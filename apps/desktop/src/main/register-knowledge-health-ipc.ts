import type { IpcMain } from "electron";
import type {
  KnowledgeHealthOrphanParentSearchRequest,
  KnowledgeHealthOrphanParentSearchResult,
  KnowledgeHealthOrphanRepairRequest,
  KnowledgeHealthOrphanRepairResult,
  KnowledgeHealthRepairRequest,
  KnowledgeHealthRepairResult,
  KnowledgeHealthRunRequest,
  KnowledgeHealthRunResult,
  KnowledgeHealthTargetSearchRequest,
  KnowledgeHealthTargetSearchResult
} from "@pige/contracts";
import {
  KnowledgeHealthOrphanParentSearchRequestSchema,
  KnowledgeHealthOrphanParentSearchResultSchema,
  KnowledgeHealthOrphanRepairRequestSchema,
  KnowledgeHealthOrphanRepairResultSchema,
  KnowledgeHealthRepairRequestSchema,
  KnowledgeHealthRepairResultSchema,
  KnowledgeHealthRunRequestSchema,
  KnowledgeHealthRunResultSchema,
  KnowledgeHealthTargetSearchRequestSchema,
  KnowledgeHealthTargetSearchResultSchema
} from "@pige/schemas";

interface ActiveVaultBinding {
  readonly vaultId: string;
  readonly vaultPath: string;
}

interface RegisterKnowledgeHealthIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly getActiveVaultBinding: () => ActiveVaultBinding | undefined;
  readonly runKnowledgeHealth: (
    vaultPath: string,
    request: KnowledgeHealthRunRequest
  ) => KnowledgeHealthRunResult | Promise<KnowledgeHealthRunResult>;
  readonly repairKnowledgeHealth: (
    vaultPath: string,
    request: KnowledgeHealthRepairRequest
  ) => KnowledgeHealthRepairResult | Promise<KnowledgeHealthRepairResult>;
  readonly searchKnowledgeHealthTargets: (
    vaultPath: string,
    request: KnowledgeHealthTargetSearchRequest
  ) => KnowledgeHealthTargetSearchResult | Promise<KnowledgeHealthTargetSearchResult>;
  readonly searchKnowledgeHealthOrphanParents: (
    vaultPath: string,
    request: KnowledgeHealthOrphanParentSearchRequest
  ) => KnowledgeHealthOrphanParentSearchResult | Promise<KnowledgeHealthOrphanParentSearchResult>;
  readonly repairKnowledgeHealthOrphan: (
    vaultPath: string,
    request: KnowledgeHealthOrphanRepairRequest
  ) => KnowledgeHealthOrphanRepairResult | Promise<KnowledgeHealthOrphanRepairResult>;
}

export function registerKnowledgeHealthIpc(options: RegisterKnowledgeHealthIpcOptions): void {
  options.ipcMain.handle("maintenance.runKnowledgeHealth", async (_event, request: unknown) => {
    const parsed = KnowledgeHealthRunRequestSchema.parse(request);
    const binding = options.getActiveVaultBinding();
    if (!binding || binding.vaultId !== parsed.activeVaultId) return unavailable(parsed);

    try {
      const result = KnowledgeHealthRunResultSchema.parse(
        await options.runKnowledgeHealth(binding.vaultPath, parsed)
      );
      if (!sameIdentity(parsed, result)) return failed(parsed);
      const current = options.getActiveVaultBinding();
      return current?.vaultId === binding.vaultId && current.vaultPath === binding.vaultPath
        ? result
        : unavailable(parsed);
    } catch {
      const current = options.getActiveVaultBinding();
      return current?.vaultId === binding.vaultId && current.vaultPath === binding.vaultPath
        ? failed(parsed)
        : unavailable(parsed);
    }
  });
  options.ipcMain.handle("maintenance.searchKnowledgeHealthTargets", async (_event, request: unknown) => {
    const parsed = KnowledgeHealthTargetSearchRequestSchema.parse(request);
    const binding = options.getActiveVaultBinding();
    if (!binding || binding.vaultId !== parsed.activeVaultId) return targetSearchNotFound(parsed);
    try {
      const result = KnowledgeHealthTargetSearchResultSchema.parse(
        await options.searchKnowledgeHealthTargets(binding.vaultPath, parsed)
      );
      if (!sameTargetSearchIdentity(parsed, result)) return targetSearchFailed(parsed);
      const current = options.getActiveVaultBinding();
      return current?.vaultId === binding.vaultId && current.vaultPath === binding.vaultPath
        ? result
        : targetSearchNotFound(parsed);
    } catch {
      const current = options.getActiveVaultBinding();
      return current?.vaultId === binding.vaultId && current.vaultPath === binding.vaultPath
        ? targetSearchFailed(parsed)
        : targetSearchNotFound(parsed);
    }
  });
  options.ipcMain.handle("maintenance.repairKnowledgeHealth", async (_event, request: unknown) => {
    const parsed = KnowledgeHealthRepairRequestSchema.parse(request);
    const binding = options.getActiveVaultBinding();
    if (!binding || binding.vaultId !== parsed.activeVaultId) return repairNotFound(parsed);
    try {
      const result = KnowledgeHealthRepairResultSchema.parse(
        await options.repairKnowledgeHealth(binding.vaultPath, parsed)
      );
      if (!sameRepairIdentity(parsed, result)) return repairFailed(parsed);
      const current = options.getActiveVaultBinding();
      return current?.vaultId === binding.vaultId && current.vaultPath === binding.vaultPath
        ? result
        : repairNotFound(parsed);
    } catch {
      const current = options.getActiveVaultBinding();
      return current?.vaultId === binding.vaultId && current.vaultPath === binding.vaultPath
        ? repairFailed(parsed)
        : repairNotFound(parsed);
    }
  });
  options.ipcMain.handle("maintenance.searchKnowledgeHealthOrphanParents", async (_event, request: unknown) => {
    const parsed = KnowledgeHealthOrphanParentSearchRequestSchema.parse(request);
    const binding = options.getActiveVaultBinding();
    if (!binding || binding.vaultId !== parsed.activeVaultId) return orphanParentNotFound(parsed);
    try {
      const result = KnowledgeHealthOrphanParentSearchResultSchema.parse(
        await options.searchKnowledgeHealthOrphanParents(binding.vaultPath, parsed)
      );
      if (!sameOrphanParentSearchIdentity(parsed, result)) return orphanParentFailed(parsed);
      const current = options.getActiveVaultBinding();
      return current?.vaultId === binding.vaultId && current.vaultPath === binding.vaultPath
        ? result
        : orphanParentNotFound(parsed);
    } catch {
      const current = options.getActiveVaultBinding();
      return current?.vaultId === binding.vaultId && current.vaultPath === binding.vaultPath
        ? orphanParentFailed(parsed)
        : orphanParentNotFound(parsed);
    }
  });
  options.ipcMain.handle("maintenance.repairKnowledgeHealthOrphan", async (_event, request: unknown) => {
    const parsed = KnowledgeHealthOrphanRepairRequestSchema.parse(request);
    const binding = options.getActiveVaultBinding();
    if (!binding || binding.vaultId !== parsed.activeVaultId) return orphanRepairNotFound(parsed);
    try {
      const result = KnowledgeHealthOrphanRepairResultSchema.parse(
        await options.repairKnowledgeHealthOrphan(binding.vaultPath, parsed)
      );
      if (!sameOrphanRepairIdentity(parsed, result)) return orphanRepairFailed(parsed);
      const current = options.getActiveVaultBinding();
      return current?.vaultId === binding.vaultId && current.vaultPath === binding.vaultPath
        ? result
        : orphanRepairNotFound(parsed);
    } catch {
      const current = options.getActiveVaultBinding();
      return current?.vaultId === binding.vaultId && current.vaultPath === binding.vaultPath
        ? orphanRepairFailed(parsed)
        : orphanRepairNotFound(parsed);
    }
  });
}

function sameIdentity(request: KnowledgeHealthRunRequest, result: KnowledgeHealthRunResult): boolean {
  return result.apiVersion === request.apiVersion &&
    result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId;
}

function sameRepairIdentity(
  request: KnowledgeHealthRepairRequest,
  result: KnowledgeHealthRepairResult
): boolean {
  return result.apiVersion === request.apiVersion &&
    result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.indexGeneration === request.indexGeneration &&
    result.issueKind === request.issueKind &&
    result.pageId === request.pageId &&
    result.reportRequestId === request.reportRequestId &&
    result.sourceRevision === request.sourceRevision &&
    result.sourceRenderProof === request.sourceRenderProof &&
    result.occurrenceId === request.occurrenceId &&
    result.action === request.action &&
    result.repairContextId === request.repairContextId &&
    result.targetPageId === request.targetPageId &&
    result.targetContextId === request.targetContextId &&
    result.targetRevision === request.targetRevision &&
    result.targetRenderProof === request.targetRenderProof;
}

function sameTargetSearchIdentity(
  request: KnowledgeHealthTargetSearchRequest,
  result: KnowledgeHealthTargetSearchResult
): boolean {
  return result.apiVersion === request.apiVersion && result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId && result.reportRequestId === request.reportRequestId &&
    result.indexGeneration === request.indexGeneration && result.issueKind === request.issueKind &&
    result.pageId === request.pageId && result.repairContextId === request.repairContextId &&
    result.sourceRevision === request.sourceRevision && result.sourceRenderProof === request.sourceRenderProof &&
    result.occurrenceId === request.occurrenceId && result.query === request.query;
}

function sameOrphanTargetIdentity(
  request: KnowledgeHealthOrphanParentSearchRequest | KnowledgeHealthOrphanRepairRequest,
  result: KnowledgeHealthOrphanParentSearchResult | KnowledgeHealthOrphanRepairResult
): boolean {
  return result.apiVersion === request.apiVersion && result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId && result.reportRequestId === request.reportRequestId &&
    result.indexGeneration === request.indexGeneration && result.issueKind === request.issueKind &&
    result.pageId === request.pageId && result.repairContextId === request.repairContextId &&
    result.targetRevision === request.targetRevision && result.targetRenderProof === request.targetRenderProof;
}

function sameOrphanParentSearchIdentity(
  request: KnowledgeHealthOrphanParentSearchRequest,
  result: KnowledgeHealthOrphanParentSearchResult
): boolean {
  return sameOrphanTargetIdentity(request, result) && result.query === request.query;
}

function sameOrphanRepairIdentity(
  request: KnowledgeHealthOrphanRepairRequest,
  result: KnowledgeHealthOrphanRepairResult
): boolean {
  return sameOrphanTargetIdentity(request, result) && result.action === request.action &&
    result.sourcePageId === request.sourcePageId && result.sourceContextId === request.sourceContextId &&
    result.sourceRevision === request.sourceRevision && result.sourceRenderProof === request.sourceRenderProof;
}

function unavailable(request: KnowledgeHealthRunRequest): KnowledgeHealthRunResult {
  return KnowledgeHealthRunResultSchema.parse({ ...request, status: "unavailable" });
}

function failed(request: KnowledgeHealthRunRequest): KnowledgeHealthRunResult {
  return KnowledgeHealthRunResultSchema.parse({ ...request, status: "failed" });
}

function repairNotFound(request: KnowledgeHealthRepairRequest): KnowledgeHealthRepairResult {
  return KnowledgeHealthRepairResultSchema.parse({ ...request, status: "not_found" });
}

function repairFailed(request: KnowledgeHealthRepairRequest): KnowledgeHealthRepairResult {
  return KnowledgeHealthRepairResultSchema.parse({ ...request, status: "failed" });
}

function targetSearchNotFound(request: KnowledgeHealthTargetSearchRequest): KnowledgeHealthTargetSearchResult {
  return KnowledgeHealthTargetSearchResultSchema.parse({ ...request, status: "not_found" });
}

function targetSearchFailed(request: KnowledgeHealthTargetSearchRequest): KnowledgeHealthTargetSearchResult {
  return KnowledgeHealthTargetSearchResultSchema.parse({ ...request, status: "failed" });
}

function orphanParentNotFound(
  request: KnowledgeHealthOrphanParentSearchRequest
): KnowledgeHealthOrphanParentSearchResult {
  return KnowledgeHealthOrphanParentSearchResultSchema.parse({ ...request, status: "not_found" });
}

function orphanParentFailed(
  request: KnowledgeHealthOrphanParentSearchRequest
): KnowledgeHealthOrphanParentSearchResult {
  return KnowledgeHealthOrphanParentSearchResultSchema.parse({ ...request, status: "failed" });
}

function orphanRepairNotFound(request: KnowledgeHealthOrphanRepairRequest): KnowledgeHealthOrphanRepairResult {
  return KnowledgeHealthOrphanRepairResultSchema.parse({ ...request, status: "not_found" });
}

function orphanRepairFailed(request: KnowledgeHealthOrphanRepairRequest): KnowledgeHealthOrphanRepairResult {
  return KnowledgeHealthOrphanRepairResultSchema.parse({ ...request, status: "failed" });
}
