import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PigeDomainError } from "@pige/domain";
import {
  CollectionAppendDefaultRowResultSchema,
  CollectionTrashRowResultSchema,
  DatasetManifestSchema,
  DatasetRevisionSchema,
  DatasetSchemaRecordSchema,
  OperationRecordSchema,
  type CollectionAppendDefaultRowRequest,
  type CollectionAppendDefaultRowResult,
  type CollectionTrashRowRequest,
  type CollectionTrashRowResult,
  type CollectionSnapshot,
  type DatasetColumn,
  type DatasetRevision,
  type DatasetSchemaRecord
} from "@pige/schemas";
import {
  fileRef,
  hashCanonical,
  MAX_COLLECTION_JSON_BYTES,
  operationConflict,
  operationPathFor,
  payloadInvalid,
  publishImmutableFile,
  readBundle,
  readJsonRef,
  readJsonBounded,
  readRevisionById,
  replaceManifestCas,
  requestConflict,
  resolveBundleRelativePath,
  syncFile,
  validatePayloadMeta,
  writeJsonImmutable,
  writeJsonExclusive,
  type BundleBinding
} from "./managed-collection-storage";
import { appendFormulaCellsForNewRow, type FormulaProjectionStats } from "./managed-collection-formula-storage";
import { assertRelationTrashGuards } from "./managed-collection-relation-storage";
interface RowMutationIdentity {
  readonly revisionId: string;
  readonly operationId: string;
}
export function createDefaultRowMutationIdentity(request: CollectionAppendDefaultRowRequest): RowMutationIdentity {
  const dateKey = /^dataset_rev_(\d{8})_[a-z0-9]{12,}$/u.exec(request.expectedRevisionId)?.[1];
  if (!dateKey) throw requestConflict();
  return {
    revisionId: `dataset_rev_${dateKey}_${digest("pige:collection-row-add:v1", request.requestId).slice(0, 20)}`,
    operationId: `op_${dateKey}_${digest("pige:collection-row-add-operation:v1", request.requestId).slice(0, 20)}`
  };
}
export function createDefaultRowId(request: CollectionAppendDefaultRowRequest): string {
  return `row_${digest("pige:collection-row:v1", request.requestId).slice(0, 20)}`;
}
export function createRowTrashMutationIdentity(request: CollectionTrashRowRequest): RowMutationIdentity {
  const dateKey = /^dataset_rev_(\d{8})_[a-z0-9]{12,}$/u.exec(request.expectedRevisionId)?.[1];
  if (!dateKey) throw requestConflict();
  return {
    revisionId: `dataset_rev_${dateKey}_${digest("pige:collection-row-trash:v1", request.requestId).slice(0, 20)}`,
    operationId: `op_${dateKey}_${digest("pige:collection-row-trash-operation:v1", request.requestId).slice(0, 20)}`
  };
}
export function adoptDefaultRowAppend(input: {
  readonly binding: BundleBinding;
  readonly request: CollectionAppendDefaultRowRequest;
  readonly identity: RowMutationIdentity;
  readonly readSnapshot: (binding: BundleBinding, tableId: string) => CollectionSnapshot | undefined;
  readonly createOperation: (binding: BundleBinding, revision: DatasetRevision) => ReturnType<typeof OperationRecordSchema.parse>;
}): Partial<CollectionAppendDefaultRowResult> | undefined {
  const revisionPath = resolveBundleRelativePath(input.binding.bundlePath, `revisions/${input.identity.revisionId}.json`);
  const operationPath = operationPathFor(input.binding.vaultPath, input.identity.operationId);
  if (!fs.existsSync(revisionPath) && !fs.existsSync(operationPath)) return undefined;
  if (!fs.existsSync(revisionPath)) throw requestConflict();
  const revision = DatasetRevisionSchema.parse(readJsonBounded(revisionPath, MAX_COLLECTION_JSON_BYTES));
  const rowId = createDefaultRowId(input.request);
  if (revision.id !== input.identity.revisionId || revision.operationId !== input.identity.operationId ||
      revision.parentRevisionId !== input.request.expectedRevisionId || revision.change?.kind !== "collection_row_add" ||
      revision.change.tableId !== input.request.tableId || revision.change.rowId !== rowId) throw requestConflict();
  let committed = input.binding;
  if (input.binding.manifest.activeRevision !== revision.id) {
    if (input.binding.manifest.activeRevision !== input.request.expectedRevisionId) {
      const snapshot = input.readSnapshot(input.binding, input.request.tableId);
      return snapshot ? { status: "stale", snapshot } : { status: "not_found" };
    }
    replaceManifestCas(input.binding, DatasetManifestSchema.parse({
      ...input.binding.manifest,
      initialRevision: input.binding.manifest.initialRevision ?? input.binding.manifest.activeRevision,
      activeRevision: revision.id,
      revision: fileRef(input.binding.bundlePath, `revisions/${revision.id}.json`),
      schema: revision.schema,
      payload: revision.payload,
      updatedAt: revision.createdAt
    }));
    const adopted = readBundle(input.binding.vaultPath, input.binding.manifest.datasetId);
    if (!adopted || adopted.manifest.activeRevision !== revision.id) throw new PigeDomainError("collection.commit_uncertain", "The Collection replay could not be adopted.");
    committed = adopted;
  }
  const expectedOperation = input.createOperation(committed, revision);
  const operation = fs.existsSync(operationPath)
    ? OperationRecordSchema.parse(readJsonBounded(operationPath, MAX_COLLECTION_JSON_BYTES))
    : expectedOperation;
  if (hashCanonical(operation) !== hashCanonical(expectedOperation)) throw requestConflict();
  if (!fs.existsSync(operationPath)) writeJsonExclusive(operationPath, operation);
  const snapshot = input.readSnapshot(committed, input.request.tableId);
  const resultIdentity = {
    apiVersion: input.request.apiVersion,
    requestId: input.request.requestId,
    activeVaultId: input.request.activeVaultId,
    datasetId: input.request.datasetId,
    tableId: input.request.tableId
  };
  return CollectionAppendDefaultRowResultSchema.parse(snapshot
    ? { ...resultIdentity, status: "committed", rowId, operationId: operation.id, snapshot }
    : { ...resultIdentity, status: "not_found" });
}

export function adoptRowTrash(input: {
  readonly binding: BundleBinding;
  readonly request: CollectionTrashRowRequest;
  readonly identity: RowMutationIdentity;
  readonly readSnapshot: (binding: BundleBinding, tableId: string) => CollectionSnapshot | undefined;
  readonly createOperation: (binding: BundleBinding, revision: DatasetRevision) => ReturnType<typeof OperationRecordSchema.parse>;
}): Partial<CollectionTrashRowResult> | undefined {
  const revisionPath = resolveBundleRelativePath(input.binding.bundlePath, `revisions/${input.identity.revisionId}.json`);
  const operationPath = operationPathFor(input.binding.vaultPath, input.identity.operationId);
  if (!fs.existsSync(revisionPath) && !fs.existsSync(operationPath)) return undefined;
  if (!fs.existsSync(revisionPath)) throw requestConflict();
  const revision = DatasetRevisionSchema.parse(readJsonBounded(revisionPath, MAX_COLLECTION_JSON_BYTES));
  if (revision.id !== input.identity.revisionId || revision.operationId !== input.identity.operationId ||
      revision.parentRevisionId !== input.request.expectedRevisionId || revision.change?.kind !== "collection_row_trash" ||
      revision.change.tableId !== input.request.tableId || revision.change.rowId !== input.request.rowId) {
    throw requestConflict();
  }
  let committed = input.binding;
  if (input.binding.manifest.activeRevision !== revision.id) {
    if (input.binding.manifest.activeRevision !== input.request.expectedRevisionId) {
      const snapshot = input.readSnapshot(input.binding, input.request.tableId);
      return snapshot ? { status: "stale", snapshot } : { status: "not_found" };
    }
    replaceManifestCas(input.binding, DatasetManifestSchema.parse({
      ...input.binding.manifest,
      initialRevision: input.binding.manifest.initialRevision ?? input.binding.manifest.activeRevision,
      activeRevision: revision.id,
      revision: fileRef(input.binding.bundlePath, `revisions/${revision.id}.json`),
      schema: revision.schema,
      payload: revision.payload,
      updatedAt: revision.createdAt
    }));
    const adopted = readBundle(input.binding.vaultPath, input.binding.manifest.datasetId);
    if (!adopted || adopted.manifest.activeRevision !== revision.id) {
      throw new PigeDomainError("collection.commit_uncertain", "The Collection replay could not be adopted.");
    }
    committed = adopted;
  }
  const expectedOperation = input.createOperation(committed, revision);
  const operation = fs.existsSync(operationPath)
    ? OperationRecordSchema.parse(readJsonBounded(operationPath, MAX_COLLECTION_JSON_BYTES))
    : expectedOperation;
  if (hashCanonical(operation) !== hashCanonical(expectedOperation)) throw requestConflict();
  if (!fs.existsSync(operationPath)) writeJsonExclusive(operationPath, operation);
  const snapshot = input.readSnapshot(committed, input.request.tableId);
  return CollectionTrashRowResultSchema.parse(snapshot
    ? {
      apiVersion: input.request.apiVersion,
      requestId: input.request.requestId,
      activeVaultId: input.request.activeVaultId,
      datasetId: input.request.datasetId,
      tableId: input.request.tableId,
      rowId: input.request.rowId,
      status: "committed",
      operationId: operation.id,
      snapshot
    }
    : {
      apiVersion: input.request.apiVersion,
      requestId: input.request.requestId,
      activeVaultId: input.request.activeVaultId,
      datasetId: input.request.datasetId,
      tableId: input.request.tableId,
      rowId: input.request.rowId,
      status: "not_found"
    });
}

export function executeRowTrash(input: {
  readonly vaultPath: string;
  readonly request: CollectionTrashRowRequest;
  readonly isVaultActive: () => boolean;
  readonly readSnapshot: (binding: BundleBinding, tableId: string) => CollectionSnapshot | undefined;
  readonly createOperation: (binding: BundleBinding, revision: DatasetRevision) => ReturnType<typeof OperationRecordSchema.parse>;
}): CollectionTrashRowResult {
  const identity = {
    apiVersion: input.request.apiVersion,
    requestId: input.request.requestId,
    activeVaultId: input.request.activeVaultId,
    datasetId: input.request.datasetId,
    tableId: input.request.tableId,
    rowId: input.request.rowId
  } as const;
  try {
    const binding = readBundle(input.vaultPath, input.request.datasetId);
    if (!binding) return CollectionTrashRowResultSchema.parse({ ...identity, status: "not_found" });
    const mutationIdentity = createRowTrashMutationIdentity(input.request);
    const adopted = adoptRowTrash({
      binding,
      request: input.request,
      identity: mutationIdentity,
      readSnapshot: input.readSnapshot,
      createOperation: input.createOperation
    });
    if (adopted) return CollectionTrashRowResultSchema.parse({ ...identity, ...adopted });
    const snapshot = input.readSnapshot(binding, input.request.tableId);
    if (!snapshot) return CollectionTrashRowResultSchema.parse({ ...identity, status: "not_found" });
    if (binding.manifest.activeRevision !== input.request.expectedRevisionId) {
      return CollectionTrashRowResultSchema.parse({ ...identity, status: "stale", snapshot });
    }
    const row = snapshot.rows.find((candidate) => candidate.rowId === input.request.rowId);
    if (!row) return CollectionTrashRowResultSchema.parse({ ...identity, status: "not_found" });
    if (!row.canTrash) return CollectionTrashRowResultSchema.parse({ ...identity, status: "ineligible" });
    assertRelationTrashGuards({ binding, tableId: input.request.tableId, rowId: input.request.rowId });
    const committed = commitRowTrash({
      binding,
      identity: mutationIdentity,
      tableId: input.request.tableId,
      rowId: input.request.rowId,
      expectedRevisionId: input.request.expectedRevisionId
    });
    const operation = input.createOperation(committed.binding, committed.revision);
    writeJsonExclusive(operationPathFor(committed.binding.vaultPath, operation.id), operation);
    if (!input.isVaultActive()) return CollectionTrashRowResultSchema.parse({ ...identity, status: "not_found" });
    const nextSnapshot = input.readSnapshot(committed.binding, input.request.tableId);
    if (!nextSnapshot || nextSnapshot.revisionId !== committed.revision.id ||
        nextSnapshot.rows.some((candidate) => candidate.rowId === input.request.rowId)) throw operationConflict();
    return CollectionTrashRowResultSchema.parse({
      ...identity,
      status: "committed",
      operationId: operation.id,
      snapshot: nextSnapshot
    });
  } catch (caught) {
    if (caught instanceof PigeDomainError && caught.code === "collection.request_conflict") throw caught;
    const latest = readBundle(input.vaultPath, input.request.datasetId);
    const snapshot = latest ? input.readSnapshot(latest, input.request.tableId) : undefined;
    if (caught instanceof PigeDomainError && caught.code === "collection.relation_inbound") {
      return snapshot
        ? CollectionTrashRowResultSchema.parse({ ...identity, status: "ineligible", snapshot })
        : CollectionTrashRowResultSchema.parse({ ...identity, status: "not_found" });
    }
    return snapshot
      ? CollectionTrashRowResultSchema.parse({ ...identity, status: "stale", snapshot })
      : CollectionTrashRowResultSchema.parse({ ...identity, status: "not_found" });
  }
}

interface RowMutationInput {
  readonly binding: BundleBinding;
  readonly identity: RowMutationIdentity;
  readonly tableId: string;
  readonly rowId: string;
  readonly expectedRevisionId: string;
}
export function commitDefaultRowAppend(input: RowMutationInput): {
  readonly binding: BundleBinding;
  readonly revision: DatasetRevision;
} {
  const current = requireCurrent(input);
  const table = current.schema.tables.find((candidate) => candidate.id === input.tableId);
  if (!table || !table.columns.length || table.columns.some((column) => !column.calculation && (!column.nullable || usesFormula(column)))) {
    throw new PigeDomainError("collection.row_not_appendable", "The Collection cannot append a default row.");
  }
  let formulaStats: ReadonlyMap<string, FormulaProjectionStats> = new Map();
  return publishRowMutation({
    current,
    ...input,
    change: { kind: "collection_row_add" },
    createPayload: (payloadPath) => { formulaStats = appendNullRow(payloadPath, current, table, input); },
    createSchema: () => DatasetSchemaRecordSchema.parse({
      ...current.schema,
      revisionId: input.identity.revisionId,
      createdAt: new Date().toISOString(),
      tables: current.schema.tables.map((candidate) => candidate.id === table.id
        ? {
          ...candidate,
          rowCount: candidate.rowCount + 1,
          columns: candidate.columns.map((column) => {
            const added = formulaStats.get(column.id);
            return { ...column, ...(column.stats ? { stats: { ...column.stats,
              null: column.stats.null + (added?.null ?? 1), value: column.stats.value + (added?.value ?? 0) } } : {}) };
          })
        }
        : candidate)
    }),
    stats: {
      ...current.revision.stats,
      rowCount: current.revision.stats.rowCount + 1,
      cellCount: current.revision.stats.cellCount + table.columns.length
    }
  });
}
export function commitDefaultRowUndo(input: RowMutationInput & {
  readonly beforeRevisionId: string;
  readonly undoOfOperationId: string;
}): { readonly binding: BundleBinding; readonly revision: DatasetRevision } {
  const current = requireCurrent(input);
  const before = readRevisionById(current, input.beforeRevisionId);
  const schema = DatasetSchemaRecordSchema.parse(readJsonRef(current.bundlePath, before.schema));
  return publishRowMutation({
    current,
    ...input,
    sourcePayload: resolveBundleRelativePath(current.bundlePath, before.payload.path),
    change: { kind: "collection_row_add_undo", undoOfOperationId: input.undoOfOperationId },
    createPayload: (payloadPath) => rebindRevision(payloadPath, current.manifest.datasetId, before.id, input.identity.revisionId),
    createSchema: () => DatasetSchemaRecordSchema.parse({
      ...schema,
      revisionId: input.identity.revisionId,
      createdAt: new Date().toISOString()
    }),
    stats: before.stats
  });
}

export function commitRowTrash(input: RowMutationInput): {
  readonly binding: BundleBinding;
  readonly revision: DatasetRevision;
} {
  const current = requireCurrent(input);
  const table = current.schema.tables.find((candidate) => candidate.id === input.tableId);
  if (!table) throw new PigeDomainError("collection.table_not_found", "The Collection table is unavailable.");
  return publishRowMutation({
    current,
    ...input,
    change: { kind: "collection_row_trash" },
    createPayload: (payloadPath) => removeRow(payloadPath, current, table, input),
    createSchema: () => DatasetSchemaRecordSchema.parse({
      ...current.schema,
      revisionId: input.identity.revisionId,
      createdAt: new Date().toISOString(),
      tables: current.schema.tables.map((candidate) => candidate.id === table.id
        ? { ...candidate, rowCount: candidate.rowCount - 1, columns: decrementColumnStats(candidate.columns, current, input) }
        : candidate)
    }),
    stats: {
      ...current.revision.stats,
      rowCount: current.revision.stats.rowCount - 1,
      cellCount: current.revision.stats.cellCount - table.columns.length
    }
  });
}

export function commitRowTrashUndo(input: RowMutationInput & {
  readonly beforeRevisionId: string;
  readonly undoOfOperationId: string;
}): { readonly binding: BundleBinding; readonly revision: DatasetRevision } {
  const current = requireCurrent(input);
  const before = readRevisionById(current, input.beforeRevisionId);
  const schema = DatasetSchemaRecordSchema.parse(readJsonRef(current.bundlePath, before.schema));
  return publishRowMutation({
    current,
    ...input,
    sourcePayload: resolveBundleRelativePath(current.bundlePath, before.payload.path),
    change: { kind: "collection_row_trash_undo", undoOfOperationId: input.undoOfOperationId },
    createPayload: (payloadPath) => rebindRevision(payloadPath, current.manifest.datasetId, before.id, input.identity.revisionId),
    createSchema: () => DatasetSchemaRecordSchema.parse({
      ...schema,
      revisionId: input.identity.revisionId,
      createdAt: new Date().toISOString()
    }),
    stats: before.stats
  });
}

function requireCurrent(input: RowMutationInput): BundleBinding {
  const current = readBundle(input.binding.vaultPath, input.binding.manifest.datasetId);
  if (!current || current.manifest.activeRevision !== input.expectedRevisionId) {
    throw new PigeDomainError("collection.revision_changed", "The Collection revision changed before commit.");
  }
  return current;
}

function publishRowMutation(input: RowMutationInput & {
  readonly current: BundleBinding;
  readonly sourcePayload?: string;
  readonly change:
    | { readonly kind: "collection_row_add" }
    | { readonly kind: "collection_row_add_undo"; readonly undoOfOperationId: string }
    | { readonly kind: "collection_row_trash" }
    | { readonly kind: "collection_row_trash_undo"; readonly undoOfOperationId: string };
  readonly createPayload: (payloadPath: string) => void;
  readonly createSchema: () => DatasetSchemaRecord;
  readonly stats: DatasetRevision["stats"];
}): { readonly binding: BundleBinding; readonly revision: DatasetRevision } {
  const stagedRoot = path.join(input.current.bundlePath, ".staging", `${input.identity.revisionId}.${randomUUID()}`);
  const payloadPath = `data/revisions/${input.identity.revisionId}.sqlite`;
  const schemaPath = `schemas/${input.identity.revisionId}.json`;
  const revisionPath = `revisions/${input.identity.revisionId}.json`;
  const stagedPayload = path.join(stagedRoot, "payload.sqlite");
  fs.mkdirSync(stagedRoot, { recursive: true, mode: 0o700 });
  try {
    fs.copyFileSync(input.sourcePayload ?? input.current.payloadPath, stagedPayload);
    input.createPayload(stagedPayload);
    const schema = input.createSchema();
    publishImmutableFile(stagedPayload, resolveBundleRelativePath(input.current.bundlePath, payloadPath));
    writeJsonImmutable(resolveBundleRelativePath(input.current.bundlePath, schemaPath), schema);
    const now = new Date().toISOString();
    const revision = DatasetRevisionSchema.parse({
      ...input.current.revision,
      id: input.identity.revisionId,
      parentRevisionId: input.current.revision.id,
      schema: fileRef(input.current.bundlePath, schemaPath),
      payload: { ...fileRef(input.current.bundlePath, payloadPath), format: "sqlite" },
      stats: input.stats,
      operationId: input.identity.operationId,
      change: { ...input.change, tableId: input.tableId, rowId: input.rowId },
      createdAt: now
    });
    writeJsonImmutable(resolveBundleRelativePath(input.current.bundlePath, revisionPath), revision);
    replaceManifestCas(input.current, DatasetManifestSchema.parse({
      ...input.current.manifest,
      initialRevision: input.current.manifest.initialRevision ?? input.current.manifest.activeRevision,
      activeRevision: revision.id,
      revision: fileRef(input.current.bundlePath, revisionPath),
      schema: revision.schema,
      payload: revision.payload,
      updatedAt: now
    }));
    const binding = readBundle(input.current.vaultPath, input.current.manifest.datasetId);
    if (!binding || binding.manifest.activeRevision !== revision.id) throw new PigeDomainError("collection.commit_uncertain", "The Collection commit could not be adopted.");
    return { binding, revision };
  } finally {
    fs.rmSync(stagedRoot, { recursive: true, force: true });
  }
}
function appendNullRow(
  payloadPath: string,
  binding: BundleBinding,
  table: DatasetSchemaRecord["tables"][number],
  input: RowMutationInput
): ReadonlyMap<string, FormulaProjectionStats> {
  let formulaStats = new Map<string, FormulaProjectionStats>();
  const db = new DatabaseSync(payloadPath);
  try {
    db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    validatePayloadMeta(db, binding.manifest.datasetId, binding.revision.id);
    db.exec("BEGIN IMMEDIATE");
    try {
      const next = db.prepare("SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM pige_dataset_rows WHERE table_id = ?")
        .get(table.id) as { ordinal?: unknown } | undefined;
      if (typeof next?.ordinal !== "number" || !Number.isSafeInteger(next.ordinal)) throw payloadInvalid();
      db.prepare("INSERT INTO pige_dataset_rows VALUES (?, ?, ?, ?)").run(input.rowId, table.id, next.ordinal, next.ordinal + 1);
      const insertCell = db.prepare("INSERT INTO pige_dataset_cells VALUES (?, ?, 'null', 'pige_user_default', NULL, NULL, NULL, 'null', NULL, NULL, NULL)");
      const insertRelationCell = db.prepare("INSERT INTO pige_dataset_cells VALUES (?, ?, 'null', 'pige.relation.single', NULL, NULL, NULL, 'pige_relation_target_v1', 'null', NULL, NULL)");
      const insertLookupCell = db.prepare("INSERT INTO pige_dataset_cells VALUES (?, ?, 'null', 'pige.lookup.single', NULL, NULL, NULL, 'pige_lookup_derived_v1', 'null', NULL, NULL)");
      const updateColumn = db.prepare("UPDATE pige_dataset_columns SET stats_json = ? WHERE column_id = ? AND table_id = ?");
      for (const column of table.columns.filter((candidate) => !candidate.calculation)) {
        (column.relation ? insertRelationCell : column.lookup ? insertLookupCell : insertCell).run(input.rowId, column.id);
      }
      formulaStats = new Map(appendFormulaCellsForNewRow(db, table, input.rowId));
      for (const column of table.columns) {
        const stats = column.stats ?? { missing: 0, empty: 0, null: 0, value: 0 };
        const added = formulaStats.get(column.id);
        if (updateColumn.run(JSON.stringify({ ...stats, null: stats.null + (added?.null ?? 1),
          value: stats.value + (added?.value ?? 0) }), column.id, table.id).changes !== 1) throw payloadInvalid();
      }
      if (db.prepare("UPDATE pige_dataset_tables SET row_count = row_count + 1 WHERE table_id = ? AND row_count = ?")
        .run(table.id, table.rowCount).changes !== 1) throw payloadInvalid();
      if (db.prepare("UPDATE pige_dataset_meta SET value = ? WHERE key = 'revision_id'")
        .run(input.identity.revisionId).changes !== 1) throw payloadInvalid();
      db.exec("COMMIT");
    } catch (caught) {
      db.exec("ROLLBACK");
      throw caught;
    }
    assertIntegrity(db);
  } finally {
    db.close();
  }
  syncFile(payloadPath);
  return formulaStats;
}

function removeRow(
  payloadPath: string,
  binding: BundleBinding,
  table: DatasetSchemaRecord["tables"][number],
  input: RowMutationInput
): void {
  const db = new DatabaseSync(payloadPath);
  try {
    db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    validatePayloadMeta(db, binding.manifest.datasetId, binding.revision.id);
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare("SELECT table_id FROM pige_dataset_rows WHERE row_id = ?").get(input.rowId) as {
        table_id?: unknown;
      } | undefined;
      if (row?.table_id !== table.id) throw new PigeDomainError("collection.row_not_found", "The Collection row is unavailable.");
      const readCell = db.prepare("SELECT state FROM pige_dataset_cells WHERE row_id = ? AND column_id = ?");
      const updateColumn = db.prepare("UPDATE pige_dataset_columns SET stats_json = ? WHERE column_id = ? AND table_id = ?");
      for (const column of table.columns) {
        const cell = readCell.get(input.rowId, column.id) as { state?: unknown } | undefined;
        if (typeof cell?.state !== "string" || !["missing", "empty", "null", "value"].includes(cell.state)) {
          throw payloadInvalid();
        }
        const stats = column.stats ?? { missing: 0, empty: 0, null: 0, value: 0 };
        const key = cell.state as keyof typeof stats;
        if (stats[key] < 1 || updateColumn.run(JSON.stringify({ ...stats, [key]: stats[key] - 1 }), column.id, table.id).changes !== 1) {
          throw payloadInvalid();
        }
      }
      if (db.prepare("DELETE FROM pige_dataset_cells WHERE row_id = ?").run(input.rowId).changes !== table.columns.length) {
        throw payloadInvalid();
      }
      if (db.prepare("DELETE FROM pige_dataset_rows WHERE row_id = ? AND table_id = ?").run(input.rowId, table.id).changes !== 1) {
        throw payloadInvalid();
      }
      if (db.prepare("UPDATE pige_dataset_tables SET row_count = row_count - 1 WHERE table_id = ? AND row_count = ?")
        .run(table.id, table.rowCount).changes !== 1) throw payloadInvalid();
      if (db.prepare("UPDATE pige_dataset_meta SET value = ? WHERE key = 'revision_id'")
        .run(input.identity.revisionId).changes !== 1) throw payloadInvalid();
      db.exec("COMMIT");
    } catch (caught) {
      db.exec("ROLLBACK");
      throw caught;
    }
    assertIntegrity(db);
  } finally {
    db.close();
  }
  syncFile(payloadPath);
}

function decrementColumnStats(
  columns: readonly DatasetColumn[],
  binding: BundleBinding,
  input: RowMutationInput
): DatasetColumn[] {
  const db = openPayload(binding.payloadPath);
  try {
    return columns.map((column) => {
      const cell = db.prepare("SELECT state FROM pige_dataset_cells WHERE row_id = ? AND column_id = ?")
        .get(input.rowId, column.id) as { state?: unknown } | undefined;
      if (typeof cell?.state !== "string" || !["missing", "empty", "null", "value"].includes(cell.state)) {
        throw payloadInvalid();
      }
      const stats = column.stats ?? { missing: 0, empty: 0, null: 0, value: 0 };
      const key = cell.state as keyof typeof stats;
      if (stats[key] < 1) throw payloadInvalid();
      return { ...column, stats: { ...stats, [key]: stats[key] - 1 } };
    });
  } finally {
    db.close();
  }
}

function openPayload(payloadPath: string): DatabaseSync {
  const db = new DatabaseSync(payloadPath, { readOnly: true });
  db.exec("PRAGMA query_only=ON;");
  return db;
}

function rebindRevision(payloadPath: string, datasetId: string, beforeRevisionId: string, revisionId: string): void {
  const db = new DatabaseSync(payloadPath);
  try {
    db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;");
    validatePayloadMeta(db, datasetId, beforeRevisionId);
    if (db.prepare("UPDATE pige_dataset_meta SET value = ? WHERE key = 'revision_id'").run(revisionId).changes !== 1) throw payloadInvalid();
    assertIntegrity(db);
  } finally {
    db.close();
  }
  syncFile(payloadPath);
}

function assertIntegrity(database: DatabaseSync): void {
  const result = database.prepare("PRAGMA integrity_check").get() as { integrity_check?: unknown } | undefined;
  if (result?.integrity_check !== "ok") throw payloadInvalid();
}

function usesFormula(column: DatasetColumn): boolean {
  return [column.sourceType, ...(column.sourceTypes ?? [])].some((value) => value.toLowerCase().includes("formula"));
}

function digest(namespace: string, value: string): string {
  return createHash("sha256").update(namespace).update("\0").update(value).digest("hex");
}
