import { describe, expect, it, vi } from "vitest";
import {
  VAULT_FORGET_RECENT_CHANNEL,
  VAULT_RECONNECT_RECENT_CHANNEL
} from "@pige/schemas";
import { registerVaultRecentIpc } from "../../apps/desktop/src/main/register-vault-recent-ipc";

const vaultId = "vault_20260731_recentipc";
const expectedRevision = `recentvaultrev_${"a".repeat(64)}`;
const forget = {
  apiVersion: 1 as const,
  requestId: "recentvaultforgetreq_0123456789abcdef",
  vaultId,
  expectedRevision
};
const reconnect = {
  apiVersion: 1 as const,
  requestId: "recentvaultreconnectreq_0123456789abcdef",
  vaultId,
  expectedRevision
};

describe("recent Vault lifecycle IPC", () => {
  it("parses exact requests, owns the reconnect window, and keeps mutation results pathless", async () => {
    const handlers = new Map<string, (event: { sender: object }, request: unknown) => unknown>();
    const parentWindow = {};
    const forgetRecent = vi.fn(() => ({ ...forget, status: "forgotten" as const }));
    const reconnectRecent = vi.fn(async () => ({
      ...reconnect,
      status: "reconnected" as const,
      revision: `recentvaultrev_${"b".repeat(64)}`
    }));
    registerVaultRecentIpc({
      ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler as never); } },
      parentWindow: () => parentWindow as never,
      forgetRecent,
      reconnectRecent
    });

    const forgotten = await handlers.get(VAULT_FORGET_RECENT_CHANNEL)?.({ sender: {} }, forget);
    const reconnected = await handlers.get(VAULT_RECONNECT_RECENT_CHANNEL)?.({ sender: {} }, reconnect);

    expect(forgetRecent).toHaveBeenCalledWith(forget);
    expect(reconnectRecent).toHaveBeenCalledWith(parentWindow, reconnect);
    expect(forgotten).toMatchObject({ status: "forgotten" });
    expect(reconnected).toMatchObject({ status: "reconnected" });
    expect(JSON.stringify([forgotten, reconnected])).not.toContain("path");
  });

  it("rejects renderer path authority and fails closed on missing windows or response drift", async () => {
    const handlers = new Map<string, (event: { sender: object }, request: unknown) => unknown>();
    registerVaultRecentIpc({
      ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler as never); } },
      parentWindow: () => undefined,
      forgetRecent: () => ({ ...forget, requestId: "recentvaultforgetreq_ffffffffffffffff", status: "failed" }),
      reconnectRecent: async () => ({ ...reconnect, status: "failed" })
    });

    expect(() => handlers.get(VAULT_FORGET_RECENT_CHANNEL)?.(
      { sender: {} },
      { ...forget, vaultPath: "/private/vault" }
    )).toThrow();
    expect(await handlers.get(VAULT_FORGET_RECENT_CHANNEL)?.({ sender: {} }, forget))
      .toEqual({ ...forget, status: "failed" });
    expect(await handlers.get(VAULT_RECONNECT_RECENT_CHANNEL)?.({ sender: {} }, reconnect))
      .toEqual({ ...reconnect, status: "failed" });
  });
});
