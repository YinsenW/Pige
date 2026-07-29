import { createHash } from "node:crypto";
import path from "node:path";
import type { BackupCreateResult } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  BackupIdSchema,
  JobIdSchema,
  JobRecordSchema,
  type JobCheckpoint,
  type JobRecord,
  type JobRef
} from "@pige/schemas";
import type {
  BackupManagedCopyDependencyIdentity,
  BackupManagedCopyRepairProof
} from "./backup-managed-copy-binding";
import type {
  BackupCreateOptions,
  BackupDestinationFence,
  RestoreCorePreviewResult
} from "./backup-service";
import {
  captureBackupDestinationFence,
  canonicalizeBackupDestinationPath
} from "./backup-service";
import { JobExecutionCoordinator } from "./job-execution-coordinator";
import { JobRecordStore, type JobRecordSnapshot } from "./job-record-store";

export interface BackupReconnectCandidate extends BackupManagedCopyDependencyIdentity {
  readonly jobId: string;
  readonly vaultId: string;
  readonly jobUpdatedAt: string;
}

export interface BackupIncompleteCandidate {
  readonly jobId: string;
  readonly vaultId: string;
  readonly jobUpdatedAt: string;
  readonly rootId: string;
}

export interface BackupBinding {
  readonly jobId: string;
  readonly backupId: string;
  readonly createdAt: string;
  readonly vaultId: string;
  readonly vaultPath: string;
  readonly destinationPath: string;
  readonly destinationFence: BackupDestinationFence;
}

export type BackupIncompleteCandidateResult =
  | { readonly status: "ready"; readonly candidate: BackupIncompleteCandidate }
  | { readonly status: "stale" | "not_found" | "ineligible" };

export type BackupReconnectCandidateResult =
  | { readonly status: "ready"; readonly candidate: BackupReconnectCandidate }
  | { readonly status: "stale" | "not_found" };

export interface BackupJobRequest {
  readonly jobId: string;
}

export interface BackupRecoveryResult {
  readonly recovered: number;
  readonly failed: number;
}

export interface BackupRetryResult {
  readonly status: "requeued" | "not_allowed";
  readonly job: JobRecord;
}

export interface BackupReconnectServicePort {
  proveManagedCopyDependency(
    vaultPath: string,
    vaultId: string,
    dependency: BackupManagedCopyDependencyIdentity
  ): BackupManagedCopyRepairProof | undefined;
  repairManagedCopyDependency(
    vaultPath: string,
    vaultId: string,
    dependency: BackupManagedCopyDependencyIdentity,
    selectedDirectory: string
  ): BackupManagedCopyRepairProof;
}

export interface BackupServicePort extends BackupReconnectServicePort {
  createBackup(
    vaultPath: string,
    destinationPath: string,
    appVersion: string,
    options: BackupCreateOptions
  ): Promise<BackupCreateResult>;
  inspectRestoreArchive(backupPath: string): Promise<RestoreCorePreviewResult>;
}

export function inspectBackupReconnectCandidate(
  activeVaultId: string,
  requestedVaultId: string,
  jobId: string,
  snapshot: JobRecordSnapshot | undefined
): BackupReconnectCandidateResult {
  if (activeVaultId !== requestedVaultId) return { status: "stale" };
  if (!snapshot || snapshot.job.class !== "backup") return { status: "not_found" };
  const waiting = snapshot.job.waitingDependency;
  if (
    snapshot.job.activeVaultId !== requestedVaultId ||
    snapshot.job.state !== "waiting_dependency" ||
    !waiting || waiting.requiredAction !== "reconnect_path" ||
    (waiting.dependencyKind !== "vault_binding" && waiting.dependencyKind !== "external_source") ||
    !waiting.dependencyId
  ) return { status: "stale" };
  return {
    status: "ready",
    candidate: {
      jobId,
      vaultId: requestedVaultId,
      jobUpdatedAt: snapshot.job.updatedAt,
      dependencyKind: waiting.dependencyKind,
      dependencyId: waiting.dependencyId
    }
  };
}

export function inspectBackupIncompleteCandidate(
  activeVaultId: string,
  requestedVaultId: string,
  jobId: string,
  expectedJobUpdatedAt: string,
  snapshot: JobRecordSnapshot | undefined
): BackupIncompleteCandidateResult {
  if (activeVaultId !== requestedVaultId) return { status: "stale" };
  if (!snapshot) return { status: "not_found" };
  if (snapshot.job.class !== "backup") return { status: "ineligible" };
  const waiting = snapshot.job.waitingDependency;
  if (
    snapshot.job.activeVaultId !== requestedVaultId ||
    snapshot.job.updatedAt !== expectedJobUpdatedAt
  ) return { status: "stale" };
  if (
    snapshot.job.state !== "waiting_dependency" ||
    waiting?.dependencyKind !== "vault_binding" ||
    waiting.requiredAction !== "reconnect_path" ||
    !waiting.dependencyId
  ) return { status: "ineligible" };
  return {
    status: "ready",
    candidate: {
      jobId,
      vaultId: requestedVaultId,
      jobUpdatedAt: snapshot.job.updatedAt,
      rootId: waiting.dependencyId
    }
  };
}

export function prepareIncompleteBackupJob(
  store: JobRecordStore,
  snapshot: JobRecordSnapshot | undefined,
  candidate: BackupIncompleteCandidate,
  now: Date
): JobRecordSnapshot | undefined {
  if (!snapshot || !sameIncompleteCandidate(snapshot.job, candidate)) return undefined;
  const owner = new JobExecutionCoordinator(store, { now: () => now });
  let current = snapshot;
  if (!hasOmissionReceipt(current.job, candidate.rootId)) {
    current = owner.patch(current, {
      inputRefs: [...(current.job.inputRefs ?? []), omissionReceipt(current.job, candidate.rootId)],
      warnings: mergeOmissionWarning(current.job)
    });
  }
  return owner.prepareRetry(current, {
    message: "Incomplete Backup continuation is queued with its original identity."
  });
}

export function prepareIncompleteBackupRecovery(
  store: JobRecordStore,
  snapshot: JobRecordSnapshot,
  now: Date
): JobRecordSnapshot | undefined {
  const waiting = snapshot.job.waitingDependency;
  if (
    snapshot.job.class !== "backup" || snapshot.job.state !== "waiting_dependency" ||
    waiting?.dependencyKind !== "vault_binding" || waiting.requiredAction !== "reconnect_path" ||
    !waiting.dependencyId || !hasOmissionReceipt(snapshot.job, waiting.dependencyId)
  ) return undefined;
  return new JobExecutionCoordinator(store, { now: () => now }).prepareRetry(snapshot, {
    message: "Incomplete Backup continuation was recovered with its original identity."
  });
}

export function omittedExternalManagedCopyRootIds(job: JobRecord): readonly string[] {
  const roots = (job.inputRefs ?? []).filter((ref) =>
    ref.kind === "root_binding" && ref.role === "backup_incomplete_omission" &&
    ref.locator === "vault_binding" && ref.id && ref.checksum
  ).flatMap((ref) => ref.id && ref.checksum === omissionReceiptChecksum(job, ref.id) ? [ref.id] : []);
  return [...new Set(roots)].sort((left, right) => left.localeCompare(right));
}

export function repairBackupReconnectCandidate(options: {
  readonly candidate: BackupReconnectCandidate;
  readonly selectedDirectory: string;
  readonly vaultPath: string;
  readonly vaultId: string;
  readonly service: BackupReconnectServicePort;
  readonly inspect: () => BackupReconnectCandidateResult;
  readonly prepareSameJob: () => "queued" | "stale" | "not_found";
}): "resolved" | "stale" | "not_found" | "failed" {
  const current = options.inspect();
  if (current.status !== "ready") return current.status;
  if (!sameCandidate(current.candidate, options.candidate)) return "stale";
  let proof: BackupManagedCopyRepairProof;
  try {
    proof = options.service.repairManagedCopyDependency(
      options.vaultPath,
      options.vaultId,
      options.candidate,
      options.selectedDirectory
    );
  } catch (caught) {
    if (caught instanceof PigeDomainError && caught.code === "backup.reconnect_not_found") return "not_found";
    if (
      caught instanceof PigeDomainError &&
      (caught.code === "backup.reconnect_stale" || caught.code === "backup.reconnect_mismatch")
    ) return "stale";
    return "failed";
  }
  const afterRepair = options.inspect();
  if (afterRepair.status !== "ready") return afterRepair.status;
  if (!sameCandidate(afterRepair.candidate, options.candidate)) return "stale";
  const rereadProof = options.service.proveManagedCopyDependency(
    options.vaultPath,
    options.vaultId,
    options.candidate
  );
  if (!rereadProof || rereadProof.proofDigest !== proof.proofDigest) return "failed";
  const prepared = options.prepareSameJob();
  return prepared === "queued" ? "resolved" : prepared;
}

export function proveWaitingDependency(
  service: BackupReconnectServicePort,
  vaultPath: string,
  vaultId: string,
  waiting: JobRecord["waitingDependency"]
): boolean {
  const dependency = managedCopyDependency(waiting);
  return Boolean(
    waiting?.requiredAction === "reconnect_path" && dependency &&
    service.proveManagedCopyDependency(vaultPath, vaultId, dependency)
  );
}

export function prepareReconnectedJob(
  store: JobRecordStore,
  snapshot: JobRecordSnapshot | undefined,
  now: Date,
  enqueue: (queued: JobRecordSnapshot) => void
): "queued" | "stale" | "not_found" {
  if (!snapshot) return "not_found";
  try {
    const queued = new JobExecutionCoordinator(store, { now: () => now }).prepareRetry(snapshot, {
      message: "Backup reconnect is accepted with its original identity."
    });
    enqueue(queued);
    return "queued";
  } catch {
    return "stale";
  }
}

export function startBackupJob(
  store: JobRecordStore,
  snapshot: JobRecordSnapshot,
  now: Date
): JobRecordSnapshot {
  if (snapshot.job.state === "running") return snapshot;
  if (snapshot.job.state === "queued" || snapshot.job.state === "failed_retryable") {
    return new JobExecutionCoordinator(store, { now: () => now }).begin(snapshot, {
      stage: "backing_up",
      message: "Backup is running."
    });
  }
  throw new PigeDomainError("backup.job_conflict", "The Backup Job cannot start from its durable state.");
}

export function createQueuedBackupJob(
  binding: BackupBinding,
  checkpointIds: readonly string[]
): JobRecord {
  const destinationRef: JobRef = {
    kind: "external_uri",
    path: binding.destinationPath,
    role: "backup_destination"
  };
  const backupIdentityRef: JobRef = {
    kind: "backup",
    id: binding.backupId,
    role: "backup_identity"
  };
  const checkpoints: JobCheckpoint[] = checkpointIds.map((id) => ({
    id,
    step: id,
    state: "not_started",
    inputRefs: id === "preflight" ? [destinationRef, backupIdentityRef] : [],
    outputRefs: []
  }));
  return JobRecordSchema.parse({
    schemaVersion: 1,
    id: binding.jobId,
    class: "backup",
    state: "queued",
    stage: "backing_up",
    priority: "interactive",
    scope: "vault",
    createdAt: binding.createdAt,
    updatedAt: binding.createdAt,
    activeVaultId: binding.vaultId,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    inputRefs: [destinationRef, backupIdentityRef],
    outputRefs: [],
    operationIds: [],
    checkpoints,
    progress: { completedUnits: 0, totalUnits: checkpointIds.length, unit: "checkpoint" },
    retry: { retryCount: 0, maxAutomaticRetries: 0, requiresUserAction: false },
    cancellation: { durableWritesApplied: false },
    privacy: { usedCloudModel: false, usedNetwork: false, usedShell: false, accessedExternalFiles: true },
    message: "Backup is queued."
  });
}

export function readBackupBinding(job: JobRecord, vaultPath: string): BackupBinding {
  const destination = job.inputRefs?.find((ref) => ref.role === "backup_destination")?.path;
  const backupId = job.inputRefs?.find((ref) => ref.role === "backup_identity")?.id;
  if (
    job.class !== "backup" || job.scope !== "vault" || !job.activeVaultId ||
    !destination || !backupId || !isCanonicalBackupDestination(destination)
  ) throw new PigeDomainError("backup.job_conflict", "The Backup Job binding is invalid.");
  return {
    jobId: JobIdSchema.parse(job.id),
    backupId: BackupIdSchema.parse(backupId),
    createdAt: job.createdAt,
    vaultId: job.activeVaultId,
    vaultPath: path.resolve(vaultPath),
    destinationPath: path.resolve(destination),
    destinationFence: captureBackupDestinationFence(destination)
  };
}

export function prepareBackupForDurableCompletion(
  store: JobRecordStore,
  snapshot: JobRecordSnapshot,
  now: Date
): JobRecordSnapshot {
  if (snapshot.job.state === "running" || snapshot.job.state === "cancel_requested") return snapshot;
  return startBackupJob(store, snapshot, now);
}

function sameCandidate(left: BackupReconnectCandidate, right: BackupReconnectCandidate): boolean {
  return left.jobId === right.jobId && left.vaultId === right.vaultId &&
    left.jobUpdatedAt === right.jobUpdatedAt && left.dependencyKind === right.dependencyKind &&
    left.dependencyId === right.dependencyId;
}

function sameIncompleteCandidate(job: JobRecord, candidate: BackupIncompleteCandidate): boolean {
  const waiting = job.waitingDependency;
  return job.id === candidate.jobId && job.activeVaultId === candidate.vaultId &&
    job.updatedAt === candidate.jobUpdatedAt && job.class === "backup" &&
    job.state === "waiting_dependency" && waiting?.dependencyKind === "vault_binding" &&
    waiting.requiredAction === "reconnect_path" && waiting.dependencyId === candidate.rootId;
}

function omissionReceipt(job: JobRecord, rootId: string) {
  return {
    kind: "root_binding" as const,
    id: rootId,
    locator: "vault_binding",
    checksum: omissionReceiptChecksum(job, rootId),
    role: "backup_incomplete_omission"
  };
}

function hasOmissionReceipt(job: JobRecord, rootId: string): boolean {
  return omittedExternalManagedCopyRootIds(job).includes(rootId);
}

function omissionReceiptChecksum(job: JobRecord, rootId: string): `sha256:${string}` {
  const backupId = job.inputRefs?.find((ref) => ref.role === "backup_identity")?.id;
  return `sha256:${createHash("sha256").update(JSON.stringify({
    version: 1,
    jobId: job.id,
    vaultId: job.activeVaultId,
    backupId,
    rootId
  }), "utf8").digest("hex")}`;
}

function mergeOmissionWarning(job: JobRecord) {
  const warning = {
    code: "backup.external_managed_copy_omitted",
    domain: "backup" as const,
    messageKey: "errors.backup.external_managed_copy_omitted"
  };
  return [...(job.warnings ?? []).filter((candidate) => candidate.code !== warning.code), warning];
}

function isCanonicalBackupDestination(destinationPath: string): boolean {
  const resolved = path.resolve(destinationPath);
  if (resolved !== destinationPath || !resolved.endsWith(".pige-backup.zip")) return false;
  try {
    return canonicalizeBackupDestinationPath(resolved) === resolved;
  } catch {
    return false;
  }
}

function managedCopyDependency(
  waiting: JobRecord["waitingDependency"]
): BackupManagedCopyDependencyIdentity | undefined {
  if (
    !waiting?.dependencyId ||
    (waiting.dependencyKind !== "vault_binding" && waiting.dependencyKind !== "external_source")
  ) return undefined;
  return { dependencyKind: waiting.dependencyKind, dependencyId: waiting.dependencyId };
}
