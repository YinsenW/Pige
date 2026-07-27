import type { IpcMain } from "electron";
import type {
  KnowledgeHealthRunRequest,
  KnowledgeHealthRunResult
} from "@pige/contracts";
import {
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
}

function sameIdentity(request: KnowledgeHealthRunRequest, result: KnowledgeHealthRunResult): boolean {
  return result.apiVersion === request.apiVersion &&
    result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId;
}

function unavailable(request: KnowledgeHealthRunRequest): KnowledgeHealthRunResult {
  return KnowledgeHealthRunResultSchema.parse({ ...request, status: "unavailable" });
}

function failed(request: KnowledgeHealthRunRequest): KnowledgeHealthRunResult {
  return KnowledgeHealthRunResultSchema.parse({ ...request, status: "failed" });
}
