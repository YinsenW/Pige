import { describe, expect, it } from "vitest";
import { CollectionRenameTableRequestSchema, CollectionRenameTableResultSchema } from "@pige/schemas";

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
