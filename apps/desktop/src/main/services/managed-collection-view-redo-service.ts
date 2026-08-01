import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  KnowledgeActivityRedoRequest,
  KnowledgeActivityRedoResult,
  KnowledgeActivitySummary
} from "@pige/contracts";
import {
  CollectionViewFilterSchema,
  CollectionViewSortSchema,
  OperationRecordSchema,
  ViewIdSchema,
  type OperationRecord
} from "@pige/schemas";
import { z } from "zod";
import {
  MAX_COLLECTION_JSON_BYTES,
  fileRef,
  hashCanonical,
  operationPathFor,
  readBundle,
  readJsonBounded,
  readOperationRecords,
  readRevisionById,
  resolveBundleRelativePath,
  syncFile,
  writeJsonExclusive,
  writeJsonImmutable,
  type BundleBinding,
  type FileRef
} from "./managed-collection-storage";

interface ManagedCollectionViewRedoVaultPort {
  current(): { readonly vaultId: string } | undefined;
  activeVaultPath(): string | undefined;
}

const FileRefSchema = z.object({
  path: z.string().min(1).max(1024),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  size: z.number().int().nonnegative()
}).strict();

const ViewRevisionSchema = z.object({
  schemaVersion: z.literal(1),
  viewId: ViewIdSchema,
  viewRevision: z.number().int().positive(),
  state: z.enum(["active", "trashed"]),
  action: z.enum(["create", "update", "rename", "trash", "restore"]).optional(),
  datasetId: z.string().regex(/^dataset_\d{8}_[a-z0-9]{12,}$/),
  tableId: z.string().regex(/^table_[a-z0-9]{12,}$/),
  datasetRevisionId: z.string().regex(/^dataset_rev_\d{8}_[a-z0-9]{12,}$/),
  name: z.string().trim().min(1).max(120),
  filter: CollectionViewFilterSchema.optional(),
  sort: CollectionViewSortSchema.optional(),
  requestHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  operationId: z.string().regex(/^op_\d{8}_[a-z0-9]{8,}$/),
  undoOfOperationId: z.string().regex(/^op_\d{8}_[a-z0-9]{8,}$/).optional(),
  redoOfOperationId: z.string().regex(/^op_\d{8}_[a-z0-9]{8,}$/).optional(),
  createdAt: z.string().datetime({ offset: true })
}).strict();

const ViewPointerSchema = z.object({
  schemaVersion: z.literal(1),
  viewId: ViewIdSchema,
  datasetId: z.string().regex(/^dataset_\d{8}_[a-z0-9]{12,}$/),
  tableId: z.string().regex(/^table_[a-z0-9]{12,}$/),
  activeRevision: z.number().int().positive(),
  revision: FileRefSchema,
  updatedAt: z.string().datetime({ offset: true })
}).strict();

type ViewRevision = z.infer<typeof ViewRevisionSchema>;
type ViewPointer = z.infer<typeof ViewPointerSchema>;
const VIEW_OPERATION_KINDS = new Set([
  "create_collection_view", "update_collection_view", "rename_collection_view", "trash_collection_view"
]);
const OPERATION_ID = /^op_\d{8}_[a-z0-9]{8,}$/u;
const MAX_VIEW_POINTERS = 32;

export class ManagedCollectionViewRedoService {
  readonly #vaults: ManagedCollectionViewRedoVaultPort;

  constructor(vaults: ManagedCollectionViewRedoVaultPort) {
    this.#vaults = vaults;
  }

  activityState(
    operation: OperationRecord,
    undo: OperationRecord | undefined
  ): Pick<KnowledgeActivitySummary, "canRedo" | "redoUnavailableReason"> | undefined {
    if (!undo) return undefined;
    const vaultPath = this.#vaults.activeVaultPath();
    const original = vaultPath ? readBinding(vaultPath, operation) : undefined;
    const undone = original && readBinding(vaultPath!, undo);
    if (!vaultPath || !original || !undone || undone.revision.undoOfOperationId !== operation.id ||
        undone.revision.viewId !== original.revision.viewId) return undefined;
    const redoId = createRedoOperationId(operation.id);
    const redo = readOperation(vaultPath, redoId);
    if (redo) return matchesRedoOperation(original, undone, redo)
      ? { canRedo: false, redoUnavailableReason: "already_redone" }
      : { canRedo: false, redoUnavailableReason: "content_changed" };
    const current = readCurrentView(original.bundle, original.revision.viewId);
    return current && current.revision.operationId === undo.id &&
      current.revision.viewRevision === undone.revision.viewRevision
      ? { canRedo: true }
      : { canRedo: false, redoUnavailableReason: current ? "content_changed" : "target_missing" };
  }

  redo(request: KnowledgeActivityRedoRequest): KnowledgeActivityRedoResult {
    if (!request || typeof request !== "object" || !OPERATION_ID.test(request.operationId)) {
      return { status: "not_found", operationId: request.operationId };
    }
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { status: "not_found", operationId: request.operationId };
    const operation = readOperation(vaultPath, request.operationId);
    const original = operation ? readBinding(vaultPath, operation) : undefined;
    if (!operation || !original || !VIEW_OPERATION_KINDS.has(operation.kind) || original.revision.undoOfOperationId) {
      return { status: "not_found", operationId: request.operationId };
    }
    const undo = readOperation(vaultPath, createUndoOperationId(operation.id));
    const undone = undo ? readBinding(vaultPath, undo) : undefined;
    if (!undo || !undone || undone.revision.undoOfOperationId !== operation.id ||
        undone.revision.viewId !== original.revision.viewId) {
      return { status: "stale", operationId: operation.id };
    }
    return this.#redoExact(vaultPath, original, undone, operation, undo, request.expectedRevisionId, true);
  }

  recoverIncompleteRedos(): { readonly recovered: number; readonly failed: number } {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0;
    let failed = 0;
    for (const operation of readOperationRecords(vaultPath)) {
      if (!VIEW_OPERATION_KINDS.has(operation.kind)) continue;
      const original = readBinding(vaultPath, operation);
      if (!original || original.revision.undoOfOperationId || original.revision.redoOfOperationId) continue;
      const undo = readOperation(vaultPath, createUndoOperationId(operation.id));
      const undone = undo ? readBinding(vaultPath, undo) : undefined;
      if (!undo || !undone || undone.revision.undoOfOperationId !== operation.id) continue;
      const redoPath = viewRevisionPath(original.revision.viewId, undone.revision.viewRevision + 1);
      if (!fs.existsSync(resolveBundleRelativePath(original.bundle.bundlePath, redoPath)) &&
          !readOperation(vaultPath, createRedoOperationId(operation.id))) continue;
      try {
        const result = this.#redoExact(vaultPath, original, undone, operation, undo, undefined, false);
        if (result.status === "redone" || result.status === "already_redone") recovered += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    return { recovered, failed };
  }

  #redoExact(
    vaultPath: string,
    original: ViewBinding,
    undone: ViewBinding,
    operation: OperationRecord,
    undo: OperationRecord,
    expectedRevisionId: string | undefined,
    allowStart: boolean
  ): KnowledgeActivityRedoResult {
    const current = readCurrentView(original.bundle, original.revision.viewId);
    if (!current) return { status: "not_found", operationId: operation.id };
    if (expectedRevisionId !== undefined && expectedRevisionId !== original.revision.datasetRevisionId) {
      return { status: "stale", operationId: operation.id, currentRevisionId: original.bundle.manifest.activeRevision };
    }
    if (original.bundle.manifest.activeRevision !== original.revision.datasetRevisionId) {
      return { status: "stale", operationId: operation.id, currentRevisionId: original.bundle.manifest.activeRevision };
    }
    const redoId = createRedoOperationId(operation.id);
    const existingOperation = readOperation(vaultPath, redoId);
    if (existingOperation) {
      return matchesRedoOperation(original, undone, existingOperation) && current.revision.operationId === redoId
        ? { status: "already_redone", operationId: operation.id, undoOperationId: undo.id,
          redoOperationId: redoId, revisionId: original.revision.datasetRevisionId }
        : { status: "stale", operationId: operation.id, currentRevisionId: original.bundle.manifest.activeRevision };
    }
    const nextRevisionNumber = undone.revision.viewRevision + 1;
    const relativePath = viewRevisionPath(original.revision.viewId, nextRevisionNumber);
    const revisionPath = resolveBundleRelativePath(original.bundle.bundlePath, relativePath);
    const existingRevision = fs.existsSync(revisionPath)
      ? ViewRevisionSchema.parse(readJsonBounded(revisionPath, MAX_COLLECTION_JSON_BYTES))
      : undefined;
    if (!allowStart && !existingRevision) return { status: "not_found", operationId: operation.id };
    if (current.revision.operationId !== undo.id && current.revision.operationId !== redoId) {
      return { status: "stale", operationId: operation.id, currentRevisionId: original.bundle.manifest.activeRevision };
    }
    const { undoOfOperationId: _discardUndo, redoOfOperationId: _discardRedo,
      ...originalRevision } = original.revision;
    const revision = ViewRevisionSchema.parse({
      ...originalRevision,
      viewRevision: nextRevisionNumber,
      requestHash: digest("pige:collection-view-redo-request:v1", operation.id),
      operationId: redoId,
      redoOfOperationId: operation.id,
      createdAt: existingRevision?.createdAt ?? new Date().toISOString()
    });
    if (existingRevision && hashCanonical(existingRevision) !== hashCanonical(revision)) {
      return { status: "stale", operationId: operation.id, currentRevisionId: original.bundle.manifest.activeRevision };
    }
    if (!existingRevision) writeJsonImmutable(revisionPath, revision);
    const revisionRef = fileRef(original.bundle.bundlePath, relativePath);
    const pointer = ViewPointerSchema.parse({
      ...current.pointer,
      activeRevision: revision.viewRevision,
      revision: revisionRef,
      updatedAt: revision.createdAt
    });
    if (current.revision.operationId === undo.id) replacePointer(current.path, current.bytes, pointer);
    const undoRevisionRef = fileRef(original.bundle.bundlePath,
      viewRevisionPath(undone.revision.viewId, undone.revision.viewRevision));
    const redoOperation = createRedoOperation(original.bundle, revision, revisionRef, undoRevisionRef, operation);
    const operationPath = operationPathFor(vaultPath, redoId);
    if (fs.existsSync(operationPath)) {
      const persisted = OperationRecordSchema.parse(readJsonBounded(operationPath, MAX_COLLECTION_JSON_BYTES));
      if (hashCanonical(persisted) !== hashCanonical(redoOperation)) {
        return { status: "stale", operationId: operation.id, currentRevisionId: original.bundle.manifest.activeRevision };
      }
    } else writeJsonExclusive(operationPath, redoOperation);
    const committed = readCurrentView(original.bundle, original.revision.viewId);
    if (!committed || committed.revision.operationId !== redoId ||
        committed.revision.viewRevision !== revision.viewRevision) {
      return { status: "stale", operationId: operation.id, currentRevisionId: original.bundle.manifest.activeRevision };
    }
    return { status: "redone", operationId: operation.id, undoOperationId: undo.id,
      redoOperationId: redoId, revisionId: original.revision.datasetRevisionId };
  }
}

interface ViewBinding { readonly bundle: BundleBinding; readonly revision: ViewRevision; }
interface CurrentView { readonly pointer: ViewPointer; readonly revision: ViewRevision; readonly path: string; readonly bytes: Buffer; }

function readBinding(vaultPath: string, operation: OperationRecord): ViewBinding | undefined {
  const dataset = operation.targetRefs.filter((ref) => ref.kind === "dataset");
  const table = operation.targetRefs.filter((ref) => ref.kind === "table");
  const view = operation.targetRefs.filter((ref) => ref.kind === "view");
  if (dataset.length !== 1 || table.length !== 1 || view.length !== 1 || operation.after?.kind !== "view") return undefined;
  try {
    const bundle = readBundle(vaultPath, dataset[0]!.id);
    if (!bundle || !operation.after.path?.startsWith(`${bundle.bundleRelativePath}/`)) return undefined;
    const relativePath = operation.after.path.slice(bundle.bundleRelativePath.length + 1);
    const revisionRef = fileRef(bundle.bundlePath, relativePath);
    if (revisionRef.checksum !== operation.after.checksum) return undefined;
    const revision = ViewRevisionSchema.parse(readJsonBounded(
      resolveBundleRelativePath(bundle.bundlePath, relativePath), MAX_COLLECTION_JSON_BYTES
    ));
    if (revision.operationId !== operation.id || revision.datasetId !== dataset[0]!.id ||
        revision.tableId !== table[0]!.id || revision.viewId !== view[0]!.id) return undefined;
    return { bundle, revision };
  } catch {
    return undefined;
  }
}

function readCurrentView(bundle: BundleBinding, viewId: string): CurrentView | undefined {
  const root = resolveBundleRelativePath(bundle.bundlePath, "views");
  if (!fs.existsSync(root)) return undefined;
  const names = fs.readdirSync(root).filter((name) => /^view_[a-z0-9]{12,}\.json$/u.test(name));
  if (names.length > MAX_VIEW_POINTERS || !names.includes(`${viewId}.json`)) return undefined;
  try {
    const pointerPath = path.join(root, `${viewId}.json`);
    const stat = fs.lstatSync(pointerPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
    const bytes = fs.readFileSync(pointerPath);
    if (bytes.length > MAX_COLLECTION_JSON_BYTES) return undefined;
    const pointer = ViewPointerSchema.parse(JSON.parse(bytes.toString("utf8")));
    if (pointer.viewId !== viewId || pointer.datasetId !== bundle.manifest.datasetId) return undefined;
    const revision = ViewRevisionSchema.parse(readJsonBounded(
      resolveBundleRelativePath(bundle.bundlePath, pointer.revision.path), MAX_COLLECTION_JSON_BYTES
    ));
    return revision.viewId === pointer.viewId && revision.viewRevision === pointer.activeRevision &&
      fileRef(bundle.bundlePath, pointer.revision.path).checksum === pointer.revision.checksum
      ? { pointer, revision, path: pointerPath, bytes }
      : undefined;
  } catch {
    return undefined;
  }
}

function createRedoOperation(
  bundle: BundleBinding,
  revision: ViewRevision,
  revisionRef: FileRef,
  beforeRef: FileRef,
  original: OperationRecord
): OperationRecord {
  const datasetRevision = readRevisionById(bundle, revision.datasetRevisionId);
  const datasetRevisionPath = `revisions/${datasetRevision.id}.json`;
  const viewRef = { kind: "view" as const, id: revision.viewId,
    path: `${bundle.bundleRelativePath}/${revisionRef.path}`, checksum: revisionRef.checksum };
  return OperationRecordSchema.parse({
    id: revision.operationId,
    schemaVersion: 1,
    createdAt: revision.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: original.kind,
    targetRefs: [{ kind: "dataset", id: revision.datasetId, path: bundle.bundleRelativePath },
      { kind: "table", id: revision.tableId }, viewRef],
    sourceRefs: [{ kind: "dataset_revision", id: revision.datasetRevisionId,
      path: `${bundle.bundleRelativePath}/${datasetRevisionPath}`,
      checksum: fileRef(bundle.bundlePath, datasetRevisionPath).checksum }],
    before: { kind: "view", id: revision.viewId,
      path: `${bundle.bundleRelativePath}/${beforeRef.path}`, checksum: beforeRef.checksum },
    after: viewRef,
    summary: `${revision.action ?? "update"} saved Collection view ${revision.viewId}.`,
    reversible: "yes",
    rollbackHint: "Advance this saved view through another immutable view revision.",
    warnings: []
  });
}

function matchesRedoOperation(original: ViewBinding, undone: ViewBinding, redo: OperationRecord): boolean {
  const binding = readBinding(original.bundle.vaultPath, redo);
  return !!binding && binding.revision.redoOfOperationId === original.revision.operationId &&
    binding.revision.viewId === original.revision.viewId &&
    binding.revision.viewRevision === undone.revision.viewRevision + 1;
}

function replacePointer(filePath: string, expected: Buffer, next: ViewPointer): void {
  if (!fs.readFileSync(filePath).equals(expected)) return;
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    syncFile(temporary);
    if (!fs.readFileSync(filePath).equals(expected)) return;
    fs.renameSync(temporary, filePath);
    syncFile(filePath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function createUndoOperationId(operationId: string): string {
  const date = /^op_(\d{8})_[a-z0-9]{8,}$/u.exec(operationId)?.[1];
  return date ? `op_${date}_${digest("pige:collection-view-undo:v1", operationId).slice(7, 27)}` : "";
}

function createRedoOperationId(operationId: string): string {
  const date = /^op_(\d{8})_[a-z0-9]{8,}$/u.exec(operationId)?.[1];
  return date ? `op_${date}_${digest("pige:collection-view-redo:v1", operationId).slice(7, 27)}` : "";
}

function viewRevisionPath(viewId: string, revision: number): string {
  return `views/${viewId}/revisions/${revision}.json`;
}

function readOperation(vaultPath: string, operationId: string): OperationRecord | undefined {
  if (!operationId) return undefined;
  try {
    return OperationRecordSchema.parse(readJsonBounded(operationPathFor(vaultPath, operationId), MAX_COLLECTION_JSON_BYTES));
  } catch {
    return undefined;
  }
}

function digest(domain: string, value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(`${domain}\0${value}`).digest("hex")}`;
}
