import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { afterEach, describe, expect, it } from "vitest";
import { ZipFile } from "yazl";
import { BackupRestoreService } from "../../apps/desktop/src/main/services/backup-service";
import { createVaultOnDisk, isPigeVault, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const tempRoots: string[] = [];

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
    expect(fs.readFileSync(path.join(restored.restoredVaultPath!, "wiki/note.md"), "utf8")).toContain("Durable note");
    expect(fs.readFileSync(path.join(restored.restoredVaultPath!, "raw/source.txt"), "utf8")).toBe("managed source");
    expect(fs.existsSync(path.join(restored.restoredVaultPath!, ".pige/source-records/source.json"))).toBe(true);
    expect(fs.existsSync(path.join(restored.restoredVaultPath!, ".pige/db"))).toBe(true);
    expect(fs.existsSync(path.join(restored.restoredVaultPath!, ".pige/indexes"))).toBe(true);
    expect(fs.existsSync(path.join(restored.restoredVaultPath!, ".pige/cache"))).toBe(true);
    expect(fs.existsSync(path.join(restored.restoredVaultPath!, ".pige/db/vault.sqlite"))).toBe(false);
    expect(fs.existsSync(path.join(restored.restoredVaultPath!, ".pige/cache/tmp.bin"))).toBe(false);
    expect(fs.existsSync(path.join(restored.restoredVaultPath!, ".pige/indexes/index.bin"))).toBe(false);
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

function writeVaultFixture(vaultPath: string): void {
  fs.mkdirSync(path.join(vaultPath, "wiki"), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, "sources"), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, "raw"), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, "artifacts"), { recursive: true });
  fs.writeFileSync(path.join(vaultPath, "wiki/note.md"), "# Durable note\n", "utf8");
  fs.writeFileSync(path.join(vaultPath, "sources/source.md"), "# Source page\n", "utf8");
  fs.writeFileSync(path.join(vaultPath, "raw/source.txt"), "managed source", "utf8");
  fs.writeFileSync(path.join(vaultPath, "artifacts/ocr.txt"), "ocr text", "utf8");
  fs.writeFileSync(path.join(vaultPath, ".pige/source-records/source.json"), "{}", "utf8");
  fs.writeFileSync(path.join(vaultPath, ".pige/conversations/conversation.jsonl"), "{}\n", "utf8");
  fs.writeFileSync(path.join(vaultPath, ".pige/memory/memory.json"), "{}", "utf8");
  fs.writeFileSync(path.join(vaultPath, ".pige/jobs/job.json"), "{}", "utf8");
  fs.writeFileSync(path.join(vaultPath, ".pige/proposals/proposal.json"), "{}", "utf8");
  fs.writeFileSync(path.join(vaultPath, ".pige/operations/operation.json"), "{}", "utf8");
  fs.writeFileSync(path.join(vaultPath, ".pige/skills/skill.md"), "# Skill\n", "utf8");
  fs.writeFileSync(path.join(vaultPath, ".pige/trash/deleted.md"), "# Deleted\n", "utf8");
  fs.writeFileSync(path.join(vaultPath, ".pige/db/vault.sqlite"), "db cache", "utf8");
  fs.writeFileSync(path.join(vaultPath, ".pige/indexes/index.bin"), "index cache", "utf8");
  fs.writeFileSync(path.join(vaultPath, ".pige/cache/tmp.bin"), "temp cache", "utf8");
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
