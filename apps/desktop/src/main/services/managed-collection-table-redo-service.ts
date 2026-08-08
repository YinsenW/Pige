import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  KnowledgeActivityRedoRequest,
  KnowledgeActivityRedoResult,
  KnowledgeActivitySummary
} from "@pige/contracts";
import {
  DatasetManifestSchema,
  DatasetRevisionSchema,
  DatasetSchemaRecordSchema,
  OperationRecordSchema,
  type DatasetRevision,
  type OperationRecord
} from "@pige/schemas";
import {
  createTableAddOperation,
  createTableAddUndoOperationId,
  createTableTrashOperation,
  createTableTrashUndoOperationId,
  readTableAddActivityBinding,
  readTableTrashActivityBinding,
  type ManagedCollectionTableAddBinding,
  type ManagedCollectionTableTrashBinding
} from "./managed-collection-table-service";
import {
  MAX_COLLECTION_JSON_BYTES,
  fileRef,
  hashCanonical,
  operationPathFor,
  payloadInvalid,
  publishImmutableFile,
  readBundle,
  readJsonBounded,
  readJsonRef,
  readOperationRecords,
  replaceManifestCas,
  resolveBundleRelativePath,
  syncFile,
  validatePayloadMeta,
  writeJsonExclusive,
  writeJsonImmutable,
  type BundleBinding
} from "./managed-collection-storage";

interface ManagedCollectionTableRedoVaultPort {
  activeVaultPath(): string | undefined;
}

interface TableRedoVariant {
  readonly name: "add" | "trash";
  readonly originalChange: "collection_table_add" | "collection_table_trash";
  readonly undoChange: "collection_table_add_undo" | "collection_table_trash_undo";
  readonly undoOperationId: (operationId: string) => string;
  readonly readBinding: (
    vaultPath: string,
    operation: OperationRecord
  ) => ManagedCollectionTableAddBinding | ManagedCollectionTableTrashBinding | undefined;
  readonly createOperation: (binding: BundleBinding, revision: DatasetRevision) => OperationRecord;
}

interface TableRedoBinding {
  readonly bundle: BundleBinding;
  readonly revision: DatasetRevision;
  readonly operation: OperationRecord;
  readonly variant: TableRedoVariant;
}

interface PrivateRedoFields {
  readonly redoOfOperationId: string;
  readonly undoOperationId: string;
}

const OPERATION_ID = /^op_(\d{8})_[a-z0-9]{8,}$/u;
const REVISION_ID = /^dataset_rev_(\d{8})_[a-z0-9]{12,}$/u;

const TABLE_ADD_REDO: TableRedoVariant = {
  name: "add",
  originalChange: "collection_table_add",
  undoChange: "collection_table_add_undo",
  undoOperationId: createTableAddUndoOperationId,
  readBinding: readTableAddActivityBinding,
  createOperation: createTableAddOperation
};

const TABLE_TRASH_REDO: TableRedoVariant = {
  name: "trash",
  originalChange: "collection_table_trash",
  undoChange: "collection_table_trash_undo",
  undoOperationId: createTableTrashUndoOperationId,
  readBinding: readTableTrashActivityBinding,
  createOperation: createTableTrashOperation
};

export class ManagedCollectionTableRedoService {
  readonly #vaults: ManagedCollectionTableRedoVaultPort;

  constructor(vaults: ManagedCollectionTableRedoVaultPort) {
    this.#vaults = vaults;
  }

  activityState(
    operation: OperationRecord,
    undo: OperationRecord | undefined
  ): Pick<KnowledgeActivitySummary, "canRedo" | "redoUnavailableReason"> | undefined {
    if (!undo) return undefined;
    const vaultPath = this.#vaults.activeVaultPath();
    const original = vaultPath ? readExactBinding(vaultPath, operation) : undefined;
    const undone = vaultPath ? readExactBinding(vaultPath, undo) : undefined;
    if (!vaultPath || !original || !undone || !isMatchingUndo(original, undone)) return undefined;
    const redo = readOperation(vaultPath, createRedoIdentity(operation.id, undone.revision.id, original.variant).operationId);
    if (redo) return matchesRedoOperation(vaultPath, original, undone, redo)
      ? { canRedo: false, redoUnavailableReason: "already_redone" }
      : { canRedo: false, redoUnavailableReason: "content_changed" };
    const current = readBundle(vaultPath, original.bundle.manifest.datasetId);
    return current?.manifest.activeRevision === undone.revision.id
      ? { canRedo: true }
      : { canRedo: false, redoUnavailableReason: current ? "content_changed" : "target_missing" };
  }

  redo(request: KnowledgeActivityRedoRequest): KnowledgeActivityRedoResult {
    if (!request || typeof request !== "object" || !OPERATION_ID.test(request.operationId)) {
      return { status: "not_found", operationId: request?.operationId ?? "" };
    }
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { status: "not_found", operationId: request.operationId };
    const operation = readOperation(vaultPath, request.operationId);
    const original = operation ? readExactBinding(vaultPath, operation) : undefined;
    if (!operation || !original || !isOriginal(original)) {
      return { status: "not_found", operationId: request.operationId };
    }
    const undo = readOperation(vaultPath, original.variant.undoOperationId(operation.id));
    const undone = undo ? readExactBinding(vaultPath, undo) : undefined;
    if (!undo || !undone || !isMatchingUndo(original, undone)) {
      return { status: "stale", operationId: operation.id };
    }
    return this.#redoExact(vaultPath, original, undone, request.expectedRevisionId, true);
  }

  recoverIncompleteRedos(): { readonly recovered: number; readonly failed: number } {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0;
    let failed = 0;
    for (const operation of readOperationRecords(vaultPath)) {
      const original = readExactBinding(vaultPath, operation);
      if (!original || !isOriginal(original)) continue;
      const undo = readOperation(vaultPath, original.variant.undoOperationId(operation.id));
      const undone = undo ? readExactBinding(vaultPath, undo) : undefined;
      if (!undo || !undone || !isMatchingUndo(original, undone)) continue;
      const identity = createRedoIdentity(operation.id, undone.revision.id, original.variant);
      const current = readBundle(vaultPath, original.bundle.manifest.datasetId);
      const existingOperation = readOperation(vaultPath, identity.operationId);
      if (existingOperation && current?.manifest.activeRevision === identity.revisionId) continue;
      if (!redoArtifactsExist(original.bundle, identity.revisionId) && !existingOperation) continue;
      try {
        const result = this.#redoExact(vaultPath, original, undone, undefined, false);
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
    original: TableRedoBinding,
    undone: TableRedoBinding,
    expectedRevisionId: string | undefined,
    allowStart: boolean
  ): KnowledgeActivityRedoResult {
    const current = readBundle(vaultPath, original.bundle.manifest.datasetId);
    if (!current) return { status: "not_found", operationId: original.operation.id };
    if (expectedRevisionId !== undefined && expectedRevisionId !== undone.revision.id) {
      return { status: "stale", operationId: original.operation.id, currentRevisionId: current.manifest.activeRevision };
    }
    const identity = createRedoIdentity(original.operation.id, undone.revision.id, original.variant);
    const existingOperation = readOperation(vaultPath, identity.operationId);
    if (existingOperation) {
      return matchesRedoOperation(vaultPath, original, undone, existingOperation) &&
        current.manifest.activeRevision === identity.revisionId
        ? { status: "already_redone", operationId: original.operation.id, undoOperationId: undone.operation.id,
          redoOperationId: identity.operationId, revisionId: identity.revisionId }
        : { status: "stale", operationId: original.operation.id, currentRevisionId: current.manifest.activeRevision };
    }
    if (current.manifest.activeRevision !== undone.revision.id &&
        current.manifest.activeRevision !== identity.revisionId) {
      return { status: "stale", operationId: original.operation.id, currentRevisionId: current.manifest.activeRevision };
    }
    if (!allowStart && !redoArtifactsExist(original.bundle, identity.revisionId)) {
      return { status: "not_found", operationId: original.operation.id };
    }
    const revision = publishRedoRevision(current, original.revision, undone.revision.id, original.operation, undone.operation, identity);
    let committed = readBundle(vaultPath, current.manifest.datasetId);
    if (!committed) return { status: "not_found", operationId: original.operation.id };
    if (committed.manifest.activeRevision === undone.revision.id) {
      replaceManifestCas(committed, DatasetManifestSchema.parse({
        ...committed.manifest,
        initialRevision: committed.manifest.initialRevision ?? committed.manifest.activeRevision,
        activeRevision: revision.id,
        revision: fileRef(committed.bundlePath, `revisions/${revision.id}.json`),
        schema: revision.schema,
        payload: revision.payload,
        updatedAt: revision.createdAt
      }));
      committed = readBundle(vaultPath, current.manifest.datasetId);
      if (!committed) return { status: "not_found", operationId: original.operation.id };
    }
    if (committed.manifest.activeRevision !== revision.id) {
      return { status: "stale", operationId: original.operation.id, currentRevisionId: committed.manifest.activeRevision };
    }
    const redoOperation = original.variant.createOperation(committed, revision);
    writeJsonExclusive(operationPathFor(vaultPath, identity.operationId), redoOperation);
    const persisted = readOperation(vaultPath, identity.operationId);
    if (!persisted || !matchesRedoOperation(vaultPath, original, undone, persisted)) {
      return { status: "stale", operationId: original.operation.id, currentRevisionId: committed.manifest.activeRevision };
    }
    return { status: "redone", operationId: original.operation.id, undoOperationId: undone.operation.id,
      redoOperationId: identity.operationId, revisionId: revision.id };
  }
}

function publishRedoRevision(
  current: BundleBinding,
  originalRevision: DatasetRevision,
  parentRevisionId: string,
  original: OperationRecord,
  undo: OperationRecord,
  identity: { readonly revisionId: string; readonly operationId: string }
): DatasetRevision {
  const schemaPath = `schemas/${identity.revisionId}.json`;
  const payloadPath = `data/revisions/${identity.revisionId}.sqlite`;
  const revisionPath = `revisions/${identity.revisionId}.json`;
  const existingRevision = readOptionalRevision(current, identity.revisionId);
  const originalSchema = DatasetSchemaRecordSchema.parse(readJsonRef(current.bundlePath, originalRevision.schema));
  const existingSchema = readOptionalJson(current.bundlePath, schemaPath);
  const createdAt = existingRevision?.createdAt ??
    (existingSchema && typeof existingSchema.createdAt === "string" ? existingSchema.createdAt : new Date().toISOString());
  const schema = DatasetSchemaRecordSchema.parse({ ...originalSchema, revisionId: identity.revisionId, createdAt });
  writeJsonImmutable(resolveBundleRelativePath(current.bundlePath, schemaPath), schema);
  const stagedRoot = path.join(current.bundlePath, ".staging", `${identity.revisionId}.${randomUUID()}`);
  const stagedPayload = path.join(stagedRoot, "payload.sqlite");
  fs.mkdirSync(stagedRoot, { recursive: true, mode: 0o700 });
  try {
    fs.copyFileSync(resolveBundleRelativePath(current.bundlePath, originalRevision.payload.path), stagedPayload);
    rebindPayloadRevision(stagedPayload, current.manifest.datasetId, originalRevision.id, identity.revisionId);
    publishImmutableFile(stagedPayload, resolveBundleRelativePath(current.bundlePath, payloadPath));
  } finally {
    fs.rmSync(stagedRoot, { recursive: true, force: true });
  }
  const revision = DatasetRevisionSchema.parse({
    ...originalRevision,
    id: identity.revisionId,
    parentRevisionId,
    schema: fileRef(current.bundlePath, schemaPath),
    payload: { ...fileRef(current.bundlePath, payloadPath), format: "sqlite" },
    operationId: identity.operationId,
    redoOfOperationId: original.id,
    undoOperationId: undo.id,
    createdAt
  });
  if (existingRevision && hashCanonical(existingRevision) !== hashCanonical(revision)) throw payloadInvalid();
  writeJsonImmutable(resolveBundleRelativePath(current.bundlePath, revisionPath), revision);
  return revision;
}

function readExactBinding(vaultPath: string, operation: OperationRecord): TableRedoBinding | undefined {
  const variant = tableRedoVariant(operation);
  if (!variant) return undefined;
  const binding = variant.readBinding(vaultPath, operation);
  if (!binding || binding.revision.operationId !== operation.id) return undefined;
  return { ...binding, operation, variant };
}

function isOriginal(binding: TableRedoBinding): boolean {
  return binding.revision.change?.kind === binding.variant.originalChange && !privateRedoFields(binding.revision);
}

function isMatchingUndo(original: TableRedoBinding, undone: TableRedoBinding): boolean {
  const change = undone.revision.change;
  return undone.variant === original.variant && change?.kind === original.variant.undoChange &&
    change.undoOfOperationId === original.operation.id &&
    undone.revision.datasetId === original.revision.datasetId &&
    undone.revision.parentRevisionId === original.revision.id;
}

function matchesRedoOperation(
  vaultPath: string,
  original: TableRedoBinding,
  undone: TableRedoBinding,
  redoOperation: OperationRecord
): boolean {
  const redo = readExactBinding(vaultPath, redoOperation);
  const fields = redo ? privateRedoFields(redo.revision) : undefined;
  const originalChange = original.revision.change;
  const redoChange = redo?.revision.change;
  const originalTableId = tableChangeTableId(originalChange);
  const redoTableId = tableChangeTableId(redoChange);
  return !!redo && redo.variant === original.variant && originalChange?.kind === original.variant.originalChange &&
    redoChange?.kind === original.variant.originalChange && !!fields && !!originalTableId &&
    fields.redoOfOperationId === original.operation.id && fields.undoOperationId === undone.operation.id &&
    redo.revision.parentRevisionId === undone.revision.id &&
    redoTableId === originalTableId &&
    redo.operation.kind === original.operation.kind;
}

function tableRedoVariant(operation: OperationRecord): TableRedoVariant | undefined {
  return operation.kind === "add_collection_table" ? TABLE_ADD_REDO
    : operation.kind === "trash_collection_table" ? TABLE_TRASH_REDO
      : undefined;
}

function tableChangeTableId(change: DatasetRevision["change"]): string | undefined {
  return change?.kind === "collection_table_add" || change?.kind === "collection_table_add_undo" ||
    change?.kind === "collection_table_trash" || change?.kind === "collection_table_trash_undo"
    ? change.tableId
    : undefined;
}

function privateRedoFields(revision: DatasetRevision): PrivateRedoFields | undefined {
  const candidate = revision as DatasetRevision & Partial<PrivateRedoFields>;
  return typeof candidate.redoOfOperationId === "string" && typeof candidate.undoOperationId === "string"
    ? { redoOfOperationId: candidate.redoOfOperationId, undoOperationId: candidate.undoOperationId }
    : undefined;
}

function readOptionalRevision(bundle: BundleBinding, revisionId: string): DatasetRevision | undefined {
  const revisionPath = resolveBundleRelativePath(bundle.bundlePath, `revisions/${revisionId}.json`);
  return fs.existsSync(revisionPath)
    ? DatasetRevisionSchema.parse(readJsonBounded(revisionPath, MAX_COLLECTION_JSON_BYTES))
    : undefined;
}

function readOptionalJson(bundlePath: string, relativePath: string): Record<string, unknown> | undefined {
  const filePath = resolveBundleRelativePath(bundlePath, relativePath);
  if (!fs.existsSync(filePath)) return undefined;
  const value = readJsonBounded(filePath, MAX_COLLECTION_JSON_BYTES);
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function redoArtifactsExist(bundle: BundleBinding, revisionId: string): boolean {
  return [
    `schemas/${revisionId}.json`,
    `data/revisions/${revisionId}.sqlite`,
    `revisions/${revisionId}.json`
  ].some((relativePath) => fs.existsSync(resolveBundleRelativePath(bundle.bundlePath, relativePath)));
}

function rebindPayloadRevision(
  payloadPath: string,
  datasetId: string,
  sourceRevisionId: string,
  revisionId: string
): void {
  const database = new DatabaseSync(payloadPath);
  try {
    database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;");
    validatePayloadMeta(database, datasetId, sourceRevisionId);
    if (database.prepare("UPDATE pige_dataset_meta SET value = ? WHERE key = 'revision_id'")
      .run(revisionId).changes !== 1) throw payloadInvalid();
    const integrity = database.prepare("PRAGMA integrity_check").get() as { integrity_check?: unknown } | undefined;
    if (integrity?.integrity_check !== "ok") throw payloadInvalid();
  } finally {
    database.close();
  }
  syncFile(payloadPath);
}

function createRedoIdentity(operationId: string, undoRevisionId: string, variant: TableRedoVariant): {
  readonly revisionId: string;
  readonly operationId: string;
} {
  const date = REVISION_ID.exec(undoRevisionId)?.[1];
  if (!date) throw payloadInvalid();
  return {
    revisionId: `dataset_rev_${date}_${digest(`pige:collection-table-${variant.name}-redo-revision:v1`, operationId).slice(0, 20)}`,
    operationId: createRedoOperationId(operationId, variant)
  };
}

function createRedoOperationId(operationId: string, variant: TableRedoVariant): string {
  const date = OPERATION_ID.exec(operationId)?.[1];
  return date
    ? `op_${date}_${digest(`pige:collection-table-${variant.name}-redo-operation:v1`, operationId).slice(0, 20)}`
    : "";
}

function readOperation(vaultPath: string, operationId: string): OperationRecord | undefined {
  if (!operationId) return undefined;
  try {
    return OperationRecordSchema.parse(readJsonBounded(
      operationPathFor(vaultPath, operationId), MAX_COLLECTION_JSON_BYTES
    ));
  } catch {
    return undefined;
  }
}

function digest(domain: string, value: string): string {
  return createHash("sha256").update(domain).update("\0").update(value).digest("hex");
}
