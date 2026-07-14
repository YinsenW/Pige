import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openPromise } from "yauzl";
import { ZipFile } from "yazl";
import { BackupManifestSchema, type BackupManifest } from "@pige/schemas";
import {
  BackupRestoreService,
  createRestoreDestinationIdentity,
  type RestoreCoreApplyInput,
  type RestoreCorePreviewResult
} from "../../apps/desktop/src/main/services/backup-service";
import {
  PIGE_DURABLE_ROOTS,
  PIGE_REBUILDABLE_ROOTS,
  PIGE_TRANSIENT_RUNTIME_ROOTS,
  createVaultOnDisk,
  isPigeVault,
  loadVaultSummary
} from "../../apps/desktop/src/main/services/vault-layout";

const tempRoots: string[] = [];
const BACKUP_MANIFEST_ENTRY = "pige-backup-manifest.json";
const BACKUP_ROOT_FILES = ["PIGE.md", "index.md", "log.md", ".pige/manifest.json", ".pige/config.json"] as const;

type DurableRoot = (typeof PIGE_DURABLE_ROOTS)[number];

interface FixtureFile {
  readonly path: string;
  readonly canary: string;
}

const DURABLE_FIXTURES: Readonly<Record<DurableRoot, FixtureFile>> = {
  raw: { path: "raw/managed-source.bin", canary: "durable-raw-body-canary" },
  artifacts: { path: "artifacts/ocr.txt", canary: "durable-artifact-body-canary" },
  sources: { path: "sources/source.md", canary: "durable-source-page-body-canary" },
  wiki: { path: "wiki/note.md", canary: "durable-wiki-body-canary" },
  datasets: { path: "datasets/example--dataset_20260713_abcdef123456/dataset.json", canary: "durable-dataset-canary" },
  assets: { path: "assets/source-image.png", canary: "durable-asset-body-canary" },
  ".pige/source-records": {
    path: ".pige/source-records/source.json",
    canary: "durable-source-record-body-canary"
  },
  ".pige/conversations": {
    path: ".pige/conversations/conversation.jsonl",
    canary: "durable-conversation-body-canary"
  },
  ".pige/jobs": { path: ".pige/jobs/job.json", canary: "durable-job-body-canary" },
  ".pige/proposals": { path: ".pige/proposals/proposal.json", canary: "durable-proposal-body-canary" },
  ".pige/operations": { path: ".pige/operations/operation.json", canary: "durable-operation-body-canary" },
  ".pige/memory": { path: ".pige/memory/memory.json", canary: "durable-memory-body-canary" },
  ".pige/skills": { path: ".pige/skills/skill.md", canary: "durable-skill-body-canary" },
  ".pige/trash": { path: ".pige/trash/deleted.md", canary: "durable-trash-body-canary" }
};

function makeVault(): { root: string; vaultPath: string } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pige-backup-test-")));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Backup Vault",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-09T12:00:00.000Z")
  });
  return { root, vaultPath: path.join(root, "Backup Vault") };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("backup restore service", () => {
  it("reports available backup status without enabling create when no vault is active", () => {
    const service = new BackupRestoreService();

    expect(service.status(undefined)).toMatchObject({
      phase: "available",
      createAvailable: false,
      restoreAvailable: true,
      messageKey: "backup.statusNoVault"
    });
    expect(service.status(loadVaultSummary(makeVault().vaultPath))).toMatchObject({
      createAvailable: true,
      restoreAvailable: true,
      messageKey: "backup.statusReady"
    });
  });

  it("creates a zip backup with durable vault files and restores it into a new vault without rebuildable cache files", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "safe-backup.pige-backup.zip");
    const restoreParent = path.join(root, "restore-targets");
    writeVaultFixture(vaultPath);
    writeExcludedVaultFixtures(vaultPath);

    const created = await new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test");
    const preview = await new BackupRestoreService().inspectRestoreArchive(backupPath);
    const restored = await applyTestRestore(new BackupRestoreService(),
      backupPath,
      restoreParent,
      preview
    );

    expect(created.status).toBe("created");
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(created.manifest).toMatchObject({
      format: "pige-backup",
      formatVersion: 1,
      appVersion: "0.1.0-test",
      vaultName: "Backup Vault",
      noteCount: 1,
      sourceCount: 1,
      conversationCount: 1,
      memoryCount: 1,
      includesSecrets: false
    });
    expect(preview.invalidFileCount).toBe(0);
    expect(preview.backupId).toMatch(/^backup_\d{8}_[a-z0-9]{8,}$/u);
    expect(preview.backupIdSource).toBe("manifest");
    expect(preview.manifest?.fileCount).toBe(created.manifest?.fileCount);
    expect(restored.status).toBe("restored");
    expect(restored.restoredVaultPath).toBe(path.join(restoreParent, "Backup Vault Restored"));
    expect(isPigeVault(restored.restoredVaultPath!)).toBe(true);
    expect(
      fs.readFileSync(path.join(restored.restoredVaultPath!, DURABLE_FIXTURES.wiki.path), "utf8")
    ).toBe(DURABLE_FIXTURES.wiki.canary);
    expect(
      fs.readFileSync(path.join(restored.restoredVaultPath!, DURABLE_FIXTURES.raw.path), "utf8")
    ).toBe(DURABLE_FIXTURES.raw.canary);
    expect(fs.existsSync(path.join(restored.restoredVaultPath!, ".pige/source-records/source.json"))).toBe(true);
    expect(fs.existsSync(path.join(restored.restoredVaultPath!, ".pige/db"))).toBe(true);
    expect(fs.existsSync(path.join(restored.restoredVaultPath!, ".pige/indexes"))).toBe(true);
    expect(fs.existsSync(path.join(restored.restoredVaultPath!, ".pige/cache"))).toBe(true);
    expect(fs.existsSync(path.join(restored.restoredVaultPath!, ".pige/runtime"))).toBe(true);
    expect(fs.existsSync(path.join(restored.restoredVaultPath!, ".pige/db/vault.sqlite"))).toBe(false);
    expect(fs.existsSync(path.join(restored.restoredVaultPath!, ".pige/cache/tmp.bin"))).toBe(false);
    expect(fs.existsSync(path.join(restored.restoredVaultPath!, ".pige/indexes/index.bin"))).toBe(false);
    expect(readVaultManifestFixture(restored.restoredVaultPath!)).toMatchObject({
      vault_id: restored.resultVaultId,
      origin_vault_id: preview.sourceVaultId,
      restored_from_backup_id: preview.backupId
    });
  });

  it("applies replace_existing without changing the source vault identity", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "replace-identity.pige-backup.zip");
    const restoreParent = path.join(root, "replace-targets");
    await new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test");
    const preview = await new BackupRestoreService().inspectRestoreArchive(backupPath);

    const restored = await applyTestRestore(
      new BackupRestoreService(),
      backupPath,
      restoreParent,
      preview,
      { mode: "replace_existing", resultVaultId: preview.sourceVaultId }
    );

    expect(restored).toMatchObject({
      mode: "replace_existing",
      sourceVaultId: preview.sourceVaultId,
      resultVaultId: preview.sourceVaultId,
      backupId: preview.backupId
    });
    expect(readVaultManifestFixture(restored.restoredVaultPath)).toMatchObject({
      vault_id: preview.sourceVaultId
    });
    expect(readVaultManifestFixture(restored.restoredVaultPath)).not.toHaveProperty("restored_from_backup_id");
  });

  it("reports body-free durable core phases and adopts a commit after checkpoint persistence fails", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "checkpointed-restore.pige-backup.zip");
    const restoreParent = path.join(root, "checkpoint-targets");
    const service = new BackupRestoreService();
    await service.createBackup(vaultPath, backupPath, "0.1.0-test");
    const preview = await service.inspectRestoreArchive(backupPath);
    const phases: string[] = [];
    const checkpointFailure = new Error("injected checkpoint persistence failure");
    const input = createTestRestoreInput(backupPath, restoreParent, preview, {
      onPhase(event) {
        phases.push(event.phase);
        expect(JSON.stringify(event)).not.toContain(root);
        if (event.phase === "destination_committed") throw checkpointFailure;
      }
    });

    await expect(service.applyRestore(input)).rejects.toBe(checkpointFailure);

    expect(phases).toEqual([
      "manifest_validated",
      "destination_reserved",
      "archive_extracted",
      "durable_domains_migrated",
      "external_dependencies_reconciled",
      "vault_identity_finalized",
      "destination_committed"
    ]);
    const destinationPath = input.destinationIdentity.destinationPath;
    const sidecarPath = path.join(
      path.dirname(destinationPath),
      `.${path.basename(destinationPath)}.pige-restore.json`
    );
    const markerPath = path.join(destinationPath, ".pige-restore-publication.json");
    expect(fs.existsSync(sidecarPath)).toBe(true);
    expect(fs.existsSync(markerPath)).toBe(true);

    const restored = await new BackupRestoreService().adoptCommittedRestore(input);

    expect(isPigeVault(restored.restoredVaultPath)).toBe(true);
    expect(fs.existsSync(sidecarPath)).toBe(false);
    expect(fs.existsSync(markerPath)).toBe(false);
  });

  it("validates and adopts an exact cleanly committed destination without rewriting it", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "clean-commit-adoption.pige-backup.zip");
    const restoreParent = path.join(root, "clean-commit-targets");
    const service = new BackupRestoreService();
    await service.createBackup(vaultPath, backupPath, "0.1.0-test");
    const preview = await service.inspectRestoreArchive(backupPath);
    const input = createTestRestoreInput(backupPath, restoreParent, preview);
    const committed = await service.applyRestore(input);
    const manifestBefore = fs.readFileSync(
      path.join(committed.restoredVaultPath, ".pige", "manifest.json")
    );

    const adopted = await service.adoptCommittedRestore(input);

    expect(adopted).toEqual(committed);
    expect(fs.readFileSync(path.join(adopted.restoredVaultPath, ".pige", "manifest.json")))
      .toEqual(manifestBefore);
    for (const durableRoot of PIGE_DURABLE_ROOTS) {
      expect(fs.lstatSync(path.join(adopted.restoredVaultPath, durableRoot)).isDirectory()).toBe(true);
    }

    fs.writeFileSync(path.join(adopted.restoredVaultPath, "wiki", "foreign.md"), "foreign", "utf8");
    await expect(service.adoptCommittedRestore(input)).rejects.toMatchObject({
      code: "restore.result_invalid"
    });
  });

  it("can exclude the running rollback Backup Job from its own archive", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "self-excluding-backup.pige-backup.zip");
    const excludedJobId = "job_20260714_rollbackself01";
    const excludedRelativePath = `.pige/jobs/2026/07/${excludedJobId}.json`;
    const retainedRelativePath = ".pige/jobs/2026/07/job_20260714_retainedjob01.json";
    writeFixtureFiles(vaultPath, [
      { path: excludedRelativePath, canary: "running rollback job" },
      { path: retainedRelativePath, canary: "retained durable job" }
    ]);

    await new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test", {
      excludeJobId: excludedJobId
    });
    const generated = await readGeneratedBackup(backupPath);

    expect(generated.manifest.files.map(({ path: filePath }) => filePath))
      .not.toContain(excludedRelativePath);
    expect(generated.entries.has(`vault/${excludedRelativePath}`)).toBe(false);
    expect(generated.manifest.files.map(({ path: filePath }) => filePath))
      .toContain(retainedRelativePath);
    expect(generated.entries.has(`vault/${retainedRelativePath}`)).toBe(true);
  });

  it("derives one exact legacy lineage ID from archive bytes and createdAt", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "legacy-lineage.pige-backup.zip");
    await new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test");
    await rewriteBackupArchive(backupPath, (manifest) => ({ ...manifest, backupId: undefined }));

    const first = await new BackupRestoreService().inspectRestoreArchive(backupPath);
    const second = await new BackupRestoreService().inspectRestoreArchive(backupPath);
    const expectedSuffix = createHash("sha256")
      .update("pige:legacy-backup-lineage:v1\0", "utf8")
      .update(first.archiveDigest, "utf8")
      .update("\0", "utf8")
      .update(first.manifest.createdAt, "utf8")
      .digest("hex");

    expect(first.backupIdSource).toBe("derived_legacy");
    expect(first.backupId).toBe(`backup_${first.manifest.createdAt.slice(0, 10).replaceAll("-", "")}_${expectedSuffix}`);
    expect(second.backupId).toBe(first.backupId);
    const restored = await applyTestRestore(
      new BackupRestoreService(),
      backupPath,
      path.join(root, "legacy-targets"),
      first
    );
    expect(readVaultManifestFixture(restored.restoredVaultPath)).toMatchObject({
      restored_from_backup_id: first.backupId
    });
  });

  it("preserves structured schema and external-dependency facts while parsing", async () => {
    const { root } = makeVault();
    const backupPath = path.join(root, "structured-manifest.pige-backup.zip");
    await writeCustomBackupZip(backupPath, {
      manifestFile: {
        path: "wiki/note.md",
        size: Buffer.byteLength("structured body"),
        checksum: checksumBuffer(Buffer.from("structured body", "utf8"))
      },
      entryBody: "structured body",
      manifestExtras: {
        domainSchemaVersions: createDomainSchemaVersionFixture(),
        externalDependencies: [{
          kind: "external_original",
          sourceId: "src_20260714_external1",
          included: false,
          requiredForCompleteRestore: true,
          displayName: "Detached original"
        }]
      }
    });
    const observed: Array<{ readonly externalDependencyCount: number }> = [];
    const preview = await new BackupRestoreService().inspectRestoreArchive(backupPath);

    await applyTestRestore(
      new BackupRestoreService(),
      backupPath,
      path.join(root, "structured-targets"),
      preview,
      { onPhase: (event) => observed.push(event) }
    );

    expect(observed.every((event) => event.externalDependencyCount === 1)).toBe(true);
    expect(preview.warnings).toContainEqual({
      code: "external_originals_not_included",
      count: 1
    });
    expect(JSON.stringify(preview.warnings)).not.toContain("Detached original");
  });

  it("rejects an outer manifest that disagrees with the archived vault identity", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "inner-outer-mismatch.pige-backup.zip");
    await new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test");
    await rewriteBackupArchive(backupPath, (manifest, entries) => {
      const entryName = "vault/.pige/manifest.json";
      const inner = JSON.parse(entries.get(entryName)!.toString("utf8")) as Record<string, unknown>;
      const changed = Buffer.from(`${JSON.stringify({
        ...inner,
        vault_id: "vault_20260714_mismatch01"
      }, null, 2)}\n`, "utf8");
      entries.set(entryName, changed);
      return {
        ...manifest,
        totalBytes: manifest.totalBytes - requireManifestFile(manifest, ".pige/manifest.json").size + changed.byteLength,
        files: manifest.files.map((file) => file.path === ".pige/manifest.json"
          ? { ...file, size: changed.byteLength, checksum: checksumBuffer(changed) }
          : file)
      };
    });

    await expect(new BackupRestoreService().inspectRestoreArchive(backupPath)).rejects.toMatchObject({
      code: "restore.backup_invalid"
    });
  });

  it("reserves the final destination without replacement and commits the vault manifest last", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "manifest-last.pige-backup.zip");
    const restoreParent = path.join(root, "restore-targets");
    const restoredVaultPath = path.join(restoreParent, "Backup Vault Restored");
    writeVaultFixture(vaultPath);
    await new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test");
    const preview = await new BackupRestoreService().inspectRestoreArchive(backupPath);
    const writtenRestorePaths: string[] = [];
    const originalLinkSync = fs.linkSync.bind(fs);
    vi.spyOn(fs, "linkSync").mockImplementation((sourcePath, destinationPath) => {
      const candidatePath = path.resolve(destinationPath.toString());
      if (candidatePath.startsWith(`${restoredVaultPath}${path.sep}`)) writtenRestorePaths.push(candidatePath);
      return originalLinkSync(sourcePath, destinationPath);
    });

    const result = await applyTestRestore(new BackupRestoreService(),
      backupPath,
      restoreParent,
      preview
    );

    expect(result.status).toBe("restored");
    expect(writtenRestorePaths.length).toBeGreaterThan(1);
    expect(writtenRestorePaths.at(-1)).toBe(path.join(restoredVaultPath, ".pige/manifest.json"));
    expect(writtenRestorePaths.slice(0, -1)).not.toContain(path.join(restoredVaultPath, ".pige/manifest.json"));
  });

  it("resumes an identity-bound partial publication without deleting or duplicating restored files", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "retryable-publication.pige-backup.zip");
    const restoreParent = path.join(root, "restore-targets");
    const restoredVaultPath = path.join(restoreParent, "Backup Vault Restored");
    writeVaultFixture(vaultPath);
    await new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test");
    const preview = await new BackupRestoreService().inspectRestoreArchive(backupPath);
    const originalCopyFileSync = fs.copyFileSync.bind(fs);
    const copySpy = vi.spyOn(fs, "copyFileSync").mockImplementation((sourcePath, destinationPath, mode) => {
      const candidatePath = path.resolve(destinationPath.toString());
      if (
        path.resolve(sourcePath.toString()).endsWith(`${path.sep}${DURABLE_FIXTURES.wiki.path}`) &&
        candidatePath.startsWith(`${restoredVaultPath}${path.sep}`) &&
        candidatePath.endsWith(".tmp")
      ) {
        fs.writeFileSync(candidatePath, "partial restore publication bytes");
        throw Object.assign(new Error("injected restore publication failure"), { code: "EIO" });
      }
      return originalCopyFileSync(sourcePath, destinationPath, mode);
    });

    await expect(applyTestRestore(new BackupRestoreService(),
      backupPath,
      restoreParent,
      preview
    )).rejects.toMatchObject({ code: "EIO" });

    expect(fs.existsSync(path.join(restoredVaultPath, ".pige/manifest.json"))).toBe(false);
    expect(isPigeVault(restoredVaultPath)).toBe(false);
    copySpy.mockRestore();

    const retriedPreview = await new BackupRestoreService().inspectRestoreArchive(backupPath);
    const restored = await applyTestRestore(new BackupRestoreService(),
      backupPath,
      restoreParent,
      retriedPreview
    );

    expect(restored.status).toBe("restored");
    expect(isPigeVault(restoredVaultPath)).toBe(true);
    expect(fs.readFileSync(path.join(restoredVaultPath, DURABLE_FIXTURES.wiki.path), "utf8"))
      .toBe(DURABLE_FIXTURES.wiki.canary);
    expect(fs.existsSync(path.join(restoredVaultPath, ".pige-restore-publication.json"))).toBe(false);
    expect(fs.existsSync(path.join(restoreParent, ".Backup Vault Restored.pige-restore.json"))).toBe(false);
  });

  it("fsyncs a complete crash-left publication temp before linking it on retry", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "retryable-temp-fsync.pige-backup.zip");
    const restoreParent = path.join(root, "restore-targets");
    writeVaultFixture(vaultPath);
    await new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test");
    const preview = await new BackupRestoreService().inspectRestoreArchive(backupPath);
    const originalCopyFileSync = fs.copyFileSync.bind(fs);
    const originalFsyncSync = fs.fsyncSync.bind(fs);
    let copiedWikiTemp = false;
    let injected = false;
    vi.spyOn(fs, "copyFileSync").mockImplementation((sourcePath, destinationPath, mode) => {
      const result = originalCopyFileSync(sourcePath, destinationPath, mode);
      if (
        path.resolve(sourcePath.toString()).endsWith(`${path.sep}${DURABLE_FIXTURES.wiki.path}`) &&
        path.resolve(destinationPath.toString()).endsWith(".tmp")
      ) {
        copiedWikiTemp = true;
      }
      return result;
    });
    vi.spyOn(fs, "fsyncSync").mockImplementation((descriptor) => {
      if (copiedWikiTemp && !injected) {
        injected = true;
        throw Object.assign(new Error("injected restore temp fsync failure"), { code: "EIO" });
      }
      return originalFsyncSync(descriptor);
    });

    await expect(applyTestRestore(new BackupRestoreService(),
      backupPath,
      restoreParent,
      preview
    )).rejects.toMatchObject({ code: "EIO" });
    expect(injected).toBe(true);
    vi.restoreAllMocks();

    const restored = await applyTestRestore(new BackupRestoreService(),
      backupPath,
      restoreParent,
      await new BackupRestoreService().inspectRestoreArchive(backupPath)
    );
    expect(restored.status).toBe("restored");
  });

  it("reconciles a manifest publication temp after the committed vault becomes visible", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "retryable-manifest-temp.pige-backup.zip");
    const restoreParent = path.join(root, "restore-targets");
    const restoredVaultPath = path.join(restoreParent, "Backup Vault Restored");
    writeVaultFixture(vaultPath);
    await new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test");
    const preview = await new BackupRestoreService().inspectRestoreArchive(backupPath);
    const originalLinkSync = fs.linkSync.bind(fs);
    const originalUnlinkSync = fs.unlinkSync.bind(fs);
    let manifestLinked = false;
    let injected = false;
    vi.spyOn(fs, "linkSync").mockImplementation((sourcePath, destinationPath) => {
      const result = originalLinkSync(sourcePath, destinationPath);
      if (path.resolve(destinationPath.toString()) === path.join(restoredVaultPath, ".pige/manifest.json")) {
        manifestLinked = true;
      }
      return result;
    });
    vi.spyOn(fs, "unlinkSync").mockImplementation((filePath) => {
      const candidatePath = path.resolve(filePath.toString());
      if (manifestLinked && !injected && candidatePath.endsWith(".tmp")) {
        injected = true;
        throw Object.assign(new Error("injected manifest temp cleanup failure"), { code: "EIO" });
      }
      return originalUnlinkSync(filePath);
    });

    await expect(applyTestRestore(new BackupRestoreService(),
      backupPath,
      restoreParent,
      preview
    )).rejects.toMatchObject({ code: "EIO" });
    expect(injected).toBe(true);
    expect(isPigeVault(restoredVaultPath)).toBe(true);
    vi.restoreAllMocks();

    const originalOpenSync = fs.openSync.bind(fs);
    const originalFsyncSync = fs.fsyncSync.bind(fs);
    const manifestDirectoryDescriptors = new Set<number>();
    let manifestDirectoryFsynced = false;
    vi.spyOn(fs, "openSync").mockImplementation((filePath, flags, mode) => {
      const descriptor = originalOpenSync(filePath, flags, mode);
      if (path.resolve(filePath.toString()) === path.join(restoredVaultPath, ".pige")) {
        manifestDirectoryDescriptors.add(descriptor);
      }
      return descriptor;
    });
    vi.spyOn(fs, "fsyncSync").mockImplementation((descriptor) => {
      if (manifestDirectoryDescriptors.has(descriptor)) manifestDirectoryFsynced = true;
      return originalFsyncSync(descriptor);
    });

    const restored = await applyTestRestore(new BackupRestoreService(),
      backupPath,
      restoreParent,
      await new BackupRestoreService().inspectRestoreArchive(backupPath)
    );
    expect(restored.status).toBe("restored");
    expect(manifestDirectoryFsynced).toBe(true);
    expect(fs.readdirSync(path.join(restoredVaultPath, ".pige")).filter((entry) => entry.endsWith(".tmp")))
      .toEqual([]);
  });

  it("cleans only owned staging after extraction failure and retries without a visible destination", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "retryable-extraction.pige-backup.zip");
    const restoreParent = path.join(root, "restore-targets");
    const restoredVaultPath = path.join(restoreParent, "Backup Vault Restored");
    writeVaultFixture(vaultPath);
    await new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test");
    const preview = await new BackupRestoreService().inspectRestoreArchive(backupPath);
    const originalCreateWriteStream = fs.createWriteStream.bind(fs);
    const streamSpy = vi.spyOn(fs, "createWriteStream").mockImplementation((filePath, options) => {
      const candidatePath = path.resolve(filePath.toString());
      if (
        candidatePath.includes(`${path.sep}.pige-restore-`) &&
        candidatePath.endsWith(`${path.sep}${DURABLE_FIXTURES.wiki.path}`)
      ) {
        throw Object.assign(new Error("injected restore extraction failure"), { code: "EIO" });
      }
      return originalCreateWriteStream(filePath, options);
    });

    await expect(applyTestRestore(new BackupRestoreService(),
      backupPath,
      restoreParent,
      preview
    )).rejects.toMatchObject({ code: "EIO" });

    expect(fs.existsSync(restoredVaultPath)).toBe(false);
    expect(fs.readdirSync(restoreParent).filter((entry) => entry.startsWith(".pige-restore-"))).toEqual([]);
    streamSpy.mockRestore();
    const retried = await applyTestRestore(new BackupRestoreService(),
      backupPath,
      restoreParent,
      await new BackupRestoreService().inspectRestoreArchive(backupPath)
    );
    expect(retried.status).toBe("restored");
  });

  it("archives every current durable class and emits a body-free path-safe manifest aligned with ZIP entries", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "durable-classes.pige-backup.zip");
    const includedFixtures = writeVaultFixture(vaultPath);
    const excludedVaultFixtures = writeExcludedVaultFixtures(vaultPath);
    const machineLocalFixtures = writeMachineLocalFixtures(path.join(root, "app-data"));

    await new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test");
    const archive = await readGeneratedBackup(backupPath);
    const manifestPaths = archive.manifest.files.map((file) => file.path).sort();
    const archiveVaultPaths = Array.from(archive.entries.keys())
      .filter((entryName) => entryName.startsWith("vault/"))
      .map((entryName) => entryName.slice("vault/".length))
      .sort();

    expect(Array.from(archive.entries.keys()).sort()).toEqual([
      BACKUP_MANIFEST_ENTRY,
      ...manifestPaths.map((filePath) => `vault/${filePath}`)
    ].sort());
    expect(archiveVaultPaths).toEqual(manifestPaths);
    expect(archive.manifest.fileCount).toBe(archive.manifest.files.length);
    expect(archive.manifest.fileCount).toBe(archiveVaultPaths.length);
    expect(archive.manifest.totalBytes).toBe(archive.manifest.files.reduce((sum, file) => sum + file.size, 0));
    expect(archive.manifest.noteCount).toBe(countManifestFiles(archive.manifest, "wiki/", ".md"));
    expect(archive.manifest.sourceCount).toBe(countManifestFiles(archive.manifest, "sources/", ".md"));
    expect(archive.manifest.conversationCount).toBe(countManifestFiles(archive.manifest, ".pige/conversations/"));
    expect(archive.manifest.memoryCount).toBe(countManifestFiles(archive.manifest, ".pige/memory/"));
    expect(archive.manifest.includesSecrets).toBe(false);
    expect(archive.manifest.includes).toEqual({
      markdownKnowledge: true,
      sourceRecords: true,
      managedSourceCopies: true,
      conversations: true,
      vaultMemory: true,
      trash: true,
      rebuildableDatabaseCache: false,
      secrets: false
    });
    expect(archive.manifest.excludedRoots).toEqual([
      ...PIGE_REBUILDABLE_ROOTS,
      ...PIGE_TRANSIENT_RUNTIME_ROOTS
    ]);
    expect(archive.manifest.externalDependencies).toEqual([]);

    for (const rootName of PIGE_DURABLE_ROOTS) {
      const fixture = DURABLE_FIXTURES[rootName];
      expect(manifestPaths).toContain(fixture.path);
      expect(archive.entries.get(`vault/${fixture.path}`)?.toString("utf8")).toBe(fixture.canary);
    }
    for (const rootFile of BACKUP_ROOT_FILES) {
      expect(manifestPaths).toContain(rootFile);
    }

    for (const file of archive.manifest.files) {
      const body = archive.entries.get(`vault/${file.path}`);
      expect(body, file.path).toBeDefined();
      expect(file.path).toBe(path.posix.normalize(file.path));
      expect(path.posix.isAbsolute(file.path)).toBe(false);
      expect(file.path).not.toContain("\\");
      expect(file.path.split("/")).not.toContain("..");
      expect(file.size).toBe(body!.byteLength);
      expect(file.checksum).toBe(checksumBuffer(body!));
    }

    const archiveBodies = Buffer.concat(Array.from(archive.entries.values())).toString("utf8");
    for (const fixture of [...excludedVaultFixtures, ...machineLocalFixtures]) {
      expect(manifestPaths).not.toContain(fixture.path);
      expect(archive.entries.has(`vault/${fixture.path}`)).toBe(false);
      expect(archive.manifestText).not.toContain(fixture.path);
      expect(archiveBodies).not.toContain(fixture.canary);
    }
    for (const fixture of includedFixtures) {
      expect(archive.manifestText).not.toContain(fixture.canary);
    }
    expect(archive.manifestText).not.toContain("copy_to_source_library");
    expect(archive.manifestText).not.toContain(root);
    expect(archive.manifestText).not.toContain(vaultPath);
  });

  it("rejects creating backups inside the active vault", async () => {
    const { vaultPath } = makeVault();
    await expect(
      new BackupRestoreService().createBackup(vaultPath, path.join(vaultPath, "inside.pige-backup.zip"))
    ).rejects.toMatchObject({ code: "backup.path_inside_vault" });
  });

  it("publishes a validated adjacent staging archive and leaves no staging residue", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "atomic-success.pige-backup.zip");
    writeVaultFixture(vaultPath);
    const originalCreateWriteStream = fs.createWriteStream.bind(fs);
    let observedStagingPath: string | undefined;
    vi.spyOn(fs, "createWriteStream").mockImplementation((filePath, options) => {
      const candidatePath = path.resolve(filePath.toString());
      if (isBackupStagingPath(candidatePath, backupPath)) observedStagingPath = candidatePath;
      return originalCreateWriteStream(filePath, options);
    });

    await new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test");

    expect(observedStagingPath).toBeDefined();
    expect(path.dirname(observedStagingPath!)).toBe(path.dirname(backupPath));
    expect(fs.existsSync(observedStagingPath!)).toBe(false);
    expect(listBackupStagingFiles(backupPath)).toEqual([]);
    const publishedStat = fs.lstatSync(backupPath);
    expect(publishedStat.nlink).toBe(1);
    expect(publishedStat.mode & 0o777).toBe(0o600);
    await expect(new BackupRestoreService().inspectRestoreArchive(backupPath)).resolves.toMatchObject({
      invalidFileCount: 0
    });
  });

  it("rejects same-size source drift after manifest hashing without publishing a backup", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "source-drift.pige-backup.zip");
    writeVaultFixture(vaultPath);
    const sourcePath = path.join(vaultPath, DURABLE_FIXTURES.wiki.path);
    const originalBody = fs.readFileSync(sourcePath, "utf8");
    const changedBody = "x".repeat(Buffer.byteLength(originalBody));
    const originalOpenSync = fs.openSync.bind(fs);
    const originalCloseSync = fs.closeSync.bind(fs);
    let checksumDescriptor: number | undefined;
    let mutatedAfterHash = false;
    vi.spyOn(fs, "openSync").mockImplementation((filePath, flags, mode) => {
      const descriptor = originalOpenSync(filePath, flags, mode);
      if (path.resolve(filePath.toString()) === sourcePath) {
        checksumDescriptor = descriptor;
      }
      return descriptor;
    });
    vi.spyOn(fs, "closeSync").mockImplementation((descriptor) => {
      originalCloseSync(descriptor);
      if (descriptor === checksumDescriptor) {
        checksumDescriptor = undefined;
        fs.writeFileSync(sourcePath, changedBody, "utf8");
        mutatedAfterHash = true;
      }
    });

    await expect(
      new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test")
    ).rejects.toMatchObject({ code: "backup.validation_failed" });

    expect(mutatedAfterHash).toBe(true);
    expect(Buffer.byteLength(changedBody)).toBe(Buffer.byteLength(originalBody));
    expect(fs.readFileSync(sourcePath, "utf8")).toBe(changedBody);
    expect(fs.existsSync(backupPath)).toBe(false);
    expect(listBackupStagingFiles(backupPath)).toEqual([]);
  });

  it("rejects a same-size source replacement between descriptor stat and hashing", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "source-replacement.pige-backup.zip");
    writeVaultFixture(vaultPath);
    const sourcePath = path.join(vaultPath, DURABLE_FIXTURES.wiki.path);
    const originalBody = fs.readFileSync(sourcePath, "utf8");
    const replacementBody = "y".repeat(Buffer.byteLength(originalBody));
    const displacedPath = path.join(root, "displaced-source.md");
    const originalLstatSync = fs.lstatSync.bind(fs);
    let replaced = false;
    vi.spyOn(fs, "lstatSync").mockImplementation((filePath, options) => {
      if (!replaced && path.resolve(filePath.toString()) === sourcePath) {
        fs.renameSync(sourcePath, displacedPath);
        fs.writeFileSync(sourcePath, replacementBody, "utf8");
        replaced = true;
      }
      return originalLstatSync(filePath, options as never);
    });

    await expect(
      new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test")
    ).rejects.toMatchObject({ code: "backup.source_changed" });

    expect(replaced).toBe(true);
    expect(Buffer.byteLength(replacementBody)).toBe(Buffer.byteLength(originalBody));
    expect(fs.existsSync(backupPath)).toBe(false);
    expect(listBackupStagingFiles(backupPath)).toEqual([]);
  });

  it("cleans only its owned staging archive when the archive write stream fails", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "write-failure.pige-backup.zip");
    const unrelatedStagingPath = path.join(root, `.${path.basename(backupPath)}.unrelated.tmp`);
    writeVaultFixture(vaultPath);
    fs.writeFileSync(unrelatedStagingPath, "unrelated staging canary", "utf8");
    const writeFailure = new Error("injected backup write failure");
    const originalCreateWriteStream = fs.createWriteStream.bind(fs);
    let failedStagingPath: string | undefined;
    vi.spyOn(fs, "createWriteStream").mockImplementation((filePath, options) => {
      const candidatePath = path.resolve(filePath.toString());
      if (!isBackupStagingPath(candidatePath, backupPath) || candidatePath === unrelatedStagingPath) {
        return originalCreateWriteStream(filePath, options);
      }
      failedStagingPath = candidatePath;
      return new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
        final(callback) {
          callback(writeFailure);
        }
      }) as fs.WriteStream;
    });

    await expect(
      new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test")
    ).rejects.toBe(writeFailure);

    expect(failedStagingPath).toBeDefined();
    expect(fs.existsSync(failedStagingPath!)).toBe(false);
    expect(fs.existsSync(backupPath)).toBe(false);
    expect(fs.readFileSync(unrelatedStagingPath, "utf8")).toBe("unrelated staging canary");
    expect(listBackupStagingFiles(backupPath)).toEqual([unrelatedStagingPath]);
  });

  it("does not overwrite or remove a destination that appears during atomic publication", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "destination-race.pige-backup.zip");
    const racedDestinationBody = "destination race winner";
    writeVaultFixture(vaultPath);
    const originalLinkSync = fs.linkSync.bind(fs);
    const linkSpy = vi.spyOn(fs, "linkSync").mockImplementation((existingPath, newPath) => {
      expect(path.resolve(existingPath.toString())).not.toBe(backupPath);
      expect(path.resolve(newPath.toString())).toBe(backupPath);
      fs.writeFileSync(newPath, racedDestinationBody, { encoding: "utf8", flag: "wx" });
      originalLinkSync(existingPath, newPath);
    });

    await expect(
      new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test")
    ).rejects.toMatchObject({ code: "backup.destination_exists" });

    expect(linkSpy).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(backupPath, "utf8")).toBe(racedDestinationBody);
    expect(listBackupStagingFiles(backupPath)).toEqual([]);
  });

  it("distinguishes a non-writable destination from unsupported atomic publication", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "unsupported-atomic-link.pige-backup.zip");
    writeVaultFixture(vaultPath);
    vi.spyOn(fs, "linkSync").mockImplementation(() => {
      throw Object.assign(new Error("hard links unavailable"), { code: "EPERM" });
    });

    await expect(
      new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test")
    ).rejects.toMatchObject({ code: "backup.destination_not_writable" });

    expect(fs.existsSync(backupPath)).toBe(false);
    expect(listBackupStagingFiles(backupPath)).toEqual([]);
  });

  it("reports an unsupported atomic-publication filesystem without leaving output", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "unsupported-link-filesystem.pige-backup.zip");
    writeVaultFixture(vaultPath);
    vi.spyOn(fs, "linkSync").mockImplementation(() => {
      throw Object.assign(new Error("cross-device hard link"), { code: "EXDEV" });
    });

    await expect(
      new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test")
    ).rejects.toMatchObject({ code: "backup.atomic_publish_unsupported" });

    expect(fs.existsSync(backupPath)).toBe(false);
    expect(listBackupStagingFiles(backupPath)).toEqual([]);
  });

  it("reconciles a crash-left staging hard link before reporting an existing destination", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "crash-linked.pige-backup.zip");
    vi.spyOn(process, "kill").mockImplementation((ownerPid) => {
      if (ownerPid === 123) throw Object.assign(new Error("process exited"), { code: "ESRCH" });
      return true;
    });
    const stagingPath = path.join(
      root,
      `.${path.basename(backupPath)}.123.00000000-0000-4000-8000-000000000000.tmp`
    );
    fs.writeFileSync(stagingPath, "fully published archive canary", { encoding: "utf8", mode: 0o600 });
    fs.linkSync(stagingPath, backupPath);

    await expect(
      new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test")
    ).rejects.toMatchObject({ code: "backup.destination_exists" });

    expect(fs.existsSync(stagingPath)).toBe(false);
    expect(fs.readFileSync(backupPath, "utf8")).toBe("fully published archive canary");
    expect(fs.lstatSync(backupPath).nlink).toBe(1);
  });

  it("does not reconcile a staging link owned by a live publisher", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "live-linked.pige-backup.zip");
    const stagingPath = path.join(
      root,
      `.${path.basename(backupPath)}.${process.pid}.00000000-0000-4000-8000-000000000000.tmp`
    );
    fs.writeFileSync(stagingPath, "live publication canary", { encoding: "utf8", mode: 0o600 });
    fs.linkSync(stagingPath, backupPath);

    await expect(
      new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test")
    ).rejects.toMatchObject({ code: "backup.destination_exists" });

    expect(fs.readFileSync(stagingPath, "utf8")).toBe("live publication canary");
    expect(fs.readFileSync(backupPath, "utf8")).toBe("live publication canary");
    expect(fs.lstatSync(backupPath).nlink).toBe(2);
  });

  it("rejects same-size staging drift between validation and atomic publication", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "staging-race.pige-backup.zip");
    writeVaultFixture(vaultPath);
    const originalLinkSync = fs.linkSync.bind(fs);
    let mutatedStagingPath: string | undefined;
    vi.spyOn(fs, "linkSync").mockImplementation((existingPath, newPath) => {
      mutatedStagingPath = path.resolve(existingPath.toString());
      const archive = fs.readFileSync(mutatedStagingPath);
      archive[Math.max(0, archive.length - 1)] ^= 0xff;
      fs.writeFileSync(mutatedStagingPath, archive);
      const changedAt = new Date(Date.now() + 5_000);
      fs.utimesSync(mutatedStagingPath, changedAt, changedAt);
      originalLinkSync(existingPath, newPath);
    });

    await expect(
      new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test")
    ).rejects.toMatchObject({ code: "backup.finalization_failed" });

    expect(mutatedStagingPath).toBeDefined();
    expect(fs.existsSync(backupPath)).toBe(false);
    expect(listBackupStagingFiles(backupPath)).toEqual([]);
  });

  it("rejects same-size destination drift immediately after atomic publication", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "destination-content-race.pige-backup.zip");
    writeVaultFixture(vaultPath);
    const originalLinkSync = fs.linkSync.bind(fs);
    vi.spyOn(fs, "linkSync").mockImplementation((existingPath, newPath) => {
      originalLinkSync(existingPath, newPath);
      const archive = fs.readFileSync(newPath);
      archive[Math.max(0, archive.length - 1)] ^= 0xff;
      fs.writeFileSync(newPath, archive);
      const changedAt = new Date(Date.now() + 5_000);
      fs.utimesSync(newPath, changedAt, changedAt);
    });

    await expect(
      new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test")
    ).rejects.toMatchObject({ code: "backup.finalization_failed" });

    expect(fs.existsSync(backupPath)).toBe(false);
    expect(listBackupStagingFiles(backupPath)).toEqual([]);
  });

  it("rejects a self-consistent staged archive whose embedded manifest is not the source snapshot", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "validation-failure.pige-backup.zip");
    const invalidTemplatePath = path.join(root, "invalid-template.zip");
    writeVaultFixture(vaultPath);
    await writeCustomBackupZip(invalidTemplatePath, {
      manifestFile: {
        path: "wiki/note.md",
        size: Buffer.byteLength("actual body"),
        checksum: checksumBuffer(Buffer.from("actual body", "utf8"))
      },
      entryBody: "actual body"
    });
    const invalidArchive = fs.readFileSync(invalidTemplatePath);
    fs.rmSync(invalidTemplatePath);

    const originalCreateWriteStream = fs.createWriteStream.bind(fs);
    const originalCloseSync = fs.closeSync.bind(fs);
    let stagingPath: string | undefined;
    let stagingDescriptor: number | undefined;
    let replacedAfterClose = false;
    vi.spyOn(fs, "createWriteStream").mockImplementation((filePath, options) => {
      const candidatePath = path.resolve(filePath.toString());
      if (isBackupStagingPath(candidatePath, backupPath) && typeof options === "object" && options !== null) {
        stagingPath = candidatePath;
        stagingDescriptor = typeof options.fd === "number" ? options.fd : undefined;
      }
      return originalCreateWriteStream(filePath, options);
    });
    vi.spyOn(fs, "closeSync").mockImplementation((descriptor) => {
      originalCloseSync(descriptor);
      if (descriptor === stagingDescriptor) {
        stagingDescriptor = undefined;
        fs.writeFileSync(stagingPath!, invalidArchive);
        replacedAfterClose = true;
      }
    });

    await expect(
      new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test")
    ).rejects.toMatchObject({ code: "backup.validation_failed" });

    expect(replacedAfterClose).toBe(true);
    expect(fs.existsSync(backupPath)).toBe(false);
    expect(listBackupStagingFiles(backupPath)).toEqual([]);
  });

  it.each(["manifest", "vault entry"] as const)("rejects duplicate ZIP %s", async (duplicateKind) => {
    const { root } = makeVault();
    const backupPath = path.join(root, `duplicate-${duplicateKind.replace(" ", "-")}.pige-backup.zip`);
    await writeDuplicateBackupZip(backupPath, duplicateKind);

    await expect(new BackupRestoreService().inspectRestoreArchive(backupPath)).rejects.toMatchObject({
      code: "restore.entry_duplicate"
    });
  });

  it("does not publish when the destination directory cannot be durably flushed", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "directory-fsync-failure.pige-backup.zip");
    writeVaultFixture(vaultPath);
    const originalFsyncSync = fs.fsyncSync.bind(fs);
    let fsyncCalls = 0;
    const directoryFsyncFailure = Object.assign(new Error("injected directory fsync failure"), { code: "EIO" });
    vi.spyOn(fs, "fsyncSync").mockImplementation((descriptor) => {
      fsyncCalls += 1;
      if (fsyncCalls === 2) throw directoryFsyncFailure;
      originalFsyncSync(descriptor);
    });

    await expect(
      new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test")
    ).rejects.toBe(directoryFsyncFailure);

    expect(fsyncCalls).toBe(2);
    expect(fs.existsSync(backupPath)).toBe(false);
    expect(listBackupStagingFiles(backupPath)).toEqual([]);
  });

  it("flags checksum mismatches during restore preview and blocks restore apply", async () => {
    const { root } = makeVault();
    const backupPath = path.join(root, "bad-checksum.pige-backup.zip");
    await writeCustomBackupZip(backupPath, {
      manifestFile: {
        path: "wiki/note.md",
        size: Buffer.byteLength("actual body"),
        checksum: "sha256:0000000000000000000000000000000000000000000000000000000000000000"
      },
      entryBody: "actual body"
    });

    const preview = await new BackupRestoreService().inspectRestoreArchive(backupPath);

    expect(preview.invalidFileCount).toBe(1);
    await expect(applyTestRestore(new BackupRestoreService(),
      backupPath,
      path.join(root, "restore"),
      preview
    )).rejects.toMatchObject({
      code: "restore.backup_invalid"
    });
  });

  it("binds restore apply to the exact previewed archive bytes", async () => {
    const first = makeVault();
    const second = makeVault();
    const backupPath = path.join(first.root, "preview-bound.pige-backup.zip");
    const replacementPath = path.join(second.root, "replacement.pige-backup.zip");
    writeVaultFixture(first.vaultPath);
    writeVaultFixture(second.vaultPath);
    fs.writeFileSync(path.join(second.vaultPath, DURABLE_FIXTURES.wiki.path), "replacement archive body");
    await new BackupRestoreService().createBackup(first.vaultPath, backupPath, "0.1.0-test");
    await new BackupRestoreService().createBackup(second.vaultPath, replacementPath, "0.1.0-test");
    const preview = await new BackupRestoreService().inspectRestoreArchive(backupPath);
    const previewToken = preview.archivePreviewToken;

    expect(previewToken).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(previewToken).not.toContain(first.root);
    await expect(applyTestRestore(new BackupRestoreService(),
      backupPath,
      path.join(first.root, "wrong-token-restore"),
      preview,
      { archivePreviewToken: `sha256:${"0".repeat(64)}` }
    )).rejects.toMatchObject({ code: "restore.backup_invalid" });
    expect(fs.existsSync(path.join(first.root, "wrong-token-restore", "Backup Vault Restored"))).toBe(false);
    fs.copyFileSync(replacementPath, backupPath);

    await expect(applyTestRestore(new BackupRestoreService(),
      backupPath,
      path.join(first.root, "restore"),
      preview
    )).rejects.toMatchObject({ code: "restore.backup_invalid" });
    expect(fs.existsSync(path.join(first.root, "restore", "Backup Vault Restored"))).toBe(false);
  });

  it("rejects an archive path replacement during descriptor-bound extraction before publication", async () => {
    const first = makeVault();
    const second = makeVault();
    const backupPath = path.join(first.root, "descriptor-bound.pige-backup.zip");
    const originalArchivePath = path.join(first.root, "descriptor-bound.original.zip");
    const replacementPath = path.join(second.root, "descriptor-bound-replacement.pige-backup.zip");
    const restoreParent = path.join(first.root, "restore");
    writeVaultFixture(first.vaultPath);
    writeVaultFixture(second.vaultPath);
    fs.writeFileSync(path.join(second.vaultPath, DURABLE_FIXTURES.wiki.path), "replacement archive body");
    await new BackupRestoreService().createBackup(first.vaultPath, backupPath, "0.1.0-test");
    await new BackupRestoreService().createBackup(second.vaultPath, replacementPath, "0.1.0-test");
    const preview = await new BackupRestoreService().inspectRestoreArchive(backupPath);
    const originalCreateWriteStream = fs.createWriteStream.bind(fs);
    let replaced = false;
    vi.spyOn(fs, "createWriteStream").mockImplementation((filePath, options) => {
      const candidatePath = path.resolve(filePath.toString());
      if (!replaced && candidatePath.includes(`${path.sep}.pige-restore-`)) {
        replaced = true;
        fs.renameSync(backupPath, originalArchivePath);
        fs.copyFileSync(replacementPath, backupPath);
      }
      return originalCreateWriteStream(filePath, options);
    });

    await expect(applyTestRestore(new BackupRestoreService(),
      backupPath,
      restoreParent,
      preview
    )).rejects.toMatchObject({ code: "restore.backup_invalid" });

    expect(replaced).toBe(true);
    expect(fs.existsSync(originalArchivePath)).toBe(true);
    expect(fs.existsSync(path.join(restoreParent, "Backup Vault Restored"))).toBe(false);
  });

  it("preserves an unowned destination that appears during final restore publication", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "destination-race-restore.pige-backup.zip");
    const restoreParent = path.join(root, "restore-targets");
    const restoredVaultPath = path.join(restoreParent, "Backup Vault Restored");
    const canaryPath = path.join(restoredVaultPath, "unowned-canary.txt");
    writeVaultFixture(vaultPath);
    await new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test");
    const preview = await new BackupRestoreService().inspectRestoreArchive(backupPath);
    const originalMkdirSync = fs.mkdirSync.bind(fs);
    vi.spyOn(fs, "mkdirSync").mockImplementation((directoryPath, options) => {
      if (path.resolve(directoryPath.toString()) !== restoredVaultPath) {
        return originalMkdirSync(directoryPath, options);
      }
      originalMkdirSync(restoredVaultPath, { recursive: true });
      fs.writeFileSync(canaryPath, "unowned destination canary");
      throw Object.assign(new Error("injected restore destination race"), { code: "EEXIST" });
    });

    await expect(applyTestRestore(new BackupRestoreService(),
      backupPath,
      restoreParent,
      preview
    )).rejects.toMatchObject({ code: "restore.destination_exists" });

    expect(fs.readFileSync(canaryPath, "utf8")).toBe("unowned destination canary");
    expect(fs.existsSync(path.join(restoredVaultPath, "wiki"))).toBe(false);
  });

  it("does not clean or overwrite an unowned destination swapped in after reservation", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "post-reservation-race.pige-backup.zip");
    const restoreParent = path.join(root, "restore-targets");
    const restoredVaultPath = path.join(restoreParent, "Backup Vault Restored");
    const ownedPublicationPath = path.join(restoreParent, ".owned-restore-publication");
    const canaryPath = path.join(restoredVaultPath, "unowned-canary.txt");
    writeVaultFixture(vaultPath);
    await new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test");
    const preview = await new BackupRestoreService().inspectRestoreArchive(backupPath);
    const originalCopyFileSync = fs.copyFileSync.bind(fs);
    let swapped = false;
    vi.spyOn(fs, "copyFileSync").mockImplementation((sourcePath, destinationPath, mode) => {
      const candidatePath = path.resolve(destinationPath.toString());
      if (!swapped && candidatePath.startsWith(`${restoredVaultPath}${path.sep}`)) {
        swapped = true;
        fs.renameSync(restoredVaultPath, ownedPublicationPath);
        fs.mkdirSync(restoredVaultPath, { mode: 0o700 });
        fs.writeFileSync(canaryPath, "unowned destination canary");
        throw Object.assign(new Error("injected post-reservation destination swap"), { code: "EIO" });
      }
      return originalCopyFileSync(sourcePath, destinationPath, mode);
    });

    await expect(applyTestRestore(new BackupRestoreService(),
      backupPath,
      restoreParent,
      preview
    )).rejects.toMatchObject({ code: "EIO" });

    expect(swapped).toBe(true);
    expect(fs.readFileSync(canaryPath, "utf8")).toBe("unowned destination canary");
    expect(fs.readdirSync(restoredVaultPath)).toEqual(["unowned-canary.txt"]);
    expect(fs.existsSync(path.join(ownedPublicationPath, ".pige-restore-publication.json"))).toBe(true);
  });

  it("rejects mode, Job, and preview replay against one partial publication", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "binding-replay.pige-backup.zip");
    const restoreParent = path.join(root, "binding-targets");
    writeVaultFixture(vaultPath);
    await new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test");
    const preview = await new BackupRestoreService().inspectRestoreArchive(backupPath);
    const originalCopyFileSync = fs.copyFileSync.bind(fs);
    let injected = false;
    vi.spyOn(fs, "copyFileSync").mockImplementation((sourcePath, destinationPath, mode) => {
      if (!injected && path.resolve(destinationPath.toString()).endsWith(".tmp")) {
        injected = true;
        throw Object.assign(new Error("injected partial publication"), { code: "EIO" });
      }
      return originalCopyFileSync(sourcePath, destinationPath, mode);
    });
    await expect(applyTestRestore(
      new BackupRestoreService(),
      backupPath,
      restoreParent,
      preview
    )).rejects.toMatchObject({ code: "EIO" });
    vi.restoreAllMocks();

    await expect(applyTestRestore(
      new BackupRestoreService(),
      backupPath,
      restoreParent,
      preview,
      { mode: "replace_existing", resultVaultId: preview.sourceVaultId }
    )).rejects.toMatchObject({ code: "restore.destination_exists" });
    await expect(applyTestRestore(
      new BackupRestoreService(),
      backupPath,
      restoreParent,
      preview,
      { jobId: "job_20260714_wrongjob001" }
    )).rejects.toMatchObject({ code: "restore.destination_exists" });
    await expect(applyTestRestore(
      new BackupRestoreService(),
      backupPath,
      restoreParent,
      preview,
      { previewId: `sha256:${"f".repeat(64)}` }
    )).rejects.toMatchObject({ code: "restore.destination_exists" });

    await expect(applyTestRestore(
      new BackupRestoreService(),
      backupPath,
      restoreParent,
      preview
    )).resolves.toMatchObject({ status: "restored" });
  });

  it("rejects undeclared staging and destination entries", async () => {
    const first = makeVault();
    const firstBackup = path.join(first.root, "extra-staging.pige-backup.zip");
    const firstParent = path.join(first.root, "extra-staging-targets");
    await new BackupRestoreService().createBackup(first.vaultPath, firstBackup, "0.1.0-test");
    const firstPreview = await new BackupRestoreService().inspectRestoreArchive(firstBackup);
    const originalMkdirSync = fs.mkdirSync.bind(fs);
    let injectedStagingEntry = false;
    vi.spyOn(fs, "mkdirSync").mockImplementation((directoryPath, options) => {
      const result = originalMkdirSync(directoryPath, options);
      const candidatePath = path.resolve(directoryPath.toString());
      if (!injectedStagingEntry && candidatePath.includes(`${path.sep}.pige-restore-`) && candidatePath.endsWith(`${path.sep}.pige${path.sep}db`)) {
        injectedStagingEntry = true;
        fs.writeFileSync(path.join(path.dirname(path.dirname(candidatePath)), "undeclared.txt"), "undeclared staging");
      }
      return result;
    });
    await expect(applyTestRestore(
      new BackupRestoreService(),
      firstBackup,
      firstParent,
      firstPreview
    )).rejects.toMatchObject({ code: "restore.result_invalid" });
    expect(injectedStagingEntry).toBe(true);
    vi.restoreAllMocks();

    const second = makeVault();
    const secondBackup = path.join(second.root, "extra-destination.pige-backup.zip");
    const secondParent = path.join(second.root, "extra-destination-targets");
    const destinationPath = path.join(secondParent, "Backup Vault Restored");
    await new BackupRestoreService().createBackup(second.vaultPath, secondBackup, "0.1.0-test");
    const secondPreview = await new BackupRestoreService().inspectRestoreArchive(secondBackup);
    const originalLinkSync = fs.linkSync.bind(fs);
    let injectedDestinationEntry = false;
    vi.spyOn(fs, "linkSync").mockImplementation((sourcePath, targetPath) => {
      const result = originalLinkSync(sourcePath, targetPath);
      if (path.resolve(targetPath.toString()) === path.join(destinationPath, ".pige/manifest.json")) {
        fs.writeFileSync(path.join(destinationPath, "undeclared.txt"), "undeclared destination");
        injectedDestinationEntry = true;
      }
      return result;
    });
    await expect(applyTestRestore(
      new BackupRestoreService(),
      secondBackup,
      secondParent,
      secondPreview
    )).rejects.toMatchObject({ code: "restore.result_invalid" });
    expect(injectedDestinationEntry).toBe(true);
    expect(fs.readFileSync(path.join(destinationPath, "undeclared.txt"), "utf8")).toBe("undeclared destination");
  });

  it("rejects unsafe roots, nested vaults, and symbolic-link ancestors before writes", async () => {
    const { root, vaultPath } = makeVault();
    const safeParent = path.join(root, "safe-parent");
    const appDataPath = path.join(root, "app-data-root");
    const tempPath = path.join(root, "temp-root");
    fs.mkdirSync(safeParent);
    fs.mkdirSync(appDataPath);
    fs.mkdirSync(tempPath);

    expect(() => createRestoreDestinationIdentity(path.join(appDataPath, "Restored"), { appDataPath, tempPath }))
      .toThrowError(expect.objectContaining({ code: "vault_path_blocked" }));
    expect(() => createRestoreDestinationIdentity(path.join(vaultPath, "nested"), { appDataPath, tempPath }))
      .toThrowError(expect.objectContaining({ code: "restore.destination_invalid" }));

    const realParent = path.join(root, "real-parent");
    const linkedParent = path.join(root, "linked-parent");
    fs.mkdirSync(realParent);
    fs.symlinkSync(realParent, linkedParent, "dir");
    expect(() => createRestoreDestinationIdentity(path.join(linkedParent, "Restored"), { appDataPath, tempPath }))
      .toThrowError(expect.objectContaining({ code: "restore.destination_invalid" }));
  });

  it("preserves a successor parent when an ancestor is swapped during extraction", async () => {
    const { root, vaultPath } = makeVault();
    const backupPath = path.join(root, "parent-swap.pige-backup.zip");
    const restoreParent = path.join(root, "parent-swap-targets");
    const displacedParent = path.join(root, "displaced-parent-swap-targets");
    const successorCanary = path.join(restoreParent, "successor-canary.txt");
    await new BackupRestoreService().createBackup(vaultPath, backupPath, "0.1.0-test");
    const preview = await new BackupRestoreService().inspectRestoreArchive(backupPath);
    const input = createTestRestoreInput(backupPath, restoreParent, preview);
    const originalCreateWriteStream = fs.createWriteStream.bind(fs);
    let swapped = false;
    vi.spyOn(fs, "createWriteStream").mockImplementation((filePath, options) => {
      const stream = originalCreateWriteStream(filePath, options);
      const candidatePath = path.resolve(filePath.toString());
      if (!swapped && candidatePath.includes(`${path.sep}.pige-restore-`)) {
        swapped = true;
        fs.renameSync(restoreParent, displacedParent);
        fs.mkdirSync(restoreParent);
        fs.writeFileSync(successorCanary, "successor parent canary");
      }
      return stream;
    });

    await expect(new BackupRestoreService().applyRestore(input)).rejects.toMatchObject({
      code: "restore.destination_invalid"
    });
    expect(swapped).toBe(true);
    expect(fs.readFileSync(successorCanary, "utf8")).toBe("successor parent canary");
  });

  it("rejects unsafe manifest paths before extraction", async () => {
    const { root } = makeVault();
    const backupPath = path.join(root, "unsafe.pige-backup.zip");
    await writeCustomBackupZip(backupPath, {
      manifestFile: {
        path: "../evil.md",
        size: 0,
        checksum: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      },
      entryBody: ""
    });

    await expect(new BackupRestoreService().inspectRestoreArchive(backupPath)).rejects.toMatchObject({
      code: "restore.entry_invalid"
    });
  });
});

interface RestoreTestOverrides {
  readonly archivePreviewToken?: string;
  readonly archiveDigest?: string;
  readonly previewId?: string;
  readonly jobId?: string;
  readonly mode?: RestoreCoreApplyInput["mode"];
  readonly sourceVaultId?: string;
  readonly resultVaultId?: string;
  readonly destinationPath?: string;
  readonly onPhase?: RestoreCoreApplyInput["onPhase"];
}

async function applyTestRestore(
  service: BackupRestoreService,
  backupPath: string,
  restoreParent: string,
  preview: RestoreCorePreviewResult,
  overrides: RestoreTestOverrides = {}
) {
  return service.applyRestore(createTestRestoreInput(backupPath, restoreParent, preview, overrides));
}

function createTestRestoreInput(
  backupPath: string,
  restoreParent: string,
  preview: RestoreCorePreviewResult,
  overrides: RestoreTestOverrides = {}
): RestoreCoreApplyInput {
  fs.mkdirSync(restoreParent, { recursive: true });
  const mode = overrides.mode ?? "clone_as_new";
  const destinationPath = overrides.destinationPath ?? path.join(restoreParent, "Backup Vault Restored");
  const pathSafety = {
    appDataPath: path.join(path.dirname(restoreParent), "blocked-app-data"),
    tempPath: path.join(path.dirname(restoreParent), "blocked-temp")
  };
  return {
    backupPath,
    archivePreviewToken: overrides.archivePreviewToken ?? preview.archivePreviewToken,
    previewId: overrides.previewId ?? checksumBuffer(Buffer.from(`preview:${backupPath}`, "utf8")),
    archiveDigest: overrides.archiveDigest ?? preview.archiveDigest,
    jobId: overrides.jobId ?? "job_20260714_restorecore01",
    mode,
    sourceVaultId: overrides.sourceVaultId ?? preview.sourceVaultId,
    resultVaultId: overrides.resultVaultId ?? (
      mode === "replace_existing" ? preview.sourceVaultId : "vault_20260714_restorecore01"
    ),
    destinationIdentity: createRestoreDestinationIdentity(destinationPath, pathSafety),
    pathSafety,
    ...(overrides.onPhase ? { onPhase: overrides.onPhase } : {})
  };
}

function writeVaultFixture(vaultPath: string): readonly FixtureFile[] {
  const fixtures = PIGE_DURABLE_ROOTS.map((rootName) => DURABLE_FIXTURES[rootName]);
  writeFixtureFiles(vaultPath, fixtures);
  return fixtures;
}

function writeExcludedVaultFixtures(vaultPath: string): readonly FixtureFile[] {
  const fixtures = [
    { path: ".pige/db/vault.sqlite", canary: "excluded-rebuildable-db-canary" },
    { path: ".pige/indexes/index.bin", canary: "excluded-rebuildable-index-canary" },
    { path: ".pige/cache/tmp.bin", canary: "excluded-rebuildable-cache-canary" },
    { path: ".pige/runtime/vault-writer-owner.json", canary: "excluded-runtime-owner-canary" },
    { path: ".pige/models/private-model.bin", canary: "excluded-vault-model-canary" },
    { path: ".pige/tools/private-tool.bin", canary: "excluded-vault-tool-canary" },
    { path: ".pige/diagnostics/private.log", canary: "excluded-vault-diagnostics-canary" },
    { path: "unknown-model-cache/private.bin", canary: "excluded-unknown-cache-canary" }
  ] as const;
  writeFixtureFiles(vaultPath, fixtures);
  return fixtures;
}

function writeMachineLocalFixtures(appDataPath: string): readonly FixtureFile[] {
  const fixtures = [
    { path: "secrets/provider.key", canary: "excluded-machine-secret-canary" },
    { path: "models/qwen.bin", canary: "excluded-machine-model-canary" },
    { path: "tools/paddle.bin", canary: "excluded-machine-tool-canary" },
    { path: "diagnostics/crash.log", canary: "excluded-machine-diagnostics-canary" }
  ] as const;
  writeFixtureFiles(appDataPath, fixtures);
  return fixtures;
}

function writeFixtureFiles(rootPath: string, fixtures: readonly FixtureFile[]): void {
  for (const fixture of fixtures) {
    const targetPath = path.join(rootPath, ...fixture.path.split("/"));
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, fixture.canary, "utf8");
  }
}

async function readGeneratedBackup(backupPath: string): Promise<{
  readonly entries: ReadonlyMap<string, Buffer>;
  readonly manifest: BackupManifest;
  readonly manifestText: string;
}> {
  const entries = new Map<string, Buffer>();
  const zipFile = await openPromise(backupPath, { lazyEntries: false, validateEntrySizes: true, strictFileNames: true });
  try {
    for await (const entry of zipFile.eachEntry()) {
      if (entry.fileName.endsWith("/")) continue;
      const chunks: Buffer[] = [];
      const stream = await zipFile.openReadStreamPromise(entry);
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      entries.set(entry.fileName, Buffer.concat(chunks));
    }
  } finally {
    zipFile.close();
  }

  const manifestBuffer = entries.get(BACKUP_MANIFEST_ENTRY);
  if (!manifestBuffer) throw new Error("Generated backup manifest is missing.");
  const manifestText = manifestBuffer.toString("utf8");
  return {
    entries,
    manifest: BackupManifestSchema.parse(JSON.parse(manifestText) as unknown),
    manifestText
  };
}

function countManifestFiles(manifest: BackupManifest, prefix: string, suffix?: string): number {
  return manifest.files.filter((file) => file.path.startsWith(prefix) && (!suffix || file.path.endsWith(suffix))).length;
}

function checksumBuffer(buffer: Buffer): string {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

function readVaultManifestFixture(vaultPath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(vaultPath, ".pige/manifest.json"), "utf8")) as Record<string, unknown>;
}

function requireManifestFile(manifest: BackupManifest, filePath: string) {
  const file = manifest.files.find((candidate) => candidate.path === filePath);
  if (!file) throw new Error(`Missing manifest fixture file: ${filePath}`);
  return file;
}

function createDomainSchemaVersionFixture() {
  const version = { min: 1, max: 1 };
  return {
    markdownPages: version,
    sourceRecords: version,
    conversationEvents: version,
    jobs: version,
    proposals: version,
    operations: version,
    memory: version,
    skills: version,
    datasets: version
  };
}

async function rewriteBackupArchive(
  backupPath: string,
  mutate: (
    manifest: BackupManifest,
    entries: Map<string, Buffer>
  ) => BackupManifest
): Promise<void> {
  const archive = await readGeneratedBackup(backupPath);
  const entries = new Map(archive.entries);
  const manifest = mutate(archive.manifest, entries);
  entries.set(BACKUP_MANIFEST_ENTRY, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"));
  const stagingPath = `${backupPath}.rewrite`;
  const zip = new ZipFile();
  for (const [entryName, body] of entries) zip.addBuffer(body, entryName);
  zip.end();
  await pipeline(zip.outputStream, fs.createWriteStream(stagingPath, { flags: "wx" }));
  fs.renameSync(stagingPath, backupPath);
}

function isBackupStagingPath(candidatePath: string, backupPath: string): boolean {
  const candidateName = path.basename(candidatePath);
  return path.dirname(candidatePath) === path.dirname(backupPath) &&
    candidateName.startsWith(`.${path.basename(backupPath)}.`) &&
    candidateName.endsWith(".tmp");
}

function listBackupStagingFiles(backupPath: string): readonly string[] {
  return fs.readdirSync(path.dirname(backupPath))
    .map((entry) => path.join(path.dirname(backupPath), entry))
    .filter((entryPath) => isBackupStagingPath(entryPath, backupPath))
    .sort();
}

async function writeCustomBackupZip(
  backupPath: string,
  input: {
    readonly manifestFile: { readonly path: string; readonly size: number; readonly checksum: string };
    readonly entryBody: string;
    readonly manifestExtras?: Readonly<Record<string, unknown>>;
  }
): Promise<void> {
  const vaultManifestBody = Buffer.from(`${JSON.stringify({
    vault_id: "vault_20260709_testid",
    vault_schema_version: 1,
    created_at: "2026-07-09T12:00:00.000Z",
    updated_at: "2026-07-09T12:00:00.000Z",
    app_min_version: "0.1.0",
    default_locale: "en",
    durable_roots: [...PIGE_DURABLE_ROOTS],
    rebuildable_roots: [...PIGE_REBUILDABLE_ROOTS]
  }, null, 2)}\n`, "utf8");
  const vaultManifestFile = {
    path: ".pige/manifest.json",
    size: vaultManifestBody.byteLength,
    checksum: checksumBuffer(vaultManifestBody)
  };
  const vaultConfigBody = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    sourceStorage: {
      defaultStrategy: "copy_to_source_library",
      sourceAssetRootKind: "inside_vault",
      inVaultSourceAssetRoot: "raw"
    },
    backup: {
      includeConversations: true,
      includeVaultMemory: true,
      includeTrash: true
    },
    memory: { vaultMemoryEnabled: true }
  }, null, 2)}\n`, "utf8");
  const vaultConfigFile = {
    path: ".pige/config.json",
    size: vaultConfigBody.byteLength,
    checksum: checksumBuffer(vaultConfigBody)
  };
  const manifest = {
    format: "pige-backup",
    formatVersion: 1,
    appVersion: "0.1.0-test",
    vaultId: "vault_20260709_testid",
    vaultName: "Unsafe",
    vaultSchemaVersion: 1,
    createdAt: "2026-07-09T12:00:00.000Z",
    fileCount: 3,
    totalBytes: input.manifestFile.size + vaultManifestFile.size + vaultConfigFile.size,
    noteCount: 0,
    sourceCount: 0,
    conversationCount: 0,
    memoryCount: 0,
    includesSecrets: false,
    includes: {
      markdownKnowledge: true,
      sourceRecords: true,
      managedSourceCopies: true,
      conversations: true,
      vaultMemory: true,
      trash: true,
      rebuildableDatabaseCache: false,
      secrets: false
    },
    excludedRoots: [".pige/db", ".pige/indexes", ".pige/cache"],
    externalDependencies: [],
    ...input.manifestExtras,
    files: [input.manifestFile, vaultManifestFile, vaultConfigFile]
  };
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"), "pige-backup-manifest.json");
  if (!input.manifestFile.path.startsWith("../")) {
    zip.addBuffer(Buffer.from(input.entryBody, "utf8"), `vault/${input.manifestFile.path}`);
  }
  zip.addBuffer(vaultManifestBody, "vault/.pige/manifest.json");
  zip.addBuffer(vaultConfigBody, "vault/.pige/config.json");
  zip.end();
  await pipeline(zip.outputStream, fs.createWriteStream(backupPath));
}

async function writeDuplicateBackupZip(
  backupPath: string,
  duplicateKind: "manifest" | "vault entry"
): Promise<void> {
  const entryBody = "duplicate entry body";
  const manifest = {
    format: "pige-backup",
    formatVersion: 1,
    appVersion: "0.1.0-test",
    vaultId: "vault_20260709_testid",
    vaultName: "Duplicate",
    vaultSchemaVersion: 1,
    createdAt: "2026-07-09T12:00:00.000Z",
    fileCount: 1,
    totalBytes: Buffer.byteLength(entryBody),
    noteCount: 1,
    sourceCount: 0,
    conversationCount: 0,
    memoryCount: 0,
    includesSecrets: false,
    includes: {
      markdownKnowledge: true,
      sourceRecords: true,
      managedSourceCopies: true,
      conversations: true,
      vaultMemory: true,
      trash: true,
      rebuildableDatabaseCache: false,
      secrets: false
    },
    excludedRoots: [".pige/db", ".pige/indexes", ".pige/cache"],
    externalDependencies: [],
    files: [{
      path: "wiki/note.md",
      size: Buffer.byteLength(entryBody),
      checksum: checksumBuffer(Buffer.from(entryBody, "utf8"))
    }]
  };
  const manifestBody = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const zip = new ZipFile();
  zip.addBuffer(manifestBody, BACKUP_MANIFEST_ENTRY);
  if (duplicateKind === "manifest") zip.addBuffer(manifestBody, BACKUP_MANIFEST_ENTRY);
  zip.addBuffer(Buffer.from(entryBody, "utf8"), "vault/wiki/note.md");
  if (duplicateKind === "vault entry") {
    zip.addBuffer(Buffer.from(entryBody, "utf8"), "vault/wiki/note.md");
  }
  zip.end();
  await pipeline(zip.outputStream, fs.createWriteStream(backupPath));
}
