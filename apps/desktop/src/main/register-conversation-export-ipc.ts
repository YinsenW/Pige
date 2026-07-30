import type { BrowserWindow, IpcMain, SaveDialogOptions, WebContents } from "electron";
import {
  AGENT_CONVERSATION_EXPORT_CHANNEL,
  AgentConversationExportRequestSchema,
  AgentConversationExportResultSchema,
  type AgentConversationExportRequest,
  type AgentConversationExportResult
} from "@pige/schemas";
import type { AgentConversationExportVaultBinding } from "./services/agent-conversation-export-service";

export interface RegisterConversationExportIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly getWindow: (sender: WebContents) => BrowserWindow | undefined;
  readonly showSaveDialog: (window: BrowserWindow, options: SaveDialogOptions) => Promise<{
    readonly canceled: boolean;
    readonly filePath?: string;
  }>;
  readonly getActiveVaultBinding: () => AgentConversationExportVaultBinding | undefined;
  readonly exportConversation: (
    binding: AgentConversationExportVaultBinding,
    request: AgentConversationExportRequest,
    destinationPath: string
  ) => AgentConversationExportResult;
}

export function registerConversationExportIpc(options: RegisterConversationExportIpcOptions): void {
  options.ipcMain.handle(AGENT_CONVERSATION_EXPORT_CHANNEL, async (event, request: unknown) => {
    const parsed = AgentConversationExportRequestSchema.parse(request);
    const initialBinding = options.getActiveVaultBinding();
    const window = options.getWindow(event.sender);
    if (!initialBinding || initialBinding.vaultId !== parsed.activeVaultId || !window) {
      return status(parsed, "failed");
    }
    let selection: { readonly canceled: boolean; readonly filePath?: string };
    try {
      selection = await options.showSaveDialog(window, {
        title: "Export Conversation",
        defaultPath: `pige-conversation-${parsed.conversationId.slice(5)}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }]
      });
    } catch {
      return status(parsed, "failed");
    }
    if (selection.canceled || !selection.filePath) return status(parsed, "cancelled");
    const currentBinding = options.getActiveVaultBinding();
    if (!sameBinding(initialBinding, currentBinding)) return status(parsed, "failed");
    try {
      const result = AgentConversationExportResultSchema.parse(
        options.exportConversation(initialBinding, parsed, selection.filePath)
      );
      assertIdentity(parsed, result);
      return sameBinding(initialBinding, options.getActiveVaultBinding()) ? result : status(parsed, "failed");
    } catch {
      return status(parsed, "failed");
    }
  });
}

function sameBinding(
  expected: AgentConversationExportVaultBinding,
  current: AgentConversationExportVaultBinding | undefined
): current is AgentConversationExportVaultBinding {
  return current?.vaultId === expected.vaultId && current.vaultPath === expected.vaultPath;
}

function assertIdentity(request: AgentConversationExportRequest, result: AgentConversationExportResult): void {
  if (result.apiVersion !== request.apiVersion || result.requestId !== request.requestId ||
      result.activeVaultId !== request.activeVaultId || result.conversationId !== request.conversationId) {
    throw new Error("Conversation export response identity did not match the request.");
  }
  if ((result.status === "exported" || result.status === "cancelled") &&
      result.tailEventId !== request.expectedTailEventId) {
    throw new Error("Conversation export tail identity did not match the request.");
  }
}

function status(
  request: AgentConversationExportRequest,
  value: "cancelled" | "failed"
): AgentConversationExportResult {
  return AgentConversationExportResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    conversationId: request.conversationId,
    status: value,
    ...(value === "cancelled" ? { tailEventId: request.expectedTailEventId } : {})
  });
}
