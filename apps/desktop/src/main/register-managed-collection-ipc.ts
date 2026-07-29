import type { IpcMain, WebContents } from "electron";
import {
  COLLECTION_ADD_FORMULA_COLUMN_CHANNEL,
  COLLECTION_ADD_RELATION_COLUMN_CHANNEL,
  COLLECTION_EDIT_RELATION_CELL_CHANNEL,
  COLLECTION_UPDATE_FORMULA_COLUMN_CHANNEL,
  CollectionAddFormulaColumnRequestSchema,
  CollectionAddFormulaColumnResultSchema,
  CollectionAddRelationColumnRequestSchema,
  CollectionAddRelationColumnResultSchema,
  CollectionEditRelationCellRequestSchema,
  CollectionEditRelationCellResultSchema,
  CollectionUpdateFormulaColumnRequestSchema,
  CollectionUpdateFormulaColumnResultSchema,
  CollectionAddNullableColumnRequestSchema,
  CollectionAddNullableColumnResultSchema,
  CollectionAppendDefaultRowRequestSchema,
  CollectionAppendDefaultRowResultSchema,
  CollectionCellEditRequestSchema,
  CollectionCellEditResultSchema,
  CollectionCreateViewRequestSchema,
  CollectionCreateViewResultSchema,
  CollectionOpenCitationRequestSchema,
  CollectionOpenCitationResultSchema,
  CollectionListRequestSchema,
  CollectionListResultSchema,
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
  type CollectionAddFormulaColumnRequest,
  type CollectionAddFormulaColumnResult,
  type CollectionAddRelationColumnRequest,
  type CollectionAddRelationColumnResult,
  type CollectionEditRelationCellRequest,
  type CollectionEditRelationCellResult,
  type CollectionUpdateFormulaColumnRequest,
  type CollectionUpdateFormulaColumnResult,
  type CollectionCellEditRequest,
  type CollectionCellEditResult,
  type CollectionCreateViewRequest,
  type CollectionCreateViewResult,
  type CollectionOpenCitationRequest,
  type CollectionOpenCitationResult,
  type CollectionListRequest,
  type CollectionListResult,
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
  readonly listCollections: (
    request: CollectionListRequest
  ) => CollectionListResult | Promise<CollectionListResult>;
  readonly openCollection: (
    request: CollectionOpenRequest
  ) => CollectionOpenResult | Promise<CollectionOpenResult>;
  readonly openCollectionCitation: (
    request: CollectionOpenCitationRequest
  ) => CollectionOpenCitationResult | Promise<CollectionOpenCitationResult>;
  readonly editCollectionCell: (
    request: CollectionCellEditRequest
  ) => CollectionCellEditResult | Promise<CollectionCellEditResult>;
  readonly appendDefaultCollectionRow: (
    request: CollectionAppendDefaultRowRequest
  ) => CollectionAppendDefaultRowResult | Promise<CollectionAppendDefaultRowResult>;
  readonly addNullableCollectionColumn: (
    request: CollectionAddNullableColumnRequest
  ) => CollectionAddNullableColumnResult | Promise<CollectionAddNullableColumnResult>;
  readonly addFormulaCollectionColumn?: (
    request: CollectionAddFormulaColumnRequest
  ) => CollectionAddFormulaColumnResult | Promise<CollectionAddFormulaColumnResult>;
  readonly updateFormulaCollectionColumn?: (
    request: CollectionUpdateFormulaColumnRequest
  ) => CollectionUpdateFormulaColumnResult | Promise<CollectionUpdateFormulaColumnResult>;
  readonly addRelationCollectionColumn?: (
    request: CollectionAddRelationColumnRequest
  ) => CollectionAddRelationColumnResult | Promise<CollectionAddRelationColumnResult>;
  readonly editRelationCollectionCell?: (
    request: CollectionEditRelationCellRequest
  ) => CollectionEditRelationCellResult | Promise<CollectionEditRelationCellResult>;
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

function failedList(request: CollectionListRequest): CollectionListResult {
  return CollectionListResultSchema.parse({
    apiVersion: request.apiVersion,
    activeVaultId: request.activeVaultId,
    status: "failed"
  });
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

function failedCitation(request: CollectionOpenCitationRequest): CollectionOpenCitationResult {
  return CollectionOpenCitationResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    conversationId: request.conversationId,
    assistantEventId: request.assistantEventId,
    citationRef: request.citationRef,
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

function failedAddFormulaColumn(
  request: CollectionAddFormulaColumnRequest
): CollectionAddFormulaColumnResult {
  return CollectionAddFormulaColumnResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    status: "failed"
  });
}

function failedUpdateFormulaColumn(request: CollectionUpdateFormulaColumnRequest): CollectionUpdateFormulaColumnResult {
  return CollectionUpdateFormulaColumnResultSchema.parse({
    apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
    datasetId: request.datasetId, tableId: request.tableId, columnId: request.columnId, status: "failed"
  });
}

function failedAddRelationColumn(
  request: CollectionAddRelationColumnRequest
): CollectionAddRelationColumnResult {
  return CollectionAddRelationColumnResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    targetTableId: request.targetTableId,
    targetDisplayColumnId: request.targetDisplayColumnId,
    status: "failed"
  });
}

function failedEditRelationCell(
  request: CollectionEditRelationCellRequest
): CollectionEditRelationCellResult {
  return CollectionEditRelationCellResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    rowId: request.rowId,
    columnId: request.columnId,
    targetRowId: request.targetRowId,
    status: "failed"
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

function assertCitationIdentity(
  request: CollectionOpenCitationRequest,
  result: CollectionOpenCitationResult
): CollectionOpenCitationResult {
  if (
    result.requestId !== request.requestId ||
    result.activeVaultId !== request.activeVaultId ||
    result.conversationId !== request.conversationId ||
    result.assistantEventId !== request.assistantEventId ||
    result.citationRef !== request.citationRef
  ) {
    throw new Error("Managed Collection citation response identity did not match the request.");
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
  options.ipcMain.handle("collections.list", async (_event, request: unknown) => {
    const parsed = CollectionListRequestSchema.parse(request);
    if (options.getActiveVaultId() !== parsed.activeVaultId) return failedList(parsed);
    let rawResult: CollectionListResult;
    try {
      rawResult = await options.listCollections(parsed);
    } catch {
      return failedList(parsed);
    }
    const result = CollectionListResultSchema.parse(rawResult);
    if (result.activeVaultId !== parsed.activeVaultId) return failedList(parsed);
    return options.getActiveVaultId() === parsed.activeVaultId ? result : failedList(parsed);
  });

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

  options.ipcMain.handle("collections.openCitation", async (event, request: unknown) => {
    const parsed = CollectionOpenCitationRequestSchema.parse(request);
    if (!options.isTrustedSender(event.sender) || options.getActiveVaultId() !== parsed.activeVaultId) {
      return failedCitation(parsed);
    }
    let rawResult: CollectionOpenCitationResult;
    try {
      rawResult = await options.openCollectionCitation(parsed);
    } catch {
      return failedCitation(parsed);
    }
    const result = assertCitationIdentity(
      parsed,
      CollectionOpenCitationResultSchema.parse(rawResult)
    );
    return options.isTrustedSender(event.sender) && options.getActiveVaultId() === parsed.activeVaultId
      ? result
      : failedCitation(parsed);
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

  options.ipcMain.handle(COLLECTION_ADD_FORMULA_COLUMN_CHANNEL, async (event, request: unknown) => {
    const parsed = CollectionAddFormulaColumnRequestSchema.parse(request);
    if (
      !options.isTrustedSender(event.sender) ||
      options.getActiveVaultId() !== parsed.activeVaultId ||
      !options.addFormulaCollectionColumn
    ) {
      return failedAddFormulaColumn(parsed);
    }
    let rawResult: CollectionAddFormulaColumnResult;
    try {
      rawResult = await options.addFormulaCollectionColumn(parsed);
    } catch {
      return failedAddFormulaColumn(parsed);
    }
    const result = CollectionAddFormulaColumnResultSchema.parse(rawResult);
    if (
      result.requestId !== parsed.requestId ||
      result.activeVaultId !== parsed.activeVaultId ||
      result.datasetId !== parsed.datasetId ||
      result.tableId !== parsed.tableId
    ) {
      throw new Error("Managed Collection formula-column response identity did not match the request.");
    }
    return options.isTrustedSender(event.sender) && options.getActiveVaultId() === parsed.activeVaultId
      ? result
      : failedAddFormulaColumn(parsed);
  });

  options.ipcMain.handle(COLLECTION_UPDATE_FORMULA_COLUMN_CHANNEL, async (event, request: unknown) => {
    const parsed = CollectionUpdateFormulaColumnRequestSchema.parse(request);
    if (!options.isTrustedSender(event.sender) || options.getActiveVaultId() !== parsed.activeVaultId ||
        !options.updateFormulaCollectionColumn) return failedUpdateFormulaColumn(parsed);
    let rawResult: CollectionUpdateFormulaColumnResult;
    try { rawResult = await options.updateFormulaCollectionColumn(parsed); }
    catch { return failedUpdateFormulaColumn(parsed); }
    const result = CollectionUpdateFormulaColumnResultSchema.parse(rawResult);
    if (result.requestId !== parsed.requestId || result.activeVaultId !== parsed.activeVaultId ||
        result.datasetId !== parsed.datasetId || result.tableId !== parsed.tableId || result.columnId !== parsed.columnId) {
      throw new Error("Managed Collection formula-update response identity did not match the request.");
    }
    return options.isTrustedSender(event.sender) && options.getActiveVaultId() === parsed.activeVaultId
      ? result : failedUpdateFormulaColumn(parsed);
  });

  options.ipcMain.handle(COLLECTION_ADD_RELATION_COLUMN_CHANNEL, async (event, request: unknown) => {
    const parsed = CollectionAddRelationColumnRequestSchema.parse(request);
    if (!options.isTrustedSender(event.sender) || options.getActiveVaultId() !== parsed.activeVaultId ||
        !options.addRelationCollectionColumn) return failedAddRelationColumn(parsed);
    let rawResult: CollectionAddRelationColumnResult;
    try { rawResult = await options.addRelationCollectionColumn(parsed); }
    catch { return failedAddRelationColumn(parsed); }
    const result = CollectionAddRelationColumnResultSchema.parse(rawResult);
    if (result.requestId !== parsed.requestId || result.activeVaultId !== parsed.activeVaultId ||
        result.datasetId !== parsed.datasetId || result.tableId !== parsed.tableId ||
        result.targetTableId !== parsed.targetTableId ||
        result.targetDisplayColumnId !== parsed.targetDisplayColumnId) {
      throw new Error("Managed Collection relation-column response identity did not match the request.");
    }
    return options.isTrustedSender(event.sender) && options.getActiveVaultId() === parsed.activeVaultId
      ? result : failedAddRelationColumn(parsed);
  });

  options.ipcMain.handle(COLLECTION_EDIT_RELATION_CELL_CHANNEL, async (event, request: unknown) => {
    const parsed = CollectionEditRelationCellRequestSchema.parse(request);
    if (!options.isTrustedSender(event.sender) || options.getActiveVaultId() !== parsed.activeVaultId ||
        !options.editRelationCollectionCell) return failedEditRelationCell(parsed);
    let rawResult: CollectionEditRelationCellResult;
    try { rawResult = await options.editRelationCollectionCell(parsed); }
    catch { return failedEditRelationCell(parsed); }
    const result = CollectionEditRelationCellResultSchema.parse(rawResult);
    if (result.requestId !== parsed.requestId || result.activeVaultId !== parsed.activeVaultId ||
        result.datasetId !== parsed.datasetId || result.tableId !== parsed.tableId ||
        result.rowId !== parsed.rowId || result.columnId !== parsed.columnId ||
        result.targetRowId !== parsed.targetRowId) {
      throw new Error("Managed Collection relation-cell response identity did not match the request.");
    }
    return options.isTrustedSender(event.sender) && options.getActiveVaultId() === parsed.activeVaultId
      ? result : failedEditRelationCell(parsed);
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
