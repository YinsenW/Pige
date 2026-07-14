import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  getPath: vi.fn(),
  openPath: vi.fn(),
  showOpenDialog: vi.fn()
}));

vi.mock("electron", () => ({
  app: { getPath: electronMocks.getPath },
  dialog: { showOpenDialog: electronMocks.showOpenDialog },
  shell: { openPath: electronMocks.openPath }
}));

import {
  BackupRestoreService,
  createRestoreDestinationIdentity,
  type RestoreCoreCheckpointPhase,
  type RestoreCorePreviewResult
} from "../../apps/desktop/src/main/services/backup-service";
import { LocalSettingsStore } from "../../apps/desktop/src/main/services/local-settings";
import { RestoreCoordinatorService } from "../../apps/desktop/src/main/services/restore-coordinator-service";
import { RestoreJobStore, createPreviousVaultBindingHash } from "../../apps/desktop/src/main/services/restore-job-store";
import { RestorePreviewRegistry, type ApplyingRestorePreview } from "../../apps/desktop/src/main/services/restore-preview-registry";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import { VaultService } from "../../apps/desktop/src/main/services/vault-service";

const roots: string[] = [];
const vaultServices: VaultService[] = [];
const coordinators: RestoreCoordinatorService[] = [];

afterEach(() => {
  for (const coordinator of coordinators.splice(0).reverse()) coordinator.close();
  for (const service of vaultServices.splice(0).reverse()) service.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("RestoreCoordinatorService", () => {
  it("clones once, switches the machine binding, writes one Operation, and adopts an exact retry", async () => {
    const fixture = await makeFixture("clone_as_new");
    const rebuild = vi.fn(async () => rebuildResult());
    const pause = vi.fn(async () => {
      fixture.pauseCount += 1;
      return () => { fixture.resumeCount += 1; };
    });
    let coordinator = trackCoordinator(new RestoreCoordinatorService({
      ...coordinatorOptions(fixture),
      pauseMutableWork: pause,
      rebuildIndexes: rebuild
    }));

    const first = await coordinator.apply({
      preview: fixture.applying,
      destinationPath: fixture.destinationPath,
      replaceConfirmed: false
    });

    expect(first).toEqual({ status: "restored", jobId: expect.stringMatching(/^job_/u) });
    expect(fixture.vaults.activeVaultPath()).toBe(fixture.destinationPath);
    expect(fixture.vaults.current()?.vaultId).not.toBe(fixture.preview.sourceVaultId);
    expect(fs.existsSync(fixture.sourceVaultPath)).toBe(true);
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(fixture.pauseCount).toBe(1);
    expect(fixture.resumeCount).toBe(1);
    const restoreOperations = readRecords(path.join(fixture.destinationPath, ".pige", "operations"));
    expect(restoreOperations)
      .toEqual([expect.objectContaining({ kind: "restore_applied", jobId: first.jobId })]);
    expect(JSON.stringify(restoreOperations)).not.toContain(fixture.root);

    coordinator.close();
    coordinators.splice(coordinators.indexOf(coordinator), 1);
    coordinator = trackCoordinator(new RestoreCoordinatorService({
      ...coordinatorOptions(fixture),
      pauseMutableWork: pause,
      rebuildIndexes: rebuild
    }));
    const repeated = await coordinator.apply({
      preview: fixture.applying,
      destinationPath: fixture.destinationPath,
      replaceConfirmed: false
    });

    expect(repeated.jobId).toBe(first.jobId);
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(readRecords(path.join(fixture.destinationPath, ".pige", "operations")))
      .toHaveLength(1);
    expect(readMachineRestoreJob(fixture.userDataPath, first.jobId!)).toMatchObject({
      state: "completed",
      operationIds: [expect.stringMatching(/^op_/u)]
    });
  });

  it("creates and validates a true rollback Backup Job before replacing the active binding", async () => {
    const fixture = await makeFixture("replace_existing");
    const postArchiveNote = path.join(fixture.sourceVaultPath, "wiki", "current-state.md");
    fs.writeFileSync(postArchiveNote, "# Current state\n\nRollback-only content.\n", "utf8");
    const machineFiles = [
      path.join(fixture.userDataPath, "model-providers.json"),
      path.join(fixture.userDataPath, "secret-store.json"),
      path.join(fixture.userDataPath, "permission-decisions.json")
    ];
    for (const [index, filePath] of machineFiles.entries()) {
      fs.writeFileSync(filePath, `machine-only-${index}\n`, { encoding: "utf8", mode: 0o600 });
    }
    const machineBytes = machineFiles.map((filePath) => fs.readFileSync(filePath));
    const coordinator = trackCoordinator(new RestoreCoordinatorService({
      ...coordinatorOptions(fixture),
      pauseMutableWork: async () => () => undefined,
      rebuildIndexes: async () => rebuildResult()
    }));

    const result = await coordinator.apply({
      preview: fixture.applying,
      destinationPath: fixture.destinationPath,
      replaceConfirmed: true
    });

    expect(result).toEqual({ status: "restored", jobId: expect.stringMatching(/^job_/u) });
    expect(fixture.vaults.current()?.vaultId).toBe(fixture.preview.sourceVaultId);
    expect(fixture.vaults.activeVaultPath()).toBe(fixture.destinationPath);
    expect(fs.existsSync(fixture.sourceVaultPath)).toBe(true);
    expect(fs.readFileSync(postArchiveNote, "utf8")).toContain("Rollback-only content");
    expect(fixture.settings.read().recentVaults.filter(({ vaultId }) =>
      vaultId === fixture.preview.sourceVaultId
    )).toEqual([expect.objectContaining({ path: fixture.destinationPath })]);

    const rollbackArchive = path.join(
      fixture.userDataPath,
      "restore-coordinator",
      "rollback",
      `${result.jobId}.pige-backup.zip`
    );
    expect(fs.existsSync(rollbackArchive)).toBe(true);
    await expect(fixture.backup.inspectRestoreArchive(rollbackArchive)).resolves.toMatchObject({
      sourceVaultId: fixture.preview.sourceVaultId,
      invalidFileCount: 0
    });
    const backupJobs = readRecords(path.join(fixture.sourceVaultPath, ".pige", "jobs"))
      .filter((record) => record.class === "backup");
    expect(backupJobs).toEqual([expect.objectContaining({
      state: "completed",
      parentJobId: result.jobId,
      operationIds: [expect.stringMatching(/^op_/u)]
    })]);
    const backupOperations = readRecords(path.join(fixture.sourceVaultPath, ".pige", "operations"));
    expect(backupOperations)
      .toContainEqual(expect.objectContaining({ kind: "backup_created", jobId: backupJobs[0]?.id }));
    expect(JSON.stringify(backupOperations)).not.toContain(fixture.root);
    for (const [index, filePath] of machineFiles.entries()) {
      expect(fs.readFileSync(filePath)).toEqual(machineBytes[index]);
    }
  });

  it("recovers the same rollback Backup stage when persistence stops before archive-staged checkpoint", async () => {
    const fixture = await makeFixture("replace_existing");
    const originalCreateBackup = fixture.backup.createBackup.bind(fixture.backup);
    let interrupt = true;
    vi.spyOn(fixture.backup, "createBackup").mockImplementation(
      (vaultPath, destinationPath, appVersion, options = {}) => originalCreateBackup(
        vaultPath,
        destinationPath,
        appVersion,
        {
          ...options,
          onPhase: async (event) => {
            if (interrupt && event.phase === "archive_staged") {
              interrupt = false;
              throw new Error("Synthetic rollback stop before checkpoint persistence.");
            }
            await options.onPhase?.(event);
          }
        }
      )
    );
    const coordinator = trackCoordinator(new RestoreCoordinatorService({
      ...coordinatorOptions(fixture),
      pauseMutableWork: async () => () => undefined,
      rebuildIndexes: async () => rebuildResult()
    }));
    const command = {
      preview: fixture.applying,
      destinationPath: fixture.destinationPath,
      replaceConfirmed: true
    };

    await expect(coordinator.apply(command)).rejects.toThrow("Synthetic rollback stop");
    const rollbackRoot = path.join(fixture.userDataPath, "restore-coordinator", "rollback");
    const stagedPath = fs.readdirSync(rollbackRoot)
      .map((entry) => path.join(rollbackRoot, entry))
      .find((entry) => entry.endsWith(".tmp"));
    expect(stagedPath).toBeDefined();
    const stagedBytes = fs.readFileSync(stagedPath!);
    fs.writeFileSync(path.join(fixture.sourceVaultPath, "wiki", "after-stop.md"), "# Newer state\n", "utf8");

    const result = await coordinator.apply(command);
    const rollbackArchive = path.join(rollbackRoot, `${result.jobId}.pige-backup.zip`);

    expect(result.status).toBe("restored");
    expect(fs.readFileSync(rollbackArchive)).toEqual(stagedBytes);
    expect(fs.readdirSync(rollbackRoot).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
    const backupJobs = readRecords(path.join(fixture.sourceVaultPath, ".pige", "jobs"))
      .filter((record) => record.class === "backup");
    expect(backupJobs).toHaveLength(1);
    expect(backupJobs[0]).toMatchObject({
      state: "completed",
      checkpoints: expect.arrayContaining([
        expect.objectContaining({ id: "manifest_emitted", state: "done", checksumAfter: expect.stringMatching(/^sha256:/u) }),
        expect.objectContaining({ id: "archive_staged", state: "done", checksumAfter: expect.stringMatching(/^sha256:/u) })
      ])
    });
  }, 15_000);

  it("rejects replacement of a finalized rollback archive before its final checkpoint commit", async () => {
    const fixture = await makeFixture("replace_existing");
    const originalCreateBackup = fixture.backup.createBackup.bind(fixture.backup);
    let interrupt = true;
    vi.spyOn(fixture.backup, "createBackup").mockImplementation(
      (vaultPath, destinationPath, appVersion, options = {}) => originalCreateBackup(
        vaultPath,
        destinationPath,
        appVersion,
        {
          ...options,
          onPhase: async (event) => {
            if (interrupt && event.phase === "archive_finalized") {
              interrupt = false;
              throw new Error("Synthetic rollback stop before final checkpoint persistence.");
            }
            await options.onPhase?.(event);
          }
        }
      )
    );
    const coordinator = trackCoordinator(new RestoreCoordinatorService({
      ...coordinatorOptions(fixture),
      pauseMutableWork: async () => () => undefined,
      rebuildIndexes: async () => rebuildResult()
    }));
    const command = {
      preview: fixture.applying,
      destinationPath: fixture.destinationPath,
      replaceConfirmed: true
    };

    await expect(coordinator.apply(command)).rejects.toThrow("Synthetic rollback stop");
    const restoreJob = readRecords(path.join(
      fixture.userDataPath,
      "restore-coordinator",
      ".pige",
      "jobs"
    ))[0]!;
    const rollbackArchive = path.join(
      fixture.userDataPath,
      "restore-coordinator",
      "rollback",
      `${restoreJob.id}.pige-backup.zip`
    );
    const conflictingArchive = path.join(fixture.root, "conflicting-rollback.pige-backup.zip");
    await originalCreateBackup(fixture.sourceVaultPath, conflictingArchive, "0.1.0-test", {
      backupId: "backup_20260714_conflictingrollback01",
      createdAt: "2026-07-14T09:00:00.000Z",
      stagingOwnerKey: "conflicting-rollback"
    });
    fs.copyFileSync(conflictingArchive, rollbackArchive);

    await expect(coordinator.apply(command)).rejects.toMatchObject({ code: "backup.destination_exists" });
    const childJobs = readRecords(path.join(fixture.sourceVaultPath, ".pige", "jobs"))
      .filter((record) => record.class === "backup");
    expect(childJobs).toHaveLength(1);
    expect(childJobs[0]).toMatchObject({
      state: "failed_final",
      error: { code: "backup.destination_exists", retryable: false }
    });
    expect(readMachineRestoreJob(fixture.userDataPath, restoreJob.id)).toMatchObject({ state: "failed_final" });
    expect(readRecords(path.join(fixture.sourceVaultPath, ".pige", "operations")))
      .not.toContainEqual(expect.objectContaining({ jobId: childJobs[0]?.id }));
  }, 15_000);

  it("reuses the same Job after binding commit when index rebuild needs an explicit retry", async () => {
    const fixture = await makeFixture("clone_as_new");
    const applySpy = vi.spyOn(fixture.backup, "applyRestore");
    const rebuild = vi.fn()
      .mockRejectedValueOnce(new Error("synthetic index worker stop"))
      .mockResolvedValueOnce(rebuildResult());
    const coordinator = trackCoordinator(new RestoreCoordinatorService({
      ...coordinatorOptions(fixture),
      pauseMutableWork: async () => () => undefined,
      rebuildIndexes: rebuild
    }));

    await expect(coordinator.apply({
      preview: fixture.applying,
      destinationPath: fixture.destinationPath,
      replaceConfirmed: false
    })).rejects.toThrow("synthetic index worker stop");
    const failedJob = readRecords(path.join(
      fixture.userDataPath,
      "restore-coordinator",
      ".pige",
      "jobs"
    ))[0];
    expect(failedJob).toMatchObject({
      state: "failed_retryable",
      checkpoints: expect.arrayContaining([
        expect.objectContaining({ id: "destination_committed", state: "done" }),
        expect.objectContaining({ id: "indexes_rebuilt", state: "running" })
      ])
    });
    expect(fixture.vaults.activeVaultPath()).toBe(fixture.destinationPath);

    const retried = await coordinator.apply({
      preview: fixture.applying,
      destinationPath: fixture.destinationPath,
      replaceConfirmed: false
    });

    expect(retried.jobId).toBe(failedJob?.id);
    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(rebuild).toHaveBeenCalledTimes(2);
    expect(readMachineRestoreJob(fixture.userDataPath, retried.jobId!)).toMatchObject({
      state: "completed",
      retry: {
        retryCount: 1,
        maxAutomaticRetries: 0,
        requiresUserAction: false,
        lastRetryReason: "explicit_user_retry"
      }
    });
    expect(readRecords(path.join(fixture.destinationPath, ".pige", "operations")))
      .toHaveLength(1);
  });

  it("does not rerun a failed-final Restore Job through the same semantic action", async () => {
    const fixture = await makeFixture("clone_as_new");
    const seeded = seedRestoreJob(fixture);
    const failed = seeded.store.markFailed(seeded.snapshot, {
      retryable: false,
      message: "Synthetic final restore identity failure."
    });
    seeded.store.close();
    const applySpy = vi.spyOn(fixture.backup, "applyRestore");
    const coordinator = trackCoordinator(new RestoreCoordinatorService({
      ...coordinatorOptions(fixture),
      pauseMutableWork: async () => () => undefined,
      rebuildIndexes: async () => rebuildResult()
    }));

    await expect(coordinator.apply({
      preview: fixture.applying,
      destinationPath: fixture.destinationPath,
      replaceConfirmed: false
    })).rejects.toMatchObject({ code: "restore.job_conflict" });

    expect(applySpy).not.toHaveBeenCalled();
    expect(readMachineRestoreJob(fixture.userDataPath, failed.job.id)).toMatchObject({
      state: "failed_final",
      finishedAt: failed.job.finishedAt
    });
  });

  it.each<RestoreCoreCheckpointPhase>([
    "manifest_validated",
    "destination_reserved",
    "archive_extracted",
    "durable_domains_migrated",
    "external_dependencies_reconciled",
    "vault_identity_finalized"
  ])("recovers the same running Job after the %s checkpoint", async (lastPhase) => {
    const fixture = await makeFixture("clone_as_new");
    const seeded = seedRestoreJob(fixture);
    const phases: RestoreCoreCheckpointPhase[] = [
      "manifest_validated",
      "destination_reserved",
      "archive_extracted",
      "durable_domains_migrated",
      "external_dependencies_reconciled",
      "vault_identity_finalized"
    ];
    let snapshot = seeded.snapshot;
    for (const phase of phases) {
      snapshot = seeded.store.beginCheckpoint(snapshot, phase);
      snapshot = completeSeededCoreCheckpoint(seeded.store, snapshot, seeded.binding, phase);
      if (phase === lastPhase) break;
    }
    seeded.store.close();

    const coordinator = trackCoordinator(new RestoreCoordinatorService({
      ...coordinatorOptions(fixture),
      pauseMutableWork: async () => () => undefined,
      rebuildIndexes: async () => rebuildResult()
    }));
    await expect(coordinator.recoverInterrupted()).resolves.toEqual({ recovered: 1, failed: 0 });

    expect(fixture.vaults.activeVaultPath()).toBe(fixture.destinationPath);
    expect(readMachineRestoreJob(fixture.userDataPath, snapshot.job.id)).toMatchObject({
      id: snapshot.job.id,
      state: "completed"
    });
  }, 15_000);

  it("adopts a committed destination after the machine binding swaps, without a second core apply", async () => {
    const fixture = await makeFixture("clone_as_new");
    const seeded = seedRestoreJob(fixture);
    let snapshot = seeded.snapshot;
    const destinationIdentity = createRestoreDestinationIdentity(
      fixture.destinationPath,
      fixture.pathSafety
    );
    await fixture.backup.applyRestore({
      backupPath: fixture.preview.backupPath,
      archivePreviewToken: fixture.preview.archivePreviewToken,
      previewId: fixture.applying.previewId,
      archiveDigest: fixture.preview.archiveDigest,
      jobId: snapshot.job.id,
      mode: "clone_as_new",
      sourceVaultId: fixture.preview.sourceVaultId,
      resultVaultId: seeded.binding.resultVaultId,
      destinationIdentity,
      pathSafety: fixture.pathSafety,
      onPhase: (event) => {
        snapshot = seeded.store.beginCheckpoint(snapshot, event.phase);
        snapshot = completeSeededCoreCheckpoint(
          seeded.store,
          snapshot,
          seeded.binding,
          event.phase,
          event.externalDependencyCount
        );
      }
    });
    const transition = fixture.vaults.beginRestoreTransition({
      expectedActiveVaultPath: fixture.sourceVaultPath,
      expectedActiveVaultId: fixture.preview.sourceVaultId
    });
    transition.commit(fixture.destinationPath, loadVaultSummary(fixture.destinationPath));
    seeded.store.close();
    const applySpy = vi.spyOn(fixture.backup, "applyRestore");

    const coordinator = trackCoordinator(new RestoreCoordinatorService({
      ...coordinatorOptions(fixture),
      pauseMutableWork: async () => () => undefined,
      rebuildIndexes: async () => rebuildResult()
    }));
    await expect(coordinator.recoverInterrupted()).resolves.toEqual({ recovered: 1, failed: 0 });

    expect(applySpy).not.toHaveBeenCalled();
    expect(readMachineRestoreJob(fixture.userDataPath, snapshot.job.id).state).toBe("completed");
    expect(readRecords(path.join(fixture.destinationPath, ".pige", "operations")))
      .toEqual([expect.objectContaining({ kind: "restore_applied", jobId: snapshot.job.id })]);
  });

  it("adopts a clean core commit after restart before the machine binding swap", async () => {
    const fixture = await makeFixture("clone_as_new");
    const seeded = seedRestoreJob(fixture);
    let snapshot = seeded.snapshot;
    const destinationIdentity = createRestoreDestinationIdentity(
      fixture.destinationPath,
      fixture.pathSafety
    );
    await fixture.backup.applyRestore({
      backupPath: fixture.preview.backupPath,
      archivePreviewToken: fixture.preview.archivePreviewToken,
      previewId: fixture.applying.previewId,
      archiveDigest: fixture.preview.archiveDigest,
      jobId: snapshot.job.id,
      mode: "clone_as_new",
      sourceVaultId: fixture.preview.sourceVaultId,
      resultVaultId: seeded.binding.resultVaultId,
      destinationIdentity,
      pathSafety: fixture.pathSafety,
      onPhase: (event) => {
        snapshot = seeded.store.beginCheckpoint(snapshot, event.phase);
        snapshot = completeSeededCoreCheckpoint(
          seeded.store,
          snapshot,
          seeded.binding,
          event.phase,
          event.externalDependencyCount
        );
      }
    });
    seeded.store.close();
    const applySpy = vi.spyOn(fixture.backup, "applyRestore");
    const adoptSpy = vi.spyOn(fixture.backup, "adoptCommittedRestore");

    const coordinator = trackCoordinator(new RestoreCoordinatorService({
      ...coordinatorOptions(fixture),
      pauseMutableWork: async () => () => undefined,
      rebuildIndexes: async () => rebuildResult()
    }));
    await expect(coordinator.recoverInterrupted()).resolves.toEqual({ recovered: 1, failed: 0 });

    expect(applySpy).not.toHaveBeenCalled();
    expect(adoptSpy).toHaveBeenCalledTimes(1);
    expect(fixture.vaults.activeVaultPath()).toBe(fixture.destinationPath);
    expect(readMachineRestoreJob(fixture.userDataPath, snapshot.job.id).state).toBe("completed");
  });

  it("fails closed when the previous active-vault binding changed before startup adoption", async () => {
    const fixture = await makeFixture("clone_as_new");
    const seeded = seedRestoreJob(fixture);
    seeded.store.close();
    const other = createVaultOnDisk({
      parentDirectory: fixture.vaultParent,
      vaultName: "Other",
      appDataPath: fixture.pathSafety.appDataPath,
      tempPath: fixture.pathSafety.tempPath
    });
    const otherPath = path.join(fixture.vaultParent, "Other");
    fixture.vaults.openPath(otherPath);

    const coordinator = trackCoordinator(new RestoreCoordinatorService({
      ...coordinatorOptions(fixture),
      pauseMutableWork: async () => () => undefined,
      rebuildIndexes: async () => rebuildResult()
    }));
    await expect(coordinator.recoverInterrupted()).resolves.toEqual({ recovered: 0, failed: 1 });

    expect(fixture.vaults.current()?.vaultId).toBe(other.vaultId);
    expect(fs.existsSync(fixture.destinationPath)).toBe(false);
    expect(readRecords(path.join(otherPath, ".pige", "operations"))).toEqual([]);
  });

  it("rejects a completed checkpoint whose durable checksum binding was altered", async () => {
    const fixture = await makeFixture("clone_as_new");
    const seeded = seedRestoreJob(fixture);
    let snapshot = seeded.store.beginCheckpoint(seeded.snapshot, "manifest_validated");
    snapshot = seeded.store.completeCheckpoint(snapshot, "manifest_validated", {
      checksumAfter: `sha256:${"f".repeat(64)}`
    });
    seeded.store.close();
    const coordinator = trackCoordinator(new RestoreCoordinatorService({
      ...coordinatorOptions(fixture),
      pauseMutableWork: async () => () => undefined,
      rebuildIndexes: async () => rebuildResult()
    }));

    await expect(coordinator.recoverInterrupted()).resolves.toEqual({ recovered: 0, failed: 1 });

    expect(readMachineRestoreJob(fixture.userDataPath, snapshot.job.id)).toMatchObject({
      state: "failed_final"
    });
    expect(fs.existsSync(fixture.destinationPath)).toBe(false);
  });

  it("rejects a symlinked destination ancestor before creating a machine Restore Job", async () => {
    const fixture = await makeFixture("clone_as_new");
    const external = path.join(fixture.root, "external-destination");
    const linkedParent = path.join(fixture.root, "linked-destination");
    fs.mkdirSync(external);
    fs.symlinkSync(external, linkedParent);
    const coordinator = trackCoordinator(new RestoreCoordinatorService({
      ...coordinatorOptions(fixture),
      pauseMutableWork: async () => () => undefined,
      rebuildIndexes: async () => rebuildResult()
    }));

    await expect(coordinator.apply({
      preview: fixture.applying,
      destinationPath: path.join(linkedParent, "Restored"),
      replaceConfirmed: false
    })).rejects.toMatchObject({ code: "restore.destination_invalid" });

    expect(readRecords(path.join(
      fixture.userDataPath,
      "restore-coordinator",
      ".pige",
      "jobs"
    ))).toEqual([]);
    expect(fs.readdirSync(external)).toEqual([]);
  });
});

interface Fixture {
  readonly root: string;
  readonly userDataPath: string;
  readonly vaultParent: string;
  readonly sourceVaultPath: string;
  readonly restoreParent: string;
  readonly destinationPath: string;
  readonly pathSafety: { readonly appDataPath: string; readonly tempPath: string };
  readonly settings: LocalSettingsStore;
  readonly vaults: VaultService;
  readonly backup: BackupRestoreService;
  readonly preview: RestoreCorePreviewResult;
  readonly applying: ApplyingRestorePreview;
  pauseCount: number;
  resumeCount: number;
}

async function makeFixture(mode: "clone_as_new" | "replace_existing"): Promise<Fixture> {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-restore-coordinator-")));
  roots.push(root);
  const userDataPath = path.join(root, "user-data");
  const vaultParent = path.join(root, "vaults");
  const restoreParent = path.join(root, "restores");
  const pathSafety = {
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp")
  };
  for (const directory of [userDataPath, vaultParent, restoreParent, pathSafety.appDataPath, pathSafety.tempPath]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  createVaultOnDisk({
    parentDirectory: vaultParent,
    vaultName: "Source",
    ...pathSafety,
    now: new Date("2026-07-14T01:02:03.000Z")
  });
  const sourceVaultPath = path.join(vaultParent, "Source");
  const settings = new LocalSettingsStore(userDataPath);
  const vaults = new VaultService(settings);
  vaultServices.push(vaults);
  vaults.openPath(sourceVaultPath);
  const backup = new BackupRestoreService();
  const backupPath = path.join(root, "source.pige-backup.zip");
  await backup.createBackup(sourceVaultPath, backupPath, "0.1.0-test");
  const preview = await backup.inspectRestoreArchive(backupPath);
  const registry = new RestorePreviewRegistry();
  const generation = registry.begin(1);
  const ready = registry.complete(1, generation, {
    backupPath: preview.backupPath,
    archivePreviewToken: preview.archivePreviewToken,
    archiveDigest: preview.archiveDigest,
    backupId: preview.backupId,
    backupIdSource: preview.backupIdSource,
    sourceVaultId: preview.sourceVaultId
  });
  const applying = registry.claim(1, { previewId: ready.previewId, mode });
  return {
    root,
    userDataPath,
    vaultParent,
    sourceVaultPath,
    restoreParent,
    destinationPath: path.join(restoreParent, mode === "clone_as_new" ? "Clone" : "Replacement"),
    pathSafety,
    settings,
    vaults,
    backup,
    preview,
    applying,
    pauseCount: 0,
    resumeCount: 0
  };
}

function coordinatorOptions(fixture: Fixture) {
  return {
    userDataPath: fixture.userDataPath,
    appVersion: "0.1.0-test",
    pathSafety: fixture.pathSafety,
    backupService: fixture.backup,
    vaultService: fixture.vaults
  };
}

function seedRestoreJob(fixture: Fixture) {
  const store = new RestoreJobStore(fixture.userDataPath);
  const destination = createRestoreDestinationIdentity(fixture.destinationPath, fixture.pathSafety);
  const snapshot = store.create({
    createdAt: fixture.preview.manifest.createdAt,
    archiveDigest: fixture.preview.archiveDigest as `sha256:${string}`,
    backupId: fixture.preview.backupId,
    mode: fixture.applying.mode,
    sourceVaultId: fixture.preview.sourceVaultId,
    destinationIdentity: destination.identityDigest as `sha256:${string}`,
    previousBindingHash: createPreviousVaultBindingHash(
      fixture.sourceVaultPath,
      fixture.preview.sourceVaultId
    ),
    backupPath: fixture.preview.backupPath,
    destinationPath: fixture.destinationPath,
    archivePreviewToken: fixture.preview.archivePreviewToken as `sha256:${string}`,
    previewId: fixture.applying.previewId as `sha256:${string}`,
    backupIdentitySource: fixture.preview.backupIdSource,
    expectedActiveVaultPath: fixture.sourceVaultPath,
    expectedActiveVaultId: fixture.preview.sourceVaultId,
    replaceConfirmed: fixture.applying.mode === "replace_existing"
  });
  return { store, snapshot, binding: store.binding(snapshot) };
}

function rebuildResult() {
  return {
    rebuiltAt: "2026-07-14T02:00:00.000Z",
    pageCount: 3,
    invalidPageCount: 0
  };
}

function completeSeededCoreCheckpoint(
  store: RestoreJobStore,
  snapshot: ReturnType<RestoreJobStore["read"]>,
  binding: ReturnType<RestoreJobStore["binding"]>,
  phase: RestoreCoreCheckpointPhase,
  externalDependencyCount = 0
) {
  return store.completeCheckpoint(snapshot, phase, {
    ...(phase === "manifest_validated" ? { checksumAfter: binding.archiveDigest } : {}),
    ...(phase === "destination_reserved" || phase === "destination_committed"
      ? { checksumAfter: binding.destinationIdentity }
      : {}),
    ...(phase === "destination_committed" ? {
      outputRefs: [{
        kind: "external_uri" as const,
        id: binding.resultVaultId,
        path: binding.destinationPath,
        role: "restored_vault"
      }]
    } : {}),
    ...(phase === "external_dependencies_reconciled" ? {
      resumeHint: externalDependencyCount > 0
        ? "external_dependencies_require_reconnection"
        : "external_dependencies_complete"
    } : {})
  });
}

function trackCoordinator(service: RestoreCoordinatorService): RestoreCoordinatorService {
  coordinators.push(service);
  return service;
}

function readMachineRestoreJob(userDataPath: string, jobId: string): Record<string, unknown> {
  const record = readRecords(path.join(userDataPath, "restore-coordinator", ".pige", "jobs"))
    .find(({ id }) => id === jobId);
  if (!record) throw new Error(`Missing machine Restore Job ${jobId}`);
  return record;
}

function readRecords(rootPath: string): Record<string, any>[] {
  if (!fs.existsSync(rootPath)) return [];
  const records: Record<string, any>[] = [];
  const visit = (directoryPath: string): void => {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        records.push(JSON.parse(fs.readFileSync(entryPath, "utf8")) as Record<string, any>);
      }
    }
  };
  visit(rootPath);
  return records;
}
