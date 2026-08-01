import { createHash } from "node:crypto";
import type {
  AgentConversationHistoryQuery,
  AgentConversationHistorySummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  AgentConversationInputPresentationSchema,
  AgentTurnCurrentNoteScopeSchema,
  type AgentConversationMetadataManifest,
  type ConversationEvent
} from "@pige/schemas";
import { containsRestrictedModelContent } from "./model-egress-content";

const MAX_PREVIEW_CODE_POINTS = 240;
const UNSAFE_PREVIEW_PATTERN = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

export interface AgentConversationHistoryEntry extends AgentConversationHistorySummary {
  readonly titleRevision: number;
  readonly latestUserEventId?: string;
}

export function projectConversationHistoryEntry(input: {
  readonly conversationId: string;
  readonly events: readonly ConversationEvent[];
  readonly metadata?: AgentConversationMetadataManifest["conversations"][number];
  readonly query?: AgentConversationHistoryQuery;
}): AgentConversationHistoryEntry | undefined {
  const { conversationId, events, metadata, query } = input;
  if (events.some((event) => event.conversationId !== conversationId)) {
    throw new PigeDomainError("agent_runtime.turn_unavailable", "Conversation history is unavailable.");
  }
  const visible = events.filter((event) => event.type === "user_message" || event.type === "assistant_message");
  const tail = visible.at(-1);
  if (!tail) return undefined;
  const latestUser = [...visible].reverse().find((event) => event.type === "user_message");
  const previewEvent = latestUser ?? tail;
  const safePreview = createSafePreview(typeof previewEvent.text === "string" ? previewEvent.text : "Conversation");
  const scope = latestUser
    ? AgentTurnCurrentNoteScopeSchema.safeParse((latestUser as ConversationEvent & Record<string, unknown>).scope)
    : undefined;
  const inputPresentation = latestUser
    ? AgentConversationInputPresentationSchema.safeParse(
        (latestUser as ConversationEvent & Record<string, unknown>).inputPresentation
      )
    : undefined;
  const searchMatch = query ? findSearchMatch(visible, query) : undefined;
  return {
    conversationId,
    updatedAt: tail.createdAt,
    safePreview,
    tailEventId: tail.id,
    ...(searchMatch ? { searchMatch } : {}),
    ...(metadata?.title ? { title: metadata.title } : {}),
    titleRevision: metadata?.revision ?? 0,
    ...(scope?.success ? { scope: scope.data } : {}),
    ...(inputPresentation?.success ? { inputPresentation: inputPresentation.data } : {}),
    ...(latestUser ? { latestUserEventId: latestUser.id } : {})
  };
}

export function conversationHistoryEntryMatchesQuery(
  entry: AgentConversationHistoryEntry,
  query: AgentConversationHistoryQuery
): boolean {
  const needle = normalizeSearchText(query);
  return normalizeSearchText(entry.title ?? "").includes(needle) ||
    normalizeSearchText(entry.safePreview).includes(needle) ||
    entry.searchMatch !== undefined;
}

export function createConversationHistorySnapshotHash(
  entries: readonly AgentConversationHistoryEntry[]
): string {
  return createHash("sha256").update(JSON.stringify(entries), "utf8").digest("hex");
}

export function compareConversationHistoryEntries(
  left: AgentConversationHistoryEntry,
  right: AgentConversationHistoryEntry
): number {
  const updated = right.updatedAt.localeCompare(left.updatedAt, "en");
  return updated || left.conversationId.localeCompare(right.conversationId, "en");
}

function findSearchMatch(
  events: readonly ConversationEvent[],
  query: AgentConversationHistoryQuery
): NonNullable<AgentConversationHistorySummary["searchMatch"]> | undefined {
  const needle = normalizeSearchText(query);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if ((event.type !== "user_message" && event.type !== "assistant_message") ||
      typeof event.text !== "string" || containsRestrictedModelContent(event.text)) continue;
    const safeText = toSafeDisplayLine(event.text);
    if (!normalizeSearchText(safeText).includes(needle)) continue;
    return {
      eventId: event.id,
      role: event.type === "user_message" ? "user" : "assistant",
      createdAt: event.createdAt,
      safeExcerpt: createMatchExcerpt(safeText, needle)
    };
  }
  return undefined;
}

function createSafePreview(value: string): string {
  const codePoints = [...(toSafeDisplayLine(value) || "Conversation")];
  return codePoints.slice(0, MAX_PREVIEW_CODE_POINTS).join("");
}

function createMatchExcerpt(value: string, normalizedNeedle: string): string {
  const normalized = value.normalize("NFKC");
  const folded = normalized.toLowerCase();
  const matchIndex = folded.indexOf(normalizedNeedle);
  const codePoints = [...normalized];
  const matchStart = matchIndex < 0 ? 0 : [...folded.slice(0, matchIndex)].length;
  const leading = matchStart > 72;
  const start = leading ? matchStart - 72 : 0;
  const trailingBudget = MAX_PREVIEW_CODE_POINTS - (leading ? 1 : 0);
  let end = Math.min(codePoints.length, start + trailingBudget);
  const trailing = end < codePoints.length;
  if (trailing) end = Math.max(start + 1, end - 1);
  return `${leading ? "…" : ""}${codePoints.slice(start, end).join("")}${trailing ? "…" : ""}`;
}

function toSafeDisplayLine(value: string): string {
  return value.replace(UNSAFE_PREVIEW_PATTERN, " ").replace(/\s+/gu, " ").trim();
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}
