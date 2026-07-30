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
  reportRequestId: request.requestId,
  indexGeneration: "2026-07-27T12:00:00.000Z#abcdefghijklmnop",
  issueKind: "broken_link",
  pageId: "page_20260727_healthrepair",
  action: "unlink_broken_reference",
  repairContextId: `knowledge_health_repair_context_${"a".repeat(32)}`,
  sourceRevision: `noteeditrev_${"b".repeat(64)}`,
  sourceRenderProof: `knowledge_health_render_${"c".repeat(64)}`,
  occurrenceId: `knowledge_health_occurrence_${"d".repeat(64)}`
} as const;
const targetSearchRequest = {
  apiVersion: repairRequest.apiVersion,
  requestId: "knowledge_health_target_search_abcdefghijklmnop",
  activeVaultId: repairRequest.activeVaultId,
  reportRequestId: repairRequest.reportRequestId,
  indexGeneration: repairRequest.indexGeneration,
  issueKind: repairRequest.issueKind,
  pageId: repairRequest.pageId,
  repairContextId: repairRequest.repairContextId,
  sourceRevision: repairRequest.sourceRevision,
  sourceRenderProof: repairRequest.sourceRenderProof,
  occurrenceId: repairRequest.occurrenceId,
  query: "current"
} as const;
const orphanSearchRequest = {
  apiVersion: 1,
  requestId: "knowledge_health_orphan_parent_search_abcdefghijklmnop",
  activeVaultId: request.activeVaultId,
  reportRequestId: request.requestId,
  indexGeneration: repairRequest.indexGeneration,
  issueKind: "orphan_page",
  pageId: "page_20260731_orphantarget",
  repairContextId: `knowledge_health_repair_context_${"c".repeat(32)}`,
  targetRevision: `noteeditrev_${"d".repeat(64)}`,
  targetRenderProof: `knowledge_health_render_${"e".repeat(64)}`,
  query: "entry"
} as const;
const orphanRepairRequest = {
  apiVersion: 1,
  requestId: "knowledge_health_orphan_repair_request_abcdefghijklmnop",
  activeVaultId: orphanSearchRequest.activeVaultId,
  reportRequestId: orphanSearchRequest.reportRequestId,
  indexGeneration: orphanSearchRequest.indexGeneration,
  issueKind: orphanSearchRequest.issueKind,
  pageId: orphanSearchRequest.pageId,
  repairContextId: orphanSearchRequest.repairContextId,
  targetRevision: orphanSearchRequest.targetRevision,
  targetRenderProof: orphanSearchRequest.targetRenderProof,
  action: "connect_orphan_to_parent",
  sourcePageId: "page_20260731_entryparent",
  sourceContextId: `knowledge_health_orphan_parent_context_${"f".repeat(32)}`,
  sourceRevision: `noteeditrev_${"1".repeat(64)}`,
  sourceRenderProof: `knowledge_health_render_${"2".repeat(64)}`
} as const;
const duplicateTopicRepairRequest = {
  apiVersion: 1,
  requestId: "knowledge_health_duplicate_topic_repair_request_abcdefghijklmnop",
  activeVaultId: request.activeVaultId,
  reportRequestId: request.requestId,
  indexGeneration: repairRequest.indexGeneration,
  issueKind: "duplicate_topic",
  repairContextId: `knowledge_health_repair_context_${"7".repeat(32)}`,
  survivorPageId: "page_20260731_duplicatetopica",
  survivorRevision: `noteeditrev_${"8".repeat(64)}`,
  survivorRenderProof: `knowledge_health_render_${"9".repeat(64)}`,
  absorbedPageId: "page_20260731_duplicatetopicb",
  absorbedRevision: `noteeditrev_${"a".repeat(64)}`,
  absorbedRenderProof: `knowledge_health_render_${"b".repeat(64)}`
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
  readonly searchKnowledgeHealthTargets?: (...args: unknown[]) => unknown;
  readonly repairKnowledgeHealth?: (...args: unknown[]) => unknown;
  readonly searchKnowledgeHealthOrphanParents?: (...args: unknown[]) => unknown;
  readonly repairKnowledgeHealthOrphan?: (...args: unknown[]) => unknown;
  readonly repairKnowledgeHealthDuplicateTopic?: (...args: unknown[]) => unknown;
} = {}) {
  const handlers = new Map<string, IpcHandler>();
  const runKnowledgeHealth = vi.fn(options.runKnowledgeHealth ?? (() => readyResult()));
  const searchKnowledgeHealthTargets = vi.fn(options.searchKnowledgeHealthTargets ?? (() => ({
    ...targetSearchRequest,
    status: "ready" as const,
    targets: [],
    truncated: false
  })));
  const repairKnowledgeHealth = vi.fn(options.repairKnowledgeHealth ?? (() => ({
    ...repairRequest,
    status: "committed" as const,
    revision: `noteeditrev_${"b".repeat(64)}`,
    operationId: "op_20260727_abcdefghijklmnop"
  })));
  const searchKnowledgeHealthOrphanParents = vi.fn(options.searchKnowledgeHealthOrphanParents ?? (() => ({
    ...orphanSearchRequest,
    status: "ready" as const,
    parents: [],
    truncated: false
  })));
  const repairKnowledgeHealthOrphan = vi.fn(options.repairKnowledgeHealthOrphan ?? (() => ({
    ...orphanRepairRequest,
    status: "committed" as const,
    revision: `noteeditrev_${"3".repeat(64)}`,
    operationId: "op_20260731_orphanrepair123"
  })));
  const repairKnowledgeHealthDuplicateTopic = vi.fn(options.repairKnowledgeHealthDuplicateTopic ?? (() => ({
    ...duplicateTopicRepairRequest,
    status: "committed" as const,
    operationId: "op_20260731_duplicatetopic123"
  })));
  registerKnowledgeHealthIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler as IpcHandler)
    } as Pick<IpcMain, "handle">,
    getActiveVaultBinding: options.getActiveVaultBinding ?? (() => binding),
    runKnowledgeHealth,
    searchKnowledgeHealthTargets,
    searchKnowledgeHealthOrphanParents,
    repairKnowledgeHealthOrphan,
    repairKnowledgeHealthDuplicateTopic,
    repairKnowledgeHealth
  });
  return {
    handlers,
    runKnowledgeHealth,
    repairKnowledgeHealth,
    searchKnowledgeHealthTargets,
    searchKnowledgeHealthOrphanParents,
    repairKnowledgeHealthOrphan,
    repairKnowledgeHealthDuplicateTopic
  };
}

describe("registerKnowledgeHealthIpc", () => {
  it("registers and strictly delegates the maintenance channel", async () => {
    const { handlers, runKnowledgeHealth, searchKnowledgeHealthTargets, repairKnowledgeHealth,
      searchKnowledgeHealthOrphanParents, repairKnowledgeHealthOrphan,
      repairKnowledgeHealthDuplicateTopic } = makeHarness();

    expect([...handlers.keys()]).toEqual([
      "maintenance.runKnowledgeHealth",
      "maintenance.searchKnowledgeHealthTargets",
      "maintenance.repairKnowledgeHealth",
      "maintenance.repairKnowledgeHealthDuplicateTopic",
      "maintenance.searchKnowledgeHealthOrphanParents",
      "maintenance.repairKnowledgeHealthOrphan"
    ]);
    await expect(handlers.get("maintenance.runKnowledgeHealth")!(
      {} as IpcMainInvokeEvent,
      request
    )).resolves.toEqual(readyResult());
    expect(runKnowledgeHealth).toHaveBeenCalledWith(binding.vaultPath, request);
    await expect(handlers.get("maintenance.searchKnowledgeHealthTargets")!(
      {} as IpcMainInvokeEvent,
      targetSearchRequest
    )).resolves.toMatchObject({ status: "ready", targets: [] });
    expect(searchKnowledgeHealthTargets).toHaveBeenCalledWith(binding.vaultPath, targetSearchRequest);
    await expect(handlers.get("maintenance.repairKnowledgeHealth")!(
      {} as IpcMainInvokeEvent,
      repairRequest
    )).resolves.toMatchObject({ status: "committed", operationId: "op_20260727_abcdefghijklmnop" });
    expect(repairKnowledgeHealth).toHaveBeenCalledWith(binding.vaultPath, repairRequest);
    await expect(handlers.get("maintenance.searchKnowledgeHealthOrphanParents")!(
      {} as IpcMainInvokeEvent,
      orphanSearchRequest
    )).resolves.toMatchObject({ status: "ready", parents: [] });
    expect(searchKnowledgeHealthOrphanParents).toHaveBeenCalledWith(binding.vaultPath, orphanSearchRequest);
    await expect(handlers.get("maintenance.repairKnowledgeHealthOrphan")!(
      {} as IpcMainInvokeEvent,
      orphanRepairRequest
    )).resolves.toMatchObject({ status: "committed", operationId: "op_20260731_orphanrepair123" });
    expect(repairKnowledgeHealthOrphan).toHaveBeenCalledWith(binding.vaultPath, orphanRepairRequest);
    await expect(handlers.get("maintenance.repairKnowledgeHealthDuplicateTopic")!(
      {} as IpcMainInvokeEvent,
      duplicateTopicRepairRequest
    )).resolves.toMatchObject({ status: "committed", operationId: "op_20260731_duplicatetopic123" });
    expect(repairKnowledgeHealthDuplicateTopic).toHaveBeenCalledWith(binding.vaultPath, duplicateTopicRepairRequest);
  });

  it("fails closed before service access for malformed or inactive-vault requests", async () => {
    const { handlers, runKnowledgeHealth, searchKnowledgeHealthTargets, repairKnowledgeHealth,
      searchKnowledgeHealthOrphanParents, repairKnowledgeHealthOrphan } = makeHarness({
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
    await expect(handlers.get("maintenance.searchKnowledgeHealthTargets")!(
      {} as IpcMainInvokeEvent,
      targetSearchRequest
    )).resolves.toEqual({ ...targetSearchRequest, status: "not_found" });
    expect(searchKnowledgeHealthTargets).not.toHaveBeenCalled();
    await expect(handlers.get("maintenance.searchKnowledgeHealthOrphanParents")!(
      {} as IpcMainInvokeEvent,
      orphanSearchRequest
    )).resolves.toEqual({ ...orphanSearchRequest, status: "not_found" });
    expect(searchKnowledgeHealthOrphanParents).not.toHaveBeenCalled();
    await expect(handlers.get("maintenance.repairKnowledgeHealthOrphan")!(
      {} as IpcMainInvokeEvent,
      orphanRepairRequest
    )).resolves.toEqual({ ...orphanRepairRequest, status: "not_found" });
    expect(repairKnowledgeHealthOrphan).not.toHaveBeenCalled();
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

    const targetThrown = makeHarness({
      searchKnowledgeHealthTargets: () => { throw new Error("/private/vault Target body"); }
    });
    await expect(targetThrown.handlers.get("maintenance.searchKnowledgeHealthTargets")!(
      {} as IpcMainInvokeEvent,
      targetSearchRequest
    )).resolves.toEqual({ ...targetSearchRequest, status: "failed" });
    const orphanThrown = makeHarness({
      searchKnowledgeHealthOrphanParents: () => { throw new Error("/private/vault Parent body"); },
      repairKnowledgeHealthOrphan: () => { throw new Error("/private/vault Parent body"); }
    });
    await expect(orphanThrown.handlers.get("maintenance.searchKnowledgeHealthOrphanParents")!(
      {} as IpcMainInvokeEvent,
      orphanSearchRequest
    )).resolves.toEqual({ ...orphanSearchRequest, status: "failed" });
    await expect(orphanThrown.handlers.get("maintenance.repairKnowledgeHealthOrphan")!(
      {} as IpcMainInvokeEvent,
      orphanRepairRequest
    )).resolves.toEqual({ ...orphanRepairRequest, status: "failed" });
  });
});
