import { describe, expect, it } from "vitest";
import {
  LibraryRenameTopicRequestSchema,
  LibraryRenameTopicResultSchema
} from "@pige/schemas";

const identity = {
  apiVersion: 1 as const,
  requestId: "library_topic_rename_request_20260731contract",
  activeVaultId: "vault_20260731_topicrename",
  pageId: "page_20260731_topicrename",
  expectedUpdatedAt: "2026-07-31T08:00:00.000Z",
  expectedRevision: `noteeditrev_${"a".repeat(64)}`,
  expectedTitle: "Old Topic",
  title: "New Topic"
};

describe("Library Topic rename contract", () => {
  it("binds the exact current Topic identity and rejects private fields", () => {
    expect(LibraryRenameTopicRequestSchema.parse(identity)).toEqual(identity);
    expect(() => LibraryRenameTopicRequestSchema.parse({ ...identity, title: identity.expectedTitle })).toThrow();
    expect(() => LibraryRenameTopicRequestSchema.parse({ ...identity, sourcePath: "/private/topic.md" })).toThrow();
  });

  it("projects only a bounded authoritative Topic render on commit", () => {
    const result = LibraryRenameTopicResultSchema.parse({
      ...identity,
      status: "committed",
      operationId: "op_20260731_0123456789abcdef",
      render: {
        summary: {
          pageId: identity.pageId,
          title: identity.title,
          pageType: "topic",
          status: "active",
          pagePath: "wiki/topics/old-topic.md",
          createdAt: "2026-07-31T07:00:00.000Z",
          updatedAt: "2026-07-31T09:00:00.000Z",
          language: "en",
          sourceIds: []
        },
        html: "<p>Topic</p>",
        byteSize: 120,
        renderContextId: "notectx_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        topicRenameEligibility: { canRename: true, revision: `noteeditrev_${"b".repeat(64)}` }
      }
    });
    expect(result.status).toBe("committed");
    expect(JSON.stringify(result)).not.toMatch(/absolutePath|sourceBody|checksum|beforeImagePath/u);
    expect(() => LibraryRenameTopicResultSchema.parse({ ...result, absolutePath: "/private/topic.md" })).toThrow();
  });
});
