import type { IpcMain } from "electron";
import {
  LocalRerankerDisableRequestSchema,
  LocalRerankerDisableResultSchema,
  LocalRerankerEnableRequestSchema,
  LocalRerankerEnableResultSchema,
  LocalRerankerInstallRequestSchema,
  LocalRerankerInstallResultSchema,
  LocalRerankerRemoveRequestSchema,
  LocalRerankerRemoveResultSchema,
  LocalRerankerStatusRequestSchema,
  LocalRerankerStatusSchema,
  type LocalRerankerDisableRequest,
  type LocalRerankerDisableResult,
  type LocalRerankerEnableRequest,
  type LocalRerankerEnableResult,
  type LocalRerankerInstallRequest,
  type LocalRerankerInstallResult,
  type LocalRerankerRemoveRequest,
  type LocalRerankerRemoveResult,
  type LocalRerankerStatus,
  type LocalRerankerStatusRequest
} from "@pige/schemas";

interface RegisterLocalRerankerIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly status: (request: LocalRerankerStatusRequest) => LocalRerankerStatus | Promise<LocalRerankerStatus>;
  readonly install: (request: LocalRerankerInstallRequest) => LocalRerankerInstallResult | Promise<LocalRerankerInstallResult>;
  readonly enable: (request: LocalRerankerEnableRequest) => LocalRerankerEnableResult | Promise<LocalRerankerEnableResult>;
  readonly disable: (request: LocalRerankerDisableRequest) => LocalRerankerDisableResult | Promise<LocalRerankerDisableResult>;
  readonly remove: (request: LocalRerankerRemoveRequest) => LocalRerankerRemoveResult | Promise<LocalRerankerRemoveResult>;
}

type MutationRequest = LocalRerankerInstallRequest;
type MutationResult = { readonly apiVersion: 1; readonly requestId: string; readonly revision: number };

async function invokeMutation<T extends MutationResult>(
  request: MutationRequest,
  invoke: () => T | Promise<T>
): Promise<T | (MutationResult & { readonly status: "failed" })> {
  try {
    const result = await invoke();
    if (result.requestId !== request.requestId) throw new Error("Local reranker response identity mismatch.");
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.includes("identity mismatch")) throw error;
    return { apiVersion: 1, requestId: request.requestId, revision: request.expectedRevision, status: "failed" };
  }
}

export function registerLocalRerankerIpc(options: RegisterLocalRerankerIpcOptions): void {
  options.ipcMain.handle("retrieval.localRerankerStatus", async (_event, request: unknown) => {
    const parsed = LocalRerankerStatusRequestSchema.parse(request);
    return LocalRerankerStatusSchema.parse(await options.status(parsed));
  });
  options.ipcMain.handle("retrieval.installLocalReranker", async (_event, request: unknown) => {
    const parsed = LocalRerankerInstallRequestSchema.parse(request);
    return LocalRerankerInstallResultSchema.parse(await invokeMutation(parsed, () => options.install(parsed)));
  });
  options.ipcMain.handle("retrieval.enableLocalReranker", async (_event, request: unknown) => {
    const parsed = LocalRerankerEnableRequestSchema.parse(request);
    return LocalRerankerEnableResultSchema.parse(await invokeMutation(parsed, () => options.enable(parsed)));
  });
  options.ipcMain.handle("retrieval.disableLocalReranker", async (_event, request: unknown) => {
    const parsed = LocalRerankerDisableRequestSchema.parse(request);
    return LocalRerankerDisableResultSchema.parse(await invokeMutation(parsed, () => options.disable(parsed)));
  });
  options.ipcMain.handle("retrieval.removeLocalReranker", async (_event, request: unknown) => {
    const parsed = LocalRerankerRemoveRequestSchema.parse(request);
    return LocalRerankerRemoveResultSchema.parse(await invokeMutation(parsed, () => options.remove(parsed)));
  });
}
