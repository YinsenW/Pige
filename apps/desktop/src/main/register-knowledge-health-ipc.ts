import type { IpcMain } from "electron";
import type {
  KnowledgeHealthRepairRequest,
  KnowledgeHealthRepairResult,
  KnowledgeHealthRunRequest,
  KnowledgeHealthRunResult
} from "@pige/contracts";
import {
  KnowledgeHealthRepairRequestSchema,
  KnowledgeHealthRepairResultSchema,
  KnowledgeHealthRunRequestSchema,
  KnowledgeHealthRunResultSchema
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
    result.action === request.action &&
    result.repairContextId === request.repairContextId;
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
