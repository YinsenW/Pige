import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  JobIdSchema,
  JobRecordSchema,
  OperationIdSchema,
  OperationRecordSchema,
  VaultMigrationApplyResultSchema,
  VaultMigrationCheckpointSchema,
  VaultMigrationPreviewSchema,
  type JobRecord,
  type OperationRecord,
  type VaultMigrationApplyRequest,
  type VaultMigrationApplyResult,
  type VaultMigrationCheckpoint,
  type VaultMigrationPreview
} from "@pige/schemas";
import type { VaultSummary } from "@pige/contracts";
import { BackupRestoreService } from "./backup-service";
import { flushDirectoryWhereSupported } from "./durable-directory-sync";
import { JobRecordStore, type JobRecordSnapshot } from "./job-record-store";
import {
  inspectVaultCompatibility,
  loadVaultSummary,
  resetRebuildableVaultStorage
} from "./vault-layout";
import {
  commitVaultMigrationDurableDomains,
  commitVaultMigrationManifest,
  ensureVaultMigrationPrivateDirectory,
  inspectVaultMigrationCounts,
  stageVaultMigration,
  validateVaultMigrationStage
} from "./vault-migration-storage";

const CHECKPOINTS = VaultMigrationCheckpointSchema.options;
const MAX_OPERATION_BYTES = 256 * 1024;

export interface VaultMigrationWriterLease {
  readonly vaultPath: string;
  assertHeld(): void;
}

export interface VaultMigrationCompletion {
  readonly jobId: string;
  readonly operationId: string;
  readonly vault: VaultSummary;
}

export class VaultMigrationService {
  readonly #userDataPath: string;
  readonly #backup: BackupRestoreService;
  readonly #previewPaths = new Map<string, string>();

  constructor(userDataPath: string, backup = new BackupRestoreService({ userDataPath })) {
    this.#userDataPath = path.resolve(userDataPath);
    this.#backup = backup;
  }

  inspect(vaultPathInput: string): VaultMigrationPreview | undefined {
    const vaultPath = path.resolve(vaultPathInput);
    const inspection = inspectVaultCompatibility(vaultPath);
    if (inspection.status !== "needs_migration") return undefined;
    const counts = inspectVaultMigrationCounts(vaultPath);
    const previewId = migrationPreviewId(inspection.manifest.vault_id, inspection.snapshotId, counts);
    const preview = VaultMigrationPreviewSchema.parse({
      apiVersion: 1,
      previewId,
      vaultId: inspection.manifest.vault_id,
      fromVersion: 1,
      toVersion: 2,
      migrationClass: "transform",
      requiresBackup: true,
      languagePolicy: "preserve_or_unknown",
      affectedDomains: [
        { domain: "vault_manifest", count: counts.vault_manifest },
        { domain: "source_records", count: counts.source_records },
        { domain: "markdown_pages", count: counts.markdown_pages },
        { domain: "ocr_artifacts", count: counts.ocr_artifacts },
        { domain: "conversation_events", count: counts.conversation_events },
        { domain: "memory", count: counts.memory },
        { domain: "rebuildable_chunks", count: counts.rebuildable_chunks }
      ],
      warnings: [
        "pre_migration_backup_required",
        "unknown_language_preserved",
        "rebuildable_indexes_after_commit"
      ]
    });
    this.#previewPaths.set(preview.previewId, vaultPath);
    return preview;
  }

  resolvePreviewPath(request: VaultMigrationApplyRequest): string | undefined {
    const candidate = this.#previewPaths.get(request.previewId);
    if (!candidate) return undefined;
    const inspection = inspectVaultCompatibility(candidate);
    if (inspection.status === "needs_migration" && inspection.manifest.vault_id === request.vaultId) return candidate;
    if (inspection.status === "current" && inspection.manifest.vault_id === request.vaultId) return candidate;
    return undefined;
  }

  async apply(
    request: VaultMigrationApplyRequest,
    lease: VaultMigrationWriterLease
  ): Promise<VaultMigrationCompletion | VaultMigrationApplyResult> {
    const vaultPath = path.resolve(lease.vaultPath);
    const current = inspectVaultCompatibility(vaultPath);
    if (current.status !== "needs_migration") {
      return VaultMigrationApplyResultSchema.parse({ ...request, status: "stale", current: current.status });
    }
    const preview = this.inspect(vaultPath);
    if (!preview || preview.previewId !== request.previewId || preview.vaultId !== request.vaultId) {
      return VaultMigrationApplyResultSchema.parse({ ...request, status: "stale", current: "needs_migration" });
    }
    lease.assertHeld();
    const createdAt = current.manifest.updated_at;
    const jobId = migrationJobId(createdAt, preview);
    const operationId = migrationOperationId(createdAt, preview);
    const jobs = new JobRecordStore({
      rootPath: path.join(vaultPath, ".pige/jobs"),
      assertWriterLease: () => lease.assertHeld()
    });
    let job = createOrReadJob(jobs, vaultPath, jobId, createdAt, preview);
    try {
      job = markRunning(jobs, job);
      job = completeCheckpoint(jobs, job, "compatibility_revalidated");

      const backupPath = migrationBackupPath(this.#userDataPath, preview);
      const backupId = `backup_${createdAt.slice(0, 10).replaceAll("-", "")}_${digest(`backup\0${preview.previewId}`).slice(0, 32)}`;
      await this.#backup.createBackup(vaultPath, backupPath, undefined, {
        backupId,
        createdAt,
        stagingOwnerKey: jobId,
        excludeJobId: jobId
      });
      job = completeCheckpoint(jobs, job, "pre_backup_completed");

      const stage = stageVaultMigration(vaultPath, current.manifest, new Date().toISOString());
      job = completeCheckpoint(jobs, job, "durable_domains_staged");
      validateVaultMigrationStage(stage);
      job = completeCheckpoint(jobs, job, "staged_validation_completed");
      commitVaultMigrationDurableDomains(vaultPath, stage, () => lease.assertHeld());
      job = completeCheckpoint(jobs, job, "durable_domains_committed");
      commitVaultMigrationManifest(vaultPath, stage, () => lease.assertHeld());
      job = completeCheckpoint(jobs, job, "manifest_committed");

      const operation = writeMigrationOperation(vaultPath, job.job, operationId, preview, () => lease.assertHeld());
      job = completeCheckpoint(jobs, job, "operation_recorded", operation.id);
      resetRebuildableVaultStorage(vaultPath);
      job = completeCheckpoint(jobs, job, "indexes_rebuilt");
      finishJob(jobs, job, operation.id);
      return { jobId, operationId, vault: loadVaultSummary(vaultPath) };
    } catch (caught) {
      markFailed(jobs, job, caught);
      return VaultMigrationApplyResultSchema.parse({
        ...request,
        status: "failed",
        jobId,
        repair: inspectVaultCompatibility(vaultPath).status === "current"
          ? "restore_pre_migration_backup"
          : "retry"
      });
    }
  }

  recoverCommitted(vaultPathInput: string, lease: VaultMigrationWriterLease): number {
    const vaultPath = path.resolve(vaultPathInput);
    const inspection = inspectVaultCompatibility(vaultPath);
    if (inspection.status !== "current") return 0;
    const root = path.join(vaultPath, ".pige/jobs");
    if (!fs.existsSync(root)) return 0;
    const store = new JobRecordStore({ rootPath: root, assertWriterLease: () => lease.assertHeld() });
    let recovered = 0;
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^job_\d{8}_[a-z0-9]{8,}\.json$/u.test(entry.name)) continue;
      let job = store.read(path.join(root, entry.name));
      if (job.job.class !== "migration" || job.job.activeVaultId !== inspection.manifest.vault_id ||
        ["completed", "completed_with_warnings", "failed_final", "cancelled", "compacted"].includes(job.job.state)) continue;
      const previewId = job.job.inputRefs?.find((ref) => ref.role === "migration_preview")?.id;
      if (!previewId || !/^vaultmigration_[a-z0-9]{32,96}$/u.test(previewId)) continue;
      job = markRunning(store, job);
      for (const checkpoint of CHECKPOINTS.slice(0, 6)) job = completeCheckpoint(store, job, checkpoint);
      const operationId = migrationOperationIdFor(job.job.createdAt, previewId);
      const operation = writeMigrationOperation(
        vaultPath,
        job.job,
        operationId,
        { vaultId: inspection.manifest.vault_id, previewId },
        () => lease.assertHeld()
      );
      job = completeCheckpoint(store, job, "operation_recorded", operation.id);
      resetRebuildableVaultStorage(vaultPath);
      job = completeCheckpoint(store, job, "indexes_rebuilt");
      finishJob(store, job, operation.id);
      recovered += 1;
    }
    return recovered;
  }
}

function createOrReadJob(
  jobs: JobRecordStore,
  vaultPath: string,
  jobId: string,
  createdAt: string,
  preview: VaultMigrationPreview
): JobRecordSnapshot {
  const filePath = path.join(vaultPath, ".pige/jobs", `${jobId}.json`);
  const job = JobRecordSchema.parse({
    schemaVersion: 1,
    id: jobId,
    class: "migration",
    state: "queued",
    stage: "repairing",
    priority: "interactive",
    scope: "vault",
    createdAt,
    updatedAt: createdAt,
    activeVaultId: preview.vaultId,
    actor: { kind: "migration", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    inputRefs: [
      { kind: "external_uri", id: preview.vaultId, checksum: `sha256:${digest(preview.previewId)}`, role: "migration_source" },
      { kind: "tool", id: preview.previewId, role: "migration_preview" }
    ],
    outputRefs: [],
    operationIds: [],
    checkpoints: CHECKPOINTS.map((id) => ({ id, step: id, state: "not_started", inputRefs: [], outputRefs: [] })),
    progress: { completedUnits: 0, totalUnits: CHECKPOINTS.length, unit: "checkpoint" },
    privacy: { usedCloudModel: false, usedNetwork: false, usedShell: false, accessedExternalFiles: true },
    message: "Vault migration is queued after explicit user approval."
  });
  try { return jobs.createIfAbsent(filePath, job); }
  catch (caught) {
    if (!(caught instanceof PigeDomainError) || caught.code !== "job.revision_conflict") throw caught;
    const existing = jobs.read(filePath);
    if (existing.job.class !== "migration" || existing.job.activeVaultId !== preview.vaultId) throw migrationConflict();
    return existing;
  }
}

function markRunning(jobs: JobRecordStore, snapshot: JobRecordSnapshot): JobRecordSnapshot {
  if (snapshot.job.state === "running") return snapshot;
  if (snapshot.job.state !== "queued" && snapshot.job.state !== "failed_retryable") throw migrationConflict();
  const now = new Date().toISOString();
  return jobs.compareAndSwap(snapshot, JobRecordSchema.parse({
    ...snapshot.job,
    state: "running",
    updatedAt: now,
    startedAt: snapshot.job.startedAt ?? now,
    finishedAt: undefined,
    error: undefined,
    message: "Vault migration is running."
  }));
}

function completeCheckpoint(
  jobs: JobRecordStore,
  snapshot: JobRecordSnapshot,
  checkpointId: VaultMigrationCheckpoint,
  operationId?: string
): JobRecordSnapshot {
  const index = CHECKPOINTS.indexOf(checkpointId);
  const checkpoints = snapshot.job.checkpoints ?? [];
  if (checkpoints[index]?.state === "done") return snapshot;
  if (checkpoints.slice(0, index).some((checkpoint) => checkpoint.state !== "done")) throw migrationConflict();
  const now = new Date().toISOString();
  const next = checkpoints.map((checkpoint, checkpointIndex) => checkpointIndex === index ? {
    ...checkpoint,
    state: "done" as const,
    startedAt: checkpoint.startedAt ?? now,
    finishedAt: now,
    ...(operationId ? { outputRefs: [{ kind: "operation" as const, id: operationId, role: "migration_applied" }] } : {})
  } : checkpoint);
  return jobs.compareAndSwap(snapshot, JobRecordSchema.parse({
    ...snapshot.job,
    updatedAt: now,
    checkpoints: next,
    progress: { completedUnits: next.filter((checkpoint) => checkpoint.state === "done").length, totalUnits: CHECKPOINTS.length, unit: "checkpoint" },
    message: `Vault migration checkpoint ${checkpointId} completed.`
  }));
}

function finishJob(jobs: JobRecordStore, snapshot: JobRecordSnapshot, operationId: string): JobRecordSnapshot {
  if ((snapshot.job.checkpoints ?? []).some((checkpoint) => checkpoint.state !== "done")) throw migrationConflict();
  const now = new Date().toISOString();
  return jobs.compareAndSwap(snapshot, JobRecordSchema.parse({
    ...snapshot.job,
    state: "completed",
    updatedAt: now,
    finishedAt: now,
    operationIds: [operationId],
    outputRefs: [{ kind: "operation", id: operationId, role: "migration_applied" }],
    message: "Vault migration completed and rebuildable indexes were reset."
  }));
}

function markFailed(jobs: JobRecordStore, snapshot: JobRecordSnapshot, caught: unknown): void {
  try {
    if (snapshot.job.state !== "running") return;
    const now = new Date().toISOString();
    jobs.compareAndSwap(snapshot, JobRecordSchema.parse({
      ...snapshot.job,
      state: "failed_retryable",
      updatedAt: now,
      finishedAt: now,
      retry: { retryCount: 0, maxAutomaticRetries: 0, requiresUserAction: true, lastRetryReason: "vault.migration_failed" },
      error: {
        code: caught instanceof PigeDomainError ? caught.code : "vault.migration_failed",
        domain: "vault",
        messageKey: "errors.vault.migration_failed",
        retryable: true,
        severity: "error",
        userAction: "retry"
      },
      message: "Vault migration stopped at a fail-closed checkpoint."
    }));
  } catch { /* preserve the original migration failure */ }
}

function writeMigrationOperation(
  vaultPath: string,
  job: JobRecord,
  operationId: string,
  preview: { readonly vaultId: string; readonly previewId: string },
  assertWriterLease: () => void
): OperationRecord {
  const operation = OperationRecordSchema.parse({
    id: operationId,
    schemaVersion: 1,
    jobId: job.id,
    createdAt: job.createdAt,
    actor: job.actor,
    kind: "migration_applied",
    targetRefs: [{ kind: "vault", id: preview.vaultId, checksum: `sha256:${digest(preview.previewId)}` }],
    sourceRefs: [{ kind: "job", id: job.id }],
    summary: "Vault durable domains were migrated from schema v1 to v2 after a pre-migration backup.",
    reversible: "best_effort",
    rollbackHint: "Restore the pre-migration backup if migration validation later fails.",
    warnings: []
  });
  const date = /^op_(\d{4})(\d{2})/u.exec(operation.id);
  if (!date) throw migrationConflict();
  const directory = ensureVaultMigrationPrivateDirectory(
    vaultPath,
    `.pige/operations/${date[1]!}/${date[2]!}`
  );
  const filePath = path.join(directory, `${operation.id}.json`);
  const bytes = Buffer.from(`${JSON.stringify(operation, null, 2)}\n`, "utf8");
  if (bytes.byteLength > MAX_OPERATION_BYTES) throw migrationConflict();
  if (fs.existsSync(filePath)) {
    const existing = OperationRecordSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
    if (JSON.stringify(existing) !== JSON.stringify(operation)) throw migrationConflict();
    return existing;
  }
  const temporary = path.join(directory, `.${operation.id}.${randomUUID()}.tmp`);
  assertWriterLease();
  fs.writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
  const descriptor = fs.openSync(temporary, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  assertWriterLease();
  fs.linkSync(temporary, filePath);
  fs.rmSync(temporary, { force: true });
  flushDirectoryWhereSupported(directory);
  return operation;
}

function migrationPreviewId(vaultId: string, snapshotId: string, counts: object): string {
  return `vaultmigration_${digest(JSON.stringify({ vaultId, snapshotId, counts })).slice(0, 64)}`;
}

function migrationJobId(createdAt: string, preview: VaultMigrationPreview): string {
  const date = createdAt.slice(0, 10).replaceAll("-", "");
  return JobIdSchema.parse(`job_${date}_${digest(`migration-job\0${preview.previewId}`).slice(0, 48)}`);
}

function migrationOperationId(createdAt: string, preview: VaultMigrationPreview): string {
  return migrationOperationIdFor(createdAt, preview.previewId);
}

function migrationOperationIdFor(createdAt: string, previewId: string): string {
  const date = createdAt.slice(0, 10).replaceAll("-", "");
  return OperationIdSchema.parse(`op_${date}_${digest(`migration-operation\0${previewId}`).slice(0, 48)}`);
}

function migrationBackupPath(userDataPath: string, preview: VaultMigrationPreview): string {
  const root = path.join(userDataPath, "migration-backups", preview.vaultId);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  return path.join(root, `${preview.previewId}.pige-backup.zip`);
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function migrationConflict(): PigeDomainError {
  return new PigeDomainError("vault.migration_conflict", "Vault migration durable identity changed.");
}
