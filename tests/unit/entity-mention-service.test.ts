import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EntityMentionService,
  projectEntityMentions
} from "../../apps/desktop/src/main/services/entity-mention-service";
import { hashMarkdown } from "../../apps/desktop/src/main/services/note-markdown-editor-service";

const roots: string[] = [];
const request = {
  apiVersion: 1 as const,
  requestId: "entitymentionreq_abcdefghijklmnop",
  activeVaultId: "vault_20260802_entitymention",
  currentPageId: "page_20260802_entity0001",
  renderContextId: "notectx_0123456789abcdef0123456789abcdef",
  expectedRevision: `noteeditrev_${"a".repeat(64)}`,
  action: "add" as const,
  targetPageId: "page_20260802_note000001",
  expectedTargetUpdatedAt: "2026-08-02T10:00:00.000Z"
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("EntityMentionService", () => {
  it("searches current pages and adds and removes one exact entity mention", async () => {
    const vaultPath = makeVault();
    writePage(vaultPath, request.currentPageId, "Pige", "entity", "2026-08-02T09:00:00.000Z", []);
    writePage(vaultPath, request.targetPageId, "Launch notes", "note", request.expectedTargetUpdatedAt, []);
    writePage(vaultPath, "page_20260802_claim0001", "Launch claim", "claim", "2026-08-02T10:30:00.000Z", []);
    const current = vi.fn(() => true);
    const save = vi.fn((input: { readonly pageId: string; readonly markdown: string }) => {
      fs.writeFileSync(pagePath(vaultPath, input.pageId), input.markdown, "utf8");
      return { status: "committed" as const, operationId: "op_20260802_entitymention1" };
    });
    const service = new EntityMentionService({
      resolveManagedPageTarget: vi.fn(() => readyEntity(current)),
      render: vi.fn(async () => entityRender(projectEntityMentions(vaultPath, request.currentPageId)))
    } as never, editor(vaultPath, save) as never, () => vaultPath,
    () => new Date("2026-08-02T11:00:00.000Z"));

    expect(service.search("reader_owner", { ...request, query: "launch" })).toMatchObject({
      status: "ready",
      candidates: [
        { pageId: "page_20260802_claim0001", title: "Launch claim", pageType: "claim" },
        { pageId: request.targetPageId, title: "Launch notes", pageType: "note" }
      ]
    });
    await expect(service.change("reader_owner", request)).resolves.toMatchObject({
      status: "committed",
      operationId: "op_20260802_entitymention1",
      render: { entityMentions: { items: [{ pageId: request.targetPageId }] } }
    });
    expect(readPage(vaultPath, request.targetPageId)).toContain(`entities: ["${request.currentPageId}"]`);
    expect(current).toHaveBeenCalledTimes(5);

    const updatedAt = pageUpdatedAt(vaultPath, request.targetPageId);
    const remove = new EntityMentionService({
      resolveManagedPageTarget: vi.fn(() => readyEntity(() => true)),
      render: vi.fn(async () => entityRender(projectEntityMentions(vaultPath, request.currentPageId)))
    } as never, editor(vaultPath, save) as never, () => vaultPath,
    () => new Date("2026-08-02T12:00:00.000Z"));
    await expect(remove.change("reader_owner", {
      ...request, requestId: "entitymentionreq_removeabcdefghijk", action: "remove", expectedTargetUpdatedAt: updatedAt
    })).resolves.toMatchObject({ status: "committed", render: { entityMentions: { items: [] } } });
    expect(readPage(vaultPath, request.targetPageId)).toContain("entities: []");
  });

  it("fails closed before mutation when either page identity drifts", async () => {
    const vaultPath = makeVault();
    writePage(vaultPath, request.currentPageId, "Pige", "entity", "2026-08-02T09:00:00.000Z", []);
    writePage(vaultPath, request.targetPageId, "Launch notes", "note", "2026-08-02T10:00:01.000Z", []);
    const save = vi.fn();
    const staleTarget = new EntityMentionService({
      resolveManagedPageTarget: vi.fn(() => readyEntity(() => true)), render: vi.fn()
    } as never, editor(vaultPath, save) as never, () => vaultPath);
    await expect(staleTarget.change("reader_owner", request)).resolves.toEqual({ ...request, status: "stale" });

    const staleEntity = new EntityMentionService({
      resolveManagedPageTarget: vi.fn(() => readyEntity(() => false)), render: vi.fn()
    } as never, editor(vaultPath, save) as never, () => vaultPath);
    await expect(staleEntity.change("reader_owner", request)).resolves.toEqual({ ...request, status: "stale" });
    expect(save).not.toHaveBeenCalled();
  });
});

function makeVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-entity-mention-"));
  roots.push(root); fs.mkdirSync(path.join(root, "wiki"), { recursive: true }); return root;
}
function pagePath(vaultPath: string, pageId: string): string { return path.join(vaultPath, "wiki", `${pageId}.md`); }
function readPage(vaultPath: string, pageId: string): string { return fs.readFileSync(pagePath(vaultPath, pageId), "utf8"); }
function writePage(vaultPath: string, pageId: string, title: string,
  type: "note" | "claim" | "entity", updatedAt: string, entities: readonly string[]): void {
  fs.writeFileSync(pagePath(vaultPath, pageId), `---\nid: "${pageId}"\nschema_version: 1\ntitle: "${title}"\ntype: "${type}"\ncreated_at: 2026-08-02T09:00:00.000Z\nupdated_at: ${updatedAt}\nstatus: "active"\nlanguage: "en"\naliases: []\ntags: []\ntopics: []\nentities: ${JSON.stringify(entities)}\nsource_ids: []\nrelated_page_ids: []\n${type === "entity" ? "entity:\n  entity_type: product\n" : ""}---\n\n# ${title}\n`, "utf8");
}
function editor(vaultPath: string, save: ReturnType<typeof vi.fn>) {
  return { open: ({ pageId }: { readonly pageId: string }) => { const markdown = readPage(vaultPath, pageId);
    return { status: "opened" as const, revisionId: hashMarkdown(markdown),
      renderIdentity: `sha256:${"b".repeat(64)}`, markdown }; }, save };
}
function pageUpdatedAt(vaultPath: string, pageId: string): string {
  return /^updated_at:\s*(.+)$/mu.exec(readPage(vaultPath, pageId))?.[1]!.replaceAll('"', "") ?? "";
}
function readyEntity(assertCurrent: () => boolean) {
  return { status: "ready" as const, pageContentHash: `sha256:${"a".repeat(64)}`, assertCurrent };
}
function entityRender(items: ReturnType<typeof projectEntityMentions>) {
  return { summary: { pageId: request.currentPageId, title: "Pige", pageType: "entity" as const,
    status: "active" as const, pagePath: "wiki/entity.md", createdAt: "2026-08-02T09:00:00.000Z",
    updatedAt: "2026-08-02T09:00:00.000Z", sourceIds: [] }, html: "<h1>Pige</h1>", byteSize: 80,
    renderContextId: "notectx_fedcba9876543210fedcba9876543210",
    entityMentions: { canEdit: true, revision: `noteeditrev_${"b".repeat(64)}`, items } };
}
