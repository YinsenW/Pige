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
const repairRequest = {
  apiVersion: 1,
  requestId: "knowledge_health_repair_request_abcdefghijklmnop",
  activeVaultId: request.activeVaultId,
  indexGeneration: "2026-07-27T12:00:00.000Z#abcdefghijklmnop",
  issueKind: "broken_link",
  pageId: "page_20260727_healthrepair",
  action: "unlink_broken_reference",
  repairContextId: `knowledge_health_repair_context_${"a".repeat(32)}`
} as const;

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
  readonly repairKnowledgeHealth?: (...args: unknown[]) => unknown;
} = {}) {
  const handlers = new Map<string, IpcHandler>();
  const runKnowledgeHealth = vi.fn(options.runKnowledgeHealth ?? (() => readyResult()));
  const repairKnowledgeHealth = vi.fn(options.repairKnowledgeHealth ?? (() => ({
    ...repairRequest,
    status: "committed" as const,
    revision: `noteeditrev_${"b".repeat(64)}`,
    operationId: "op_20260727_abcdefghijklmnop"
  })));
  registerKnowledgeHealthIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler as IpcHandler)
    } as Pick<IpcMain, "handle">,
    getActiveVaultBinding: options.getActiveVaultBinding ?? (() => binding),
    runKnowledgeHealth,
    repairKnowledgeHealth
  });
  return { handlers, runKnowledgeHealth, repairKnowledgeHealth };
}

describe("registerKnowledgeHealthIpc", () => {
  it("registers and strictly delegates the maintenance channel", async () => {
    const { handlers, runKnowledgeHealth, repairKnowledgeHealth } = makeHarness();

    expect([...handlers.keys()]).toEqual([
      "maintenance.runKnowledgeHealth",
      "maintenance.repairKnowledgeHealth"
    ]);
    await expect(handlers.get("maintenance.runKnowledgeHealth")!(
      {} as IpcMainInvokeEvent,
      request
    )).resolves.toEqual(readyResult());
    expect(runKnowledgeHealth).toHaveBeenCalledWith(binding.vaultPath, request);
    await expect(handlers.get("maintenance.repairKnowledgeHealth")!(
      {} as IpcMainInvokeEvent,
      repairRequest
    )).resolves.toMatchObject({ status: "committed", operationId: "op_20260727_abcdefghijklmnop" });
    expect(repairKnowledgeHealth).toHaveBeenCalledWith(binding.vaultPath, repairRequest);
  });

  it("fails closed before service access for malformed or inactive-vault requests", async () => {
    const { handlers, runKnowledgeHealth, repairKnowledgeHealth } = makeHarness({
      getActiveVaultBinding: () => ({ ...binding, vaultId: "vault_20260727_elsewhere" })
    });
    await expect(handlers.get("maintenance.runKnowledgeHealth")!(
      {} as IpcMainInvokeEvent,
      request
    )).resolves.toEqual({ ...request, status: "unavailable" });
    expect(runKnowledgeHealth).not.toHaveBeenCalled();
    await expect(handlers.get("maintenance.repairKnowledgeHealth")!(
      {} as IpcMainInvokeEvent,
      repairRequest
    )).resolves.toEqual({ ...repairRequest, status: "not_found" });
    expect(repairKnowledgeHealth).not.toHaveBeenCalled();
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

    const repairThrown = makeHarness({
      repairKnowledgeHealth: () => { throw new Error("/private/vault body"); }
    });
    await expect(repairThrown.handlers.get("maintenance.repairKnowledgeHealth")!(
      {} as IpcMainInvokeEvent,
      repairRequest
    )).resolves.toEqual({ ...repairRequest, status: "failed" });
  });
});
