import { describe, expect, it, vi } from "vitest";
import { NoteTagService } from "../../apps/desktop/src/main/services/note-tag-service";

const request = {
  apiVersion: 1 as const,
  requestId: "noteaddtagreq_abcdefghijklmnop",
  activeVaultId: "vault_20260730_tags",
  currentPageId: "page_20260730_tags",
  renderContextId: "notectx_abcdefghijklmnop",
  expectedRevision: `noteeditrev_${"a".repeat(64)}`,
  tag: "Research note"
};
const editRequest = {
  apiVersion: 1 as const,
  requestId: "notetaxonomyreq_abcdefghijklmnop",
  activeVaultId: request.activeVaultId,
  currentPageId: request.currentPageId,
  renderContextId: request.renderContextId,
  expectedRevision: request.expectedRevision,
  tags: ["Research", "Reading"],
  topics: ["Knowledge management"]
};
const removeRequest = { ...request, requestId: "noteremovetagreq_abcdefghijklmnop" };

describe("NoteTagService", () => {
  it.each(["note", "claim", "question", "concept", "entity"] as const)(
    "atomically replaces the exact %s tags and topics through one revision-bound editor operation", async (pageType) => {
    const assertCurrent = vi.fn(() => true);
    const save = vi.fn(() => ({ status: "committed" as const, requestId: "noteeditreq_internal",
      activeVaultId: request.activeVaultId, pageId: request.currentPageId, revisionId: `sha256:${"b".repeat(64)}`,
      renderIdentity: `sha256:${"c".repeat(64)}`, operationId: "op_20260731_taxonomy123456" }));
    const service = new NoteTagService({ resolveTrashTarget: vi.fn(() => readyTarget(assertCurrent)),
      render: vi.fn(async () => taxonomyRender(pageType)) } as never, { open: vi.fn(() => openedNote(pageType)), save } as never,
      () => new Date("2026-07-31T12:00:00.000Z"));

    await expect(service.edit("reader_owner", editRequest)).resolves.toMatchObject({
      ...editRequest, status: "committed", operationId: "op_20260731_taxonomy123456"
    });
    expect(assertCurrent).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevisionId: `sha256:${"a".repeat(64)}`,
      markdown: expect.stringContaining('tags: ["Research","Reading"]')
    }));
    expect(save.mock.calls[0]?.[0].markdown).toContain('topics: ["Knowledge management"]');
  });

  it("fails closed before mutation for stale, non-note, source, inactive, and unchanged targets", async () => {
    const cases = [
      { target: readyTarget(() => false), markdown: openedNote().markdown, status: "stale" },
      { target: readyTarget(() => true), markdown: openedNote().markdown.replace('type: "note"', 'type: "source"'), status: "ineligible" },
      { target: readyTarget(() => true), markdown: openedNote().markdown.replace('type: "note"', 'type: "topic"'), status: "ineligible" },
      { target: readyTarget(() => true), markdown: openedNote().markdown.replace('status: "active"', 'status: "archived"'), status: "ineligible" },
      { target: readyTarget(() => true), markdown: openedNote().markdown.replace("source_ids: []", 'tags: ["Research", "Reading"]\ntopics: ["Knowledge management"]\nsource_ids: []'), status: "ineligible" }
    ] as const;
    for (const fixture of cases) {
      const save = vi.fn();
      const service = new NoteTagService({ resolveTrashTarget: vi.fn(() => fixture.target), render: vi.fn() } as never,
        { open: vi.fn(() => ({ ...openedNote(), markdown: fixture.markdown })), save } as never);
      await expect(service.edit("reader_owner", editRequest)).resolves.toEqual({ ...editRequest, status: fixture.status });
      expect(save).not.toHaveBeenCalled();
    }
  });
  it.each(["note", "claim", "question", "concept", "entity"] as const)(
    "adds one canonical tag through the current %s Reader revision and returns the authoritative render", async (pageType) => {
    const assertCurrent = vi.fn(() => true);
    const save = vi.fn(() => ({
      status: "committed" as const,
      requestId: "noteeditreq_internal",
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      revisionId: `sha256:${"b".repeat(64)}`,
      renderIdentity: `sha256:${"c".repeat(64)}`,
      operationId: "op_20260730_addtag12345678"
    }));
    const render = vi.fn(async () => taggedRender(pageType));
    const service = new NoteTagService({
      resolveTrashTarget: vi.fn(() => readyTarget(assertCurrent)), render
    } as never, { open: vi.fn(() => openedNote(pageType)), save } as never, () => new Date("2026-07-30T12:00:00.000Z"));

    await expect(service.add("reader_owner", request)).resolves.toMatchObject({
      ...request,
      status: "committed",
      operationId: "op_20260730_addtag12345678",
      render: { summary: { pageType }, tagging: { tags: ["Research note"] } }
    });
    expect(assertCurrent).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.stringMatching(/^noteeditreq_[a-f0-9]{32}$/u),
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      expectedRevisionId: `sha256:${"a".repeat(64)}`,
      markdown: expect.stringContaining('tags: ["Research note"]')
    }));
    expect(render).toHaveBeenCalledWith({ pageId: request.currentPageId }, "reader_owner");
  });

  it("fails before mutation for stale identity, duplicate tags, and the twelve-tag limit", async () => {
    const save = vi.fn(() => ({ status: "failed" as const }));
    const stale = new NoteTagService({
      resolveTrashTarget: vi.fn(() => readyTarget(() => false)), render: vi.fn()
    } as never, { open: vi.fn(() => openedNote()), save } as never);
    await expect(stale.add("reader_owner", request)).resolves.toEqual({ ...request, status: "stale" });
    expect(save).not.toHaveBeenCalled();

    for (const markdown of [
      openedNote().markdown.replace("source_ids: []", 'tags: ["Research note"]\nsource_ids: []'),
      openedNote().markdown.replace("source_ids: []", `tags: ${JSON.stringify(Array.from({ length: 12 }, (_, index) => `tag-${index}`))}\nsource_ids: []`)
    ]) {
      const editorSave = vi.fn(() => ({ status: "failed" as const }));
      const service = new NoteTagService({
        resolveTrashTarget: vi.fn(() => readyTarget(() => true)), render: vi.fn()
      } as never, { open: vi.fn(() => ({ ...openedNote(), markdown })), save: editorSave } as never);
      await expect(service.add("reader_owner", request)).resolves.toEqual({ ...request, status: "ineligible" });
      expect(editorSave).not.toHaveBeenCalled();
    }
  });

  it("rejects a post-write render that does not prove the exact tag", async () => {
    const service = new NoteTagService({
      resolveTrashTarget: vi.fn(() => readyTarget(() => true)),
      render: vi.fn(async () => ({ ...taggedRender(), tagging: { ...taggedRender().tagging, tags: [] } }))
    } as never, {
      open: vi.fn(() => openedNote()),
      save: vi.fn(() => ({
        status: "committed",
        requestId: "noteeditreq_internal",
        activeVaultId: request.activeVaultId,
        pageId: request.currentPageId,
        revisionId: `sha256:${"b".repeat(64)}`,
        renderIdentity: `sha256:${"c".repeat(64)}`,
        operationId: "op_20260730_addtag12345678"
      }))
    } as never);
    await expect(service.add("reader_owner", request)).resolves.toEqual({ ...request, status: "failed" });
  });

  it("removes one exact current tag and fails closed when the tag or Reader revision drifts", async () => {
    const assertCurrent = vi.fn(() => true);
    const save = vi.fn(() => ({
      status: "committed" as const, requestId: "noteeditreq_internal", activeVaultId: request.activeVaultId,
      pageId: request.currentPageId, revisionId: `sha256:${"b".repeat(64)}`,
      renderIdentity: `sha256:${"c".repeat(64)}`, operationId: "op_20260731_removetag123456"
    }));
    const service = new NoteTagService({ resolveTrashTarget: vi.fn(() => readyTarget(assertCurrent)),
      render: vi.fn(async () => ({ ...taggedRender(), tagging: { ...taggedRender().tagging, tags: [] } }))
    } as never, { open: vi.fn(() => ({ ...openedNote(), markdown: openedNote().markdown.replace("source_ids: []", 'tags: ["Research note"]\nsource_ids: []') })), save } as never,
    () => new Date("2026-07-31T12:00:00.000Z"));
    await expect(service.remove("reader_owner", removeRequest)).resolves.toMatchObject({
      ...removeRequest, status: "committed", operationId: "op_20260731_removetag123456", render: { tagging: { tags: [] } }
    });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.stringMatching(/^noteeditreq_[a-f0-9]{32}$/u),
      markdown: expect.stringContaining("tags: []")
    }));
    const absent = new NoteTagService({ resolveTrashTarget: vi.fn(() => readyTarget(() => true)), render: vi.fn() } as never,
      { open: vi.fn(() => openedNote()), save: vi.fn() } as never);
    await expect(absent.remove("reader_owner", removeRequest)).resolves.toEqual({ ...removeRequest, status: "ineligible" });
    const stale = new NoteTagService({ resolveTrashTarget: vi.fn(() => readyTarget(() => false)), render: vi.fn() } as never,
      { open: vi.fn(() => openedNote()), save: vi.fn() } as never);
    await expect(stale.remove("reader_owner", removeRequest)).resolves.toEqual({ ...removeRequest, status: "stale" });
  });
});

function readyTarget(assertCurrent: () => boolean) {
  return {
    status: "ready" as const,
    activeVaultId: request.activeVaultId,
    vaultPath: "/private/vault",
    pageId: request.currentPageId,
    pagePath: "wiki/tags.md",
    absolutePath: "/private/vault/wiki/tags.md",
    pageContentHash: `sha256:${"a".repeat(64)}`,
    title: "Tagged note",
    assertCurrent
  };
}

type TaxonomyPageType = "note" | "claim" | "question" | "concept" | "entity";

function openedNote(pageType: TaxonomyPageType = "note") {
  return {
    status: "opened" as const,
    activeVaultId: request.activeVaultId,
    pageId: request.currentPageId,
    revisionId: `sha256:${"a".repeat(64)}`,
    renderIdentity: `sha256:${"d".repeat(64)}`,
    markdown: `---\nid: "${request.currentPageId}"\nschema_version: 1\ntitle: "Tagged note"\ntype: "${pageType}"\ncreated_at: "2026-07-30T10:00:00.000Z"\nupdated_at: "2026-07-30T10:00:00.000Z"\nstatus: "active"\naliases: []\nsource_ids: []\n---\n\n# Tagged note\n\nKeep this body.\n`
  };
}

function taggedRender(pageType: TaxonomyPageType = "note") {
  return {
    summary: {
      pageId: request.currentPageId,
      title: "Tagged note",
      pageType,
      status: "active" as const,
      pagePath: "wiki/tags.md",
      createdAt: "2026-07-30T10:00:00.000Z",
      updatedAt: "2026-07-30T12:00:00.000Z",
      sourceIds: []
    },
    html: "<h1>Tagged note</h1>",
    byteSize: 128,
    renderContextId: "notectx_qrstuvwxyzabcdef",
    trashEligibility: { canTrash: true, revision: `noteeditrev_${"b".repeat(64)}` },
    archiveEligibility: { canArchive: true, revision: `noteeditrev_${"b".repeat(64)}` },
    tagging: { tags: ["Research note"], topics: [], canAdd: true, canEdit: true, revision: `noteeditrev_${"b".repeat(64)}` }
  };
}

function taxonomyRender(pageType: TaxonomyPageType = "note") {
  return { ...taggedRender(pageType), tagging: { ...taggedRender(pageType).tagging, tags: [...editRequest.tags], topics: [...editRequest.topics] } };
}
