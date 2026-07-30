import type { IpcMain } from "electron";
import type { VaultRenameDisplayNameRequest, VaultRenameDisplayNameResult } from "@pige/contracts";
import {
  VAULT_RENAME_DISPLAY_NAME_CHANNEL,
  VaultRenameDisplayNameRequestSchema,
  VaultRenameDisplayNameResultSchema
} from "@pige/schemas";

interface RegisterVaultMetadataIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly renameDisplayName: (request: VaultRenameDisplayNameRequest) => VaultRenameDisplayNameResult;
}

export function registerVaultMetadataIpc(options: RegisterVaultMetadataIpcOptions): void {
  options.ipcMain.handle(VAULT_RENAME_DISPLAY_NAME_CHANNEL, (_event, request: unknown) => {
    const parsed = VaultRenameDisplayNameRequestSchema.parse(request);
    const result = VaultRenameDisplayNameResultSchema.parse(options.renameDisplayName(parsed));
    if (!sameIdentity(parsed, result)) {
      return VaultRenameDisplayNameResultSchema.parse({ ...parsed, status: "failed" });
    }
    return result;
  });
}

function sameIdentity(
  request: VaultRenameDisplayNameRequest,
  result: VaultRenameDisplayNameResult
): boolean {
  return result.apiVersion === request.apiVersion &&
    result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.expectedMetadataRevision === request.expectedMetadataRevision &&
    result.displayName === request.displayName &&
    (!("metadata" in result) || result.metadata.activeVaultId === request.activeVaultId);
}
