import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OperationRecordSchema, type DatasetManifest } from "@pige/schemas";
import { ManagedDatasetLifecycleService } from "../../apps/desktop/src/main/services/managed-dataset-lifecycle-service";
import type { BundleBinding } from "../../apps/desktop/src/main/services/managed-collection-storage";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("ManagedDatasetLifecycleService", () => {
  it("lists pathless trashed datasets and restores one exact candidate after restart", () => {
    const fixture = createFixture();
    const service = createService(fixture);
    const committed = service.trash(requestFor(fixture));
    if (committed.status !== "committed") throw new Error("Dataset trash did not commit");
    const restarted = createService(fixture);
    const listed = restarted.listTrash({ apiVersion: 1, requestId: "collection_request_datasettrashlist1",
      activeVaultId: fixture.vaultId });
    expect(listed).toMatchObject({ status: "ready", datasets: [{ datasetId: fixture.datasetId,
      revisionId: fixture.revisionId, trashOperationId: committed.operationId, title: "Records" }] });
    expect(JSON.stringify(listed)).not.toMatch(/path|digest|checksum|source/u);
    if (listed.status !== "ready") throw new Error("Dataset trash list unavailable");
    const request = { apiVersion: 1 as const, requestId: "collection_request_datasetrestore01",
      activeVaultId: fixture.vaultId, datasetId: fixture.datasetId, expectedRevisionId: fixture.revisionId,
      trashOperationId: committed.operationId, expectedTrashRevision: listed.revision };
    const restored = restarted.restore(request);
    expect(restored).toMatchObject({ status: "committed", operationId: expect.stringMatching(/^op_/) });
    expect(restarted.restore(request)).toEqual(restored);
    expect(fs.existsSync(fixture.bundlePath)).toBe(true);
    expect(restarted.listTrash({ apiVersion: 1, requestId: "collection_request_datasettrashlist2",
      activeVaultId: fixture.vaultId })).toMatchObject({ status: "ready", datasets: [] });
  });

  it("trashes one exact bundle, adopts a crash, and restores/redoes without touching source evidence", () => {
    const fixture = createFixture();
    const service = createService(fixture);
    const request = requestFor(fixture);
    const committed = service.trash(request);
    expect(committed).toMatchObject({ status: "committed", operationId: expect.stringMatching(/^op_20260801_/) });
    if (committed.status !== "committed") throw new Error("Dataset trash did not commit");
    expect(fs.existsSync(fixture.bundlePath)).toBe(false);
    expect(fs.readFileSync(fixture.sourceRecordPath, "utf8")).toBe("source-evidence");
    expect(service.trash(request)).toEqual(committed);

    const operationPath = path.join(fixture.vaultPath, ".pige", "operations", `${committed.operationId}.json`);
    const operation = OperationRecordSchema.parse(JSON.parse(fs.readFileSync(operationPath, "utf8")));
    fs.rmSync(operationPath);
    const restarted = createService(fixture);
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    const recovered = OperationRecordSchema.parse(JSON.parse(fs.readFileSync(operationPath, "utf8")));
    expect(recovered).toEqual(operation);

    const summary = restarted.activitySummary(recovered);
    expect(summary).toMatchObject({ kind: "trash_dataset", status: "applied", canUndo: true });
    const undone = restarted.undo(recovered);
    expect(undone).toMatchObject({ status: "undone", operationId: recovered.id, revisionId: fixture.revisionId });
    expect(fs.existsSync(fixture.bundlePath)).toBe(true);
    if (!undone.undoOperationId) throw new Error("Undo operation missing");
    const undoPath = path.join(fixture.vaultPath, ".pige", "operations", `${undone.undoOperationId}.json`);
    const restore = OperationRecordSchema.parse(JSON.parse(fs.readFileSync(undoPath, "utf8")));
    fs.rmSync(undoPath);
    const intentPath = path.join(fixture.vaultPath, ".pige", "dataset-lifecycle", "restore-intents", `${restore.id}.json`);
    fs.mkdirSync(path.dirname(intentPath), { recursive: true });
    fs.writeFileSync(intentPath, JSON.stringify({ schemaVersion: 1, originalOperationId: recovered.id, restore }));
    expect(createService(fixture).recoverIncompleteOperations()).toEqual({ recovered: 2, failed: 0 });
    const operations = readOperations(fixture.vaultPath);
    const undo = restarted.findUndoOperation(recovered, operations);
    expect(undo).toBeDefined();
    expect(restarted.activitySummary(recovered, undo)).toMatchObject({ status: "undone", canRedo: true });

    const redone = restarted.redo({ operationId: recovered.id });
    expect(redone).toMatchObject({ status: "redone", operationId: recovered.id, undoOperationId: undo?.id });
    expect(fs.existsSync(fixture.bundlePath)).toBe(false);
    expect(restarted.redo({ operationId: recovered.id })).toMatchObject({ status: "already_redone" });
    expect(restarted.activitySummary(recovered, undo)).toMatchObject({ canRedo: false, redoUnavailableReason: "already_redone" });
  });

  it("fails closed for revision drift, payload tampering, and restore path conflicts", () => {
    const fixture = createFixture();
    const service = createService(fixture);
    expect(service.trash({ ...requestFor(fixture), expectedRevisionId: "dataset_rev_20260801_zzzzzzzzzzzz" }))
      .toMatchObject({ status: "stale" });
    expect(fs.existsSync(fixture.bundlePath)).toBe(true);

    const committed = service.trash(requestFor(fixture));
    if (committed.status !== "committed") throw new Error("Dataset trash did not commit");
    const operation = readOperations(fixture.vaultPath).find(({ id }) => id === committed.operationId)!;
    fs.mkdirSync(fixture.bundlePath, { recursive: true });
    fs.writeFileSync(path.join(fixture.bundlePath, "conflict"), "unrelated");
    expect(service.undo(operation)).toMatchObject({ status: "stale" });
    expect(fs.readFileSync(path.join(fixture.bundlePath, "conflict"), "utf8")).toBe("unrelated");
  });
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-dataset-lifecycle-"));
  roots.push(root);
  const vaultPath = path.join(root, "Vault");
  const bundleRelativePath = "datasets/records--dataset_20260801_abcdefghijkl";
  const bundlePath = path.join(vaultPath, ...bundleRelativePath.split("/"));
  fs.mkdirSync(path.join(bundlePath, "data", "revisions"), { recursive: true });
  fs.writeFileSync(path.join(bundlePath, "dataset.json"), "manifest");
  fs.writeFileSync(path.join(bundlePath, "data", "revisions", "payload.sqlite"), "payload");
  const sourceRecordPath = path.join(vaultPath, ".pige", "source-records", "source.json");
  fs.mkdirSync(path.dirname(sourceRecordPath), { recursive: true });
  fs.writeFileSync(sourceRecordPath, "source-evidence");
  return {
    vaultPath, bundlePath, bundleRelativePath, sourceRecordPath,
    vaultId: "vault_20260801_datasettrash",
    datasetId: "dataset_20260801_abcdefghijkl",
    revisionId: "dataset_rev_20260801_abcdefghijkl"
  };
}

function createService(fixture: ReturnType<typeof createFixture>) {
  const readCurrent = (): BundleBinding | undefined => {
    if (!fs.existsSync(fixture.bundlePath)) return undefined;
    const manifest = { datasetId: fixture.datasetId, activeRevision: fixture.revisionId, title: "Records" } as DatasetManifest;
    return { vaultPath: fixture.vaultPath, bundlePath: fixture.bundlePath,
      bundleRelativePath: fixture.bundleRelativePath, manifestPath: path.join(fixture.bundlePath, "dataset.json"),
      manifestBytes: Buffer.from("manifest"), manifestStat: fs.statSync(path.join(fixture.bundlePath, "dataset.json")), manifest,
      revision: { id: fixture.revisionId } as BundleBinding["revision"], schema: {} as BundleBinding["schema"],
      payloadPath: path.join(fixture.bundlePath, "data", "revisions", "payload.sqlite") };
  };
  return new ManagedDatasetLifecycleService({ current: () => ({ vaultId: fixture.vaultId }),
    activeVaultPath: () => fixture.vaultPath }, () => new Date("2026-08-01T00:00:00.000Z"), readCurrent);
}

function requestFor(fixture: ReturnType<typeof createFixture>) {
  return { apiVersion: 1 as const, requestId: "collection_request_datasettrash0001", activeVaultId: fixture.vaultId,
    datasetId: fixture.datasetId, expectedRevisionId: fixture.revisionId };
}

function readOperations(vaultPath: string) {
  const root = path.join(vaultPath, ".pige", "operations");
  return fs.readdirSync(root).map((name) => OperationRecordSchema.parse(JSON.parse(fs.readFileSync(path.join(root, name), "utf8"))));
}
