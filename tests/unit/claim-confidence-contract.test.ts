import { describe, expect, it } from "vitest";
import {
  NOTE_SET_CLAIM_CONFIDENCE_CHANNEL,
  NoteRenderResultSchema,
  NoteSetClaimConfidenceRequestSchema,
  NoteSetClaimConfidenceResultSchema
} from "@pige/schemas";

const request = {
  apiVersion: 1 as const,
  requestId: "noteclaimconfreq_abcdefghijklmnop",
  activeVaultId: "vault_20260801_claim01",
  currentPageId: "page_20260801_claim0001",
  renderContextId: "notectx_0123456789abcdef0123456789abcdef",
  expectedRevision: `noteeditrev_${"a".repeat(64)}`,
  confidence: "high" as const
};

describe("Claim confidence contract", () => {
  it("freezes one pathless exact-current mutation channel", () => {
    expect(NOTE_SET_CLAIM_CONFIDENCE_CHANNEL).toBe("notes.setClaimConfidence");
    expect(NoteSetClaimConfidenceRequestSchema.parse(request)).toEqual(request);
    expect(() => NoteSetClaimConfidenceRequestSchema.parse({ ...request, confidence: "certain" })).toThrow();
    expect(() => NoteSetClaimConfidenceRequestSchema.parse({ ...request, path: "/private/claim.md" })).toThrow();
  });

  it("returns only a closed result or an authoritative safe Claim render", () => {
    expect(NoteSetClaimConfidenceResultSchema.parse({ ...request, status: "stale" }))
      .toEqual({ ...request, status: "stale" });
    const render = NoteRenderResultSchema.parse({
      summary: { pageId: request.currentPageId, title: "Claim", pageType: "claim", status: "active",
        pagePath: "claims/claim.md", createdAt: "2026-08-01T10:00:00.000Z",
        updatedAt: "2026-08-01T11:00:00.000Z", sourceIds: [] },
      html: "<h1>Claim</h1>", byteSize: 64,
      renderContextId: "notectx_fedcba9876543210fedcba9876543210",
      claimConfidence: { confidence: "high", canChange: true, revision: `noteeditrev_${"b".repeat(64)}` }
    });
    expect(NoteSetClaimConfidenceResultSchema.parse({
      ...request, status: "committed", operationId: "op_20260801_claimconfidence1", render
    })).toMatchObject({ status: "committed", render: { claimConfidence: { confidence: "high" } } });
  });
});
