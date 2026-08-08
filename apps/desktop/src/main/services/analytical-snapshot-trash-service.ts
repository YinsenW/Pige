import fs from "node:fs";
import path from "node:path";
import type { KnowledgeActivitySummary, KnowledgeActivityUndoResult } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  CollectionAnalyticalSnapshotIdSchema,
  CollectionAnalyticalSnapshotListTrashRequestSchema,
  CollectionAnalyticalSnapshotListTrashResultSchema,
  CollectionAnalyticalSnapshotRestoreRequestSchema,
  CollectionAnalyticalSnapshotRestoreResultSchema,
  CollectionAnalyticalSnapshotTrashRequestSchema,
  CollectionAnalyticalSnapshotTrashResultSchema,
  OperationIdSchema,
  OperationRecordSchema,
  type CollectionAnalyticalSnapshotListTrashRequest,
  type CollectionAnalyticalSnapshotListTrashResult,
  type CollectionAnalyticalSnapshotRestoreRequest,
  type CollectionAnalyticalSnapshotRestoreResult,
  type CollectionAnalyticalSnapshotTrashRequest,
  type CollectionAnalyticalSnapshotTrashResult,
  type OperationRecord
} from "@pige/schemas";
import { flushDirectoryWhereSupported } from "./durable-directory-sync";
import {
  AnalyticalSnapshotRecordSchema,
  AnalyticalSnapshotService,
  type AnalyticalSnapshotRecord,
  type AnalyticalSnapshotServiceVaultPort
} from "./analytical-snapshot-service";
import {
  assertSafeVaultRoot,
  hashCanonical,
  operationPathFor,
  readJsonBounded,
  writeJsonExclusive
} from "./managed-collection-storage";
import { z } from "zod";

const MAX_RECEIPT_BYTES = 128 * 1024;
const MAX_RECEIPTS = 256;
const SNAPSHOT_DIRECTORY = ".pige/analytical-snapshots";
const TRASH_DIRECTORY = ".pige/trash/analytical-snapshots";
const OPERATION_ID_PATTERN = /^op_\d{8}_[a-z0-9]{8,}$/u;
const RELATIVE_PATH_PATTERN = /^\.pige\/(?:analytical-snapshots|trash\/analytical-snapshots)\/[a-z0-9][a-z0-9._/-]*\.json$/u;

const AnalyticalSnapshotTrashReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("analytical_snapshot_trash_receipt"),
  requestId: z.string().regex(/^collection_request_[a-z0-9]{16,64}$/u),
  requestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  activeVaultId: z.string().regex(/^vault_\d{8}_[a-z0-9]{8,}$/u),
  snapshotId: CollectionAnalyticalSnapshotIdSchema,
  datasetId: z.string().regex(/^dataset_\d{8}_[a-z0-9]{12,}$/u),
  revisionId: z.string().regex(/^dataset_rev_\d{8}_[a-z0-9]{12,}$/u),
  tableId: z.string().regex(/^table_[a-z0-9]{12,}$/u),
  expectedOperationId: OperationIdSchema,
  sourceOperationId: OperationIdSchema,
  tableName: z.string().trim().min(1).max(512),
  rowCount: z.number().int().nonnegative().max(10_000_000),
  columnCount: z.number().int().positive().max(32),
  title: z.string().trim().min(1).max(240),
  operationId: OperationIdSchema,
  createdAt: z.string().datetime({ offset: true }),
  recordHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  originalRelativePath: z.string().regex(RELATIVE_PATH_PATTERN),
  trashRelativePath: z.string().regex(RELATIVE_PATH_PATTERN)
}).strict();

type AnalyticalSnapshotTrashReceipt = z.infer<typeof AnalyticalSnapshotTrashReceiptSchema>;

interface AnalyticalSnapshotRestoreIntent {
  readonly schemaVersion: 1;
  readonly kind: "analytical_snapshot_restore_intent";
  readonly requestId: string;
  readonly activeVaultId: string;
  readonly snapshotId: string;
  readonly trashOperationId: string;
  readonly expectedTrashRevision: string;
  readonly restoreOperationId: string;
  readonly createdAt: string;
}

export class AnalyticalSnapshotTrashService {
  readonly #vaults: AnalyticalSnapshotServiceVaultPort;
  readonly #snapshots: Pick<AnalyticalSnapshotService, "open" | "isCurrentRecord">;
  readonly #now: () => Date;

  constructor(
    vaults: AnalyticalSnapshotServiceVaultPort,
    snapshots: Pick<AnalyticalSnapshotService, "open" | "isCurrentRecord"> = new AnalyticalSnapshotService(vaults),
    now: () => Date = () => new Date()
  ) {
    this.#vaults = vaults;
    this.#snapshots = snapshots;
    this.#now = now;
  }

  trash(request: CollectionAnalyticalSnapshotTrashRequest): CollectionAnalyticalSnapshotTrashResult {
    const parsed = CollectionAnalyticalSnapshotTrashRequestSchema.parse(request);
    const identity = { ...parsed };
    const vaultPath = this.#activeVaultPath(parsed.activeVaultId);
    if (!vaultPath) return CollectionAnalyticalSnapshotTrashResultSchema.parse({ ...identity, status: "not_found" });
    try {
      const replay = readReceiptByRequest(vaultPath, parsed.requestId);
      if (replay) {
        if (!matchesTrashRequest(replay, parsed)) return result(identity, "stale");
        completeTrash(vaultPath, replay);
        return result(identity, "committed", replay.operationId);
      }
      const record = readRecord(vaultPath, parsed.snapshotId);
      if (!record) return result(identity, "not_found");
      if (record.operationId !== parsed.expectedOperationId) return result(identity, "stale");
      if (!this.#isCurrentSnapshot(parsed.activeVaultId, record) || !matchesCreateOperation(vaultPath, record)) {
        return result(identity, "ineligible");
      }
      const operationId = operationIdFor(parsed.requestId, record.snapshotId, "trash", this.#now());
      const receipt: AnalyticalSnapshotTrashReceipt = {
        schemaVersion: 1,
        kind: "analytical_snapshot_trash_receipt",
        requestId: parsed.requestId,
        requestDigest: requestDigest(parsed),
        activeVaultId: parsed.activeVaultId,
        snapshotId: record.snapshotId,
        datasetId: record.datasetId,
        revisionId: record.revisionId,
        tableId: record.tableId,
        expectedOperationId: parsed.expectedOperationId,
        sourceOperationId: record.operationId,
        tableName: record.tableName,
        rowCount: record.rowCount,
        columnCount: record.columnCount,
        title: record.title,
        operationId,
        createdAt: this.#now().toISOString(),
        recordHash: hashCanonical(record),
        originalRelativePath: snapshotRelativePath(record.snapshotId),
        trashRelativePath: trashRelativePath(operationId)
      };
      writeReceipt(vaultPath, receipt);
      const current = readRecord(vaultPath, record.snapshotId);
      if (!current || hashCanonical(current) !== receipt.recordHash ||
          !this.#isCurrentSnapshot(parsed.activeVaultId, current)) return result(identity, "stale");
      completeTrash(vaultPath, receipt);
      return result(identity, "committed", receipt.operationId);
    } catch (caught) {
      return result(identity, isStale(caught) ? "stale" : "failed");
    }
  }

  listTrash(request: CollectionAnalyticalSnapshotListTrashRequest): CollectionAnalyticalSnapshotListTrashResult {
    const parsed = CollectionAnalyticalSnapshotListTrashRequestSchema.parse(request);
    const vaultPath = this.#activeVaultPath(parsed.activeVaultId);
    if (!vaultPath) return { ...request, status: "not_found" };
    try {
      const snapshots = readReceipts(vaultPath)
        .filter((receipt) => isRestorable(vaultPath, receipt))
        .filter((receipt) => this.#isCurrentSnapshot(parsed.activeVaultId, receipt))
        .map(toTrashSummary)
        .sort((left, right) => right.trashedAt.localeCompare(left.trashedAt) || left.snapshotId.localeCompare(right.snapshotId))
        .slice(0, 100);
      const revision = trashRevision(snapshots);
      return CollectionAnalyticalSnapshotListTrashResultSchema.parse({
        ...request,
        status: "ready",
        revision,
        snapshots
      });
    } catch {
      return CollectionAnalyticalSnapshotListTrashResultSchema.parse({ ...request, status: "failed" });
    }
  }

  restore(request: CollectionAnalyticalSnapshotRestoreRequest): CollectionAnalyticalSnapshotRestoreResult {
    const parsed = CollectionAnalyticalSnapshotRestoreRequestSchema.parse(request);
    const identity = { ...parsed };
    const vaultPath = this.#activeVaultPath(parsed.activeVaultId);
    if (!vaultPath) return CollectionAnalyticalSnapshotRestoreResultSchema.parse({ ...identity, status: "not_found" });
    try {
      const receipt = readReceiptByOperation(vaultPath, parsed.trashOperationId);
      if (!receipt) return restoreResult(identity, "not_found");
      const inventory = this.listTrash({ apiVersion: 1, requestId: parsed.requestId, activeVaultId: parsed.activeVaultId });
      if (inventory.status !== "ready") return restoreResult(identity, inventory.status === "not_found" ? "not_found" : "failed");
      const candidate = inventory.snapshots.find((item) => item.trashOperationId === parsed.trashOperationId);
      if (receipt.snapshotId !== parsed.snapshotId || inventory.revision !== parsed.expectedTrashRevision || !candidate) {
        return restoreResult(identity, "stale");
      }
      const restoreOperationId = restoreOperationIdFor(receipt);
      const existing = readOperation(vaultPath, restoreOperationId);
      if (existing) {
        if (!matchesRestoreOperation(receipt, existing) || !isRestored(vaultPath, receipt)) return restoreResult(identity, "stale");
        return restoreResult(identity, "committed", existing.id);
      }
      if (!isRestorable(vaultPath, receipt) || !this.#isCurrentSnapshot(parsed.activeVaultId, receipt)) {
        return restoreResult(identity, "ineligible");
      }
      const intent: AnalyticalSnapshotRestoreIntent = {
        schemaVersion: 1,
        kind: "analytical_snapshot_restore_intent",
        requestId: parsed.requestId,
        activeVaultId: parsed.activeVaultId,
        snapshotId: parsed.snapshotId,
        trashOperationId: parsed.trashOperationId,
        expectedTrashRevision: parsed.expectedTrashRevision,
        restoreOperationId,
        createdAt: this.#now().toISOString()
      };
      writeRestoreIntent(vaultPath, intent);
      completeRestore(vaultPath, receipt, restoreOperationId, this.#now().toISOString());
      removeRestoreIntent(vaultPath, restoreOperationId);
      return restoreResult(identity, "committed", restoreOperationId);
    } catch (caught) {
      return restoreResult(identity, isStale(caught) ? "stale" : "failed");
    }
  }

  activitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    if (operation.kind !== "trash_analytical_snapshot") return undefined;
    const vaultPath = this.#vaults.activeVaultPath();
    const receipt = vaultPath ? readReceiptByOperation(vaultPath, operation.id) : undefined;
    if (!vaultPath || !receipt || !matchesTrashOperation(receipt, operation)) return undefined;
    const restored = undo && matchesRestoreOperation(receipt, undo);
    return {
      operationId: operation.id,
      kind: restored ? "restore_analytical_snapshot" : "trash_analytical_snapshot",
      createdAt: operation.createdAt,
      targetLabel: receipt.title,
      status: restored ? "undone" : "applied",
      canUndo: !restored && isRestorable(vaultPath, receipt),
      ...(restored ? { undoUnavailableReason: "already_undone" as const } : {})
    };
  }

  findUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    if (operation.kind !== "trash_analytical_snapshot") return undefined;
    const receipt = this.#vaults.activeVaultPath()
      ? readReceiptByOperation(this.#vaults.activeVaultPath()!, operation.id)
      : undefined;
    return receipt ? operations.find((candidate) => candidate.id === restoreOperationIdFor(receipt) && matchesRestoreOperation(receipt, candidate)) : undefined;
  }

  undo(operation: OperationRecord): KnowledgeActivityUndoResult {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath || operation.kind !== "trash_analytical_snapshot") return { status: "not_found", operationId: operation.id };
    const receipt = readReceiptByOperation(vaultPath, operation.id);
    if (!receipt || !matchesTrashOperation(receipt, operation)) return { status: "not_found", operationId: operation.id };
    const restoreId = restoreOperationIdFor(receipt);
    const existing = readOperation(vaultPath, restoreId);
    if (existing) {
      if (!matchesRestoreOperation(receipt, existing) || !isRestored(vaultPath, receipt)) return { status: "stale", operationId: operation.id };
      return { status: "already_undone", operationId: operation.id, undoOperationId: restoreId };
    }
    try {
      const intent: AnalyticalSnapshotRestoreIntent = {
        schemaVersion: 1,
        kind: "analytical_snapshot_restore_intent",
        requestId: `collection_request_undo${restoreId.slice(-24)}`,
        activeVaultId: receipt.activeVaultId,
        snapshotId: receipt.snapshotId,
        trashOperationId: receipt.operationId,
        expectedTrashRevision: trashRevision([toTrashSummary(receipt)]),
        restoreOperationId: restoreId,
        createdAt: this.#now().toISOString()
      };
      writeRestoreIntent(vaultPath, intent);
      completeRestore(vaultPath, receipt, restoreId, this.#now().toISOString());
      removeRestoreIntent(vaultPath, restoreId);
      return { status: "undone", operationId: operation.id, undoOperationId: restoreId };
    } catch {
      return { status: "stale", operationId: operation.id };
    }
  }

  recoverIncompleteOperations(): { readonly recovered: number; readonly failed: number } {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0;
    let failed = 0;
    for (const receipt of readReceipts(vaultPath)) {
      try {
        const before = readOperation(vaultPath, receipt.operationId);
        completeTrash(vaultPath, receipt);
        if (!before) recovered += 1;
      } catch {
        failed += 1;
      }
    }
    for (const intent of readRestoreIntents(vaultPath)) {
      try {
        const receipt = readReceiptByOperation(vaultPath, intent.trashOperationId);
        if (!receipt || receipt.snapshotId !== intent.snapshotId || receipt.activeVaultId !== intent.activeVaultId) throw stale();
        const before = readOperation(vaultPath, intent.restoreOperationId);
        completeRestore(vaultPath, receipt, intent.restoreOperationId, intent.createdAt);
        removeRestoreIntent(vaultPath, intent.restoreOperationId);
        if (!before) recovered += 1;
      } catch {
        failed += 1;
      }
    }
    return { recovered, failed };
  }

  #activeVaultPath(activeVaultId: string): string | undefined {
    const current = this.#vaults.current();
    if (!current || current.vaultId !== activeVaultId) return undefined;
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return undefined;
    assertSafeVaultRoot(vaultPath);
    return vaultPath;
  }

  #isCurrentSnapshot(activeVaultId: string, value: AnalyticalSnapshotRecord | AnalyticalSnapshotTrashReceipt): boolean {
    const vaultPath = this.#activeVaultPath(activeVaultId);
    if (!vaultPath) return false;
    const relativePath = "recordHash" in value ? value.trashRelativePath : snapshotRelativePath(value.snapshotId);
    const record = readRecordAtPath(vaultPath, relativePath);
    return Boolean(record &&
      ("recordHash" in value ? hashCanonical(record) === value.recordHash : true) &&
      record.snapshotId === value.snapshotId && record.datasetId === value.datasetId &&
      record.revisionId === value.revisionId && record.tableId === value.tableId &&
      this.#snapshots.isCurrentRecord(activeVaultId, record));
  }
}

function result(
  identity: CollectionAnalyticalSnapshotTrashRequest,
  status: "committed" | "stale" | "not_found" | "ineligible" | "failed",
  operationId?: string
): CollectionAnalyticalSnapshotTrashResult {
  return CollectionAnalyticalSnapshotTrashResultSchema.parse({ ...identity, status, ...(operationId ? { operationId } : {}) });
}

function restoreResult(
  identity: CollectionAnalyticalSnapshotRestoreRequest,
  status: "committed" | "stale" | "not_found" | "ineligible" | "failed",
  operationId?: string
): CollectionAnalyticalSnapshotRestoreResult {
  return CollectionAnalyticalSnapshotRestoreResultSchema.parse({ ...identity, status, ...(operationId ? { operationId } : {}) });
}

function requestDigest(request: CollectionAnalyticalSnapshotTrashRequest): string {
  return hashCanonical({ activeVaultId: request.activeVaultId, snapshotId: request.snapshotId, expectedOperationId: request.expectedOperationId });
}

function snapshotRelativePath(snapshotId: string): string {
  if (!CollectionAnalyticalSnapshotIdSchema.safeParse(snapshotId).success) throw stale();
  return `${SNAPSHOT_DIRECTORY}/${snapshotId}.json`;
}

function readRecordAtPath(vaultPath: string, relativePath: string): AnalyticalSnapshotRecord | undefined {
  const filePath = resolveRelative(vaultPath, relativePath);
  if (!fs.existsSync(filePath)) return undefined;
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw stale();
  const parsed = AnalyticalSnapshotRecordSchema.safeParse(readJsonBounded(filePath, MAX_RECEIPT_BYTES));
  return parsed.success ? parsed.data : undefined;
}

function trashRelativePath(operationId: string): string {
  if (!OPERATION_ID_PATTERN.test(operationId)) throw stale();
  return `${TRASH_DIRECTORY}/items/${operationId}/snapshot.json`;
}

function receiptRoot(vaultPath: string): string { return resolveRelative(vaultPath, `${TRASH_DIRECTORY}/receipts`); }
function receiptPath(vaultPath: string, operationId: string): string { return path.join(receiptRoot(vaultPath), `${operationId}.json`); }
function restoreIntentRoot(vaultPath: string): string { return resolveRelative(vaultPath, `${TRASH_DIRECTORY}/restore-intents`); }
function restoreIntentPath(vaultPath: string, operationId: string): string { return path.join(restoreIntentRoot(vaultPath), `${operationId}.json`); }

function readRecord(vaultPath: string, snapshotId: string): AnalyticalSnapshotRecord | undefined {
  return readRecordAtPath(vaultPath, snapshotRelativePath(snapshotId));
}

function readReceipts(vaultPath: string): AnalyticalSnapshotTrashReceipt[] {
  const root = receiptRoot(vaultPath);
  if (!fs.existsSync(root)) return [];
  ensureSafeDirectory(vaultPath, root);
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && OPERATION_ID_PATTERN.test(entry.name.replace(/\.json$/u, "")))
    .slice(0, MAX_RECEIPTS);
  return entries.flatMap((entry) => {
    const parsed = AnalyticalSnapshotTrashReceiptSchema.safeParse(readJsonBounded(path.join(root, entry.name), MAX_RECEIPT_BYTES));
    return parsed.success ? [parsed.data] : [];
  });
}

function readReceiptByRequest(vaultPath: string, requestId: string): AnalyticalSnapshotTrashReceipt | undefined {
  return readReceipts(vaultPath).find((receipt) => receipt.requestId === requestId);
}

function readReceiptByOperation(vaultPath: string, operationId: string): AnalyticalSnapshotTrashReceipt | undefined {
  return readReceipts(vaultPath).find((receipt) => receipt.operationId === operationId);
}

function writeReceipt(vaultPath: string, receipt: AnalyticalSnapshotTrashReceipt): void {
  writePrivateJsonExclusive(vaultPath, receiptPath(vaultPath, receipt.operationId), receipt);
}

function writeRestoreIntent(vaultPath: string, intent: AnalyticalSnapshotRestoreIntent): void {
  writePrivateJsonExclusive(vaultPath, restoreIntentPath(vaultPath, intent.restoreOperationId), intent);
}

function readRestoreIntents(vaultPath: string): AnalyticalSnapshotRestoreIntent[] {
  const root = restoreIntentRoot(vaultPath);
  if (!fs.existsSync(root)) return [];
  ensureSafeDirectory(vaultPath, root);
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && OPERATION_ID_PATTERN.test(entry.name.replace(/\.json$/u, "")))
    .flatMap((entry) => {
      const value = readJsonBounded(path.join(root, entry.name), MAX_RECEIPT_BYTES);
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const candidate = value as Partial<AnalyticalSnapshotRestoreIntent>;
      return candidate.schemaVersion === 1 && candidate.kind === "analytical_snapshot_restore_intent" &&
        typeof candidate.requestId === "string" && typeof candidate.activeVaultId === "string" &&
        typeof candidate.snapshotId === "string" && typeof candidate.trashOperationId === "string" &&
        typeof candidate.expectedTrashRevision === "string" && typeof candidate.restoreOperationId === "string" &&
        typeof candidate.createdAt === "string" ? [candidate as AnalyticalSnapshotRestoreIntent] : [];
    });
}

function removeRestoreIntent(vaultPath: string, operationId: string): void {
  try {
    fs.rmSync(restoreIntentPath(vaultPath, operationId));
    flushDirectoryWhereSupported(restoreIntentRoot(vaultPath));
  } catch (caught) {
    if (!(caught instanceof Error && "code" in caught && caught.code === "ENOENT")) throw caught;
  }
}

function completeTrash(vaultPath: string, receipt: AnalyticalSnapshotTrashReceipt): void {
  const original = resolveRelative(vaultPath, receipt.originalRelativePath);
  const trashed = resolveRelative(vaultPath, receipt.trashRelativePath);
  const operation = readOperation(vaultPath, receipt.operationId);
  if (operation) {
    if (!matchesTrashOperation(receipt, operation) || fs.existsSync(original) || !matchesRecordHash(trashed, receipt.recordHash)) throw stale();
    return;
  }
  if (fs.existsSync(trashed)) {
    if (fs.existsSync(original) || !matchesRecordHash(trashed, receipt.recordHash)) throw stale();
  } else {
    if (!matchesRecordHash(original, receipt.recordHash)) throw stale();
    ensureSafeDirectory(vaultPath, path.dirname(trashed));
    fs.renameSync(original, trashed);
    flushDirectoryWhereSupported(path.dirname(original));
    flushDirectoryWhereSupported(path.dirname(trashed));
  }
  writeOperation(vaultPath, createTrashOperation(receipt));
}

function completeRestore(vaultPath: string, receipt: AnalyticalSnapshotTrashReceipt, restoreId: string, createdAt: string): void {
  const original = resolveRelative(vaultPath, receipt.originalRelativePath);
  const trashed = resolveRelative(vaultPath, receipt.trashRelativePath);
  const trash = readOperation(vaultPath, receipt.operationId);
  const existing = readOperation(vaultPath, restoreId);
  const restore = existing ?? createRestoreOperation(receipt, trash, restoreId, createdAt);
  if (!trash || !matchesTrashOperation(receipt, trash) || !matchesRestoreOperation(receipt, restore)) throw stale();
  if (existing) {
    if (fs.existsSync(trashed) || !matchesRecordHash(original, receipt.recordHash)) throw stale();
    return;
  }
  if (fs.existsSync(original)) {
    if (fs.existsSync(trashed) || !matchesRecordHash(original, receipt.recordHash)) throw stale();
  } else {
    if (!matchesRecordHash(trashed, receipt.recordHash)) throw stale();
    ensureSafeDirectory(vaultPath, path.dirname(original));
    fs.renameSync(trashed, original);
    flushDirectoryWhereSupported(path.dirname(trashed));
    flushDirectoryWhereSupported(path.dirname(original));
  }
  writeOperation(vaultPath, restore);
}

function createTrashOperation(receipt: AnalyticalSnapshotTrashReceipt): OperationRecord {
  return OperationRecordSchema.parse({
    id: receipt.operationId,
    schemaVersion: 1,
    createdAt: receipt.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "trash_analytical_snapshot",
    targetRefs: [{ kind: "dataset", id: receipt.datasetId, path: receipt.trashRelativePath }],
    sourceRefs: [{ kind: "dataset", id: receipt.datasetId, path: receipt.originalRelativePath }, { kind: "operation", id: receipt.sourceOperationId }],
    before: { kind: "dataset_revision", id: receipt.revisionId, path: receipt.originalRelativePath },
    after: { kind: "dataset_revision", id: receipt.revisionId, path: receipt.trashRelativePath },
    summary: `Moved ${receipt.title} analytical snapshot to recoverable trash.`,
    reversible: "yes",
    warnings: []
  });
}

function createRestoreOperation(receipt: AnalyticalSnapshotTrashReceipt, trash: OperationRecord | undefined, id: string, createdAt: string): OperationRecord {
  if (!trash) throw stale();
  return OperationRecordSchema.parse({
    id,
    schemaVersion: 1,
    createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "restore_analytical_snapshot",
    targetRefs: [{ kind: "dataset", id: receipt.datasetId, path: receipt.originalRelativePath }],
    sourceRefs: [{ kind: "operation", id: trash.id }, { kind: "dataset", id: receipt.datasetId, path: receipt.trashRelativePath }],
    before: { kind: "dataset_revision", id: receipt.revisionId, path: receipt.trashRelativePath },
    after: { kind: "dataset_revision", id: receipt.revisionId, path: receipt.originalRelativePath },
    summary: `Restored ${receipt.title} analytical snapshot.`,
    reversible: "no",
    warnings: []
  });
}

function matchesTrashRequest(receipt: AnalyticalSnapshotTrashReceipt, request: CollectionAnalyticalSnapshotTrashRequest): boolean {
  return receipt.requestId === request.requestId && receipt.activeVaultId === request.activeVaultId &&
    receipt.snapshotId === request.snapshotId && receipt.expectedOperationId === request.expectedOperationId &&
    receipt.requestDigest === requestDigest(request);
}

function matchesCreateOperation(vaultPath: string, record: AnalyticalSnapshotRecord): boolean {
  const operation = readOperation(vaultPath, record.operationId);
  return Boolean(operation && operation.kind === "create_dataset_snapshot" &&
    operation.targetRefs.some((ref) => ref.kind === "dataset" && ref.id === record.snapshotId) &&
    operation.sourceRefs.some((ref) => ref.kind === "dataset" && ref.id === record.datasetId) &&
    operation.after?.kind === "dataset" && operation.after.id === record.snapshotId);
}

function matchesTrashOperation(receipt: AnalyticalSnapshotTrashReceipt, operation: OperationRecord): boolean {
  return operation.id === receipt.operationId && operation.kind === "trash_analytical_snapshot" &&
    operation.targetRefs.some((ref) => ref.kind === "dataset" && ref.id === receipt.datasetId && ref.path === receipt.trashRelativePath) &&
    operation.before?.id === receipt.revisionId && operation.before.path === receipt.originalRelativePath &&
    operation.after?.id === receipt.revisionId && operation.after.path === receipt.trashRelativePath;
}

function matchesRestoreOperation(receipt: AnalyticalSnapshotTrashReceipt, operation: OperationRecord): boolean {
  return operation.kind === "restore_analytical_snapshot" &&
    operation.sourceRefs.some((ref) => ref.kind === "operation" && ref.id === receipt.operationId) &&
    operation.targetRefs.some((ref) => ref.kind === "dataset" && ref.id === receipt.datasetId && ref.path === receipt.originalRelativePath) &&
    operation.before?.id === receipt.revisionId && operation.before.path === receipt.trashRelativePath &&
    operation.after?.id === receipt.revisionId && operation.after.path === receipt.originalRelativePath;
}

function isRestorable(vaultPath: string, receipt: AnalyticalSnapshotTrashReceipt): boolean {
  const operation = readOperation(vaultPath, receipt.operationId);
  const trashed = resolveRelative(vaultPath, receipt.trashRelativePath);
  const original = resolveRelative(vaultPath, receipt.originalRelativePath);
  return Boolean(operation && matchesTrashOperation(receipt, operation) && !readOperation(vaultPath, restoreOperationIdFor(receipt)) &&
    !fs.existsSync(original) && matchesRecordHash(trashed, receipt.recordHash));
}

function isRestored(vaultPath: string, receipt: AnalyticalSnapshotTrashReceipt): boolean {
  return !fs.existsSync(resolveRelative(vaultPath, receipt.trashRelativePath)) &&
    matchesRecordHash(resolveRelative(vaultPath, receipt.originalRelativePath), receipt.recordHash);
}

function matchesRecordHash(filePath: string, expected: string): boolean {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) return false;
    const parsed = AnalyticalSnapshotRecordSchema.safeParse(readJsonBounded(filePath, MAX_RECEIPT_BYTES));
    return parsed.success && hashCanonical(parsed.data) === expected;
  } catch {
    return false;
  }
}

function readOperation(vaultPath: string, operationId: string): OperationRecord | undefined {
  if (!OperationIdSchema.safeParse(operationId).success) return undefined;
  try {
    const parsed = OperationRecordSchema.safeParse(readJsonBounded(operationPathFor(vaultPath, operationId), MAX_RECEIPT_BYTES));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function writeOperation(vaultPath: string, operation: OperationRecord): void {
  writePrivateJsonExclusive(vaultPath, operationPathFor(vaultPath, operation.id), operation);
}

function restoreOperationIdFor(receipt: AnalyticalSnapshotTrashReceipt): string {
  return operationIdFor(receipt.createdAt, receipt.operationId, "restore", new Date(receipt.createdAt));
}

function operationIdFor(seed: string, snapshotId: string, action: string, date: Date): string {
  const dateKey = date.toISOString().slice(0, 10).replaceAll("-", "");
  return `op_${dateKey}_${hashCanonical({ action, seed, snapshotId }).slice("sha256:".length, "sha256:".length + 24)}`;
}

function toTrashSummary(receipt: AnalyticalSnapshotTrashReceipt) {
  return {
    snapshotId: receipt.snapshotId,
    datasetId: receipt.datasetId,
    revisionId: receipt.revisionId,
    tableId: receipt.tableId,
    title: receipt.title,
    tableName: receipt.tableName,
    rowCount: receipt.rowCount,
    columnCount: receipt.columnCount,
    operationId: receipt.sourceOperationId,
    createdAt: receipt.createdAt,
    trashOperationId: receipt.operationId,
    trashedAt: receipt.createdAt,
    trashRevision: trashRevision([receipt]),
    canRestore: true as const
  };
}

function trashRevision(items: readonly unknown[]): string {
  return `snapshottrashrev_${hashCanonical(items).slice("sha256:".length)}`;
}

function resolveRelative(vaultPath: string, relativePath: string): string {
  if (path.isAbsolute(relativePath) || relativePath.split("/").some((part) => !part || part === "." || part === "..")) throw stale();
  const root = path.resolve(vaultPath);
  const resolved = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, resolved);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw stale();
  return resolved;
}

function ensureSafeDirectory(vaultPath: string, directory: string): void {
  const root = path.resolve(vaultPath);
  const resolved = path.resolve(directory);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw stale();
  let current = root;
  for (const part of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw stale();
    } catch (caught) {
      if (!(caught instanceof Error && "code" in caught && caught.code === "ENOENT")) throw caught;
      fs.mkdirSync(current, { mode: 0o700 });
      flushDirectoryWhereSupported(path.dirname(current));
    }
  }
}

function writePrivateJsonExclusive(vaultPath: string, filePath: string, value: unknown): void {
  ensureSafeDirectory(vaultPath, path.dirname(filePath));
  writeJsonExclusive(filePath, value);
}

function isStale(value: unknown): boolean {
  return value instanceof PigeDomainError && value.code === "analytical_snapshot_trash.stale";
}

function stale(): PigeDomainError {
  return new PigeDomainError("analytical_snapshot_trash.stale", "The analytical snapshot lifecycle binding changed.");
}
