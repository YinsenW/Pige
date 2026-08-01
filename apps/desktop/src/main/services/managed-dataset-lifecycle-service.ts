import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  KnowledgeActivityRedoRequest,
  KnowledgeActivityRedoResult,
  KnowledgeActivitySummary,
  KnowledgeActivityUndoResult
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  CollectionTrashDatasetRequestSchema,
  CollectionTrashDatasetResultSchema,
  OperationRecordSchema,
  type CollectionTrashDatasetRequest,
  type CollectionTrashDatasetResult,
  type OperationRecord
} from "@pige/schemas";
import { readBundle, type BundleBinding } from "./managed-collection-storage";

interface DatasetLifecycleVaultPort {
  current(): { readonly vaultId: string } | undefined;
  activeVaultPath(): string | undefined;
}

interface DatasetTrashReceipt {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly activeVaultId: string;
  readonly datasetId: string;
  readonly revisionId: string;
  readonly title: string;
  readonly originalRelativePath: string;
  readonly trashRelativePath: string;
  readonly treeDigest: string;
  readonly operationId: string;
  readonly createdAt: string;
  readonly originalOperationId?: string;
  readonly undoOperationId?: string;
}
interface DatasetRestoreIntent { readonly schemaVersion: 1; readonly originalOperationId: string; readonly restore: OperationRecord; }

const MAX_TREE_ENTRIES = 20_000;
const MAX_TREE_BYTES = 1024 * 1024 * 1024;
const OPERATION_ID = /^op_\d{8}_[a-z0-9]{8,}$/u;

export class ManagedDatasetLifecycleService {
  readonly #vaults: DatasetLifecycleVaultPort;
  readonly #now: () => Date;
  readonly #readBundle: (vaultPath: string, datasetId: string) => BundleBinding | undefined;

  constructor(vaults: DatasetLifecycleVaultPort, now: () => Date = () => new Date(),
    readCurrentBundle: (vaultPath: string, datasetId: string) => BundleBinding | undefined = readBundle) {
    this.#vaults = vaults;
    this.#now = now;
    this.#readBundle = readCurrentBundle;
  }

  trash(request: CollectionTrashDatasetRequest): CollectionTrashDatasetResult {
    const parsed = CollectionTrashDatasetRequestSchema.parse(request);
    const identity = resultIdentity(parsed);
    const vaultPath = this.#activeVaultPath(parsed.activeVaultId);
    if (!vaultPath) return CollectionTrashDatasetResultSchema.parse({ ...identity, status: "not_found" });
    try {
      const operationId = operationIdFor(parsed.requestId, parsed.datasetId, "trash", this.#now());
      const existing = readReceipt(vaultPath, operationId);
      if (existing) {
        if (!matchesRequest(existing, parsed)) return CollectionTrashDatasetResultSchema.parse({ ...identity, status: "stale" });
        completeTrash(vaultPath, existing);
        return CollectionTrashDatasetResultSchema.parse({ ...identity, status: "committed", operationId });
      }
      const bundle = this.#readBundle(vaultPath, parsed.datasetId);
      if (!bundle) return CollectionTrashDatasetResultSchema.parse({ ...identity, status: "not_found" });
      if (bundle.manifest.activeRevision !== parsed.expectedRevisionId) {
        return CollectionTrashDatasetResultSchema.parse({ ...identity, status: "stale" });
      }
      const receipt: DatasetTrashReceipt = {
        schemaVersion: 1,
        requestId: parsed.requestId,
        activeVaultId: parsed.activeVaultId,
        datasetId: parsed.datasetId,
        revisionId: parsed.expectedRevisionId,
        title: boundedTitle(bundle.manifest.title),
        originalRelativePath: bundle.bundleRelativePath,
        trashRelativePath: path.posix.join(".pige", "trash", "datasets", operationId, "bundle"),
        treeDigest: digestTree(bundle.bundlePath),
        operationId,
        createdAt: this.#now().toISOString()
      };
      writeReceipt(vaultPath, receipt);
      const current = this.#readBundle(vaultPath, parsed.datasetId);
      if (!current || current.bundleRelativePath !== receipt.originalRelativePath ||
          current.manifest.activeRevision !== receipt.revisionId || digestTree(current.bundlePath) !== receipt.treeDigest) {
        return CollectionTrashDatasetResultSchema.parse({ ...identity, status: "stale" });
      }
      completeTrash(vaultPath, receipt);
      return CollectionTrashDatasetResultSchema.parse({ ...identity, status: "committed", operationId });
    } catch (caught) {
      const status = caught instanceof PigeDomainError && caught.code === "dataset_lifecycle.stale" ? "stale" : "failed";
      return CollectionTrashDatasetResultSchema.parse({ ...identity, status });
    }
  }

  activitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    if (operation.kind !== "trash_dataset") return undefined;
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return undefined;
    const receipt = readReceipt(vaultPath, operation.id);
    if (!receipt || !matchesTrashOperation(receipt, operation)) return undefined;
    const restore = undo && matchesRestoreOperation(receipt, operation, undo) ? undo : undefined;
    const redo = restore ? readRedoReceipt(vaultPath, operation.id) : undefined;
    const redoOperation = redo ? readOperation(vaultPath, redo.operationId) : undefined;
    const trashCurrent = treeMatches(resolveVault(vaultPath, receipt.trashRelativePath), receipt.treeDigest);
    const restoreCurrent = treeMatches(resolveVault(vaultPath, receipt.originalRelativePath), receipt.treeDigest);
    return {
      operationId: operation.id,
      kind: "trash_dataset",
      createdAt: operation.createdAt,
      targetLabel: receipt.title,
      status: restore ? "undone" : "applied",
      canUndo: !restore && trashCurrent,
      ...(!restore && !trashCurrent ? { undoUnavailableReason: "target_missing" as const } : {}),
      ...(restore ? {
        undoUnavailableReason: "already_undone" as const,
        canRedo: !redoOperation && restoreCurrent,
        ...(!redoOperation && !restoreCurrent ? { redoUnavailableReason: "content_changed" as const } : {}),
        ...(redoOperation ? { redoUnavailableReason: "already_redone" as const } : {})
      } : {})
    };
  }

  findUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    if (operation.kind !== "trash_dataset") return undefined;
    const vaultPath = this.#vaults.activeVaultPath();
    const receipt = vaultPath ? readReceipt(vaultPath, operation.id) : undefined;
    if (!receipt) return undefined;
    return operations.find((candidate) => matchesRestoreOperation(receipt, operation, candidate));
  }

  undo(operation: OperationRecord): KnowledgeActivityUndoResult {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath || operation.kind !== "trash_dataset") return { status: "not_found", operationId: operation.id };
    const receipt = readReceipt(vaultPath, operation.id);
    if (!receipt || !matchesTrashOperation(receipt, operation)) return { status: "not_found", operationId: operation.id };
    const undoId = operationIdFor(operation.id, receipt.datasetId, "restore", new Date(receipt.createdAt));
    const existing = readOperation(vaultPath, undoId);
    if (existing) {
      if (!matchesRestoreOperation(receipt, operation, existing)) return { status: "stale", operationId: operation.id };
      completeRestore(vaultPath, receipt, operation, existing);
      removeRestoreIntent(vaultPath, undoId);
      return { status: "already_undone", operationId: operation.id, undoOperationId: undoId, revisionId: receipt.revisionId };
    }
    try {
      const restore = createRestoreOperation(receipt, operation, undoId, this.#now().toISOString());
      writeRestoreIntent(vaultPath, { schemaVersion: 1, originalOperationId: operation.id, restore });
      completeRestore(vaultPath, receipt, operation, restore);
      removeRestoreIntent(vaultPath, undoId);
      return { status: "undone", operationId: operation.id, undoOperationId: undoId, revisionId: receipt.revisionId };
    } catch {
      return { status: "stale", operationId: operation.id };
    }
  }

  redo(request: KnowledgeActivityRedoRequest): KnowledgeActivityRedoResult {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { status: "not_found", operationId: request.operationId };
    const original = readOperation(vaultPath, request.operationId);
    const receipt = original ? readReceipt(vaultPath, original.id) : undefined;
    if (!original || !receipt || !matchesTrashOperation(receipt, original)) {
      return { status: "not_found", operationId: request.operationId };
    }
    const undo = this.findUndoOperation(original, readOperations(vaultPath));
    if (!undo) return { status: "stale", operationId: request.operationId };
    const existing = readRedoReceipt(vaultPath, original.id);
    try {
      const redoReceipt = existing ?? createRedoReceipt(receipt, undo, original.id, this.#now());
      if (!existing) writeReceipt(vaultPath, redoReceipt);
      completeTrash(vaultPath, redoReceipt);
      return {
        status: existing ? "already_redone" : "redone",
        operationId: original.id,
        undoOperationId: undo.id,
        redoOperationId: redoReceipt.operationId
      };
    } catch {
      return { status: "stale", operationId: request.operationId };
    }
  }

  recoverIncompleteOperations(): { readonly recovered: number; readonly failed: number } {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0;
    let failed = 0;
    for (const receipt of readReceipts(vaultPath)) {
      try {
        const operation = readOperation(vaultPath, receipt.operationId);
        if (!operation) completeTrash(vaultPath, receipt);
        else if (!matchesTrashOperation(receipt, operation)) throw stale();
        recovered += 1;
      } catch {
        failed += 1;
      }
    }
    for (const intent of readRestoreIntents(vaultPath)) {
      try {
        const receipt = readReceipt(vaultPath, intent.originalOperationId);
        const trash = receipt ? readOperation(vaultPath, receipt.operationId) : undefined;
        if (!receipt || !trash) throw stale();
        completeRestore(vaultPath, receipt, trash, intent.restore);
        removeRestoreIntent(vaultPath, intent.restore.id);
        recovered += 1;
      } catch { failed += 1; }
    }
    return { recovered, failed };
  }

  #activeVaultPath(vaultId: string): string | undefined {
    return this.#vaults.current()?.vaultId === vaultId ? this.#vaults.activeVaultPath() : undefined;
  }
}

function resultIdentity(request: CollectionTrashDatasetRequest) {
  return { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId,
    datasetId: request.datasetId, expectedRevisionId: request.expectedRevisionId };
}

function matchesRequest(receipt: DatasetTrashReceipt, request: CollectionTrashDatasetRequest): boolean {
  return receipt.requestId === request.requestId && receipt.activeVaultId === request.activeVaultId &&
    receipt.datasetId === request.datasetId && receipt.revisionId === request.expectedRevisionId;
}

function completeTrash(vaultPath: string, receipt: DatasetTrashReceipt): void {
  const source = resolveVault(vaultPath, receipt.originalRelativePath);
  const target = resolveVault(vaultPath, receipt.trashRelativePath);
  const operation = readOperation(vaultPath, receipt.operationId);
  if (operation) {
    if (!matchesTrashOperation(receipt, operation) || fs.existsSync(source) || !treeMatches(target, receipt.treeDigest)) throw stale();
    return;
  }
  if (fs.existsSync(target)) {
    if (fs.existsSync(source) || !treeMatches(target, receipt.treeDigest)) throw stale();
  } else {
    if (!treeMatches(source, receipt.treeDigest)) throw stale();
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.renameSync(source, target);
    syncDirectory(path.dirname(source));
    syncDirectory(path.dirname(target));
  }
  writeOperation(vaultPath, createTrashOperation(receipt));
}

function completeRestore(vaultPath: string, receipt: DatasetTrashReceipt, trash: OperationRecord, restore: OperationRecord): void {
  if (!matchesRestoreOperation(receipt, trash, restore)) throw stale();
  const source = resolveVault(vaultPath, receipt.trashRelativePath);
  const target = resolveVault(vaultPath, receipt.originalRelativePath);
  const existing = readOperation(vaultPath, restore.id);
  if (existing) {
    if (!matchesRestoreOperation(receipt, trash, existing) || fs.existsSync(source) || !treeMatches(target, receipt.treeDigest)) throw stale();
    return;
  }
  if (fs.existsSync(target)) {
    if (fs.existsSync(source) || !treeMatches(target, receipt.treeDigest)) throw stale();
  } else {
    if (!treeMatches(source, receipt.treeDigest)) throw stale();
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.renameSync(source, target);
    syncDirectory(path.dirname(source));
    syncDirectory(path.dirname(target));
  }
  writeOperation(vaultPath, restore);
}

function createTrashOperation(receipt: DatasetTrashReceipt): OperationRecord {
  return OperationRecordSchema.parse({ id: receipt.operationId, schemaVersion: 1, createdAt: receipt.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" }, kind: "trash_dataset",
    targetRefs: [{ kind: "dataset", id: receipt.datasetId, path: receipt.trashRelativePath }],
    sourceRefs: [{ kind: "dataset", id: receipt.datasetId, path: receipt.originalRelativePath },
      ...(receipt.originalOperationId ? [{ kind: "operation" as const, id: receipt.originalOperationId }] : []),
      ...(receipt.undoOperationId ? [{ kind: "operation" as const, id: receipt.undoOperationId }] : [])],
    before: { kind: "dataset_revision", id: receipt.revisionId, path: receipt.originalRelativePath },
    after: { kind: "dataset_revision", id: receipt.revisionId, path: receipt.trashRelativePath },
    summary: `Moved ${receipt.title} to recoverable trash.`, reversible: "yes", warnings: [] });
}

function createRestoreOperation(receipt: DatasetTrashReceipt, trash: OperationRecord, id: string, createdAt: string): OperationRecord {
  return OperationRecordSchema.parse({ id, schemaVersion: 1, createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" }, kind: "restore_dataset",
    targetRefs: [{ kind: "dataset", id: receipt.datasetId, path: receipt.originalRelativePath }],
    sourceRefs: [{ kind: "operation", id: trash.id }, { kind: "dataset", id: receipt.datasetId, path: receipt.trashRelativePath }],
    before: { kind: "dataset_revision", id: receipt.revisionId, path: receipt.trashRelativePath },
    after: { kind: "dataset_revision", id: receipt.revisionId, path: receipt.originalRelativePath },
    summary: `Restored ${receipt.title} from recoverable trash.`, reversible: "yes", warnings: [] });
}

function matchesTrashOperation(receipt: DatasetTrashReceipt, operation: OperationRecord): boolean {
  return operation.id === receipt.operationId && operation.kind === "trash_dataset" &&
    operation.targetRefs.some((ref) => ref.kind === "dataset" && ref.id === receipt.datasetId && ref.path === receipt.trashRelativePath) &&
    operation.before?.id === receipt.revisionId && operation.before.path === receipt.originalRelativePath &&
    operation.after?.id === receipt.revisionId && operation.after.path === receipt.trashRelativePath;
}

function matchesRestoreOperation(receipt: DatasetTrashReceipt, trash: OperationRecord, restore: OperationRecord): boolean {
  return matchesTrashOperation(receipt, trash) && restore.kind === "restore_dataset" &&
    restore.sourceRefs.some((ref) => ref.kind === "operation" && ref.id === trash.id) &&
    restore.targetRefs.some((ref) => ref.kind === "dataset" && ref.id === receipt.datasetId && ref.path === receipt.originalRelativePath) &&
    restore.before?.id === receipt.revisionId && restore.before.path === receipt.trashRelativePath &&
    restore.after?.id === receipt.revisionId && restore.after.path === receipt.originalRelativePath;
}

function createRedoReceipt(original: DatasetTrashReceipt, undo: OperationRecord, requestId: string, now: Date): DatasetTrashReceipt {
  const operationId = operationIdFor(requestId, original.datasetId, "redo", now);
  return { ...original, requestId, operationId, createdAt: now.toISOString(),
    trashRelativePath: path.posix.join(".pige", "trash", "datasets", operationId, "bundle"),
    originalOperationId: original.operationId, undoOperationId: undo.id };
}

function receiptRoot(vaultPath: string): string { return resolveVault(vaultPath, path.posix.join(".pige", "dataset-lifecycle")); }
function receiptPath(vaultPath: string, operationId: string): string { return path.join(receiptRoot(vaultPath), `${operationId}.json`); }
function operationPath(vaultPath: string, operationId: string): string { return resolveVault(vaultPath, path.posix.join(".pige", "operations", `${operationId}.json`)); }
function restoreIntentRoot(vaultPath: string): string { return resolveVault(vaultPath, path.posix.join(".pige", "dataset-lifecycle", "restore-intents")); }
function restoreIntentPath(vaultPath: string, operationId: string): string { return path.join(restoreIntentRoot(vaultPath), `${operationId}.json`); }

function writeReceipt(vaultPath: string, receipt: DatasetTrashReceipt): void { writeJsonExclusive(receiptPath(vaultPath, receipt.operationId), receipt); }
function readReceipt(vaultPath: string, operationId: string): DatasetTrashReceipt | undefined {
  return readJson(receiptPath(vaultPath, operationId)) as DatasetTrashReceipt | undefined;
}
function readRedoReceipt(vaultPath: string, originalOperationId: string): DatasetTrashReceipt | undefined {
  return readReceipts(vaultPath).find((receipt) => receipt.originalOperationId === originalOperationId);
}
function readReceipts(vaultPath: string): DatasetTrashReceipt[] {
  const root = receiptRoot(vaultPath);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((name) => OPERATION_ID.test(name.replace(/\.json$/u, ""))).flatMap((name) => {
    const value = readJson(path.join(root, name));
    return value && typeof value === "object" ? [value as DatasetTrashReceipt] : [];
  });
}
function writeOperation(vaultPath: string, operation: OperationRecord): void { writeJsonExclusive(operationPath(vaultPath, operation.id), operation); }
function readOperation(vaultPath: string, operationId: string): OperationRecord | undefined {
  const value = readJson(operationPath(vaultPath, operationId));
  const parsed = OperationRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
function readOperations(vaultPath: string): OperationRecord[] {
  const root = resolveVault(vaultPath, path.posix.join(".pige", "operations"));
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).flatMap((name) => {
    const value = readJson(path.join(root, name)); const parsed = OperationRecordSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}
function writeRestoreIntent(vaultPath: string, intent: DatasetRestoreIntent): void {
  const existing = readJson(restoreIntentPath(vaultPath, intent.restore.id));
  if (existing !== undefined) {
    if (JSON.stringify(existing) !== JSON.stringify(intent)) throw stale();
    return;
  }
  writeJsonExclusive(restoreIntentPath(vaultPath, intent.restore.id), intent);
}
function readRestoreIntents(vaultPath: string): DatasetRestoreIntent[] {
  const root = restoreIntentRoot(vaultPath);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((name) => name.endsWith(".json")).flatMap((name) => {
    const value = readJson(path.join(root, name)) as DatasetRestoreIntent | undefined;
    const restore = OperationRecordSchema.safeParse(value?.restore);
    return value?.schemaVersion === 1 && typeof value.originalOperationId === "string" && restore.success
      ? [{ ...value, restore: restore.data }] : [];
  });
}
function removeRestoreIntent(vaultPath: string, operationId: string): void {
  try { fs.rmSync(restoreIntentPath(vaultPath, operationId)); } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code !== "ENOENT") throw caught;
  }
}

function readJson(filePath: string): unknown {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch (caught) { if ((caught as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw caught; }
}
function writeJsonExclusive(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  syncDirectory(path.dirname(filePath));
}
function resolveVault(vaultPath: string, relativePath: string): string {
  if (path.isAbsolute(relativePath) || relativePath.split("/").some((part) => !part || part === "." || part === "..")) throw stale();
  const resolved = path.resolve(vaultPath, ...relativePath.split("/"));
  if (!resolved.startsWith(`${path.resolve(vaultPath)}${path.sep}`)) throw stale();
  return resolved;
}
function digestTree(root: string): string {
  const hash = createHash("sha256"); let entries = 0; let bytes = 0;
  const visit = (current: string, relative: string): void => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) throw stale();
    entries += 1; if (entries > MAX_TREE_ENTRIES) throw stale();
    hash.update(`${relative}\0${stat.isDirectory() ? "d" : "f"}\0${stat.mode & 0o777}\0`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current).sort()) visit(path.join(current, name), relative ? `${relative}/${name}` : name);
    } else if (stat.isFile()) {
      bytes += stat.size; if (bytes > MAX_TREE_BYTES) throw stale(); hash.update(fs.readFileSync(current));
    } else throw stale();
  };
  visit(root, ""); return `sha256:${hash.digest("hex")}`;
}
function treeMatches(root: string, digest: string): boolean { try { return fs.existsSync(root) && digestTree(root) === digest; } catch { return false; } }
function syncDirectory(directory: string): void { const descriptor = fs.openSync(directory, "r"); try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); } }
function operationIdFor(seed: string, datasetId: string, action: string, date: Date): string {
  const day = date.toISOString().slice(0, 10).replace(/-/gu, "");
  return `op_${day}_${createHash("sha256").update(`${action}\0${seed}\0${datasetId}`).digest("hex").slice(0, 24)}`;
}
function boundedTitle(value: string): string { return Array.from(value.trim()).slice(0, 120).join("") || "Dataset"; }
function stale(): PigeDomainError { return new PigeDomainError("dataset_lifecycle.stale", "The Dataset lifecycle binding changed."); }
