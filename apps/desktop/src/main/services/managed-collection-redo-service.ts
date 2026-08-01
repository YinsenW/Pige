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
  createOperationForRevision,
  createUndoOperationId,
  isMatchingUndoOperation,
  isUndoableCollectionChange,
  readOperationBinding
} from "./managed-collection-service";
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
  readRevisionById,
  replaceManifestCas,
  resolveBundleRelativePath,
  syncFile,
  validatePayloadMeta,
  writeJsonExclusive,
  writeJsonImmutable,
  type BundleBinding
} from "./managed-collection-storage";

interface ManagedCollectionRedoVaultPort {
  current(): { readonly vaultId: string } | undefined;
  activeVaultPath(): string | undefined;
}

interface CollectionOperationRevisionBinding {
  readonly bundle: BundleBinding;
  readonly revision: DatasetRevision;
  readonly operation: OperationRecord;
}

interface PrivateRedoFields {
  readonly redoOfOperationId: string;
  readonly undoOperationId: string;
}

const OPERATION_ID = /^op_(\d{8})_[a-z0-9]{8,}$/u;

export class ManagedCollectionRedoService {
  readonly #vaults: ManagedCollectionRedoVaultPort;

  constructor(vaults: ManagedCollectionRedoVaultPort) {
    this.#vaults = vaults;
  }

  activityState(
    operation: OperationRecord,
    undo: OperationRecord | undefined
  ): Pick<KnowledgeActivitySummary, "canRedo" | "redoUnavailableReason"> | undefined {
    if (!undo) return undefined;
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath || !isMatchingUndoOperation(operation, undo)) return undefined;
    const original = readExactBinding(vaultPath, operation);
    const undone = readExactBinding(vaultPath, undo);
    if (!original || !undone) return undefined;
    const redoId = createRedoOperationId(operation.id);
    const redoOperation = readOperation(vaultPath, redoId);
    if (redoOperation) {
      return matchesRedoOperation(vaultPath, original, undone, operation, undo, redoOperation)
        ? { canRedo: false, redoUnavailableReason: "already_redone" }
        : { canRedo: false, redoUnavailableReason: "content_changed" };
    }
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
    const operationBinding = operation ? readOperationBinding(operation) : undefined;
    if (!operation || !original || !operationBinding || !isUndoableCollectionChange(operationBinding.changeKind)) {
      return { status: "not_found", operationId: request.operationId };
    }
    const undo = readOperation(vaultPath, createUndoOperationId(operation.id));
    const undone = undo ? readExactBinding(vaultPath, undo) : undefined;
    if (!undo || !undone || !isMatchingUndoOperation(operation, undo)) {
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
      const original = readExactBinding(vaultPath, operation);
      const operationBinding = readOperationBinding(operation);
      if (!original || !operationBinding || !isUndoableCollectionChange(operationBinding.changeKind)) continue;
      const undo = readOperation(vaultPath, createUndoOperationId(operation.id));
      const undone = undo ? readExactBinding(vaultPath, undo) : undefined;
      if (!undo || !undone || !isMatchingUndoOperation(operation, undo)) continue;
      const identity = createRedoIdentity(operation.id, undone.revision.id);
      const current = readBundle(vaultPath, original.bundle.manifest.datasetId);
      const existingOperation = readOperation(vaultPath, identity.operationId);
      if (existingOperation && current?.manifest.activeRevision === identity.revisionId) continue;
      if (!redoArtifactsExist(original.bundle, identity.revisionId) && !existingOperation) continue;
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
    original: CollectionOperationRevisionBinding,
    undone: CollectionOperationRevisionBinding,
    operation: OperationRecord,
    undo: OperationRecord,
    expectedRevisionId: string | undefined,
    allowStart: boolean
  ): KnowledgeActivityRedoResult {
    const current = readBundle(vaultPath, original.bundle.manifest.datasetId);
    if (!current) return { status: "not_found", operationId: operation.id };
    if (expectedRevisionId !== undefined && expectedRevisionId !== undone.revision.id) {
      return { status: "stale", operationId: operation.id, currentRevisionId: current.manifest.activeRevision };
    }
    const identity = createRedoIdentity(operation.id, undone.revision.id);
    const existingOperation = readOperation(vaultPath, identity.operationId);
    if (existingOperation) {
      return matchesRedoOperation(vaultPath, original, undone, operation, undo, existingOperation) &&
        current.manifest.activeRevision === identity.revisionId
        ? { status: "already_redone", operationId: operation.id, undoOperationId: undo.id,
          redoOperationId: identity.operationId, revisionId: identity.revisionId }
        : { status: "stale", operationId: operation.id, currentRevisionId: current.manifest.activeRevision };
    }
    if (current.manifest.activeRevision !== undone.revision.id &&
        current.manifest.activeRevision !== identity.revisionId) {
      return { status: "stale", operationId: operation.id, currentRevisionId: current.manifest.activeRevision };
    }
    if (!allowStart && !redoArtifactsExist(original.bundle, identity.revisionId)) {
      return { status: "not_found", operationId: operation.id };
    }
    const revision = publishRedoRevision(
      current, original.revision, undone.revision.id, operation, undo, identity
    );
    let committed = readBundle(vaultPath, current.manifest.datasetId);
    if (!committed) return { status: "not_found", operationId: operation.id };
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
      if (!committed) return { status: "not_found", operationId: operation.id };
    }
    if (committed.manifest.activeRevision !== revision.id) {
      return { status: "stale", operationId: operation.id, currentRevisionId: committed.manifest.activeRevision };
    }
    const redoOperation = createOperationForRevision(committed, revision);
    writeJsonExclusive(operationPathFor(vaultPath, identity.operationId), redoOperation);
    const persisted = readOperation(vaultPath, identity.operationId);
    if (!persisted || !matchesRedoOperation(vaultPath, original, undone, operation, undo, persisted)) {
      return { status: "stale", operationId: operation.id, currentRevisionId: committed.manifest.activeRevision };
    }
    return { status: "redone", operationId: operation.id, undoOperationId: undo.id,
      redoOperationId: identity.operationId, revisionId: revision.id };
  }
}

function publishRedoRevision(
  current: BundleBinding,
  originalRevision: DatasetRevision,
  parentRevisionId: string,
  operation: OperationRecord,
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
    (existingSchema && typeof existingSchema === "object" && "createdAt" in existingSchema &&
      typeof existingSchema.createdAt === "string" ? existingSchema.createdAt : new Date().toISOString());
  const schema = DatasetSchemaRecordSchema.parse({
    ...originalSchema,
    revisionId: identity.revisionId,
    createdAt
  });
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
    redoOfOperationId: operation.id,
    undoOperationId: undo.id,
    createdAt
  });
  if (existingRevision && hashCanonical(existingRevision) !== hashCanonical(revision)) throw payloadInvalid();
  writeJsonImmutable(resolveBundleRelativePath(current.bundlePath, revisionPath), revision);
  return revision;
}

function readExactBinding(vaultPath: string, operation: OperationRecord): CollectionOperationRevisionBinding | undefined {
  const operationBinding = readOperationBinding(operation);
  if (!operationBinding) return undefined;
  try {
    const bundle = readBundle(vaultPath, operationBinding.datasetId);
    if (!bundle) return undefined;
    const revision = readRevisionById(bundle, operationBinding.afterRevisionId);
    if (revision.operationId !== operation.id ||
        hashCanonical(createOperationForRevision(bundle, revision)) !== hashCanonical(operation)) return undefined;
    return { bundle, revision, operation };
  } catch {
    return undefined;
  }
}

function matchesRedoOperation(
  vaultPath: string,
  original: CollectionOperationRevisionBinding,
  undone: CollectionOperationRevisionBinding,
  operation: OperationRecord,
  undo: OperationRecord,
  redoOperation: OperationRecord
): boolean {
  const redo = readExactBinding(vaultPath, redoOperation);
  if (!redo) return false;
  const fields = privateRedoFields(redo.revision);
  return !!fields && fields.redoOfOperationId === operation.id && fields.undoOperationId === undo.id &&
    redo.revision.parentRevisionId === undone.revision.id &&
    redo.operation.kind === original.operation.kind;
}

function privateRedoFields(revision: DatasetRevision): PrivateRedoFields | undefined {
  const candidate = revision as DatasetRevision & Partial<PrivateRedoFields>;
  return typeof candidate.redoOfOperationId === "string" && typeof candidate.undoOperationId === "string"
    ? { redoOfOperationId: candidate.redoOfOperationId, undoOperationId: candidate.undoOperationId }
    : undefined;
}

function readOptionalRevision(bundle: BundleBinding, revisionId: string): DatasetRevision | undefined {
  const revisionPath = resolveBundleRelativePath(bundle.bundlePath, `revisions/${revisionId}.json`);
  if (!fs.existsSync(revisionPath)) return undefined;
  return DatasetRevisionSchema.parse(readJsonBounded(revisionPath, MAX_COLLECTION_JSON_BYTES));
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

function createRedoIdentity(operationId: string, undoRevisionId: string): {
  readonly revisionId: string;
  readonly operationId: string;
} {
  const date = /^dataset_rev_(\d{8})_[a-z0-9]{12,}$/u.exec(undoRevisionId)?.[1];
  if (!date) throw payloadInvalid();
  return {
    revisionId: `dataset_rev_${date}_${digest("pige:collection-redo-revision:v1", operationId).slice(0, 20)}`,
    operationId: createRedoOperationId(operationId)
  };
}

function createRedoOperationId(operationId: string): string {
  const date = OPERATION_ID.exec(operationId)?.[1];
  return date ? `op_${date}_${digest("pige:collection-redo-operation:v1", operationId).slice(0, 20)}` : "";
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
