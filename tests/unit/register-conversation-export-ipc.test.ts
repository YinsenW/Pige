import { describe, expect, it, vi } from "vitest";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { registerConversationExportIpc } from "../../apps/desktop/src/main/register-conversation-export-ipc";

type IpcHandler = (event: IpcMainInvokeEvent, request?: unknown) => unknown;

const binding = {
  vaultId: "vault_20260731_export01",
  vaultPath: "/private/vault"
} as const;
const request = {
  apiVersion: 1,
  requestId: "conversation_export_request_abcdefghijklmnop",
  activeVaultId: binding.vaultId,
  conversationId: "conv_20260731_export01",
  expectedTailEventId: "evt_20260731_assistant01"
} as const;

function makeHarness(overrides: {
  readonly getWindow?: () => object | undefined;
  readonly getActiveVaultBinding?: () => typeof binding | undefined;
  readonly showSaveDialog?: () => Promise<{ readonly canceled: boolean; readonly filePath?: string }>;
  readonly exportConversation?: (...args: any[]) => unknown;
} = {}) {
  const handlers = new Map<string, IpcHandler>();
  const exportConversation = vi.fn(overrides.exportConversation ?? ((_binding, parsed) => ({
    apiVersion: 1,
    requestId: parsed.requestId,
    activeVaultId: parsed.activeVaultId,
    conversationId: parsed.conversationId,
    status: "exported",
    tailEventId: parsed.expectedTailEventId,
    eventCount: 3
  })));
  registerConversationExportIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler as IpcHandler) } as Pick<IpcMain, "handle">,
    getWindow: (overrides.getWindow ?? (() => ({}))) as never,
    showSaveDialog: overrides.showSaveDialog ?? (async () => ({ canceled: false, filePath: "/private/export.json" })),
    getActiveVaultBinding: overrides.getActiveVaultBinding ?? (() => binding),
    exportConversation
  });
  return { handlers, exportConversation };
}

describe("registerConversationExportIpc", () => {
  it("passes the Main-selected destination only to the service and returns a pathless status", async () => {
    const harness = makeHarness();
    const result = await call(harness, request);
    expect(result).toMatchObject({
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      conversationId: request.conversationId,
      status: "exported",
      tailEventId: request.expectedTailEventId,
      eventCount: 3
    });
    expect(harness.exportConversation).toHaveBeenCalledWith(binding, request, "/private/export.json");
    expect(JSON.stringify(result)).not.toMatch(/path|payload|error/iu);
  });

  it("keeps cancellation quiet and causes zero service effects", async () => {
    const harness = makeHarness({ showSaveDialog: async () => ({ canceled: true }) });
    expect(await call(harness, request)).toEqual({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      conversationId: request.conversationId,
      status: "cancelled",
      tailEventId: request.expectedTailEventId
    });
    expect(harness.exportConversation).not.toHaveBeenCalled();
  });

  it("fails closed for malformed input, untrusted senders, or vault drift", async () => {
    const malformed = makeHarness();
    await expect(call(malformed, { ...request, outputPath: "/private/leak.json" })).rejects.toThrow();
    expect(malformed.exportConversation).not.toHaveBeenCalled();

    const untrusted = makeHarness({ getWindow: () => undefined });
    expect(await call(untrusted, request)).toMatchObject({ status: "failed" });
    expect(untrusted.exportConversation).not.toHaveBeenCalled();

    let reads = 0;
    const drifted = makeHarness({
      getActiveVaultBinding: () => reads++ === 0 ? binding : { ...binding, vaultPath: "/private/other-vault" }
    });
    expect(await call(drifted, request)).toMatchObject({ status: "failed" });
    expect(drifted.exportConversation).not.toHaveBeenCalled();
  });

  it("rejects identity drift and private result fields from the service", async () => {
    const swapped = makeHarness({
      exportConversation: (_binding, parsed) => ({
        apiVersion: 1,
        requestId: parsed.requestId,
        activeVaultId: parsed.activeVaultId,
        conversationId: "conv_20260731_swapped01",
        status: "exported",
        tailEventId: parsed.expectedTailEventId,
        eventCount: 3
      })
    });
    expect(await call(swapped, request)).toMatchObject({ status: "failed" });

    const privateResult = makeHarness({
      exportConversation: (_binding, parsed) => ({
        apiVersion: 1,
        requestId: parsed.requestId,
        activeVaultId: parsed.activeVaultId,
        conversationId: parsed.conversationId,
        status: "exported",
        tailEventId: parsed.expectedTailEventId,
        eventCount: 3,
        filePath: "/private/export.json"
      })
    });
    expect(await call(privateResult, request)).toMatchObject({ status: "failed" });
  });
});

function call(harness: ReturnType<typeof makeHarness>, value: unknown): Promise<any> {
  return Promise.resolve(harness.handlers.get("agent.exportConversation")!({ sender: {} } as IpcMainInvokeEvent, value));
}
