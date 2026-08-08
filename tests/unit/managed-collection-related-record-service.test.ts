import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CollectionOpenRelatedRecordsRequest,
  CollectionSnapshot
} from "@pige/schemas";
import type { BundleBinding } from "../../apps/desktop/src/main/services/managed-collection-storage";

const storageMocks = vi.hoisted(() => ({
  readBundle: vi.fn(),
  readCollectionSnapshot: vi.fn()
}));

vi.mock("../../apps/desktop/src/main/services/managed-collection-storage", () => storageMocks);

import { ManagedCollectionRelatedRecordService } from "../../apps/desktop/src/main/services/managed-collection-related-record-service";

const roots: string[] = [];

afterEach(() => {
  storageMocks.readBundle.mockReset();
  storageMocks.readCollectionSnapshot.mockReset();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("ManagedCollectionRelatedRecordService", () => {
  it("opens the exact target row through a read-only bounded projection", () => {
    const fixture = makeFixture();
    const service = new ManagedCollectionRelatedRecordService({
      current: () => ({ vaultId: "vault_20260808_relrecords01" }),
      activeVaultPath: () => fixture.vaultPath
    });
    storageMocks.readBundle.mockReturnValue(fixture.binding);
    storageMocks.readCollectionSnapshot.mockImplementation((_binding: BundleBinding, tableId: string, projection?: { readonly rowIds?: readonly string[] }) => {
      if (tableId === fixture.sourceTableId) return fixture.sourceSnapshot;
      if (tableId !== fixture.targetTableId) return undefined;
      return projection?.rowIds
        ? { ...fixture.targetSnapshot, rows: fixture.targetSnapshot.rows.filter((row) => projection.rowIds?.includes(row.rowId)), returnedRowCount: 1 }
        : fixture.targetSnapshot;
    });

    const result = service.open(request(fixture));

    expect(result).toMatchObject({
      status: "ready",
      sourceTableId: fixture.sourceTableId,
      sourceColumnId: fixture.sourceColumnId,
      sourceRowId: fixture.sourceRowId,
      targetTableId: fixture.targetTableId,
      targetRowId: fixture.targetRowId,
      snapshot: {
        tableId: fixture.targetTableId,
        rows: [{ rowId: fixture.targetRowId }],
        returnedRowCount: 1,
        truncated: false
      }
    });
    expect(storageMocks.readCollectionSnapshot).toHaveBeenLastCalledWith(
      fixture.binding,
      fixture.targetTableId,
      { rowIds: [fixture.targetRowId] }
    );
  });

  it("returns a stale source snapshot before reading relation cells when the revision changed", () => {
    const fixture = makeFixture();
    const service = new ManagedCollectionRelatedRecordService({
      current: () => ({ vaultId: "vault_20260808_relrecords01" }),
      activeVaultPath: () => fixture.vaultPath
    });
    storageMocks.readBundle.mockReturnValue({
      ...fixture.binding,
      manifest: { ...fixture.binding.manifest, activeRevision: "dataset_rev_20260808_relrecords01" }
    });
    storageMocks.readCollectionSnapshot.mockReturnValue(fixture.sourceSnapshot);

    const result = service.open({ ...request(fixture), expectedRevisionId: "dataset_rev_20260807_oldrecords01" });

    expect(result).toMatchObject({ status: "stale", snapshot: { tableId: fixture.sourceTableId } });
    expect(storageMocks.readCollectionSnapshot).toHaveBeenCalledOnce();
  });

  it("fails closed when a relation target row belongs to another table", () => {
    const fixture = makeFixture();
    const database = new DatabaseSync(fixture.payloadPath);
    database.prepare("UPDATE pige_dataset_rows SET table_id = ? WHERE row_id = ?").run(
      "table_othertarget01",
      fixture.targetRowId
    );
    database.close();
    const service = new ManagedCollectionRelatedRecordService({
      current: () => ({ vaultId: "vault_20260808_relrecords01" }),
      activeVaultPath: () => fixture.vaultPath
    });
    storageMocks.readBundle.mockReturnValue(fixture.binding);
    storageMocks.readCollectionSnapshot.mockReturnValue(fixture.sourceSnapshot);

    expect(service.open(request(fixture))).toMatchObject({
      status: "not_found",
      sourceTableId: fixture.sourceTableId,
      sourceRowId: fixture.sourceRowId
    });
  });
});

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-related-record-service-"));
  roots.push(root);
  const payloadPath = path.join(root, "data.sqlite");
  const database = new DatabaseSync(payloadPath);
  database.exec(`
    CREATE TABLE pige_dataset_rows (row_id TEXT PRIMARY KEY, table_id TEXT NOT NULL, ordinal INTEGER NOT NULL, source_ordinal INTEGER NOT NULL);
    CREATE TABLE pige_dataset_cells (row_id TEXT NOT NULL, column_id TEXT NOT NULL, state TEXT NOT NULL, projection_kind TEXT, projection_json TEXT, formula_json TEXT);
  `);
  database.prepare("INSERT INTO pige_dataset_rows VALUES (?, ?, ?, ?)").run("row_sourcerelated01", "table_sourcerelated01", 0, 1);
  database.prepare("INSERT INTO pige_dataset_rows VALUES (?, ?, ?, ?)").run("row_targetrelated01", "table_targetrelated01", 0, 1);
  database.prepare("INSERT INTO pige_dataset_cells VALUES (?, ?, ?, ?, ?, ?)").run(
    "row_sourcerelated01",
    "column_relationrelated01",
    "value",
    "pige_relation_target_v1",
    JSON.stringify({ kind: "pige_relation_target", schemaVersion: 1, targetRowId: "row_targetrelated01" }),
    null
  );
  database.close();

  const sourceTableId = "table_sourcerelated01";
  const targetTableId = "table_targetrelated01";
  const sourceColumnId = "column_relationrelated01";
  const sourceRowId = "row_sourcerelated01";
  const targetRowId = "row_targetrelated01";
  const sourceSnapshot = snapshot(sourceTableId, "People", sourceRowId, "Ada", sourceColumnId, true);
  const targetSnapshot = snapshot(targetTableId, "Companies", targetRowId, "Acme", "column_targetname01", false);
  const binding = {
    payloadPath,
    manifest: { activeRevision: "dataset_rev_20260808_relrecords01" },
    schema: {
      tables: [{
        id: sourceTableId,
        columns: [{ id: sourceColumnId, relation: { targetTableId, targetDisplayColumnId: "column_targetname01" } }]
      }, { id: targetTableId, columns: [{ id: "column_targetname01" }] }]
    }
  } as unknown as BundleBinding;
  return { vaultPath: root, payloadPath, binding, sourceTableId, targetTableId, sourceColumnId, sourceRowId, targetRowId, sourceSnapshot, targetSnapshot };
}

function request(fixture: ReturnType<typeof makeFixture>): CollectionOpenRelatedRecordsRequest {
  return {
    apiVersion: 1,
    requestId: "collection_request_relatedservice01",
    activeVaultId: "vault_20260808_relrecords01",
    datasetId: "dataset_20260808_relrecords01",
    sourceTableId: fixture.sourceTableId,
    sourceColumnId: fixture.sourceColumnId,
    sourceRowId: fixture.sourceRowId,
    expectedRevisionId: "dataset_rev_20260808_relrecords01"
  };
}

function snapshot(
  tableId: string,
  tableName: string,
  rowId: string,
  label: string,
  columnId: string,
  relation: boolean
): CollectionSnapshot {
  return {
    datasetId: "dataset_20260808_relrecords01",
    revisionId: "dataset_rev_20260808_relrecords01",
    title: "Related records",
    tableId,
    tableName,
    columns: [{
      columnId,
      label: relation ? "Company" : "Name",
      logicalType: "string",
      canRename: true,
      canTrash: !relation,
      canUseAsFormulaOperand: false,
      canEditFormula: false,
      ...(relation ? {
        canEditRelation: true,
        relation: { kind: "pige_single_relation" as const, schemaVersion: 1 as const, targetTableId: "table_targetrelated01", targetDisplayColumnId: "column_targetname01" }
      } : { canUseAsRelationDisplay: true })
    }],
    rows: [{
      rowId,
      cells: [{ columnId, value: relation ? { kind: "relation" as const, targetRowId: "row_targetrelated01", displayLabel: "Acme" } : label, editable: true }],
      canTrash: !relation,
      hasInboundRelationReferences: relation
    }],
    totalRowCount: 1,
    returnedRowCount: 1,
    truncated: false,
    canAppendDefaultRow: false,
    canAddColumn: false,
    canAddFormulaColumn: false,
    views: []
  };
}
