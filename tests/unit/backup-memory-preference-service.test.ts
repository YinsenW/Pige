import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OperationRecordSchema } from "@pige/schemas";
import { BackupMemoryPreferenceService } from "../../apps/desktop/src/main/services/backup-memory-preference-service";
import { createVaultOnDisk, loadVaultSummary, readVaultConfig } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-memory-backup-preference-"));
  roots.push(root);
  const vaultPath = path.join(root, "Vault");
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Vault",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp")
  });
  const vault = loadVaultSummary(vaultPath);
  let active = true;
  let blocked = false;
  const service = () => new BackupMemoryPreferenceService({
    vault: {
      current: () => active ? vault : undefined,
      activeVaultPath: () => active ? vaultPath : undefined,
      assertWriterLease: (candidate) => {
        if (!active || candidate !== vaultPath) throw new Error("stale binding");
      }
    },
    hasActiveBackupJob: () => blocked,
    now: () => "2026-07-31T00:00:00.000Z"
  });
  return { root, vaultPath, vault, service, block: () => { blocked = true; }, deactivate: () => { active = false; } };
}

function operations(value: ReturnType<typeof fixture>) {
  const directory = path.join(value.vaultPath, ".pige", "operations", "2026", "07");
  return fs.existsSync(directory) ? fs.readdirSync(directory).map((file) =>
    OperationRecordSchema.parse(JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")))) : [];
}

describe("BackupMemoryPreferenceService", () => {
  it("persists one revision-fenced portable choice with a path-free setting Operation", () => {
    const value = fixture();
    const before = value.service().summary();
    const request = {
      apiVersion: 1 as const,
      requestId: "backupmemoryreq_abcdefghijklmnop",
      activeVaultId: value.vault.vaultId,
      expectedRevision: before.revision,
      includeVaultMemory: false
    };
    const result = value.service().update(request);

    expect(result).toMatchObject({ status: "updated", summary: { includeVaultMemory: false, canUpdate: true } });
    expect(result.summary.revision).not.toBe(before.revision);
    expect(readVaultConfig(value.vaultPath).backup.includeVaultMemory).toBe(false);
    expect(value.service().summary()).toEqual(result.summary);
    const operationText = fs.readFileSync(
      path.join(value.vaultPath, ".pige/operations/2026/07", fs.readdirSync(path.join(value.vaultPath, ".pige/operations/2026/07"))[0]!),
      "utf8"
    );
    expect(operationText).toContain('"id": "memory.includeMemoryInBackup"');
    expect(operationText).not.toContain(value.root);
    expect(value.service().update(request)).toEqual(result);
  });

  it("blocks while Backup work is active and preserves the previous choice", () => {
    const value = fixture();
    const before = value.service().summary();
    value.block();
    expect(value.service().update({
      apiVersion: 1,
      requestId: "backupmemoryreq_blockedabcdefghz",
      activeVaultId: value.vault.vaultId,
      expectedRevision: before.revision,
      includeVaultMemory: false
    })).toMatchObject({ status: "blocked", summary: { includeVaultMemory: true, canUpdate: false } });
    expect(readVaultConfig(value.vaultPath).backup.includeVaultMemory).toBe(true);
  });

  it("restores and redos one exact memory preference after restart without a duplicate effect", () => {
    const value = fixture(), before = value.service().summary();
    value.service().update({
      apiVersion: 1,
      requestId: "backupmemoryreq_redoabcdefghijkl",
      activeVaultId: value.vault.vaultId,
      expectedRevision: before.revision,
      includeVaultMemory: false
    });
    const forward = operations(value)[0]!;
    expect(value.service().activitySummary(forward)).toMatchObject({ status: "applied", canUndo: true });
    expect(value.service().undo(forward)).toMatchObject({ status: "undone" });
    const undo = value.service().findUndoOperation(forward, operations(value));
    expect(undo).toBeDefined();
    expect(value.service().activityState(forward, undo)).toEqual({ canRedo: true });
    expect(value.service().redo({ operationId: forward.id })).toMatchObject({ status: "redone", undoOperationId: undo!.id });
    const redo = operations(value).find((operation) => operation.sourceRefs.some((reference) => reference.id === forward.id));
    expect(redo).toBeDefined();
    expect(readVaultConfig(value.vaultPath).backup.includeVaultMemory).toBe(false);
    fs.rmSync(path.join(value.vaultPath, ".pige", "operations", "2026", "07", `${redo!.id}.json`));
    expect(value.service().recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    expect(value.service().redo({ operationId: forward.id })).toMatchObject({ status: "already_redone", redoOperationId: redo!.id });
  });
});
