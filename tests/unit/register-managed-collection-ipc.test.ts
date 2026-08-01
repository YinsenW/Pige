import { describe, expect, it, vi } from "vitest";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { registerManagedCollectionIpc } from "../../apps/desktop/src/main/register-managed-collection-ipc";

type IpcHandler = (event: IpcMainInvokeEvent, request?: unknown) => unknown;

const activeVaultId = "vault_20260727_collection";
const openRequest = {
  apiVersion: 1,
  requestId: "collection_request_abcdefghijklmnop",
  activeVaultId,
  datasetId: "dataset_20260727_abcdefghijkl",
  tableId: "table_abcdefghijkl"
} as const;
const revealRequest = {
  ...openRequest,
  requestId: "collection_reveal_abcdefghijklmnop",
  revisionId: "dataset_rev_20260727_abcdefghijkl"
} as const;
const listRequest = {
  apiVersion: 1,
  activeVaultId,
  limit: 20
} as const;
const citationRequest = {
  apiVersion: 1,
  requestId: "collection_request_citationabcdefgh",
  activeVaultId,
  conversationId: "conv_20260727_citationabcdefgh",
  assistantEventId: "evt_20260727_citationabcdefgh",
  citationRef: "citation_10"
} as const;
const editRequest = {
  ...openRequest,
  requestId: "collection_request_qrstuvwxyzabcdef",
  expectedRevisionId: "dataset_rev_20260727_abcdefghijkl",
  rowId: "row_abcdefghijkl",
  columnId: "column_abcdefghijkl",
  value: "updated"
} as const;
const appendRequest = {
  ...openRequest,
  requestId: "collection_request_appendabcdefghij",
  expectedRevisionId: "dataset_rev_20260727_abcdefghijkl"
} as const;
const addColumnRequest = {
  ...openRequest,
  requestId: "collection_request_columnabcdefghij",
  expectedRevisionId: "dataset_rev_20260727_abcdefghijkl",
  label: "Owner",
  logicalType: "string"
} as const;
const updateFormulaRequest = {
  ...openRequest,
  requestId: "collection_request_formulaupdateipc",
  expectedRevisionId: "dataset_rev_20260727_abcdefghijkl",
  columnId: "column_formulaabcdef",
  expression: { kind: "binary", operator: "multiply", left: { kind: "column", columnId: "column_operandabcdef" }, right: { kind: "literal", value: 2 } }
} as const;
const addRelationRequest = {
  ...openRequest,
  requestId: "collection_request_relationaddipc01",
  expectedRevisionId: "dataset_rev_20260727_abcdefghijkl",
  label: "Owner",
  targetTableId: "table_targetabcdefgh",
  targetDisplayColumnId: "column_targetlabelabc"
} as const;
const addLookupRequest = {
  ...openRequest,
  requestId: "collection_request_lookupaddipc0001",
  expectedRevisionId: "dataset_rev_20260727_abcdefghijkl",
  label: "Company tier",
  relationColumnId: "column_relationabcdef",
  targetColumnId: "column_targettierabc"
} as const;
const addRollupRequest = {
  ...openRequest, requestId: "collection_request_rollupaddipc0001",
  expectedRevisionId: "dataset_rev_20260727_abcdefghijkl", label: "Company total",
  relationColumnId: "column_relationabcdef", aggregation: "sum", targetColumnId: "column_targetcount01"
} as const;
const updateRollupRequest = {
  ...openRequest, requestId: "collection_request_rollupupdateipc1",
  expectedRevisionId: "dataset_rev_20260727_abcdefghijkl", columnId: "column_rollupabcdef",
  relationColumnId: "column_relationabcdef", aggregation: "count"
} as const;
const editRelationRequest = {
  ...openRequest,
  requestId: "collection_request_relationeditipc1",
  expectedRevisionId: "dataset_rev_20260727_abcdefghijkl",
  rowId: "row_abcdefghijkl",
  columnId: "column_relationabcdef",
  targetRowId: "row_targetabcdefgh"
} as const;
const renameColumnRequest = {
  ...openRequest,
  requestId: "collection_request_renameabcdefghij",
  expectedRevisionId: "dataset_rev_20260727_abcdefghijkl",
  columnId: "column_abcdefghijkl",
  label: "Work item"
} as const;
const createViewRequest = {
  ...openRequest,
  requestId: "collection_request_viewabcdefghijkl",
  expectedRevisionId: "dataset_rev_20260727_abcdefghijkl",
  name: "Open tasks",
  filter: { operator: "eq", columnId: "column_abcdefghijkl", value: "Open" },
  sort: { columnId: "column_abcdefghijkl", direction: "asc" }
} as const;
const renameViewRequest = {
  ...openRequest,
  requestId: "collection_request_viewrenameabcdef",
  expectedRevisionId: "dataset_rev_20260727_abcdefghijkl",
  viewId: "view_abcdefghijkl",
  expectedViewRevision: 2,
  name: "Renamed"
} as const;
const updateViewRequest = {
  ...openRequest,
  requestId: "collection_request_viewupdateabcdef",
  expectedRevisionId: "dataset_rev_20260727_abcdefghijkl",
  viewId: "view_abcdefghijkl",
  expectedViewRevision: 2,
  filter: { operator: "is_null", columnId: "column_abcdefghijkl" }
} as const;
const trashViewRequest = {
  ...openRequest,
  requestId: "collection_request_viewtrashabcdefg",
  expectedRevisionId: "dataset_rev_20260727_abcdefghijkl",
  viewId: "view_abcdefghijkl",
  expectedViewRevision: 2
} as const;
const trashColumnRequest = {
  ...openRequest,
  requestId: "collection_request_trashcolumnabcde",
  expectedRevisionId: "dataset_rev_20260727_abcdefghijkl",
  columnId: "column_abcdefghijkl"
} as const;
const trashRowRequest = {
  ...openRequest,
  requestId: "collection_request_trashabcdefghijk",
  expectedRevisionId: "dataset_rev_20260727_abcdefghijkl",
  rowId: "row_abcdefghijkl"
} as const;

function makeHarness(options: {
  readonly getActiveVaultId?: () => string | undefined;
  readonly isTrustedSender?: () => boolean;
  readonly listCollections?: (request: typeof listRequest) => unknown;
  readonly openCollection?: (request: typeof openRequest) => unknown;
  readonly revealCollection?: (request: typeof revealRequest) => unknown;
  readonly openCollectionCitation?: (request: typeof citationRequest) => unknown;
  readonly editCollectionCell?: (request: typeof editRequest) => unknown;
  readonly appendDefaultCollectionRow?: (request: typeof appendRequest) => unknown;
  readonly addNullableCollectionColumn?: (request: typeof addColumnRequest) => unknown;
  readonly updateFormulaCollectionColumn?: (request: typeof updateFormulaRequest) => unknown;
  readonly addRelationCollectionColumn?: (request: typeof addRelationRequest) => unknown;
  readonly addLookupCollectionColumn?: (request: typeof addLookupRequest) => unknown;
  readonly addRollupCollectionColumn?: (request: typeof addRollupRequest) => unknown;
  readonly updateRollupCollectionColumn?: (request: typeof updateRollupRequest) => unknown;
  readonly editRelationCollectionCell?: (request: typeof editRelationRequest) => unknown;
  readonly renameCollectionColumn?: (request: typeof renameColumnRequest) => unknown;
  readonly createCollectionView?: (request: typeof createViewRequest) => unknown;
  readonly updateCollectionView?: (request: typeof updateViewRequest) => unknown;
  readonly renameCollectionView?: (request: typeof renameViewRequest) => unknown;
  readonly trashCollectionView?: (request: typeof trashViewRequest) => unknown;
  readonly trashCollectionColumn?: (request: typeof trashColumnRequest) => unknown;
  readonly trashCollectionRow?: (request: typeof trashRowRequest) => unknown;
} = {}) {
  const handlers = new Map<string, IpcHandler>();
  const listCollections = vi.fn(options.listCollections ?? ((request) => ({
    apiVersion: request.apiVersion,
    activeVaultId: request.activeVaultId,
    status: "ready",
    datasets: [],
    totalDatasetCount: 0,
    hasMore: false
  })));
  const openCollection = vi.fn(options.openCollection ?? ((request) => ({
    ...request,
    status: "ready",
    snapshot: {
      datasetId: request.datasetId,
      revisionId: "dataset_rev_20260727_abcdefghijkl",
      title: "Tasks",
      tableId: request.tableId,
      tableName: "Tasks",
      columns: [{ columnId: "column_abcdefghijkl", label: "Task", logicalType: "string", canRename: true, canTrash: true, canUseAsFormulaOperand: false, canEditFormula: false }],
      rows: [{
        rowId: "row_abcdefghijkl",
        cells: [{ columnId: "column_abcdefghijkl", value: "Draft", editable: true }],
        canTrash: true
      }],
      totalRowCount: 1,
      returnedRowCount: 1,
      truncated: false,
      canAppendDefaultRow: true,
      canAddColumn: true,
      canAddFormulaColumn: true,
      views: []
    }
  })));
  const openCollectionCitation = vi.fn(options.openCollectionCitation ?? ((request) => ({
    ...request,
    status: "not_found"
  })));
  const revealCollection = vi.fn(options.revealCollection ?? ((request) => ({
    ...request,
    status: "revealed"
  })));
  const appendDefaultCollectionRow = vi.fn(options.appendDefaultCollectionRow ?? ((request) => ({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    status: "not_found"
  })));
  const editCollectionCell = vi.fn(options.editCollectionCell ?? ((request) => ({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    rowId: request.rowId,
    columnId: request.columnId,
    status: "committed",
    revisionId: "dataset_rev_20260727_qrstuvwxyzab",
    operationId: "op_20260727_abcdefghijkl"
  })));
  const addNullableCollectionColumn = vi.fn(options.addNullableCollectionColumn ?? ((request) => ({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    status: "not_found"
  })));
  const updateFormulaCollectionColumn = vi.fn(options.updateFormulaCollectionColumn ?? ((request) => ({
    apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
    datasetId: request.datasetId, tableId: request.tableId, columnId: request.columnId, status: "failed"
  })));
  const addRelationCollectionColumn = vi.fn(options.addRelationCollectionColumn ?? ((request) => ({
    apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
    datasetId: request.datasetId, tableId: request.tableId, targetTableId: request.targetTableId,
    targetDisplayColumnId: request.targetDisplayColumnId, status: "not_found"
  })));
  const addLookupCollectionColumn = vi.fn(options.addLookupCollectionColumn ?? ((request) => ({
    apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
    datasetId: request.datasetId, tableId: request.tableId, relationColumnId: request.relationColumnId,
    targetColumnId: request.targetColumnId, status: "not_found"
  })));
  const addRollupCollectionColumn = vi.fn(options.addRollupCollectionColumn ?? ((request) => ({
    apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
    datasetId: request.datasetId, tableId: request.tableId, relationColumnId: request.relationColumnId,
    aggregation: request.aggregation, targetColumnId: request.targetColumnId, status: "not_found"
  })));
  const updateRollupCollectionColumn = vi.fn(options.updateRollupCollectionColumn ?? ((request) => ({
    apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
    datasetId: request.datasetId, tableId: request.tableId, columnId: request.columnId,
    relationColumnId: request.relationColumnId, aggregation: request.aggregation, status: "not_found"
  })));
  const editRelationCollectionCell = vi.fn(options.editRelationCollectionCell ?? ((request) => ({
    apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
    datasetId: request.datasetId, tableId: request.tableId, rowId: request.rowId,
    columnId: request.columnId, targetRowId: request.targetRowId, status: "not_found"
  })));
  const trashCollectionRow = vi.fn(options.trashCollectionRow ?? ((request) => ({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    rowId: request.rowId,
    status: "not_found"
  })));
  const renameCollectionColumn = vi.fn(options.renameCollectionColumn ?? ((request) => ({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    columnId: request.columnId,
    status: "not_found"
  })));
  const trashCollectionColumn = vi.fn(options.trashCollectionColumn ?? ((request) => ({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    columnId: request.columnId,
    status: "not_found"
  })));
  const createCollectionView = vi.fn(options.createCollectionView ?? ((request) => ({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    status: "not_found"
  })));
  const renameCollectionView = vi.fn(options.renameCollectionView ?? ((request) => ({
    apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
    datasetId: request.datasetId, tableId: request.tableId, viewId: request.viewId, status: "not_found"
  })));
  const updateCollectionView = vi.fn(options.updateCollectionView ?? ((request) => ({
    apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
    datasetId: request.datasetId, tableId: request.tableId, viewId: request.viewId, status: "not_found"
  })));
  const trashCollectionView = vi.fn(options.trashCollectionView ?? ((request) => ({
    apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
    datasetId: request.datasetId, tableId: request.tableId, viewId: request.viewId, status: "not_found"
  })));

  registerManagedCollectionIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler as IpcHandler)
    } as Pick<IpcMain, "handle">,
    isTrustedSender: options.isTrustedSender ?? (() => true),
    getActiveVaultId: options.getActiveVaultId ?? (() => activeVaultId),
    listCollections,
    openCollection,
    revealCollection,
    openCollectionCitation,
    editCollectionCell,
    appendDefaultCollectionRow,
    addNullableCollectionColumn,
    updateFormulaCollectionColumn,
    addRelationCollectionColumn,
    addLookupCollectionColumn,
    addRollupCollectionColumn,
    updateRollupCollectionColumn,
    editRelationCollectionCell,
    renameCollectionColumn,
    createCollectionView,
    updateCollectionView,
    renameCollectionView,
    trashCollectionView,
    trashCollectionColumn,
    trashCollectionRow
  });
  return {
    handlers,
    listCollections,
    openCollection,
    revealCollection,
    openCollectionCitation,
    editCollectionCell,
    appendDefaultCollectionRow,
    addNullableCollectionColumn,
    updateFormulaCollectionColumn,
    addRelationCollectionColumn,
    addLookupCollectionColumn,
    addRollupCollectionColumn,
    updateRollupCollectionColumn,
    editRelationCollectionCell,
    renameCollectionColumn,
    createCollectionView,
    updateCollectionView,
    renameCollectionView,
    trashCollectionView,
    trashCollectionColumn,
    trashCollectionRow
  };
}

describe("registerManagedCollectionIpc", () => {
  it("registers the bounded collection channels", () => {
    expect([...makeHarness().handlers.keys()]).toEqual([
      "collections.list",
      "collections.open",
      "collections.reveal",
      "collections.openCitation",
      "collections.editCell",
      "collections.appendDefaultRow",
      "collections.addNullableColumn",
      "collections.addFormulaColumn",
      "collections.updateFormulaColumn",
      "collections.addRelationColumn",
      "collections.editRelationCell",
      "collections.addLookupColumn",
      "collections.addRollupColumn",
      "collections.updateRollupColumn",
      "collections.renameColumn",
      "collections.createView",
      "collections.renameView",
      "collections.updateView",
      "collections.trashView",
      "collections.trashColumn",
      "collections.trashRow"
    ]);
  });

  it("reveals only an exact current Dataset identity through the trusted boundary", async () => {
    const accepted = makeHarness();
    await expect(accepted.handlers.get("collections.reveal")!(
      { sender: {} } as IpcMainInvokeEvent, revealRequest
    )).resolves.toEqual({ ...revealRequest, status: "revealed" });
    expect(accepted.revealCollection).toHaveBeenCalledWith(revealRequest);

    const stale = makeHarness({ getActiveVaultId: () => "vault_other" });
    await expect(stale.handlers.get("collections.reveal")!(
      { sender: {} } as IpcMainInvokeEvent, revealRequest
    )).resolves.toEqual({ ...revealRequest, status: "stale" });
    expect(stale.revealCollection).not.toHaveBeenCalled();

    const swapped = makeHarness({
      revealCollection: (request) => ({ ...request, datasetId: "dataset_20260727_otherdataset01", status: "revealed" })
    });
    await expect(swapped.handlers.get("collections.reveal")!(
      { sender: {} } as IpcMainInvokeEvent, revealRequest
    )).resolves.toEqual({ ...revealRequest, status: "stale" });
  });

  it("strictly binds view update, rename, and trash to trusted sender, vault, and exact view identity", async () => {
    const accepted = makeHarness();
    await expect(accepted.handlers.get("collections.updateView")!(
      { sender: {} } as IpcMainInvokeEvent, updateViewRequest
    )).resolves.toMatchObject({ status: "not_found", viewId: updateViewRequest.viewId });
    await expect(accepted.handlers.get("collections.renameView")!(
      { sender: {} } as IpcMainInvokeEvent, renameViewRequest
    )).resolves.toMatchObject({ status: "not_found", viewId: renameViewRequest.viewId });
    await expect(accepted.handlers.get("collections.trashView")!(
      { sender: {} } as IpcMainInvokeEvent, trashViewRequest
    )).resolves.toMatchObject({ status: "not_found", viewId: trashViewRequest.viewId });
    expect(accepted.renameCollectionView).toHaveBeenCalledWith(renameViewRequest);
    expect(accepted.updateCollectionView).toHaveBeenCalledWith(updateViewRequest);
    expect(accepted.trashCollectionView).toHaveBeenCalledWith(trashViewRequest);
    await expect(accepted.handlers.get("collections.renameView")!(
      { sender: {} } as IpcMainInvokeEvent, { ...renameViewRequest, rawSql: "select 1" }
    )).rejects.toThrow();
    await expect(accepted.handlers.get("collections.updateView")!(
      { sender: {} } as IpcMainInvokeEvent, { ...updateViewRequest, body: "private" }
    )).rejects.toThrow();

    const untrusted = makeHarness({ isTrustedSender: () => false });
    await expect(untrusted.handlers.get("collections.trashView")!(
      { sender: {} } as IpcMainInvokeEvent, trashViewRequest
    )).resolves.toMatchObject({ status: "failed", viewId: trashViewRequest.viewId });
    expect(untrusted.trashCollectionView).not.toHaveBeenCalled();
    await expect(untrusted.handlers.get("collections.updateView")!(
      { sender: {} } as IpcMainInvokeEvent, updateViewRequest
    )).resolves.toMatchObject({ status: "failed", viewId: updateViewRequest.viewId });

    const swapped = makeHarness({ renameCollectionView: (request) => ({
      apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
      datasetId: request.datasetId, tableId: request.tableId, viewId: "view_wrongwrongwrong", status: "not_found"
    }) });
    await expect(swapped.handlers.get("collections.renameView")!(
      { sender: {} } as IpcMainInvokeEvent, renameViewRequest
    )).rejects.toThrow("view-rename response identity did not match");
  });

  it("strictly binds lookup creation to trusted sender, vault, strict input, and exact dependency identity", async () => {
    const accepted = makeHarness();
    await expect(accepted.handlers.get("collections.addLookupColumn")!(
      { sender: {} } as IpcMainInvokeEvent, addLookupRequest
    )).resolves.toMatchObject({
      status: "not_found",
      relationColumnId: addLookupRequest.relationColumnId,
      targetColumnId: addLookupRequest.targetColumnId
    });
    expect(accepted.addLookupCollectionColumn).toHaveBeenCalledWith(addLookupRequest);

    await expect(accepted.handlers.get("collections.addLookupColumn")!(
      { sender: {} } as IpcMainInvokeEvent, { ...addLookupRequest, rawSql: "select * from cells" }
    )).rejects.toThrow();

    const untrusted = makeHarness({ isTrustedSender: () => false });
    await expect(untrusted.handlers.get("collections.addLookupColumn")!(
      { sender: {} } as IpcMainInvokeEvent, addLookupRequest
    )).resolves.toMatchObject({ status: "failed" });
    expect(untrusted.addLookupCollectionColumn).not.toHaveBeenCalled();

    const inactiveVault = makeHarness({ getActiveVaultId: () => "vault_20260727_elsewhere" });
    await expect(inactiveVault.handlers.get("collections.addLookupColumn")!(
      { sender: {} } as IpcMainInvokeEvent, addLookupRequest
    )).resolves.toMatchObject({ status: "failed" });
    expect(inactiveVault.addLookupCollectionColumn).not.toHaveBeenCalled();

    const mismatched = makeHarness({ addLookupCollectionColumn: (request) => ({
      apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
      datasetId: request.datasetId, tableId: request.tableId, relationColumnId: request.relationColumnId,
      targetColumnId: "column_otherlookupabc", status: "not_found"
    }) });
    await expect(mismatched.handlers.get("collections.addLookupColumn")!(
      { sender: {} } as IpcMainInvokeEvent, addLookupRequest
    )).rejects.toThrow("response identity did not match");
  });

  it("strictly binds rollup creation to trusted sender, vault, aggregation, and dependency identity", async () => {
    const accepted = makeHarness();
    await expect(accepted.handlers.get("collections.addRollupColumn")!(
      { sender: {} } as IpcMainInvokeEvent, addRollupRequest
    )).resolves.toMatchObject({ status: "not_found", aggregation: "sum", targetColumnId: addRollupRequest.targetColumnId });
    expect(accepted.addRollupCollectionColumn).toHaveBeenCalledWith(addRollupRequest);
    await expect(accepted.handlers.get("collections.addRollupColumn")!(
      { sender: {} } as IpcMainInvokeEvent, { ...addRollupRequest, rawSql: "sum(value)" }
    )).rejects.toThrow();
    const untrusted = makeHarness({ isTrustedSender: () => false });
    await expect(untrusted.handlers.get("collections.addRollupColumn")!(
      { sender: {} } as IpcMainInvokeEvent, addRollupRequest
    )).resolves.toMatchObject({ status: "failed" });
    expect(untrusted.addRollupCollectionColumn).not.toHaveBeenCalled();
    const mismatched = makeHarness({ addRollupCollectionColumn: (request) => ({
      apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
      datasetId: request.datasetId, tableId: request.tableId, relationColumnId: request.relationColumnId,
      aggregation: "count", status: "not_found"
    }) });
    await expect(mismatched.handlers.get("collections.addRollupColumn")!(
      { sender: {} } as IpcMainInvokeEvent, addRollupRequest
    )).rejects.toThrow("response identity did not match");
  });

  it("strictly binds rollup updates to the exact current descriptor identity", async () => {
    const accepted = makeHarness();
    await expect(accepted.handlers.get("collections.updateRollupColumn")!(
      { sender: {} } as IpcMainInvokeEvent, updateRollupRequest
    )).resolves.toMatchObject({ status: "not_found", columnId: updateRollupRequest.columnId, aggregation: "count" });
    expect(accepted.updateRollupCollectionColumn).toHaveBeenCalledWith(updateRollupRequest);
    await expect(accepted.handlers.get("collections.updateRollupColumn")!(
      { sender: {} } as IpcMainInvokeEvent, { ...updateRollupRequest, rawSql: "count(*)" }
    )).rejects.toThrow();
    const mismatched = makeHarness({ updateRollupCollectionColumn: (request) => ({ apiVersion: request.apiVersion,
      requestId: request.requestId, activeVaultId: request.activeVaultId, datasetId: request.datasetId,
      tableId: request.tableId, columnId: request.columnId, relationColumnId: request.relationColumnId,
      status: "not_found", aggregation: "sum", targetColumnId: "column_othernumeric01" }) });
    await expect(mismatched.handlers.get("collections.updateRollupColumn")!(
      { sender: {} } as IpcMainInvokeEvent, updateRollupRequest
    )).rejects.toThrow("response identity did not match");
  });

  it("strictly binds relation mutations to trusted sender, vault, and exact identity", async () => {
    const accepted = makeHarness();
    await expect(accepted.handlers.get("collections.addRelationColumn")!(
      { sender: {} } as IpcMainInvokeEvent, addRelationRequest
    )).resolves.toMatchObject({ status: "not_found", targetTableId: addRelationRequest.targetTableId });
    await expect(accepted.handlers.get("collections.editRelationCell")!(
      { sender: {} } as IpcMainInvokeEvent, editRelationRequest
    )).resolves.toMatchObject({ status: "not_found", targetRowId: editRelationRequest.targetRowId });
    expect(accepted.addRelationCollectionColumn).toHaveBeenCalledWith(addRelationRequest);
    expect(accepted.editRelationCollectionCell).toHaveBeenCalledWith(editRelationRequest);

    const untrusted = makeHarness({ isTrustedSender: () => false });
    await expect(untrusted.handlers.get("collections.addRelationColumn")!(
      { sender: {} } as IpcMainInvokeEvent, addRelationRequest
    )).resolves.toMatchObject({ status: "failed" });
    await expect(untrusted.handlers.get("collections.editRelationCell")!(
      { sender: {} } as IpcMainInvokeEvent, editRelationRequest
    )).resolves.toMatchObject({ status: "failed" });
    expect(untrusted.addRelationCollectionColumn).not.toHaveBeenCalled();
    expect(untrusted.editRelationCollectionCell).not.toHaveBeenCalled();

    const mismatched = makeHarness({
      editRelationCollectionCell: (request) => ({
        apiVersion: request.apiVersion, requestId: request.requestId,
        activeVaultId: request.activeVaultId, datasetId: request.datasetId,
        tableId: request.tableId, rowId: request.rowId, columnId: request.columnId,
        targetRowId: "row_differentabcdefgh", status: "not_found"
      })
    });
    await expect(mismatched.handlers.get("collections.editRelationCell")!(
      { sender: {} } as IpcMainInvokeEvent, editRelationRequest
    )).rejects.toThrow("response identity did not match");
  });

  it("strictly binds formula updates to trusted sender, vault, and exact response identity", async () => {
    const accepted = makeHarness({ updateFormulaCollectionColumn: (request) => ({
      apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
      datasetId: request.datasetId, tableId: request.tableId, columnId: request.columnId, status: "not_found"
    }) });
    await expect(accepted.handlers.get("collections.updateFormulaColumn")!(
      { sender: {} } as IpcMainInvokeEvent, updateFormulaRequest
    )).resolves.toMatchObject({ status: "not_found", columnId: updateFormulaRequest.columnId });
    expect(accepted.updateFormulaCollectionColumn).toHaveBeenCalledWith(updateFormulaRequest);
    const untrusted = makeHarness({ isTrustedSender: () => false });
    await expect(untrusted.handlers.get("collections.updateFormulaColumn")!(
      { sender: {} } as IpcMainInvokeEvent, updateFormulaRequest
    )).resolves.toMatchObject({ status: "failed" });
    expect(untrusted.updateFormulaCollectionColumn).not.toHaveBeenCalled();
    const mismatched = makeHarness({ updateFormulaCollectionColumn: (request) => ({
      apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
      datasetId: request.datasetId, tableId: request.tableId,
      columnId: "column_otherformulaabc", status: "not_found"
    }) });
    await expect(mismatched.handlers.get("collections.updateFormulaColumn")!(
      { sender: {} } as IpcMainInvokeEvent, updateFormulaRequest
    )).rejects.toThrow("response identity did not match");
  });

  it("fences citation lookup by trusted sender, vault, and exact result identity", async () => {
    const ready = (request: typeof citationRequest) => ({
      ...request,
      status: "ready" as const,
      mode: "citation_readonly" as const,
      preview: {
        datasetId: "dataset_20260727_abcdefghijkl",
        revisionId: "dataset_rev_20260727_abcdefghijkl",
        tableId: "table_abcdefghijkl",
        tableName: "Tasks",
        planHash: `sha256:${"a".repeat(64)}`,
        resultHash: `sha256:${"b".repeat(64)}`,
        columns: [{ key: "column_abcdefghijkl", label: "Task", logicalType: "string" as const }],
        rows: [{ rowId: "row_abcdefghijkl", values: ["Draft"] }],
        matchedRowCount: 1,
        returnedRowCount: 1,
        truncated: false,
        citationRefs: [request.citationRef]
      },
      highlights: [{ kind: "columns" as const, columnIds: ["column_abcdefghijkl"] }]
    });
    const accepted = makeHarness({ openCollectionCitation: ready });
    await expect(accepted.handlers.get("collections.openCitation")!(
      { sender: {} } as IpcMainInvokeEvent,
      citationRequest
    )).resolves.toMatchObject({ status: "ready", mode: "citation_readonly" });
    expect(accepted.openCollectionCitation).toHaveBeenCalledOnce();

    const untrusted = makeHarness({ isTrustedSender: () => false, openCollectionCitation: ready });
    await expect(untrusted.handlers.get("collections.openCitation")!(
      { sender: {} } as IpcMainInvokeEvent,
      citationRequest
    )).resolves.toMatchObject({ status: "failed" });
    expect(untrusted.openCollectionCitation).not.toHaveBeenCalled();

    const mismatched = makeHarness({
      openCollectionCitation: (request) => ({
        ...ready(request),
        assistantEventId: "evt_20260727_wrongidentityabcd"
      })
    });
    await expect(mismatched.handlers.get("collections.openCitation")!(
      { sender: {} } as IpcMainInvokeEvent,
      citationRequest
    )).rejects.toThrow();
  });

  it("strictly parses and returns bounded open and edit results", async () => {
    const {
      handlers,
      openCollection,
      editCollectionCell,
      appendDefaultCollectionRow,
      addNullableCollectionColumn,
      renameCollectionColumn,
      createCollectionView,
      trashCollectionColumn,
      trashCollectionRow
    } = makeHarness({
      addNullableCollectionColumn: (request) => ({
        apiVersion: request.apiVersion,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        datasetId: request.datasetId,
        tableId: request.tableId,
        status: "committed",
        columnId: "column_ownerabcdefghijkl",
        operationId: "op_20260727_columnabcdefgh",
        snapshot: {
          datasetId: request.datasetId,
          revisionId: "dataset_rev_20260727_columnabcdefghij",
          title: "Tasks",
          tableId: request.tableId,
          tableName: "Tasks",
          columns: [{ columnId: "column_ownerabcdefghijkl", label: "Owner", logicalType: "string", canRename: true, canTrash: true, canUseAsFormulaOperand: false, canEditFormula: false }],
          rows: [{
            rowId: "row_abcdefghijkl",
            cells: [{ columnId: "column_ownerabcdefghijkl", value: null, editable: true }],
            canTrash: true
          }],
          totalRowCount: 1,
          returnedRowCount: 1,
          truncated: false,
          canAppendDefaultRow: true,
          canAddColumn: true,
          canAddFormulaColumn: true,
          views: []
        }
      }),
      renameCollectionColumn: (request) => ({
        apiVersion: request.apiVersion,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        datasetId: request.datasetId,
        tableId: request.tableId,
        columnId: request.columnId,
        status: "not_found"
      })
    });

    await expect(handlers.get("collections.open")!({} as IpcMainInvokeEvent, openRequest))
      .resolves.toMatchObject({ status: "ready", requestId: openRequest.requestId });
    await expect(handlers.get("collections.editCell")!({} as IpcMainInvokeEvent, editRequest))
      .resolves.toMatchObject({
        status: "committed",
        requestId: editRequest.requestId,
        revisionId: "dataset_rev_20260727_qrstuvwxyzab"
      });
    await expect(handlers.get("collections.appendDefaultRow")!({} as IpcMainInvokeEvent, appendRequest))
      .resolves.toMatchObject({ status: "not_found", requestId: appendRequest.requestId });
    await expect(handlers.get("collections.addNullableColumn")!({} as IpcMainInvokeEvent, addColumnRequest))
      .resolves.toMatchObject({
        status: "committed",
        requestId: addColumnRequest.requestId,
        columnId: "column_ownerabcdefghijkl"
      });
    await expect(handlers.get("collections.renameColumn")!({ sender: {} } as IpcMainInvokeEvent, renameColumnRequest))
      .resolves.toMatchObject({ status: "not_found", requestId: renameColumnRequest.requestId });
    await expect(handlers.get("collections.createView")!({ sender: {} } as IpcMainInvokeEvent, createViewRequest))
      .resolves.toMatchObject({ status: "not_found", requestId: createViewRequest.requestId });
    await expect(handlers.get("collections.trashColumn")!({ sender: {} } as IpcMainInvokeEvent, trashColumnRequest))
      .resolves.toMatchObject({ status: "not_found", requestId: trashColumnRequest.requestId });
    await expect(handlers.get("collections.trashRow")!({} as IpcMainInvokeEvent, trashRowRequest))
      .resolves.toMatchObject({ status: "not_found", requestId: trashRowRequest.requestId });
    expect(openCollection).toHaveBeenCalledWith(openRequest);
    expect(editCollectionCell).toHaveBeenCalledWith(editRequest);
    expect(appendDefaultCollectionRow).toHaveBeenCalledWith(appendRequest);
    expect(addNullableCollectionColumn).toHaveBeenCalledWith(addColumnRequest);
    expect(renameCollectionColumn).toHaveBeenCalledWith(renameColumnRequest);
    expect(createCollectionView).toHaveBeenCalledWith(createViewRequest);
    expect(trashCollectionColumn).toHaveBeenCalledWith(trashColumnRequest);
    expect(trashCollectionRow).toHaveBeenCalledWith(trashRowRequest);
  });

  it("fails catalog reads closed on vault and response identity drift", async () => {
    let currentVaultId: string | undefined = activeVaultId;
    const changed = makeHarness({
      getActiveVaultId: () => currentVaultId,
      listCollections: (request) => {
        currentVaultId = "vault_20260727_changed";
        return {
          apiVersion: request.apiVersion,
          activeVaultId: request.activeVaultId,
          status: "ready",
          datasets: [],
          totalDatasetCount: 0,
          hasMore: false
        };
      }
    });
    await expect(changed.handlers.get("collections.list")!({} as IpcMainInvokeEvent, listRequest))
      .resolves.toEqual({ apiVersion: 1, activeVaultId, status: "failed" });

    const mismatched = makeHarness({
      listCollections: () => ({
        apiVersion: 1,
        activeVaultId: "vault_20260727_changed",
        status: "ready",
        datasets: [],
        totalDatasetCount: 0,
        hasMore: false
      })
    });
    await expect(mismatched.handlers.get("collections.list")!({} as IpcMainInvokeEvent, listRequest))
      .resolves.toEqual({ apiVersion: 1, activeVaultId, status: "failed" });
  });

  it("fails closed before service access when the active vault does not match", async () => {
    const {
      handlers,
      openCollection,
      editCollectionCell,
      appendDefaultCollectionRow,
      addNullableCollectionColumn,
      renameCollectionColumn,
      createCollectionView,
      trashCollectionColumn,
      trashCollectionRow
    } = makeHarness({
      getActiveVaultId: () => "vault_20260727_elsewhere"
    });

    await expect(handlers.get("collections.open")!({} as IpcMainInvokeEvent, openRequest))
      .resolves.toEqual({ ...openRequest, status: "failed" });
    await expect(handlers.get("collections.editCell")!({} as IpcMainInvokeEvent, editRequest))
      .resolves.toEqual({
        apiVersion: 1,
        requestId: editRequest.requestId,
        activeVaultId: editRequest.activeVaultId,
        datasetId: editRequest.datasetId,
        tableId: editRequest.tableId,
        rowId: editRequest.rowId,
        columnId: editRequest.columnId,
        status: "failed"
      });
    await expect(handlers.get("collections.appendDefaultRow")!({} as IpcMainInvokeEvent, appendRequest))
      .resolves.toEqual({
        apiVersion: 1,
        requestId: appendRequest.requestId,
        activeVaultId: appendRequest.activeVaultId,
        datasetId: appendRequest.datasetId,
        tableId: appendRequest.tableId,
        status: "not_found"
      });
    await expect(handlers.get("collections.addNullableColumn")!({} as IpcMainInvokeEvent, addColumnRequest))
      .resolves.toEqual({
        apiVersion: 1,
        requestId: addColumnRequest.requestId,
        activeVaultId: addColumnRequest.activeVaultId,
        datasetId: addColumnRequest.datasetId,
        tableId: addColumnRequest.tableId,
        status: "not_found"
      });
    await expect(handlers.get("collections.renameColumn")!({ sender: {} } as IpcMainInvokeEvent, renameColumnRequest))
      .resolves.toEqual({
        apiVersion: 1,
        requestId: renameColumnRequest.requestId,
        activeVaultId: renameColumnRequest.activeVaultId,
        datasetId: renameColumnRequest.datasetId,
        tableId: renameColumnRequest.tableId,
        columnId: renameColumnRequest.columnId,
        status: "failed"
      });
    await expect(handlers.get("collections.createView")!({ sender: {} } as IpcMainInvokeEvent, createViewRequest))
      .resolves.toEqual({
        apiVersion: 1,
        requestId: createViewRequest.requestId,
        activeVaultId: createViewRequest.activeVaultId,
        datasetId: createViewRequest.datasetId,
        tableId: createViewRequest.tableId,
        status: "failed"
      });
    await expect(handlers.get("collections.trashColumn")!({ sender: {} } as IpcMainInvokeEvent, trashColumnRequest))
      .resolves.toEqual({
        apiVersion: 1,
        requestId: trashColumnRequest.requestId,
        activeVaultId: trashColumnRequest.activeVaultId,
        datasetId: trashColumnRequest.datasetId,
        tableId: trashColumnRequest.tableId,
        columnId: trashColumnRequest.columnId,
        status: "failed"
      });
    await expect(handlers.get("collections.trashRow")!({} as IpcMainInvokeEvent, trashRowRequest))
      .resolves.toEqual({
        apiVersion: 1,
        requestId: trashRowRequest.requestId,
        activeVaultId: trashRowRequest.activeVaultId,
        datasetId: trashRowRequest.datasetId,
        tableId: trashRowRequest.tableId,
        rowId: trashRowRequest.rowId,
        status: "not_found"
      });
    expect(openCollection).not.toHaveBeenCalled();
    expect(editCollectionCell).not.toHaveBeenCalled();
    expect(appendDefaultCollectionRow).not.toHaveBeenCalled();
    expect(addNullableCollectionColumn).not.toHaveBeenCalled();
    expect(renameCollectionColumn).not.toHaveBeenCalled();
    expect(createCollectionView).not.toHaveBeenCalled();
    expect(trashCollectionColumn).not.toHaveBeenCalled();
    expect(trashCollectionRow).not.toHaveBeenCalled();
  });

  it("rejects malformed or identity-swapped service responses", async () => {
    const { handlers } = makeHarness({
      openCollection: (request) => ({ ...request, status: "ready", path: "/private/data.sqlite" }),
      editCollectionCell: (request) => ({
        apiVersion: request.apiVersion,
        requestId: "collection_request_wrongwrongwrong1",
        activeVaultId: request.activeVaultId,
        datasetId: request.datasetId,
        tableId: request.tableId,
        rowId: request.rowId,
        columnId: request.columnId,
        status: "failed"
      })
    });

    await expect(handlers.get("collections.open")!({} as IpcMainInvokeEvent, openRequest))
      .rejects.toThrow();
    await expect(handlers.get("collections.editCell")!({} as IpcMainInvokeEvent, editRequest))
      .rejects.toThrow("response identity did not match");
  });

  it("preserves the optional saved-view identity through collection open", async () => {
    const viewId = "view_abcdefghijkl";
    const request = { ...openRequest, viewId } as const;
    const { handlers, openCollection } = makeHarness({
      openCollection: (parsed) => ({
        apiVersion: parsed.apiVersion,
        requestId: parsed.requestId,
        activeVaultId: parsed.activeVaultId,
        datasetId: parsed.datasetId,
        tableId: parsed.tableId,
        status: "ready",
        snapshot: {
          datasetId: parsed.datasetId,
          revisionId: "dataset_rev_20260727_abcdefghijkl",
          title: "Tasks",
          tableId: parsed.tableId,
          tableName: "Tasks",
          columns: [{ columnId: "column_abcdefghijkl", label: "Task", logicalType: "string", canRename: true, canTrash: true, canUseAsFormulaOperand: false, canEditFormula: false }],
          rows: [],
          totalRowCount: 0,
          returnedRowCount: 0,
          truncated: false,
          canAppendDefaultRow: true,
          canAddColumn: true,
          canAddFormulaColumn: true,
          views: [{ viewId, viewRevision: 1, name: "Open tasks" }],
          activeViewId: viewId
        }
      })
    });

    await expect(handlers.get("collections.open")!({} as IpcMainInvokeEvent, request))
      .resolves.toMatchObject({ status: "ready", snapshot: { activeViewId: viewId } });
    expect(openCollection).toHaveBeenCalledWith(request);

    const mismatched = makeHarness({
      openCollection: (parsed) => ({
        apiVersion: parsed.apiVersion,
        requestId: parsed.requestId,
        activeVaultId: parsed.activeVaultId,
        datasetId: parsed.datasetId,
        tableId: parsed.tableId,
        status: "ready",
        snapshot: {
          datasetId: parsed.datasetId,
          revisionId: "dataset_rev_20260727_abcdefghijkl",
          title: "Tasks",
          tableId: parsed.tableId,
          tableName: "Tasks",
          columns: [{ columnId: "column_abcdefghijkl", label: "Task", logicalType: "string", canRename: true, canTrash: true, canUseAsFormulaOperand: false, canEditFormula: false }],
          rows: [],
          totalRowCount: 0,
          returnedRowCount: 0,
          truncated: false,
          canAppendDefaultRow: true,
          canAddColumn: true,
          canAddFormulaColumn: true,
          views: []
        }
      })
    });
    await expect(mismatched.handlers.get("collections.open")!({} as IpcMainInvokeEvent, request))
      .rejects.toThrow("open response view identity did not match");
  });

  it("rejects unknown request fields before service access", async () => {
    const { handlers, openCollection, addNullableCollectionColumn, renameCollectionColumn, createCollectionView, trashCollectionColumn, trashCollectionRow } = makeHarness();
    await expect(handlers.get("collections.open")!({} as IpcMainInvokeEvent, {
      ...openRequest,
      path: "/private/data.sqlite"
    })).rejects.toThrow();
    expect(openCollection).not.toHaveBeenCalled();
    await expect(handlers.get("collections.addNullableColumn")!({} as IpcMainInvokeEvent, {
      ...addColumnRequest,
      path: "/private/data.sqlite"
    })).rejects.toThrow();
    expect(addNullableCollectionColumn).not.toHaveBeenCalled();
    await expect(handlers.get("collections.renameColumn")!({ sender: {} } as IpcMainInvokeEvent, {
      ...renameColumnRequest,
      path: "/private/data.sqlite"
    })).rejects.toThrow();
    expect(renameCollectionColumn).not.toHaveBeenCalled();
    await expect(handlers.get("collections.createView")!({ sender: {} } as IpcMainInvokeEvent, {
      ...createViewRequest,
      path: "/private/data.sqlite"
    })).rejects.toThrow();
    expect(createCollectionView).not.toHaveBeenCalled();
    await expect(handlers.get("collections.trashColumn")!({ sender: {} } as IpcMainInvokeEvent, {
      ...trashColumnRequest,
      path: "/private/data.sqlite"
    })).rejects.toThrow();
    expect(trashCollectionColumn).not.toHaveBeenCalled();
    await expect(handlers.get("collections.trashRow")!({} as IpcMainInvokeEvent, {
      ...trashRowRequest,
      path: "/private/data.sqlite"
    })).rejects.toThrow();
    expect(trashCollectionRow).not.toHaveBeenCalled();
  });

  it("rejects an identity-swapped add-column result", async () => {
    const { handlers } = makeHarness({
      addNullableCollectionColumn: (request) => ({
        apiVersion: request.apiVersion,
        requestId: "collection_request_wrongwrongwrong2",
        activeVaultId: request.activeVaultId,
        datasetId: request.datasetId,
        tableId: request.tableId,
        status: "not_found"
      })
    });

    await expect(handlers.get("collections.addNullableColumn")!(
      {} as IpcMainInvokeEvent,
      addColumnRequest
    )).rejects.toThrow("add-column response identity did not match");
  });

  it("rejects an identity-swapped row-trash result", async () => {
    const { handlers } = makeHarness({
      trashCollectionRow: (request) => ({
        apiVersion: request.apiVersion,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        datasetId: request.datasetId,
        tableId: request.tableId,
        rowId: "row_wrongwrongwrong",
        status: "not_found"
      })
    });

    await expect(handlers.get("collections.trashRow")!(
      {} as IpcMainInvokeEvent,
      trashRowRequest
    )).rejects.toThrow("row-trash response identity did not match");
  });

  it("fails closed for an untrusted sender and rejects a swapped rename identity", async () => {
    const untrusted = makeHarness({ isTrustedSender: () => false });
    await expect(untrusted.handlers.get("collections.renameColumn")!(
      { sender: {} } as IpcMainInvokeEvent,
      renameColumnRequest
    )).resolves.toMatchObject({ status: "failed", columnId: renameColumnRequest.columnId });
    expect(untrusted.renameCollectionColumn).not.toHaveBeenCalled();

    const swapped = makeHarness({
      renameCollectionColumn: (request) => ({
        apiVersion: request.apiVersion,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        datasetId: request.datasetId,
        tableId: request.tableId,
        columnId: "column_wrongwrongwrong",
        status: "not_found"
      })
    });
    await expect(swapped.handlers.get("collections.renameColumn")!(
      { sender: {} } as IpcMainInvokeEvent,
      renameColumnRequest
    )).rejects.toThrow("column-rename response identity did not match");
  });

  it("fails closed for an untrusted sender and rejects a swapped column-trash identity", async () => {
    const untrusted = makeHarness({ isTrustedSender: () => false });
    await expect(untrusted.handlers.get("collections.trashColumn")!(
      { sender: {} } as IpcMainInvokeEvent,
      trashColumnRequest
    )).resolves.toMatchObject({ status: "failed", columnId: trashColumnRequest.columnId });
    expect(untrusted.trashCollectionColumn).not.toHaveBeenCalled();

    const swapped = makeHarness({
      trashCollectionColumn: (request) => ({
        apiVersion: request.apiVersion,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        datasetId: request.datasetId,
        tableId: request.tableId,
        columnId: "column_wrongwrongwrong",
        status: "not_found"
      })
    });
    await expect(swapped.handlers.get("collections.trashColumn")!(
      { sender: {} } as IpcMainInvokeEvent,
      trashColumnRequest
    )).rejects.toThrow("column-trash response identity did not match");
  });

  it("fails closed for an untrusted sender and rejects a swapped view-creation identity", async () => {
    const untrusted = makeHarness({ isTrustedSender: () => false });
    await expect(untrusted.handlers.get("collections.createView")!(
      { sender: {} } as IpcMainInvokeEvent,
      createViewRequest
    )).resolves.toMatchObject({ status: "failed" });
    expect(untrusted.createCollectionView).not.toHaveBeenCalled();

    const swapped = makeHarness({
      createCollectionView: (request) => ({
        apiVersion: request.apiVersion,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        datasetId: "dataset_20260727_wrongwrongwrong",
        tableId: request.tableId,
        status: "not_found"
      })
    });
    await expect(swapped.handlers.get("collections.createView")!(
      { sender: {} } as IpcMainInvokeEvent,
      createViewRequest
    )).rejects.toThrow("view-creation response identity did not match");
  });
});
