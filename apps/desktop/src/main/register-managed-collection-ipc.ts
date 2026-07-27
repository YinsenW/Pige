import type { IpcMain, WebContents } from "electron";
import {
  CollectionAddNullableColumnRequestSchema,
  CollectionAddNullableColumnResultSchema,
  CollectionAppendDefaultRowRequestSchema,
  CollectionAppendDefaultRowResultSchema,
  CollectionCellEditRequestSchema,
  CollectionCellEditResultSchema,
  CollectionCreateViewRequestSchema,
  CollectionCreateViewResultSchema,
  CollectionOpenRequestSchema,
  CollectionOpenResultSchema,
  CollectionRenameColumnRequestSchema,
  CollectionRenameColumnResultSchema,
  CollectionTrashColumnRequestSchema,
  CollectionTrashColumnResultSchema,
  CollectionTrashRowRequestSchema,
  CollectionTrashRowResultSchema,
  type CollectionAddNullableColumnRequest,
  type CollectionAddNullableColumnResult,
  type CollectionCellEditRequest,
  type CollectionCellEditResult,
  type CollectionCreateViewRequest,
  type CollectionCreateViewResult,
  type CollectionAppendDefaultRowRequest,
  type CollectionAppendDefaultRowResult,
  type CollectionOpenRequest,
  type CollectionOpenResult,
  type CollectionRenameColumnRequest,
  type CollectionRenameColumnResult,
  type CollectionTrashColumnRequest,
  type CollectionTrashColumnResult,
  type CollectionTrashRowRequest,
  type CollectionTrashRowResult
} from "@pige/schemas";

interface RegisterManagedCollectionIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly isTrustedSender: (sender: WebContents) => boolean;
  readonly getActiveVaultId: () => string | undefined;
  readonly openCollection: (
    request: CollectionOpenRequest
  ) => CollectionOpenResult | Promise<CollectionOpenResult>;
  readonly editCollectionCell: (
    request: CollectionCellEditRequest
  ) => CollectionCellEditResult | Promise<CollectionCellEditResult>;
  readonly appendDefaultCollectionRow: (
    request: CollectionAppendDefaultRowRequest
  ) => CollectionAppendDefaultRowResult | Promise<CollectionAppendDefaultRowResult>;
  readonly addNullableCollectionColumn: (
    request: CollectionAddNullableColumnRequest
  ) => CollectionAddNullableColumnResult | Promise<CollectionAddNullableColumnResult>;
  readonly renameCollectionColumn: (
    request: CollectionRenameColumnRequest
  ) => CollectionRenameColumnResult | Promise<CollectionRenameColumnResult>;
  readonly createCollectionView: (
    request: CollectionCreateViewRequest
  ) => CollectionCreateViewResult | Promise<CollectionCreateViewResult>;
  readonly trashCollectionColumn: (
    request: CollectionTrashColumnRequest
  ) => CollectionTrashColumnResult | Promise<CollectionTrashColumnResult>;
  readonly trashCollectionRow: (
    request: CollectionTrashRowRequest
  ) => CollectionTrashRowResult | Promise<CollectionTrashRowResult>;
}

function failedOpen(request: CollectionOpenRequest): CollectionOpenResult {
  return CollectionOpenResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    status: "failed"
  });
}

function failedEdit(request: CollectionCellEditRequest): CollectionCellEditResult {
  return CollectionCellEditResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    rowId: request.rowId,
    columnId: request.columnId,
    status: "failed"
  });
}

function notFoundAppend(request: CollectionAppendDefaultRowRequest): CollectionAppendDefaultRowResult {
  return CollectionAppendDefaultRowResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    status: "not_found"
  });
}

function notFoundAddColumn(
  request: CollectionAddNullableColumnRequest
): CollectionAddNullableColumnResult {
  return CollectionAddNullableColumnResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    status: "not_found"
  });
}

function notFoundTrashRow(request: CollectionTrashRowRequest): CollectionTrashRowResult {
  return CollectionTrashRowResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    rowId: request.rowId,
    status: "not_found"
  });
}

function failedRenameColumn(request: CollectionRenameColumnRequest): CollectionRenameColumnResult {
  return CollectionRenameColumnResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    columnId: request.columnId,
    status: "failed"
  });
}

function failedTrashColumn(request: CollectionTrashColumnRequest): CollectionTrashColumnResult {
  return CollectionTrashColumnResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    columnId: request.columnId,
    status: "failed"
  });
}

function failedCreateView(request: CollectionCreateViewRequest): CollectionCreateViewResult {
  return CollectionCreateViewResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    status: "failed"
  });
}

function assertOpenIdentity(
  request: CollectionOpenRequest,
  result: CollectionOpenResult
): CollectionOpenResult {
  if (
    result.requestId !== request.requestId ||
    result.activeVaultId !== request.activeVaultId ||
    result.datasetId !== request.datasetId ||
    result.tableId !== request.tableId
  ) {
    throw new Error("Managed Collection open response identity did not match the request.");
  }
  if (result.status === "ready" && result.snapshot.activeViewId !== request.viewId) {
    throw new Error("Managed Collection open response view identity did not match the request.");
  }
  return result;
}

function assertEditIdentity(
  request: CollectionCellEditRequest,
  result: CollectionCellEditResult
): CollectionCellEditResult {
  if (
    result.requestId !== request.requestId ||
    result.activeVaultId !== request.activeVaultId ||
    result.datasetId !== request.datasetId ||
    result.tableId !== request.tableId ||
    result.rowId !== request.rowId ||
    result.columnId !== request.columnId
  ) {
    throw new Error("Managed Collection edit response identity did not match the request.");
  }
  return result;
}

export function registerManagedCollectionIpc(options: RegisterManagedCollectionIpcOptions): void {
  options.ipcMain.handle("collections.open", async (_event, request: unknown) => {
    const parsed = CollectionOpenRequestSchema.parse(request);
    if (options.getActiveVaultId() !== parsed.activeVaultId) return failedOpen(parsed);

    let rawResult: CollectionOpenResult;
    try {
      rawResult = await options.openCollection(parsed);
    } catch {
      return failedOpen(parsed);
    }
    const result = assertOpenIdentity(parsed, CollectionOpenResultSchema.parse(rawResult));
    return options.getActiveVaultId() === parsed.activeVaultId ? result : failedOpen(parsed);
  });

  options.ipcMain.handle("collections.editCell", async (_event, request: unknown) => {
    const parsed = CollectionCellEditRequestSchema.parse(request);
    if (options.getActiveVaultId() !== parsed.activeVaultId) return failedEdit(parsed);

    let rawResult: CollectionCellEditResult;
    try {
      rawResult = await options.editCollectionCell(parsed);
    } catch {
      return failedEdit(parsed);
    }
    const result = assertEditIdentity(parsed, CollectionCellEditResultSchema.parse(rawResult));
    return options.getActiveVaultId() === parsed.activeVaultId ? result : failedEdit(parsed);
  });

  options.ipcMain.handle("collections.appendDefaultRow", async (_event, request: unknown) => {
    const parsed = CollectionAppendDefaultRowRequestSchema.parse(request);
    if (options.getActiveVaultId() !== parsed.activeVaultId) return notFoundAppend(parsed);
    let rawResult: CollectionAppendDefaultRowResult;
    try {
      rawResult = await options.appendDefaultCollectionRow(parsed);
    } catch {
      return notFoundAppend(parsed);
    }
    const result = CollectionAppendDefaultRowResultSchema.parse(rawResult);
    if (
      result.requestId !== parsed.requestId ||
      result.activeVaultId !== parsed.activeVaultId ||
      result.datasetId !== parsed.datasetId ||
      result.tableId !== parsed.tableId
    ) throw new Error("Managed Collection append response identity did not match the request.");
    return options.getActiveVaultId() === parsed.activeVaultId ? result : notFoundAppend(parsed);
  });

  options.ipcMain.handle("collections.addNullableColumn", async (_event, request: unknown) => {
    const parsed = CollectionAddNullableColumnRequestSchema.parse(request);
    if (options.getActiveVaultId() !== parsed.activeVaultId) return notFoundAddColumn(parsed);
    let rawResult: CollectionAddNullableColumnResult;
    try {
      rawResult = await options.addNullableCollectionColumn(parsed);
    } catch {
      return notFoundAddColumn(parsed);
    }
    const result = CollectionAddNullableColumnResultSchema.parse(rawResult);
    if (
      result.requestId !== parsed.requestId ||
      result.activeVaultId !== parsed.activeVaultId ||
      result.datasetId !== parsed.datasetId ||
      result.tableId !== parsed.tableId
    ) throw new Error("Managed Collection add-column response identity did not match the request.");
    return options.getActiveVaultId() === parsed.activeVaultId ? result : notFoundAddColumn(parsed);
  });

  options.ipcMain.handle("collections.renameColumn", async (event, request: unknown) => {
    const parsed = CollectionRenameColumnRequestSchema.parse(request);
    if (!options.isTrustedSender(event.sender) || options.getActiveVaultId() !== parsed.activeVaultId) {
      return failedRenameColumn(parsed);
    }
    let rawResult: CollectionRenameColumnResult;
    try {
      rawResult = await options.renameCollectionColumn(parsed);
    } catch {
      return failedRenameColumn(parsed);
    }
    const result = CollectionRenameColumnResultSchema.parse(rawResult);
    if (
      result.requestId !== parsed.requestId ||
      result.activeVaultId !== parsed.activeVaultId ||
      result.datasetId !== parsed.datasetId ||
      result.tableId !== parsed.tableId ||
      result.columnId !== parsed.columnId
    ) throw new Error("Managed Collection column-rename response identity did not match the request.");
    return options.isTrustedSender(event.sender) && options.getActiveVaultId() === parsed.activeVaultId
      ? result
      : failedRenameColumn(parsed);
  });

  options.ipcMain.handle("collections.createView", async (event, request: unknown) => {
    const parsed = CollectionCreateViewRequestSchema.parse(request);
    if (!options.isTrustedSender(event.sender) || options.getActiveVaultId() !== parsed.activeVaultId) {
      return failedCreateView(parsed);
    }
    let rawResult: CollectionCreateViewResult;
    try {
      rawResult = await options.createCollectionView(parsed);
    } catch {
      return failedCreateView(parsed);
    }
    const result = CollectionCreateViewResultSchema.parse(rawResult);
    if (
      result.requestId !== parsed.requestId ||
      result.activeVaultId !== parsed.activeVaultId ||
      result.datasetId !== parsed.datasetId ||
      result.tableId !== parsed.tableId
    ) throw new Error("Managed Collection view-creation response identity did not match the request.");
    return options.isTrustedSender(event.sender) && options.getActiveVaultId() === parsed.activeVaultId
      ? result
      : failedCreateView(parsed);
  });

  options.ipcMain.handle("collections.trashColumn", async (event, request: unknown) => {
    const parsed = CollectionTrashColumnRequestSchema.parse(request);
    if (!options.isTrustedSender(event.sender) || options.getActiveVaultId() !== parsed.activeVaultId) {
      return failedTrashColumn(parsed);
    }
    let rawResult: CollectionTrashColumnResult;
    try {
      rawResult = await options.trashCollectionColumn(parsed);
    } catch {
      return failedTrashColumn(parsed);
    }
    const result = CollectionTrashColumnResultSchema.parse(rawResult);
    if (
      result.requestId !== parsed.requestId ||
      result.activeVaultId !== parsed.activeVaultId ||
      result.datasetId !== parsed.datasetId ||
      result.tableId !== parsed.tableId ||
      result.columnId !== parsed.columnId
    ) throw new Error("Managed Collection column-trash response identity did not match the request.");
    return options.isTrustedSender(event.sender) && options.getActiveVaultId() === parsed.activeVaultId
      ? result
      : failedTrashColumn(parsed);
  });

  options.ipcMain.handle("collections.trashRow", async (_event, request: unknown) => {
    const parsed = CollectionTrashRowRequestSchema.parse(request);
    if (options.getActiveVaultId() !== parsed.activeVaultId) return notFoundTrashRow(parsed);
    let rawResult: CollectionTrashRowResult;
    try {
      rawResult = await options.trashCollectionRow(parsed);
    } catch {
      return notFoundTrashRow(parsed);
    }
    const result = CollectionTrashRowResultSchema.parse(rawResult);
    if (
      result.requestId !== parsed.requestId ||
      result.activeVaultId !== parsed.activeVaultId ||
      result.datasetId !== parsed.datasetId ||
      result.tableId !== parsed.tableId ||
      result.rowId !== parsed.rowId
    ) throw new Error("Managed Collection row-trash response identity did not match the request.");
    return options.getActiveVaultId() === parsed.activeVaultId ? result : notFoundTrashRow(parsed);
  });
}
