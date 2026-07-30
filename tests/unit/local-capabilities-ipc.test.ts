import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { readFileSync } from "node:fs";
import {
  PADDLE_OCR_ENGINE_ID,
  TOOLCHAIN_REPAIR_CHANNEL,
  PaddleOcrDisableResultSchema,
  PaddleOcrEnableResultSchema,
  PaddleOcrInstallResultSchema,
  PaddleOcrRemoveResultSchema,
  PaddleOcrTestResultSchema,
  ToolchainRepairResultSchema
} from "@pige/schemas";
import { describe, expect, it, vi } from "vitest";
import { registerLocalCapabilitiesIpc } from
  "../../apps/desktop/src/main/register-local-capabilities-ipc";

type IpcHandler = (event: IpcMainInvokeEvent, request?: unknown) => unknown;

const request = {
  apiVersion: 1,
  requestId: "paddleocr_abcdefghijklmnop",
  expectedRevision: 4
} as const;

const toolchainRepairRequest = {
  apiVersion: 1,
  requestId: "toolchain_repair_request_abcdefghijklmnop",
  expectedHealthId: `toolchain_health_${"a".repeat(64)}`,
  expectedMissingRequiredToolIds: ["git", "uv"]
} as const;

const notInstalledSummary = {
  apiVersion: 1,
  revision: 4,
  engineId: PADDLE_OCR_ENGINE_ID,
  state: "not_installed",
  catalogVersion: "paddleocr-v1",
  components: [{
    componentId: "paddleocr-engine",
    kind: "engine",
    label: "PaddleOCR local engine",
    version: "1.0.0",
    sizeBytes: 1024
  }],
  downloadSizeBytes: 1024,
  nativeOcrPreferred: true,
  hiddenDownloadsAllowed: false,
  canInstall: true,
  canEnable: false,
  canTest: false,
  canDisable: false,
  canRemove: false
} as const;

const readySummary = {
  ...notInstalledSummary,
  revision: 5,
  state: "ready",
  canInstall: false,
  canTest: true,
  canDisable: true,
  canRemove: true
} as const;

const disabledSummary = {
  ...readySummary,
  revision: 6,
  state: "disabled",
  canEnable: true,
  canDisable: false
} as const;

function makeHarness(overrides: Record<string, unknown> = {}) {
  const handlers = new Map<string, IpcHandler>();
  const callbacks = {
    ocrLanguagePreference: vi.fn((input: { readonly requestId: string }) => ({
      apiVersion: 1 as const,
      requestId: input.requestId,
      status: "ready" as const,
      summary: {
        apiVersion: 1 as const,
        revision: 2,
        preference: { mode: "preferred" as const, language: "ja" as const },
        appliesTo: "new_ocr_jobs" as const
      }
    })),
    setOcrLanguagePreference: vi.fn((input: { readonly requestId: string }) => ({
      apiVersion: 1 as const,
      requestId: input.requestId,
      status: "committed" as const,
      summary: {
        apiVersion: 1 as const,
        revision: 3,
        preference: { mode: "preferred" as const, language: "fr" as const },
        appliesTo: "new_ocr_jobs" as const
      }
    })),
    paddleOcrSummary: vi.fn(() => notInstalledSummary),
    installPaddleOcr: vi.fn((input: typeof request) => ({
      apiVersion: 1 as const,
      requestId: input.requestId,
      engineId: PADDLE_OCR_ENGINE_ID,
      status: "accepted" as const,
      jobId: "job_20260728_abcdefgh",
      summary: {
        ...notInstalledSummary,
        activeAction: "install" as const,
        activeJobId: "job_20260728_abcdefgh",
        canInstall: false
      }
    })),
    enablePaddleOcr: vi.fn((input: typeof request) => ({
      apiVersion: 1 as const,
      requestId: input.requestId,
      engineId: PADDLE_OCR_ENGINE_ID,
      status: "committed" as const,
      summary: readySummary
    })),
    testPaddleOcr: vi.fn((input: typeof request) => ({
      apiVersion: 1 as const,
      requestId: input.requestId,
      engineId: PADDLE_OCR_ENGINE_ID,
      status: "accepted" as const,
      jobId: "job_20260728_ijklmnop",
      summary: {
        ...readySummary,
        activeAction: "test" as const,
        activeJobId: "job_20260728_ijklmnop",
        canTest: false,
        canDisable: false,
        canRemove: false
      }
    })),
    disablePaddleOcr: vi.fn((input: typeof request) => ({
      apiVersion: 1 as const,
      requestId: input.requestId,
      engineId: PADDLE_OCR_ENGINE_ID,
      status: "committed" as const,
      summary: disabledSummary
    })),
    removePaddleOcr: vi.fn((input: typeof request) => ({
      apiVersion: 1 as const,
      requestId: input.requestId,
      engineId: PADDLE_OCR_ENGINE_ID,
      status: "committed" as const,
      summary: { ...notInstalledSummary, revision: 7 }
    })),
    repairToolchain: vi.fn((input: typeof toolchainRepairRequest) => ({
      ...input,
      status: "opened" as const
    })),
    ...overrides
  };

  registerLocalCapabilitiesIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler as IpcHandler)
    } as Pick<IpcMain, "handle">,
    ...callbacks
  });
  return { handlers, callbacks };
}

describe("registerLocalCapabilitiesIpc", () => {
  it("is composed by Main against the reviewed manifest lifecycle owner", () => {
    const source = readFileSync("apps/desktop/src/main/index.ts", "utf8");
    expect(source).toContain("registerLocalCapabilitiesIpc({");
    expect(source).toContain("createUnavailablePaddleOcrLifecycleService(");
    for (const callback of [
      "ocrLanguagePreference",
      "setOcrLanguagePreference",
      "paddleOcrSummary",
      "installPaddleOcr",
      "enablePaddleOcr",
      "testPaddleOcr",
      "disablePaddleOcr",
      "removePaddleOcr",
      "repairToolchain"
    ]) {
      expect(source).toContain(`${callback}:`);
    }
    expect(source).toContain("parser-manifests/paddleocr-local.parser.manifest.json");
  });

  it("registers OCR, managed PaddleOCR, and bundled-toolchain repair channels", () => {
    expect([...makeHarness().handlers.keys()]).toEqual([
      "localCapabilities.ocrLanguagePreference",
      "localCapabilities.setOcrLanguagePreference",
      "localCapabilities.paddleOcrSummary",
      "localCapabilities.installPaddleOcr",
      "localCapabilities.enablePaddleOcr",
      "localCapabilities.testPaddleOcr",
      "localCapabilities.disablePaddleOcr",
      "localCapabilities.removePaddleOcr",
      TOOLCHAIN_REPAIR_CHANNEL
    ]);
  });

  it("strictly delegates valid summary and lifecycle requests", async () => {
    const { handlers, callbacks } = makeHarness();

    const preferenceRead = { apiVersion: 1, requestId: "ocrlangreq_abcdefghijklmnop" } as const;
    const preferenceSet = {
      ...preferenceRead,
      expectedRevision: 2,
      preference: { mode: "preferred", language: "fr" }
    } as const;
    await expect(call(handlers, "localCapabilities.ocrLanguagePreference", preferenceRead))
      .resolves.toMatchObject({ status: "ready", summary: { revision: 2 } });
    await expect(call(handlers, "localCapabilities.setOcrLanguagePreference", preferenceSet))
      .resolves.toMatchObject({ status: "committed", summary: { revision: 3 } });
    expect(callbacks.ocrLanguagePreference).toHaveBeenCalledWith(preferenceRead);
    expect(callbacks.setOcrLanguagePreference).toHaveBeenCalledWith(preferenceSet);

    await expect(call(handlers, "localCapabilities.paddleOcrSummary", { apiVersion: 1 }))
      .resolves.toEqual(notInstalledSummary);
    for (const [channel, callback, status] of [
      ["localCapabilities.installPaddleOcr", callbacks.installPaddleOcr, "accepted"],
      ["localCapabilities.enablePaddleOcr", callbacks.enablePaddleOcr, "committed"],
      ["localCapabilities.testPaddleOcr", callbacks.testPaddleOcr, "accepted"],
      ["localCapabilities.disablePaddleOcr", callbacks.disablePaddleOcr, "committed"],
      ["localCapabilities.removePaddleOcr", callbacks.removePaddleOcr, "committed"]
    ] as const) {
      await expect(call(handlers, channel, request)).resolves.toMatchObject({
        apiVersion: request.apiVersion,
        requestId: request.requestId,
        engineId: PADDLE_OCR_ENGINE_ID,
        status
      });
      expect(callback).toHaveBeenCalledWith(request);
    }
    expect(callbacks.paddleOcrSummary).toHaveBeenCalledWith({ apiVersion: 1 });
    await expect(call(handlers, TOOLCHAIN_REPAIR_CHANNEL, toolchainRepairRequest))
      .resolves.toEqual({ ...toolchainRepairRequest, status: "opened" });
    expect(callbacks.repairToolchain).toHaveBeenCalledWith(toolchainRepairRequest);
  });

  it("rejects malformed requests before invoking lifecycle services", async () => {
    const { handlers, callbacks } = makeHarness();

    await expect(call(handlers, "localCapabilities.paddleOcrSummary", {
      apiVersion: 1,
      path: "/private/paddleocr"
    })).rejects.toThrow();
    for (const [channel, callback] of [
      ["localCapabilities.installPaddleOcr", callbacks.installPaddleOcr],
      ["localCapabilities.enablePaddleOcr", callbacks.enablePaddleOcr],
      ["localCapabilities.testPaddleOcr", callbacks.testPaddleOcr],
      ["localCapabilities.disablePaddleOcr", callbacks.disablePaddleOcr],
      ["localCapabilities.removePaddleOcr", callbacks.removePaddleOcr]
    ] as const) {
      await expect(call(handlers, channel, { ...request, rawError: "private" }))
        .rejects.toThrow();
      expect(callback).not.toHaveBeenCalled();
    }
    expect(callbacks.paddleOcrSummary).not.toHaveBeenCalled();
    await expect(call(handlers, TOOLCHAIN_REPAIR_CHANNEL, {
      ...toolchainRepairRequest,
      expectedMissingRequiredToolIds: ["uv", "git"]
    })).rejects.toThrow();
    expect(callbacks.repairToolchain).not.toHaveBeenCalled();
  });

  it("fails closed on malformed service results while preserving request identity", async () => {
    const { handlers } = makeHarness({
      paddleOcrSummary: vi.fn(() => ({ ...notInstalledSummary, downloadUrl: "https://invalid" })),
      enablePaddleOcr: vi.fn(() => ({
        apiVersion: 1,
        requestId: "paddleocr_ffffffffffffffff",
        engineId: PADDLE_OCR_ENGINE_ID,
        status: "committed",
        summary: readySummary
      })),
      removePaddleOcr: vi.fn(() => ({
        apiVersion: 1,
        requestId: request.requestId,
        engineId: PADDLE_OCR_ENGINE_ID,
        status: "failed",
        rawError: "/private/paddleocr"
      })),
      repairToolchain: vi.fn(() => ({
        ...toolchainRepairRequest,
        requestId: "toolchain_repair_request_ffffffffffffffff",
        status: "opened"
      }))
    });

    await expect(call(handlers, "localCapabilities.paddleOcrSummary", { apiVersion: 1 }))
      .rejects.toThrow();
    await expect(call(handlers, "localCapabilities.enablePaddleOcr", request))
      .resolves.toEqual(failedResult());
    await expect(call(handlers, "localCapabilities.removePaddleOcr", request))
      .resolves.toEqual(failedResult());
    await expect(call(handlers, TOOLCHAIN_REPAIR_CHANNEL, toolchainRepairRequest))
      .resolves.toEqual({ ...toolchainRepairRequest, status: "failed" });
  });

  it("returns schema-valid body-free failures when mutation services throw", async () => {
    const failure = vi.fn(() => {
      throw new Error("ENOENT /private/paddleocr from https://invalid");
    });
    const { handlers } = makeHarness({
      installPaddleOcr: failure,
      enablePaddleOcr: failure,
      testPaddleOcr: failure,
      disablePaddleOcr: failure,
      removePaddleOcr: failure
    });
    const cases = [
      ["localCapabilities.installPaddleOcr", PaddleOcrInstallResultSchema],
      ["localCapabilities.enablePaddleOcr", PaddleOcrEnableResultSchema],
      ["localCapabilities.testPaddleOcr", PaddleOcrTestResultSchema],
      ["localCapabilities.disablePaddleOcr", PaddleOcrDisableResultSchema],
      ["localCapabilities.removePaddleOcr", PaddleOcrRemoveResultSchema]
    ] as const;

    for (const [channel, schema] of cases) {
      const result = await call(handlers, channel, request);
      expect(result).toEqual(failedResult());
      expect(schema.parse(result)).toEqual(failedResult());
      expect(JSON.stringify(result)).not.toMatch(/error|summary|path|url|private/u);
    }
    expect(failure).toHaveBeenCalledTimes(5);

    const toolchainFailure = vi.fn(() => {
      throw new Error("private URL and path");
    });
    const toolchainHarness = makeHarness({ repairToolchain: toolchainFailure });
    const result = await call(toolchainHarness.handlers, TOOLCHAIN_REPAIR_CHANNEL, toolchainRepairRequest);
    expect(result).toEqual({ ...toolchainRepairRequest, status: "failed" });
    expect(ToolchainRepairResultSchema.parse(result)).toEqual(result);
    expect(JSON.stringify(result)).not.toMatch(/error|path|url|private/u);
  });
});

function call(
  handlers: Map<string, IpcHandler>,
  channel: string,
  value?: unknown
): Promise<unknown> {
  return Promise.resolve(handlers.get(channel)!({} as IpcMainInvokeEvent, value));
}

function failedResult() {
  return {
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    engineId: PADDLE_OCR_ENGINE_ID,
    status: "failed"
  } as const;
}
