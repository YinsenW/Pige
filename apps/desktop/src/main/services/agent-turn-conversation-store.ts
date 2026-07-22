import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AgentConversationMessage,
  AgentConversationInputPresentation,
  AgentTurnAnswer,
  AgentTurnInputKind,
  AgentTurnObjective,
  AgentTurnScope
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  AgentTurnCurrentNoteScopeSchema,
  ConversationEventSchema,
  type ConversationEvent,
  type Locale,
  type ModelEgressContentClass
} from "@pige/schemas";
import {
  assertDurableAssistantIntegrity,
  normalizeDurableAssistantEvent
} from "./durable-agent-turn-answer";

const MAX_TURN_TEXT_BYTES = 64 * 1024;
const MAX_CONVERSATION_FILE_BYTES = 8 * 1024 * 1024;
const MAX_CONTEXT_MESSAGES = 16;
const MAX_CONTEXT_TEXT_BYTES = 64 * 1024;
const DEFAULT_TIMELINE_MESSAGES = 50;
const MAX_TIMELINE_MESSAGES = 100;
const MAX_TIMELINE_TEXT_BYTES = 256 * 1024;
const MAX_DISCOVERY_CANDIDATE_FILES = 256;
const MAX_DISCOVERY_DIRECTORY_ENTRIES = 4_096;
const MAX_DISCOVERY_BYTES = 32 * 1024 * 1024;
const CLIENT_TURN_ID_PATTERN = /^turn_(\d{8})_([a-z0-9]{12,64})$/u;
const CONVERSATION_ID_PATTERN = /^conv_(\d{8})(?:_([a-z0-9]{4,}))?$/u;
const EVENT_ID_PATTERN = /^evt_\d{8}_[a-z0-9]{8,}$/u;
const LOCATOR_PATTERN = /^\.pige\/conversations\/(\d{4})\/(\d{2})\/(conv_\d{8}(?:_[a-z0-9]{4,})?)\.jsonl$/u;
const RESTRICTED_TURN_MARKER = "Restricted content was blocked before Agent ingress.";

export interface PreservedAgentTurn {
  readonly event: ConversationEvent;
  readonly locator: string;
  readonly inputHash: string;
  readonly metadata?: AgentTurnConversationMetadata;
}

export interface AgentTurnConversationMetadata {
  readonly inputKind: AgentTurnInputKind;
  readonly objective: AgentTurnObjective;
  readonly locale: Locale;
  readonly scope?: AgentTurnScope;
  readonly inputPresentation?: AgentConversationInputPresentation;
}

export interface AgentTurnConversationBinding {
  readonly clientTurnId?: string;
  readonly conversationId?: string;
  readonly expectedTailEventId?: string;
}

export interface AgentTurnConversationContextMessage {
  readonly role: "user" | "assistant";
  readonly createdAt: string;
  readonly text: string;
  readonly historyContentClasses: readonly ModelEgressContentClass[];
}

export interface AgentTurnConversationTimeline {
  readonly conversationId: string;
  readonly tailEventId: string;
  readonly messages: readonly AgentConversationMessage[];
}

interface ResolvedTurnBinding {
  readonly clientTurnId: string;
  readonly conversationId: string;
  readonly parentEventId?: string;
  readonly isFollowUp: boolean;
}

interface LocatedConversationEvent {
  readonly event: ConversationEvent;
  readonly locator: string;
}

interface ConversationCandidate {
  readonly locator: string;
  readonly size: number;
}

interface DiscoveryBudget {
  entries: number;
  files: number;
}

export class AgentTurnConversationStore {
  appendUserTurn(
    vaultPath: string,
    text: string,
    metadata?: AgentTurnConversationMetadata,
    binding?: AgentTurnConversationBinding
  ): PreservedAgentTurn {
    return this.#appendInputTurn(vaultPath, "user", text, metadata, binding);
  }

  appendBlockedTurnMarker(
    vaultPath: string,
    text: string,
    metadata?: AgentTurnConversationMetadata,
    binding?: AgentTurnConversationBinding
  ): PreservedAgentTurn {
    return this.#appendInputTurn(vaultPath, "blocked", text, metadata, binding);
  }

  appendAssistantTurn(
    vaultPath: string,
    userTurn: PreservedAgentTurn,
    jobId: string,
    answer: string | AgentTurnAnswer
  ): ConversationEvent {
    if (userTurn.event.type !== "user_message") {
      throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The Agent conversation binding is invalid.");
    }
    const candidateAnswer = normalizeAssistantAnswer(answer);
    const durableUser = this.readUserTurn(
      vaultPath,
      userTurn.locator,
      userTurn.event.id,
      userTurn.inputHash
    );
    if (durableUser.event.type !== "user_message") {
      throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The Agent conversation binding is invalid.");
    }
    const dateKey = /^evt_(\d{8})_/u.exec(durableUser.event.id)?.[1];
    if (!dateKey) {
      throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The Agent conversation binding is invalid.");
    }
    const eventWithoutHash = ConversationEventSchema.parse({
      id: `evt_${dateKey}_${hashHex(`pige.agent_assistant.v1\0${jobId}\0${durableUser.event.id}`).slice(0, 16)}`,
      conversationId: durableUser.event.conversationId,
      type: "assistant_message",
      createdAt: new Date().toISOString(),
      parentEventId: durableUser.event.id,
      jobId,
      text: candidateAnswer.text,
      ...(candidateAnswer.grounding === undefined ? {} : { answerGrounding: candidateAnswer.grounding }),
      ...(candidateAnswer.citations === undefined ? {} : { answerCitations: candidateAnswer.citations }),
      ...(candidateAnswer.datasetResult === undefined ? {} : { answerDatasetResult: candidateAnswer.datasetResult })
    });
    const normalized = normalizeDurableAssistantEvent(eventWithoutHash);
    const event = ConversationEventSchema.parse({
      ...eventWithoutHash,
      contentHash: createAssistantContentHash(jobId, durableUser.event.id, normalized)
    });

    return appendEvent(vaultPath, durableUser.locator, event, false, (events) => {
      assertConversationEventsBelong(events, durableUser.event.conversationId);
      if (!events.some((candidate) => candidate.id === durableUser.event.id && candidate.type === "user_message")) {
        throw new PigeDomainError("agent_runtime.turn_changed", "The preserved Agent user turn changed before completion.");
      }
      const matches = events.filter(
        (candidate) => candidate.type === "assistant_message" && candidate.jobId === jobId
      );
      if (matches.length > 1) {
        throw new PigeDomainError("agent_runtime.turn_conflict", "Multiple assistant results claim one Agent turn.");
      }
      const existing = matches[0];
      if (existing) {
        assertMatchingAssistant(existing, durableUser.event.id, normalized);
        return existing;
      }
      if (events.some((candidate) => candidate.id === event.id)) {
        throw new PigeDomainError("agent_runtime.turn_conflict", "The Agent assistant event identity is already in use.");
      }
      return undefined;
    });
  }

  readUserTurn(
    vaultPath: string,
    locator: string,
    eventId: string,
    expectedInputHash: string
  ): PreservedAgentTurn {
    if (!/^sha256:[a-f0-9]{64}$/u.test(expectedInputHash)) {
      throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The Agent turn checksum is invalid.");
    }
    const events = readConversationEvents(vaultPath, locator);
    const matches = events.filter((event) => event.id === eventId);
    if (matches.length > 1) {
      throw new PigeDomainError("agent_runtime.turn_conflict", "Multiple events claim one Agent turn identity.");
    }
    const found = matches[0];
    if (!found || found.type !== "user_message" || typeof found.text !== "string") {
      throw new PigeDomainError("agent_runtime.turn_unavailable", "The preserved Agent user turn was not found.");
    }
    const metadata = readTurnMetadata(found);
    const actualHash = createTurnInputHash(
      "user",
      found.text,
      metadata,
      found.clientTurnId ? {
        clientTurnId: found.clientTurnId,
        conversationId: found.conversationId,
        ...(found.parentEventId ? { parentEventId: found.parentEventId } : {})
      } : undefined
    );
    if (actualHash !== expectedInputHash || (found.inputHash !== undefined && found.inputHash !== actualHash)) {
      throw new PigeDomainError("agent_runtime.turn_changed", "The preserved Agent user turn changed before resume.");
    }
    return { event: found, locator, inputHash: actualHash, ...(metadata ? { metadata } : {}) };
  }

  findAssistantTurn(vaultPath: string, locator: string, jobId: string): ConversationEvent | undefined {
    const matches = readConversationEvents(vaultPath, locator).filter(
      (event) => event.type === "assistant_message" && event.jobId === jobId
    );
    if (matches.length > 1) {
      throw new PigeDomainError("agent_runtime.turn_conflict", "Multiple assistant results claim one Agent turn.");
    }
    const match = matches[0];
    if (match) assertDurableAssistantIntegrity(match);
    return match;
  }

  readContextBeforeUserTurn(
    vaultPath: string,
    userTurn: PreservedAgentTurn
  ): readonly AgentTurnConversationContextMessage[];
  readContextBeforeUserTurn(
    vaultPath: string,
    locator: string,
    userEventId: string
  ): readonly AgentTurnConversationContextMessage[];
  readContextBeforeUserTurn(
    vaultPath: string,
    turnOrLocator: PreservedAgentTurn | string,
    eventId?: string
  ): readonly AgentTurnConversationContextMessage[] {
    const locator = typeof turnOrLocator === "string" ? turnOrLocator : turnOrLocator.locator;
    const userEventId = typeof turnOrLocator === "string" ? eventId : turnOrLocator.event.id;
    if (!userEventId || !EVENT_ID_PATTERN.test(userEventId)) {
      throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The Agent context event identity is invalid.");
    }
    const events = readConversationEvents(vaultPath, locator);
    const matchingIndexes = events.flatMap((event, index) => event.id === userEventId ? [index] : []);
    const matchingIndex = matchingIndexes[0];
    if (matchingIndexes.length !== 1 || matchingIndex === undefined || events[matchingIndex]?.type !== "user_message") {
      throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent context boundary was not found.");
    }
    const contextEvents = events.slice(0, matchingIndex);
    return selectRecentContextMessages(
      contextEvents,
      MAX_CONTEXT_MESSAGES,
      MAX_CONTEXT_TEXT_BYTES,
      contextEvents.some((event) => event.type === "user_message" && event.scope?.kind === "current_note")
    );
  }

  readConversationTimeline(
    vaultPath: string,
    conversationId?: string,
    limit = DEFAULT_TIMELINE_MESSAGES,
    scope?: AgentTurnScope
  ): AgentTurnConversationTimeline | undefined {
    if (conversationId === undefined) {
      return this.readLatestConversationTimeline(vaultPath, limit, scope);
    }
    const boundedLimit = validateTimelineLimit(limit);
    const locator = conversationLocator(conversationId);
    const events = readConversationEventsIfExists(vaultPath, locator);
    if (!events || events.length === 0) return undefined;
    assertConversationEventsBelong(events, conversationId);
    assertConversationScope(events, scope);
    return createTimeline(events, boundedLimit);
  }

  readLatestConversationTimeline(
    vaultPath: string,
    limit = DEFAULT_TIMELINE_MESSAGES,
    scope?: AgentTurnScope
  ): AgentTurnConversationTimeline | undefined {
    const boundedLimit = validateTimelineLimit(limit);
    const candidates = discoverConversationCandidates(vaultPath);
    let scannedBytes = 0;
    let latest: { readonly events: readonly ConversationEvent[]; readonly sortKey: string } | undefined;
    for (const candidate of candidates) {
      scannedBytes += candidate.size;
      if (scannedBytes > MAX_DISCOVERY_BYTES) {
        throw new PigeDomainError("agent_runtime.turn_unavailable", "Conversation discovery exceeded its read limit.");
      }
      const events = readConversationEvents(vaultPath, candidate.locator);
      if (events.length === 0) continue;
      const locatorConversationId = conversationIdFromLocator(candidate.locator);
      assertConversationEventsBelong(events, locatorConversationId);
      if (!conversationHasScope(events, scope)) continue;
      const latestMessage = [...events].reverse().find(
        (event) => event.type === "user_message" || event.type === "assistant_message"
      );
      if (!latestMessage) continue;
      const sortKey = `${latestMessage.createdAt}\0${latestMessage.id}\0${latestMessage.conversationId}`;
      if (!latest || sortKey > latest.sortKey) latest = { events, sortKey };
    }
    return latest ? createTimeline(latest.events, boundedLimit) : undefined;
  }

  #appendInputTurn(
    vaultPath: string,
    kind: "user" | "blocked",
    text: string,
    metadata: AgentTurnConversationMetadata | undefined,
    binding: AgentTurnConversationBinding | undefined
  ): PreservedAgentTurn {
    const boundedText = validateTurnText(text);
    const resolved = resolveTurnBinding(binding);
    const inputHash = createTurnInputHash(kind, boundedText, metadata, resolved);
    const locator = conversationLocator(resolved.conversationId);
    const expectedText = kind === "user" ? boundedText : RESTRICTED_TURN_MARKER;
    const existingMatches = findClientTurnEvents(vaultPath, resolved.clientTurnId);
    if (existingMatches.length > 1) {
      throw new PigeDomainError("agent_runtime.turn_conflict", "Multiple events claim one client turn identity.");
    }
    const existing = existingMatches[0];
    if (existing) {
      return adoptMatchingInputTurn(existing, kind, expectedText, inputHash, metadata, resolved);
    }

    const event = ConversationEventSchema.parse({
      id: clientTurnEventId(resolved.clientTurnId),
      conversationId: resolved.conversationId,
      type: kind === "user" ? "user_message" : "error",
      createdAt: new Date().toISOString(),
      clientTurnId: resolved.clientTurnId,
      ...(resolved.parentEventId === undefined ? {} : { parentEventId: resolved.parentEventId }),
      inputHash,
      text: expectedText,
      ...metadata
    });
    const persisted = appendEvent(vaultPath, locator, event, !resolved.isFollowUp, (events) => {
      assertConversationEventsBelong(events, resolved.conversationId);
      const localMatches = events.filter((candidate) => candidate.clientTurnId === resolved.clientTurnId);
      if (localMatches.length > 1) {
        throw new PigeDomainError("agent_runtime.turn_conflict", "Multiple events claim one client turn identity.");
      }
      if (localMatches[0]) {
        return adoptMatchingInputTurn(
          { event: localMatches[0], locator },
          kind,
          expectedText,
          inputHash,
          metadata,
          resolved
        ).event;
      }
      if (events.some((candidate) => candidate.id === event.id)) {
        throw new PigeDomainError("agent_runtime.turn_conflict", "The Agent turn event identity is already in use.");
      }
      if (resolved.isFollowUp) {
        assertConversationScope(events, metadata?.scope);
        if (events.at(-1)?.id !== resolved.parentEventId) {
          throw new PigeDomainError("agent_runtime.turn_conflict", "The Agent conversation tail changed before append.");
        }
      } else if (events.length > 0) {
        throw new PigeDomainError("agent_runtime.turn_conflict", "The first Agent turn conversation identity is already in use.");
      }
      return undefined;
    });
    return {
      event: persisted,
      locator,
      inputHash,
      ...(metadata ? { metadata } : {})
    };
  }
}

function resolveTurnBinding(binding: AgentTurnConversationBinding | undefined): ResolvedTurnBinding {
  const generatedAt = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const clientTurnId = binding?.clientTurnId ?? `turn_${generatedAt}_${randomUUID().replaceAll("-", "")}`;
  const clientMatch = CLIENT_TURN_ID_PATTERN.exec(clientTurnId);
  if (!clientMatch) {
    throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The client turn identity is invalid.");
  }
  const hasConversation = binding?.conversationId !== undefined;
  const hasExpectedTail = binding?.expectedTailEventId !== undefined;
  if (hasConversation !== hasExpectedTail) {
    throw new PigeDomainError("agent_runtime.turn_binding_invalid", "A follow-up requires a complete conversation tail binding.");
  }
  if (!hasConversation) {
    return {
      clientTurnId,
      conversationId: `conv_${clientMatch[1]}_${clientMatch[2]}`,
      isFollowUp: false
    };
  }
  if (
    !CONVERSATION_ID_PATTERN.test(binding.conversationId ?? "") ||
    !EVENT_ID_PATTERN.test(binding.expectedTailEventId ?? "")
  ) {
    throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The follow-up conversation tail binding is invalid.");
  }
  return {
    clientTurnId,
    conversationId: binding.conversationId as string,
    parentEventId: binding.expectedTailEventId as string,
    isFollowUp: true
  };
}

function adoptMatchingInputTurn(
  located: LocatedConversationEvent,
  kind: "user" | "blocked",
  expectedText: string,
  inputHash: string,
  metadata: AgentTurnConversationMetadata | undefined,
  binding: ResolvedTurnBinding
): PreservedAgentTurn {
  const event = located.event;
  const expectedType = kind === "user" ? "user_message" : "error";
  if (
    event.type !== expectedType ||
    event.text !== expectedText ||
    event.inputHash !== inputHash ||
    event.conversationId !== binding.conversationId ||
    event.parentEventId !== binding.parentEventId ||
    !hasExactTurnMetadata(event, metadata)
  ) {
    throw new PigeDomainError("agent_runtime.turn_changed", "The client turn identity was reused with changed input or binding.");
  }
  return {
    event,
    locator: located.locator,
    inputHash,
    ...(metadata ? { metadata } : {})
  };
}

function assertMatchingAssistant(
  event: ConversationEvent,
  parentEventId: string,
  answer: ReturnType<typeof normalizeAssistantAnswer>
): void {
  const legacyParentMatches = event.parentEventId === undefined || event.parentEventId === parentEventId;
  const answerMetadataMatches = answer.structured === false
    ? event.answerGrounding === undefined &&
      event.answerCitations === undefined &&
      event.answerDatasetResult === undefined
    : event.answerGrounding === answer.grounding &&
      JSON.stringify(event.answerCitations ?? []) === JSON.stringify(answer.citations ?? []) &&
      JSON.stringify(event.answerDatasetResult ?? null) === JSON.stringify(answer.datasetResult ?? null);
  if (event.text !== answer.text || !legacyParentMatches || !answerMetadataMatches) {
    throw new PigeDomainError("agent_runtime.turn_conflict", "The Agent job already has a different assistant result.");
  }
  if (
    event.contentHash &&
    event.contentHash !== createAssistantContentHash(event.jobId ?? "", parentEventId, answer)
  ) {
    throw new PigeDomainError("agent_runtime.turn_changed", "The durable assistant result changed after completion.");
  }
}

function normalizeAssistantAnswer(answer: string | AgentTurnAnswer): {
  readonly text: string;
  readonly structured: boolean;
  readonly grounding?: AgentTurnAnswer["grounding"];
  readonly citations?: AgentTurnAnswer["citations"];
  readonly datasetResult?: AgentTurnAnswer["datasetResult"];
} {
  if (typeof answer === "string") {
    return { text: validateTurnText(answer), structured: false };
  }
  return {
    text: validateTurnText(answer.answer),
    structured: true,
    grounding: answer.grounding,
    citations: answer.citations,
    ...(answer.datasetResult === undefined ? {} : { datasetResult: answer.datasetResult })
  };
}

function createAssistantContentHash(
  jobId: string,
  parentEventId: string,
  answer: ReturnType<typeof normalizeAssistantAnswer>
): string {
  const hashVersion = answer.datasetResult === undefined ? "v1" : "v2";
  return hashValue(`pige.agent_assistant.${hashVersion}\0${jobId}\0${parentEventId}\0${JSON.stringify({
    text: answer.text,
    grounding: answer.grounding ?? null,
    citations: answer.citations ?? null,
    ...(answer.datasetResult === undefined ? {} : { datasetResult: answer.datasetResult })
  })}`);
}

function findClientTurnEvents(vaultPath: string, clientTurnId: string): LocatedConversationEvent[] {
  const matches: LocatedConversationEvent[] = [];
  let scannedBytes = 0;
  for (const candidate of discoverConversationCandidates(vaultPath)) {
    scannedBytes += candidate.size;
    if (scannedBytes > MAX_DISCOVERY_BYTES) {
      throw new PigeDomainError("agent_runtime.turn_unavailable", "Client turn discovery exceeded its read limit.");
    }
    for (const event of readConversationEvents(vaultPath, candidate.locator)) {
      if (event.clientTurnId === clientTurnId) matches.push({ event, locator: candidate.locator });
    }
  }
  return matches;
}

function readConversationEvents(vaultPath: string, locator: string): ConversationEvent[] {
  const events = readConversationEventsIfExists(vaultPath, locator);
  if (!events) {
    throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation file is unavailable.");
  }
  return events;
}

function readConversationEventsIfExists(vaultPath: string, locator: string): ConversationEvent[] | undefined {
  const filePath = resolveConversationPath(vaultPath, locator);
  if (!assertExistingDirectoryPath(vaultPath, path.dirname(filePath))) return undefined;
  const pathStat = lstatIfExists(filePath);
  if (!pathStat) return undefined;
  assertRegularPrivateFileStat(pathStat);
  if (pathStat.size > MAX_CONVERSATION_FILE_BYTES) {
    throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation file is too large to resume safely.");
  }
  const descriptor = openConversationFile(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const descriptorStat = assertSafeOpenFile(filePath, descriptor);
    if (descriptorStat.size > MAX_CONVERSATION_FILE_BYTES) {
      throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation file is too large to resume safely.");
    }
    return parseConversationText(readDescriptorText(descriptor));
  } finally {
    fs.closeSync(descriptor);
  }
}

function appendEvent(
  vaultPath: string,
  locator: string,
  event: ConversationEvent,
  allowCreate: boolean,
  inspect: (events: readonly ConversationEvent[]) => ConversationEvent | undefined
): ConversationEvent {
  const filePath = resolveConversationPath(vaultPath, locator);
  if (allowCreate) {
    ensurePrivateDirectoryPath(vaultPath, path.dirname(filePath));
  } else if (!assertExistingDirectoryPath(vaultPath, path.dirname(filePath))) {
    throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation file is unavailable.");
  }
  const flags = fs.constants.O_RDWR |
    fs.constants.O_APPEND |
    (allowCreate ? fs.constants.O_CREAT : 0) |
    (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = openConversationFile(filePath, flags, 0o600);
  try {
    const stat = assertSafeOpenFile(filePath, descriptor);
    if (stat.size > MAX_CONVERSATION_FILE_BYTES) {
      throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation file is too large.");
    }
    const events = parseConversationText(readDescriptorText(descriptor));
    const existing = inspect(events);
    if (existing) return existing;
    const line = `${JSON.stringify(ConversationEventSchema.parse(event))}\n`;
    if (stat.size + Buffer.byteLength(line, "utf8") > MAX_CONVERSATION_FILE_BYTES) {
      throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation file reached its size limit.");
    }
    fs.writeFileSync(descriptor, line, "utf8");
    fs.fsyncSync(descriptor);
    return event;
  } finally {
    fs.closeSync(descriptor);
  }
}

function parseConversationText(text: string): ConversationEvent[] {
  const events: ConversationEvent[] = [];
  const ids = new Set<string>();
  for (const line of text.split("\n").filter(Boolean)) {
    let event: ConversationEvent;
    try {
      event = ConversationEventSchema.parse(JSON.parse(line));
    } catch {
      throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation history is invalid.");
    }
    if (ids.has(event.id)) {
      throw new PigeDomainError("agent_runtime.turn_conflict", "The Agent conversation contains duplicate event identities.");
    }
    assertStoredUserIntegrity(event);
    assertDurableAssistantIntegrity(event);
    ids.add(event.id);
    events.push(event);
  }
  return events;
}

function readTurnMetadata(event: ConversationEvent): AgentTurnConversationMetadata | undefined {
  const value = event as ConversationEvent & Record<string, unknown>;
  const inputKinds = new Set<AgentTurnInputKind>([
    "typed_text",
    "pasted_text",
    "typed_url",
    "pasted_url",
    "file_drop",
    "file_picker",
    "follow_up"
  ]);
  const objectives = new Set<AgentTurnObjective>(["auto", "capture", "vault_only"]);
  const locales = new Set<Locale>(["zh-Hans", "en", "ja", "ko", "fr", "de"]);
  if (
    typeof value.inputKind !== "string" ||
    typeof value.objective !== "string" ||
    typeof value.locale !== "string" ||
    !inputKinds.has(value.inputKind as AgentTurnInputKind) ||
    !objectives.has(value.objective as AgentTurnObjective) ||
    !locales.has(value.locale as Locale)
  ) {
    return undefined;
  }
  const scope = readTurnScope(value.scope);
  const inputPresentation = readInputPresentation(value.inputPresentation);
  return {
    inputKind: value.inputKind as AgentTurnInputKind,
    objective: value.objective as AgentTurnObjective,
    locale: value.locale as Locale,
    ...(scope ? { scope } : {}),
    ...(inputPresentation ? { inputPresentation } : {})
  };
}

function readTurnScope(value: unknown): AgentTurnScope | undefined {
  const parsed = AgentTurnCurrentNoteScopeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function readInputPresentation(value: unknown): AgentConversationInputPresentation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => key !== "kind" && key !== "action")) return undefined;
  if (
    candidate.kind === "reader_selection_action" &&
    (candidate.action === "explain" || candidate.action === "summarize")
  ) {
    return { kind: candidate.kind, action: candidate.action };
  }
  if (
    candidate.kind === "reader_selection_transform" &&
    (candidate.action === "translate" || candidate.action === "polish" || candidate.action === "expand")
  ) {
    return { kind: candidate.kind, action: candidate.action };
  }
  return undefined;
}

function assertStoredUserIntegrity(event: ConversationEvent): void {
  if (event.type !== "user_message" || !event.inputHash) return;
  if (typeof event.text !== "string") {
    throw new PigeDomainError("agent_runtime.turn_changed", "The durable user turn changed after preservation.");
  }
  const actualHash = createTurnInputHash(
    "user",
    event.text,
    readTurnMetadata(event),
    event.clientTurnId ? {
      clientTurnId: event.clientTurnId,
      conversationId: event.conversationId,
      ...(event.parentEventId ? { parentEventId: event.parentEventId } : {})
    } : undefined
  );
  if (event.inputHash !== actualHash) {
    throw new PigeDomainError("agent_runtime.turn_changed", "The durable user turn changed after preservation.");
  }
}

function hasExactTurnMetadata(
  event: ConversationEvent,
  metadata: AgentTurnConversationMetadata | undefined
): boolean {
  const value = event as ConversationEvent & Record<string, unknown>;
  if (!metadata) {
    return value.inputKind === undefined &&
      value.objective === undefined &&
      value.locale === undefined &&
      value.scope === undefined &&
      value.inputPresentation === undefined;
  }
  return value.inputKind === metadata.inputKind &&
    value.objective === metadata.objective &&
    value.locale === metadata.locale &&
    scopesEqual(readTurnScope(value.scope), metadata.scope) &&
    JSON.stringify(readInputPresentation(value.inputPresentation)) === JSON.stringify(metadata.inputPresentation);
}

function conversationHasScope(events: readonly ConversationEvent[], scope: AgentTurnScope | undefined): boolean {
  if (scope && events.some((event) =>
    event.type === "attachment_reference" ||
    event.type === "capture_reference" ||
    event.type === "source_reference"
  )) {
    return false;
  }
  const userEvents = events.filter((event) => event.type === "user_message");
  return userEvents.length > 0 && userEvents.every((event) =>
    scopesEqual(readTurnMetadata(event)?.scope, scope)
  );
}

function assertConversationScope(events: readonly ConversationEvent[], scope: AgentTurnScope | undefined): void {
  if (!conversationHasScope(events, scope)) {
    throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The Agent conversation scope changed.");
  }
}

function scopesEqual(left: AgentTurnScope | undefined, right: AgentTurnScope | undefined): boolean {
  return left?.kind === right?.kind && left?.pageId === right?.pageId;
}

function selectRecentContextMessages(
  events: readonly ConversationEvent[],
  limit: number,
  maxTextBytes: number,
  scopedConversation: boolean
): AgentTurnConversationContextMessage[] {
  const selected: AgentTurnConversationContextMessage[] = [];
  let textBytes = 0;
  for (let index = events.length - 1; index >= 0 && selected.length < limit; index -= 1) {
    const event = events[index];
    if (
      !event ||
      (event.type !== "user_message" && event.type !== "assistant_message") ||
      typeof event.text !== "string"
    ) {
      continue;
    }
    const bytes = Buffer.byteLength(event.text, "utf8");
    if (textBytes + bytes > maxTextBytes) break;
    const messageNeedsConservativeClassification =
      scopedConversation ||
      (
        event.type === "assistant_message" &&
        (
          event.answerGrounding === "local_knowledge" ||
          event.answerGrounding === "source"
        )
      );
    selected.push({
      role: event.type === "user_message" ? "user" : "assistant",
      createdAt: event.createdAt,
      text: event.text,
      historyContentClasses: messageNeedsConservativeClassification
        ? ["sensitive"]
        : ["ordinary"]
    });
    textBytes += bytes;
  }
  return selected.reverse();
}

function selectRecentMessages(
  events: readonly ConversationEvent[],
  limit: number,
  maxTextBytes: number
): AgentConversationMessage[] {
  const selected: AgentConversationMessage[] = [];
  let textBytes = 0;
  for (let index = events.length - 1; index >= 0 && selected.length < limit; index -= 1) {
    const event = events[index];
    if (
      !event ||
      (event.type !== "user_message" && event.type !== "assistant_message") ||
      typeof event.text !== "string"
    ) {
      continue;
    }
    const bytes = Buffer.byteLength(event.text, "utf8");
    if (textBytes + bytes > maxTextBytes) break;
    const inputPresentation = event.type === "user_message"
      ? readInputPresentation(event.inputPresentation)
      : undefined;
    selected.push({
      id: event.id,
      role: event.type === "user_message" ? "user" : "assistant",
      createdAt: event.createdAt,
      text: inputPresentation?.kind === "reader_selection_transform" ? "" : event.text,
      ...(event.jobId === undefined ? {} : { jobId: event.jobId }),
      ...(inputPresentation ? { inputPresentation } : {}),
      ...(event.type === "assistant_message" && event.answerGrounding !== undefined ? {
        answer: {
          answer: event.text,
          grounding: event.answerGrounding,
          citations: event.answerCitations ?? [],
          ...(event.answerDatasetResult === undefined ? {} : { datasetResult: event.answerDatasetResult })
        }
      } : {})
    });
    textBytes += bytes;
  }
  return selected.reverse();
}

function createTimeline(
  events: readonly ConversationEvent[],
  limit: number
): AgentTurnConversationTimeline {
  const tail = events.at(-1);
  if (!tail) {
    throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation is empty.");
  }
  return {
    conversationId: tail.conversationId,
    tailEventId: tail.id,
    messages: selectRecentMessages(events, limit, MAX_TIMELINE_TEXT_BYTES)
  };
}

function validateTimelineLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TIMELINE_MESSAGES) {
    throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The conversation timeline limit is invalid.");
  }
  return limit;
}

function assertConversationEventsBelong(
  events: readonly ConversationEvent[],
  conversationId: string
): void {
  if (events.some((event) => event.conversationId !== conversationId)) {
    throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation history has inconsistent identity.");
  }
}

function validateTurnText(value: string): string {
  const text = value.trim();
  if (!text || Buffer.byteLength(text, "utf8") > MAX_TURN_TEXT_BYTES || /\u0000/u.test(text)) {
    throw new PigeDomainError("agent_runtime.turn_invalid", "The Agent turn is empty or exceeds its transport limit.");
  }
  return text;
}

function conversationLocator(conversationId: string): string {
  const match = CONVERSATION_ID_PATTERN.exec(conversationId);
  if (!match) {
    throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The Agent conversation identity is invalid.");
  }
  const dateKey = match[1] as string;
  return `.pige/conversations/${dateKey.slice(0, 4)}/${dateKey.slice(4, 6)}/${conversationId}.jsonl`;
}

function conversationIdFromLocator(locator: string): string {
  const match = LOCATOR_PATTERN.exec(locator);
  if (!match?.[3]) {
    throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The Agent conversation locator is invalid.");
  }
  return match[3];
}

function clientTurnEventId(clientTurnId: string): string {
  return clientTurnId.replace(/^turn_/u, "evt_");
}

function resolveConversationPath(vaultPath: string, locator: string): string {
  const match = LOCATOR_PATTERN.exec(locator);
  if (
    !match ||
    locator.includes("\\") ||
    locator.split("/").some((segment) => segment === "" || segment === "." || segment === "..") ||
    match[1] !== match[3]?.slice(5, 9) ||
    match[2] !== match[3]?.slice(9, 11)
  ) {
    throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The Agent conversation locator is invalid.");
  }
  const root = path.resolve(vaultPath);
  const resolved = path.resolve(vaultPath, ...locator.split("/"));
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new PigeDomainError("vault.path_outside_root", "The Agent conversation path is outside the active vault.");
  }
  return resolved;
}

function discoverConversationCandidates(vaultPath: string): ConversationCandidate[] {
  const root = path.resolve(vaultPath);
  const conversationsRoot = path.join(root, ".pige", "conversations");
  if (!assertExistingDirectoryPath(vaultPath, conversationsRoot)) return [];
  const budget: DiscoveryBudget = { entries: 0, files: 0 };
  const candidates: ConversationCandidate[] = [];
  for (const yearEntry of readDirectoryEntries(conversationsRoot, budget)) {
    if (!/^\d{4}$/u.test(yearEntry.name)) continue;
    const yearPath = path.join(conversationsRoot, yearEntry.name);
    assertDiscoveredDirectory(yearEntry);
    for (const monthEntry of readDirectoryEntries(yearPath, budget)) {
      if (!/^\d{2}$/u.test(monthEntry.name)) continue;
      const monthPath = path.join(yearPath, monthEntry.name);
      assertDiscoveredDirectory(monthEntry);
      for (const fileEntry of readDirectoryEntries(monthPath, budget)) {
        const fileMatch = /^(conv_(\d{8})(?:_[a-z0-9]{4,})?)\.jsonl$/u.exec(fileEntry.name);
        if (!fileMatch) continue;
        if (!fileEntry.isFile() || fileEntry.isSymbolicLink()) {
          throw new PigeDomainError("agent_runtime.turn_unavailable", "Conversation discovery found an unsafe file.");
        }
        const conversationId = fileMatch[1] as string;
        const dateKey = fileMatch[2] as string;
        if (yearEntry.name !== dateKey.slice(0, 4) || monthEntry.name !== dateKey.slice(4, 6)) {
          throw new PigeDomainError("agent_runtime.turn_unavailable", "Conversation discovery found an inconsistent path.");
        }
        budget.files += 1;
        if (budget.files > MAX_DISCOVERY_CANDIDATE_FILES) {
          throw new PigeDomainError("agent_runtime.turn_unavailable", "Conversation discovery exceeded its file limit.");
        }
        const filePath = path.join(monthPath, fileEntry.name);
        const stat = assertRegularPrivateFile(filePath);
        if (stat.size > MAX_CONVERSATION_FILE_BYTES) {
          throw new PigeDomainError("agent_runtime.turn_unavailable", "A discovered conversation file is too large.");
        }
        candidates.push({ locator: conversationLocator(conversationId), size: stat.size });
      }
    }
  }
  return candidates.sort((left, right) => left.locator.localeCompare(right.locator));
}

function readDirectoryEntries(directoryPath: string, budget: DiscoveryBudget): fs.Dirent[] {
  const entries: fs.Dirent[] = [];
  let directory: fs.Dir;
  try {
    directory = fs.opendirSync(directoryPath);
  } catch {
    throw new PigeDomainError("agent_runtime.turn_unavailable", "Conversation discovery could not read its directory.");
  }
  try {
    for (;;) {
      const entry = directory.readSync();
      if (!entry) break;
      budget.entries += 1;
      if (budget.entries > MAX_DISCOVERY_DIRECTORY_ENTRIES) {
        throw new PigeDomainError("agent_runtime.turn_unavailable", "Conversation discovery exceeded its directory limit.");
      }
      entries.push(entry);
    }
  } finally {
    directory.closeSync();
  }
  return entries;
}

function assertDiscoveredDirectory(entry: fs.Dirent): void {
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new PigeDomainError("agent_runtime.turn_unavailable", "Conversation discovery found an unsafe directory.");
  }
}

function ensurePrivateDirectoryPath(vaultPath: string, directoryPath: string): void {
  const root = assertSafeVaultRoot(vaultPath);
  const relative = path.relative(root, directoryPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PigeDomainError("vault.path_outside_root", "The Agent conversation directory is outside the active vault.");
  }
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat = lstatIfExists(current);
    if (!stat) {
      try {
        fs.mkdirSync(current, { mode: 0o700 });
      } catch {
        throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation directory could not be created safely.");
      }
      stat = lstatIfExists(current);
    }
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation directory is unsafe.");
    }
  }
}

function assertExistingDirectoryPath(vaultPath: string, directoryPath: string): boolean {
  const root = assertSafeVaultRoot(vaultPath);
  const relative = path.relative(root, directoryPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PigeDomainError("vault.path_outside_root", "The Agent conversation directory is outside the active vault.");
  }
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = lstatIfExists(current);
    if (!stat) return false;
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation directory is unsafe.");
    }
  }
  return true;
}

function assertSafeVaultRoot(vaultPath: string): string {
  const root = path.resolve(vaultPath);
  const stat = lstatIfExists(root);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new PigeDomainError("agent_runtime.turn_unavailable", "The active vault root is unsafe.");
  }
  return root;
}

function assertRegularPrivateFile(filePath: string): fs.Stats {
  const stat = lstatIfExists(filePath);
  if (!stat) {
    throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation file is unavailable.");
  }
  assertRegularPrivateFileStat(stat);
  return stat;
}

function assertRegularPrivateFileStat(stat: fs.Stats): void {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation file is unsafe.");
  }
}

function assertSafeOpenFile(filePath: string, descriptor: number): fs.Stats {
  let descriptorStat: fs.Stats;
  let pathStat: fs.Stats;
  try {
    descriptorStat = fs.fstatSync(descriptor);
    pathStat = fs.lstatSync(filePath);
  } catch {
    throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation file is unsafe.");
  }
  assertRegularPrivateFileStat(descriptorStat);
  assertRegularPrivateFileStat(pathStat);
  if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) {
    throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation file changed during access.");
  }
  return descriptorStat;
}

function openConversationFile(filePath: string, flags: number, mode?: number): number {
  try {
    return fs.openSync(filePath, flags, mode);
  } catch {
    throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation file could not be opened safely.");
  }
}

function readDescriptorText(descriptor: number): string {
  try {
    return fs.readFileSync(descriptor, "utf8");
  } catch {
    throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation file could not be read safely.");
  }
}

function lstatIfExists(targetPath: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(targetPath);
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation path could not be inspected safely.");
  }
}

function hashValue(value: string): string {
  return `sha256:${hashHex(value)}`;
}

function hashHex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function createTurnInputHash(
  kind: "user" | "blocked",
  text: string,
  metadata: AgentTurnConversationMetadata | undefined,
  binding?: Pick<ResolvedTurnBinding, "clientTurnId" | "conversationId" | "parentEventId">
): string {
  const stableMetadata = metadata ? {
    inputKind: metadata.inputKind,
    objective: metadata.objective,
    locale: metadata.locale,
    ...(metadata.scope ? { scope: metadata.scope } : {}),
    ...(metadata.inputPresentation ? { inputPresentation: metadata.inputPresentation } : {})
  } : null;
  if (!binding) {
    return hashValue(`pige.agent_turn.${kind}.v1\0${text}\0${JSON.stringify(stableMetadata)}`);
  }
  return hashValue(
    `pige.agent_turn.${kind}.${metadata?.scope ? "v3" : "v2"}\0${text}\0${JSON.stringify(stableMetadata)}\0` +
    `${binding.clientTurnId}\0${binding.conversationId}\0${binding.parentEventId ?? ""}`
  );
}
