import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { KnowledgeActivitySummary, KnowledgeActivityUndoResult, VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  CollectionListRevisionHistoryRequestSchema,
  CollectionListRevisionHistoryResultSchema,
  CollectionOpenRevisionHistoryRequestSchema,
  CollectionOpenRevisionHistoryResultSchema,
  CollectionRestoreRevisionHistoryRequestSchema,
  CollectionRestoreRevisionHistoryResultSchema,
  CollectionSnapshotSchema,
  DatasetManifestSchema,
  DatasetRevisionSchema,
  DatasetSchemaRecordSchema,
  OperationRecordSchema,
  type CollectionListRevisionHistoryRequest,
  type CollectionListRevisionHistoryResult,
  type CollectionOpenRevisionHistoryRequest,
  type CollectionOpenRevisionHistoryResult,
  type CollectionRestoreRevisionHistoryRequest,
  type CollectionRestoreRevisionHistoryResult,
  type CollectionRevisionHistorySummary,
  type CollectionSnapshot,
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
interface RestoreIdentity { readonly revisionId: string; readonly operationId: string; }
interface RestoreBinding { readonly bundle: BundleBinding; readonly revision: DatasetRevision; }
const MAX_HISTORY_REVISIONS = 10_000;

export class ManagedCollectionRevisionHistoryService {
  readonly #vaults: VaultPort;
  #tail: Promise<void> = Promise.resolve();

  constructor(vaults: VaultPort) { this.#vaults = vaults; }

  list(request: CollectionListRevisionHistoryRequest): CollectionListRevisionHistoryResult {
    const parsed = CollectionListRevisionHistoryRequestSchema.parse(request);
    const identity = listIdentity(parsed);
    const vaultPath = this.#activeVaultPath(parsed.activeVaultId);
    if (!vaultPath) return CollectionListRevisionHistoryResultSchema.parse({ ...identity, status: "not_found" });
    try {
      const bundle = readBundle(vaultPath, parsed.datasetId);
      if (!bundle) return CollectionListRevisionHistoryResultSchema.parse({ ...identity, status: "not_found" });
      if (bundle.manifest.activeRevision !== parsed.expectedCurrentRevisionId) {
        return CollectionListRevisionHistoryResultSchema.parse({ ...identity, status: "stale",
          currentRevisionId: bundle.manifest.activeRevision });
      }
      const revisions = reachableRevisions(bundle);
      const start = parsed.cursor ? cursorIndex(parsed.cursor, parsed, revisions) : 0;
      if (start === undefined) return CollectionListRevisionHistoryResultSchema.parse({ ...identity, status: "stale",
        currentRevisionId: bundle.manifest.activeRevision });
      const page = revisions.slice(start, start + parsed.limit);
      const hasMore = start + page.length < revisions.length;
      const nextCursor = hasMore ? historyCursor(parsed.activeVaultId, parsed.datasetId,
        parsed.expectedCurrentRevisionId, revisions[start + page.length]!.id) : undefined;
      return CollectionListRevisionHistoryResultSchema.parse({ ...identity, status: "ready",
        currentRevisionId: bundle.manifest.activeRevision,
        revisions: page.map((revision, index) => summarizeRevision(revision, start + index === 0)),
        hasMore, ...(nextCursor ? { nextCursor } : {}) });
    } catch {
      return CollectionListRevisionHistoryResultSchema.parse({ ...identity, status: "failed" });
    }
  }

  open(request: CollectionOpenRevisionHistoryRequest): CollectionOpenRevisionHistoryResult {
    const parsed = CollectionOpenRevisionHistoryRequestSchema.parse(request);
    const identity = openIdentity(parsed);
    const vaultPath = this.#activeVaultPath(parsed.activeVaultId);
    if (!vaultPath) return CollectionOpenRevisionHistoryResultSchema.parse({ ...identity, status: "not_found" });
    try {
      const bundle = readBundle(vaultPath, parsed.datasetId);
      if (!bundle) return CollectionOpenRevisionHistoryResultSchema.parse({ ...identity, status: "not_found" });
      if (bundle.manifest.activeRevision !== parsed.expectedCurrentRevisionId) {
        return CollectionOpenRevisionHistoryResultSchema.parse({ ...identity, status: "stale",
          currentRevisionId: bundle.manifest.activeRevision });
      }
      if (!reachableRevisions(bundle).some(({ id }) => id === parsed.revisionId)) {
        return CollectionOpenRevisionHistoryResultSchema.parse({ ...identity, status: "not_found" });
      }
      const historical = readImmutableCollectionRevision(bundle, parsed.revisionId);
      const snapshot = readCollectionSnapshot(historical, parsed.tableId);
      if (!snapshot) return CollectionOpenRevisionHistoryResultSchema.parse({ ...identity, status: "not_found" });
      return CollectionOpenRevisionHistoryResultSchema.parse({ ...identity, status: "ready",
        currentRevisionId: bundle.manifest.activeRevision, snapshot: readOnlySnapshot(snapshot), readOnly: true });
    } catch {
      return CollectionOpenRevisionHistoryResultSchema.parse({ ...identity, status: "failed" });
    }
  }

  restore(request: CollectionRestoreRevisionHistoryRequest): Promise<CollectionRestoreRevisionHistoryResult> {
    return this.#serialize(() => this.#restore(CollectionRestoreRevisionHistoryRequestSchema.parse(request)));
  }

  activitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    const binding = this.#readActivityBinding(operation);
    if (!binding || binding.revision.change?.kind !== "collection_revision_restore") return undefined;
    const change = binding.revision.change;
    const undoBinding = undo ? this.#readActivityBinding(undo) : undefined;
    if (undo && (undoBinding?.revision.change?.kind !== "collection_revision_restore_undo" ||
        undoBinding.revision.change.undoOfOperationId !== operation.id)) return undefined;
    const current = readBundle(binding.bundle.vaultPath, binding.revision.datasetId);
    const changed = !undo && (!current || current.manifest.activeRevision !== binding.revision.id);
    return {
      operationId: operation.id, kind: "restore_collection_revision", createdAt: operation.createdAt,
      targetLabel: boundedLabel(binding.bundle.manifest.title),
      target: { kind: "collection", datasetId: binding.revision.datasetId, tableId: change.tableId,
        revisionId: undoBinding?.revision.id ?? binding.revision.id },
      status: undo ? "undone" : "applied", canUndo: !undo && !changed,
      ...(undo ? { undoUnavailableReason: "already_undone" as const } :
        changed ? { undoUnavailableReason: current ? "revision_changed" as const : "target_missing" as const } : {})
    };
  }

  findUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    const binding = this.#readActivityBinding(operation);
    if (!binding || binding.revision.change?.kind !== "collection_revision_restore") return undefined;
    const candidate = operations.find(({ id }) => id === undoOperationId(operation.id));
    const undo = candidate ? this.#readActivityBinding(candidate) : undefined;
    return undo?.revision.change?.kind === "collection_revision_restore_undo" &&
      undo.revision.change.undoOfOperationId === operation.id ? candidate : undefined;
  }

  async undo(operation: OperationRecord, expectedRevisionId?: string): Promise<KnowledgeActivityUndoResult> {
    const binding = this.#readActivityBinding(operation);
    if (!binding || binding.revision.change?.kind !== "collection_revision_restore" || !binding.revision.parentRevisionId) {
      return { status: "not_found", operationId: operation.id };
    }
    const current = readBundle(binding.bundle.vaultPath, binding.revision.datasetId);
    if (!current) return { status: "not_found", operationId: operation.id };
    if (expectedRevisionId !== binding.revision.id || current.manifest.activeRevision !== binding.revision.id) {
      return { status: "stale", operationId: operation.id, currentRevisionId: current.manifest.activeRevision };
    }
    const existing = this.findUndoOperation(operation, readOperationRecords(current.vaultPath));
    if (existing) return { status: "already_undone", operationId: operation.id,
      undoOperationId: existing.id, revisionId: current.manifest.activeRevision };
    try {
      const committed = this.#commit(current, undoIdentity(operation.id, current.revision.id),
        binding.revision.parentRevisionId, binding.revision.change.tableId, operation.id);
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
      if (bundle.revision.change?.kind !== "collection_revision_restore" &&
          bundle.revision.change?.kind !== "collection_revision_restore_undo") continue;
      const operationPath = operationPathFor(vaultPath, bundle.revision.operationId);
      if (fs.existsSync(operationPath)) continue;
      try { writeJsonExclusive(operationPath, createOperation(bundle, bundle.revision)); recovered += 1; }
      catch { failed += 1; }
    }
    return { recovered, failed };
  }

  async #restore(request: CollectionRestoreRevisionHistoryRequest): Promise<CollectionRestoreRevisionHistoryResult> {
    const identity = restoreResultIdentity(request);
    const vaultPath = this.#activeVaultPath(request.activeVaultId);
    if (!vaultPath) return CollectionRestoreRevisionHistoryResultSchema.parse({ ...identity, status: "not_found" });
    try {
      const binding = readBundle(vaultPath, request.datasetId);
      if (!binding) return CollectionRestoreRevisionHistoryResultSchema.parse({ ...identity, status: "not_found" });
      const mutation = restoreIdentity(request.requestId, request.expectedCurrentRevisionId);
      const replay = this.#adoptReplay(binding, request, mutation);
      if (replay) return replay;
      const currentSnapshot = readCollectionSnapshot(binding, request.tableId);
      if (!currentSnapshot) return CollectionRestoreRevisionHistoryResultSchema.parse({ ...identity, status: "not_found" });
      if (binding.manifest.activeRevision !== request.expectedCurrentRevisionId) {
        return CollectionRestoreRevisionHistoryResultSchema.parse({ ...identity, status: "stale", currentRevisionId:
          binding.manifest.activeRevision, snapshot: currentSnapshot });
      }
      if (request.revisionId === binding.manifest.activeRevision) {
        return CollectionRestoreRevisionHistoryResultSchema.parse({ ...identity, status: "ineligible" });
      }
      if (!reachableRevisions(binding).some(({ id }) => id === request.revisionId)) {
        return CollectionRestoreRevisionHistoryResultSchema.parse({ ...identity, status: "not_found" });
      }
      const target = readImmutableCollectionRevision(binding, request.revisionId);
      if (!readCollectionSnapshot(target, request.tableId)) {
        return CollectionRestoreRevisionHistoryResultSchema.parse({ ...identity, status: "not_found" });
      }
      const committed = this.#commit(binding, mutation, request.revisionId, request.tableId);
      const snapshot = readCollectionSnapshot(committed.bundle, request.tableId);
      if (!snapshot) throw commitUncertain();
      return CollectionRestoreRevisionHistoryResultSchema.parse({ ...identity, status: "committed",
        operationId: committed.revision.operationId, newRevisionId: committed.revision.id, snapshot });
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "collection.request_conflict") throw caught;
      const latest = readBundle(vaultPath, request.datasetId);
      const snapshot = latest ? readCollectionSnapshot(latest, request.tableId) : undefined;
      return CollectionRestoreRevisionHistoryResultSchema.parse(snapshot
        ? { ...identity, status: "stale", currentRevisionId: latest!.manifest.activeRevision, snapshot }
        : { ...identity, status: "failed" });
    }
  }

  #adoptReplay(binding: BundleBinding, request: CollectionRestoreRevisionHistoryRequest,
    identity: RestoreIdentity): CollectionRestoreRevisionHistoryResult | undefined {
    const revisionPath = resolveBundleRelativePath(binding.bundlePath, `revisions/${identity.revisionId}.json`);
    const operationPath = operationPathFor(binding.vaultPath, identity.operationId);
    if (!fs.existsSync(revisionPath) && !fs.existsSync(operationPath)) return undefined;
    if (!fs.existsSync(revisionPath)) throw requestConflict();
    const revision = DatasetRevisionSchema.parse(readJsonBounded(revisionPath, MAX_COLLECTION_JSON_BYTES));
    if (revision.id !== identity.revisionId || revision.operationId !== identity.operationId ||
        revision.parentRevisionId !== request.expectedCurrentRevisionId ||
        revision.change?.kind !== "collection_revision_restore" || revision.change.tableId !== request.tableId ||
        revision.change.restoredRevisionId !== request.revisionId) throw requestConflict();
    let current = binding;
    if (binding.manifest.activeRevision !== revision.id) {
      if (binding.manifest.activeRevision !== request.expectedCurrentRevisionId) {
        const snapshot = readCollectionSnapshot(binding, request.tableId);
        return snapshot ? CollectionRestoreRevisionHistoryResultSchema.parse({ ...restoreResultIdentity(request),
          status: "stale", currentRevisionId: binding.manifest.activeRevision, snapshot }) : undefined;
      }
      replaceManifestCas(binding, nextManifest(binding, revision));
      const adopted = readBundle(binding.vaultPath, binding.manifest.datasetId);
      if (!adopted || adopted.manifest.activeRevision !== revision.id) throw commitUncertain();
      current = adopted;
    }
    const snapshot = readCollectionSnapshot(current, request.tableId);
    if (!snapshot) throw requestConflict();
    const expected = createOperation(current, revision);
    if (fs.existsSync(operationPath)) {
      const actual = OperationRecordSchema.parse(readJsonBounded(operationPath, MAX_COLLECTION_JSON_BYTES));
      if (hashCanonical(actual) !== hashCanonical(expected)) throw requestConflict();
    } else writeJsonExclusive(operationPath, expected);
    return CollectionRestoreRevisionHistoryResultSchema.parse({ ...restoreResultIdentity(request), status: "committed",
      operationId: revision.operationId, newRevisionId: revision.id, snapshot });
  }

  #commit(binding: BundleBinding, identity: RestoreIdentity, restoredRevisionId: string, tableId: string,
    undoOfOperationId?: string): RestoreBinding {
    const current = readBundle(binding.vaultPath, binding.manifest.datasetId);
    if (!current || current.manifest.activeRevision !== binding.manifest.activeRevision) throw commitUncertain();
    const restored = readImmutableCollectionRevision(current, restoredRevisionId);
    if (!readCollectionSnapshot(restored, tableId)) throw requestConflict();
    const now = new Date().toISOString();
    const schemaPath = `schemas/${identity.revisionId}.json`;
    const payloadPath = `data/revisions/${identity.revisionId}.sqlite`;
    const revisionPath = `revisions/${identity.revisionId}.json`;
    const stagedRoot = path.join(current.bundlePath, ".staging", `${identity.revisionId}.${randomUUID()}`);
    const stagedPayload = path.join(stagedRoot, "payload.sqlite");
    const schema = DatasetSchemaRecordSchema.parse({ ...restored.schema, revisionId: identity.revisionId, createdAt: now });
    fs.mkdirSync(stagedRoot, { recursive: true, mode: 0o700 });
    try {
      fs.copyFileSync(restored.payloadPath, stagedPayload);
      rebindPayloadRevision(stagedPayload, current.manifest.datasetId, restored.revision.id, identity.revisionId);
      publishImmutableFile(stagedPayload, resolveBundleRelativePath(current.bundlePath, payloadPath));
    } finally { fs.rmSync(stagedRoot, { recursive: true, force: true }); }
    writeJsonImmutable(resolveBundleRelativePath(current.bundlePath, schemaPath), schema);
    const revision = DatasetRevisionSchema.parse({ ...restored.revision, id: identity.revisionId,
      parentRevisionId: current.revision.id, schema: fileRef(current.bundlePath, schemaPath),
      payload: { ...fileRef(current.bundlePath, payloadPath), format: "sqlite" }, operationId: identity.operationId,
      change: undoOfOperationId
        ? { kind: "collection_revision_restore_undo", tableId, restoredRevisionId, undoOfOperationId }
        : { kind: "collection_revision_restore", tableId, restoredRevisionId }, createdAt: now });
    writeJsonImmutable(resolveBundleRelativePath(current.bundlePath, revisionPath), revision);
    replaceManifestCas(current, nextManifest(current, revision));
    const committed = readBundle(current.vaultPath, current.manifest.datasetId);
    if (!committed || committed.manifest.activeRevision !== revision.id) throw commitUncertain();
    writeJsonExclusive(operationPathFor(current.vaultPath, identity.operationId), createOperation(committed, revision));
    return { bundle: committed, revision };
  }

  #readActivityBinding(operation: OperationRecord): RestoreBinding | undefined {
    if (operation.kind !== "restore_collection_revision") return undefined;
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

  #activeVaultPath(vaultId: string): string | undefined {
    return this.#vaults.current()?.vaultId === vaultId ? this.#vaults.activeVaultPath() : undefined;
  }

  #serialize<T>(work: () => T | Promise<T>): Promise<T> {
    const result = this.#tail.then(work, work);
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

function reachableRevisions(binding: BundleBinding): DatasetRevision[] {
  const revisions: DatasetRevision[] = [];
  const seen = new Set<string>();
  let revision: DatasetRevision | undefined = binding.revision;
  while (revision) {
    if (seen.has(revision.id) || revisions.length >= MAX_HISTORY_REVISIONS) throw requestConflict();
    seen.add(revision.id); revisions.push(revision);
    revision = revision.parentRevisionId ? readRevisionById(binding, revision.parentRevisionId) : undefined;
  }
  return revisions;
}

function summarizeRevision(revision: DatasetRevision, isCurrent: boolean): CollectionRevisionHistorySummary {
  const kind = revision.change?.kind;
  const category: CollectionRevisionHistorySummary["category"] = !kind || kind === "initial_import" ? "import" :
    kind.endsWith("_undo") ? "undo" : kind === "collection_revision_restore" ? "restore" :
      ["collection_cell_edit", "collection_row_add", "collection_row_trash", "collection_relation_cell_update"]
        .some((prefix) => kind.startsWith(prefix)) ? "data" : "schema";
  return { revisionId: revision.id, parentRevisionId: revision.parentRevisionId ?? null,
    operationId: revision.operationId, createdAt: revision.createdAt, category,
    rowCount: revision.stats.rowCount, columnCount: revision.stats.columnCount, isCurrent };
}

function readOnlySnapshot(snapshot: CollectionSnapshot): CollectionSnapshot {
  return CollectionSnapshotSchema.parse({ ...snapshot,
    columns: snapshot.columns.map((column) => ({ ...column, canRename: false, canTrash: false,
      canUseAsFormulaOperand: false, canEditFormula: false, canUseAsRelationDisplay: false,
      canEditRelationDefinition: false, canEditRelation: false, canUseAsLookupTarget: false,
      canEditLookup: false, canUseAsRollupTarget: false, canEditRollup: false })),
    rows: snapshot.rows.map((row) => ({ ...row, canTrash: false,
      cells: row.cells.map((cell) => ({ ...cell, editable: false })) })),
    canAppendDefaultRow: false, canAddColumn: false, canAddFormulaColumn: false,
    canAddRelationColumn: false, canAddLookupColumn: false, canAddRollupColumn: false,
    views: snapshot.views.map((view) => ({ ...view, canEdit: false, canRename: false, canTrash: false }))
  });
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
  if (!revision.parentRevisionId || (change?.kind !== "collection_revision_restore" &&
      change?.kind !== "collection_revision_restore_undo")) throw requestConflict();
  const before = readRevisionById(binding, revision.parentRevisionId);
  const beforePath = `revisions/${before.id}.json`; const afterPath = `revisions/${revision.id}.json`;
  const beforeRef = { kind: "dataset_revision" as const, id: before.id,
    path: `${binding.bundleRelativePath}/${beforePath}`, checksum: fileRef(binding.bundlePath, beforePath).checksum };
  const afterRef = { kind: "dataset_revision" as const, id: revision.id,
    path: `${binding.bundleRelativePath}/${afterPath}`, checksum: fileRef(binding.bundlePath, afterPath).checksum };
  const restoredPath = `revisions/${change.restoredRevisionId}.json`;
  const restoredRef = { kind: "dataset_revision" as const, id: change.restoredRevisionId,
    path: `${binding.bundleRelativePath}/${restoredPath}`, checksum: fileRef(binding.bundlePath, restoredPath).checksum };
  return OperationRecordSchema.parse({ id: revision.operationId, schemaVersion: 1, createdAt: revision.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "restore_collection_revision",
    targetRefs: [{ kind: "dataset", id: revision.datasetId, path: binding.bundleRelativePath }, afterRef],
    sourceRefs: [beforeRef, ...(restoredRef.id === beforeRef.id ? [] : [restoredRef]), ...(change.kind === "collection_revision_restore_undo"
      ? [{ kind: "operation" as const, id: change.undoOfOperationId }] : [])],
    before: beforeRef, after: afterRef, summary: "Restored a prior Collection revision as a new revision.",
    reversible: "yes", warnings: [] });
}

function nextManifest(binding: BundleBinding, revision: DatasetRevision) {
  return DatasetManifestSchema.parse({ ...binding.manifest,
    initialRevision: binding.manifest.initialRevision ?? binding.manifest.activeRevision,
    activeRevision: revision.id, revision: fileRef(binding.bundlePath, `revisions/${revision.id}.json`),
    schema: revision.schema, payload: revision.payload, updatedAt: revision.createdAt });
}
function restoreIdentity(requestId: string, expectedRevisionId: string): RestoreIdentity {
  const date = revisionDate(expectedRevisionId);
  return { revisionId: `dataset_rev_${date}_${digest("pige:collection-history-restore:v1", requestId).slice(0, 20)}`,
    operationId: `op_${date}_${digest("pige:collection-history-restore-operation:v1", requestId).slice(0, 20)}` };
}
function undoIdentity(operationId: string, revisionId: string): RestoreIdentity {
  const date = revisionDate(revisionId);
  return { revisionId: `dataset_rev_${date}_${digest("pige:collection-history-undo:v1", operationId).slice(0, 20)}`,
    operationId: undoOperationId(operationId) };
}
function undoOperationId(operationId: string): string {
  const date = /^op_(\d{8})_[a-z0-9]{8,}$/u.exec(operationId)?.[1];
  if (!date) throw requestConflict();
  return `op_${date}_${digest("pige:collection-history-undo-operation:v1", operationId).slice(0, 20)}`;
}
function revisionDate(revisionId: string): string {
  const date = /^dataset_rev_(\d{8})_[a-z0-9]{12,}$/u.exec(revisionId)?.[1];
  if (!date) throw requestConflict();
  return date;
}
function historyCursor(vaultId: string, datasetId: string, currentRevisionId: string, boundaryRevisionId: string): string {
  return `collection_history_${digest("pige:collection-history-cursor:v1",
    `${vaultId}\0${datasetId}\0${currentRevisionId}\0${boundaryRevisionId}`)}`;
}
function cursorIndex(cursor: string, request: CollectionListRevisionHistoryRequest,
  revisions: readonly DatasetRevision[]): number | undefined {
  const index = revisions.findIndex(({ id }) => historyCursor(request.activeVaultId, request.datasetId,
    request.expectedCurrentRevisionId, id) === cursor);
  return index >= 0 ? index : undefined;
}
function listIdentity(request: CollectionListRevisionHistoryRequest) { return { apiVersion: 1 as const,
  requestId: request.requestId, activeVaultId: request.activeVaultId, datasetId: request.datasetId,
  expectedCurrentRevisionId: request.expectedCurrentRevisionId }; }
function openIdentity(request: CollectionOpenRevisionHistoryRequest) { return { ...listIdentity(request),
  revisionId: request.revisionId, tableId: request.tableId }; }
function restoreResultIdentity(request: CollectionRestoreRevisionHistoryRequest) { return { ...openIdentity(request),
  confirmation: request.confirmation }; }
function digest(domain: string, value: string): string { return createHash("sha256").update(`${domain}\0${value}`).digest("hex"); }
function boundedLabel(value: string): string { return Array.from(value.trim()).slice(0, 120).join("") || "Collection"; }
function commitUncertain(): PigeDomainError { return new PigeDomainError("collection.commit_uncertain",
  "The Collection revision restore could not be verified."); }
