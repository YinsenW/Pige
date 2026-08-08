import type { IpcMain, WebContents } from "electron";
import {
  DIAGNOSTICS_CANCEL_SUPPORT_BUNDLE_CHANNEL,
  DIAGNOSTICS_CLEAR_LOCAL_CHANNEL,
  DIAGNOSTICS_EXPORT_SUPPORT_BUNDLE_CHANNEL,
  DIAGNOSTICS_PREVIEW_SUPPORT_BUNDLE_CHANNEL,
  DIAGNOSTICS_REVEAL_SUPPORT_BUNDLE_CHANNEL,
  DIAGNOSTICS_RETRY_SUPPORT_BUNDLE_CHANNEL,
  DIAGNOSTICS_WORKFLOW_SUMMARY_CHANNEL,
  DiagnosticsClearLocalRequestSchema,
  DiagnosticsClearLocalResultSchema,
  DiagnosticsExportSupportBundleRequestSchema,
  DiagnosticsExportSupportBundleResultSchema,
  DiagnosticsPreviewSupportBundleRequestSchema,
  DiagnosticsRevealSupportBundleRequestSchema,
  DiagnosticsRevealSupportBundleResultSchema,
  DiagnosticsSupportBundleMutationRequestSchema,
  DiagnosticsSupportBundleMutationResultSchema,
  DiagnosticsWorkflowSummarySchema,
  DiagnosticsHealthSchema,
  type DiagnosticsClearLocalRequest,
  type DiagnosticsClearLocalResult,
  type DiagnosticsExportSupportBundleRequest,
  type DiagnosticsExportSupportBundleResult,
  type DiagnosticsPreviewSupportBundleRequest,
  type DiagnosticsRevealSupportBundleRequest,
  type DiagnosticsRevealSupportBundleResult,
  type DiagnosticsSupportBundleMutationRequest,
  type DiagnosticsSupportBundleMutationResult,
  type DiagnosticsWorkflowSummary,
  type SupportBundlePreview
} from "@pige/schemas";
import type { DiagnosticsHealth } from "@pige/contracts";

type Awaitable<T> = T | Promise<T>;

export interface RegisterDiagnosticsIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly isTrustedSender: (sender: WebContents) => boolean;
  readonly health: () => Awaitable<DiagnosticsHealth>;
  readonly workflowSummary: () => Awaitable<DiagnosticsWorkflowSummary>;
  readonly preview: (request: DiagnosticsPreviewSupportBundleRequest) => Awaitable<SupportBundlePreview>;
  readonly chooseDestination: (sender: WebContents) => Awaitable<string | undefined>;
  readonly replayStart: (request: DiagnosticsExportSupportBundleRequest) => Awaitable<DiagnosticsExportSupportBundleResult | undefined>;
  readonly start: (request: DiagnosticsExportSupportBundleRequest, destinationPath: string) => Awaitable<DiagnosticsExportSupportBundleResult>;
  readonly cancel: (request: DiagnosticsSupportBundleMutationRequest) => Awaitable<DiagnosticsSupportBundleMutationResult>;
  readonly retry: (request: DiagnosticsSupportBundleMutationRequest) => Awaitable<DiagnosticsSupportBundleMutationResult>;
  readonly reveal: (request: DiagnosticsRevealSupportBundleRequest) => Awaitable<DiagnosticsRevealSupportBundleResult>;
  readonly clear: (request: DiagnosticsClearLocalRequest) => Awaitable<DiagnosticsClearLocalResult>;
}

export function registerDiagnosticsIpc(options: RegisterDiagnosticsIpcOptions): void {
  options.ipcMain.handle("diagnostics.health", async (event) => {
    if (!options.isTrustedSender(event.sender)) throw new Error("Untrusted diagnostics sender.");
    return DiagnosticsHealthSchema.parse(await options.health());
  });
  options.ipcMain.handle(DIAGNOSTICS_WORKFLOW_SUMMARY_CHANNEL, async (event) => {
    if (!options.isTrustedSender(event.sender)) throw new Error("Untrusted diagnostics sender.");
    return DiagnosticsWorkflowSummarySchema.parse(await options.workflowSummary());
  });
  options.ipcMain.handle(DIAGNOSTICS_PREVIEW_SUPPORT_BUNDLE_CHANNEL, async (event, input: unknown) => {
    const request = DiagnosticsPreviewSupportBundleRequestSchema.parse(input);
    if (!options.isTrustedSender(event.sender)) throw new Error("Untrusted diagnostics sender.");
    return options.preview(request);
  });
  options.ipcMain.handle(DIAGNOSTICS_EXPORT_SUPPORT_BUNDLE_CHANNEL, async (event, input: unknown) => {
    const request = DiagnosticsExportSupportBundleRequestSchema.parse(input);
    const identity = request;
    if (!options.isTrustedSender(event.sender)) return failedExport(identity);
    try {
      const replay = await options.replayStart(request);
      if (replay) {
        const result = DiagnosticsExportSupportBundleResultSchema.parse(replay);
        assertExportIdentity(request, result);
        return result;
      }
      const before = DiagnosticsWorkflowSummarySchema.parse(await options.workflowSummary());
      if (before.revision !== request.expectedRevision || before.scopeContextId !== request.scopeContextId) {
        return DiagnosticsExportSupportBundleResultSchema.parse({ ...identity, status: "stale", workflow: before });
      }
      const destinationPath = await options.chooseDestination(event.sender);
      if (!options.isTrustedSender(event.sender)) return failedExport(identity);
      if (!destinationPath) {
        return DiagnosticsExportSupportBundleResultSchema.parse({
          ...identity,
          status: "canceled",
          workflow: DiagnosticsWorkflowSummarySchema.parse(await options.workflowSummary())
        });
      }
      const result = DiagnosticsExportSupportBundleResultSchema.parse(await options.start(request, destinationPath));
      assertExportIdentity(request, result);
      return result;
    } catch { return failedExport(identity); }
  });
  options.ipcMain.handle(DIAGNOSTICS_CANCEL_SUPPORT_BUNDLE_CHANNEL, async (event, input: unknown) => {
    return mutation(options, event.sender, input, "cancel");
  });
  options.ipcMain.handle(DIAGNOSTICS_RETRY_SUPPORT_BUNDLE_CHANNEL, async (event, input: unknown) => {
    return mutation(options, event.sender, input, "retry");
  });
  options.ipcMain.handle(DIAGNOSTICS_REVEAL_SUPPORT_BUNDLE_CHANNEL, async (event, input: unknown) => {
    const request = DiagnosticsRevealSupportBundleRequestSchema.parse(input);
    if (!options.isTrustedSender(event.sender)) return failedReveal(request);
    try {
      const result = DiagnosticsRevealSupportBundleResultSchema.parse(await options.reveal(request));
      assertRevealIdentity(request, result);
      return result;
    } catch { return failedReveal(request); }
  });
  options.ipcMain.handle(DIAGNOSTICS_CLEAR_LOCAL_CHANNEL, async (event, input: unknown) => {
    const request = DiagnosticsClearLocalRequestSchema.parse(input);
    if (!options.isTrustedSender(event.sender)) return DiagnosticsClearLocalResultSchema.parse({ ...request, status: "failed" });
    try { return DiagnosticsClearLocalResultSchema.parse(await options.clear(request)); }
    catch { return DiagnosticsClearLocalResultSchema.parse({ ...request, status: "failed" }); }
  });
}

async function mutation(
  options: RegisterDiagnosticsIpcOptions,
  sender: WebContents,
  input: unknown,
  action: "cancel" | "retry"
): Promise<DiagnosticsSupportBundleMutationResult> {
  const request = DiagnosticsSupportBundleMutationRequestSchema.parse(input);
  if (!options.isTrustedSender(sender)) return failedMutation(request);
  try {
    const result = DiagnosticsSupportBundleMutationResultSchema.parse(
      await (action === "cancel" ? options.cancel(request) : options.retry(request))
    );
    assertMutationIdentity(request, result);
    return result;
  } catch { return failedMutation(request); }
}

function failedExport(request: DiagnosticsExportSupportBundleRequest): DiagnosticsExportSupportBundleResult {
  return DiagnosticsExportSupportBundleResultSchema.parse({ ...request, status: "failed" });
}

function failedMutation(request: DiagnosticsSupportBundleMutationRequest): DiagnosticsSupportBundleMutationResult {
  return DiagnosticsSupportBundleMutationResultSchema.parse({ ...request, status: "failed" });
}

function failedReveal(request: DiagnosticsRevealSupportBundleRequest): DiagnosticsRevealSupportBundleResult {
  return DiagnosticsRevealSupportBundleResultSchema.parse({ ...request, status: "failed" });
}

function assertExportIdentity(request: DiagnosticsExportSupportBundleRequest, result: DiagnosticsExportSupportBundleResult): void {
  if (result.requestId !== request.requestId || result.previewId !== request.previewId ||
    result.scopeContextId !== request.scopeContextId || result.expectedRevision !== request.expectedRevision) {
    throw new Error("Diagnostics export identity changed.");
  }
}

function assertMutationIdentity(request: DiagnosticsSupportBundleMutationRequest, result: DiagnosticsSupportBundleMutationResult): void {
  if (result.requestId !== request.requestId || result.jobId !== request.jobId ||
    result.scopeContextId !== request.scopeContextId || result.expectedRevision !== request.expectedRevision) {
    throw new Error("Diagnostics mutation identity changed.");
  }
}

function assertRevealIdentity(request: DiagnosticsRevealSupportBundleRequest, result: DiagnosticsRevealSupportBundleResult): void {
  if (result.requestId !== request.requestId || result.jobId !== request.jobId ||
    result.scopeContextId !== request.scopeContextId || result.expectedRevision !== request.expectedRevision) {
    throw new Error("Diagnostics reveal identity changed.");
  }
}
