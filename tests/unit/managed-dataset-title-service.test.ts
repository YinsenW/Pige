import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DatasetManifestSchema, DatasetRevisionSchema, DatasetSchemaRecordSchema, OperationRecordSchema } from "@pige/schemas";
import { ManagedDatasetTitleService } from "../../apps/desktop/src/main/services/managed-dataset-title-service";
import { fileRef, operationPathFor, readBundle, readOperationRecords } from "../../apps/desktop/src/main/services/managed-collection-storage";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("ManagedDatasetTitleService", () => {
  it("renames a stable Dataset through an immutable metadata revision and exact Undo/restart recovery", async () => {
    const fixture = createFixture();
    const service = createService(fixture);
    const request = { apiVersion: 1 as const, requestId: "collection_request_datasetrename001",
      activeVaultId: fixture.vaultId, datasetId: fixture.datasetId,
      expectedRevisionId: fixture.revisionId, title: "Research records" };
    const committed = await service.rename(request);
    expect(committed).toMatchObject({ status: "committed", title: "Research records" });
    if (committed.status !== "committed") throw new Error("Dataset rename did not commit");
    const renamed = readBundle(fixture.vaultPath, fixture.datasetId)!;
    expect(renamed.manifest.datasetId).toBe(fixture.datasetId);
    expect(renamed.manifest.title).toBe("Research records");
    expect(renamed.revision.parentRevisionId).toBe(fixture.revisionId);
    expect(renamed.revision.change).toEqual({ kind: "dataset_title_rename", previousTitle: "Records", title: "Research records" });
    expect(renamed.revision.payload.path).toBe("data/revisions/initial.sqlite");
    expect(await service.rename(request)).toEqual(committed);

    const operationPath = operationPathFor(fixture.vaultPath, committed.operationId);
    const operation = OperationRecordSchema.parse(JSON.parse(fs.readFileSync(operationPath, "utf8")));
    expect(service.activitySummary(operation)).toMatchObject({ kind: "rename_dataset", targetLabel: "Research records",
      status: "applied", canUndo: true });
    fs.rmSync(operationPath);
    const restarted = createService(fixture);
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    const recovered = OperationRecordSchema.parse(JSON.parse(fs.readFileSync(operationPath, "utf8")));
    expect(recovered).toEqual(operation);

    const undone = await restarted.undo(recovered, committed.revisionId);
    expect(undone).toMatchObject({ status: "undone", operationId: recovered.id });
    const restored = readBundle(fixture.vaultPath, fixture.datasetId)!;
    expect(restored.manifest.datasetId).toBe(fixture.datasetId);
    expect(restored.manifest.title).toBe("Records");
    expect(restored.revision.change).toMatchObject({ kind: "dataset_title_rename_undo", title: "Records",
      undoOfOperationId: recovered.id });
    const operations = readOperationRecords(fixture.vaultPath);
    const undo = restarted.findUndoOperation(recovered, operations);
    expect(undo?.id).toBe(undone.undoOperationId);
    expect(restarted.activitySummary(recovered, undo)).toMatchObject({ status: "undone", canUndo: false });
  });

  it("fails closed on revision drift and preserves the authoritative title", async () => {
    const fixture = createFixture();
    const result = await createService(fixture).rename({ apiVersion: 1,
      requestId: "collection_request_datasetrename002", activeVaultId: fixture.vaultId,
      datasetId: fixture.datasetId, expectedRevisionId: "dataset_rev_20260801_zzzzzzzzzzzz", title: "Other" });
    expect(result).toEqual({ apiVersion: 1, requestId: "collection_request_datasetrename002",
      activeVaultId: fixture.vaultId, datasetId: fixture.datasetId,
      expectedRevisionId: "dataset_rev_20260801_zzzzzzzzzzzz", status: "stale",
      currentRevisionId: fixture.revisionId, title: "Records" });
    expect(readBundle(fixture.vaultPath, fixture.datasetId)?.manifest.title).toBe("Records");
  });
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-dataset-title-")); roots.push(root);
  const vaultPath = path.join(root, "Vault");
  const datasetId = "dataset_20260801_abcdefghijkl";
  const revisionId = "dataset_rev_20260801_abcdefghijkl";
  const bundlePath = path.join(vaultPath, "datasets", `records--${datasetId}`);
  fs.mkdirSync(path.join(bundlePath, "data", "revisions"), { recursive: true });
  fs.mkdirSync(path.join(bundlePath, "schemas"), { recursive: true });
  fs.mkdirSync(path.join(bundlePath, "revisions"), { recursive: true });
  fs.writeFileSync(path.join(bundlePath, "data", "revisions", "initial.sqlite"), "payload");
  const schema = DatasetSchemaRecordSchema.parse({ schemaVersion: 1, datasetId, revisionId,
    tables: [{ id: "table_abcdefghijkl", name: "records", sourceLocator: "csv:records", ordinal: 0,
      rowCount: 0, columnCount: 1, columns: [{ id: "column_abcdefghijkl", name: "name", ordinal: 0,
        logicalType: "string", nullable: true, sourceType: "text" }] }], createdAt: "2026-08-01T00:00:00.000Z" });
  fs.writeFileSync(path.join(bundlePath, "schemas", `${revisionId}.json`), `${JSON.stringify(schema, null, 2)}\n`);
  const revision = DatasetRevisionSchema.parse({ schemaVersion: 1, id: revisionId, datasetId, parentRevisionId: null,
    source: { sourceId: "src_20260801_abcdefghijkl", sourceKind: "csv_file",
      sourceRecordHash: `sha256:${"a".repeat(64)}`, sourceAssetChecksum: `sha256:${"b".repeat(64)}`, sourceAssetSize: 7 },
    schema: fileRef(bundlePath, `schemas/${revisionId}.json`),
    payload: { ...fileRef(bundlePath, "data/revisions/initial.sqlite"), format: "sqlite" },
    adapter: { id: "csv", version: "1" }, writer: { id: "dataset", version: "1" },
    stats: { tableCount: 1, rowCount: 0, columnCount: 1, cellCount: 0, retainedValueBytes: 0 }, warnings: [],
    operationId: "op_20260801_abcdefghijkl", change: { kind: "initial_import" }, createdAt: "2026-08-01T00:00:00.000Z" });
  fs.writeFileSync(path.join(bundlePath, "revisions", `${revisionId}.json`), `${JSON.stringify(revision, null, 2)}\n`);
  const manifest = DatasetManifestSchema.parse({ format: "pige-dataset", formatVersion: 1, datasetId,
    profile: "managed_collection", title: "Records", sourceId: revision.source.sourceId,
    activeRevision: revisionId, revision: fileRef(bundlePath, `revisions/${revisionId}.json`),
    schema: revision.schema, payload: revision.payload,
    compatibility: { minReaderFormatVersion: 1, maxReaderFormatVersion: 1 },
    createdAt: revision.createdAt, updatedAt: revision.createdAt });
  fs.writeFileSync(path.join(bundlePath, "dataset.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { vaultPath, bundlePath, datasetId, revisionId, vaultId: "vault_20260801_datasettitle" };
}

function createService(fixture: ReturnType<typeof createFixture>) {
  return new ManagedDatasetTitleService({ current: () => ({ vaultId: fixture.vaultId } as never),
    activeVaultPath: () => fixture.vaultPath });
}
