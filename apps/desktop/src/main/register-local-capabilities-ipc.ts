import type { BrowserWindow, IpcMain, OpenDialogOptions, WebContents } from "electron";
import {
  DICTATION_LANGUAGE_PREFERENCE_CHANNEL,
  SET_DICTATION_LANGUAGE_PREFERENCE_CHANNEL,
  DictationLanguagePreferenceRequestSchema,
  DictationLanguagePreferenceResultSchema,
  SetDictationLanguagePreferenceRequestSchema,
  SetDictationLanguagePreferenceResultSchema,
  OCR_LANGUAGE_PREFERENCE_CHANNEL,
  SET_OCR_LANGUAGE_PREFERENCE_CHANNEL,
  OCR_ENGINE_PREFERENCE_CHANNEL,
  SET_OCR_ENGINE_PREFERENCE_CHANNEL,
  OCR_SUMMARY_PREFERENCE_CHANNEL,
  SET_OCR_SUMMARY_PREFERENCE_CHANNEL,
  OCR_IMAGE_TEST_CHANNEL,
  TOOLCHAIN_REPAIR_CHANNEL,
  OcrLanguagePreferenceRequestSchema,
  OcrLanguagePreferenceResultSchema,
  SetOcrLanguagePreferenceRequestSchema,
  SetOcrLanguagePreferenceResultSchema,
  OcrEnginePreferenceRequestSchema,
  OcrEnginePreferenceResultSchema,
  SetOcrEnginePreferenceRequestSchema,
  SetOcrEnginePreferenceResultSchema,
  OcrSummaryPreferenceRequestSchema,
  OcrSummaryPreferenceResultSchema,
  SetOcrSummaryPreferenceRequestSchema,
  SetOcrSummaryPreferenceResultSchema,
  OcrImageTestRequestSchema,
  OcrImageTestResultSchema,
  ToolchainRepairRequestSchema,
  ToolchainRepairResultSchema,
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
  type PaddleOcrTestResult,
  type DictationLanguagePreferenceRequest,
  type DictationLanguagePreferenceResult,
  type SetDictationLanguagePreferenceRequest,
  type SetDictationLanguagePreferenceResult,
  type OcrLanguagePreferenceRequest,
  type OcrLanguagePreferenceResult,
  type SetOcrLanguagePreferenceRequest,
  type SetOcrLanguagePreferenceResult,
  type OcrEnginePreferenceRequest,
  type OcrEnginePreferenceResult,
  type SetOcrEnginePreferenceRequest,
  type SetOcrEnginePreferenceResult,
  type OcrSummaryPreferenceRequest,
  type OcrSummaryPreferenceResult,
  type SetOcrSummaryPreferenceRequest,
  type SetOcrSummaryPreferenceResult,
  type OcrImageTestRequest,
  type OcrImageTestResult,
  type ToolchainRepairRequest,
  type ToolchainRepairResult
} from "@pige/schemas";

type Awaitable<T> = T | Promise<T>;

export interface RegisterLocalCapabilitiesIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly getWindow: (sender: WebContents) => BrowserWindow | undefined;
  readonly showOpenDialog: (
    window: BrowserWindow,
    options: OpenDialogOptions
  ) => Promise<{ readonly canceled: boolean; readonly filePaths: readonly string[] }>;
  readonly testOcrImage: (
    request: OcrImageTestRequest,
    inputPath: string
  ) => Awaitable<OcrImageTestResult>;
  readonly dictationLanguagePreference: (
    request: DictationLanguagePreferenceRequest
  ) => Awaitable<DictationLanguagePreferenceResult>;
  readonly setDictationLanguagePreference: (
    request: SetDictationLanguagePreferenceRequest
  ) => Awaitable<SetDictationLanguagePreferenceResult>;
  readonly ocrLanguagePreference: (
    request: OcrLanguagePreferenceRequest
  ) => Awaitable<OcrLanguagePreferenceResult>;
  readonly setOcrLanguagePreference: (
    request: SetOcrLanguagePreferenceRequest
  ) => Awaitable<SetOcrLanguagePreferenceResult>;
  readonly ocrEnginePreference: (
    request: OcrEnginePreferenceRequest
  ) => Awaitable<OcrEnginePreferenceResult>;
  readonly setOcrEnginePreference: (
    request: SetOcrEnginePreferenceRequest
  ) => Awaitable<SetOcrEnginePreferenceResult>;
  readonly ocrSummaryPreference: (
    request: OcrSummaryPreferenceRequest
  ) => Awaitable<OcrSummaryPreferenceResult>;
  readonly setOcrSummaryPreference: (
    request: SetOcrSummaryPreferenceRequest
  ) => Awaitable<SetOcrSummaryPreferenceResult>;
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
  readonly repairToolchain: (
    request: ToolchainRepairRequest
  ) => Awaitable<ToolchainRepairResult>;
  readonly onPaddleOcrReady?: () => Awaitable<void>;
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
    DICTATION_LANGUAGE_PREFERENCE_CHANNEL,
    async (_event, request: unknown) => {
      const parsed = DictationLanguagePreferenceRequestSchema.parse(request);
      return DictationLanguagePreferenceResultSchema.parse(
        await options.dictationLanguagePreference(parsed)
      );
    }
  );

  options.ipcMain.handle(
    SET_DICTATION_LANGUAGE_PREFERENCE_CHANNEL,
    async (_event, request: unknown) => {
      const parsed = SetDictationLanguagePreferenceRequestSchema.parse(request);
      return SetDictationLanguagePreferenceResultSchema.parse(
        await options.setDictationLanguagePreference(parsed)
      );
    }
  );

  options.ipcMain.handle(
    OCR_LANGUAGE_PREFERENCE_CHANNEL,
    async (_event, request: unknown) => {
      const parsed = OcrLanguagePreferenceRequestSchema.parse(request);
      return OcrLanguagePreferenceResultSchema.parse(await options.ocrLanguagePreference(parsed));
    }
  );

  options.ipcMain.handle(
    OCR_ENGINE_PREFERENCE_CHANNEL,
    async (_event, request: unknown) => {
      const parsed = OcrEnginePreferenceRequestSchema.parse(request);
      return OcrEnginePreferenceResultSchema.parse(await options.ocrEnginePreference(parsed));
    }
  );

  options.ipcMain.handle(
    SET_OCR_ENGINE_PREFERENCE_CHANNEL,
    async (_event, request: unknown) => {
      const parsed = SetOcrEnginePreferenceRequestSchema.parse(request);
      return SetOcrEnginePreferenceResultSchema.parse(await options.setOcrEnginePreference(parsed));
    }
  );

  options.ipcMain.handle(
    OCR_SUMMARY_PREFERENCE_CHANNEL,
    async (_event, request: unknown) => {
      const parsed = OcrSummaryPreferenceRequestSchema.parse(request);
      return OcrSummaryPreferenceResultSchema.parse(await options.ocrSummaryPreference(parsed));
    }
  );

  options.ipcMain.handle(
    SET_OCR_SUMMARY_PREFERENCE_CHANNEL,
    async (_event, request: unknown) => {
      const parsed = SetOcrSummaryPreferenceRequestSchema.parse(request);
      return SetOcrSummaryPreferenceResultSchema.parse(await options.setOcrSummaryPreference(parsed));
    }
  );

  options.ipcMain.handle(OCR_IMAGE_TEST_CHANNEL, async (event, request: unknown) => {
    const parsed = OcrImageTestRequestSchema.parse(request);
    const window = options.getWindow(event.sender);
    if (!window || event.sender.isDestroyed()) return imageTestResult(parsed, "failed");
    try {
      const selection = await options.showOpenDialog(window, {
        title: "Test OCR with an image",
        properties: ["openFile"],
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "heic", "heif", "tif", "tiff", "webp"] }]
      });
      if (event.sender.isDestroyed()) return imageTestResult(parsed, "failed");
      if (selection.canceled) return imageTestResult(parsed, "cancelled");
      if (selection.filePaths.length !== 1) return imageTestResult(parsed, "failed");
      const result = OcrImageTestResultSchema.parse(await options.testOcrImage(parsed, selection.filePaths[0]!));
      return result.requestId === parsed.requestId ? result : imageTestResult(parsed, "failed");
    } catch {
      return imageTestResult(parsed, "failed");
    }
  });

  options.ipcMain.handle(
    SET_OCR_LANGUAGE_PREFERENCE_CHANNEL,
    async (_event, request: unknown) => {
      const parsed = SetOcrLanguagePreferenceRequestSchema.parse(request);
      return SetOcrLanguagePreferenceResultSchema.parse(await options.setOcrLanguagePreference(parsed));
    }
  );

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
      const result = await invokeMutation(
        parsed,
        PaddleOcrEnableResultSchema,
        () => options.enablePaddleOcr(parsed)
      );
      if (
        (result.status === "committed" || result.status === "already_enabled") &&
        result.summary.state === "ready"
      ) {
        try { await options.onPaddleOcrReady?.(); } catch { /* Enabled state remains authoritative. */ }
      }
      return result;
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

  options.ipcMain.handle(
    TOOLCHAIN_REPAIR_CHANNEL,
    async (_event, request: unknown) => {
      const parsed = ToolchainRepairRequestSchema.parse(request);
      try {
        const result = ToolchainRepairResultSchema.parse(await options.repairToolchain(parsed));
        return sameToolchainRepairIdentity(parsed, result)
          ? result
          : ToolchainRepairResultSchema.parse(failedToolchainRepair(parsed));
      } catch {
        return ToolchainRepairResultSchema.parse(failedToolchainRepair(parsed));
      }
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

function sameToolchainRepairIdentity(
  request: ToolchainRepairRequest,
  result: ToolchainRepairResult
): boolean {
  return result.requestId === request.requestId &&
    result.expectedHealthId === request.expectedHealthId &&
    result.expectedMissingRequiredToolIds.length === request.expectedMissingRequiredToolIds.length &&
    result.expectedMissingRequiredToolIds.every(
      (toolId, index) => toolId === request.expectedMissingRequiredToolIds[index]
    );
}

function failedToolchainRepair(
  request: ToolchainRepairRequest
): ToolchainRepairResult {
  return {
    ...request,
    status: "failed"
  };
}

function imageTestResult(
  request: OcrImageTestRequest,
  status: "cancelled" | "failed"
): OcrImageTestResult {
  return OcrImageTestResultSchema.parse({ ...request, status });
}
