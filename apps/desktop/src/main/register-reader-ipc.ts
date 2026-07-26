import { randomUUID } from "node:crypto";
import type { IpcMain, WebContents } from "electron";
import type {
  NoteGetRequest,
  NoteOpenSourceReferenceRequest,
  NoteRenderRequest,
  NoteResolveInlineReferenceRequest,
  ReaderSelectionActionRequest,
  ReaderSelectionProposalDecisionRequest,
  ReaderSelectionProposalGetRequest,
  ReaderSelectionResolveRequest,
  ReaderSelectionTransformRequest
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  NoteOpenSourceReferenceRequestSchema,
  NoteOpenSourceReferenceResultSchema,
  NoteResolveInlineReferenceRequestSchema,
  NoteResolveInlineReferenceResultSchema,
  ReaderSelectionActionRequestSchema,
  ReaderSelectionActionResultSchema,
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

interface RegisterReaderIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly getNotesService: () => NotesService;
  readonly getReaderSelectionActionService: () => ReaderSelectionActionService;
  readonly getReaderSelectionProposalService: () => ReaderSelectionProposalService;
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
