import { createHash } from "node:crypto";
import path from "node:path";
import type {
  KnowledgeActivityRedoRequest,
  KnowledgeActivityRedoResult,
  KnowledgeActivitySummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import type { OperationRecord } from "@pige/schemas";
import { readOperation } from "./note-trash-service";
import {
  completeSourceTrashReceipt,
  matchesSourceRestoreOperation,
  matchesSourceTrashOperation,
  readAllSourceTrashReceipts,
  readSourceTrashReceiptByOperation,
  sourceTrashRedoEligibility,
  type SourceTrashReceipt,
  type SourceTrashUsagePort,
  type SourceTrashVaultPort,
  sourceTrashRestoreOperationId,
  writeSourceTrashReceiptExclusive
} from "./source-trash-service";

const OPERATION_ID = /^op_(\d{8})_[a-z0-9]{8,}$/u;

interface SourceTrashRedoDependencies {
  readonly now?: () => Date;
  readonly afterReceiptPersisted?: () => void;
}

export class SourceTrashRedoService {
  readonly #vaults: SourceTrashVaultPort;
  readonly #usage: SourceTrashUsagePort | undefined;
  readonly #now: () => Date;
  readonly #afterReceiptPersisted: (() => void) | undefined;

  constructor(
    vaults: SourceTrashVaultPort,
    usage?: SourceTrashUsagePort,
    dependencies: SourceTrashRedoDependencies = {}
  ) {
    this.#vaults = vaults;
    this.#usage = usage;
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
      const receipt = readSourceTrashReceiptByOperation(vaultPath, request.operationId);
      if (!original || !receipt || !matchesSourceTrashOperation(receipt, original)) {
        return { status: "not_found", operationId: request.operationId };
      }
      const undo = readOperation(vaultPath, sourceTrashRestoreOperationId(original.id));
      if (!undo || !matchesSourceRestoreOperation(receipt, undo)) {
        return { status: "not_found", operationId: original.id };
      }
      if (request.expectedRevisionId !== undefined && request.expectedRevisionId !== receipt.sourceRecord.checksum) {
        return { status: "stale", operationId: original.id, currentRevisionId: receipt.sourceRecord.checksum };
      }
      const child = this.#readChild(vaultPath, receipt, undo);
      if (child) return this.#complete(vaultPath, receipt, undo, child, "already_redone");
      if (sourceTrashRedoEligibility(vaultPath, receipt, this.#usage) !== "ready") {
        return { status: "stale", operationId: original.id, currentRevisionId: receipt.sourceRecord.checksum };
      }
      const childReceipt = createRedoReceipt(receipt, undo, this.#now().toISOString());
      writeSourceTrashReceiptExclusive(vaultPath, childReceipt);
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
    const receipt = vaultPath && readSourceTrashReceiptByOperation(vaultPath, operation.id);
    if (!vaultPath || !receipt || !matchesSourceTrashOperation(receipt, operation) ||
      !matchesSourceRestoreOperation(receipt, undo)) return undefined;
    try {
      if (this.#readChild(vaultPath, receipt, undo)) {
        return { canRedo: false, redoUnavailableReason: "already_redone" };
      }
      const eligibility = sourceTrashRedoEligibility(vaultPath, receipt, this.#usage);
      return eligibility === "ready" ? { canRedo: true } : {
        canRedo: false,
        redoUnavailableReason: eligibility
      };
    } catch {
      return { canRedo: false, redoUnavailableReason: "content_changed" };
    }
  }

  recoverIncompleteRedos(): { readonly recovered: number; readonly failed: number } {
    const vaultPath = this.#activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0;
    let failed = 0;
    for (const child of readAllSourceTrashReceipts(vaultPath).filter((candidate) => candidate.redoOfOperationId)) {
      try {
        const parent = readSourceTrashReceiptByOperation(vaultPath, child.redoOfOperationId!);
        const original = parent && readOperation(vaultPath, parent.operationId);
        const undo = child.undoOperationId && readOperation(vaultPath, child.undoOperationId);
        if (!parent || !original || !undo || !matchesSourceTrashOperation(parent, original) ||
          !matchesSourceRestoreOperation(parent, undo) || !matchesRedoReceipt(child, parent, undo)) {
          throw new Error("Invalid source trash Redo lineage.");
        }
        const existed = Boolean(readOperation(vaultPath, child.operationId));
        completeSourceTrashReceipt(vaultPath, child, this.#usage);
        if (!existed) recovered += 1;
      } catch {
        failed += 1;
      }
    }
    return { recovered, failed };
  }

  #complete(
    vaultPath: string,
    parent: SourceTrashReceipt,
    undo: OperationRecord,
    child: SourceTrashReceipt,
    freshStatus: "redone" | "already_redone"
  ): KnowledgeActivityRedoResult {
    if (!matchesRedoReceipt(child, parent, undo)) throw new Error("Conflicting source trash Redo receipt.");
    const existed = Boolean(readOperation(vaultPath, child.operationId));
    completeSourceTrashReceipt(vaultPath, child, this.#usage);
    return {
      status: existed ? "already_redone" : freshStatus,
      operationId: parent.operationId,
      undoOperationId: undo.id,
      redoOperationId: child.operationId,
      revisionId: child.sourceRecord.checksum
    };
  }

  #readChild(vaultPath: string, parent: SourceTrashReceipt, undo: OperationRecord): SourceTrashReceipt | undefined {
    const children = readAllSourceTrashReceipts(vaultPath)
      .filter((candidate) => candidate.redoOfOperationId === parent.operationId);
    if (children.length > 1) throw new Error("Conflicting source trash Redo receipts.");
    const child = children[0];
    if (child && !matchesRedoReceipt(child, parent, undo)) throw new Error("Conflicting source trash Redo receipt.");
    return child;
  }

  #activeVaultPath(): string | undefined {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    return vault && vaultPath ? path.resolve(vaultPath) : undefined;
  }
}

function createRedoReceipt(parent: SourceTrashReceipt, undo: OperationRecord, createdAt: string): SourceTrashReceipt {
  const operationId = sourceTrashRedoOperationId(parent.operationId);
  const payloadRoot = `.pige/trash/source-assets/${operationId}`;
  return {
    ...parent,
    requestId: `sourcetrashreq_${digest(`redo\0${parent.operationId}`).slice(0, 32)}`,
    requestDigest: `sha256:${digest(`${parent.operationId}\0${undo.id}\0${parent.sourceRecord.checksum}`)}`,
    operationId,
    createdAt,
    sourceRecord: { ...parent.sourceRecord, trashPath: `${payloadRoot}/record.json` },
    sourcePage: { ...parent.sourcePage, trashPath: `${payloadRoot}/page.md` },
    ...(parent.managedAsset ? { managedAsset: { ...parent.managedAsset, trashPath: `${payloadRoot}/managed-copy` } } : {}),
    redoOfOperationId: parent.operationId,
    undoOperationId: undo.id
  };
}

function matchesRedoReceipt(child: SourceTrashReceipt, parent: SourceTrashReceipt, undo: OperationRecord): boolean {
  const operationId = sourceTrashRedoOperationId(parent.operationId);
  return child.redoOfOperationId === parent.operationId && child.undoOperationId === undo.id &&
    child.operationId === operationId && child.requestId === `sourcetrashreq_${digest(`redo\0${parent.operationId}`).slice(0, 32)}` &&
    child.requestDigest === `sha256:${digest(`${parent.operationId}\0${undo.id}\0${parent.sourceRecord.checksum}`)}` &&
    child.activeVaultId === parent.activeVaultId && child.sourceId === parent.sourceId && child.pageId === parent.pageId &&
    child.storage === parent.storage && child.title === parent.title &&
    child.sourceRecord.originalPath === parent.sourceRecord.originalPath && child.sourceRecord.checksum === parent.sourceRecord.checksum &&
    child.sourceRecord.size === parent.sourceRecord.size && child.sourceRecord.trashPath === `.pige/trash/source-assets/${operationId}/record.json` &&
    child.sourcePage.originalPath === parent.sourcePage.originalPath && child.sourcePage.checksum === parent.sourcePage.checksum &&
    child.sourcePage.size === parent.sourcePage.size && child.sourcePage.trashPath === `.pige/trash/source-assets/${operationId}/page.md` &&
    sameManagedAsset(child, parent, operationId);
}

function sameManagedAsset(child: SourceTrashReceipt, parent: SourceTrashReceipt, operationId: string): boolean {
  if (!child.managedAsset || !parent.managedAsset) return child.managedAsset === parent.managedAsset;
  return child.managedAsset.originalPath === parent.managedAsset.originalPath &&
    child.managedAsset.checksum === parent.managedAsset.checksum && child.managedAsset.size === parent.managedAsset.size &&
    child.managedAsset.trashPath === `.pige/trash/source-assets/${operationId}/managed-copy`;
}

function sourceTrashRedoOperationId(operationId: string): string {
  const dateKey = OPERATION_ID.exec(operationId)?.[1];
  if (!dateKey) throw new Error("Invalid source trash Operation identity.");
  return `op_${dateKey}_${digest(`pige.source.trash.redo.v1\0${operationId}`).slice(0, 24)}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
