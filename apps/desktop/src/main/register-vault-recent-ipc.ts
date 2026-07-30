import type { BrowserWindow, IpcMain, WebContents } from "electron";
import type {
  RecentVaultForgetRequest,
  RecentVaultForgetResult,
  RecentVaultReconnectRequest,
  RecentVaultReconnectResult
} from "@pige/contracts";
import {
  RecentVaultForgetRequestSchema,
  RecentVaultForgetResultSchema,
  RecentVaultReconnectRequestSchema,
  RecentVaultReconnectResultSchema,
  VAULT_FORGET_RECENT_CHANNEL,
  VAULT_RECONNECT_RECENT_CHANNEL
} from "@pige/schemas";

interface RegisterVaultRecentIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly parentWindow: (sender: WebContents) => BrowserWindow | undefined;
  readonly forgetRecent: (request: RecentVaultForgetRequest) => RecentVaultForgetResult;
  readonly reconnectRecent: (
    parentWindow: BrowserWindow,
    request: RecentVaultReconnectRequest
  ) => Promise<RecentVaultReconnectResult>;
}

export function registerVaultRecentIpc(options: RegisterVaultRecentIpcOptions): void {
  options.ipcMain.handle(VAULT_FORGET_RECENT_CHANNEL, (_event, input: unknown) => {
    const request = RecentVaultForgetRequestSchema.parse(input);
    try {
      const result = RecentVaultForgetResultSchema.parse(options.forgetRecent(request));
      return sameIdentity(request, result) ? result : RecentVaultForgetResultSchema.parse({ ...request, status: "failed" });
    } catch {
      return RecentVaultForgetResultSchema.parse({ ...request, status: "failed" });
    }
  });
  options.ipcMain.handle(VAULT_RECONNECT_RECENT_CHANNEL, async (event, input: unknown) => {
    const request = RecentVaultReconnectRequestSchema.parse(input);
    const parentWindow = options.parentWindow(event.sender);
    if (!parentWindow) return RecentVaultReconnectResultSchema.parse({ ...request, status: "failed" });
    try {
      const result = RecentVaultReconnectResultSchema.parse(await options.reconnectRecent(parentWindow, request));
      return sameIdentity(request, result) ? result : RecentVaultReconnectResultSchema.parse({ ...request, status: "failed" });
    } catch {
      return RecentVaultReconnectResultSchema.parse({ ...request, status: "failed" });
    }
  });
}

function sameIdentity(
  request: RecentVaultForgetRequest | RecentVaultReconnectRequest,
  result: RecentVaultForgetResult | RecentVaultReconnectResult
): boolean {
  return result.apiVersion === request.apiVersion &&
    result.requestId === request.requestId &&
    result.vaultId === request.vaultId &&
    result.expectedRevision === request.expectedRevision;
}
