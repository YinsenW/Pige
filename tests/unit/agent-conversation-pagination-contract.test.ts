import { describe, expect, it } from "vitest";
import {
  AgentConversationEarlierPageSchema,
  AgentConversationRequestSchema,
  AgentConversationResultSchema
} from "@pige/schemas";

const conversationId = "conv_20260726_pagination01";
const snapshotTailEventId = "evt_20260726_pagetail01";
const cursor = "timeline_0123456789abcdef0123456789abcdef";

describe("Agent conversation pagination contracts", () => {
  it("accepts legacy-compatible initial reads and strictly bound earlier-page reads", () => {
    expect(AgentConversationRequestSchema.parse({ limit: 100 })).toEqual({ limit: 100 });
    expect(AgentConversationRequestSchema.parse({
      conversationId,
      snapshotTailEventId,
      earlierCursor: cursor,
      limit: 24,
      scope: { kind: "current_note", pageId: "page_20260726_pagination01" }
    })).toMatchObject({ conversationId, snapshotTailEventId, earlierCursor: cursor });
    expect(() => AgentConversationRequestSchema.parse({
      conversationId,
      earlierCursor: cursor
    })).toThrow();
    expect(() => AgentConversationRequestSchema.parse({
      conversationId,
      snapshotTailEventId,
      earlierCursor: `${cursor}extra`
    })).toThrow();
  });

  it("keeps older pages body-safe and structurally unable to claim tail authority", () => {
    const page = AgentConversationEarlierPageSchema.parse({
      kind: "earlier",
      conversationId,
      snapshotTailEventId,
      messages: [{
        id: "evt_20260726_pagemessage1",
        role: "user",
        createdAt: "2026-07-26T12:00:00.000Z",
        text: "Exact renderer-safe durable message."
      }],
      hasEarlier: true,
      nextEarlierCursor: cursor
    });

    expect(page).not.toHaveProperty("tailEventId");
    expect(page).not.toHaveProperty("canFollowUp");
    expect(page).not.toHaveProperty("latestTurn");
    expect(() => AgentConversationEarlierPageSchema.parse({ ...page, canFollowUp: true })).toThrow();
    expect(() => AgentConversationEarlierPageSchema.parse({ ...page, hasEarlier: false })).toThrow();
    expect(() => AgentConversationEarlierPageSchema.parse({
      ...page,
      messages: [page.messages[0], page.messages[0]]
    })).toThrow();
    expect(AgentConversationResultSchema.parse(page)).toEqual(page);
  });
});
