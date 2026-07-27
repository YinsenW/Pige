import { describe, expect, it } from "vitest";
import { KNOWLEDGE_HEALTH_MAX_RESULT_UTF8_BYTES } from "@pige/schemas";
import { KnowledgeHealthService } from
  "../../apps/desktop/src/main/services/knowledge-health-service";

const request = {
  apiVersion: 1,
  requestId: "knowledge_health_request_abcdefghijklmnop",
  activeVaultId: "vault_20260727_healthtest"
} as const;

describe("KnowledgeHealthService", () => {
  it("projects complete and partial derived reports without persistence", () => {
    const service = new KnowledgeHealthService({
      knowledgeHealth: () => ({
        indexGeneration: "2026-07-27T12:00:00.000Z#abcdefghijklmnop",
        invalidPageCount: 1,
        counts: {
          totalIssueCount: 1,
          brokenLinkPageCount: 1,
          unresolvedLinkCount: 2,
          orphanPageCount: 0,
          duplicateTopicGroupCount: 0,
          unsourcedClaimCount: 0
        },
        issues: [{
          kind: "broken_link",
          page: { pageId: "page_20260727_healthaa", title: "Health" },
          unresolvedLinkCount: 2
        }],
        truncated: false
      })
    }, () => "2026-07-27T12:30:00.000Z");

    expect(service.run("/private/vault", request)).toEqual({
      ...request,
      status: "ready",
      checkedAt: "2026-07-27T12:30:00.000Z",
      indexGeneration: "2026-07-27T12:00:00.000Z#abcdefghijklmnop",
      coverage: "partial",
      invalidPageCount: 1,
      counts: {
        totalIssueCount: 1,
        brokenLinkPageCount: 1,
        unresolvedLinkCount: 2,
        orphanPageCount: 0,
        duplicateTopicGroupCount: 0,
        unsourcedClaimCount: 0
      },
      issues: [{
        kind: "broken_link",
        page: { pageId: "page_20260727_healthaa", title: "Health" },
        unresolvedLinkCount: 2
      }],
      truncated: false
    });
  });

  it("returns body-free unavailable and failed results", () => {
    expect(new KnowledgeHealthService({ knowledgeHealth: () => undefined })
      .run("/private/vault", request)).toEqual({ ...request, status: "unavailable" });
    expect(new KnowledgeHealthService({ knowledgeHealth: () => { throw new Error("/private/body"); } })
      .run("/private/vault", request)).toEqual({ ...request, status: "failed" });
  });

  it("trims projected issues to the strict UTF-8 result bound", () => {
    const issues = Array.from({ length: 100 }, (_, group) => {
      const pages = Array.from({ length: 8 }, (_, page) => {
        const suffix = (group * 8 + page).toString(36).padStart(8, "0");
        return { pageId: `page_20260727_${suffix}`, title: "x".repeat(512) };
      });
      return { kind: "duplicate_topic" as const, candidatePageCount: 8, pages };
    });
    const service = new KnowledgeHealthService({
      knowledgeHealth: () => ({
        indexGeneration: "2026-07-27T12:00:00.000Z#abcdefghijklmnop",
        invalidPageCount: 0,
        counts: {
          totalIssueCount: 100,
          brokenLinkPageCount: 0,
          unresolvedLinkCount: 0,
          orphanPageCount: 0,
          duplicateTopicGroupCount: 100,
          unsourcedClaimCount: 0
        },
        issues,
        truncated: false
      })
    }, () => "2026-07-27T12:30:00.000Z");

    const result = service.run("/private/vault", request);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected a ready report.");
    expect(result.truncated).toBe(true);
    expect(result.issues.length).toBeLessThan(100);
    expect(Buffer.byteLength(JSON.stringify(result), "utf8"))
      .toBeLessThanOrEqual(KNOWLEDGE_HEALTH_MAX_RESULT_UTF8_BYTES);
  });
});
