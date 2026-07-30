import type { IpcMain } from "electron";
import type {
  KnowledgeHealthRepairRequest,
  KnowledgeHealthRepairResult,
  KnowledgeHealthRunRequest,
  KnowledgeHealthRunResult,
  KnowledgeHealthTargetSearchRequest,
  KnowledgeHealthTargetSearchResult
} from "@pige/contracts";
import {
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
