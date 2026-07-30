import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  KnowledgeActivityRedoRequest,
  KnowledgeActivityRedoResult,
  KnowledgeActivitySummary
} from "@pige/contracts";
import type { OperationRecord } from "@pige/schemas";
import { PigeDomainError } from "@pige/domain";
import {
  completeNoteTrashReceipt,
  hashBytes,
  matchesRestoreOperation,
  matchesTrashOperation,
  readAllReceipts,
  readOperation,
  readReceiptByOperation,
  resolveVaultRelative,
  restoreOperationId,
  writeReceiptExclusive,
  type NoteTrashReceipt,
  type NoteTrashVaultPort
} from "./note-trash-service";

const OPERATION_ID = /^op_(\d{8})_[a-z0-9]{8,}$/u;
const MAX_NOTE_BYTES = 4 * 1024 * 1024;

interface NoteTrashRedoDependencies {
  readonly now?: () => Date;
  readonly afterReceiptPersisted?: () => void;
}

export class NoteTrashRedoService {
  readonly #vaults: NoteTrashVaultPort;
  readonly #now: () => Date;
  readonly #afterReceiptPersisted: (() => void) | undefined;

  constructor(vaults: NoteTrashVaultPort, dependencies: NoteTrashRedoDependencies = {}) {
    this.#vaults = vaults;
    this.#now = dependencies.now ?? (() => new Date());
    this.#afterReceiptPersisted = dependencies.afterReceiptPersisted;
  }

  redo(request: KnowledgeActivityRedoRequest): KnowledgeActivityRedoResult {
    if (!request || typeof request !== "object" || !OPERATION_ID.test(request.operationId)) {
      throw new PigeDomainError("activity.invalid_operation_id", "The Activity operation identity is invalid.");
    }
    const vaultPath = this.#activeVaultPath();
    if (!vaultPath) return { status: "not_found", operationId: request.operationId };
    try {
      const original = readOperation(vaultPath, request.operationId);
      const receipt = readReceiptByOperation(vaultPath, request.operationId);
      if (!original || !receipt || !matchesTrashOperation(receipt, original)) {
        return { status: "not_found", operationId: request.operationId };
      }
      const undo = readOperation(vaultPath, restoreOperationId(original.id));
      if (!undo || !matchesRestoreOperation(receipt, original, undo)) {
        return { status: "not_found", operationId: original.id };
      }
      if (request.expectedRevisionId !== undefined && request.expectedRevisionId !== receipt.contentHash) {
        return { status: "stale", operationId: original.id, currentRevisionId: receipt.contentHash };
      }
      const child = this.#readChild(vaultPath, receipt, undo);
      if (child) return this.#complete(vaultPath, receipt, undo, child, "already_redone");
      if (!liveMatches(vaultPath, receipt)) {
        const currentRevisionId = liveHash(vaultPath, receipt);
        return {
          status: "stale",
          operationId: original.id,
          ...(currentRevisionId ? { currentRevisionId } : {})
        };
      }
      const childReceipt = createRedoReceipt(receipt, undo, this.#now().toISOString());
      writeReceiptExclusive(vaultPath, childReceipt);
      this.#afterReceiptPersisted?.();
      return this.#complete(vaultPath, receipt, undo, childReceipt, "redone");
    } catch {
      return { status: "stale", operationId: request.operationId };
    }
  }

  activityState(
    operation: OperationRecord,
    undo: OperationRecord | undefined
  ): Pick<KnowledgeActivitySummary, "canRedo" | "redoUnavailableReason"> | undefined {
    if (!undo) return undefined;
    const vaultPath = this.#activeVaultPath();
    const receipt = vaultPath && readReceiptByOperation(vaultPath, operation.id);
    if (!vaultPath || !receipt || !matchesTrashOperation(receipt, operation) ||
      !matchesRestoreOperation(receipt, operation, undo)) return undefined;
    try {
      if (this.#readChild(vaultPath, receipt, undo)) {
        return { canRedo: false, redoUnavailableReason: "already_redone" };
      }
      if (!fs.existsSync(resolveVaultRelative(vaultPath, receipt.originalPagePath))) {
        return { canRedo: false, redoUnavailableReason: "target_missing" };
      }
      return liveMatches(vaultPath, receipt)
        ? { canRedo: true }
        : { canRedo: false, redoUnavailableReason: "content_changed" };
    } catch {
      return { canRedo: false, redoUnavailableReason: "content_changed" };
    }
  }

  recoverIncompleteRedos(): { readonly recovered: number; readonly failed: number } {
    const vaultPath = this.#activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0;
    let failed = 0;
    for (const receipt of readAllReceipts(vaultPath).filter((candidate) => candidate.redoOfOperationId)) {
      try {
        const parent = readReceiptByOperation(vaultPath, receipt.redoOfOperationId!);
        const original = parent && readOperation(vaultPath, parent.operationId);
        const undo = receipt.undoOperationId && readOperation(vaultPath, receipt.undoOperationId);
        if (!parent || !original || !undo || !matchesTrashOperation(parent, original) ||
          !matchesRestoreOperation(parent, original, undo) || !matchesRedoReceipt(receipt, parent, undo)) {
          throw new Error("Invalid note trash Redo lineage.");
        }
        completeNoteTrashReceipt(vaultPath, receipt);
        recovered += 1;
      } catch {
        failed += 1;
      }
    }
    return { recovered, failed };
  }

  #complete(
    vaultPath: string,
    parent: NoteTrashReceipt,
    undo: OperationRecord,
    child: NoteTrashReceipt,
    freshStatus: "redone" | "already_redone"
  ): KnowledgeActivityRedoResult {
    if (!matchesRedoReceipt(child, parent, undo)) throw new Error("Conflicting note trash Redo receipt.");
    const existed = Boolean(readOperation(vaultPath, child.operationId));
    completeNoteTrashReceipt(vaultPath, child);
    return {
      status: existed ? "already_redone" : freshStatus,
      operationId: parent.operationId,
      undoOperationId: undo.id,
      redoOperationId: child.operationId,
      revisionId: child.contentHash
    };
  }

  #readChild(vaultPath: string, parent: NoteTrashReceipt, undo: OperationRecord): NoteTrashReceipt | undefined {
    const children = readAllReceipts(vaultPath).filter((candidate) => candidate.redoOfOperationId === parent.operationId);
    if (children.length > 1) throw new Error("Conflicting note trash Redo receipts.");
    const child = children[0];
    if (child && !matchesRedoReceipt(child, parent, undo)) throw new Error("Conflicting note trash Redo receipt.");
    return child;
  }

  #activeVaultPath(): string | undefined {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    return vault && vaultPath ? path.resolve(vaultPath) : undefined;
  }
}

function createRedoReceipt(parent: NoteTrashReceipt, undo: OperationRecord, createdAt: string): NoteTrashReceipt {
  const operationId = redoOperationId(parent.operationId);
  return {
    schemaVersion: 1,
    kind: "note_trash_receipt",
    requestId: `notetrashredoreq_${digest(parent.operationId).slice(0, 32)}`,
    requestDigest: `sha256:${digest(`${parent.operationId}\0${undo.id}\0${parent.contentHash}`)}`,
    activeVaultId: parent.activeVaultId,
    pageId: parent.pageId,
    operationId,
    originalPagePath: parent.originalPagePath,
    trashPagePath: [".pige", "trash", "pages", operationId, path.posix.basename(parent.originalPagePath)].join("/"),
    contentHash: parent.contentHash,
    title: parent.title,
    createdAt,
    redoOfOperationId: parent.operationId,
    undoOperationId: undo.id
  };
}

function matchesRedoReceipt(child: NoteTrashReceipt, parent: NoteTrashReceipt, undo: OperationRecord): boolean {
  return child.redoOfOperationId === parent.operationId && child.undoOperationId === undo.id &&
    child.operationId === redoOperationId(parent.operationId) && child.activeVaultId === parent.activeVaultId &&
    child.pageId === parent.pageId && child.originalPagePath === parent.originalPagePath &&
    child.contentHash === parent.contentHash && child.title === parent.title;
}

function redoOperationId(operationId: string): string {
  const dateKey = OPERATION_ID.exec(operationId)?.[1];
  if (!dateKey) throw new Error("Invalid note trash Operation identity.");
  return `op_${dateKey}_${digest(`pige.note.trash.redo.v1\0${operationId}`).slice(0, 16)}`;
}

function liveMatches(vaultPath: string, receipt: NoteTrashReceipt): boolean {
  return liveHash(vaultPath, receipt) === receipt.contentHash;
}

function liveHash(vaultPath: string, receipt: NoteTrashReceipt): string | undefined {
  const filePath = resolveVaultRelative(vaultPath, receipt.originalPagePath);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > MAX_NOTE_BYTES) return undefined;
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      return undefined;
    }
    return hashBytes(bytes);
  } catch (caught) {
    if (typeof caught === "object" && caught !== null && "code" in caught && caught.code === "ENOENT") return undefined;
    throw caught;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
