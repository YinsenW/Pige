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
const listRequest = {
  apiVersion: 1,
  activeVaultId,
  limit: 20
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
  readonly editCollectionCell?: (request: typeof editRequest) => unknown;
  readonly appendDefaultCollectionRow?: (request: typeof appendRequest) => unknown;
  readonly addNullableCollectionColumn?: (request: typeof addColumnRequest) => unknown;
  readonly renameCollectionColumn?: (request: typeof renameColumnRequest) => unknown;
  readonly createCollectionView?: (request: typeof createViewRequest) => unknown;
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
      columns: [{ columnId: "column_abcdefghijkl", label: "Task", logicalType: "string", canRename: true, canTrash: true }],
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
      views: []
    }
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

  registerManagedCollectionIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler as IpcHandler)
    } as Pick<IpcMain, "handle">,
    isTrustedSender: options.isTrustedSender ?? (() => true),
    getActiveVaultId: options.getActiveVaultId ?? (() => activeVaultId),
    listCollections,
    openCollection,
    editCollectionCell,
    appendDefaultCollectionRow,
    addNullableCollectionColumn,
    renameCollectionColumn,
    createCollectionView,
    trashCollectionColumn,
    trashCollectionRow
  });
  return {
    handlers,
    listCollections,
    openCollection,
    editCollectionCell,
    appendDefaultCollectionRow,
    addNullableCollectionColumn,
    renameCollectionColumn,
    createCollectionView,
    trashCollectionColumn,
    trashCollectionRow
  };
}

describe("registerManagedCollectionIpc", () => {
  it("registers the bounded collection channels", () => {
    expect([...makeHarness().handlers.keys()]).toEqual([
      "collections.list",
      "collections.open",
      "collections.editCell",
      "collections.appendDefaultRow",
      "collections.addNullableColumn",
      "collections.renameColumn",
      "collections.createView",
      "collections.trashColumn",
      "collections.trashRow"
    ]);
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
          columns: [{ columnId: "column_ownerabcdefghijkl", label: "Owner", logicalType: "string", canRename: true, canTrash: true }],
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
          columns: [{ columnId: "column_abcdefghijkl", label: "Task", logicalType: "string", canRename: true, canTrash: true }],
          rows: [],
          totalRowCount: 0,
          returnedRowCount: 0,
          truncated: false,
          canAppendDefaultRow: true,
          canAddColumn: true,
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
          columns: [{ columnId: "column_abcdefghijkl", label: "Task", logicalType: "string", canRename: true, canTrash: true }],
          rows: [],
          totalRowCount: 0,
          returnedRowCount: 0,
          truncated: false,
          canAppendDefaultRow: true,
          canAddColumn: true,
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
