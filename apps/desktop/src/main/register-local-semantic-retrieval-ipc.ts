import type { IpcMain } from "electron";
import {
  LocalSemanticRetrievalDisableRequestSchema,
  LocalSemanticRetrievalDisableResultSchema,
  LocalSemanticRetrievalEnableRequestSchema,
  LocalSemanticRetrievalEnableResultSchema,
  LocalSemanticRetrievalInstallRequestSchema,
  LocalSemanticRetrievalInstallResultSchema,
  LocalSemanticRetrievalRemoveRequestSchema,
  LocalSemanticRetrievalRemoveResultSchema,
  LocalSemanticRetrievalStatusRequestSchema,
  LocalSemanticRetrievalStatusSchema,
  type LocalSemanticRetrievalDisableRequest,
  type LocalSemanticRetrievalDisableResult,
  type LocalSemanticRetrievalEnableRequest,
  type LocalSemanticRetrievalEnableResult,
  type LocalSemanticRetrievalInstallRequest,
  type LocalSemanticRetrievalInstallResult,
  type LocalSemanticRetrievalRemoveRequest,
  type LocalSemanticRetrievalRemoveResult,
  type LocalSemanticRetrievalStatus,
  type LocalSemanticRetrievalStatusRequest
} from "@pige/schemas";

interface RegisterLocalSemanticRetrievalIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly status: (
    request: LocalSemanticRetrievalStatusRequest
  ) => LocalSemanticRetrievalStatus | Promise<LocalSemanticRetrievalStatus>;
  readonly install: (
    request: LocalSemanticRetrievalInstallRequest
  ) => LocalSemanticRetrievalInstallResult | Promise<LocalSemanticRetrievalInstallResult>;
  readonly enable: (
    request: LocalSemanticRetrievalEnableRequest
  ) => LocalSemanticRetrievalEnableResult | Promise<LocalSemanticRetrievalEnableResult>;
  readonly disable: (
    request: LocalSemanticRetrievalDisableRequest
  ) => LocalSemanticRetrievalDisableResult | Promise<LocalSemanticRetrievalDisableResult>;
  readonly remove: (
    request: LocalSemanticRetrievalRemoveRequest
  ) => LocalSemanticRetrievalRemoveResult | Promise<LocalSemanticRetrievalRemoveResult>;
}

type MutationRequest = LocalSemanticRetrievalInstallRequest;
type MutationResult = {
  readonly apiVersion: 1;
  readonly requestId: string;
  readonly revision: number;
};

function failedMutation(request: MutationRequest): MutationResult & { readonly status: "failed" } {
  return {
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    revision: request.expectedRevision,
    status: "failed"
  };
}

function assertMutationIdentity<T extends MutationResult>(request: MutationRequest, result: T): T {
  if (result.requestId !== request.requestId) {
    throw new Error("Local semantic retrieval response identity did not match the request.");
  }
  return result;
}

async function invokeMutation<T extends MutationResult>(
  request: MutationRequest,
  invoke: () => T | Promise<T>
): Promise<T | ReturnType<typeof failedMutation>> {
  try {
    return assertMutationIdentity(request, await invoke());
  } catch (error) {
    if (error instanceof Error && error.message.includes("response identity")) throw error;
    return failedMutation(request);
  }
}

export function registerLocalSemanticRetrievalIpc(
  options: RegisterLocalSemanticRetrievalIpcOptions
): void {
  options.ipcMain.handle("retrieval.localSemanticStatus", async (_event, request: unknown) => {
    const parsed = LocalSemanticRetrievalStatusRequestSchema.parse(request);
    return LocalSemanticRetrievalStatusSchema.parse(await options.status(parsed));
  });

  options.ipcMain.handle("retrieval.installLocalSemanticAsset", async (_event, request: unknown) => {
    const parsed = LocalSemanticRetrievalInstallRequestSchema.parse(request);
    const result = await invokeMutation(parsed, async () =>
      LocalSemanticRetrievalInstallResultSchema.parse(await options.install(parsed))
    );
    return LocalSemanticRetrievalInstallResultSchema.parse(result);
  });

  options.ipcMain.handle("retrieval.enableLocalSemanticAsset", async (_event, request: unknown) => {
    const parsed = LocalSemanticRetrievalEnableRequestSchema.parse(request);
    const result = await invokeMutation(parsed, async () =>
      LocalSemanticRetrievalEnableResultSchema.parse(await options.enable(parsed))
    );
    return LocalSemanticRetrievalEnableResultSchema.parse(result);
  });

  options.ipcMain.handle("retrieval.disableLocalSemanticAsset", async (_event, request: unknown) => {
    const parsed = LocalSemanticRetrievalDisableRequestSchema.parse(request);
    const result = await invokeMutation(parsed, async () =>
      LocalSemanticRetrievalDisableResultSchema.parse(await options.disable(parsed))
    );
    return LocalSemanticRetrievalDisableResultSchema.parse(result);
  });

  options.ipcMain.handle("retrieval.removeLocalSemanticAsset", async (_event, request: unknown) => {
    const parsed = LocalSemanticRetrievalRemoveRequestSchema.parse(request);
    const result = await invokeMutation(parsed, async () =>
      LocalSemanticRetrievalRemoveResultSchema.parse(await options.remove(parsed))
    );
    return LocalSemanticRetrievalRemoveResultSchema.parse(result);
  });
}
