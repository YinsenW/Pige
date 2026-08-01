import { createHash } from "node:crypto";
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

  it("reads only the exact durable assistant event from its bound conversation", () => {
    const vaultPath = createVaultRoot();
    const conversations = new AgentTurnConversationStore();
    const turn = conversations.appendUserTurn(
      vaultPath,
      "Compare this Dataset",
      { inputKind: "typed_text", locale: "en" },
      { clientTurnId: "turn_20260729_citationlookup001" }
    );
    const assistant = conversations.appendAssistantTurn(
      vaultPath,
      turn,
      "job_20260729_citationlookup001",
      "The cited rows match."
    );
    const history = new AgentConversationHistory();
    expect(turn.event.conversationId).toBe("conv_20260729_citationlookup001");
    expect(assistant.id).toMatch(/^evt_20260729_[a-z0-9]{8,}$/u);
    expect(fs.existsSync(path.join(
      vaultPath,
      ".pige/conversations/2026/07",
      `${turn.event.conversationId}.jsonl`
    ))).toBe(true);

    expect(history.readAssistantEvent({
      vaultPath,
      conversationId: turn.event.conversationId,
      assistantEventId: assistant.id
    })).toMatchObject({ id: assistant.id, conversationId: turn.event.conversationId, type: "assistant_message" });
    expect(history.readAssistantEvent({
      vaultPath,
      conversationId: turn.event.conversationId,
      assistantEventId: turn.event.id
    })).toBeUndefined();
    expect(() => history.readAssistantEvent({
      vaultPath,
      conversationId: "conv_20260729_wrongconversation",
      assistantEventId: assistant.id
    })).not.toThrow();
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

  it("sets, clears, and reloads a durable title without changing the append-only conversation", () => {
    const vaultPath = createVaultRoot();
    const conversations = new AgentTurnConversationStore();
    const turn = conversations.appendUserTurn(
      vaultPath,
      "Original body that must stay only in JSONL",
      { inputKind: "typed_text", locale: "en" },
      { clientTurnId: "turn_20260731_renamepersist001" }
    );
    const assistant = conversations.appendAssistantTurn(
      vaultPath,
      turn,
      "job_20260731_renamepersist001",
      "Assistant body and tool payload stay in JSONL"
    );
    const jsonlPath = path.join(vaultPath, ".pige/conversations/2026/07", `${turn.event.conversationId}.jsonl`);
    const before = fs.readFileSync(jsonlPath);
    const beforeHash = createHash("sha256").update(before).digest("hex");
    const initial = new AgentConversationHistory().list({
      activeVaultId: "vault_20260731_rename01",
      vaultPath
    }).conversations[0]!;
    const request = {
      apiVersion: 1 as const,
      requestId: "conversation_title_request_renamepersist001",
      activeVaultId: "vault_20260731_rename01",
      conversationId: turn.event.conversationId,
      expectedTailEventId: assistant.id,
      expectedTitleRevision: 0,
      title: "Research plan"
    };

    const owner = new AgentConversationHistory(128, () => new Date("2026-07-31T01:02:03.000Z"));
    expect(owner.setTitle({ vaultPath, request })).toMatchObject({
      status: "committed",
      summary: { ...initial, title: "Research plan", titleRevision: 1 }
    });
    expect(owner.setTitle({ vaultPath, request })).toMatchObject({
      status: "committed",
      summary: { title: "Research plan", titleRevision: 1 }
    });
    expect(new AgentConversationHistory().list({
      activeVaultId: "vault_20260731_rename01",
      vaultPath
    }).conversations[0]).toMatchObject({ title: "Research plan", titleRevision: 1 });

    const metadataPath = path.join(vaultPath, ".pige/conversations/conversations-manifest.json");
    const metadata = fs.readFileSync(metadataPath, "utf8");
    expect(metadata).toContain('"title": "Research plan"');
    for (const privateValue of [
      "Original body", "Assistant body", vaultPath, "provider", "model", "tool", "secret"
    ]) expect(metadata).not.toContain(privateValue);
    expect(createHash("sha256").update(fs.readFileSync(jsonlPath)).digest("hex")).toBe(beforeHash);

    expect(owner.setTitle({
      vaultPath,
      request: {
        ...request,
        requestId: "conversation_title_request_clearpersist0001",
        expectedTitleRevision: 1,
        title: null
      }
    })).toMatchObject({ status: "committed", summary: { titleRevision: 2 } });
    const restarted = new AgentConversationHistory().list({
      activeVaultId: "vault_20260731_rename01",
      vaultPath
    }).conversations[0]!;
    expect(restarted.title).toBeUndefined();
    expect(restarted.titleRevision).toBe(2);
    expect(createHash("sha256").update(fs.readFileSync(jsonlPath)).digest("hex")).toBe(beforeHash);
  });

  it("returns the authoritative summary when the tail or title revision is stale", () => {
    const vaultPath = createVaultRoot();
    const conversations = new AgentTurnConversationStore();
    const turn = conversations.appendUserTurn(
      vaultPath,
      "Initial turn",
      { inputKind: "typed_text", locale: "en" },
      { clientTurnId: "turn_20260731_renamestale0001" }
    );
    const firstAssistant = conversations.appendAssistantTurn(
      vaultPath, turn, "job_20260731_renamestale0001", "Initial answer"
    );
    const owner = new AgentConversationHistory();
    expect(owner.setTitle({
      vaultPath,
      request: {
        apiVersion: 1,
        requestId: "conversation_title_request_firststale000100",
        activeVaultId: "vault_20260731_rename01",
        conversationId: turn.event.conversationId,
        expectedTailEventId: firstAssistant.id,
        expectedTitleRevision: 0,
        title: "First title"
      }
    }).status).toBe("committed");

    const nextTurn = conversations.appendUserTurn(
      vaultPath,
      "A later turn",
      { inputKind: "follow_up", locale: "en" },
      {
        clientTurnId: "turn_20260731_renamestale0002",
        conversationId: turn.event.conversationId,
        expectedTailEventId: firstAssistant.id
      }
    );
    const stale = owner.setTitle({
      vaultPath,
      request: {
        apiVersion: 1,
        requestId: "conversation_title_request_secondstale00100",
        activeVaultId: "vault_20260731_rename01",
        conversationId: turn.event.conversationId,
        expectedTailEventId: firstAssistant.id,
        expectedTitleRevision: 0,
        title: "Draft title"
      }
    });
    expect(stale).toMatchObject({
      status: "stale",
      summary: { title: "First title", titleRevision: 1, tailEventId: nextTurn.event.id }
    });
  });

  it("rejects secret-like titles before writing metadata", () => {
    const vaultPath = createVaultRoot();
    const turn = new AgentTurnConversationStore().appendUserTurn(
      vaultPath,
      "Keep this local",
      { inputKind: "typed_text", locale: "en" },
      { clientTurnId: "turn_20260731_renamesecret001" }
    );
    expect(() => new AgentConversationHistory().setTitle({
      vaultPath,
      request: {
        apiVersion: 1,
        requestId: "conversation_title_request_secretblocked010",
        activeVaultId: "vault_20260731_rename01",
        conversationId: turn.event.conversationId,
        expectedTailEventId: turn.event.id,
        expectedTitleRevision: 0,
        title: "sk-abcdefghijklmnop"
      }
    })).toThrowError(expect.objectContaining({ code: "agent_runtime.turn_unavailable" }));
    expect(fs.existsSync(path.join(vaultPath, ".pige/conversations/conversations-manifest.json"))).toBe(false);
  });

  it("searches every durable message with one bounded match projection and exact snapshot/query cursor fences", () => {
    const vaultPath = createVaultRoot();
    const conversations = new AgentTurnConversationStore();
    const titled = conversations.appendUserTurn(
      vaultPath,
      "Budget notes",
      { inputKind: "typed_text", locale: "en" },
      { clientTurnId: "turn_20260731_searchtitle0001" }
    );
    const transcriptMatch = conversations.appendAssistantTurn(
      vaultPath,
      titled,
      "job_20260731_searchtitle0001",
      "Hidden transcript phrase is now discoverable without exposing the whole conversation"
    );
    const preview = conversations.appendUserTurn(
      vaultPath,
      "Project follow-up",
      { inputKind: "typed_text", locale: "en" },
      { clientTurnId: "turn_20260731_searchpreview001" }
    );
    const unrelated = conversations.appendUserTurn(
      vaultPath,
      "Unrelated conversation",
      { inputKind: "typed_text", locale: "en" },
      { clientTurnId: "turn_20260731_searchother0001" }
    );
    const owner = new AgentConversationHistory();
    const full = owner.list({ activeVaultId: "vault_20260731_search01", vaultPath });
    expect(full.conversations.every((conversation) => conversation.searchMatch === undefined)).toBe(true);
    const titledSummary = full.conversations.find((item) => item.conversationId === titled.event.conversationId)!;
    const unrelatedSummary = full.conversations.find((item) => item.conversationId === unrelated.event.conversationId)!;
    const titledPath = path.join(vaultPath, ".pige/conversations/2026/07", `${titled.event.conversationId}.jsonl`);
    const titledHash = createHash("sha256").update(fs.readFileSync(titledPath)).digest("hex");
    expect(owner.setTitle({
      vaultPath,
      request: {
        apiVersion: 1,
        requestId: "conversation_title_request_searchtitle00010",
        activeVaultId: "vault_20260731_search01",
        conversationId: titled.event.conversationId,
        expectedTailEventId: titledSummary.tailEventId,
        expectedTitleRevision: 0,
        title: "Launch Project"
      }
    }).status).toBe("committed");

    const firstPage = owner.list({
      activeVaultId: "vault_20260731_search01",
      vaultPath,
      query: "project",
      limit: 1
    });
    expect(firstPage.currentConversationId).toBe(full.currentConversationId);
    expect(firstPage.conversations).toHaveLength(1);
    expect(firstPage.hasMore).toBe(true);
    const secondPage = owner.list({
      activeVaultId: "vault_20260731_search01",
      vaultPath,
      query: "project",
      limit: 1,
      cursor: firstPage.nextCursor
    });
    expect([
      firstPage.conversations[0]?.conversationId,
      secondPage.conversations[0]?.conversationId
    ].sort()).toEqual([titled.event.conversationId, preview.event.conversationId].sort());
    expect(() => owner.list({
      activeVaultId: "vault_20260731_search01",
      vaultPath,
      query: "other",
      cursor: firstPage.nextCursor
    })).toThrowError(expect.objectContaining({ code: "agent_runtime.turn_binding_invalid" }));

    expect(new AgentConversationHistory().list({
      activeVaultId: "vault_20260731_search01",
      vaultPath,
      query: "LAUNCH   PROJECT"
    }).conversations).toEqual([
      expect.objectContaining({ conversationId: titled.event.conversationId, title: "Launch Project" })
    ]);
    expect(new AgentConversationHistory().list({
      activeVaultId: "vault_20260731_search01",
      vaultPath,
      query: "missing"
    })).toMatchObject({ currentConversationId: full.currentConversationId, conversations: [], hasMore: false });
    expect(new AgentConversationHistory().list({
      activeVaultId: "vault_20260731_search01",
      vaultPath,
      query: "transcript phrase"
    }).conversations).toEqual([
      expect.objectContaining({
        conversationId: titled.event.conversationId,
        searchMatch: {
          eventId: transcriptMatch.id,
          role: "assistant",
          createdAt: transcriptMatch.createdAt,
          safeExcerpt: "Hidden transcript phrase is now discoverable without exposing the whole conversation"
        }
      })
    ]);
    expect(createHash("sha256").update(fs.readFileSync(titledPath)).digest("hex")).toBe(titledHash);

    expect(owner.setTitle({
      vaultPath,
      request: {
        apiVersion: 1,
        requestId: "conversation_title_request_searchother00010",
        activeVaultId: "vault_20260731_search01",
        conversationId: unrelated.event.conversationId,
        expectedTailEventId: unrelatedSummary.tailEventId,
        expectedTitleRevision: 0,
        title: "Another title"
      }
    }).status).toBe("committed");
    expect(() => owner.list({
      activeVaultId: "vault_20260731_search01",
      vaultPath,
      query: "project",
      cursor: firstPage.nextCursor
    })).toThrowError(expect.objectContaining({ code: "agent_runtime.turn_binding_invalid" }));
  });
});

function createVaultRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-conversation-history-"));
  tempRoots.push(root);
  return root;
}
