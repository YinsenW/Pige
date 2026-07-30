import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  KnowledgeActivitySummary,
  KnowledgeActivityUndoResult,
  NoteTrashCurrentRequest,
  NoteTrashCurrentResult,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { OperationRecordSchema, type OperationRecord } from "@pige/schemas";
import { flushDirectoryWhereSupported } from "./durable-directory-sync";
import type { NotesTrashResolution } from "./notes-service";

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

interface NoteTrashReceipt {
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
      target: { kind: "page", pageId: receipt.pageId },
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
    for (const receipt of readAllReceipts(vaultPath)) {
      try {
        const restore = readOperation(vaultPath, restoreOperationId(receipt.operationId));
        if (restore) {
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

  #completeTrash(vaultPath: string, receipt: NoteTrashReceipt): void {
    const existing = readOperation(vaultPath, receipt.operationId);
    if (existing) {
      if (!matchesTrashOperation(receipt, existing)) throw operationConflict();
      assertTrashedState(vaultPath, receipt);
      return;
    }
    moveToTrash(vaultPath, receipt);
    commitOperationExclusive(vaultPath, createTrashOperation(receipt));
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

function createTrashOperation(receipt: NoteTrashReceipt): OperationRecord {
  return OperationRecordSchema.parse({
    id: receipt.operationId,
    schemaVersion: 1,
    createdAt: receipt.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "trash_page",
    targetRefs: [{ kind: "page", id: receipt.pageId, path: receipt.trashPagePath }],
    sourceRefs: [{ kind: "page", id: receipt.pageId, path: receipt.originalPagePath }],
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

function matchesTrashOperation(receipt: NoteTrashReceipt, operation: OperationRecord): boolean {
  const target = operation.targetRefs[0];
  return operation.id === receipt.operationId && operation.kind === "trash_page" &&
    operation.actor.kind === "user" && operation.targetRefs.length === 1 &&
    target?.kind === "page" && target.id === receipt.pageId && target.path === receipt.trashPagePath &&
    operation.before?.id === receipt.contentHash && operation.before.path === receipt.originalPagePath &&
    operation.after?.id === receipt.contentHash && operation.after.path === receipt.trashPagePath;
}

function matchesRestoreOperation(receipt: NoteTrashReceipt, trash: OperationRecord, restore: OperationRecord): boolean {
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

function writeReceiptExclusive(vaultPath: string, receipt: NoteTrashReceipt): void {
  const receiptPath = receiptPathForRequest(vaultPath, receipt.requestId);
  ensureSafeDirectory(vaultPath, path.dirname(receiptPath));
  writeJsonExclusive(receiptPath, receipt);
}

function readReceiptByRequest(vaultPath: string, requestId: string): NoteTrashReceipt | undefined {
  return readReceipt(receiptPathForRequest(vaultPath, requestId));
}

function readReceiptByOperation(vaultPath: string, operationId: string): NoteTrashReceipt | undefined {
  return readAllReceipts(vaultPath).find((receipt) => receipt.operationId === operationId);
}

function readAllReceipts(vaultPath: string): NoteTrashReceipt[] {
  const root = receiptRoot(vaultPath);
  if (!pathExists(root)) return [];
  ensureSafeDirectory(vaultPath, root);
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && /^receipt_[a-f0-9]{32}\.json$/u.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length > MAX_RECEIPTS) throw new PigeDomainError("note_trash.receipt_limit", "Too many note trash receipts exist.");
  return entries.map((entry) => readReceipt(path.join(root, entry.name))).filter((value): value is NoteTrashReceipt => !!value);
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
    typeof value.title !== "string" || typeof value.createdAt !== "string"
  ) throw new PigeDomainError("note_trash.receipt_invalid", "The note trash receipt is invalid.");
  return value as NoteTrashReceipt;
}

function commitOperationExclusive(vaultPath: string, operation: OperationRecord): OperationRecord {
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

function readOperation(vaultPath: string, operationId: string): OperationRecord | undefined {
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

function restoreOperationId(operationId: string): string {
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

function assertHash(bytes: Uint8Array, expected: string): void {
  if (hashBytes(bytes) !== expected) throw staleError();
}

function hashBytes(bytes: Uint8Array): string {
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
