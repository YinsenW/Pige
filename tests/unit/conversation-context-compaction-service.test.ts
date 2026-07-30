import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import type { ConversationEvent } from "@pige/schemas";
import {
  MAX_CONVERSATION_CONTEXT_MESSAGES,
  MAX_CONVERSATION_CONTEXT_TEXT_BYTES,
  selectCompactedConversationContext
} from "../../apps/desktop/src/main/services/conversation-context-compaction-service";

describe("conversation context compaction", () => {
  it("keeps recent bodies and all omitted durable refs without mutating the transcript", () => {
    const events = makeEvents();
    const before = JSON.stringify(events);
    const context = selectCompactedConversationContext(events);
    expect(JSON.stringify(events)).toBe(before);
    expect(context).toHaveLength(MAX_CONVERSATION_CONTEXT_MESSAGES);
    expect(context.reduce((sum, message) => sum + Buffer.byteLength(message.text), 0))
      .toBeLessThanOrEqual(MAX_CONVERSATION_CONTEXT_TEXT_BYTES);
    expect(context[0]).toMatchObject({ role: "assistant" });
    expect(context[0]!.text).toContain("Earlier conversation context compacted by Pige");
    expect(context[0]!.text).toContain("evt_20260731_message0001");
    expect(context[0]!.text).toContain("citation_11");
    expect(context[0]!.text).toContain("src_20260731_compaction01");
    expect(context[0]!.text).toContain("page_20260731_compaction01");
    expect(context[0]!.text).toContain("job_20260731_compaction01");
    expect(context[0]!.text).toContain("proposal_20260731_compaction01");
    expect(context[0]!.text).toContain("op_20260731_compaction01");
    expect(context[0]!.text).toContain("capture_20260731_compaction01");
    expect(context[0]!.text).not.toContain("private early body");
    expect(context.at(-1)!.text).toBe("Recent body 17");
  });

  it("binds omitted-body drift into the deterministic digest and leaves short history exact", () => {
    const events = makeEvents();
    const first = selectCompactedConversationContext(events);
    const changed = events.map((event, index) => index === 0 ? { ...event, text: "changed private body" } : event);
    const second = selectCompactedConversationContext(changed);
    expect(first[0]!.text).not.toBe(second[0]!.text);
    const short = events.slice(-4);
    expect(selectCompactedConversationContext(short)).toEqual(short.map((event) => ({
      role: event.type === "user_message" ? "user" : "assistant",
      createdAt: event.createdAt,
      text: event.text
    })));
  });
});

function makeEvents(): ConversationEvent[] {
  const messages = Array.from({ length: 18 }, (_, index) => ({
    schemaVersion: 1 as const,
    id: `evt_20260731_message${String(index).padStart(4, "0")}`,
    conversationId: "conv_20260731_compaction",
    type: index % 2 === 0 ? "user_message" as const : "assistant_message" as const,
    createdAt: `2026-07-31T12:00:${String(index).padStart(2, "0")}.000Z`,
    text: index === 0 ? "private early body" : `Recent body ${index}`,
    ...(index === 1 ? {
      jobId: "job_20260731_compaction01",
      proposalId: "proposal_20260731_compaction01",
      answerCitations: [{ refId: "citation_11", label: "[11]", pageId: "page_20260731_compaction01",
        title: "Compaction source", pageType: "source" as const, locator: "source" }]
    } : {}),
    ...(index === 0 ? { sourceId: "src_20260731_compaction01" } : {})
  })) as ConversationEvent[];
  messages.splice(2, 0, {
    schemaVersion: 1, id: "evt_20260731_operationref1", conversationId: "conv_20260731_compaction",
    type: "operation_reference", createdAt: "2026-07-31T12:00:01.500Z",
    parentEventId: "evt_20260731_message0001", operationId: "op_20260731_compaction01"
  } as ConversationEvent);
  messages.splice(3, 0, {
    schemaVersion: 1, id: "evt_20260731_captureref01", conversationId: "conv_20260731_compaction",
    type: "capture_reference", createdAt: "2026-07-31T12:00:01.750Z",
    captureId: "capture_20260731_compaction01"
  } as ConversationEvent);
  return messages;
}
