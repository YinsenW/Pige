import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PigeDomainError } from "@pige/domain";
import {
  CollectionAddRollupColumnRequestSchema,
  CollectionAddRollupColumnResultSchema,
  DatasetManifestSchema,
  DatasetPigeRelationCellSchema,
  DatasetRevisionSchema,
  DatasetSchemaRecordSchema,
  OperationRecordSchema,
  type CollectionAddRollupColumnRequest,
  type CollectionAddRollupColumnResult,
  type CollectionColumnSummary,
  type CollectionSnapshot,
  type DatasetColumn,
  type DatasetRevision,
  type OperationRecord
} from "@pige/schemas";
import {
  fileRef, hashCanonical, MAX_COLLECTION_JSON_BYTES, operationPathFor, payloadInvalid,
  parseCollectionCellValue, publishImmutableFile, readBundle, readJsonBounded, readJsonRef,
  readRevisionById, replaceManifestCas, requestConflict, resolveBundleRelativePath,
  syncFile, validatePayloadMeta, writeJsonExclusive, writeJsonImmutable,
  type BundleBinding, type CollectionCellBinding
} from "./managed-collection-storage";

const MAX_COLLECTION_COLUMNS = 32;
const ROLLUP_SOURCE_TYPE = "pige.rollup.single";
const ROLLUP_PROJECTION_KIND = "pige_rollup_derived_v1";

interface RollupMutationIdentity {
  readonly revisionId: string;
  readonly operationId: string;
  readonly columnId: string;
}

export function projectRollupColumns(
  columns: readonly DatasetColumn[],
  allColumns: readonly DatasetColumn[],
  base: readonly CollectionColumnSummary[]
): readonly CollectionColumnSummary[] {
  const dependencies = new Set(allColumns.flatMap((column) => column.rollup
    ? [column.rollup.relationColumnId, ...(column.rollup.targetColumnId ? [column.rollup.targetColumnId] : [])]
    : []));
  return base.map((summary) => {
    const column = columns.find((candidate) => candidate.id === summary.columnId);
    if (!column) throw payloadInvalid();
    const numeric = isRollupTarget(column);
    return {
      ...summary,
      canTrash: summary.canTrash && !dependencies.has(column.id),
      canUseAsFormulaOperand: summary.canUseAsFormulaOperand && !column.rollup,
      canUseAsRelationDisplay: summary.canUseAsRelationDisplay && !column.rollup,
      canUseAsLookupTarget: summary.canUseAsLookupTarget && !column.rollup,
      canUseAsRollupTarget: numeric,
      ...(column.rollup ? { rollup: column.rollup } : {})
    };
  });
}

export function readRollupCellValue(
  database: DatabaseSync,
  schema: BundleBinding["schema"],
  rowId: string,
  column: DatasetColumn
): number | null {
  const rollup = column.rollup;
  const sourceTable = schema.tables.find((table) => table.columns.some((candidate) => candidate.id === column.id));
  const relationColumn = sourceTable?.columns.find((candidate) => candidate.id === rollup?.relationColumnId);
  const relation = relationColumn?.relation;
  const targetTable = relation ? schema.tables.find((table) => table.id === relation.targetTableId) : undefined;
  const targetColumn = rollup?.targetColumnId
    ? targetTable?.columns.find((candidate) => candidate.id === rollup.targetColumnId)
    : undefined;
  if (!rollup || !sourceTable || !relationColumn || !relation || !targetTable ||
      (rollup.aggregation === "sum" && (!targetColumn || !isRollupTarget(targetColumn)))) throw payloadInvalid();
  const relationRaw = database.prepare(
    "SELECT state, projection_kind, projection_json, formula_json FROM pige_dataset_cells WHERE row_id = ? AND column_id = ?"
  ).get(rowId, relationColumn.id) as Record<string, unknown> | undefined;
  if (!relationRaw) throw payloadInvalid();
  const relationCell = parseRawCell(relationColumn, relationRaw);
  if (relationCell.state === "null" && relationCell.projectionJson === "null") {
    return rollup.aggregation === "count" ? 0 : null;
  }
  if (relationCell.state !== "value" || relationCell.projectionJson === null) throw payloadInvalid();
  const relationTarget = DatasetPigeRelationCellSchema.parse(JSON.parse(relationCell.projectionJson));
  if (!relationTarget) throw payloadInvalid();
  const targetRow = database.prepare("SELECT table_id FROM pige_dataset_rows WHERE row_id = ?")
    .get(relationTarget.targetRowId) as { table_id?: unknown } | undefined;
  if (targetRow?.table_id !== targetTable.id) return rollup.aggregation === "count" ? 0 : null;
  if (rollup.aggregation === "count") return 1;
  const raw = database.prepare(
    "SELECT state, projection_kind, projection_json, formula_json FROM pige_dataset_cells WHERE row_id = ? AND column_id = ?"
  ).get(relationTarget.targetRowId, targetColumn!.id) as Record<string, unknown> | undefined;
  if (!raw) return null;
  const value = parseCollectionCellValue(parseRawCell(targetColumn!, raw), targetColumn!.logicalType);
  return typeof value === "number" && Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
}

export function executeRollupAdd(input: {
  readonly vaultPath?: string;
  readonly request: CollectionAddRollupColumnRequest;
  readonly isVaultActive: () => boolean;
  readonly readSnapshot: (binding: BundleBinding, tableId: string) => CollectionSnapshot | undefined;
  readonly createOperation: (binding: BundleBinding, revision: DatasetRevision) => OperationRecord;
}): CollectionAddRollupColumnResult {
  const request = CollectionAddRollupColumnRequestSchema.parse(input.request);
  const identity = resultIdentity(request);
  if (!input.vaultPath) return CollectionAddRollupColumnResultSchema.parse({ ...identity, status: "not_found" });
  try {
    const binding = readBundle(input.vaultPath, request.datasetId);
    if (!binding) return CollectionAddRollupColumnResultSchema.parse({ ...identity, status: "not_found" });
    const mutation = createRollupIdentity(request);
    const adopted = adoptRollupAdd(binding, request, mutation, input.readSnapshot, input.createOperation);
    if (adopted) return adopted;
    const snapshot = input.readSnapshot(binding, request.tableId);
    if (!snapshot) return CollectionAddRollupColumnResultSchema.parse({ ...identity, status: "not_found" });
    if (binding.manifest.activeRevision !== request.expectedRevisionId) {
      return CollectionAddRollupColumnResultSchema.parse({ ...identity, status: "stale", snapshot });
    }
    const committed = commitRollupAdd(binding, request, mutation);
    const operation = input.createOperation(committed.binding, committed.revision);
    writeJsonExclusive(operationPathFor(committed.binding.vaultPath, operation.id), operation);
    if (!input.isVaultActive()) return CollectionAddRollupColumnResultSchema.parse({ ...identity, status: "not_found" });
    const next = input.readSnapshot(committed.binding, request.tableId);
    if (!next) throw payloadInvalid();
    return CollectionAddRollupColumnResultSchema.parse({
      ...identity, status: "committed", columnId: mutation.columnId, operationId: operation.id, snapshot: next
    });
  } catch (caught) {
    if (caught instanceof PigeDomainError && caught.code === "collection.request_conflict") throw caught;
    const current = input.vaultPath ? readBundle(input.vaultPath, request.datasetId) : undefined;
    const snapshot = current ? input.readSnapshot(current, request.tableId) : undefined;
    if (snapshot && current?.manifest.activeRevision !== request.expectedRevisionId) {
      return CollectionAddRollupColumnResultSchema.parse({ ...identity, status: "stale", snapshot });
    }
    return CollectionAddRollupColumnResultSchema.parse({
      ...identity, status: caught instanceof PigeDomainError ? "ineligible" : "failed"
    });
  }
}

export function commitRollupUndoOperation(input: {
  readonly binding: BundleBinding;
  readonly identity: { readonly revisionId: string; readonly operationId: string };
  readonly afterRevisionId: string;
  readonly beforeRevisionId: string;
  readonly undoOfOperationId: string;
  readonly createOperation: (binding: BundleBinding, revision: DatasetRevision) => OperationRecord;
}): { readonly revision: DatasetRevision; readonly operation: OperationRecord } {
  const current = requireCurrent(input.binding, input.afterRevisionId);
  const after = readRevisionById(current, input.afterRevisionId);
  const before = readRevisionById(current, input.beforeRevisionId);
  if (after.change?.kind !== "collection_rollup_add" || after.parentRevisionId !== before.id) throw requestConflict();
  const beforeSchema = DatasetSchemaRecordSchema.parse(readJsonRef(current.bundlePath, before.schema));
  const committed = publishMutation({
    current,
    identity: { ...input.identity, columnId: after.change.columnId },
    tableId: after.change.tableId,
    columnId: after.change.columnId,
    change: {
      kind: "collection_rollup_add_undo", relationColumnId: after.change.relationColumnId,
      aggregation: after.change.aggregation, ...(after.change.targetColumnId ? { targetColumnId: after.change.targetColumnId } : {}),
      undoOfOperationId: input.undoOfOperationId
    },
    mutate: (database) => {
      if (database.prepare("UPDATE pige_dataset_meta SET value = ? WHERE key = 'revision_id'")
        .run(input.identity.revisionId).changes !== 1) throw payloadInvalid();
    },
    sourcePayload: resolveBundleRelativePath(current.bundlePath, before.payload.path),
    sourceRevisionId: before.id,
    schema: DatasetSchemaRecordSchema.parse({
      ...beforeSchema, revisionId: input.identity.revisionId, createdAt: new Date().toISOString()
    }),
    stats: before.stats
  });
  const operation = input.createOperation(committed.binding, committed.revision);
  writeJsonExclusive(operationPathFor(committed.binding.vaultPath, operation.id), operation);
  return { revision: committed.revision, operation };
}

export function assertRollupTrashGuards(input: {
  readonly binding: BundleBinding;
  readonly tableId: string;
  readonly columnId: string;
}): void {
  const current = requireCurrent(input.binding, input.binding.manifest.activeRevision);
  const table = current.schema.tables.find((candidate) => candidate.id === input.tableId);
  if (!table?.columns.some((candidate) => candidate.id === input.columnId)) {
    throw new PigeDomainError("collection.column_not_found", "The Collection column is unavailable.");
  }
  if (current.schema.tables.some((candidate) => candidate.columns.some((column) =>
    column.rollup?.relationColumnId === input.columnId || column.rollup?.targetColumnId === input.columnId))) {
    throw new PigeDomainError("collection.rollup_inbound", "The Collection column is required by a rollup.");
  }
}

function commitRollupAdd(binding: BundleBinding, request: CollectionAddRollupColumnRequest,
  identity: RollupMutationIdentity): { readonly binding: BundleBinding; readonly revision: DatasetRevision } {
  const current = requireCurrent(binding, request.expectedRevisionId);
  const table = current.schema.tables.find((candidate) => candidate.id === request.tableId);
  const relationColumn = table?.columns.find((candidate) => candidate.id === request.relationColumnId);
  const targetTable = relationColumn?.relation
    ? current.schema.tables.find((candidate) => candidate.id === relationColumn.relation?.targetTableId)
    : undefined;
  const targetColumn = request.targetColumnId
    ? targetTable?.columns.find((candidate) => candidate.id === request.targetColumnId)
    : undefined;
  if (!table || !relationColumn?.relation || !targetTable || table.columns.length >= MAX_COLLECTION_COLUMNS ||
      table.columns.some((column) => normalize(column.name) === normalize(request.label)) ||
      (request.aggregation === "sum" && (!targetColumn || !isRollupTarget(targetColumn)))) {
    throw new PigeDomainError("collection.rollup_ineligible", "The rollup descriptor is ineligible.");
  }
  const rollup = {
    kind: "pige_single_rollup" as const, schemaVersion: 1 as const,
    relationColumnId: relationColumn.id, aggregation: request.aggregation,
    ...(targetColumn ? { targetColumnId: targetColumn.id } : {})
  };
  const column: DatasetColumn = {
    id: identity.columnId, name: request.label.trim(), ordinal: table.columns.length,
    sourceType: ROLLUP_SOURCE_TYPE, sourceTypes: [ROLLUP_SOURCE_TYPE], logicalType: "number", nullable: true,
    rollup, stats: { missing: 0, empty: 0, null: table.rowCount, value: 0 }
  };
  return publishMutation({
    current, identity, tableId: table.id, columnId: column.id,
    change: { kind: "collection_rollup_add", relationColumnId: relationColumn.id,
      aggregation: request.aggregation, ...(targetColumn ? { targetColumnId: targetColumn.id } : {}) },
    mutate: (database) => addRollupColumn(database, table, column, identity.revisionId),
    schema: DatasetSchemaRecordSchema.parse({
      ...current.schema, revisionId: identity.revisionId, createdAt: new Date().toISOString(),
      tables: current.schema.tables.map((candidate) => candidate.id === table.id
        ? { ...candidate, columnCount: candidate.columnCount + 1, columns: [...candidate.columns, column] }
        : candidate)
    }),
    stats: { ...current.revision.stats, columnCount: current.revision.stats.columnCount + 1,
      cellCount: current.revision.stats.cellCount + table.rowCount }
  });
}

function publishMutation(input: {
  readonly current: BundleBinding;
  readonly identity: RollupMutationIdentity;
  readonly tableId: string;
  readonly columnId: string;
  readonly change: Record<string, unknown> & { readonly kind: "collection_rollup_add" | "collection_rollup_add_undo" };
  readonly mutate: (database: DatabaseSync) => void;
  readonly sourcePayload?: string;
  readonly sourceRevisionId?: string;
  readonly schema: BundleBinding["schema"];
  readonly stats: DatasetRevision["stats"];
}): { readonly binding: BundleBinding; readonly revision: DatasetRevision } {
  const stagedRoot = path.join(input.current.bundlePath, ".staging", `${input.identity.revisionId}.${randomUUID()}`);
  const payloadRelativePath = `data/revisions/${input.identity.revisionId}.sqlite`;
  const schemaRelativePath = `schemas/${input.identity.revisionId}.json`;
  const revisionRelativePath = `revisions/${input.identity.revisionId}.json`;
  const stagedPayload = path.join(stagedRoot, "payload.sqlite");
  fs.mkdirSync(stagedRoot, { recursive: true, mode: 0o700 });
  try {
    fs.copyFileSync(input.sourcePayload ?? input.current.payloadPath, stagedPayload);
    const database = new DatabaseSync(stagedPayload);
    try {
      database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
      validatePayloadMeta(database, input.current.manifest.datasetId, input.sourceRevisionId ?? input.current.revision.id);
      database.exec("BEGIN IMMEDIATE");
      try { input.mutate(database); database.exec("COMMIT"); } catch (caught) { database.exec("ROLLBACK"); throw caught; }
    } finally { database.close(); syncFile(stagedPayload); }
    publishImmutableFile(stagedPayload, resolveBundleRelativePath(input.current.bundlePath, payloadRelativePath));
    writeJsonImmutable(resolveBundleRelativePath(input.current.bundlePath, schemaRelativePath), input.schema);
    const now = new Date().toISOString();
    const revision = DatasetRevisionSchema.parse({
      ...input.current.revision, id: input.identity.revisionId, parentRevisionId: input.current.revision.id,
      schema: fileRef(input.current.bundlePath, schemaRelativePath),
      payload: { ...fileRef(input.current.bundlePath, payloadRelativePath), format: "sqlite" },
      stats: input.stats, operationId: input.identity.operationId,
      change: { ...input.change, tableId: input.tableId, columnId: input.columnId }, createdAt: now
    });
    writeJsonImmutable(resolveBundleRelativePath(input.current.bundlePath, revisionRelativePath), revision);
    replaceManifestCas(input.current, DatasetManifestSchema.parse({
      ...input.current.manifest, initialRevision: input.current.manifest.initialRevision ?? input.current.manifest.activeRevision,
      activeRevision: revision.id, revision: fileRef(input.current.bundlePath, revisionRelativePath),
      schema: revision.schema, payload: revision.payload, updatedAt: now
    }));
    const binding = readBundle(input.current.vaultPath, input.current.manifest.datasetId);
    if (!binding || binding.manifest.activeRevision !== revision.id) throw new PigeDomainError("collection.commit_uncertain", "The rollup commit could not be adopted.");
    return { binding, revision };
  } finally { fs.rmSync(stagedRoot, { recursive: true, force: true }); }
}

function addRollupColumn(database: DatabaseSync, table: BundleBinding["schema"]["tables"][number],
  column: DatasetColumn, revisionId: string): void {
  database.prepare("INSERT INTO pige_dataset_columns VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    column.id, table.id, column.ordinal, column.name, "derived", JSON.stringify(column.sourceTypes), JSON.stringify(column.stats)
  );
  const rows = database.prepare("SELECT row_id FROM pige_dataset_rows WHERE table_id = ? ORDER BY ordinal").all(table.id) as Array<{ row_id?: unknown }>;
  if (rows.length !== table.rowCount) throw payloadInvalid();
  const insert = database.prepare([
    "INSERT INTO pige_dataset_cells",
    "(row_id, column_id, state, source_type, lexical_raw, lexical_text, quoted, projection_kind, projection_json, formula_json, source_style_json)",
    "VALUES (?, ?, 'null', ?, NULL, NULL, NULL, ?, 'null', NULL, NULL)"
  ].join(" "));
  for (const row of rows) {
    if (typeof row.row_id !== "string" || insert.run(row.row_id, column.id, ROLLUP_SOURCE_TYPE, ROLLUP_PROJECTION_KIND).changes !== 1) throw payloadInvalid();
  }
  if (database.prepare("UPDATE pige_dataset_tables SET column_count = column_count + 1 WHERE table_id = ? AND column_count = ?")
    .run(table.id, table.columnCount).changes !== 1 ||
    database.prepare("UPDATE pige_dataset_meta SET value = ? WHERE key = 'revision_id'").run(revisionId).changes !== 1) throw payloadInvalid();
}

function adoptRollupAdd(binding: BundleBinding, request: CollectionAddRollupColumnRequest,
  identity: RollupMutationIdentity,
  readSnapshot: (binding: BundleBinding, tableId: string) => CollectionSnapshot | undefined,
  createOperation: (binding: BundleBinding, revision: DatasetRevision) => OperationRecord
): CollectionAddRollupColumnResult | undefined {
  const revisionPath = resolveBundleRelativePath(binding.bundlePath, `revisions/${identity.revisionId}.json`);
  if (!fs.existsSync(revisionPath)) return undefined;
  const revision = DatasetRevisionSchema.parse(readJsonBounded(revisionPath, MAX_COLLECTION_JSON_BYTES));
  if (revision.id !== identity.revisionId || revision.operationId !== identity.operationId ||
      revision.parentRevisionId !== request.expectedRevisionId || revision.change?.kind !== "collection_rollup_add" ||
      revision.change.tableId !== request.tableId || revision.change.columnId !== identity.columnId ||
      revision.change.relationColumnId !== request.relationColumnId || revision.change.aggregation !== request.aggregation ||
      revision.change.targetColumnId !== request.targetColumnId) throw requestConflict();
  let current = binding;
  if (current.manifest.activeRevision !== revision.id) {
    if (current.manifest.activeRevision !== request.expectedRevisionId) throw requestConflict();
    replaceManifestCas(current, DatasetManifestSchema.parse({
      ...current.manifest, initialRevision: current.manifest.initialRevision ?? current.manifest.activeRevision,
      activeRevision: revision.id, revision: fileRef(current.bundlePath, `revisions/${revision.id}.json`),
      schema: revision.schema, payload: revision.payload, updatedAt: revision.createdAt
    }));
    const next = readBundle(current.vaultPath, current.manifest.datasetId);
    if (!next || next.manifest.activeRevision !== revision.id) throw requestConflict();
    current = next;
  }
  const expectedOperation = createOperation(current, revision);
  const operationPath = operationPathFor(current.vaultPath, expectedOperation.id);
  const operation = fs.existsSync(operationPath)
    ? OperationRecordSchema.parse(readJsonBounded(operationPath, MAX_COLLECTION_JSON_BYTES))
    : expectedOperation;
  if (hashCanonical(operation) !== hashCanonical(expectedOperation)) throw requestConflict();
  if (!fs.existsSync(operationPath)) writeJsonExclusive(operationPath, operation);
  const snapshot = readSnapshot(current, request.tableId);
  if (!snapshot) throw requestConflict();
  return CollectionAddRollupColumnResultSchema.parse({
    ...resultIdentity(request), status: "committed", columnId: identity.columnId,
    operationId: operation.id, snapshot
  });
}

function parseRawCell(column: DatasetColumn, raw: Record<string, unknown>): Omit<CollectionCellBinding, "tableName"> {
  if (typeof raw.state !== "string" || typeof raw.projection_kind !== "string" ||
      !(typeof raw.projection_json === "string" || raw.projection_json === null) ||
      !(typeof raw.formula_json === "string" || raw.formula_json === null)) throw payloadInvalid();
  return { column, state: raw.state, projectionKind: raw.projection_kind,
    projectionJson: raw.projection_json, formulaJson: raw.formula_json };
}

function isRollupTarget(column: DatasetColumn): boolean {
  return !column.calculation && !column.relation && !column.lookup && !column.rollup &&
    ![column.sourceType, ...(column.sourceTypes ?? [])].some((value) => value.toLowerCase().includes("formula")) &&
    (column.logicalType === "integer" || column.logicalType === "number");
}

function createRollupIdentity(request: CollectionAddRollupColumnRequest): RollupMutationIdentity {
  const dateKey = /^dataset_rev_(\d{8})_[a-z0-9]{12,}$/u.exec(request.expectedRevisionId)?.[1];
  if (!dateKey) throw requestConflict();
  return {
    revisionId: `dataset_rev_${dateKey}_${digest("pige:collection-rollup-add:v1", request.requestId).slice(0, 20)}`,
    operationId: `op_${dateKey}_${digest("pige:collection-rollup-add-operation:v1", request.requestId).slice(0, 20)}`,
    columnId: `column_${digest("pige:collection-rollup-column:v1", request.tableId, request.requestId).slice(0, 20)}`
  };
}

function requireCurrent(binding: BundleBinding, revisionId: string): BundleBinding {
  const current = readBundle(binding.vaultPath, binding.manifest.datasetId);
  if (!current || current.manifest.activeRevision !== revisionId) throw new PigeDomainError("collection.revision_changed", "The Collection revision changed.");
  return current;
}
function resultIdentity(request: CollectionAddRollupColumnRequest) { return {
  apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
  datasetId: request.datasetId, tableId: request.tableId, relationColumnId: request.relationColumnId,
  aggregation: request.aggregation, ...(request.targetColumnId ? { targetColumnId: request.targetColumnId } : {})
}; }
function normalize(value: string): string { return value.trim().normalize("NFC").toLocaleLowerCase("en-US"); }
function digest(...parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
}
