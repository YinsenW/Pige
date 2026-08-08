import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CollectionAnalyticalSnapshotCitationResultSchema,
  CollectionAnalyticalSnapshotCreateResultSchema,
  CollectionAnalyticalSnapshotListResultSchema,
  CollectionAnalyticalSnapshotOpenResultSchema,
  CollectionSnapshotSchema,
  OperationRecordSchema
} from "@pige/schemas";
import {
  AnalyticalSnapshotService,
  type AnalyticalSnapshotServiceVaultPort
} from "../../apps/desktop/src/main/services/analytical-snapshot-service";
import * as storage from "../../apps/desktop/src/main/services/managed-collection-storage";

vi.mock("../../apps/desktop/src/main/services/managed-collection-storage", async () => {
  const actual = await vi.importActual<typeof storage>("../../apps/desktop/src/main/services/managed-collection-storage");
  return { ...actual, readBundle: vi.fn(), readImmutableCollectionRevision: vi.fn(), readCollectionSnapshot: vi.fn() };
});

const vaultId = "vault_20260809_analyticalsnap";
const datasetId = "dataset_20260809_analyticalsnap";
const revisionId = "dataset_rev_20260809_analyticalsnap";
const tableId = "table_analyticalsnap01";
const columnId = "column_abcdefghijkl";
const rowId = "row_analyticalsnap01";
const roots: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("AnalyticalSnapshotService", () => {
  it("creates one immutable descriptor, re-adopts it after restart, browses bounded rows, and cites a row", () => {
    const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-analytical-snapshot-"));
    roots.push(vaultPath);
    const binding = makeBinding();
    vi.mocked(storage.readBundle).mockReturnValue(binding as never);
    vi.mocked(storage.readImmutableCollectionRevision).mockReturnValue(binding as never);
    vi.mocked(storage.readCollectionSnapshot).mockReturnValue(makeSnapshot() as never);
    expect(() => CollectionSnapshotSchema.parse(makeSnapshot())).not.toThrow();
    const port: AnalyticalSnapshotServiceVaultPort = { current: () => ({ vaultId }), activeVaultPath: () => vaultPath };
    const request = { requestId: "collection_request_snapshotrestartabcdefgh", activeVaultId: vaultId, datasetId, tableId, expectedRevisionId: revisionId };

    const first = new AnalyticalSnapshotService(port).create(request);
    expect(first.status).toBe("committed");
    if (first.status !== "committed") throw new Error("Snapshot was not committed");
    expect(fs.readdirSync(path.join(vaultPath, ".pige", "analytical-snapshots"))).toHaveLength(1);
    const operation = OperationRecordSchema.parse(readFirstJson(vaultPath, ".pige/operations"));
    expect(operation).toMatchObject({ kind: "create_dataset_snapshot", reversible: "no" });
    expect(JSON.stringify(first)).not.toMatch(/\/private|\.sqlite|payload|path/u);

    const operationPath = findJson(vaultPath, ".pige/operations");
    fs.rmSync(operationPath);
    const adopted = new AnalyticalSnapshotService(port).create(request);
    expect(adopted).toEqual({ status: "already_committed", record: first.record });
    expect(fs.existsSync(operationPath)).toBe(true);

    const listed = new AnalyticalSnapshotService(port).list(vaultId);
    expect(CollectionAnalyticalSnapshotListResultSchema.parse({ apiVersion: 1, requestId: request.requestId, activeVaultId: vaultId, status: "ready", snapshots: listed })).toMatchObject({ snapshots: [{ snapshotId: first.record.snapshotId }] });
    const opened = new AnalyticalSnapshotService(port).open(vaultId, first.record.snapshotId);
    expect(CollectionAnalyticalSnapshotOpenResultSchema.parse({ apiVersion: 1, requestId: request.requestId, activeVaultId: vaultId, snapshotId: first.record.snapshotId, ...opened })).toMatchObject({ status: "ready", preview: { returnedRowCount: 1, truncated: false } });
    const cited = new AnalyticalSnapshotService(port).openCitation(vaultId, first.record.snapshotId, rowId);
    expect(CollectionAnalyticalSnapshotCitationResultSchema.parse({ apiVersion: 1, requestId: request.requestId, activeVaultId: vaultId, snapshotId: first.record.snapshotId, rowId, ...cited })).toMatchObject({ status: "ready", citation: { rowId } });
  });

  it("fails closed when the active revision or vault identity drifts", () => {
    const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-analytical-snapshot-drift-"));
    roots.push(vaultPath);
    const binding = makeBinding();
    vi.mocked(storage.readBundle).mockReturnValue(binding as never);
    const port: AnalyticalSnapshotServiceVaultPort = { current: () => ({ vaultId }), activeVaultPath: () => vaultPath };
    const service = new AnalyticalSnapshotService(port);
    expect(service.create({ requestId: "collection_request_snapshotdriftabcdefgh", activeVaultId: vaultId, datasetId, tableId, expectedRevisionId: "dataset_rev_20260809_otherrevision" })).toEqual({ status: "stale" });
    expect(service.create({ requestId: "collection_request_snapshotwrongvaultabcdefgh", activeVaultId: "vault_20260809_otheractive", datasetId, tableId, expectedRevisionId: revisionId })).toEqual({ status: "stale" });
    expect(fs.existsSync(path.join(vaultPath, ".pige", "analytical-snapshots"))).toBe(false);
  });
});

function makeBinding(): Record<string, unknown> {
  const file = { path: "data/revisions/revision.sqlite", checksum: `sha256:${"a".repeat(64)}`, size: 1 };
  const table = {
    id: tableId, name: "Events", sourceLocator: "events", ordinal: 0, rowCount: 1, columnCount: 1,
    columns: [{ id: columnId, name: "Name", ordinal: 0, sourceType: "text", logicalType: "string", nullable: false }]
  };
  const schema = { schemaVersion: 1, datasetId, revisionId, tables: [table], createdAt: "2026-08-09T00:00:00.000Z" };
  const revision = { schemaVersion: 1, id: revisionId, datasetId, parentRevisionId: null,
    source: { sourceId: "src_20260809_analyticalsnap", sourceKind: "csv_file", sourceRecordHash: `sha256:${"b".repeat(64)}`, sourceAssetChecksum: `sha256:${"c".repeat(64)}`, sourceAssetSize: 1 },
    schema: file, payload: file, adapter: { id: "test", version: "1" }, writer: { id: "test", version: "1" },
    stats: { tableCount: 1, rowCount: 1, columnCount: 1, cellCount: 1, retainedValueBytes: 1 }, warnings: [], operationId: "op_20260809_analytical01", change: { kind: "initial_import" }, createdAt: "2026-08-09T00:00:00.000Z" };
  return { vaultPath: "/private/vault", bundlePath: "/private/vault/datasets/dataset", bundleRelativePath: "datasets/dataset", manifestPath: "/private/vault/datasets/dataset/dataset.json", manifestBytes: Buffer.from("{}"), manifestStat: {} as fs.Stats,
    manifest: { format: "pige-dataset", formatVersion: 1, datasetId, profile: "managed_collection", title: "Events", sourceId: "src_20260809_analyticalsnap", activeRevision: revisionId, revision: file, schema: file, payload: { ...file, format: "sqlite" }, compatibility: { minReaderFormatVersion: 1, maxReaderFormatVersion: 1 }, createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z" }, revision, schema, payloadPath: "/private/vault/datasets/dataset/data/revisions/revision.sqlite" };
}

function makeSnapshot() {
  return {
    datasetId,
    revisionId,
    title: "Events",
    tableId,
    tableName: "Events",
    columns: [{
      columnId,
      label: "Name",
      logicalType: "string",
      canRename: false,
      canTrash: false,
      canUseAsFormulaOperand: false,
      canEditFormula: false
    }],
    rows: [{
      rowId,
      cells: [{ columnId, value: "Launch", editable: true }],
      canTrash: false
    }],
    totalRowCount: 1,
    returnedRowCount: 1,
    truncated: false,
    canAppendDefaultRow: true,
    canAddColumn: true,
    canAddFormulaColumn: false,
    canAddRelationColumn: false,
    canAddLookupColumn: false,
    canAddRollupColumn: false,
    canTrashTable: true,
    views: []
  };
}

function findJson(root: string, relative: string): string {
  const directory = path.join(root, relative);
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = findJson(root, path.join(relative, entry.name));
      if (found) return found;
    } else if (entry.name.endsWith(".json")) return absolute;
  }
  throw new Error("Missing JSON file");
}

function readFirstJson(root: string, relative: string): unknown {
  return JSON.parse(fs.readFileSync(findJson(root, relative), "utf8"));
}
