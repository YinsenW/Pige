import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AgentConversationMessage, AgentTurnScope } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  AgentConversationInputPresentationSchema,
  type ConversationEvent
} from "@pige/schemas";
import { captureReferencesByUserEvent } from "./agent-conversation-capture-reference";

const DEFAULT_CURSOR_CAPACITY = 256;

interface CursorBinding {
  readonly vaultPath: string;
  readonly conversationId: string;
  readonly scopeKey: string;
  readonly snapshotTailEventId: string;
  readonly beforeEventId: string;
}

export class AgentConversationCursorRegistry {
  readonly #cursors = new Map<string, CursorBinding>();
  readonly #cursorByBinding = new Map<string, string>();

  constructor(private readonly capacity = DEFAULT_CURSOR_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("Timeline cursor capacity must be a positive integer.");
    }
  }

  require(
    cursor: string,
    expected: Omit<CursorBinding, "vaultPath" | "scopeKey" | "beforeEventId"> & {
      readonly vaultPath: string;
      readonly scope?: AgentTurnScope;
    }
  ): CursorBinding {
    const binding = this.#cursors.get(cursor);
    if (
      !binding ||
      binding.vaultPath !== path.resolve(expected.vaultPath) ||
      binding.conversationId !== expected.conversationId ||
      binding.scopeKey !== scopeKey(expected.scope) ||
      binding.snapshotTailEventId !== expected.snapshotTailEventId
    ) {
      throw invalidConversationTimelineCursor();
    }
    return binding;
  }

  remember(
    vaultPath: string,
    conversationId: string,
    scope: AgentTurnScope | undefined,
    snapshotTailEventId: string,
    beforeEventId: string
  ): string {
    const binding: CursorBinding = {
      vaultPath: path.resolve(vaultPath),
      conversationId,
      scopeKey: scopeKey(scope),
      snapshotTailEventId,
      beforeEventId
    };
    const bindingKey = JSON.stringify(binding);
    const existing = this.#cursorByBinding.get(bindingKey);
    if (existing && this.#cursors.has(existing)) return existing;
    const cursor = `timeline_${randomUUID().replaceAll("-", "")}`;
    this.#cursors.set(cursor, binding);
    this.#cursorByBinding.set(bindingKey, cursor);
    while (this.#cursors.size > this.capacity) {
      const oldest = this.#cursors.entries().next().value as [string, CursorBinding] | undefined;
      if (!oldest) break;
      this.#cursors.delete(oldest[0]);
      this.#cursorByBinding.delete(JSON.stringify(oldest[1]));
    }
    return cursor;
  }
}

export function selectConversationTimelineMessages(
  events: readonly ConversationEvent[],
  limit: number,
  maxTextBytes: number,
  beforeEventId?: string
): { readonly messages: AgentConversationMessage[]; readonly hasEarlier: boolean } {
  const messageEvents = events.filter((event) =>
    (event.type === "user_message" || event.type === "assistant_message") && typeof event.text === "string"
  );
  const boundaryMatches = beforeEventId === undefined
    ? []
    : messageEvents.flatMap((event, index) => event.id === beforeEventId ? [index] : []);
  const boundaryIndex = beforeEventId === undefined ? messageEvents.length : boundaryMatches[0];
  if (boundaryIndex === undefined || (beforeEventId !== undefined && boundaryMatches.length !== 1)) {
    throw invalidConversationTimelineCursor();
  }
  const selected: AgentConversationMessage[] = [];
  const captureReferences = captureReferencesByUserEvent(events);
  let textBytes = 0;
  let earliestSelectedIndex = boundaryIndex;
  for (let index = boundaryIndex - 1; index >= 0 && selected.length < limit; index -= 1) {
    const event = messageEvents[index];
    if (!event || typeof event.text !== "string") continue;
    const bytes = Buffer.byteLength(event.text, "utf8");
    if (textBytes + bytes > maxTextBytes) break;
    const parsedPresentation = event.type === "user_message"
      ? AgentConversationInputPresentationSchema.safeParse(event.inputPresentation)
      : undefined;
    const inputPresentation = parsedPresentation?.success ? parsedPresentation.data : undefined;
    const eventCaptureReferences = captureReferences.get(event.id);
    selected.push({
      id: event.id,
      role: event.type === "user_message" ? "user" : "assistant",
      createdAt: event.createdAt,
      text: inputPresentation?.kind === "reader_selection_transform" ? "" : event.text,
      ...(event.jobId === undefined ? {} : { jobId: event.jobId }),
      ...(inputPresentation ? { inputPresentation } : {}),
      ...(eventCaptureReferences?.length ? { captureReferences: eventCaptureReferences } : {}),
      ...(event.type === "assistant_message" && event.answerGrounding !== undefined ? {
        answer: {
          answer: event.text,
          grounding: event.answerGrounding,
          citations: event.answerCitations ?? [],
          ...(event.answerDatasetResult === undefined ? {} : { datasetResult: event.answerDatasetResult }),
          ...(event.answerMemoryContext === undefined ? {} : { memoryContext: event.answerMemoryContext })
        }
      } : {})
    });
    textBytes += bytes;
    earliestSelectedIndex = index;
  }
  return { messages: selected.reverse(), hasEarlier: earliestSelectedIndex > 0 };
}

export function invalidConversationTimelineCursor(): PigeDomainError {
  return new PigeDomainError("agent_runtime.turn_binding_invalid", "The conversation pagination cursor is invalid.");
}

function scopeKey(scope: AgentTurnScope | undefined): string {
  return scope ? `current_note:${scope.pageId}` : "home";
}
