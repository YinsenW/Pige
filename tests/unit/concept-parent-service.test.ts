import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConceptParentService, readConceptParentIds } from "../../apps/desktop/src/main/services/concept-parent-service";

const roots: string[] = [];
const request = {
  apiVersion: 1 as const, requestId: "conceptparentreq_abcdefghijklmnop",
  activeVaultId: "vault_20260801_concepts", currentPageId: "page_20260801_concept01",
  renderContextId: "notectx_0123456789abcdef0123456789abcdef",
  expectedRevision: `noteeditrev_${"a".repeat(64)}`, action: "add" as const,
  targetPageId: "page_20260801_concept02", expectedTargetUpdatedAt: "2026-08-01T11:00:00.000Z"
};

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("ConceptParentService", () => {
  it("searches active concepts and commits an exact broader-concept link", async () => {
    const vaultPath = makeVault();
    writeConcept(vaultPath, request.targetPageId, "Broader idea", request.expectedTargetUpdatedAt);
    writeConcept(vaultPath, "page_20260801_archived1", "Broader old", "2026-08-01T10:30:00.000Z", "archived");
    const save = vi.fn(() => ({ status: "committed" as const, operationId: "op_20260801_conceptparent1" }));
    const service = new ConceptParentService({
      resolveManagedPageTarget: vi.fn(() => readyTarget(() => true)),
      render: vi.fn(async () => conceptRender([parentItem()]))
    } as never, { open: vi.fn(() => openedConcept()), save } as never, () => vaultPath,
    () => new Date("2026-08-01T12:00:00.000Z"));

    expect(service.search("reader_owner", { ...request, query: "broader" })).toMatchObject({
      status: "ready", candidates: [{ pageId: request.targetPageId, title: "Broader idea" }]
    });
    await expect(service.change("reader_owner", request)).resolves.toMatchObject({
      status: "committed", operationId: "op_20260801_conceptparent1",
      render: { conceptParents: { items: [{ pageId: request.targetPageId }] } }
    });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      pageId: request.currentPageId,
      markdown: expect.stringContaining(`parent_concepts: ["${request.targetPageId}"]`)
    }));
  });

  it("removes an existing parent and fences target or Reader drift before mutation", async () => {
    const vaultPath = makeVault();
    writeConcept(vaultPath, request.targetPageId, "Broader idea", request.expectedTargetUpdatedAt);
    const save = vi.fn(() => ({ status: "committed" as const, operationId: "op_20260801_conceptparent2" }));
    const remove = new ConceptParentService({ resolveManagedPageTarget: vi.fn(() => readyTarget(() => true)),
      render: vi.fn(async () => conceptRender([])) } as never,
    { open: vi.fn(() => openedConcept([request.targetPageId])), save } as never, () => vaultPath);
    const { expectedTargetUpdatedAt: _, ...identity } = request;
    await expect(remove.change("reader_owner", { ...identity, requestId: "conceptparentreq_removeabcdefgh", action: "remove" }))
      .resolves.toMatchObject({ status: "committed", render: { conceptParents: { items: [] } } });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ markdown: expect.stringContaining("parent_concepts: []") }));

    writeConcept(vaultPath, request.targetPageId, "Broader idea", "2026-08-01T11:00:01.000Z");
    const staleSave = vi.fn();
    const stale = new ConceptParentService({ resolveManagedPageTarget: vi.fn(() => readyTarget(() => true)),
      render: vi.fn() } as never, { open: vi.fn(() => openedConcept()), save: staleSave } as never, () => vaultPath);
    await expect(stale.change("reader_owner", request)).resolves.toMatchObject({ status: "stale" });
    expect(staleSave).not.toHaveBeenCalled();

    writeConcept(vaultPath, request.targetPageId, "Broader idea", request.expectedTargetUpdatedAt, "active",
      [request.currentPageId]);
    const cyclic = new ConceptParentService({ resolveManagedPageTarget: vi.fn(() => readyTarget(() => true)),
      render: vi.fn() } as never, { open: vi.fn(() => openedConcept()), save: staleSave } as never, () => vaultPath);
    await expect(cyclic.change("reader_owner", request)).resolves.toMatchObject({ status: "ineligible" });
    expect(staleSave).not.toHaveBeenCalled();
  });

  it("parses only one bounded unique parent_concepts truth", () => {
    expect(readConceptParentIds(conceptFrontmatter([]))).toEqual([]);
    expect(readConceptParentIds(conceptFrontmatter([request.targetPageId, request.targetPageId]))).toBeUndefined();
    expect(readConceptParentIds(conceptFrontmatter([]).replace("  parent_concepts: []",
      "  parent_concepts: []\n  parent_concepts: []"))).toBeUndefined();
  });
});

function makeVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-concept-parent-")); roots.push(root);
  fs.mkdirSync(path.join(root, "wiki"), { recursive: true }); return root;
}
function writeConcept(vaultPath: string, pageId: string, title: string, updatedAt: string,
  status: "active" | "archived" = "active", parents: readonly string[] = []): void {
  fs.writeFileSync(path.join(vaultPath, "wiki", `${pageId}.md`), `---\nid: "${pageId}"\nschema_version: 1\ntitle: "${title}"\ntype: "concept"\ncreated_at: 2026-08-01T10:00:00.000Z\nupdated_at: ${updatedAt}\nstatus: "${status}"\naliases: []\nsource_ids: []\nconcept:\n  parent_concepts: ${JSON.stringify(parents)}\n  child_concepts: []\n---\n\n# ${title}\n`, "utf8");
}
function readyTarget(assertCurrent: () => boolean) {
  return { status: "ready" as const, pageContentHash: `sha256:${"a".repeat(64)}`, assertCurrent };
}
function openedConcept(ids: readonly string[] = []) { return { status: "opened" as const,
  revisionId: `sha256:${"a".repeat(64)}`, renderIdentity: `sha256:${"b".repeat(64)}`,
  markdown: `---\n${conceptFrontmatter(ids)}---\n\n# Concept\n` }; }
function conceptFrontmatter(ids: readonly string[]): string { return `id: "${request.currentPageId}"\nschema_version: 1\ntitle: "Concept"\ntype: "concept"\ncreated_at: 2026-08-01T10:00:00.000Z\nupdated_at: 2026-08-01T10:00:00.000Z\nstatus: "active"\naliases: []\nsource_ids: []\nconcept:\n  parent_concepts: ${JSON.stringify(ids)}\n  child_concepts: []\n`; }
function parentItem() { return { pageId: request.targetPageId, title: "Broader idea",
  updatedAt: request.expectedTargetUpdatedAt }; }
function conceptRender(items: readonly ReturnType<typeof parentItem>[]) { return {
  summary: { pageId: request.currentPageId, title: "Concept", pageType: "concept" as const,
    status: "active" as const, pagePath: "wiki/concept.md", createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z", sourceIds: [] }, html: "<h1>Concept</h1>", byteSize: 80,
  renderContextId: "notectx_fedcba9876543210fedcba9876543210",
  conceptParents: { canEdit: true, revision: `noteeditrev_${"b".repeat(64)}`, items }
}; }
