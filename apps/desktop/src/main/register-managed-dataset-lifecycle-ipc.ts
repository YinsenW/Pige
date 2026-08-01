import type { IpcMain, WebContents } from "electron";
import {
  COLLECTION_LIST_DATASET_TRASH_CHANNEL,
  COLLECTION_RESTORE_DATASET_CHANNEL,
  COLLECTION_TRASH_DATASET_CHANNEL,
  CollectionListDatasetTrashRequestSchema,
  CollectionListDatasetTrashResultSchema,
  CollectionRestoreDatasetRequestSchema,
  CollectionRestoreDatasetResultSchema,
  CollectionTrashDatasetRequestSchema,
  CollectionTrashDatasetResultSchema,
  type CollectionListDatasetTrashRequest,
  type CollectionListDatasetTrashResult,
  type CollectionRestoreDatasetRequest,
  type CollectionRestoreDatasetResult,
  type CollectionTrashDatasetRequest,
  type CollectionTrashDatasetResult
} from "@pige/schemas";

export function registerManagedDatasetLifecycleIpc(options: {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly isTrustedSender: (sender: WebContents) => boolean;
  readonly getActiveVaultId: () => string | undefined;
  readonly trashDataset: (request: CollectionTrashDatasetRequest) => CollectionTrashDatasetResult | Promise<CollectionTrashDatasetResult>;
  readonly listDatasetTrash: (request: CollectionListDatasetTrashRequest) => CollectionListDatasetTrashResult | Promise<CollectionListDatasetTrashResult>;
  readonly restoreDataset: (request: CollectionRestoreDatasetRequest) => CollectionRestoreDatasetResult | Promise<CollectionRestoreDatasetResult>;
}): void {
  options.ipcMain.handle(COLLECTION_TRASH_DATASET_CHANNEL, async (event, request: unknown) => {
    const parsed = CollectionTrashDatasetRequestSchema.parse(request);
    if (!trusted(options, event.sender, parsed.activeVaultId)) return CollectionTrashDatasetResultSchema.parse({ ...parsed, status: "failed" });
    let raw: CollectionTrashDatasetResult;
    try { raw = await options.trashDataset(parsed); } catch { return CollectionTrashDatasetResultSchema.parse({ ...parsed, status: "failed" }); }
    const result = CollectionTrashDatasetResultSchema.parse(raw);
    assertIdentity(parsed, result, ["datasetId", "expectedRevisionId"]);
    return trusted(options, event.sender, parsed.activeVaultId) ? result : CollectionTrashDatasetResultSchema.parse({ ...parsed, status: "failed" });
  });

  options.ipcMain.handle(COLLECTION_LIST_DATASET_TRASH_CHANNEL, async (event, request: unknown) => {
    const parsed = CollectionListDatasetTrashRequestSchema.parse(request);
    if (!trusted(options, event.sender, parsed.activeVaultId)) return CollectionListDatasetTrashResultSchema.parse({ ...parsed, status: "failed" });
    let raw: CollectionListDatasetTrashResult;
    try { raw = await options.listDatasetTrash(parsed); } catch { return CollectionListDatasetTrashResultSchema.parse({ ...parsed, status: "failed" }); }
    const result = CollectionListDatasetTrashResultSchema.parse(raw);
    assertIdentity(parsed, result, []);
    return trusted(options, event.sender, parsed.activeVaultId) ? result : CollectionListDatasetTrashResultSchema.parse({ ...parsed, status: "failed" });
  });

  options.ipcMain.handle(COLLECTION_RESTORE_DATASET_CHANNEL, async (event, request: unknown) => {
    const parsed = CollectionRestoreDatasetRequestSchema.parse(request);
    if (!trusted(options, event.sender, parsed.activeVaultId)) return CollectionRestoreDatasetResultSchema.parse({ ...parsed, status: "failed" });
    let raw: CollectionRestoreDatasetResult;
    try { raw = await options.restoreDataset(parsed); } catch { return CollectionRestoreDatasetResultSchema.parse({ ...parsed, status: "failed" }); }
    const result = CollectionRestoreDatasetResultSchema.parse(raw);
    assertIdentity(parsed, result, ["datasetId", "expectedRevisionId", "trashOperationId", "expectedTrashRevision"]);
    return trusted(options, event.sender, parsed.activeVaultId) ? result : CollectionRestoreDatasetResultSchema.parse({ ...parsed, status: "failed" });
  });
}

function trusted(options: { readonly isTrustedSender: (sender: WebContents) => boolean; readonly getActiveVaultId: () => string | undefined }, sender: WebContents, vaultId: string): boolean {
  return options.isTrustedSender(sender) && options.getActiveVaultId() === vaultId;
}

function assertIdentity(request: Record<string, unknown>, result: Record<string, unknown>, keys: readonly string[]): void {
  if (request.requestId !== result.requestId || request.activeVaultId !== result.activeVaultId ||
      keys.some((key) => request[key] !== result[key])) throw new Error("Managed Dataset lifecycle response identity did not match the request.");
}
