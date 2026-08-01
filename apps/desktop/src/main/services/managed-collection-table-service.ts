import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { KnowledgeActivitySummary, KnowledgeActivityUndoResult, VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  CollectionRenameTableRequestSchema,
  CollectionRenameTableResultSchema,
  DatasetManifestSchema,
  DatasetRevisionSchema,
  DatasetSchemaRecordSchema,
  OperationRecordSchema,
  type CollectionRenameTableRequest,
  type CollectionRenameTableResult,
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

export class ManagedCollectionTableService {
  readonly #vaults: VaultPort;
  #tail: Promise<void> = Promise.resolve();

  constructor(vaults: VaultPort) { this.#vaults = vaults; }

  rename(request: CollectionRenameTableRequest): Promise<CollectionRenameTableResult> {
    return this.#serialize(() => this.#rename(CollectionRenameTableRequestSchema.parse(request)));
  }

  activitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
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
    const binding = this.#readActivityBinding(operation);
    if (!binding || binding.revision.change?.kind !== "collection_table_rename") return undefined;
    const candidate = operations.find(({ id }) => id === undoOperationId(operation.id));
    const undo = candidate ? this.#readActivityBinding(candidate) : undefined;
    return undo?.revision.change?.kind === "collection_table_rename_undo" &&
      undo.revision.change.undoOfOperationId === operation.id ? candidate : undefined;
  }

  async undo(operation: OperationRecord, expectedRevisionId?: string): Promise<KnowledgeActivityUndoResult> {
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

  recoverIncompleteOperations(): { readonly recovered: number; readonly failed: number } {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0; let failed = 0;
    for (const bundle of readAllBundles(vaultPath)) {
      if (bundle.revision.change?.kind !== "collection_table_rename" &&
          bundle.revision.change?.kind !== "collection_table_rename_undo") continue;
      const operationPath = operationPathFor(vaultPath, bundle.revision.operationId);
      if (fs.existsSync(operationPath)) continue;
      try { writeJsonExclusive(operationPath, createOperation(bundle, bundle.revision)); recovered += 1; }
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
function resultIdentity(request: CollectionRenameTableRequest) { return { apiVersion: 1 as const,
  requestId: request.requestId, activeVaultId: request.activeVaultId, datasetId: request.datasetId,
  tableId: request.tableId, name: request.name }; }
function digest(domain: string, value: string): string { return createHash("sha256").update(`${domain}\0${value}`).digest("hex"); }
function normalizeName(value: string): string { return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US"); }
function boundedLabel(value: string): string { return Array.from(value.trim()).slice(0, 120).join("") || "Table"; }
function commitUncertain(): PigeDomainError { return new PigeDomainError("collection.commit_uncertain", "The Collection table rename could not be verified."); }
