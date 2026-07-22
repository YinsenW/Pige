import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  PigeErrorSummary,
  ReaderSelectionIdentity,
  ReaderSelectionProposalDecisionRequest,
  ReaderSelectionProposalDecisionResult,
  ReaderSelectionProposalGetRequest,
  ReaderSelectionProposalGetResult,
  ReaderSelectionProposalPreview,
  ReaderSelectionTransformAction,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  JobIdSchema,
  OperationIdSchema,
  ReaderSelectionIdentitySchema,
  ReaderSelectionProposalIdSchema,
  ReaderSelectionProposalStateSchema,
  ReaderSelectionTransformActionSchema,
  VaultIdSchema,
  type JobRecord,
  type OperationRecord
} from "@pige/schemas";
import { z } from "zod";
import { containsRestrictedModelContent } from "./model-egress-content";
import {
  createReaderSelectionReviewResolution
} from "./reader-selection-job-binding";
import type { ResolveJobReviewInput } from "./job-execution-coordinator";

const MAX_RECORD_BYTES = 64 * 1024;
const MAX_REPLACEMENT_BYTES = 16 * 1024;
const MAX_PREVIEW_LINES = 8;
const MAX_PREVIEW_LINE_CHARACTERS = 160;
const REVIEW_REPLACEMENT_BYTES = 4 * 1024;

const ReaderSelectionProposalRecordSchema = z.object({
  schemaVersion: z.literal(1),
  proposalId: ReaderSelectionProposalIdSchema,
  revision: z.number().int().min(1),
  state: ReaderSelectionProposalStateSchema,
  activeVaultId: VaultIdSchema,
  jobId: JobIdSchema,
  action: ReaderSelectionTransformActionSchema,
  selection: ReaderSelectionIdentitySchema,
  replacement: z.string().min(1).max(MAX_REPLACEMENT_BYTES),
  previewLines: z.array(z.object({
    kind: z.enum(["context", "removed", "added"]),
    text: z.string().min(1).max(MAX_PREVIEW_LINE_CHARACTERS)
  }).strict()).max(MAX_PREVIEW_LINES),
  intentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  operationId: OperationIdSchema.optional()
}).strict();

type ReaderSelectionProposalRecord = z.infer<typeof ReaderSelectionProposalRecordSchema>;

export interface ReaderSelectionProposalVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export interface ReaderSelectionProposalJobPort {
  readAgentTurnJob(jobId: string): JobRecord | undefined;
  resolveAgentTurnReview(input: ResolveJobReviewInput & { readonly job: JobRecord }): JobRecord;
}

export interface ReaderSelectionProposalWriterPort {
  apply(input: {
    readonly vaultPath: string;
    readonly job: JobRecord;
    readonly selection: ReaderSelectionIdentity;
    readonly replacement: string;
    readonly action: ReaderSelectionTransformAction;
  }): OperationRecord;
}

export class ReaderSelectionProposalService {
  readonly #vaults: ReaderSelectionProposalVaultPort;
  readonly #jobs: ReaderSelectionProposalJobPort;
  readonly #writer: ReaderSelectionProposalWriterPort;

  constructor(
    vaults: ReaderSelectionProposalVaultPort,
    jobs: ReaderSelectionProposalJobPort,
    writer: ReaderSelectionProposalWriterPort
  ) {
    this.#vaults = vaults;
    this.#jobs = jobs;
    this.#writer = writer;
  }

  shouldRequireReview(selection: ReaderSelectionIdentity, replacement: string): boolean {
    const replacementBytes = Buffer.byteLength(replacement, "utf8");
    const selectedBytes = selection.span.endExclusive - selection.span.start;
    return replacementBytes > REVIEW_REPLACEMENT_BYTES ||
      replacementBytes > selectedBytes * 2 + 512;
  }

  stage(input: {
    readonly job: JobRecord;
    readonly action: ReaderSelectionTransformAction;
    readonly selection: ReaderSelectionIdentity;
    readonly selectedText: string;
    readonly replacement: string;
  }): ReaderSelectionProposalPreview {
    const { vault, vaultPath } = this.#requireVault();
    if (input.job.activeVaultId !== vault.vaultId || input.job.class !== "agent_turn") {
      throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The Reader proposal Job binding is invalid.");
    }
    if (Buffer.byteLength(input.replacement, "utf8") > MAX_REPLACEMENT_BYTES) {
      throw new PigeDomainError("agent_ingest.update_content_restricted", "The Reader transform replacement is too large.");
    }
    if (containsRestrictedModelContent(input.replacement)) {
      throw new PigeDomainError(
        "agent_ingest.update_content_restricted",
        "The Reader transform replacement contains restricted content."
      );
    }
    const proposalId = proposalIdForJob(input.job.id);
    const intentHash = hashIntent(input.job.id, input.action, input.selection, input.replacement);
    const existing = readRecord(vaultPath, proposalId);
    if (existing) {
      if (existing.intentHash !== intentHash || existing.activeVaultId !== vault.vaultId) {
        throw new PigeDomainError("proposal.identity_conflict", "The Reader proposal identity is already bound to another intent.");
      }
      return project(existing, input.selectedText);
    }
    const now = new Date().toISOString();
    const record = ReaderSelectionProposalRecordSchema.parse({
      schemaVersion: 1,
      proposalId,
      revision: 1,
      state: "ready",
      activeVaultId: vault.vaultId,
      jobId: input.job.id,
      action: input.action,
      selection: input.selection,
      replacement: input.replacement,
      previewLines: createPreviewLines(input.selectedText, input.replacement),
      intentHash,
      createdAt: now,
      updatedAt: now
    });
    writeRecordCreate(vaultPath, record);
    return project(requireRecord(vaultPath, proposalId), input.selectedText);
  }

  get(request: ReaderSelectionProposalGetRequest): ReaderSelectionProposalGetResult {
    const current = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!current || !vaultPath) return { apiVersion: 1, status: "unavailable", reason: "vault_changed" };
    try {
      const record = readRecord(vaultPath, request.proposalId);
      if (!record) return { apiVersion: 1, status: "unavailable", reason: "not_found" };
      if (record.activeVaultId !== current.vaultId) {
        return { apiVersion: 1, status: "unavailable", reason: "vault_changed" };
      }
      return { apiVersion: 1, status: "available", proposal: project(this.#reconcile(vaultPath, record)) };
    } catch {
      return { apiVersion: 1, status: "unavailable", reason: "record_invalid" };
    }
  }

  decide(request: ReaderSelectionProposalDecisionRequest): ReaderSelectionProposalDecisionResult {
    try {
      return this.#decide(request);
    } catch (caught) {
      if (caught instanceof PigeDomainError && new Set([
        "proposal.not_found",
        "proposal.revision_conflict",
        "vault.no_active_vault"
      ]).has(caught.code)) {
        return { apiVersion: 1, status: "stale" };
      }
      return { apiVersion: 1, status: "failed", error: proposalFailureError() };
    }
  }

  #decide(request: ReaderSelectionProposalDecisionRequest): ReaderSelectionProposalDecisionResult {
    const { vault, vaultPath } = this.#requireVault();
    const current = readRecord(vaultPath, request.proposalId);
    if (!current || current.activeVaultId !== vault.vaultId) {
      return { apiVersion: 1, status: "stale" };
    }
    if (current.revision !== request.expectedRevision || current.state !== "ready") {
      return { apiVersion: 1, status: "stale", proposal: project(this.#reconcile(vaultPath, current)) };
    }
    if (request.decision === "reject") {
      const rejected = replaceRecord(vaultPath, current, { state: "rejected" });
      const job = this.#jobs.readAgentTurnJob(current.jobId);
      if (!job) return { apiVersion: 1, status: "stale", proposal: project(rejected) };
      try {
        this.#resolveReview(job, { proposalId: current.proposalId, result: "completed" });
      } catch {
        // The durable rejection remains authoritative; get() retries Job reconciliation.
      }
      return { apiVersion: 1, status: "rejected", proposal: project(rejected) };
    }

    const resolving = replaceRecord(vaultPath, current, { state: "resolving" });
    const job = this.#jobs.readAgentTurnJob(current.jobId);
    if (!job) {
      const conflicted = replaceRecord(vaultPath, resolving, { state: "conflicted" });
      return { apiVersion: 1, status: "conflicted", proposal: project(conflicted) };
    }
    let operation: OperationRecord;
    try {
      operation = this.#writer.apply({
        vaultPath,
        job,
        selection: current.selection,
        replacement: current.replacement,
        action: current.action
      });
    } catch (caught) {
      const conflicted = replaceRecord(vaultPath, resolving, { state: "conflicted" });
      const error = conflictError();
      try {
        this.#resolveReview(job, {
          proposalId: current.proposalId,
          result: "failed_final",
          error
        });
      } catch {
        // The durable proposal remains conflicted even if its parent Job changed concurrently.
      }
      if (isExpectedConflict(caught)) {
        return { apiVersion: 1, status: "conflicted", proposal: project(conflicted) };
      }
      return { apiVersion: 1, status: "failed", error };
    }

    const applied = replaceRecord(vaultPath, resolving, {
      state: "applied",
      operationId: operation.id
    });
    try {
      this.#resolveReview(job, {
        proposalId: current.proposalId,
        result: "completed",
        operationId: operation.id
      });
    } catch {
      // The durable apply remains authoritative; get() retries Job reconciliation.
    }
    return {
      apiVersion: 1,
      status: "applied",
      proposal: project(applied),
      operationId: operation.id
    };
  }

  #requireVault(): { readonly vault: VaultSummary; readonly vaultPath: string } {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vault || !vaultPath) {
      throw new PigeDomainError("vault.no_active_vault", "No active vault is available.");
    }
    return { vault, vaultPath };
  }

  #reconcile(vaultPath: string, record: ReaderSelectionProposalRecord): ReaderSelectionProposalRecord {
    let current = record;
    const job = this.#jobs.readAgentTurnJob(current.jobId);
    if (!job) return current;
    if (current.state === "resolving") {
      try {
        const operation = this.#writer.apply({
          vaultPath,
          job,
          selection: current.selection,
          replacement: current.replacement,
          action: current.action
        });
        current = replaceRecord(vaultPath, current, {
          state: "applied",
          operationId: operation.id
        });
      } catch {
        current = replaceRecord(vaultPath, current, { state: "conflicted" });
      }
    }
    try {
      if (current.state === "applied" && current.operationId) {
        this.#resolveReview(job, {
          proposalId: current.proposalId,
          result: "completed",
          operationId: current.operationId
        });
      } else if (current.state === "rejected") {
        this.#resolveReview(job, { proposalId: current.proposalId, result: "completed" });
      } else if (current.state === "conflicted") {
        this.#resolveReview(job, {
          proposalId: current.proposalId,
          result: "failed_final",
          error: conflictError()
        });
      }
    } catch {
      // A terminal or concurrently advanced parent already owns the settled state.
    }
    return current;
  }

  #resolveReview(job: JobRecord, input: {
    readonly proposalId: string;
    readonly result: "completed" | "failed_final";
    readonly operationId?: string;
    readonly error?: PigeErrorSummary;
  }): JobRecord {
    return this.#jobs.resolveAgentTurnReview({
      job,
      ...createReaderSelectionReviewResolution(input)
    });
  }
}

function proposalIdForJob(jobId: string): string {
  const dateKey = /^job_(\d{8})_/u.exec(jobId)?.[1] ?? "19700101";
  const suffix = createHash("sha256")
    .update(`pige.reader-selection-proposal.v1\0${jobId}`, "utf8")
    .digest("hex")
    .slice(0, 20);
  return `proposal_${dateKey}_${suffix}`;
}

function hashIntent(
  jobId: string,
  action: ReaderSelectionTransformAction,
  selection: ReaderSelectionIdentity,
  replacement: string
): string {
  return `sha256:${createHash("sha256").update(JSON.stringify({ jobId, action, selection, replacement })).digest("hex")}`;
}

function project(record: ReaderSelectionProposalRecord, _selectedText?: string): ReaderSelectionProposalPreview {
  return {
    proposalId: record.proposalId,
    action: record.action,
    state: record.state,
    revision: record.revision,
    lines: record.previewLines
  };
}

function createPreviewLines(selectedText: string, replacement: string): ReaderSelectionProposalPreview["lines"] {
  const removed = boundedLines(selectedText, "removed", 4);
  const added = boundedLines(replacement, "added", Math.max(1, MAX_PREVIEW_LINES - removed.length));
  return [...removed, ...added].slice(0, MAX_PREVIEW_LINES);
}

function boundedLines(
  text: string,
  kind: "removed" | "added",
  limit: number
): ReaderSelectionProposalPreview["lines"] {
  return text.split(/\r?\n/u)
    .map((line) => line.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim())
    .filter((line) => line.length > 0 && !containsRestrictedModelContent(line))
    .slice(0, limit)
    .map((line) => ({ kind, text: line.slice(0, MAX_PREVIEW_LINE_CHARACTERS) }));
}

function recordsDirectory(vaultPath: string): string {
  return path.join(vaultPath, ".pige", "reader-selection-proposals");
}

function recordPath(vaultPath: string, proposalId: string): string {
  ReaderSelectionProposalIdSchema.parse(proposalId);
  return path.join(recordsDirectory(vaultPath), `${proposalId}.json`);
}

function requireRecord(vaultPath: string, proposalId: string): ReaderSelectionProposalRecord {
  const record = readRecord(vaultPath, proposalId);
  if (!record) throw new PigeDomainError("proposal.not_found", "Reader proposal record was not found.");
  return record;
}

function readRecord(vaultPath: string, proposalId: string): ReaderSelectionProposalRecord | undefined {
  const filePath = recordPath(vaultPath, proposalId);
  if (!fs.existsSync(filePath)) return undefined;
  const stat = fs.lstatSync(filePath);
  const realVault = fs.realpathSync(vaultPath);
  const realFile = fs.realpathSync(filePath);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > MAX_RECORD_BYTES ||
    !realFile.startsWith(`${realVault}${path.sep}`)
  ) {
    throw new PigeDomainError("proposal.record_invalid", "Reader proposal record is not a private regular file.");
  }
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const current = fs.fstatSync(descriptor);
    if (current.dev !== stat.dev || current.ino !== stat.ino || current.size !== stat.size) {
      throw new PigeDomainError("proposal.record_invalid", "Reader proposal record changed during read.");
    }
    const bytes = Buffer.alloc(current.size);
    if (fs.readSync(descriptor, bytes, 0, bytes.length, 0) !== bytes.length) {
      throw new PigeDomainError("proposal.record_invalid", "Reader proposal record could not be read exactly.");
    }
    return ReaderSelectionProposalRecordSchema.parse(JSON.parse(bytes.toString("utf8")));
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeRecordCreate(vaultPath: string, record: ReaderSelectionProposalRecord): void {
  const directory = recordsDirectory(vaultPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  const realVault = fs.realpathSync(vaultPath);
  const realDirectory = fs.realpathSync(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    !realDirectory.startsWith(`${realVault}${path.sep}`)
  ) {
    throw new PigeDomainError("proposal.record_invalid", "Reader proposal directory is unsafe.");
  }
  const filePath = recordPath(vaultPath, record.proposalId);
  const descriptor = fs.openSync(
    filePath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
    0o600
  );
  try {
    const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8");
    if (bytes.length > MAX_RECORD_BYTES) throw new PigeDomainError("proposal.record_invalid", "Reader proposal record is too large.");
    fs.writeSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function replaceRecord(
  vaultPath: string,
  expected: ReaderSelectionProposalRecord,
  patch: { readonly state: ReaderSelectionProposalRecord["state"]; readonly operationId?: string }
): ReaderSelectionProposalRecord {
  const current = requireRecord(vaultPath, expected.proposalId);
  if (current.revision !== expected.revision || current.intentHash !== expected.intentHash) {
    throw new PigeDomainError("proposal.revision_conflict", "Reader proposal changed before commit.");
  }
  const next = ReaderSelectionProposalRecordSchema.parse({
    ...current,
    state: patch.state,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
    ...(patch.operationId ? { operationId: patch.operationId } : {})
  });
  const filePath = recordPath(vaultPath, next.proposalId);
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    const before = requireRecord(vaultPath, expected.proposalId);
    if (before.revision !== expected.revision || before.intentHash !== expected.intentHash) {
      throw new PigeDomainError("proposal.revision_conflict", "Reader proposal changed before replace.");
    }
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
  return requireRecord(vaultPath, next.proposalId);
}

function conflictError(): PigeErrorSummary {
  return {
    code: "agent_runtime.proposal_conflicted",
    domain: "agent_runtime",
    messageKey: "error.generic",
    retryable: false,
    severity: "error",
    userAction: "none"
  };
}

function proposalFailureError(): PigeErrorSummary {
  return {
    code: "agent_runtime.proposal_decision_failed",
    domain: "agent_runtime",
    messageKey: "error.generic",
    retryable: false,
    severity: "error",
    userAction: "none"
  };
}

function isExpectedConflict(value: unknown): boolean {
  return value instanceof PigeDomainError && new Set([
    "agent_ingest.page_conflict",
    "agent_ingest.update_target_ineligible",
    "agent_runtime.turn_binding_invalid",
    "proposal.revision_conflict"
  ]).has(value.code);
}
