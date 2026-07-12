import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AgentTurnInputKind, AgentTurnObjective } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { ConversationEventSchema, type ConversationEvent, type Locale } from "@pige/schemas";

const MAX_TURN_TEXT_BYTES = 64 * 1024;
const MAX_CONVERSATION_FILE_BYTES = 8 * 1024 * 1024;

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
}

export class AgentTurnConversationStore {
  appendUserTurn(
    vaultPath: string,
    text: string,
    metadata?: AgentTurnConversationMetadata
  ): PreservedAgentTurn {
    const boundedText = validateTurnText(text);
    const now = new Date();
    const createdAt = now.toISOString();
    const dateKey = createdAt.slice(0, 10).replaceAll("-", "");
    const monthKey = createdAt.slice(0, 7).replace("-", "/");
    const conversationId = `conv_${dateKey}`;
    const event = ConversationEventSchema.parse({
      id: `evt_${dateKey}_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      conversationId,
      type: "user_message",
      createdAt,
      text: boundedText,
      ...metadata
    });
    const locator = `.pige/conversations/${monthKey}/${conversationId}.jsonl`;
    appendEvent(vaultPath, locator, event);
    return {
      event,
      locator,
      inputHash: createTurnInputHash("user", boundedText, metadata),
      ...(metadata ? { metadata } : {})
    };
  }

  appendBlockedTurnMarker(
    vaultPath: string,
    text: string,
    metadata?: AgentTurnConversationMetadata
  ): PreservedAgentTurn {
    const boundedText = validateTurnText(text);
    const now = new Date();
    const createdAt = now.toISOString();
    const dateKey = createdAt.slice(0, 10).replaceAll("-", "");
    const monthKey = createdAt.slice(0, 7).replace("-", "/");
    const conversationId = `conv_${dateKey}`;
    const event = ConversationEventSchema.parse({
      id: `evt_${dateKey}_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      conversationId,
      type: "error",
      createdAt,
      text: "Restricted content was blocked before Agent ingress.",
      ...metadata
    });
    const locator = `.pige/conversations/${monthKey}/${conversationId}.jsonl`;
    appendEvent(vaultPath, locator, event);
    return {
      event,
      locator,
      inputHash: createTurnInputHash("blocked", boundedText, metadata),
      ...(metadata ? { metadata } : {})
    };
  }

  appendAssistantTurn(
    vaultPath: string,
    userTurn: PreservedAgentTurn,
    jobId: string,
    text: string
  ): ConversationEvent {
    const boundedText = validateTurnText(text);
    const dateKey = /^evt_(\d{8})_/u.exec(userTurn.event.id)?.[1];
    if (!dateKey || userTurn.event.type !== "user_message") {
      throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The Agent conversation binding is invalid.");
    }
    const event = ConversationEventSchema.parse({
      id: `evt_${dateKey}_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      conversationId: userTurn.event.conversationId,
      type: "assistant_message",
      createdAt: new Date().toISOString(),
      jobId,
      text: boundedText
    });
    appendEvent(vaultPath, userTurn.locator, event);
    return event;
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
    let found: ConversationEvent | undefined;
    for (const event of events) {
      if (event.id === eventId) found = event;
    }
    if (!found || found.type !== "user_message" || typeof found.text !== "string") {
      throw new PigeDomainError("agent_runtime.turn_unavailable", "The preserved Agent user turn was not found.");
    }
    const metadata = readTurnMetadata(found);
    const actualHash = createTurnInputHash("user", found.text, metadata);
    if (actualHash !== expectedInputHash) {
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
    return matches[0];
  }
}

function readConversationEvents(vaultPath: string, locator: string): ConversationEvent[] {
  const filePath = resolveConversationPath(vaultPath, locator);
  const stat = assertRegularPrivateFile(filePath);
  if (stat.size > MAX_CONVERSATION_FILE_BYTES) {
    throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation file is too large to resume safely.");
  }
  return fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean).map((line) => {
    try {
      return ConversationEventSchema.parse(JSON.parse(line));
    } catch {
      throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation history is invalid.");
    }
  });
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
  return {
    inputKind: value.inputKind as AgentTurnInputKind,
    objective: value.objective as AgentTurnObjective,
    locale: value.locale as Locale
  };
}

function appendEvent(vaultPath: string, locator: string, event: ConversationEvent): void {
  const filePath = resolveConversationPath(vaultPath, locator);
  ensurePrivateDirectoryPath(vaultPath, path.dirname(filePath));
  if (fs.existsSync(filePath)) {
    const current = assertRegularPrivateFile(filePath);
    if (current.size > MAX_CONVERSATION_FILE_BYTES) {
      throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation file is too large.");
    }
  }
  const flags = fs.constants.O_WRONLY |
    fs.constants.O_APPEND |
    fs.constants.O_CREAT |
    (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(filePath, flags, 0o600);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation file is unsafe.");
    }
    const line = `${JSON.stringify(ConversationEventSchema.parse(event))}\n`;
    if (stat.size + Buffer.byteLength(line, "utf8") > MAX_CONVERSATION_FILE_BYTES) {
      throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation file reached its size limit.");
    }
    fs.writeFileSync(descriptor, line, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function validateTurnText(value: string): string {
  const text = value.trim();
  if (!text || Buffer.byteLength(text, "utf8") > MAX_TURN_TEXT_BYTES || /\u0000/u.test(text)) {
    throw new PigeDomainError("agent_runtime.turn_invalid", "The Agent turn is empty or exceeds its transport limit.");
  }
  return text;
}

function resolveConversationPath(vaultPath: string, locator: string): string {
  if (
    !/^\.pige\/conversations\/\d{4}\/\d{2}\/conv_\d{8}(?:_[a-z0-9]{4,})?\.jsonl$/u.test(locator) ||
    locator.includes("\\") ||
    locator.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
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

function ensurePrivateDirectoryPath(vaultPath: string, directoryPath: string): void {
  const root = path.resolve(vaultPath);
  const relative = path.relative(root, directoryPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PigeDomainError("vault.path_outside_root", "The Agent conversation directory is outside the active vault.");
  }
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation directory is unsafe.");
    }
  }
}

function assertRegularPrivateFile(filePath: string): fs.Stats {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new PigeDomainError("agent_runtime.turn_unavailable", "The Agent conversation file is unsafe.");
  }
  return stat;
}

function hashValue(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function createTurnInputHash(
  kind: "user" | "blocked",
  text: string,
  metadata: AgentTurnConversationMetadata | undefined
): string {
  return hashValue(`pige.agent_turn.${kind}.v1\0${text}\0${JSON.stringify(metadata ?? null)}`);
}
