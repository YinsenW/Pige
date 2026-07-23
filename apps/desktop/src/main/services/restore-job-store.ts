import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  JobIdSchema,
  JobRecordSchema,
  OperationIdSchema,
  OperationRecordSchema,
  VaultIdSchema,
  type JobCheckpoint,
  type JobRecord,
  type JobRef,
  type OperationRecord,
  type PigeErrorSummary
} from "@pige/schemas";
import { JobExecutionCoordinator } from "./job-execution-coordinator";
import { JobRecordStore, type JobRecordSnapshot } from "./job-record-store";
import { acquireVaultWriterLease, type VaultWriterLease } from "./vault-writer-lease";

export const RESTORE_CHECKPOINT_IDS = [
  "manifest_validated",
  "destination_reserved",
  "archive_extracted",
  "durable_domains_migrated",
  "external_dependencies_reconciled",
  "vault_identity_finalized",
  "destination_committed",
  "indexes_rebuilt"
] as const;

export function createRestoreJobError(codeInput: string | undefined, retryable: boolean): PigeErrorSummary {
  const code = codeInput && /^(?:backup|restore|vault)\./u.test(codeInput)
    ? codeInput
    : "restore.execution_failed";
  return {
    code,
    domain: code.startsWith("backup.") ? "backup" : code.startsWith("vault.") ? "vault" : "restore",
    messageKey: `errors.${code}`,
    retryable,
    severity: "error",
    userAction: retryable ? "retry" : "choose_path"
  };
}

export type RestoreCheckpointId = typeof RESTORE_CHECKPOINT_IDS[number];
export type RestoreJobMode = "clone_as_new" | "replace_existing";

export interface RestoreJobIdentityInput {
  readonly createdAt: string;
  readonly archiveDigest: `sha256:${string}`;
  readonly backupId: string;
  readonly mode: RestoreJobMode;
  readonly sourceVaultId: string;
  readonly destinationIdentity: `sha256:${string}`;
  readonly previousBindingHash: `sha256:${string}`;
}

export interface RestoreJobIdentity {
  readonly jobId: string;
  readonly resultVaultId: string;
}

export interface CreateRestoreJobInput extends RestoreJobIdentityInput {
  readonly backupPath: string;
  readonly destinationPath: string;
  readonly archivePreviewToken: `sha256:${string}`;
  readonly previewId: `sha256:${string}`;
  readonly backupIdentitySource: "manifest" | "derived_legacy";
  readonly expectedActiveVaultPath?: string;
  readonly expectedActiveVaultId?: string;
  readonly replaceConfirmed: boolean;
}

export interface RestoreJobBinding extends CreateRestoreJobInput, RestoreJobIdentity {}

export interface RestoreActionLookup {
  readonly backupPath: string;
  readonly archiveDigest: `sha256:${string}`;
  readonly backupId: string;
  readonly backupIdentitySource: "manifest" | "derived_legacy";
  readonly mode: RestoreJobMode;
  readonly sourceVaultId: string;
  readonly destinationPath: string;
  readonly destinationIdentity: `sha256:${string}`;
}

export interface RestoreOperationInput {
  readonly snapshot: JobRecordSnapshot;
  readonly vaultPath: string;
  readonly backupId: string;
  readonly archiveDigest: `sha256:${string}`;
  readonly sourceVaultId: string;
  readonly resultVaultId: string;
  readonly mode: RestoreJobMode;
  readonly destinationIdentity: `sha256:${string}`;
  readonly warningCodes?: readonly string[];
  readonly assertVaultWriterLease: () => void;
}

export interface BackupOperationInput {
  readonly job: JobRecord;
  readonly vaultPath: string;
  readonly vaultId: string;
  readonly backupId: string;
  readonly archiveDigest: `sha256:${string}`;
  readonly assertVaultWriterLease: () => void;
}

const MAX_MACHINE_JOB_RECORDS = 512;
const MAX_OPERATION_BYTES = 256 * 1024;

export class RestoreJobStore {
  readonly #rootPath: string;
  readonly #jobRootPath: string;
  readonly #lease: VaultWriterLease;
  readonly #jobs: JobRecordStore;
  #closed = false;

  constructor(userDataPathInput: string) {
    const userDataPath = captureCanonicalDirectory(userDataPathInput, true);
    this.#rootPath = ensurePrivateChildDirectory(userDataPath, "restore-coordinator");
    ensurePrivateChildDirectory(this.#rootPath, ".pige");
    this.#jobRootPath = ensurePrivateChildDirectory(path.join(this.#rootPath, ".pige"), "jobs");
    this.#lease = acquireVaultWriterLease(this.#rootPath);
    this.#jobs = new JobRecordStore({
      rootPath: this.#jobRootPath,
      assertWriterLease: () => this.#assertHeld()
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#lease.release();
  }

  create(input: CreateRestoreJobInput): JobRecordSnapshot {
    this.#assertHeld();
    if (
      input.previousBindingHash !== createPreviousVaultBindingHash(
        input.expectedActiveVaultPath,
        input.expectedActiveVaultId
      ) ||
      (input.mode === "replace_existing" && (
        input.expectedActiveVaultId !== input.sourceVaultId || input.replaceConfirmed !== true
      )) ||
      (input.mode === "clone_as_new" && input.replaceConfirmed !== false)
    ) {
      throw new PigeDomainError("restore.job_conflict", "Restore previous-vault binding is invalid.");
    }
    const identity = createRestoreJobIdentity(input);
    const filePath = this.pathFor(identity.jobId);
    const createdAt = new Date(input.createdAt).toISOString();
    const inputRefs: JobRef[] = [
      {
        kind: "backup",
        id: input.backupId,
        path: path.resolve(input.backupPath),
        checksum: input.archiveDigest,
        locator: input.backupIdentitySource,
        role: "restore_archive"
      },
      {
        kind: "tool",
        id: "restore_archive_preview",
        checksum: input.archivePreviewToken,
        role: "restore_archive_preview"
      },
      {
        kind: "tool",
        id: "restore_public_preview",
        checksum: input.previewId,
        role: "restore_public_preview"
      },
      {
        kind: "external_uri",
        id: input.sourceVaultId,
        path: path.resolve(input.destinationPath),
        checksum: input.destinationIdentity,
        locator: input.mode,
        role: "restore_destination"
      },
      {
        kind: "tool",
        id: `restore_mode:${input.mode}`,
        role: "restore_identity_mode"
      },
      {
        kind: "external_uri",
        id: input.expectedActiveVaultId ?? "no_active_vault",
        ...(input.expectedActiveVaultPath ? { path: path.resolve(input.expectedActiveVaultPath) } : {}),
        checksum: input.previousBindingHash,
        role: "previous_active_vault"
      },
      ...(input.mode === "replace_existing" ? [{
        kind: "tool" as const,
        id: "restore_replace_confirmed",
        checksum: createReplaceConfirmationHash(input),
        role: "restore_replace_confirmation"
      }] : [])
    ];
    const checkpoints: JobCheckpoint[] = RESTORE_CHECKPOINT_IDS.map((id) => ({
      id,
      step: id,
      state: "not_started",
      inputRefs: [],
      outputRefs: []
    }));
    const job = JobRecordSchema.parse({
      schemaVersion: 1,
      id: identity.jobId,
      class: "restore",
      state: "queued",
      stage: "restoring",
      priority: "interactive",
      scope: "machine_local",
      createdAt,
      updatedAt: createdAt,
      actor: {
        kind: "user",
        runtimeKind: "desktop_local",
        clientCapabilityTier: "desktop_full"
      },
      inputRefs,
      outputRefs: [],
      operationIds: [],
      checkpoints,
      progress: {
        completedUnits: 0,
        totalUnits: RESTORE_CHECKPOINT_IDS.length,
        unit: "checkpoint"
      },
      privacy: {
        usedCloudModel: false,
        usedNetwork: false,
        usedShell: false,
        accessedExternalFiles: true,
      },
      message: "Restore is queued with an explicit identity mode and validated archive binding."
    });

    try {
      return this.#jobs.createIfAbsent(filePath, job);
    } catch (caught) {
      if (!(caught instanceof PigeDomainError) || caught.code !== "job.revision_conflict") throw caught;
      const existing = this.#jobs.read(filePath);
      assertRestoreJobBinding(existing.job, input, identity);
      return existing;
    }
  }

  read(jobId: string): JobRecordSnapshot {
    return this.#jobs.read(this.pathFor(JobIdSchema.parse(jobId)));
  }

  binding(snapshot: JobRecordSnapshot): RestoreJobBinding {
    return readRestoreJobBinding(snapshot.job);
  }

  listRecoverable(): readonly JobRecordSnapshot[] {
    return this.#listAll()
      .filter(({ job }) =>
        job.class === "restore" && new Set(["queued", "running", "cancel_requested"]).has(job.state)
      )
      .sort((left, right) => left.job.createdAt.localeCompare(right.job.createdAt));
  }

  findByRestoreAction(input: RestoreActionLookup): JobRecordSnapshot | undefined {
    const matches = this.#listAll().filter((snapshot) => {
      if (snapshot.job.class !== "restore") return false;
      const binding = readRestoreJobBinding(snapshot.job);
      return (
        binding.backupPath === path.resolve(input.backupPath) &&
        binding.archiveDigest === input.archiveDigest &&
        binding.backupId === input.backupId &&
        binding.backupIdentitySource === input.backupIdentitySource &&
        binding.mode === input.mode &&
        binding.sourceVaultId === input.sourceVaultId &&
        binding.destinationPath === path.resolve(input.destinationPath) &&
        binding.destinationIdentity === input.destinationIdentity
      );
    });
    if (matches.length > 1) {
      throw new PigeDomainError("restore.job_conflict", "Multiple Restore Jobs claim the same semantic action.");
    }
    return matches[0];
  }

  prepareExplicitRetry(snapshot: JobRecordSnapshot): JobRecordSnapshot {
    if (snapshot.job.state === "running") return this.recoverInterrupted(snapshot);
    if (snapshot.job.state === "failed_retryable") {
      return this.#coordinator().prepareRetry(snapshot, {
        message: "An explicit Restore retry was accepted for the same durable Job.",
        reason: "explicit_user_retry"
      });
    }
    assertRestoreApplyState(snapshot.job);
    return snapshot;
  }

  recoverInterrupted(snapshot: JobRecordSnapshot): JobRecordSnapshot {
    if (snapshot.job.state !== "running" && snapshot.job.state !== "cancel_requested") return snapshot;
    return this.#coordinator().recoverInterrupted(snapshot, {
      canResumeIdempotently: snapshot.job.state === "running",
      queuedMessage: "Interrupted Restore recovery is queued with its exact checkpoint identity.",
      retryableMessage: "Interrupted Restore recovery requires an explicit retry."
    });
  }

  beginCheckpoint(snapshot: JobRecordSnapshot, checkpointId: RestoreCheckpointId): JobRecordSnapshot {
    return this.#transitionCheckpoint(snapshot, checkpointId, "running");
  }

  completeCheckpoint(
    snapshot: JobRecordSnapshot,
    checkpointId: RestoreCheckpointId,
    input: {
      readonly inputRefs?: readonly JobRef[];
      readonly outputRefs?: readonly JobRef[];
      readonly checksumBefore?: `sha256:${string}`;
      readonly checksumAfter?: `sha256:${string}`;
      readonly operationId?: string;
      readonly resumeHint?: string;
    } = {}
  ): JobRecordSnapshot {
    return this.#transitionCheckpoint(snapshot, checkpointId, "done", input);
  }

  markFailed(
    snapshot: JobRecordSnapshot,
    input: { readonly error: PigeErrorSummary; readonly message: string }
  ): JobRecordSnapshot {
    return this.#coordinator().settle(snapshot, input.error.retryable ? {
      kind: "requeue",
      error: { ...input.error, retryable: true },
      reason: input.error.code,
      maxAutomaticRetries: 0,
      requiresUserAction: true,
      message: input.message,
      facts: { stage: "restoring" }
    } : {
      kind: "failed",
      error: { ...input.error, retryable: false },
      message: input.message,
      facts: { stage: "restoring" }
    });
  }

  linkChildJob(snapshot: JobRecordSnapshot, childJobId: string): JobRecordSnapshot {
    const parsedChildJobId = JobIdSchema.parse(childJobId);
    return this.#coordinator().patch(snapshot, { childJobIds: [parsedChildJobId] });
  }

  markCompleted(snapshot: JobRecordSnapshot, operation: OperationRecord, resultVaultId: string, destinationPath: string): JobRecordSnapshot {
    return this.#coordinator().convergeLatest(this.read(snapshot.job.id), {
      read: () => this.read(snapshot.job.id),
      acceptTerminal: (job) => {
        const exact = job.operationIds?.includes(operation.id) &&
          job.outputRefs?.some((ref) => ref.role === "restore_applied" && ref.id === operation.id) &&
          job.outputRefs.some((ref) => ref.role === "restored_vault" &&
          ref.id === resultVaultId && path.resolve(ref.path ?? "") === path.resolve(destinationPath));
        if (!exact) throw new PigeDomainError("restore.job_conflict", "Completed Restore Job output binding changed.");
        return true;
      },
      apply: (current) => {
        if ((current.job.checkpoints ?? []).some((checkpoint) => checkpoint.state !== "done")) {
        throw new PigeDomainError("restore.checkpoint_invalid", "Restore cannot complete before every checkpoint.");
        }
        const outputRefs: JobRef[] = [...(current.job.outputRefs ?? []),
          { kind: "operation", id: operation.id, role: "restore_applied" },
          { kind: "external_uri", id: resultVaultId, path: path.resolve(destinationPath), role: "restored_vault" }];
        return this.#coordinator().adoptDurableCompletion(current, {
          checkpointId: "destination_committed",
          ...(operation.warnings.length > 0 ? { result: "completed_with_warnings" as const } : {}),
          message: operation.warnings.length > 0
            ? "Restore completed with bounded external dependency warnings."
            : "Restore completed and the restored vault binding is active.",
          facts: {
            stage: "restoring",
            activeVaultId: VaultIdSchema.parse(resultVaultId),
            outputRefs: dedupeJobRefs(outputRefs),
            operationIds: Array.from(new Set([...(current.job.operationIds ?? []), operation.id])),
            progress: {
              completedUnits: RESTORE_CHECKPOINT_IDS.length,
              totalUnits: RESTORE_CHECKPOINT_IDS.length,
              unit: "checkpoint"
            }
          }
        });
      },
      missingMessage: "The Restore Job disappeared after its durable effect.",
      conflictMessage: "The Restore Job could not converge after its durable effect."
    });
  }

  writeRestoreAppliedOperation(input: RestoreOperationInput): OperationRecord {
    this.#assertHeld();
    input.assertVaultWriterLease();
    return this.#writeOperation(
      input.vaultPath,
      createRestoreAppliedOperation(input),
      input.assertVaultWriterLease
    );
  }

  writeBackupCreatedOperation(input: BackupOperationInput): OperationRecord {
    this.#assertHeld();
    return writeBackupCreatedOperation(input);
  }

  #writeOperation(
    vaultPath: string,
    operation: OperationRecord,
    assertVaultWriterLease: () => void
  ): OperationRecord {
    const operationPath = operationFilePath(vaultPath, operation.id);
    const existing = readOperationIfPresent(operationPath, assertVaultWriterLease);
    if (existing) {
      if (canonicalJson(existing) !== canonicalJson(operation)) {
        throw new PigeDomainError("restore.operation_conflict", "The restore Operation conflicts with durable state.");
      }
      return existing;
    }
    writeOperationNoReplace(operationPath, operation, assertVaultWriterLease);
    const committed = readOperationIfPresent(operationPath, assertVaultWriterLease);
    if (!committed || canonicalJson(committed) !== canonicalJson(operation)) {
      throw new PigeDomainError("restore.operation_conflict", "The restore Operation failed exact readback.");
    }
    return committed;
  }

  pathFor(jobId: string): string {
    const parsed = JobIdSchema.parse(jobId);
    const match = /^job_(\d{4})(\d{2})\d{2}_/u.exec(parsed);
    if (!match) throw new PigeDomainError("restore.job_invalid", "Restore Job identity is invalid.");
    return path.join(this.#jobRootPath, match[1]!, match[2]!, `${parsed}.json`);
  }

  #listAll(): readonly JobRecordSnapshot[] {
    this.#assertHeld();
    const snapshots: JobRecordSnapshot[] = [];
    for (const year of readSafeDirectoryNames(this.#jobRootPath)) {
      if (!/^\d{4}$/u.test(year)) continue;
      const yearPath = captureCanonicalDirectory(path.join(this.#jobRootPath, year), false);
      for (const month of readSafeDirectoryNames(yearPath)) {
        if (!/^\d{2}$/u.test(month)) continue;
        const monthPath = captureCanonicalDirectory(path.join(yearPath, month), false);
        for (const entry of readSafeDirectoryNames(monthPath)) {
          if (!/^job_\d{8}_[a-z0-9]{8,}\.json$/u.test(entry)) continue;
          snapshots.push(this.#jobs.read(path.join(monthPath, entry)));
          if (snapshots.length > MAX_MACHINE_JOB_RECORDS) {
            throw new PigeDomainError("restore.job_store_invalid", "Restore Job storage exceeds its bounded capacity.");
          }
        }
      }
    }
    return snapshots;
  }

  #transitionCheckpoint(
    snapshot: JobRecordSnapshot,
    checkpointId: RestoreCheckpointId,
    state: "running" | "done",
    input: {
      readonly inputRefs?: readonly JobRef[];
      readonly outputRefs?: readonly JobRef[];
      readonly checksumBefore?: `sha256:${string}`;
      readonly checksumAfter?: `sha256:${string}`;
      readonly operationId?: string;
      readonly resumeHint?: string;
    } = {}
  ): JobRecordSnapshot {
    const current = snapshot.job;
    const checkpoints = current.checkpoints ?? [];
    const index = RESTORE_CHECKPOINT_IDS.indexOf(checkpointId);
    const currentCheckpoint = checkpoints[index];
    if (!currentCheckpoint || currentCheckpoint.id !== checkpointId) {
      throw new PigeDomainError("restore.checkpoint_invalid", "Restore checkpoint order is invalid.");
    }
    if (checkpoints.slice(0, index).some((checkpoint) => checkpoint.state !== "done")) {
      throw new PigeDomainError("restore.checkpoint_invalid", "A restore checkpoint was attempted out of order.");
    }
    if (currentCheckpoint.state === "done") return snapshot;
    if (state === "done" && currentCheckpoint.state !== "running") {
      throw new PigeDomainError("restore.checkpoint_invalid", "A restore checkpoint must begin before completion.");
    }
    const now = new Date().toISOString();
    const nextCheckpoint: JobCheckpoint = {
      ...currentCheckpoint,
      state,
      startedAt: currentCheckpoint.startedAt ?? now,
      ...(state === "done" ? { finishedAt: now } : {}),
      inputRefs: [...(input.inputRefs ?? currentCheckpoint.inputRefs)],
      outputRefs: [...(input.outputRefs ?? currentCheckpoint.outputRefs)],
      ...(input.checksumBefore ? { checksumBefore: input.checksumBefore } : {}),
      ...(input.checksumAfter ? { checksumAfter: input.checksumAfter } : {}),
      ...(input.operationId ? { operationId: OperationIdSchema.parse(input.operationId) } : {}),
      ...(input.resumeHint ? { resumeHint: input.resumeHint } : {})
    };
    const nextCheckpoints = checkpoints.map((checkpoint, checkpointIndex) =>
      checkpointIndex === index ? nextCheckpoint : checkpoint
    );
    const completedUnits = nextCheckpoints.filter((checkpoint) => checkpoint.state === "done").length;
    const message = state === "done"
      ? `Restore checkpoint ${checkpointId} completed.`
      : `Restore checkpoint ${checkpointId} is running.`;
    const facts = {
      stage: "restoring" as const,
      checkpoints: nextCheckpoints,
      progress: {
        completedUnits,
        totalUnits: RESTORE_CHECKPOINT_IDS.length,
        unit: "checkpoint"
      },
      message
    };
    const owner = this.#coordinator();
    if (state === "running" && current.state === "queued") {
      return owner.begin(snapshot, { stage: "restoring", message, facts });
    }
    if (state === "done" && checkpointId === "destination_committed") {
      return owner.markDurableBoundary(snapshot, {
        checkpointId: "destination_committed",
        message,
        facts
      });
    }
    return owner.patch(snapshot, facts);
  }

  #coordinator(): JobExecutionCoordinator {
    this.#assertHeld();
    return new JobExecutionCoordinator(this.#jobs);
  }

  #assertHeld(): void {
    if (this.#closed) {
      throw new PigeDomainError("restore.job_store_closed", "Restore Job storage is closed.");
    }
    this.#lease.assertHeld();
  }
}

export function writeBackupCreatedOperation(input: BackupOperationInput): OperationRecord {
  input.assertVaultWriterLease();
  const operation = createBackupCreatedOperation(input);
  const operationPath = operationFilePath(input.vaultPath, operation.id);
  const existing = readOperationIfPresent(operationPath, input.assertVaultWriterLease);
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(operation)) {
      throw new PigeDomainError("backup.operation_conflict", "The Backup Operation conflicts with durable state.");
    }
    return existing;
  }
  writeOperationNoReplace(operationPath, operation, input.assertVaultWriterLease);
  const committed = readOperationIfPresent(operationPath, input.assertVaultWriterLease);
  if (!committed || canonicalJson(committed) !== canonicalJson(operation)) {
    throw new PigeDomainError("backup.operation_conflict", "The Backup Operation failed exact readback.");
  }
  return committed;
}

export function createRestoreJobIdentity(input: RestoreJobIdentityInput): RestoreJobIdentity {
  const createdAt = new Date(input.createdAt).toISOString();
  const dateKey = createdAt.slice(0, 10).replaceAll("-", "");
  const canonical = canonicalJson({
    identityVersion: 1,
    archiveDigest: input.archiveDigest,
    backupId: input.backupId,
    mode: input.mode,
    sourceVaultId: input.sourceVaultId,
    destinationIdentity: input.destinationIdentity,
    previousBindingHash: input.previousBindingHash
  });
  const jobDigest = createHash("sha256")
    .update("pige:restore-job:v1\0", "utf8")
    .update(canonical, "utf8")
    .digest("hex");
  const resultVaultId = input.mode === "replace_existing"
    ? VaultIdSchema.parse(input.sourceVaultId)
    : VaultIdSchema.parse(`vault_${dateKey}_${createHash("sha256")
      .update("pige:restore-clone-vault:v1\0", "utf8")
      .update(canonical, "utf8")
      .digest("hex")}`);
  return {
    jobId: JobIdSchema.parse(`job_${dateKey}_${jobDigest}`),
    resultVaultId
  };
}

export function readRestoreJobBinding(job: JobRecord): RestoreJobBinding {
  const backup = job.inputRefs?.find((ref) => ref.role === "restore_archive");
  const archivePreview = job.inputRefs?.find((ref) => ref.role === "restore_archive_preview");
  const publicPreview = job.inputRefs?.find((ref) => ref.role === "restore_public_preview");
  const destination = job.inputRefs?.find((ref) => ref.role === "restore_destination");
  const modeRef = job.inputRefs?.find((ref) => ref.role === "restore_identity_mode");
  const previousBinding = job.inputRefs?.find((ref) => ref.role === "previous_active_vault");
  const replaceConfirmation = job.inputRefs?.find((ref) => ref.role === "restore_replace_confirmation");
  const mode = modeRef?.id === "restore_mode:clone_as_new"
    ? "clone_as_new"
    : modeRef?.id === "restore_mode:replace_existing"
      ? "replace_existing"
      : undefined;
  if (
    job.class !== "restore" ||
    job.scope !== "machine_local" ||
    !backup?.id ||
    !backup.path ||
    !backup.checksum ||
    (backup.locator !== "manifest" && backup.locator !== "derived_legacy") ||
    !archivePreview?.checksum ||
    !publicPreview?.checksum ||
    !destination?.id ||
    !destination.path ||
    !destination.checksum ||
    !previousBinding?.id ||
    !previousBinding.checksum ||
    !mode
  ) {
    throw new PigeDomainError("restore.job_conflict", "Restore Job durable bindings are incomplete.");
  }
  const identityInput: RestoreJobIdentityInput = {
    createdAt: job.createdAt,
    archiveDigest: backup.checksum as `sha256:${string}`,
    backupId: backup.id,
    mode,
    sourceVaultId: destination.id,
    destinationIdentity: destination.checksum as `sha256:${string}`,
    previousBindingHash: previousBinding.checksum as `sha256:${string}`
  };
  const identity = createRestoreJobIdentity(identityInput);
  const expectedActiveVaultPath = previousBinding.path
    ? path.resolve(previousBinding.path)
    : undefined;
  const expectedActiveVaultId = previousBinding.id !== "no_active_vault"
    ? previousBinding.id
    : undefined;
  if (
    identity.jobId !== job.id ||
    identityInput.previousBindingHash !== createPreviousVaultBindingHash(
      expectedActiveVaultPath,
      expectedActiveVaultId
    ) ||
    (mode === "replace_existing" && (
      expectedActiveVaultId !== destination.id ||
      replaceConfirmation?.checksum !== createReplaceConfirmationHash(identityInput)
    )) ||
    (mode === "clone_as_new" && replaceConfirmation !== undefined)
  ) {
    throw new PigeDomainError("restore.job_conflict", "Restore Job identity does not match its durable bindings.");
  }
  return {
    ...identityInput,
    ...identity,
    backupPath: path.resolve(backup.path),
    destinationPath: path.resolve(destination.path),
    archivePreviewToken: archivePreview.checksum as `sha256:${string}`,
    previewId: publicPreview.checksum as `sha256:${string}`,
    backupIdentitySource: backup.locator,
    replaceConfirmed: mode === "replace_existing",
    ...(expectedActiveVaultPath ? { expectedActiveVaultPath } : {}),
    ...(expectedActiveVaultId ? { expectedActiveVaultId } : {})
  };
}

export function createPreviousVaultBindingHash(
  activeVaultPath?: string,
  activeVaultId?: string
): `sha256:${string}` {
  if ((activeVaultPath === undefined) !== (activeVaultId === undefined)) {
    throw new PigeDomainError("restore.job_conflict", "Previous vault path and identity must be bound together.");
  }
  return `sha256:${createHash("sha256")
    .update("pige:restore-previous-vault-binding:v1\0", "utf8")
    .update(activeVaultPath ? path.resolve(activeVaultPath) : "none", "utf8")
    .update("\0", "utf8")
    .update(activeVaultId ?? "none", "utf8")
    .digest("hex")}`;
}

function createReplaceConfirmationHash(input: RestoreJobIdentityInput): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update("pige:restore-replace-confirmation:v1\0", "utf8")
    .update(canonicalJson({
      archiveDigest: input.archiveDigest,
      backupId: input.backupId,
      sourceVaultId: input.sourceVaultId,
      destinationIdentity: input.destinationIdentity,
      previousBindingHash: input.previousBindingHash
    }), "utf8")
    .digest("hex")}`;
}

function assertRestoreApplyState(job: JobRecord): JobRecord {
  if (
    job.state === "queued" ||
    job.state === "running" ||
    job.state === "completed" ||
    job.state === "completed_with_warnings"
  ) {
    return job;
  }
  throw new PigeDomainError(
    "restore.job_conflict",
    "This Restore Job cannot be resumed from its durable terminal state."
  );
}

function assertRestoreJobBinding(
  job: JobRecord,
  input: CreateRestoreJobInput,
  identity: RestoreJobIdentity
): void {
  const backup = job.inputRefs?.find((ref) => ref.role === "restore_archive");
  const archivePreview = job.inputRefs?.find((ref) => ref.role === "restore_archive_preview");
  const destination = job.inputRefs?.find((ref) => ref.role === "restore_destination");
  const mode = job.inputRefs?.find((ref) => ref.role === "restore_identity_mode");
  const previousBinding = job.inputRefs?.find((ref) => ref.role === "previous_active_vault");
  const replaceConfirmation = job.inputRefs?.find((ref) => ref.role === "restore_replace_confirmation");
  if (
    job.id !== identity.jobId ||
    job.class !== "restore" ||
    job.scope !== "machine_local" ||
    backup?.id !== input.backupId ||
    backup.checksum !== input.archiveDigest ||
    backup.locator !== input.backupIdentitySource ||
    path.resolve(backup.path ?? "") !== path.resolve(input.backupPath) ||
    archivePreview?.checksum !== input.archivePreviewToken ||
    destination?.id !== input.sourceVaultId ||
    destination.checksum !== input.destinationIdentity ||
    path.resolve(destination.path ?? "") !== path.resolve(input.destinationPath) ||
    destination.locator !== input.mode ||
    mode?.id !== `restore_mode:${input.mode}` ||
    previousBinding?.checksum !== input.previousBindingHash ||
    previousBinding?.id !== (input.expectedActiveVaultId ?? "no_active_vault") ||
    (previousBinding?.path ? path.resolve(previousBinding.path) : undefined) !==
      (input.expectedActiveVaultPath ? path.resolve(input.expectedActiveVaultPath) : undefined) ||
    (input.mode === "replace_existing"
      ? replaceConfirmation?.checksum !== createReplaceConfirmationHash(input)
      : replaceConfirmation !== undefined)
  ) {
    throw new PigeDomainError("restore.job_conflict", "An existing Restore Job has different durable bindings.");
  }
}

function createRestoreAppliedOperation(input: RestoreOperationInput): OperationRecord {
  const dateKey = /^job_(\d{8})_/u.exec(input.snapshot.job.id)?.[1];
  if (!dateKey) throw new PigeDomainError("restore.operation_conflict", "Restore Operation date is invalid.");
  const operationId = OperationIdSchema.parse(`op_${dateKey}_${createHash("sha256")
    .update("pige:restore-applied-operation:v1\0", "utf8")
    .update(canonicalJson({
      jobId: input.snapshot.job.id,
      backupId: input.backupId,
      archiveDigest: input.archiveDigest,
      sourceVaultId: input.sourceVaultId,
      resultVaultId: input.resultVaultId,
      mode: input.mode,
      destinationIdentity: input.destinationIdentity
    }), "utf8")
    .digest("hex")}`);
  return OperationRecordSchema.parse({
    id: operationId,
    schemaVersion: 1,
    jobId: input.snapshot.job.id,
    createdAt: input.snapshot.job.createdAt,
    actor: {
      kind: "system",
      runtimeKind: "desktop_local",
      clientCapabilityTier: "desktop_full"
    },
    kind: "restore_applied",
    targetRefs: [
      { kind: "vault", id: input.resultVaultId },
      { kind: "root_binding", id: `restore_destination:${input.destinationIdentity}` }
    ],
    sourceRefs: [
      { kind: "job", id: input.snapshot.job.id },
      { kind: "backup", id: input.backupId, checksum: input.archiveDigest },
      { kind: "vault", id: input.sourceVaultId }
    ],
    summary: input.mode === "replace_existing"
      ? "A validated backup restored the existing logical vault through a fresh-folder binding swap."
      : "A validated backup restored an independent cloned vault with new vault identity.",
    reversible: "best_effort",
    rollbackHint: input.mode === "replace_existing"
      ? "Use the verified rollback backup to restore the prior machine binding."
      : "Unregister and trash the cloned vault through Pige after reviewing its contents.",
    warnings: [...(input.warningCodes ?? [])]
  });
}

function createBackupCreatedOperation(input: BackupOperationInput): OperationRecord {
  const dateKey = /^job_(\d{8})_/u.exec(input.job.id)?.[1];
  if (!dateKey) throw new PigeDomainError("backup.operation_conflict", "Backup Operation date is invalid.");
  const operationId = OperationIdSchema.parse(`op_${dateKey}_${createHash("sha256")
    .update("pige:backup-created-operation:v1\0", "utf8")
    .update(canonicalJson({
      jobId: input.job.id,
      vaultId: input.vaultId,
      backupId: input.backupId,
      archiveDigest: input.archiveDigest
    }), "utf8")
    .digest("hex")}`);
  return OperationRecordSchema.parse({
    id: operationId,
    schemaVersion: 1,
    jobId: input.job.id,
    createdAt: input.job.createdAt,
    actor: input.job.actor ?? {
      kind: "system",
      runtimeKind: "desktop_local",
      clientCapabilityTier: "desktop_full"
    },
    kind: "backup_created",
    targetRefs: [{ kind: "backup", id: input.backupId, checksum: input.archiveDigest }],
    sourceRefs: [
      { kind: "job", id: input.job.id },
      { kind: "vault", id: input.vaultId }
    ],
    summary: "A validated backup archive was created for the active vault.",
    reversible: "best_effort",
    rollbackHint: "Remove the backup archive through the operating system when it is no longer needed.",
    warnings: []
  });
}

function operationFilePath(vaultPathInput: string, operationId: string): string {
  const vaultPath = captureCanonicalDirectory(vaultPathInput, false);
  const dateKey = /^op_(\d{4})(\d{2})\d{2}_/u.exec(operationId);
  if (!dateKey) throw new PigeDomainError("restore.operation_conflict", "Restore Operation identity is invalid.");
  const operationRoot = captureCanonicalDirectory(path.join(vaultPath, ".pige", "operations"), false);
  const yearPath = ensurePrivateChildDirectory(operationRoot, dateKey[1]!);
  const monthPath = ensurePrivateChildDirectory(yearPath, dateKey[2]!);
  return path.join(monthPath, `${operationId}.json`);
}

function writeOperationNoReplace(
  filePath: string,
  operation: OperationRecord,
  assertVaultWriterLease: () => void
): void {
  const body = Buffer.from(`${JSON.stringify(operation, null, 2)}\n`, "utf8");
  if (body.byteLength > MAX_OPERATION_BYTES) {
    throw new PigeDomainError("restore.operation_conflict", "Restore Operation exceeds its bound.");
  }
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  let temporaryCreated = false;
  try {
    assertVaultWriterLease();
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0),
      0o600
    );
    temporaryCreated = true;
    fs.writeFileSync(descriptor, body);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    assertVaultWriterLease();
    try {
      fs.linkSync(temporaryPath, filePath);
    } catch (caught) {
      if (isErrno(caught, "EEXIST")) {
        throw new PigeDomainError("restore.operation_conflict", "Restore Operation already exists with another revision.");
      }
      throw caught;
    }
    fs.unlinkSync(temporaryPath);
    temporaryCreated = false;
    flushDirectory(path.dirname(filePath));
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (temporaryCreated) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch (caught) {
        if (!isErrno(caught, "ENOENT")) throw caught;
      }
    }
  }
}

function readOperationIfPresent(
  filePath: string,
  assertVaultWriterLease: () => void
): OperationRecord | undefined {
  assertVaultWriterLease();
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_OPERATION_BYTES) {
      throw new PigeDomainError("restore.operation_conflict", "Restore Operation is unsafe or oversized.");
    }
    const operation = OperationRecordSchema.parse(JSON.parse(fs.readFileSync(descriptor, "utf8")));
    if (path.basename(filePath) !== `${operation.id}.json`) {
      throw new PigeDomainError("restore.operation_conflict", "Restore Operation identity does not match its path.");
    }
    return operation;
  } catch (caught) {
    if (isErrno(caught, "ENOENT")) return undefined;
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("restore.operation_conflict", "Restore Operation could not be read safely.");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function ensurePrivateChildDirectory(parentPathInput: string, childName: string): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(childName) || childName === "." || childName === "..") {
    throw new PigeDomainError("restore.path_unsafe", "Restore runtime directory identity is invalid.");
  }
  const parentPath = captureCanonicalDirectory(parentPathInput, false);
  const childPath = path.join(parentPath, childName);
  try {
    fs.mkdirSync(childPath, { mode: 0o700 });
    flushDirectory(parentPath);
  } catch (caught) {
    if (!isErrno(caught, "EEXIST")) {
      throw new PigeDomainError("restore.path_unsafe", "Restore runtime directory could not be created safely.");
    }
  }
  const canonical = captureCanonicalDirectory(childPath, false);
  if (path.dirname(canonical) !== parentPath) {
    throw new PigeDomainError("restore.path_unsafe", "Restore runtime directory escaped its owner.");
  }
  fs.chmodSync(canonical, 0o700);
  return canonical;
}

function captureCanonicalDirectory(directoryPathInput: string, create: boolean): string {
  const resolvedPath = path.resolve(directoryPathInput);
  if (create) fs.mkdirSync(resolvedPath, { recursive: true, mode: 0o700 });
  let stat: fs.Stats;
  let canonicalStat: fs.Stats;
  let canonical: string;
  try {
    stat = fs.lstatSync(resolvedPath);
    canonical = fs.realpathSync.native(resolvedPath);
    canonicalStat = fs.lstatSync(canonical);
  } catch {
    throw new PigeDomainError("restore.path_unsafe", "Restore runtime directory is unavailable.");
  }
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    !canonicalStat.isDirectory() ||
    canonicalStat.isSymbolicLink() ||
    stat.dev !== canonicalStat.dev ||
    stat.ino !== canonicalStat.ino
  ) {
    throw new PigeDomainError("restore.path_unsafe", "Restore runtime directory is unsafe.");
  }
  return canonical;
}

function readSafeDirectoryNames(directoryPath: string): readonly string[] {
  const canonical = captureCanonicalDirectory(directoryPath, false);
  return fs.readdirSync(canonical, { withFileTypes: true }).map((entry) => {
    if (entry.isSymbolicLink()) {
      throw new PigeDomainError("restore.path_unsafe", "Restore Job storage contains a symbolic link.");
    }
    return entry.name;
  });
}

function flushDirectory(directoryPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (caught) {
    if (!isErrno(caught, "EINVAL") && !isErrno(caught, "ENOTSUP") && !isErrno(caught, "EBADF")) {
      throw caught;
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function dedupeJobRefs(refs: readonly JobRef[]): readonly JobRef[] {
  const byIdentity = new Map<string, JobRef>();
  for (const ref of refs) byIdentity.set(canonicalJson(ref), ref);
  return [...byIdentity.values()];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isErrno(caught: unknown, code: string): boolean {
  return Boolean(caught && typeof caught === "object" && "code" in caught && caught.code === code);
}
