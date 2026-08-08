import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaimEvidenceService, readClaimEvidenceRefs } from
  "../../apps/desktop/src/main/services/claim-evidence-service";

const roots: string[] = [];
const vaultId = "vault_20260802_claimevidence";
const claimPageId = "page_20260802_claimevidence";
const sourcePageId = "page_20260802_evidencesource";
const sourceId = "src_20260802_evidencesource";
const updatedAt = "2026-08-02T10:00:00.000Z";
const request = {
  apiVersion: 1 as const, requestId: "claimevidencereq_abcdefghijklmnop", activeVaultId: vaultId,
  currentPageId: claimPageId, renderContextId: "notectx_0123456789abcdef0123456789abcdef",
  expectedRevision: `noteeditrev_${"a".repeat(64)}` as const, action: "add" as const,
  sourcePageId, sourceId, expectedSourceUpdatedAt: updatedAt
};

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("ClaimEvidenceService", () => {
  it("searches current Source Pages and commits exact evidence through the reversible editor", async () => {
    const vaultPath = makeVault(), save = vi.fn(() => ({ status: "committed" as const, operationId: "op_20260802_claimevidence1" }));
    const service = new ClaimEvidenceService({ resolveManagedPageTarget: vi.fn(() => readyTarget()),
      render: vi.fn(async () => render([item()])) } as never,
    { open: vi.fn(() => opened(["src_20260802_claimbase#source"])), save } as never, () => vaultPath,
    () => new Date("2026-08-02T11:00:00.000Z"));

    expect(service.search("reader", { ...request, query: "Evidence" })).toMatchObject({
      status: "ready", candidates: [{ sourcePageId, sourceId, title: "Evidence source" }]
    });
    await expect(service.change("reader", request)).resolves.toMatchObject({
      status: "committed", operationId: "op_20260802_claimevidence1"
    });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ markdown: expect.stringContaining(
      `source_ids: ["src_20260802_claimbase","${sourceId}"]`
    ) }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ markdown: expect.stringContaining(
      `evidence: ["src_20260802_claimbase#source","${sourceId}#source"]`
    ) }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ recoveryKind: "claim_source" }));
  });

  it("fails before mutation on SourceRecord drift and refuses removal of the final evidence", async () => {
    const vaultPath = makeVault(), save = vi.fn();
    const recordPath = path.join(vaultPath, ".pige", "source-records", "2026", "08", `${sourceId}.json`);
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    fs.writeFileSync(recordPath, JSON.stringify({ ...record, knowledgePageId: "page_20260802_otherpage" }));
    const service = new ClaimEvidenceService({ resolveManagedPageTarget: vi.fn(() => readyTarget()), render: vi.fn() } as never,
      { open: vi.fn(() => opened([])), save } as never, () => vaultPath);
    await expect(service.change("reader", request)).resolves.toEqual({ ...request, status: "stale" });
    const { expectedSourceUpdatedAt: _currentness, ...remove } = request;
    const currentVaultPath = makeVault();
    const finalOnly = new ClaimEvidenceService({ resolveManagedPageTarget: vi.fn(() => readyTarget()), render: vi.fn() } as never,
      { open: vi.fn(() => opened([`${sourceId}#source`], [sourceId])), save } as never, () => currentVaultPath);
    await expect(finalOnly.change("reader", { ...remove, requestId: "claimevidencereq_removeabcdefgh", action: "remove" }))
      .resolves.toMatchObject({ status: "ineligible" });
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects a removal whose Source Page identity does not match current durable evidence", async () => {
    const vaultPath = makeVault(), save = vi.fn();
    const service = new ClaimEvidenceService({ resolveManagedPageTarget: vi.fn(() => readyTarget()), render: vi.fn() } as never,
      { open: vi.fn(() => opened(["src_20260802_claimbase#source", `${sourceId}#source`],
        ["src_20260802_claimbase", sourceId])), save } as never, () => vaultPath);
    const { expectedSourceUpdatedAt: _currentness, ...remove } = request;
    await expect(service.change("reader", { ...remove, requestId: "claimevidencereq_mismatchabcdefgh", action: "remove",
      sourcePageId: "page_20260802_wrongsource" })).resolves.toMatchObject({ status: "stale" });
    expect(save).not.toHaveBeenCalled();
  });

  it("accepts only bounded unique source evidence refs", () => {
    expect(readClaimEvidenceRefs(frontmatter([`${sourceId}#source`]))).toEqual([`${sourceId}#source`]);
    expect(readClaimEvidenceRefs(frontmatter([`${sourceId}#source`, `${sourceId}#source`]))).toBeUndefined();
    expect(readClaimEvidenceRefs(frontmatter(["not-a-source"]))).toBeUndefined();
  });
});

function makeVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-claim-evidence-")); roots.push(root);
  fs.mkdirSync(path.join(root, "sources"), { recursive: true });
  fs.writeFileSync(path.join(root, "sources", `${sourcePageId}.md`), `---\nid: "${sourcePageId}"\nschema_version: 1\ntitle: "Evidence source"\ntype: "source"\ncreated_at: "${updatedAt}"\nupdated_at: "${updatedAt}"\nstatus: "active"\nsource_ids: ["${sourceId}"]\n---\n\n# Evidence source\n`);
  const recordPath = path.join(root, ".pige", "source-records", "2026", "08", `${sourceId}.json`);
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  fs.writeFileSync(recordPath, JSON.stringify({ schemaVersion: 1, id: sourceId, kind: "text",
    storageStrategy: "reference_original", semanticOrchestration: "agent_turn", knowledgePageId: sourcePageId,
    knowledgePagePath: `sources/${sourcePageId}.md`, original: { uri: `pige-test://${sourceId}` }, artifacts: [],
    metadata: {}, createdAt: updatedAt, updatedAt }));
  return root;
}
function readyTarget() { return { status: "ready" as const, pageContentHash: `sha256:${"a".repeat(64)}`, assertCurrent: () => true }; }
function opened(refs: readonly string[], ids: readonly string[] = ["src_20260802_claimbase"]) {
  return { status: "opened" as const, revisionId: `sha256:${"a".repeat(64)}`,
    renderIdentity: `sha256:${"b".repeat(64)}`, markdown: `---\n${frontmatter(refs, ids)}---\n\n# Claim\n` };
}
function frontmatter(refs: readonly string[], ids: readonly string[] = ["src_20260802_claimbase"]): string {
  return `id: "${claimPageId}"\nschema_version: 1\ntitle: "Claim"\ntype: "claim"\ncreated_at: "2026-08-02T09:00:00.000Z"\nupdated_at: "2026-08-02T09:00:00.000Z"\nstatus: "active"\naliases: []\nsource_ids: ${JSON.stringify(ids)}\nclaim:\n  confidence: "medium"\n  evidence: ${JSON.stringify(refs)}\n  contradicts: []\n`;
}
function item() { return { sourcePageId, sourceId, title: "Evidence source", updatedAt }; }
function render(items: readonly ReturnType<typeof item>[]) { return { summary: { pageId: claimPageId, title: "Claim",
  pageType: "claim" as const, status: "active" as const, pagePath: "wiki/claim.md", createdAt: updatedAt,
  updatedAt, sourceIds: items.map(({ sourceId: id }) => id) }, html: "<h1>Claim</h1>", byteSize: 80,
  renderContextId: "notectx_fedcba9876543210fedcba9876543210",
  claimEvidence: { canEdit: true, revision: `noteeditrev_${"b".repeat(64)}`, items } }; }
