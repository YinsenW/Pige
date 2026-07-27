import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import type {
  KnowledgeActivitySummary,
  KnowledgeActivityUndoResult
} from "@pige/contracts";
import {
  MemoryDeleteRequestSchema,
  MemoryDisableRequestSchema,
  MemoryEnableRequestSchema,
  MemoryExportRequestSchema,
  MemoryExportResultSchema,
  MemoryLifecycleMutationResultSchema,
  MemoryMutationResultSchema,
  MemoryRecordSummarySchema,
  MemoryResetRequestSchema,
  MemorySummarySchema,
  OperationRecordSchema,
  type MemoryDeleteRequest,
  type MemoryDisableRequest,
  type MemoryEnableRequest,
  type MemoryExportRequest,
  type MemoryExportResult,
  type MemoryLifecycleMutationResult,
  type MemoryMutationResult,
  type MemoryRecordSummary,
  type MemoryResetRequest,
  type MemorySummary,
  type OperationRecord
} from "@pige/schemas";
import { flushDirectoryWhereSupported } from "./durable-directory-sync";
import {
  MEMORY_OPERATION_ID_PATTERN as OPERATION_ID_PATTERN,
  applyMemoryReceipt as applyReceipt,
  assertMemoryRegistryBindings as assertRegistryBindings,
  createMemoryEventId,
  createMemoryId,
  createMemoryLifecycleOperation as createLifecycleOperation,
  createMemoryOperationId as createOperationId,
  createMemoryRestoreOperation as createRestoreOperation,
  createMemoryUndoOperationId as createUndoOperationId,
  createMemoryUndoRegistry as createUndoRegistry,
  hashMemoryRegistry as hashRegistry,
  isMatchingMemoryRestoreOperation as isMatchingRestoreOperation,
  memoryLifecycleConflict as lifecycleConflict,
  memoryOperationRelativePath as operationRelativePath,
  memoryReceiptRelativePath as receiptRelativePath,
  memoryRestoreIntentRelativePath as restoreIntentRelativePath,
  memoryUndoUnavailableReason as undoUnavailableReason,
  prepareMemoryMutation as prepareMutation,
  readMemoryOperationBinding,
  restoredMemoryRecords as restoredRecords,
  stableJson,
  type MemoryEventRecord,
  type MemoryLifecycleAction,
  type MemoryLifecycleReceipt,
  type MemoryRegistry,
  type MemoryRestoreIntent,
  type StoredMemoryRecord
} from "./agent-memory-lifecycle";
import { containsRestrictedModelContent } from "./model-egress-content";

const REGISTRY_FILE = "registry.json";
const MAX_REGISTRY_BYTES = 2 * 1024 * 1024;
const MAX_PRIVATE_RECORD_BYTES = 4 * 1024 * 1024;

export interface RememberVaultPreferenceRequest {
  readonly vaultPath: string;
  readonly activeVaultId: string;
  readonly title: string;
  readonly body: string;
  readonly sourceConversationId: string;
  readonly sourceEventId: string;
  readonly parentJobId: string;
}

export interface AgentMemoryServiceDependencies {
  readonly now?: () => Date;
  readonly randomBytes?: (size: number) => Buffer;
  readonly activeVaultPath?: () => string | undefined;
}

export interface AgentMemoryRecoveryResult {
  readonly recovered: number;
  readonly failed: number;
}

export class AgentMemoryService {
  readonly #now: () => Date;
  readonly #randomBytes: (size: number) => Buffer;
  readonly #activeVaultPath: (() => string | undefined) | undefined;
  readonly #knownVaultPaths = new Set<string>();

  constructor(dependencies: AgentMemoryServiceDependencies = {}) {
    this.#now = dependencies.now ?? (() => new Date());
    this.#randomBytes = dependencies.randomBytes ?? randomBytes;
    this.#activeVaultPath = dependencies.activeVaultPath;
  }

  list(vaultPath: string, activeVaultId: string): MemorySummary {
    this.#rememberVault(vaultPath);
    const registry = this.#readRegistry(vaultPath);
    return projectSummary(activeVaultId, registry);
  }

  rememberPreference(request: RememberVaultPreferenceRequest): MemoryRecordSummary {
    this.#rememberVault(request.vaultPath);
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
    const now = this.#now().toISOString();
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
    this.#rememberVault(vaultPath);
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
    records[index] = { ...current, status: "disabled", updatedAt: this.#now().toISOString() };
    const next = { schemaVersion: 1 as const, revision: registry.revision + 1, events: registry.events, records };
    this.#writeRegistry(vaultPath, next);
    this.#writeInspectableRecord(vaultPath, records[index]!);
    return MemoryMutationResultSchema.parse({ status: "committed", summary: projectSummary(parsed.activeVaultId, next) });
  }

  enable(vaultPath: string, request: MemoryEnableRequest): MemoryLifecycleMutationResult {
    const parsed = MemoryEnableRequestSchema.parse(request);
    return this.#mutate(vaultPath, parsed.activeVaultId, {
      action: "enable",
      requestId: parsed.requestId,
      expectedRevision: parsed.expectedRevision,
      memoryId: parsed.memoryId
    });
  }

  delete(vaultPath: string, request: MemoryDeleteRequest): MemoryLifecycleMutationResult {
    const parsed = MemoryDeleteRequestSchema.parse(request);
    return this.#mutate(vaultPath, parsed.activeVaultId, {
      action: "delete",
      requestId: parsed.requestId,
      expectedRevision: parsed.expectedRevision,
      memoryId: parsed.memoryId
    });
  }

  reset(vaultPath: string, request: MemoryResetRequest): MemoryLifecycleMutationResult {
    const parsed = MemoryResetRequestSchema.parse(request);
    return this.#mutate(vaultPath, parsed.activeVaultId, {
      action: "reset",
      requestId: parsed.requestId,
      expectedRevision: parsed.expectedRevision
    });
  }

  export(vaultPath: string, request: MemoryExportRequest, privateDestinationPath: string): MemoryExportResult {
    this.#rememberVault(vaultPath);
    const parsed = MemoryExportRequestSchema.parse(request);
    const identity = {
      apiVersion: 1 as const,
      requestId: parsed.requestId,
      activeVaultId: parsed.activeVaultId
    };
    const registry = this.#readRegistry(vaultPath);
    if (!privateDestinationPath) {
      return MemoryExportResultSchema.parse({ ...identity, status: "cancelled", revision: registry.revision });
    }
    if (parsed.expectedRevision !== registry.revision) {
      return MemoryExportResultSchema.parse({ ...identity, status: "stale", revision: registry.revision });
    }
    const records = registry.records.map(projectRecord);
    if (records.some((record) => containsRestrictedModelContent(`${record.title}\n${record.body}`))) {
      return MemoryExportResultSchema.parse({ ...identity, status: "failed", revision: registry.revision });
    }
    const envelope = {
      schemaVersion: 1,
      exportedAt: this.#now().toISOString(),
      scope: "vault",
      revision: registry.revision,
      records
    } as const;
    try {
      writePrivateExport(privateDestinationPath, `${JSON.stringify(envelope, null, 2)}\n`, this.#randomBytes);
      return MemoryExportResultSchema.parse({ ...identity, status: "exported", revision: registry.revision });
    } catch {
      return MemoryExportResultSchema.parse({ ...identity, status: "failed", revision: registry.revision });
    }
  }

  recall(vaultPath: string, limit = 8): readonly MemoryRecordSummary[] {
    this.#rememberVault(vaultPath);
    return this.#readRegistry(vaultPath).records
      .filter((record) => record.status === "active")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, Math.max(0, Math.min(limit, 8)));
  }

  activitySummary(operation: OperationRecord, undoOperation?: OperationRecord): KnowledgeActivitySummary | undefined {
    const binding = readMemoryOperationBinding(operation);
    if (!binding || (undoOperation && !isMatchingRestoreOperation(operation, undoOperation))) return undefined;
    const vaultPath = this.#currentVaultPath();
    let registry: MemoryRegistry | undefined;
    if (vaultPath) {
      try {
        registry = this.#readRegistry(vaultPath);
      } catch {
        registry = undefined;
      }
    }
    const target = binding.memoryId
      ? { kind: "memory" as const, memoryId: binding.memoryId }
      : { kind: "memory" as const };
    const receipt = vaultPath ? this.#readReceiptForOperation(vaultPath, operation) : undefined;
    const unavailableReason = !registry || !receipt
      ? "legacy_record" as const
      : undoUnavailableReason(registry, receipt);
    return {
      operationId: operation.id,
      kind: operation.kind as "update_memory" | "trash_memory" | "restore_memory",
      createdAt: operation.createdAt,
      ...(binding.action === "reset" ? { targetLabel: "All Agent memory" } : {}),
      target,
      status: undoOperation ? "undone" : "applied",
      canUndo: !undoOperation && unavailableReason === undefined,
      ...(undoOperation
        ? { undoUnavailableReason: "already_undone" as const }
        : unavailableReason ? { undoUnavailableReason: unavailableReason } : {})
    };
  }

  findUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    const binding = readMemoryOperationBinding(operation);
    if (!binding || operation.kind === "restore_memory") return undefined;
    const candidate = operations.find((entry) => entry.id === createUndoOperationId(operation.id));
    return candidate && isMatchingRestoreOperation(operation, candidate) ? candidate : undefined;
  }

  undo(operation: OperationRecord, expectedRevisionId?: string): KnowledgeActivityUndoResult {
    const binding = readMemoryOperationBinding(operation);
    if (!binding || operation.kind === "restore_memory") return { status: "not_found", operationId: operation.id };
    if (expectedRevisionId !== undefined && expectedRevisionId !== String(binding.afterRevision)) {
      return { status: "stale", operationId: operation.id, currentRevisionId: String(binding.afterRevision) };
    }
    const vaultPath = this.#currentVaultPath();
    if (!vaultPath) return { status: "not_found", operationId: operation.id };
    this.#rememberVault(vaultPath);
    const receipt = this.#readReceiptForOperation(vaultPath, operation);
    if (!receipt || receipt.operationId !== operation.id) return { status: "not_found", operationId: operation.id };
    const undoOperationId = createUndoOperationId(operation.id);
    const existing = this.#readOperation(vaultPath, undoOperationId);
    if (existing) {
      if (!isMatchingRestoreOperation(operation, existing)) throw lifecycleConflict();
      const restored = readMemoryOperationBinding(existing)!;
      return {
        status: "already_undone",
        operationId: operation.id,
        undoOperationId,
        revisionId: String(restored.afterRevision)
      };
    }
    const registry = this.#readRegistry(vaultPath);
    const next = createUndoRegistry(registry, receipt, this.#now().toISOString());
    const intent: MemoryRestoreIntent = {
      schemaVersion: 1,
      originalOperationId: operation.id,
      undoOperationId,
      createdAt: this.#now().toISOString(),
      baseRevision: registry.revision,
      restoredRevision: next.revision,
      baseRegistryHash: hashRegistry(registry),
      restoredRegistryHash: hashRegistry(next)
    };
    this.#persistRestoreIntent(vaultPath, intent);
    this.#recoverRestoreIntent(vaultPath, receipt, intent, operation);
    return {
      status: "undone",
      operationId: operation.id,
      undoOperationId,
      revisionId: String(next.revision)
    };
  }

  recoverIncompleteOperations(): AgentMemoryRecoveryResult {
    let recovered = 0;
    let failed = 0;
    for (const vaultPath of this.#vaultPathsForRecovery()) {
      for (const receipt of this.#readAllReceipts(vaultPath)) {
        try {
          const intent = this.#readRestoreIntent(vaultPath, receipt.operationId);
          if (intent) {
            const operation = this.#readOperation(vaultPath, receipt.operationId);
            if (!operation) throw lifecycleConflict();
            const undoOperation = this.#readOperation(vaultPath, intent.undoOperationId);
            if (undoOperation) {
              if (!isMatchingRestoreOperation(operation, undoOperation)) throw lifecycleConflict();
            } else if (this.#recoverRestoreIntent(vaultPath, receipt, intent, operation)) recovered += 1;
          } else if (this.#recoverReceipt(vaultPath, receipt)) {
            recovered += 1;
          }
        } catch {
          failed += 1;
        }
      }
    }
    return { recovered, failed };
  }

  #mutate(
    vaultPath: string,
    activeVaultId: string,
    input: {
      readonly action: MemoryLifecycleAction;
      readonly requestId: string;
      readonly expectedRevision: number;
      readonly memoryId?: string;
    }
  ): MemoryLifecycleMutationResult {
    this.#rememberVault(vaultPath);
    const existing = this.#findReceiptByRequest(vaultPath, input.requestId);
    if (existing) {
      assertReceiptRequest(existing, activeVaultId, input);
      this.#recoverReceipt(vaultPath, existing);
      const current = this.#readRegistry(vaultPath);
      return lifecycleResult("committed", activeVaultId, input.requestId, current, existing.operationId);
    }
    const registry = this.#readRegistry(vaultPath);
    if (registry.revision !== input.expectedRevision) {
      return lifecycleResult("stale", activeVaultId, input.requestId, registry);
    }
    if (registry.revision === Number.MAX_SAFE_INTEGER) throw lifecycleConflict();
    const createdAt = this.#now().toISOString();
    const operationId = createOperationId(input.requestId, createdAt);
    const prepared = prepareMutation(registry, input, createdAt);
    if (!prepared) return lifecycleResult("not_found", activeVaultId, input.requestId, registry);
    const receipt: MemoryLifecycleReceipt = {
      schemaVersion: 1,
      action: input.action,
      requestId: input.requestId,
      activeVaultId,
      ...(input.memoryId ? { memoryId: input.memoryId } : {}),
      expectedRevision: input.expectedRevision,
      operationId,
      createdAt,
      beforeRevision: registry.revision,
      afterRevision: prepared.next.revision,
      beforeRegistryHash: hashRegistry(registry),
      afterRegistryHash: hashRegistry(prepared.next),
      removedEvents: prepared.removedEvents,
      removedRecords: prepared.removedRecords,
      ...(prepared.beforeRecord ? { beforeRecord: prepared.beforeRecord } : {}),
      ...(prepared.afterRecord ? { afterRecord: prepared.afterRecord } : {})
    };
    this.#persistReceipt(vaultPath, receipt);
    this.#recoverReceipt(vaultPath, receipt);
    return lifecycleResult("committed", activeVaultId, input.requestId, prepared.next, operationId);
  }

  #recoverReceipt(vaultPath: string, receipt: MemoryLifecycleReceipt): boolean {
    const current = this.#readRegistry(vaultPath);
    const currentHash = hashRegistry(current);
    let changed = false;
    if (currentHash === receipt.beforeRegistryHash && current.revision === receipt.beforeRevision) {
      const next = applyReceipt(current, receipt);
      if (hashRegistry(next) !== receipt.afterRegistryHash || next.revision !== receipt.afterRevision) {
        throw lifecycleConflict();
      }
      this.#writeRegistryExact(vaultPath, currentHash, next);
      this.#syncInspectableRecords(vaultPath, receipt, next);
      changed = true;
    } else if (currentHash !== receipt.afterRegistryHash || current.revision !== receipt.afterRevision) {
      throw lifecycleConflict();
    }
    const operation = createLifecycleOperation(receipt);
    const operationWasMissing = this.#readOperation(vaultPath, operation.id) === undefined;
    this.#persistOperation(vaultPath, operation);
    return changed || operationWasMissing;
  }

  #recoverRestoreIntent(
    vaultPath: string,
    receipt: MemoryLifecycleReceipt,
    intent: MemoryRestoreIntent,
    originalOperation: OperationRecord
  ): boolean {
    if (intent.originalOperationId !== originalOperation.id || intent.undoOperationId !== createUndoOperationId(originalOperation.id)) {
      throw lifecycleConflict();
    }
    const current = this.#readRegistry(vaultPath);
    const currentHash = hashRegistry(current);
    let changed = false;
    if (currentHash === intent.baseRegistryHash && current.revision === intent.baseRevision) {
      const next = createUndoRegistry(current, receipt, intent.createdAt);
      if (next.revision !== intent.restoredRevision || hashRegistry(next) !== intent.restoredRegistryHash) {
        throw lifecycleConflict();
      }
      this.#writeRegistryExact(vaultPath, currentHash, next);
      for (const record of restoredRecords(receipt, next)) this.#writeInspectableRecord(vaultPath, record);
      changed = true;
    } else if (currentHash !== intent.restoredRegistryHash || current.revision !== intent.restoredRevision) {
      throw lifecycleConflict();
    }
    const restoreOperation = createRestoreOperation(originalOperation, receipt, intent);
    const operationWasMissing = this.#readOperation(vaultPath, restoreOperation.id) === undefined;
    this.#persistOperation(vaultPath, restoreOperation);
    return changed || operationWasMissing;
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
    return parseRegistry(parsed);
  }

  #writeRegistry(vaultPath: string, registry: MemoryRegistry): void {
    atomicWrite(path.join(ensureMemoryRoot(vaultPath), REGISTRY_FILE), serializeRegistry(registry), this.#randomBytes);
  }

  #writeRegistryExact(vaultPath: string, expectedHash: string, registry: MemoryRegistry): void {
    const current = this.#readRegistry(vaultPath);
    if (hashRegistry(current) !== expectedHash) throw lifecycleConflict();
    this.#writeRegistry(vaultPath, registry);
  }

  #writeInspectableRecord(vaultPath: string, record: MemoryRecordSummary): void {
    const atomsRoot = path.join(ensureMemoryRoot(vaultPath), "atoms");
    ensureDirectory(atomsRoot);
    const frontmatter = JSON.stringify({ ...record, body: undefined });
    atomicWrite(path.join(atomsRoot, `${record.id}.md`), `---\n${frontmatter}\n---\n\n${record.body}\n`, this.#randomBytes);
  }

  #syncInspectableRecords(vaultPath: string, receipt: MemoryLifecycleReceipt, next: MemoryRegistry): void {
    for (const removed of receipt.removedRecords) {
      removeRegularFileIfPresent(path.join(ensureMemoryRoot(vaultPath), "atoms", `${removed.id}.md`));
    }
    if (receipt.afterRecord) this.#writeInspectableRecord(vaultPath, receipt.afterRecord);
    for (const record of next.records.filter((entry) => receipt.removedRecords.some((removed) => removed.id === entry.id))) {
      this.#writeInspectableRecord(vaultPath, record);
    }
  }

  #persistReceipt(vaultPath: string, receipt: MemoryLifecycleReceipt): void {
    const relativePath = receiptRelativePath(receipt);
    writePrivateExclusive(vaultPath, relativePath, `${JSON.stringify(receipt, null, 2)}\n`, this.#randomBytes);
    const adopted = this.#readReceipt(vaultPath, relativePath);
    if (!adopted || stableJson(adopted) !== stableJson(receipt)) throw lifecycleConflict();
  }

  #persistRestoreIntent(vaultPath: string, intent: MemoryRestoreIntent): void {
    const relativePath = restoreIntentRelativePath(intent.originalOperationId);
    writePrivateExclusive(vaultPath, relativePath, `${JSON.stringify(intent, null, 2)}\n`, this.#randomBytes);
    const adopted = this.#readRestoreIntent(vaultPath, intent.originalOperationId);
    if (!adopted || stableJson(adopted) !== stableJson(intent)) throw lifecycleConflict();
  }

  #persistOperation(vaultPath: string, operation: OperationRecord): void {
    const relativePath = operationRelativePath(operation.id);
    writePrivateExclusive(vaultPath, relativePath, `${JSON.stringify(operation, null, 2)}\n`, this.#randomBytes);
    const adopted = this.#readOperation(vaultPath, operation.id);
    if (!adopted || stableJson(adopted) !== stableJson(operation)) throw lifecycleConflict();
  }

  #readReceipt(vaultPath: string, relativePath: string): MemoryLifecycleReceipt | undefined {
    const value = readPrivateJson(vaultPath, relativePath, MAX_PRIVATE_RECORD_BYTES);
    return value === undefined ? undefined : parseReceipt(value);
  }

  #findReceiptByRequest(vaultPath: string, requestId: string): MemoryLifecycleReceipt | undefined {
    const mutation = this.#readReceipt(vaultPath, `.pige/memory/mutations/${requestId}.json`);
    const trash = this.#readReceipt(vaultPath, `.pige/trash/memory/${requestId}.json`);
    if (mutation && trash) throw lifecycleConflict();
    return mutation ?? trash;
  }

  #readReceiptForOperation(vaultPath: string, operation: OperationRecord): MemoryLifecycleReceipt | undefined {
    const binding = readMemoryOperationBinding(operation);
    return binding ? this.#readReceipt(vaultPath, binding.receiptPath) : undefined;
  }

  #readRestoreIntent(vaultPath: string, operationId: string): MemoryRestoreIntent | undefined {
    const value = readPrivateJson(vaultPath, restoreIntentRelativePath(operationId), MAX_PRIVATE_RECORD_BYTES);
    return value === undefined ? undefined : parseRestoreIntent(value);
  }

  #readOperation(vaultPath: string, operationId: string): OperationRecord | undefined {
    const value = readPrivateJson(vaultPath, operationRelativePath(operationId), MAX_PRIVATE_RECORD_BYTES);
    return value === undefined ? undefined : OperationRecordSchema.parse(value);
  }

  #readAllReceipts(vaultPath: string): readonly MemoryLifecycleReceipt[] {
    const relativeRoots = [".pige/memory/mutations", ".pige/trash/memory"];
    const receipts: MemoryLifecycleReceipt[] = [];
    for (const relativeRoot of relativeRoots) {
      const root = resolveVaultPrivatePath(vaultPath, relativeRoot);
      if (!fs.existsSync(root)) continue;
      const stats = fs.lstatSync(root);
      if (!stats.isDirectory() || stats.isSymbolicLink()) throw lifecycleConflict();
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink() || !/^memory_request_[a-z0-9]{16,64}\.json$/u.test(entry.name)) continue;
        const receipt = this.#readReceipt(vaultPath, `${relativeRoot}/${entry.name}`);
        if (receipt) receipts.push(receipt);
      }
    }
    return receipts;
  }

  #rememberVault(vaultPath: string): void {
    this.#knownVaultPaths.add(fs.realpathSync.native(vaultPath));
  }

  #currentVaultPath(): string | undefined {
    const configured = this.#activeVaultPath?.();
    if (configured) return configured;
    return this.#knownVaultPaths.size === 1 ? [...this.#knownVaultPaths][0] : undefined;
  }

  #vaultPathsForRecovery(): readonly string[] {
    const configured = this.#activeVaultPath?.();
    return configured ? [configured] : [...this.#knownVaultPaths];
  }
}

function lifecycleResult(
  status: "committed" | "stale" | "not_found",
  activeVaultId: string,
  requestId: string,
  registry: MemoryRegistry,
  operationId?: string
): MemoryLifecycleMutationResult {
  return MemoryLifecycleMutationResultSchema.parse({
    apiVersion: 1,
    status,
    requestId,
    activeVaultId,
    ...(operationId ? { operationId } : {}),
    summary: projectSummary(activeVaultId, registry)
  });
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

function parseRegistry(value: MemoryRegistry): MemoryRegistry {
  if (
    value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
    !Array.isArray(value.events) || !Array.isArray(value.records) || value.records.length > 1_000
  ) throw registryInvalid("The vault memory registry is invalid.");
  const events = value.events.map(parseMemoryEvent);
  const records = value.records.map(parseStoredMemoryRecord);
  assertRegistryBindings(events, records);
  return { schemaVersion: 1, revision: value.revision, events, records };
}

function parseMemoryEvent(value: unknown): MemoryEventRecord {
  if (!value || typeof value !== "object") throw registryInvalid("A memory event is invalid.");
  const event = value as Partial<MemoryEventRecord>;
  if (
    typeof event.id !== "string" || !/^memory_event_[a-f0-9]{20}$/u.test(event.id) ||
    event.kind !== "explicit_remember" || typeof event.title !== "string" || typeof event.body !== "string" ||
    typeof event.conversationId !== "string" || typeof event.userEventId !== "string" ||
    typeof event.parentJobId !== "string" || typeof event.occurredAt !== "string"
  ) throw registryInvalid("A memory event is invalid.");
  return event as MemoryEventRecord;
}

function parseStoredMemoryRecord(value: unknown): StoredMemoryRecord {
  if (!value || typeof value !== "object") throw registryInvalid("A memory atom is invalid.");
  const record = value as Partial<StoredMemoryRecord>;
  const summary = projectRecord(record as StoredMemoryRecord);
  if (
    typeof record.eventId !== "string" || !/^memory_event_[a-f0-9]{20}$/u.test(record.eventId) ||
    typeof record.conversationId !== "string" || typeof record.userEventId !== "string" ||
    typeof record.parentJobId !== "string"
  ) throw registryInvalid("A memory atom provenance binding is invalid.");
  return { ...summary, eventId: record.eventId, conversationId: record.conversationId, userEventId: record.userEventId, parentJobId: record.parentJobId };
}

function parseReceipt(value: unknown): MemoryLifecycleReceipt {
  if (!value || typeof value !== "object") throw lifecycleConflict();
  const receipt = value as Partial<MemoryLifecycleReceipt>;
  if (
    receipt.schemaVersion !== 1 || !(["enable", "delete", "reset"] as const).includes(receipt.action as never) ||
    typeof receipt.requestId !== "string" || !/^memory_request_[a-z0-9]{16,64}$/u.test(receipt.requestId) ||
    typeof receipt.activeVaultId !== "string" || !OPERATION_ID_PATTERN.test(receipt.operationId ?? "") ||
    typeof receipt.createdAt !== "string" || !Number.isSafeInteger(receipt.expectedRevision) ||
    !Number.isSafeInteger(receipt.beforeRevision) || !Number.isSafeInteger(receipt.afterRevision) ||
    receipt.afterRevision !== receipt.beforeRevision! + 1 || !isSha256(receipt.beforeRegistryHash) ||
    !isSha256(receipt.afterRegistryHash) || !Array.isArray(receipt.removedEvents) || !Array.isArray(receipt.removedRecords)
  ) throw lifecycleConflict();
  const removedEvents = receipt.removedEvents.map(parseMemoryEvent);
  const removedRecords = receipt.removedRecords.map(parseStoredMemoryRecord);
  assertRegistryBindings(removedEvents, removedRecords);
  const beforeRecord = receipt.beforeRecord ? parseStoredMemoryRecord(receipt.beforeRecord) : undefined;
  const afterRecord = receipt.afterRecord ? parseStoredMemoryRecord(receipt.afterRecord) : undefined;
  if (
    receipt.action === "enable"
      ? (!receipt.memoryId || !beforeRecord || !afterRecord || removedRecords.length !== 0 || removedEvents.length !== 0)
      : (receipt.action === "delete" ? !receipt.memoryId || removedRecords.length !== 1 : !!receipt.memoryId) ||
        beforeRecord !== undefined || afterRecord !== undefined
  ) throw lifecycleConflict();
  return { ...(receipt as MemoryLifecycleReceipt), removedEvents, removedRecords, ...(beforeRecord ? { beforeRecord } : {}), ...(afterRecord ? { afterRecord } : {}) };
}

function parseRestoreIntent(value: unknown): MemoryRestoreIntent {
  if (!value || typeof value !== "object") throw lifecycleConflict();
  const intent = value as Partial<MemoryRestoreIntent>;
  if (
    intent.schemaVersion !== 1 || !OPERATION_ID_PATTERN.test(intent.originalOperationId ?? "") ||
    !OPERATION_ID_PATTERN.test(intent.undoOperationId ?? "") || typeof intent.createdAt !== "string" ||
    !Number.isSafeInteger(intent.baseRevision) || !Number.isSafeInteger(intent.restoredRevision) ||
    intent.restoredRevision !== intent.baseRevision! + 1 || !isSha256(intent.baseRegistryHash) || !isSha256(intent.restoredRegistryHash)
  ) throw lifecycleConflict();
  return intent as MemoryRestoreIntent;
}

function assertReceiptRequest(
  receipt: MemoryLifecycleReceipt,
  activeVaultId: string,
  input: { readonly action: MemoryLifecycleAction; readonly expectedRevision: number; readonly memoryId?: string }
): void {
  if (
    receipt.activeVaultId !== activeVaultId || receipt.action !== input.action ||
    receipt.expectedRevision !== input.expectedRevision || receipt.memoryId !== input.memoryId
  ) throw lifecycleConflict();
}

function serializeRegistry(registry: MemoryRegistry): string {
  return `${JSON.stringify(registry, null, 2)}\n`;
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
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new PigeDomainError("memory.path_unsafe", "A memory directory is unsafe.");
}

function resolveVaultPrivatePath(vaultPath: string, relativePath: string): string {
  if (
    path.isAbsolute(relativePath) || relativePath.includes("\\") ||
    relativePath.split("/").some((part) => !part || part === "." || part === "..")
  ) throw lifecycleConflict();
  const root = fs.realpathSync.native(vaultPath);
  const resolved = path.resolve(root, ...relativePath.split("/"));
  if (!resolved.startsWith(`${root}${path.sep}`)) throw lifecycleConflict();
  return resolved;
}

function writePrivateExclusive(
  vaultPath: string,
  relativePath: string,
  contents: string,
  random: (size: number) => Buffer
): void {
  if (Buffer.byteLength(contents, "utf8") > MAX_PRIVATE_RECORD_BYTES) throw lifecycleConflict();
  const filePath = resolveVaultPrivatePath(vaultPath, relativePath);
  ensureDirectory(path.dirname(filePath));
  if (fs.existsSync(filePath)) {
    const stats = fs.lstatSync(filePath);
    if (!stats.isFile() || stats.isSymbolicLink() || fs.readFileSync(filePath, "utf8") !== contents) throw lifecycleConflict();
    return;
  }
  atomicWriteExclusive(filePath, contents, random);
}

function readPrivateJson(vaultPath: string, relativePath: string, maximumBytes: number): unknown | undefined {
  const filePath = resolveVaultPrivatePath(vaultPath, relativePath);
  if (!fs.existsSync(filePath)) return undefined;
  const stats = fs.lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > maximumBytes) throw lifecycleConflict();
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function atomicWrite(filePath: string, contents: string, random: (size: number) => Buffer): void {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${random(8).toString("hex")}`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(descriptor, contents, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, 0o600);
    flushDirectoryWhereSupported(path.dirname(filePath));
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
  }
}

function atomicWriteExclusive(filePath: string, contents: string, random: (size: number) => Buffer): void {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${random(8).toString("hex")}`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(descriptor, contents, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.linkSync(temporaryPath, filePath);
    fs.unlinkSync(temporaryPath);
    fs.chmodSync(filePath, 0o600);
    flushDirectoryWhereSupported(path.dirname(filePath));
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
  }
}

function writePrivateExport(destinationPath: string, contents: string, random: (size: number) => Buffer): void {
  if (!path.isAbsolute(destinationPath)) throw lifecycleConflict();
  const parent = path.dirname(destinationPath);
  const parentStats = fs.lstatSync(parent);
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) throw lifecycleConflict();
  const parentReal = fs.realpathSync.native(parent);
  if (parentReal !== parent) throw lifecycleConflict();
  if (fs.existsSync(destinationPath)) {
    const destinationStats = fs.lstatSync(destinationPath);
    if (!destinationStats.isFile() || destinationStats.isSymbolicLink()) throw lifecycleConflict();
  }
  const temporaryPath = path.join(parent, `.${path.basename(destinationPath)}.${process.pid}.${random(8).toString("hex")}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(descriptor, contents, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    const parentAfter = fs.lstatSync(parent);
    if (parentAfter.dev !== parentStats.dev || parentAfter.ino !== parentStats.ino || fs.realpathSync.native(parent) !== parentReal) throw lifecycleConflict();
    if (fs.existsSync(destinationPath) && fs.lstatSync(destinationPath).isSymbolicLink()) throw lifecycleConflict();
    fs.renameSync(temporaryPath, destinationPath);
    fs.chmodSync(destinationPath, 0o600);
    flushDirectoryWhereSupported(parent);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
  }
}

function removeRegularFileIfPresent(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const stats = fs.lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) throw lifecycleConflict();
  fs.unlinkSync(filePath);
  flushDirectoryWhereSupported(path.dirname(filePath));
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function registryInvalid(message: string): PigeDomainError {
  return new PigeDomainError("memory.registry_invalid", message);
}
