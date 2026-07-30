import type { BrowserWindow, IpcMain, OpenDialogOptions, SaveDialogOptions, WebContents } from "electron";
import {
  SkillDiscardStagedRequestSchema,
  SkillDiscardStagedResultSchema,
  SkillDisableRequestSchema,
  SkillEnableRequestSchema,
  SkillExportRequestSchema,
  SkillExportResultSchema,
  SkillInstallStagedRequestSchema,
  SkillInstallStagedResultSchema,
  SkillLifecycleMutationResultSchema,
  SkillPendingStagedReviewsRequestSchema,
  SkillPendingStagedReviewsResultSchema,
  SkillRegistryMutationResultSchema,
  SkillRegistryQueryResultSchema,
  SkillRestoreRequestSchema,
  SkillRestoreResultSchema,
  SkillStageFromMarkdownRequestSchema,
  SkillStageFromMarkdownResultSchema,
  SkillStageFromZipRequestSchema,
  SkillStageFromZipResultSchema,
  SkillStageFromUrlRequestSchema,
  SkillStageFromUrlResultSchema,
  SkillStageUpdateRequestSchema,
  SkillStageUpdateResultSchema,
  SkillUninstallRequestSchema,
  type SkillDiscardStagedRequest,
  type SkillDiscardStagedResult,
  type SkillDisableRequest,
  type SkillEnableRequest,
  type SkillExportRequest,
  type SkillExportResult,
  type SkillInstallStagedRequest,
  type SkillInstallStagedResult,
  type SkillLifecycleMutationResult,
  type SkillPendingStagedReviewsRequest,
  type SkillPendingStagedReviewsResult,
  type SkillRegistryMutationResult,
  type SkillRegistryQueryResult,
  type SkillRestoreRequest,
  type SkillRestoreResult,
  type SkillStageFromMarkdownRequest,
  type SkillStageFromMarkdownResult,
  type SkillStageFromZipRequest,
  type SkillStageFromZipResult,
  type SkillStageFromUrlRequest,
  type SkillStageFromUrlResult,
  type SkillStageUpdateRequest,
  type SkillStageUpdateResult,
  type SkillUninstallRequest
} from "@pige/schemas";

interface RegisterSkillsIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly getActiveVaultId: () => string | undefined;
  readonly getWindow: (sender: WebContents) => BrowserWindow | undefined;
  readonly showSaveDialog: (window: BrowserWindow, options: SaveDialogOptions) => Promise<{
    readonly canceled: boolean;
    readonly filePath?: string;
  }>;
  readonly showOpenDialog: (window: BrowserWindow, options: OpenDialogOptions) => Promise<{
    readonly canceled: boolean;
    readonly filePaths: string[];
  }>;
  readonly summary: () => SkillRegistryQueryResult | Promise<SkillRegistryQueryResult>;
  readonly pendingStagedReviews: (
    request: SkillPendingStagedReviewsRequest
  ) => SkillPendingStagedReviewsResult | Promise<SkillPendingStagedReviewsResult>;
  readonly stageFromUrl: (
    request: SkillStageFromUrlRequest
  ) => SkillStageFromUrlResult | Promise<SkillStageFromUrlResult>;
  readonly stageFromMarkdown: (
    request: SkillStageFromMarkdownRequest,
    sourcePath: string
  ) => SkillStageFromMarkdownResult | Promise<SkillStageFromMarkdownResult>;
  readonly stageFromZip: (
    request: SkillStageFromZipRequest,
    sourcePath: string
  ) => SkillStageFromZipResult | Promise<SkillStageFromZipResult>;
  readonly stageUpdate: (
    request: SkillStageUpdateRequest,
    sourcePath?: string
  ) => SkillStageUpdateResult | Promise<SkillStageUpdateResult>;
  readonly resolveUpdateSource?: (
    request: SkillStageUpdateRequest
  ) => "https" | "local_markdown" | "local_zip" | "local_file" | undefined |
    Promise<"https" | "local_markdown" | "local_zip" | "local_file" | undefined>;
  readonly installStaged: (
    request: SkillInstallStagedRequest
  ) => SkillInstallStagedResult | Promise<SkillInstallStagedResult>;
  readonly discardStaged: (
    request: SkillDiscardStagedRequest
  ) => SkillDiscardStagedResult | Promise<SkillDiscardStagedResult>;
  readonly disable: (
    request: SkillDisableRequest
  ) => SkillRegistryMutationResult | Promise<SkillRegistryMutationResult>;
  readonly enable: (request: SkillEnableRequest) => SkillLifecycleMutationResult | Promise<SkillLifecycleMutationResult>;
  readonly uninstall: (
    request: SkillUninstallRequest
  ) => SkillLifecycleMutationResult | Promise<SkillLifecycleMutationResult>;
  readonly restore: (request: SkillRestoreRequest) => SkillRestoreResult | Promise<SkillRestoreResult>;
  readonly exportSkill: (
    request: SkillExportRequest,
    destinationPath: string
  ) => SkillExportResult | Promise<SkillExportResult>;
  readonly publishRegistryChanged: (
    result: SkillInstallStagedResult | SkillRegistryMutationResult | SkillLifecycleMutationResult | SkillRestoreResult
  ) => void;
}

function assertRequestIdentity<T extends { readonly requestId: string }>(
  request: T,
  result: { readonly requestId: string }
): void {
  if (result.requestId !== request.requestId) {
    throw new Error("Skill lifecycle response identity did not match the request.");
  }
}

export function registerSkillsIpc(options: RegisterSkillsIpcOptions): void {
  options.ipcMain.handle("skills.summary", async () =>
    SkillRegistryQueryResultSchema.parse(await options.summary())
  );
  options.ipcMain.handle("skills.pendingStagedReviews", async (_event, request: unknown) => {
    const parsed = SkillPendingStagedReviewsRequestSchema.parse(request);
    if (!hasActiveVault(options, parsed.activeVaultId)) return pendingReviewsFailed(parsed);
    const result = SkillPendingStagedReviewsResultSchema.parse(await options.pendingStagedReviews(parsed));
    assertRequestIdentity(parsed, result);
    if (result.activeVaultId !== parsed.activeVaultId || !hasActiveVault(options, parsed.activeVaultId)) {
      return pendingReviewsFailed(parsed);
    }
    return result;
  });
  options.ipcMain.handle("skills.stageFromUrl", async (_event, request: unknown) => {
    const parsed = SkillStageFromUrlRequestSchema.parse(request);
    const result = SkillStageFromUrlResultSchema.parse(await options.stageFromUrl(parsed));
    assertRequestIdentity(parsed, result);
    return result;
  });
  options.ipcMain.handle("skills.stageFromMarkdown", async (event, request: unknown) => {
    const parsed = SkillStageFromMarkdownRequestSchema.parse(request);
    if (!hasActiveVault(options, parsed.activeVaultId)) return markdownStatus(parsed, "failed");
    const window = options.getWindow(event.sender);
    if (!window) return markdownStatus(parsed, "failed");
    let selection: { readonly canceled: boolean; readonly filePaths: string[] };
    try {
      selection = await options.showOpenDialog(window, {
        title: "Import Skill",
        properties: ["openFile"],
        filters: [{ name: "Markdown", extensions: ["md"] }]
      });
    } catch {
      return markdownStatus(parsed, "failed");
    }
    if (!hasActiveVault(options, parsed.activeVaultId)) return markdownStatus(parsed, "failed");
    if (selection.canceled) return markdownStatus(parsed, "cancelled");
    if (selection.filePaths.length !== 1) return markdownStatus(parsed, "failed");
    try {
      const result = SkillStageFromMarkdownResultSchema.parse(
        await options.stageFromMarkdown(parsed, selection.filePaths[0]!)
      );
      assertMarkdownIdentity(parsed, result);
      return result;
    } catch {
      return markdownStatus(parsed, "failed");
    }
  });
  options.ipcMain.handle("skills.stageFromZip", async (event, request: unknown) => {
    const parsed = SkillStageFromZipRequestSchema.parse(request);
    if (!hasActiveVault(options, parsed.activeVaultId)) return zipStatus(parsed, "failed");
    const window = options.getWindow(event.sender);
    if (!window) return zipStatus(parsed, "failed");
    let selection: { readonly canceled: boolean; readonly filePaths: string[] };
    try {
      selection = await options.showOpenDialog(window, {
        title: "Import ZIP Skill",
        properties: ["openFile"],
        filters: [{ name: "ZIP archive", extensions: ["zip"] }]
      });
    } catch {
      return zipStatus(parsed, "failed");
    }
    if (!hasActiveVault(options, parsed.activeVaultId)) return zipStatus(parsed, "failed");
    if (selection.canceled) return zipStatus(parsed, "cancelled");
    if (selection.filePaths.length !== 1) return zipStatus(parsed, "failed");
    try {
      const result = SkillStageFromZipResultSchema.parse(await options.stageFromZip(parsed, selection.filePaths[0]!));
      assertMarkdownIdentity(parsed, result);
      return result;
    } catch {
      return zipStatus(parsed, "failed");
    }
  });
  options.ipcMain.handle("skills.stageUpdate", async (event, request: unknown) => {
    const parsed = SkillStageUpdateRequestSchema.parse(request);
    if (!hasActiveVault(options, parsed.activeVaultId)) return stageUpdateFailed(parsed);
    let sourcePath: string | undefined;
    try {
      const source = await options.resolveUpdateSource?.(parsed) ?? "https";
      if (source === "local_markdown" || source === "local_zip" || source === "local_file") {
        const window = options.getWindow(event.sender);
        if (!window) return stageUpdateFailed(parsed);
        const selection = await options.showOpenDialog(window, {
          title: source === "local_markdown" ? "Update Skill from Markdown"
            : source === "local_zip" ? "Update Skill from ZIP" : "Update Skill from File",
          properties: ["openFile"],
          filters: source === "local_markdown" ? [{ name: "Markdown", extensions: ["md"] }]
            : source === "local_zip" ? [{ name: "ZIP archive", extensions: ["zip"] }]
              : [{ name: "Skill file", extensions: ["md", "zip"] }]
        });
        if (!hasActiveVault(options, parsed.activeVaultId)) return stageUpdateFailed(parsed);
        if (selection.canceled) return stageUpdateStatus(parsed, "cancelled");
        if (selection.filePaths.length !== 1) return stageUpdateFailed(parsed);
        sourcePath = selection.filePaths[0];
      }
    } catch {
      return stageUpdateFailed(parsed);
    }
    const result = SkillStageUpdateResultSchema.parse(await options.stageUpdate(parsed, sourcePath));
    assertInstalledIdentity(parsed, result);
    if (!hasActiveVault(options, parsed.activeVaultId)) return stageUpdateFailed(parsed);
    return result;
  });
  options.ipcMain.handle("skills.installStaged", async (_event, request: unknown) => {
    const parsed = SkillInstallStagedRequestSchema.parse(request);
    const result = SkillInstallStagedResultSchema.parse(await options.installStaged(parsed));
    assertRequestIdentity(parsed, result);
    if (result.status === "committed") options.publishRegistryChanged(result);
    return result;
  });
  options.ipcMain.handle("skills.discardStaged", async (_event, request: unknown) => {
    const parsed = SkillDiscardStagedRequestSchema.parse(request);
    const result = SkillDiscardStagedResultSchema.parse(await options.discardStaged(parsed));
    assertRequestIdentity(parsed, result);
    return result;
  });
  options.ipcMain.handle("skills.disable", async (_event, request: unknown) => {
    const parsed = SkillDisableRequestSchema.parse(request);
    const result = SkillRegistryMutationResultSchema.parse(await options.disable(parsed));
    if (result.status === "committed") options.publishRegistryChanged(result);
    return result;
  });
  registerInstalledMutation(options, "skills.enable", SkillEnableRequestSchema, options.enable);
  registerInstalledMutation(options, "skills.uninstall", SkillUninstallRequestSchema, options.uninstall);
  options.ipcMain.handle("skills.restore", async (_event, request: unknown) => {
    const parsed = SkillRestoreRequestSchema.parse(request);
    if (!hasActiveVault(options, parsed.activeVaultId)) return restoreFailed(parsed);
    const result = SkillRestoreResultSchema.parse(await options.restore(parsed));
    if (result.requestId !== parsed.requestId || result.activeVaultId !== parsed.activeVaultId ||
      result.restoreContextId !== parsed.restoreContextId || result.skillId !== parsed.skillId ||
      !hasActiveVault(options, parsed.activeVaultId)) return restoreFailed(parsed);
    if (result.status === "committed") options.publishRegistryChanged(result);
    return result;
  });
  options.ipcMain.handle("skills.export", async (event, request: unknown): Promise<SkillExportResult> => {
    const parsed = SkillExportRequestSchema.parse(request);
    if (!hasActiveVault(options, parsed.activeVaultId)) return exportStatus(parsed, "failed");
    const window = options.getWindow(event.sender);
    if (!window) return exportStatus(parsed, "failed");
    let selection: { readonly canceled: boolean; readonly filePath?: string };
    try {
      selection = await options.showSaveDialog(window, {
        title: "Export Skill",
        defaultPath: `${parsed.skillId}-SKILL.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }]
      });
    } catch {
      return exportStatus(parsed, "failed");
    }
    if (options.getActiveVaultId() !== parsed.activeVaultId) return exportStatus(parsed, "failed");
    if (selection.canceled || !selection.filePath) return exportStatus(parsed, "cancelled");
    try {
      const result = SkillExportResultSchema.parse(await options.exportSkill(parsed, selection.filePath));
      assertInstalledIdentity(parsed, result);
      return result;
    } catch {
      return exportStatus(parsed, "failed");
    }
  });
}

function restoreFailed(request: SkillRestoreRequest): SkillRestoreResult {
  return SkillRestoreResultSchema.parse({
    apiVersion: 1,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    restoreContextId: request.restoreContextId,
    skillId: request.skillId,
    status: "failed"
  });
}

function assertMarkdownIdentity(
  request: SkillStageFromMarkdownRequest,
  result: { readonly apiVersion: 1; readonly requestId: string; readonly activeVaultId: string }
): void {
  if (result.apiVersion !== request.apiVersion || result.requestId !== request.requestId ||
    result.activeVaultId !== request.activeVaultId) {
    throw new Error("Skill Markdown stage response identity did not match the request.");
  }
}

type InstalledRequest = SkillEnableRequest | SkillUninstallRequest;

function registerInstalledMutation<TRequest extends InstalledRequest>(
  options: RegisterSkillsIpcOptions,
  channel: "skills.enable" | "skills.uninstall",
  schema: { parse(value: unknown): TRequest },
  mutate: (request: TRequest) => SkillLifecycleMutationResult | Promise<SkillLifecycleMutationResult>
): void {
  options.ipcMain.handle(channel, async (_event, request: unknown) => {
    const parsed = schema.parse(request);
    if (!hasActiveVault(options, parsed.activeVaultId)) {
      return SkillLifecycleMutationResultSchema.parse({
        apiVersion: parsed.apiVersion,
        requestId: parsed.requestId,
        activeVaultId: parsed.activeVaultId,
        skillId: parsed.skillId,
        status: "failed"
      });
    }
    const result = SkillLifecycleMutationResultSchema.parse(await mutate(parsed));
    assertInstalledIdentity(parsed, result);
    if (result.status === "committed") options.publishRegistryChanged(result);
    return result;
  });
}

function hasActiveVault(options: RegisterSkillsIpcOptions, activeVaultId: string): boolean {
  return options.getActiveVaultId() === activeVaultId;
}

function assertInstalledIdentity(
  request: SkillEnableRequest | SkillUninstallRequest | SkillExportRequest | SkillStageUpdateRequest,
  result: SkillLifecycleMutationResult | SkillExportResult | SkillStageUpdateResult
): void {
  if (result.apiVersion !== request.apiVersion || result.requestId !== request.requestId ||
    result.activeVaultId !== request.activeVaultId || result.skillId !== request.skillId) {
    throw new Error("Skill lifecycle response identity did not match the request.");
  }
}

function stageUpdateFailed(request: SkillStageUpdateRequest): SkillStageUpdateResult {
  return stageUpdateStatus(request, "failed");
}

function stageUpdateStatus(request: SkillStageUpdateRequest, status: "cancelled" | "failed"): SkillStageUpdateResult {
  return SkillStageUpdateResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    skillId: request.skillId,
    status
  });
}

function exportStatus(request: SkillExportRequest, status: "cancelled" | "failed"): SkillExportResult {
  return SkillExportResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    skillId: request.skillId,
    registryRevision: request.expectedRegistryRevision,
    status
  });
}

function markdownStatus(
  request: SkillStageFromMarkdownRequest,
  status: "cancelled" | "failed"
): SkillStageFromMarkdownResult {
  return SkillStageFromMarkdownResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    status
  });
}

function pendingReviewsFailed(request: SkillPendingStagedReviewsRequest): SkillPendingStagedReviewsResult {
  return SkillPendingStagedReviewsResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    status: "failed"
  });
}

function zipStatus(request: SkillStageFromZipRequest, status: "cancelled" | "failed"): SkillStageFromZipResult {
  return SkillStageFromZipResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    status
  });
}
