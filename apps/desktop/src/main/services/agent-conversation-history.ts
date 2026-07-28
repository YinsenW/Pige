import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AgentConversationHistoryCursor,
  AgentConversationHistorySummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  AgentConversationInputPresentationSchema,
  AgentTurnCurrentNoteScopeSchema,
  ConversationEventSchema,
  type ConversationEvent
} from "@pige/schemas";

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 50;
const MAX_PREVIEW_CODE_POINTS = 240;
const MAX_CONVERSATION_FILE_BYTES = 8 * 1024 * 1024;
const MAX_DISCOVERY_FILES = 256;
const MAX_DISCOVERY_ENTRIES = 4_096;
const MAX_DISCOVERY_BYTES = 32 * 1024 * 1024;
const DEFAULT_CURSOR_CAPACITY = 128;
const CONVERSATION_FILE_PATTERN = /^(conv_(\d{8})(?:_[a-z0-9]{4,})?)\.jsonl$/u;
const UNSAFE_PREVIEW_PATTERN = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

export interface AgentConversationHistoryEntry extends AgentConversationHistorySummary {
  readonly latestUserEventId?: string;
}

export interface AgentConversationHistoryPage {
  readonly currentConversationId?: string;
  readonly conversations: readonly AgentConversationHistoryEntry[];
  readonly hasMore: boolean;
  readonly nextCursor?: AgentConversationHistoryCursor;
}

interface HistoryCursorBinding {
  readonly activeVaultId: string;
  readonly vaultPath: string;
  readonly snapshotHash: string;
  readonly offset: number;
  readonly boundaryConversationId: string;
  readonly boundaryUpdatedAt: string;
}

export class AgentConversationHistory {
  readonly #cursors = new Map<AgentConversationHistoryCursor, HistoryCursorBinding>();
  readonly #cursorCapacity: number;

  constructor(cursorCapacity = DEFAULT_CURSOR_CAPACITY) {
    this.#cursorCapacity = Math.max(1, cursorCapacity);
  }

  list(input: {
    readonly activeVaultId: string;
    readonly vaultPath: string;
    readonly limit?: number;
    readonly cursor?: AgentConversationHistoryCursor;
  }): AgentConversationHistoryPage {
    const limit = validateLimit(input.limit ?? DEFAULT_PAGE_SIZE);
    const vaultPath = assertSafeVaultRoot(input.vaultPath);
    const entries = readHistoryEntries(vaultPath);
    const snapshotHash = createSnapshotHash(entries);
    let offset = 0;

    if (input.cursor) {
      const binding = this.#cursors.get(input.cursor);
      if (
        !binding ||
        binding.activeVaultId !== input.activeVaultId ||
        binding.vaultPath !== vaultPath ||
        binding.snapshotHash !== snapshotHash ||
        binding.offset < 1 ||
        entries[binding.offset - 1]?.conversationId !== binding.boundaryConversationId ||
        entries[binding.offset - 1]?.updatedAt !== binding.boundaryUpdatedAt
      ) {
        throw invalidHistoryCursor();
      }
      offset = binding.offset;
    }

    if (offset >= entries.length && entries.length > 0) throw invalidHistoryCursor();
    const conversations = entries.slice(offset, offset + limit);
    const nextOffset = offset + conversations.length;
    const hasMore = nextOffset < entries.length;
    const nextCursor = hasMore
      ? this.#registerCursor({
          activeVaultId: input.activeVaultId,
          vaultPath,
          snapshotHash,
          offset: nextOffset,
          boundaryConversationId: entries[nextOffset - 1]!.conversationId,
          boundaryUpdatedAt: entries[nextOffset - 1]!.updatedAt
        })
      : undefined;

    return {
      ...(entries[0] ? { currentConversationId: entries[0].conversationId } : {}),
      conversations,
      hasMore,
      ...(nextCursor ? { nextCursor } : {})
    };
  }

  readAssistantEvent(input: {
    readonly vaultPath: string;
    readonly conversationId: string;
    readonly assistantEventId: string;
  }): ConversationEvent | undefined {
    const match = CONVERSATION_FILE_PATTERN.exec(`${input.conversationId}.jsonl`);
    if (!match || !/^evt_\d{8}_[a-z0-9]{8,}$/u.test(input.assistantEventId)) {
      throw unavailableHistory();
    }
    const dateKey = match[2]!;
    const root = assertSafeVaultRoot(input.vaultPath);
    const directory = path.join(root, ".pige", "conversations", dateKey.slice(0, 4), dateKey.slice(4, 6));
    if (!assertExistingDirectoryPath(root, directory)) return undefined;
    const filePath = path.join(directory, `${input.conversationId}.jsonl`);
    if (!lstatIfExists(filePath)) return undefined;
    const events = readConversationFile(filePath);
    if (events.some((event) => event.conversationId !== input.conversationId)) throw unavailableHistory();
    const matches = events.filter((event) => event.id === input.assistantEventId);
    if (matches.length > 1) throw unavailableHistory();
    return matches[0]?.type === "assistant_message" ? matches[0] : undefined;
  }

  #registerCursor(binding: HistoryCursorBinding): AgentConversationHistoryCursor {
    const cursor = `conversation_history_${randomBytes(32).toString("hex")}` as AgentConversationHistoryCursor;
    this.#cursors.set(cursor, binding);
    while (this.#cursors.size > this.#cursorCapacity) {
      const oldest = this.#cursors.keys().next().value as AgentConversationHistoryCursor | undefined;
      if (!oldest) break;
      this.#cursors.delete(oldest);
    }
    return cursor;
  }
}

function readHistoryEntries(vaultPath: string): AgentConversationHistoryEntry[] {
  const conversationsRoot = path.join(vaultPath, ".pige", "conversations");
  if (!assertExistingDirectoryPath(vaultPath, conversationsRoot)) return [];

  const entries: AgentConversationHistoryEntry[] = [];
  const budget = { entries: 0, files: 0, bytes: 0 };
  for (const yearEntry of readDirectoryEntries(conversationsRoot, budget)) {
    if (!/^\d{4}$/u.test(yearEntry.name)) continue;
    assertDirectoryEntry(yearEntry);
    const yearPath = path.join(conversationsRoot, yearEntry.name);
    for (const monthEntry of readDirectoryEntries(yearPath, budget)) {
      if (!/^\d{2}$/u.test(monthEntry.name)) continue;
      assertDirectoryEntry(monthEntry);
      const monthPath = path.join(yearPath, monthEntry.name);
      for (const fileEntry of readDirectoryEntries(monthPath, budget)) {
        const match = CONVERSATION_FILE_PATTERN.exec(fileEntry.name);
        if (!match) continue;
        if (!fileEntry.isFile() || fileEntry.isSymbolicLink()) throw unavailableHistory();
        const conversationId = match[1]!;
        const dateKey = match[2]!;
        if (yearEntry.name !== dateKey.slice(0, 4) || monthEntry.name !== dateKey.slice(4, 6)) {
          throw unavailableHistory();
        }
        budget.files += 1;
        if (budget.files > MAX_DISCOVERY_FILES) throw unavailableHistory();
        const filePath = path.join(monthPath, fileEntry.name);
        const stat = assertPrivateRegularFile(filePath);
        budget.bytes += stat.size;
        if (stat.size > MAX_CONVERSATION_FILE_BYTES || budget.bytes > MAX_DISCOVERY_BYTES) {
          throw unavailableHistory();
        }
        const events = readConversationFile(filePath);
        const entry = toHistoryEntry(conversationId, events);
        if (entry) entries.push(entry);
      }
    }
  }
  return entries.sort(compareHistoryEntries);
}

function toHistoryEntry(
  conversationId: string,
  events: readonly ConversationEvent[]
): AgentConversationHistoryEntry | undefined {
  if (events.some((event) => event.conversationId !== conversationId)) throw unavailableHistory();
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
  return {
    conversationId,
    updatedAt: tail.createdAt,
    safePreview,
    tailEventId: tail.id,
    ...(scope?.success ? { scope: scope.data } : {}),
    ...(inputPresentation?.success ? { inputPresentation: inputPresentation.data } : {}),
    ...(latestUser ? { latestUserEventId: latestUser.id } : {})
  };
}

function readConversationFile(filePath: string): ConversationEvent[] {
  const descriptor = openReadonly(filePath);
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    const pathStat = fs.lstatSync(filePath);
    assertPrivateRegularFileStat(descriptorStat);
    assertPrivateRegularFileStat(pathStat);
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) throw unavailableHistory();
    if (descriptorStat.size > MAX_CONVERSATION_FILE_BYTES) throw unavailableHistory();
    const text = fs.readFileSync(descriptor, "utf8");
    const events: ConversationEvent[] = [];
    const ids = new Set<string>();
    for (const line of text.split("\n").filter(Boolean)) {
      let event: ConversationEvent;
      try {
        const raw = JSON.parse(line) as Record<string, unknown>;
        delete raw.authoredTaskIntent;
        event = ConversationEventSchema.parse(raw);
      } catch {
        throw unavailableHistory();
      }
      if (ids.has(event.id)) throw unavailableHistory();
      ids.add(event.id);
      events.push(event);
    }
    return events;
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw unavailableHistory();
  } finally {
    fs.closeSync(descriptor);
  }
}

function readDirectoryEntries(
  directoryPath: string,
  budget: { entries: number }
): fs.Dirent[] {
  let directory: fs.Dir;
  try {
    directory = fs.opendirSync(directoryPath);
  } catch {
    throw unavailableHistory();
  }
  const entries: fs.Dirent[] = [];
  try {
    for (;;) {
      const entry = directory.readSync();
      if (!entry) break;
      budget.entries += 1;
      if (budget.entries > MAX_DISCOVERY_ENTRIES) throw unavailableHistory();
      entries.push(entry);
    }
  } finally {
    directory.closeSync();
  }
  return entries;
}

function createSafePreview(value: string): string {
  const oneLine = value.replace(UNSAFE_PREVIEW_PATTERN, " ").replace(/\s+/gu, " ").trim();
  const codePoints = [...(oneLine || "Conversation")];
  return codePoints.slice(0, MAX_PREVIEW_CODE_POINTS).join("");
}

function createSnapshotHash(entries: readonly AgentConversationHistoryEntry[]): string {
  return createHash("sha256").update(JSON.stringify(entries), "utf8").digest("hex");
}

function compareHistoryEntries(left: AgentConversationHistoryEntry, right: AgentConversationHistoryEntry): number {
  const updated = right.updatedAt.localeCompare(left.updatedAt, "en");
  return updated || left.conversationId.localeCompare(right.conversationId, "en");
}

function validateLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw invalidHistoryCursor();
  return limit;
}

function assertSafeVaultRoot(vaultPath: string): string {
  const root = path.resolve(vaultPath);
  const stat = lstatIfExists(root);
  if (!stat) throw unavailableHistory();
  assertDirectory(stat);
  return root;
}

function assertExistingDirectoryPath(vaultPath: string, directoryPath: string): boolean {
  const root = assertSafeVaultRoot(vaultPath);
  const relative = path.relative(root, directoryPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw unavailableHistory();
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = lstatIfExists(current);
    if (!stat) return false;
    assertDirectory(stat);
  }
  return true;
}

function assertDirectory(stat: fs.Stats): void {
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw unavailableHistory();
}

function assertDirectoryEntry(entry: fs.Dirent): void {
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw unavailableHistory();
}

function assertPrivateRegularFile(filePath: string): fs.Stats {
  const stat = lstatIfExists(filePath);
  if (!stat) throw unavailableHistory();
  assertPrivateRegularFileStat(stat);
  return stat;
}

function assertPrivateRegularFileStat(stat: fs.Stats): void {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw unavailableHistory();
}

function openReadonly(filePath: string): number {
  try {
    return fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch {
    throw unavailableHistory();
  }
}

function lstatIfExists(targetPath: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(targetPath);
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw unavailableHistory();
  }
}

function invalidHistoryCursor(): PigeDomainError {
  return new PigeDomainError("agent_runtime.turn_binding_invalid", "The conversation history cursor is invalid.");
}

function unavailableHistory(): PigeDomainError {
  return new PigeDomainError("agent_runtime.turn_unavailable", "The conversation history is unavailable.");
}
