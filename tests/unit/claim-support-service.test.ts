import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaimSupportService, readClaimSupportIds } from "../../apps/desktop/src/main/services/claim-support-service";

const roots: string[] = [];
const request = {
  apiVersion: 1 as const, requestId: "claimsupportreq_abcdefghijklmnop", activeVaultId: "vault_20260808_claims",
  currentPageId: "page_20260808_claim0001", renderContextId: "notectx_0123456789abcdef0123456789abcdef",
  expectedRevision: `noteeditrev_${"a".repeat(64)}`, action: "add" as const,
  targetPageId: "page_20260808_claim0002", expectedTargetUpdatedAt: "2026-08-08T11:00:00.000Z"
};
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("ClaimSupportService", () => {
  it("searches sourced claims and commits a directed, exact support relation", async () => {
    const vaultPath = makeVault(); writeClaim(vaultPath, request.targetPageId, "Supporting claim", request.expectedTargetUpdatedAt);
    writeClaim(vaultPath, "page_20260808_claim0003", "Unsourced claim", "2026-08-08T10:30:00.000Z", false);
    const save = vi.fn(() => ({ status: "committed" as const, operationId: "op_20260808_claimsupport1" }));
    const service = new ClaimSupportService({ resolveManagedPageTarget: vi.fn(() => target(() => true)), render: vi.fn(async () => render([item()])) } as never,
      { open: vi.fn(() => opened()), save } as never, () => vaultPath, () => new Date("2026-08-08T12:00:00.000Z"));
    expect(service.search("reader", { ...request, query: "support" })).toMatchObject({ status: "ready", candidates: [{ pageId: request.targetPageId }] });
    await expect(service.change("reader", request)).resolves.toMatchObject({ status: "committed", operationId: "op_20260808_claimsupport1", render: { claimSupports: { items: [{ pageId: request.targetPageId }] } } });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ markdown: expect.stringContaining(`supports: ["${request.targetPageId}"]`) }));

    const { expectedTargetUpdatedAt: _targetUpdatedAt, ...removeIdentity } = request;
    const remove = new ClaimSupportService({ resolveManagedPageTarget: vi.fn(() => target(() => true)), render: vi.fn(async () => render([])) } as never,
      { open: vi.fn(() => opened([request.targetPageId])), save: vi.fn(() => ({ status: "committed" as const, operationId: "op_20260808_claimsupport2" })) } as never,
      () => vaultPath, () => new Date("2026-08-08T13:00:00.000Z"));
    await expect(remove.change("reader", { ...removeIdentity, requestId: "claimsupportreq_removeabcdefghijkl", action: "remove" })).resolves.toMatchObject({ status: "committed" });
  });

  it("fails closed before save for unsourced, changed, or cyclic target claims", async () => {
    const vaultPath = makeVault(), save = vi.fn(); writeClaim(vaultPath, request.targetPageId, "Target", request.expectedTargetUpdatedAt, false);
    const service = new ClaimSupportService({ resolveManagedPageTarget: vi.fn(() => target(() => true)), render: vi.fn() } as never, { open: vi.fn(() => opened()), save } as never, () => vaultPath);
    await expect(service.change("reader", request)).resolves.toEqual({ ...request, status: "stale" });
    writeClaim(vaultPath, request.targetPageId, "Target", request.expectedTargetUpdatedAt, true, [request.currentPageId]);
    await expect(service.change("reader", request)).resolves.toEqual({ ...request, status: "stale" });
    expect(save).not.toHaveBeenCalled();
  });

  it("accepts a single bounded unique support array", () => {
    expect(readClaimSupportIds(frontmatter([]))).toEqual([]);
    expect(readClaimSupportIds(frontmatter([request.targetPageId, request.targetPageId]))).toBeUndefined();
    expect(readClaimSupportIds(frontmatter([]).replace("  supports: []", "  supports: []\n  supports: []"))).toBeUndefined();
  });
});

function makeVault(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-claim-support-")); roots.push(root); fs.mkdirSync(path.join(root, "wiki"), { recursive: true }); return root; }
function writeClaim(vaultPath: string, pageId: string, title: string, updatedAt: string, sourced = true, supports: readonly string[] = []): void {
  fs.writeFileSync(path.join(vaultPath, "wiki", `${pageId}.md`), `---\n${frontmatter(supports, pageId, title, updatedAt, sourced)}---\n\n# ${title}\n`, "utf8");
}
function target(assertCurrent: () => boolean) { return { status: "ready" as const, pageContentHash: `sha256:${"a".repeat(64)}`, assertCurrent }; }
function opened(supports: readonly string[] = []) { return { status: "opened" as const, revisionId: `sha256:${"a".repeat(64)}`, renderIdentity: `sha256:${"b".repeat(64)}`, markdown: `---\n${frontmatter(supports)}---\n\n# Claim\n` }; }
function frontmatter(supports: readonly string[], pageId = request.currentPageId, title = "Claim", updatedAt = "2026-08-08T10:00:00.000Z", sourced = true): string {
  return `id: "${pageId}"\nschema_version: 1\ntitle: "${title}"\ntype: "claim"\ncreated_at: 2026-08-08T10:00:00.000Z\nupdated_at: ${updatedAt}\nstatus: "active"\naliases: []\nsource_ids: ${sourced ? '["src_20260808_claimbase"]' : "[]"}\nclaim:\n  confidence: "medium"\n  evidence: []\n  contradicts: []\n  supports: ${JSON.stringify(supports)}\n`;
}
function item() { return { pageId: request.targetPageId, title: "Supporting claim", updatedAt: request.expectedTargetUpdatedAt }; }
function render(items: readonly ReturnType<typeof item>[]) { return { summary: { pageId: request.currentPageId, title: "Claim", pageType: "claim" as const, status: "active" as const, pagePath: "wiki/claim.md", createdAt: "2026-08-08T10:00:00.000Z", updatedAt: "2026-08-08T12:00:00.000Z", sourceIds: ["src_20260808_claimbase"] }, html: "<h1>Claim</h1>", byteSize: 80, renderContextId: "notectx_fedcba9876543210fedcba9876543210", claimSupports: { canEdit: true, revision: `noteeditrev_${"b".repeat(64)}`, items } }; }
