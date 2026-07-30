import type { IpcMain } from "electron";
import {
  AgentConversationSetTitleRequestSchema,
  AgentConversationSetTitleResultSchema,
  type AgentConversationHistorySummary,
  type AgentConversationSetTitleRequest,
  type AgentConversationSetTitleResult
} from "@pige/schemas";
import type { AgentConversationHistory } from "./services/agent-conversation-history";

interface RegisterConversationHistoryIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly getActiveVault: () => { readonly vaultId: string; readonly vaultPath: string } | undefined;
  readonly assertWriterLease: (vaultPath: string) => void;
  readonly history: AgentConversationHistory;
}

type ConversationTitleResultPayload =
  | { readonly status: "committed" | "stale"; readonly summary: AgentConversationHistorySummary & {
      readonly titleRevision: number;
    } }
  | { readonly status: "not_found" | "failed" };

export function registerConversationHistoryIpc(options: RegisterConversationHistoryIpcOptions): void {
  options.ipcMain.handle("agent.setConversationTitle", (_event, input: unknown) => {
    const request = AgentConversationSetTitleRequestSchema.parse(input);
    const active = options.getActiveVault();
    if (!active || active.vaultId !== request.activeVaultId) return failed(request);
    try {
      options.assertWriterLease(active.vaultPath);
      const result = options.history.setTitle({ vaultPath: active.vaultPath, request });
      const current = options.getActiveVault();
      if (!current || current.vaultId !== active.vaultId || current.vaultPath !== active.vaultPath) return failed(request);
      options.assertWriterLease(active.vaultPath);
      if (result.status === "not_found") return parseResult(request, { status: "not_found" });
      const { latestUserEventId: _privateEventId, ...summary } = result.summary;
      return parseResult(request, { status: result.status, summary });
    } catch {
      return failed(request);
    }
  });
}

function parseResult(
  request: AgentConversationSetTitleRequest,
  result: ConversationTitleResultPayload
): AgentConversationSetTitleResult {
  return AgentConversationSetTitleResultSchema.parse({
    apiVersion: 1,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    conversationId: request.conversationId,
    ...result
  });
}

function failed(request: AgentConversationSetTitleRequest): AgentConversationSetTitleResult {
  return parseResult(request, { status: "failed" });
}
