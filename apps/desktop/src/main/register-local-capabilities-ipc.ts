import type { IpcMain } from "electron";
import {
  PADDLE_OCR_ENGINE_ID,
  PaddleOcrDisableRequestSchema,
  PaddleOcrDisableResultSchema,
  PaddleOcrEnableRequestSchema,
  PaddleOcrEnableResultSchema,
  PaddleOcrInstallRequestSchema,
  PaddleOcrInstallResultSchema,
  PaddleOcrRemoveRequestSchema,
  PaddleOcrRemoveResultSchema,
  PaddleOcrSummaryRequestSchema,
  PaddleOcrSummarySchema,
  PaddleOcrTestRequestSchema,
  PaddleOcrTestResultSchema,
  type PaddleOcrDisableRequest,
  type PaddleOcrDisableResult,
  type PaddleOcrEnableRequest,
  type PaddleOcrEnableResult,
  type PaddleOcrInstallRequest,
  type PaddleOcrInstallResult,
  type PaddleOcrRemoveRequest,
  type PaddleOcrRemoveResult,
  type PaddleOcrSummary,
  type PaddleOcrSummaryRequest,
  type PaddleOcrTestRequest,
  type PaddleOcrTestResult
} from "@pige/schemas";

type Awaitable<T> = T | Promise<T>;

export interface RegisterLocalCapabilitiesIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly paddleOcrSummary: (
    request: PaddleOcrSummaryRequest
  ) => Awaitable<PaddleOcrSummary>;
  readonly installPaddleOcr: (
    request: PaddleOcrInstallRequest
  ) => Awaitable<PaddleOcrInstallResult>;
  readonly enablePaddleOcr: (
    request: PaddleOcrEnableRequest
  ) => Awaitable<PaddleOcrEnableResult>;
  readonly testPaddleOcr: (
    request: PaddleOcrTestRequest
  ) => Awaitable<PaddleOcrTestResult>;
  readonly disablePaddleOcr: (
    request: PaddleOcrDisableRequest
  ) => Awaitable<PaddleOcrDisableResult>;
  readonly removePaddleOcr: (
    request: PaddleOcrRemoveRequest
  ) => Awaitable<PaddleOcrRemoveResult>;
}

type MutationRequest = PaddleOcrInstallRequest;
type MutationResult = {
  readonly apiVersion: 1;
  readonly requestId: string;
  readonly engineId: typeof PADDLE_OCR_ENGINE_ID;
};

interface ResultSchema<T> {
  parse(value: unknown): T;
}

export function registerLocalCapabilitiesIpc(
  options: RegisterLocalCapabilitiesIpcOptions
): void {
  options.ipcMain.handle(
    "localCapabilities.paddleOcrSummary",
    async (_event, request: unknown) => {
      const parsed = PaddleOcrSummaryRequestSchema.parse(request);
      return PaddleOcrSummarySchema.parse(await options.paddleOcrSummary(parsed));
    }
  );

  options.ipcMain.handle(
    "localCapabilities.installPaddleOcr",
    async (_event, request: unknown) => {
      const parsed = PaddleOcrInstallRequestSchema.parse(request);
      return invokeMutation(
        parsed,
        PaddleOcrInstallResultSchema,
        () => options.installPaddleOcr(parsed)
      );
    }
  );

  options.ipcMain.handle(
    "localCapabilities.enablePaddleOcr",
    async (_event, request: unknown) => {
      const parsed = PaddleOcrEnableRequestSchema.parse(request);
      return invokeMutation(
        parsed,
        PaddleOcrEnableResultSchema,
        () => options.enablePaddleOcr(parsed)
      );
    }
  );

  options.ipcMain.handle(
    "localCapabilities.testPaddleOcr",
    async (_event, request: unknown) => {
      const parsed = PaddleOcrTestRequestSchema.parse(request);
      return invokeMutation(
        parsed,
        PaddleOcrTestResultSchema,
        () => options.testPaddleOcr(parsed)
      );
    }
  );

  options.ipcMain.handle(
    "localCapabilities.disablePaddleOcr",
    async (_event, request: unknown) => {
      const parsed = PaddleOcrDisableRequestSchema.parse(request);
      return invokeMutation(
        parsed,
        PaddleOcrDisableResultSchema,
        () => options.disablePaddleOcr(parsed)
      );
    }
  );

  options.ipcMain.handle(
    "localCapabilities.removePaddleOcr",
    async (_event, request: unknown) => {
      const parsed = PaddleOcrRemoveRequestSchema.parse(request);
      return invokeMutation(
        parsed,
        PaddleOcrRemoveResultSchema,
        () => options.removePaddleOcr(parsed)
      );
    }
  );
}

async function invokeMutation<T extends MutationResult>(
  request: MutationRequest,
  schema: ResultSchema<T>,
  invoke: () => Awaitable<T>
): Promise<T> {
  try {
    const result = schema.parse(await invoke());
    return result.apiVersion === request.apiVersion && result.requestId === request.requestId
      ? result
      : schema.parse(failedMutation(request));
  } catch {
    return schema.parse(failedMutation(request));
  }
}

function failedMutation(request: MutationRequest): MutationResult & { readonly status: "failed" } {
  return {
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    engineId: PADDLE_OCR_ENGINE_ID,
    status: "failed"
  };
}
