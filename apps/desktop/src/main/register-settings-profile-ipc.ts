import type {
  BrowserWindow,
  IpcMain,
  MessageBoxOptions,
  OpenDialogOptions,
  SaveDialogOptions,
  WebContents
} from "electron";
import {
  SETTINGS_PROFILE_EXPORT_CHANNEL,
  SETTINGS_PROFILE_IMPORT_APPLY_CHANNEL,
  SETTINGS_PROFILE_IMPORT_PREVIEW_CHANNEL,
  SettingsProfileExportRequestSchema,
  SettingsProfileExportResultSchema,
  SettingsProfileImportApplyRequestSchema,
  SettingsProfileImportApplyResultSchema,
  SettingsProfileImportPreviewRequestSchema,
  SettingsProfileImportPreviewResultSchema,
  type SettingsProfileExportRequest,
  type SettingsProfileImportApplyRequest,
  type SettingsProfileImportPreviewRequest
} from "@pige/schemas";
import type { SettingsProfileTransferService } from "./services/settings-profile-transfer-service";

export interface RegisterSettingsProfileIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly getWindow: (sender: WebContents) => BrowserWindow | undefined;
  readonly showSaveDialog: (window: BrowserWindow, options: SaveDialogOptions) => Promise<{
    readonly canceled: boolean; readonly filePath?: string;
  }>;
  readonly showOpenDialog: (window: BrowserWindow, options: OpenDialogOptions) => Promise<{
    readonly canceled: boolean; readonly filePaths: readonly string[];
  }>;
  readonly showMessageBox: (window: BrowserWindow, options: MessageBoxOptions) => Promise<{
    readonly response: number;
  }>;
  readonly getService: () => SettingsProfileTransferService;
}

export function registerSettingsProfileIpc(options: RegisterSettingsProfileIpcOptions): void {
  options.ipcMain.handle(SETTINGS_PROFILE_EXPORT_CHANNEL, async (event, value: unknown) => {
    const request = SettingsProfileExportRequestSchema.parse(value);
    const window = options.getWindow(event.sender);
    if (!window) return SettingsProfileExportResultSchema.parse({ ...request, status: "failed" });
    try {
      const selection = await options.showSaveDialog(window, {
        title: "Export Pige Preferences",
        defaultPath: "pige-preferences.pige-settings.json",
        filters: [{ name: "Pige preferences", extensions: ["json"] }]
      });
      if (selection.canceled || !selection.filePath) return exportStatus(request, "cancelled");
      return options.getService().export(request, selection.filePath);
    } catch {
      return exportStatus(request, "failed");
    }
  });

  options.ipcMain.handle(SETTINGS_PROFILE_IMPORT_PREVIEW_CHANNEL, async (event, value: unknown) => {
    const request = SettingsProfileImportPreviewRequestSchema.parse(value);
    const window = options.getWindow(event.sender);
    if (!window) return previewStatus(request, "failed");
    try {
      const selection = await options.showOpenDialog(window, {
        title: "Import Pige Preferences",
        properties: ["openFile"],
        filters: [{ name: "Pige preferences", extensions: ["json"] }]
      });
      if (selection.canceled || selection.filePaths.length !== 1) return previewStatus(request, "cancelled");
      return options.getService().preview(request, selection.filePaths[0]!);
    } catch {
      return previewStatus(request, "failed");
    }
  });

  options.ipcMain.handle(SETTINGS_PROFILE_IMPORT_APPLY_CHANNEL, async (event, value: unknown) => {
    const request = SettingsProfileImportApplyRequestSchema.parse(value);
    const window = options.getWindow(event.sender);
    if (!window || !options.getService().hasCurrentPreview(request.previewId)) {
      return applyStatus(request, window ? "not_found" : "failed");
    }
    try {
      const confirmation = await options.showMessageBox(window, {
        type: "warning",
        buttons: ["Import preferences", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: "Import Pige Preferences",
        message: "Apply these preferences?",
        detail: "Vaults, provider credentials, permissions, window state, and recent-vault history will not be changed."
      });
      if (confirmation.response !== 0) return applyStatus(request, "cancelled");
      return options.getService().apply(request);
    } catch {
      return applyStatus(request, "failed");
    }
  });
}

function exportStatus(request: SettingsProfileExportRequest, status: "cancelled" | "failed") {
  return SettingsProfileExportResultSchema.parse({ ...request, status });
}
function previewStatus(request: SettingsProfileImportPreviewRequest, status: "cancelled" | "failed") {
  return SettingsProfileImportPreviewResultSchema.parse({ ...request, status });
}
function applyStatus(
  request: SettingsProfileImportApplyRequest,
  status: "cancelled" | "not_found" | "failed"
) {
  return SettingsProfileImportApplyResultSchema.parse({ ...request, status });
}
