import { describe, expect, it, vi } from "vitest";
import { NoteArchiveService } from "../../apps/desktop/src/main/services/note-archive-service";

const request = {
  apiVersion: 1 as const,
  requestId: "notearchivereq_abcdefghijklmnop",
  activeVaultId: "vault_20260730_archive",
  currentPageId: "page_20260730_archive",
  renderContextId: "noterenderctx_abcdefghijklmnop",
  expectedRevision: `noteeditrev_${"a".repeat(64)}`
};
const restoreRequest = {
  ...request,
  requestId: "noterestorereq_abcdefghijklmnop"
};

describe("NoteArchiveService", () => {
  it("archives one exact current Reader note and returns only the authoritative archived render", async () => {
    const assertCurrent = vi.fn(() => true);
    const save = vi.fn(() => ({
      status: "committed" as const,
      requestId: "noteeditreq_internalarchive",
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      revisionId: `sha256:${"b".repeat(64)}`,
      renderIdentity: `sha256:${"c".repeat(64)}`,
      operationId: "op_20260730_abcdefghijklmnop"
    }));
    const render = vi.fn(async () => archivedRender());
    const service = new NoteArchiveService({
      resolveTrashTarget: vi.fn(() => readyTarget(assertCurrent)),
      render
    } as never, { open: vi.fn(() => openedNote()), save } as never, () => new Date("2026-07-30T12:00:00.000Z"));

    const result = await service.archive("reader_owner", request);
    expect(result).toMatchObject({
      ...request,
      status: "committed",
      operationId: "op_20260730_abcdefghijklmnop",
      render: { summary: { status: "archived" }, archiveEligibility: { canArchive: false } }
    });
    expect(assertCurrent).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      requestId: expect.stringMatching(/^noteeditreq_[a-f0-9]{32}$/u),
      expectedRevisionId: `sha256:${"a".repeat(64)}`,
      markdown: expect.stringContaining("status: archived")
    }), "archive_page");
    expect(render).toHaveBeenCalledWith({ pageId: request.currentPageId }, "reader_owner");
  });

  it("fails before mutation for stale identity and rejects a non-authoritative post-write render", async () => {
    const save = vi.fn(() => ({ status: "failed" as const }));
    const stale = new NoteArchiveService({
      resolveTrashTarget: vi.fn(() => ({ status: "ready", ...readyTarget(() => false) })),
      render: vi.fn()
    } as never, { open: vi.fn(() => openedNote()), save } as never);
    await expect(stale.archive("reader_owner", request)).resolves.toEqual({ ...request, status: "stale" });
    expect(save).not.toHaveBeenCalled();

    const mismatched = new NoteArchiveService({
      resolveTrashTarget: vi.fn(() => readyTarget(() => true)),
      render: vi.fn(async () => ({ ...archivedRender(), summary: { ...archivedRender().summary, status: "active" } }))
    } as never, {
      open: vi.fn(() => openedNote()),
      save: vi.fn(() => ({
        status: "committed",
        requestId: "noteeditreq_internalarchive",
        activeVaultId: request.activeVaultId,
        pageId: request.currentPageId,
        revisionId: `sha256:${"b".repeat(64)}`,
        renderIdentity: `sha256:${"c".repeat(64)}`,
        operationId: "op_20260730_abcdefghijklmnop"
      }))
    } as never);
    await expect(mismatched.archive("reader_owner", request)).resolves.toEqual({ ...request, status: "failed" });
  });

  it("restores one exact archived note with a restore_page Operation and no duplicate mutation", async () => {
    const assertCurrent = vi.fn(() => true);
    const save = vi.fn(() => ({
      status: "committed" as const,
      requestId: "noteeditreq_internalrestore",
      activeVaultId: restoreRequest.activeVaultId,
      pageId: restoreRequest.currentPageId,
      revisionId: `sha256:${"b".repeat(64)}`,
      renderIdentity: `sha256:${"c".repeat(64)}`,
      operationId: "op_20260730_restorepage1234"
    }));
    const service = new NoteArchiveService({
      resolveTrashTarget: vi.fn(() => readyTarget(assertCurrent)),
      render: vi.fn(async () => activeRender())
    } as never, { open: vi.fn(() => openedArchivedNote()), save } as never, () => new Date("2026-07-30T13:00:00.000Z"));

    await expect(service.restore("reader_owner", restoreRequest)).resolves.toMatchObject({
      ...restoreRequest,
      status: "committed",
      operationId: "op_20260730_restorepage1234",
      render: { summary: { status: "active" }, restoreEligibility: { canRestore: false } }
    });
    expect(assertCurrent).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.stringMatching(/^noteeditreq_[a-f0-9]{32}$/u),
      expectedRevisionId: `sha256:${"a".repeat(64)}`,
      markdown: expect.stringContaining("status: active")
    }), "restore_page");
  });

  it("fails restore before mutation on stale identity or a non-archived source", async () => {
    const save = vi.fn(() => ({ status: "failed" as const }));
    const stale = new NoteArchiveService({
      resolveTrashTarget: vi.fn(() => readyTarget(() => false)), render: vi.fn()
    } as never, { open: vi.fn(() => openedArchivedNote()), save } as never);
    await expect(stale.restore("reader_owner", restoreRequest)).resolves.toEqual({ ...restoreRequest, status: "stale" });
    expect(save).not.toHaveBeenCalled();

    const ineligible = new NoteArchiveService({
      resolveTrashTarget: vi.fn(() => readyTarget(() => true)), render: vi.fn()
    } as never, { open: vi.fn(() => openedNote()), save } as never);
    await expect(ineligible.restore("reader_owner", restoreRequest)).resolves.toEqual({ ...restoreRequest, status: "ineligible" });
    expect(save).not.toHaveBeenCalled();
  });
});

function readyTarget(assertCurrent: () => boolean) {
  return {
    status: "ready" as const,
    activeVaultId: request.activeVaultId,
    vaultPath: "/private/vault",
    pageId: request.currentPageId,
    pagePath: "wiki/archive.md",
    absolutePath: "/private/vault/wiki/archive.md",
    pageContentHash: `sha256:${"a".repeat(64)}`,
    title: "Archive note",
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
    markdown: `---\nid: "${request.currentPageId}"\nschema_version: 1\ntitle: "Archive note"\ntype: "note"\ncreated_at: "2026-07-30T10:00:00.000Z"\nupdated_at: "2026-07-30T10:00:00.000Z"\nstatus: "active"\naliases: []\nsource_ids: []\n---\n\n# Archive note\n\nKeep this body.\n`
  };
}

function openedArchivedNote() {
  return {
    ...openedNote(),
    markdown: openedNote().markdown.replace("status: \"active\"", "status: archived")
  };
}

function archivedRender() {
  return {
    summary: {
      pageId: request.currentPageId,
      title: "Archive note",
      pageType: "note" as const,
      status: "archived" as const,
      pagePath: "wiki/archive.md",
      createdAt: "2026-07-30T10:00:00.000Z",
      updatedAt: "2026-07-30T12:00:00.000Z",
      sourceIds: []
    },
    html: "<h1>Archive note</h1>",
    byteSize: 128,
    renderContextId: "noterenderctx_qrstuvwxyzabcdef",
    trashEligibility: { canTrash: true, revision: `noteeditrev_${"b".repeat(64)}` },
    archiveEligibility: { canArchive: false, revision: `noteeditrev_${"b".repeat(64)}` },
    restoreEligibility: { canRestore: true, revision: `noteeditrev_${"b".repeat(64)}` }
  };
}

function activeRender() {
  return {
    ...archivedRender(),
    summary: { ...archivedRender().summary, status: "active" as const },
    archiveEligibility: { canArchive: true, revision: `noteeditrev_${"b".repeat(64)}` },
    restoreEligibility: { canRestore: false, revision: `noteeditrev_${"b".repeat(64)}` }
  };
}
