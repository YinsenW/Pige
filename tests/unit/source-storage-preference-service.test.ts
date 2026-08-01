import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OperationRecordSchema } from "@pige/schemas";
import { SourceStoragePreferenceService } from "../../apps/desktop/src/main/services/source-storage-preference-service";
import {
  createVaultOnDisk,
  loadVaultSummary,
  readVaultConfig,
  updateVaultSourceStorageStrategy
} from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-source-storage-preference-"));
  roots.push(root);
  const vaultPath = path.join(root, "Vault");
  createVaultOnDisk({ parentDirectory: root, vaultName: "Vault", appDataPath: path.join(root, "app-data"), tempPath: path.join(root, "temp") });
  const sentinel = path.join(vaultPath, "raw", "files", "existing-source.bin");
  fs.mkdirSync(path.dirname(sentinel), { recursive: true });
  fs.writeFileSync(sentinel, "existing source bytes");
  let current = loadVaultSummary(vaultPath), active = true;
  const vault = {
    current: () => active ? current : undefined,
    activeVaultPath: () => active ? vaultPath : undefined,
    assertWriterLease: (candidate: string) => { if (!active || candidate !== vaultPath) throw new Error("stale binding"); },
    applySourceStorageStrategy: (strategy: "copy_to_source_library" | "reference_original") => {
      current = updateVaultSourceStorageStrategy(vaultPath, strategy); return current;
    },
    refreshActiveVaultSummary: () => { current = loadVaultSummary(vaultPath); return current; }
  };
  const service = () => new SourceStoragePreferenceService(vault, () => "2026-08-02T00:00:00.000Z");
  return { root, vaultPath, sentinel, vault: () => current, service, deactivate: () => { active = false; } };
}

function operations(value: ReturnType<typeof fixture>) {
  const directory = path.join(value.vaultPath, ".pige", "operations", "2026", "08");
  return fs.existsSync(directory) ? fs.readdirSync(directory).map((file) =>
    OperationRecordSchema.parse(JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")))) : [];
}

describe("SourceStoragePreferenceService", () => {
  it("commits one exact future-capture policy without moving existing source bytes and replays once", () => {
    const value = fixture(), before = value.vault();
    const request = { apiVersion: 1 as const, requestId: "sourcepolicyreq_abcdefghijklmnop",
      activeVaultId: before.vaultId, expectedRevision: before.managedCopyRoot.sourceStorageRevision,
      defaultStrategy: "reference_original" as const };
    const result = value.service().update(request);
    expect(result).toMatchObject({ status: "updated", summary: { defaultStrategy: "reference_original" } });
    expect(value.service().update(request)).toEqual(result);
    expect(readVaultConfig(value.vaultPath).sourceStorage.defaultStrategy).toBe("reference_original");
    expect(fs.readFileSync(value.sentinel, "utf8")).toBe("existing source bytes");
    const committed = operations(value)[0]!;
    expect(JSON.stringify(committed)).not.toContain(value.root);
    fs.rmSync(path.join(value.vaultPath, ".pige", "operations", "2026", "08", `${committed.id}.json`));
    expect(value.service().recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    expect(operations(value).map(({ id }) => id)).toEqual([committed.id]);
  });

  it("finishes an interrupted Undo intent after the process restarts", () => {
    const value = fixture(), before = value.vault();
    const requestId = "sourcepolicyreq_crashundoabcdefg";
    value.service().update({ apiVersion: 1, requestId, activeVaultId: before.vaultId,
      expectedRevision: before.managedCopyRoot.sourceStorageRevision, defaultStrategy: "reference_original" });
    const forward = operations(value)[0]!;
    const receiptRoot = path.join(value.vaultPath, ".pige", "source-storage-preference-receipts", requestId);
    fs.writeFileSync(path.join(receiptRoot, "undo.json"),
      '{"schemaVersion":1,"kind":"source_storage_preference_undo"}\n');
    const config = readVaultConfig(value.vaultPath);
    updateVaultSourceStorageStrategy(value.vaultPath, "copy_to_source_library");
    expect(config.sourceStorage.defaultStrategy).toBe("reference_original");
    expect(value.service().recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    const undo = value.service().findUndoOperation(forward, operations(value));
    expect(undo).toBeDefined();
    expect(readVaultConfig(value.vaultPath).sourceStorage.defaultStrategy).toBe("copy_to_source_library");
  });

  it("restores the prior strategy through Activity Undo and adopts an interrupted Undo after restart", () => {
    const value = fixture(), before = value.vault();
    value.service().update({ apiVersion: 1, requestId: "sourcepolicyreq_undoabcdefghijkl",
      activeVaultId: before.vaultId, expectedRevision: before.managedCopyRoot.sourceStorageRevision,
      defaultStrategy: "reference_original" });
    const forward = operations(value)[0]!;
    expect(value.service().activitySummary(forward)).toMatchObject({ status: "applied", canUndo: true });
    expect(value.service().undo(forward)).toMatchObject({ status: "undone" });
    expect(readVaultConfig(value.vaultPath).sourceStorage.defaultStrategy).toBe("copy_to_source_library");
    const all = operations(value), undo = value.service().findUndoOperation(forward, all);
    expect(value.service().activitySummary(forward, undo)).toMatchObject({ status: "undone", canUndo: false });
    expect(value.service().recoverIncompleteOperations()).toEqual({ recovered: 0, failed: 0 });
    expect(fs.readFileSync(value.sentinel, "utf8")).toBe("existing source bytes");
  });

  it("fails stale and cross-vault requests before changing config", () => {
    const value = fixture(), before = value.vault();
    expect(value.service().update({ apiVersion: 1, requestId: "sourcepolicyreq_staleabcdefghijk",
      activeVaultId: before.vaultId, expectedRevision: `ssrev_${"f".repeat(64)}`,
      defaultStrategy: "reference_original" })).toMatchObject({ status: "stale" });
    expect(value.service().update({ apiVersion: 1, requestId: "sourcepolicyreq_wrongvaultabcdef",
      activeVaultId: "vault_20260802_other01", expectedRevision: before.managedCopyRoot.sourceStorageRevision,
      defaultStrategy: "reference_original" })).toMatchObject({ status: "not_found" });
    expect(readVaultConfig(value.vaultPath).sourceStorage.defaultStrategy).toBe("copy_to_source_library");
    value.deactivate();
  });
});
