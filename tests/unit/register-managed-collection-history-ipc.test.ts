import { describe, expect, it, vi } from "vitest";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import type { CollectionListRevisionHistoryRequest, CollectionOpenRevisionHistoryRequest,
  CollectionRestoreRevisionHistoryRequest } from "@pige/schemas";
import { registerManagedCollectionHistoryIpc } from "../../apps/desktop/src/main/register-managed-collection-history-ipc";

type Handler = (event: IpcMainInvokeEvent, input: unknown) => unknown;
const activeVaultId = "vault_20260727_collection";
const base = { apiVersion: 1 as const, requestId: "collection_request_historyipc000001",
  activeVaultId, datasetId: "dataset_20260727_abcdefghijkl",
  expectedCurrentRevisionId: "dataset_rev_20260727_abcdefghijkl" };

describe("registerManagedCollectionHistoryIpc", () => {
  it("routes strict trusted history requests and fails closed for stale senders", async () => {
    const handlers = new Map<string, Handler>();
    const list = vi.fn((request: CollectionListRevisionHistoryRequest) => ({ ...request, status: "ready" as const,
      currentRevisionId: request.expectedCurrentRevisionId, revisions: [], hasMore: false }));
    const open = vi.fn((request: CollectionOpenRevisionHistoryRequest) => ({ ...request, status: "not_found" as const }));
    const restore = vi.fn(async (request: CollectionRestoreRevisionHistoryRequest) => ({ ...request, status: "not_found" as const }));
    registerManagedCollectionHistoryIpc({ ipcMain: { handle: (channel, handler) =>
      handlers.set(channel, handler as Handler) } as Pick<IpcMain, "handle">,
    isTrustedSender: () => true, getActiveVaultId: () => activeVaultId, list, open, restore });
    const event = { sender: {} } as IpcMainInvokeEvent;
    expect(await handlers.get("collections.listRevisionHistory")!(event, { ...base, limit: 25 }))
      .toMatchObject({ status: "ready", currentRevisionId: base.expectedCurrentRevisionId });
    expect(await handlers.get("collections.openRevisionHistory")!(event, { ...base,
      requestId: "collection_request_historyipc000002", revisionId: base.expectedCurrentRevisionId,
      tableId: "table_abcdefghijkl" })).toMatchObject({ status: "not_found" });
    expect(await handlers.get("collections.restoreRevisionHistory")!(event, { ...base,
      requestId: "collection_request_historyipc000003", revisionId: "dataset_rev_20260727_bcdefghijklm",
      tableId: "table_abcdefghijkl", confirmation: "restore_as_new_revision" })).toMatchObject({ status: "not_found" });
    expect(list).toHaveBeenCalledOnce(); expect(open).toHaveBeenCalledOnce(); expect(restore).toHaveBeenCalledOnce();

    const blocked = new Map<string, Handler>();
    registerManagedCollectionHistoryIpc({ ipcMain: { handle: (channel, handler) =>
      blocked.set(channel, handler as Handler) } as Pick<IpcMain, "handle">,
    isTrustedSender: () => false, getActiveVaultId: () => activeVaultId, list, open, restore });
    expect(await blocked.get("collections.listRevisionHistory")!(event, { ...base, limit: 25 }))
      .toMatchObject({ status: "not_found" });
    expect(list).toHaveBeenCalledOnce();
  });
});
