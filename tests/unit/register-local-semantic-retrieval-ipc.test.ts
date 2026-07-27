import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { registerLocalSemanticRetrievalIpc } from
  "../../apps/desktop/src/main/register-local-semantic-retrieval-ipc";

type IpcHandler = (event: IpcMainInvokeEvent, request?: unknown) => unknown;

const request = {
  apiVersion: 1,
  requestId: "ragasset_0123456789abcdef",
  expectedRevision: 7
} as const;

function makeHarness(overrides: Record<string, unknown> = {}) {
  const handlers = new Map<string, IpcHandler>();
  const callbacks = {
    status: vi.fn(() => ({
      apiVersion: 1 as const,
      revision: 7,
      assetId: "qwen3_embedding_0_6b_q8_0" as const,
      assetState: "ready" as const,
      downloadSizeBytes: 639_150_592 as const,
      lexicalSearchRemainsAvailable: true as const
    })),
    install: vi.fn((input: typeof request) => ({
      apiVersion: 1 as const,
      requestId: input.requestId,
      revision: 8,
      status: "accepted" as const,
      jobId: "job_20260727_abcdefghijkl"
    })),
    enable: vi.fn((input: typeof request) => ({
      apiVersion: 1 as const,
      requestId: input.requestId,
      revision: 8,
      status: "committed" as const
    })),
    disable: vi.fn((input: typeof request) => ({
      apiVersion: 1 as const,
      requestId: input.requestId,
      revision: 8,
      status: "committed" as const
    })),
    remove: vi.fn((input: typeof request) => ({
      apiVersion: 1 as const,
      requestId: input.requestId,
      revision: 8,
      status: "committed" as const
    })),
    ...overrides
  };

  registerLocalSemanticRetrievalIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler as IpcHandler)
    } as Pick<IpcMain, "handle">,
    ...callbacks
  });
  return { handlers, callbacks };
}

describe("registerLocalSemanticRetrievalIpc", () => {
  it("registers the exact five preload channels", () => {
    expect([...makeHarness().handlers.keys()]).toEqual([
      "retrieval.localSemanticStatus",
      "retrieval.installLocalSemanticAsset",
      "retrieval.enableLocalSemanticAsset",
      "retrieval.disableLocalSemanticAsset",
      "retrieval.removeLocalSemanticAsset"
    ]);
  });

  it("strictly parses status and delegates parsed lifecycle requests", async () => {
    const { handlers, callbacks } = makeHarness();

    await expect(handlers.get("retrieval.localSemanticStatus")!(
      {} as IpcMainInvokeEvent,
      { apiVersion: 1 }
    )).resolves.toMatchObject({ assetState: "ready", revision: 7 });

    for (const channel of [
      "retrieval.installLocalSemanticAsset",
      "retrieval.enableLocalSemanticAsset",
      "retrieval.disableLocalSemanticAsset",
      "retrieval.removeLocalSemanticAsset"
    ]) {
      await expect(handlers.get(channel)!({} as IpcMainInvokeEvent, request))
        .resolves.toMatchObject({ requestId: request.requestId, revision: 8 });
    }
    expect(callbacks.install).toHaveBeenCalledWith(request);
    expect(callbacks.enable).toHaveBeenCalledWith(request);
    expect(callbacks.disable).toHaveBeenCalledWith(request);
    expect(callbacks.remove).toHaveBeenCalledWith(request);
  });

  it("rejects malformed requests and strictly parses status results", async () => {
    const { handlers, callbacks } = makeHarness({
      status: vi.fn(() => ({
        apiVersion: 1,
        revision: 7,
        assetId: "qwen3_embedding_0_6b_q8_0",
        assetState: "ready",
        downloadSizeBytes: 639_150_592,
        lexicalSearchRemainsAvailable: true,
        path: "/private/model.gguf"
      }))
    });

    await expect(handlers.get("retrieval.installLocalSemanticAsset")!(
      {} as IpcMainInvokeEvent,
      { ...request, url: "https://example.com/model.gguf" }
    )).rejects.toThrow();
    expect(callbacks.install).not.toHaveBeenCalled();
    await expect(handlers.get("retrieval.localSemanticStatus")!(
      {} as IpcMainInvokeEvent,
      { apiVersion: 1 }
    )).rejects.toThrow();
  });

  it("fails closed without exposing callback errors or private fields", async () => {
    const { handlers } = makeHarness({
      install: vi.fn(() => {
        throw new Error("/private/model.gguf failed from https://example.com");
      }),
      enable: vi.fn(() => ({
        apiVersion: 1,
        requestId: request.requestId,
        revision: 8,
        status: "committed",
        sha256: "secret"
      }))
    });

    await expect(handlers.get("retrieval.installLocalSemanticAsset")!(
      {} as IpcMainInvokeEvent,
      request
    )).resolves.toEqual({
      apiVersion: 1,
      requestId: request.requestId,
      revision: request.expectedRevision,
      status: "failed"
    });
    await expect(handlers.get("retrieval.enableLocalSemanticAsset")!(
      {} as IpcMainInvokeEvent,
      request
    )).resolves.toEqual({
      apiVersion: 1,
      requestId: request.requestId,
      revision: request.expectedRevision,
      status: "failed"
    });
  });

  it("rejects identity-swapped results instead of converting them to success", async () => {
    const { handlers } = makeHarness({
      remove: vi.fn(() => ({
        apiVersion: 1,
        requestId: "ragasset_ffffffffffffffff",
        revision: 9,
        status: "committed"
      }))
    });

    await expect(handlers.get("retrieval.removeLocalSemanticAsset")!(
      {} as IpcMainInvokeEvent,
      request
    )).rejects.toThrow("response identity did not match");
  });
});
