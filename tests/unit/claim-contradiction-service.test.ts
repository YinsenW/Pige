import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ClaimContradictionService,
  readClaimContradictionIds
} from "../../apps/desktop/src/main/services/claim-contradiction-service";

const roots: string[] = [];
const request = {
  apiVersion: 1 as const,
  requestId: "claimcontradictionreq_abcdefghijklmnop",
  activeVaultId: "vault_20260801_claims",
  currentPageId: "page_20260801_claim0001",
  renderContextId: "notectx_0123456789abcdef0123456789abcdef",
  expectedRevision: `noteeditrev_${"a".repeat(64)}`,
  action: "add" as const,
  targetPageId: "page_20260801_claim0002",
  expectedTargetUpdatedAt: "2026-08-01T11:00:00.000Z"
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("ClaimContradictionService", () => {
  it("searches only current sourced claims and commits an exact reversible relation", async () => {
    const vaultPath = makeVault();
    writeClaim(vaultPath, request.targetPageId, "Conflicting claim", request.expectedTargetUpdatedAt);
    writeClaim(vaultPath, "page_20260801_claim0003", "Unsourced conflict", "2026-08-01T10:30:00.000Z", false);
    const assertCurrent = vi.fn(() => true);
    const save = vi.fn(() => ({ status: "committed" as const, operationId: "op_20260801_claimrelation1" }));
    const service = new ClaimContradictionService({
      resolveManagedPageTarget: vi.fn(() => readyTarget(assertCurrent)),
      render: vi.fn(async () => claimRender([item()]))
    } as never, { open: vi.fn(() => openedClaim()), save } as never, () => vaultPath,
    () => new Date("2026-08-01T12:00:00.000Z"));

    expect(service.search("reader", { ...request, query: "conflict" })).toMatchObject({
      status: "ready", candidates: [{ pageId: request.targetPageId, title: "Conflicting claim" }]
    });
    await expect(service.change("reader", request)).resolves.toMatchObject({
      status: "committed", operationId: "op_20260801_claimrelation1",
      render: { claimContradictions: { items: [{ pageId: request.targetPageId }] } }
    });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      markdown: expect.stringContaining(`contradicts: ["${request.targetPageId}"]`)
    }));

    const { expectedTargetUpdatedAt: _targetRevision, ...removeIdentity } = request;
    const removeSave = vi.fn(() => ({ status: "committed" as const, operationId: "op_20260801_claimrelation2" }));
    const remove = new ClaimContradictionService({
      resolveManagedPageTarget: vi.fn(() => readyTarget(() => true)),
      render: vi.fn(async () => claimRender([]))
    } as never, { open: vi.fn(() => openedClaim([request.targetPageId])), save: removeSave } as never,
    () => vaultPath, () => new Date("2026-08-01T13:00:00.000Z"));
    await expect(remove.change("reader", { ...removeIdentity,
      requestId: "claimcontradictionreq_removeabcdefghijkl", action: "remove" })).resolves.toMatchObject({
      status: "committed", operationId: "op_20260801_claimrelation2"
    });
    expect(removeSave).toHaveBeenCalledWith(expect.objectContaining({ markdown: expect.stringContaining("contradicts: []") }));
  });

  it("fails before mutation for unsourced, changed, or raced target identity", async () => {
    const vaultPath = makeVault(), save = vi.fn();
    writeClaim(vaultPath, request.targetPageId, "Conflict", request.expectedTargetUpdatedAt, false);
    const service = new ClaimContradictionService({
      resolveManagedPageTarget: vi.fn(() => readyTarget(() => true)), render: vi.fn()
    } as never, { open: vi.fn(() => openedClaim()), save } as never, () => vaultPath);
    await expect(service.change("reader", request)).resolves.toEqual({ ...request, status: "stale" });

    writeClaim(vaultPath, request.targetPageId, "Conflict", request.expectedTargetUpdatedAt);
    const raced = new ClaimContradictionService({
      resolveManagedPageTarget: vi.fn(() => readyTarget(() => true)), render: vi.fn()
    } as never, { open: vi.fn(() => {
      writeClaim(vaultPath, request.targetPageId, "Conflict", "2026-08-01T11:00:01.000Z");
      return openedClaim();
    }), save } as never, () => vaultPath);
    await expect(raced.change("reader", request)).resolves.toEqual({ ...request, status: "stale" });
    expect(save).not.toHaveBeenCalled();
  });

  it("accepts only one bounded unique claim truth", () => {
    expect(readClaimContradictionIds(claimFrontmatter([]))).toEqual([]);
    expect(readClaimContradictionIds(claimFrontmatter([request.targetPageId, request.targetPageId]))).toBeUndefined();
    expect(readClaimContradictionIds(claimFrontmatter([]).replace("  contradicts: []", "  contradicts: []\n  contradicts: []"))).toBeUndefined();
  });
});

function makeVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-claim-contradiction-"));
  roots.push(root); fs.mkdirSync(path.join(root, "wiki"), { recursive: true }); return root;
}
function writeClaim(vaultPath: string, pageId: string, title: string, updatedAt: string, sourced = true): void {
  fs.writeFileSync(path.join(vaultPath, "wiki", `${pageId}.md`), `---\nid: "${pageId}"\nschema_version: 1\ntitle: "${title}"\ntype: "claim"\ncreated_at: 2026-08-01T10:00:00.000Z\nupdated_at: ${updatedAt}\nstatus: "active"\naliases: []\nsource_ids: ${sourced ? '["src_20260801_claim0001"]' : "[]"}\nclaim:\n  confidence: "medium"\n  evidence: []\n  contradicts: []\n---\n\n# ${title}\n`, "utf8");
}
function readyTarget(assertCurrent: () => boolean) {
  return { status: "ready" as const, pageContentHash: `sha256:${"a".repeat(64)}`, assertCurrent };
}
function openedClaim(ids: readonly string[] = []) {
  return { status: "opened" as const, revisionId: `sha256:${"a".repeat(64)}`,
    renderIdentity: `sha256:${"b".repeat(64)}`, markdown: `---\n${claimFrontmatter(ids)}---\n\n# Claim\n` };
}
function claimFrontmatter(ids: readonly string[]): string {
  return `id: "${request.currentPageId}"\nschema_version: 1\ntitle: "Claim"\ntype: "claim"\ncreated_at: 2026-08-01T10:00:00.000Z\nupdated_at: 2026-08-01T10:00:00.000Z\nstatus: "active"\naliases: []\nsource_ids: ["src_20260801_claimbase"]\nclaim:\n  confidence: "medium"\n  evidence: []\n  contradicts: ${JSON.stringify(ids)}\n`;
}
function item() { return { pageId: request.targetPageId, title: "Conflicting claim", updatedAt: request.expectedTargetUpdatedAt }; }
function claimRender(items: readonly ReturnType<typeof item>[]) {
  return { summary: { pageId: request.currentPageId, title: "Claim", pageType: "claim" as const,
    status: "active" as const, pagePath: "wiki/claim.md", createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z", sourceIds: ["src_20260801_claimbase"] },
    html: "<h1>Claim</h1>", byteSize: 80, renderContextId: "notectx_fedcba9876543210fedcba9876543210",
    claimContradictions: { canEdit: true, revision: `noteeditrev_${"b".repeat(64)}`, items } };
}
