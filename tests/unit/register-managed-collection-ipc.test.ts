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
const editRequest = {
  ...openRequest,
  requestId: "collection_request_qrstuvwxyzabcdef",
  expectedRevisionId: "dataset_rev_20260727_abcdefghijkl",
  rowId: "row_abcdefghijkl",
  columnId: "column_abcdefghijkl",
  value: "updated"
} as const;

function makeHarness(options: {
  readonly getActiveVaultId?: () => string | undefined;
  readonly openCollection?: (request: typeof openRequest) => unknown;
  readonly editCollectionCell?: (request: typeof editRequest) => unknown;
} = {}) {
  const handlers = new Map<string, IpcHandler>();
  const openCollection = vi.fn(options.openCollection ?? ((request) => ({
    ...request,
    status: "ready",
    snapshot: {
      datasetId: request.datasetId,
      revisionId: "dataset_rev_20260727_abcdefghijkl",
      title: "Tasks",
      tableId: request.tableId,
      tableName: "Tasks",
      columns: [{ columnId: "column_abcdefghijkl", label: "Task", logicalType: "string" }],
      rows: [{
        rowId: "row_abcdefghijkl",
        cells: [{ columnId: "column_abcdefghijkl", value: "Draft", editable: true }]
      }],
      totalRowCount: 1,
      returnedRowCount: 1,
      truncated: false
    }
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

  registerManagedCollectionIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler as IpcHandler)
    } as Pick<IpcMain, "handle">,
    getActiveVaultId: options.getActiveVaultId ?? (() => activeVaultId),
    openCollection,
    editCollectionCell
  });
  return { handlers, openCollection, editCollectionCell };
}

describe("registerManagedCollectionIpc", () => {
  it("registers only collection open and cell-edit channels", () => {
    expect([...makeHarness().handlers.keys()]).toEqual([
      "collections.open",
      "collections.editCell"
    ]);
  });

  it("strictly parses and returns bounded open and edit results", async () => {
    const { handlers, openCollection, editCollectionCell } = makeHarness();

    await expect(handlers.get("collections.open")!({} as IpcMainInvokeEvent, openRequest))
      .resolves.toMatchObject({ status: "ready", requestId: openRequest.requestId });
    await expect(handlers.get("collections.editCell")!({} as IpcMainInvokeEvent, editRequest))
      .resolves.toMatchObject({
        status: "committed",
        requestId: editRequest.requestId,
        revisionId: "dataset_rev_20260727_qrstuvwxyzab"
      });
    expect(openCollection).toHaveBeenCalledWith(openRequest);
    expect(editCollectionCell).toHaveBeenCalledWith(editRequest);
  });

  it("fails closed before service access when the active vault does not match", async () => {
    const { handlers, openCollection, editCollectionCell } = makeHarness({
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
    expect(openCollection).not.toHaveBeenCalled();
    expect(editCollectionCell).not.toHaveBeenCalled();
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

  it("rejects unknown request fields before service access", async () => {
    const { handlers, openCollection } = makeHarness();
    await expect(handlers.get("collections.open")!({} as IpcMainInvokeEvent, {
      ...openRequest,
      path: "/private/data.sqlite"
    })).rejects.toThrow();
    expect(openCollection).not.toHaveBeenCalled();
  });
});
