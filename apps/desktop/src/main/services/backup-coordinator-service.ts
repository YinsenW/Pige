import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { hasObjectErrorCode as isErrno } from "./object-error-code";
import {
  BackupIdSchema,
  JobIdSchema,
  OperationRecordSchema,
  type JobCheckpoint,
  type JobRecord,
  type JobRef,
  type OperationRecord
} from "@pige/schemas";
import {
  captureBackupDestinationFence,
  type BackupCreateCheckpointEvent,
  type BackupCreateOptions,
  type RestoreCorePreviewResult
} from "./backup-service";
import {
  inspectBackupReconnectCandidate,
  inspectBackupIncompleteCandidate,
  markBackupFailed,
  omittedExternalManagedCopyRootIds,
  prepareIncompleteBackupJob,
  prepareIncompleteBackupRecovery,
  createQueuedBackupJob,
  readBackupBinding,
  prepareBackupForDurableCompletion,
  prepareReconnectedJob,
  proveWaitingDependency,
  repairBackupReconnectCandidate,
  startBackupJob,
  type BackupReconnectCandidate,
  type BackupReconnectCandidateResult,
  type BackupIncompleteCandidate,
  type BackupIncompleteCandidateResult,
  type BackupBinding,
  type BackupJobRequest,
  type BackupRecoveryResult,
  type BackupRetryResult,
  type BackupServicePort
} from "./backup-reconnect-coordinator";
import {
  BackupDestinationReconnectService,
  isBackupDestinationReconnectFailure,
  type BackupDestinationReconnectCandidate,
  type BackupDestinationReconnectCandidateResult
} from "./backup-destination-reconnect-service";
import { JobExecutionCoordinator } from "./job-execution-coordinator";
import { JobRecordStore, type JobRecordSnapshot } from "./job-record-store";
export const BACKUP_CHECKPOINT_IDS = [
  "preflight",
  "manifest_written",
  "files_hashed",
  "archive_staged",
  "archive_finalized"
] as const;

export type BackupCheckpointId = typeof BACKUP_CHECKPOINT_IDS[number];

export type { BackupServicePort } from "./backup-reconnect-coordinator";

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
  readonly warningCodes?: readonly string[];
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
  readonly schedule?: (task: () => Promise<void>) => void;
}

export type {
  BackupJobRequest,
  BackupIncompleteCandidate,
  BackupIncompleteCandidateResult,
  BackupReconnectCandidate,
  BackupReconnectCandidateResult,
  BackupRecoveryResult,
  BackupRetryResult
} from "./backup-reconnect-coordinator";

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
  readonly #schedule: (task: () => Promise<void>) => void;
  readonly #destinationReconnect: BackupDestinationReconnectService;
  readonly #controllers = new Map<string, AbortController>();

  constructor(options: BackupCoordinatorOptions) {
    this.#vault = options.vault;
    this.#backup = options.backupService;
    this.#appVersion = options.appVersion;
    this.#writeOperation = options.writeBackupCreatedOperation;
    this.#now = options.now ?? (() => new Date());
    this.#randomId = options.randomId ?? (() => randomUUID().replaceAll("-", ""));
    this.#schedule = options.schedule ?? ((task) => { setTimeout(() => { void task(); }, 0); });
    this.#destinationReconnect = new BackupDestinationReconnectService({
      capture: (jobIdInput) => {
        const active = this.#captureActiveVault();
        const jobId = parseRequestedJobId(jobIdInput);
        const store = this.#store(active.vaultPath);
        return { ...active, store, snapshot: readJobIfPresent(store, jobFilePath(active.vaultPath, jobId)) };
      },
      now: this.#now,
      onQueued: (context, queued) => {
        const binding = readBackupBinding(queued.job, context.vaultPath);
        this.#schedule(async () => { await this.#run(context.store, queued, binding).then(() => undefined, () => undefined); });
      }
    });
  }

  inspectReconnectCandidate(activeVaultId: string, jobIdInput: string): BackupReconnectCandidateResult {
    const active = this.#captureActiveVault();
    const jobId = parseRequestedJobId(jobIdInput);
    const store = this.#store(active.vaultPath);
    const snapshot = readJobIfPresent(store, jobFilePath(active.vaultPath, jobId));
    return inspectBackupReconnectCandidate(active.vaultId, activeVaultId, jobId, snapshot);
  }

  inspectIncompleteCandidate(
    activeVaultId: string,
    jobIdInput: string,
    expectedJobUpdatedAt: string
  ): BackupIncompleteCandidateResult {
    const active = this.#captureActiveVault();
    const jobId = parseRequestedJobId(jobIdInput);
    const store = this.#store(active.vaultPath);
    const snapshot = readJobIfPresent(store, jobFilePath(active.vaultPath, jobId));
    return inspectBackupIncompleteCandidate(
      active.vaultId,
      activeVaultId,
      jobId,
      expectedJobUpdatedAt,
      snapshot
    );
  }

  inspectDestinationReconnectCandidate(
    activeVaultId: string,
    jobIdInput: string,
    expectedJobUpdatedAt: string
  ): BackupDestinationReconnectCandidateResult {
    const jobId = parseRequestedJobId(jobIdInput);
    return this.#destinationReconnect.inspect(activeVaultId, jobId, expectedJobUpdatedAt);
  }

  reconnectDestination(
    candidate: BackupDestinationReconnectCandidate,
    selectedDirectory: string
  ): "reconnected" | "stale" | "not_found" | "ineligible" | "failed" {
    return this.#destinationReconnect.reconnect(candidate, selectedDirectory);
  }

  async continueIncomplete(
    candidate: BackupIncompleteCandidate
  ): Promise<"continued" | "stale" | "not_found" | "ineligible" | "failed"> {
    const active = this.#captureActiveVault();
    const inspected = this.inspectIncompleteCandidate(
      candidate.vaultId,
      candidate.jobId,
      candidate.jobUpdatedAt
    );
    if (inspected.status !== "ready") return inspected.status;
    const store = this.#store(active.vaultPath);
    const snapshot = readJobIfPresent(store, jobFilePath(active.vaultPath, candidate.jobId));
    const queued = prepareIncompleteBackupJob(store, snapshot, candidate, this.#now());
    if (!queued) return "stale";
    try {
      const binding = readBackupBinding(queued.job, active.vaultPath);
      const result = (await this.#run(store, queued, binding)).job;
      return result.state === "completed_with_warnings" ? "continued" : "failed";
    } catch (caught) {
      if (isContention(caught)) return "stale";
      return "failed";
    }
  }

  reconnectDependency(
    candidate: BackupReconnectCandidate,
    selectedDirectory: string
  ): "resolved" | "stale" | "not_found" | "failed" {
    const active = this.#captureActiveVault();
    return repairBackupReconnectCandidate({
      candidate,
      selectedDirectory,
      vaultPath: active.vaultPath,
      vaultId: active.vaultId,
      service: this.#backup,
      inspect: () => this.inspectReconnectCandidate(candidate.vaultId, candidate.jobId),
      prepareSameJob: () => this.#prepareReconnectedJob(active.vaultPath, candidate.jobId)
    });
  }

  #prepareReconnectedJob(vaultPath: string, jobId: string): "queued" | "stale" | "not_found" {
    const store = this.#store(vaultPath);
    const snapshot = readJobIfPresent(store, jobFilePath(vaultPath, jobId));
    return prepareReconnectedJob(store, snapshot, this.#now(), (queued) => {
      const binding = readBackupBinding(queued.job, vaultPath);
      this.#schedule(async () => {
        await this.#run(store, queued, binding).then(() => undefined, () => undefined);
      });
    });
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
      createQueuedBackupJob(binding, BACKUP_CHECKPOINT_IDS)
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
    const owner = coordinator(store, this.#now());
    const next = owner.requestCancellation(snapshot, {
      requestedBy: "user",
      message: "Backup cancellation was requested."
    });
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
    if (snapshot.job.state === "waiting_dependency") {
      const waiting = snapshot.job.waitingDependency;
      if (!proveWaitingDependency(this.#backup, active.vaultPath, active.vaultId, waiting)) {
        return { status: "not_allowed", job: snapshot.job };
      }
      snapshot = coordinator(store, this.#now()).prepareRetry(snapshot, {
        message: "Backup retry is queued with its original identity."
      });
    } else if (snapshot.job.state === "failed_retryable") {
      snapshot = coordinator(store, this.#now()).prepareRetry(snapshot, {
        message: "Backup retry is queued with its original identity."
      });
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
    for (const initialSnapshot of listRecoverableBackupJobs(store, active.vaultPath)) {
      try {
        let snapshot = initialSnapshot.job.state === "running"
          ? coordinator(store, this.#now()).recoverInterrupted(initialSnapshot, {
              canResumeIdempotently: true,
              queuedMessage: "Interrupted Backup recovery is queued with its exact checkpoint identity.",
              retryableMessage: "Interrupted Backup recovery requires an explicit retry."
            })
          : initialSnapshot;
        const binding = readBackupBinding(snapshot.job, active.vaultPath);
        assertActiveBinding(active, binding);
        if (snapshot.job.state === "waiting_dependency") {
          const incomplete = prepareIncompleteBackupRecovery(store, snapshot, this.#now());
          if (incomplete) {
            snapshot = incomplete;
          } else {
          const waiting = snapshot.job.waitingDependency;
          if (!proveWaitingDependency(this.#backup, active.vaultPath, active.vaultId, waiting)) {
            failed += 1;
            continue;
          }
          snapshot = coordinator(store, this.#now()).prepareRetry(snapshot, {
            message: "Repaired Backup recovery is queued with its original identity."
          });
          }
        }
        const result = await this.#run(store, snapshot, binding);
        if (RECOVERABLE_STATES.has(result.job.state)) {
          failed += 1;
        } else {
          recovered += 1;
        }
      } catch (caught) {
        if (isBackupDestinationReconnectFailure(caught)) {
          try {
            const waiting = markBackupFailed(store, initialSnapshot, caught, this.#now());
            if (waiting.job.state === "waiting_dependency") {
              failed += 1;
              continue;
            }
          } catch {
            // Preserve the original recovery failure count when durable reconciliation cannot commit.
          }
        }
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

      snapshot = startBackupJob(store, snapshot, this.#now());
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
        return markBackupFailed(store, snapshot, caught, this.#now());
      } catch (reconcileError) {
        if (isContention(reconcileError)) throw reconcileError;
        if (reconcileError instanceof PigeDomainError && (
          reconcileError.code === "backup.result_conflict" ||
          reconcileError.code === "backup.operation_conflict" ||
          reconcileError.code === "backup.job_conflict"
        )) {
          return markBackupFailed(store, snapshot, reconcileError, this.#now());
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
      ...(omittedExternalManagedCopyRootIds(job).length > 0
        ? { omittedExternalManagedCopyRootIds: omittedExternalManagedCopyRootIds(job) }
        : {}),
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
    snapshot = prepareBackupForDurableCompletion(store, snapshot, this.#now());
    snapshot = completeMissingCheckpoints(store, snapshot, binding, inspected, this.#now());
    this.#assertBinding(binding);
    const operation = OperationRecordSchema.parse(await this.#writeOperation({
      job: snapshot.job,
      vaultPath: binding.vaultPath,
      vaultId: binding.vaultId,
      backupId: binding.backupId,
      archiveDigest: inspected.archiveDigest as `sha256:${string}`,
      ...(omittedExternalManagedCopyRootIds(snapshot.job).length > 0
        ? { warningCodes: ["backup.external_managed_copy_omitted"] }
        : {}),
      assertVaultWriterLease: () => this.#vault.assertWriterLease(binding.vaultPath)
    }));
    assertOperationBinding(operation, binding, inspected, snapshot.job);
    snapshot = refreshSnapshot(store, snapshot);
    if (isCompleted(snapshot.job)) {
      assertCompletedJob(snapshot.job, binding, inspected, operation.id);
      return snapshot;
    }
    const backupRef = createBackupRef(binding, inspected);
    const incomplete = omittedExternalManagedCopyRootIds(snapshot.job).length > 0;
    return coordinator(store, this.#now()).adoptDurableCompletion(snapshot, {
      checkpointId: "archive_finalized",
      ...(incomplete ? { result: "completed_with_warnings" as const } : {}),
      message: incomplete
        ? "Backup completed with an explicitly omitted external managed-copy root."
        : "Backup completed and passed exact archive inspection.",
      facts: {
        stage: "backing_up",
        outputRefs: dedupeRefs([
          ...(snapshot.job.outputRefs ?? []),
          backupRef,
          { kind: "operation", id: operation.id, role: "backup_created" }
        ]),
        operationIds: Array.from(new Set([...(snapshot.job.operationIds ?? []), operation.id])),
        progress: {
          completedUnits: BACKUP_CHECKPOINT_IDS.length,
          totalUnits: BACKUP_CHECKPOINT_IDS.length,
          unit: "checkpoint"
        }
      }
    });
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
  const facts = {
    stage: "backing_up" as const,
    checkpoints: nextCheckpoints,
    progress: {
      completedUnits: nextCheckpoints.filter((checkpoint) => checkpoint.state === "done").length,
      totalUnits: BACKUP_CHECKPOINT_IDS.length,
      unit: "checkpoint"
    },
    message: `Backup checkpoint ${event.phase} completed.`
  };
  return event.phase === "archive_finalized"
    ? coordinator(store, nowSource).markDurableBoundary(snapshot, {
        checkpointId: "archive_finalized",
        message: facts.message,
        facts
      })
    : coordinator(store, nowSource).patch(snapshot, facts);
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
  let snapshot = refreshSnapshot(store, initialSnapshot);
  if (checkpointDone(snapshot.job, "archive_finalized")) {
    throw new PigeDomainError("backup.result_conflict", "A finalized Backup cannot be recorded as cancelled.");
  }
  const owner = coordinator(store, nowSource);
  if (snapshot.job.state !== "cancel_requested") {
    snapshot = owner.requestCancellation(snapshot, {
      requestedBy: "system",
      message: "Backup cancellation was requested."
    });
  }
  return owner.cancellationOutcome(snapshot, {
    cancelledMessage: "Backup was cancelled before archive finalization.",
    preservedResultMessage: "Backup was cancelled before archive finalization.",
    safeCheckpointId: lastDoneCheckpoint(snapshot.job) ?? "before_durable_write"
  });
}

function coordinator(store: JobRecordStore, nowSource: Date): JobExecutionCoordinator {
  return new JobExecutionCoordinator(store, { now: () => nowSource });
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
  inspected: RestoreCorePreviewResult,
  job: JobRecord
): void {
  const incomplete = omittedExternalManagedCopyRootIds(job).length > 0;
  if (
    operation.kind !== "backup_created" ||
    operation.jobId !== binding.jobId ||
    operation.createdAt !== binding.createdAt ||
    !operation.targetRefs.some((ref) =>
      ref.kind === "backup" && ref.id === binding.backupId && ref.checksum === inspected.archiveDigest
    ) ||
    !operation.sourceRefs.some((ref) => ref.kind === "job" && ref.id === binding.jobId) ||
    !operation.sourceRefs.some((ref) => ref.kind === "vault" && ref.id === binding.vaultId) ||
    operation.warnings.includes("backup.external_managed_copy_omitted") !== incomplete
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
    !job.outputRefs?.some((ref) => ref.kind === "operation" && ref.id === linkedOperationId) ||
    (omittedExternalManagedCopyRootIds(job).length > 0 && job.state !== "completed_with_warnings")
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
