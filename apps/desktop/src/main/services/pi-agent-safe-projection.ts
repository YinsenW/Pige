import { Buffer } from "node:buffer";
import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { PigeDomainError } from "@pige/domain";
import { containsRestrictedModelContent } from "./model-egress-content";
import type { PigeAgentToolDescriptor, PigeAgentToolResult } from "./pi-agent-tool-boundary";

export interface PiAgentTerminalDraftBoundary {
  readonly toolName: "pige_finish_home_turn";
  readonly argumentName: "answer";
  readonly maxCharacters: 8_000;
  readonly onSnapshot: (text: string) => void;
}

export interface PiAgentHistoryMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
}

export interface PiAgentEventRecord {
  readonly type: AgentEvent["type"];
  readonly toolName?: string;
  readonly isError?: boolean;
}

const MAX_HISTORY_MESSAGES = 16;
const MAX_HISTORY_UTF8_BYTES = 64 * 1024;
const MAX_TURN_EVENT_RECORDS = 512;
const DRAFT_PUBLISH_SETTLE_MS = 90;

export function createPiHistoryMessages(
  history: readonly PiAgentHistoryMessage[],
  model: Model<Api>
): AgentMessage[] {
  if (history.length > MAX_HISTORY_MESSAGES) {
    throw new PigeDomainError("agent_runtime.turn_history_invalid", "The Agent conversation history exceeds its message limit.");
  }
  let bytes = 0;
  return history.map((message) => {
    const text = message.text.trim();
    const timestamp = Date.parse(message.createdAt);
    bytes += Buffer.byteLength(text, "utf8");
    if (
      !text ||
      !Number.isFinite(timestamp) ||
      bytes > MAX_HISTORY_UTF8_BYTES ||
      (message.role !== "user" && message.role !== "assistant")
    ) {
      throw new PigeDomainError("agent_runtime.turn_history_invalid", "The Agent conversation history is invalid or too large.");
    }
    if (message.role === "user") {
      return {
        role: "user" as const,
        content: [{ type: "text" as const, text }],
        timestamp
      };
    }
    return {
      role: "assistant" as const,
      content: [{ type: "text" as const, text }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: "stop" as const,
      timestamp
    };
  });
}

export function toEventRecord(event: AgentEvent): PiAgentEventRecord {
  if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
    return {
      type: event.type,
      toolName: event.toolName,
      ...(event.type === "tool_execution_end" ? { isError: event.isError } : {})
    };
  }
  if (event.type === "tool_execution_update") {
    return { type: event.type, toolName: event.toolName };
  }
  return { type: event.type };
}

export function appendEventRecord(
  events: PiAgentEventRecord[],
  record: PiAgentEventRecord
): boolean {
  if (record.type === "message_update" && events.at(-1)?.type === "message_update") {
    return true;
  }
  if (events.length >= MAX_TURN_EVENT_RECORDS) return false;
  events.push(record);
  return true;
}

export class SafeTerminalDraftController {
  readonly #boundary: PiAgentTerminalDraftBoundary | undefined;
  readonly #allowNativeAssistantDraft: boolean;
  #lastToolSnapshot: string | undefined;
  #lastNativeSnapshot: string | undefined;
  #lastPresentedText: string | undefined;
  #toolCallObserved = false;
  #presentationEmitted = false;
  #presentationNeedsSettle = false;

  constructor(
    boundary: PiAgentTerminalDraftBoundary | undefined,
    allowNativeAssistantDraft = false
  ) {
    this.#boundary = boundary;
    this.#allowNativeAssistantDraft = allowNativeAssistantDraft;
  }

  observe(event: AgentEvent): void {
    if (!this.#boundary || event.type !== "message_update") return;
    const updateType = event.assistantMessageEvent.type;
    if (
      updateType === "toolcall_start" ||
      updateType === "toolcall_delta" ||
      updateType === "toolcall_end"
    ) {
      this.#toolCallObserved = true;
    }
    const terminalSnapshot = readSafeTerminalDraft(event, this.#boundary);
    if (terminalSnapshot && terminalSnapshot !== this.#lastToolSnapshot) {
      this.#lastToolSnapshot = terminalSnapshot;
      this.#emit(terminalSnapshot);
      return;
    }
    if (!this.#allowNativeAssistantDraft || this.#toolCallObserved) return;
    const nativeSnapshot = readSafeNativeAssistantDraft(event, this.#boundary);
    if (!nativeSnapshot || nativeSnapshot === this.#lastNativeSnapshot) return;
    this.#lastNativeSnapshot = nativeSnapshot;
    this.#emit(nativeSnapshot);
  }

  rejectAttempt(toolName: string): void {
    if (toolName !== this.#boundary?.toolName) return;
    this.#lastToolSnapshot = undefined;
  }

  async afterToolExecute(
    tool: PigeAgentToolDescriptor,
    args: unknown,
    result: PigeAgentToolResult
  ): Promise<PigeAgentToolResult> {
    if (!this.#boundary || tool.name !== this.#boundary.toolName || result.terminate !== true) {
      return result;
    }
    if (isRecord(args)) {
      const answer = readSafeTerminalAnswer(args[this.#boundary.argumentName], this.#boundary);
      if (answer) this.#emit(answer);
    }
    await this.#settlePresentation();
    return result;
  }

  async assertCompleteAndSettle(): Promise<void> {
    await this.#settlePresentation();
  }

  #emit(text: string): void {
    if (!this.#boundary || !text || text === this.#lastPresentedText) return;
    this.#lastPresentedText = text;
    this.#presentationEmitted = true;
    this.#presentationNeedsSettle = true;
    try {
      this.#boundary.onSnapshot(text);
    } catch {
      // Presentation delivery is non-authoritative and cannot fail the Pi turn.
    }
  }

  async #settlePresentation(): Promise<void> {
    if (!this.#presentationEmitted || !this.#presentationNeedsSettle) return;
    await new Promise((resolve) => setTimeout(resolve, DRAFT_PUBLISH_SETTLE_MS));
    this.#presentationNeedsSettle = false;
  }
}

export function collectAssistantText(messages: readonly unknown[]): string {
  const values: string[] = [];
  for (const message of messages) {
    if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const content of message.content) {
      if (isRecord(content) && content.type === "text" && typeof content.text === "string") {
        values.push(content.text);
      }
    }
  }
  return values.join("\n").trim();
}

function readSafeTerminalDraft(
  event: AgentEvent,
  boundary: PiAgentTerminalDraftBoundary | undefined
): string | undefined {
  if (!boundary || event.type !== "message_update") return undefined;
  const update = event.assistantMessageEvent;
  if (
    update.type !== "toolcall_start" &&
    update.type !== "toolcall_delta" &&
    update.type !== "toolcall_end"
  ) {
    return undefined;
  }
  const content = update.partial.content[update.contentIndex];
  if (
    !content ||
    content.type !== "toolCall" ||
    content.name !== boundary.toolName ||
    !isRecord(content.arguments)
  ) {
    return undefined;
  }
  return readSafeTerminalAnswer(content.arguments[boundary.argumentName], boundary);
}

function readSafeNativeAssistantDraft(
  event: AgentEvent,
  boundary: PiAgentTerminalDraftBoundary
): string | undefined {
  if (event.type !== "message_update") return undefined;
  const update = event.assistantMessageEvent;
  if (
    update.type !== "text_start" &&
    update.type !== "text_delta" &&
    update.type !== "text_end"
  ) {
    return undefined;
  }
  const text = update.partial.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("\n");
  return readSafeTerminalAnswer(text, boundary);
}

function readSafeTerminalAnswer(
  candidate: unknown,
  boundary: PiAgentTerminalDraftBoundary
): string | undefined {
  if (typeof candidate !== "string") return undefined;
  const text = candidate.trim();
  const characterCount = Array.from(text).length;
  if (
    characterCount === 0 ||
    characterCount > boundary.maxCharacters ||
    containsUnsafeDraftControlCharacter(text) ||
    containsRestrictedModelContent(text)
  ) {
    return undefined;
  }
  return text;
}

function containsUnsafeDraftControlCharacter(value: string): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
