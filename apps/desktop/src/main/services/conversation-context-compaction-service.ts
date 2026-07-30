import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { PigeDomainError } from "@pige/domain";
import type { ConversationEvent } from "@pige/schemas";
import type { AgentTurnConversationContextMessage } from "./agent-turn-conversation-store";

export const MAX_CONVERSATION_CONTEXT_MESSAGES = 16;
export const MAX_CONVERSATION_CONTEXT_TEXT_BYTES = 64 * 1024;
const SUMMARY_HEADER = "[Earlier conversation context compacted by Pige]";
type TextConversationEvent = ConversationEvent & { readonly text: string };

export function selectCompactedConversationContext(
  events: readonly ConversationEvent[]
): readonly AgentTurnConversationContextMessage[] {
  const messages: TextConversationEvent[] = [];
  for (const event of events) {
    if (isTextMessage(event)) messages.push(event);
  }
  const recent = selectRecent(messages, MAX_CONVERSATION_CONTEXT_MESSAGES, MAX_CONVERSATION_CONTEXT_TEXT_BYTES);
  const omittedCount = messages.length - recent.length;
  if (omittedCount <= 0) return recent.map(toContextMessage);

  let boundary = Math.max(omittedCount, messages.length - (MAX_CONVERSATION_CONTEXT_MESSAGES - 1));
  for (let attempt = 0; attempt <= messages.length; attempt += 1) {
    const summary = createCompactionSummary(events, messages.slice(0, boundary));
    const summaryBytes = Buffer.byteLength(summary.text, "utf8");
    if (summaryBytes > MAX_CONVERSATION_CONTEXT_TEXT_BYTES) throw historyTooLarge();
    const retained = selectRecent(messages, MAX_CONVERSATION_CONTEXT_MESSAGES - 1,
      MAX_CONVERSATION_CONTEXT_TEXT_BYTES - summaryBytes);
    if (retained.length === 0) throw historyTooLarge();
    const nextBoundary = messages.length - retained.length;
    if (nextBoundary === boundary) return [summary, ...retained.map(toContextMessage)];
    boundary = nextBoundary;
  }
  throw historyTooLarge();
}

function createCompactionSummary(
  events: readonly ConversationEvent[],
  omittedMessages: readonly ConversationEvent[]
): AgentTurnConversationContextMessage {
  const lastOmittedId = omittedMessages.at(-1)!.id;
  const lastOmittedIndex = events.findIndex(({ id }) => id === lastOmittedId);
  if (lastOmittedIndex < 0) throw historyTooLarge();
  const boundary = events.slice(0, lastOmittedIndex + 1);
  const refs = collectRefs(boundary);
  const lines = [
    SUMMARY_HEADER,
    `Omitted ${omittedMessages.length} earlier user/assistant messages from ${omittedMessages[0]!.createdAt} through ${omittedMessages.at(-1)!.createdAt}.`,
    `Content digest: sha256:${createHash("sha256").update(JSON.stringify(boundary)).digest("hex")}.`,
    "The complete durable conversation remains available in History; omitted message bodies are not authority.",
    ...refs.map(([label, values]) => `${label}: ${values.join(", ")}.`)
  ];
  return { role: "assistant", createdAt: omittedMessages.at(-1)!.createdAt, text: lines.join("\n") };
}

function collectRefs(events: readonly ConversationEvent[]): ReadonlyArray<readonly [string, readonly string[]]> {
  const groups = new Map<string, Set<string>>([
    ["Event refs", new Set()], ["Source refs", new Set()], ["Page refs", new Set()],
    ["Job refs", new Set()], ["Proposal refs", new Set()], ["Operation refs", new Set()],
    ["Capture refs", new Set()], ["Citation refs", new Set()], ["Policy hashes", new Set()]
  ]);
  for (const event of events) {
    groups.get("Event refs")!.add(event.id);
    add(groups, "Source refs", event.sourceId);
    add(groups, "Job refs", event.jobId);
    add(groups, "Proposal refs", event.proposalId);
    add(groups, "Operation refs", event.operationId);
    add(groups, "Capture refs", event.captureId);
    const policyHash = (event as ConversationEvent & { readonly policyHash?: unknown }).policyHash;
    if (typeof policyHash === "string" && /^sha256:[a-f0-9]{64}$/u.test(policyHash)) add(groups, "Policy hashes", policyHash);
    for (const citation of event.answerCitations ?? []) {
      add(groups, "Citation refs", citation.refId);
      if ("pageId" in citation) add(groups, "Page refs", citation.pageId);
      if ("evidence" in citation) {
        add(groups, "Source refs", citation.evidence.sourceId);
      }
    }
  }
  return [...groups.entries()]
    .map(([label, values]) => [label, [...values].sort((left, right) => left.localeCompare(right, "en-US"))] as const)
    .filter(([, values]) => values.length > 0);
}

function add(groups: Map<string, Set<string>>, label: string, value: string | undefined): void {
  if (value) groups.get(label)!.add(value);
}

function selectRecent(
  messages: readonly TextConversationEvent[], limit: number, maxTextBytes: number
): TextConversationEvent[] {
  const selected: TextConversationEvent[] = [];
  let bytes = 0;
  for (let index = messages.length - 1; index >= 0 && selected.length < limit; index -= 1) {
    const event = messages[index]!;
    const nextBytes = Buffer.byteLength(event.text!, "utf8");
    if (bytes + nextBytes > maxTextBytes) break;
    selected.push(event);
    bytes += nextBytes;
  }
  return selected.reverse();
}

function isTextMessage(event: ConversationEvent): event is TextConversationEvent {
  return (event.type === "user_message" || event.type === "assistant_message") && typeof event.text === "string";
}

function toContextMessage(event: TextConversationEvent): AgentTurnConversationContextMessage {
  return { role: event.type === "user_message" ? "user" : "assistant", createdAt: event.createdAt, text: event.text };
}

function historyTooLarge(): PigeDomainError {
  return new PigeDomainError("agent_runtime.turn_history_invalid", "Conversation references exceed the model context limit.");
}
