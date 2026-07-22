import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  LocalDatabaseRebuildResult,
  RestoreApplyResult,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  BackupIdSchema,
  JobIdSchema,
  JobRecordSchema,
  type JobCheckpoint,
  type JobRecord,
  type JobRef
} from "@pige/schemas";
import {
  BackupRestoreService,
  captureBackupDestinationFence,
  createRestoreDestinationIdentity,
  type BackupCreateCheckpointEvent,
  type BackupCreateOptions,
  type RestoreCoreCheckpointEvent,
  type RestoreCoreApplyResult,
  type RestoreCorePreviewResult,
  type RestoreDestinationIdentity
} from "./backup-service";
import { JobRecordStore, type JobRecordSnapshot } from "./job-record-store";
import type { ApplyingRestorePreview } from "./restore-preview-registry";
import {
  RestoreJobStore,
  createPreviousVaultBindingHash,
  type RestoreJobBinding
} from "./restore-job-store";
import { loadVaultSummary, type VaultPathSafetyOptions } from "./vault-layout";
import { VaultService, type VaultRestoreTransition } from "./vault-service";

export interface RestoreCoordinatorOptions {
  readonly userDataPath: string;
  readonly appVersion: string;
  readonly pathSafety: VaultPathSafetyOptions;
  readonly backupService: BackupRestoreService;
  readonly vaultService: VaultService;
  readonly pauseMutableWork: () => Promise<() => void>;
  readonly rebuildIndexes: (vaultPath: string) => Promise<LocalDatabaseRebuildResult>;
  readonly jobStore?: RestoreJobStore;
}

export interface RestoreApplyCommand {
  readonly preview: ApplyingRestorePreview;
  readonly destinationPath: string;
  readonly replaceConfirmed: boolean;
}

interface BackupServiceWithInternalOptions {
  inspectRestoreArchive: BackupRestoreService["inspectRestoreArchive"];
  applyRestore: BackupRestoreService["applyRestore"];
  adoptCommittedRestore: BackupRestoreService["adoptCommittedRestore"];
  createBackup(
    vaultPathInput: string,
    backupFilePathInput: string,
    appVersion?: string,
    options?: BackupCreateOptions
  ): ReturnType<BackupRestoreService["createBackup"]>;
}

const BACKUP_CHECKPOINT_IDS = [
  "preflight",
  "manifest_emitted",
  "hashes_computed",
  "archive_staged",
  "archive_validated",
  "archive_finalized"
] as const;

export class RestoreCoordinatorService {
  readonly #userDataPath: string;
  readonly #appVersion: string;
  readonly #pathSafety: VaultPathSafetyOptions;
  readonly #backup: BackupServiceWithInternalOptions;
  readonly #vaults: VaultService;
  readonly #pauseMutableWork: () => Promise<() => void>;
  readonly #rebuildIndexes: (vaultPath: string) => Promise<LocalDatabaseRebuildResult>;
  readonly #jobs: RestoreJobStore;
  readonly #ownsJobStore: boolean;
  #running = false;

  constructor(options: RestoreCoordinatorOptions) {
    this.#userDataPath = fs.realpathSync.native(path.resolve(options.userDataPath));
    this.#appVersion = options.appVersion;
    this.#pathSafety = options.pathSafety;
    this.#backup = options.backupService;
    this.#vaults = options.vaultService;
    this.#pauseMutableWork = options.pauseMutableWork;
    this.#rebuildIndexes = options.rebuildIndexes;
    this.#jobs = options.jobStore ?? new RestoreJobStore(this.#userDataPath);
    this.#ownsJobStore = options.jobStore === undefined;
  }

  close(): void {
    if (this.#ownsJobStore) this.#jobs.close();
  }

  async apply(command: RestoreApplyCommand): Promise<RestoreApplyResult> {
    if (this.#running) {
      throw new PigeDomainError("restore.in_progress", "Another restore is already running in this process.");
    }
    this.#running = true;
    try {
      const inspected = await this.#backup.inspectRestoreArchive(command.preview.backupPath);
      assertPreviewStillCurrent(command.preview, inspected);
      const destinationIdentity = createRestoreDestinationIdentity(
        command.destinationPath,
        this.#pathSafety
      );
      const currentVault = this.#vaults.current();
      const currentVaultPath = this.#vaults.activeVaultPath();
      const action = {
        backupPath: inspected.backupPath,
        archiveDigest: inspected.archiveDigest as `sha256:${string}`,
        backupId: inspected.backupId,
        backupIdentitySource: inspected.backupIdSource,
        mode: command.preview.mode,
        sourceVaultId: inspected.sourceVaultId,
        destinationPath: destinationIdentity.destinationPath,
        destinationIdentity: destinationIdentity.identityDigest as `sha256:${string}`
      } as const;
      let snapshot = this.#jobs.findByRestoreAction(action);
      if (!snapshot) {
        assertRequestedModeAllowed(
          command.preview.mode,
          command.replaceConfirmed,
          inspected.sourceVaultId,
          currentVault,
          currentVaultPath
        );
        const identityInput = {
          createdAt: inspected.manifest.createdAt,
          archiveDigest: action.archiveDigest,
          backupId: inspected.backupId,
          mode: command.preview.mode,
          sourceVaultId: inspected.sourceVaultId,
          destinationIdentity: action.destinationIdentity,
          previousBindingHash: createPreviousVaultBindingHash(currentVaultPath, currentVault?.vaultId)
        } as const;
        snapshot = this.#jobs.create({
          ...identityInput,
          backupPath: inspected.backupPath,
          destinationPath: destinationIdentity.destinationPath,
          archivePreviewToken: inspected.archivePreviewToken as `sha256:${string}`,
          previewId: command.preview.previewId as `sha256:${string}`,
          backupIdentitySource: inspected.backupIdSource,
          ...(currentVaultPath ? { expectedActiveVaultPath: currentVaultPath } : {}),
          ...(currentVault ? { expectedActiveVaultId: currentVault.vaultId } : {}),
          replaceConfirmed: command.replaceConfirmed
        });
      } else if (command.preview.mode === "replace_existing" && !command.replaceConfirmed) {
        throw new PigeDomainError("restore.replace_unavailable", "Replace retry requires explicit confirmation.");
      }
      snapshot = this.#jobs.prepareExplicitRetry(snapshot);
      const binding = this.#jobs.binding(snapshot);
      return await this.#run(snapshot, binding, destinationIdentity);
    } finally {
      this.#running = false;
    }
  }

  async recoverInterrupted(): Promise<{ readonly recovered: number; readonly failed: number }> {
    if (this.#running) return { recovered: 0, failed: 0 };
    this.#running = true;
    let recovered = 0;
    let failed = 0;
    try {
      for (const snapshot of this.#jobs.listRecoverable()) {
        try {
          const binding = this.#jobs.binding(snapshot);
          const destinationIdentity = createRestoreDestinationIdentity(
            binding.destinationPath,
            this.#pathSafety
          );
          if (destinationIdentity.identityDigest !== binding.destinationIdentity) {
            throw new PigeDomainError("restore.destination_changed", "Restore destination identity changed.");
          }
          await this.#run(snapshot, binding, destinationIdentity);
          recovered += 1;
        } catch (caught) {
          try {
            const current = this.#jobs.read(snapshot.job.id);
            if (current.job.state === "queued" || current.job.state === "running") {
              this.#jobs.markFailed(current, {
                retryable: isRetryableRestoreFailure(caught),
                message: safeRestoreFailureMessage(caught)
              });
            }
          } catch {
            // The original recovery failure remains authoritative.
          }
          failed += 1;
        }
      }
      return { recovered, failed };
    } finally {
      this.#running = false;
    }
  }

  async #run(
    initialSnapshot: JobRecordSnapshot,
    binding: RestoreJobBinding,
    destinationIdentity: RestoreDestinationIdentity
  ): Promise<RestoreApplyResult> {
    let snapshot = initialSnapshot;
    let transition: VaultRestoreTransition | undefined;
    let transitionCommitted = false;
    let rebuildResult: LocalDatabaseRebuildResult | undefined;
    const resumeMutableWork = await this.#pauseMutableWork();
    try {
      const activeVault = this.#vaults.current();
      const activeVaultPath = this.#vaults.activeVaultPath();
      const alreadyActivated = activeVault?.vaultId === binding.resultVaultId &&
        activeVaultPath === binding.destinationPath;
      if (checkpointDone(snapshot.job, "destination_committed")) {
        assertStoredDestinationCommit(snapshot.job, binding);
      }
      if (!alreadyActivated) {
        assertPreviousBindingCurrent(binding, activeVault, activeVaultPath);
        transition = this.#vaults.beginRestoreTransition({
          ...(binding.expectedActiveVaultPath
            ? { expectedActiveVaultPath: binding.expectedActiveVaultPath }
            : {}),
          ...(binding.expectedActiveVaultId
            ? { expectedActiveVaultId: binding.expectedActiveVaultId }
            : {})
        });
      } else if (!checkpointDone(snapshot.job, "destination_committed")) {
        throw new PigeDomainError(
          "restore.job_conflict",
          "The restored vault is active before its destination checkpoint is durable."
        );
      }

      if (binding.mode === "replace_existing" && !alreadyActivated) {
        if (!transition?.previousVaultPath || !transition.previousVault) {
          throw new PigeDomainError("restore.replace_unavailable", "The source vault is unavailable for replacement.");
        }
        snapshot = await this.#ensureRollbackBackup(snapshot, binding, transition);
      }

      if (!alreadyActivated) {
        const coreInput = {
          backupPath: binding.backupPath,
          archivePreviewToken: binding.archivePreviewToken,
          previewId: binding.previewId,
          archiveDigest: binding.archiveDigest,
          jobId: binding.jobId,
          mode: binding.mode,
          sourceVaultId: binding.sourceVaultId,
          resultVaultId: binding.resultVaultId,
          destinationIdentity,
          pathSafety: this.#pathSafety,
          onPhase: async (event: RestoreCoreCheckpointEvent) => {
            snapshot = this.#recordCoreCheckpoint(snapshot, binding, event);
          }
        } as const;
        let result: RestoreCoreApplyResult;
        if (checkpointDone(snapshot.job, "destination_committed")) {
          if (!fs.existsSync(binding.destinationPath)) {
            throw new PigeDomainError(
              "restore.result_conflict",
              "The committed restore destination is no longer available."
            );
          }
          result = await this.#backup.adoptCommittedRestore(coreInput);
        } else {
          result = await this.#backup.applyRestore(coreInput);
        }
        assertRestoreResult(binding, result);
      }

      const restoredVault = loadVaultSummary(binding.destinationPath);
      if (restoredVault.vaultId !== binding.resultVaultId) {
        throw new PigeDomainError("restore.identity_conflict", "Restored vault identity failed readback.");
      }
      if (transition) {
        transition.commit(binding.destinationPath, restoredVault);
        transitionCommitted = true;
      }

      if (!checkpointDone(snapshot.job, "indexes_rebuilt")) {
        snapshot = this.#jobs.beginCheckpoint(snapshot, "indexes_rebuilt");
        rebuildResult = await this.#rebuildIndexes(binding.destinationPath);
        snapshot = this.#jobs.completeCheckpoint(snapshot, "indexes_rebuilt", {
          outputRefs: [{
            kind: "external_uri",
            id: binding.resultVaultId,
            checksum: createIndexRebuildSummaryHash(rebuildResult),
            role: "rebuilt_indexes"
          }]
        });
      }

      const operation = this.#jobs.writeRestoreAppliedOperation({
        snapshot,
        vaultPath: binding.destinationPath,
        backupId: binding.backupId,
        archiveDigest: binding.archiveDigest,
        sourceVaultId: binding.sourceVaultId,
        resultVaultId: binding.resultVaultId,
        mode: binding.mode,
        destinationIdentity: binding.destinationIdentity,
        warningCodes: restoreWarningCodes(snapshot.job),
        assertVaultWriterLease: () => this.#vaults.assertWriterLease(binding.destinationPath)
      });
      if (!isCompletedJob(snapshot.job)) {
        snapshot = this.#jobs.markCompleted(
          snapshot,
          operation,
          binding.resultVaultId,
          binding.destinationPath
        );
      } else {
        assertCompletedRestoreJob(snapshot.job, operation.id, binding);
      }

      return {
        status: "restored",
        jobId: snapshot.job.id
      };
    } catch (caught) {
      if (transition && !transitionCommitted) {
        try {
          transition.rollback();
        } catch {
          // A changed machine binding is not safe to overwrite during failure cleanup.
        }
      }
      try {
        this.#jobs.markFailed(snapshot, {
          retryable: isRetryableRestoreFailure(caught),
          message: safeRestoreFailureMessage(caught)
        });
      } catch {
        // Preserve the primary failure if durable failure recording itself cannot win CAS.
      }
      throw caught;
    } finally {
      resumeMutableWork();
    }
  }

  #recordCoreCheckpoint(
    snapshot: JobRecordSnapshot,
    binding: RestoreJobBinding,
    event: RestoreCoreCheckpointEvent
  ): JobRecordSnapshot {
    if (
      event.jobId !== binding.jobId ||
      event.previewId !== binding.previewId ||
      event.archiveDigest !== binding.archiveDigest ||
      event.backupId !== binding.backupId ||
      event.backupIdSource !== binding.backupIdentitySource ||
      event.mode !== binding.mode ||
      event.sourceVaultId !== binding.sourceVaultId ||
      event.resultVaultId !== binding.resultVaultId ||
      event.destinationIdentity !== binding.destinationIdentity
    ) {
      throw new PigeDomainError("restore.checkpoint_conflict", "Restore checkpoint binding changed.");
    }
    const stored = snapshot.job.checkpoints?.find((checkpoint) => checkpoint.id === event.phase);
    if (stored?.state === "done") {
      assertStoredCoreCheckpoint(stored, binding, event);
      return snapshot;
    }
    let next = this.#jobs.beginCheckpoint(snapshot, event.phase);
    next = this.#jobs.completeCheckpoint(next, event.phase, {
      ...(event.phase === "manifest_validated" ? { checksumAfter: binding.archiveDigest } : {}),
      ...(event.phase === "destination_reserved" || event.phase === "destination_committed"
        ? { checksumAfter: binding.destinationIdentity }
        : {}),
      ...(event.phase === "destination_committed" ? {
        outputRefs: [{
          kind: "external_uri",
          id: binding.resultVaultId,
          path: binding.destinationPath,
          role: "restored_vault"
        }]
      } : {}),
      ...(event.phase === "external_dependencies_reconciled" ? {
        resumeHint: event.externalDependencyCount > 0
          ? "external_dependencies_require_reconnection"
          : "external_dependencies_complete"
      } : {})
    });
    return next;
  }

  async #ensureRollbackBackup(
    restoreSnapshot: JobRecordSnapshot,
    binding: RestoreJobBinding,
    transition: VaultRestoreTransition
  ): Promise<JobRecordSnapshot> {
    transition.assertHeld();
    const vaultPath = transition.previousVaultPath!;
    const vault = transition.previousVault!;
    if (vault.vaultId !== binding.sourceVaultId) {
      throw new PigeDomainError("restore.replace_unavailable", "Replacement source vault identity changed.");
    }
    const backupJobId = createRollbackBackupJobId(restoreSnapshot.job.id);
    const backupJobPath = jobPath(vaultPath, backupJobId);
    const backupStore = new JobRecordStore({
      rootPath: path.join(vaultPath, ".pige", "jobs"),
      assertWriterLease: () => transition.assertHeld()
    });
    let backupSnapshot = createOrReadRollbackBackupJob(
      backupStore,
      backupJobPath,
      backupJobId,
      restoreSnapshot.job,
      vault,
      rollbackBackupPath(this.#userDataPath, restoreSnapshot.job.id)
    );
    const backupPath = backupSnapshot.job.inputRefs?.find((ref) => ref.role === "rollback_backup_destination")?.path;
    if (!backupPath) {
      throw new PigeDomainError("backup.job_conflict", "Rollback backup destination is missing.");
    }

    if (isCompletedJob(backupSnapshot.job) && !fs.existsSync(backupPath)) {
      throw new PigeDomainError(
        "backup.rollback_missing",
        "The completed rollback backup archive is no longer available."
      );
    }

    let inspected: RestoreCorePreviewResult;
    try {
      const rollbackIdentity = rollbackBackupIdentity(backupSnapshot.job);
      if (!isCompletedJob(backupSnapshot.job)) {
        backupSnapshot = startRollbackBackupJob(backupStore, backupSnapshot);
        await this.#backup.createBackup(vaultPath, backupPath, this.#appVersion, {
          excludeJobId: backupJobId,
          backupId: rollbackIdentity.backupId,
          createdAt: rollbackIdentity.createdAt,
          stagingOwnerKey: backupJobId,
          expectedDestinationFence: captureBackupDestinationFence(backupPath),
          ...rollbackBackupCheckpointDigests(backupSnapshot.job),
          onPhase: async (event) => {
            backupSnapshot = recordRollbackBackupCheckpoint(backupStore, backupSnapshot, event);
          }
        });
      }
      inspected = await this.#backup.inspectRestoreArchive(backupPath);
      if (
        inspected.sourceVaultId !== vault.vaultId ||
        inspected.backupId !== rollbackIdentity.backupId ||
        inspected.manifest.createdAt !== rollbackIdentity.createdAt ||
        inspected.manifest.appVersion !== this.#appVersion
      ) {
        throw new PigeDomainError("backup.validation_failed", "Rollback backup durable identity changed.");
      }
      assertRollbackBackupCheckpoints(backupSnapshot.job, inspected);
      const operation = this.#jobs.writeBackupCreatedOperation({
        job: backupSnapshot.job,
        vaultPath,
        vaultId: vault.vaultId,
        backupId: inspected.backupId,
        archiveDigest: inspected.archiveDigest as `sha256:${string}`,
        assertVaultWriterLease: () => transition.assertHeld()
      });
      if (!isCompletedJob(backupSnapshot.job)) {
        backupSnapshot = completeRollbackBackupJob(
          backupStore,
          backupSnapshot,
          inspected,
          operation.id
        );
      } else {
        assertCompletedRollbackBackupJob(backupSnapshot.job, inspected, operation.id);
      }
    } catch (caught) {
      try {
        backupSnapshot = markRollbackBackupFailed(backupStore, backupSnapshot, caught);
      } catch {
        // The original rollback failure remains authoritative if its child-state CAS loses.
      }
      throw caught;
    }
    const linked = this.#jobs.linkChildJob(restoreSnapshot, backupSnapshot.job.id);
    return linked;
  }
}

function assertPreviewStillCurrent(
  preview: ApplyingRestorePreview,
  inspected: RestoreCorePreviewResult
): void {
  if (
    path.resolve(preview.backupPath) !== inspected.backupPath ||
    preview.archivePreviewToken !== inspected.archivePreviewToken ||
    preview.archiveDigest !== inspected.archiveDigest ||
    preview.backupId !== inspected.backupId ||
    preview.backupIdSource !== inspected.backupIdSource ||
    preview.sourceVaultId !== inspected.sourceVaultId
  ) {
    throw new PigeDomainError("restore.backup_changed", "The backup changed after preview.");
  }
}

function assertRequestedModeAllowed(
  mode: ApplyingRestorePreview["mode"],
  replaceConfirmed: boolean,
  sourceVaultId: string,
  activeVault: VaultSummary | undefined,
  activeVaultPath: string | undefined
): void {
  if (mode === "replace_existing") {
    if (!replaceConfirmed || !activeVault || !activeVaultPath || activeVault.vaultId !== sourceVaultId) {
      throw new PigeDomainError(
        "restore.replace_unavailable",
        "Replace existing requires explicit confirmation and the exact active source vault."
      );
    }
  } else if (replaceConfirmed) {
    throw new PigeDomainError("restore.mode_invalid", "Clone restore cannot carry replacement confirmation.");
  }
}

function assertPreviousBindingCurrent(
  binding: RestoreJobBinding,
  activeVault: VaultSummary | undefined,
  activeVaultPath: string | undefined
): void {
  if (
    activeVaultPath !== binding.expectedActiveVaultPath ||
    activeVault?.vaultId !== binding.expectedActiveVaultId ||
    createPreviousVaultBindingHash(activeVaultPath, activeVault?.vaultId) !== binding.previousBindingHash
  ) {
    throw new PigeDomainError("vault.binding_changed", "The active vault changed before restore adoption.");
  }
}

function assertRestoreResult(binding: RestoreJobBinding, result: RestoreCoreApplyResult): void {
  if (
    result.archiveDigest !== binding.archiveDigest ||
    result.backupId !== binding.backupId ||
    result.backupIdSource !== binding.backupIdentitySource ||
    result.mode !== binding.mode ||
    result.sourceVaultId !== binding.sourceVaultId ||
    result.resultVaultId !== binding.resultVaultId ||
    result.destinationIdentity.identityDigest !== binding.destinationIdentity ||
    path.resolve(result.restoredVaultPath) !== binding.destinationPath
  ) {
    throw new PigeDomainError("restore.result_conflict", "Restore result failed exact durable binding verification.");
  }
}

function createRollbackBackupJobId(restoreJobId: string): string {
  const dateKey = /^job_(\d{8})_/u.exec(restoreJobId)?.[1];
  if (!dateKey) throw new PigeDomainError("backup.job_conflict", "Rollback backup parent identity is invalid.");
  return JobIdSchema.parse(`job_${dateKey}_${createHash("sha256")
    .update("pige:restore-rollback-backup-job:v1\0", "utf8")
    .update(restoreJobId, "utf8")
    .digest("hex")}`);
}

function rollbackBackupIdentity(job: JobRecord): { readonly backupId: string; readonly createdAt: string } {
  const dateKey = job.createdAt.slice(0, 10).replaceAll("-", "");
  const digest = createHash("sha256")
    .update("pige:restore-rollback-backup:v1\0", "utf8")
    .update(job.id, "utf8")
    .digest("hex");
  return {
    backupId: BackupIdSchema.parse(`backup_${dateKey}_${digest}`),
    createdAt: job.createdAt
  };
}

function jobPath(vaultPath: string, jobId: string): string {
  const date = /^job_(\d{4})(\d{2})\d{2}_/u.exec(jobId);
  if (!date) throw new PigeDomainError("backup.job_conflict", "Rollback backup Job identity is invalid.");
  return path.join(vaultPath, ".pige", "jobs", date[1]!, date[2]!, `${jobId}.json`);
}

function rollbackBackupPath(userDataPath: string, restoreJobId: string): string {
  const root = ensurePrivateDirectory(path.join(userDataPath, "restore-coordinator", "rollback"));
  return path.join(root, `${restoreJobId}.pige-backup.zip`);
}

function createOrReadRollbackBackupJob(
  store: JobRecordStore,
  filePath: string,
  jobId: string,
  restoreJob: JobRecord,
  vault: VaultSummary,
  backupPath: string
): JobRecordSnapshot {
  const createdAt = restoreJob.createdAt;
  const checkpoints: JobCheckpoint[] = BACKUP_CHECKPOINT_IDS.map((id) => ({
    id,
    step: id,
    state: "not_started",
    inputRefs: [],
    outputRefs: []
  }));
  const job = JobRecordSchema.parse({
    schemaVersion: 1,
    id: jobId,
    class: "backup",
    state: "queued",
    stage: "backing_up",
    priority: "interactive",
    scope: "vault",
    parentJobId: restoreJob.id,
    createdAt,
    updatedAt: createdAt,
    activeVaultId: vault.vaultId,
    actor: {
      kind: "system",
      runtimeKind: "desktop_local",
      clientCapabilityTier: "desktop_full"
    },
    inputRefs: [{
      kind: "external_uri",
      path: backupPath,
      role: "rollback_backup_destination"
    }],
    outputRefs: [],
    operationIds: [],
    checkpoints,
    progress: { completedUnits: 0, totalUnits: BACKUP_CHECKPOINT_IDS.length, unit: "checkpoint" },
    privacy: {
      usedCloudModel: false,
      usedNetwork: false,
      usedShell: false,
      accessedExternalFiles: true,
    },
    message: "Rollback backup is queued before replacing the active vault binding."
  });
  try {
    return store.createIfAbsent(filePath, job);
  } catch (caught) {
    if (!(caught instanceof PigeDomainError) || caught.code !== "job.revision_conflict") throw caught;
    const existing = store.read(filePath);
    if (
      existing.job.id !== jobId ||
      existing.job.class !== "backup" ||
      existing.job.parentJobId !== restoreJob.id ||
      existing.job.activeVaultId !== vault.vaultId ||
      existing.job.inputRefs?.find((ref) => ref.role === "rollback_backup_destination")?.path !== backupPath
    ) {
      throw new PigeDomainError("backup.job_conflict", "Rollback backup Job binding changed.");
    }
    return existing;
  }
}

function startRollbackBackupJob(store: JobRecordStore, snapshot: JobRecordSnapshot): JobRecordSnapshot {
  if (isCompletedJob(snapshot.job)) return snapshot;
  if (snapshot.job.state === "failed_final" || snapshot.job.state === "cancelled") {
    throw new PigeDomainError("backup.job_conflict", "Rollback backup cannot restart from a terminal state.");
  }
  const { error: _error, finishedAt: _finishedAt, ...rest } = snapshot.job;
  return store.compareAndSwap(snapshot, JobRecordSchema.parse({
    ...rest,
    state: "running",
    stage: "backing_up",
    startedAt: snapshot.job.startedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    checkpoints: (snapshot.job.checkpoints ?? []).map((checkpoint, index) => index === 0 ? {
      ...checkpoint,
      state: "running",
      startedAt: checkpoint.startedAt ?? new Date().toISOString()
    } : checkpoint),
    message: "Rollback backup preflight is running."
  }));
}

function assertRollbackBackupCheckpoints(job: JobRecord, inspected: RestoreCorePreviewResult): void {
  const checkpoints = job.checkpoints ?? [];
  const byId = new Map(checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
  const manifestChecksum = byId.get("manifest_emitted")?.checksumAfter;
  const hashesChecksum = byId.get("hashes_computed")?.checksumAfter;
  const stagedDigest = byId.get("archive_staged")?.checksumAfter;
  const validatedDigest = byId.get("archive_validated")?.checksumAfter;
  const finalizedDigest = byId.get("archive_finalized")?.checksumAfter;
  if (
    checkpoints.length !== BACKUP_CHECKPOINT_IDS.length ||
    checkpoints.some((checkpoint) => checkpoint.state !== "done") ||
    !manifestChecksum ||
    manifestChecksum !== hashesChecksum ||
    stagedDigest !== inspected.archiveDigest ||
    validatedDigest !== inspected.archiveDigest ||
    finalizedDigest !== inspected.archiveDigest
  ) {
    throw new PigeDomainError("backup.checkpoint_conflict", "Rollback backup checkpoints are incomplete or changed.");
  }
}

function markRollbackBackupFailed(
  store: JobRecordStore,
  initialSnapshot: JobRecordSnapshot,
  caught: unknown
): JobRecordSnapshot {
  const snapshot = store.read(initialSnapshot.path);
  if (isCompletedJob(snapshot.job) || snapshot.job.state === "failed_final" || snapshot.job.state === "cancelled") {
    return snapshot;
  }
  const retryable = isRetryableRestoreFailure(caught);
  const code = caught instanceof PigeDomainError && caught.code.startsWith("backup.")
    ? caught.code
    : "backup.execution_failed";
  const now = new Date().toISOString();
  return store.compareAndSwap(snapshot, JobRecordSchema.parse({
    ...snapshot.job,
    state: retryable ? "failed_retryable" : "failed_final",
    updatedAt: now,
    finishedAt: now,
    error: {
      code,
      domain: "backup",
      messageKey: `errors.${code}`,
      retryable,
      severity: "error",
      userAction: retryable ? "retry" : "none"
    },
    retry: {
      retryCount: snapshot.job.retry?.retryCount ?? 0,
      maxAutomaticRetries: 0,
      requiresUserAction: retryable,
      lastRetryReason: code
    },
    message: retryable
      ? "Rollback backup stopped safely and may be retried with the same identity."
      : "Rollback backup stopped because its durable identity or archive conflicted."
  }));
}

function rollbackBackupCheckpointDigests(job: JobRecord): Pick<
  BackupCreateOptions,
  "expectedManifestChecksum" | "expectedArchiveDigest"
> {
  const manifestChecksum = job.checkpoints?.find((checkpoint) =>
    checkpoint.id === "hashes_computed" || checkpoint.id === "manifest_emitted"
  )?.checksumAfter;
  const archiveDigest = job.checkpoints?.find((checkpoint) =>
    checkpoint.id === "archive_finalized" || checkpoint.id === "archive_staged"
  )?.checksumAfter;
  return {
    ...(manifestChecksum ? { expectedManifestChecksum: manifestChecksum as `sha256:${string}` } : {}),
    ...(archiveDigest ? { expectedArchiveDigest: archiveDigest as `sha256:${string}` } : {})
  };
}

function recordRollbackBackupCheckpoint(
  store: JobRecordStore,
  initialSnapshot: JobRecordSnapshot,
  event: BackupCreateCheckpointEvent
): JobRecordSnapshot {
  const phaseMap: Record<BackupCreateCheckpointEvent["phase"], readonly string[]> = {
    preflight: ["preflight"],
    manifest_written: ["manifest_emitted"],
    files_hashed: ["hashes_computed"],
    archive_staged: ["archive_staged", "archive_validated"],
    archive_finalized: ["archive_finalized"]
  };
  const snapshot = store.read(initialSnapshot.path);
  const identity = rollbackBackupIdentity(snapshot.job);
  if (
    event.backupId !== identity.backupId ||
    event.createdAt !== identity.createdAt ||
    event.stagingOwnerKey !== snapshot.job.id
  ) {
    throw new PigeDomainError("backup.checkpoint_conflict", "Rollback backup checkpoint identity changed.");
  }
  const targetIds = new Set(phaseMap[event.phase]);
  const checksum = event.archiveDigest ?? event.manifestChecksum;
  const now = new Date().toISOString();
  const checkpoints = (snapshot.job.checkpoints ?? []).map((checkpoint) => {
    if (!targetIds.has(checkpoint.id)) return checkpoint;
    if (
      checkpoint.state === "done" &&
      checksum !== undefined &&
      checkpoint.checksumAfter !== checksum
    ) {
      throw new PigeDomainError("backup.checkpoint_conflict", "Rollback backup checkpoint digest changed.");
    }
    return {
      ...checkpoint,
      state: "done" as const,
      startedAt: checkpoint.startedAt ?? now,
      finishedAt: checkpoint.finishedAt ?? now,
      ...(checksum ? { checksumAfter: checksum } : {})
    };
  });
  return store.compareAndSwap(snapshot, JobRecordSchema.parse({
    ...snapshot.job,
    state: "running",
    updatedAt: now,
    checkpoints,
    progress: {
      completedUnits: checkpoints.filter((checkpoint) => checkpoint.state === "done").length,
      totalUnits: BACKUP_CHECKPOINT_IDS.length,
      unit: "checkpoint"
    },
    message: `Rollback backup checkpoint ${event.phase} completed.`
  }));
}

function completeRollbackBackupJob(
  store: JobRecordStore,
  snapshot: JobRecordSnapshot,
  inspected: RestoreCorePreviewResult,
  operationId: string
): JobRecordSnapshot {
  assertRollbackBackupCheckpoints(snapshot.job, inspected);
  const now = new Date().toISOString();
  const backupRef: JobRef = {
    kind: "backup",
    id: inspected.backupId,
    path: inspected.backupPath,
    checksum: inspected.archiveDigest,
    role: "rollback_backup"
  };
  return store.compareAndSwap(snapshot, JobRecordSchema.parse({
    ...snapshot.job,
    state: "completed",
    stage: "backing_up",
    updatedAt: now,
    finishedAt: now,
    outputRefs: [backupRef, { kind: "operation", id: operationId, role: "backup_created" }],
    operationIds: [operationId],
    checkpoints: (snapshot.job.checkpoints ?? []).map((checkpoint) => ({
      ...checkpoint,
      outputRefs: checkpoint.id === "archive_finalized" ? [backupRef] : checkpoint.outputRefs
    })),
    progress: {
      completedUnits: BACKUP_CHECKPOINT_IDS.length,
      totalUnits: BACKUP_CHECKPOINT_IDS.length,
      unit: "checkpoint"
    },
    message: "Rollback backup completed and passed archive validation."
  }));
}

function isCompletedJob(job: JobRecord): boolean {
  return job.state === "completed" || job.state === "completed_with_warnings";
}

function assertCompletedRestoreJob(
  job: JobRecord,
  operationId: string,
  binding: RestoreJobBinding
): void {
  if (
    !job.operationIds?.includes(operationId) ||
    !job.outputRefs?.some((ref) => ref.role === "restore_applied" && ref.id === operationId) ||
    !job.outputRefs?.some((ref) =>
      ref.role === "restored_vault" &&
      ref.id === binding.resultVaultId &&
      path.resolve(ref.path ?? "") === binding.destinationPath
    )
  ) {
    throw new PigeDomainError("restore.job_conflict", "Completed Restore Job output binding changed.");
  }
}

function assertCompletedRollbackBackupJob(
  job: JobRecord,
  inspected: RestoreCorePreviewResult,
  operationId: string
): void {
  const archiveRef = job.outputRefs?.find((ref) => ref.role === "rollback_backup");
  if (
    archiveRef?.id !== inspected.backupId ||
    archiveRef.checksum !== inspected.archiveDigest ||
    path.resolve(archiveRef.path ?? "") !== inspected.backupPath ||
    !job.operationIds?.includes(operationId) ||
    !job.outputRefs?.some((ref) => ref.role === "backup_created" && ref.id === operationId)
  ) {
    throw new PigeDomainError("backup.job_conflict", "Completed rollback backup binding changed.");
  }
}

function restoreWarningCodes(job: JobRecord): readonly string[] {
  return job.checkpoints?.some((checkpoint) =>
    checkpoint.id === "external_dependencies_reconciled" &&
    checkpoint.resumeHint === "external_dependencies_require_reconnection"
  )
    ? ["restore.external_dependencies_require_reconnection"]
    : [];
}

function checkpointDone(job: JobRecord, checkpointId: string): boolean {
  return job.checkpoints?.find((checkpoint) => checkpoint.id === checkpointId)?.state === "done";
}

function assertStoredCoreCheckpoint(
  checkpoint: JobCheckpoint,
  binding: RestoreJobBinding,
  event: RestoreCoreCheckpointEvent
): void {
  if (
    (event.phase === "manifest_validated" && checkpoint.checksumAfter !== binding.archiveDigest) ||
    ((event.phase === "destination_reserved" || event.phase === "destination_committed") &&
      checkpoint.checksumAfter !== binding.destinationIdentity) ||
    (event.phase === "destination_committed" && !checkpoint.outputRefs.some((ref) =>
      ref.role === "restored_vault" &&
      ref.id === binding.resultVaultId &&
      path.resolve(ref.path ?? "") === binding.destinationPath
    )) ||
    (event.phase === "external_dependencies_reconciled" && checkpoint.resumeHint !== (
      event.externalDependencyCount > 0
        ? "external_dependencies_require_reconnection"
        : "external_dependencies_complete"
    ))
  ) {
    throw new PigeDomainError("restore.checkpoint_conflict", "Stored Restore checkpoint binding changed.");
  }
}

function assertStoredDestinationCommit(job: JobRecord, binding: RestoreJobBinding): void {
  const checkpoint = job.checkpoints?.find(({ id }) => id === "destination_committed");
  if (
    !checkpoint ||
    checkpoint.state !== "done" ||
    checkpoint.checksumAfter !== binding.destinationIdentity ||
    !checkpoint.outputRefs.some((ref) =>
      ref.role === "restored_vault" &&
      ref.id === binding.resultVaultId &&
      path.resolve(ref.path ?? "") === binding.destinationPath
    )
  ) {
    throw new PigeDomainError("restore.checkpoint_conflict", "Restore destination checkpoint changed.");
  }
}

function createIndexRebuildSummaryHash(result: LocalDatabaseRebuildResult): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update("pige:restore-index-rebuild:v1\0", "utf8")
    .update(JSON.stringify({
      pageCount: result.pageCount,
      invalidPageCount: result.invalidPageCount
    }), "utf8")
    .digest("hex")}`;
}

function ensurePrivateDirectory(directoryPath: string): string {
  const resolved = path.resolve(directoryPath);
  const parent = path.dirname(resolved);
  let canonicalParent: string;
  try {
    const parentStat = fs.lstatSync(parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error("unsafe");
    canonicalParent = fs.realpathSync.native(parent);
  } catch {
    throw new PigeDomainError("restore.path_unsafe", "Restore rollback parent is unsafe.");
  }
  try {
    fs.mkdirSync(resolved, { mode: 0o700 });
  } catch (caught) {
    if (!isErrno(caught, "EEXIST")) throw caught;
  }
  const stat = fs.lstatSync(resolved);
  const canonical = fs.realpathSync.native(resolved);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    path.dirname(canonical) !== canonicalParent ||
    path.basename(canonical) !== path.basename(resolved)
  ) {
    throw new PigeDomainError("restore.path_unsafe", "Restore rollback directory is unsafe.");
  }
  fs.chmodSync(resolved, 0o700);
  return resolved;
}

function isErrno(caught: unknown, code: string): boolean {
  return Boolean(caught && typeof caught === "object" && "code" in caught && caught.code === code);
}

function isRetryableRestoreFailure(caught: unknown): boolean {
  if (!(caught instanceof PigeDomainError)) return true;
  return !new Set([
    "backup.checkpoint_conflict",
    "backup.destination_changed",
    "backup.destination_exists",
    "backup.job_conflict",
    "backup.result_conflict",
    "backup.rollback_missing",
    "backup.staging_conflict",
    "backup.validation_failed",
    "restore.backup_changed",
    "restore.backup_invalid",
    "restore.checkpoint_conflict",
    "restore.checkpoint_invalid",
    "restore.destination_changed",
    "restore.destination_exists",
    "restore.identity_conflict",
    "restore.job_conflict",
    "restore.mode_invalid",
    "restore.operation_conflict",
    "restore.path_unsafe",
    "restore.replace_unavailable",
    "restore.result_invalid",
    "restore.result_conflict",
    "vault.binding_changed"
  ]).has(caught.code);
}

function safeRestoreFailureMessage(caught: unknown): string {
  return isRetryableRestoreFailure(caught)
    ? "Restore stopped at a durable checkpoint and may be retried after repairing local storage."
    : "Restore stopped because an identity, archive, destination, or active-vault binding changed."
}
