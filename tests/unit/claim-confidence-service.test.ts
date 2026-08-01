import { describe, expect, it, vi } from "vitest";
import {
  ClaimConfidenceService,
  readClaimConfidence,
  updateClaimConfidenceMarkdown
} from "../../apps/desktop/src/main/services/claim-confidence-service";

const request = {
  apiVersion: 1 as const,
  requestId: "noteclaimconfreq_abcdefghijklmnop",
  activeVaultId: "vault_20260801_claim01",
  currentPageId: "page_20260801_claim0001",
  renderContextId: "notectx_0123456789abcdef0123456789abcdef",
  expectedRevision: `noteeditrev_${"a".repeat(64)}`,
  confidence: "high" as const
};

describe("ClaimConfidenceService", () => {
  it("changes only the exact current Claim confidence and returns the authoritative render", async () => {
    const assertCurrent = vi.fn(() => true);
    const save = vi.fn(() => ({ status: "committed" as const, operationId: "op_20260801_claimconfidence1" }));
    const render = vi.fn(async () => claimRender("high"));
    const service = new ClaimConfidenceService({
      resolveManagedPageTarget: vi.fn(() => readyTarget(assertCurrent)), render
    } as never, { open: vi.fn(() => openedClaim()), save } as never,
    () => new Date("2026-08-01T12:00:00.000Z"));

    await expect(service.setConfidence("reader_owner", request)).resolves.toMatchObject({
      ...request, status: "committed", operationId: "op_20260801_claimconfidence1",
      render: { claimConfidence: { confidence: "high", canChange: true } }
    });
    expect(assertCurrent).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.stringMatching(/^noteeditreq_[a-f0-9]{32}$/u),
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      expectedRevisionId: `sha256:${"a".repeat(64)}`,
      markdown: expect.stringContaining('claim:\n  confidence: "high"\n  evidence: []\n  contradicts: []')
    }));
    expect(save.mock.calls[0]?.[0].markdown).toContain("updated_at: 2026-08-01T12:00:00.000Z");
    expect(save.mock.calls[0]?.[0].markdown).toContain("Keep this body unchanged.");
    expect(render).toHaveBeenCalledWith({ pageId: request.currentPageId }, "reader_owner");
  });

  it("fails closed before mutation for stale identity, no change, or malformed Claim truth", async () => {
    const save = vi.fn(() => ({ status: "failed" as const }));
    const stale = new ClaimConfidenceService({
      resolveManagedPageTarget: vi.fn(() => readyTarget(() => false)), render: vi.fn()
    } as never, { open: vi.fn(() => openedClaim()), save } as never);
    await expect(stale.setConfidence("reader_owner", request)).resolves.toEqual({ ...request, status: "stale" });

    const unchanged = new ClaimConfidenceService({
      resolveManagedPageTarget: vi.fn(() => readyTarget(() => true)), render: vi.fn()
    } as never, { open: vi.fn(() => ({ ...openedClaim(), markdown: claimMarkdown("high") })), save } as never);
    await expect(unchanged.setConfidence("reader_owner", request)).resolves.toEqual({ ...request, status: "ineligible" });

    const malformed = new ClaimConfidenceService({
      resolveManagedPageTarget: vi.fn(() => readyTarget(() => true)), render: vi.fn()
    } as never, { open: vi.fn(() => ({ ...openedClaim(), markdown: claimMarkdown("medium").replace(
      "  evidence: []", "  confidence: low\n  evidence: []") })), save } as never);
    await expect(malformed.setConfidence("reader_owner", request)).resolves.toEqual({ ...request, status: "ineligible" });
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects non-Claim pages and preserves every field except confidence and updated_at", () => {
    expect(readClaimConfidence(frontmatter("medium"))).toBe("medium");
    expect(readClaimConfidence(frontmatter("medium").replace(
      "  evidence: []", "  confidence: low\n  evidence: []"))).toBeUndefined();
    expect(updateClaimConfidenceMarkdown(
      claimMarkdown("medium"), "low", "2026-08-01T13:00:00.000Z"
    )).toBe(claimMarkdown("low").replace(
      "updated_at: 2026-08-01T10:00:00.000Z", "updated_at: 2026-08-01T13:00:00.000Z"
    ));
    expect(updateClaimConfidenceMarkdown(
      claimMarkdown("medium").replace('type: "claim"', 'type: "note"'),
      "low", "2026-08-01T13:00:00.000Z"
    )).toBeUndefined();
  });
});

function readyTarget(assertCurrent: () => boolean) {
  return { status: "ready" as const, pageContentHash: `sha256:${"a".repeat(64)}`, assertCurrent };
}

function openedClaim() {
  return { status: "opened" as const, revisionId: `sha256:${"a".repeat(64)}`,
    renderIdentity: `sha256:${"b".repeat(64)}`, markdown: claimMarkdown("medium") };
}

function claimRender(confidence: "low" | "medium" | "high") {
  return {
    summary: { pageId: request.currentPageId, title: "Claim", pageType: "claim" as const,
      status: "active" as const, pagePath: "claims/claim.md",
      createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T12:00:00.000Z", sourceIds: [] },
    html: "<h1>Claim</h1>", byteSize: 128,
    renderContextId: "notectx_fedcba9876543210fedcba9876543210",
    claimConfidence: { confidence, canChange: true, revision: `noteeditrev_${"b".repeat(64)}` }
  };
}

function frontmatter(confidence: string): string {
  return `id: "${request.currentPageId}"
schema_version: 1
title: "Claim"
type: "claim"
created_at: 2026-08-01T10:00:00.000Z
updated_at: 2026-08-01T10:00:00.000Z
status: "active"
aliases: []
source_ids: []
claim:
  confidence: "${confidence}"
  evidence: []
  contradicts: []
`;
}

function claimMarkdown(confidence: string): string {
  return `---\n${frontmatter(confidence)}---\n\n# Claim\n\nKeep this body unchanged.\n`;
}
