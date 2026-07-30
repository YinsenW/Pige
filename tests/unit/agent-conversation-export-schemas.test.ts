import { describe, expect, it } from "vitest";
import {
  AgentConversationExportArtifactSchema,
  AgentConversationExportRequestSchema,
  AgentConversationExportResultSchema
} from "@pige/schemas";

const request = {
  apiVersion: 1,
  requestId: "conversation_export_request_abcdefghijklmnop",
  activeVaultId: "vault_20260731_export01",
  conversationId: "conv_20260731_export01",
  expectedTailEventId: "evt_20260731_assistant01"
} as const;

const artifact = {
  schemaVersion: 1,
  kind: "pige_conversation",
  conversationId: request.conversationId,
  tailEventId: request.expectedTailEventId,
  exportedAt: "2026-07-31T10:00:00.000Z",
  events: [
    {
      kind: "message",
      eventId: "evt_20260731_user0001",
      role: "user",
      createdAt: "2026-07-31T09:59:00.000Z",
      text: "Summarize this source.",
      citations: []
    },
    {
      kind: "source_reference",
      eventId: "evt_20260731_source001",
      eventType: "source_reference",
      createdAt: "2026-07-31T09:59:01.000Z",
      parentEventId: "evt_20260731_user0001",
      sourceId: "src_20260731_source001",
      displayName: "Quarterly report.pdf",
      sourceKind: "pdf_file"
    },
    {
      kind: "message",
      eventId: request.expectedTailEventId,
      role: "assistant",
      createdAt: "2026-07-31T10:00:00.000Z",
      text: "The report is grounded in one local page.",
      citations: [{
        kind: "page",
        refId: "citation_1",
        label: "[1]",
        pageId: "page_20260731_export01",
        title: "Quarterly report",
        pageType: "source"
      }]
    }
  ]
} as const;

describe("Agent conversation export schemas", () => {
  it("keeps requests and all pathless result variants strict", () => {
    expect(AgentConversationExportRequestSchema.parse(request)).toEqual(request);
    expect(() => AgentConversationExportRequestSchema.parse({ ...request, outputPath: "/private/export.json" }))
      .toThrow();

    for (const result of [
      { ...identity(), status: "exported", tailEventId: request.expectedTailEventId, eventCount: 3 },
      { ...identity(), status: "cancelled", tailEventId: request.expectedTailEventId },
      { ...identity(), status: "stale", currentTailEventId: "evt_20260731_newtail01" },
      { ...identity(), status: "not_found" },
      { ...identity(), status: "failed" }
    ] as const) {
      const parsed = AgentConversationExportResultSchema.parse(result);
      expect(JSON.stringify(parsed)).not.toMatch(/path|error|payload/iu);
    }
    expect(() => AgentConversationExportResultSchema.parse({
      ...identity(),
      status: "exported",
      tailEventId: request.expectedTailEventId,
      eventCount: 3,
      filePath: "/private/export.json"
    })).toThrow();
  });

  it("preserves ordered roles and safe citation/source identities without accepting private fields", () => {
    const parsed = AgentConversationExportArtifactSchema.parse(artifact);
    expect(parsed.events.map(({ eventId }) => eventId)).toEqual([
      "evt_20260731_user0001",
      "evt_20260731_source001",
      "evt_20260731_assistant01"
    ]);
    expect(parsed.events.filter(({ kind }) => kind === "message").map(({ role }) => role))
      .toEqual(["user", "assistant"]);
    expect(JSON.stringify(parsed)).not.toMatch(/locator|sourceBody|rawTool|modelPayload|path/iu);

    expect(() => AgentConversationExportArtifactSchema.parse({
      ...artifact,
      events: artifact.events.map((event, index) => index === 1
        ? { ...event, sourceBody: "private source body" }
        : event)
    })).toThrow();
    expect(() => AgentConversationExportArtifactSchema.parse({
      ...artifact,
      events: [...artifact.events, artifact.events[0]]
    })).toThrow();
    expect(() => AgentConversationExportArtifactSchema.parse({
      ...artifact,
      tailEventId: "evt_20260731_user0001"
    })).toThrow();
  });
});

function identity() {
  return {
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    conversationId: request.conversationId
  };
}
