import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  ConfirmationProposalSchema,
  JobRecordSchema,
  OperationRecordSchema,
  type JobRecord,
  type OperationRecord
} from "@pige/schemas";
import { ExternalOperationRecordStore } from "./external-operation-record-store";
import { JobRecordStore, type JobRecordSnapshot } from "./job-record-store";

const DEFAULT_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const SUCCESS_STATES = new Set<JobRecord["state"]>(["completed", "completed_with_warnings"]);
const SETTLED_CHILD_STATES = new Set<JobRecord["state"]>([
  "completed",
  "completed_with_warnings",
  "compacted"
]);
const SETTLED_PROPOSAL_STATES = new Set([
  "applied",
  "rejected",
  "superseded",
  "conflicted",
  "expired"
]);

export interface JobCompactionVaultPort {
  activeVaultPath(): string | undefined;
  assertWriterLease(vaultPath: string): void;
}

export interface JobCompactionResult {
  readonly scanned: number;
  readonly compacted: number;
  readonly skipped: number;
  readonly conflicted: number;
  readonly failed: number;
}

export interface JobCompactionServiceOptions {
  readonly now?: () => Date;
  readonly retentionMs?: number;
  readonly beforeCommit?: (snapshot: JobRecordSnapshot) => void;
  readonly afterOperationCommit?: (operation: OperationRecord) => void;
}

export class JobCompactionService {
  readonly #vaults: JobCompactionVaultPort;
  readonly #now: () => Date;
  readonly #retentionMs: number;
  readonly #beforeCommit: ((snapshot: JobRecordSnapshot) => void) | undefined;
  readonly #afterOperationCommit: ((operation: OperationRecord) => void) | undefined;
  readonly #operations = new ExternalOperationRecordStore();

  constructor(vaults: JobCompactionVaultPort, options: JobCompactionServiceOptions = {}) {
    this.#vaults = vaults;
    this.#now = options.now ?? (() => new Date());
    this.#retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.#beforeCommit = options.beforeCommit;
    this.#afterOperationCommit = options.afterOperationCommit;
    if (!Number.isSafeInteger(this.#retentionMs) || this.#retentionMs < 1) {
      throw new PigeDomainError("job.compaction_invalid", "The Job compaction retention window is invalid.");
    }
  }

  compactEligible(): JobCompactionResult {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { scanned: 0, compacted: 0, skipped: 0, conflicted: 0, failed: 0 };
    this.#vaults.assertWriterLease(vaultPath);
    const root = path.join(vaultPath, ".pige", "jobs");
    if (!fs.existsSync(root)) return { scanned: 0, compacted: 0, skipped: 0, conflicted: 0, failed: 0 };

    const store = new JobRecordStore({
      rootPath: root,
      assertWriterLease: () => this.#vaults.assertWriterLease(vaultPath)
    });
    const snapshots = listJobPaths(root).flatMap((filePath) => {
      try {
        return [store.read(filePath)];
      } catch {
        return [];
      }
    });
    const byId = new Map(snapshots.map((snapshot) => [snapshot.job.id, snapshot]));
    const compactedAt = this.#now();
    const cutoff = new Date(compactedAt.getTime() - this.#retentionMs);
    let compacted = 0;
    let skipped = 0;
    let conflicted = 0;
    let failed = 0;

    for (const snapshot of snapshots) {
      if (!isEligible(snapshot.job, byId, vaultPath, cutoff)) {
        skipped += 1;
        continue;
      }
      try {
        this.#beforeCommit?.(snapshot);
        const current = store.read(snapshot.path);
        if (!sameRevision(current, snapshot)) {
          conflicted += 1;
          continue;
        }
        const operationId = createCompactionOperationId(snapshot);
        const existingOperation = readExistingCompactionOperation(vaultPath, operationId, snapshot);
        const effectiveCompactedAt = existingOperation
          ? new Date(existingOperation.createdAt)
          : compactedAt;
        const effectiveCutoff = new Date(effectiveCompactedAt.getTime() - this.#retentionMs);
        const next = createCompactedJob(snapshot, operationId, effectiveCompactedAt, effectiveCutoff);
        const operation = createCompactionOperation(snapshot, next, operationId, effectiveCompactedAt);
        this.#operations.write(vaultPath, operation, () => this.#vaults.assertWriterLease(vaultPath));
        this.#afterOperationCommit?.(operation);
        store.compareAndSwap(snapshot, next);
        compacted += 1;
      } catch (caught) {
        if (caught instanceof PigeDomainError && caught.code === "job.revision_conflict") {
          conflicted += 1;
        } else {
          failed += 1;
        }
      }
    }

    return { scanned: snapshots.length, compacted, skipped, conflicted, failed };
  }
}

function isEligible(
  job: JobRecord,
  byId: ReadonlyMap<string, JobRecordSnapshot>,
  vaultPath: string,
  cutoff: Date
): boolean {
  if (!SUCCESS_STATES.has(job.state) || !job.finishedAt) return false;
  const finishedAt = Date.parse(job.finishedAt);
  if (!Number.isFinite(finishedAt) || finishedAt > cutoff.getTime()) return false;
  if (job.childJobIds?.some((id) => !SETTLED_CHILD_STATES.has(byId.get(id)?.job.state ?? "queued"))) {
    return false;
  }
  if ((job.permissionRequestIds?.length ?? 0) > (job.permissionDecisionIds?.length ?? 0)) return false;
  if (job.proposalIds?.some((id) => !isSettledProposal(vaultPath, id))) return false;
  return true;
}

function isSettledProposal(vaultPath: string, proposalId: string): boolean {
  const match = /^proposal_(\d{8})_[a-z0-9]{8,}$/u.exec(proposalId);
  if (!match) return false;
  const date = match[1]!;
  const filePath = path.join(
    vaultPath,
    ".pige",
    "proposals",
    date.slice(0, 4),
    date.slice(4, 6),
    `${proposalId}.json`
  );
  try {
    if (fs.realpathSync.native(filePath) !== path.resolve(filePath)) return false;
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) return false;
    const proposal = ConfirmationProposalSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
    return proposal.id === proposalId && SETTLED_PROPOSAL_STATES.has(proposal.state);
  } catch {
    return false;
  }
}

function createCompactedJob(
  snapshot: JobRecordSnapshot,
  operationId: string,
  compactedAt: Date,
  cutoff: Date
): JobRecord {
  const job = snapshot.job;
  const startedAt = job.startedAt ? Date.parse(job.startedAt) : Date.parse(job.createdAt);
  const finishedAt = Date.parse(job.finishedAt!);
  const retainedReferenceCount = (job.inputRefs?.length ?? 0) +
    (job.outputRefs?.length ?? 0) +
    (job.childJobIds?.length ?? 0) +
    (job.proposalIds?.length ?? 0) +
    (job.operationIds?.length ?? 0) + 1;
  const operationIds = [...new Set([...(job.operationIds ?? []), operationId])];
  const {
    stage: _stage,
    checkpoints: _checkpoints,
    retry: _retry,
    cancellation: _cancellation,
    waitingDependency: _waitingDependency,
    ...retained
  } = job;
  return JobRecordSchema.parse({
    ...retained,
    state: "compacted",
    updatedAt: compactedAt.toISOString(),
    operationIds,
    compaction: {
      schemaVersion: 1,
      compactedAt: compactedAt.toISOString(),
      retentionCutoff: cutoff.toISOString(),
      previousState: job.state,
      detailSha256: snapshot.revision.sha256,
      removedCheckpointCount: job.checkpoints?.length ?? 0,
      retainedReferenceCount,
      ...(Number.isFinite(startedAt) && Number.isFinite(finishedAt) && finishedAt >= startedAt
        ? { durationMs: finishedAt - startedAt }
        : {})
    }
  });
}

function createCompactionOperationId(snapshot: JobRecordSnapshot): string {
  const date = snapshot.job.finishedAt!.slice(0, 10).replaceAll("-", "");
  const suffix = createHash("sha256")
    .update(`pige.compact_job.v1\0${snapshot.job.id}\0${snapshot.revision.sha256}`, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `op_${date}_${suffix}`;
}

function readExistingCompactionOperation(
  vaultPath: string,
  operationId: string,
  snapshot: JobRecordSnapshot
): OperationRecord | undefined {
  const match = /^op_(\d{8})_[a-z0-9]{8,}$/u.exec(operationId);
  if (!match) return undefined;
  const date = match[1]!;
  const filePath = path.join(
    vaultPath,
    ".pige",
    "operations",
    date.slice(0, 4),
    date.slice(4, 6),
    `${operationId}.json`
  );
  try {
    if (fs.realpathSync.native(filePath) !== path.resolve(filePath)) return undefined;
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) return undefined;
    const operation = OperationRecordSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
    if (
      operation.id !== operationId ||
      operation.kind !== "compact_job" ||
      operation.jobId !== snapshot.job.id ||
      operation.before?.kind !== "job" ||
      operation.before.id !== snapshot.job.id ||
      operation.before.checksum !== snapshot.revision.sha256
    ) return undefined;
    return operation;
  } catch {
    return undefined;
  }
}

function createCompactionOperation(
  snapshot: JobRecordSnapshot,
  next: JobRecord,
  operationId: string,
  compactedAt: Date
): OperationRecord {
  const afterChecksum = sha256(serializeJob(next));
  return OperationRecordSchema.parse({
    id: operationId,
    schemaVersion: 1,
    jobId: snapshot.job.id,
    createdAt: compactedAt.toISOString(),
    actor: snapshot.job.actor ?? {
      kind: "system",
      runtimeKind: "desktop_local",
      clientCapabilityTier: "desktop_full"
    },
    kind: "compact_job",
    targetRefs: [{ kind: "job", id: snapshot.job.id, checksum: afterChecksum }],
    sourceRefs: [{ kind: "job", id: snapshot.job.id, checksum: snapshot.revision.sha256 }],
    before: { kind: "job", id: snapshot.job.id, checksum: snapshot.revision.sha256 },
    after: { kind: "job", id: snapshot.job.id, checksum: afterChecksum },
    summary: "Compacted retained successful Job detail after the configured retention window.",
    reversible: "no",
    warnings: []
  });
}

function listJobPaths(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) files.push(...listJobPaths(candidate));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(candidate);
  }
  return files.sort();
}

function sameRevision(left: JobRecordSnapshot, right: JobRecordSnapshot): boolean {
  return left.job.id === right.job.id &&
    left.revision.sha256 === right.revision.sha256 &&
    left.revision.size === right.revision.size &&
    left.revision.dev === right.revision.dev &&
    left.revision.ino === right.revision.ino;
}

function serializeJob(job: JobRecord): Buffer {
  return Buffer.from(`${JSON.stringify(job, null, 2)}\n`, "utf8");
}

function sha256(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
