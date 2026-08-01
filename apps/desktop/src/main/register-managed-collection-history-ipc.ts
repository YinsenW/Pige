import type { IpcMain } from "electron";
import {
  COLLECTION_LIST_REVISION_HISTORY_CHANNEL,
  COLLECTION_OPEN_REVISION_HISTORY_CHANNEL,
  COLLECTION_RESTORE_REVISION_HISTORY_CHANNEL,
  CollectionListRevisionHistoryRequestSchema,
  CollectionListRevisionHistoryResultSchema,
  CollectionOpenRevisionHistoryRequestSchema,
  CollectionOpenRevisionHistoryResultSchema,
  CollectionRestoreRevisionHistoryRequestSchema,
  CollectionRestoreRevisionHistoryResultSchema,
  type CollectionListRevisionHistoryRequest,
  type CollectionListRevisionHistoryResult,
  type CollectionOpenRevisionHistoryRequest,
  type CollectionOpenRevisionHistoryResult,
  type CollectionRestoreRevisionHistoryRequest,
  type CollectionRestoreRevisionHistoryResult
} from "@pige/schemas";

interface RegisterManagedCollectionHistoryIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly isTrustedSender: (sender: Electron.WebContents) => boolean;
  readonly getActiveVaultId: () => string | undefined;
  readonly list: (request: CollectionListRevisionHistoryRequest) => CollectionListRevisionHistoryResult;
  readonly open: (request: CollectionOpenRevisionHistoryRequest) => CollectionOpenRevisionHistoryResult;
  readonly restore: (request: CollectionRestoreRevisionHistoryRequest) => Promise<CollectionRestoreRevisionHistoryResult>;
}

export function registerManagedCollectionHistoryIpc(options: RegisterManagedCollectionHistoryIpcOptions): void {
  options.ipcMain.handle(COLLECTION_LIST_REVISION_HISTORY_CHANNEL, (event, input: unknown) => {
    const request = CollectionListRevisionHistoryRequestSchema.parse(input);
    if (!options.isTrustedSender(event.sender) || options.getActiveVaultId() !== request.activeVaultId) {
      return CollectionListRevisionHistoryResultSchema.parse({ ...baseIdentity(request), status: "not_found" });
    }
    return options.list(request);
  });
  options.ipcMain.handle(COLLECTION_OPEN_REVISION_HISTORY_CHANNEL, (event, input: unknown) => {
    const request = CollectionOpenRevisionHistoryRequestSchema.parse(input);
    if (!options.isTrustedSender(event.sender) || options.getActiveVaultId() !== request.activeVaultId) {
      return CollectionOpenRevisionHistoryResultSchema.parse({ ...openIdentity(request), status: "not_found" });
    }
    return options.open(request);
  });
  options.ipcMain.handle(COLLECTION_RESTORE_REVISION_HISTORY_CHANNEL, async (event, input: unknown) => {
    const request = CollectionRestoreRevisionHistoryRequestSchema.parse(input);
    if (!options.isTrustedSender(event.sender) || options.getActiveVaultId() !== request.activeVaultId) {
      return CollectionRestoreRevisionHistoryResultSchema.parse({ ...restoreIdentity(request), status: "not_found" });
    }
    return options.restore(request);
  });
}

function baseIdentity(request: CollectionListRevisionHistoryRequest) {
  return { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId,
    datasetId: request.datasetId, expectedCurrentRevisionId: request.expectedCurrentRevisionId };
}
function openIdentity(request: CollectionOpenRevisionHistoryRequest) {
  return { ...baseIdentity(request), revisionId: request.revisionId, tableId: request.tableId };
}
function restoreIdentity(request: CollectionRestoreRevisionHistoryRequest) {
  return { ...openIdentity(request), confirmation: request.confirmation };
}
