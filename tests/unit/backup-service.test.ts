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
import { BackupRestoreService } from "../../apps/desktop/src/main/services/backup-service";
import {
  PIGE_DURABLE_ROOTS,
  PIGE_REBUILDABLE_ROOTS,
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-backup-test-"));
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
    const preview = await new BackupRestoreService().previewRestore(backupPath);
    const restored = await new BackupRestoreService().applyRestore(backupPath, restoreParent);

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
    expect(fs.existsSync(path.join(restored.restoredVaultPath!, ".pige/db/vault.sqlite"))).toBe(false);
    expect(fs.existsSync(path.join(restored.restoredVaultPath!, ".pige/cache/tmp.bin"))).toBe(false);
    expect(fs.existsSync(path.join(restored.restoredVaultPath!, ".pige/indexes/index.bin"))).toBe(false);
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
    expect(archive.manifest.excludedRoots).toEqual([...PIGE_REBUILDABLE_ROOTS]);
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
    await expect(new BackupRestoreService().previewRestore(backupPath)).resolves.toMatchObject({
      status: "ready",
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

    await expect(new BackupRestoreService().previewRestore(backupPath)).rejects.toMatchObject({
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

    const preview = await new BackupRestoreService().previewRestore(backupPath);

    expect(preview.invalidFileCount).toBe(1);
    await expect(new BackupRestoreService().applyRestore(backupPath, path.join(root, "restore"))).rejects.toMatchObject({
      code: "restore.backup_invalid"
    });
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

    await expect(new BackupRestoreService().previewRestore(backupPath)).rejects.toMatchObject({
      code: "restore.entry_invalid"
    });
  });
});

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
  input: { readonly manifestFile: { readonly path: string; readonly size: number; readonly checksum: string }; readonly entryBody: string }
): Promise<void> {
  const manifest = {
    format: "pige-backup",
    formatVersion: 1,
    appVersion: "0.1.0-test",
    vaultId: "vault_20260709_testid",
    vaultName: "Unsafe",
    vaultSchemaVersion: 1,
    createdAt: "2026-07-09T12:00:00.000Z",
    fileCount: 1,
    totalBytes: input.manifestFile.size,
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
    files: [input.manifestFile]
  };
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"), "pige-backup-manifest.json");
  if (!input.manifestFile.path.startsWith("../")) {
    zip.addBuffer(Buffer.from(input.entryBody, "utf8"), `vault/${input.manifestFile.path}`);
  }
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
