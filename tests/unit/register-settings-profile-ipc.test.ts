import { describe, expect, it, vi } from "vitest";
import {
  SETTINGS_PROFILE_EXPORT_CHANNEL,
  SETTINGS_PROFILE_IMPORT_APPLY_CHANNEL,
  SETTINGS_PROFILE_IMPORT_PREVIEW_CHANNEL
} from "@pige/schemas";
import { registerSettingsProfileIpc } from "../../apps/desktop/src/main/register-settings-profile-ipc";
import type { SettingsProfileTransferService } from "../../apps/desktop/src/main/services/settings-profile-transfer-service";

describe("registerSettingsProfileIpc", () => {
  it("keeps file paths in Main and requires explicit confirmation before apply", async () => {
    const handlers = new Map<string, (event: any, value: unknown) => Promise<unknown>>();
    const service = {
      export: vi.fn((request) => ({ ...request, status: "exported", keys: ["app_locale"] })),
      preview: vi.fn((request) => ({
        ...request,
        status: "ready",
        previewId: "settingspreview_0123456789abcdef0123456789abcdef",
        keys: ["app_locale"]
      })),
      hasCurrentPreview: vi.fn(() => true),
      apply: vi.fn((request) => ({ ...request, status: "committed", keys: ["app_locale"] }))
    } as unknown as SettingsProfileTransferService;
    let confirmationResponse = 1;
    registerSettingsProfileIpc({
      ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler as never); } },
      getWindow: () => ({}) as never,
      showSaveDialog: async () => ({ canceled: false, filePath: "/private/export.json" }),
      showOpenDialog: async () => ({ canceled: false, filePaths: ["/private/import.json"] }),
      showMessageBox: async () => ({ response: confirmationResponse }),
      getService: () => service
    });
    const event = { sender: {} };
    const exported = await handlers.get(SETTINGS_PROFILE_EXPORT_CHANNEL)!(event, {
      apiVersion: 1, requestId: "settingsprofilereq_aaaaaaaaaaaaaaaa"
    });
    expect(JSON.stringify(exported)).not.toContain("/private/export.json");
    expect((service.export as any)).toHaveBeenCalledWith(expect.anything(), "/private/export.json");
    const preview = await handlers.get(SETTINGS_PROFILE_IMPORT_PREVIEW_CHANNEL)!(event, {
      apiVersion: 1, requestId: "settingsprofilereq_bbbbbbbbbbbbbbbb"
    }) as { previewId: string };
    expect(JSON.stringify(preview)).not.toContain("/private/import.json");
    const denied = await handlers.get(SETTINGS_PROFILE_IMPORT_APPLY_CHANNEL)!(event, {
      apiVersion: 1,
      requestId: "settingsprofilereq_cccccccccccccccc",
      previewId: preview.previewId
    }) as { status: string };
    expect(denied.status).toBe("cancelled");
    expect(service.apply).not.toHaveBeenCalled();
    confirmationResponse = 0;
    const committed = await handlers.get(SETTINGS_PROFILE_IMPORT_APPLY_CHANNEL)!(event, {
      apiVersion: 1,
      requestId: "settingsprofilereq_dddddddddddddddd",
      previewId: preview.previewId
    }) as { status: string };
    expect(committed.status).toBe("committed");
    expect(service.apply).toHaveBeenCalledOnce();
  });

  it("fails closed without a trusted window", async () => {
    const handlers = new Map<string, (event: any, value: unknown) => Promise<unknown>>();
    const service = { hasCurrentPreview: vi.fn() } as unknown as SettingsProfileTransferService;
    registerSettingsProfileIpc({
      ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler as never); } },
      getWindow: () => undefined,
      showSaveDialog: vi.fn(),
      showOpenDialog: vi.fn(),
      showMessageBox: vi.fn(),
      getService: () => service
    });
    const result = await handlers.get(SETTINGS_PROFILE_EXPORT_CHANNEL)!({ sender: {} }, {
      apiVersion: 1, requestId: "settingsprofilereq_eeeeeeeeeeeeeeee"
    }) as { status: string };
    expect(result.status).toBe("failed");
  });
});
