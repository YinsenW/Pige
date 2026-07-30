import { describe, expect, it, vi } from "vitest";
import { VAULT_RENAME_DISPLAY_NAME_CHANNEL } from "@pige/schemas";
import { registerVaultMetadataIpc } from "../../apps/desktop/src/main/register-vault-metadata-ipc";

const request = {
  apiVersion: 1 as const,
  requestId: "vaultrenamereq_0123456789abcdef",
  activeVaultId: "vault_20260731_renameipc",
  expectedMetadataRevision: `vaultmeta_${"a".repeat(64)}`,
  displayName: "Renamed"
};

describe("Vault metadata IPC", () => {
  it("parses a strict request and projects an exact pathless result", async () => {
    let handler: ((_event: unknown, request: unknown) => unknown) | undefined;
    const renameDisplayName = vi.fn(() => ({
      ...request,
      status: "renamed" as const,
      metadata: {
        activeVaultId: request.activeVaultId,
        displayName: request.displayName,
        revision: `vaultmeta_${"b".repeat(64)}`
      }
    }));
    registerVaultMetadataIpc({
      ipcMain: { handle: (channel, candidate) => { expect(channel).toBe(VAULT_RENAME_DISPLAY_NAME_CHANNEL); handler = candidate; } },
      renameDisplayName
    });

    const result = await handler?.({}, request);

    expect(renameDisplayName).toHaveBeenCalledWith(request);
    expect(result).toMatchObject({ status: "renamed", metadata: { displayName: "Renamed" } });
    expect(JSON.stringify(result)).not.toContain("/Users/");
  });

  it("rejects extra authority and fails closed on a mismatched owner identity", async () => {
    let handler: ((_event: unknown, request: unknown) => unknown) | undefined;
    registerVaultMetadataIpc({
      ipcMain: { handle: (_channel, candidate) => { handler = candidate; } },
      renameDisplayName: () => ({ ...request, requestId: "vaultrenamereq_ffffffffffffffff", status: "failed" })
    });
    expect(() => handler?.({}, { ...request, sourceContent: "private" })).toThrow();
    expect(await handler?.({}, request)).toEqual({ ...request, status: "failed" });
  });
});
