import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { JobRecordSchema, type JobRecord, type JobRef } from "@pige/schemas";
import {
  captureBackupDestinationFence,
  canonicalizeBackupDestinationPath
} from "./backup-service";
import { JobRecordStore, type JobRecordSnapshot } from "./job-record-store";

const DESTINATION_DEPENDENCY_KIND = "external_destination" as const;
const DESTINATION_RECONNECT_LOCATOR = "backup_destination_reconnect";

export interface BackupDestinationReconnectCandidate {
  readonly jobId: string;
  readonly vaultId: string;
  readonly jobUpdatedAt: string;
  readonly dependencyId: string;
}

export type BackupDestinationReconnectCandidateResult =
  | { readonly status: "ready"; readonly candidate: BackupDestinationReconnectCandidate }
  | { readonly status: "stale" | "not_found" | "ineligible" };

export function isBackupDestinationReconnectFailure(caught: unknown): boolean {
  return caught instanceof PigeDomainError && (
    caught.code === "backup.destination_changed" ||
    caught.code === "backup.destination_not_writable"
  );
}

export function backupDestinationDependency(job: JobRecord): {
  readonly dependencyKind: typeof DESTINATION_DEPENDENCY_KIND;
  readonly dependencyId: string;
  readonly requiredAction: "reconnect_path";
  readonly messageKey: string;
} {
  const destination = readDestination(job);
  return {
    dependencyKind: DESTINATION_DEPENDENCY_KIND,
    dependencyId: destinationDependencyId(job, destination),
    requiredAction: "reconnect_path",
    messageKey: "errors.backup.destination_reconnect_required"
  };
}

export function inspectBackupDestinationReconnectCandidate(
  activeVaultId: string,
  requestedVaultId: string,
  jobId: string,
  expectedJobUpdatedAt: string,
  snapshot: JobRecordSnapshot | undefined
): BackupDestinationReconnectCandidateResult {
  if (activeVaultId !== requestedVaultId) return { status: "stale" };
  if (!snapshot) return { status: "not_found" };
  const job = snapshot.job;
  if (job.class !== "backup") return { status: "ineligible" };
  if (
    job.id !== jobId || job.activeVaultId !== requestedVaultId ||
    job.updatedAt !== expectedJobUpdatedAt
  ) return { status: "stale" };
  const waiting = job.waitingDependency;
  if (
    job.state !== "waiting_dependency" ||
    waiting?.dependencyKind !== DESTINATION_DEPENDENCY_KIND ||
    waiting.requiredAction !== "reconnect_path" ||
    !waiting.dependencyId || checkpointDone(job, "archive_finalized")
  ) return { status: "ineligible" };
  let expectedDependencyId: string;
  try {
    expectedDependencyId = destinationDependencyId(job, readDestination(job));
  } catch {
    return { status: "ineligible" };
  }
  if (waiting.dependencyId !== expectedDependencyId) return { status: "stale" };
  return {
    status: "ready",
    candidate: {
      jobId,
      vaultId: requestedVaultId,
      jobUpdatedAt: expectedJobUpdatedAt,
      dependencyId: expectedDependencyId
    }
  };
}

export function reconnectBackupDestination(options: {
  readonly store: JobRecordStore;
  readonly snapshot: JobRecordSnapshot | undefined;
  readonly candidate: BackupDestinationReconnectCandidate;
  readonly selectedDirectory: string;
  readonly vaultPath: string;
  readonly now: Date;
}): JobRecordSnapshot {
  const { snapshot, candidate } = options;
  const inspected = inspectBackupDestinationReconnectCandidate(
    candidate.vaultId,
    candidate.vaultId,
    candidate.jobId,
    candidate.jobUpdatedAt,
    snapshot
  );
  if (inspected.status !== "ready" || !sameCandidate(inspected.candidate, candidate)) {
    throw new PigeDomainError("backup.destination_reconnect_stale", "The Backup destination reconnect identity is stale.");
  }
  const oldDestination = readDestination(snapshot!.job);
  const selectedDirectory = canonicalDirectory(options.selectedDirectory);
  const newDestination = canonicalizeBackupDestinationPath(
    path.join(selectedDirectory, path.basename(oldDestination))
  );
  assertOutsideVault(options.vaultPath, newDestination);
  captureBackupDestinationFence(newDestination);
  if (fs.existsSync(newDestination)) {
    throw new PigeDomainError("backup.destination_exists", "The selected Backup destination already exists.");
  }
  const updatedAt = monotonicTimestamp(snapshot!.job.updatedAt, options.now);
  const receipt: JobRef = {
    kind: "root_binding",
    id: candidate.dependencyId,
    locator: DESTINATION_RECONNECT_LOCATOR,
    checksum: reconnectReceiptChecksum(snapshot!.job, candidate, newDestination),
    role: "backup_destination_reconnect"
  };
  const job = snapshot!.job;
  const next = JobRecordSchema.parse({
    ...job,
    state: "queued",
    updatedAt,
    inputRefs: [
      ...replaceDestinationRefs(job.inputRefs ?? [], newDestination),
      ...((job.inputRefs ?? []).some((ref) => ref.role === receipt.role && ref.id === receipt.id) ? [] : [receipt])
    ],
    checkpoints: job.checkpoints?.map((checkpoint) => ({
      ...checkpoint,
      inputRefs: replaceDestinationRefs(checkpoint.inputRefs, newDestination)
    })),
    retry: {
      retryCount: (job.retry?.retryCount ?? 0) + 1,
      maxAutomaticRetries: job.retry?.maxAutomaticRetries ?? 0,
      requiresUserAction: false,
      lastRetryReason: "backup.destination_reconnected"
    },
    message: "Backup destination was reconnected and the same Job is queued.",
    stage: undefined,
    startedAt: undefined,
    finishedAt: undefined,
    progress: undefined,
    waitingDependency: undefined,
    error: undefined
  });
  return options.store.compareAndSwap(snapshot!, next);
}

export function canReconnectBackupDestination(job: JobRecord): boolean {
  const waiting = job.waitingDependency;
  if (
    job.class !== "backup" || job.state !== "waiting_dependency" ||
    waiting?.dependencyKind !== DESTINATION_DEPENDENCY_KIND ||
    waiting.requiredAction !== "reconnect_path" || !waiting.dependencyId ||
    checkpointDone(job, "archive_finalized")
  ) return false;
  try {
    return waiting.dependencyId === destinationDependencyId(job, readDestination(job));
  } catch {
    return false;
  }
}

function replaceDestinationRefs(refs: readonly JobRef[], destinationPath: string): JobRef[] {
  return refs.map((ref) => ref.role === "backup_destination"
    ? { ...ref, kind: "external_uri" as const, path: destinationPath }
    : ref);
}

function readDestination(job: JobRecord): string {
  const destinations = (job.inputRefs ?? []).filter((ref) => ref.role === "backup_destination");
  if (destinations.length !== 1 || !destinations[0]?.path) {
    throw new PigeDomainError("backup.job_conflict", "The Backup Job has no unique destination binding.");
  }
  const resolved = path.resolve(destinations[0].path);
  if (resolved !== destinations[0].path || !resolved.endsWith(".pige-backup.zip")) {
    throw new PigeDomainError("backup.job_conflict", "The Backup destination binding is invalid.");
  }
  return resolved;
}

function destinationDependencyId(job: JobRecord, destinationPath: string): string {
  const backupId = job.inputRefs?.find((ref) => ref.role === "backup_identity")?.id;
  if (!backupId || !job.activeVaultId) {
    throw new PigeDomainError("backup.job_conflict", "The Backup identity is incomplete.");
  }
  return `backup_destination:${createHash("sha256").update(JSON.stringify({
    version: 1,
    jobId: job.id,
    vaultId: job.activeVaultId,
    backupId,
    destinationPath
  }), "utf8").digest("hex")}`;
}

function reconnectReceiptChecksum(
  job: JobRecord,
  candidate: BackupDestinationReconnectCandidate,
  destinationPath: string
): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify({
    version: 1,
    jobId: job.id,
    vaultId: candidate.vaultId,
    dependencyId: candidate.dependencyId,
    destinationPath
  }), "utf8").digest("hex")}`;
}

function canonicalDirectory(directoryPath: string): string {
  const resolved = path.resolve(directoryPath);
  try {
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("unsafe directory");
    }
    return fs.realpathSync.native(resolved);
  } catch {
    throw new PigeDomainError("backup.destination_reconnect_invalid", "The selected Backup directory is unavailable or unsafe.");
  }
}

function assertOutsideVault(vaultPath: string, destinationPath: string): void {
  const canonicalVault = fs.realpathSync.native(path.resolve(vaultPath));
  const relative = path.relative(canonicalVault, destinationPath);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..")) {
    throw new PigeDomainError("backup.path_inside_vault", "The Backup destination must remain outside the vault.");
  }
}

function checkpointDone(job: JobRecord, checkpointId: string): boolean {
  return job.checkpoints?.some((checkpoint) => checkpoint.id === checkpointId && checkpoint.state === "done") === true;
}

function monotonicTimestamp(current: string, now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new PigeDomainError("job.clock_invalid", "The Job clock is invalid.");
  return new Date(Math.max(now.getTime(), Date.parse(current) + 1)).toISOString();
}

function sameCandidate(
  left: BackupDestinationReconnectCandidate,
  right: BackupDestinationReconnectCandidate
): boolean {
  return left.jobId === right.jobId && left.vaultId === right.vaultId &&
    left.jobUpdatedAt === right.jobUpdatedAt && left.dependencyId === right.dependencyId;
}
