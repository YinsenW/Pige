import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OperationRecordSchema } from "@pige/schemas";
import { BackupConversationPreferenceService } from "../../apps/desktop/src/main/services/backup-conversation-preference-service";
import { createVaultOnDisk, loadVaultSummary, readVaultConfig } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-conversation-backup-preference-"));
  roots.push(root);
  const vaultPath = path.join(root, "Vault");
  createVaultOnDisk({ parentDirectory: root, vaultName: "Vault", appDataPath: path.join(root, "app-data"), tempPath: path.join(root, "temp") });
  const vault = loadVaultSummary(vaultPath);
  let active = true;
  let blocked = false;
  const service = () => new BackupConversationPreferenceService({
    vault: {
      current: () => active ? vault : undefined,
      activeVaultPath: () => active ? vaultPath : undefined,
      assertWriterLease: (candidate) => { if (!active || candidate !== vaultPath) throw new Error("stale binding"); }
    },
    hasActiveBackupJob: () => blocked,
    now: () => "2026-08-01T00:00:00.000Z"
  });
  return { root, vaultPath, vault, service, block: (value = true) => { blocked = value; }, deactivate: () => { active = false; } };
}

function operation(value: ReturnType<typeof fixture>) {
  const directory = path.join(value.vaultPath, ".pige", "operations", "2026", "08");
  const file = fs.readdirSync(directory).find((entry) => entry.endsWith(".json"))!;
  return OperationRecordSchema.parse(JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")));
}

describe("BackupConversationPreferenceService", () => {
  it("commits a revision-fenced exclusion, recovers its Operation, and replays exactly once", () => {
    const value = fixture();
    const before = value.service().summary();
    const request = {
      apiVersion: 1 as const,
      requestId: "backupconversationreq_abcdefghijklmnop",
      activeVaultId: value.vault.vaultId,
      expectedRevision: before.revision,
      includeConversations: false
    };
    const result = value.service().update(request);
    expect(result).toMatchObject({ status: "updated", summary: { includeConversations: false, canUpdate: true } });
    expect(readVaultConfig(value.vaultPath).backup.includeConversations).toBe(false);
    expect(value.service().update(request)).toEqual(result);

    const committed = operation(value);
    const operationFile = path.join(value.vaultPath, ".pige", "operations", "2026", "08", `${committed.id}.json`);
    fs.rmSync(operationFile);
    expect(value.service().recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    expect(operation(value).id).toBe(committed.id);
    expect(JSON.stringify(committed)).not.toContain(value.root);
  });

  it("publishes an Activity and restores the exact prior setting through Undo and restart", () => {
    const value = fixture();
    const before = value.service().summary();
    value.service().update({
      apiVersion: 1,
      requestId: "backupconversationreq_undoabcdefghijkl",
      activeVaultId: value.vault.vaultId,
      expectedRevision: before.revision,
      includeConversations: false
    });
    const committed = operation(value);
    expect(value.service().activitySummary(committed)).toMatchObject({ kind: "change_setting", status: "applied", canUndo: true });
    const undone = value.service().undo(committed);
    expect(undone.status).toBe("undone");
    expect(readVaultConfig(value.vaultPath).backup.includeConversations).toBe(true);
    const operations = fs.readdirSync(path.join(value.vaultPath, ".pige", "operations", "2026", "08"))
      .map((file) => OperationRecordSchema.parse(JSON.parse(fs.readFileSync(path.join(value.vaultPath, ".pige", "operations", "2026", "08", file), "utf8"))));
    const undo = value.service().findUndoOperation(committed, operations);
    expect(value.service().activitySummary(committed, undo)).toMatchObject({ status: "undone", canUndo: false });
    expect(value.service().undo(committed).status).toBe("already_undone");
    expect(value.service().recoverIncompleteOperations()).toEqual({ recovered: 0, failed: 0 });
  });

  it("blocks update and Undo while Backup work is active and fails stale authority closed", () => {
    const value = fixture();
    const before = value.service().summary();
    value.block();
    expect(value.service().update({
      apiVersion: 1,
      requestId: "backupconversationreq_blockedabcdefghij",
      activeVaultId: value.vault.vaultId,
      expectedRevision: before.revision,
      includeConversations: false
    })).toMatchObject({ status: "blocked", summary: { includeConversations: true, canUpdate: false } });
    value.block(false);
    value.service().update({
      apiVersion: 1,
      requestId: "backupconversationreq_commitabcdefghijkl",
      activeVaultId: value.vault.vaultId,
      expectedRevision: before.revision,
      includeConversations: false
    });
    const committed = operation(value);
    value.block();
    expect(value.service().undo(committed).status).toBe("stale");
    value.deactivate();
    expect(() => value.service().summary()).toThrow();
  });
});
