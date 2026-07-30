import { describe, expect, it, vi } from "vitest";
import {
  VAULT_STORAGE_RELOCATE_CHANNEL,
  VAULT_STORAGE_RELOCATION_STATUS_CHANNEL
} from "@pige/schemas";
import { registerVaultStorageRelocationIpc } from "../../apps/desktop/src/main/register-vault-storage-relocation-ipc";

const request = {
  apiVersion: 1 as const,
  requestId: "vaultrelocatereq_0123456789abcdef",
  activeVaultId: "vault_20260731_relocateipc",
  expectedRevision: `vaultrelocationrev_${"a".repeat(64)}`
};

describe("Vault storage relocation IPC", () => {
  it("binds strict pathless handlers to the sending Main window", async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const parentWindow = {} as never;
    const relocate = vi.fn(async (_window, input) => ({
      ...input,
      status: "relocated" as const,
      revision: `vaultrelocationrev_${"b".repeat(64)}`
    }));
    registerVaultStorageRelocationIpc({
      ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } } as never,
      parentWindow: () => parentWindow,
      status: () => ({
        apiVersion: 1,
        status: "ready",
        activeVaultId: request.activeVaultId,
        revision: request.expectedRevision
      }),
      relocate
    });

    expect(await handlers.get(VAULT_STORAGE_RELOCATION_STATUS_CHANNEL)?.({ sender: {} }))
      .toMatchObject({ status: "ready", revision: request.expectedRevision });
    const result = await handlers.get(VAULT_STORAGE_RELOCATE_CHANNEL)?.({ sender: {} }, request);
    expect(result).toMatchObject({ status: "relocated", activeVaultId: request.activeVaultId });
    expect(JSON.stringify(result)).not.toMatch(/destinationPath|sourcePath|stagingPath|filePaths/u);
    expect(relocate).toHaveBeenCalledWith(parentWindow, request);
  });

  it("fails closed for missing windows, identity drift, and extra path input", async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    let hasWindow = false;
    registerVaultStorageRelocationIpc({
      ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } } as never,
      parentWindow: () => hasWindow ? ({} as never) : undefined,
      status: () => ({ apiVersion: 1, status: "unavailable" }),
      relocate: async (_window, input) => ({ ...input, requestId: `${input.requestId}x`, status: "failed" })
    });
    expect(await handlers.get(VAULT_STORAGE_RELOCATE_CHANNEL)?.({ sender: {} }, request))
      .toMatchObject({ ...request, status: "failed" });
    hasWindow = true;
    expect(await handlers.get(VAULT_STORAGE_RELOCATE_CHANNEL)?.({ sender: {} }, request))
      .toEqual({ ...request, status: "failed" });
    await expect(() => handlers.get(VAULT_STORAGE_RELOCATE_CHANNEL)?.(
      { sender: {} },
      { ...request, destinationPath: "/private/new" }
    )).rejects.toThrow();
  });
});
