import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { KnowledgeActivitySummary, KnowledgeActivityUndoResult, VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  CollectionAddTableRequestSchema,
  CollectionAddTableResultSchema,
  CollectionRenameTableRequestSchema,
  CollectionRenameTableResultSchema,
  CollectionTrashTableRequestSchema,
  CollectionTrashTableResultSchema,
  DatasetManifestSchema,
  DatasetRevisionSchema,
  DatasetSchemaRecordSchema,
  OperationRecordSchema,
  type CollectionRenameTableRequest,
  type CollectionRenameTableResult,
  type CollectionAddTableRequest,
  type CollectionAddTableResult,
  type CollectionTrashTableRequest,
  type CollectionTrashTableResult,
  type DatasetSchemaRecord,
  type DatasetRevision,
  type OperationRecord
} from "@pige/schemas";
import {
  MAX_COLLECTION_JSON_BYTES,
  fileRef,
  hashCanonical,
  operationPathFor,
  publishImmutableFile,
  readAllBundles,
  readBundle,
  readCollectionSnapshot,
  readImmutableCollectionRevision,
  readJsonBounded,
  readOperationRecords,
  readRevisionById,
  replaceManifestCas,
  requestConflict,
  resolveBundleRelativePath,
  syncFile,
  validatePayloadMeta,
  writeJsonExclusive,
  writeJsonImmutable,
  type BundleBinding
} from "./managed-collection-storage";

interface VaultPort { current(): VaultSummary | undefined; activeVaultPath(): string | undefined; }
interface RenameIdentity { readonly revisionId: string; readonly operationId: string; }
interface RenameBinding { readonly bundle: BundleBinding; readonly revision: DatasetRevision; }
interface TrashIdentity { readonly revisionId: string; readonly operationId: string; }
export interface ManagedCollectionTableTrashBinding {
  readonly bundle: BundleBinding;
  readonly revision: DatasetRevision;
}
interface AddIdentity { readonly revisionId: string; readonly operationId: string; readonly tableId: string; readonly columnId: string; }
export interface ManagedCollectionTableAddBinding {
  readonly bundle: BundleBinding;
  readonly revision: DatasetRevision;
}

export class ManagedCollectionTableService {
  readonly #vaults: VaultPort;
  #tail: Promise<void> = Promise.resolve();

  constructor(vaults: VaultPort) { this.#vaults = vaults; }

  add(request: CollectionAddTableRequest): Promise<CollectionAddTableResult> {
    return this.#serialize(() => this.#add(CollectionAddTableRequestSchema.parse(request)));
  }

  rename(request: CollectionRenameTableRequest): Promise<CollectionRenameTableResult> {
    return this.#serialize(() => this.#rename(CollectionRenameTableRequestSchema.parse(request)));
  }

  trash(request: CollectionTrashTableRequest): Promise<CollectionTrashTableResult> {
    return this.#serialize(() => this.#trash(CollectionTrashTableRequestSchema.parse(request)));
  }

  activitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    if (operation.kind === "trash_collection_table") return this.trashActivitySummary(operation, undo);
    if (operation.kind === "add_collection_table") return this.addActivitySummary(operation, undo);
    const binding = this.#readActivityBinding(operation);
    if (!binding || binding.revision.change?.kind !== "collection_table_rename") return undefined;
    const change = binding.revision.change;
    const undoBinding = undo ? this.#readActivityBinding(undo) : undefined;
    if (undo && (undoBinding?.revision.change?.kind !== "collection_table_rename_undo" ||
        undoBinding.revision.change.undoOfOperationId !== operation.id)) return undefined;
    const current = readBundle(binding.bundle.vaultPath, binding.revision.datasetId);
    const currentName = current?.schema.tables.find(({ id }) => id === change.tableId)?.name;
    const changed = !undo && (!current || current.manifest.activeRevision !== binding.revision.id ||
      currentName !== change.name);
    return {
      operationId: operation.id,
      kind: "rename_collection_table",
      createdAt: operation.createdAt,
      targetLabel: boundedLabel(change.name),
      target: { kind: "collection", datasetId: binding.revision.datasetId,
        tableId: change.tableId, revisionId: undoBinding?.revision.id ?? binding.revision.id },
      status: undo ? "undone" : "applied",
      canUndo: !undo && !changed,
      ...(undo ? { undoUnavailableReason: "already_undone" as const } :
        changed ? { undoUnavailableReason: current ? "revision_changed" as const : "target_missing" as const } : {})
    };
  }

  findUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    if (operation.kind === "trash_collection_table") return this.findTrashUndoOperation(operation, operations);
    if (operation.kind === "add_collection_table") return this.findAddUndoOperation(operation, operations);
    const binding = this.#readActivityBinding(operation);
    if (!binding || binding.revision.change?.kind !== "collection_table_rename") return undefined;
    const candidate = operations.find(({ id }) => id === undoOperationId(operation.id));
    const undo = candidate ? this.#readActivityBinding(candidate) : undefined;
    return undo?.revision.change?.kind === "collection_table_rename_undo" &&
      undo.revision.change.undoOfOperationId === operation.id ? candidate : undefined;
  }

  trashActivitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    const binding = this.#readTrashActivityBinding(operation);
    if (!binding || binding.revision.change?.kind !== "collection_table_trash") return undefined;
    const change = binding.revision.change;
    const undoBinding = undo ? this.#readTrashActivityBinding(undo) : undefined;
    if (undo && (undoBinding?.revision.change?.kind !== "collection_table_trash_undo" ||
        undoBinding.revision.change.undoOfOperationId !== operation.id)) return undefined;
    const current = readBundle(binding.bundle.vaultPath, binding.revision.datasetId);
    const changed = !undo && (!current || current.manifest.activeRevision !== binding.revision.id ||
      current.schema.tables.some((table) => table.id === change.tableId));
    return {
      operationId: operation.id,
      kind: "trash_collection_table",
      createdAt: operation.createdAt,
      targetLabel: boundedLabel(change.name),
      target: { kind: "collection", datasetId: binding.revision.datasetId,
        tableId: change.tableId, revisionId: undoBinding?.revision.id ?? binding.revision.id },
      status: undo ? "undone" : "applied",
      canUndo: !undo && !changed,
      ...(undo ? { undoUnavailableReason: "already_undone" as const } :
        changed ? { undoUnavailableReason: current ? "revision_changed" as const : "target_missing" as const } : {})
    };
  }

  findTrashUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    const binding = this.#readTrashActivityBinding(operation);
    if (!binding || binding.revision.change?.kind !== "collection_table_trash") return undefined;
    const candidate = operations.find(({ id }) => id === createTableTrashUndoOperationId(operation.id));
    const undo = candidate ? this.#readTrashActivityBinding(candidate) : undefined;
    return undo?.revision.change?.kind === "collection_table_trash_undo" &&
      undo.revision.change.undoOfOperationId === operation.id ? candidate : undefined;
  }

  addActivitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    const binding = this.#readAddActivityBinding(operation);
    if (!binding || binding.revision.change?.kind !== "collection_table_add") return undefined;
    const change = binding.revision.change;
    const undoBinding = undo ? this.#readAddActivityBinding(undo) : undefined;
    if (undo && (undoBinding?.revision.change?.kind !== "collection_table_add_undo" ||
        undoBinding.revision.change.undoOfOperationId !== operation.id)) return undefined;
    const current = readBundle(binding.bundle.vaultPath, binding.revision.datasetId);
    const changed = !undo && (!current || current.manifest.activeRevision !== binding.revision.id ||
      !current.schema.tables.some((table) => table.id === change.tableId && table.name === change.name));
    return {
      operationId: operation.id, kind: "add_collection_table", createdAt: operation.createdAt,
      targetLabel: boundedLabel(change.name), target: { kind: "collection", datasetId: binding.revision.datasetId,
        tableId: change.tableId, revisionId: undoBinding?.revision.id ?? binding.revision.id },
      status: undo ? "undone" : "applied", canUndo: !undo && !changed,
      ...(undo ? { undoUnavailableReason: "already_undone" as const } :
        changed ? { undoUnavailableReason: current ? "revision_changed" as const : "target_missing" as const } : {})
    };
  }

  findAddUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    const binding = this.#readAddActivityBinding(operation);
    if (!binding || binding.revision.change?.kind !== "collection_table_add") return undefined;
    const candidate = operations.find(({ id }) => id === createTableAddUndoOperationId(operation.id));
    const undo = candidate ? this.#readAddActivityBinding(candidate) : undefined;
    return undo?.revision.change?.kind === "collection_table_add_undo" &&
      undo.revision.change.undoOfOperationId === operation.id ? candidate : undefined;
  }

  async undoTrash(operation: OperationRecord, expectedRevisionId?: string): Promise<KnowledgeActivityUndoResult> {
    const binding = this.#readTrashActivityBinding(operation);
    if (!binding || binding.revision.change?.kind !== "collection_table_trash") {
      return { status: "not_found", operationId: operation.id };
    }
    const current = readBundle(binding.bundle.vaultPath, binding.revision.datasetId);
    if (!current) return { status: "not_found", operationId: operation.id };
    const change = binding.revision.change;
    if (expectedRevisionId !== binding.revision.id || current.manifest.activeRevision !== binding.revision.id ||
        current.schema.tables.some((table) => table.id === change.tableId)) {
      return { status: "stale", operationId: operation.id, currentRevisionId: current.manifest.activeRevision };
    }
    const existing = this.findTrashUndoOperation(operation, readOperationRecords(current.vaultPath));
    if (existing) return { status: "already_undone", operationId: operation.id,
      undoOperationId: existing.id, revisionId: current.manifest.activeRevision };
    try {
      const committed = this.#commitTrashUndo(current, trashUndoIdentity(operation.id, current.revision.id), operation.id);
      return { status: "undone", operationId: operation.id, undoOperationId: committed.revision.operationId,
        revisionId: committed.revision.id };
    } catch {
      const latest = readBundle(current.vaultPath, current.manifest.datasetId);
      return { status: "stale", operationId: operation.id,
        ...(latest ? { currentRevisionId: latest.manifest.activeRevision } : {}) };
    }
  }

  async undo(operation: OperationRecord, expectedRevisionId?: string): Promise<KnowledgeActivityUndoResult> {
    if (operation.kind === "trash_collection_table") return this.undoTrash(operation, expectedRevisionId);
    if (operation.kind === "add_collection_table") return this.undoAdd(operation, expectedRevisionId);
    const binding = this.#readActivityBinding(operation);
    if (!binding || binding.revision.change?.kind !== "collection_table_rename") {
      return { status: "not_found", operationId: operation.id };
    }
    const change = binding.revision.change;
    const current = readBundle(binding.bundle.vaultPath, binding.revision.datasetId);
    if (!current) return { status: "not_found", operationId: operation.id };
    const currentName = current.schema.tables.find(({ id }) => id === change.tableId)?.name;
    if (expectedRevisionId !== binding.revision.id || current.manifest.activeRevision !== binding.revision.id ||
        currentName !== change.name) {
      return { status: "stale", operationId: operation.id, currentRevisionId: current.manifest.activeRevision };
    }
    const existing = this.findUndoOperation(operation, readOperationRecords(current.vaultPath));
    if (existing) return { status: "already_undone", operationId: operation.id,
      undoOperationId: existing.id, revisionId: current.manifest.activeRevision };
    try {
      const committed = this.#commit(current, undoIdentity(operation.id, current.revision.id),
        change.tableId, change.previousName, operation.id);
      return { status: "undone", operationId: operation.id, undoOperationId: committed.revision.operationId,
        revisionId: committed.revision.id };
    } catch {
      const latest = readBundle(current.vaultPath, current.manifest.datasetId);
      return { status: "stale", operationId: operation.id,
        ...(latest ? { currentRevisionId: latest.manifest.activeRevision } : {}) };
    }
  }

  async undoAdd(operation: OperationRecord, expectedRevisionId?: string): Promise<KnowledgeActivityUndoResult> {
    const binding = this.#readAddActivityBinding(operation);
    if (!binding || binding.revision.change?.kind !== "collection_table_add") {
      return { status: "not_found", operationId: operation.id };
    }
    const current = readBundle(binding.bundle.vaultPath, binding.revision.datasetId);
    if (!current) return { status: "not_found", operationId: operation.id };
    const change = binding.revision.change;
    if (expectedRevisionId !== binding.revision.id || current.manifest.activeRevision !== binding.revision.id ||
        !current.schema.tables.some((table) => table.id === change.tableId && table.name === change.name)) {
      return { status: "stale", operationId: operation.id, currentRevisionId: current.manifest.activeRevision };
    }
    const existing = this.findAddUndoOperation(operation, readOperationRecords(current.vaultPath));
    if (existing) return { status: "already_undone", operationId: operation.id,
      undoOperationId: existing.id, revisionId: current.manifest.activeRevision };
    try {
      const committed = this.#commitAddUndo(current, addUndoIdentity(operation.id, current.revision.id), operation.id);
      return { status: "undone", operationId: operation.id, undoOperationId: committed.revision.operationId,
        revisionId: committed.revision.id };
    } catch {
      const latest = readBundle(current.vaultPath, current.manifest.datasetId);
      return { status: "stale", operationId: operation.id,
        ...(latest ? { currentRevisionId: latest.manifest.activeRevision } : {}) };
    }
  }

  recoverIncompleteOperations(): { readonly recovered: number; readonly failed: number } {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0; let failed = 0;
    for (const bundle of readAllBundles(vaultPath)) {
      if (bundle.revision.change?.kind !== "collection_table_add" &&
          bundle.revision.change?.kind !== "collection_table_add_undo" &&
          bundle.revision.change?.kind !== "collection_table_rename" &&
          bundle.revision.change?.kind !== "collection_table_rename_undo" &&
          bundle.revision.change?.kind !== "collection_table_trash" &&
          bundle.revision.change?.kind !== "collection_table_trash_undo") continue;
      const operationPath = operationPathFor(vaultPath, bundle.revision.operationId);
      if (fs.existsSync(operationPath)) continue;
      try {
        const operation = bundle.revision.change.kind.startsWith("collection_table_trash")
          ? createTableTrashOperation(bundle, bundle.revision) : bundle.revision.change.kind.startsWith("collection_table_add")
            ? createTableAddOperation(bundle, bundle.revision) : createOperation(bundle, bundle.revision);
        writeJsonExclusive(operationPath, operation); recovered += 1;
      }
      catch { failed += 1; }
    }
    return { recovered, failed };
  }

  async #rename(request: CollectionRenameTableRequest): Promise<CollectionRenameTableResult> {
    const identity = resultIdentity(request);
    const vaultPath = this.#activeVaultPath(request.activeVaultId);
    if (!vaultPath) return CollectionRenameTableResultSchema.parse({ ...identity, status: "not_found" });
    try {
      const binding = readBundle(vaultPath, request.datasetId);
      if (!binding) return CollectionRenameTableResultSchema.parse({ ...identity, status: "not_found" });
      const mutation = mutationIdentity(request.requestId, request.expectedRevisionId);
      const replay = this.#adoptReplay(binding, request, mutation);
      if (replay) return replay;
      const snapshot = readCollectionSnapshot(binding, request.tableId);
      if (!snapshot) return CollectionRenameTableResultSchema.parse({ ...identity, status: "not_found" });
      if (binding.manifest.activeRevision !== request.expectedRevisionId) {
        return CollectionRenameTableResultSchema.parse({ ...identity, status: "stale", snapshot });
      }
      const normalized = normalizeName(request.name);
      if (normalizeName(snapshot.tableName) === normalized) {
        return CollectionRenameTableResultSchema.parse({ ...identity, status: "ineligible", snapshot });
      }
      if (binding.schema.tables.some((table) => table.id !== request.tableId && normalizeName(table.name) === normalized)) {
        return CollectionRenameTableResultSchema.parse({ ...identity, status: "duplicate", snapshot });
      }
      const committed = this.#commit(binding, mutation, request.tableId, request.name);
      const next = readCollectionSnapshot(committed.bundle, request.tableId);
      if (!next) throw commitUncertain();
      return CollectionRenameTableResultSchema.parse({ ...identity, status: "committed",
        operationId: committed.revision.operationId, snapshot: next });
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "collection.request_conflict") throw caught;
      const latest = readBundle(vaultPath, request.datasetId);
      const snapshot = latest ? readCollectionSnapshot(latest, request.tableId) : undefined;
      return CollectionRenameTableResultSchema.parse(snapshot
        ? { ...identity, status: "stale", snapshot }
        : { ...identity, status: "failed" });
    }
  }

  async #trash(request: CollectionTrashTableRequest): Promise<CollectionTrashTableResult> {
    const identity = trashResultIdentity(request);
    const vaultPath = this.#activeVaultPath(request.activeVaultId);
    if (!vaultPath) return CollectionTrashTableResultSchema.parse({ ...identity, status: "not_found" });
    try {
      const binding = readBundle(vaultPath, request.datasetId);
      if (!binding) return CollectionTrashTableResultSchema.parse({ ...identity, status: "not_found" });
      const mutation = trashIdentity(request.requestId, request.expectedRevisionId);
      const replay = this.#adoptTrashReplay(binding, request, mutation);
      if (replay) return replay;
      const snapshot = readCollectionSnapshot(binding, request.tableId);
      if (!snapshot) return CollectionTrashTableResultSchema.parse({ ...identity, status: "not_found" });
      if (binding.manifest.activeRevision !== request.expectedRevisionId) {
        return CollectionTrashTableResultSchema.parse({ ...identity, status: "stale", snapshot });
      }
      if (!snapshot.canTrashTable) {
        return CollectionTrashTableResultSchema.parse({ ...identity, status: "ineligible", snapshot });
      }
      const committed = this.#commitTrash(binding, mutation, request.tableId);
      if (committed.bundle.schema.tables.some((table) => table.id === request.tableId)) throw commitUncertain();
      return CollectionTrashTableResultSchema.parse({ ...identity, status: "committed",
        operationId: committed.revision.operationId, revisionId: committed.revision.id });
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "collection.request_conflict") throw caught;
      const latest = readBundle(vaultPath, request.datasetId);
      const snapshot = latest ? readCollectionSnapshot(latest, request.tableId) : undefined;
      return CollectionTrashTableResultSchema.parse(snapshot
        ? { ...identity, status: "stale", snapshot }
        : { ...identity, status: "failed" });
    }
  }

  async #add(request: CollectionAddTableRequest): Promise<CollectionAddTableResult> {
    const identity = addResultIdentity(request);
    const vaultPath = this.#activeVaultPath(request.activeVaultId);
    if (!vaultPath) return CollectionAddTableResultSchema.parse({ ...identity, status: "not_found" });
    try {
      const binding = readBundle(vaultPath, request.datasetId);
      if (!binding) return CollectionAddTableResultSchema.parse({ ...identity, status: "not_found" });
      const mutation = addIdentity(request.requestId, request.expectedRevisionId);
      const replay = this.#adoptAddReplay(binding, request, mutation);
      if (replay) return replay;
      if (binding.manifest.activeRevision !== request.expectedRevisionId) {
        return CollectionAddTableResultSchema.parse({ ...identity, status: "stale" });
      }
      if (binding.schema.tables.length >= 1024) {
        return CollectionAddTableResultSchema.parse({ ...identity, status: "ineligible" });
      }
      if (binding.schema.tables.some((table) => normalizeName(table.name) === normalizeName(request.name))) {
        return CollectionAddTableResultSchema.parse({ ...identity, status: "duplicate" });
      }
      const committed = this.#commitAdd(binding, mutation, request.name);
      const snapshot = readCollectionSnapshot(committed.bundle, mutation.tableId);
      if (!snapshot) throw commitUncertain();
      return CollectionAddTableResultSchema.parse({ ...identity, status: "committed", tableId: mutation.tableId,
        operationId: committed.revision.operationId, snapshot });
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "collection.request_conflict") throw caught;
      const latest = readBundle(vaultPath, request.datasetId);
      return CollectionAddTableResultSchema.parse(latest?.manifest.activeRevision !== request.expectedRevisionId
        ? { ...identity, status: "stale" } : { ...identity, status: "failed" });
    }
  }

  #adoptReplay(binding: BundleBinding, request: CollectionRenameTableRequest,
    identity: RenameIdentity): CollectionRenameTableResult | undefined {
    const revisionPath = resolveBundleRelativePath(binding.bundlePath, `revisions/${identity.revisionId}.json`);
    const operationPath = operationPathFor(binding.vaultPath, identity.operationId);
    if (!fs.existsSync(revisionPath) && !fs.existsSync(operationPath)) return undefined;
    if (!fs.existsSync(revisionPath)) throw requestConflict();
    const revision = DatasetRevisionSchema.parse(readJsonBounded(revisionPath, MAX_COLLECTION_JSON_BYTES));
    if (revision.id !== identity.revisionId || revision.operationId !== identity.operationId ||
        revision.parentRevisionId !== request.expectedRevisionId || revision.change?.kind !== "collection_table_rename" ||
        revision.change.tableId !== request.tableId || revision.change.name !== request.name) throw requestConflict();
    let current = binding;
    if (binding.manifest.activeRevision !== revision.id) {
      if (binding.manifest.activeRevision !== request.expectedRevisionId) {
        const snapshot = readCollectionSnapshot(binding, request.tableId);
        return snapshot ? CollectionRenameTableResultSchema.parse({ ...resultIdentity(request), status: "stale", snapshot }) : undefined;
      }
      replaceManifestCas(binding, nextManifest(binding, revision));
      const adopted = readBundle(binding.vaultPath, binding.manifest.datasetId);
      if (!adopted || adopted.manifest.activeRevision !== revision.id) throw commitUncertain();
      current = adopted;
    }
    const snapshot = readCollectionSnapshot(current, request.tableId);
    if (!snapshot || snapshot.tableName !== request.name) throw requestConflict();
    const expected = createOperation(current, revision);
    if (fs.existsSync(operationPath)) {
      const actual = OperationRecordSchema.parse(readJsonBounded(operationPath, MAX_COLLECTION_JSON_BYTES));
      if (hashCanonical(actual) !== hashCanonical(expected)) throw requestConflict();
    } else writeJsonExclusive(operationPath, expected);
    return CollectionRenameTableResultSchema.parse({ ...resultIdentity(request), status: "committed",
      operationId: revision.operationId, snapshot });
  }

  #adoptTrashReplay(binding: BundleBinding, request: CollectionTrashTableRequest,
    identity: TrashIdentity): CollectionTrashTableResult | undefined {
    const revisionPath = resolveBundleRelativePath(binding.bundlePath, `revisions/${identity.revisionId}.json`);
    const operationPath = operationPathFor(binding.vaultPath, identity.operationId);
    if (!fs.existsSync(revisionPath) && !fs.existsSync(operationPath)) return undefined;
    if (!fs.existsSync(revisionPath)) throw requestConflict();
    const revision = DatasetRevisionSchema.parse(readJsonBounded(revisionPath, MAX_COLLECTION_JSON_BYTES));
    if (revision.id !== identity.revisionId || revision.operationId !== identity.operationId ||
        revision.parentRevisionId !== request.expectedRevisionId || revision.change?.kind !== "collection_table_trash" ||
        revision.change.tableId !== request.tableId) throw requestConflict();
    let current = binding;
    if (binding.manifest.activeRevision !== revision.id) {
      if (binding.manifest.activeRevision !== request.expectedRevisionId) {
        const snapshot = readCollectionSnapshot(binding, request.tableId);
        return snapshot ? CollectionTrashTableResultSchema.parse({ ...trashResultIdentity(request), status: "stale", snapshot }) : undefined;
      }
      replaceManifestCas(binding, nextManifest(binding, revision));
      const adopted = readBundle(binding.vaultPath, binding.manifest.datasetId);
      if (!adopted || adopted.manifest.activeRevision !== revision.id) throw commitUncertain();
      current = adopted;
    }
    if (current.schema.tables.some((table) => table.id === request.tableId)) throw requestConflict();
    const expected = createTableTrashOperation(current, revision);
    if (fs.existsSync(operationPath)) {
      const actual = OperationRecordSchema.parse(readJsonBounded(operationPath, MAX_COLLECTION_JSON_BYTES));
      if (hashCanonical(actual) !== hashCanonical(expected)) throw requestConflict();
    } else writeJsonExclusive(operationPath, expected);
    return CollectionTrashTableResultSchema.parse({ ...trashResultIdentity(request), status: "committed",
      operationId: revision.operationId, revisionId: revision.id });
  }

  #adoptAddReplay(binding: BundleBinding, request: CollectionAddTableRequest,
    identity: AddIdentity): CollectionAddTableResult | undefined {
    const revisionPath = resolveBundleRelativePath(binding.bundlePath, `revisions/${identity.revisionId}.json`);
    const operationPath = operationPathFor(binding.vaultPath, identity.operationId);
    if (!fs.existsSync(revisionPath) && !fs.existsSync(operationPath)) return undefined;
    if (!fs.existsSync(revisionPath)) throw requestConflict();
    const revision = DatasetRevisionSchema.parse(readJsonBounded(revisionPath, MAX_COLLECTION_JSON_BYTES));
    if (revision.id !== identity.revisionId || revision.operationId !== identity.operationId ||
        revision.parentRevisionId !== request.expectedRevisionId || revision.change?.kind !== "collection_table_add" ||
        revision.change.tableId !== identity.tableId || revision.change.name !== request.name) throw requestConflict();
    let current = binding;
    if (binding.manifest.activeRevision !== revision.id) {
      if (binding.manifest.activeRevision !== request.expectedRevisionId) {
        return CollectionAddTableResultSchema.parse({ ...addResultIdentity(request), status: "stale" });
      }
      replaceManifestCas(binding, nextManifest(binding, revision));
      const adopted = readBundle(binding.vaultPath, binding.manifest.datasetId);
      if (!adopted || adopted.manifest.activeRevision !== revision.id) throw commitUncertain();
      current = adopted;
    }
    const snapshot = readCollectionSnapshot(current, identity.tableId);
    if (!snapshot || snapshot.tableName !== request.name) throw requestConflict();
    const expected = createTableAddOperation(current, revision);
    if (fs.existsSync(operationPath)) {
      const actual = OperationRecordSchema.parse(readJsonBounded(operationPath, MAX_COLLECTION_JSON_BYTES));
      if (hashCanonical(actual) !== hashCanonical(expected)) throw requestConflict();
    } else writeJsonExclusive(operationPath, expected);
    return CollectionAddTableResultSchema.parse({ ...addResultIdentity(request), status: "committed", tableId: identity.tableId,
      operationId: revision.operationId, snapshot });
  }

  #commit(binding: BundleBinding, identity: RenameIdentity, tableId: string, name: string,
    undoOfOperationId?: string): RenameBinding {
    const current = readBundle(binding.vaultPath, binding.manifest.datasetId);
    if (!current || current.manifest.activeRevision !== binding.manifest.activeRevision) throw commitUncertain();
    const table = current.schema.tables.find(({ id }) => id === tableId);
    if (!table) throw new PigeDomainError("collection.table_not_found", "The Collection table is unavailable.");
    const now = new Date().toISOString();
    const schemaPath = `schemas/${identity.revisionId}.json`;
    const payloadPath = `data/revisions/${identity.revisionId}.sqlite`;
    const revisionPath = `revisions/${identity.revisionId}.json`;
    const stagedRoot = path.join(current.bundlePath, ".staging", `${identity.revisionId}.${randomUUID()}`);
    const stagedPayload = path.join(stagedRoot, "payload.sqlite");
    const schema = DatasetSchemaRecordSchema.parse({ ...current.schema, revisionId: identity.revisionId, createdAt: now,
      tables: current.schema.tables.map((candidate) => candidate.id === tableId ? { ...candidate, name } : candidate) });
    fs.mkdirSync(stagedRoot, { recursive: true, mode: 0o700 });
    try {
      fs.copyFileSync(current.payloadPath, stagedPayload);
      rebindPayloadRevision(stagedPayload, current.manifest.datasetId, current.revision.id, identity.revisionId);
      publishImmutableFile(stagedPayload, resolveBundleRelativePath(current.bundlePath, payloadPath));
    } finally { fs.rmSync(stagedRoot, { recursive: true, force: true }); }
    writeJsonImmutable(resolveBundleRelativePath(current.bundlePath, schemaPath), schema);
    const revision = DatasetRevisionSchema.parse({ ...current.revision, id: identity.revisionId,
      parentRevisionId: current.revision.id, schema: fileRef(current.bundlePath, schemaPath),
      payload: { ...fileRef(current.bundlePath, payloadPath), format: "sqlite" }, operationId: identity.operationId,
      change: undoOfOperationId
        ? { kind: "collection_table_rename_undo", tableId, previousName: table.name, name, undoOfOperationId }
        : { kind: "collection_table_rename", tableId, previousName: table.name, name }, createdAt: now });
    writeJsonImmutable(resolveBundleRelativePath(current.bundlePath, revisionPath), revision);
    replaceManifestCas(current, nextManifest(current, revision));
    const committed = readBundle(current.vaultPath, current.manifest.datasetId);
    if (!committed || committed.manifest.activeRevision !== revision.id ||
        committed.schema.tables.find(({ id }) => id === tableId)?.name !== name) throw commitUncertain();
    writeJsonExclusive(operationPathFor(current.vaultPath, identity.operationId), createOperation(committed, revision));
    return { bundle: committed, revision };
  }

  #commitAdd(binding: BundleBinding, identity: AddIdentity, name: string): ManagedCollectionTableAddBinding {
    const current = readBundle(binding.vaultPath, binding.manifest.datasetId);
    if (!current || current.manifest.activeRevision !== binding.manifest.activeRevision ||
        current.schema.tables.length >= 1024 || current.schema.tables.some((table) => normalizeName(table.name) === normalizeName(name))) {
      throw requestConflict();
    }
    const now = new Date().toISOString();
    const table = { id: identity.tableId, name, sourceLocator: "pige:managed_table", sourceMetadata: { owner: "pige" },
      header: { mode: "absent" as const, used: false }, ordinal: current.schema.tables.length, rowCount: 0, columnCount: 1,
      columns: [{ id: identity.columnId, name: "Name", ordinal: 0, sourceType: "pige_user_nullable",
        sourceTypes: ["pige_user_nullable"], sourceMetadata: { owner: "pige" }, logicalType: "string" as const,
        nullable: true, stats: { missing: 0, empty: 0, null: 0, value: 0 } }] };
    const schemaPath = `schemas/${identity.revisionId}.json`;
    const payloadPath = `data/revisions/${identity.revisionId}.sqlite`;
    const revisionPath = `revisions/${identity.revisionId}.json`;
    const stagedRoot = path.join(current.bundlePath, ".staging", `${identity.revisionId}.${randomUUID()}`);
    const stagedPayload = path.join(stagedRoot, "payload.sqlite");
    const schema = DatasetSchemaRecordSchema.parse({ ...current.schema, revisionId: identity.revisionId, createdAt: now,
      tables: [...current.schema.tables, table] });
    fs.mkdirSync(stagedRoot, { recursive: true, mode: 0o700 });
    let stats: DatasetRevision["stats"];
    try {
      fs.copyFileSync(current.payloadPath, stagedPayload);
      stats = appendTableToPayload(stagedPayload, current.manifest.datasetId, current.revision.id, identity.revisionId, table);
      syncFile(stagedPayload);
      publishImmutableFile(stagedPayload, resolveBundleRelativePath(current.bundlePath, payloadPath));
    } finally { fs.rmSync(stagedRoot, { recursive: true, force: true }); }
    writeJsonImmutable(resolveBundleRelativePath(current.bundlePath, schemaPath), schema);
    const revision = DatasetRevisionSchema.parse({ ...current.revision, id: identity.revisionId,
      parentRevisionId: current.revision.id, schema: fileRef(current.bundlePath, schemaPath),
      payload: { ...fileRef(current.bundlePath, payloadPath), format: "sqlite" }, stats, operationId: identity.operationId,
      change: { kind: "collection_table_add", tableId: identity.tableId, name }, createdAt: now });
    writeJsonImmutable(resolveBundleRelativePath(current.bundlePath, revisionPath), revision);
    replaceManifestCas(current, nextManifest(current, revision));
    const committed = readBundle(current.vaultPath, current.manifest.datasetId);
    if (!committed || committed.manifest.activeRevision !== revision.id ||
        !committed.schema.tables.some((candidate) => candidate.id === identity.tableId && candidate.name === name)) throw commitUncertain();
    writeJsonExclusive(operationPathFor(current.vaultPath, identity.operationId), createTableAddOperation(committed, revision));
    return { bundle: committed, revision };
  }

  #commitTrash(binding: BundleBinding, identity: TrashIdentity, tableId: string): ManagedCollectionTableTrashBinding {
    const current = readBundle(binding.vaultPath, binding.manifest.datasetId);
    if (!current || current.manifest.activeRevision !== binding.manifest.activeRevision) throw commitUncertain();
    const table = current.schema.tables.find((candidate) => candidate.id === tableId);
    if (!table || !tableCanTrash(current.schema, tableId)) throw requestConflict();
    const now = new Date().toISOString();
    const schemaPath = `schemas/${identity.revisionId}.json`;
    const payloadPath = `data/revisions/${identity.revisionId}.sqlite`;
    const revisionPath = `revisions/${identity.revisionId}.json`;
    const stagedRoot = path.join(current.bundlePath, ".staging", `${identity.revisionId}.${randomUUID()}`);
    const stagedPayload = path.join(stagedRoot, "payload.sqlite");
    const schema = DatasetSchemaRecordSchema.parse({ ...current.schema, revisionId: identity.revisionId, createdAt: now,
      tables: current.schema.tables.filter((candidate) => candidate.id !== tableId) });
    fs.mkdirSync(stagedRoot, { recursive: true, mode: 0o700 });
    let stats: DatasetRevision["stats"];
    try {
      fs.copyFileSync(current.payloadPath, stagedPayload);
      stats = removeTableFromPayload(stagedPayload, current.manifest.datasetId, current.revision.id, identity.revisionId, tableId);
      syncFile(stagedPayload);
      publishImmutableFile(stagedPayload, resolveBundleRelativePath(current.bundlePath, payloadPath));
    } finally { fs.rmSync(stagedRoot, { recursive: true, force: true }); }
    writeJsonImmutable(resolveBundleRelativePath(current.bundlePath, schemaPath), schema);
    const revision = DatasetRevisionSchema.parse({ ...current.revision, id: identity.revisionId,
      parentRevisionId: current.revision.id, schema: fileRef(current.bundlePath, schemaPath),
      payload: { ...fileRef(current.bundlePath, payloadPath), format: "sqlite" }, stats, operationId: identity.operationId,
      change: { kind: "collection_table_trash", tableId, name: table.name }, createdAt: now });
    writeJsonImmutable(resolveBundleRelativePath(current.bundlePath, revisionPath), revision);
    replaceManifestCas(current, nextManifest(current, revision));
    const committed = readBundle(current.vaultPath, current.manifest.datasetId);
    if (!committed || committed.manifest.activeRevision !== revision.id ||
        committed.schema.tables.some((candidate) => candidate.id === tableId)) throw commitUncertain();
    writeJsonExclusive(operationPathFor(current.vaultPath, identity.operationId), createTableTrashOperation(committed, revision));
    return { bundle: committed, revision };
  }

  #commitTrashUndo(binding: BundleBinding, identity: TrashIdentity, undoOfOperationId: string): ManagedCollectionTableTrashBinding {
    const current = readBundle(binding.vaultPath, binding.manifest.datasetId);
    if (!current || current.manifest.activeRevision !== binding.manifest.activeRevision ||
        current.revision.change?.kind !== "collection_table_trash" || !current.revision.parentRevisionId) throw commitUncertain();
    const prior = readImmutableCollectionRevision(current, current.revision.parentRevisionId);
    const change = current.revision.change;
    const table = prior.schema.tables.find((candidate) => candidate.id === change.tableId);
    if (!table || current.schema.tables.some((candidate) => candidate.id === table.id)) throw requestConflict();
    const now = new Date().toISOString();
    const schemaPath = `schemas/${identity.revisionId}.json`;
    const payloadPath = `data/revisions/${identity.revisionId}.sqlite`;
    const revisionPath = `revisions/${identity.revisionId}.json`;
    const stagedRoot = path.join(current.bundlePath, ".staging", `${identity.revisionId}.${randomUUID()}`);
    const stagedPayload = path.join(stagedRoot, "payload.sqlite");
    const schema = DatasetSchemaRecordSchema.parse({ ...prior.schema, revisionId: identity.revisionId, createdAt: now });
    fs.mkdirSync(stagedRoot, { recursive: true, mode: 0o700 });
    try {
      fs.copyFileSync(prior.payloadPath, stagedPayload);
      rebindPayloadRevision(stagedPayload, current.manifest.datasetId, prior.revision.id, identity.revisionId);
      publishImmutableFile(stagedPayload, resolveBundleRelativePath(current.bundlePath, payloadPath));
    } finally { fs.rmSync(stagedRoot, { recursive: true, force: true }); }
    writeJsonImmutable(resolveBundleRelativePath(current.bundlePath, schemaPath), schema);
    const revision = DatasetRevisionSchema.parse({ ...prior.revision, id: identity.revisionId,
      parentRevisionId: current.revision.id, schema: fileRef(current.bundlePath, schemaPath),
      payload: { ...fileRef(current.bundlePath, payloadPath), format: "sqlite" }, operationId: identity.operationId,
      change: { kind: "collection_table_trash_undo", tableId: table.id, name: table.name, undoOfOperationId }, createdAt: now });
    writeJsonImmutable(resolveBundleRelativePath(current.bundlePath, revisionPath), revision);
    replaceManifestCas(current, nextManifest(current, revision));
    const committed = readBundle(current.vaultPath, current.manifest.datasetId);
    if (!committed || committed.manifest.activeRevision !== revision.id ||
        !committed.schema.tables.some((candidate) => candidate.id === table.id)) throw commitUncertain();
    writeJsonExclusive(operationPathFor(current.vaultPath, identity.operationId), createTableTrashOperation(committed, revision));
    return { bundle: committed, revision };
  }

  #commitAddUndo(binding: BundleBinding, identity: AddIdentity, undoOfOperationId: string): ManagedCollectionTableAddBinding {
    const current = readBundle(binding.vaultPath, binding.manifest.datasetId);
    if (!current || current.manifest.activeRevision !== binding.manifest.activeRevision ||
        current.revision.change?.kind !== "collection_table_add" || !current.revision.parentRevisionId) throw commitUncertain();
    const prior = readImmutableCollectionRevision(current, current.revision.parentRevisionId);
    const change = current.revision.change;
    if (prior.schema.tables.some((table) => table.id === change.tableId) ||
        !current.schema.tables.some((table) => table.id === change.tableId && table.name === change.name)) throw requestConflict();
    const now = new Date().toISOString();
    const schemaPath = `schemas/${identity.revisionId}.json`;
    const payloadPath = `data/revisions/${identity.revisionId}.sqlite`;
    const revisionPath = `revisions/${identity.revisionId}.json`;
    const stagedRoot = path.join(current.bundlePath, ".staging", `${identity.revisionId}.${randomUUID()}`);
    const stagedPayload = path.join(stagedRoot, "payload.sqlite");
    const schema = DatasetSchemaRecordSchema.parse({ ...prior.schema, revisionId: identity.revisionId, createdAt: now });
    fs.mkdirSync(stagedRoot, { recursive: true, mode: 0o700 });
    try {
      fs.copyFileSync(prior.payloadPath, stagedPayload);
      rebindPayloadRevision(stagedPayload, current.manifest.datasetId, prior.revision.id, identity.revisionId);
      publishImmutableFile(stagedPayload, resolveBundleRelativePath(current.bundlePath, payloadPath));
    } finally { fs.rmSync(stagedRoot, { recursive: true, force: true }); }
    writeJsonImmutable(resolveBundleRelativePath(current.bundlePath, schemaPath), schema);
    const revision = DatasetRevisionSchema.parse({ ...prior.revision, id: identity.revisionId,
      parentRevisionId: current.revision.id, schema: fileRef(current.bundlePath, schemaPath),
      payload: { ...fileRef(current.bundlePath, payloadPath), format: "sqlite" }, operationId: identity.operationId,
      change: { kind: "collection_table_add_undo", tableId: change.tableId, name: change.name, undoOfOperationId }, createdAt: now });
    writeJsonImmutable(resolveBundleRelativePath(current.bundlePath, revisionPath), revision);
    replaceManifestCas(current, nextManifest(current, revision));
    const committed = readBundle(current.vaultPath, current.manifest.datasetId);
    if (!committed || committed.manifest.activeRevision !== revision.id ||
        committed.schema.tables.some((table) => table.id === change.tableId)) throw commitUncertain();
    writeJsonExclusive(operationPathFor(current.vaultPath, identity.operationId), createTableAddOperation(committed, revision));
    return { bundle: committed, revision };
  }

  #readActivityBinding(operation: OperationRecord): RenameBinding | undefined {
    if (operation.kind !== "rename_collection_table") return undefined;
    const vaultPath = this.#vaults.activeVaultPath();
    const datasetId = operation.targetRefs.find((ref) => ref.kind === "dataset")?.id;
    if (!vaultPath || !datasetId || !operation.after?.id) return undefined;
    const bundle = readBundle(vaultPath, datasetId);
    if (!bundle) return undefined;
    try {
      const revision = readRevisionById(bundle, operation.after.id);
      return hashCanonical(createOperation(bundle, revision)) === hashCanonical(operation) ? { bundle, revision } : undefined;
    } catch { return undefined; }
  }

  #readTrashActivityBinding(operation: OperationRecord): ManagedCollectionTableTrashBinding | undefined {
    return readTableTrashActivityBinding(this.#vaults.activeVaultPath(), operation);
  }

  #readAddActivityBinding(operation: OperationRecord): ManagedCollectionTableAddBinding | undefined {
    return readTableAddActivityBinding(this.#vaults.activeVaultPath(), operation);
  }

  #activeVaultPath(vaultId: string): string | undefined {
    return this.#vaults.current()?.vaultId === vaultId ? this.#vaults.activeVaultPath() : undefined;
  }

  #serialize<T>(work: () => T | Promise<T>): Promise<T> {
    const result = this.#tail.then(work, work);
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

function rebindPayloadRevision(payloadPath: string, datasetId: string, beforeRevisionId: string, revisionId: string): void {
  const database = new DatabaseSync(payloadPath);
  try {
    database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;");
    validatePayloadMeta(database, datasetId, beforeRevisionId);
    if (database.prepare("UPDATE pige_dataset_meta SET value = ? WHERE key = 'revision_id'")
      .run(revisionId).changes !== 1) throw commitUncertain();
    const integrity = database.prepare("PRAGMA integrity_check").get() as { integrity_check?: unknown } | undefined;
    if (integrity?.integrity_check !== "ok") throw commitUncertain();
  } finally { database.close(); }
  syncFile(payloadPath);
}

function createOperation(binding: BundleBinding, revision: DatasetRevision): OperationRecord {
  const change = revision.change;
  if (!revision.parentRevisionId || (change?.kind !== "collection_table_rename" &&
      change?.kind !== "collection_table_rename_undo")) throw requestConflict();
  const before = readRevisionById(binding, revision.parentRevisionId);
  const beforePath = `revisions/${before.id}.json`; const afterPath = `revisions/${revision.id}.json`;
  const beforeRef = { kind: "dataset_revision" as const, id: before.id,
    path: `${binding.bundleRelativePath}/${beforePath}`, checksum: fileRef(binding.bundlePath, beforePath).checksum };
  const afterRef = { kind: "dataset_revision" as const, id: revision.id,
    path: `${binding.bundleRelativePath}/${afterPath}`, checksum: fileRef(binding.bundlePath, afterPath).checksum };
  return OperationRecordSchema.parse({ id: revision.operationId, schemaVersion: 1, createdAt: revision.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "rename_collection_table",
    targetRefs: [{ kind: "dataset", id: revision.datasetId, path: binding.bundleRelativePath }, afterRef],
    sourceRefs: [beforeRef, ...(change.kind === "collection_table_rename_undo"
      ? [{ kind: "operation" as const, id: change.undoOfOperationId }] : [])],
    before: beforeRef, after: afterRef, summary: `Renamed Collection table to ${boundedLabel(change.name)}.`,
    reversible: "yes", warnings: [] });
}

export function readTableTrashActivityBinding(
  vaultPath: string | undefined,
  operation: OperationRecord
): ManagedCollectionTableTrashBinding | undefined {
  if (operation.kind !== "trash_collection_table") return undefined;
  const datasetId = operation.targetRefs.find((ref) => ref.kind === "dataset")?.id;
  if (!vaultPath || !datasetId || !operation.after?.id) return undefined;
  const bundle = readBundle(vaultPath, datasetId);
  if (!bundle) return undefined;
  try {
    const revision = readRevisionById(bundle, operation.after.id);
    return hashCanonical(createTableTrashOperation(bundle, revision)) === hashCanonical(operation)
      ? { bundle, revision }
      : undefined;
  } catch {
    return undefined;
  }
}

export function createTableTrashOperation(binding: BundleBinding, revision: DatasetRevision): OperationRecord {
  const change = revision.change;
  if (!revision.parentRevisionId || (change?.kind !== "collection_table_trash" &&
      change?.kind !== "collection_table_trash_undo")) throw requestConflict();
  const before = readRevisionById(binding, revision.parentRevisionId);
  const beforePath = `revisions/${before.id}.json`; const afterPath = `revisions/${revision.id}.json`;
  const beforeRef = { kind: "dataset_revision" as const, id: before.id,
    path: `${binding.bundleRelativePath}/${beforePath}`, checksum: fileRef(binding.bundlePath, beforePath).checksum };
  const afterRef = { kind: "dataset_revision" as const, id: revision.id,
    path: `${binding.bundleRelativePath}/${afterPath}`, checksum: fileRef(binding.bundlePath, afterPath).checksum };
  const redo = readTableRedoFields(revision);
  return OperationRecordSchema.parse({ id: revision.operationId, schemaVersion: 1, createdAt: revision.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "trash_collection_table",
    targetRefs: [{ kind: "dataset", id: revision.datasetId, path: binding.bundleRelativePath }, afterRef],
    sourceRefs: [beforeRef, ...(change.kind === "collection_table_trash_undo"
      ? [{ kind: "operation" as const, id: change.undoOfOperationId }] : []),
    ...(redo ? [{ kind: "operation" as const, id: redo.redoOfOperationId },
      { kind: "operation" as const, id: redo.undoOperationId }] : [])],
    before: beforeRef, after: afterRef,
    summary: change.kind === "collection_table_trash"
      ? `Moved Collection table ${boundedLabel(change.name)} out of the current revision.`
      : `Restored Collection table ${boundedLabel(change.name)} through forward revision.`,
    reversible: "yes", warnings: [] });
}

function readTableRedoFields(
  revision: DatasetRevision
): { readonly redoOfOperationId: string; readonly undoOperationId: string } | undefined {
  const candidate = revision as DatasetRevision & {
    readonly redoOfOperationId?: unknown;
    readonly undoOperationId?: unknown;
  };
  return typeof candidate.redoOfOperationId === "string" && typeof candidate.undoOperationId === "string"
    ? { redoOfOperationId: candidate.redoOfOperationId, undoOperationId: candidate.undoOperationId }
    : undefined;
}

export function readTableAddActivityBinding(
  vaultPath: string | undefined,
  operation: OperationRecord
): ManagedCollectionTableAddBinding | undefined {
  if (operation.kind !== "add_collection_table") return undefined;
  const datasetId = operation.targetRefs.find((ref) => ref.kind === "dataset")?.id;
  if (!vaultPath || !datasetId || !operation.after?.id) return undefined;
  const bundle = readBundle(vaultPath, datasetId);
  if (!bundle) return undefined;
  try {
    const revision = readRevisionById(bundle, operation.after.id);
    return hashCanonical(createTableAddOperation(bundle, revision)) === hashCanonical(operation)
      ? { bundle, revision }
      : undefined;
  } catch {
    return undefined;
  }
}

export function createTableAddOperation(binding: BundleBinding, revision: DatasetRevision): OperationRecord {
  const change = revision.change;
  if (!revision.parentRevisionId || (change?.kind !== "collection_table_add" &&
      change?.kind !== "collection_table_add_undo")) throw requestConflict();
  const before = readRevisionById(binding, revision.parentRevisionId);
  const beforePath = `revisions/${before.id}.json`; const afterPath = `revisions/${revision.id}.json`;
  const beforeRef = { kind: "dataset_revision" as const, id: before.id,
    path: `${binding.bundleRelativePath}/${beforePath}`, checksum: fileRef(binding.bundlePath, beforePath).checksum };
  const afterRef = { kind: "dataset_revision" as const, id: revision.id,
    path: `${binding.bundleRelativePath}/${afterPath}`, checksum: fileRef(binding.bundlePath, afterPath).checksum };
  const redo = readTableRedoFields(revision);
  return OperationRecordSchema.parse({ id: revision.operationId, schemaVersion: 1, createdAt: revision.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "add_collection_table",
    targetRefs: [{ kind: "dataset", id: revision.datasetId, path: binding.bundleRelativePath }, afterRef],
    sourceRefs: [beforeRef, ...(change.kind === "collection_table_add_undo"
      ? [{ kind: "operation" as const, id: change.undoOfOperationId }] : []),
    ...(redo ? [{ kind: "operation" as const, id: redo.redoOfOperationId },
      { kind: "operation" as const, id: redo.undoOperationId }] : [])],
    before: beforeRef, after: afterRef,
    summary: change.kind === "collection_table_add"
      ? `Added Collection table ${boundedLabel(change.name)}.`
      : `Removed added Collection table ${boundedLabel(change.name)} through forward revision.`,
    reversible: "yes", warnings: [] });
}

function nextManifest(binding: BundleBinding, revision: DatasetRevision) {
  return DatasetManifestSchema.parse({ ...binding.manifest,
    initialRevision: binding.manifest.initialRevision ?? binding.manifest.activeRevision,
    activeRevision: revision.id, revision: fileRef(binding.bundlePath, `revisions/${revision.id}.json`),
    schema: revision.schema, payload: revision.payload, updatedAt: revision.createdAt });
}
function mutationIdentity(requestId: string, expectedRevisionId: string): RenameIdentity {
  const date = /^dataset_rev_(\d{8})_[a-z0-9]{12,}$/u.exec(expectedRevisionId)?.[1];
  if (!date) throw requestConflict();
  return { revisionId: `dataset_rev_${date}_${digest("pige:collection-table-title:v1", requestId).slice(0, 20)}`,
    operationId: `op_${date}_${digest("pige:collection-table-title-operation:v1", requestId).slice(0, 20)}` };
}
function trashIdentity(requestId: string, expectedRevisionId: string): TrashIdentity {
  const date = /^dataset_rev_(\d{8})_[a-z0-9]{12,}$/u.exec(expectedRevisionId)?.[1];
  if (!date) throw requestConflict();
  return { revisionId: `dataset_rev_${date}_${digest("pige:collection-table-trash:v1", requestId).slice(0, 20)}`,
    operationId: `op_${date}_${digest("pige:collection-table-trash-operation:v1", requestId).slice(0, 20)}` };
}
function addIdentity(requestId: string, expectedRevisionId: string): AddIdentity {
  const date = /^dataset_rev_(\d{8})_[a-z0-9]{12,}$/u.exec(expectedRevisionId)?.[1];
  if (!date) throw requestConflict();
  return { revisionId: `dataset_rev_${date}_${digest("pige:collection-table-add:v1", requestId).slice(0, 20)}`,
    operationId: `op_${date}_${digest("pige:collection-table-add-operation:v1", requestId).slice(0, 20)}`,
    tableId: `table_${digest("pige:collection-table-add-id:v1", requestId).slice(0, 20)}`,
    columnId: `column_${digest("pige:collection-table-add-name:v1", requestId).slice(0, 20)}` };
}
function undoIdentity(operationId: string, revisionId: string): RenameIdentity {
  const date = /^dataset_rev_(\d{8})_[a-z0-9]{12,}$/u.exec(revisionId)?.[1];
  if (!date) throw requestConflict();
  return { revisionId: `dataset_rev_${date}_${digest("pige:collection-table-title-undo:v1", operationId).slice(0, 20)}`,
    operationId: undoOperationId(operationId) };
}
function undoOperationId(operationId: string): string {
  const date = /^op_(\d{8})_[a-z0-9]{8,}$/u.exec(operationId)?.[1];
  if (!date) throw requestConflict();
  return `op_${date}_${digest("pige:collection-table-title-undo-operation:v1", operationId).slice(0, 20)}`;
}
function trashUndoIdentity(operationId: string, revisionId: string): TrashIdentity {
  const date = /^dataset_rev_(\d{8})_[a-z0-9]{12,}$/u.exec(revisionId)?.[1];
  if (!date) throw requestConflict();
  return { revisionId: `dataset_rev_${date}_${digest("pige:collection-table-trash-undo:v1", operationId).slice(0, 20)}`,
    operationId: createTableTrashUndoOperationId(operationId) };
}
export function createTableTrashUndoOperationId(operationId: string): string {
  const date = /^op_(\d{8})_[a-z0-9]{8,}$/u.exec(operationId)?.[1];
  if (!date) throw requestConflict();
  return `op_${date}_${digest("pige:collection-table-trash-undo-operation:v1", operationId).slice(0, 20)}`;
}
function addUndoIdentity(operationId: string, revisionId: string): AddIdentity {
  const date = /^dataset_rev_(\d{8})_[a-z0-9]{12,}$/u.exec(revisionId)?.[1];
  if (!date) throw requestConflict();
  return { revisionId: `dataset_rev_${date}_${digest("pige:collection-table-add-undo:v1", operationId).slice(0, 20)}`,
    operationId: createTableAddUndoOperationId(operationId), tableId: "table_undoidentity00000000", columnId: "column_undoidentity0000000" };
}
export function createTableAddUndoOperationId(operationId: string): string {
  const date = /^op_(\d{8})_[a-z0-9]{8,}$/u.exec(operationId)?.[1];
  if (!date) throw requestConflict();
  return `op_${date}_${digest("pige:collection-table-add-undo-operation:v1", operationId).slice(0, 20)}`;
}
function resultIdentity(request: CollectionRenameTableRequest) { return { apiVersion: 1 as const,
  requestId: request.requestId, activeVaultId: request.activeVaultId, datasetId: request.datasetId,
  tableId: request.tableId, name: request.name }; }
function trashResultIdentity(request: CollectionTrashTableRequest) { return { apiVersion: 1 as const,
  requestId: request.requestId, activeVaultId: request.activeVaultId, datasetId: request.datasetId,
  tableId: request.tableId }; }
function digest(domain: string, value: string): string { return createHash("sha256").update(`${domain}\0${value}`).digest("hex"); }
function normalizeName(value: string): string { return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US"); }
function boundedLabel(value: string): string { return Array.from(value.trim()).slice(0, 120).join("") || "Table"; }
function commitUncertain(): PigeDomainError { return new PigeDomainError("collection.commit_uncertain", "The Collection table mutation could not be verified."); }

function tableCanTrash(schema: DatasetSchemaRecord, tableId: string): boolean {
  return schema.tables.length > 1 && schema.tables.some((table) => table.id === tableId) &&
    !schema.tables.some((table) => table.id !== tableId &&
      table.columns.some((column) => column.relation?.targetTableId === tableId));
}
function addResultIdentity(request: CollectionAddTableRequest) { return { apiVersion: 1 as const,
  requestId: request.requestId, activeVaultId: request.activeVaultId, datasetId: request.datasetId, name: request.name }; }

function removeTableFromPayload(
  payloadPath: string, datasetId: string, beforeRevisionId: string, revisionId: string, tableId: string
): DatasetRevision["stats"] {
  const database = new DatabaseSync(payloadPath);
  try {
    database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    validatePayloadMeta(database, datasetId, beforeRevisionId);
    database.exec("BEGIN IMMEDIATE;");
    try {
      const table = database.prepare("SELECT table_id FROM pige_dataset_tables WHERE table_id = ?").get(tableId) as { table_id?: unknown } | undefined;
      if (table?.table_id !== tableId) throw requestConflict();
      database.prepare("DELETE FROM pige_dataset_cells WHERE row_id IN (SELECT row_id FROM pige_dataset_rows WHERE table_id = ?)").run(tableId);
      database.prepare("DELETE FROM pige_dataset_rows WHERE table_id = ?").run(tableId);
      database.prepare("DELETE FROM pige_dataset_columns WHERE table_id = ?").run(tableId);
      if (database.prepare("DELETE FROM pige_dataset_tables WHERE table_id = ?").run(tableId).changes !== 1) throw requestConflict();
      if (database.prepare("UPDATE pige_dataset_meta SET value = ? WHERE key = 'revision_id'").run(revisionId).changes !== 1) throw commitUncertain();
      database.exec("COMMIT;");
    } catch (caught) { database.exec("ROLLBACK;"); throw caught; }
    const integrity = database.prepare("PRAGMA integrity_check").get() as { integrity_check?: unknown } | undefined;
    if (integrity?.integrity_check !== "ok") throw commitUncertain();
    const counts = database.prepare(`SELECT
      (SELECT COUNT(*) FROM pige_dataset_tables) AS table_count,
      (SELECT COUNT(*) FROM pige_dataset_rows) AS row_count,
      (SELECT COUNT(*) FROM pige_dataset_columns) AS column_count,
      (SELECT COUNT(*) FROM pige_dataset_cells) AS cell_count,
      (SELECT COALESCE(SUM(length(COALESCE(lexical_raw, ''))), 0) FROM pige_dataset_cells) AS retained_value_bytes`).get() as Record<string, unknown>;
    const values = ["table_count", "row_count", "column_count", "cell_count", "retained_value_bytes"].map((key) => counts[key]);
    if (!values.every((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) throw commitUncertain();
    return { tableCount: values[0] as number, rowCount: values[1] as number, columnCount: values[2] as number,
      cellCount: values[3] as number, retainedValueBytes: values[4] as number };
  } finally { database.close(); }
}

function appendTableToPayload(
  payloadPath: string, datasetId: string, beforeRevisionId: string, revisionId: string,
  table: DatasetSchemaRecord["tables"][number]
): DatasetRevision["stats"] {
  const database = new DatabaseSync(payloadPath);
  try {
    database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    validatePayloadMeta(database, datasetId, beforeRevisionId);
    database.exec("BEGIN IMMEDIATE;");
    try {
      const column = table.columns[0];
      if (!column || table.columns.length !== 1) throw requestConflict();
      database.prepare("INSERT INTO pige_dataset_tables VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
        table.id, table.ordinal, table.name, table.sourceLocator, JSON.stringify(table.sourceMetadata ?? {}),
        JSON.stringify(table.header ?? { mode: "absent", used: false }), 0, 1
      );
      database.prepare("INSERT INTO pige_dataset_columns VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        column.id, table.id, column.ordinal, column.name, column.logicalType,
        JSON.stringify(column.sourceTypes ?? [column.sourceType]), JSON.stringify(column.stats ?? { missing: 0, empty: 0, null: 0, value: 0 })
      );
      if (database.prepare("UPDATE pige_dataset_meta SET value = ? WHERE key = 'revision_id'").run(revisionId).changes !== 1) throw commitUncertain();
      database.exec("COMMIT;");
    } catch (caught) { database.exec("ROLLBACK;"); throw caught; }
    const integrity = database.prepare("PRAGMA integrity_check").get() as { integrity_check?: unknown } | undefined;
    if (integrity?.integrity_check !== "ok") throw commitUncertain();
    const counts = database.prepare(`SELECT
      (SELECT COUNT(*) FROM pige_dataset_tables) AS table_count,
      (SELECT COUNT(*) FROM pige_dataset_rows) AS row_count,
      (SELECT COUNT(*) FROM pige_dataset_columns) AS column_count,
      (SELECT COUNT(*) FROM pige_dataset_cells) AS cell_count,
      (SELECT COALESCE(SUM(length(COALESCE(lexical_raw, ''))), 0) FROM pige_dataset_cells) AS retained_value_bytes`).get() as Record<string, unknown>;
    const values = ["table_count", "row_count", "column_count", "cell_count", "retained_value_bytes"].map((key) => counts[key]);
    if (!values.every((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) throw commitUncertain();
    return { tableCount: values[0] as number, rowCount: values[1] as number, columnCount: values[2] as number,
      cellCount: values[3] as number, retainedValueBytes: values[4] as number };
  } finally { database.close(); }
}
