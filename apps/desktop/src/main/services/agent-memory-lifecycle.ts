import { createHash } from "node:crypto";
import { PigeDomainError } from "@pige/domain";
import {
  MemoryRecordSummarySchema,
  OperationRecordSchema,
  type MemoryLanguageFact,
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
  readonly kind: "explicit_remember" | "authored_statement";
  readonly title: string;
  readonly body: string;
  readonly conversationId: string;
  readonly userEventId: string;
  readonly parentJobId: string;
  readonly language: MemoryLanguageFact;
  readonly occurredAt: string;
}

export interface StoredMemoryRecord extends MemoryRecordSummary {
  readonly eventId: string;
  readonly conversationId: string;
  readonly userEventId: string;
  readonly parentJobId: string;
  readonly language: MemoryLanguageFact;
  readonly editProvenance?: MemoryEditProvenance;
}

export interface MemoryEditProvenance {
  readonly kind: "explicit_edit";
  readonly requestId: string;
  readonly operationId: string;
}

export type MemoryLifecycleMutationAction = "edit" | "enable" | "delete" | "reset";
export type MemoryLifecycleAction = "create" | MemoryLifecycleMutationAction;

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
  readonly createdEvent?: MemoryEventRecord;
  readonly beforeRecord?: StoredMemoryRecord;
  readonly afterRecord?: StoredMemoryRecord;
  readonly actorKind?: "user" | "pige_agent";
  readonly jobId?: string;
  readonly modelProfileId?: string;
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
  readonly action: MemoryLifecycleAction | "restore" | "undo_create";
  readonly memoryId?: string;
  readonly receiptPath: string;
  readonly beforeRevision: number;
  readonly afterRevision: number;
}

export function prepareMemoryMutation(
  registry: MemoryRegistry,
  input: {
    readonly action: MemoryLifecycleMutationAction;
    readonly memoryId?: string;
    readonly title?: string;
    readonly body?: string;
    readonly requestId?: string;
    readonly operationId?: string;
  },
  now: string
): {
  readonly next: MemoryRegistry;
  readonly removedEvents: readonly MemoryEventRecord[];
  readonly removedRecords: readonly StoredMemoryRecord[];
  readonly beforeRecord?: StoredMemoryRecord;
  readonly afterRecord?: StoredMemoryRecord;
} | undefined {
  if (input.action === "edit") {
    const index = registry.records.findIndex((record) => record.id === input.memoryId);
    if (
      index < 0 || input.title === undefined || input.body === undefined ||
      input.requestId === undefined || input.operationId === undefined
    ) return undefined;
    const beforeRecord = registry.records[index]!;
    const afterRecord: StoredMemoryRecord = {
      ...beforeRecord,
      title: input.title,
      body: input.body,
      updatedAt: now,
      editProvenance: {
        kind: "explicit_edit",
        requestId: input.requestId,
        operationId: input.operationId
      }
    };
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

export function prepareMemoryCreation(
  registry: MemoryRegistry,
  input: {
    readonly requestId: string;
    readonly activeVaultId: string;
    readonly kind: "preference" | "correction" | "workflow_lesson";
    readonly title: string;
    readonly body: string;
    readonly sourceConversationId: string;
    readonly sourceEventId: string;
    readonly parentJobId: string;
    readonly language: MemoryLanguageFact;
    readonly provenanceKind: "explicit_user_request" | "authored_user_statement";
    readonly actorKind: "user" | "pige_agent";
    readonly modelProfileId?: string;
  },
  now: string
): { readonly next: MemoryRegistry; readonly receipt: MemoryLifecycleReceipt; readonly record: StoredMemoryRecord } {
  if (registry.revision === Number.MAX_SAFE_INTEGER || registry.records.length >= 1_000) {
    throw memoryLifecycleConflict();
  }
  const agentActor = input.actorKind === "pige_agent" && input.provenanceKind === "authored_user_statement" &&
    typeof input.modelProfileId === "string" && /^model_[a-z0-9_]+$/u.test(input.modelProfileId);
  const userActor = input.actorKind === "user" && input.provenanceKind === "explicit_user_request" &&
    input.modelProfileId === undefined;
  if (!agentActor && !userActor) throw memoryLifecycleConflict();
  const memoryId = createMemoryId(input.sourceEventId);
  const eventId = createMemoryEventId(input.sourceEventId);
  if (registry.records.some((record) => record.id === memoryId) || registry.events.some((event) => event.id === eventId)) {
    throw memoryLifecycleConflict();
  }
  const summary = MemoryRecordSummarySchema.parse({
    id: memoryId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    status: "active",
    provenance: { kind: input.provenanceKind, occurredAt: now },
    createdAt: now,
    updatedAt: now
  });
  const createdEvent: MemoryEventRecord = {
    id: eventId,
    kind: input.provenanceKind === "explicit_user_request" ? "explicit_remember" : "authored_statement",
    title: summary.title,
    body: summary.body,
    conversationId: input.sourceConversationId,
    userEventId: input.sourceEventId,
    parentJobId: input.parentJobId,
    language: input.language,
    occurredAt: now
  };
  const record: StoredMemoryRecord = {
    ...summary,
    eventId,
    conversationId: input.sourceConversationId,
    userEventId: input.sourceEventId,
    parentJobId: input.parentJobId,
    language: input.language
  };
  const next: MemoryRegistry = {
    schemaVersion: 1,
    revision: registry.revision + 1,
    events: [...registry.events, createdEvent],
    records: [...registry.records, record]
  };
  const operationId = createMemoryOperationId(input.requestId, now);
  return {
    next,
    record,
    receipt: {
      schemaVersion: 1,
      action: "create",
      requestId: input.requestId,
      activeVaultId: input.activeVaultId,
      memoryId,
      expectedRevision: registry.revision,
      operationId,
      createdAt: now,
      beforeRevision: registry.revision,
      afterRevision: next.revision,
      beforeRegistryHash: hashMemoryRegistry(registry),
      afterRegistryHash: hashMemoryRegistry(next),
      removedEvents: [],
      removedRecords: [],
      createdEvent,
      afterRecord: record,
      actorKind: input.actorKind,
      ...(input.actorKind === "pige_agent"
        ? { jobId: input.parentJobId, modelProfileId: input.modelProfileId }
        : {})
    }
  };
}

export function applyMemoryReceipt(registry: MemoryRegistry, receipt: MemoryLifecycleReceipt): MemoryRegistry {
  if (receipt.action === "create") {
    if (
      !receipt.createdEvent || !receipt.afterRecord ||
      registry.events.some((event) => event.id === receipt.createdEvent!.id) ||
      registry.records.some((record) => record.id === receipt.afterRecord!.id)
    ) throw memoryLifecycleConflict();
    return {
      schemaVersion: 1,
      revision: receipt.afterRevision,
      events: [...registry.events, receipt.createdEvent],
      records: [...registry.records, receipt.afterRecord]
    };
  }
  if (receipt.action === "edit" || receipt.action === "enable") {
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

export function isValidMemoryEditTransition(
  before: StoredMemoryRecord,
  after: StoredMemoryRecord,
  receipt: Partial<Pick<MemoryLifecycleReceipt, "action" | "requestId" | "operationId" | "memoryId" | "createdAt">>
): boolean {
  return receipt.action === "edit" && receipt.memoryId === before.id &&
    before.id === after.id && before.kind === after.kind && before.status === after.status &&
    stableJson(before.provenance) === stableJson(after.provenance) && before.createdAt === after.createdAt &&
    before.eventId === after.eventId && before.conversationId === after.conversationId &&
    before.userEventId === after.userEventId && before.parentJobId === after.parentJobId &&
    after.updatedAt === receipt.createdAt && after.editProvenance?.kind === "explicit_edit" &&
    after.editProvenance.requestId === receipt.requestId &&
    after.editProvenance.operationId === receipt.operationId;
}

export function createMemoryUndoRegistry(
  registry: MemoryRegistry,
  receipt: MemoryLifecycleReceipt,
  now: string
): MemoryRegistry {
  if (registry.revision === Number.MAX_SAFE_INTEGER) throw memoryLifecycleConflict();
  if (receipt.action === "create") {
    if (!receipt.createdEvent || !receipt.afterRecord) throw memoryLifecycleConflict();
    const currentEvent = registry.events.find((event) => event.id === receipt.createdEvent!.id);
    const currentRecord = registry.records.find((record) => record.id === receipt.afterRecord!.id);
    if (
      !currentEvent || !currentRecord ||
      stableJson(currentEvent) !== stableJson(receipt.createdEvent) ||
      stableJson(currentRecord) !== stableJson(receipt.afterRecord)
    ) throw memoryLifecycleConflict();
    return {
      schemaVersion: 1,
      revision: registry.revision + 1,
      events: registry.events.filter((event) => event.id !== receipt.createdEvent!.id),
      records: registry.records.filter((record) => record.id !== receipt.afterRecord!.id)
    };
  }
  if (receipt.action === "edit" || receipt.action === "enable") {
    const current = registry.records.find((record) => record.id === receipt.memoryId);
    if (
      !current || !receipt.afterRecord || !receipt.beforeRecord ||
      stableJson(current) !== stableJson(receipt.afterRecord)
    ) throw memoryLifecycleConflict();
    const records = registry.records.map((record) => record.id === current.id
      ? receipt.action === "edit" ? receipt.beforeRecord! : { ...receipt.beforeRecord!, updatedAt: now }
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
  assertMemoryRegistryBindings(next.events, next.records, (_event, record) => record.editProvenance !== undefined);
  return next;
}

export function restoredMemoryRecords(
  receipt: MemoryLifecycleReceipt,
  registry: MemoryRegistry
): readonly StoredMemoryRecord[] {
  if (receipt.action === "create") return [];
  if (receipt.action === "edit" || receipt.action === "enable") {
    return registry.records.filter((record) => record.id === receipt.memoryId);
  }
  const restored = new Set(receipt.removedRecords.map((record) => record.id));
  return registry.records.filter((record) => restored.has(record.id));
}

export function createMemoryLifecycleOperation(receipt: MemoryLifecycleReceipt): OperationRecord {
  const targetRefs = receipt.memoryId ? [{ kind: "memory" as const, id: receipt.memoryId }] : [];
  return OperationRecordSchema.parse({
    id: receipt.operationId,
    schemaVersion: 1,
    createdAt: receipt.createdAt,
    actor: { kind: receipt.actorKind ?? "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    ...(receipt.jobId ? { jobId: receipt.jobId } : {}),
    ...(receipt.modelProfileId ? { modelProfileId: receipt.modelProfileId } : {}),
    kind: receipt.action === "create"
      ? "create_memory"
      : receipt.action === "edit" || receipt.action === "enable" ? "update_memory" : "trash_memory",
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
    summary: receipt.action === "create"
      ? "Saved an authored vault-scoped Agent memory."
      : receipt.action === "edit"
      ? "Updated an Agent memory record."
      : receipt.action === "enable"
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
    kind: receipt.action === "create" ? "trash_memory" : "restore_memory",
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
    summary: receipt.action === "create"
      ? "Removed an Agent-created memory through Activity Undo."
      : receipt.action === "edit"
      ? "Restored the prior Agent memory text."
      : receipt.action === "enable"
        ? "Restored the prior disabled Agent memory state."
        : receipt.action === "delete"
          ? "Restored an Agent memory record from private trash."
          : "Restored Agent memory records from private trash.",
    reversible: "best_effort",
    rollbackHint: "Create another explicit memory lifecycle action if the restored registry remains current.",
    warnings: []
  });
}

export function memoryRedoUnavailableReason(registry: MemoryRegistry, receipt: MemoryLifecycleReceipt): string | undefined {
  if (receipt.action === "create") {
    return registry.events.some((event) => event.id === receipt.createdEvent?.id) ||
      registry.records.some((record) => record.id === receipt.afterRecord?.id) ? "content_changed" : undefined;
  }
  if (receipt.action === "edit" || receipt.action === "enable") {
    const current = registry.records.find((record) => record.id === receipt.memoryId);
    if (!current || !receipt.beforeRecord) return "target_missing";
    const expected = receipt.action === "enable" ? { ...receipt.beforeRecord, updatedAt: current.updatedAt } : receipt.beforeRecord;
    return stableJson(current) === stableJson(expected) ? undefined : "content_changed";
  }
  return receipt.removedEvents.every((removed) => registry.events.some((event) => stableJson(event) === stableJson(removed))) &&
    receipt.removedRecords.every((removed) => registry.records.some((record) => stableJson(record) === stableJson(removed)))
    ? undefined : "content_changed";
}

export function createMemoryRedoRegistry(registry: MemoryRegistry, receipt: MemoryLifecycleReceipt): MemoryRegistry {
  if (registry.revision === Number.MAX_SAFE_INTEGER || memoryRedoUnavailableReason(registry, receipt)) throw memoryLifecycleConflict();
  if (receipt.action === "create") return { schemaVersion: 1, revision: registry.revision + 1,
    events: [...registry.events, receipt.createdEvent!], records: [...registry.records, receipt.afterRecord!] };
  if (receipt.action === "edit" || receipt.action === "enable") return { schemaVersion: 1, revision: registry.revision + 1,
    events: registry.events, records: registry.records.map((record) => record.id === receipt.memoryId ? receipt.afterRecord! : record) };
  const eventIds = new Set(receipt.removedEvents.map((event) => event.id));
  const recordIds = new Set(receipt.removedRecords.map((record) => record.id));
  return { schemaVersion: 1, revision: registry.revision + 1,
    events: registry.events.filter((event) => !eventIds.has(event.id)), records: registry.records.filter((record) => !recordIds.has(record.id)) };
}

export function createMemoryRedoIntent(original: OperationRecord, undo: OperationRecord, before: MemoryRegistry,
  after: MemoryRegistry, createdAt: string): MemoryRestoreIntent {
  return { schemaVersion: 1, originalOperationId: undo.id, undoOperationId: createMemoryUndoOperationId(undo.id), createdAt,
    baseRevision: before.revision, restoredRevision: after.revision,
    baseRegistryHash: hashMemoryRegistry(before), restoredRegistryHash: hashMemoryRegistry(after) };
}

export function createMemoryRedoOperation(original: OperationRecord, undo: OperationRecord, intent: MemoryRestoreIntent): OperationRecord {
  return OperationRecordSchema.parse({ ...original, id: intent.undoOperationId, createdAt: intent.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    jobId: undefined, modelProfileId: undefined, sourceRefs: [{ kind: "operation", id: undo.id }],
    before: { kind: "memory", id: `registry_revision_${intent.baseRevision}`,
      path: original.before!.path, checksum: intent.baseRegistryHash },
    after: { kind: "memory", id: `registry_revision_${intent.restoredRevision}`,
      path: ".pige/memory/registry.json", checksum: intent.restoredRegistryHash },
    summary: `Redid ${original.kind.replaceAll("_", " ")}.`, reversible: "yes",
    rollbackHint: "Undo the exact current memory Activity again.", warnings: [] });
}

export function isMatchingMemoryRedoOperation(original: OperationRecord, undo: OperationRecord, redo: OperationRecord): boolean {
  const originalBinding = readMemoryOperationBinding(original); const redoBinding = readMemoryOperationBinding(redo);
  return !!originalBinding && !!redoBinding && redoBinding.action === originalBinding.action &&
    redoBinding.memoryId === originalBinding.memoryId && redo.id === createMemoryUndoOperationId(undo.id) && redo.kind === original.kind &&
    redo.actor.kind === "user" && redo.actor.runtimeKind === "desktop_local" &&
    redo.sourceRefs.length === 1 && redo.sourceRefs[0]?.kind === "operation" && redo.sourceRefs[0].id === undo.id &&
    redo.before?.kind === "memory" && redo.before.path === original.before?.path &&
    redo.after?.kind === "memory" && redo.after.path === ".pige/memory/registry.json" &&
    redoBinding.beforeRevision >= memoryOperationAfterRevision(undo) && memoryOperationAfterRevision(redo) > redoBinding.beforeRevision;
}

export function isMatchingMemoryRedoReceipt(
  operation: OperationRecord,
  receipt: MemoryLifecycleReceipt,
  readOperation: (operationId: string) => OperationRecord | undefined
): boolean {
  const undoId = operation.sourceRefs.length === 1 && operation.sourceRefs[0]?.kind === "operation"
    ? operation.sourceRefs[0].id : undefined;
  const undo = undoId ? readOperation(undoId) : undefined;
  const previousId = undo?.sourceRefs.length === 1 && undo.sourceRefs[0]?.kind === "operation"
    ? undo.sourceRefs[0].id : undefined;
  const previous = previousId ? readOperation(previousId) : undefined;
  return !!undo && !!previous && isMatchingMemoryRestoreOperation(previous, undo) &&
    isMatchingMemoryRedoOperation(previous, undo, operation) &&
    readMemoryOperationBinding(previous)?.receiptPath === memoryReceiptRelativePath(receipt);
}

export function memoryOperationAfterRevision(operation: OperationRecord): number {
  const match = /^registry_revision_(\d+)$/u.exec(operation.after?.id ?? "");
  const revision = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(revision) || revision < 0) throw memoryLifecycleConflict();
  return revision;
}

export function recoverMemoryOperationChain(port: {
  readonly recoverReceipt: () => boolean;
  readonly readOriginal: () => OperationRecord | undefined;
  readonly readOperation: (operationId: string) => OperationRecord | undefined;
  readonly readIntent: (operationId: string) => MemoryRestoreIntent | undefined;
  readonly recoverRestore: (intent: MemoryRestoreIntent, operation: OperationRecord) => boolean;
  readonly recoverRedo: (intent: MemoryRestoreIntent, operation: OperationRecord, undo: OperationRecord) => boolean;
}): number {
  let recovered = port.recoverReceipt() ? 1 : 0;
  let operation = port.readOriginal();
  if (!operation) throw memoryLifecycleConflict();
  for (;;) {
    const undoIntent = port.readIntent(operation.id);
    let undo = port.readOperation(createMemoryUndoOperationId(operation.id));
    if (undo && !isMatchingMemoryRestoreOperation(operation, undo)) throw memoryLifecycleConflict();
    if (undoIntent && port.recoverRestore(undoIntent, operation)) recovered += 1;
    undo = port.readOperation(createMemoryUndoOperationId(operation.id));
    if (!undo) return recovered;
    const redoIntent = port.readIntent(undo.id);
    if (!redoIntent) return recovered;
    if (port.recoverRedo(redoIntent, operation, undo)) recovered += 1;
    const redo = port.readOperation(createMemoryUndoOperationId(undo.id));
    if (!redo) throw memoryLifecycleConflict();
    operation = redo;
  }
}

export function memoryUndoUnavailableReason(
  registry: MemoryRegistry,
  receipt: MemoryLifecycleReceipt
): "content_changed" | "revision_changed" | "target_missing" | undefined {
  if (registry.revision < receipt.afterRevision) return "revision_changed";
  if (receipt.action === "create") {
    const currentEvent = registry.events.find((event) => event.id === receipt.createdEvent?.id);
    const currentRecord = registry.records.find((record) => record.id === receipt.afterRecord?.id);
    if (!currentEvent || !currentRecord) return "target_missing";
    return receipt.createdEvent && receipt.afterRecord &&
      stableJson(currentEvent) === stableJson(receipt.createdEvent) &&
      stableJson(currentRecord) === stableJson(receipt.afterRecord)
      ? undefined
      : "content_changed";
  }
  if (receipt.action === "edit" || receipt.action === "enable") {
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
  if (!(operation.kind === "create_memory" || operation.kind === "update_memory" || operation.kind === "trash_memory" || operation.kind === "restore_memory")) {
    return undefined;
  }
  if (
    operation.actor.runtimeKind !== "desktop_local" || operation.proposalId !== undefined ||
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
  const redoSource = operation.sourceRefs.length === 1 && operation.sourceRefs[0]?.kind === "operation" &&
    operation.id === createMemoryUndoOperationId(operation.sourceRefs[0].id);
  if (operation.kind === "create_memory") {
    const agentActor = operation.actor.kind === "pige_agent" && operation.jobId !== undefined &&
      operation.modelProfileId !== undefined && operation.sourceRefs.length === 0;
    const userActor = operation.actor.kind === "user" && operation.jobId === undefined &&
      operation.modelProfileId === undefined && (operation.sourceRefs.length === 0 || redoSource);
    if (
      (!agentActor && !userActor) || operation.targetRefs.length !== 1 ||
      !/^\.pige\/memory\/creates\/memory_request_[a-z0-9]{16,64}\.json$/u.test(operation.before.path)
    ) return undefined;
    return {
      action: "create",
      memoryId: operation.targetRefs[0]!.id,
      receiptPath: operation.before.path,
      beforeRevision,
      afterRevision
    };
  }
  if (operation.actor.kind !== "user" || operation.jobId !== undefined || operation.modelProfileId !== undefined) return undefined;
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
  if (
    operation.kind === "trash_memory" && operation.sourceRefs.length === 1 &&
    operation.sourceRefs[0]?.kind === "operation" &&
    /^\.pige\/trash\/memory\/op_\d{8}_[a-z0-9]{8,}\.restore\.json$/u.test(operation.before.path)
  ) {
    return {
      action: "undo_create",
      ...(operation.targetRefs[0] ? { memoryId: operation.targetRefs[0].id } : {}),
      receiptPath: operation.before.path,
      beforeRevision,
      afterRevision
    };
  }
  if (operation.sourceRefs.length !== 0 && !redoSource) return undefined;
  const action = operation.kind === "update_memory"
    ? operation.before.path.startsWith(".pige/memory/edits/") ? "edit" : "enable"
    : operation.targetRefs.length === 0 ? "reset" : "delete";
  if (
    (action === "edit" && !/^\.pige\/memory\/edits\/memory_request_[a-z0-9]{16,64}\.json$/u.test(operation.before.path)) ||
    (action === "enable" && !/^\.pige\/memory\/mutations\/memory_request_[a-z0-9]{16,64}\.json$/u.test(operation.before.path)) ||
    ((action === "delete" || action === "reset") &&
      !/^\.pige\/trash\/memory\/memory_request_[a-z0-9]{16,64}\.json$/u.test(operation.before.path))
  ) return undefined;
  return {
    action,
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
  const expectedAction = originalBinding?.action === "create" ? "undo_create" : "restore";
  return !!originalBinding && !!restoreBinding && restoreBinding.action === expectedAction &&
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

export function createMemoryRequestId(sourceEventId: string): string {
  return `memory_request_${createHash("sha256").update(`pige.memory.create.v1\0${sourceEventId}`).digest("hex").slice(0, 24)}`;
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
  records: readonly StoredMemoryRecord[],
  validateEdit?: (event: MemoryEventRecord, record: StoredMemoryRecord) => boolean
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
      !event ||
      event.conversationId !== record.conversationId || event.userEventId !== record.userEventId ||
      event.parentJobId !== record.parentJobId || event.occurredAt !== record.provenance.occurredAt ||
      event.occurredAt !== record.createdAt || record.id !== createMemoryId(event.userEventId) ||
      event.id !== createMemoryEventId(event.userEventId) ||
      (event.kind === "explicit_remember") !== (record.provenance.kind === "explicit_user_request") ||
      (record.editProvenance
        ? !validateEdit?.(event, record)
        : event.title !== record.title || event.body !== record.body)
    ) throw memoryRegistryInvalid("A memory atom is not bound to its explicit event.");
  }
  if (eventsById.size !== boundEventIds.size) {
    throw memoryRegistryInvalid("The memory registry contains an unbound event.");
  }
}

export function memoryReceiptRelativePath(receipt: MemoryLifecycleReceipt): string {
  return receipt.action === "create"
    ? `.pige/memory/creates/${receipt.requestId}.json`
    : receipt.action === "edit"
    ? `.pige/memory/edits/${receipt.requestId}.json`
    : receipt.action === "enable"
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
