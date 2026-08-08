import { describe, expect, it } from "vitest";
import {
  CollectionAddTableRequestSchema,
  CollectionAddTableResultSchema,
  CollectionRenameTableRequestSchema,
  CollectionRenameTableResultSchema,
  CollectionTrashTableRequestSchema,
  CollectionTrashTableResultSchema
} from "@pige/schemas";

describe("Managed Collection table add contract", () => {
  it("keeps generated table authority in Main and returns only the created safe snapshot", () => {
    const request = CollectionAddTableRequestSchema.parse({ apiVersion: 1,
      requestId: "collection_request_tableaddcontract", activeVaultId: "vault_20260808_tableadd",
      datasetId: "dataset_20260808_abcdefghijkl", expectedRevisionId: "dataset_rev_20260808_abcdefghijkl", name: "Projects" });
    const snapshot = { datasetId: request.datasetId, revisionId: "dataset_rev_20260808_bcdefghijklm",
      title: "Contacts", tableId: "table_bcdefghijklm", tableName: request.name,
      columns: [{ columnId: "column_abcdefghijkl", label: "Name", logicalType: "string", canRename: true,
        canTrash: true, canUseAsFormulaOperand: false, canEditFormula: false }], rows: [], totalRowCount: 0,
      returnedRowCount: 0, truncated: false, canAppendDefaultRow: true, canAddColumn: true, canAddFormulaColumn: false, views: [] };
    expect(CollectionAddTableResultSchema.parse({ apiVersion: request.apiVersion, requestId: request.requestId,
      activeVaultId: request.activeVaultId, datasetId: request.datasetId, name: request.name, status: "committed", tableId: snapshot.tableId,
      operationId: "op_20260808_abcdefghijkl", snapshot })).toMatchObject({ status: "committed", snapshot: { tableName: "Projects" } });
    expect(() => CollectionAddTableRequestSchema.parse({ ...request, tableId: "table_rendererowned" })).toThrow();
    expect(() => CollectionAddTableResultSchema.parse({ ...request, status: "failed", path: "/tmp/private" })).toThrow();
  });
});

describe("Managed Collection table rename contract", () => {
  it("binds stable identity and accepts only authoritative body-free results", () => {
    const request = CollectionRenameTableRequestSchema.parse({ apiVersion: 1,
      requestId: "collection_request_tablerenamecontract", activeVaultId: "vault_20260802_tablerename",
      datasetId: "dataset_20260802_abcdefghijkl", tableId: "table_abcdefghijkl",
      expectedRevisionId: "dataset_rev_20260802_abcdefghijkl", name: "People" });
    const snapshot = { datasetId: request.datasetId, revisionId: "dataset_rev_20260802_bcdefghijklm",
      title: "Contacts", tableId: request.tableId, tableName: request.name,
      columns: [{ columnId: "column_abcdefghijkl", label: "Name", logicalType: "string",
        canRename: true, canTrash: true, canUseAsFormulaOperand: false, canEditFormula: false }],
      rows: [], totalRowCount: 0, returnedRowCount: 0, truncated: false,
      canAppendDefaultRow: true, canAddColumn: true, canAddFormulaColumn: false, views: [] };
    expect(CollectionRenameTableResultSchema.parse({ apiVersion: 1, requestId: request.requestId,
      activeVaultId: request.activeVaultId, datasetId: request.datasetId, tableId: request.tableId,
      name: request.name, status: "committed", operationId: "op_20260802_abcdefghijkl", snapshot }))
      .toMatchObject({ status: "committed", snapshot: { tableId: request.tableId, tableName: "People" } });
    expect(() => CollectionRenameTableRequestSchema.parse({ ...request, path: "/tmp/private" })).toThrow();
    expect(() => CollectionRenameTableResultSchema.parse({ apiVersion: 1, requestId: request.requestId,
      activeVaultId: request.activeVaultId, datasetId: request.datasetId, tableId: request.tableId,
      name: request.name, status: "committed", operationId: "op_20260802_abcdefghijkl",
      snapshot: { ...snapshot, tableName: "Wrong" } })).toThrow();
  });
});

describe("Managed Collection table trash contract", () => {
  it("binds only current immutable revision identity and never exposes table contents", () => {
    const request = CollectionTrashTableRequestSchema.parse({ apiVersion: 1,
      requestId: "collection_request_trashtablecontract", activeVaultId: "vault_20260802_tabletrash",
      datasetId: "dataset_20260802_abcdefghijkl", tableId: "table_abcdefghijkl",
      expectedRevisionId: "dataset_rev_20260802_abcdefghijkl" });
    const committed = CollectionTrashTableResultSchema.parse({ apiVersion: 1, requestId: request.requestId,
      activeVaultId: request.activeVaultId, datasetId: request.datasetId, tableId: request.tableId,
      status: "committed", operationId: "op_20260802_abcdefghijkl", revisionId: "dataset_rev_20260802_bcdefghijklm" });
    expect(committed).toMatchObject({ status: "committed", revisionId: "dataset_rev_20260802_bcdefghijklm" });
    expect(() => CollectionTrashTableRequestSchema.parse({ ...request, path: "/tmp/private" })).toThrow();
    expect(() => CollectionTrashTableResultSchema.parse({ ...committed, body: "private table contents" })).toThrow();
  });
});
