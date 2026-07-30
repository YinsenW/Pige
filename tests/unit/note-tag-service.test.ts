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

describe("NoteTagService", () => {
  it("atomically replaces the exact note tags and topics through one revision-bound editor operation", async () => {
    const assertCurrent = vi.fn(() => true);
    const save = vi.fn(() => ({ status: "committed" as const, requestId: "noteeditreq_internal",
      activeVaultId: request.activeVaultId, pageId: request.currentPageId, revisionId: `sha256:${"b".repeat(64)}`,
      renderIdentity: `sha256:${"c".repeat(64)}`, operationId: "op_20260731_taxonomy123456" }));
    const service = new NoteTagService({ resolveTrashTarget: vi.fn(() => readyTarget(assertCurrent)),
      render: vi.fn(async () => taxonomyRender()) } as never, { open: vi.fn(() => openedNote()), save } as never,
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
  it("adds one canonical tag through the current Reader revision and returns the authoritative render", async () => {
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
    const render = vi.fn(async () => taggedRender());
    const service = new NoteTagService({
      resolveTrashTarget: vi.fn(() => readyTarget(assertCurrent)), render
    } as never, { open: vi.fn(() => openedNote()), save } as never, () => new Date("2026-07-30T12:00:00.000Z"));

    await expect(service.add("reader_owner", request)).resolves.toMatchObject({
      ...request,
      status: "committed",
      operationId: "op_20260730_addtag12345678",
      render: { tagging: { tags: ["Research note"] } }
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

function openedNote() {
  return {
    status: "opened" as const,
    activeVaultId: request.activeVaultId,
    pageId: request.currentPageId,
    revisionId: `sha256:${"a".repeat(64)}`,
    renderIdentity: `sha256:${"d".repeat(64)}`,
    markdown: `---\nid: "${request.currentPageId}"\nschema_version: 1\ntitle: "Tagged note"\ntype: "note"\ncreated_at: "2026-07-30T10:00:00.000Z"\nupdated_at: "2026-07-30T10:00:00.000Z"\nstatus: "active"\naliases: []\nsource_ids: []\n---\n\n# Tagged note\n\nKeep this body.\n`
  };
}

function taggedRender() {
  return {
    summary: {
      pageId: request.currentPageId,
      title: "Tagged note",
      pageType: "note" as const,
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

function taxonomyRender() {
  return { ...taggedRender(), tagging: { ...taggedRender().tagging, tags: [...editRequest.tags], topics: [...editRequest.topics] } };
}
