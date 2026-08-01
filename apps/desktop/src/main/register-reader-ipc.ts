import { randomUUID } from "node:crypto";
import type { BrowserWindow, IpcMain, OpenDialogOptions, WebContents } from "electron";
import type {
  LibraryRenameTopicRequest,
  LibraryRenameTopicResult,
  NoteGetRequest,
  NoteEditorOpenRequest,
  NoteEditorOpenResult,
  NoteEditorSaveRequest,
  NoteEditorSaveResult,
  NoteMergeRequest,
  NoteMergeResult,
  NoteRelateRequest,
  NoteRelateResult,
  NoteUnlinkRelationRequest,
  NoteUnlinkRelationResult,
  NoteImportMarkdownRequest,
  NoteImportMarkdownResult,
  NoteOpenSourceReferenceRequest,
  NoteReconnectOriginalSourceRequest,
  SourceRefreshPreviewRequest,
  SourceRefreshConfirmRequest,
  NoteRevealSourceRequest,
  NoteRevealGeneratedRequest,
  NoteRevealGeneratedResult,
  NoteRenderRequest,
  NoteArchiveCurrentRequest,
  NoteArchiveCurrentResult,
  NoteRestoreArchivedRequest,
  NoteRestoreArchivedResult,
  NoteSetQuestionStateRequest,
  NoteSetQuestionStateResult,
  NoteSetClaimConfidenceRequest,
  NoteSetClaimConfidenceResult,
  NoteSetEntityTypeRequest,
  NoteSetEntityTypeResult,
  NoteAddTagRequest,
  NoteAddTagResult,
  NoteEditTaxonomyRequest,
  NoteEditTaxonomyResult,
  NoteRenameRequest,
  NoteRenameResult,
  NoteAliasChangeRequest,
  NoteAliasChangeResult,
  NoteRemoveTagRequest,
  NoteRemoveTagResult,
  NoteTrashCurrentRequest,
  NoteTrashCurrentResult,
  NoteTrashListRequest,
  NoteTrashListResult,
  NoteTrashRestoreRequest,
  NoteTrashRestoreResult,
  NoteRevisionHistoryListRequest,
  NoteRevisionHistoryListResult,
  NoteRevisionHistoryOpenRequest,
  NoteRevisionHistoryOpenResult,
  NoteRevisionHistoryRestoreRequest,
  NoteRevisionHistoryRestoreResult,
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
  LIBRARY_RENAME_TOPIC_CHANNEL,
  LibraryRenameTopicRequestSchema,
  LibraryRenameTopicResultSchema,
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
  NOTE_UNLINK_RELATION_CHANNEL,
  NoteUnlinkRelationRequestSchema,
  NoteUnlinkRelationResultSchema,
  NOTE_IMPORT_MARKDOWN_CHANNEL,
  NoteImportMarkdownRequestSchema,
  NoteImportMarkdownResultSchema,
  NoteOpenSourceReferenceRequestSchema,
  NoteOpenSourceReferenceResultSchema,
  NOTE_OPEN_SEARCH_MATCH_CHANNEL,
  NoteOpenSearchMatchRequestSchema,
  NoteOpenSearchMatchResultSchema,
  NOTE_RECONNECT_ORIGINAL_SOURCE_CHANNEL,
  NoteReconnectOriginalSourceRequestSchema,
  NoteReconnectOriginalSourceResultSchema,
  SOURCE_REFRESH_PREVIEW_CHANNEL,
  SOURCE_REFRESH_CONFIRM_CHANNEL,
  SourceRefreshPreviewRequestSchema,
  SourceRefreshPreviewResultSchema,
  SourceRefreshConfirmRequestSchema,
  SourceRefreshConfirmResultSchema,
  NoteRevealSourceRequestSchema,
  NoteRevealSourceResultSchema,
  NOTE_REVEAL_GENERATED_CHANNEL,
  NoteRevealGeneratedRequestSchema,
  NoteRevealGeneratedResultSchema,
  NOTE_ARCHIVE_CURRENT_CHANNEL,
  NoteArchiveCurrentRequestSchema,
  NoteArchiveCurrentResultSchema,
  NOTE_RESTORE_ARCHIVED_CHANNEL,
  NoteRestoreArchivedRequestSchema,
  NoteRestoreArchivedResultSchema,
  NOTE_SET_QUESTION_STATE_CHANNEL,
  NoteSetQuestionStateRequestSchema,
  NoteSetQuestionStateResultSchema,
  NOTE_SET_CLAIM_CONFIDENCE_CHANNEL,
  NoteSetClaimConfidenceRequestSchema,
  NoteSetClaimConfidenceResultSchema,
  NOTE_SET_ENTITY_TYPE_CHANNEL,
  NoteSetEntityTypeRequestSchema,
  NoteSetEntityTypeResultSchema,
  NOTE_SEARCH_ENTITY_MENTIONS_CHANNEL,
  NOTE_CHANGE_ENTITY_MENTION_CHANNEL,
  NoteSearchEntityMentionsRequestSchema,
  NoteSearchEntityMentionsResultSchema,
  NoteChangeEntityMentionRequestSchema,
  NoteChangeEntityMentionResultSchema,
  NOTE_SEARCH_QUESTION_ANSWERS_CHANNEL,
  NOTE_CHANGE_QUESTION_ANSWER_CHANNEL,
  NoteSearchQuestionAnswersRequestSchema,
  NoteSearchQuestionAnswersResultSchema,
  NoteChangeQuestionAnswerRequestSchema,
  NoteChangeQuestionAnswerResultSchema,
  NOTE_SEARCH_CLAIM_CONTRADICTIONS_CHANNEL,
  NOTE_CHANGE_CLAIM_CONTRADICTION_CHANNEL,
  NoteSearchClaimContradictionsRequestSchema,
  NoteSearchClaimContradictionsResultSchema,
  NoteChangeClaimContradictionRequestSchema,
  NoteChangeClaimContradictionResultSchema,
  NOTE_SEARCH_CONCEPT_PARENTS_CHANNEL,
  NOTE_CHANGE_CONCEPT_PARENT_CHANNEL,
  NoteSearchConceptParentsRequestSchema,
  NoteSearchConceptParentsResultSchema,
  NoteChangeConceptParentRequestSchema,
  NoteChangeConceptParentResultSchema,
  NOTE_SEARCH_TOPIC_PARENTS_CHANNEL,
  NOTE_CHANGE_TOPIC_PARENT_CHANNEL,
  NoteSearchTopicParentsRequestSchema,
  NoteSearchTopicParentsResultSchema,
  NoteChangeTopicParentRequestSchema,
  NoteChangeTopicParentResultSchema,
  NOTE_ADD_TAG_CHANNEL,
  NoteAddTagRequestSchema,
  NoteAddTagResultSchema,
  NOTE_EDIT_TAXONOMY_CHANNEL,
  NoteEditTaxonomyRequestSchema,
  NoteEditTaxonomyResultSchema,
  NOTE_RENAME_CHANNEL,
  NoteRenameRequestSchema,
  NoteRenameResultSchema,
  NOTE_CHANGE_ALIAS_CHANNEL,
  NoteAliasChangeRequestSchema,
  NoteAliasChangeResultSchema,
  NOTE_REMOVE_TAG_CHANNEL,
  NoteRemoveTagRequestSchema,
  NoteRemoveTagResultSchema,
  NoteResolveInlineReferenceRequestSchema,
  NoteResolveInlineReferenceResultSchema,
  NoteTrashCurrentRequestSchema,
  NoteTrashCurrentResultSchema,
  NOTE_TRASH_LIST_CHANNEL,
  NOTE_TRASH_RESTORE_CHANNEL,
  NoteTrashListRequestSchema,
  NoteTrashListResultSchema,
  NoteTrashRestoreRequestSchema,
  NoteTrashRestoreResultSchema,
  NOTE_REVISION_HISTORY_LIST_CHANNEL,
  NOTE_REVISION_HISTORY_OPEN_CHANNEL,
  NOTE_REVISION_HISTORY_RESTORE_CHANNEL,
  NoteRevisionHistoryListRequestSchema,
  NoteRevisionHistoryListResultSchema,
  NoteRevisionHistoryOpenRequestSchema,
  NoteRevisionHistoryOpenResultSchema,
  NoteRevisionHistoryRestoreRequestSchema,
  NoteRevisionHistoryRestoreResultSchema,
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
import type { ReaderGeneratedNoteRevealService } from "./services/reader-generated-note-reveal-service";
import type { ReaderSourceReconnectService } from "./services/reader-source-reconnect-service";
import type { SourceRefreshService } from "./services/source-refresh-service";
import type { NoteTrashService } from "./services/note-trash-service";
import type { NoteArchiveService } from "./services/note-archive-service";
import type { NoteTagService } from "./services/note-tag-service";
import type { NoteRenameService } from "./services/note-rename-service";
import type { NoteAliasService } from "./services/note-alias-service";
import type { NoteMergeService } from "./services/note-merge-service";
import type { NoteRelateService } from "./services/note-relate-service";
import type { NoteMarkdownImportService } from "./services/note-markdown-import-service";
import type { NoteRevisionHistoryService } from "./services/note-revision-history-service";
import type { LibraryTopicRenameService } from "./services/library-topic-rename-service";
import type { QuestionStateService } from "./services/question-state-service";
import type { ClaimConfidenceService } from "./services/claim-confidence-service";
import type { EntityTypeService } from "./services/entity-type-service";
import type { EntityMentionService } from "./services/entity-mention-service";
import type { QuestionAnswerService } from "./services/question-answer-service";
import type { ClaimContradictionService } from "./services/claim-contradiction-service";
import type { ConceptParentService } from "./services/concept-parent-service";
import type { TopicParentService } from "./services/topic-parent-service";

interface RegisterReaderIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly getNotesService: () => NotesService;
  readonly getReaderSelectionActionService: () => ReaderSelectionActionService;
  readonly getReaderSelectionProposalService: () => ReaderSelectionProposalService;
  readonly getReaderSelectionCreateNoteService: () => ReaderSelectionCreateNoteActionService;
  readonly getReaderSourceRevealService: () => ReaderSourceRevealService;
  readonly getReaderGeneratedNoteRevealService: () => ReaderGeneratedNoteRevealService;
  readonly getReaderSourceReconnectService: () => ReaderSourceReconnectService;
  readonly getSourceRefreshService: () => SourceRefreshService;
  readonly getWindow: (sender: WebContents) => BrowserWindow | undefined;
  readonly showOpenDialog: (window: BrowserWindow, options: OpenDialogOptions) => Promise<{
    readonly canceled: boolean;
    readonly filePaths: readonly string[];
  }>;
  readonly getNoteTrashService: () => NoteTrashService;
  readonly getNoteArchiveService: () => NoteArchiveService;
  readonly getQuestionStateService: () => QuestionStateService;
  readonly getClaimConfidenceService: () => ClaimConfidenceService;
  readonly getEntityTypeService: () => EntityTypeService;
  readonly getEntityMentionService: () => EntityMentionService;
  readonly getQuestionAnswerService: () => QuestionAnswerService;
  readonly getClaimContradictionService: () => ClaimContradictionService;
  readonly getConceptParentService: () => ConceptParentService;
  readonly getTopicParentService: () => TopicParentService;
  readonly getNoteTagService: () => NoteTagService;
  readonly getNoteRenameService: () => NoteRenameService;
  readonly getNoteAliasService: () => NoteAliasService;
  readonly getNoteMergeService: () => NoteMergeService;
  readonly getNoteRelateService: () => NoteRelateService;
  readonly getNoteMarkdownImportService: () => NoteMarkdownImportService;
  readonly getNoteRevisionHistoryService: () => NoteRevisionHistoryService;
  readonly getLibraryTopicRenameService: () => LibraryTopicRenameService;
  readonly onNoteTrashCommitted: () => void;
  readonly onNoteArchiveCommitted: () => void;
  readonly onNoteRelated: () => void;
  readonly onNoteImported: () => void;
  readonly onSourceRefreshed: () => void;
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
  options.ipcMain.handle(NOTE_OPEN_SEARCH_MATCH_CHANNEL, async (event, request: unknown) => {
    const parsed = NoteOpenSearchMatchRequestSchema.parse(request);
    const sender = event.sender;
    const ownerId = trackNotesSender(sender);
    const result = NoteOpenSearchMatchResultSchema.parse(
      await options.getNotesService().openSearchMatch(parsed, ownerId)
    );
    if (
      sender.isDestroyed() ||
      notesTrackedSenders.get(sender.id) !== ownerId ||
      result.requestId !== parsed.requestId ||
      result.activeVaultId !== parsed.activeVaultId ||
      result.pageId !== parsed.pageId
    ) {
      options.getNotesService().releaseOwner(ownerId);
      return NoteOpenSearchMatchResultSchema.parse({
        apiVersion: 1,
        requestId: parsed.requestId,
        activeVaultId: parsed.activeVaultId,
        pageId: parsed.pageId,
        status: "stale"
      });
    }
    return result;
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
  options.ipcMain.handle(NOTE_REVISION_HISTORY_LIST_CHANNEL, (event, request: unknown): NoteRevisionHistoryListResult => {
    const parsed = NoteRevisionHistoryListRequestSchema.parse(request) as NoteRevisionHistoryListRequest;
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (!ownerId || event.sender.isDestroyed()) return NoteRevisionHistoryListResultSchema.parse({ ...parsed, status: "stale" });
    try {
      const result = NoteRevisionHistoryListResultSchema.parse(
        options.getNoteRevisionHistoryService().listForRenderer(ownerId, parsed)
      );
      return notesTrackedSenders.get(event.sender.id) === ownerId && !event.sender.isDestroyed()
        ? result
        : NoteRevisionHistoryListResultSchema.parse({ ...parsed, status: "stale" });
    } catch {
      return NoteRevisionHistoryListResultSchema.parse({ ...parsed, status: "failed" });
    }
  });
  options.ipcMain.handle(NOTE_REVISION_HISTORY_OPEN_CHANNEL, async (event, request: unknown): Promise<NoteRevisionHistoryOpenResult> => {
    const parsed = NoteRevisionHistoryOpenRequestSchema.parse(request) as NoteRevisionHistoryOpenRequest;
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (!ownerId || event.sender.isDestroyed()) return NoteRevisionHistoryOpenResultSchema.parse({ ...parsed, status: "stale" });
    try {
      const result = NoteRevisionHistoryOpenResultSchema.parse(
        await options.getNoteRevisionHistoryService().openForRenderer(ownerId, parsed)
      );
      return notesTrackedSenders.get(event.sender.id) === ownerId && !event.sender.isDestroyed()
        ? result
        : NoteRevisionHistoryOpenResultSchema.parse({ ...parsed, status: "stale" });
    } catch {
      return NoteRevisionHistoryOpenResultSchema.parse({ ...parsed, status: "failed" });
    }
  });
  options.ipcMain.handle(NOTE_REVISION_HISTORY_RESTORE_CHANNEL, async (event, request: unknown): Promise<NoteRevisionHistoryRestoreResult> => {
    const parsed = NoteRevisionHistoryRestoreRequestSchema.parse(request) as NoteRevisionHistoryRestoreRequest;
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (!ownerId || event.sender.isDestroyed()) return NoteRevisionHistoryRestoreResultSchema.parse({ ...parsed, status: "stale" });
    try {
      const result = NoteRevisionHistoryRestoreResultSchema.parse(
        await options.getNoteRevisionHistoryService().restoreForRenderer(ownerId, parsed)
      );
      if (result.status === "committed") options.onNoteRelated();
      return notesTrackedSenders.get(event.sender.id) === ownerId && !event.sender.isDestroyed()
        ? result
        : NoteRevisionHistoryRestoreResultSchema.parse({ ...parsed, status: "stale" });
    } catch {
      return NoteRevisionHistoryRestoreResultSchema.parse({ ...parsed, status: "failed" });
    }
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
  options.ipcMain.handle(NOTE_TRASH_LIST_CHANNEL, (_event, request: unknown): NoteTrashListResult => {
    const parsed = NoteTrashListRequestSchema.parse(request);
    try {
      return NoteTrashListResultSchema.parse(options.getNoteTrashService().list(parsed));
    } catch {
      return NoteTrashListResultSchema.parse({ ...parsed, status: "failed" });
    }
  });
  options.ipcMain.handle(NOTE_TRASH_RESTORE_CHANNEL, async (event, request: unknown): Promise<NoteTrashRestoreResult> => {
    const parsed = NoteTrashRestoreRequestSchema.parse(request);
    const ownerId = trackNotesSender(event.sender);
    if (event.sender.isDestroyed()) return NoteTrashRestoreResultSchema.parse({ ...parsed, status: "failed" });
    const restored = options.getNoteTrashService().restore(parsed);
    if (restored.status !== "committed") return NoteTrashRestoreResultSchema.parse({ ...parsed, status: restored.status });
    try {
      const render = await options.getNotesService().render({ pageId: parsed.pageId }, ownerId);
      if (!render.renderContextId || render.summary.pageId !== parsed.pageId ||
        notesTrackedSenders.get(event.sender.id) !== ownerId || event.sender.isDestroyed()) {
        return NoteTrashRestoreResultSchema.parse({ ...parsed, status: "failed" });
      }
      options.onNoteTrashCommitted();
      return NoteTrashRestoreResultSchema.parse({
        ...parsed, status: "committed", operationId: restored.operationId, render
      });
    } catch {
      return NoteTrashRestoreResultSchema.parse({ ...parsed, status: "failed" });
    }
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
  options.ipcMain.handle(NOTE_SET_QUESTION_STATE_CHANNEL, async (event, request: unknown) => {
    const parsed = NoteSetQuestionStateRequestSchema.parse(request) as NoteSetQuestionStateRequest;
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) {
      return NoteSetQuestionStateResultSchema.parse({ ...parsed, status: "failed" });
    }
    let rawResult: NoteSetQuestionStateResult;
    try {
      rawResult = await options.getQuestionStateService().setState(ownerId, parsed);
    } catch {
      rawResult = { ...parsed, status: "failed" };
    }
    const result = NoteSetQuestionStateResultSchema.parse(rawResult);
    if (result.status === "committed") options.onNoteRelated();
    if (notesTrackedSenders.get(event.sender.id) !== ownerId || event.sender.isDestroyed()) {
      return NoteSetQuestionStateResultSchema.parse({ ...parsed, status: "failed" });
    }
    return result;
  });
  options.ipcMain.handle(NOTE_SET_CLAIM_CONFIDENCE_CHANNEL, async (event, request: unknown) => {
    const parsed = NoteSetClaimConfidenceRequestSchema.parse(request) as NoteSetClaimConfidenceRequest;
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) {
      return NoteSetClaimConfidenceResultSchema.parse({ ...parsed, status: "failed" });
    }
    let rawResult: NoteSetClaimConfidenceResult;
    try {
      rawResult = await options.getClaimConfidenceService().setConfidence(ownerId, parsed);
    } catch {
      rawResult = { ...parsed, status: "failed" };
    }
    const result = NoteSetClaimConfidenceResultSchema.parse(rawResult);
    if (result.status === "committed") options.onNoteRelated();
    if (notesTrackedSenders.get(event.sender.id) !== ownerId || event.sender.isDestroyed()) {
      return NoteSetClaimConfidenceResultSchema.parse({ ...parsed, status: "failed" });
    }
    return result;
  });
  options.ipcMain.handle(NOTE_SET_ENTITY_TYPE_CHANNEL, async (event, request: unknown) => {
    const parsed = NoteSetEntityTypeRequestSchema.parse(request) as NoteSetEntityTypeRequest;
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) {
      return NoteSetEntityTypeResultSchema.parse({ ...parsed, status: "failed" });
    }
    let rawResult: NoteSetEntityTypeResult;
    try { rawResult = await options.getEntityTypeService().setType(ownerId, parsed); }
    catch { rawResult = { ...parsed, status: "failed" }; }
    const result = NoteSetEntityTypeResultSchema.parse(rawResult);
    if (result.status === "committed") options.onNoteRelated();
    if (notesTrackedSenders.get(event.sender.id) !== ownerId || event.sender.isDestroyed()) {
      return NoteSetEntityTypeResultSchema.parse({ ...parsed, status: "failed" });
    }
    return result;
  });
  options.ipcMain.handle(NOTE_SEARCH_ENTITY_MENTIONS_CHANNEL, async (event, request: unknown) => {
    const parsed = NoteSearchEntityMentionsRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) {
      return NoteSearchEntityMentionsResultSchema.parse({ ...parsed, status: "failed" });
    }
    try { return NoteSearchEntityMentionsResultSchema.parse(options.getEntityMentionService().search(ownerId, parsed)); }
    catch { return NoteSearchEntityMentionsResultSchema.parse({ ...parsed, status: "failed" }); }
  });
  options.ipcMain.handle(NOTE_CHANGE_ENTITY_MENTION_CHANNEL, async (event, request: unknown) => {
    const parsed = NoteChangeEntityMentionRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) {
      return NoteChangeEntityMentionResultSchema.parse({ ...parsed, status: "failed" });
    }
    try {
      const result = NoteChangeEntityMentionResultSchema.parse(
        await options.getEntityMentionService().change(ownerId, parsed)
      );
      if (result.status === "committed") options.onNoteRelated();
      return notesTrackedSenders.get(event.sender.id) === ownerId && !event.sender.isDestroyed()
        ? result : NoteChangeEntityMentionResultSchema.parse({ ...parsed, status: "failed" });
    } catch { return NoteChangeEntityMentionResultSchema.parse({ ...parsed, status: "failed" }); }
  });
  options.ipcMain.handle(NOTE_SEARCH_QUESTION_ANSWERS_CHANNEL, async (event, request: unknown) => {
    const parsed = NoteSearchQuestionAnswersRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) return NoteSearchQuestionAnswersResultSchema.parse({ ...parsed, status: "failed" });
    try { return NoteSearchQuestionAnswersResultSchema.parse(options.getQuestionAnswerService().search(ownerId, parsed)); }
    catch { return NoteSearchQuestionAnswersResultSchema.parse({ ...parsed, status: "failed" }); }
  });
  options.ipcMain.handle(NOTE_CHANGE_QUESTION_ANSWER_CHANNEL, async (event, request: unknown) => {
    const parsed = NoteChangeQuestionAnswerRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) return NoteChangeQuestionAnswerResultSchema.parse({ ...parsed, status: "failed" });
    try {
      const result = NoteChangeQuestionAnswerResultSchema.parse(await options.getQuestionAnswerService().change(ownerId, parsed));
      if (result.status === "committed") options.onNoteRelated();
      return notesTrackedSenders.get(event.sender.id) === ownerId && !event.sender.isDestroyed()
        ? result : NoteChangeQuestionAnswerResultSchema.parse({ ...parsed, status: "failed" });
    } catch { return NoteChangeQuestionAnswerResultSchema.parse({ ...parsed, status: "failed" }); }
  });
  options.ipcMain.handle(NOTE_SEARCH_CLAIM_CONTRADICTIONS_CHANNEL, async (event, request: unknown) => {
    const parsed = NoteSearchClaimContradictionsRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) {
      return NoteSearchClaimContradictionsResultSchema.parse({ ...parsed, status: "failed" });
    }
    try {
      return NoteSearchClaimContradictionsResultSchema.parse(
        options.getClaimContradictionService().search(ownerId, parsed)
      );
    } catch {
      return NoteSearchClaimContradictionsResultSchema.parse({ ...parsed, status: "failed" });
    }
  });
  options.ipcMain.handle(NOTE_CHANGE_CLAIM_CONTRADICTION_CHANNEL, async (event, request: unknown) => {
    const parsed = NoteChangeClaimContradictionRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) {
      return NoteChangeClaimContradictionResultSchema.parse({ ...parsed, status: "failed" });
    }
    try {
      const result = NoteChangeClaimContradictionResultSchema.parse(
        await options.getClaimContradictionService().change(ownerId, parsed)
      );
      if (result.status === "committed") options.onNoteRelated();
      return notesTrackedSenders.get(event.sender.id) === ownerId && !event.sender.isDestroyed()
        ? result
        : NoteChangeClaimContradictionResultSchema.parse({ ...parsed, status: "failed" });
    } catch {
      return NoteChangeClaimContradictionResultSchema.parse({ ...parsed, status: "failed" });
    }
  });
  options.ipcMain.handle(NOTE_SEARCH_CONCEPT_PARENTS_CHANNEL, (event, request: unknown) => {
    const parsed = NoteSearchConceptParentsRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) {
      return NoteSearchConceptParentsResultSchema.parse({ ...parsed, status: "failed" });
    }
    try {
      return NoteSearchConceptParentsResultSchema.parse(options.getConceptParentService().search(ownerId, parsed));
    } catch {
      return NoteSearchConceptParentsResultSchema.parse({ ...parsed, status: "failed" });
    }
  });
  options.ipcMain.handle(NOTE_CHANGE_CONCEPT_PARENT_CHANNEL, async (event, request: unknown) => {
    const parsed = NoteChangeConceptParentRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) {
      return NoteChangeConceptParentResultSchema.parse({ ...parsed, status: "failed" });
    }
    try {
      const result = NoteChangeConceptParentResultSchema.parse(
        await options.getConceptParentService().change(ownerId, parsed)
      );
      if (result.status === "committed") options.onNoteRelated();
      return !event.sender.isDestroyed() && notesTrackedSenders.get(event.sender.id) === ownerId
        ? result : NoteChangeConceptParentResultSchema.parse({ ...parsed, status: "failed" });
    } catch {
      return NoteChangeConceptParentResultSchema.parse({ ...parsed, status: "failed" });
    }
  });
  options.ipcMain.handle(NOTE_SEARCH_TOPIC_PARENTS_CHANNEL, (event, request: unknown) => {
    const parsed = NoteSearchTopicParentsRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) {
      return NoteSearchTopicParentsResultSchema.parse({ ...parsed, status: "failed" });
    }
    try {
      return NoteSearchTopicParentsResultSchema.parse(options.getTopicParentService().search(ownerId, parsed));
    } catch {
      return NoteSearchTopicParentsResultSchema.parse({ ...parsed, status: "failed" });
    }
  });
  options.ipcMain.handle(NOTE_CHANGE_TOPIC_PARENT_CHANNEL, async (event, request: unknown) => {
    const parsed = NoteChangeTopicParentRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) {
      return NoteChangeTopicParentResultSchema.parse({ ...parsed, status: "failed" });
    }
    try {
      const result = NoteChangeTopicParentResultSchema.parse(
        await options.getTopicParentService().change(ownerId, parsed)
      );
      if (result.status === "committed") options.onNoteRelated();
      return !event.sender.isDestroyed() && notesTrackedSenders.get(event.sender.id) === ownerId
        ? result : NoteChangeTopicParentResultSchema.parse({ ...parsed, status: "failed" });
    } catch {
      return NoteChangeTopicParentResultSchema.parse({ ...parsed, status: "failed" });
    }
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
  options.ipcMain.handle(NOTE_EDIT_TAXONOMY_CHANNEL, async (event, request: unknown) => {
    const parsed = NoteEditTaxonomyRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) {
      return NoteEditTaxonomyResultSchema.parse({ ...parsed, status: "failed" });
    }
    let rawResult: NoteEditTaxonomyResult;
    try { rawResult = await options.getNoteTagService().edit(ownerId, parsed); }
    catch { rawResult = { ...parsed, status: "failed" }; }
    const result = NoteEditTaxonomyResultSchema.parse(rawResult);
    if (result.status === "committed") options.onNoteRelated();
    return notesTrackedSenders.get(event.sender.id) === ownerId && !event.sender.isDestroyed()
      ? result
      : NoteEditTaxonomyResultSchema.parse({ ...parsed, status: "failed" });
  });
  options.ipcMain.handle(NOTE_RENAME_CHANNEL, async (event, request: unknown) => {
    const parsed = NoteRenameRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) return NoteRenameResultSchema.parse({ ...parsed, status: "failed" });
    let rawResult: NoteRenameResult;
    try { rawResult = await options.getNoteRenameService().rename(ownerId, parsed); }
    catch { rawResult = { ...parsed, status: "failed" }; }
    const result = NoteRenameResultSchema.parse(rawResult);
    if (result.status === "committed") options.onNoteRelated();
    return notesTrackedSenders.get(event.sender.id) === ownerId && !event.sender.isDestroyed()
      ? result : NoteRenameResultSchema.parse({ ...parsed, status: "failed" });
  });
  options.ipcMain.handle(NOTE_CHANGE_ALIAS_CHANNEL, async (event, request: unknown) => {
    const parsed = NoteAliasChangeRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) return NoteAliasChangeResultSchema.parse({ ...parsed, status: "failed" });
    let rawResult: NoteAliasChangeResult;
    try { rawResult = await options.getNoteAliasService().change(ownerId, parsed); }
    catch { rawResult = { ...parsed, status: "failed" }; }
    const result = NoteAliasChangeResultSchema.parse(rawResult);
    if (result.status === "committed") options.onNoteRelated();
    return notesTrackedSenders.get(event.sender.id) === ownerId && !event.sender.isDestroyed()
      ? result : NoteAliasChangeResultSchema.parse({ ...parsed, status: "failed" });
  });
  options.ipcMain.handle(NOTE_REMOVE_TAG_CHANNEL, async (event, request: unknown) => {
    const parsed = NoteRemoveTagRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) return NoteRemoveTagResultSchema.parse({ ...parsed, status: "failed" });
    let rawResult: NoteRemoveTagResult;
    try { rawResult = await options.getNoteTagService().remove(ownerId, parsed); }
    catch { rawResult = { ...parsed, status: "failed" }; }
    const result = NoteRemoveTagResultSchema.parse(rawResult);
    if (result.status === "committed") options.onNoteRelated();
    return notesTrackedSenders.get(event.sender.id) === ownerId && !event.sender.isDestroyed()
      ? result : NoteRemoveTagResultSchema.parse({ ...parsed, status: "failed" });
  });
  options.ipcMain.handle(LIBRARY_RENAME_TOPIC_CHANNEL, async (event, request: unknown) => {
    const parsed = LibraryRenameTopicRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) {
      return LibraryRenameTopicResultSchema.parse({ ...parsed, status: "failed" });
    }
    let rawResult: LibraryRenameTopicResult;
    try { rawResult = await options.getLibraryTopicRenameService().rename(ownerId, parsed); }
    catch { rawResult = { ...parsed, status: "failed" }; }
    const result = LibraryRenameTopicResultSchema.parse(rawResult);
    if (result.status === "committed") options.onNoteRelated();
    return notesTrackedSenders.get(event.sender.id) === ownerId && !event.sender.isDestroyed()
      ? result
      : LibraryRenameTopicResultSchema.parse({ ...parsed, status: "failed" });
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
  options.ipcMain.handle(NOTE_UNLINK_RELATION_CHANNEL, async (event, request: unknown): Promise<NoteUnlinkRelationResult> => {
    const parsed = NoteUnlinkRelationRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    if (ownerId === undefined || event.sender.isDestroyed()) {
      return NoteUnlinkRelationResultSchema.parse({ ...parsed, status: "stale" });
    }
    const result = await options.getNoteRelateService().unlink(ownerId, parsed);
    if (result.status === "committed") options.onNoteRelated();
    return notesTrackedSenders.get(event.sender.id) === ownerId && !event.sender.isDestroyed()
      ? NoteUnlinkRelationResultSchema.parse(result)
      : NoteUnlinkRelationResultSchema.parse({ ...parsed, status: "stale" });
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
  options.ipcMain.handle(NOTE_REVEAL_GENERATED_CHANNEL, async (
    event,
    request: NoteRevealGeneratedRequest
  ): Promise<NoteRevealGeneratedResult> => {
    const parsed = NoteRevealGeneratedRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    const result = NoteRevealGeneratedResultSchema.parse(
      ownerId === undefined || event.sender.isDestroyed()
        ? { ...parsed, status: "stale" }
        : await options.getReaderGeneratedNoteRevealService().reveal(ownerId, parsed)
    );
    return notesTrackedSenders.get(event.sender.id) === ownerId && !event.sender.isDestroyed()
      ? result
      : NoteRevealGeneratedResultSchema.parse({ ...parsed, status: "stale" });
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
  options.ipcMain.handle(SOURCE_REFRESH_PREVIEW_CHANNEL, async (event, request: SourceRefreshPreviewRequest) => {
    const parsed = SourceRefreshPreviewRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    const contextCurrent = (): boolean => ownerId !== undefined && !event.sender.isDestroyed() &&
      notesTrackedSenders.get(event.sender.id) === ownerId && options.getNotesService().isRenderContextCurrent(ownerId, {
        activeVaultId: parsed.activeVaultId,
        pageId: parsed.currentPageId,
        renderContextId: parsed.renderContextId
      });
    return SourceRefreshPreviewResultSchema.parse(
      await options.getSourceRefreshService().preview(parsed, contextCurrent)
    );
  });
  options.ipcMain.handle(SOURCE_REFRESH_CONFIRM_CHANNEL, async (event, request: SourceRefreshConfirmRequest) => {
    const parsed = SourceRefreshConfirmRequestSchema.parse(request);
    const ownerId = notesTrackedSenders.get(event.sender.id);
    const contextCurrent = (): boolean => ownerId !== undefined && !event.sender.isDestroyed() &&
      notesTrackedSenders.get(event.sender.id) === ownerId && options.getNotesService().isRenderContextCurrent(ownerId, {
        activeVaultId: parsed.activeVaultId,
        pageId: parsed.currentPageId,
        renderContextId: parsed.renderContextId
      });
    const result = SourceRefreshConfirmResultSchema.parse(
      await options.getSourceRefreshService().confirm(parsed, contextCurrent)
    );
    if (result.status === "refreshed") options.onSourceRefreshed();
    return result;
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
