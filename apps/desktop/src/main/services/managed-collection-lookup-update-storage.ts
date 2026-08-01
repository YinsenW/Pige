import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PigeDomainError } from "@pige/domain";
import {
  CollectionUpdateLookupColumnRequestSchema,
  CollectionUpdateLookupColumnResultSchema,
  DatasetManifestSchema,
  DatasetRevisionSchema,
  DatasetSchemaRecordSchema,
  OperationRecordSchema,
  type CollectionSnapshot,
  type CollectionUpdateLookupColumnRequest,
  type CollectionUpdateLookupColumnResult,
  type DatasetColumn,
  type DatasetPigeLookup,
  type DatasetRevision,
  type DatasetSchemaRecord,
  type OperationRecord
} from "@pige/schemas";
import {
  fileRef, hashCanonical, MAX_COLLECTION_JSON_BYTES, operationPathFor, payloadInvalid,
  publishImmutableFile, readBundle, readJsonBounded, readJsonRef, readRevisionById,
  replaceManifestCas, requestConflict, resolveBundleRelativePath, syncFile,
  validatePayloadMeta, writeJsonExclusive, writeJsonImmutable, type BundleBinding
} from "./managed-collection-storage";
import {
  recomputeAllFormulaRowsInTable,
  type FormulaProjectionStatsByTable
} from "./managed-collection-formula-storage";

interface LookupUpdateIdentity { readonly revisionId: string; readonly operationId: string; }

export async function executeLookupUpdate(input: {
  readonly vaultPath?: string;
  readonly request: CollectionUpdateLookupColumnRequest;
  readonly isVaultActive: () => boolean;
  readonly readSnapshot: (binding: BundleBinding, tableId: string) => CollectionSnapshot | undefined;
  readonly createOperation: (binding: BundleBinding, revision: DatasetRevision) => OperationRecord;
}): Promise<CollectionUpdateLookupColumnResult> {
  const request = CollectionUpdateLookupColumnRequestSchema.parse(input.request);
  const identity = resultIdentity(request);
  if (!input.vaultPath) return CollectionUpdateLookupColumnResultSchema.parse({ ...identity, status: "not_found" });
  try {
    const binding = readBundle(input.vaultPath, request.datasetId);
    if (!binding) return CollectionUpdateLookupColumnResultSchema.parse({ ...identity, status: "not_found" });
    const mutation = createIdentity(request);
    const adopted = adoptExisting(binding, request, mutation, input.readSnapshot, input.createOperation);
    if (adopted) return adopted;
    const snapshot = input.readSnapshot(binding, request.tableId);
    if (!snapshot) return CollectionUpdateLookupColumnResultSchema.parse({ ...identity, status: "not_found" });
    if (binding.manifest.activeRevision !== request.expectedRevisionId) {
      return CollectionUpdateLookupColumnResultSchema.parse({ ...identity, status: "stale", snapshot });
    }
    const committed = commitUpdate(binding, request, mutation);
    const operation = input.createOperation(committed.binding, committed.revision);
    writeJsonExclusive(operationPathFor(committed.binding.vaultPath, operation.id), operation);
    if (!input.isVaultActive()) return CollectionUpdateLookupColumnResultSchema.parse({ ...identity, status: "not_found" });
    const next = input.readSnapshot(committed.binding, request.tableId);
    if (!next) throw requestConflict();
    return CollectionUpdateLookupColumnResultSchema.parse({ ...identity, status: "committed", operationId: operation.id, snapshot: next });
  } catch (caught) {
    if (caught instanceof PigeDomainError && caught.code === "collection.request_conflict") throw caught;
    const reason = caught instanceof PigeDomainError ? caught.code : "";
    if (reason === "collection.revision_changed") {
      const current = input.vaultPath ? readBundle(input.vaultPath, request.datasetId) : undefined;
      const snapshot = current ? input.readSnapshot(current, request.tableId) : undefined;
      return CollectionUpdateLookupColumnResultSchema.parse(snapshot
        ? { ...identity, status: "stale", snapshot }
        : { ...identity, status: "not_found" });
    }
    return CollectionUpdateLookupColumnResultSchema.parse({ ...identity,
      status: reason.startsWith("collection.") ? "ineligible" : "failed" });
  }
}

export function commitLookupUpdateUndoOperation(input: {
  readonly binding: BundleBinding;
  readonly identity: LookupUpdateIdentity;
  readonly afterRevisionId: string;
  readonly beforeRevisionId: string;
  readonly undoOfOperationId: string;
  readonly tableId: string;
  readonly columnId: string;
  readonly createOperation: (binding: BundleBinding, revision: DatasetRevision) => OperationRecord;
}): { readonly binding: BundleBinding; readonly revision: DatasetRevision; readonly operation: OperationRecord } {
  const current = requireCurrent(input.binding, input.afterRevisionId);
  const before = readRevisionById(current, input.beforeRevisionId);
  const beforeSchema = DatasetSchemaRecordSchema.parse(readJsonRef(current.bundlePath, before.schema));
  const descriptor = requireLookup(beforeSchema, input.tableId, input.columnId);
  const committed = publish({ current, identity: input.identity, tableId: input.tableId, columnId: input.columnId,
    descriptor, restore: { revision: before, schema: beforeSchema },
    change: { kind: "collection_lookup_update_undo", ...descriptorFields(descriptor), undoOfOperationId: input.undoOfOperationId } });
  const operation = input.createOperation(committed.binding, committed.revision);
  writeJsonExclusive(operationPathFor(committed.binding.vaultPath, operation.id), operation);
  return { ...committed, operation };
}

function commitUpdate(binding: BundleBinding, request: CollectionUpdateLookupColumnRequest,
  identity: LookupUpdateIdentity): { readonly binding: BundleBinding; readonly revision: DatasetRevision } {
  const current = requireCurrent(binding, request.expectedRevisionId);
  const table = current.schema.tables.find((candidate) => candidate.id === request.tableId);
  const column = table?.columns.find((candidate) => candidate.id === request.columnId);
  if (!table || column?.lookup?.kind !== "pige_single_lookup") throw ineligible();
  const { descriptor, logicalType } = validateDescriptor(current.schema, table, request);
  if (hashCanonical(column.lookup) === hashCanonical(descriptor)) throw ineligible();
  return publish({ current, identity, tableId: table.id, columnId: column.id, descriptor, logicalType,
    change: { kind: "collection_lookup_update", ...descriptorFields(descriptor) } });
}

function publish(input: {
  readonly current: BundleBinding; readonly identity: LookupUpdateIdentity; readonly tableId: string; readonly columnId: string;
  readonly descriptor: DatasetPigeLookup; readonly restore?: { readonly revision: DatasetRevision; readonly schema: DatasetSchemaRecord };
  readonly logicalType?: DatasetColumn["logicalType"];
  readonly change: ({ readonly kind: "collection_lookup_update" } | { readonly kind: "collection_lookup_update_undo"; readonly undoOfOperationId: string }) &
    { readonly relationColumnId: string; readonly targetColumnId: string };
}): { readonly binding: BundleBinding; readonly revision: DatasetRevision } {
  const stagedRoot = path.join(input.current.bundlePath, ".staging", `${input.identity.revisionId}.${randomUUID()}`);
  const payloadRelativePath = `data/revisions/${input.identity.revisionId}.sqlite`;
  const schemaRelativePath = `schemas/${input.identity.revisionId}.json`;
  const revisionRelativePath = `revisions/${input.identity.revisionId}.json`;
  const stagedPayload = path.join(stagedRoot, "payload.sqlite");
  fs.mkdirSync(stagedRoot, { recursive: true, mode: 0o700 });
  try {
    const sourcePayload = input.restore
      ? resolveBundleRelativePath(input.current.bundlePath, input.restore.revision.payload.path)
      : input.current.payloadPath;
    fs.copyFileSync(sourcePayload, stagedPayload);
    const baseSchema = input.restore?.schema ?? input.current.schema;
    let schema = DatasetSchemaRecordSchema.parse({ ...baseSchema, revisionId: input.identity.revisionId,
      createdAt: new Date().toISOString(), tables: baseSchema.tables.map((table) => table.id === input.tableId
        ? { ...table, columns: table.columns.map((column) => column.id === input.columnId
          ? { ...column, ...(input.logicalType ? { logicalType: input.logicalType } : {}), lookup: input.descriptor }
          : column) }
        : table) });
    const formulaStats = adoptPayload(stagedPayload, input.current.manifest.datasetId,
      input.restore?.revision.id ?? input.current.revision.id, input.identity.revisionId,
      input.restore ? undefined : { schema, tableId: input.tableId });
    if (!input.restore) schema = applyFormulaStats(schema, formulaStats);
    publishImmutableFile(stagedPayload, resolveBundleRelativePath(input.current.bundlePath, payloadRelativePath));
    writeJsonImmutable(resolveBundleRelativePath(input.current.bundlePath, schemaRelativePath), schema);
    const now = new Date().toISOString();
    const revision = DatasetRevisionSchema.parse({ ...(input.restore?.revision ?? input.current.revision), id: input.identity.revisionId,
      datasetId: input.current.manifest.datasetId, parentRevisionId: input.current.revision.id,
      schema: fileRef(input.current.bundlePath, schemaRelativePath),
      payload: { ...fileRef(input.current.bundlePath, payloadRelativePath), format: "sqlite" },
      operationId: input.identity.operationId, change: { ...input.change, tableId: input.tableId, columnId: input.columnId }, createdAt: now });
    writeJsonImmutable(resolveBundleRelativePath(input.current.bundlePath, revisionRelativePath), revision);
    replaceManifestCas(input.current, DatasetManifestSchema.parse({ ...input.current.manifest,
      initialRevision: input.current.manifest.initialRevision ?? input.current.manifest.activeRevision,
      activeRevision: revision.id, revision: fileRef(input.current.bundlePath, revisionRelativePath),
      schema: revision.schema, payload: revision.payload, updatedAt: now }));
    const adopted = readBundle(input.current.vaultPath, input.current.manifest.datasetId);
    if (!adopted || adopted.manifest.activeRevision !== revision.id) throw commitUncertain();
    return { binding: adopted, revision };
  } finally { fs.rmSync(stagedRoot, { recursive: true, force: true }); }
}

function adoptExisting(binding: BundleBinding, request: CollectionUpdateLookupColumnRequest, identity: LookupUpdateIdentity,
  readSnapshot: (binding: BundleBinding, tableId: string) => CollectionSnapshot | undefined,
  createOperation: (binding: BundleBinding, revision: DatasetRevision) => OperationRecord): CollectionUpdateLookupColumnResult | undefined {
  const revisionPath = resolveBundleRelativePath(binding.bundlePath, `revisions/${identity.revisionId}.json`);
  if (!fs.existsSync(revisionPath)) return undefined;
  const revision = DatasetRevisionSchema.parse(readJsonBounded(revisionPath, MAX_COLLECTION_JSON_BYTES));
  if (revision.id !== identity.revisionId || revision.operationId !== identity.operationId ||
      revision.parentRevisionId !== request.expectedRevisionId || revision.change?.kind !== "collection_lookup_update" ||
      revision.change.tableId !== request.tableId || revision.change.columnId !== request.columnId ||
      revision.change.relationColumnId !== request.relationColumnId || revision.change.targetColumnId !== request.targetColumnId) {
    throw requestConflict();
  }
  let current = binding;
  if (binding.manifest.activeRevision !== revision.id) {
    if (binding.manifest.activeRevision !== request.expectedRevisionId) {
      const snapshot = readSnapshot(binding, request.tableId);
      return snapshot ? CollectionUpdateLookupColumnResultSchema.parse({ ...resultIdentity(request), status: "stale", snapshot }) : undefined;
    }
    replaceManifestCas(binding, DatasetManifestSchema.parse({ ...binding.manifest,
      initialRevision: binding.manifest.initialRevision ?? binding.manifest.activeRevision,
      activeRevision: revision.id, revision: fileRef(binding.bundlePath, `revisions/${revision.id}.json`),
      schema: revision.schema, payload: revision.payload, updatedAt: revision.createdAt }));
    current = readBundle(binding.vaultPath, binding.manifest.datasetId) ?? binding;
  }
  const expected = createOperation(current, revision);
  const operationPath = operationPathFor(current.vaultPath, expected.id);
  const operation = fs.existsSync(operationPath) ? OperationRecordSchema.parse(readJsonBounded(operationPath, MAX_COLLECTION_JSON_BYTES)) : expected;
  if (hashCanonical(operation) !== hashCanonical(expected)) throw requestConflict();
  if (!fs.existsSync(operationPath)) writeJsonExclusive(operationPath, operation);
  const snapshot = readSnapshot(current, request.tableId);
  if (!snapshot) throw requestConflict();
  return CollectionUpdateLookupColumnResultSchema.parse({ ...resultIdentity(request), status: "committed", operationId: operation.id, snapshot });
}

function validateDescriptor(schema: DatasetSchemaRecord, table: DatasetSchemaRecord["tables"][number],
  request: CollectionUpdateLookupColumnRequest): { readonly descriptor: DatasetPigeLookup; readonly logicalType: DatasetColumn["logicalType"] } {
  const relation = table.columns.find((column) => column.id === request.relationColumnId)?.relation;
  if (relation?.kind !== "pige_single_relation") throw ineligible();
  const targetTable = schema.tables.find((candidate) => candidate.id === relation.targetTableId);
  const target = targetTable?.columns.find((column) => column.id === request.targetColumnId);
  if (!target || !isLookupTarget(target)) throw ineligible();
  return { descriptor: { kind: "pige_single_lookup", schemaVersion: 1,
    relationColumnId: request.relationColumnId, targetColumnId: request.targetColumnId }, logicalType: target.logicalType };
}

function requireLookup(schema: DatasetSchemaRecord, tableId: string, columnId: string): DatasetPigeLookup {
  const lookup = schema.tables.find((table) => table.id === tableId)?.columns.find((column) => column.id === columnId)?.lookup;
  if (lookup?.kind !== "pige_single_lookup") throw requestConflict();
  return lookup;
}
function isLookupTarget(column: DatasetColumn): boolean { return !column.calculation && !column.relation && !column.lookup && !column.rollup &&
  ["string", "integer", "number", "boolean", "date", "datetime"].includes(column.logicalType) &&
  ![column.sourceType, ...(column.sourceTypes ?? [])].some((value) => value.toLowerCase().includes("formula")); }
function adoptPayload(
  payloadPath: string,
  datasetId: string,
  beforeRevisionId: string,
  revisionId: string,
  recompute?: { readonly schema: DatasetSchemaRecord; readonly tableId: string }
): FormulaProjectionStatsByTable {
  const database = new DatabaseSync(payloadPath);
  let formulaStats: FormulaProjectionStatsByTable = new Map();
  try { database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;");
    validatePayloadMeta(database, datasetId, beforeRevisionId);
    if (recompute) formulaStats = recomputeAllFormulaRowsInTable(database, recompute.schema, recompute.tableId);
    if (database.prepare("UPDATE pige_dataset_meta SET value = ? WHERE key = 'revision_id'").run(revisionId).changes !== 1) throw payloadInvalid();
    database.exec("COMMIT");
    const row = database.prepare("PRAGMA integrity_check").get() as { integrity_check?: unknown } | undefined;
    if (row?.integrity_check !== "ok") throw payloadInvalid();
  } catch (caught) { try { database.exec("ROLLBACK"); } catch { /* no active transaction */ } throw caught; }
  finally { database.close(); syncFile(payloadPath); }
  return formulaStats;
}

function applyFormulaStats(schema: DatasetSchemaRecord, stats: FormulaProjectionStatsByTable): DatasetSchemaRecord {
  return DatasetSchemaRecordSchema.parse({ ...schema, tables: schema.tables.map((table) => ({
    ...table,
    columns: table.columns.map((column) => {
      const next = stats.get(table.id)?.get(column.id);
      return next ? { ...column, stats: next } : column;
    })
  })) });
}
function createIdentity(request: CollectionUpdateLookupColumnRequest): LookupUpdateIdentity {
  const dateKey = /^dataset_rev_(\d{8})_[a-z0-9]{12,}$/u.exec(request.expectedRevisionId)?.[1];
  if (!dateKey) throw requestConflict();
  return { revisionId: `dataset_rev_${dateKey}_${digest("pige:collection-lookup-update:v1", request.requestId).slice(0, 20)}`,
    operationId: `op_${dateKey}_${digest("pige:collection-lookup-update-operation:v1", request.requestId).slice(0, 20)}` };
}
function requireCurrent(binding: BundleBinding, revisionId: string): BundleBinding { const current = readBundle(binding.vaultPath, binding.manifest.datasetId);
  if (!current || current.manifest.activeRevision !== revisionId) throw new PigeDomainError("collection.revision_changed", "The Collection revision changed."); return current; }
function resultIdentity(request: CollectionUpdateLookupColumnRequest) { return { apiVersion: request.apiVersion, requestId: request.requestId,
  activeVaultId: request.activeVaultId, datasetId: request.datasetId, tableId: request.tableId, columnId: request.columnId,
  relationColumnId: request.relationColumnId, targetColumnId: request.targetColumnId }; }
function descriptorFields(value: DatasetPigeLookup) { return {
  relationColumnId: value.relationColumnId, targetColumnId: value.targetColumnId
}; }
function ineligible(): PigeDomainError { return new PigeDomainError("collection.lookup_ineligible", "The Collection lookup cannot be updated."); }
function commitUncertain(): PigeDomainError { return new PigeDomainError("collection.commit_uncertain", "The Collection lookup update could not be adopted."); }
function digest(...parts: readonly string[]): string { const hash = createHash("sha256"); for (const part of parts) hash.update(part).update("\0"); return hash.digest("hex"); }
