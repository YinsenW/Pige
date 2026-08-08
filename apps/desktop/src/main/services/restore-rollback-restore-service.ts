import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { BackupIdSchema, JobRecordSchema, type JobRecord } from "@pige/schemas";
import type { BackupRestoreService, RestoreCorePreviewResult } from "./backup-service";
import { readRestoreJobBinding } from "./restore-job-store";
import type { VaultService } from "./vault-service";

export interface RestoreRollbackCandidate {
  readonly activeVaultId: string;
  readonly restoreJobId: string;
  readonly expectedRestoreJobUpdatedAt: string;
}

export type RestoreRollbackPreparation =
  | { readonly status: "prepared"; readonly preview: RestoreCorePreviewResult }
  | { readonly status: "stale" | "not_found" | "failed" };

const MAX_MACHINE_JOB_RECORDS = 512;

/**
 * Read-only authority for the one private rollback archive created before a
 * completed replacement restore. Applying it remains owned by RestoreCoordinator.
 */
export class RestoreRollbackRestoreService {
  readonly #userDataPath: string;
  readonly #backup: Pick<BackupRestoreService, "inspectRestoreArchive">;
  readonly #vaults: VaultService;

  constructor(options: {
    readonly userDataPath: string;
    readonly backupService: BackupRestoreService;
    readonly vaultService: VaultService;
  }) {
    this.#userDataPath = canonicalDirectory(options.userDataPath);
    this.#backup = options.backupService;
    this.#vaults = options.vaultService;
  }

  candidate(activeVaultId: string): RestoreRollbackCandidate | undefined {
    if (this.#vaults.current()?.vaultId !== activeVaultId) return undefined;
    const job = this.#latestCompletedReplacement(activeVaultId);
    return job ? {
      activeVaultId,
      restoreJobId: job.id,
      expectedRestoreJobUpdatedAt: job.updatedAt
    } : undefined;
  }

  async prepare(candidate: RestoreRollbackCandidate): Promise<RestoreRollbackPreparation> {
    const current = this.candidate(candidate.activeVaultId);
    if (!current) return { status: "not_found" };
    if (
      current.restoreJobId !== candidate.restoreJobId ||
      current.expectedRestoreJobUpdatedAt !== candidate.expectedRestoreJobUpdatedAt
    ) return { status: "stale" };
    const job = this.#findRestoreJob(candidate.restoreJobId);
    if (!job || !isEligibleReplacement(job, candidate.activeVaultId)) return { status: "not_found" };

    let inspected: RestoreCorePreviewResult;
    try {
      const archivePath = this.#rollbackArchivePath(job.id);
      const before = safeRegularFile(archivePath);
      inspected = await this.#backup.inspectRestoreArchive(archivePath);
      const after = safeRegularFile(archivePath);
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) return { status: "failed" };
    } catch {
      return { status: "failed" };
    }
    const expected = rollbackBackupIdentity({ id: createRollbackBackupJobId(job.id), createdAt: job.createdAt });
    if (
      inspected.sourceVaultId !== candidate.activeVaultId ||
      inspected.backupId !== expected.backupId ||
      inspected.manifest.createdAt !== expected.createdAt
    ) return { status: "failed" };
    const after = this.candidate(candidate.activeVaultId);
    if (!after || after.restoreJobId !== candidate.restoreJobId || after.expectedRestoreJobUpdatedAt !== candidate.expectedRestoreJobUpdatedAt) {
      return { status: "stale" };
    }
    return { status: "prepared", preview: inspected };
  }

  #latestCompletedReplacement(activeVaultId: string): JobRecord | undefined {
    return this.#listRestoreJobs()
      .filter((job) => isEligibleReplacement(job, activeVaultId))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))[0];
  }

  #findRestoreJob(jobId: string): JobRecord | undefined {
    return this.#listRestoreJobs().find((job) => job.id === jobId);
  }

  #listRestoreJobs(): readonly JobRecord[] {
    const root = path.join(this.#userDataPath, "restore-coordinator", ".pige", "jobs");
    if (!fs.existsSync(root)) return [];
    const jobs: JobRecord[] = [];
    for (const year of safeDirectoryNames(root, /^\d{4}$/u)) {
      for (const month of safeDirectoryNames(path.join(root, year), /^\d{2}$/u)) {
        const monthPath = safeChildDirectory(path.join(root, year), month);
        for (const entry of safeDirectoryNames(monthPath, /^job_\d{8}_[a-z0-9]{8,}\.json$/u)) {
          const recordPath = safeRegularFile(path.join(monthPath, entry)).path;
          const bytes = fs.readFileSync(recordPath, "utf8");
          if (Buffer.byteLength(bytes, "utf8") > 256 * 1024) {
            throw new PigeDomainError("restore.job_store_invalid", "Restore Job record exceeds its bounded capacity.");
          }
          jobs.push(JobRecordSchema.parse(JSON.parse(bytes)));
          if (jobs.length > MAX_MACHINE_JOB_RECORDS) {
            throw new PigeDomainError("restore.job_store_invalid", "Restore Job storage exceeds its bounded capacity.");
          }
        }
      }
    }
    return jobs;
  }

  #rollbackArchivePath(restoreJobId: string): string {
    const root = safeChildDirectory(path.join(this.#userDataPath, "restore-coordinator"), "rollback");
    return path.join(root, `${restoreJobId}.pige-backup.zip`);
  }
}

function isEligibleReplacement(job: JobRecord, activeVaultId: string): boolean {
  if (
    job.class !== "restore" ||
    (job.state !== "completed" && job.state !== "completed_with_warnings") ||
    job.activeVaultId !== activeVaultId ||
    !job.outputRefs?.some((ref) => ref.role === "restore_applied") ||
    !job.childJobIds?.includes(createRollbackBackupJobId(job.id))
  ) return false;
  try {
    const binding = readRestoreJobBinding(job);
    return binding.mode === "replace_existing" && binding.resultVaultId === activeVaultId;
  } catch {
    return false;
  }
}

function createRollbackBackupJobId(restoreJobId: string): string {
  const dateKey = /^job_(\d{8})_/u.exec(restoreJobId)?.[1];
  if (!dateKey) throw new PigeDomainError("backup.job_conflict", "Rollback backup parent identity is invalid.");
  return `job_${dateKey}_${createHash("sha256")
    .update("pige:restore-rollback-backup-job:v1\0", "utf8")
    .update(restoreJobId, "utf8")
    .digest("hex")}`;
}

function rollbackBackupIdentity(job: Pick<JobRecord, "id" | "createdAt">): { readonly backupId: string; readonly createdAt: string } {
  const dateKey = job.createdAt.slice(0, 10).replaceAll("-", "");
  return {
    backupId: BackupIdSchema.parse(`backup_${dateKey}_${createHash("sha256")
      .update("pige:restore-rollback-backup:v1\0", "utf8")
      .update(job.id, "utf8")
      .digest("hex")}`),
    createdAt: job.createdAt
  };
}

function canonicalDirectory(input: string): string {
  const resolved = path.resolve(input);
  const stat = fs.lstatSync(resolved);
  const canonical = fs.realpathSync.native(resolved);
  const canonicalStat = fs.lstatSync(canonical);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !canonicalStat.isDirectory() || canonicalStat.isSymbolicLink()) {
    throw new PigeDomainError("restore.path_unsafe", "Restore runtime directory is unsafe.");
  }
  return canonical;
}

function safeChildDirectory(parent: string, childName: string): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(childName)) throw new PigeDomainError("restore.path_unsafe", "Restore storage child is invalid.");
  const canonicalParent = canonicalDirectory(parent);
  const child = canonicalDirectory(path.join(canonicalParent, childName));
  if (path.dirname(child) !== canonicalParent) throw new PigeDomainError("restore.path_unsafe", "Restore storage escaped its owner.");
  return child;
}

function safeDirectoryNames(directory: string, matcher: RegExp): readonly string[] {
  const canonical = canonicalDirectory(directory);
  return fs.readdirSync(canonical, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) throw new PigeDomainError("restore.path_unsafe", "Restore storage contains a symbolic link.");
    return matcher.test(entry.name) ? [entry.name] : [];
  });
}

function safeRegularFile(filePath: string): { readonly path: string; readonly dev: number; readonly ino: number; readonly size: number } {
  const parent = canonicalDirectory(path.dirname(filePath));
  const expected = path.join(parent, path.basename(filePath));
  const stat = fs.lstatSync(expected);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new PigeDomainError("restore.path_unsafe", "Restore rollback archive is unsafe.");
  return { path: expected, dev: stat.dev, ino: stat.ino, size: stat.size };
}
