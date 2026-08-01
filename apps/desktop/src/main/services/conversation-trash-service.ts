import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  ConversationPurgeRequest,
  ConversationPurgeResult,
  ConversationRestoreRequest,
  ConversationRestoreResult,
  ConversationTrashListRequest,
  ConversationTrashListResult,
  ConversationTrashRequest,
  ConversationTrashResult,
  ConversationTrashSummary,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { OperationRecordSchema, type OperationRecord } from "@pige/schemas";
import { flushDirectoryWhereSupported } from "./durable-directory-sync";
import { AgentConversationHistory } from "./agent-conversation-history";

const MAX_CONVERSATION_BYTES = 8 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 64 * 1024;
const MAX_RECEIPTS = 10_000;
const OPERATION_ID = /^op_(\d{8})_[a-z0-9]{8,}$/u;

export interface ConversationTrashVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

interface ConversationTrashReceipt {
  readonly schemaVersion: 1;
  readonly kind: "conversation_trash_receipt";
  readonly requestId: string;
  readonly requestDigest: string;
  readonly activeVaultId: string;
  readonly trashEntryId: string;
  readonly conversationId: string;
  readonly operationId: string;
  readonly originalPath: string;
  readonly trashPath: string;
  readonly contentHash: string;
  readonly revision: string;
  readonly safePreview: string;
  readonly updatedAt: string;
  readonly trashedAt: string;
}

interface ConversationPurgeRecordBase {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly requestDigest: string;
  readonly activeVaultId: string;
  readonly trashEntryId: string;
  readonly conversationId: string;
  readonly expectedRevision: string;
  readonly trashOperationId: string;
  readonly purgeOperationId: string;
  readonly createdAt: string;
}

interface ConversationPurgeIntent extends ConversationPurgeRecordBase {
  readonly kind: "conversation_purge_intent";
}

interface ConversationPurgeTombstone extends ConversationPurgeRecordBase {
  readonly kind: "conversation_purge_tombstone";
  readonly trashPath: string;
  readonly contentHash: string;
}

interface ConversationTrashDependencies {
  readonly now?: () => Date;
  readonly randomId?: () => string;
}

export class ConversationTrashService {
  readonly #vaults: ConversationTrashVaultPort;
  readonly #history: AgentConversationHistory;
  readonly #now: () => Date;
  readonly #randomId: () => string;

  constructor(
    vaults: ConversationTrashVaultPort,
    history = new AgentConversationHistory(),
    dependencies: ConversationTrashDependencies = {}
  ) {
    this.#vaults = vaults;
    this.#history = history;
    this.#now = dependencies.now ?? (() => new Date());
    this.#randomId = dependencies.randomId ?? randomUUID;
  }

  trash(request: ConversationTrashRequest): ConversationTrashResult {
    const identity = { ...request };
    const scope = this.#scope(request.activeVaultId);
    if (!scope) return { ...identity, status: "failed" };
    try {
      const existing = readReceiptByRequest(scope, request.requestId);
      if (existing) {
        if (!matchesRequest(existing, request) || readOperation(scope, restoreOperationId(existing.operationId))) {
          return { ...identity, status: "stale" };
        }
        this.#completeTrash(scope, existing);
        return { ...identity, status: "committed", trashEntryId: existing.trashEntryId, operationId: existing.operationId };
      }
      const target = this.#history.resolveLifecycleTarget({ vaultPath: scope, conversationId: request.conversationId });
      if (!target) return { ...identity, status: "not_found" };
      if (target.revision !== request.expectedRevision) return { ...identity, status: "stale" };
      const trashedAt = this.#now().toISOString();
      const operationId = createOperationId(trashedAt, request, target.contentHash, this.#randomId());
      const receipt: ConversationTrashReceipt = {
        schemaVersion: 1,
        kind: "conversation_trash_receipt",
        requestId: request.requestId,
        requestDigest: requestDigest(request),
        activeVaultId: request.activeVaultId,
        trashEntryId: createTrashEntryId(operationId),
        conversationId: request.conversationId,
        operationId,
        originalPath: target.relativePath,
        trashPath: [".pige", "trash", "conversations", createTrashEntryId(operationId), `${request.conversationId}.jsonl`].join("/"),
        contentHash: target.contentHash,
        revision: target.revision,
        safePreview: target.summary.safePreview,
        updatedAt: target.summary.updatedAt,
        trashedAt
      };
      writeReceiptExclusive(scope, receipt);
      const current = this.#history.resolveLifecycleTarget({ vaultPath: scope, conversationId: request.conversationId });
      if (!current || current.revision !== receipt.revision) throw staleError();
      this.#completeTrash(scope, receipt);
      return { ...identity, status: "committed", trashEntryId: receipt.trashEntryId, operationId };
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "conversation_trash.stale") {
        return { ...identity, status: "stale" };
      }
      if (caught instanceof PigeDomainError && caught.code === "conversation_trash.not_found") {
        return { ...identity, status: "not_found" };
      }
      return { ...identity, status: "failed" };
    }
  }

  list(request: ConversationTrashListRequest): ConversationTrashListResult {
    const scope = this.#scope(request.activeVaultId);
    if (!scope) return { ...request, status: "failed" };
    try {
      this.recoverIncompleteOperations();
      const conversations = readAllReceipts(scope)
        .filter((receipt) => {
          const restore = readOperation(scope, restoreOperationId(receipt.operationId));
          return !restore || !payloadMatches(scope, receipt.originalPath, receipt.contentHash, 2);
        })
        .filter((receipt) => payloadMatches(scope, receipt.trashPath, receipt.contentHash, 1))
        .map(toSummary)
        .sort((left, right) => right.trashedAt.localeCompare(left.trashedAt, "en") || left.conversationId.localeCompare(right.conversationId, "en"))
        .slice(0, 256);
      return { ...request, status: "ready", conversations };
    } catch {
      return { ...request, status: "failed" };
    }
  }

  restore(request: ConversationRestoreRequest): ConversationRestoreResult {
    const identity = { ...request };
    const scope = this.#scope(request.activeVaultId);
    if (!scope) return { ...identity, status: "failed" };
    try {
      const receipt = readAllReceipts(scope).find((candidate) => candidate.trashEntryId === request.trashEntryId);
      if (!receipt || receipt.activeVaultId !== request.activeVaultId || receipt.conversationId !== request.conversationId) {
        return { ...identity, status: "not_found" };
      }
      if (receipt.revision !== request.expectedRevision) return { ...identity, status: "stale" };
      if (hasPurgeAuthority(scope, receipt)) return { ...identity, status: "stale" };
      const trashOperation = readOperation(scope, receipt.operationId);
      if (!trashOperation || !matchesTrashOperation(receipt, trashOperation)) return { ...identity, status: "failed" };
      const restoreId = restoreOperationId(receipt.operationId);
      const existing = readOperation(scope, restoreId);
      if (existing) {
        if (!matchesRestoreOperation(receipt, trashOperation, existing)) return { ...identity, status: "failed" };
        completeRestoreFromIntent(scope, receipt);
        return { ...identity, status: "already_restored", operationId: restoreId };
      }
      const operation = this.#restore(scope, receipt, trashOperation);
      return { ...identity, status: "restored", operationId: operation.id };
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "conversation_trash.stale") {
        return { ...identity, status: "stale" };
      }
      if (caught instanceof PigeDomainError && caught.code === "conversation_trash.not_found") {
        return { ...identity, status: "not_found" };
      }
      return { ...identity, status: "failed" };
    }
  }

  purge(request: ConversationPurgeRequest): ConversationPurgeResult {
    const identity = { ...request };
    const scope = this.#scope(request.activeVaultId);
    if (!scope) return { ...identity, status: "failed" };
    try {
      const tombstone = readPurgeTombstoneByRequest(scope, request.requestId);
      if (tombstone) {
        if (!matchesPurgeRequest(tombstone, request)) return { ...identity, status: "stale" };
        this.#completePurge(scope, tombstone);
        return { ...identity, status: "committed", operationId: tombstone.purgeOperationId };
      }
      const existing = readPurgeIntentByRequest(scope, request.requestId);
      if (existing) {
        if (!matchesPurgeRequest(existing, request)) return { ...identity, status: "stale" };
        this.#completePurge(scope, existing);
        return { ...identity, status: "committed", operationId: existing.purgeOperationId };
      }
      const receipt = readAllReceipts(scope).find((candidate) => candidate.trashEntryId === request.trashEntryId);
      const status = validatePurgeReceipt(scope, receipt, request);
      if (status !== "ready") return { ...identity, status };
      const createdAt = this.#now().toISOString();
      const intent: ConversationPurgeIntent = {
        schemaVersion: 1,
        kind: "conversation_purge_intent",
        requestId: request.requestId,
        requestDigest: purgeRequestDigest(request),
        activeVaultId: request.activeVaultId,
        trashEntryId: request.trashEntryId,
        conversationId: request.conversationId,
        expectedRevision: request.expectedRevision,
        trashOperationId: receipt!.operationId,
        purgeOperationId: createPurgeOperationId(createdAt, request, this.#randomId()),
        createdAt
      };
      writePurgeRecordExclusive(scope, purgeIntentPath(scope, request.requestId), intent);
      this.#completePurge(scope, intent);
      return { ...identity, status: "committed", operationId: intent.purgeOperationId };
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "conversation_trash.not_found") {
        return { ...identity, status: "not_found" };
      }
      if (caught instanceof PigeDomainError && caught.code === "conversation_trash.stale") {
        return { ...identity, status: "stale" };
      }
      return { ...identity, status: "failed" };
    }
  }

  recoverIncompleteOperations(): { readonly recovered: number; readonly failed: number } {
    const scope = this.#vaults.activeVaultPath();
    if (!scope || !this.#vaults.current()) return { recovered: 0, failed: 0 };
    let recovered = 0;
    let failed = 0;
    for (const intent of readAllPurgeIntents(scope)) {
      try {
        this.#completePurge(scope, intent);
        recovered += 1;
      } catch {
        failed += 1;
      }
    }
    for (const receipt of readAllReceipts(scope)) {
      try {
        if (hasPurgeAuthority(scope, receipt)) continue;
        const restore = readOperation(scope, restoreOperationId(receipt.operationId));
        if (restore) {
          const trash = readOperation(scope, receipt.operationId);
          if (!trash || !matchesRestoreOperation(receipt, trash, restore)) throw conflictError();
          completeRestoreFromIntent(scope, receipt);
        } else {
          this.#completeTrash(scope, receipt);
        }
        recovered += 1;
      } catch {
        failed += 1;
      }
    }
    return { recovered, failed };
  }

  #completePurge(vaultPath: string, record: ConversationPurgeIntent | ConversationPurgeTombstone): void {
    let tombstone = readPurgeTombstoneByRequest(vaultPath, record.requestId);
    const receipt = readAllReceipts(vaultPath).find((candidate) => candidate.trashEntryId === record.trashEntryId);
    if (!tombstone) {
      if (record.kind !== "conversation_purge_intent" || !receipt ||
        validatePurgeReceiptAgainstRecord(vaultPath, receipt, record) !== "ready") throw staleError();
      tombstone = {
        ...record,
        kind: "conversation_purge_tombstone",
        trashPath: receipt.trashPath,
        contentHash: receipt.contentHash
      };
      writePurgeRecordExclusive(vaultPath, purgeTombstonePath(vaultPath, record.requestId), tombstone);
    } else if (!matchesPurgeRecord(tombstone, record)) {
      throw staleError();
    }
    const operation = readOperation(vaultPath, tombstone.purgeOperationId);
    if (operation) {
      if (!matchesPurgeOperation(tombstone, operation)) throw staleError();
    } else {
      commitOperationExclusive(vaultPath, createPurgeOperation(tombstone));
    }
    removePurgePayload(vaultPath, tombstone);
    if (receipt) removeTrashReceipt(vaultPath, receipt);
    removeExactPurgeRecord(vaultPath, purgeIntentPath(vaultPath, record.requestId), record);
  }

  #completeTrash(vaultPath: string, receipt: ConversationTrashReceipt): void {
    const operation = readOperation(vaultPath, receipt.operationId);
    if (operation) {
      if (!matchesTrashOperation(receipt, operation)) throw conflictError();
      moveToTrash(vaultPath, receipt);
      assertTrashed(vaultPath, receipt);
      return;
    }
    moveToTrash(vaultPath, receipt);
    commitOperationExclusive(vaultPath, createTrashOperation(receipt));
  }

  #restore(vaultPath: string, receipt: ConversationTrashReceipt, trash: OperationRecord): OperationRecord {
    const originalPath = resolveVaultRelative(vaultPath, receipt.originalPath);
    const trashPath = resolveVaultRelative(vaultPath, receipt.trashPath);
    ensureSafeDirectory(vaultPath, path.dirname(originalPath));
    const originalExists = pathExists(originalPath);
    const trashExists = pathExists(trashPath);
    if (!originalExists && !trashExists) throw notFoundError();
    if (originalExists && !trashExists) throw staleError();
    const preserved = readVerifiedFile(vaultPath, trashPath, originalExists ? 2 : 1);
    assertHash(preserved.bytes, receipt.contentHash);
    if (originalExists) {
      const original = readVerifiedFile(vaultPath, originalPath, 2);
      if (!sameInode(original.stat, preserved.stat) || hashBytes(original.bytes) !== receipt.contentHash) throw staleError();
    }
    const restore = commitOperationExclusive(vaultPath, createRestoreOperation(receipt, trash, this.#now().toISOString()));
    completeRestoreFromIntent(vaultPath, receipt);
    return restore;
  }

  #scope(activeVaultId: string): string | undefined {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    return vault && vaultPath && vault.vaultId === activeVaultId ? vaultPath : undefined;
  }
}

function moveToTrash(vaultPath: string, receipt: ConversationTrashReceipt): void {
  const sourcePath = resolveVaultRelative(vaultPath, receipt.originalPath);
  const trashPath = resolveVaultRelative(vaultPath, receipt.trashPath);
  ensureSafeDirectory(vaultPath, path.dirname(trashPath));
  const sourceExists = pathExists(sourcePath);
  const trashExists = pathExists(trashPath);
  const quarantineExists = pathExists(quarantinePathFor(sourcePath, trashPath));
  if (!sourceExists && !trashExists) throw notFoundError();
  if (trashExists) {
    const trash = readVerifiedFile(vaultPath, trashPath, sourceExists || quarantineExists ? 2 : 1);
    assertHash(trash.bytes, receipt.contentHash);
    if (sourceExists) {
      const source = readVerifiedFile(vaultPath, sourcePath, 2);
      if (!sameInode(source.stat, trash.stat) || hashBytes(source.bytes) !== receipt.contentHash) throw staleError();
      removeVerifiedLink(vaultPath, sourcePath, trashPath, source.stat, receipt.contentHash);
    } else if (quarantineExists) {
      removeVerifiedLink(vaultPath, sourcePath, trashPath, trash.stat, receipt.contentHash);
    }
    return;
  }
  const source = readVerifiedFile(vaultPath, sourcePath, 1);
  assertHash(source.bytes, receipt.contentHash);
  fs.linkSync(sourcePath, trashPath);
  flushDirectoryWhereSupported(path.dirname(trashPath));
  const linked = readVerifiedFile(vaultPath, trashPath, 2);
  if (!sameInode(source.stat, linked.stat) || hashBytes(linked.bytes) !== receipt.contentHash) throw staleError();
  removeVerifiedLink(vaultPath, sourcePath, trashPath, source.stat, receipt.contentHash);
}

function completeRestoreFromIntent(vaultPath: string, receipt: ConversationTrashReceipt): void {
  const originalPath = resolveVaultRelative(vaultPath, receipt.originalPath);
  const trashPath = resolveVaultRelative(vaultPath, receipt.trashPath);
  ensureSafeDirectory(vaultPath, path.dirname(originalPath));
  const quarantineExists = pathExists(quarantinePathFor(trashPath, originalPath));
  if (!pathExists(originalPath)) {
    if (!pathExists(trashPath)) throw notFoundError();
    const trash = readVerifiedFile(vaultPath, trashPath, quarantineExists ? 2 : 1);
    assertHash(trash.bytes, receipt.contentHash);
    fs.linkSync(trashPath, originalPath);
    flushDirectoryWhereSupported(path.dirname(originalPath));
  }
  const original = readVerifiedFile(vaultPath, originalPath, pathExists(trashPath) || quarantineExists ? 2 : 1);
  assertHash(original.bytes, receipt.contentHash);
  if (!pathExists(trashPath)) {
    if (quarantineExists) removeVerifiedLink(vaultPath, trashPath, originalPath, original.stat, receipt.contentHash);
    return;
  }
  const trash = readVerifiedFile(vaultPath, trashPath, 2);
  if (!sameInode(original.stat, trash.stat) || hashBytes(trash.bytes) !== receipt.contentHash) throw staleError();
  removeVerifiedLink(vaultPath, trashPath, originalPath, trash.stat, receipt.contentHash);
}

function removeVerifiedLink(vaultPath: string, sourcePath: string, preservedPath: string, expected: fs.Stats, expectedHash: string): void {
  const quarantinePath = quarantinePathFor(sourcePath, preservedPath);
  if (pathExists(sourcePath)) {
    if (pathExists(quarantinePath)) throw staleError();
    fs.renameSync(sourcePath, quarantinePath);
    flushDirectoryWhereSupported(path.dirname(sourcePath));
    flushDirectoryWhereSupported(path.dirname(quarantinePath));
  }
  if (!pathExists(quarantinePath)) return;
  const quarantined = readVerifiedFile(vaultPath, quarantinePath, 2);
  if (!sameInode(expected, quarantined.stat) || hashBytes(quarantined.bytes) !== expectedHash) throw staleError();
  fs.unlinkSync(quarantinePath);
  flushDirectoryWhereSupported(path.dirname(quarantinePath));
}

function quarantinePathFor(sourcePath: string, preservedPath: string): string {
  return path.join(path.dirname(preservedPath), `.${path.basename(sourcePath)}.lifecycle-quarantine`);
}

function createTrashOperation(receipt: ConversationTrashReceipt): OperationRecord {
  return OperationRecordSchema.parse({
    id: receipt.operationId,
    schemaVersion: 1,
    createdAt: receipt.trashedAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "trash_conversation",
    targetRefs: [{ kind: "conversation", id: receipt.conversationId, path: receipt.trashPath, checksum: receipt.contentHash }],
    sourceRefs: [{ kind: "conversation", id: receipt.conversationId, path: receipt.originalPath, checksum: receipt.contentHash }],
    before: { kind: "conversation", id: receipt.conversationId, path: receipt.originalPath, checksum: receipt.contentHash },
    after: { kind: "conversation", id: receipt.conversationId, path: receipt.trashPath, checksum: receipt.contentHash },
    summary: "Moved one conversation to recoverable trash.",
    reversible: "best_effort",
    rollbackHint: "Restore the unchanged conversation history to its original internal location.",
    warnings: []
  });
}

function createRestoreOperation(receipt: ConversationTrashReceipt, trash: OperationRecord, createdAt: string): OperationRecord {
  return OperationRecordSchema.parse({
    id: restoreOperationId(receipt.operationId),
    schemaVersion: 1,
    createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "restore_conversation",
    targetRefs: [{ kind: "conversation", id: receipt.conversationId, path: receipt.originalPath, checksum: receipt.contentHash }],
    sourceRefs: [
      { kind: "operation", id: trash.id },
      { kind: "conversation", id: receipt.conversationId, path: receipt.trashPath, checksum: receipt.contentHash }
    ],
    before: { kind: "conversation", id: receipt.conversationId, path: receipt.trashPath, checksum: receipt.contentHash },
    after: { kind: "conversation", id: receipt.conversationId, path: receipt.originalPath, checksum: receipt.contentHash },
    summary: "Restored one conversation from recoverable trash.",
    reversible: "no",
    rollbackHint: "Move the unchanged conversation to recoverable trash again if requested.",
    warnings: []
  });
}

function matchesTrashOperation(receipt: ConversationTrashReceipt, operation: OperationRecord): boolean {
  return operation.id === receipt.operationId && operation.kind === "trash_conversation" &&
    operation.actor.kind === "user" && operation.before?.kind === "conversation" &&
    operation.before.id === receipt.conversationId && operation.before.path === receipt.originalPath &&
    operation.before.checksum === receipt.contentHash && operation.after?.kind === "conversation" &&
    operation.after.id === receipt.conversationId && operation.after.path === receipt.trashPath &&
    operation.after.checksum === receipt.contentHash;
}

function matchesRestoreOperation(receipt: ConversationTrashReceipt, trash: OperationRecord, restore: OperationRecord): boolean {
  return matchesTrashOperation(receipt, trash) && restore.id === restoreOperationId(trash.id) &&
    restore.kind === "restore_conversation" && restore.before?.path === receipt.trashPath &&
    restore.after?.path === receipt.originalPath && restore.after.id === receipt.conversationId &&
    restore.after.checksum === receipt.contentHash && restore.sourceRefs.some((ref) => ref.kind === "operation" && ref.id === trash.id);
}

function validatePurgeReceipt(
  vaultPath: string,
  receipt: ConversationTrashReceipt | undefined,
  request: ConversationPurgeRequest
): "ready" | "stale" | "not_found" {
  if (!receipt) return "not_found";
  if (receipt.activeVaultId !== request.activeVaultId || receipt.trashEntryId !== request.trashEntryId ||
    receipt.conversationId !== request.conversationId || receipt.revision !== request.expectedRevision) return "stale";
  return validateCurrentPurgeTarget(vaultPath, receipt);
}

function validatePurgeReceiptAgainstRecord(
  vaultPath: string,
  receipt: ConversationTrashReceipt,
  record: ConversationPurgeRecordBase
): "ready" | "stale" | "not_found" {
  if (receipt.activeVaultId !== record.activeVaultId || receipt.trashEntryId !== record.trashEntryId ||
    receipt.conversationId !== record.conversationId || receipt.revision !== record.expectedRevision ||
    receipt.operationId !== record.trashOperationId) return "stale";
  return validateCurrentPurgeTarget(vaultPath, receipt);
}

function validateCurrentPurgeTarget(vaultPath: string, receipt: ConversationTrashReceipt): "ready" | "stale" | "not_found" {
  const trashOperation = readOperation(vaultPath, receipt.operationId);
  if (!trashOperation || !matchesTrashOperation(receipt, trashOperation)) return "stale";
  if (readOperation(vaultPath, restoreOperationId(receipt.operationId))) return "stale";
  if (pathExists(resolveVaultRelative(vaultPath, receipt.originalPath))) return "stale";
  const trashPath = resolveVaultRelative(vaultPath, receipt.trashPath);
  if (!pathExists(trashPath)) return "not_found";
  return payloadMatches(vaultPath, receipt.trashPath, receipt.contentHash, 1) ? "ready" : "stale";
}

function createPurgeOperation(tombstone: ConversationPurgeTombstone): OperationRecord {
  return OperationRecordSchema.parse({
    id: tombstone.purgeOperationId,
    schemaVersion: 1,
    createdAt: tombstone.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "purge_conversation",
    targetRefs: [{ kind: "conversation", id: tombstone.conversationId }],
    sourceRefs: [{ kind: "operation", id: tombstone.trashOperationId }],
    before: {
      kind: "conversation",
      id: tombstone.conversationId,
      path: tombstone.trashPath,
      checksum: tombstone.contentHash
    },
    summary: "Permanently deleted one conversation from recoverable trash.",
    reversible: "no",
    warnings: ["The trashed conversation cannot be restored."]
  });
}

function matchesPurgeOperation(tombstone: ConversationPurgeTombstone, operation: OperationRecord): boolean {
  const target = operation.targetRefs[0];
  return operation.id === tombstone.purgeOperationId && operation.kind === "purge_conversation" &&
    operation.actor.kind === "user" && operation.reversible === "no" && operation.targetRefs.length === 1 &&
    target?.kind === "conversation" && target.id === tombstone.conversationId &&
    operation.sourceRefs.some((ref) => ref.kind === "operation" && ref.id === tombstone.trashOperationId) &&
    operation.before?.kind === "conversation" && operation.before.id === tombstone.conversationId &&
    operation.before.path === tombstone.trashPath && operation.before.checksum === tombstone.contentHash &&
    operation.after === undefined;
}

function removePurgePayload(vaultPath: string, tombstone: ConversationPurgeTombstone): void {
  const trashPath = resolveVaultRelative(vaultPath, tombstone.trashPath);
  const quarantinePath = `${trashPath}.purge-quarantine`;
  if (pathExists(trashPath)) {
    if (pathExists(quarantinePath)) throw staleError();
    assertHash(readVerifiedFile(vaultPath, trashPath, 1).bytes, tombstone.contentHash);
    fs.renameSync(trashPath, quarantinePath);
    flushDirectoryWhereSupported(path.dirname(trashPath));
  }
  if (pathExists(quarantinePath)) {
    assertHash(readVerifiedFile(vaultPath, quarantinePath, 1).bytes, tombstone.contentHash);
    fs.unlinkSync(quarantinePath);
    flushDirectoryWhereSupported(path.dirname(quarantinePath));
  }
  const directory = path.dirname(trashPath);
  try {
    if (fs.readdirSync(directory).length === 0) {
      fs.rmdirSync(directory);
      flushDirectoryWhereSupported(path.dirname(directory));
    }
  } catch (caught) {
    if (!isErrno(caught, "ENOENT") && !isErrno(caught, "ENOTEMPTY")) throw caught;
  }
}

function removeTrashReceipt(vaultPath: string, receipt: ConversationTrashReceipt): void {
  const filePath = receiptPath(vaultPath, receipt.requestId);
  const current = readReceipt(filePath);
  if (!current) return;
  if (JSON.stringify(current) !== JSON.stringify(receipt)) throw staleError();
  fs.unlinkSync(filePath);
  flushDirectoryWhereSupported(path.dirname(filePath));
}

function assertTrashed(vaultPath: string, receipt: ConversationTrashReceipt): void {
  if (pathExists(resolveVaultRelative(vaultPath, receipt.originalPath))) throw staleError();
  if (!payloadMatches(vaultPath, receipt.trashPath, receipt.contentHash, 1)) throw staleError();
}

function toSummary(receipt: ConversationTrashReceipt): ConversationTrashSummary {
  return {
    trashEntryId: receipt.trashEntryId as ConversationTrashSummary["trashEntryId"],
    conversationId: receipt.conversationId as ConversationTrashSummary["conversationId"],
    safePreview: receipt.safePreview,
    updatedAt: receipt.updatedAt,
    trashedAt: receipt.trashedAt,
    revision: receipt.revision as ConversationTrashSummary["revision"]
  };
}

function writeReceiptExclusive(vaultPath: string, receipt: ConversationTrashReceipt): void {
  const filePath = receiptPath(vaultPath, receipt.requestId);
  ensureSafeDirectory(vaultPath, path.dirname(filePath));
  writeJsonExclusive(filePath, receipt);
}

function readReceiptByRequest(vaultPath: string, requestId: string): ConversationTrashReceipt | undefined {
  return readReceipt(receiptPath(vaultPath, requestId));
}

function readAllReceipts(vaultPath: string): ConversationTrashReceipt[] {
  const root = path.join(vaultPath, ".pige", "trash", "conversation-receipts");
  if (!pathExists(root)) return [];
  ensureSafeDirectory(vaultPath, root);
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && /^receipt_[a-f0-9]{32}\.json$/u.test(entry.name));
  if (entries.length > MAX_RECEIPTS) throw conflictError();
  return entries.map((entry) => readReceipt(path.join(root, entry.name))).filter((entry): entry is ConversationTrashReceipt => !!entry);
}

function readReceipt(filePath: string): ConversationTrashReceipt | undefined {
  if (!pathExists(filePath)) return undefined;
  const value = JSON.parse(readBoundedFile(filePath, MAX_RECEIPT_BYTES).toString("utf8")) as Partial<ConversationTrashReceipt>;
  if (value.schemaVersion !== 1 || value.kind !== "conversation_trash_receipt" || typeof value.requestId !== "string" ||
    !/^conversationtrashreq_[a-z0-9]{16,64}$/u.test(value.requestId) || typeof value.requestDigest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.requestDigest) || typeof value.activeVaultId !== "string" || typeof value.trashEntryId !== "string" ||
    !/^conversationtrash_[a-f0-9]{32}$/u.test(value.trashEntryId) || typeof value.conversationId !== "string" ||
    typeof value.operationId !== "string" || !OPERATION_ID.test(value.operationId) || typeof value.originalPath !== "string" ||
    typeof value.trashPath !== "string" || typeof value.contentHash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value.contentHash) ||
    typeof value.revision !== "string" || !/^conversationrev_[a-f0-9]{64}$/u.test(value.revision) ||
    typeof value.safePreview !== "string" || [...value.safePreview].length < 1 || [...value.safePreview].length > 240 ||
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value.safePreview) ||
    typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)) ||
    typeof value.trashedAt !== "string" || !Number.isFinite(Date.parse(value.trashedAt))) throw conflictError();
  const receipt = value as ConversationTrashReceipt;
  const dateKey = /^conv_(\d{8})(?:_[a-z0-9]{4,})?$/u.exec(receipt.conversationId)?.[1];
  const expectedOriginal = dateKey
    ? [".pige", "conversations", dateKey.slice(0, 4), dateKey.slice(4, 6), `${receipt.conversationId}.jsonl`].join("/")
    : undefined;
  const expectedTrash = [".pige", "trash", "conversations", receipt.trashEntryId, `${receipt.conversationId}.jsonl`].join("/");
  if (!dateKey || receipt.originalPath !== expectedOriginal || receipt.trashPath !== expectedTrash ||
    receipt.trashEntryId !== createTrashEntryId(receipt.operationId)) throw conflictError();
  return receipt;
}

function writePurgeRecordExclusive(vaultPath: string, filePath: string, value: unknown): void {
  ensureSafeDirectory(vaultPath, path.dirname(filePath));
  writeJsonExclusive(filePath, value);
}

function readAllPurgeIntents(vaultPath: string): ConversationPurgeIntent[] {
  return readPurgeRecords(vaultPath, purgeIntentRoot(vaultPath), /^intent_[a-f0-9]{32}\.json$/u, parsePurgeIntent);
}

function readAllPurgeTombstones(vaultPath: string): ConversationPurgeTombstone[] {
  return readPurgeRecords(vaultPath, purgeTombstoneRoot(vaultPath), /^tombstone_[a-f0-9]{32}\.json$/u, parsePurgeTombstone);
}

function readPurgeRecords<T>(
  vaultPath: string,
  root: string,
  pattern: RegExp,
  parse: (bytes: Buffer) => T
): T[] {
  if (!pathExists(root)) return [];
  assertSafeExistingDirectory(vaultPath, root);
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && pattern.test(entry.name));
  if (entries.length > MAX_RECEIPTS) throw conflictError();
  return entries.map((entry) => parse(readBoundedFile(path.join(root, entry.name), MAX_RECEIPT_BYTES)));
}

function readPurgeIntentByRequest(vaultPath: string, requestId: string): ConversationPurgeIntent | undefined {
  const filePath = purgeIntentPath(vaultPath, requestId);
  return pathExists(filePath) ? parsePurgeIntent(readBoundedFile(filePath, MAX_RECEIPT_BYTES)) : undefined;
}

function readPurgeTombstoneByRequest(vaultPath: string, requestId: string): ConversationPurgeTombstone | undefined {
  const filePath = purgeTombstonePath(vaultPath, requestId);
  return pathExists(filePath) ? parsePurgeTombstone(readBoundedFile(filePath, MAX_RECEIPT_BYTES)) : undefined;
}

function parsePurgeIntent(bytes: Buffer): ConversationPurgeIntent {
  const value = JSON.parse(bytes.toString("utf8")) as Partial<ConversationPurgeIntent>;
  const keys = "activeVaultId,conversationId,createdAt,expectedRevision,kind,purgeOperationId,requestDigest,requestId,schemaVersion,trashEntryId,trashOperationId";
  if (Object.keys(value).sort().join(",") !== keys || value.schemaVersion !== 1 || value.kind !== "conversation_purge_intent" ||
    typeof value.requestId !== "string" || !/^conversationpurgereq_[a-z0-9]{16,64}$/u.test(value.requestId) ||
    typeof value.requestDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value.requestDigest) ||
    typeof value.activeVaultId !== "string" || typeof value.trashEntryId !== "string" ||
    !/^conversationtrash_[a-f0-9]{32}$/u.test(value.trashEntryId) || typeof value.conversationId !== "string" ||
    typeof value.expectedRevision !== "string" || !/^conversationrev_[a-f0-9]{64}$/u.test(value.expectedRevision) ||
    typeof value.trashOperationId !== "string" || !OPERATION_ID.test(value.trashOperationId) ||
    typeof value.purgeOperationId !== "string" || !OPERATION_ID.test(value.purgeOperationId) ||
    typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) throw staleError();
  return value as ConversationPurgeIntent;
}

function parsePurgeTombstone(bytes: Buffer): ConversationPurgeTombstone {
  const value = JSON.parse(bytes.toString("utf8")) as Partial<ConversationPurgeTombstone>;
  const keys = "activeVaultId,contentHash,conversationId,createdAt,expectedRevision,kind,purgeOperationId,requestDigest,requestId,schemaVersion,trashEntryId,trashOperationId,trashPath";
  if (Object.keys(value).sort().join(",") !== keys || value.kind !== "conversation_purge_tombstone" ||
    typeof value.trashPath !== "string" || typeof value.contentHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.contentHash)) throw staleError();
  const intent = parsePurgeIntent(Buffer.from(JSON.stringify({
    schemaVersion: value.schemaVersion,
    kind: "conversation_purge_intent",
    requestId: value.requestId,
    requestDigest: value.requestDigest,
    activeVaultId: value.activeVaultId,
    trashEntryId: value.trashEntryId,
    conversationId: value.conversationId,
    expectedRevision: value.expectedRevision,
    trashOperationId: value.trashOperationId,
    purgeOperationId: value.purgeOperationId,
    createdAt: value.createdAt
  })));
  const expectedPath = [".pige", "trash", "conversations", intent.trashEntryId, `${intent.conversationId}.jsonl`].join("/");
  if (value.trashPath !== expectedPath) throw staleError();
  return { ...intent, kind: "conversation_purge_tombstone", trashPath: value.trashPath, contentHash: value.contentHash };
}

function hasPurgeAuthority(vaultPath: string, receipt: ConversationTrashReceipt): boolean {
  return [...readAllPurgeIntents(vaultPath), ...readAllPurgeTombstones(vaultPath)]
    .some((record) => record.trashEntryId === receipt.trashEntryId && record.trashOperationId === receipt.operationId);
}

function removeExactPurgeRecord(
  vaultPath: string,
  filePath: string,
  record: ConversationPurgeIntent | ConversationPurgeTombstone
): void {
  if (!pathExists(filePath)) return;
  const current = parsePurgeIntent(readBoundedFile(filePath, MAX_RECEIPT_BYTES));
  if (!matchesPurgeRecord(current, record)) throw staleError();
  fs.unlinkSync(filePath);
  flushDirectoryWhereSupported(path.dirname(filePath));
}

function commitOperationExclusive(vaultPath: string, operation: OperationRecord): OperationRecord {
  const filePath = operationPath(vaultPath, operation.id);
  ensureSafeDirectory(vaultPath, path.dirname(filePath));
  try {
    writeJsonExclusive(filePath, operation);
    return operation;
  } catch (caught) {
    if (!isErrno(caught, "EEXIST")) throw caught;
    const existing = readOperation(vaultPath, operation.id);
    if (existing && JSON.stringify(existing) === JSON.stringify(operation)) return existing;
    throw conflictError();
  }
}

function readOperation(vaultPath: string, operationId: string): OperationRecord | undefined {
  const filePath = operationPath(vaultPath, operationId);
  if (!pathExists(filePath)) return undefined;
  assertSafeExistingDirectory(vaultPath, path.dirname(filePath));
  return OperationRecordSchema.parse(JSON.parse(readBoundedFile(filePath, 256 * 1024).toString("utf8")));
}

function operationPath(vaultPath: string, operationId: string): string {
  const dateKey = OPERATION_ID.exec(operationId)?.[1];
  if (!dateKey) throw conflictError();
  return path.join(vaultPath, ".pige", "operations", dateKey.slice(0, 4), dateKey.slice(4, 6), `${operationId}.json`);
}

function receiptPath(vaultPath: string, requestId: string): string {
  const digest = createHash("sha256").update(requestId, "utf8").digest("hex").slice(0, 32);
  return path.join(vaultPath, ".pige", "trash", "conversation-receipts", `receipt_${digest}.json`);
}

function purgeIntentRoot(vaultPath: string): string {
  return path.join(vaultPath, ".pige", "trash", "conversation-purges", "intents");
}

function purgeTombstoneRoot(vaultPath: string): string {
  return path.join(vaultPath, ".pige", "trash", "conversation-purges", "tombstones");
}

function purgeIntentPath(vaultPath: string, requestId: string): string {
  return path.join(purgeIntentRoot(vaultPath), `intent_${purgeRecordKey(requestId)}.json`);
}

function purgeTombstonePath(vaultPath: string, requestId: string): string {
  return path.join(purgeTombstoneRoot(vaultPath), `tombstone_${purgeRecordKey(requestId)}.json`);
}

function purgeRecordKey(requestId: string): string {
  return createHash("sha256").update(requestId, "utf8").digest("hex").slice(0, 32);
}

function writeJsonExclusive(filePath: string, value: unknown): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  flushDirectoryWhereSupported(path.dirname(filePath));
}

function readVerifiedFile(vaultPath: string, filePath: string, maximumLinks: number): { readonly bytes: Buffer; readonly stat: fs.Stats } {
  assertConfined(vaultPath, filePath);
  assertSafeExistingDirectory(vaultPath, path.dirname(filePath));
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink < 1 || before.nlink > maximumLinks || before.size > MAX_CONVERSATION_BYTES) throw staleError();
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (!sameFile(before, after)) throw staleError();
    return { bytes, stat: after };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function readBoundedFile(filePath: string, maximumBytes: number): Buffer {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximumBytes) throw conflictError();
    const bytes = fs.readFileSync(descriptor);
    if (!sameFile(before, fs.fstatSync(descriptor))) throw conflictError();
    return bytes;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function ensureSafeDirectory(vaultPath: string, directoryPath: string): void {
  assertConfinedOrRoot(vaultPath, directoryPath);
  const root = path.resolve(vaultPath);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw staleError();
  let current = root;
  for (const part of path.relative(root, path.resolve(directoryPath)).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw staleError();
    } catch (caught) {
      if (!isErrno(caught, "ENOENT")) throw caught;
      fs.mkdirSync(current, { mode: 0o700 });
      flushDirectoryWhereSupported(path.dirname(current));
    }
  }
}

function assertSafeExistingDirectory(vaultPath: string, directoryPath: string): void {
  assertConfinedOrRoot(vaultPath, directoryPath);
  const root = path.resolve(vaultPath);
  let current = root;
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw staleError();
  for (const part of path.relative(root, path.resolve(directoryPath)).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw staleError();
  }
}

function resolveVaultRelative(vaultPath: string, relativePath: string): string {
  if (path.posix.isAbsolute(relativePath) || relativePath.split("/").some((part) => !part || part === "." || part === "..")) throw staleError();
  const resolved = path.resolve(vaultPath, ...relativePath.split("/"));
  assertConfined(vaultPath, resolved);
  return resolved;
}

function assertConfined(vaultPath: string, candidatePath: string): void {
  const root = path.resolve(vaultPath);
  const candidate = path.resolve(candidatePath);
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) throw staleError();
}

function assertConfinedOrRoot(vaultPath: string, candidatePath: string): void {
  const root = path.resolve(vaultPath);
  const candidate = path.resolve(candidatePath);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) throw staleError();
}

function payloadMatches(vaultPath: string, relativePath: string, expectedHash: string, maximumLinks: number): boolean {
  try { return hashBytes(readVerifiedFile(vaultPath, resolveVaultRelative(vaultPath, relativePath), maximumLinks).bytes) === expectedHash; } catch { return false; }
}

function createOperationId(createdAt: string, request: ConversationTrashRequest, contentHash: string, randomId: string): string {
  const dateKey = createdAt.slice(0, 10).replaceAll("-", "");
  const digest = createHash("sha256").update("pige.conversation.trash.v1\0").update(requestDigest(request)).update(contentHash).update(randomId).digest("hex").slice(0, 16);
  return `op_${dateKey}_${digest}`;
}

function createTrashEntryId(operationId: string): string {
  return `conversationtrash_${createHash("sha256").update(`pige.conversation.trash.entry.v1\0${operationId}`).digest("hex").slice(0, 32)}`;
}

function restoreOperationId(operationId: string): string {
  const dateKey = OPERATION_ID.exec(operationId)?.[1];
  if (!dateKey) throw conflictError();
  return `op_${dateKey}_${createHash("sha256").update(`pige.conversation.restore.v1\0${operationId}`).digest("hex").slice(0, 16)}`;
}

function createPurgeOperationId(createdAt: string, request: ConversationPurgeRequest, randomId: string): string {
  const dateKey = createdAt.slice(0, 10).replaceAll("-", "");
  const digest = createHash("sha256")
    .update("pige.conversation.purge.v1\0")
    .update(purgeRequestDigest(request))
    .update(randomId)
    .digest("hex")
    .slice(0, 16);
  return `op_${dateKey}_${digest}`;
}

function requestDigest(request: ConversationTrashRequest): string {
  return hashBytes(Buffer.from([request.requestId, request.activeVaultId, request.conversationId, request.expectedRevision].join("\0"), "utf8"));
}

function matchesRequest(receipt: ConversationTrashReceipt, request: ConversationTrashRequest): boolean {
  return receipt.requestDigest === requestDigest(request) && receipt.activeVaultId === request.activeVaultId &&
    receipt.conversationId === request.conversationId && receipt.revision === request.expectedRevision;
}

function purgeRequestDigest(request: ConversationPurgeRequest): string {
  return hashBytes(Buffer.from([
    request.requestId,
    request.activeVaultId,
    request.trashEntryId,
    request.conversationId,
    request.expectedRevision,
    request.confirmation
  ].join("\0"), "utf8"));
}

function matchesPurgeRequest(record: ConversationPurgeRecordBase, request: ConversationPurgeRequest): boolean {
  return record.requestDigest === purgeRequestDigest(request) && record.activeVaultId === request.activeVaultId &&
    record.trashEntryId === request.trashEntryId && record.conversationId === request.conversationId &&
    record.expectedRevision === request.expectedRevision;
}

function matchesPurgeRecord(left: ConversationPurgeRecordBase, right: ConversationPurgeRecordBase): boolean {
  return left.requestId === right.requestId && left.requestDigest === right.requestDigest &&
    left.activeVaultId === right.activeVaultId && left.trashEntryId === right.trashEntryId &&
    left.conversationId === right.conversationId && left.expectedRevision === right.expectedRevision &&
    left.trashOperationId === right.trashOperationId && left.purgeOperationId === right.purgeOperationId &&
    left.createdAt === right.createdAt;
}

function assertHash(bytes: Uint8Array, expected: string): void { if (hashBytes(bytes) !== expected) throw staleError(); }
function hashBytes(bytes: Uint8Array): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function sameInode(left: fs.Stats, right: fs.Stats): boolean { return left.dev === right.dev && left.ino === right.ino; }
function sameFile(left: fs.Stats, right: fs.Stats): boolean { return sameInode(left, right) && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs; }
function pathExists(filePath: string): boolean { try { fs.lstatSync(filePath); return true; } catch (caught) { if (isErrno(caught, "ENOENT")) return false; throw caught; } }
function isErrno(value: unknown, code: string): boolean { return typeof value === "object" && value !== null && "code" in value && (value as { code?: unknown }).code === code; }
function staleError(): PigeDomainError { return new PigeDomainError("conversation_trash.stale", "The conversation changed before the lifecycle action committed."); }
function notFoundError(): PigeDomainError { return new PigeDomainError("conversation_trash.not_found", "The recoverable conversation is unavailable."); }
function conflictError(): PigeDomainError { return new PigeDomainError("conversation_trash.operation_conflict", "The conversation lifecycle binding conflicts with durable state."); }
