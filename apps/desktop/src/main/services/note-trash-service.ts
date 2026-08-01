import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  KnowledgeActivitySummary,
  KnowledgeActivityUndoResult,
  NoteTrashCurrentRequest,
  NoteTrashCurrentResult,
  NoteTrashListRequest,
  NoteTrashListResult,
  NoteTrashRestoreRequest,
  NoteTrashSummary,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { parsePigeFrontmatter } from "@pige/markdown";
import {
  NoteTrashListRequestSchema,
  NoteTrashRestoreRequestSchema,
  OperationRecordSchema,
  type OperationRecord
} from "@pige/schemas";
import { flushDirectoryWhereSupported } from "./durable-directory-sync";
import type { NotesTrashResolution } from "./notes-service";
import { isPigeGeneratedFrontmatter, isTrashableKnowledgePage } from "./reader-generated-note-reveal-service";
const MAX_NOTE_BYTES = 4 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 64 * 1024;
const MAX_RECEIPTS = 10_000;
const NOTE_REVISION = /^noteeditrev_([a-f0-9]{64})$/u;
const OPERATION_ID = /^op_(\d{8})_[a-z0-9]{8,}$/u;
export interface NoteTrashVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}
export interface NoteTrashTargetPort {
  resolveTrashTarget(ownerId: string, request: {
    readonly activeVaultId: string;
    readonly pageId: string;
    readonly renderContextId: string;
    readonly expectedRevision: string;
  }): NotesTrashResolution;
}
export type NoteTrashRequest = NoteTrashCurrentRequest;
export type NoteTrashResult = NoteTrashCurrentResult;
export type NoteTrashRestoreOutcome =
  | { readonly status: "committed"; readonly operationId: string }
  | { readonly status: "stale" | "not_found" | "failed" };
export interface NoteTrashReceipt {
  readonly schemaVersion: 1;
  readonly kind: "note_trash_receipt";
  readonly requestId: string;
  readonly requestDigest: string;
  readonly activeVaultId: string;
  readonly pageId: string;
  readonly operationId: string;
  readonly originalPagePath: string;
  readonly trashPagePath: string;
  readonly contentHash: string;
  readonly title: string;
  readonly createdAt: string;
  readonly redoOfOperationId?: string;
  readonly undoOperationId?: string;
}
interface NoteTrashRestoreIntent {
  readonly schemaVersion: 1;
  readonly kind: "note_trash_restore_intent";
  readonly requestId: string;
  readonly activeVaultId: string;
  readonly pageId: string;
  readonly trashOperationId: string;
  readonly expectedTrashRevision: string;
  readonly createdAt: string;
}
interface NoteTrashDependencies {
  readonly now?: () => Date;
  readonly randomId?: () => string;
}
export class NoteTrashService {
  readonly #vaults: NoteTrashVaultPort;
  readonly #targets: NoteTrashTargetPort;
  readonly #now: () => Date;
  readonly #randomId: () => string;
  constructor(vaults: NoteTrashVaultPort, targets: NoteTrashTargetPort, dependencies: NoteTrashDependencies = {}) {
    this.#vaults = vaults;
    this.#targets = targets;
    this.#now = dependencies.now ?? (() => new Date());
    this.#randomId = dependencies.randomId ?? randomUUID;
  }
  trash(ownerId: string, request: NoteTrashRequest): NoteTrashResult {
    const identity = resultIdentity(request);
    if (!validRequest(request)) return { ...identity, status: "failed" };
    const scope = this.#scope(request.activeVaultId);
    if (!scope) return { ...identity, status: "failed" };
    try {
      const existing = readReceiptByRequest(scope.vaultPath, request.requestId);
      if (existing) {
        if (existing.requestDigest !== requestDigest(request) || existing.activeVaultId !== request.activeVaultId) {
          return closedResult(request, "stale");
        }
        this.#completeTrash(scope.vaultPath, existing);
        return committedResult(request, existing.operationId);
      }
      const target = this.#targets.resolveTrashTarget(ownerId, {
        activeVaultId: request.activeVaultId,
        pageId: request.currentPageId,
        renderContextId: request.renderContextId,
        expectedRevision: request.expectedRevision
      });
      if (target.status !== "ready") return closedResult(request, target.status);
      if (!target.assertCurrent()) return closedResult(request, "stale");
      const createdAt = this.#now().toISOString();
      const operationId = createOperationId(createdAt, request, target.pageContentHash, this.#randomId());
      const receipt: NoteTrashReceipt = {
        schemaVersion: 1,
        kind: "note_trash_receipt",
        requestId: request.requestId,
        requestDigest: requestDigest(request),
        activeVaultId: request.activeVaultId,
        pageId: request.currentPageId,
        operationId,
        originalPagePath: normalizePagePath(scope.vaultPath, target.absolutePath, target.pagePath),
        trashPagePath: trashRelativePath(operationId, target.pagePath),
        contentHash: target.pageContentHash,
        title: boundedTitle(target.title),
        createdAt
      };
      writeReceiptExclusive(scope.vaultPath, receipt);
      if (!target.assertCurrent()) throw staleError();
      this.#completeTrash(scope.vaultPath, receipt);
      return committedResult(request, operationId);
    } catch (caught) {
      return caught instanceof PigeDomainError && caught.code === "note_trash.stale"
        ? closedResult(request, "stale")
        : { ...identity, status: "failed" };
    }
  }
  list(request: NoteTrashListRequest): NoteTrashListResult {
    const identity = { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId };
    if (!NoteTrashListRequestSchema.safeParse(request).success) return { ...identity, status: "failed" };
    const scope = this.#scope(request.activeVaultId);
    if (!scope) return { ...identity, status: "failed" };
    try {
      const notes = readAllReceipts(scope.vaultPath).flatMap((receipt): NoteTrashSummary[] => {
        const candidate = restorableCandidate(scope.vaultPath, receipt);
        return candidate ? [candidate] : [];
      }).sort((left, right) => right.trashedAt.localeCompare(left.trashedAt) ||
        left.trashOperationId.localeCompare(right.trashOperationId));
      return { ...identity, status: "ready", notes };
    } catch {
      return { ...identity, status: "failed" };
    }
  }
  restore(request: NoteTrashRestoreRequest): NoteTrashRestoreOutcome {
    if (!NoteTrashRestoreRequestSchema.safeParse(request).success) return { status: "failed" };
    const scope = this.#scope(request.activeVaultId);
    if (!scope) return { status: "failed" };
    try {
      const replay = readRestoreIntentByRequest(scope.vaultPath, request.requestId);
      if (replay) {
        if (!matchesRestoreIntent(replay, request)) return { status: "stale" };
        return this.#completeRestoreIntent(scope.vaultPath, replay);
      }
      const receipt = readReceiptByOperation(scope.vaultPath, request.trashOperationId);
      if (!receipt) return { status: "not_found" };
      if (receipt.activeVaultId !== request.activeVaultId || receipt.pageId !== request.pageId ||
        trashRevision(receipt) !== request.expectedTrashRevision) return { status: "stale" };
      const trashOperation = readOperation(scope.vaultPath, receipt.operationId);
      if (!trashOperation || !matchesTrashOperation(receipt, trashOperation)) return { status: "stale" };
      const existingRestore = readOperation(scope.vaultPath, restoreOperationId(receipt.operationId));
      if (existingRestore) {
        if (!matchesRestoreOperation(receipt, trashOperation, existingRestore)) return { status: "stale" };
        this.#finishRestoreCleanup(scope.vaultPath, receipt, existingRestore);
        return { status: "committed", operationId: existingRestore.id };
      }
      if (pathExists(resolveVaultRelative(scope.vaultPath, receipt.originalPagePath))) return { status: "stale" };
      if (!pathExists(resolveVaultRelative(scope.vaultPath, receipt.trashPagePath))) return { status: "not_found" };
      if (!restorableCandidate(scope.vaultPath, receipt)) return { status: "not_found" };
      const intent: NoteTrashRestoreIntent = {
        schemaVersion: 1,
        kind: "note_trash_restore_intent",
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        pageId: request.pageId,
        trashOperationId: request.trashOperationId,
        expectedTrashRevision: request.expectedTrashRevision,
        createdAt: this.#now().toISOString()
      };
      writeRestoreIntentExclusive(scope.vaultPath, intent);
      return this.#completeRestoreIntent(scope.vaultPath, intent);
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "note_trash.stale") return { status: "stale" };
      if (caught instanceof PigeDomainError && caught.code === "note_trash.not_found") return { status: "not_found" };
      return { status: "failed" };
    }
  }
  activitySummary(
    operation: OperationRecord,
    undo: OperationRecord | undefined
  ): KnowledgeActivitySummary | undefined {
    if (!isTrashOperation(operation)) return undefined;
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return undefined;
    const receipt = readReceiptByOperation(vaultPath, operation.id);
    if (!receipt || !matchesTrashOperation(receipt, operation)) return undefined;
    const matchingUndo = undo && matchesRestoreOperation(receipt, operation, undo) ? undo : undefined;
    return {
      operationId: operation.id,
      kind: "trash_page" as KnowledgeActivitySummary["kind"],
      createdAt: operation.createdAt,
      targetLabel: receipt.title,
      ...(matchingUndo ? { target: { kind: "page" as const, pageId: receipt.pageId } } : {}),
      status: matchingUndo ? "undone" : "applied",
      canUndo: !matchingUndo && trashPayloadMatches(vaultPath, receipt),
      ...(!matchingUndo && !trashPayloadMatches(vaultPath, receipt) ? { undoUnavailableReason: "target_missing" as const } : {}),
      ...(matchingUndo ? { undoUnavailableReason: "already_undone" as const } : {})
    };
  }
  findUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    if (!isTrashOperation(operation)) return undefined;
    return operations.find((candidate) => candidate.id === restoreOperationId(operation.id));
  }
  undo(operation: OperationRecord): KnowledgeActivityUndoResult {
    const vaultPath = this.#requireScope();
    const receipt = readReceiptByOperation(vaultPath, operation.id);
    if (!receipt || !matchesTrashOperation(receipt, operation)) {
      return { status: "not_found", operationId: operation.id };
    }
    const restoreId = restoreOperationId(operation.id);
    const existing = readOperation(vaultPath, restoreId);
    if (existing) {
      if (!matchesRestoreOperation(receipt, operation, existing)) throw operationConflict();
      this.#finishRestoreCleanup(vaultPath, receipt, existing);
      return { status: "already_undone", operationId: operation.id, undoOperationId: restoreId };
    }
    try {
      const restored = this.#restore(vaultPath, receipt, operation);
      return { status: "undone", operationId: operation.id, undoOperationId: restored.id };
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "note_trash.stale") {
        return { status: "stale", operationId: operation.id };
      }
      if (caught instanceof PigeDomainError && caught.code === "note_trash.not_found") {
        return { status: "not_found", operationId: operation.id };
      }
      throw caught;
    }
  }
  recoverIncompleteOperations(): { readonly recovered: number; readonly failed: number } {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0;
    let failed = 0;
    const intendedOperations = new Set<string>();
    for (const intent of readAllRestoreIntents(vaultPath)) {
      intendedOperations.add(intent.trashOperationId);
      try {
        if (this.#completeRestoreIntent(vaultPath, intent).status !== "committed") throw staleError();
        recovered += 1;
      } catch {
        failed += 1;
      }
    }
    const receipts = readAllReceipts(vaultPath).sort((left, right) => Number(Boolean(right.redoOfOperationId)) - Number(Boolean(left.redoOfOperationId)));
    for (const receipt of receipts) {
      if (intendedOperations.has(receipt.operationId)) continue;
      try {
        const restore = readOperation(vaultPath, restoreOperationId(receipt.operationId));
        if (restore) {
          const redo = receipts.find((candidate) => candidate.redoOfOperationId === receipt.operationId);
          const redoOperation = redo && readOperation(vaultPath, redo.operationId);
          if (redo && redoOperation && matchesTrashOperation(redo, redoOperation)) {
            recovered += 1;
            continue;
          }
          const trash = readOperation(vaultPath, receipt.operationId);
          if (!trash || !matchesRestoreOperation(receipt, trash, restore)) throw operationConflict();
          this.#finishRestoreCleanup(vaultPath, receipt, restore);
        } else {
          this.#completeTrash(vaultPath, receipt);
        }
        recovered += 1;
      } catch {
        failed += 1;
      }
    }
    return { recovered, failed };
  }
  #completeRestoreIntent(vaultPath: string, intent: NoteTrashRestoreIntent): NoteTrashRestoreOutcome {
    const receipt = readReceiptByOperation(vaultPath, intent.trashOperationId);
    if (!receipt) return { status: "not_found" };
    if (receipt.activeVaultId !== intent.activeVaultId || receipt.pageId !== intent.pageId ||
      trashRevision(receipt) !== intent.expectedTrashRevision) return { status: "stale" };
    const trashOperation = readOperation(vaultPath, receipt.operationId);
    if (!trashOperation || !matchesTrashOperation(receipt, trashOperation)) return { status: "stale" };
    const existingRestore = readOperation(vaultPath, restoreOperationId(receipt.operationId));
    if (existingRestore) {
      if (!matchesRestoreOperation(receipt, trashOperation, existingRestore)) return { status: "stale" };
      this.#finishRestoreCleanup(vaultPath, receipt, existingRestore);
      return { status: "committed", operationId: existingRestore.id };
    }
    const restored = this.#restore(vaultPath, receipt, trashOperation);
    return { status: "committed", operationId: restored.id };
  }
  #completeTrash(vaultPath: string, receipt: NoteTrashReceipt): void {
    completeNoteTrashReceipt(vaultPath, receipt);
  }
  #restore(vaultPath: string, receipt: NoteTrashReceipt, trashOperation: OperationRecord): OperationRecord {
    const originalPath = resolveVaultRelative(vaultPath, receipt.originalPagePath);
    const trashPath = resolveVaultRelative(vaultPath, receipt.trashPagePath);
    ensureSafeDirectory(vaultPath, path.dirname(originalPath));
    const originalExists = pathExists(originalPath);
    const trashExists = pathExists(trashPath);
    if (!trashExists && !originalExists) throw notFoundError();
    if (!trashExists && originalExists) throw staleError();
    const trash = readVerifiedFile(vaultPath, trashPath, 2);
    assertHash(trash.bytes, receipt.contentHash);
    if (originalExists) {
      const original = readVerifiedFile(vaultPath, originalPath, 2);
      if (!sameInode(original.stat, trash.stat) || hashBytes(original.bytes) !== receipt.contentHash) throw staleError();
    } else {
      fs.linkSync(trashPath, originalPath);
      flushDirectoryWhereSupported(path.dirname(originalPath));
      const original = readVerifiedFile(vaultPath, originalPath, 2);
      const linkedTrash = readVerifiedFile(vaultPath, trashPath, 2);
      if (
        !sameInode(original.stat, linkedTrash.stat) ||
        hashBytes(original.bytes) !== receipt.contentHash ||
        hashBytes(linkedTrash.bytes) !== receipt.contentHash
      ) throw staleError();
    }
    const restore = commitOperationExclusive(vaultPath, createRestoreOperation(receipt, trashOperation));
    this.#finishRestoreCleanup(vaultPath, receipt, restore);
    return restore;
  }

  #finishRestoreCleanup(vaultPath: string, receipt: NoteTrashReceipt, restore: OperationRecord): void {
    const trashOperation = readOperation(vaultPath, receipt.operationId);
    if (!trashOperation || !matchesRestoreOperation(receipt, trashOperation, restore)) throw operationConflict();
    const originalPath = resolveVaultRelative(vaultPath, receipt.originalPagePath);
    const trashPath = resolveVaultRelative(vaultPath, receipt.trashPagePath);
    if (!pathExists(originalPath)) throw staleError();
    const trashExists = pathExists(trashPath);
    const quarantineExists = pathExists(quarantinePathFor(trashPath, originalPath));
    const original = readVerifiedFile(vaultPath, originalPath, trashExists || quarantineExists ? 2 : 1);
    assertHash(original.bytes, receipt.contentHash);
    if (!trashExists) {
      if (quarantineExists) removeVerifiedLink(vaultPath, trashPath, originalPath, original.stat, receipt.contentHash);
      return;
    }
    const trash = readVerifiedFile(vaultPath, trashPath, 2);
    if (!sameInode(original.stat, trash.stat) || hashBytes(trash.bytes) !== receipt.contentHash) throw staleError();
    removeVerifiedLink(vaultPath, trashPath, originalPath, trash.stat, receipt.contentHash);
  }

  #scope(activeVaultId: string): { readonly vaultPath: string } | undefined {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    return vault && vaultPath && vault.vaultId === activeVaultId ? { vaultPath } : undefined;
  }

  #requireScope(): string {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!this.#vaults.current() || !vaultPath) throw new PigeDomainError("vault.not_open", "Open a Vault first.");
    return vaultPath;
  }
}

export function completeNoteTrashReceipt(vaultPath: string, receipt: NoteTrashReceipt): void {
  const existing = readOperation(vaultPath, receipt.operationId);
  if (existing) {
    if (!matchesTrashOperation(receipt, existing)) throw operationConflict();
    assertTrashedState(vaultPath, receipt);
    return;
  }
  moveToTrash(vaultPath, receipt);
  commitOperationExclusive(vaultPath, createTrashOperation(receipt));
}
function moveToTrash(vaultPath: string, receipt: NoteTrashReceipt): void {
  const sourcePath = resolveVaultRelative(vaultPath, receipt.originalPagePath);
  const trashPath = resolveVaultRelative(vaultPath, receipt.trashPagePath);
  ensureSafeDirectory(vaultPath, path.dirname(trashPath));
  const sourceExists = pathExists(sourcePath);
  const trashExists = pathExists(trashPath);
  if (!sourceExists && !trashExists) throw notFoundError();
  if (trashExists) {
    const trash = readVerifiedFile(vaultPath, trashPath, sourceExists ? 2 : 1);
    assertHash(trash.bytes, receipt.contentHash);
    if (sourceExists) {
      const source = readVerifiedFile(vaultPath, sourcePath, 2);
      if (!sameInode(source.stat, trash.stat) || hashBytes(source.bytes) !== receipt.contentHash) throw staleError();
      removeVerifiedLink(vaultPath, sourcePath, trashPath, source.stat, receipt.contentHash);
    } else if (pathExists(quarantinePathFor(sourcePath, trashPath))) {
      removeVerifiedLink(vaultPath, sourcePath, trashPath, trash.stat, receipt.contentHash);
    }
    return;
  }
  const source = readVerifiedFile(vaultPath, sourcePath, 1);
  assertHash(source.bytes, receipt.contentHash);
  fs.linkSync(sourcePath, trashPath);
  flushDirectoryWhereSupported(path.dirname(trashPath));
  const linkedSource = readVerifiedFile(vaultPath, sourcePath, 2);
  const trash = readVerifiedFile(vaultPath, trashPath, 2);
  if (
    !sameInode(linkedSource.stat, trash.stat) ||
    hashBytes(linkedSource.bytes) !== receipt.contentHash ||
    hashBytes(trash.bytes) !== receipt.contentHash
  ) throw staleError();
  removeVerifiedLink(vaultPath, sourcePath, trashPath, linkedSource.stat, receipt.contentHash);
}

function removeVerifiedLink(
  vaultPath: string,
  sourcePath: string,
  preservedPath: string,
  expected: fs.Stats,
  expectedHash: string
): void {
  const quarantinePath = quarantinePathFor(sourcePath, preservedPath);
  const sourceExists = pathExists(sourcePath);
  const quarantineExists = pathExists(quarantinePath);
  if (sourceExists && quarantineExists) throw staleError();
  if (!sourceExists && !quarantineExists) return;
  ensureSafeDirectory(vaultPath, path.dirname(quarantinePath));
  if (sourceExists) {
    fs.renameSync(sourcePath, quarantinePath);
    flushDirectoryWhereSupported(path.dirname(sourcePath));
    flushDirectoryWhereSupported(path.dirname(quarantinePath));
  }
  const quarantined = readVerifiedFile(vaultPath, quarantinePath, 2);
  if (!sameInode(expected, quarantined.stat) || hashBytes(quarantined.bytes) !== expectedHash) {
    if (!pathExists(sourcePath)) {
      try { fs.linkSync(quarantinePath, sourcePath); flushDirectoryWhereSupported(path.dirname(sourcePath)); } catch { /* Preserve the unexpected file in quarantine. */ }
    }
    throw staleError();
  }
  fs.unlinkSync(quarantinePath);
  flushDirectoryWhereSupported(path.dirname(quarantinePath));
}

function quarantinePathFor(sourcePath: string, preservedPath: string): string {
  return path.join(path.dirname(preservedPath), `.${path.basename(sourcePath)}.source-quarantine`);
}
function assertTrashedState(vaultPath: string, receipt: NoteTrashReceipt): void {
  if (pathExists(resolveVaultRelative(vaultPath, receipt.originalPagePath))) throw staleError();
  const trash = readVerifiedFile(vaultPath, resolveVaultRelative(vaultPath, receipt.trashPagePath), 1);
  assertHash(trash.bytes, receipt.contentHash);
}

export function createTrashOperation(receipt: NoteTrashReceipt): OperationRecord {
  return OperationRecordSchema.parse({
    id: receipt.operationId,
    schemaVersion: 1,
    createdAt: receipt.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "trash_page",
    targetRefs: [{ kind: "page", id: receipt.pageId, path: receipt.trashPagePath }],
    sourceRefs: [{ kind: "page", id: receipt.pageId, path: receipt.originalPagePath },
      ...(receipt.redoOfOperationId && receipt.undoOperationId
        ? [{ kind: "operation" as const, id: receipt.redoOfOperationId }, { kind: "operation" as const, id: receipt.undoOperationId }]
        : [])],
    before: { kind: "page", id: receipt.contentHash, path: receipt.originalPagePath },
    after: { kind: "page", id: receipt.contentHash, path: receipt.trashPagePath },
    summary: `Moved ${receipt.title} to recoverable trash.`,
    reversible: "best_effort",
    rollbackHint: "Restore the unchanged note to its original path if that path remains available.",
    warnings: []
  });
}

function createRestoreOperation(receipt: NoteTrashReceipt, trash: OperationRecord): OperationRecord {
  return OperationRecordSchema.parse({
    id: restoreOperationId(receipt.operationId),
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "restore_page",
    targetRefs: [{ kind: "page", id: receipt.pageId, path: receipt.originalPagePath }],
    sourceRefs: [
      { kind: "operation", id: trash.id },
      { kind: "page", id: receipt.pageId, path: receipt.trashPagePath }
    ],
    before: { kind: "page", id: receipt.contentHash, path: receipt.trashPagePath },
    after: { kind: "page", id: receipt.contentHash, path: receipt.originalPagePath },
    summary: `Restored ${receipt.title} from recoverable trash.`,
    reversible: "no",
    rollbackHint: "Move the unchanged note to recoverable trash again if requested.",
    warnings: []
  });
}

export function matchesTrashOperation(receipt: NoteTrashReceipt, operation: OperationRecord): boolean {
  const target = operation.targetRefs[0];
  return operation.id === receipt.operationId && operation.kind === "trash_page" &&
    operation.actor.kind === "user" && operation.targetRefs.length === 1 &&
    target?.kind === "page" && target.id === receipt.pageId && target.path === receipt.trashPagePath &&
    (!receipt.redoOfOperationId || operation.sourceRefs.some((ref) => ref.kind === "operation" && ref.id === receipt.redoOfOperationId)) &&
    (!receipt.undoOperationId || operation.sourceRefs.some((ref) => ref.kind === "operation" && ref.id === receipt.undoOperationId)) &&
    operation.before?.id === receipt.contentHash && operation.before.path === receipt.originalPagePath &&
    operation.after?.id === receipt.contentHash && operation.after.path === receipt.trashPagePath;
}

export function matchesRestoreOperation(receipt: NoteTrashReceipt, trash: OperationRecord, restore: OperationRecord): boolean {
  const target = restore.targetRefs[0];
  return matchesTrashOperation(receipt, trash) && restore.id === restoreOperationId(trash.id) &&
    restore.kind === "restore_page" && restore.actor.kind === "user" && restore.targetRefs.length === 1 &&
    target?.kind === "page" && target.id === receipt.pageId && target.path === receipt.originalPagePath &&
    restore.sourceRefs.some((ref) => ref.kind === "operation" && ref.id === trash.id) &&
    restore.before?.id === receipt.contentHash && restore.before.path === receipt.trashPagePath &&
    restore.after?.id === receipt.contentHash && restore.after.path === receipt.originalPagePath;
}

function isTrashOperation(operation: OperationRecord): boolean {
  return operation.kind === "trash_page" && operation.actor.kind === "user" && operation.reversible !== "no";
}

export function writeReceiptExclusive(vaultPath: string, receipt: NoteTrashReceipt): void {
  const receiptPath = receiptPathForRequest(vaultPath, receipt.requestId);
  ensureSafeDirectory(vaultPath, path.dirname(receiptPath));
  writeJsonExclusive(receiptPath, receipt);
}

function readReceiptByRequest(vaultPath: string, requestId: string): NoteTrashReceipt | undefined {
  return readReceipt(receiptPathForRequest(vaultPath, requestId));
}

export function readReceiptByOperation(vaultPath: string, operationId: string): NoteTrashReceipt | undefined {
  return readAllReceipts(vaultPath).find((receipt) => receipt.operationId === operationId);
}

export function readAllReceipts(vaultPath: string): NoteTrashReceipt[] {
  const root = receiptRoot(vaultPath);
  if (!pathExists(root)) return [];
  ensureSafeDirectory(vaultPath, root);
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && /^receipt_[a-f0-9]{32}\.json$/u.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length > MAX_RECEIPTS) throw new PigeDomainError("note_trash.receipt_limit", "Too many note trash receipts exist.");
  return entries.map((entry) => readReceipt(path.join(root, entry.name))).filter((value): value is NoteTrashReceipt => !!value);
}

function writeRestoreIntentExclusive(vaultPath: string, intent: NoteTrashRestoreIntent): void {
  const intentPath = restoreIntentPathForRequest(vaultPath, intent.requestId);
  ensureSafeDirectory(vaultPath, path.dirname(intentPath));
  try {
    writeJsonExclusive(intentPath, intent);
  } catch (caught) {
    if (!isErrno(caught, "EEXIST")) throw caught;
    const existing = readRestoreIntent(intentPath);
    if (!existing || JSON.stringify(existing) !== JSON.stringify(intent)) throw operationConflict();
  }
}

function readRestoreIntentByRequest(vaultPath: string, requestId: string): NoteTrashRestoreIntent | undefined {
  return readRestoreIntent(restoreIntentPathForRequest(vaultPath, requestId));
}

function readAllRestoreIntents(vaultPath: string): NoteTrashRestoreIntent[] {
  const root = restoreIntentRoot(vaultPath);
  if (!pathExists(root)) return [];
  ensureSafeDirectory(vaultPath, root);
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && /^intent_[a-f0-9]{32}\.json$/u.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length > MAX_RECEIPTS) throw new PigeDomainError("note_trash.receipt_limit", "Too many note restore intents exist.");
  return entries.map((entry) => readRestoreIntent(path.join(root, entry.name))).filter((value): value is NoteTrashRestoreIntent => !!value);
}

function readRestoreIntent(filePath: string): NoteTrashRestoreIntent | undefined {
  if (!pathExists(filePath)) return undefined;
  const value = JSON.parse(readBoundedFile(filePath, MAX_RECEIPT_BYTES).toString("utf8")) as Partial<NoteTrashRestoreIntent>;
  if (Object.keys(value).sort().join(",") !==
      "activeVaultId,createdAt,expectedTrashRevision,kind,pageId,requestId,schemaVersion,trashOperationId" ||
    value.schemaVersion !== 1 || value.kind !== "note_trash_restore_intent" ||
    typeof value.requestId !== "string" || !/^notetrashrestorereq_[a-z0-9]{16,64}$/u.test(value.requestId) ||
    typeof value.activeVaultId !== "string" || typeof value.pageId !== "string" ||
    typeof value.trashOperationId !== "string" || !OPERATION_ID.test(value.trashOperationId) ||
    typeof value.expectedTrashRevision !== "string" || !/^notetrashrev_[a-f0-9]{64}$/u.test(value.expectedTrashRevision) ||
    typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new PigeDomainError("note_trash.restore_intent_invalid", "The note restore intent is invalid.");
  }
  return value as NoteTrashRestoreIntent;
}

function matchesRestoreIntent(intent: NoteTrashRestoreIntent, request: NoteTrashRestoreRequest): boolean {
  return intent.requestId === request.requestId && intent.activeVaultId === request.activeVaultId &&
    intent.pageId === request.pageId && intent.trashOperationId === request.trashOperationId &&
    intent.expectedTrashRevision === request.expectedTrashRevision;
}

function readReceipt(filePath: string): NoteTrashReceipt | undefined {
  if (!pathExists(filePath)) return undefined;
  const bytes = readBoundedFile(filePath, MAX_RECEIPT_BYTES);
  const value = JSON.parse(bytes.toString("utf8")) as Partial<NoteTrashReceipt>;
  if (
    value.schemaVersion !== 1 || value.kind !== "note_trash_receipt" ||
    typeof value.requestId !== "string" || typeof value.requestDigest !== "string" ||
    typeof value.activeVaultId !== "string" || typeof value.pageId !== "string" ||
    typeof value.operationId !== "string" || !OPERATION_ID.test(value.operationId) ||
    typeof value.originalPagePath !== "string" || typeof value.trashPagePath !== "string" ||
    typeof value.contentHash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value.contentHash) ||
    typeof value.title !== "string" || typeof value.createdAt !== "string" ||
    (value.redoOfOperationId !== undefined && (typeof value.redoOfOperationId !== "string" || !OPERATION_ID.test(value.redoOfOperationId))) ||
    (value.undoOperationId !== undefined && (typeof value.undoOperationId !== "string" || !OPERATION_ID.test(value.undoOperationId))) ||
    Boolean(value.redoOfOperationId) !== Boolean(value.undoOperationId)
  ) throw new PigeDomainError("note_trash.receipt_invalid", "The note trash receipt is invalid.");
  return value as NoteTrashReceipt;
}

export function commitOperationExclusive(vaultPath: string, operation: OperationRecord): OperationRecord {
  const operationPath = operationPathFor(vaultPath, operation.id);
  ensureSafeDirectory(vaultPath, path.dirname(operationPath));
  try {
    writeJsonExclusive(operationPath, operation);
    return operation;
  } catch (caught) {
    if (!isErrno(caught, "EEXIST")) throw caught;
    const existing = readOperation(vaultPath, operation.id);
    if (existing && JSON.stringify(existing) === JSON.stringify(operation)) return existing;
    throw operationConflict();
  }
}

export function readOperation(vaultPath: string, operationId: string): OperationRecord | undefined {
  const operationPath = operationPathFor(vaultPath, operationId);
  if (!pathExists(operationPath)) return undefined;
  return OperationRecordSchema.parse(JSON.parse(readBoundedFile(operationPath, 256 * 1024).toString("utf8")));
}

function operationPathFor(vaultPath: string, operationId: string): string {
  const dateKey = OPERATION_ID.exec(operationId)?.[1];
  if (!dateKey) throw operationConflict();
  return path.join(
    vaultPath,
    ".pige",
    "operations",
    dateKey.slice(0, 4),
    dateKey.slice(4, 6),
    `${operationId}.json`
  );
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
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink < 1 || before.nlink > maximumLinks || before.size > MAX_NOTE_BYTES) throw staleError();
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
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximumBytes) throw staleError();
    const bytes = fs.readFileSync(descriptor);
    if (!sameFile(before, fs.fstatSync(descriptor))) throw staleError();
    return bytes;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function ensureSafeDirectory(vaultPath: string, directoryPath: string): void {
  assertConfined(vaultPath, directoryPath);
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
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw staleError();
      flushDirectoryWhereSupported(path.dirname(current));
    }
  }
}

export function resolveVaultRelative(vaultPath: string, relativePath: string): string {
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

function normalizePagePath(vaultPath: string, absolutePath: string, relativePath: string): string {
  const resolved = resolveVaultRelative(vaultPath, relativePath);
  if (resolved !== path.resolve(absolutePath) || !/^(?:wiki|sources)\//u.test(relativePath)) throw staleError();
  return relativePath;
}

function validRequest(request: NoteTrashRequest): boolean {
  return !!request && request.apiVersion === 1 && typeof request.requestId === "string" && /^notetrashreq_[a-z0-9]{16,64}$/u.test(request.requestId) &&
    typeof request.activeVaultId === "string" && typeof request.currentPageId === "string" &&
    typeof request.renderContextId === "string" && NOTE_REVISION.test(request.expectedRevision);
}

function requestDigest(request: NoteTrashRequest): string {
  return hashText([request.requestId, request.activeVaultId, request.currentPageId, request.renderContextId, request.expectedRevision].join("\0"));
}

function resultIdentity(request: NoteTrashRequest) {
  return {
    apiVersion: 1 as const,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    currentPageId: request.currentPageId,
    renderContextId: request.renderContextId,
    expectedRevision: request.expectedRevision
  };
}

function committedResult(request: NoteTrashRequest, operationId: string): NoteTrashResult {
  return {
    ...resultIdentity(request),
    status: "committed",
    operationId,
    authority: {
      pageId: request.currentPageId,
      pageState: "trashed",
      readerState: "closed",
      libraryPresence: "absent",
      canTrash: false
    }
  };
}

function closedResult(
  request: NoteTrashRequest,
  status: "stale" | "not_found" | "ineligible"
): NoteTrashResult {
  if (status === "stale") {
    return {
      ...resultIdentity(request),
      status,
      authority: {
        pageId: request.currentPageId,
        pageState: "present",
        readerState: "refresh_required",
        libraryPresence: "present",
        canTrash: false
      }
    };
  }
  if (status === "not_found") {
    return {
      ...resultIdentity(request),
      status,
      authority: {
        pageId: request.currentPageId,
        pageState: "missing",
        readerState: "closed",
        libraryPresence: "absent",
        canTrash: false
      }
    };
  }
  return {
    ...resultIdentity(request),
    status,
    authority: {
      pageId: request.currentPageId,
      pageState: "present",
      readerState: "preserved",
      libraryPresence: "present",
      canTrash: false
    }
  };
}

function receiptRoot(vaultPath: string): string {
  return path.join(vaultPath, ".pige", "trash", "note-receipts");
}

function restoreIntentRoot(vaultPath: string): string {
  return path.join(vaultPath, ".pige", "trash", "note-restore-intents");
}

function restoreIntentPathForRequest(vaultPath: string, requestId: string): string {
  return path.join(restoreIntentRoot(vaultPath), `intent_${createHash("sha256").update(requestId).digest("hex").slice(0, 32)}.json`);
}

function receiptPathForRequest(vaultPath: string, requestId: string): string {
  return path.join(receiptRoot(vaultPath), `receipt_${createHash("sha256").update(requestId).digest("hex").slice(0, 32)}.json`);
}

function trashRelativePath(operationId: string, pagePath: string): string {
  return [".pige", "trash", "pages", operationId, path.posix.basename(pagePath)].join("/");
}

function createOperationId(createdAt: string, request: NoteTrashRequest, contentHash: string, randomId: string): string {
  const dateKey = createdAt.slice(0, 10).replaceAll("-", "");
  const digest = createHash("sha256").update("pige.note.trash.v1\0").update(requestDigest(request)).update(contentHash).update(randomId).digest("hex").slice(0, 16);
  return `op_${dateKey}_${digest}`;
}

export function restoreOperationId(operationId: string): string {
  const dateKey = OPERATION_ID.exec(operationId)?.[1];
  if (!dateKey) throw operationConflict();
  const digest = createHash("sha256").update(`pige.note.restore.v1\0${operationId}`).digest("hex").slice(0, 16);
  return `op_${dateKey}_${digest}`;
}

function trashPayloadMatches(vaultPath: string, receipt: NoteTrashReceipt): boolean {
  try {
    const payload = readVerifiedFile(vaultPath, resolveVaultRelative(vaultPath, receipt.trashPagePath), 1);
    return hashBytes(payload.bytes) === receipt.contentHash;
  } catch {
    return false;
  }
}

function restorableCandidate(vaultPath: string, receipt: NoteTrashReceipt): NoteTrashSummary | undefined {
  if (pathExists(resolveVaultRelative(vaultPath, receipt.originalPagePath))) return undefined;
  const trashOperation = readOperation(vaultPath, receipt.operationId);
  if (!trashOperation || !matchesTrashOperation(receipt, trashOperation) ||
    readOperation(vaultPath, restoreOperationId(receipt.operationId))) return undefined;
  const payload = readVerifiedFile(vaultPath, resolveVaultRelative(vaultPath, receipt.trashPagePath), 1);
  if (hashBytes(payload.bytes) !== receipt.contentHash) return undefined;
  const markdown = payload.bytes.toString("utf8");
  if (markdown.includes("\uFFFD")) return undefined;
  const parsed = parsePigeFrontmatter(markdown);
  const frontmatter = parsed?.frontmatter;
  const trashable = isTrashableKnowledgePage(frontmatter?.type, frontmatter?.status,
    Boolean(parsed && isPigeGeneratedFrontmatter(parsed.raw)));
  if (!trashable || frontmatter?.id !== receipt.pageId || boundedTitle(frontmatter.title ?? "") !== receipt.title) {
    return undefined;
  }
  return {
    trashOperationId: receipt.operationId,
    expectedTrashRevision: trashRevision(receipt),
    pageId: receipt.pageId,
    title: receipt.title,
    trashedAt: receipt.createdAt,
    canRestore: true
  };
}

function trashRevision(receipt: NoteTrashReceipt): `notetrashrev_${string}` {
  return `notetrashrev_${createHash("sha256")
    .update("pige.note.trash.restore-revision.v1\0", "utf8")
    .update(JSON.stringify(receipt), "utf8")
    .digest("hex")}`;
}

function assertHash(bytes: Uint8Array, expected: string): void {
  if (hashBytes(bytes) !== expected) throw staleError();
}

export function hashBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function boundedTitle(value: string): string {
  const title = value.replace(/\s+/gu, " ").trim().slice(0, 120);
  if (!title) throw staleError();
  return title;
}

function sameFile(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function sameInode(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function pathExists(filePath: string): boolean {
  try { fs.lstatSync(filePath); return true; } catch (caught) { if (isErrno(caught, "ENOENT")) return false; throw caught; }
}

function isErrno(value: unknown, code: string): boolean {
  return typeof value === "object" && value !== null && "code" in value && (value as { code?: unknown }).code === code;
}

function staleError(): PigeDomainError { return new PigeDomainError("note_trash.stale", "The note changed before the lifecycle action committed."); }
function notFoundError(): PigeDomainError { return new PigeDomainError("note_trash.not_found", "The recoverable note payload is unavailable."); }
function operationConflict(): PigeDomainError { return new PigeDomainError("note_trash.operation_conflict", "The note lifecycle Operation binding conflicts."); }
