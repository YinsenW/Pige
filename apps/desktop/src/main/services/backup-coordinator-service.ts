import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BackupCreateResult } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  BackupIdSchema,
  JobIdSchema,
  JobRecordSchema,
  OperationRecordSchema,
  type JobCheckpoint,
  type JobRecord,
  type JobRef,
  type OperationRecord
} from "@pige/schemas";
import {
  captureBackupDestinationFence,
  canonicalizeBackupDestinationPath,
  BackupManagedCopyDependencyError,
  type BackupCreateCheckpointEvent,
  type BackupCreateOptions,
  type BackupDestinationFence,
  type RestoreCorePreviewResult
} from "./backup-service";
import { JobRecordStore, type JobRecordSnapshot } from "./job-record-store";

export const BACKUP_CHECKPOINT_IDS = [
  "preflight",
  "manifest_written",
  "files_hashed",
  "archive_staged",
  "archive_finalized"
] as const;

export type BackupCheckpointId = typeof BACKUP_CHECKPOINT_IDS[number];

export interface BackupServicePort {
  createBackup(
    vaultPath: string,
    destinationPath: string,
    appVersion: string,
    options: BackupCreateOptions
  ): Promise<BackupCreateResult>;
  inspectRestoreArchive(backupPath: string): Promise<RestoreCorePreviewResult>;
}

export interface BackupVaultPort {
  current(): { readonly vaultId: string } | undefined;
  activeVaultPath(): string | undefined;
  assertWriterLease(vaultPath: string): void;
}

export interface BackupCreatedOperationInput {
  readonly job: JobRecord;
  readonly vaultPath: string;
  readonly vaultId: string;
  readonly backupId: string;
  readonly archiveDigest: `sha256:${string}`;
  readonly assertVaultWriterLease: () => void;
}

export type BackupCreatedOperationWriter = (
  input: BackupCreatedOperationInput
) => OperationRecord | Promise<OperationRecord>;

export interface BackupCoordinatorOptions {
  readonly vault: BackupVaultPort;
  readonly backupService: BackupServicePort;
  readonly appVersion: string;
  readonly writeBackupCreatedOperation: BackupCreatedOperationWriter;
  readonly now?: () => Date;
  readonly randomId?: () => string;
}

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

interface BackupBinding {
  readonly jobId: string;
  readonly backupId: string;
  readonly createdAt: string;
  readonly vaultId: string;
  readonly vaultPath: string;
  readonly destinationPath: string;
  readonly destinationFence: BackupDestinationFence;
}

const MAX_RECOVERABLE_JOBS = 10_000;
const RECOVERABLE_STATES = new Set<JobRecord["state"]>([
  "queued",
  "running",
  "waiting_dependency",
  "cancel_requested",
  "failed_retryable"
]);
const TERMINAL_STATES = new Set<JobRecord["state"]>([
  "completed",
  "completed_with_warnings",
  "failed_final",
  "cancelled",
  "compacted"
]);

export class BackupCoordinatorService {
  readonly #vault: BackupVaultPort;
  readonly #backup: BackupServicePort;
  readonly #appVersion: string;
  readonly #writeOperation: BackupCreatedOperationWriter;
  readonly #now: () => Date;
  readonly #randomId: () => string;
  readonly #controllers = new Map<string, AbortController>();

  constructor(options: BackupCoordinatorOptions) {
    this.#vault = options.vault;
    this.#backup = options.backupService;
    this.#appVersion = options.appVersion;
    this.#writeOperation = options.writeBackupCreatedOperation;
    this.#now = options.now ?? (() => new Date());
    this.#randomId = options.randomId ?? (() => randomUUID().replaceAll("-", ""));
  }

  async create(destinationPathInput: string): Promise<JobRecord> {
    const active = this.#captureActiveVault();
    const createdAt = this.#now().toISOString();
    const dateKey = createdAt.slice(0, 10).replaceAll("-", "");
    const suffix = this.#randomId().toLocaleLowerCase("en-US").replace(/[^a-z0-9]/gu, "");
    const jobId = JobIdSchema.parse(`job_${dateKey}_${suffix}`);
    const backupId = BackupIdSchema.parse(`backup_${dateKey}_${suffix}`);
    const destinationFence = captureBackupDestinationFence(destinationPathInput);
    const destinationPath = destinationFence.destinationPath;
    const binding: BackupBinding = {
      jobId,
      backupId,
      createdAt,
      vaultId: active.vaultId,
      vaultPath: active.vaultPath,
      destinationPath,
      destinationFence
    };
    const store = this.#store(binding.vaultPath);
    const snapshot = store.createIfAbsent(
      jobFilePath(binding.vaultPath, binding.jobId),
      createQueuedBackupJob(binding)
    );
    return (await this.#run(store, snapshot, binding)).job;
  }

  async cancel(request: BackupJobRequest | string): Promise<JobRecord | undefined> {
    const jobId = parseRequestedJobId(request);
    const active = this.#captureActiveVault();
    const store = this.#store(active.vaultPath);
    const snapshot = readJobIfPresent(store, jobFilePath(active.vaultPath, jobId));
    if (!snapshot || snapshot.job.class !== "backup") return undefined;
    const binding = readBackupBinding(snapshot.job, active.vaultPath);
    assertActiveBinding(active, binding);
    if (TERMINAL_STATES.has(snapshot.job.state) || checkpointDone(snapshot.job, "archive_finalized")) {
      return snapshot.job;
    }
    const now = this.#now().toISOString();
    const next = store.compareAndSwap(snapshot, JobRecordSchema.parse({
      ...snapshot.job,
      state: "cancel_requested",
      updatedAt: now,
      cancellation: {
        ...(snapshot.job.cancellation ?? {}),
        requestedAt: snapshot.job.cancellation?.requestedAt ?? now,
        requestedBy: snapshot.job.cancellation?.requestedBy ?? "user",
        safeCheckpointId: lastDoneCheckpoint(snapshot.job),
        durableWritesApplied: false
      },
      message: "Backup cancellation was requested."
    }));
    const activeController = this.#controllers.get(jobId);
    activeController?.abort();
    if (activeController) return next.job;
    try {
      return (await this.#run(store, next, binding)).job;
    } catch (caught) {
      if (isContention(caught)) return next.job;
      throw caught;
    }
  }

  async retry(request: BackupJobRequest | string): Promise<BackupRetryResult | undefined> {
    const jobId = parseRequestedJobId(request);
    const active = this.#captureActiveVault();
    const store = this.#store(active.vaultPath);
    let snapshot = readJobIfPresent(store, jobFilePath(active.vaultPath, jobId));
    if (!snapshot || snapshot.job.class !== "backup") return undefined;
    const binding = readBackupBinding(snapshot.job, active.vaultPath);
    assertActiveBinding(active, binding);
    if (snapshot.job.state === "failed_retryable" || snapshot.job.state === "waiting_dependency") {
      const now = this.#now().toISOString();
      const {
        error: _error,
        finishedAt: _finishedAt,
        waitingDependency: _waitingDependency,
        ...rest
      } = snapshot.job;
      snapshot = store.compareAndSwap(snapshot, JobRecordSchema.parse({
        ...rest,
        state: "queued",
        updatedAt: now,
        retry: {
          retryCount: (snapshot.job.retry?.retryCount ?? 0) + 1,
          maxAutomaticRetries: 0,
          requiresUserAction: false,
          lastRetryReason: snapshot.job.error?.code ?? "backup.retry_requested"
        },
        message: "Backup retry is queued with its original identity."
      }));
    } else if (snapshot.job.state !== "queued") {
      return { status: "not_allowed", job: snapshot.job };
    }
    const result = (await this.#run(store, snapshot, binding)).job;
    return {
      status: result.state === "completed" || result.state === "completed_with_warnings"
        ? "requeued"
        : "not_allowed",
      job: result
    };
  }

  async recoverInterrupted(): Promise<BackupRecoveryResult> {
    const active = this.#captureActiveVault();
    const store = this.#store(active.vaultPath);
    let recovered = 0;
    let failed = 0;
    for (const snapshot of listRecoverableBackupJobs(store, active.vaultPath)) {
      try {
        const binding = readBackupBinding(snapshot.job, active.vaultPath);
        assertActiveBinding(active, binding);
        const result = await this.#run(store, snapshot, binding);
        if (RECOVERABLE_STATES.has(result.job.state)) {
          failed += 1;
        } else {
          recovered += 1;
        }
      } catch {
        failed += 1;
      }
    }
    return { recovered, failed };
  }

  async #run(
    store: JobRecordStore,
    initialSnapshot: JobRecordSnapshot,
    binding: BackupBinding
  ): Promise<JobRecordSnapshot> {
    const destinationClaim = store.acquireNamedClaim("backup_destination", binding.destinationPath);
    const controller = new AbortController();
    let snapshot = initialSnapshot;
    if (this.#controllers.has(binding.jobId)) {
      destinationClaim.release();
      throw new PigeDomainError("backup.in_progress", "The Backup Job is already active in this process.");
    }
    this.#controllers.set(binding.jobId, controller);
    try {
      this.#assertBinding(binding);
      snapshot = refreshSnapshot(store, snapshot);
      if (TERMINAL_STATES.has(snapshot.job.state)) return snapshot;
      if (snapshot.job.state === "cancel_requested") controller.abort();

      const adopted = await this.#inspectExactFinal(binding, snapshot.job, false);
      if (adopted) return await this.#completeFromInspection(store, snapshot, binding, adopted);

      if (controller.signal.aborted) {
        try {
          await this.#backup.createBackup(
            binding.vaultPath,
            binding.destinationPath,
            this.#appVersion,
            this.#createCoreOptions(binding, snapshot.job, controller.signal)
          );
        } catch (caught) {
          if (!isAbortError(caught) && !(
            caught instanceof PigeDomainError && caught.code === "backup.staging_conflict"
          )) throw caught;
        }
        return markCancelled(store, refreshSnapshot(store, snapshot), this.#now());
      }

      snapshot = startJob(store, snapshot, this.#now());
      await this.#backup.createBackup(
        binding.vaultPath,
        binding.destinationPath,
        this.#appVersion,
        this.#createCoreOptions(binding, snapshot.job, controller.signal, async (event) => {
          destinationClaim.assertHeld();
          this.#assertBinding(binding);
          snapshot = refreshSnapshot(store, snapshot);
          assertCoreEventBinding(event, binding);
          snapshot = recordCheckpoint(store, snapshot, binding, event, this.#now());
        })
      );
      const inspected = await this.#inspectExactFinal(binding, snapshot.job, true);
      return await this.#completeFromInspection(store, snapshot, binding, inspected!);
    } catch (caught) {
      if (isContention(caught)) throw caught;
      try {
        snapshot = refreshSnapshot(store, snapshot);
        if (TERMINAL_STATES.has(snapshot.job.state)) return snapshot;
        const inspected = await this.#inspectExactFinal(binding, snapshot.job, false);
        if (inspected) return await this.#completeFromInspection(store, snapshot, binding, inspected);
        if (snapshot.job.state === "cancel_requested" || isAbortError(caught)) {
          return markCancelled(store, snapshot, this.#now());
        }
        return markFailed(store, snapshot, caught, this.#now());
      } catch (reconcileError) {
        if (isContention(reconcileError)) throw reconcileError;
        if (reconcileError instanceof PigeDomainError && (
          reconcileError.code === "backup.result_conflict" ||
          reconcileError.code === "backup.operation_conflict" ||
          reconcileError.code === "backup.job_conflict"
        )) {
          return markFailed(store, snapshot, reconcileError, this.#now());
        }
        throw caught;
      }
    } finally {
      this.#controllers.delete(binding.jobId);
      destinationClaim.release();
    }
  }

  #createCoreOptions(
    binding: BackupBinding,
    job: JobRecord,
    signal: AbortSignal,
    onPhase?: (event: BackupCreateCheckpointEvent) => Promise<void>
  ): BackupCreateOptions {
    return {
      backupId: binding.backupId,
      createdAt: binding.createdAt,
      excludeJobId: binding.jobId,
      stagingOwnerKey: binding.jobId,
      expectedDestinationFence: binding.destinationFence,
      ...expectedCheckpointDigests(job),
      signal,
      ...(onPhase ? { onPhase } : {})
    };
  }

  async #completeFromInspection(
    store: JobRecordStore,
    initialSnapshot: JobRecordSnapshot,
    binding: BackupBinding,
    inspected: RestoreCorePreviewResult
  ): Promise<JobRecordSnapshot> {
    let snapshot = refreshSnapshot(store, initialSnapshot);
    if (isCompleted(snapshot.job)) {
      assertCompletedJob(snapshot.job, binding, inspected);
      return snapshot;
    }
    snapshot = completeMissingCheckpoints(store, snapshot, binding, inspected, this.#now());
    this.#assertBinding(binding);
    const operation = OperationRecordSchema.parse(await this.#writeOperation({
      job: snapshot.job,
      vaultPath: binding.vaultPath,
      vaultId: binding.vaultId,
      backupId: binding.backupId,
      archiveDigest: inspected.archiveDigest as `sha256:${string}`,
      assertVaultWriterLease: () => this.#vault.assertWriterLease(binding.vaultPath)
    }));
    assertOperationBinding(operation, binding, inspected);
    snapshot = refreshSnapshot(store, snapshot);
    if (isCompleted(snapshot.job)) {
      assertCompletedJob(snapshot.job, binding, inspected, operation.id);
      return snapshot;
    }
    const now = this.#now().toISOString();
    const backupRef = createBackupRef(binding, inspected);
    return store.compareAndSwap(snapshot, JobRecordSchema.parse({
      ...snapshot.job,
      state: "completed",
      stage: "backing_up",
      updatedAt: now,
      finishedAt: now,
      outputRefs: dedupeRefs([
        ...(snapshot.job.outputRefs ?? []),
        backupRef,
        { kind: "operation", id: operation.id, role: "backup_created" }
      ]),
      operationIds: Array.from(new Set([...(snapshot.job.operationIds ?? []), operation.id])),
      cancellation: snapshot.job.cancellation ? {
        ...snapshot.job.cancellation,
        safeCheckpointId: "archive_finalized",
        durableWritesApplied: true
      } : { safeCheckpointId: "archive_finalized", durableWritesApplied: true },
      progress: {
        completedUnits: BACKUP_CHECKPOINT_IDS.length,
        totalUnits: BACKUP_CHECKPOINT_IDS.length,
        unit: "checkpoint"
      },
      message: "Backup completed and passed exact archive inspection."
    }));
  }

  async #inspectExactFinal(
    binding: BackupBinding,
    job: JobRecord,
    required: boolean
  ): Promise<RestoreCorePreviewResult | undefined> {
    const { expectedManifestChecksum, expectedArchiveDigest } = expectedCheckpointDigests(job);
    if (fs.existsSync(binding.destinationPath) && (!expectedManifestChecksum || !expectedArchiveDigest)) {
      throw new PigeDomainError(
        "backup.result_conflict",
        "The Backup destination has no complete durable manifest and archive checkpoint binding."
      );
    }
    let inspected: RestoreCorePreviewResult;
    try {
      inspected = await this.#backup.inspectRestoreArchive(binding.destinationPath);
    } catch (caught) {
      const destinationExists = fs.existsSync(binding.destinationPath);
      if (!required && !destinationExists) return undefined;
      if (destinationExists) {
        throw new PigeDomainError(
          "backup.result_conflict",
          "The checkpoint-bound Backup archive is unreadable or invalid."
        );
      }
      throw caught;
    }
    if (
      path.resolve(inspected.backupPath) !== binding.destinationPath ||
      inspected.backupId !== binding.backupId ||
      inspected.sourceVaultId !== binding.vaultId ||
      inspected.manifest.createdAt !== binding.createdAt ||
      inspected.manifest.appVersion !== this.#appVersion ||
      inspected.invalidFileCount !== 0 ||
      !/^sha256:[a-f0-9]{64}$/u.test(inspected.archiveDigest) ||
      inspected.archiveDigest !== expectedArchiveDigest ||
      !expectedManifestChecksum
    ) {
      throw new PigeDomainError("backup.result_conflict", "The Backup archive conflicts with its durable identity.");
    }
    return inspected;
  }

  #captureActiveVault(): { readonly vaultId: string; readonly vaultPath: string } {
    const current = this.#vault.current();
    const activeVaultPath = this.#vault.activeVaultPath();
    if (!current || !activeVaultPath) {
      throw new PigeDomainError("backup.vault_unavailable", "An active vault is required for backup.");
    }
    const vaultPath = path.resolve(activeVaultPath);
    this.#vault.assertWriterLease(vaultPath);
    return { vaultId: current.vaultId, vaultPath };
  }

  #assertBinding(binding: BackupBinding): void {
    const active = this.#captureActiveVault();
    assertActiveBinding(active, binding);
  }

  #store(vaultPath: string): JobRecordStore {
    return new JobRecordStore({
      rootPath: path.join(vaultPath, ".pige", "jobs"),
      assertWriterLease: () => this.#vault.assertWriterLease(vaultPath)
    });
  }
}

function createQueuedBackupJob(binding: BackupBinding): JobRecord {
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
  const checkpoints: JobCheckpoint[] = BACKUP_CHECKPOINT_IDS.map((id) => ({
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
    actor: {
      kind: "user",
      runtimeKind: "desktop_local",
      clientCapabilityTier: "desktop_full"
    },
    inputRefs: [destinationRef, backupIdentityRef],
    outputRefs: [],
    operationIds: [],
    checkpoints,
    progress: { completedUnits: 0, totalUnits: BACKUP_CHECKPOINT_IDS.length, unit: "checkpoint" },
    retry: { retryCount: 0, maxAutomaticRetries: 0, requiresUserAction: false },
    cancellation: { durableWritesApplied: false },
    privacy: {
      usedCloudModel: false,
      usedNetwork: false,
      usedShell: false,
      accessedExternalFiles: true,
      permissionDecisionIds: []
    },
    message: "Backup is queued."
  });
}

function readBackupBinding(job: JobRecord, vaultPath: string): BackupBinding {
  const destination = job.inputRefs?.find((ref) => ref.role === "backup_destination")?.path;
  const backupId = job.inputRefs?.find((ref) => ref.role === "backup_identity")?.id;
  if (
    job.class !== "backup" ||
    job.scope !== "vault" ||
    !job.activeVaultId ||
    !destination ||
    !backupId ||
    !isCanonicalBackupDestination(destination)
  ) {
    throw new PigeDomainError("backup.job_conflict", "The Backup Job binding is invalid.");
  }
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

function startJob(store: JobRecordStore, snapshot: JobRecordSnapshot, nowSource: Date): JobRecordSnapshot {
  if (snapshot.job.state === "running") return snapshot;
  if (
    snapshot.job.state !== "queued" &&
    snapshot.job.state !== "failed_retryable" &&
    snapshot.job.state !== "waiting_dependency"
  ) {
    throw new PigeDomainError("backup.job_conflict", "The Backup Job cannot start from its durable state.");
  }
  const now = nowSource.toISOString();
  const {
    error: _error,
    finishedAt: _finishedAt,
    waitingDependency: _waitingDependency,
    ...rest
  } = snapshot.job;
  return store.compareAndSwap(snapshot, JobRecordSchema.parse({
    ...rest,
    state: "running",
    stage: "backing_up",
    startedAt: snapshot.job.startedAt ?? now,
    updatedAt: now,
    message: "Backup is running."
  }));
}

function recordCheckpoint(
  store: JobRecordStore,
  snapshot: JobRecordSnapshot,
  binding: BackupBinding,
  event: BackupCreateCheckpointEvent,
  nowSource: Date
): JobRecordSnapshot {
  const index = BACKUP_CHECKPOINT_IDS.indexOf(event.phase);
  const checkpoints = snapshot.job.checkpoints ?? [];
  const current = checkpoints[index];
  if (!current || current.id !== event.phase) {
    throw new PigeDomainError("backup.checkpoint_conflict", "The Backup checkpoint order is invalid.");
  }
  if (current.state === "done") {
    assertStoredCheckpoint(current, event, binding);
    return snapshot;
  }
  if (checkpoints.slice(0, index).some((checkpoint) => checkpoint.state !== "done")) {
    throw new PigeDomainError("backup.checkpoint_conflict", "The Backup checkpoint advanced out of order.");
  }
  if (snapshot.job.state === "cancel_requested" && event.phase !== "archive_finalized") {
    throw abortError();
  }
  const now = nowSource.toISOString();
  const checksum = checkpointChecksum(event);
  const backupRef = event.phase === "archive_finalized"
    ? [{
        kind: "backup" as const,
        id: binding.backupId,
        path: binding.destinationPath,
        ...(event.archiveDigest ? { checksum: event.archiveDigest } : {}),
        role: "backup_archive"
      }]
    : [];
  const nextCheckpoints = checkpoints.map((checkpoint, checkpointIndex) => checkpointIndex === index ? {
    ...checkpoint,
    state: "done" as const,
    startedAt: checkpoint.startedAt ?? now,
    finishedAt: now,
    outputRefs: backupRef,
    ...(checksum ? { checksumAfter: checksum } : {})
  } : checkpoint);
  return store.compareAndSwap(snapshot, JobRecordSchema.parse({
    ...snapshot.job,
    state: "running",
    stage: "backing_up",
    startedAt: snapshot.job.startedAt ?? now,
    updatedAt: now,
    checkpoints: nextCheckpoints,
    progress: {
      completedUnits: nextCheckpoints.filter((checkpoint) => checkpoint.state === "done").length,
      totalUnits: BACKUP_CHECKPOINT_IDS.length,
      unit: "checkpoint"
    },
    cancellation: event.phase === "archive_finalized" ? {
      ...(snapshot.job.cancellation ?? {}),
      safeCheckpointId: "archive_finalized",
      durableWritesApplied: true
    } : snapshot.job.cancellation,
    message: `Backup checkpoint ${event.phase} completed.`
  }));
}

function completeMissingCheckpoints(
  store: JobRecordStore,
  initialSnapshot: JobRecordSnapshot,
  binding: BackupBinding,
  inspected: RestoreCorePreviewResult,
  nowSource: Date
): JobRecordSnapshot {
  let snapshot = initialSnapshot;
  for (const phase of BACKUP_CHECKPOINT_IDS) {
    if (checkpointDone(snapshot.job, phase)) continue;
    const archiveDigest = phase === "archive_staged" || phase === "archive_finalized"
      ? inspected.archiveDigest as `sha256:${string}`
      : undefined;
    snapshot = recordCheckpoint(store, snapshot, binding, {
      phase,
      backupId: binding.backupId,
      createdAt: binding.createdAt,
      stagingOwnerKey: binding.jobId,
      ...(archiveDigest ? { archiveDigest } : {})
    }, nowSource);
  }
  return snapshot;
}

function markCancelled(
  store: JobRecordStore,
  initialSnapshot: JobRecordSnapshot,
  nowSource: Date
): JobRecordSnapshot {
  const snapshot = refreshSnapshot(store, initialSnapshot);
  if (checkpointDone(snapshot.job, "archive_finalized")) {
    throw new PigeDomainError("backup.result_conflict", "A finalized Backup cannot be recorded as cancelled.");
  }
  const now = nowSource.toISOString();
  return store.compareAndSwap(snapshot, JobRecordSchema.parse({
    ...snapshot.job,
    state: "cancelled",
    updatedAt: now,
    finishedAt: now,
    cancellation: {
      ...(snapshot.job.cancellation ?? {}),
      requestedAt: snapshot.job.cancellation?.requestedAt ?? now,
      requestedBy: snapshot.job.cancellation?.requestedBy ?? "system",
      safeCheckpointId: lastDoneCheckpoint(snapshot.job),
      durableWritesApplied: false
    },
    message: "Backup was cancelled before archive finalization."
  }));
}

function markFailed(
  store: JobRecordStore,
  initialSnapshot: JobRecordSnapshot,
  caught: unknown,
  nowSource: Date
): JobRecordSnapshot {
  const snapshot = refreshSnapshot(store, initialSnapshot);
  if (isCompleted(snapshot.job)) return snapshot;
  if (caught instanceof BackupManagedCopyDependencyError) {
    const now = nowSource.toISOString();
    const { error: _error, finishedAt: _finishedAt, ...rest } = snapshot.job;
    return store.compareAndSwap(snapshot, JobRecordSchema.parse({
      ...rest,
      state: "waiting_dependency",
      updatedAt: now,
      waitingDependency: {
        dependencyKind: caught.dependencyKind,
        dependencyId: caught.dependencyId,
        requiredAction: "reconnect_path",
        messageKey: `errors.${caught.code}`
      },
      retry: {
        retryCount: snapshot.job.retry?.retryCount ?? 0,
        maxAutomaticRetries: 0,
        requiresUserAction: true,
        lastRetryReason: caught.code
      },
      message: "Backup is waiting for a required managed source location."
    }));
  }
  const retryable = isRetryableFailure(caught);
  const code = safeErrorCode(caught);
  const now = nowSource.toISOString();
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
      userAction: retryable ? "retry" : "choose_path"
    },
    retry: {
      retryCount: snapshot.job.retry?.retryCount ?? 0,
      maxAutomaticRetries: 0,
      requiresUserAction: true,
      lastRetryReason: code
    },
    message: retryable
      ? "Backup stopped safely and can be retried with the same identity."
      : "Backup stopped because its durable binding or output conflicted."
  }));
}

function assertCoreEventBinding(event: BackupCreateCheckpointEvent, binding: BackupBinding): void {
  if (
    event.backupId !== binding.backupId ||
    new Date(event.createdAt).toISOString() !== binding.createdAt ||
    event.stagingOwnerKey !== binding.jobId ||
    (event.manifestChecksum !== undefined && !/^sha256:[a-f0-9]{64}$/u.test(event.manifestChecksum)) ||
    (event.archiveDigest !== undefined && !/^sha256:[a-f0-9]{64}$/u.test(event.archiveDigest))
  ) {
    throw new PigeDomainError("backup.checkpoint_conflict", "The Backup checkpoint binding changed.");
  }
}

function assertStoredCheckpoint(
  checkpoint: JobCheckpoint,
  event: BackupCreateCheckpointEvent,
  binding: BackupBinding
): void {
  const checksum = checkpointChecksum(event);
  if (
    (checksum !== undefined && checkpoint.checksumAfter !== checksum) ||
    (event.phase === "archive_finalized" && !checkpoint.outputRefs.some((ref) =>
      ref.kind === "backup" &&
      ref.id === binding.backupId &&
      path.resolve(ref.path ?? "") === binding.destinationPath &&
      (event.archiveDigest === undefined || ref.checksum === event.archiveDigest)
    ))
  ) {
    throw new PigeDomainError("backup.checkpoint_conflict", "The stored Backup checkpoint conflicts with core output.");
  }
}

function assertOperationBinding(
  operation: OperationRecord,
  binding: BackupBinding,
  inspected: RestoreCorePreviewResult
): void {
  if (
    operation.kind !== "backup_created" ||
    operation.jobId !== binding.jobId ||
    operation.createdAt !== binding.createdAt ||
    operation.permissionDecisionIds.length !== 0 ||
    !operation.targetRefs.some((ref) =>
      ref.kind === "backup" && ref.id === binding.backupId && ref.checksum === inspected.archiveDigest
    ) ||
    !operation.sourceRefs.some((ref) => ref.kind === "job" && ref.id === binding.jobId) ||
    !operation.sourceRefs.some((ref) => ref.kind === "vault" && ref.id === binding.vaultId)
  ) {
    throw new PigeDomainError("backup.operation_conflict", "The Backup Operation conflicts with exact archive identity.");
  }
}

function assertCompletedJob(
  job: JobRecord,
  binding: BackupBinding,
  inspected: RestoreCorePreviewResult,
  operationId?: string
): void {
  const archiveRef = job.outputRefs?.find((ref) => ref.role === "backup_archive");
  const linkedOperationId = operationId ?? job.operationIds?.[0];
  if (
    archiveRef?.id !== binding.backupId ||
    archiveRef.checksum !== inspected.archiveDigest ||
    path.resolve(archiveRef.path ?? "") !== binding.destinationPath ||
    !linkedOperationId ||
    !job.operationIds?.includes(linkedOperationId) ||
    !job.outputRefs?.some((ref) => ref.kind === "operation" && ref.id === linkedOperationId)
  ) {
    throw new PigeDomainError("backup.job_conflict", "The completed Backup Job conflicts with exact archive identity.");
  }
}

function createBackupRef(binding: BackupBinding, inspected: RestoreCorePreviewResult): JobRef {
  return {
    kind: "backup",
    id: binding.backupId,
    path: binding.destinationPath,
    checksum: inspected.archiveDigest,
    role: "backup_archive"
  };
}

function listRecoverableBackupJobs(
  store: JobRecordStore,
  vaultPath: string
): readonly JobRecordSnapshot[] {
  const jobsRoot = path.join(vaultPath, ".pige", "jobs");
  if (!fs.existsSync(jobsRoot)) return [];
  const snapshots: JobRecordSnapshot[] = [];
  for (const year of readSafeDirectory(jobsRoot)) {
    if (!/^\d{4}$/u.test(year.name) || !year.isDirectory()) continue;
    const yearPath = path.join(jobsRoot, year.name);
    for (const month of readSafeDirectory(yearPath)) {
      if (!/^\d{2}$/u.test(month.name) || !month.isDirectory()) continue;
      const monthPath = path.join(yearPath, month.name);
      for (const entry of readSafeDirectory(monthPath)) {
        if (!/^job_\d{8}_[a-z0-9]{8,}\.json$/u.test(entry.name) || !entry.isFile()) continue;
        const snapshot = store.read(path.join(monthPath, entry.name));
        if (
          snapshot.job.class === "backup" &&
          snapshot.job.inputRefs?.some((ref) => ref.role === "backup_destination") &&
          RECOVERABLE_STATES.has(snapshot.job.state)
        ) {
          snapshots.push(snapshot);
        }
        if (snapshots.length > MAX_RECOVERABLE_JOBS) {
          throw new PigeDomainError("backup.job_store_invalid", "Backup Job storage exceeds its bounded capacity.");
        }
      }
    }
  }
  return snapshots.sort((left, right) =>
    left.job.createdAt.localeCompare(right.job.createdAt) || left.job.id.localeCompare(right.job.id)
  );
}

function readSafeDirectory(directoryPath: string): readonly fs.Dirent[] {
  const stat = fs.lstatSync(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new PigeDomainError("backup.job_store_invalid", "Backup Job storage is unsafe.");
  }
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  if (entries.some((entry) => entry.isSymbolicLink())) {
    throw new PigeDomainError("backup.job_store_invalid", "Backup Job storage contains a symbolic link.");
  }
  return entries;
}

function readJobIfPresent(store: JobRecordStore, filePath: string): JobRecordSnapshot | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return store.read(filePath);
  } catch (caught) {
    if (
      isErrno(caught, "ENOENT") ||
      (caught instanceof PigeDomainError && caught.code === "job.record_not_found")
    ) return undefined;
    throw caught;
  }
}

function refreshSnapshot(store: JobRecordStore, snapshot: JobRecordSnapshot): JobRecordSnapshot {
  const current = store.read(snapshot.path);
  if (current.job.id !== snapshot.job.id) {
    throw new PigeDomainError("job.revision_conflict", "The Backup Job identity changed.");
  }
  return current;
}

function assertActiveBinding(
  active: { readonly vaultId: string; readonly vaultPath: string },
  binding: BackupBinding
): void {
  if (active.vaultId !== binding.vaultId || active.vaultPath !== binding.vaultPath) {
    throw new PigeDomainError("backup.binding_changed", "The active vault binding changed during backup.");
  }
}

function parseRequestedJobId(request: BackupJobRequest | string): string {
  return JobIdSchema.parse(typeof request === "string" ? request : request.jobId);
}

function jobFilePath(vaultPath: string, jobId: string): string {
  const parsed = JobIdSchema.parse(jobId);
  const match = /^job_(\d{4})(\d{2})\d{2}_/u.exec(parsed);
  if (!match) throw new PigeDomainError("backup.job_conflict", "The Backup Job identity is invalid.");
  return path.join(vaultPath, ".pige", "jobs", match[1]!, match[2]!, `${parsed}.json`);
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

function checkpointChecksum(event: BackupCreateCheckpointEvent): string | undefined {
  return event.archiveDigest ?? event.manifestChecksum;
}

function expectedCheckpointDigests(job: JobRecord): Pick<
  BackupCreateOptions,
  "expectedManifestChecksum" | "expectedArchiveDigest"
> {
  const manifestChecksum = job.checkpoints?.find(
    (checkpoint) => checkpoint.id === "files_hashed" || checkpoint.id === "manifest_written"
  )?.checksumAfter;
  const archiveDigest = job.checkpoints?.find(
    (checkpoint) => checkpoint.id === "archive_finalized" || checkpoint.id === "archive_staged"
  )?.checksumAfter;
  return {
    ...(manifestChecksum ? { expectedManifestChecksum: manifestChecksum as `sha256:${string}` } : {}),
    ...(archiveDigest ? { expectedArchiveDigest: archiveDigest as `sha256:${string}` } : {})
  };
}

function checkpointDone(job: JobRecord, id: BackupCheckpointId): boolean {
  return job.checkpoints?.find((checkpoint) => checkpoint.id === id)?.state === "done";
}

function lastDoneCheckpoint(job: JobRecord): string | undefined {
  return [...(job.checkpoints ?? [])].reverse().find((checkpoint) => checkpoint.state === "done")?.id;
}

function isCompleted(job: JobRecord): boolean {
  return job.state === "completed" || job.state === "completed_with_warnings";
}

function isRetryableFailure(caught: unknown): boolean {
  if (!(caught instanceof PigeDomainError)) return true;
  return !new Set([
    "backup.binding_changed",
    "backup.checkpoint_conflict",
    "backup.destination_changed",
    "backup.destination_exists",
    "backup.job_conflict",
    "backup.operation_conflict",
    "backup.result_conflict",
    "backup.staging_conflict",
    "backup.vault_invalid",
    "backup.path_inside_vault",
    "vault.binding_changed",
    "vault.writer_lease_lost"
  ]).has(caught.code);
}

function safeErrorCode(caught: unknown): string {
  const candidate = caught instanceof PigeDomainError && caught.code.startsWith("backup.")
    ? caught.code
    : "backup.execution_failed";
  return /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,2}$/u.test(candidate)
    ? candidate
    : "backup.execution_failed";
}

function isContention(caught: unknown): boolean {
  return caught instanceof PigeDomainError && new Set([
    "job.claim_conflict",
    "job.claim_lost",
    "job.revision_conflict"
  ]).has(caught.code);
}

function isAbortError(caught: unknown): boolean {
  return Boolean(caught && typeof caught === "object" && "name" in caught && caught.name === "AbortError");
}

function abortError(): Error {
  const error = new Error("Backup execution was aborted.");
  error.name = "AbortError";
  return error;
}

function isErrno(caught: unknown, code: string): boolean {
  return Boolean(caught && typeof caught === "object" && "code" in caught && caught.code === code);
}

function dedupeRefs(refs: readonly JobRef[]): readonly JobRef[] {
  const unique = new Map<string, JobRef>();
  for (const ref of refs) unique.set(canonicalJson(ref), ref);
  return [...unique.values()];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createDeterministicBackupOperationId(jobId: string): string {
  const dateKey = /^job_(\d{8})_/u.exec(JobIdSchema.parse(jobId))?.[1];
  if (!dateKey) throw new PigeDomainError("backup.operation_conflict", "The Backup Operation date is invalid.");
  return `op_${dateKey}_${createHash("sha256")
    .update("pige:backup-created-operation:v1\0", "utf8")
    .update(jobId, "utf8")
    .digest("hex")}`;
}
