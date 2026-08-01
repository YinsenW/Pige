import { describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import { registerManagedDatasetLifecycleIpc } from "../../apps/desktop/src/main/register-managed-dataset-lifecycle-ipc";

describe("managed Dataset lifecycle IPC", () => {
  it("keeps list, restore, and permanent delete trusted, strict, pathless, and identity-bound", async () => {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, request: unknown) => Promise<unknown>>();
    const vaultId = "vault_20260801_datasettrash";
    const datasetId = "dataset_20260801_abcdefghijkl";
    const revisionId = "dataset_rev_20260801_abcdefghijkl";
    const operationId = "op_20260801_datasettrash01";
    const trashRevision = `datasettrashrev_${"a".repeat(64)}`;
    const listDatasetTrash = vi.fn((request) => ({ ...request, status: "ready" as const,
      revision: trashRevision, datasets: [{ datasetId, title: "Records", revisionId,
        trashOperationId: operationId, trashedAt: "2026-08-01T00:00:00.000Z" }] }));
    const restoreDataset = vi.fn((request) => ({ ...request, status: "committed" as const,
      operationId: "op_20260801_datasetrestore01" }));
    const purgeDataset = vi.fn((request) => ({ ...request, status: "committed" as const,
      operationId: "op_20260801_datasetpurge001" }));
    registerManagedDatasetLifecycleIpc({
      ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler as never); } },
      isTrustedSender: (sender) => sender.id === 7,
      getActiveVaultId: () => vaultId,
      trashDataset: (request) => ({ ...request, status: "failed" }),
      listDatasetTrash,
      restoreDataset,
      purgeDataset
    });
    const event = { sender: { id: 7 } } as IpcMainInvokeEvent;
    const list = await handlers.get("collections.listDatasetTrash")!(event, {
      apiVersion: 1, requestId: "collection_request_datasettrashlist1", activeVaultId: vaultId
    });
    expect(list).toMatchObject({ status: "ready", datasets: [{ datasetId, title: "Records" }] });
    expect(JSON.stringify(list)).not.toMatch(/path|digest|checksum|source/u);
    const restored = await handlers.get("collections.restoreDataset")!(event, {
      apiVersion: 1, requestId: "collection_request_datasetrestore01", activeVaultId: vaultId,
      datasetId, expectedRevisionId: revisionId, trashOperationId: operationId,
      expectedTrashRevision: trashRevision
    });
    expect(restored).toMatchObject({ status: "committed", datasetId, operationId: "op_20260801_datasetrestore01" });
    const purged = await handlers.get("collections.purgeDataset")!(event, {
      apiVersion: 1, requestId: "collection_request_datasetpurge0001", activeVaultId: vaultId,
      datasetId, expectedRevisionId: revisionId, trashOperationId: operationId,
      expectedTrashRevision: trashRevision, confirmation: "delete_permanently"
    });
    expect(purged).toMatchObject({ status: "committed", datasetId, operationId: "op_20260801_datasetpurge001" });
    expect(listDatasetTrash).toHaveBeenCalledOnce(); expect(restoreDataset).toHaveBeenCalledOnce();
    expect(purgeDataset).toHaveBeenCalledOnce();
    const denied = await handlers.get("collections.listDatasetTrash")!({ sender: { id: 8 } } as IpcMainInvokeEvent, {
      apiVersion: 1, requestId: "collection_request_datasettrashlist2", activeVaultId: vaultId
    });
    expect(denied).toMatchObject({ status: "failed" });
  });
});
