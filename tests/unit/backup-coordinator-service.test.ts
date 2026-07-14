import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { JobRecordSchema, OperationRecordSchema, type JobRecord, type OperationRecord } from "@pige/schemas";
import { afterEach, describe, expect, it } from "vitest";
import {
  BACKUP_CHECKPOINT_IDS,
  BackupCoordinatorService,
  createDeterministicBackupOperationId,
  type BackupCheckpointId,
  type BackupCreatedOperationInput,
  type BackupServicePort,
  type BackupVaultPort
} from "../../apps/desktop/src/main/services/backup-coordinator-service";
import type {
  BackupCreateCheckpointEvent,
  BackupCreateOptions
} from "../../apps/desktop/src/main/services/backup-service";
import {
  BackupRestoreService,
  prepareBackupDestinationPath
} from "../../apps/desktop/src/main/services/backup-service";
import { JobRecordStore } from "../../apps/desktop/src/main/services/job-record-store";
import { writeBackupCreatedOperation } from "../../apps/desktop/src/main/services/restore-job-store";
import {
  createVaultOnDisk,
  loadVaultSummary
} from "../../apps/desktop/src/main/services/vault-layout";

const FIXED_NOW = "2026-07-14T08:09:10.000Z";
const APP_VERSION = "0.1.0-test";
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("BackupCoordinatorService", () => {
  it("composes the real archive core, durable Job, and exact backup_created Operation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-backup-composed-"));
    tempRoots.push(root);
    createVaultOnDisk({
      parentDirectory: root,
      vaultName: "Composed Backup Vault",
      appDataPath: path.join(root, "app-data"),
      tempPath: path.join(root, "temp"),
      now: new Date(FIXED_NOW)
    });
    const vaultPath = path.join(root, "Composed Backup Vault");
    const vault = loadVaultSummary(vaultPath);
    fs.writeFileSync(path.join(vaultPath, "wiki", "composed.md"), "# Composed\n", "utf8");
    const vaultPort = new TestVaultPort(vaultPath, vault.vaultId);
    const service = new BackupRestoreService();
    const coordinator = new BackupCoordinatorService({
      vault: vaultPort,
      backupService: service,
      appVersion: APP_VERSION,
      writeBackupCreatedOperation: (input) => writeBackupCreatedOperation({
        job: input.job,
        vaultPath: input.vaultPath,
        vaultId: input.vaultId,
        backupId: input.backupId,
        archiveDigest: input.archiveDigest,
        assertVaultWriterLease: input.assertVaultWriterLease
      }),
      now: () => new Date(FIXED_NOW),
      randomId: () => "composedbackup01"
    });
    const destination = path.join(root, "exports", "composed.zip");

    const job = await coordinator.create(destination);
    const archivePath = job.outputRefs?.find((ref) => ref.role === "backup_archive")?.path;
    const inspected = await service.inspectRestoreArchive(archivePath!);

    expect(job).toMatchObject({
      class: "backup",
      state: "completed",
      operationIds: [expect.stringMatching(/^op_/u)]
    });
    expect(inspected).toMatchObject({
      backupId: backupIdentity(job),
      sourceVaultId: vault.vaultId,
      invalidFileCount: 0
    });
    const operationId = job.operationIds![0]!;
    const operationPath = path.join(
      vaultPath,
      ".pige",
      "operations",
      FIXED_NOW.slice(0, 4),
      FIXED_NOW.slice(5, 7),
      `${operationId}.json`
    );
    expect(OperationRecordSchema.parse(JSON.parse(fs.readFileSync(operationPath, "utf8")))).toMatchObject({
      id: operationId,
      jobId: job.id,
      kind: "backup_created",
      targetRefs: [expect.objectContaining({ id: backupIdentity(job), checksum: inspected.archiveDigest })]
    });
  });

  it("recovers a real staged archive after source drift without recompressing or duplicating the Operation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-backup-real-recovery-"));
    tempRoots.push(root);
    createVaultOnDisk({
      parentDirectory: root,
      vaultName: "Recovered Backup Vault",
      appDataPath: path.join(root, "app-data"),
      tempPath: path.join(root, "temp"),
      now: new Date(FIXED_NOW)
    });
    const vaultPath = path.join(root, "Recovered Backup Vault");
    const vault = loadVaultSummary(vaultPath);
    const sourcePath = path.join(vaultPath, "wiki", "recovered.md");
    fs.writeFileSync(sourcePath, "# Before interruption\n", "utf8");
    const destination = path.join(root, "exports", "recovered.zip");
    const vaultPort = new TestVaultPort(vaultPath, vault.vaultId);
    const archiveCore = new BackupRestoreService();
    let interruptAfterStage = true;
    const interruptingCore: BackupServicePort = {
      inspectRestoreArchive: (backupPath) => archiveCore.inspectRestoreArchive(backupPath),
      createBackup: (sourceVaultPath, destinationPath, appVersion, options) =>
        archiveCore.createBackup(sourceVaultPath, destinationPath, appVersion, {
          ...options,
          onPhase: async (event) => {
            await options.onPhase?.(event);
            if (interruptAfterStage && event.phase === "archive_staged") {
              interruptAfterStage = false;
              throw new Error("Injected process interruption after durable staging.");
            }
          }
        })
    };
    const writeOperation = (input: BackupCreatedOperationInput) => writeBackupCreatedOperation({
      job: input.job,
      vaultPath: input.vaultPath,
      vaultId: input.vaultId,
      backupId: input.backupId,
      archiveDigest: input.archiveDigest,
      assertVaultWriterLease: input.assertVaultWriterLease
    });
    const coordinatorOptions = {
      vault: vaultPort,
      backupService: interruptingCore,
      appVersion: APP_VERSION,
      writeBackupCreatedOperation: writeOperation,
      now: () => new Date(FIXED_NOW),
      randomId: () => "realrecovery01"
    };

    const interrupted = await new BackupCoordinatorService(coordinatorOptions).create(destination);
    expect(interrupted.state).toBe("failed_retryable");
    const stagedPath = findStagingPath(destination);
    const stagedDigest = sha256File(stagedPath!);
    fs.writeFileSync(sourcePath, "# After interruption\n", "utf8");

    const restarted = new BackupCoordinatorService(coordinatorOptions);
    expect(await restarted.recoverInterrupted()).toEqual({ recovered: 1, failed: 0 });
    const completed = readJob(vaultPath, interrupted.id);
    const archivePath = completed.outputRefs?.find((ref) => ref.role === "backup_archive")?.path;

    expect(completed.state).toBe("completed");
    expect(archivePath).toBe(normalizeDestination(destination));
    expect(sha256File(archivePath!)).toBe(stagedDigest);
    expect(completed.operationIds).toHaveLength(1);
    expect(listOperationFiles(vaultPath)).toHaveLength(1);
    const inspected = await archiveCore.inspectRestoreArchive(archivePath!);
    expect(inspected.invalidFileCount).toBe(0);
  });

  it("adopts a validated stage when the process stopped before the archive-staged checkpoint commit", async () => {
    const fixture = makeRealCoordinatorFixture("precheckpointstage01");
    let interruptBeforeCheckpoint = true;
    const interruptingCore: BackupServicePort = {
      inspectRestoreArchive: (backupPath) => fixture.core.inspectRestoreArchive(backupPath),
      createBackup: (vaultPath, destinationPath, appVersion, options) => fixture.core.createBackup(
        vaultPath,
        destinationPath,
        appVersion,
        {
          ...options,
          onPhase: async (event) => {
            if (interruptBeforeCheckpoint && event.phase === "archive_staged") {
              interruptBeforeCheckpoint = false;
              throw new Error("Injected stop before durable archive-staged checkpoint.");
            }
            await options.onPhase?.(event);
          }
        }
      )
    };
    const options = { ...fixture.options, backupService: interruptingCore };

    const interrupted = await new BackupCoordinatorService(options).create(fixture.destination);
    const stagedPath = findStagingPath(fixture.destination);
    const stagedDigest = sha256File(stagedPath!);
    expect(interrupted.state).toBe("failed_retryable");
    expect(interrupted.checkpoints?.find(({ id }) => id === "archive_staged")?.state).toBe("not_started");

    expect(await new BackupCoordinatorService(options).recoverInterrupted()).toEqual({ recovered: 1, failed: 0 });
    const completed = readJob(fixture.vaultPath, interrupted.id);
    const finalPath = completed.outputRefs?.find((ref) => ref.role === "backup_archive")?.path;
    expect(completed.state).toBe("completed");
    expect(sha256File(finalPath!)).toBe(stagedDigest);
    expect(listOperationFiles(fixture.vaultPath)).toHaveLength(1);
  });

  it("terminalizes corrupt pre-checkpoint staging and cleans exact staging on inactive cancellation", async () => {
    const corrupted = makeRealCoordinatorFixture("corruptstage01");
    const corruptCore = interruptBeforeArchiveStagedCheckpoint(corrupted.core);
    const corruptOptions = { ...corrupted.options, backupService: corruptCore.port };
    const interrupted = await new BackupCoordinatorService(corruptOptions).create(corrupted.destination);
    const stagedPath = findStagingPath(corrupted.destination)!;
    fs.truncateSync(stagedPath, Math.max(1, Math.floor(fs.statSync(stagedPath).size / 2)));

    expect(await new BackupCoordinatorService(corruptOptions).recoverInterrupted())
      .toEqual({ recovered: 1, failed: 0 });
    expect(readJob(corrupted.vaultPath, interrupted.id)).toMatchObject({
      state: "failed_final",
      error: { code: "backup.staging_conflict", retryable: false }
    });
    expect(await new BackupCoordinatorService(corruptOptions).recoverInterrupted())
      .toEqual({ recovered: 0, failed: 0 });

    const cancelled = makeRealCoordinatorFixture("cancelstage01");
    const cancelCore = interruptBeforeArchiveStagedCheckpoint(cancelled.core);
    const cancelOptions = { ...cancelled.options, backupService: cancelCore.port };
    const failed = await new BackupCoordinatorService(cancelOptions).create(cancelled.destination);
    const cancelStage = findStagingPath(cancelled.destination)!;
    expect(fs.existsSync(cancelStage)).toBe(true);

    const terminal = await new BackupCoordinatorService(cancelOptions).cancel(failed.id);
    expect(terminal?.state).toBe("cancelled");
    expect(fs.existsSync(cancelStage)).toBe(false);
    expect(fs.existsSync(normalizeDestination(cancelled.destination))).toBe(false);
  });

  it("fails closed when the destination ancestor changes after Job binding but before core execution", async () => {
    const fixture = makeRealCoordinatorFixture("ancestorchange01");
    const destinationParent = path.dirname(normalizeDestination(fixture.destination));
    fs.mkdirSync(destinationParent, { recursive: true });
    const displacedParent = `${destinationParent}-displaced`;
    let swapped = false;
    const swappingCore: BackupServicePort = {
      inspectRestoreArchive: (backupPath) => fixture.core.inspectRestoreArchive(backupPath),
      createBackup: (vaultPath, destinationPath, appVersion, options) => {
        if (!swapped) {
          swapped = true;
          fs.renameSync(destinationParent, displacedParent);
          fs.mkdirSync(destinationParent);
        }
        return fixture.core.createBackup(vaultPath, destinationPath, appVersion, options);
      }
    };

    const job = await new BackupCoordinatorService({ ...fixture.options, backupService: swappingCore })
      .create(fixture.destination);

    expect(job).toMatchObject({
      state: "failed_final",
      error: { code: "backup.destination_changed", retryable: false }
    });
    expect(fs.readdirSync(destinationParent)).toEqual([]);
    expect(listOperationFiles(fixture.vaultPath)).toEqual([]);
  });

  it("terminalizes a corrupted checkpoint-bound final archive instead of retrying it on every startup", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-backup-corrupt-recovery-"));
    tempRoots.push(root);
    createVaultOnDisk({
      parentDirectory: root,
      vaultName: "Corrupt Backup Vault",
      appDataPath: path.join(root, "app-data"),
      tempPath: path.join(root, "temp"),
      now: new Date(FIXED_NOW)
    });
    const vaultPath = path.join(root, "Corrupt Backup Vault");
    const vault = loadVaultSummary(vaultPath);
    fs.writeFileSync(path.join(vaultPath, "wiki", "corrupt.md"), "# Corrupt recovery\n", "utf8");
    const destination = path.join(root, "exports", "corrupt.zip");
    const archiveCore = new BackupRestoreService();
    let interruptAfterStage = true;
    const interruptingCore: BackupServicePort = {
      inspectRestoreArchive: (backupPath) => archiveCore.inspectRestoreArchive(backupPath),
      createBackup: (sourceVaultPath, destinationPath, appVersion, options) =>
        archiveCore.createBackup(sourceVaultPath, destinationPath, appVersion, {
          ...options,
          onPhase: async (event) => {
            await options.onPhase?.(event);
            if (interruptAfterStage && event.phase === "archive_staged") {
              interruptAfterStage = false;
              throw new Error("Injected process interruption after durable staging.");
            }
          }
        })
    };
    const coordinatorOptions = {
      vault: new TestVaultPort(vaultPath, vault.vaultId),
      backupService: interruptingCore,
      appVersion: APP_VERSION,
      writeBackupCreatedOperation: (input: BackupCreatedOperationInput) => writeBackupCreatedOperation({
        job: input.job,
        vaultPath: input.vaultPath,
        vaultId: input.vaultId,
        backupId: input.backupId,
        archiveDigest: input.archiveDigest,
        assertVaultWriterLease: input.assertVaultWriterLease
      }),
      now: () => new Date(FIXED_NOW),
      randomId: () => "corruptrecovery01"
    };

    const interrupted = await new BackupCoordinatorService(coordinatorOptions).create(destination);
    const stagedPath = findStagingPath(destination);
    const finalPath = normalizeDestination(destination);
    fs.linkSync(stagedPath, finalPath);
    fs.rmSync(stagedPath);
    const bytes = fs.readFileSync(finalPath);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    fs.writeFileSync(finalPath, bytes);

    expect(await new BackupCoordinatorService(coordinatorOptions).recoverInterrupted())
      .toEqual({ recovered: 1, failed: 0 });
    const terminalized = readJob(vaultPath, interrupted.id);

    expect(terminalized.state).toBe("failed_final");
    expect(terminalized.error?.code).toBe("backup.result_conflict");
    expect(listOperationFiles(vaultPath)).toEqual([]);
    expect(await new BackupCoordinatorService(coordinatorOptions).recoverInterrupted())
      .toEqual({ recovered: 0, failed: 0 });
  });

  it("persists the exact five core phases with one identity and one linked Operation", async () => {
    const fixture = makeFixture();
    const destination = path.join(fixture.root, "exports", "daily.zip");

    const job = await fixture.coordinator.create(destination);

    expect(job.state).toBe("completed");
    expect(job.checkpoints?.map(({ id, state }) => ({ id, state }))).toEqual(
      BACKUP_CHECKPOINT_IDS.map((id) => ({ id, state: "done" }))
    );
    expect(fixture.core.events).toEqual([...BACKUP_CHECKPOINT_IDS]);
    expect(fixture.core.identities).toHaveLength(1);
    expect(fixture.core.identities[0]).toMatchObject({
      jobId: job.id,
      backupId: backupIdentity(job),
      createdAt: FIXED_NOW,
      excludeJobId: job.id,
      stagingOwnerKey: job.id
    });
    expect(fixture.operations.records.size).toBe(1);
    expect(job.operationIds).toEqual([...fixture.operations.records.keys()]);
    expect(job.privacy).toEqual({
      usedCloudModel: false,
      usedNetwork: false,
      usedShell: false,
      accessedExternalFiles: true,
      permissionDecisionIds: []
    });
    expect(job.cancellation?.durableWritesApplied).toBe(true);
    expect(JSON.stringify(job)).not.toContain("source body");
  });

  it("adopts staged output after restart without creating a second archive", async () => {
    const fixture = makeFixture();
    fixture.core.failOnceAfter = "archive_staged";
    const destination = path.join(fixture.root, "exports", "staged");
    const failed = await fixture.coordinator.create(destination);

    expect(failed.state).toBe("failed_retryable");
    expect(fixture.core.archiveWrites).toBe(1);
    expect(fixture.core.staged.size).toBe(1);

    const restarted = fixture.newCoordinator();
    expect(await restarted.recoverInterrupted()).toEqual({ recovered: 1, failed: 0 });
    const completed = readJob(fixture.vault, failed.id);

    expect(completed.state).toBe("completed");
    expect(completed.id).toBe(failed.id);
    expect(backupIdentity(completed)).toBe(backupIdentity(failed));
    expect(fixture.core.archiveWrites).toBe(1);
    expect(fixture.core.createCalls).toBe(2);
    expect(fixture.operations.records.size).toBe(1);
  });

  it("adopts an exact finalized archive on restart without invoking compression again", async () => {
    const fixture = makeFixture();
    fixture.core.failOnceAfter = "archive_staged";
    const destination = path.join(fixture.root, "exports", "final-adopt");
    const failed = await fixture.coordinator.create(destination);
    const identity = fixture.core.identities[0]!;
    fixture.core.publishFinal(normalizeDestination(destination), fixture.vaultId, identity);
    const callsBeforeRecovery = fixture.core.createCalls;

    expect(await fixture.newCoordinator().recoverInterrupted()).toEqual({ recovered: 1, failed: 0 });
    const completed = readJob(fixture.vault, failed.id);

    expect(completed.state).toBe("completed");
    expect(fixture.core.createCalls).toBe(callsBeforeRecovery);
    expect(fixture.core.archiveWrites).toBe(2);
    expect(fixture.operations.records.size).toBe(1);
  });

  it("rejects a matching-looking final archive without a durable archive checkpoint", async () => {
    const fixture = makeFixture();
    fixture.core.failOnceAfter = "preflight";
    const destination = path.join(fixture.root, "exports", "uncheckpointed-final");
    const failed = await fixture.coordinator.create(destination);
    const identity = fixture.core.identities[0]!;
    fixture.core.publishFinal(normalizeDestination(destination), fixture.vaultId, identity);

    expect(await fixture.newCoordinator().recoverInterrupted()).toEqual({ recovered: 1, failed: 0 });
    const terminalized = readJob(fixture.vault, failed.id);

    expect(terminalized.state).toBe("failed_final");
    expect(terminalized.error?.code).toBe("backup.result_conflict");
    expect(fixture.operations.records.size).toBe(0);
  });

  it("preserves destination-claim and cancellation CAS winners", async () => {
    const fixture = makeFixture();
    const pause = fixture.core.pauseAfter("preflight");
    const destination = path.join(fixture.root, "exports", "contended");
    const first = fixture.coordinator.create(destination);
    await pause.reached;

    const competing = fixture.newCoordinator();
    await expect(competing.create(destination)).rejects.toMatchObject({ code: "job.claim_conflict" });

    const firstJobId = fixture.core.identities[0]!.jobId;
    const cancelled = await competing.cancel(firstJobId);
    expect(cancelled?.state).toBe("cancel_requested");
    pause.release();
    const final = await first;

    expect(final.state).toBe("cancelled");
    expect(final.cancellation?.durableWritesApplied).toBe(false);
    expect(fixture.core.archives.size).toBe(0);
    const queuedCompetitor = listJobs(fixture.vault).find((job) => job.id !== final.id);
    expect(queuedCompetitor?.state).toBe("queued");
  });

  it("uses one destination claim for canonical and symlink-alias paths", async () => {
    const fixture = makeFixture();
    const exportsPath = path.join(fixture.root, "exports");
    const aliasPath = path.join(fixture.root, "exports-alias");
    fs.mkdirSync(exportsPath);
    fs.symlinkSync(exportsPath, aliasPath, "dir");
    const pause = fixture.core.pauseAfter("preflight");
    const first = fixture.coordinator.create(path.join(exportsPath, "aliased.zip"));
    await pause.reached;

    await expect(fixture.newCoordinator().create(path.join(aliasPath, "aliased.zip")))
      .rejects.toMatchObject({ code: "job.claim_conflict" });

    pause.release();
    await expect(first).resolves.toMatchObject({ state: "completed" });
  });

  it("cancels before finalization but adopts output once finalization is durable", async () => {
    const beforeFixture = makeFixture();
    const beforePause = beforeFixture.core.pauseAfter("archive_staged");
    const beforePromise = beforeFixture.coordinator.create(path.join(beforeFixture.root, "before-final"));
    await beforePause.reached;
    const beforeJobId = beforeFixture.core.identities[0]!.jobId;
    expect((await beforeFixture.coordinator.cancel(beforeJobId))?.state).toBe("cancel_requested");
    const before = await beforePromise;

    expect(before.state).toBe("cancelled");
    expect(before.cancellation?.durableWritesApplied).toBe(false);
    expect(beforeFixture.operations.records.size).toBe(0);

    const afterFixture = makeFixture();
    const afterPause = afterFixture.core.pauseAfter("archive_finalized");
    const afterPromise = afterFixture.coordinator.create(path.join(afterFixture.root, "after-final"));
    await afterPause.reached;
    const afterJobId = afterFixture.core.identities[0]!.jobId;
    expect((await afterFixture.coordinator.cancel(afterJobId))?.state).toBe("running");
    afterPause.release();
    const after = await afterPromise;

    expect(after.state).toBe("completed");
    expect(after.cancellation?.durableWritesApplied).toBe(true);
    expect(afterFixture.operations.records.size).toBe(1);
  });

  it("retries with the same Job and Backup identities and no duplicate Operation", async () => {
    const fixture = makeFixture();
    fixture.core.failOnceAfter = "files_hashed";
    const failed = await fixture.coordinator.create(path.join(fixture.root, "retry"));
    const originalBackupId = backupIdentity(failed);

    const completed = await fixture.coordinator.retry(failed.id);

    expect(completed?.status).toBe("requeued");
    expect(completed?.job.state).toBe("completed");
    expect(completed?.job.id).toBe(failed.id);
    expect(backupIdentity(completed!.job)).toBe(originalBackupId);
    expect(completed?.job.retry?.retryCount).toBe(1);
    expect(new Set(fixture.core.identities.map(({ jobId }) => jobId))).toEqual(new Set([failed.id]));
    expect(new Set(fixture.core.identities.map(({ backupId }) => backupId))).toEqual(new Set([originalBackupId]));
    expect(fixture.core.archiveWrites).toBe(1);
    expect(fixture.operations.records.size).toBe(1);
    await expect(fixture.coordinator.retry(failed.id)).resolves.toMatchObject({
      status: "not_allowed",
      job: { id: failed.id, state: "completed" }
    });
  });

  it("fails closed when a destination is occupied by conflicting backup identity", async () => {
    const fixture = makeFixture();
    fixture.core.failOnceAfter = "preflight";
    const destination = path.join(fixture.root, "exports", "conflict");
    const failed = await fixture.coordinator.create(destination);
    const identity = fixture.core.identities[0]!;
    fixture.core.publishFinal(normalizeDestination(destination), fixture.vaultId, {
      ...identity,
      backupId: "backup_20260714_conflictingidentity"
    });

    const result = await fixture.coordinator.retry(failed.id);

    expect(result?.status).toBe("not_allowed");
    expect(result?.job.state).toBe("failed_final");
    expect(result?.job.error?.code).toBe("backup.result_conflict");
    expect(fixture.operations.records.size).toBe(0);
  });
});

function makeRealCoordinatorFixture(suffix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-backup-review-"));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Review Backup Vault",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date(FIXED_NOW)
  });
  const vaultPath = path.join(root, "Review Backup Vault");
  const vault = loadVaultSummary(vaultPath);
  fs.writeFileSync(path.join(vaultPath, "wiki", "review.md"), "# Review\n", "utf8");
  const core = new BackupRestoreService();
  const options = {
    vault: new TestVaultPort(vaultPath, vault.vaultId),
    backupService: core as BackupServicePort,
    appVersion: APP_VERSION,
    writeBackupCreatedOperation: (input: BackupCreatedOperationInput) => writeBackupCreatedOperation({
      job: input.job,
      vaultPath: input.vaultPath,
      vaultId: input.vaultId,
      backupId: input.backupId,
      archiveDigest: input.archiveDigest,
      assertVaultWriterLease: input.assertVaultWriterLease
    }),
    now: () => new Date(FIXED_NOW),
    randomId: () => suffix
  };
  return {
    root,
    vaultPath,
    core,
    options,
    destination: path.join(root, "exports", `${suffix}.zip`)
  };
}

function interruptBeforeArchiveStagedCheckpoint(core: BackupRestoreService): {
  readonly port: BackupServicePort;
} {
  let interrupt = true;
  return {
    port: {
      inspectRestoreArchive: (backupPath) => core.inspectRestoreArchive(backupPath),
      createBackup: (vaultPath, destinationPath, appVersion, options) => core.createBackup(
        vaultPath,
        destinationPath,
        appVersion,
        {
          ...options,
          onPhase: async (event) => {
            if (interrupt && event.phase === "archive_staged") {
              interrupt = false;
              throw new Error("Injected stop before durable archive-staged checkpoint.");
            }
            await options.onPhase?.(event);
          }
        }
      )
    }
  };
}

interface Fixture {
  readonly root: string;
  readonly vault: string;
  readonly vaultId: string;
  readonly core: FakeBackupCore;
  readonly operations: OperationWriterFixture;
  readonly coordinator: BackupCoordinatorService;
  newCoordinator(): BackupCoordinatorService;
}

function makeFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-backup-coordinator-"));
  tempRoots.push(root);
  const vault = path.join(root, "vault");
  fs.mkdirSync(path.join(vault, ".pige", "jobs"), { recursive: true });
  const vaultId = "vault_20260714_backup01";
  const vaultPort = new TestVaultPort(vault, vaultId);
  const core = new FakeBackupCore();
  const operations = createOperationWriter();
  let identityCounter = 0;
  const newCoordinator = () => new BackupCoordinatorService({
    vault: vaultPort,
    backupService: core,
    appVersion: APP_VERSION,
    writeBackupCreatedOperation: operations.write,
    now: () => new Date(FIXED_NOW),
    randomId: () => `identity${String(++identityCounter).padStart(12, "0")}`
  });
  const coordinator = newCoordinator();
  return { root, vault, vaultId, core, operations, coordinator, newCoordinator };
}

class TestVaultPort implements BackupVaultPort {
  constructor(readonly vaultPath: string, readonly vaultId: string) {}

  current(): { readonly vaultId: string } {
    return { vaultId: this.vaultId };
  }

  activeVaultPath(): string {
    return this.vaultPath;
  }

  assertWriterLease(vaultPath: string): void {
    if (path.resolve(vaultPath) !== this.vaultPath) {
      throw new PigeDomainError("vault.binding_changed", "The active vault binding changed.");
    }
  }
}

interface CoreIdentity {
  readonly jobId: string;
  readonly backupId: string;
  readonly createdAt: string;
  readonly excludeJobId: string;
  readonly stagingOwnerKey: string;
}

interface StoredArchive {
  readonly identity: CoreIdentity;
  readonly vaultId: string;
  readonly digest: `sha256:${string}`;
}

class FakeBackupCore implements BackupServicePort {
  readonly events: BackupCheckpointId[] = [];
  readonly identities: CoreIdentity[] = [];
  readonly archives = new Map<string, StoredArchive>();
  readonly staged = new Map<string, StoredArchive>();
  createCalls = 0;
  archiveWrites = 0;
  failOnceAfter: BackupCheckpointId | undefined;
  #pause: { phase: BackupCheckpointId; gate: Gate } | undefined;

  pauseAfter(phase: BackupCheckpointId): Gate {
    const gate = createGate();
    this.#pause = { phase, gate };
    return gate;
  }

  async createBackup(
    vaultPath: string,
    destinationPath: string,
    appVersion: string,
    options: BackupCreateOptions
  ) {
    this.createCalls += 1;
    expect(appVersion).toBe(APP_VERSION);
    const identity: CoreIdentity = {
      jobId: options.excludeJobId!,
      backupId: options.backupId!,
      createdAt: options.createdAt!,
      excludeJobId: options.excludeJobId!,
      stagingOwnerKey: options.stagingOwnerKey!
    };
    this.identities.push(identity);
    const vaultId = "vault_20260714_backup01";
    const digest = digestFor(identity.backupId);
    const staged = this.staged.get(destinationPath);
    if (staged) {
      this.archives.set(destinationPath, staged);
      this.staged.delete(destinationPath);
      await options.onPhase!(eventFor("archive_finalized", identity, digest));
      this.events.push("archive_finalized");
      return { status: "created" as const, backupPath: destinationPath, manifest: summary(identity, vaultId) };
    }

    for (const phase of BACKUP_CHECKPOINT_IDS) {
      throwIfAborted(options.signal!);
      if (phase === "archive_staged") {
        const archive = { identity, vaultId, digest };
        this.staged.set(destinationPath, archive);
        this.archiveWrites += 1;
      }
      if (phase === "archive_finalized") {
        const archive = this.staged.get(destinationPath)!;
        this.archives.set(destinationPath, archive);
        this.staged.delete(destinationPath);
      }
      await options.onPhase!(eventFor(phase, identity, digest));
      this.events.push(phase);
      if (this.#pause?.phase === phase) {
        const pause = this.#pause;
        this.#pause = undefined;
        pause.gate.markReached();
        await waitForReleaseOrAbort(pause.gate.released, options.signal!);
      }
      if (this.failOnceAfter === phase) {
        this.failOnceAfter = undefined;
        throw new Error("Injected backup-core interruption.");
      }
    }
    return { status: "created" as const, backupPath: destinationPath, manifest: summary(identity, vaultId) };
  }

  async inspectRestoreArchive(backupPath: string) {
    const archive = this.archives.get(path.resolve(backupPath));
    if (!archive) throw Object.assign(new Error("Archive not found."), { code: "ENOENT" });
    return {
      backupPath: path.resolve(backupPath),
      archivePreviewToken: archive.digest,
      archiveDigest: archive.digest,
      archiveSize: 1024,
      backupId: archive.identity.backupId,
      backupIdSource: "manifest" as const,
      sourceVaultId: archive.vaultId,
      sourceVaultSchemaVersion: 1,
      manifest: summary(archive.identity, archive.vaultId),
      invalidFileCount: 0,
      warnings: []
    };
  }

  publishFinal(destinationPath: string, vaultId: string, identity: CoreIdentity): void {
    this.archives.set(destinationPath, { identity, vaultId, digest: digestFor(identity.backupId) });
    this.archiveWrites += 1;
  }
}

interface Gate {
  readonly reached: Promise<void>;
  readonly released: Promise<void>;
  markReached(): void;
  release(): void;
}

function createGate(): Gate {
  let markReached!: () => void;
  let release!: () => void;
  return {
    reached: new Promise<void>((resolve) => { markReached = resolve; }),
    released: new Promise<void>((resolve) => { release = resolve; }),
    markReached,
    release
  };
}

function waitForReleaseOrAbort(released: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    released.then(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, reject);
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function abortError(): Error {
  const error = new Error("Aborted.");
  error.name = "AbortError";
  return error;
}

function eventFor(
  phase: BackupCheckpointId,
  identity: CoreIdentity,
  digest: `sha256:${string}`
): BackupCreateCheckpointEvent {
  return {
    phase,
    backupId: identity.backupId,
    createdAt: identity.createdAt,
    stagingOwnerKey: identity.stagingOwnerKey,
    ...(phase === "manifest_written" || phase === "files_hashed"
      ? { manifestChecksum: digest }
      : {}),
    ...(phase === "archive_staged" || phase === "archive_finalized"
      ? { archiveDigest: digest }
      : {})
  };
}

function summary(identity: CoreIdentity, vaultId: string) {
  return {
    formatVersion: 1 as const,
    format: "pige-backup" as const,
    appVersion: APP_VERSION,
    vaultId,
    vaultName: "Backup coordinator fixture",
    vaultSchemaVersion: 1,
    createdAt: identity.createdAt,
    fileCount: 4,
    totalBytes: 1024,
    noteCount: 1,
    sourceCount: 1,
    conversationCount: 1,
    memoryCount: 1,
    includesSecrets: false as const,
    includes: {
      markdownKnowledge: true,
      sourceRecords: true,
      managedSourceCopies: true,
      conversations: true,
      vaultMemory: true,
      trash: true,
      rebuildableDatabaseCache: false,
      secrets: false as const
    }
  };
}

interface OperationWriterFixture {
  readonly records: Map<string, OperationRecord>;
  readonly write: (input: BackupCreatedOperationInput) => OperationRecord;
}

function createOperationWriter(): OperationWriterFixture {
  const records = new Map<string, OperationRecord>();
  return {
    records,
    write(input) {
      input.assertVaultWriterLease();
      const id = createDeterministicBackupOperationId(input.job.id);
      const operation = OperationRecordSchema.parse({
        id,
        schemaVersion: 1,
        jobId: input.job.id,
        createdAt: input.job.createdAt,
        actor: input.job.actor,
        permissionDecisionIds: [],
        kind: "backup_created",
        targetRefs: [{ kind: "backup", id: input.backupId, checksum: input.archiveDigest }],
        sourceRefs: [
          { kind: "job", id: input.job.id },
          { kind: "vault", id: input.vaultId }
        ],
        summary: "A validated backup archive was created for the active vault.",
        reversible: "best_effort",
        rollbackHint: "Remove the archive after review when it is no longer needed.",
        warnings: []
      });
      const existing = records.get(id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(operation)) {
        throw new PigeDomainError("backup.operation_conflict", "Operation identity conflict.");
      }
      records.set(id, existing ?? operation);
      return records.get(id)!;
    }
  };
}

function readJob(vaultPath: string, jobId: string): JobRecord {
  const match = /^job_(\d{4})(\d{2})\d{2}_/u.exec(jobId)!;
  const store = new JobRecordStore({
    rootPath: path.join(vaultPath, ".pige", "jobs"),
    unsafeAllowUnfenced: true
  });
  return store.read(path.join(vaultPath, ".pige", "jobs", match[1]!, match[2]!, `${jobId}.json`)).job;
}

function listJobs(vaultPath: string): JobRecord[] {
  const result: JobRecord[] = [];
  const root = path.join(vaultPath, ".pige", "jobs");
  for (const year of fs.readdirSync(root)) {
    if (!/^\d{4}$/u.test(year)) continue;
    for (const month of fs.readdirSync(path.join(root, year))) {
      if (!/^\d{2}$/u.test(month)) continue;
      for (const file of fs.readdirSync(path.join(root, year, month))) {
        if (!file.endsWith(".json")) continue;
        result.push(JobRecordSchema.parse(JSON.parse(fs.readFileSync(path.join(root, year, month, file), "utf8"))));
      }
    }
  }
  return result;
}

function backupIdentity(job: JobRecord): string {
  return job.inputRefs?.find((ref) => ref.role === "backup_identity")?.id ?? "";
}

function normalizeDestination(destinationPath: string): string {
  return prepareBackupDestinationPath(destinationPath);
}

function findStagingPath(destinationPath: string): string {
  const normalized = normalizeDestination(destinationPath);
  const staged = fs.readdirSync(path.dirname(normalized))
    .map((entry) => path.join(path.dirname(normalized), entry))
    .find((entry) => path.basename(entry).startsWith(`.${path.basename(normalized)}.`));
  if (!staged) throw new Error("Expected a deterministic Backup staging archive.");
  return staged;
}

function sha256File(filePath: string): string {
  return `sha256:${createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function listOperationFiles(vaultPath: string): string[] {
  const root = path.join(vaultPath, ".pige", "operations");
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const visit = (directoryPath: string): void => {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(entryPath);
    }
  };
  visit(root);
  return files.sort();
}

function digestFor(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
