import { describe, expect, it, vi } from "vitest";
import type { IpcMain } from "electron";
import type { AgentConversationSetTitleRequest } from "@pige/contracts";
import { registerConversationHistoryIpc } from "../../apps/desktop/src/main/register-conversation-history-ipc";
import type { AgentConversationHistory } from "../../apps/desktop/src/main/services/agent-conversation-history";

const request: AgentConversationSetTitleRequest = {
  apiVersion: 1,
  requestId: "conversation_title_request_1234567890abcdef",
  activeVaultId: "vault_20260731_rename01",
  conversationId: "conv_20260731_rename01",
  expectedTailEventId: "evt_20260731_renametail01",
  expectedTitleRevision: 2,
  title: "Project notes"
};

describe("registerConversationHistoryIpc", () => {
  it("binds the mutation to the active vault and writer lease and exposes only the safe summary", () => {
    const handlers = new Map<string, (_event: unknown, input: unknown) => unknown>();
    const setTitle = vi.fn(() => ({
      status: "committed" as const,
      summary: {
        conversationId: request.conversationId,
        updatedAt: "2026-07-31T01:02:03.000Z",
        safePreview: "Original preview",
        tailEventId: request.expectedTailEventId,
        title: request.title ?? undefined,
        titleRevision: 3,
        latestUserEventId: "evt_20260731_privateuser01"
      }
    }));
    const assertWriterLease = vi.fn();
    registerConversationHistoryIpc({
      ipcMain: ipcMainFor(handlers),
      getActiveVault: () => ({ vaultId: request.activeVaultId, vaultPath: "/private/vault" }),
      assertWriterLease,
      history: { setTitle } as unknown as AgentConversationHistory
    });

    const result = invoke(handlers, request);
    expect(result).toMatchObject({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      conversationId: request.conversationId,
      status: "committed",
      summary: { title: "Project notes", titleRevision: 3 }
    });
    expect(JSON.stringify(result)).not.toContain("privateuser");
    expect(JSON.stringify(result)).not.toContain("/private/vault");
    expect(setTitle).toHaveBeenCalledWith({ vaultPath: "/private/vault", request });
    expect(assertWriterLease).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the active vault changes after the owner mutation", () => {
    const handlers = new Map<string, (_event: unknown, input: unknown) => unknown>();
    let read = 0;
    registerConversationHistoryIpc({
      ipcMain: ipcMainFor(handlers),
      getActiveVault: () => ++read === 1
        ? { vaultId: request.activeVaultId, vaultPath: "/vault/a" }
        : { vaultId: "vault_20260731_other001", vaultPath: "/vault/b" },
      assertWriterLease: () => undefined,
      history: {
        setTitle: () => ({
          status: "committed",
          summary: {
            conversationId: request.conversationId,
            updatedAt: "2026-07-31T01:02:03.000Z",
            safePreview: "Preview",
            tailEventId: request.expectedTailEventId,
            title: "Project notes",
            titleRevision: 3
          }
        })
      } as unknown as AgentConversationHistory
    });
    expect(invoke(handlers, request)).toEqual({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      conversationId: request.conversationId,
      status: "failed"
    });
  });

  it("rejects private renderer fields before calling the owner", () => {
    const handlers = new Map<string, (_event: unknown, input: unknown) => unknown>();
    const setTitle = vi.fn();
    registerConversationHistoryIpc({
      ipcMain: ipcMainFor(handlers),
      getActiveVault: () => ({ vaultId: request.activeVaultId, vaultPath: "/vault" }),
      assertWriterLease: () => undefined,
      history: { setTitle } as unknown as AgentConversationHistory
    });
    expect(() => invoke(handlers, { ...request, path: "/private", body: "raw" })).toThrow();
    expect(setTitle).not.toHaveBeenCalled();
  });
});

function ipcMainFor(
  handlers: Map<string, (_event: unknown, input: unknown) => unknown>
): Pick<IpcMain, "handle"> {
  return {
    handle: (channel, handler) => {
      handlers.set(channel, handler);
    }
  } as Pick<IpcMain, "handle">;
}

function invoke(
  handlers: Map<string, (_event: unknown, input: unknown) => unknown>,
  input: unknown
): unknown {
  const handler = handlers.get("agent.setConversationTitle");
  if (!handler) throw new Error("conversation title handler was not registered");
  return handler({}, input);
}
