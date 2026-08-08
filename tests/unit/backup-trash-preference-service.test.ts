import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OperationRecordSchema } from "@pige/schemas";
import { BackupTrashPreferenceService } from "../../apps/desktop/src/main/services/backup-trash-preference-service";
import { createVaultOnDisk, loadVaultSummary, readVaultConfig } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-trash-backup-preference-"));
  roots.push(root);
  const vaultPath = path.join(root, "Vault");
  createVaultOnDisk({ parentDirectory: root, vaultName: "Vault", appDataPath: path.join(root, "app-data"), tempPath: path.join(root, "temp") });
  const vault = loadVaultSummary(vaultPath);
  let blocked = false;
  const service = () => new BackupTrashPreferenceService({
    vault: {
      current: () => vault,
      activeVaultPath: () => vaultPath,
      assertWriterLease: (candidate) => { if (candidate !== vaultPath) throw new Error("stale binding"); }
    },
    hasActiveBackupJob: () => blocked,
    now: () => "2026-08-01T00:00:00.000Z"
  });
  return { vaultPath, vault, service, block: (value = true) => { blocked = value; } };
}

function operations(value: ReturnType<typeof fixture>) {
  const directory = path.join(value.vaultPath, ".pige", "operations", "2026", "08");
  return fs.existsSync(directory) ? fs.readdirSync(directory).map((file) =>
    OperationRecordSchema.parse(JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")))) : [];
}

describe("BackupTrashPreferenceService", () => {
  it("commits an exact revision-fenced preference and persists it across restart", () => {
    const value = fixture();
    const before = value.service().summary();
    const request = {
      apiVersion: 1 as const,
      requestId: "backuptrashreq_abcdefghijklmnop",
      activeVaultId: value.vault.vaultId,
      expectedRevision: before.revision,
      includeTrash: false
    };
    expect(value.service().update(request)).toMatchObject({ status: "updated", summary: { includeTrash: false } });
    expect(readVaultConfig(value.vaultPath).backup.includeTrash).toBe(false);
    expect(value.service().summary()).toMatchObject({ includeTrash: false });
    const operationFiles = fs.readdirSync(path.join(value.vaultPath, ".pige", "operations", "2026", "08"));
    expect(operationFiles).toHaveLength(1);
    expect(fs.readFileSync(path.join(value.vaultPath, ".pige", "operations", "2026", "08", operationFiles[0]!), "utf8"))
      .toContain("backup.includeTrash");
  });

  it("blocks while backup work is active and fails stale revisions closed", () => {
    const value = fixture();
    const before = value.service().summary();
    value.block();
    expect(value.service().update({
      apiVersion: 1,
      requestId: "backuptrashreq_blockedabcdefghij",
      activeVaultId: value.vault.vaultId,
      expectedRevision: before.revision,
      includeTrash: false
    })).toMatchObject({ status: "blocked", summary: { includeTrash: true, canUpdate: false } });
    value.block(false);
    expect(value.service().update({
      apiVersion: 1,
      requestId: "backuptrashreq_staleabcdefghijkl",
      activeVaultId: value.vault.vaultId,
      expectedRevision: `backuptrashrev_${"0".repeat(64)}`,
      includeTrash: false
    })).toMatchObject({ status: "stale", summary: { includeTrash: true } });
  });

  it("keeps trash preference Undo and Redo receipt-bound across restart", () => {
    const value = fixture(), before = value.service().summary();
    value.service().update({
      apiVersion: 1,
      requestId: "backuptrashreq_redoabcdefghijkl",
      activeVaultId: value.vault.vaultId,
      expectedRevision: before.revision,
      includeTrash: false
    });
    const forward = operations(value)[0]!;
    expect(value.service().undo(forward)).toMatchObject({ status: "undone" });
    const undo = value.service().findUndoOperation(forward, operations(value));
    expect(value.service().activitySummary(forward, undo)).toMatchObject({ status: "undone", canRedo: true });
    value.block();
    expect(value.service().redo({ operationId: forward.id })).toMatchObject({ status: "stale" });
    expect(readVaultConfig(value.vaultPath).backup.includeTrash).toBe(true);
    value.block(false);
    expect(value.service().redo({ operationId: forward.id })).toMatchObject({ status: "redone", undoOperationId: undo!.id });
    expect(readVaultConfig(value.vaultPath).backup.includeTrash).toBe(false);
    expect(value.service().redo({ operationId: forward.id })).toMatchObject({ status: "already_redone" });
  });
});
