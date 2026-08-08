import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaimSupersessionService, readClaimSupersessionIds } from "../../apps/desktop/src/main/services/claim-supersession-service";

const roots: string[] = [];
const request = { apiVersion: 1 as const, requestId: "claimsupersessionreq_abcdefghijklmnop", activeVaultId: "vault_20260808_claims", currentPageId: "page_20260808_claim0001", renderContextId: "notectx_0123456789abcdef0123456789abcdef", expectedRevision: `noteeditrev_${"a".repeat(64)}`, action: "add" as const, targetPageId: "page_20260808_claim0002", expectedTargetUpdatedAt: "2026-08-08T11:00:00.000Z" };
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("ClaimSupersessionService", () => {
  it("adds and removes an exact source-backed directed supersession through the editor Activity owner", async () => {
    const vaultPath = makeVault(); writeClaim(vaultPath, request.targetPageId, "Prior claim", request.expectedTargetUpdatedAt);
    const save = vi.fn(() => ({ status: "committed" as const, operationId: "op_20260808_claimsupersession1" }));
    const service = new ClaimSupersessionService({ resolveManagedPageTarget: vi.fn(() => target()), render: vi.fn(async () => render([item()])) } as never, { open: vi.fn(() => opened()), save } as never, () => vaultPath, () => new Date("2026-08-08T12:00:00.000Z"));
    expect(service.search("reader", { ...request, query: "prior" })).toMatchObject({ status: "ready", candidates: [item()] });
    await expect(service.change("reader", request)).resolves.toMatchObject({ status: "committed", operationId: "op_20260808_claimsupersession1", render: { claimSupersessions: { items: [item()] } } });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ markdown: expect.stringContaining(`supersedes: ["${request.targetPageId}"]`) }));
    const { expectedTargetUpdatedAt: _discard, ...remove } = request;
    const removal = new ClaimSupersessionService({ resolveManagedPageTarget: vi.fn(() => target()), render: vi.fn(async () => render([])) } as never, { open: vi.fn(() => opened([request.targetPageId])), save: vi.fn(() => ({ status: "committed" as const, operationId: "op_20260808_claimsupersession2" })) } as never, () => vaultPath);
    await expect(removal.change("reader", { ...remove, requestId: "claimsupersessionreq_removeabc", action: "remove" })).resolves.toMatchObject({ status: "committed" });
  });
  it("fails closed before save for unsourced or cyclic targets", async () => {
    const vaultPath = makeVault(), save = vi.fn(); writeClaim(vaultPath, request.targetPageId, "Prior", request.expectedTargetUpdatedAt, false);
    const service = new ClaimSupersessionService({ resolveManagedPageTarget: vi.fn(() => target()), render: vi.fn() } as never, { open: vi.fn(() => opened()), save } as never, () => vaultPath);
    await expect(service.change("reader", request)).resolves.toEqual({ ...request, status: "stale" });
    writeClaim(vaultPath, request.targetPageId, "Prior", request.expectedTargetUpdatedAt, true, [request.currentPageId]);
    await expect(service.change("reader", request)).resolves.toEqual({ ...request, status: "stale" }); expect(save).not.toHaveBeenCalled();
  });
  it("accepts only one bounded unique supersedes projection", () => {
    expect(readClaimSupersessionIds(frontmatter([]))).toEqual([]);
    expect(readClaimSupersessionIds(frontmatter([request.targetPageId, request.targetPageId]))).toBeUndefined();
    expect(readClaimSupersessionIds(frontmatter([]).replace("  supersedes: []", "  supersedes: []\n  supersedes: []"))).toBeUndefined();
  });
});
function makeVault(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-claim-supersession-")); roots.push(root); fs.mkdirSync(path.join(root, "wiki"), { recursive: true }); return root; }
function writeClaim(vault: string, pageId: string, title: string, updatedAt: string, sourced = true, supersedes: readonly string[] = []): void { fs.writeFileSync(path.join(vault, "wiki", `${pageId}.md`), `---\n${frontmatter(supersedes, pageId, title, updatedAt, sourced)}---\n\n# ${title}\n`, "utf8"); }
function target() { return { status: "ready" as const, pageContentHash: `sha256:${"a".repeat(64)}`, assertCurrent: () => true }; }
function opened(supersedes: readonly string[] = []) { return { status: "opened" as const, revisionId: `sha256:${"a".repeat(64)}`, renderIdentity: `sha256:${"b".repeat(64)}`, markdown: `---\n${frontmatter(supersedes)}---\n\n# Claim\n` }; }
function frontmatter(supersedes: readonly string[], pageId = request.currentPageId, title = "Claim", updatedAt = "2026-08-08T10:00:00.000Z", sourced = true): string { return `id: "${pageId}"\nschema_version: 1\ntitle: "${title}"\ntype: "claim"\ncreated_at: 2026-08-08T10:00:00.000Z\nupdated_at: ${updatedAt}\nstatus: "active"\naliases: []\nsource_ids: ${sourced ? '["src_20260808_claimbase"]' : "[]"}\nclaim:\n  confidence: "medium"\n  evidence: []\n  contradicts: []\n  supports: []\n  supersedes: ${JSON.stringify(supersedes)}\n`; }
function item() { return { pageId: request.targetPageId, title: "Prior claim", updatedAt: request.expectedTargetUpdatedAt }; }
function render(items: readonly ReturnType<typeof item>[]) { return { summary: { pageId: request.currentPageId, title: "Claim", pageType: "claim" as const, status: "active" as const, pagePath: "wiki/claim.md", createdAt: "2026-08-08T10:00:00.000Z", updatedAt: "2026-08-08T12:00:00.000Z", sourceIds: ["src_20260808_claimbase"] }, html: "<h1>Claim</h1>", byteSize: 80, renderContextId: "notectx_fedcba9876543210fedcba9876543210", claimSupersessions: { canEdit: true, revision: `noteeditrev_${"b".repeat(64)}`, items } }; }
