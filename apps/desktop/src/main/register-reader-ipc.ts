import { randomUUID } from "node:crypto";
import type { BrowserWindow, IpcMain, OpenDialogOptions, WebContents } from "electron";
import type {
  NoteGetRequest,
  NoteEditorOpenRequest,
  NoteEditorOpenResult,
  NoteEditorSaveRequest,
  NoteEditorSaveResult,
  NoteMergeRequest,
  NoteMergeResult,
  NoteRelateRequest,
  NoteRelateResult,
  NoteImportMarkdownRequest,
  NoteImportMarkdownResult,
  NoteOpenSourceReferenceRequest,
  NoteReconnectOriginalSourceRequest,
  NoteRevealSourceRequest,
  NoteRenderRequest,
  NoteArchiveCurrentRequest,
  NoteArchiveCurrentResult,
  NoteRestoreArchivedRequest,
  NoteRestoreArchivedResult,
  NoteAddTagRequest,
  NoteAddTagResult,
  NoteTrashCurrentRequest,
  NoteTrashCurrentResult,
  NoteResolveInlineReferenceRequest,
  ReaderSelectionActionRequest,
  ReaderSelectionCreateNoteRequest,
  ReaderSelectionProposalDecisionRequest,
  ReaderSelectionProposalGetRequest,
  ReaderSelectionResolveRequest,
  ReaderSelectionTransformRequest
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  NoteEditorOpenRequestSchema,
  NoteEditorOpenResultSchema,
  NoteEditorSaveRequestSchema,
  NoteEditorSaveResultSchema,
  NOTE_MERGE_CHANNEL,
  NoteMergeRequestSchema,
  NoteMergeResultSchema,
  NOTE_RELATE_CHANNEL,
  NoteRelateRequestSchema,
  NoteRelateResultSchema,
  NOTE_IMPORT_MARKDOWN_CHANNEL,
  NoteImportMarkdownRequestSchema,
  NoteImportMarkdownResultSchema,
  NoteOpenSourceReferenceRequestSchema,
  NoteOpenSourceReferenceResultSchema,
  NOTE_RECONNECT_ORIGINAL_SOURCE_CHANNEL,
  NoteReconnectOriginalSourceRequestSchema,
  NoteReconnectOriginalSourceResultSchema,
  NoteRevealSourceRequestSchema,
  NoteRevealSourceResultSchema,
  NOTE_ARCHIVE_CURRENT_CHANNEL,
  NoteArchiveCurrentRequestSchema,
  NoteArchiveCurrentResultSchema,
  NOTE_RESTORE_ARCHIVED_CHANNEL,
  NoteRestoreArchivedRequestSchema,
  NoteRestoreArchivedResultSchema,
  NOTE_ADD_TAG_CHANNEL,
  NoteAddTagRequestSchema,
  NoteAddTagResultSchema,
  NoteResolveInlineReferenceRequestSchema,
  NoteResolveInlineReferenceResultSchema,
  NoteTrashCurrentRequestSchema,
  NoteTrashCurrentResultSchema,
  ReaderSelectionActionRequestSchema,
  ReaderSelectionActionResultSchema,
  ReaderSelectionCreateNoteRequestSchema,
  ReaderSelectionCreateNoteResultSchema,
  ReaderSelectionLinkRequestSchema,
  ReaderSelectionLinkResultSchema,
  ReaderSelectionProposalDecisionRequestSchema,
  ReaderSelectionProposalDecisionResultSchema,
  ReaderSelectionProposalGetRequestSchema,
  ReaderSelectionProposalGetResultSchema,
  ReaderSelectionResolveRequestSchema,
  ReaderSelectionResolveResultSchema,
  ReaderSelectionTransformRequestSchema,
  ReaderSelectionTransformResultSchema
} from "@pige/schemas";
import { AgentTurnDraftPublisher } from "./services/agent-turn-draft-publisher";
import type { NotesService } from "./services/notes-service";
import type { ReaderSelectionActionService } from "./services/reader-selection-action-service";
import type { ReaderSelectionProposalService } from "./services/reader-selection-proposal-service";
import type { ReaderSelectionCreateNoteActionService } from "./services/reader-selection-create-note-service";
import type { ReaderSourceRevealService } from "./services/reader-source-reveal-service";
import type { ReaderSourceReconnectService } from "./services/reader-source-reconnect-service";
import type { NoteTrashService } from "./services/note-trash-service";
import type { NoteArchiveService } from "./services/note-archive-service";
import type { NoteTagService } from "./services/note-tag-service";
import type { NoteMergeService } from "./services/note-merge-service";
import type { NoteRelateService } from "./services/note-relate-service";
import type { NoteMarkdownImportService } from "./services/note-markdown-import-service";

interface RegisterReaderIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly getNotesService: () => NotesService;
  readonly getReaderSelectionActionService: () => ReaderSelectionActionService;
  readonly getReaderSelectionProposalService: () => ReaderSelectionProposalService;
  readonly getReaderSelectionCreateNoteService: () => ReaderSelectionCreateNoteActionService;
  readonly getReaderSourceRevealService: () => ReaderSourceRevealService;
  readonly getReaderSourceReconnectService: () => ReaderSourceReconnectService;
  readonly getWindow: (sender: WebContents) => BrowserWindow | undefined;
  readonly showOpenDialog: (window: BrowserWindow, options: OpenDialogOptions) => Promise<{
    readonly canceled: boolean;
    readonly filePaths: readonly string[];
  }>;
  readonly getNoteTrashService: () => NoteTrashService;
  readonly getNoteArchiveService: () => NoteArchiveService;
  readonly getNoteTagService: () => NoteTagService;
  readonly getNoteMergeService: () => NoteMergeService;
  readonly getNoteRelateService: () => NoteRelateService;
  readonly getNoteMarkdownImportService: () => NoteMarkdownImportService;
  readonly onNoteTrashCommitted: () => void;
  readonly onNoteArchiveCommitted: () => void;
  readonly onNoteRelated: () => void;
  readonly onNoteImported: () => void;
}

function failedEditorOpen(request: NoteEditorOpenRequest): NoteEditorOpenResult {
  return {
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    pageId: request.pageId,
    status: "failed"
  };
}

function staleEditorOpen(request: NoteEditorOpenRequest): NoteEditorOpenResult {
  return { ...failedEditorOpen(request), status: "stale" };
}

function failedEditorSave(request: NoteEditorSaveRequest): NoteEditorSaveResult {
  return {
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    pageId: request.pageId,
    status: "failed"
  };
}

function assertEditorResultIdentity(
  request: NoteEditorOpenRequest | NoteEditorSaveRequest,
  result: NoteEditorOpenResult | NoteEditorSaveResult
): void {
  if (
    result.requestId !== request.requestId ||
    result.activeVaultId !== request.activeVaultId ||
    result.pageId !== request.pageId
  ) {
    throw new Error("Note editor response identity did not match the request.");
  }
}

export function registerReaderIpc(options: RegisterReaderIpcOptions): void {
  const notesTrackedSenders = new Map<number, string>();

  const trackNotesSender = (sender: WebContents): string => {
    const existing = notesTrackedSenders.get(sender.id);
    if (existing) return existing;
    const ownerId = `notes_owner_${randomUUID()}`;
    notesTrackedSenders.set(sender.id, ownerId);
    sender.once("destroyed", () => {
      notesTrackedSenders.delete(sender.id);
      options.getNotesService().releaseOwner(ownerId);
    });
    return ownerId;
  };

  options.ipcMain.handle("notes.get", (_event, request: NoteGetRequest) =>
    options.getNotesService().get(request)
  );
  options.ipcMain.handle("notes.render", (event, request: NoteRenderRequest) => {
    const sender = event.sender;
    const ownerId = trackNotesSender(sender);
    return options.getNotesService().render(request, ownerId).then((result) => {
      if (sender.isDestroyed() || notesTrackedSenders.get(sender.id) !== ownerId) {
        options.getNotesService().releaseOwner(ownerId);
        throw new PigeDomainError(
          "note_render_stale",
          "The Reader owner changed while the page was rendered."
        );
      }
      return result;
    });
  });
  options.ipcMain.handle("notes.openEditor", (event, request: unknown) => {
    const parsed = NoteEditorOpenRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) return staleEditorOpen(parsed);

    let rawResult: NoteEditorOpenResult;
    try {
      rawResult = options.getNotesService().openEditor(ownerId, parsed);
    } catch {
      return failedEditorOpen(parsed);
    }
    const result = NoteEditorOpenResultSchema.parse(rawResult);
    assertEditorResultIdentity(parsed, result);
    return notesTrackedSenders.get(event.sender.id) === ownerId && !event.sender.isDestroyed()
      ? result
      : staleEditorOpen(parsed);
  });
  options.ipcMain.handle("notes.saveEditor", async (event, request: unknown) => {
    const parsed = NoteEditorSaveRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) return failedEditorSave(parsed);

    let rawResult: NoteEditorSaveResult;
    try {
      rawResult = await options.getNotesService().saveEditor(ownerId, parsed);
    } catch {
      return failedEditorSave(parsed);
    }
    const result = NoteEditorSaveResultSchema.parse(rawResult);
    assertEditorResultIdentity(parsed, result);
    return notesTrackedSenders.get(event.sender.id) === ownerId && !event.sender.isDestroyed()
      ? result
      : failedEditorSave(parsed);
  });
  options.ipcMain.handle("notes.trashCurrent", (event, request: unknown) => {
    const parsed = NoteTrashCurrentRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) {
      return NoteTrashCurrentResultSchema.parse({ ...parsed, status: "failed" });
    }
    let rawResult: NoteTrashCurrentResult;
    try {
      rawResult = options.getNoteTrashService().trash(ownerId, parsed);
    } catch {
      rawResult = { ...parsed, status: "failed" };
    }
    const result = NoteTrashCurrentResultSchema.parse(rawResult);
    if (result.status === "committed") options.onNoteTrashCommitted();
    if (notesTrackedSenders.get(event.sender.id) !== ownerId || event.sender.isDestroyed()) {
      return NoteTrashCurrentResultSchema.parse({ ...parsed, status: "failed" });
    }
    return result;
  });
  options.ipcMain.handle(NOTE_ARCHIVE_CURRENT_CHANNEL, async (event, request: unknown) => {
    const parsed = NoteArchiveCurrentRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) {
      return NoteArchiveCurrentResultSchema.parse({ ...parsed, status: "failed" });
    }
    let rawResult: NoteArchiveCurrentResult;
    try {
      rawResult = await options.getNoteArchiveService().archive(ownerId, parsed);
    } catch {
      rawResult = { ...parsed, status: "failed" };
    }
    const result = NoteArchiveCurrentResultSchema.parse(rawResult);
    if (result.status === "committed") options.onNoteRelated();
    if (notesTrackedSenders.get(event.sender.id) !== ownerId || event.sender.isDestroyed()) {
      return NoteArchiveCurrentResultSchema.parse({ ...parsed, status: "failed" });
    }
    return result;
  });
  options.ipcMain.handle(NOTE_RESTORE_ARCHIVED_CHANNEL, async (event, request: unknown) => {
    const parsed = NoteRestoreArchivedRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) {
      return NoteRestoreArchivedResultSchema.parse({ ...parsed, status: "failed" });
    }
    let rawResult: NoteRestoreArchivedResult;
    try {
      rawResult = await options.getNoteArchiveService().restore(ownerId, parsed);
    } catch {
      rawResult = { ...parsed, status: "failed" };
    }
    const result = NoteRestoreArchivedResultSchema.parse(rawResult);
    if (result.status === "committed") options.onNoteRelated();
    if (notesTrackedSenders.get(event.sender.id) !== ownerId || event.sender.isDestroyed()) {
      return NoteRestoreArchivedResultSchema.parse({ ...parsed, status: "failed" });
    }
    return result;
  });
  options.ipcMain.handle(NOTE_ADD_TAG_CHANNEL, async (event, request: unknown) => {
    const parsed = NoteAddTagRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) {
      return NoteAddTagResultSchema.parse({ ...parsed, status: "failed" });
    }
    let rawResult: NoteAddTagResult;
    try {
      rawResult = await options.getNoteTagService().add(ownerId, parsed);
    } catch {
      rawResult = { ...parsed, status: "failed" };
    }
    const result = NoteAddTagResultSchema.parse(rawResult);
    if (result.status === "committed") options.onNoteRelated();
    return notesTrackedSenders.get(event.sender.id) === ownerId && !event.sender.isDestroyed()
      ? result
      : NoteAddTagResultSchema.parse({ ...parsed, status: "failed" });
  });
  options.ipcMain.handle(NOTE_IMPORT_MARKDOWN_CHANNEL, async (event, request: unknown): Promise<NoteImportMarkdownResult> => {
    const parsed = NoteImportMarkdownRequestSchema.parse(request) as NoteImportMarkdownRequest;
    const ownerId = trackNotesSender(event.sender);
    const window = options.getWindow(event.sender);
    if (event.sender.isDestroyed() || !window) {
      return NoteImportMarkdownResultSchema.parse({ ...parsed, status: "stale" });
    }
    const result = await options.getNoteMarkdownImportService().importMarkdown(ownerId, parsed, {
      pick: async () => {
        const selection = await options.showOpenDialog(window, {
          title: "Import Markdown note",
          properties: ["openFile"],
          filters: [{ name: "Markdown", extensions: ["md"] }]
        });
        return selection.canceled || selection.filePaths.length !== 1 ? undefined : selection.filePaths[0];
      }
    });
    if (notesTrackedSenders.get(event.sender.id) !== ownerId || event.sender.isDestroyed()) {
      return NoteImportMarkdownResultSchema.parse({ ...parsed, status: "stale" });
    }
    if (result.status === "imported") options.onNoteImported();
    return NoteImportMarkdownResultSchema.parse(result);
  });
  options.ipcMain.handle(NOTE_MERGE_CHANNEL, async (event, request: unknown): Promise<NoteMergeResult> => {
    const parsed = NoteMergeRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) return NoteMergeResultSchema.parse({ ...parsed, status: "stale" });
    const result = options.getNoteMergeService().merge(ownerId, parsed);
    if (result.status !== "committed") return NoteMergeResultSchema.parse({ ...parsed, status: result.status });
    try {
      const render = await options.getNotesService().render({ pageId: parsed.currentPageId }, ownerId);
      if (!render.renderContextId || notesTrackedSenders.get(event.sender.id) !== ownerId || event.sender.isDestroyed()) {
        return NoteMergeResultSchema.parse({ ...parsed, status: "failed" });
      }
      options.onNoteTrashCommitted();
      return NoteMergeResultSchema.parse({ ...parsed, status: "committed", operationId: result.operationId, render });
    } catch {
      return NoteMergeResultSchema.parse({ ...parsed, status: "failed" });
    }
  });
  options.ipcMain.handle(NOTE_RELATE_CHANNEL, async (event, request: unknown): Promise<NoteRelateResult> => {
    const parsed = NoteRelateRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) {
      return NoteRelateResultSchema.parse({ ...parsed, status: "stale" });
    }
    const result = await options.getNoteRelateService().relate(ownerId, parsed);
    if (result.status === "committed") options.onNoteArchiveCommitted();
    return notesTrackedSenders.get(event.sender.id) === ownerId && !event.sender.isDestroyed()
      ? NoteRelateResultSchema.parse(result)
      : NoteRelateResultSchema.parse({ ...parsed, status: "stale" });
  });
  options.ipcMain.handle("notes.resolveInlineReference", (
    event,
    request: NoteResolveInlineReferenceRequest
  ) => {
    const parsed = NoteResolveInlineReferenceRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    return NoteResolveInlineReferenceResultSchema.parse(
      ownerId === undefined
        ? { apiVersion: 1, requestId: parsed.requestId, status: "stale", scope: "render_context" }
        : options.getNotesService().resolveInlineReference(ownerId, parsed)
    );
  });
  options.ipcMain.handle("notes.openSourceReference", (
    event,
    request: NoteOpenSourceReferenceRequest
  ) => {
    const parsed = NoteOpenSourceReferenceRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    return NoteOpenSourceReferenceResultSchema.parse(
      ownerId === undefined
        ? { apiVersion: 1, requestId: parsed.requestId, status: "stale" }
        : options.getNotesService().openSourceReference(ownerId, parsed)
    );
  });
  options.ipcMain.handle("notes.revealSource", async (event, request: NoteRevealSourceRequest) => {
    const parsed = NoteRevealSourceRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    return NoteRevealSourceResultSchema.parse(
      ownerId === undefined || event.sender.isDestroyed()
        ? { ...parsed, status: "stale" }
        : await options.getReaderSourceRevealService().reveal(ownerId, parsed)
    );
  });
  options.ipcMain.handle(NOTE_RECONNECT_ORIGINAL_SOURCE_CHANNEL, async (
    event,
    request: NoteReconnectOriginalSourceRequest
  ) => {
    const parsed = NoteReconnectOriginalSourceRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    const window = options.getWindow(event.sender);
    if (ownerId === undefined || event.sender.isDestroyed() || !window) {
      return NoteReconnectOriginalSourceResultSchema.parse({ ...parsed, status: "stale" });
    }
    const result = await options.getReaderSourceReconnectService().reconnect(ownerId, parsed, {
      pick: async () => {
        const selection = await options.showOpenDialog(window, {
          title: "Reconnect referenced source",
          properties: ["openFile"]
        });
        return selection.canceled || selection.filePaths.length !== 1
          ? undefined
          : selection.filePaths[0];
      }
    });
    if (notesTrackedSenders.get(event.sender.id) !== ownerId || event.sender.isDestroyed()) {
      return NoteReconnectOriginalSourceResultSchema.parse({ ...parsed, status: "stale" });
    }
    return NoteReconnectOriginalSourceResultSchema.parse(result);
  });
  options.ipcMain.handle("readerSelection.resolve", (event, request: ReaderSelectionResolveRequest) => {
    const parsed = ReaderSelectionResolveRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    return ReaderSelectionResolveResultSchema.parse(
      ownerId === undefined
        ? { apiVersion: 1, requestId: parsed.requestId, status: "stale", scope: "render_context" }
        : options.getNotesService().resolveSelection(ownerId, parsed)
    );
  });
  options.ipcMain.handle("readerSelection.submitAction", async (
    event,
    request: ReaderSelectionActionRequest
  ) => {
    const parsed = ReaderSelectionActionRequestSchema.parse(request);
    const draftPublisher = new AgentTurnDraftPublisher({
      clientTurnId: parsed.clientTurnId,
      send: (draft) => {
        if (!event.sender.isDestroyed()) event.sender.send("agent.turnDraft", draft);
      }
    });
    try {
      return ReaderSelectionActionResultSchema.parse(
        await options.getReaderSelectionActionService().submit(parsed, {
          onDraft: (draft) => draftPublisher.publish(draft)
        })
      );
    } finally {
      draftPublisher.close();
    }
  });
  options.ipcMain.handle("readerSelection.submitLink", async (
    event,
    request: unknown
  ) => {
    const parsed = ReaderSelectionLinkRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) {
      return ReaderSelectionLinkResultSchema.parse({
        apiVersion: 1,
        requestId: parsed.requestId,
        status: "invalid",
        reason: "render_context_changed"
      });
    }
    const renderContextCurrent = (): boolean =>
      notesTrackedSenders.get(event.sender.id) === ownerId &&
      !event.sender.isDestroyed() &&
      options.getNotesService().isRenderContextCurrent(ownerId, {
        activeVaultId: parsed.activeVaultId,
        pageId: parsed.selection.pageId,
        renderContextId: parsed.renderContextId
      });
    const draftPublisher = new AgentTurnDraftPublisher({
      clientTurnId: parsed.clientTurnId,
      send: (draft) => {
        if (!event.sender.isDestroyed()) event.sender.send("agent.turnDraft", draft);
      }
    });
    try {
      return ReaderSelectionLinkResultSchema.parse(
        await options.getReaderSelectionActionService().submitLink(parsed, {
          renderContextCurrent,
          onDraft: (draft) => draftPublisher.publish(draft)
        })
      );
    } finally {
      draftPublisher.close();
    }
  });
  options.ipcMain.handle("readerSelection.submitTransform", async (
    event,
    request: ReaderSelectionTransformRequest
  ) => {
    const parsed = ReaderSelectionTransformRequestSchema.parse(request);
    const draftPublisher = new AgentTurnDraftPublisher({
      clientTurnId: parsed.clientTurnId,
      send: (draft) => {
        if (!event.sender.isDestroyed()) event.sender.send("agent.turnDraft", draft);
      }
    });
    try {
      return ReaderSelectionTransformResultSchema.parse(
        await options.getReaderSelectionActionService().submitTransform(parsed, {
          onDraft: (draft) => draftPublisher.publish(draft)
        })
      );
    } finally {
      draftPublisher.close();
    }
  });
  options.ipcMain.handle("readerSelection.submitCreateNote", async (
    event,
    request: ReaderSelectionCreateNoteRequest
  ) => {
    const parsed = ReaderSelectionCreateNoteRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) {
      return ReaderSelectionCreateNoteResultSchema.parse({
        apiVersion: 1,
        requestId: parsed.requestId,
        status: "invalid",
        reason: "render_context_changed"
      });
    }
    const renderContextCurrent = (): boolean =>
      notesTrackedSenders.get(event.sender.id) === ownerId && !event.sender.isDestroyed() &&
      options.getNotesService().isRenderContextCurrent(ownerId, {
        activeVaultId: parsed.activeVaultId,
        pageId: parsed.selection.pageId,
        renderContextId: parsed.renderContextId
      });
    const draftPublisher = new AgentTurnDraftPublisher({
      clientTurnId: parsed.clientTurnId,
      send: (draft) => {
        if (!event.sender.isDestroyed()) event.sender.send("agent.turnDraft", draft);
      }
    });
    try {
      return ReaderSelectionCreateNoteResultSchema.parse(
        await options.getReaderSelectionCreateNoteService().submit(parsed, {
          renderContextCurrent,
          onDraft: (draft) => draftPublisher.publish(draft)
        })
      );
    } finally {
      draftPublisher.close();
    }
  });
  options.ipcMain.handle("readerSelection.currentProposal", (
    event,
    request: ReaderSelectionProposalGetRequest
  ) => {
    const parsed = ReaderSelectionProposalGetRequestSchema.parse(request);
    if (!notesTrackedSenders.has(event.sender.id)) {
      throw new PigeDomainError(
        "desktop.ipc_sender_invalid",
        "Reader proposal access requires the active renderer."
      );
    }
    return ReaderSelectionProposalGetResultSchema.parse(
      options.getReaderSelectionProposalService().get(parsed)
    );
  });
  options.ipcMain.handle("readerSelection.decideProposal", (
    event,
    request: ReaderSelectionProposalDecisionRequest
  ) => {
    const parsed = ReaderSelectionProposalDecisionRequestSchema.parse(request);
    if (!notesTrackedSenders.has(event.sender.id)) {
      throw new PigeDomainError(
        "desktop.ipc_sender_invalid",
        "Reader proposal decisions require the active renderer."
      );
    }
    return ReaderSelectionProposalDecisionResultSchema.parse(
      options.getReaderSelectionProposalService().decide(parsed)
    );
  });
}
