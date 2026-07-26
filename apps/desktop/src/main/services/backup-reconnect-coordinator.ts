import type { BackupCreateResult } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import type { JobRecord } from "@pige/schemas";
import type {
  BackupManagedCopyDependencyIdentity,
  BackupManagedCopyRepairProof
} from "./backup-managed-copy-binding";
import type {
  BackupCreateOptions,
  RestoreCorePreviewResult
} from "./backup-service";
import { JobExecutionCoordinator } from "./job-execution-coordinator";
import { JobRecordStore, type JobRecordSnapshot } from "./job-record-store";

export interface BackupReconnectCandidate extends BackupManagedCopyDependencyIdentity {
  readonly jobId: string;
  readonly vaultId: string;
  readonly jobUpdatedAt: string;
}

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

function managedCopyDependency(
  waiting: JobRecord["waitingDependency"]
): BackupManagedCopyDependencyIdentity | undefined {
  if (
    !waiting?.dependencyId ||
    (waiting.dependencyKind !== "vault_binding" && waiting.dependencyKind !== "external_source")
  ) return undefined;
  return { dependencyKind: waiting.dependencyKind, dependencyId: waiting.dependencyId };
}
