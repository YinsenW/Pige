import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  MemoryDisableRequestSchema,
  MemoryMutationResultSchema,
  MemoryRecordSummarySchema,
  MemorySummarySchema,
  type MemoryDisableRequest,
  type MemoryMutationResult,
  type MemoryRecordSummary,
  type MemorySummary
} from "@pige/schemas";
import { flushDirectoryWhereSupported } from "./durable-directory-sync";
import { containsRestrictedModelContent } from "./model-egress-content";

const REGISTRY_FILE = "registry.json";
const MAX_REGISTRY_BYTES = 2 * 1024 * 1024;

interface MemoryRegistry {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly events: readonly MemoryEventRecord[];
  readonly records: readonly StoredMemoryRecord[];
}

interface MemoryEventRecord {
  readonly id: string;
  readonly kind: "explicit_remember";
  readonly title: string;
  readonly body: string;
  readonly conversationId: string;
  readonly userEventId: string;
  readonly parentJobId: string;
  readonly occurredAt: string;
}

interface StoredMemoryRecord extends MemoryRecordSummary {
  readonly eventId: string;
  readonly conversationId: string;
  readonly userEventId: string;
  readonly parentJobId: string;
}

export interface RememberVaultPreferenceRequest {
  readonly vaultPath: string;
  readonly activeVaultId: string;
  readonly title: string;
  readonly body: string;
  readonly sourceConversationId: string;
  readonly sourceEventId: string;
  readonly parentJobId: string;
}

export class AgentMemoryService {
  list(vaultPath: string, activeVaultId: string): MemorySummary {
    const registry = this.#readRegistry(vaultPath);
    return projectSummary(activeVaultId, registry);
  }

  rememberPreference(request: RememberVaultPreferenceRequest): MemoryRecordSummary {
    const id = createMemoryId(request.sourceEventId);
    const registry = this.#readRegistry(request.vaultPath);
    const existing = registry.records.find((record) => record.id === id);
    if (existing) {
      if (
        existing.conversationId !== request.sourceConversationId ||
        existing.userEventId !== request.sourceEventId ||
        existing.parentJobId !== request.parentJobId
      ) {
        throw new PigeDomainError("memory.provenance_conflict", "The memory event provenance changed during retry.");
      }
      this.#writeInspectableRecord(request.vaultPath, existing);
      return existing;
    }
    const title = request.title.trim();
    const body = request.body.trim();
    if (!title || !body) {
      throw new PigeDomainError("memory.input_invalid", "A remembered preference requires bounded text.");
    }
    if (containsRestrictedModelContent(`${title}\n${body}`)) {
      throw new PigeDomainError("memory.secret_blocked", "Secret-like content cannot be saved as Agent memory.");
    }
    if (registry.revision === Number.MAX_SAFE_INTEGER || registry.records.length >= 1_000) {
      throw new PigeDomainError("memory.capacity_exhausted", "The vault memory registry is full.");
    }
    const now = new Date().toISOString();
    const summary = MemoryRecordSummarySchema.parse({
      id,
      kind: "preference",
      title,
      body,
      status: "active",
      provenance: { kind: "explicit_user_request", occurredAt: now },
      createdAt: now,
      updatedAt: now
    });
    const eventId = createMemoryEventId(request.sourceEventId);
    const event: MemoryEventRecord = {
      id: eventId,
      kind: "explicit_remember",
      title,
      body,
      conversationId: request.sourceConversationId,
      userEventId: request.sourceEventId,
      parentJobId: request.parentJobId,
      occurredAt: now
    };
    const record: StoredMemoryRecord = {
      ...summary,
      eventId,
      conversationId: request.sourceConversationId,
      userEventId: request.sourceEventId,
      parentJobId: request.parentJobId
    };
    const next = {
      schemaVersion: 1 as const,
      revision: registry.revision + 1,
      events: [...registry.events, event],
      records: [...registry.records, record]
    };
    this.#writeRegistry(request.vaultPath, next);
    this.#writeInspectableRecord(request.vaultPath, record);
    return record;
  }

  disable(vaultPath: string, request: MemoryDisableRequest): MemoryMutationResult {
    const parsed = MemoryDisableRequestSchema.parse(request);
    const registry = this.#readRegistry(vaultPath);
    if (parsed.expectedRevision !== registry.revision) {
      return MemoryMutationResultSchema.parse({ status: "stale", summary: projectSummary(parsed.activeVaultId, registry) });
    }
    const index = registry.records.findIndex((record) => record.id === parsed.memoryId);
    if (index < 0) {
      return MemoryMutationResultSchema.parse({ status: "not_found", summary: projectSummary(parsed.activeVaultId, registry) });
    }
    const current = registry.records[index]!;
    if (current.status === "disabled") {
      return MemoryMutationResultSchema.parse({ status: "committed", summary: projectSummary(parsed.activeVaultId, registry) });
    }
    const records = [...registry.records];
    records[index] = {
      ...current,
      status: "disabled",
      updatedAt: new Date().toISOString()
    };
    const next = { schemaVersion: 1 as const, revision: registry.revision + 1, events: registry.events, records };
    this.#writeRegistry(vaultPath, next);
    this.#writeInspectableRecord(vaultPath, records[index]!);
    return MemoryMutationResultSchema.parse({ status: "committed", summary: projectSummary(parsed.activeVaultId, next) });
  }

  recall(vaultPath: string, limit = 8): readonly MemoryRecordSummary[] {
    return this.#readRegistry(vaultPath).records
      .filter((record) => record.status === "active")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, Math.max(0, Math.min(limit, 8)));
  }

  #readRegistry(vaultPath: string): MemoryRegistry {
    const root = ensureMemoryRoot(vaultPath);
    const registryPath = path.join(root, REGISTRY_FILE);
    if (!fs.existsSync(registryPath)) return { schemaVersion: 1, revision: 0, events: [], records: [] };
    const stats = fs.lstatSync(registryPath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_REGISTRY_BYTES) {
      throw new PigeDomainError("memory.registry_invalid", "The vault memory registry is unsafe.");
    }
    const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8")) as MemoryRegistry;
    if (parsed.schemaVersion !== 1 || !Number.isSafeInteger(parsed.revision) || parsed.revision < 0 || !Array.isArray(parsed.events) || !Array.isArray(parsed.records)) {
      throw new PigeDomainError("memory.registry_invalid", "The vault memory registry is invalid.");
    }
    const events = parsed.events.map(parseMemoryEvent);
    const records = parsed.records.map(parseStoredMemoryRecord);
    assertRegistryBindings(events, records);
    return {
      schemaVersion: 1,
      revision: parsed.revision,
      events,
      records
    };
  }

  #writeRegistry(vaultPath: string, registry: MemoryRegistry): void {
    const root = ensureMemoryRoot(vaultPath);
    atomicWrite(path.join(root, REGISTRY_FILE), `${JSON.stringify(registry, null, 2)}\n`);
  }

  #writeInspectableRecord(vaultPath: string, record: MemoryRecordSummary): void {
    const atomsRoot = path.join(ensureMemoryRoot(vaultPath), "atoms");
    ensureDirectory(atomsRoot);
    const frontmatter = JSON.stringify({ ...record, body: undefined });
    atomicWrite(path.join(atomsRoot, `${record.id}.md`), `---\n${frontmatter}\n---\n\n${record.body}\n`);
  }
}

function projectSummary(activeVaultId: string, registry: MemoryRegistry): MemorySummary {
  return MemorySummarySchema.parse({
    apiVersion: 1,
    activeVaultId,
    revision: registry.revision,
  records: [...registry.records]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(projectRecord)
  });
}

function createMemoryId(sourceEventId: string): string {
  const match = /^evt_(\d{8})_[a-z0-9]{8,}$/u.exec(sourceEventId);
  if (!match) throw new PigeDomainError("memory.provenance_invalid", "Memory requires a durable user event identity.");
  const date = match[1]!;
  return `memory_${date}_${createHash("sha256").update(sourceEventId).digest("hex").slice(0, 20)}`;
}

function createMemoryEventId(sourceEventId: string): string {
  return `memory_event_${createHash("sha256").update(sourceEventId).digest("hex").slice(0, 20)}`;
}

function projectRecord(record: StoredMemoryRecord): MemoryRecordSummary {
  return MemoryRecordSummarySchema.parse({
    id: record.id,
    kind: record.kind,
    title: record.title,
    body: record.body,
    status: record.status,
    provenance: record.provenance,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  });
}

function parseMemoryEvent(value: unknown): MemoryEventRecord {
  if (!value || typeof value !== "object") throw new PigeDomainError("memory.registry_invalid", "A memory event is invalid.");
  const event = value as Partial<MemoryEventRecord>;
  if (
    typeof event.id !== "string" || !/^memory_event_[a-f0-9]{20}$/u.test(event.id) ||
    event.kind !== "explicit_remember" || typeof event.title !== "string" || typeof event.body !== "string" ||
    typeof event.conversationId !== "string" || typeof event.userEventId !== "string" ||
    typeof event.parentJobId !== "string" || typeof event.occurredAt !== "string"
  ) {
    throw new PigeDomainError("memory.registry_invalid", "A memory event is invalid.");
  }
  return event as MemoryEventRecord;
}

function parseStoredMemoryRecord(value: unknown): StoredMemoryRecord {
  if (!value || typeof value !== "object") throw new PigeDomainError("memory.registry_invalid", "A memory atom is invalid.");
  const record = value as Partial<StoredMemoryRecord>;
  const summary = projectRecord(record as StoredMemoryRecord);
  if (
    typeof record.eventId !== "string" || !/^memory_event_[a-f0-9]{20}$/u.test(record.eventId) ||
    typeof record.conversationId !== "string" || typeof record.userEventId !== "string" ||
    typeof record.parentJobId !== "string"
  ) {
    throw new PigeDomainError("memory.registry_invalid", "A memory atom provenance binding is invalid.");
  }
  return { ...summary, eventId: record.eventId, conversationId: record.conversationId, userEventId: record.userEventId, parentJobId: record.parentJobId };
}

function assertRegistryBindings(
  events: readonly MemoryEventRecord[],
  records: readonly StoredMemoryRecord[]
): void {
  const eventsById = new Map<string, MemoryEventRecord>();
  for (const event of events) {
    if (eventsById.has(event.id)) throw registryInvalid("The memory registry contains duplicate events.");
    eventsById.set(event.id, event);
  }
  const recordIds = new Set<string>();
  const boundEventIds = new Set<string>();
  for (const record of records) {
    if (recordIds.has(record.id) || boundEventIds.has(record.eventId)) {
      throw registryInvalid("The memory registry contains duplicate atoms.");
    }
    recordIds.add(record.id);
    boundEventIds.add(record.eventId);
    const event = eventsById.get(record.eventId);
    if (
      !event ||
      event.title !== record.title ||
      event.body !== record.body ||
      event.conversationId !== record.conversationId ||
      event.userEventId !== record.userEventId ||
      event.parentJobId !== record.parentJobId ||
      event.occurredAt !== record.provenance.occurredAt ||
      event.occurredAt !== record.createdAt ||
      record.id !== createMemoryId(event.userEventId) ||
      event.id !== createMemoryEventId(event.userEventId)
    ) {
      throw registryInvalid("A memory atom is not bound to its explicit event.");
    }
  }
  if (eventsById.size !== boundEventIds.size) {
    throw registryInvalid("The memory registry contains an unbound event.");
  }
}

function registryInvalid(message: string): PigeDomainError {
  return new PigeDomainError("memory.registry_invalid", message);
}

function ensureMemoryRoot(vaultPath: string): string {
  if (!path.isAbsolute(vaultPath)) throw new PigeDomainError("memory.vault_invalid", "Memory requires an active vault.");
  const vaultRoot = fs.realpathSync.native(vaultPath);
  const root = path.join(vaultRoot, ".pige", "memory");
  ensureDirectory(root);
  if (!fs.realpathSync.native(root).startsWith(`${vaultRoot}${path.sep}`)) {
    throw new PigeDomainError("memory.path_unsafe", "The memory root escapes the active vault.");
  }
  return root;
}

function ensureDirectory(directoryPath: string): void {
  fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  const stats = fs.lstatSync(directoryPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new PigeDomainError("memory.path_unsafe", "A memory directory is unsafe.");
  }
}

function atomicWrite(filePath: string, contents: string): void {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0),
      0o600
    );
    fs.writeFileSync(descriptor, contents, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
    flushDirectoryWhereSupported(path.dirname(filePath));
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
  }
}
