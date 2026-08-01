import { createHash } from "node:crypto";
import fs from "node:fs";
import type { KnowledgeActivitySummary, KnowledgeActivityUndoResult, VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  CollectionRenameDatasetRequestSchema,
  CollectionRenameDatasetResultSchema,
  DatasetManifestSchema,
  DatasetRevisionSchema,
  DatasetSchemaRecordSchema,
  OperationRecordSchema,
  type CollectionRenameDatasetRequest,
  type CollectionRenameDatasetResult,
  type DatasetRevision,
  type OperationRecord
} from "@pige/schemas";
import {
  MAX_COLLECTION_JSON_BYTES,
  fileRef,
  hashCanonical,
  operationPathFor,
  readAllBundles,
  readBundle,
  readJsonBounded,
  readOperationRecords,
  readRevisionById,
  replaceManifestCas,
  requestConflict,
  resolveBundleRelativePath,
  writeJsonExclusive,
  writeJsonImmutable,
  type BundleBinding
} from "./managed-collection-storage";

interface ManagedDatasetTitleVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

interface RenameIdentity {
  readonly revisionId: string;
  readonly operationId: string;
}

interface RenameBinding {
  readonly bundle: BundleBinding;
  readonly revision: DatasetRevision;
}

export class ManagedDatasetTitleService {
  readonly #vaults: ManagedDatasetTitleVaultPort;
  #tail: Promise<void> = Promise.resolve();

  constructor(vaults: ManagedDatasetTitleVaultPort) { this.#vaults = vaults; }

  rename(request: CollectionRenameDatasetRequest): Promise<CollectionRenameDatasetResult> {
    return this.#serialize(() => this.#rename(CollectionRenameDatasetRequestSchema.parse(request)));
  }

  activitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    const binding = this.#readActivityBinding(operation);
    if (!binding || binding.revision.change?.kind !== "dataset_title_rename") return undefined;
    const undoBinding = undo ? this.#readActivityBinding(undo) : undefined;
    if (undo && (undoBinding?.revision.change?.kind !== "dataset_title_rename_undo" ||
        undoBinding.revision.change.undoOfOperationId !== operation.id)) return undefined;
    const current = readBundle(binding.bundle.vaultPath, binding.revision.datasetId);
    const changed = !undo && (!current || current.manifest.activeRevision !== binding.revision.id ||
      current.manifest.title !== binding.revision.change.title);
    const tableId = binding.bundle.schema.tables[0]?.id;
    return {
      operationId: operation.id,
      kind: "rename_dataset",
      createdAt: operation.createdAt,
      targetLabel: boundedLabel(binding.revision.change.title),
      ...(tableId ? { target: { kind: "collection" as const, datasetId: binding.revision.datasetId,
        tableId, revisionId: binding.revision.id } } : {}),
      status: undo ? "undone" : "applied",
      canUndo: !undo && !changed,
      ...(undo ? { undoUnavailableReason: "already_undone" as const } :
        changed ? { undoUnavailableReason: current ? "revision_changed" as const : "target_missing" as const } : {})
    };
  }

  findUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    const binding = this.#readActivityBinding(operation);
    if (!binding || binding.revision.change?.kind !== "dataset_title_rename") return undefined;
    const candidate = operations.find(({ id }) => id === undoOperationId(operation.id));
    const undo = candidate ? this.#readActivityBinding(candidate) : undefined;
    return undo?.revision.change?.kind === "dataset_title_rename_undo" &&
      undo.revision.change.undoOfOperationId === operation.id ? candidate : undefined;
  }

  async undo(operation: OperationRecord, expectedRevisionId?: string): Promise<KnowledgeActivityUndoResult> {
    const binding = this.#readActivityBinding(operation);
    if (!binding || binding.revision.change?.kind !== "dataset_title_rename") {
      return { status: "not_found", operationId: operation.id };
    }
    const current = readBundle(binding.bundle.vaultPath, binding.revision.datasetId);
    if (!current) return { status: "not_found", operationId: operation.id };
    if (expectedRevisionId !== binding.revision.id || current.manifest.activeRevision !== binding.revision.id ||
        current.manifest.title !== binding.revision.change.title) {
      return { status: "stale", operationId: operation.id, currentRevisionId: current.manifest.activeRevision };
    }
    const existing = this.findUndoOperation(operation, readOperationRecords(current.vaultPath));
    if (existing) return { status: "already_undone", operationId: operation.id, undoOperationId: existing.id,
      revisionId: current.manifest.activeRevision };
    try {
      const identity = undoIdentity(operation.id, current.revision.id);
      const committed = this.#commit(current, identity, binding.revision.change.previousTitle, operation.id);
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
      if (bundle.revision.change?.kind !== "dataset_title_rename" &&
          bundle.revision.change?.kind !== "dataset_title_rename_undo") continue;
      const operationPath = operationPathFor(vaultPath, bundle.revision.operationId);
      if (fs.existsSync(operationPath)) continue;
      try { writeJsonExclusive(operationPath, createOperation(bundle, bundle.revision)); recovered += 1; }
      catch { failed += 1; }
    }
    return { recovered, failed };
  }

  async #rename(request: CollectionRenameDatasetRequest): Promise<CollectionRenameDatasetResult> {
    const identity = resultIdentity(request);
    const vaultPath = this.#activeVaultPath(request.activeVaultId);
    if (!vaultPath) return CollectionRenameDatasetResultSchema.parse({ ...identity, status: "not_found" });
    try {
      const binding = readBundle(vaultPath, request.datasetId);
      if (!binding) return CollectionRenameDatasetResultSchema.parse({ ...identity, status: "not_found" });
      const mutation = mutationIdentity(request.requestId, request.expectedRevisionId);
      const replay = this.#adoptReplay(binding, request, mutation);
      if (replay) return replay;
      if (binding.manifest.activeRevision !== request.expectedRevisionId) {
        return CollectionRenameDatasetResultSchema.parse({ ...identity, status: "stale",
          currentRevisionId: binding.manifest.activeRevision, title: binding.manifest.title });
      }
      if (binding.manifest.title === request.title) {
        return CollectionRenameDatasetResultSchema.parse({ ...identity, status: "ineligible" });
      }
      const committed = this.#commit(binding, mutation, request.title);
      return CollectionRenameDatasetResultSchema.parse({ ...identity, status: "committed",
        operationId: committed.revision.operationId, revisionId: committed.revision.id,
        title: committed.bundle.manifest.title });
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "collection.request_conflict") throw caught;
      return CollectionRenameDatasetResultSchema.parse({ ...identity, status: "failed" });
    }
  }

  #adoptReplay(binding: BundleBinding, request: CollectionRenameDatasetRequest,
    identity: RenameIdentity): CollectionRenameDatasetResult | undefined {
    const revisionPath = resolveBundleRelativePath(binding.bundlePath, `revisions/${identity.revisionId}.json`);
    const operationPath = operationPathFor(binding.vaultPath, identity.operationId);
    if (!fs.existsSync(revisionPath) && !fs.existsSync(operationPath)) return undefined;
    if (!fs.existsSync(revisionPath)) throw requestConflict();
    const revision = DatasetRevisionSchema.parse(readJsonBounded(revisionPath, MAX_COLLECTION_JSON_BYTES));
    if (revision.id !== identity.revisionId || revision.operationId !== identity.operationId ||
        revision.parentRevisionId !== request.expectedRevisionId || revision.change?.kind !== "dataset_title_rename" ||
        revision.change.title !== request.title) throw requestConflict();
    let current = binding;
    if (binding.manifest.activeRevision !== revision.id) {
      if (binding.manifest.activeRevision !== request.expectedRevisionId) {
        return CollectionRenameDatasetResultSchema.parse({ ...resultIdentity(request), status: "stale",
          currentRevisionId: binding.manifest.activeRevision, title: binding.manifest.title });
      }
      replaceManifestCas(binding, nextManifest(binding, revision, request.title));
      const adopted = readBundle(binding.vaultPath, binding.manifest.datasetId);
      if (!adopted || adopted.manifest.activeRevision !== revision.id) throw commitUncertain();
      current = adopted;
    }
    const expected = createOperation(current, revision);
    if (fs.existsSync(operationPath)) {
      const actual = OperationRecordSchema.parse(readJsonBounded(operationPath, MAX_COLLECTION_JSON_BYTES));
      if (hashCanonical(actual) !== hashCanonical(expected)) throw requestConflict();
    } else writeJsonExclusive(operationPath, expected);
    return CollectionRenameDatasetResultSchema.parse({ ...resultIdentity(request), status: "committed",
      operationId: revision.operationId, revisionId: revision.id, title: current.manifest.title });
  }

  #commit(binding: BundleBinding, identity: RenameIdentity, title: string,
    undoOfOperationId?: string): RenameBinding {
    const now = new Date().toISOString();
    const schemaPath = `schemas/${identity.revisionId}.json`;
    const revisionPath = `revisions/${identity.revisionId}.json`;
    const schema = DatasetSchemaRecordSchema.parse({ ...binding.schema, revisionId: identity.revisionId, createdAt: now });
    writeJsonImmutable(resolveBundleRelativePath(binding.bundlePath, schemaPath), schema);
    const revision = DatasetRevisionSchema.parse({
      ...binding.revision,
      id: identity.revisionId,
      parentRevisionId: binding.revision.id,
      schema: fileRef(binding.bundlePath, schemaPath),
      payload: binding.revision.payload,
      operationId: identity.operationId,
      change: undoOfOperationId
        ? { kind: "dataset_title_rename_undo", previousTitle: binding.manifest.title, title, undoOfOperationId }
        : { kind: "dataset_title_rename", previousTitle: binding.manifest.title, title },
      createdAt: now
    });
    writeJsonImmutable(resolveBundleRelativePath(binding.bundlePath, revisionPath), revision);
    replaceManifestCas(binding, nextManifest(binding, revision, title));
    const committed = readBundle(binding.vaultPath, binding.manifest.datasetId);
    if (!committed || committed.manifest.activeRevision !== revision.id || committed.manifest.title !== title) {
      throw commitUncertain();
    }
    writeJsonExclusive(operationPathFor(binding.vaultPath, identity.operationId), createOperation(committed, revision));
    return { bundle: committed, revision };
  }

  #readActivityBinding(operation: OperationRecord): RenameBinding | undefined {
    if (operation.kind !== "rename_dataset") return undefined;
    const vaultPath = this.#vaults.activeVaultPath();
    const datasetId = operation.targetRefs.find((ref) => ref.kind === "dataset")?.id;
    if (!vaultPath || !datasetId) return undefined;
    const bundle = readBundle(vaultPath, datasetId);
    if (!bundle || !operation.after?.id) return undefined;
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

function createOperation(binding: BundleBinding, revision: DatasetRevision): OperationRecord {
  const change = revision.change;
  if (!revision.parentRevisionId || (change?.kind !== "dataset_title_rename" &&
      change?.kind !== "dataset_title_rename_undo")) throw requestConflict();
  const before = readRevisionById(binding, revision.parentRevisionId);
  const beforePath = `revisions/${before.id}.json`;
  const afterPath = `revisions/${revision.id}.json`;
  const beforeRef = { kind: "dataset_revision" as const, id: before.id,
    path: `${binding.bundleRelativePath}/${beforePath}`, checksum: fileRef(binding.bundlePath, beforePath).checksum };
  const afterRef = { kind: "dataset_revision" as const, id: revision.id,
    path: `${binding.bundleRelativePath}/${afterPath}`, checksum: fileRef(binding.bundlePath, afterPath).checksum };
  return OperationRecordSchema.parse({
    id: revision.operationId, schemaVersion: 1, createdAt: revision.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "rename_dataset",
    targetRefs: [{ kind: "dataset", id: revision.datasetId, path: binding.bundleRelativePath }, afterRef],
    sourceRefs: [beforeRef, ...(change.kind === "dataset_title_rename_undo"
      ? [{ kind: "operation" as const, id: change.undoOfOperationId }] : [])],
    before: beforeRef, after: afterRef,
    summary: `Renamed Dataset to ${boundedLabel(change.title)}.`, reversible: "yes", warnings: []
  });
}

function nextManifest(binding: BundleBinding, revision: DatasetRevision, title: string) {
  return DatasetManifestSchema.parse({ ...binding.manifest,
    initialRevision: binding.manifest.initialRevision ?? binding.manifest.activeRevision,
    title, activeRevision: revision.id,
    revision: fileRef(binding.bundlePath, `revisions/${revision.id}.json`),
    schema: revision.schema, payload: revision.payload, updatedAt: revision.createdAt });
}

function mutationIdentity(requestId: string, expectedRevisionId: string): RenameIdentity {
  const date = /^dataset_rev_(\d{8})_[a-z0-9]{12,}$/u.exec(expectedRevisionId)?.[1];
  if (!date) throw requestConflict();
  return { revisionId: `dataset_rev_${date}_${digest("pige:dataset-title:v1", requestId).slice(0, 20)}`,
    operationId: `op_${date}_${digest("pige:dataset-title-operation:v1", requestId).slice(0, 20)}` };
}

function undoIdentity(operationId: string, revisionId: string): RenameIdentity {
  const date = /^dataset_rev_(\d{8})_[a-z0-9]{12,}$/u.exec(revisionId)?.[1];
  if (!date) throw requestConflict();
  return { revisionId: `dataset_rev_${date}_${digest("pige:dataset-title-undo:v1", operationId).slice(0, 20)}`,
    operationId: undoOperationId(operationId) };
}

function undoOperationId(operationId: string): string {
  const date = /^op_(\d{8})_[a-z0-9]{8,}$/u.exec(operationId)?.[1];
  if (!date) throw requestConflict();
  return `op_${date}_${digest("pige:dataset-title-undo-operation:v1", operationId).slice(0, 20)}`;
}

function resultIdentity(request: CollectionRenameDatasetRequest) {
  return { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId,
    datasetId: request.datasetId, expectedRevisionId: request.expectedRevisionId };
}

function digest(domain: string, value: string): string {
  return createHash("sha256").update(`${domain}\0${value}`).digest("hex");
}
function boundedLabel(value: string): string { return Array.from(value.trim()).slice(0, 120).join("") || "Dataset"; }
function commitUncertain(): PigeDomainError {
  return new PigeDomainError("collection.commit_uncertain", "The Dataset rename commit could not be verified.");
}
