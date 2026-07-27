import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { registerKnowledgeHealthIpc } from
  "../../apps/desktop/src/main/register-knowledge-health-ipc";

type IpcHandler = (event: IpcMainInvokeEvent, request?: unknown) => unknown;

const request = {
  apiVersion: 1,
  requestId: "knowledge_health_request_abcdefghijklmnop",
  activeVaultId: "vault_20260727_healthtest"
} as const;
const binding = { vaultId: request.activeVaultId, vaultPath: "/private/vault" } as const;

function readyResult() {
  return {
    ...request,
    status: "ready" as const,
    checkedAt: "2026-07-27T12:30:00.000Z",
    indexGeneration: "2026-07-27T12:00:00.000Z#abcdefghijklmnop",
    coverage: "complete" as const,
    invalidPageCount: 0,
    counts: {
      totalIssueCount: 0,
      brokenLinkPageCount: 0,
      unresolvedLinkCount: 0,
      orphanPageCount: 0,
      duplicateTopicGroupCount: 0,
      unsourcedClaimCount: 0
    },
    issues: [],
    truncated: false
  };
}

function makeHarness(options: {
  readonly getActiveVaultBinding?: () => typeof binding | undefined;
  readonly runKnowledgeHealth?: (...args: unknown[]) => unknown;
} = {}) {
  const handlers = new Map<string, IpcHandler>();
  const runKnowledgeHealth = vi.fn(options.runKnowledgeHealth ?? (() => readyResult()));
  registerKnowledgeHealthIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler as IpcHandler)
    } as Pick<IpcMain, "handle">,
    getActiveVaultBinding: options.getActiveVaultBinding ?? (() => binding),
    runKnowledgeHealth
  });
  return { handlers, runKnowledgeHealth };
}

describe("registerKnowledgeHealthIpc", () => {
  it("registers and strictly delegates the maintenance channel", async () => {
    const { handlers, runKnowledgeHealth } = makeHarness();

    expect([...handlers.keys()]).toEqual(["maintenance.runKnowledgeHealth"]);
    await expect(handlers.get("maintenance.runKnowledgeHealth")!(
      {} as IpcMainInvokeEvent,
      request
    )).resolves.toEqual(readyResult());
    expect(runKnowledgeHealth).toHaveBeenCalledWith(binding.vaultPath, request);
  });

  it("fails closed before service access for malformed or inactive-vault requests", async () => {
    const { handlers, runKnowledgeHealth } = makeHarness({
      getActiveVaultBinding: () => ({ ...binding, vaultId: "vault_20260727_elsewhere" })
    });
    await expect(handlers.get("maintenance.runKnowledgeHealth")!(
      {} as IpcMainInvokeEvent,
      request
    )).resolves.toEqual({ ...request, status: "unavailable" });
    expect(runKnowledgeHealth).not.toHaveBeenCalled();
    await expect(handlers.get("maintenance.runKnowledgeHealth")!(
      {} as IpcMainInvokeEvent,
      { ...request, path: "/private/vault" }
    )).rejects.toThrow();
  });

  it("revalidates the exact vault after the report is derived", async () => {
    let reads = 0;
    const { handlers } = makeHarness({
      getActiveVaultBinding: () => ++reads === 1 ? binding : undefined
    });
    await expect(handlers.get("maintenance.runKnowledgeHealth")!(
      {} as IpcMainInvokeEvent,
      request
    )).resolves.toEqual({ ...request, status: "unavailable" });
  });

  it("returns body-free failure for internal errors or malformed results", async () => {
    const thrown = makeHarness({
      runKnowledgeHealth: () => { throw new Error("/private/vault body"); }
    });
    await expect(thrown.handlers.get("maintenance.runKnowledgeHealth")!(
      {} as IpcMainInvokeEvent,
      request
    )).resolves.toEqual({ ...request, status: "failed" });

    const unsafe = makeHarness({
      runKnowledgeHealth: () => ({ ...readyResult(), path: "/private/vault" })
    });
    await expect(unsafe.handlers.get("maintenance.runKnowledgeHealth")!(
      {} as IpcMainInvokeEvent,
      request
    )).resolves.toEqual({ ...request, status: "failed" });
  });
});
