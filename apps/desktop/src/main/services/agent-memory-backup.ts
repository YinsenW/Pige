import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { OperationRecordSchema, VaultIdSchema, type BackupManifest } from "@pige/schemas";
import {
  parseMemoryLifecycleReceipt,
  parseMemoryRegistry,
  parseMemoryRestoreIntent
} from "./agent-memory-service";
import {
  assertMemoryRegistryBindings,
  createMemoryLifecycleOperation,
  createMemoryRestoreOperation,
  hashMemoryRegistry,
  isValidMemoryEditTransition,
  memoryOperationRelativePath,
  memoryReceiptRelativePath,
  memoryRestoreIntentRelativePath,
  readMemoryOperationBinding,
  stableJson,
  type MemoryEventRecord,
  type MemoryLifecycleReceipt,
  type MemoryRegistry,
  type StoredMemoryRecord
} from "./agent-memory-lifecycle";
import { containsRestrictedModelContent } from "./model-egress-content";
import { readVaultConfig } from "./vault-layout";

export type AgentMemoryBackupIntegrity = NonNullable<BackupManifest["memoryIntegrity"]>;

const EMPTY_REGISTRY: MemoryRegistry = { schemaVersion: 1, revision: 0, events: [], records: [] };
const RECEIPT_PATH = /^(?:\.pige\/memory\/(?:edits|mutations)|\.pige\/trash\/memory)\/memory_request_[a-z0-9]{16,64}\.json$/u;
const RESTORE_INTENT_PATH = /^\.pige\/trash\/memory\/(op_\d{8}_[a-z0-9]{8,})\.restore\.json$/u;
const OPERATION_PATH = /^\.pige\/operations\/\d{4}\/\d{2}\/(op_\d{8}_[a-z0-9]{8,})\.json$/u;
const MEMORY_OPERATION_KINDS = new Set(["create_memory", "update_memory", "trash_memory", "restore_memory"]);

export function includesAgentMemoryInBackup(vaultPath?: string): boolean {
  return vaultPath ? readVaultConfig(vaultPath).backup.includeVaultMemory : true;
}

export function filterAgentMemoryBackupPaths(
  vaultPath: string,
  relativePaths: readonly string[],
  includeVaultMemory: boolean
): readonly string[] {
  return includeVaultMemory
    ? relativePaths
    : relativePaths.filter((relativePath) => !isAgentMemoryBackupPath(vaultPath, relativePath));
}

export function inspectIncludedAgentMemoryBackup(
  vaultPath: string,
  sourceVaultId: string,
  relativePaths: readonly string[],
  includeVaultMemory: boolean
): AgentMemoryBackupIntegrity | undefined {
  return includeVaultMemory ? inspectAgentMemoryBackup(vaultPath, sourceVaultId, relativePaths) : undefined;
}

export function isAgentMemoryBackupPath(vaultPath: string, relativePath: string): boolean {
  if (relativePath.startsWith(".pige/memory/") || relativePath.startsWith(".pige/trash/memory/")) return true;
  if (!OPERATION_PATH.test(relativePath)) return false;
  try {
    const candidate = readJson(vaultPath, relativePath);
    return Boolean(
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      MEMORY_OPERATION_KINDS.has(String((candidate as Record<string, unknown>).kind))
    );
  } catch {
    return false;
  }
}

export function inspectAgentMemoryBackup(
  vaultPath: string,
  sourceVaultId: string,
  relativePaths: readonly string[]
): AgentMemoryBackupIntegrity {
  try {
    const included = new Set(relativePaths);
    const receipts = new Map<string, MemoryLifecycleReceipt>();
    for (const relativePath of relativePaths.filter((entry) => RECEIPT_PATH.test(entry))) {
      const receipt = parseMemoryLifecycleReceipt(readJson(vaultPath, relativePath));
      if (
        !VaultIdSchema.safeParse(receipt.activeVaultId).success ||
        memoryReceiptRelativePath(receipt) !== relativePath ||
        receipts.has(receipt.requestId)
      ) throw memoryInvalid();
      receipts.set(receipt.requestId, receipt);
    }

    const registry = included.has(".pige/memory/registry.json")
      ? parseMemoryRegistry(readJson(vaultPath, ".pige/memory/registry.json") as MemoryRegistry)
      : EMPTY_REGISTRY;
    const validateEdit = (event: MemoryEventRecord, record: StoredMemoryRecord, seen = new Set<string>()): boolean => {
      const provenance = record.editProvenance;
      if (!provenance || seen.has(provenance.requestId)) return false;
      seen.add(provenance.requestId);
      const receipt = receipts.get(provenance.requestId);
      if (
        !receipt || receipt.action !== "edit" || receipt.operationId !== provenance.operationId ||
        receipt.memoryId !== record.id || !receipt.beforeRecord || !receipt.afterRecord ||
        stableJson(receipt.afterRecord) !== stableJson(record) ||
        !isValidMemoryEditTransition(receipt.beforeRecord, receipt.afterRecord, receipt)
      ) return false;
      return receipt.beforeRecord.editProvenance
        ? validateEdit(event, receipt.beforeRecord, seen)
        : event.title === receipt.beforeRecord.title && event.body === receipt.beforeRecord.body;
    };
    assertMemoryRegistryBindings(registry.events, registry.records, (event, record) => validateEdit(event, record));
    for (const receipt of receipts.values()) {
      const removedEvents = new Map(receipt.removedEvents.map((event) => [event.id, event]));
      for (const record of receipt.removedRecords) {
        if (record.editProvenance && !validateEdit(removedEvents.get(record.eventId)!, record)) throw memoryInvalid();
      }
    }
    if ([...registry.records, ...[...receipts.values()].flatMap((receipt) => [
      ...receipt.removedRecords,
      ...(receipt.beforeRecord ? [receipt.beforeRecord] : []),
      ...(receipt.afterRecord ? [receipt.afterRecord] : [])
    ])].some((record) => containsRestrictedModelContent(`${record.title}\n${record.body}`))) throw memoryInvalid();

    const operations = new Map<string, ReturnType<typeof OperationRecordSchema.parse>>();
    for (const relativePath of relativePaths.filter((entry) => OPERATION_PATH.test(entry))) {
      const operation = OperationRecordSchema.parse(readJson(vaultPath, relativePath));
      const binding = readMemoryOperationBinding(operation);
      if (!binding) {
        if (["update_memory", "trash_memory", "restore_memory"].includes(operation.kind)) throw memoryInvalid();
        continue;
      }
      if (memoryOperationRelativePath(operation.id) !== relativePath || operations.has(operation.id)) throw memoryInvalid();
      operations.set(operation.id, operation);
    }
    const expectedOperationIds = new Set<string>();
    for (const receipt of receipts.values()) {
      const operation = operations.get(receipt.operationId);
      if (!operation || stableJson(operation) !== stableJson(createMemoryLifecycleOperation(receipt))) throw memoryInvalid();
      expectedOperationIds.add(operation.id);
    }

    let restoreIntentCount = 0;
    for (const relativePath of relativePaths.filter((entry) => RESTORE_INTENT_PATH.test(entry))) {
      const intent = parseMemoryRestoreIntent(readJson(vaultPath, relativePath));
      if (memoryRestoreIntentRelativePath(intent.originalOperationId) !== relativePath) throw memoryInvalid();
      const original = operations.get(intent.originalOperationId);
      const binding = original && readMemoryOperationBinding(original);
      const receipt = binding && [...receipts.values()].find((entry) => memoryReceiptRelativePath(entry) === binding.receiptPath);
      const restoreOperation = operations.get(intent.undoOperationId);
      if (
        !original || !receipt || !restoreOperation ||
        stableJson(restoreOperation) !== stableJson(createMemoryRestoreOperation(original, receipt, intent))
      ) throw memoryInvalid();
      expectedOperationIds.add(original.id);
      expectedOperationIds.add(restoreOperation.id);
      restoreIntentCount += 1;
    }
    if (operations.size !== expectedOperationIds.size || [...operations].some(([id]) => !expectedOperationIds.has(id))) {
      throw memoryInvalid();
    }
    return {
      schemaVersion: 1,
      sourceVaultId,
      registryRevision: registry.revision,
      registryChecksum: hashMemoryRegistry(registry),
      eventCount: registry.events.length,
      recordCount: registry.records.length,
      lifecycleReceiptCount: receipts.size,
      restoreIntentCount,
      operationCount: operations.size
    };
  } catch (caught) {
    if (caught instanceof PigeDomainError && caught.code === "backup.memory_integrity_invalid") throw caught;
    throw memoryInvalid();
  }
}

function readJson(vaultPath: string, relativePath: string): unknown {
  const filePath = path.join(vaultPath, ...relativePath.split("/"));
  const stats = fs.lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 4 * 1024 * 1024) throw memoryInvalid();
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
}

function memoryInvalid(): PigeDomainError {
  return new PigeDomainError(
    "backup.memory_integrity_invalid",
    "Vault-scoped Agent memory is incomplete, conflicting, or unsafe for backup."
  );
}
