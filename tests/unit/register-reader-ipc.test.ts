import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";
import { registerReaderIpc } from "../../apps/desktop/src/main/register-reader-ipc";
import type { NotesService } from "../../apps/desktop/src/main/services/notes-service";
import type { ReaderSourceRevealService } from "../../apps/desktop/src/main/services/reader-source-reveal-service";
import type { ReaderSourceReconnectService } from "../../apps/desktop/src/main/services/reader-source-reconnect-service";
import type { NoteTrashService } from "../../apps/desktop/src/main/services/note-trash-service";
import type { NoteMergeService } from "../../apps/desktop/src/main/services/note-merge-service";
import type { NoteArchiveService } from "../../apps/desktop/src/main/services/note-archive-service";
import type { NoteTagService } from "../../apps/desktop/src/main/services/note-tag-service";
import type { NoteMarkdownImportService } from "../../apps/desktop/src/main/services/note-markdown-import-service";
import type { NoteRelateService } from "../../apps/desktop/src/main/services/note-relate-service";

type IpcHandler = (event: IpcMainInvokeEvent, request?: unknown) => unknown;

function makeSender(id: number): WebContents {
  const events = new EventEmitter();
  return {
    id,
    isDestroyed: vi.fn(() => false),
    once: events.once.bind(events),
    send: vi.fn()
  } as unknown as WebContents;
}

function makeHarness(
  notes: Partial<NotesService>,
  revealService?: Partial<ReaderSourceRevealService>,
  noteTrashService?: Partial<NoteTrashService>,
  onNoteTrashCommitted = vi.fn(),
  noteMergeService?: Partial<NoteMergeService>,
  reconnectService?: Partial<ReaderSourceReconnectService>,
  noteArchiveService?: Partial<NoteArchiveService>,
  onNoteArchiveCommitted = vi.fn(),
  noteMarkdownImportService?: Partial<NoteMarkdownImportService>,
  onNoteImported = vi.fn(),
  noteRelateService?: Partial<NoteRelateService>,
  noteTagService?: Partial<NoteTagService>
) {
  const handlers = new Map<string, IpcHandler>();
  registerReaderIpc({
    ipcMain: {
      handle: (channel, handler) => {
        handlers.set(channel, handler as IpcHandler);
      }
    } as Pick<IpcMain, "handle">,
    getNotesService: () => notes as NotesService,
    getReaderSelectionActionService: () => {
      throw new Error("Reader action service was not expected.");
    },
    getReaderSelectionProposalService: () => {
      throw new Error("Reader proposal service was not expected.");
    },
    getReaderSelectionCreateNoteService: () => {
      throw new Error("Reader create-note service was not expected.");
    },
    getReaderSourceRevealService: () => {
      if (revealService) return revealService as ReaderSourceRevealService;
      throw new Error("Reader source reveal service was not expected.");
    },
    getReaderSourceReconnectService: () => {
      if (reconnectService) return reconnectService as ReaderSourceReconnectService;
      throw new Error("Reader source reconnect service was not expected.");
    },
    getWindow: () => ({}) as never,
    showOpenDialog: async () => ({ canceled: false, filePaths: ["/private/replacement.txt"] }),
    getNoteTrashService: () => {
      if (noteTrashService) return noteTrashService as NoteTrashService;
      throw new Error("Note trash service was not expected.");
    },
    getNoteArchiveService: () => {
      if (noteArchiveService) return noteArchiveService as NoteArchiveService;
      throw new Error("Note archive service was not expected.");
    },
    getNoteTagService: () => {
      if (noteTagService) return noteTagService as NoteTagService;
      throw new Error("Note tag service was not expected.");
    },
    getNoteMergeService: () => {
      if (noteMergeService) return noteMergeService as NoteMergeService;
      throw new Error("Note merge service was not expected.");
    },
    getNoteRelateService: () => {
      if (noteRelateService) return noteRelateService as NoteRelateService;
      throw new Error("Note relate service was not expected.");
    },
    getNoteMarkdownImportService: () => {
      if (noteMarkdownImportService) return noteMarkdownImportService as NoteMarkdownImportService;
      throw new Error("Note Markdown import service was not expected.");
    },
    onNoteTrashCommitted,
    onNoteArchiveCommitted,
    onNoteRelated: onNoteArchiveCommitted,
    onNoteImported
  });
  return handlers;
}

describe("registerReaderIpc", () => {
  it("registers the bounded Notes and ReaderSelection channel owner", () => {
    const handlers = makeHarness({});
    expect([...handlers.keys()]).toEqual([
      "notes.get",
      "notes.render",
      "notes.openEditor",
      "notes.saveEditor",
      "notes.trashCurrent",
      "notes.listTrash",
      "notes.restoreTrash",
      "notes.archiveCurrent",
      "notes.restoreArchived",
      "notes.addTag",
      "notes.importMarkdown",
      "notes.merge",
      "notes.relate",
      "notes.resolveInlineReference",
      "notes.openSourceReference",
      "notes.revealSource",
      "notes.reconnectOriginalSource",
      "readerSelection.resolve",
      "readerSelection.submitAction",
      "readerSelection.submitLink",
      "readerSelection.submitTransform",
      "readerSelection.submitCreateNote",
      "readerSelection.currentProposal",
      "readerSelection.decideProposal"
    ]);
  });

  it("binds note tag addition to the tracked Reader owner and refreshes Activity only after commit", async () => {
    const request = {
      apiVersion: 1 as const,
      requestId: "noteaddtagreq_abcdefghijklmnop",
      activeVaultId: "vault_20260730_abcdefgh",
      currentPageId: "page_20260730_tagnote1",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      expectedRevision: `noteeditrev_${"a".repeat(32)}`,
      tag: "Research note"
    };
    const render = {
      summary: { pageId: request.currentPageId, title: "Tagged", pageType: "note", status: "active",
        pagePath: "wiki/tagged.md", createdAt: "2026-07-30T10:00:00.000Z",
        updatedAt: "2026-07-30T11:00:00.000Z", sourceIds: [] },
      html: "<h1>Tagged</h1>", byteSize: 64,
      renderContextId: "notectx_fedcba9876543210fedcba9876543210",
      tagging: { tags: [request.tag], canAdd: true, revision: `noteeditrev_${"b".repeat(32)}` }
    } as const;
    const add = vi.fn(async () => ({ ...request, status: "committed" as const,
      operationId: "op_20260730_noteaddtag123", render }));
    const refreshed = vi.fn();
    const handlers = makeHarness({ render: vi.fn(async () => render) }, undefined, undefined, vi.fn(),
      undefined, undefined, undefined, refreshed, undefined, vi.fn(), undefined, { add });
    const sender = makeSender(45);
    await handlers.get("notes.render")!({ sender } as IpcMainInvokeEvent, { pageId: request.currentPageId });
    await expect(handlers.get("notes.addTag")!({ sender } as IpcMainInvokeEvent, request))
      .resolves.toMatchObject({ status: "committed", operationId: "op_20260730_noteaddtag123" });
    expect(add).toHaveBeenCalledWith(expect.stringMatching(/^notes_owner_/u), request);
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it("binds note relation mutation to the tracked Reader owner and refreshes Activity after commit", async () => {
    const request = {
      apiVersion: 1 as const, requestId: "noterelatereq_abcdefghijklmnop",
      activeVaultId: "vault_20260730_abcdefgh", currentPageId: "page_20260730_relatesource",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      expectedRevision: `noteeditrev_${"a".repeat(64)}`, targetPageId: "page_20260730_relatetarget",
      expectedTargetUpdatedAt: "2026-07-30T10:00:00.000Z",
    };
    const render = {
      summary: { pageId: request.currentPageId, title: "Related", pageType: "note", status: "active",
        pagePath: "wiki/related.md", createdAt: "2026-07-30T09:00:00.000Z",
        updatedAt: "2026-07-30T11:00:00.000Z", sourceIds: [] },
      html: "<h1>Related</h1>", byteSize: 64,
      renderContextId: "notectx_fedcba9876543210fedcba9876543210",
    } as const;
    const relate = vi.fn(async () => ({ ...request, status: "committed" as const,
      operationId: "op_20260730_noterelate12345", render }));
    const refreshed = vi.fn();
    const handlers = makeHarness({ render: vi.fn(async () => render) }, undefined, undefined, vi.fn(),
      undefined, undefined, undefined, refreshed, undefined, vi.fn(), { relate });
    const sender = makeSender(43);
    await handlers.get("notes.render")!({ sender } as IpcMainInvokeEvent, { pageId: request.currentPageId });
    await expect(handlers.get("notes.relate")!({ sender } as IpcMainInvokeEvent, request))
      .resolves.toMatchObject({ ...request, status: "committed", operationId: "op_20260730_noterelate12345" });
    expect(relate).toHaveBeenCalledWith(expect.stringMatching(/^notes_owner_/u), request);
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it("binds current-note archive to the tracked Reader owner and refreshes Activity only after commit", async () => {
    const identity = {
      apiVersion: 1 as const,
      requestId: "notearchivereq_abcdefghijklmnop",
      activeVaultId: "vault_20260730_abcdefgh",
      currentPageId: "page_20260730_archivenote1",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      expectedRevision: `noteeditrev_${"a".repeat(32)}`
    };
    const renderResult = {
      summary: {
        pageId: identity.currentPageId,
        title: "Archived note",
        pageType: "note",
        status: "archived",
        pagePath: "wiki/archive-note.md",
        createdAt: "2026-07-30T10:00:00.000Z",
        updatedAt: "2026-07-30T12:00:00.000Z",
        sourceIds: []
      },
      html: "<h1>Archived note</h1>",
      byteSize: 64,
      renderContextId: "notectx_fedcba9876543210fedcba9876543210",
      trashEligibility: { canTrash: true, revision: `noteeditrev_${"b".repeat(32)}` },
      archiveEligibility: { canArchive: false, revision: `noteeditrev_${"b".repeat(32)}` }
    };
    const archive = vi.fn(async () => ({
      ...identity,
      status: "committed" as const,
      operationId: "op_20260730_archivenote1234",
      render: renderResult
    }));
    const refreshed = vi.fn();
    const handlers = makeHarness(
      { render: vi.fn(async () => renderResult) },
      undefined,
      undefined,
      vi.fn(),
      undefined,
      undefined,
      { archive },
      refreshed
    );
    const sender = makeSender(34);
    await handlers.get("notes.render")!({ sender } as IpcMainInvokeEvent, { pageId: identity.currentPageId });
    await expect(handlers.get("notes.archiveCurrent")!({ sender } as IpcMainInvokeEvent, identity))
      .resolves.toMatchObject({ status: "committed", operationId: "op_20260730_archivenote1234" });
    expect(archive).toHaveBeenCalledWith(expect.stringMatching(/^notes_owner_/u), identity);
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it("binds archived-note restore to the tracked Reader owner and refreshes Activity only after commit", async () => {
    const identity = {
      apiVersion: 1 as const,
      requestId: "noterestorereq_abcdefghijklmnop",
      activeVaultId: "vault_20260730_abcdefgh",
      currentPageId: "page_20260730_archivenote1",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      expectedRevision: `noteeditrev_${"a".repeat(32)}`
    };
    const renderResult = {
      summary: {
        pageId: identity.currentPageId, title: "Restored note", pageType: "note", status: "active",
        pagePath: "wiki/archive-note.md", createdAt: "2026-07-30T10:00:00.000Z",
        updatedAt: "2026-07-30T13:00:00.000Z", sourceIds: []
      },
      html: "<h1>Restored note</h1>", byteSize: 64,
      renderContextId: "notectx_fedcba9876543210fedcba9876543210",
      trashEligibility: { canTrash: true, revision: `noteeditrev_${"b".repeat(32)}` },
      archiveEligibility: { canArchive: true, revision: `noteeditrev_${"b".repeat(32)}` },
      restoreEligibility: { canRestore: false, revision: `noteeditrev_${"b".repeat(32)}` }
    } as const;
    const restore = vi.fn(async () => ({
      ...identity, status: "committed" as const,
      operationId: "op_20260730_restorepage1234", render: renderResult
    }));
    const refreshed = vi.fn();
    const handlers = makeHarness(
      { render: vi.fn(async () => renderResult) }, undefined, undefined, vi.fn(), undefined, undefined,
      { restore }, refreshed
    );
    const sender = makeSender(35);
    await handlers.get("notes.render")!({ sender } as IpcMainInvokeEvent, { pageId: identity.currentPageId });
    await expect(handlers.get("notes.restoreArchived")!({ sender } as IpcMainInvokeEvent, identity))
      .resolves.toMatchObject({ status: "committed", operationId: "op_20260730_restorepage1234" });
    expect(restore).toHaveBeenCalledWith(expect.stringMatching(/^notes_owner_/u), identity);
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it("binds current-note trash to the tracked Reader owner and refreshes only after commit", async () => {
    const renderContextId = "notectx_0123456789abcdef0123456789abcdef";
    const expectedRevision = `noteeditrev_${"a".repeat(32)}`;
    const identity = {
      apiVersion: 1,
      requestId: "notetrashreq_abcdefghijklmnop",
      activeVaultId: "vault_20260730_abcdefgh",
      currentPageId: "page_20260730_trashnote123",
      renderContextId,
      expectedRevision
    } as const;
    const render = vi.fn().mockResolvedValue({
      summary: {
        pageId: identity.currentPageId,
        title: "Trash note",
        pageType: "note",
        status: "active",
        pagePath: "wiki/trash-note.md",
        createdAt: "2026-07-30T10:00:00.000Z",
        updatedAt: "2026-07-30T10:00:00.000Z",
        sourceIds: []
      },
      html: "<h1>Trash note</h1>",
      byteSize: 20,
      renderContextId,
      trashEligibility: { canTrash: true, revision: expectedRevision }
    });
    const trash = vi.fn().mockReturnValue({
      ...identity,
      status: "committed",
      operationId: "op_20260730_trashnote1234",
      authority: {
        pageId: identity.currentPageId,
        pageState: "trashed",
        readerState: "closed",
        libraryPresence: "absent",
        canTrash: false
      }
    });
    const refreshed = vi.fn();
    const handlers = makeHarness({ render }, undefined, { trash }, refreshed);
    const sender = makeSender(31);
    await handlers.get("notes.render")!({ sender } as IpcMainInvokeEvent, { pageId: identity.currentPageId });

    expect(handlers.get("notes.trashCurrent")!({ sender } as IpcMainInvokeEvent, identity))
      .toMatchObject({ status: "committed", operationId: "op_20260730_trashnote1234" });
    expect(trash).toHaveBeenCalledWith(expect.stringMatching(/^notes_owner_/u), identity);
    expect(refreshed).toHaveBeenCalledTimes(1);

    const detachedSender = makeSender(33);
    await handlers.get("notes.render")!({ sender: detachedSender } as IpcMainInvokeEvent, { pageId: identity.currentPageId });
    vi.mocked(detachedSender.isDestroyed).mockReturnValueOnce(false).mockReturnValueOnce(true);
    expect(handlers.get("notes.trashCurrent")!({ sender: detachedSender } as IpcMainInvokeEvent, identity))
      .toEqual({ ...identity, status: "failed" });
    expect(refreshed).toHaveBeenCalledTimes(2);

    const unowned = makeHarness({}, undefined, { trash }, refreshed);
    expect(unowned.get("notes.trashCurrent")!({ sender: makeSender(32) } as IpcMainInvokeEvent, identity))
      .toEqual({ ...identity, status: "failed" });
    expect(trash).toHaveBeenCalledTimes(2);
  });

  it("lists pathless Trash summaries and restores one through the tracked Reader", async () => {
    const activeVaultId = "vault_20260730_abcdefgh";
    const pageId = "page_20260730_trashrestore1";
    const trashOperationId = "op_20260730_trashrestore1234";
    const expectedTrashRevision = `notetrashrev_${"a".repeat(64)}` as const;
    const list = vi.fn(() => ({
      apiVersion: 1 as const, requestId: "notetrashlistreq_abcdefghijklmnop", activeVaultId,
      status: "ready" as const,
      notes: [{ trashOperationId, expectedTrashRevision, pageId, title: "Restore me",
        trashedAt: "2026-07-30T12:00:00.000Z", canRestore: true as const }]
    }));
    const restore = vi.fn(() => ({ status: "committed" as const, operationId: "op_20260730_restored123456" }));
    const render = vi.fn(async () => ({
      summary: { pageId, title: "Restore me", pageType: "note" as const, status: "active" as const,
        pagePath: "wiki/restore-me.md", createdAt: "2026-07-30T10:00:00.000Z",
        updatedAt: "2026-07-30T12:00:00.000Z", sourceIds: [] },
      html: "<h1>Restore me</h1>", byteSize: 64,
      renderContextId: "notectx_fedcba9876543210fedcba9876543210"
    }));
    const refreshed = vi.fn();
    const handlers = makeHarness({ render }, undefined, { list, restore }, refreshed);
    const sender = makeSender(41);
    const listRequest = { apiVersion: 1 as const, requestId: "notetrashlistreq_abcdefghijklmnop", activeVaultId };
    expect(handlers.get("notes.listTrash")!({ sender } as IpcMainInvokeEvent, listRequest))
      .toMatchObject({ status: "ready", notes: [{ pageId, title: "Restore me" }] });
    const restoreRequest = { apiVersion: 1 as const, requestId: "notetrashrestorereq_abcdefghijklmnop",
      activeVaultId, pageId, trashOperationId, expectedTrashRevision };
    await expect(handlers.get("notes.restoreTrash")!({ sender } as IpcMainInvokeEvent, restoreRequest))
      .resolves.toMatchObject({ status: "committed", operationId: "op_20260730_restored123456",
        render: { summary: { pageId } } });
    expect(restore).toHaveBeenCalledWith(restoreRequest);
    expect(render).toHaveBeenCalledWith({ pageId }, expect.stringMatching(/^notes_owner_/u));
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it("renders authoritative survivor state only after a tracked note merge commits", async () => {
    const renderContextId = "notectx_0123456789abcdef0123456789abcdef";
    const request = {
      apiVersion: 1 as const,
      requestId: "notemergereq_abcdefghijklmnop",
      activeVaultId: "vault_20260730_abcdefgh",
      currentPageId: "page_20260730_mergesurvivor",
      renderContextId,
      expectedRevision: `noteeditrev_${"a".repeat(64)}`,
      targetPageId: "page_20260730_mergeabsorbed",
      expectedTargetUpdatedAt: "2026-07-30T10:00:00.000Z"
    };
    const renderResult = {
      summary: {
        pageId: request.currentPageId, title: "Merged note", pageType: "note", status: "active",
        pagePath: "wiki/merged.md", createdAt: "2026-07-30T09:00:00.000Z",
        updatedAt: "2026-07-30T10:01:00.000Z", sourceIds: []
      },
      html: "<h1>Merged note</h1>", byteSize: 100, renderContextId,
      trashEligibility: { canTrash: true, revision: `noteeditrev_${"b".repeat(64)}` }
    } as const;
    const render = vi.fn().mockResolvedValue(renderResult);
    const merge = vi.fn().mockReturnValue({ status: "committed", operationId: "op_20260730_notemerge123456" });
    const refreshed = vi.fn();
    const handlers = makeHarness({ render }, undefined, undefined, refreshed, { merge });
    const sender = makeSender(41);
    await handlers.get("notes.render")!({ sender } as IpcMainInvokeEvent, { pageId: request.currentPageId });

    await expect(handlers.get("notes.merge")!({ sender } as IpcMainInvokeEvent, request)).resolves.toMatchObject({
      ...request, status: "committed", operationId: "op_20260730_notemerge123456", render: renderResult
    });
    expect(merge).toHaveBeenCalledWith(expect.stringMatching(/^notes_owner_/u), request);
    expect(render).toHaveBeenLastCalledWith({ pageId: request.currentPageId }, expect.stringMatching(/^notes_owner_/u));
    expect(refreshed).toHaveBeenCalledTimes(1);

    const unowned = makeHarness({}, undefined, undefined, refreshed, { merge });
    await expect(unowned.get("notes.merge")!({ sender: makeSender(42) } as IpcMainInvokeEvent, request))
      .resolves.toEqual({ ...request, status: "stale" });
    expect(merge).toHaveBeenCalledTimes(1);
  });

  it("fails a Reader link closed before Agent submission without a tracked render owner", async () => {
    const handlers = makeHarness({});
    await expect(handlers.get("readerSelection.submitLink")!({ sender: makeSender(9) } as IpcMainInvokeEvent, {
      apiVersion: 1,
      requestId: "readerselaction_abcdefgh123456",
      action: "link",
      activeVaultId: "vault_20260728_abcdefgh",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      selection: {
        pageId: "page_20260728_readerlink12",
        pageContentHash: `sha256:${"a".repeat(64)}`,
        span: { unit: "utf8_bytes", start: 1, endExclusive: 2 },
        selectedContentHash: `sha256:${"b".repeat(64)}`
      },
      locale: "en",
      clientTurnId: "turn_20260728_readerlink12"
    })).resolves.toEqual({
      apiVersion: 1,
      requestId: "readerselaction_abcdefgh123456",
      status: "invalid",
      reason: "render_context_changed"
    });
  });

  it("fails closed when Markdown editor requests have no active Reader owner", async () => {
    const openEditor = vi.fn();
    const saveEditor = vi.fn();
    const handlers = makeHarness({ openEditor, saveEditor } as Partial<NotesService>);
    const identity = {
      apiVersion: 1,
      requestId: "noteeditreq_abcdefghijklmnop",
      activeVaultId: "vault_20260727_abcdefgh",
      pageId: "page_20260727_editor1234"
    } as const;

    expect(handlers.get("notes.openEditor")!({ sender: makeSender(10) } as IpcMainInvokeEvent, {
      ...identity,
      renderContextId: "notectx_0123456789abcdef0123456789abcdef"
    })).toEqual({ ...identity, status: "stale" });
    await expect(handlers.get("notes.saveEditor")!({ sender: makeSender(11) } as IpcMainInvokeEvent, {
      ...identity,
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      expectedRevision: `noteeditrev_${"a".repeat(32)}`,
      markdown: "# Draft\n"
    })).resolves.toEqual({ ...identity, status: "failed" });
    expect(openEditor).not.toHaveBeenCalled();
    expect(saveEditor).not.toHaveBeenCalled();
  });

  it("strictly parses Markdown editor requests and results under the tracked Reader owner", async () => {
    const renderContextId = "notectx_0123456789abcdef0123456789abcdef";
    const revision = `noteeditrev_${"a".repeat(32)}`;
    const identity = {
      apiVersion: 1,
      requestId: "noteeditreq_abcdefghijklmnop",
      activeVaultId: "vault_20260727_abcdefgh",
      pageId: "page_20260727_editor1234"
    } as const;
    const renderResult = {
      summary: {
        pageId: identity.pageId,
        title: "Editor",
        pageType: "note",
        status: "active",
        pagePath: "notes/editor.md",
        createdAt: "2026-07-27T10:00:00.000Z",
        updatedAt: "2026-07-27T10:00:00.000Z",
        sourceIds: []
      },
      html: "<h1>Editor</h1>",
      byteSize: 9,
      renderContextId
    } as const;
    const render = vi.fn().mockResolvedValue(renderResult);
    const openEditor = vi.fn().mockReturnValue({
      ...identity,
      status: "ready",
      renderContextId,
      revision,
      markdown: "# Editor\n"
    });
    const saveEditor = vi.fn().mockResolvedValue({
      ...identity,
      status: "stale",
      revision: `noteeditrev_${"b".repeat(32)}`
    });
    const handlers = makeHarness({ render, openEditor, saveEditor } as Partial<NotesService>);
    const sender = makeSender(12);
    await handlers.get("notes.render")!({ sender } as IpcMainInvokeEvent, { pageId: identity.pageId });

    const openRequest = { ...identity, renderContextId } as const;
    expect(handlers.get("notes.openEditor")!({ sender } as IpcMainInvokeEvent, openRequest))
      .toMatchObject({ status: "ready", revision, markdown: "# Editor\n" });
    const saveRequest = {
      ...identity,
      renderContextId,
      expectedRevision: revision,
      markdown: "# Updated\n"
    } as const;
    await expect(handlers.get("notes.saveEditor")!({ sender } as IpcMainInvokeEvent, saveRequest))
      .resolves.toMatchObject({ status: "stale", revision: `noteeditrev_${"b".repeat(32)}` });
    expect(openEditor).toHaveBeenCalledWith(expect.stringMatching(/^notes_owner_/u), openRequest);
    expect(saveEditor).toHaveBeenCalledWith(expect.stringMatching(/^notes_owner_/u), saveRequest);

    expect(() => handlers.get("notes.openEditor")!({ sender } as IpcMainInvokeEvent, {
      ...openRequest,
      path: "/private/editor.md"
    })).toThrow();
    saveEditor.mockResolvedValueOnce({ ...identity, status: "failed", error: "raw" });
    await expect(handlers.get("notes.saveEditor")!({ sender } as IpcMainInvokeEvent, saveRequest))
      .rejects.toThrow();

    saveEditor.mockResolvedValueOnce({
      ...identity,
      status: "committed",
      revision: `noteeditrev_${"c".repeat(32)}`,
      operationId: "op_20260727_editor1234",
      render: renderResult
    });
    vi.mocked(sender.isDestroyed).mockReturnValueOnce(false).mockReturnValueOnce(true);
    await expect(handlers.get("notes.saveEditor")!({ sender } as IpcMainInvokeEvent, saveRequest))
      .resolves.toEqual({ ...identity, status: "failed" });
  });

  it("returns body-free stale before a renderer owns a render context", () => {
    const openSourceReference = vi.fn();
    const handlers = makeHarness({ openSourceReference } as Partial<NotesService>);
    const handler = handlers.get("notes.openSourceReference")!;

    expect(handler({ sender: makeSender(1) } as IpcMainInvokeEvent, {
      apiVersion: 1,
      requestId: "noteref_abcdefghijklmnop",
      activeVaultId: "vault_20260709_abcdefgh",
      currentPageId: "page_20260709_current1234",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      sourceId: "src_20260709_source1234"
    })).toEqual({
      apiVersion: 1,
      requestId: "noteref_abcdefghijklmnop",
      status: "stale"
    });
    expect(openSourceReference).not.toHaveBeenCalled();
  });

  it("parses both sides of the owned saved-source request", async () => {
    const render = vi.fn().mockResolvedValue({
      summary: {
        pageId: "page_20260709_current1234",
        title: "Current",
        pageType: "note",
        pagePath: "wiki/current.md",
        tags: [],
        aliases: [],
        sourceIds: [],
        status: "active",
        updatedAt: "2026-07-09T12:00:00.000Z"
      },
      html: "<p>Current</p>",
      byteSize: 7,
      renderContextId: "notectx_0123456789abcdef0123456789abcdef"
    });
    const openSourceReference = vi.fn().mockReturnValue({
      apiVersion: 1,
      requestId: "noteref_abcdefghijklmnop",
      status: "resolved",
      target: { pageId: "page_20260709_source1234" }
    });
    const handlers = makeHarness({ render, openSourceReference } as Partial<NotesService>);
    const sender = makeSender(2);
    await handlers.get("notes.render")!({ sender } as IpcMainInvokeEvent, {
      pageId: "page_20260709_current1234"
    });
    const request = {
      apiVersion: 1,
      requestId: "noteref_abcdefghijklmnop",
      activeVaultId: "vault_20260709_abcdefgh",
      currentPageId: "page_20260709_current1234",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      sourceId: "src_20260709_source1234"
    } as const;

    expect(handlers.get("notes.openSourceReference")!({ sender } as IpcMainInvokeEvent, request))
      .toEqual({
        apiVersion: 1,
        requestId: request.requestId,
        status: "resolved",
        target: { pageId: "page_20260709_source1234" }
      });
    expect(openSourceReference).toHaveBeenCalledWith(expect.stringMatching(/^notes_owner_/u), request);
    expect(() => handlers.get("notes.openSourceReference")!({ sender } as IpcMainInvokeEvent, {
      ...request,
      path: "/private/source.md"
    })).toThrow();
  });

  it("rejects unsafe service output at the IPC result boundary", async () => {
    const render = vi.fn().mockResolvedValue({
      summary: {
        pageId: "page_20260709_current1234",
        title: "Current",
        pageType: "note",
        pagePath: "wiki/current.md",
        tags: [],
        aliases: [],
        sourceIds: [],
        status: "active",
        updatedAt: "2026-07-09T12:00:00.000Z"
      },
      html: "<p>Current</p>",
      byteSize: 7,
      renderContextId: "notectx_0123456789abcdef0123456789abcdef"
    });
    const handlers = makeHarness({
      render,
      openSourceReference: vi.fn().mockReturnValue({
        apiVersion: 1,
        requestId: "noteref_abcdefghijklmnop",
        status: "not_found",
        path: "/private/source.md"
      })
    } as Partial<NotesService>);
    const sender = makeSender(3);
    await handlers.get("notes.render")!({ sender } as IpcMainInvokeEvent, {
      pageId: "page_20260709_current1234"
    });

    expect(() => handlers.get("notes.openSourceReference")!({ sender } as IpcMainInvokeEvent, {
      apiVersion: 1,
      requestId: "noteref_abcdefghijklmnop",
      activeVaultId: "vault_20260709_abcdefgh",
      currentPageId: "page_20260709_current1234",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      sourceId: "src_20260709_source1234"
    })).toThrow();
  });

  it("binds source reveal to the tracked Reader owner and strict result identity", async () => {
    const render = vi.fn().mockResolvedValue({
      summary: {
        pageId: "page_20260729_current1234", title: "Current", pageType: "note",
        pagePath: "wiki/current.md", sourceIds: ["src_20260729_source1234"],
        status: "active", updatedAt: "2026-07-29T12:00:00.000Z"
      },
      html: "<p>Current</p>", byteSize: 7,
      renderContextId: "notectx_0123456789abcdef0123456789abcdef"
    });
    const reveal = vi.fn(async (_ownerId: string, request: unknown) => ({
      ...(request as object), status: "revealed"
    }));
    const handlers = makeHarness({ render } as Partial<NotesService>, { reveal });
    const sender = makeSender(15);
    await handlers.get("notes.render")!({ sender } as IpcMainInvokeEvent, {
      pageId: "page_20260729_current1234"
    });
    const request = {
      apiVersion: 1, requestId: "notesourcereveal_abcdefghijklmnop",
      activeVaultId: "vault_20260729_abcdefgh",
      currentPageId: "page_20260729_current1234",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      sourceId: "src_20260729_source1234"
    } as const;

    await expect(handlers.get("notes.revealSource")!({ sender } as IpcMainInvokeEvent, request))
      .resolves.toEqual({ ...request, status: "revealed" });
    expect(reveal).toHaveBeenCalledWith(expect.stringMatching(/^notes_owner_/u), request);
    await expect(handlers.get("notes.revealSource")!({ sender: makeSender(16) } as IpcMainInvokeEvent, request))
      .resolves.toEqual({ ...request, status: "stale" });
  });

  it("binds source reconnect to the tracked Reader owner and Main-owned picker", async () => {
    const render = vi.fn().mockResolvedValue({
      summary: {
        pageId: "page_20260730_current1234", title: "Current", pageType: "note",
        pagePath: "wiki/current.md", sourceIds: ["src_20260730_source1234"],
        status: "active", updatedAt: "2026-07-30T12:00:00.000Z"
      },
      html: "<p>Current</p>", byteSize: 7,
      renderContextId: "notectx_0123456789abcdef0123456789abcdef"
    });
    const reconnect = vi.fn(async (_ownerId: string, request: any, picker: { pick(): Promise<string | undefined> }) => ({
      ...request,
      status: await picker.pick() ? "cancelled" : "failed"
    }));
    const handlers = makeHarness(
      { render } as Partial<NotesService>,
      undefined,
      undefined,
      vi.fn(),
      undefined,
      { reconnect }
    );
    const sender = makeSender(30);
    await handlers.get("notes.render")!({ sender } as IpcMainInvokeEvent, {
      pageId: "page_20260730_current1234"
    });
    const reconnectRequest = {
      apiVersion: 1, requestId: "notesourcereconnect_abcdefghijklmnop",
      activeVaultId: "vault_20260730_abcdefgh",
      currentPageId: "page_20260730_current1234",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      sourceId: "src_20260730_source1234"
    } as const;

    await expect(handlers.get("notes.reconnectOriginalSource")!(
      { sender } as IpcMainInvokeEvent,
      reconnectRequest
    )).resolves.toEqual({ ...reconnectRequest, status: "cancelled" });
    expect(reconnect).toHaveBeenCalledWith(
      expect.stringMatching(/^notes_owner_/u),
      reconnectRequest,
      expect.objectContaining({ pick: expect.any(Function) })
    );
  });

  it("imports one Markdown note through the Main picker and refreshes only after an authoritative commit", async () => {
    const identity = {
      apiVersion: 1 as const,
      requestId: "noteimport_abcdefghijklmnop",
      activeVaultId: "vault_20260730_abcdefgh"
    };
    const render = {
      summary: {
        pageId: "page_20260730_imported1234",
        title: "Imported",
        pageType: "note" as const,
        status: "active" as const,
        pagePath: "wiki/generated/2026/page_20260730_imported1234.md",
        createdAt: "2026-07-30T12:00:00.000Z",
        updatedAt: "2026-07-30T12:00:00.000Z",
        sourceIds: []
      },
      html: "<h1>Imported</h1>",
      byteSize: 64,
      renderContextId: "notectx_0123456789abcdef0123456789abcdef"
    };
    const importMarkdown = vi.fn(async (_ownerId: string, request: typeof identity, picker: { pick(): Promise<string | undefined> }) => {
      expect(await picker.pick()).toBe("/private/replacement.txt");
      return { ...request, status: "imported" as const, operationId: "op_20260730_imported1234", render };
    });
    const refreshed = vi.fn();
    const handlers = makeHarness(
      {}, undefined, undefined, vi.fn(), undefined, undefined, undefined, vi.fn(),
      { importMarkdown }, refreshed
    );
    const sender = makeSender(44);
    await expect(handlers.get("notes.importMarkdown")!({ sender } as IpcMainInvokeEvent, identity))
      .resolves.toMatchObject({ status: "imported", operationId: "op_20260730_imported1234" });
    expect(importMarkdown).toHaveBeenCalledWith(
      expect.stringMatching(/^notes_owner_/u),
      identity,
      expect.objectContaining({ pick: expect.any(Function) })
    );
    expect(refreshed).toHaveBeenCalledTimes(1);
  });
});
