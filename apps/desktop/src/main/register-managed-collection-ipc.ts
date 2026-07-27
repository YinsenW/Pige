import type { IpcMain } from "electron";
import {
  CollectionAppendDefaultRowRequestSchema,
  CollectionAppendDefaultRowResultSchema,
  CollectionCellEditRequestSchema,
  CollectionCellEditResultSchema,
  CollectionOpenRequestSchema,
  CollectionOpenResultSchema,
  type CollectionCellEditRequest,
  type CollectionCellEditResult,
  type CollectionAppendDefaultRowRequest,
  type CollectionAppendDefaultRowResult,
  type CollectionOpenRequest,
  type CollectionOpenResult
} from "@pige/schemas";

interface RegisterManagedCollectionIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
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
}
