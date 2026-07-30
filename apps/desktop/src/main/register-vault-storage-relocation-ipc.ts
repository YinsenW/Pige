import type { BrowserWindow, IpcMain, WebContents } from "electron";
import type {
  VaultStorageRelocationRequest,
  VaultStorageRelocationResult,
  VaultStorageRelocationStatus
} from "@pige/contracts";
import {
  VAULT_STORAGE_RELOCATE_CHANNEL,
  VAULT_STORAGE_RELOCATION_STATUS_CHANNEL,
  VaultStorageRelocationRequestSchema,
  VaultStorageRelocationResultSchema,
  VaultStorageRelocationStatusSchema
} from "@pige/schemas";

interface RegisterVaultStorageRelocationIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly parentWindow: (sender: WebContents) => BrowserWindow | undefined;
  readonly status: () => VaultStorageRelocationStatus;
  readonly relocate: (
    parentWindow: BrowserWindow,
    request: VaultStorageRelocationRequest
  ) => Promise<VaultStorageRelocationResult>;
}

export function registerVaultStorageRelocationIpc(
  options: RegisterVaultStorageRelocationIpcOptions
): void {
  options.ipcMain.handle(VAULT_STORAGE_RELOCATION_STATUS_CHANNEL, () =>
    VaultStorageRelocationStatusSchema.parse(options.status()));
  options.ipcMain.handle(VAULT_STORAGE_RELOCATE_CHANNEL, async (event, input: unknown) => {
    const request = VaultStorageRelocationRequestSchema.parse(input);
    const parentWindow = options.parentWindow(event.sender);
    if (!parentWindow) return VaultStorageRelocationResultSchema.parse({ ...request, status: "failed" });
    try {
      const result = VaultStorageRelocationResultSchema.parse(await options.relocate(parentWindow, request));
      return sameIdentity(request, result)
        ? result
        : VaultStorageRelocationResultSchema.parse({ ...request, status: "failed" });
    } catch {
      return VaultStorageRelocationResultSchema.parse({ ...request, status: "failed" });
    }
  });
}

function sameIdentity(
  request: VaultStorageRelocationRequest,
  result: VaultStorageRelocationResult
): boolean {
  return result.apiVersion === request.apiVersion &&
    result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.expectedRevision === request.expectedRevision;
}
