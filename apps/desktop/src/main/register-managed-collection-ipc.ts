import type { IpcMain, WebContents } from "electron";
import {
  COLLECTION_ADD_FORMULA_COLUMN_CHANNEL,
  COLLECTION_ADD_RELATION_COLUMN_CHANNEL,
  COLLECTION_UPDATE_RELATION_COLUMN_CHANNEL,
  COLLECTION_EDIT_RELATION_CELL_CHANNEL,
  COLLECTION_ADD_LOOKUP_COLUMN_CHANNEL,
  COLLECTION_UPDATE_LOOKUP_COLUMN_CHANNEL,
  COLLECTION_ADD_ROLLUP_COLUMN_CHANNEL,
  COLLECTION_UPDATE_ROLLUP_COLUMN_CHANNEL,
  COLLECTION_UPDATE_FORMULA_COLUMN_CHANNEL,
  COLLECTION_UPDATE_VIEW_CHANNEL,
  COLLECTION_RENAME_VIEW_CHANNEL,
  COLLECTION_TRASH_VIEW_CHANNEL,
  COLLECTION_RENAME_DATASET_CHANNEL,
  COLLECTION_REVEAL_CHANNEL,
  CollectionAddFormulaColumnRequestSchema,
  CollectionAddFormulaColumnResultSchema,
  CollectionAddRelationColumnRequestSchema,
  CollectionAddRelationColumnResultSchema,
  CollectionUpdateRelationColumnRequestSchema,
  CollectionUpdateRelationColumnResultSchema,
  CollectionEditRelationCellRequestSchema,
  CollectionEditRelationCellResultSchema,
  CollectionAddLookupColumnRequestSchema,
  CollectionAddLookupColumnResultSchema,
  CollectionUpdateLookupColumnRequestSchema,
  CollectionUpdateLookupColumnResultSchema,
  CollectionAddRollupColumnRequestSchema,
  CollectionAddRollupColumnResultSchema,
  CollectionUpdateRollupColumnRequestSchema,
  CollectionUpdateRollupColumnResultSchema,
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
  CollectionUpdateViewRequestSchema,
  CollectionUpdateViewResultSchema,
  CollectionRenameViewRequestSchema,
  CollectionRenameViewResultSchema,
  CollectionTrashViewRequestSchema,
  CollectionTrashViewResultSchema,
  CollectionRenameDatasetRequestSchema,
  CollectionRenameDatasetResultSchema,
  CollectionOpenCitationRequestSchema,
  CollectionOpenCitationResultSchema,
  CollectionListRequestSchema,
  CollectionListResultSchema,
  CollectionOpenRequestSchema,
  CollectionOpenResultSchema,
  CollectionRevealRequestSchema,
  CollectionRevealResultSchema,
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
  type CollectionUpdateRelationColumnRequest,
  type CollectionUpdateRelationColumnResult,
  type CollectionEditRelationCellRequest,
  type CollectionEditRelationCellResult,
  type CollectionAddLookupColumnRequest,
  type CollectionAddLookupColumnResult,
  type CollectionUpdateLookupColumnRequest,
  type CollectionUpdateLookupColumnResult,
  type CollectionAddRollupColumnRequest,
  type CollectionAddRollupColumnResult,
  type CollectionUpdateRollupColumnRequest,
  type CollectionUpdateRollupColumnResult,
  type CollectionUpdateFormulaColumnRequest,
  type CollectionUpdateFormulaColumnResult,
  type CollectionCellEditRequest,
  type CollectionCellEditResult,
  type CollectionCreateViewRequest,
  type CollectionCreateViewResult,
  type CollectionUpdateViewRequest,
  type CollectionUpdateViewResult,
  type CollectionRenameViewRequest,
  type CollectionRenameViewResult,
  type CollectionTrashViewRequest,
  type CollectionTrashViewResult,
  type CollectionTrashDatasetRequest,
  type CollectionTrashDatasetResult,
  type CollectionListDatasetTrashRequest,
  type CollectionListDatasetTrashResult,
  type CollectionRestoreDatasetRequest,
  type CollectionRestoreDatasetResult,
  type CollectionRenameDatasetRequest,
  type CollectionRenameDatasetResult,
  type CollectionOpenCitationRequest,
  type CollectionOpenCitationResult,
  type CollectionListRequest,
  type CollectionListResult,
  type CollectionAppendDefaultRowRequest,
  type CollectionAppendDefaultRowResult,
  type CollectionOpenRequest,
  type CollectionOpenResult,
  type CollectionRevealRequest,
  type CollectionRevealResult,
  type CollectionRenameColumnRequest,
  type CollectionRenameColumnResult,
  type CollectionTrashColumnRequest,
  type CollectionTrashColumnResult,
  type CollectionTrashRowRequest,
  type CollectionTrashRowResult
} from "@pige/schemas";
import { registerManagedDatasetLifecycleIpc } from "./register-managed-dataset-lifecycle-ipc";

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
  readonly revealCollection: (
    request: CollectionRevealRequest
  ) => CollectionRevealResult | Promise<CollectionRevealResult>;
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
  readonly updateRelationCollectionColumn?: (
    request: CollectionUpdateRelationColumnRequest
  ) => CollectionUpdateRelationColumnResult | Promise<CollectionUpdateRelationColumnResult>;
  readonly editRelationCollectionCell?: (
    request: CollectionEditRelationCellRequest
  ) => CollectionEditRelationCellResult | Promise<CollectionEditRelationCellResult>;
  readonly addLookupCollectionColumn?: (
    request: CollectionAddLookupColumnRequest
  ) => CollectionAddLookupColumnResult | Promise<CollectionAddLookupColumnResult>;
  readonly updateLookupCollectionColumn?: (
    request: CollectionUpdateLookupColumnRequest
  ) => CollectionUpdateLookupColumnResult | Promise<CollectionUpdateLookupColumnResult>;
  readonly addRollupCollectionColumn?: (
    request: CollectionAddRollupColumnRequest
  ) => CollectionAddRollupColumnResult | Promise<CollectionAddRollupColumnResult>;
  readonly updateRollupCollectionColumn?: (
    request: CollectionUpdateRollupColumnRequest
  ) => CollectionUpdateRollupColumnResult | Promise<CollectionUpdateRollupColumnResult>;
  readonly renameCollectionColumn: (
    request: CollectionRenameColumnRequest
  ) => CollectionRenameColumnResult | Promise<CollectionRenameColumnResult>;
  readonly createCollectionView: (
    request: CollectionCreateViewRequest
  ) => CollectionCreateViewResult | Promise<CollectionCreateViewResult>;
  readonly updateCollectionView: (
    request: CollectionUpdateViewRequest
  ) => CollectionUpdateViewResult | Promise<CollectionUpdateViewResult>;
  readonly renameCollectionView: (
    request: CollectionRenameViewRequest
  ) => CollectionRenameViewResult | Promise<CollectionRenameViewResult>;
  readonly trashCollectionView: (
    request: CollectionTrashViewRequest
  ) => CollectionTrashViewResult | Promise<CollectionTrashViewResult>;
  readonly trashDataset: (
    request: CollectionTrashDatasetRequest
  ) => CollectionTrashDatasetResult | Promise<CollectionTrashDatasetResult>;
  readonly listDatasetTrash: (
    request: CollectionListDatasetTrashRequest
  ) => CollectionListDatasetTrashResult | Promise<CollectionListDatasetTrashResult>;
  readonly restoreDataset: (
    request: CollectionRestoreDatasetRequest
  ) => CollectionRestoreDatasetResult | Promise<CollectionRestoreDatasetResult>;
  readonly renameDataset: (
    request: CollectionRenameDatasetRequest
  ) => CollectionRenameDatasetResult | Promise<CollectionRenameDatasetResult>;
  readonly trashCollectionColumn: (
    request: CollectionTrashColumnRequest
  ) => CollectionTrashColumnResult | Promise<CollectionTrashColumnResult>;
  readonly trashCollectionRow: (
    request: CollectionTrashRowRequest
  ) => CollectionTrashRowResult | Promise<CollectionTrashRowResult>;
}

function sameRevealIdentity(request: CollectionRevealRequest, result: CollectionRevealResult): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.datasetId === request.datasetId && result.revisionId === request.revisionId &&
    result.tableId === request.tableId;
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

function failedUpdateRelationColumn(request: CollectionUpdateRelationColumnRequest): CollectionUpdateRelationColumnResult {
  return CollectionUpdateRelationColumnResultSchema.parse({
    apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
    datasetId: request.datasetId, tableId: request.tableId, columnId: request.columnId,
    targetTableId: request.targetTableId, targetDisplayColumnId: request.targetDisplayColumnId, status: "failed"
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

function failedAddLookupColumn(request: CollectionAddLookupColumnRequest): CollectionAddLookupColumnResult {
  return CollectionAddLookupColumnResultSchema.parse({
    apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
    datasetId: request.datasetId, tableId: request.tableId,
    relationColumnId: request.relationColumnId, targetColumnId: request.targetColumnId, status: "failed"
  });
}

function failedUpdateLookupColumn(request: CollectionUpdateLookupColumnRequest): CollectionUpdateLookupColumnResult {
  return CollectionUpdateLookupColumnResultSchema.parse({
    apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
    datasetId: request.datasetId, tableId: request.tableId, columnId: request.columnId,
    relationColumnId: request.relationColumnId, targetColumnId: request.targetColumnId, status: "failed"
  });
}

function failedAddRollupColumn(request: CollectionAddRollupColumnRequest): CollectionAddRollupColumnResult {
  return CollectionAddRollupColumnResultSchema.parse({
    apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
    datasetId: request.datasetId, tableId: request.tableId, relationColumnId: request.relationColumnId,
    aggregation: request.aggregation, ...(request.targetColumnId ? { targetColumnId: request.targetColumnId } : {}), status: "failed"
  });
}

function failedUpdateRollupColumn(request: CollectionUpdateRollupColumnRequest): CollectionUpdateRollupColumnResult {
  return CollectionUpdateRollupColumnResultSchema.parse({
    apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
    datasetId: request.datasetId, tableId: request.tableId, columnId: request.columnId,
    relationColumnId: request.relationColumnId, aggregation: request.aggregation,
    ...(request.targetColumnId ? { targetColumnId: request.targetColumnId } : {}), status: "failed"
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

function failedRenameView(request: CollectionRenameViewRequest): CollectionRenameViewResult {
  return CollectionRenameViewResultSchema.parse({ apiVersion: request.apiVersion, requestId: request.requestId,
    activeVaultId: request.activeVaultId, datasetId: request.datasetId, tableId: request.tableId,
    viewId: request.viewId, status: "failed" });
}

function failedUpdateView(request: CollectionUpdateViewRequest): CollectionUpdateViewResult {
  return CollectionUpdateViewResultSchema.parse({ apiVersion: request.apiVersion, requestId: request.requestId,
    activeVaultId: request.activeVaultId, datasetId: request.datasetId, tableId: request.tableId,
    viewId: request.viewId, status: "failed" });
}

function failedTrashView(request: CollectionTrashViewRequest): CollectionTrashViewResult {
  return CollectionTrashViewResultSchema.parse({ apiVersion: request.apiVersion, requestId: request.requestId,
    activeVaultId: request.activeVaultId, datasetId: request.datasetId, tableId: request.tableId,
    viewId: request.viewId, status: "failed" });
}

function failedRenameDataset(request: CollectionRenameDatasetRequest): CollectionRenameDatasetResult {
  return CollectionRenameDatasetResultSchema.parse({ apiVersion: request.apiVersion, requestId: request.requestId,
    activeVaultId: request.activeVaultId, datasetId: request.datasetId,
    expectedRevisionId: request.expectedRevisionId, status: "failed" });
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

  options.ipcMain.handle(COLLECTION_REVEAL_CHANNEL, async (event, request: unknown) => {
    const parsed = CollectionRevealRequestSchema.parse(request);
    if (!options.isTrustedSender(event.sender) || options.getActiveVaultId() !== parsed.activeVaultId) {
      return CollectionRevealResultSchema.parse({ ...parsed, status: "stale" });
    }
    try {
      const result = CollectionRevealResultSchema.parse(await options.revealCollection(parsed));
      if (!sameRevealIdentity(parsed, result) || !options.isTrustedSender(event.sender) ||
          options.getActiveVaultId() !== parsed.activeVaultId) {
        return CollectionRevealResultSchema.parse({ ...parsed, status: "stale" });
      }
      return result;
    } catch {
      return CollectionRevealResultSchema.parse({ ...parsed, status: "failed" });
    }
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

  options.ipcMain.handle(COLLECTION_UPDATE_RELATION_COLUMN_CHANNEL, async (event, request: unknown) => {
    const parsed = CollectionUpdateRelationColumnRequestSchema.parse(request);
    if (!options.isTrustedSender(event.sender) || options.getActiveVaultId() !== parsed.activeVaultId ||
        !options.updateRelationCollectionColumn) return failedUpdateRelationColumn(parsed);
    let rawResult: CollectionUpdateRelationColumnResult;
    try { rawResult = await options.updateRelationCollectionColumn(parsed); }
    catch { return failedUpdateRelationColumn(parsed); }
    const result = CollectionUpdateRelationColumnResultSchema.parse(rawResult);
    if (result.requestId !== parsed.requestId || result.activeVaultId !== parsed.activeVaultId ||
        result.datasetId !== parsed.datasetId || result.tableId !== parsed.tableId || result.columnId !== parsed.columnId ||
        result.targetTableId !== parsed.targetTableId || result.targetDisplayColumnId !== parsed.targetDisplayColumnId) {
      throw new Error("Managed Collection relation-update response identity did not match the request.");
    }
    return options.isTrustedSender(event.sender) && options.getActiveVaultId() === parsed.activeVaultId
      ? result : failedUpdateRelationColumn(parsed);
  });

  options.ipcMain.handle(COLLECTION_ADD_LOOKUP_COLUMN_CHANNEL, async (event, request: unknown) => {
    const parsed = CollectionAddLookupColumnRequestSchema.parse(request);
    if (!options.isTrustedSender(event.sender) || options.getActiveVaultId() !== parsed.activeVaultId ||
        !options.addLookupCollectionColumn) return failedAddLookupColumn(parsed);
    let rawResult: CollectionAddLookupColumnResult;
    try { rawResult = await options.addLookupCollectionColumn(parsed); }
    catch { return failedAddLookupColumn(parsed); }
    const result = CollectionAddLookupColumnResultSchema.parse(rawResult);
    if (result.requestId !== parsed.requestId || result.activeVaultId !== parsed.activeVaultId ||
        result.datasetId !== parsed.datasetId || result.tableId !== parsed.tableId ||
        result.relationColumnId !== parsed.relationColumnId || result.targetColumnId !== parsed.targetColumnId) {
      throw new Error("Managed Collection lookup-column response identity did not match the request.");
    }
    return options.isTrustedSender(event.sender) && options.getActiveVaultId() === parsed.activeVaultId
      ? result : failedAddLookupColumn(parsed);
  });

  options.ipcMain.handle(COLLECTION_ADD_ROLLUP_COLUMN_CHANNEL, async (event, request: unknown) => {
    const parsed = CollectionAddRollupColumnRequestSchema.parse(request);
    if (!options.isTrustedSender(event.sender) || options.getActiveVaultId() !== parsed.activeVaultId ||
        !options.addRollupCollectionColumn) return failedAddRollupColumn(parsed);
    let rawResult: CollectionAddRollupColumnResult;
    try { rawResult = await options.addRollupCollectionColumn(parsed); }
    catch { return failedAddRollupColumn(parsed); }
    const result = CollectionAddRollupColumnResultSchema.parse(rawResult);
    if (result.requestId !== parsed.requestId || result.activeVaultId !== parsed.activeVaultId ||
        result.datasetId !== parsed.datasetId || result.tableId !== parsed.tableId ||
        result.relationColumnId !== parsed.relationColumnId || result.aggregation !== parsed.aggregation ||
        result.targetColumnId !== parsed.targetColumnId) {
      throw new Error("Managed Collection rollup-column response identity did not match the request.");
    }
    return options.isTrustedSender(event.sender) && options.getActiveVaultId() === parsed.activeVaultId
      ? result : failedAddRollupColumn(parsed);
  });

  options.ipcMain.handle(COLLECTION_UPDATE_LOOKUP_COLUMN_CHANNEL, async (event, request: unknown) => {
    const parsed = CollectionUpdateLookupColumnRequestSchema.parse(request);
    if (!options.isTrustedSender(event.sender) || options.getActiveVaultId() !== parsed.activeVaultId ||
        !options.updateLookupCollectionColumn) return failedUpdateLookupColumn(parsed);
    let rawResult: CollectionUpdateLookupColumnResult;
    try { rawResult = await options.updateLookupCollectionColumn(parsed); }
    catch { return failedUpdateLookupColumn(parsed); }
    const result = CollectionUpdateLookupColumnResultSchema.parse(rawResult);
    if (result.requestId !== parsed.requestId || result.activeVaultId !== parsed.activeVaultId ||
        result.datasetId !== parsed.datasetId || result.tableId !== parsed.tableId || result.columnId !== parsed.columnId ||
        result.relationColumnId !== parsed.relationColumnId || result.targetColumnId !== parsed.targetColumnId) {
      throw new Error("Managed Collection lookup-update response identity did not match the request.");
    }
    return options.isTrustedSender(event.sender) && options.getActiveVaultId() === parsed.activeVaultId
      ? result : failedUpdateLookupColumn(parsed);
  });

  options.ipcMain.handle(COLLECTION_UPDATE_ROLLUP_COLUMN_CHANNEL, async (event, request: unknown) => {
    const parsed = CollectionUpdateRollupColumnRequestSchema.parse(request);
    if (!options.isTrustedSender(event.sender) || options.getActiveVaultId() !== parsed.activeVaultId ||
        !options.updateRollupCollectionColumn) return failedUpdateRollupColumn(parsed);
    let rawResult: CollectionUpdateRollupColumnResult;
    try { rawResult = await options.updateRollupCollectionColumn(parsed); }
    catch { return failedUpdateRollupColumn(parsed); }
    const result = CollectionUpdateRollupColumnResultSchema.parse(rawResult);
    if (result.requestId !== parsed.requestId || result.activeVaultId !== parsed.activeVaultId ||
        result.datasetId !== parsed.datasetId || result.tableId !== parsed.tableId || result.columnId !== parsed.columnId ||
        result.relationColumnId !== parsed.relationColumnId || result.aggregation !== parsed.aggregation ||
        result.targetColumnId !== parsed.targetColumnId) throw new Error("Managed Collection rollup-update response identity did not match the request.");
    return options.isTrustedSender(event.sender) && options.getActiveVaultId() === parsed.activeVaultId
      ? result : failedUpdateRollupColumn(parsed);
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

  options.ipcMain.handle(COLLECTION_RENAME_VIEW_CHANNEL, async (event, request: unknown) => {
    const parsed = CollectionRenameViewRequestSchema.parse(request);
    if (!options.isTrustedSender(event.sender) || options.getActiveVaultId() !== parsed.activeVaultId) {
      return failedRenameView(parsed);
    }
    let rawResult: CollectionRenameViewResult;
    try {
      rawResult = await options.renameCollectionView(parsed);
    } catch {
      return failedRenameView(parsed);
    }
    const result = CollectionRenameViewResultSchema.parse(rawResult);
    if (
      result.requestId !== parsed.requestId || result.activeVaultId !== parsed.activeVaultId ||
      result.datasetId !== parsed.datasetId || result.tableId !== parsed.tableId ||
      result.viewId !== parsed.viewId
    ) throw new Error("Managed Collection view-rename response identity did not match the request.");
    return options.isTrustedSender(event.sender) && options.getActiveVaultId() === parsed.activeVaultId
      ? result : failedRenameView(parsed);
  });

  options.ipcMain.handle(COLLECTION_UPDATE_VIEW_CHANNEL, async (event, request: unknown) => {
    const parsed = CollectionUpdateViewRequestSchema.parse(request);
    if (!options.isTrustedSender(event.sender) || options.getActiveVaultId() !== parsed.activeVaultId) {
      return failedUpdateView(parsed);
    }
    let rawResult: CollectionUpdateViewResult;
    try { rawResult = await options.updateCollectionView(parsed); } catch { return failedUpdateView(parsed); }
    const result = CollectionUpdateViewResultSchema.parse(rawResult);
    if (result.requestId !== parsed.requestId || result.activeVaultId !== parsed.activeVaultId ||
        result.datasetId !== parsed.datasetId || result.tableId !== parsed.tableId || result.viewId !== parsed.viewId) {
      throw new Error("Managed Collection view-update response identity did not match the request.");
    }
    return options.isTrustedSender(event.sender) && options.getActiveVaultId() === parsed.activeVaultId
      ? result : failedUpdateView(parsed);
  });

  options.ipcMain.handle(COLLECTION_TRASH_VIEW_CHANNEL, async (event, request: unknown) => {
    const parsed = CollectionTrashViewRequestSchema.parse(request);
    if (!options.isTrustedSender(event.sender) || options.getActiveVaultId() !== parsed.activeVaultId) {
      return failedTrashView(parsed);
    }
    let rawResult: CollectionTrashViewResult;
    try {
      rawResult = await options.trashCollectionView(parsed);
    } catch {
      return failedTrashView(parsed);
    }
    const result = CollectionTrashViewResultSchema.parse(rawResult);
    if (
      result.requestId !== parsed.requestId || result.activeVaultId !== parsed.activeVaultId ||
      result.datasetId !== parsed.datasetId || result.tableId !== parsed.tableId ||
      result.viewId !== parsed.viewId
    ) throw new Error("Managed Collection view-trash response identity did not match the request.");
    return options.isTrustedSender(event.sender) && options.getActiveVaultId() === parsed.activeVaultId
      ? result : failedTrashView(parsed);
  });

  registerManagedDatasetLifecycleIpc(options);

  options.ipcMain.handle(COLLECTION_RENAME_DATASET_CHANNEL, async (event, request: unknown) => {
    const parsed = CollectionRenameDatasetRequestSchema.parse(request);
    if (!options.isTrustedSender(event.sender) || options.getActiveVaultId() !== parsed.activeVaultId) {
      return failedRenameDataset(parsed);
    }
    let rawResult: CollectionRenameDatasetResult;
    try { rawResult = await options.renameDataset(parsed); } catch { return failedRenameDataset(parsed); }
    const result = CollectionRenameDatasetResultSchema.parse(rawResult);
    if (result.requestId !== parsed.requestId || result.activeVaultId !== parsed.activeVaultId ||
        result.datasetId !== parsed.datasetId || result.expectedRevisionId !== parsed.expectedRevisionId) {
      throw new Error("Managed Dataset rename response identity did not match the request.");
    }
    return options.isTrustedSender(event.sender) && options.getActiveVaultId() === parsed.activeVaultId
      ? result : failedRenameDataset(parsed);
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
