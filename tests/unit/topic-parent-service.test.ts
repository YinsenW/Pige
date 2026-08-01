import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopicParentService, readTopicParentIds } from "../../apps/desktop/src/main/services/topic-parent-service";

const roots: string[] = [];
const request = {
  apiVersion: 1 as const, requestId: "topicparentreq_abcdefghijklmnop",
  activeVaultId: "vault_20260801_topics", currentPageId: "page_20260801_topic001",
  renderContextId: "notectx_0123456789abcdef0123456789abcdef",
  expectedRevision: `noteeditrev_${"a".repeat(64)}`, action: "add" as const,
  targetPageId: "page_20260801_topic002", expectedTargetUpdatedAt: "2026-08-01T11:00:00.000Z"
};

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("TopicParentService", () => {
  it("searches active topics and commits one exact parent edge", async () => {
    const vaultPath = makeVault();
    writeTopic(vaultPath, request.targetPageId, "Broader topic", request.expectedTargetUpdatedAt);
    writeTopic(vaultPath, "page_20260801_archived1", "Broader old", "2026-08-01T10:30:00.000Z", "archived");
    const save = vi.fn(() => ({ status: "committed" as const, operationId: "op_20260801_topicparent1" }));
    const service = new TopicParentService({
      resolveManagedPageTarget: vi.fn(() => readyTarget(() => true)),
      render: vi.fn(async () => topicRender([parentItem()]))
    } as never, { open: vi.fn(() => openedTopic()), save } as never, () => vaultPath,
    () => new Date("2026-08-01T12:00:00.000Z"));

    expect(service.search("reader_owner", { ...request, query: "broader" })).toMatchObject({
      status: "ready", candidates: [{ pageId: request.targetPageId, title: "Broader topic" }]
    });
    await expect(service.change("reader_owner", request)).resolves.toMatchObject({
      status: "committed", operationId: "op_20260801_topicparent1",
      render: { topicParents: { items: [{ pageId: request.targetPageId }] } }
    });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      pageId: request.currentPageId,
      markdown: expect.stringContaining(`topics: ["${request.targetPageId}"]`)
    }));
  });

  it("removes an existing parent and fences target drift and cycles before mutation", async () => {
    const vaultPath = makeVault();
    writeTopic(vaultPath, request.targetPageId, "Broader topic", request.expectedTargetUpdatedAt);
    const save = vi.fn(() => ({ status: "committed" as const, operationId: "op_20260801_topicparent2" }));
    const remove = new TopicParentService({ resolveManagedPageTarget: vi.fn(() => readyTarget(() => true)),
      render: vi.fn(async () => topicRender([])) } as never,
    { open: vi.fn(() => openedTopic([request.targetPageId])), save } as never, () => vaultPath);
    const { expectedTargetUpdatedAt: _, ...identity } = request;
    await expect(remove.change("reader_owner", { ...identity, requestId: "topicparentreq_removeabcdefgh", action: "remove" }))
      .resolves.toMatchObject({ status: "committed", render: { topicParents: { items: [] } } });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ markdown: expect.stringContaining("topics: []") }));

    writeTopic(vaultPath, request.targetPageId, "Broader topic", "2026-08-01T11:00:01.000Z");
    const staleSave = vi.fn();
    const stale = new TopicParentService({ resolveManagedPageTarget: vi.fn(() => readyTarget(() => true)),
      render: vi.fn() } as never, { open: vi.fn(() => openedTopic()), save: staleSave } as never, () => vaultPath);
    await expect(stale.change("reader_owner", request)).resolves.toMatchObject({ status: "stale" });
    expect(staleSave).not.toHaveBeenCalled();

    writeTopic(vaultPath, request.targetPageId, "Broader topic", request.expectedTargetUpdatedAt, "active",
      [request.currentPageId]);
    const cyclic = new TopicParentService({ resolveManagedPageTarget: vi.fn(() => readyTarget(() => true)),
      render: vi.fn() } as never, { open: vi.fn(() => openedTopic()), save: staleSave } as never, () => vaultPath);
    await expect(cyclic.change("reader_owner", request)).resolves.toMatchObject({ status: "ineligible" });
    expect(staleSave).not.toHaveBeenCalled();
  });

  it("accepts only one bounded unique stable parent list", () => {
    expect(readTopicParentIds(topicFrontmatter([]))).toEqual([]);
    expect(readTopicParentIds(topicFrontmatter([request.targetPageId, request.targetPageId]))).toBeUndefined();
    expect(readTopicParentIds(topicFrontmatter([]).replace("topics: []", "topics: []\ntopics: []"))).toBeUndefined();
  });
});

function makeVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-topic-parent-")); roots.push(root);
  fs.mkdirSync(path.join(root, "wiki"), { recursive: true }); return root;
}
function writeTopic(vaultPath: string, pageId: string, title: string, updatedAt: string,
  status: "active" | "archived" = "active", parents: readonly string[] = []): void {
  fs.writeFileSync(path.join(vaultPath, "wiki", `${pageId}.md`), `---\nid: "${pageId}"\nschema_version: 1\ntitle: "${title}"\ntype: "topic"\ncreated_at: 2026-08-01T10:00:00.000Z\nupdated_at: ${updatedAt}\nstatus: "${status}"\naliases: []\ntags: []\ntopics: ${JSON.stringify(parents)}\nentities: []\nsource_ids: []\n---\n\n# ${title}\n`, "utf8");
}
function readyTarget(assertCurrent: () => boolean) {
  return { status: "ready" as const, pageContentHash: `sha256:${"a".repeat(64)}`, assertCurrent };
}
function openedTopic(ids: readonly string[] = []) { return { status: "opened" as const,
  revisionId: `sha256:${"a".repeat(64)}`, renderIdentity: `sha256:${"b".repeat(64)}`,
  markdown: `---\n${topicFrontmatter(ids)}---\n\n# Topic\n` }; }
function topicFrontmatter(ids: readonly string[]): string { return `id: "${request.currentPageId}"\nschema_version: 1\ntitle: "Topic"\ntype: "topic"\ncreated_at: 2026-08-01T10:00:00.000Z\nupdated_at: 2026-08-01T10:00:00.000Z\nstatus: "active"\naliases: []\ntags: []\ntopics: ${JSON.stringify(ids)}\nentities: []\nsource_ids: []\n`; }
function parentItem() { return { pageId: request.targetPageId, title: "Broader topic",
  updatedAt: request.expectedTargetUpdatedAt }; }
function topicRender(items: readonly ReturnType<typeof parentItem>[]) { return {
  summary: { pageId: request.currentPageId, title: "Topic", pageType: "topic" as const,
    status: "active" as const, pagePath: "wiki/topic.md", createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z", sourceIds: [] }, html: "<h1>Topic</h1>", byteSize: 80,
  renderContextId: "notectx_fedcba9876543210fedcba9876543210",
  topicParents: { canEdit: true, revision: `noteeditrev_${"b".repeat(64)}`, items }
}; }
