import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AgentConversationHistoryCursor,
  AgentConversationHistoryQuery,
  AgentConversationHistorySummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  AgentConversationInputPresentationSchema,
  AgentConversationHistoryQuerySchema,
  AgentConversationMetadataManifestSchema,
  AgentConversationSetTitleRequestSchema,
  AgentTurnCurrentNoteScopeSchema,
  ConversationEventSchema,
  type AgentConversationMetadataManifest,
  type AgentConversationSetTitleRequest,
  type ConversationEvent
} from "@pige/schemas";
import { containsRestrictedModelContent } from "./model-egress-content";

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 50;
const MAX_PREVIEW_CODE_POINTS = 240;
const MAX_CONVERSATION_FILE_BYTES = 8 * 1024 * 1024;
const MAX_DISCOVERY_FILES = 256;
const MAX_DISCOVERY_ENTRIES = 4_096;
const MAX_DISCOVERY_BYTES = 32 * 1024 * 1024;
const DEFAULT_CURSOR_CAPACITY = 128;
const MAX_METADATA_BYTES = 512 * 1024;
const METADATA_FILE_NAME = "conversations-manifest.json";
const CONVERSATION_FILE_PATTERN = /^(conv_(\d{8})(?:_[a-z0-9]{4,})?)\.jsonl$/u;
const UNSAFE_PREVIEW_PATTERN = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

export interface AgentConversationHistoryEntry extends AgentConversationHistorySummary {
  readonly titleRevision: number;
  readonly latestUserEventId?: string;
}

export interface AgentConversationHistoryPage {
  readonly currentConversationId?: string;
  readonly conversations: readonly AgentConversationHistoryEntry[];
  readonly hasMore: boolean;
  readonly nextCursor?: AgentConversationHistoryCursor;
}

export interface AgentConversationLifecycleTarget {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly contentHash: string;
  readonly revision: string;
  readonly summary: AgentConversationHistoryEntry;
}
export type AgentConversationTitleMutation =
  | { readonly status: "committed" | "stale"; readonly summary: AgentConversationHistoryEntry & {
      readonly titleRevision: number;
    } }
  | { readonly status: "not_found" };

interface HistoryCursorBinding {
  readonly activeVaultId: string;
  readonly vaultPath: string;
  readonly query?: AgentConversationHistoryQuery;
  readonly snapshotHash: string;
  readonly offset: number;
  readonly boundaryConversationId: string;
  readonly boundaryUpdatedAt: string;
}

export class AgentConversationHistory {
  readonly #cursors = new Map<AgentConversationHistoryCursor, HistoryCursorBinding>();
  readonly #cursorCapacity: number;
  readonly #now: () => Date;

  constructor(cursorCapacity = DEFAULT_CURSOR_CAPACITY, now: () => Date = () => new Date()) {
    this.#cursorCapacity = Math.max(1, cursorCapacity);
    this.#now = now;
  }

  list(input: {
    readonly activeVaultId: string;
    readonly vaultPath: string;
    readonly limit?: number;
    readonly cursor?: AgentConversationHistoryCursor;
    readonly query?: AgentConversationHistoryQuery;
  }): AgentConversationHistoryPage {
    const limit = validateLimit(input.limit ?? DEFAULT_PAGE_SIZE);
    const query = input.query === undefined ? undefined : AgentConversationHistoryQuerySchema.parse(input.query);
    const vaultPath = assertSafeVaultRoot(input.vaultPath);
    const allEntries = readHistoryEntries(vaultPath);
    const entries = query === undefined ? allEntries : allEntries.filter((entry) => matchesQuery(entry, query));
    const snapshotHash = createSnapshotHash(allEntries);
    let offset = 0;

    if (input.cursor) {
      const binding = this.#cursors.get(input.cursor);
      if (
        !binding ||
        binding.activeVaultId !== input.activeVaultId ||
        binding.vaultPath !== vaultPath ||
        binding.query !== query ||
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
          ...(query === undefined ? {} : { query }),
          snapshotHash,
          offset: nextOffset,
          boundaryConversationId: entries[nextOffset - 1]!.conversationId,
          boundaryUpdatedAt: entries[nextOffset - 1]!.updatedAt
        })
      : undefined;

    return {
      ...(allEntries[0] ? { currentConversationId: allEntries[0].conversationId } : {}),
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
    if (!/^evt_\d{8}_[a-z0-9]{8,}$/u.test(input.assistantEventId)) throw unavailableHistory();
    const events = this.readConversationEvents(input);
    if (!events) return undefined;
    const matches = events.filter((event) => event.id === input.assistantEventId);
    if (matches.length > 1) throw unavailableHistory();
    return matches[0]?.type === "assistant_message" ? matches[0] : undefined;
  }

  readConversationEvents(input: {
    readonly vaultPath: string;
    readonly conversationId: string;
  }): readonly ConversationEvent[] | undefined {
    const match = CONVERSATION_FILE_PATTERN.exec(`${input.conversationId}.jsonl`);
    if (!match) throw unavailableHistory();
    const dateKey = match[2]!;
    const root = assertSafeVaultRoot(input.vaultPath);
    const directory = path.join(root, ".pige", "conversations", dateKey.slice(0, 4), dateKey.slice(4, 6));
    if (!assertExistingDirectoryPath(root, directory)) return undefined;
    const filePath = path.join(directory, `${input.conversationId}.jsonl`);
    if (!lstatIfExists(filePath)) return undefined;
    const events = readConversationFile(filePath);
    if (events.some((event) => event.conversationId !== input.conversationId)) throw unavailableHistory();
    return events;
  }

  resolveLifecycleTarget(input: {
    readonly vaultPath: string;
    readonly conversationId: string;
  }): AgentConversationLifecycleTarget | undefined {
    const match = CONVERSATION_FILE_PATTERN.exec(`${input.conversationId}.jsonl`);
    if (!match) throw unavailableHistory();
    const root = assertSafeVaultRoot(input.vaultPath);
    const dateKey = match[2]!;
    const relativePath = [".pige", "conversations", dateKey.slice(0, 4), dateKey.slice(4, 6), `${input.conversationId}.jsonl`].join("/");
    const absolutePath = path.join(root, ...relativePath.split("/"));
    if (!lstatIfExists(absolutePath)) return undefined;
    const data = readConversationFileData(absolutePath);
    const summary = toHistoryEntry(input.conversationId, data.events);
    if (!summary) throw unavailableHistory();
    const digest = createHash("sha256").update(data.bytes).digest("hex");
    return {
      absolutePath,
      relativePath,
      contentHash: `sha256:${digest}`,
      revision: `conversationrev_${digest}`,
      summary: { ...summary, revision: `conversationrev_${digest}` }
    };
  }

  setTitle(input: {
    readonly vaultPath: string;
    readonly request: AgentConversationSetTitleRequest;
  }): AgentConversationTitleMutation {
    const request = AgentConversationSetTitleRequestSchema.parse(input.request);
    if (request.title !== null && containsRestrictedModelContent(request.title)) throw unavailableHistory();
    const vaultPath = assertSafeVaultRoot(input.vaultPath);
    const conversationsRoot = path.join(vaultPath, ".pige", "conversations");
    if (!assertExistingDirectoryPath(vaultPath, conversationsRoot)) return { status: "not_found" };
    const metadata = readConversationMetadata(conversationsRoot);
    const current = readHistoryEntries(vaultPath, metadata.manifest)
      .find((entry) => entry.conversationId === request.conversationId);
    if (!current) return { status: "not_found" };
    const existing = metadata.manifest.conversations.find((entry) => entry.conversationId === request.conversationId);
    if (current.tailEventId !== request.expectedTailEventId) {
      return { status: "stale", summary: current };
    }
    if (existing?.lastRequestId === request.requestId && existing.title === request.title) {
      return { status: "committed", summary: current };
    }
    if (current.titleRevision !== request.expectedTitleRevision) {
      return { status: "stale", summary: current };
    }
    if ((existing?.title ?? null) === request.title) return { status: "committed", summary: current };
    if (metadata.manifest.revision === Number.MAX_SAFE_INTEGER || (existing?.revision ?? 0) === Number.MAX_SAFE_INTEGER) {
      throw unavailableHistory();
    }
    const record = {
      conversationId: request.conversationId,
      revision: (existing?.revision ?? 0) + 1,
      title: request.title,
      tailEventId: request.expectedTailEventId,
      updatedAt: this.#now().toISOString(),
      lastRequestId: request.requestId
    };
    const next: AgentConversationMetadataManifest = AgentConversationMetadataManifestSchema.parse({
      schemaVersion: 1,
      revision: metadata.manifest.revision + 1,
      conversations: [
        ...metadata.manifest.conversations.filter((entry) => entry.conversationId !== request.conversationId),
        record
      ].sort((left, right) => left.conversationId.localeCompare(right.conversationId, "en"))
    });
    try {
      writeConversationMetadata(conversationsRoot, next, metadata.revision, () => {
        const live = readHistoryEntries(vaultPath, metadata.manifest)
          .find((entry) => entry.conversationId === request.conversationId);
        if (!live || live.tailEventId !== request.expectedTailEventId) throw invalidHistoryCursor();
      });
    } catch (caught) {
      if (!(caught instanceof PigeDomainError) || caught.code !== "agent_runtime.turn_binding_invalid") throw caught;
      const live = readHistoryEntries(vaultPath).find((entry) => entry.conversationId === request.conversationId);
      return live ? { status: "stale", summary: live } : { status: "not_found" };
    }
    const committed = readHistoryEntries(vaultPath).find((entry) => entry.conversationId === request.conversationId);
    if (!committed || committed.titleRevision !== record.revision || (committed.title ?? null) !== request.title) {
      throw unavailableHistory();
    }
    return { status: "committed", summary: committed };
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

function readHistoryEntries(
  vaultPath: string,
  knownMetadata?: AgentConversationMetadataManifest
): AgentConversationHistoryEntry[] {
  const conversationsRoot = path.join(vaultPath, ".pige", "conversations");
  if (!assertExistingDirectoryPath(vaultPath, conversationsRoot)) return [];
  const metadata = knownMetadata ?? readConversationMetadata(conversationsRoot).manifest;
  const titles = new Map(metadata.conversations.map((entry) => [entry.conversationId, entry]));

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
        const data = readConversationFileData(filePath);
        const entry = toHistoryEntry(conversationId, data.events, titles.get(conversationId));
        if (entry) {
          const digest = createHash("sha256").update(data.bytes).digest("hex");
          entries.push({ ...entry, revision: `conversationrev_${digest}` });
        }
      }
    }
  }
  return entries.sort(compareHistoryEntries);
}

function toHistoryEntry(
  conversationId: string,
  events: readonly ConversationEvent[],
  metadata?: AgentConversationMetadataManifest["conversations"][number]
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
    ...(metadata?.title ? { title: metadata.title } : {}),
    titleRevision: metadata?.revision ?? 0,
    ...(scope?.success ? { scope: scope.data } : {}),
    ...(inputPresentation?.success ? { inputPresentation: inputPresentation.data } : {}),
    ...(latestUser ? { latestUserEventId: latestUser.id } : {})
  };
}

interface ConversationMetadataRevision {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
}

function readConversationMetadata(conversationsRoot: string): {
  readonly manifest: AgentConversationMetadataManifest;
  readonly revision?: ConversationMetadataRevision;
} {
  const filePath = path.join(conversationsRoot, METADATA_FILE_NAME);
  const stat = lstatIfExists(filePath);
  if (!stat) return { manifest: { schemaVersion: 1, revision: 0, conversations: [] } };
  assertPrivateRegularFileStat(stat);
  if (stat.size <= 0 || stat.size > MAX_METADATA_BYTES) throw unavailableHistory();
  const descriptor = openReadonly(filePath);
  try {
    const held = fs.fstatSync(descriptor);
    if (!sameFileIdentity(stat, held)) throw unavailableHistory();
    const source = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(descriptor));
    return {
      manifest: AgentConversationMetadataManifestSchema.parse(JSON.parse(source)),
      revision: fileRevision(held)
    };
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw unavailableHistory();
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeConversationMetadata(
  conversationsRoot: string,
  manifest: AgentConversationMetadataManifest,
  expected: ConversationMetadataRevision | undefined,
  beforeCommit: () => void
): void {
  const destination = path.join(conversationsRoot, METADATA_FILE_NAME);
  const temporary = path.join(conversationsRoot, `.conversation-metadata.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
      (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    beforeCommit();
    const live = lstatIfExists(destination);
    if ((expected === undefined) !== (live === undefined) || (expected && (!live || !sameFileRevision(expected, live)))) {
      throw invalidHistoryCursor();
    }
    fs.renameSync(temporary, destination);
    fsyncDirectory(conversationsRoot);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.rmSync(temporary, { force: true }); } catch { /* destination was already committed */ }
  }
}

function fileRevision(stat: fs.Stats): ConversationMetadataRevision {
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs };
}

function sameFileRevision(expected: ConversationMetadataRevision, current: fs.Stats): boolean {
  return expected.dev === current.dev && expected.ino === current.ino && expected.size === current.size &&
    expected.mtimeMs === current.mtimeMs && current.isFile() && !current.isSymbolicLink();
}

function sameFileIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function fsyncDirectory(directoryPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (caught) {
    const code = caught instanceof Error && "code" in caught ? String(caught.code) : "";
    if (!["EBADF", "EINVAL", "EISDIR", "ENOSYS", "ENOTSUP", "EPERM"].includes(code)) throw caught;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function readConversationFile(filePath: string): ConversationEvent[] {
  return readConversationFileData(filePath).events;
}

function readConversationFileData(filePath: string): { readonly events: ConversationEvent[]; readonly bytes: Buffer } {
  const descriptor = openReadonly(filePath);
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    const pathStat = fs.lstatSync(filePath);
    assertPrivateRegularFileStat(descriptorStat);
    assertPrivateRegularFileStat(pathStat);
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) throw unavailableHistory();
    if (descriptorStat.size > MAX_CONVERSATION_FILE_BYTES) throw unavailableHistory();
    const bytes = fs.readFileSync(descriptor);
    const text = bytes.toString("utf8");
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
    return { events, bytes };
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

function matchesQuery(entry: AgentConversationHistoryEntry, query: AgentConversationHistoryQuery): boolean {
  const needle = normalizeSearchText(query);
  return normalizeSearchText(entry.title ?? "").includes(needle) ||
    normalizeSearchText(entry.safePreview).includes(needle);
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
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
