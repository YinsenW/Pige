import { createHash } from "node:crypto";
import { PigeDomainError } from "@pige/domain";
import { ConversationEventSchema, type ConversationEvent, type SourceKind } from "@pige/schemas";

export interface ConversationCaptureReferenceInput {
  readonly sourceId: string;
  readonly captureId: string;
  readonly jobId: string;
  readonly displayName: string;
  readonly sourceKind: SourceKind;
  readonly pageId?: string;
}

export function createConversationCaptureReference(
  userEvent: ConversationEvent,
  input: ConversationCaptureReferenceInput
): ConversationEvent {
  if (userEvent.type !== "user_message") throw invalidReference();
  const dateKey = /^evt_(\d{8})_/u.exec(userEvent.id)?.[1];
  if (!dateKey) throw invalidReference();
  return ConversationEventSchema.parse({
    schemaVersion: 1,
    id: `evt_${dateKey}_${digest(`${userEvent.id}\0${input.jobId}\0${input.sourceId}\0${input.captureId}`).slice(0, 16)}`,
    conversationId: userEvent.conversationId,
    languageContinuity: userEvent.languageContinuity,
    type: "capture_reference",
    createdAt: new Date().toISOString(),
    parentEventId: userEvent.id,
    sourceId: input.sourceId,
    captureId: input.captureId,
    jobId: input.jobId,
    displayName: input.displayName,
    sourceKind: input.sourceKind,
    ...(input.pageId ? { pageId: input.pageId } : {})
  });
}

export function assertMatchingConversationCaptureReference(
  event: ConversationEvent,
  expected: ConversationEvent
): void {
  const fields = ["id", "conversationId", "type", "parentEventId", "sourceId", "captureId", "jobId",
    "displayName", "sourceKind", "pageId"] as const;
  if (fields.some((field) => event[field] !== expected[field]) || event.text !== undefined || event.textPreview !== undefined) {
    throw new PigeDomainError("agent_runtime.turn_conflict", "The durable capture reference changed after preservation.");
  }
}

export function captureReferencesByUserEvent(events: readonly ConversationEvent[]): ReadonlyMap<string, readonly {
  readonly eventId: string;
  readonly sourceId: string;
  readonly captureId: string;
  readonly jobId: string;
  readonly displayName: string;
  readonly sourceKind: SourceKind;
  readonly pageId?: string;
}[]> {
  const users = new Map(events.filter((event) => event.type === "user_message").map((event) => [event.id, event]));
  const projected = new Map<string, Array<{
    eventId: string; sourceId: string; captureId: string; jobId: string; displayName: string; sourceKind: SourceKind;
    pageId?: string;
  }>>();
  for (const event of events) {
    if (event.type !== "capture_reference") continue;
    const parent = event.parentEventId ? users.get(event.parentEventId) : undefined;
    if (!parent || parent.conversationId !== event.conversationId || !event.sourceId || !event.captureId || !event.jobId ||
      !event.displayName || !event.sourceKind || event.text !== undefined || event.textPreview !== undefined) throw invalidReference();
    const references = projected.get(parent.id) ?? [];
    if (references.some((reference) => reference.sourceId === event.sourceId)) throw invalidReference();
    references.push({ eventId: event.id, sourceId: event.sourceId, captureId: event.captureId, jobId: event.jobId,
      displayName: event.displayName, sourceKind: event.sourceKind, ...(event.pageId ? { pageId: event.pageId } : {}) });
    projected.set(parent.id, references);
  }
  return projected;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function invalidReference(): PigeDomainError {
  return new PigeDomainError("agent_runtime.turn_binding_invalid", "The durable capture reference is invalid.");
}
