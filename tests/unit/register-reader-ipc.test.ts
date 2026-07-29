import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";
import { registerReaderIpc } from "../../apps/desktop/src/main/register-reader-ipc";
import type { NotesService } from "../../apps/desktop/src/main/services/notes-service";
import type { ReaderSourceRevealService } from "../../apps/desktop/src/main/services/reader-source-reveal-service";

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

function makeHarness(notes: Partial<NotesService>, revealService?: Partial<ReaderSourceRevealService>) {
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
    }
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
      "notes.resolveInlineReference",
      "notes.openSourceReference",
      "notes.revealSource",
      "readerSelection.resolve",
      "readerSelection.submitAction",
      "readerSelection.submitLink",
      "readerSelection.submitTransform",
      "readerSelection.submitCreateNote",
      "readerSelection.currentProposal",
      "readerSelection.decideProposal"
    ]);
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
});
