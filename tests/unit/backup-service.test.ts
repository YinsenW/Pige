import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { afterEach, describe, expect, it } from "vitest";
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
