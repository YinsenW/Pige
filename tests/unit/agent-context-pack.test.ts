import { describe, expect, it } from "vitest";
import { JobRecordSchema } from "@pige/schemas";
import {
  AgentContextPackSchema,
  buildHomeAgentContextPack
} from "../../apps/desktop/src/main/services/agent-context-pack";

const POLICY_HASH = `sha256:${"a".repeat(64)}`;
const CONVERSATION_CONTEXT_HASH = `sha256:${"e".repeat(64)}`;

describe("Agent context pack", () => {
  it("serializes a mixed current-note, eight-attachment, memory and compacted-conversation pack without bodies", () => {
    const job = JobRecordSchema.parse({
      schemaVersion: 1,
      id: "job_20260802_contextpack01",
      class: "agent_turn",
      state: "running",
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:01.000Z",
      activeVaultId: "vault_20260802_contextpack01",
      conversationEventId: "evt_20260802_contextpack01",
      inputRefs: [
        {
          kind: "conversation",
          id: "evt_20260802_contextpack01",
          checksum: `sha256:${"b".repeat(64)}`,
          role: "agent_turn_user_event"
        },
        {
          kind: "page",
          id: "page_20260802_contextpack01",
          checksum: `sha256:${"c".repeat(64)}`,
          locator: "current_note",
          role: "agent_turn_current_note_scope"
        },
        ...Array.from({ length: 8 }, (_, index) => ({
          kind: "source" as const,
          id: `src_20260802_contextpack${String(index + 1).padStart(2, "0")}`,
          checksum: `sha256:${String(index + 1).repeat(64)}`,
          locator: `attachment_${index + 1}`,
          role: "agent_turn_source"
        })),
        {
          kind: "tool",
          id: "pige_agent_attachment_set",
          checksum: `sha256:${"d".repeat(64)}`,
          role: "agent_turn_attachment_set"
        }
      ],
      message: "Context pack fixture."
    });
    const memories = [{
      id: "memory_20260802_preference01",
      title: "PRIVATE MEMORY TITLE",
      body: "PRIVATE MEMORY BODY",
      updatedAt: "2026-08-02T00:00:00.000Z"
    }];
    const history = [{
      role: "assistant" as const,
      createdAt: "2026-08-01T00:00:00.000Z",
      text: "[Earlier conversation context compacted by Pige]\nOmitted 17 earlier user/assistant messages from 2026-08-01 through 2026-08-02.\nPRIVATE COMPACTED SUMMARY"
    }, {
      role: "user" as const,
      createdAt: "2026-08-02T00:00:00.000Z",
      text: "PRIVATE RECENT TURN"
    }];
    const contextSnapshot = {
      owner: "main.agent_context" as const,
      consumer: "pi_agent" as const,
      compacted: true,
      eventCount: 42,
      messageCount: 18,
      omittedMessageCount: 17,
      firstEventId: "evt_20260801_contextpackfirst1",
      lastEventId: "evt_20260802_contextpacklast01",
      contextHash: CONVERSATION_CONTEXT_HASH,
      referenceCounts: { Source: 2, Output: 1 }
    };

    const first = buildHomeAgentContextPack({
      activeVaultId: "vault_20260802_contextpack01",
      job,
      conversationId: "conv_20260802_contextpack01",
      userEventId: "evt_20260802_contextpack01",
      policyContextId: "policy_contextpack01",
      policyHash: POLICY_HASH,
      memories,
      history,
      contextSnapshot
    });
    const second = buildHomeAgentContextPack({
      activeVaultId: "vault_20260802_contextpack01",
      job,
      conversationId: "conv_20260802_contextpack01",
      userEventId: "evt_20260802_contextpack01",
      policyContextId: "policy_contextpack01",
      policyHash: POLICY_HASH,
      memories,
      history,
      contextSnapshot
    });

    expect(AgentContextPackSchema.parse(JSON.parse(JSON.stringify(first.pack)))).toEqual(first.pack);
    expect(second).toEqual(first);
    expect(first.pack).toMatchObject({
      workflow: "note_agent",
      budgetClass: "note_agent",
      retrievalScope: { kind: "current_note", pageId: "page_20260802_contextpack01" },
      omitted: [{ reason: "conversation_compacted", count: 17 }],
      warnings: [{ code: "attachment_citation_capacity", count: 2 }]
    });
    expect(first.pack.evidenceRefs).toHaveLength(9);
    expect(first.pack.evidenceRefs.slice(1, 7).map((ref) => ref.citationRefs[0]))
      .toEqual(["citation_11", "citation_12", "citation_13", "citation_14", "citation_15", "citation_16"]);
    expect(first.pack.evidenceRefs.slice(7).every((ref) => ref.citationRefs.length === 0)).toBe(true);
    expect(first.pack.memoryRefs).toEqual([
      expect.objectContaining({ id: "memory_20260802_preference01", trust: "memory" })
    ]);
    expect(first.pack.conversationRefs[0]).toMatchObject({ checksum: CONVERSATION_CONTEXT_HASH });
    expect(first.durableRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "tool", id: first.pack.contextPackId, role: "agent_context_pack" }),
      expect.objectContaining({ kind: "memory", id: "memory_20260802_preference01" }),
      expect.objectContaining({ kind: "conversation", id: "conv_20260802_contextpack01" })
    ]));
    const serialized = JSON.stringify(first);
    for (const body of ["PRIVATE MEMORY TITLE", "PRIVATE MEMORY BODY", "PRIVATE COMPACTED SUMMARY", "PRIVATE RECENT TURN"]) {
      expect(serialized).not.toContain(body);
    }
  });

  it("changes identity when a lower-authority memory or durable conversation snapshot changes", () => {
    const job = JobRecordSchema.parse({
      schemaVersion: 1,
      id: "job_20260802_contextpack02",
      class: "agent_turn",
      state: "running",
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:01.000Z",
      activeVaultId: "vault_20260802_contextpack02",
      conversationEventId: "evt_20260802_contextpack02",
      message: "Context pack fixture."
    });
    const build = (body: string, historyText: string) => buildHomeAgentContextPack({
      activeVaultId: "vault_20260802_contextpack02",
      job,
      conversationId: "conv_20260802_contextpack02",
      userEventId: "evt_20260802_contextpack02",
      policyContextId: "policy_contextpack02",
      policyHash: POLICY_HASH,
      memories: [{ id: "memory_20260802_preference02", title: "Preference", body, updatedAt: "2026-08-02T00:00:00.000Z" }],
      history: [{ role: "user", createdAt: "2026-08-02T00:00:00.000Z", text: historyText }]
    });

    const original = build("First body", "First turn");
    expect(build("Changed body", "First turn").pack.contextPackId).not.toBe(original.pack.contextPackId);
    expect(build("First body", "Changed turn").pack.contextPackId).not.toBe(original.pack.contextPackId);
  });
});
