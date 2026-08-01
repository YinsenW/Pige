import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { registerLocalRerankerIpc } from "../../apps/desktop/src/main/register-local-reranker-ipc";

type Handler = (event: IpcMainInvokeEvent, request?: unknown) => unknown;
const request = { apiVersion: 1, requestId: "rerankasset_0123456789abcdef", expectedRevision: 7 } as const;

function harness(overrides: Record<string, unknown> = {}) {
  const handlers = new Map<string, Handler>();
  const callbacks = {
    status: vi.fn(() => ({
      apiVersion: 1 as const, revision: 7, assetId: "qwen3_reranker_0_6b_q3_k_m" as const,
      assetState: "ready" as const, downloadSizeBytes: 346_896_352 as const,
      hybridSearchRemainsAvailable: true as const
    })),
    install: vi.fn((input: typeof request) => ({
      apiVersion: 1 as const, requestId: input.requestId, revision: 8, status: "accepted" as const,
      jobId: "job_20260801_abcdefghijkl"
    })),
    enable: vi.fn((input: typeof request) => ({ apiVersion: 1 as const, requestId: input.requestId, revision: 8, status: "committed" as const })),
    disable: vi.fn((input: typeof request) => ({ apiVersion: 1 as const, requestId: input.requestId, revision: 8, status: "committed" as const })),
    remove: vi.fn((input: typeof request) => ({ apiVersion: 1 as const, requestId: input.requestId, revision: 8, status: "committed" as const })),
    ...overrides
  };
  registerLocalRerankerIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler as Handler) } as Pick<IpcMain, "handle">,
    ...callbacks
  });
  return { handlers, callbacks };
}

describe("registerLocalRerankerIpc", () => {
  it("registers five strict lifecycle channels and delegates safe requests", async () => {
    const { handlers, callbacks } = harness();
    expect([...handlers.keys()]).toEqual([
      "retrieval.localRerankerStatus", "retrieval.installLocalReranker", "retrieval.enableLocalReranker",
      "retrieval.disableLocalReranker", "retrieval.removeLocalReranker"
    ]);
    await expect(handlers.get("retrieval.localRerankerStatus")!({} as IpcMainInvokeEvent, { apiVersion: 1 }))
      .resolves.toMatchObject({ assetState: "ready" });
    for (const channel of [...handlers.keys()].slice(1)) {
      await expect(handlers.get(channel)!({} as IpcMainInvokeEvent, request)).resolves.toMatchObject({ revision: 8 });
    }
    expect(callbacks.install).toHaveBeenCalledWith(request);
  });

  it("fails callback errors body-free and rejects identity swaps", async () => {
    const failed = harness({ install: vi.fn(() => { throw new Error("/private/model.gguf"); }) });
    await expect(failed.handlers.get("retrieval.installLocalReranker")!({} as IpcMainInvokeEvent, request))
      .resolves.toEqual({ apiVersion: 1, requestId: request.requestId, revision: 7, status: "failed" });

    const swapped = harness({ remove: vi.fn(() => ({
      apiVersion: 1, requestId: "rerankasset_ffffffffffffffff", revision: 8, status: "committed"
    })) });
    await expect(swapped.handlers.get("retrieval.removeLocalReranker")!({} as IpcMainInvokeEvent, request))
      .rejects.toThrow("identity mismatch");
  });

  it("rejects renderer paths and strict status leaks", async () => {
    const { handlers } = harness({ status: vi.fn(() => ({
      apiVersion: 1, revision: 7, assetId: "qwen3_reranker_0_6b_q3_k_m", assetState: "ready",
      downloadSizeBytes: 346_896_352, hybridSearchRemainsAvailable: true, path: "/private/model.gguf"
    })) });
    await expect(handlers.get("retrieval.installLocalReranker")!({} as IpcMainInvokeEvent, { ...request, path: "/tmp" }))
      .rejects.toThrow();
    await expect(handlers.get("retrieval.localRerankerStatus")!({} as IpcMainInvokeEvent, { apiVersion: 1 }))
      .rejects.toThrow();
  });
});
