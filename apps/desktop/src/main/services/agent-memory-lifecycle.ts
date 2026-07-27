import { createHash } from "node:crypto";
import { PigeDomainError } from "@pige/domain";
import {
  OperationRecordSchema,
  type MemoryRecordSummary,
  type OperationRecord
} from "@pige/schemas";

export const MEMORY_OPERATION_ID_PATTERN = /^op_(\d{8})_[a-z0-9]{8,}$/u;

export interface MemoryRegistry {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly events: readonly MemoryEventRecord[];
  readonly records: readonly StoredMemoryRecord[];
}

export interface MemoryEventRecord {
  readonly id: string;
  readonly kind: "explicit_remember";
  readonly title: string;
  readonly body: string;
  readonly conversationId: string;
  readonly userEventId: string;
  readonly parentJobId: string;
  readonly occurredAt: string;
}

export interface StoredMemoryRecord extends MemoryRecordSummary {
  readonly eventId: string;
  readonly conversationId: string;
  readonly userEventId: string;
  readonly parentJobId: string;
}

export type MemoryLifecycleAction = "enable" | "delete" | "reset";

export interface MemoryLifecycleReceipt {
  readonly schemaVersion: 1;
  readonly action: MemoryLifecycleAction;
  readonly requestId: string;
  readonly activeVaultId: string;
  readonly memoryId?: string;
  readonly expectedRevision: number;
  readonly operationId: string;
  readonly createdAt: string;
  readonly beforeRevision: number;
  readonly afterRevision: number;
  readonly beforeRegistryHash: string;
  readonly afterRegistryHash: string;
  readonly removedEvents: readonly MemoryEventRecord[];
  readonly removedRecords: readonly StoredMemoryRecord[];
  readonly beforeRecord?: StoredMemoryRecord;
  readonly afterRecord?: StoredMemoryRecord;
}

export interface MemoryRestoreIntent {
  readonly schemaVersion: 1;
  readonly originalOperationId: string;
  readonly undoOperationId: string;
  readonly createdAt: string;
  readonly baseRevision: number;
  readonly restoredRevision: number;
  readonly baseRegistryHash: string;
  readonly restoredRegistryHash: string;
}

export interface MemoryOperationBinding {
  readonly action: MemoryLifecycleAction | "restore";
  readonly memoryId?: string;
  readonly receiptPath: string;
  readonly beforeRevision: number;
  readonly afterRevision: number;
}

export function prepareMemoryMutation(
  registry: MemoryRegistry,
  input: { readonly action: MemoryLifecycleAction; readonly memoryId?: string },
  now: string
): {
  readonly next: MemoryRegistry;
  readonly removedEvents: readonly MemoryEventRecord[];
  readonly removedRecords: readonly StoredMemoryRecord[];
  readonly beforeRecord?: StoredMemoryRecord;
  readonly afterRecord?: StoredMemoryRecord;
} | undefined {
  if (input.action === "enable") {
    const index = registry.records.findIndex((record) => record.id === input.memoryId);
    if (index < 0 || registry.records[index]!.status !== "disabled") return undefined;
    const beforeRecord = registry.records[index]!;
    const afterRecord = { ...beforeRecord, status: "active" as const, updatedAt: now };
    const records = [...registry.records];
    records[index] = afterRecord;
    return {
      next: { schemaVersion: 1, revision: registry.revision + 1, events: registry.events, records },
      removedEvents: [],
      removedRecords: [],
      beforeRecord,
      afterRecord
    };
  }
  const removedRecords = input.action === "reset"
    ? [...registry.records]
    : registry.records.filter((record) => record.id === input.memoryId);
  if (removedRecords.length === 0) return undefined;
  const removedEventIds = new Set(removedRecords.map((record) => record.eventId));
  return {
    next: {
      schemaVersion: 1,
      revision: registry.revision + 1,
      events: registry.events.filter((event) => !removedEventIds.has(event.id)),
      records: registry.records.filter((record) => !removedEventIds.has(record.eventId))
    },
    removedEvents: registry.events.filter((event) => removedEventIds.has(event.id)),
    removedRecords
  };
}

export function applyMemoryReceipt(registry: MemoryRegistry, receipt: MemoryLifecycleReceipt): MemoryRegistry {
  if (receipt.action === "enable") {
    const index = registry.records.findIndex((record) => record.id === receipt.memoryId);
    if (
      index < 0 || !receipt.beforeRecord || !receipt.afterRecord ||
      stableJson(registry.records[index]) !== stableJson(receipt.beforeRecord)
    ) throw memoryLifecycleConflict();
    const records = [...registry.records];
    records[index] = receipt.afterRecord;
    return { schemaVersion: 1, revision: receipt.afterRevision, events: registry.events, records };
  }
  const removedIds = new Set(receipt.removedRecords.map((record) => record.id));
  const removedEventIds = new Set(receipt.removedEvents.map((event) => event.id));
  if (
    receipt.removedRecords.some((removed) => !registry.records.some((record) => stableJson(record) === stableJson(removed))) ||
    receipt.removedEvents.some((removed) => !registry.events.some((event) => stableJson(event) === stableJson(removed)))
  ) throw memoryLifecycleConflict();
  return {
    schemaVersion: 1,
    revision: receipt.afterRevision,
    events: registry.events.filter((event) => !removedEventIds.has(event.id)),
    records: registry.records.filter((record) => !removedIds.has(record.id))
  };
}

export function createMemoryUndoRegistry(
  registry: MemoryRegistry,
  receipt: MemoryLifecycleReceipt,
  now: string
): MemoryRegistry {
  if (registry.revision === Number.MAX_SAFE_INTEGER) throw memoryLifecycleConflict();
  if (receipt.action === "enable") {
    const current = registry.records.find((record) => record.id === receipt.memoryId);
    if (
      !current || !receipt.afterRecord || !receipt.beforeRecord ||
      stableJson(current) !== stableJson(receipt.afterRecord)
    ) throw memoryLifecycleConflict();
    const records = registry.records.map((record) => record.id === current.id
      ? { ...receipt.beforeRecord!, updatedAt: now }
      : record);
    return { schemaVersion: 1, revision: registry.revision + 1, events: registry.events, records };
  }
  const eventIds = new Set(registry.events.map((event) => event.id));
  const recordIds = new Set(registry.records.map((record) => record.id));
  if (
    receipt.removedEvents.some((event) => eventIds.has(event.id)) ||
    receipt.removedRecords.some((record) => recordIds.has(record.id))
  ) throw memoryLifecycleConflict();
  const next = {
    schemaVersion: 1 as const,
    revision: registry.revision + 1,
    events: [...registry.events, ...receipt.removedEvents],
    records: [...registry.records, ...receipt.removedRecords]
  };
  assertMemoryRegistryBindings(next.events, next.records);
  return next;
}

export function restoredMemoryRecords(
  receipt: MemoryLifecycleReceipt,
  registry: MemoryRegistry
): readonly StoredMemoryRecord[] {
  if (receipt.action === "enable") return registry.records.filter((record) => record.id === receipt.memoryId);
  const restored = new Set(receipt.removedRecords.map((record) => record.id));
  return registry.records.filter((record) => restored.has(record.id));
}

export function createMemoryLifecycleOperation(receipt: MemoryLifecycleReceipt): OperationRecord {
  const targetRefs = receipt.memoryId ? [{ kind: "memory" as const, id: receipt.memoryId }] : [];
  return OperationRecordSchema.parse({
    id: receipt.operationId,
    schemaVersion: 1,
    createdAt: receipt.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: receipt.action === "enable" ? "update_memory" : "trash_memory",
    targetRefs,
    sourceRefs: [],
    before: {
      kind: "memory",
      id: `registry_revision_${receipt.beforeRevision}`,
      path: memoryReceiptRelativePath(receipt),
      checksum: receipt.beforeRegistryHash
    },
    after: {
      kind: "memory",
      id: `registry_revision_${receipt.afterRevision}`,
      path: ".pige/memory/registry.json",
      checksum: receipt.afterRegistryHash
    },
    summary: receipt.action === "enable"
      ? "Enabled an Agent memory record."
      : receipt.action === "delete"
        ? "Moved an Agent memory record to private trash."
        : "Moved all Agent memory records to private trash.",
    reversible: "yes",
    rollbackHint: "Restore the exact private memory receipt without replacing later memory records.",
    warnings: []
  });
}

export function createMemoryRestoreOperation(
  original: OperationRecord,
  receipt: MemoryLifecycleReceipt,
  intent: MemoryRestoreIntent
): OperationRecord {
  const targetRefs = receipt.memoryId ? [{ kind: "memory" as const, id: receipt.memoryId }] : [];
  return OperationRecordSchema.parse({
    id: intent.undoOperationId,
    schemaVersion: 1,
    createdAt: intent.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "restore_memory",
    targetRefs,
    sourceRefs: [{ kind: "operation", id: original.id }],
    before: {
      kind: "memory",
      id: `registry_revision_${intent.baseRevision}`,
      path: memoryRestoreIntentRelativePath(original.id),
      checksum: intent.baseRegistryHash
    },
    after: {
      kind: "memory",
      id: `registry_revision_${intent.restoredRevision}`,
      path: ".pige/memory/registry.json",
      checksum: intent.restoredRegistryHash
    },
    summary: receipt.action === "enable"
      ? "Restored the prior disabled Agent memory state."
      : receipt.action === "delete"
        ? "Restored an Agent memory record from private trash."
        : "Restored Agent memory records from private trash.",
    reversible: "best_effort",
    rollbackHint: "Create another explicit memory lifecycle action if the restored registry remains current.",
    warnings: []
  });
}

export function memoryUndoUnavailableReason(
  registry: MemoryRegistry,
  receipt: MemoryLifecycleReceipt
): "content_changed" | "revision_changed" | "target_missing" | undefined {
  if (registry.revision < receipt.afterRevision) return "revision_changed";
  if (receipt.action === "enable") {
    const current = registry.records.find((record) => record.id === receipt.memoryId);
    if (!current) return "target_missing";
    return receipt.afterRecord && stableJson(current) === stableJson(receipt.afterRecord)
      ? undefined
      : "content_changed";
  }
  const eventIds = new Set(registry.events.map((event) => event.id));
  const recordIds = new Set(registry.records.map((record) => record.id));
  return receipt.removedEvents.some((event) => eventIds.has(event.id)) ||
    receipt.removedRecords.some((record) => recordIds.has(record.id))
    ? "content_changed"
    : undefined;
}

export function readMemoryOperationBinding(operation: OperationRecord): MemoryOperationBinding | undefined {
  if (!(operation.kind === "update_memory" || operation.kind === "trash_memory" || operation.kind === "restore_memory")) {
    return undefined;
  }
  if (
    operation.actor.kind !== "user" || operation.actor.runtimeKind !== "desktop_local" ||
    operation.jobId !== undefined || operation.proposalId !== undefined || operation.modelProfileId !== undefined ||
    operation.skillId !== undefined || operation.packageId !== undefined || operation.policyAudit !== undefined ||
    operation.targetRefs.length > 1 || operation.targetRefs.some((reference) => reference.kind !== "memory" || !!reference.path) ||
    operation.before?.kind !== "memory" || operation.after?.kind !== "memory" ||
    !operation.before.path || !operation.after.path || !operation.before.checksum || !operation.after.checksum ||
    !/^sha256:[a-f0-9]{64}$/u.test(operation.before.checksum) ||
    !/^sha256:[a-f0-9]{64}$/u.test(operation.after.checksum) ||
    operation.after.path !== ".pige/memory/registry.json"
  ) return undefined;
  const beforeRevision = parseRegistryRevision(operation.before.id);
  const afterRevision = parseRegistryRevision(operation.after.id);
  if (beforeRevision === undefined || afterRevision === undefined || afterRevision <= beforeRevision) return undefined;
  if (operation.kind === "restore_memory") {
    if (operation.sourceRefs.length !== 1 || operation.sourceRefs[0]?.kind !== "operation") return undefined;
    return {
      action: "restore",
      ...(operation.targetRefs[0] ? { memoryId: operation.targetRefs[0].id } : {}),
      receiptPath: operation.before.path,
      beforeRevision,
      afterRevision
    };
  }
  if (operation.sourceRefs.length !== 0) return undefined;
  return {
    action: operation.kind === "update_memory" ? "enable" : operation.targetRefs.length === 0 ? "reset" : "delete",
    ...(operation.targetRefs[0] ? { memoryId: operation.targetRefs[0].id } : {}),
    receiptPath: operation.before.path,
    beforeRevision,
    afterRevision
  };
}

export function isMatchingMemoryRestoreOperation(
  original: OperationRecord,
  candidate: OperationRecord
): boolean {
  const originalBinding = readMemoryOperationBinding(original);
  const restoreBinding = readMemoryOperationBinding(candidate);
  return !!originalBinding && !!restoreBinding && restoreBinding.action === "restore" &&
    candidate.id === createMemoryUndoOperationId(original.id) &&
    candidate.sourceRefs.length === 1 && candidate.sourceRefs[0]?.kind === "operation" &&
    candidate.sourceRefs[0].id === original.id && restoreBinding.memoryId === originalBinding.memoryId &&
    restoreBinding.beforeRevision >= originalBinding.afterRevision;
}

export function createMemoryId(sourceEventId: string): string {
  const match = /^evt_(\d{8})_[a-z0-9]{8,}$/u.exec(sourceEventId);
  if (!match) throw new PigeDomainError("memory.provenance_invalid", "Memory requires a durable user event identity.");
  return `memory_${match[1]!}_${createHash("sha256").update(sourceEventId).digest("hex").slice(0, 20)}`;
}

export function createMemoryEventId(sourceEventId: string): string {
  return `memory_event_${createHash("sha256").update(sourceEventId).digest("hex").slice(0, 20)}`;
}

export function createMemoryOperationId(requestId: string, createdAt: string): string {
  const date = createdAt.slice(0, 10).replace(/-/gu, "");
  const suffix = createHash("sha256").update(`pige.memory.lifecycle.v1\0${requestId}`).digest("hex").slice(0, 20);
  return `op_${date}_${suffix}`;
}

export function createMemoryUndoOperationId(operationId: string): string {
  const date = MEMORY_OPERATION_ID_PATTERN.exec(operationId)?.[1];
  if (!date) throw memoryLifecycleConflict();
  const suffix = createHash("sha256").update(`pige.memory.lifecycle.undo.v1\0${operationId}`).digest("hex").slice(0, 20);
  return `op_${date}_${suffix}`;
}

export function assertMemoryRegistryBindings(
  events: readonly MemoryEventRecord[],
  records: readonly StoredMemoryRecord[]
): void {
  const eventsById = new Map<string, MemoryEventRecord>();
  for (const event of events) {
    if (eventsById.has(event.id)) throw memoryRegistryInvalid("The memory registry contains duplicate events.");
    eventsById.set(event.id, event);
  }
  const recordIds = new Set<string>();
  const boundEventIds = new Set<string>();
  for (const record of records) {
    if (recordIds.has(record.id) || boundEventIds.has(record.eventId)) {
      throw memoryRegistryInvalid("The memory registry contains duplicate atoms.");
    }
    recordIds.add(record.id);
    boundEventIds.add(record.eventId);
    const event = eventsById.get(record.eventId);
    if (
      !event || event.title !== record.title || event.body !== record.body ||
      event.conversationId !== record.conversationId || event.userEventId !== record.userEventId ||
      event.parentJobId !== record.parentJobId || event.occurredAt !== record.provenance.occurredAt ||
      event.occurredAt !== record.createdAt || record.id !== createMemoryId(event.userEventId) ||
      event.id !== createMemoryEventId(event.userEventId)
    ) throw memoryRegistryInvalid("A memory atom is not bound to its explicit event.");
  }
  if (eventsById.size !== boundEventIds.size) {
    throw memoryRegistryInvalid("The memory registry contains an unbound event.");
  }
}

export function memoryReceiptRelativePath(receipt: MemoryLifecycleReceipt): string {
  return receipt.action === "enable"
    ? `.pige/memory/mutations/${receipt.requestId}.json`
    : `.pige/trash/memory/${receipt.requestId}.json`;
}

export function memoryRestoreIntentRelativePath(operationId: string): string {
  if (!MEMORY_OPERATION_ID_PATTERN.test(operationId)) throw memoryLifecycleConflict();
  return `.pige/trash/memory/${operationId}.restore.json`;
}

export function memoryOperationRelativePath(operationId: string): string {
  const date = MEMORY_OPERATION_ID_PATTERN.exec(operationId)?.[1];
  if (!date) throw memoryLifecycleConflict();
  return `.pige/operations/${date.slice(0, 4)}/${date.slice(4, 6)}/${operationId}.json`;
}

export function hashMemoryRegistry(registry: MemoryRegistry): string {
  return `sha256:${createHash("sha256").update(stableJson(registry)).digest("hex")}`;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, "en-US"))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function memoryLifecycleConflict(): PigeDomainError {
  return new PigeDomainError(
    "memory.lifecycle_conflict",
    "The durable Memory lifecycle identity is conflicting or ambiguous."
  );
}

function parseRegistryRevision(value: string): number | undefined {
  const match = /^registry_revision_(\d+)$/u.exec(value);
  if (!match) return undefined;
  const revision = Number(match[1]);
  return Number.isSafeInteger(revision) ? revision : undefined;
}

function memoryRegistryInvalid(message: string): PigeDomainError {
  return new PigeDomainError("memory.registry_invalid", message);
}
