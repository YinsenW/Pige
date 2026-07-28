import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentConversationHistory } from "../../apps/desktop/src/main/services/agent-conversation-history";
import { AgentTurnConversationStore } from "../../apps/desktop/src/main/services/agent-turn-conversation-store";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("AgentConversationHistory", () => {
  it("lists bounded safe summaries in deterministic order and fences opaque cursors", () => {
    const vaultPath = createVaultRoot();
    const conversations = new AgentTurnConversationStore();
    const first = conversations.appendUserTurn(
      vaultPath,
      "First\nconversation\u202e",
      { inputKind: "typed_text", locale: "en" },
      { clientTurnId: "turn_20260729_historyfirst0001" }
    );
    conversations.appendAssistantTurn(vaultPath, first, "job_20260729_historyfirst0001", "First answer");
    const second = conversations.appendUserTurn(
      vaultPath,
      "Second conversation",
      {
        inputKind: "follow_up",
        locale: "en",
        scope: { kind: "current_note", pageId: "page_20260729_historynote01" }
      },
      { clientTurnId: "turn_20260729_historysecond001" }
    );
    conversations.appendAssistantTurn(vaultPath, second, "job_20260729_historysecond001", "Second answer");

    const history = new AgentConversationHistory(2);
    const firstPage = history.list({
      activeVaultId: "vault_20260729_history01",
      vaultPath,
      limit: 1
    });
    expect(firstPage.conversations).toHaveLength(1);
    expect(firstPage.currentConversationId).toBe(firstPage.conversations[0]?.conversationId);
    expect(firstPage.conversations[0]).toMatchObject({
      safePreview: "Second conversation",
      latestUserEventId: second.event.id,
      scope: { kind: "current_note", pageId: "page_20260729_historynote01" }
    });
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toMatch(/^conversation_history_[a-f0-9]{64}$/u);

    const secondPage = history.list({
      activeVaultId: "vault_20260729_history01",
      vaultPath,
      limit: 1,
      cursor: firstPage.nextCursor
    });
    expect(secondPage.conversations[0]).toMatchObject({
      safePreview: "First conversation",
      latestUserEventId: first.event.id
    });
    expect(secondPage.hasMore).toBe(false);
    expect(() => history.list({
      activeVaultId: "vault_20260729_other001",
      vaultPath,
      limit: 1,
      cursor: firstPage.nextCursor
    })).toThrowError(expect.objectContaining({ code: "agent_runtime.turn_binding_invalid" }));

    const third = conversations.appendUserTurn(
      vaultPath,
      "New durable conversation",
      { inputKind: "typed_text", locale: "en" },
      { clientTurnId: "turn_20260729_historythird0001" }
    );
    conversations.appendAssistantTurn(vaultPath, third, "job_20260729_historythird0001", "Third answer");
    expect(() => history.list({
      activeVaultId: "vault_20260729_history01",
      vaultPath,
      limit: 1,
      cursor: firstPage.nextCursor
    })).toThrowError(expect.objectContaining({ code: "agent_runtime.turn_binding_invalid" }));
  });

  it("fails closed for a symlinked discovery component", () => {
    const vaultPath = createVaultRoot();
    const outside = createVaultRoot();
    fs.mkdirSync(path.join(vaultPath, ".pige", "conversations"), { recursive: true });
    fs.symlinkSync(outside, path.join(vaultPath, ".pige", "conversations", "2026"));

    expect(() => new AgentConversationHistory().list({
      activeVaultId: "vault_20260729_history01",
      vaultPath
    })).toThrowError(expect.objectContaining({ code: "agent_runtime.turn_unavailable" }));
  });

  it("does not follow a symlinked private metadata parent", () => {
    const vaultPath = createVaultRoot();
    const outside = createVaultRoot();
    fs.mkdirSync(path.join(outside, "conversations"), { recursive: true });
    fs.symlinkSync(outside, path.join(vaultPath, ".pige"));

    expect(() => new AgentConversationHistory().list({
      activeVaultId: "vault_20260729_history01",
      vaultPath
    })).toThrowError(expect.objectContaining({ code: "agent_runtime.turn_unavailable" }));
  });
});

function createVaultRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-conversation-history-"));
  tempRoots.push(root);
  return root;
}
