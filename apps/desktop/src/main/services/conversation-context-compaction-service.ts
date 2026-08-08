import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { AgentConversationContextCompactionStatus } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import type { ConversationEvent, JobRecord } from "@pige/schemas";
import { captureReferenceTurnBinding } from "./agent-conversation-capture-reference";
import type {
  AgentTurnConversationContextMessage,
  AgentTurnConversationStore,
  PreservedAgentTurn
} from "./agent-turn-conversation-store";

// Main owns compaction. Pi Agent receives only the bounded result; the JSONL is never rewritten.
export const CONVERSATION_CONTEXT_COMPACTION_OWNER = "main.agent_context" as const;
export const CONVERSATION_CONTEXT_COMPACTION_CONSUMER = "pi_agent" as const;
export const MAX_CONVERSATION_CONTEXT_MESSAGES = 16;
export const MAX_CONVERSATION_CONTEXT_TEXT_BYTES = 64 * 1024;
export const MAX_CONVERSATION_CONTEXT_TOKENS = 16 * 1024;

const SUMMARY_HEADER = "[Earlier conversation context compacted by Pige]";
const REFERENCE_GROUP_LABELS = [
  "Source refs", "Page refs", "Job refs", "Proposal refs", "Operation refs", "Capture refs",
  "Citation refs", "Output refs", "Dataset refs", "Dataset revision refs", "Dataset table refs",
  "Dataset schema hashes", "Dataset query hashes", "Dataset result hashes", "Source revision hashes",
  "Policy hashes"
] as const;
type TextConversationEvent = ConversationEvent & { readonly text: string };

export interface ConversationContextCompactionPolicy {
  readonly maxMessages?: number;
  readonly maxTextBytes?: number;
  readonly maxTokens?: number;
}

export interface ConversationContextCompactionSnapshot {
  readonly owner: typeof CONVERSATION_CONTEXT_COMPACTION_OWNER;
  readonly consumer: typeof CONVERSATION_CONTEXT_COMPACTION_CONSUMER;
  readonly compacted: boolean;
  readonly eventCount: number;
  readonly messageCount: number;
  readonly omittedMessageCount: number;
  readonly firstEventId?: string;
  readonly lastEventId?: string;
  readonly contextHash: string;
  readonly referenceCounts: Readonly<Record<string, number>>;
}

export interface CompactedConversationContext {
  readonly messages: readonly AgentTurnConversationContextMessage[];
  readonly snapshot: ConversationContextCompactionSnapshot;
}

export interface ConversationContextCompactionStatus {
  readonly status: "not_needed" | "compacted";
  readonly omittedMessageCount: number;
}

export function compactConversationContextBeforeUserTurn(
  events: readonly ConversationEvent[],
  userEventId: string
): CompactedConversationContext {
  if (!/^evt_\d{8}_[a-z0-9]{8,}$/u.test(userEventId)) {
    throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The Agent context event identity is invalid.");
  }
  const matchingIndexes = events.flatMap((event, index) => event.id === userEventId ? [index] : []);
  const matchingIndex = matchingIndexes[0];
  if (matchingIndexes.length !== 1 || matchingIndex === undefined || events[matchingIndex]?.type !== "user_message") {
    throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent context boundary was not found.");
  }
  return compactConversationContext(events.slice(0, matchingIndex));
}

export function conversationContextCompactionStatus(
  context: CompactedConversationContext
): ConversationContextCompactionStatus {
  return {
    status: context.snapshot.compacted ? "compacted" : "not_needed",
    omittedMessageCount: context.snapshot.omittedMessageCount
  };
}

export function createConversationContextHash(
  conversations: AgentTurnConversationStore,
  vaultPath: string,
  turn: PreservedAgentTurn,
  history: readonly AgentTurnConversationContextMessage[],
  contextSnapshot: ConversationContextCompactionSnapshot
): string {
  const binding = captureReferenceTurnBinding(conversations, vaultPath, turn);
  return hashValue(JSON.stringify({
    conversationId: turn.event.conversationId,
    eventId: turn.event.id,
    inputHash: turn.inputHash,
    parentEventId: turn.event.parentEventId ?? null,
    history,
    contextSnapshot,
    tailEventId: binding.tailEventId,
    captureReferences: binding.captureReferences
  }));
}

export function readSafeConversationContextCompactionStatus(
  conversations: AgentTurnConversationStore,
  vaultPath: string,
  job: JobRecord
): AgentConversationContextCompactionStatus | undefined {
  if (!job.conversationEventId) return undefined;
  const conversationRef = job.inputRefs?.find(
    (ref) => ref.kind === "conversation" && ref.role === "agent_turn_user_event" && ref.id === job.conversationEventId
  );
  if (!conversationRef?.locator) return undefined;
  try {
    return conversationContextCompactionStatus(
      compactConversationContext(
        conversations.readConversationEventsBeforeUserTurn(vaultPath, conversationRef.locator, job.conversationEventId)
      )
    );
  } catch {
    return undefined;
  }
}

const DEFAULT_POLICY: Required<ConversationContextCompactionPolicy> = {
  maxMessages: MAX_CONVERSATION_CONTEXT_MESSAGES,
  maxTextBytes: MAX_CONVERSATION_CONTEXT_TEXT_BYTES,
  maxTokens: MAX_CONVERSATION_CONTEXT_TOKENS
};

export function compactConversationContext(
  events: readonly ConversationEvent[],
  policy: ConversationContextCompactionPolicy = DEFAULT_POLICY
): CompactedConversationContext {
  const limits = normalizePolicy(policy);
  const messages: TextConversationEvent[] = [];
  for (const event of events) {
    if (isTextMessage(event)) messages.push(event);
  }

  const contextHash = hashEvents(events);
  const refs = collectRefs(events);
  const recent = selectRecent(messages, limits.maxMessages, limits.maxTextBytes, limits.maxTokens);
  const omittedCount = messages.length - recent.length;
  if (omittedCount <= 0) {
    return {
      messages: recent.map(toContextMessage),
      snapshot: createSnapshot(events, messages, 0, false, contextHash, refs)
    };
  }

  let boundary = Math.max(omittedCount, messages.length - Math.max(1, limits.maxMessages - 1));
  for (let attempt = 0; attempt <= messages.length; attempt += 1) {
    const summary = createCompactionSummary(events, messages.slice(0, boundary), contextHash);
    const summaryBytes = Buffer.byteLength(summary.text, "utf8");
    const summaryTokens = estimateTokens(summary.text);
    if (summaryBytes > limits.maxTextBytes || summaryTokens > limits.maxTokens) throw historyTooLarge();
    const retained = selectRecent(
      messages,
      Math.max(0, limits.maxMessages - 1),
      limits.maxTextBytes - summaryBytes,
      limits.maxTokens - summaryTokens
    );
    if (retained.length === 0) throw historyTooLarge();
    const nextBoundary = messages.length - retained.length;
    if (nextBoundary === boundary) {
      return {
        messages: [summary, ...retained.map(toContextMessage)],
        snapshot: createSnapshot(events, messages, messages.length - retained.length, true, contextHash, refs)
      };
    }
    boundary = nextBoundary;
  }
  throw historyTooLarge();
}

export function selectCompactedConversationContext(
  events: readonly ConversationEvent[]
): readonly AgentTurnConversationContextMessage[] {
  return compactConversationContext(events).messages;
}

function createSnapshot(
  events: readonly ConversationEvent[],
  messages: readonly TextConversationEvent[],
  omittedMessageCount: number,
  compacted: boolean,
  contextHash: string,
  refs: ReadonlyArray<readonly [string, readonly string[]]>
): ConversationContextCompactionSnapshot {
  const firstEvent = events[0];
  const lastEvent = events.at(-1);
  return {
    owner: CONVERSATION_CONTEXT_COMPACTION_OWNER,
    consumer: CONVERSATION_CONTEXT_COMPACTION_CONSUMER,
    compacted,
    eventCount: events.length,
    messageCount: messages.length,
    omittedMessageCount,
    ...(firstEvent ? { firstEventId: firstEvent.id } : {}),
    ...(lastEvent ? { lastEventId: lastEvent.id } : {}),
    contextHash,
    referenceCounts: Object.fromEntries(
      refs.map(([label, values]) => [referenceCountKey(label), values.length])
    )
  };
}

function createCompactionSummary(
  events: readonly ConversationEvent[],
  omittedMessages: readonly ConversationEvent[],
  contextHash: string
): AgentTurnConversationContextMessage {
  const firstEvent = events[0];
  const lastEvent = events.at(-1);
  const firstOmitted = omittedMessages[0];
  const lastOmitted = omittedMessages.at(-1);
  if (!firstEvent || !lastEvent || !firstOmitted || !lastOmitted) throw historyTooLarge();
  const refs = collectRefs(events);
  const lines = [
    SUMMARY_HEADER,
    `Omitted ${omittedMessages.length} earlier user/assistant messages from ${firstOmitted.createdAt} through ${lastOmitted.createdAt}.`,
    `Durable history snapshot: ${events.length} events from ${firstEvent.id} through ${lastEvent.id}.`,
    `Content digest: ${contextHash}.`,
    "The complete durable conversation remains available in History; omitted message bodies are not authority.",
    ...refs.map(([label, values]) => `${label}: ${values.join(", ")}.`)
  ];
  return { role: "assistant", createdAt: lastOmitted.createdAt, text: lines.join("\n") };
}

function collectRefs(events: readonly ConversationEvent[]): ReadonlyArray<readonly [string, readonly string[]]> {
  const groups = new Map<string, Set<string>>(REFERENCE_GROUP_LABELS.map((label) => [label, new Set()]));
  for (const event of events) {
    add(groups, "Source refs", event.sourceId);
    add(groups, "Page refs", event.scope?.pageId);
    add(groups, "Page refs", event.pageId);
    add(groups, "Job refs", event.jobId);
    add(groups, "Proposal refs", event.proposalId);
    add(groups, "Operation refs", event.operationId);
    add(groups, "Capture refs", event.captureId);
    add(groups, "Output refs", event.contentHash);
    const record = event as unknown as Record<string, unknown>;
    addUnknownRefs(groups, "Source refs", record.sourceRef);
    addUnknownRefs(groups, "Source refs", record.sourceRefs);
    addUnknownRefs(groups, "Page refs", record.pageRef);
    addUnknownRefs(groups, "Page refs", record.pageRefs);
    addUnknownRefs(groups, "Output refs", record.outputRef);
    addUnknownRefs(groups, "Output refs", record.outputRefs);
    addUnknownRefs(groups, "Output refs", record.answerOutputRef);
    addUnknownRefs(groups, "Output refs", record.answerOutputRefs);
    const policyHash = record.policyHash;
    if (typeof policyHash === "string" && /^sha256:[a-f0-9]{64}$/u.test(policyHash)) add(groups, "Policy hashes", policyHash);
    for (const citation of event.answerCitations ?? []) {
      add(groups, "Citation refs", citation.refId);
      if ("pageId" in citation) add(groups, "Page refs", citation.pageId);
      if ("evidence" in citation) {
        const evidence = citation.evidence;
        add(groups, "Source refs", evidence.sourceId);
        add(groups, "Dataset refs", evidence.datasetId);
        add(groups, "Dataset revision refs", evidence.revisionId);
        add(groups, "Dataset table refs", evidence.tableId);
        add(groups, "Dataset schema hashes", evidence.schemaId);
        add(groups, "Dataset query hashes", evidence.queryPlanHash);
        add(groups, "Dataset result hashes", evidence.resultHash);
        add(groups, "Source revision hashes", evidence.sourceRevisionHash);
      }
    }
    const datasetResult = event.answerDatasetResult;
    if (datasetResult) {
      add(groups, "Dataset refs", datasetResult.datasetId);
      add(groups, "Dataset revision refs", datasetResult.revisionId);
      add(groups, "Dataset table refs", datasetResult.tableId);
      add(groups, "Dataset query hashes", datasetResult.planHash);
      add(groups, "Dataset result hashes", datasetResult.resultHash);
      for (const citationRef of datasetResult.citationRefs) add(groups, "Citation refs", citationRef);
    }
  }
  return [...groups.entries()]
    .map(([label, values]) => [label, [...values].sort((left, right) => left.localeCompare(right, "en-US"))] as const)
    .filter(([, values]) => values.length > 0);
}

function addUnknownRefs(groups: Map<string, Set<string>>, label: string, value: unknown): void {
  if (typeof value === "string") {
    add(groups, label, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) addUnknownRefItem(groups, label, item);
    return;
  }
  addUnknownRefItem(groups, label, value);
}

function addUnknownRefItem(groups: Map<string, Set<string>>, label: string, item: unknown): void {
  if (typeof item === "string") {
    add(groups, label, item);
    return;
  }
  if (!item || typeof item !== "object") return;
  const record = item as Record<string, unknown>;
  for (const key of ["refId", "id", "outputId", "checksum", "hash"]) {
    if (typeof record[key] === "string") add(groups, label, record[key]);
  }
}

function add(groups: Map<string, Set<string>>, label: string, value: string | undefined): void {
  if (value) groups.get(label)!.add(value);
}

function normalizePolicy(policy: ConversationContextCompactionPolicy): Required<ConversationContextCompactionPolicy> {
  const limits = { ...DEFAULT_POLICY, ...policy };
  if (![limits.maxMessages, limits.maxTextBytes, limits.maxTokens].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw historyTooLarge();
  }
  return limits;
}

function selectRecent(
  messages: readonly TextConversationEvent[],
  limit: number,
  maxTextBytes: number,
  maxTokens: number
): TextConversationEvent[] {
  const selected: TextConversationEvent[] = [];
  let bytes = 0;
  let tokens = 0;
  for (let index = messages.length - 1; index >= 0 && selected.length < limit; index -= 1) {
    const event = messages[index]!;
    const nextBytes = Buffer.byteLength(event.text, "utf8");
    const nextTokens = estimateTokens(event.text);
    if (bytes + nextBytes > maxTextBytes || tokens + nextTokens > maxTokens) break;
    selected.push(event);
    bytes += nextBytes;
    tokens += nextTokens;
  }
  return selected.reverse();
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(Array.from(text).length / 4));
}

function hashEvents(events: readonly ConversationEvent[]): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(events)).digest("hex")}`;
}

function hashValue(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function referenceCountKey(label: string): string {
  return label
    .replace(/ refs$/u, "")
    .replace(/ hashes$/u, "")
    .replace(/ revision$/u, "Revision")
    .replace(/ table$/u, "Table")
    .replace(/ schema$/u, "Schema")
    .replace(/ query$/u, "Query")
    .replace(/ result$/u, "Result")
    .replace(/ /gu, "");
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
