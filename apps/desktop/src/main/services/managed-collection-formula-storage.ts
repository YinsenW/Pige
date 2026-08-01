import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PigeDomainError } from "@pige/domain";
import {
  CollectionAddFormulaColumnRequestSchema,
  CollectionAddFormulaColumnResultSchema,
  DatasetManifestSchema,
  DatasetPigeFormulaExpressionSchema,
  DatasetPigeRelationCellSchema,
  DatasetRevisionSchema,
  DatasetSchemaRecordSchema,
  OperationRecordSchema,
  type CollectionAddFormulaColumnRequest,
  type CollectionAddFormulaColumnResult,
  type CollectionColumnSummary,
  type CollectionScalarValue,
  type CollectionSnapshot,
  type DatasetColumn,
  type DatasetPigeFormulaExpression,
  type DatasetLogicalType,
  type DatasetRevision,
  type DatasetSchemaRecord,
  type OperationRecord
} from "@pige/schemas";
import {
  fileRef,
  hashCanonical,
  MAX_COLLECTION_JSON_BYTES,
  operationPathFor,
  payloadInvalid,
  publishImmutableFile,
  readBundle,
  readCollectionCell,
  readJsonBounded,
  readJsonRef,
  replaceManifestCas,
  requestConflict,
  resolveBundleRelativePath,
  syncFile,
  validatePayloadMeta,
  writeJsonExclusive,
  writeJsonImmutable,
  type BundleBinding, type CollectionCellBinding
} from "./managed-collection-storage";
import {
  assertFormulaGraph,
  formulaReferencedColumnIds,
  isEligibleFormulaOperand,
  isPigeFormulaColumn
} from "./managed-collection-formula-graph";

export { formulaReferencedColumnIds } from "./managed-collection-formula-graph";

const MAX_COLLECTION_COLUMNS = 32;
const FORMULA_SOURCE_TYPE = "pige_numeric_formula_v1";

export interface FormulaColumnMutationIdentity {
  readonly revisionId: string;
  readonly operationId: string;
  readonly columnId: string;
  readonly expressionIdentity: string;
}

export interface FormulaProjectionStats {
  readonly missing: 0;
  readonly empty: 0;
  readonly null: number;
  readonly value: number;
}

export type FormulaProjectionStatsByTable = ReadonlyMap<
  string,
  ReadonlyMap<string, FormulaProjectionStats>
>;

export type FormulaOperandReader = (columnId: string) => number | null | undefined | "";

export function evaluateFormulaExpression(
  expression: DatasetPigeFormulaExpression,
  readOperand: FormulaOperandReader
): number | null {
  const parsed = DatasetPigeFormulaExpressionSchema.parse(expression);
  const evaluate = (node: DatasetPigeFormulaExpression): number | null => {
    if (node.kind === "column") return normalizeOperand(readOperand(node.columnId));
    if (node.kind === "literal") return normalizeNumber(node.value);
    const left = evaluate(node.left);
    const right = evaluate(node.right);
    if (left === null || right === null || (node.operator === "divide" && right === 0)) return null;
    const value = node.operator === "add"
      ? left + right
      : node.operator === "subtract"
        ? left - right
        : node.operator === "multiply"
          ? left * right
          : left / right;
    return normalizeNumber(value);
  };
  return evaluate(parsed);
}

export function canonicalFormulaExpressionIdentity(expression: DatasetPigeFormulaExpression): string {
  return hashCanonical(DatasetPigeFormulaExpressionSchema.parse(expression));
}

export function createFormulaColumnId(tableId: string, requestId: string): string {
  return `column_${digest("pige:collection-formula-column:v1", tableId, requestId).slice(0, 20)}`;
}

export function createFormulaMutationIdentity(
  rawRequest: CollectionAddFormulaColumnRequest
): FormulaColumnMutationIdentity {
  const request = CollectionAddFormulaColumnRequestSchema.parse(rawRequest);
  const dateKey = /^dataset_rev_(\d{8})_[a-z0-9]{12,}$/u.exec(request.expectedRevisionId)?.[1];
  if (!dateKey) throw requestConflict();
  const expressionIdentity = canonicalFormulaExpressionIdentity(request.expression);
  return {
    revisionId: `dataset_rev_${dateKey}_${digest("pige:collection-formula-revision:v1", request.requestId).slice(0, 20)}`,
    operationId: `op_${dateKey}_${digest("pige:collection-formula-operation:v1", request.requestId).slice(0, 20)}`,
    columnId: createFormulaColumnId(request.tableId, request.requestId),
    expressionIdentity
  };
}

export function adoptFormulaColumnMutation(input: {
  readonly binding: BundleBinding;
  readonly request: CollectionAddFormulaColumnRequest;
  readonly identity: FormulaColumnMutationIdentity;
  readonly readSnapshot: (binding: BundleBinding, tableId: string) => CollectionSnapshot | undefined;
  readonly createOperation: (
    binding: BundleBinding,
    revision: DatasetRevision
  ) => ReturnType<typeof OperationRecordSchema.parse>;
}): Partial<CollectionAddFormulaColumnResult> | undefined {
  const request = CollectionAddFormulaColumnRequestSchema.parse(input.request);
  const revisionPath = resolveBundleRelativePath(input.binding.bundlePath, `revisions/${input.identity.revisionId}.json`);
  if (!fs.existsSync(revisionPath)) return undefined;
  const revision = DatasetRevisionSchema.parse(readJsonBounded(revisionPath, MAX_COLLECTION_JSON_BYTES));
  assertFormulaRevision(input.binding, request, input.identity, revision);
  let committed = input.binding;
  if (input.binding.manifest.activeRevision !== revision.id) {
    if (input.binding.manifest.activeRevision !== request.expectedRevisionId) throw requestConflict();
    replaceManifestCas(input.binding, nextManifest(input.binding, revision));
    const adopted = readBundle(input.binding.vaultPath, input.binding.manifest.datasetId);
    if (!adopted || adopted.manifest.activeRevision !== revision.id) {
      throw new PigeDomainError("collection.commit_uncertain", "The Collection formula replay could not be adopted.");
    }
    committed = adopted;
  }
  const expectedOperation = input.createOperation(committed, revision);
  const operationPath = operationPathFor(committed.vaultPath, expectedOperation.id);
  const operation = fs.existsSync(operationPath)
    ? OperationRecordSchema.parse(readJsonBounded(operationPath, MAX_COLLECTION_JSON_BYTES))
    : expectedOperation;
  if (hashCanonical(operation) !== hashCanonical(expectedOperation)) throw requestConflict();
  if (!fs.existsSync(operationPath)) writeJsonExclusive(operationPath, operation);
  const snapshot = input.readSnapshot(committed, request.tableId);
  return snapshot
    ? CollectionAddFormulaColumnResultSchema.parse({
      apiVersion: request.apiVersion,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      datasetId: request.datasetId,
      tableId: request.tableId,
      status: "committed",
      columnId: input.identity.columnId,
      operationId: operation.id,
      snapshot
    })
    : { status: "not_found" };
}

export function commitFormulaColumnAdd(input: {
  readonly binding: BundleBinding;
  readonly request: CollectionAddFormulaColumnRequest;
  readonly identity: FormulaColumnMutationIdentity;
}): { readonly binding: BundleBinding; readonly revision: DatasetRevision } {
  const request = CollectionAddFormulaColumnRequestSchema.parse(input.request);
  if (input.identity.expressionIdentity !== canonicalFormulaExpressionIdentity(request.expression)) throw requestConflict();
  const current = readBundle(input.binding.vaultPath, input.binding.manifest.datasetId);
  if (!current || current.manifest.activeRevision !== request.expectedRevisionId) {
    throw new PigeDomainError("collection.revision_changed", "The Collection revision changed before formula commit.");
  }
  const table = current.schema.tables.find((candidate) => candidate.id === request.tableId);
  if (!table) throw new PigeDomainError("collection.table_not_found", "The Collection table is unavailable.");
  if (table.columns.length >= MAX_COLLECTION_COLUMNS) {
    throw new PigeDomainError("collection.column_limit", "The Collection column limit was reached.");
  }
  const normalizedLabel = normalizeLabel(request.label);
  if (table.columns.some((column) => normalizeLabel(column.name) === normalizedLabel)) {
    throw new PigeDomainError("collection.duplicate_label", "The Collection already has this column label.");
  }
  assertEligibleOperands(table, request.expression);

  const stagedRoot = path.join(current.bundlePath, ".staging", `${input.identity.revisionId}.${randomUUID()}`);
  const payloadRelativePath = `data/revisions/${input.identity.revisionId}.sqlite`;
  const schemaRelativePath = `schemas/${input.identity.revisionId}.json`;
  const revisionRelativePath = `revisions/${input.identity.revisionId}.json`;
  const stagedPayload = path.join(stagedRoot, "payload.sqlite");
  fs.mkdirSync(stagedRoot, { recursive: true, mode: 0o700 });
  try {
    fs.copyFileSync(current.payloadPath, stagedPayload);
    const formulaColumn = makeFormulaColumn(input.identity.columnId, request.label, table, request.expression);
    const formulaStats = addFormulaColumnToPayload({
      payloadPath: stagedPayload,
      datasetId: current.manifest.datasetId,
      beforeRevisionId: current.revision.id,
      revisionId: input.identity.revisionId,
      table,
      schema: current.schema,
      column: formulaColumn
    });
    const column = { ...formulaColumn, stats: formulaStats };
    const schema = DatasetSchemaRecordSchema.parse({
      ...current.schema,
      revisionId: input.identity.revisionId,
      createdAt: new Date().toISOString(),
      tables: current.schema.tables.map((candidate) => candidate.id === table.id
        ? { ...candidate, columnCount: candidate.columnCount + 1, columns: [...candidate.columns, column] }
        : candidate)
    });

    publishImmutableFile(stagedPayload, resolveBundleRelativePath(current.bundlePath, payloadRelativePath));
    writeJsonImmutable(resolveBundleRelativePath(current.bundlePath, schemaRelativePath), schema);
    const now = new Date().toISOString();
    const revision = DatasetRevisionSchema.parse({
      ...current.revision,
      id: input.identity.revisionId,
      parentRevisionId: current.revision.id,
      schema: fileRef(current.bundlePath, schemaRelativePath),
      payload: { ...fileRef(current.bundlePath, payloadRelativePath), format: "sqlite" },
      stats: {
        ...current.revision.stats,
        columnCount: current.revision.stats.columnCount + 1,
        cellCount: current.revision.stats.cellCount + table.rowCount
      },
      operationId: input.identity.operationId,
      change: { kind: "collection_column_add", tableId: table.id, columnId: column.id },
      createdAt: now
    });
    writeJsonImmutable(resolveBundleRelativePath(current.bundlePath, revisionRelativePath), revision);
    replaceManifestCas(current, nextManifest(current, revision));
    const adopted = readBundle(current.vaultPath, current.manifest.datasetId);
    if (!adopted || adopted.manifest.activeRevision !== revision.id) {
      throw new PigeDomainError("collection.commit_uncertain", "The Collection formula commit could not be adopted.");
    }
    return { binding: adopted, revision };
  } finally {
    fs.rmSync(stagedRoot, { recursive: true, force: true });
  }
}

export function recomputeFormulaCellsForEditedRow(
  database: DatabaseSync,
  table: DatasetSchemaRecord["tables"][number],
  rowId: string,
  schema?: DatasetSchemaRecord
): ReadonlyMap<string, FormulaProjectionStats> {
  const formulaColumns = assertFormulaGraph({ table });
  const stats = new Map(formulaColumns.map((column) => [column.id, mutableStats()]));
  assertRowBelongsToTable(database, table.id, rowId);
  for (const column of formulaColumns) {
    const encoded = evaluateFormulaCell(database, table, rowId, column, schema);
    const changed = database.prepare([
      "UPDATE pige_dataset_cells SET state = ?, source_type = ?, lexical_raw = NULL, lexical_text = NULL,",
      "quoted = NULL, projection_kind = ?, projection_json = ?, formula_json = ?, source_style_json = NULL",
      "WHERE row_id = ? AND column_id = ?"
    ].join(" ")).run(
      encoded.state, FORMULA_SOURCE_TYPE, encoded.projectionKind, encoded.projectionJson,
      JSON.stringify(column.calculation), rowId, column.id
    );
    if (changed.changes !== 1) throw payloadInvalid();
    incrementStats(stats.get(column.id)!, encoded.state);
  }
  return freezeStats(stats);
}

export function recomputeFormulaDependenciesForRelationRow(
  database: DatabaseSync,
  schema: DatasetSchemaRecord,
  tableId: string,
  rowId: string
): FormulaProjectionStatsByTable {
  const table = schema.tables.find((candidate) => candidate.id === tableId);
  if (!table) throw payloadInvalid();
  return recomputeFormulaRows(database, schema, new Map([[table.id, new Set([rowId])]]));
}

export function recomputeAllFormulaRowsInTable(
  database: DatabaseSync,
  schema: DatasetSchemaRecord,
  tableId: string
): FormulaProjectionStatsByTable {
  const table = schema.tables.find((candidate) => candidate.id === tableId);
  if (!table) throw payloadInvalid();
  const rows = database.prepare(
    "SELECT row_id FROM pige_dataset_rows WHERE table_id = ? ORDER BY ordinal"
  ).all(table.id) as Array<{ row_id?: unknown }>;
  if (rows.length !== table.rowCount) throw payloadInvalid();
  const rowIds = new Set(rows.map((row) => {
    if (typeof row.row_id !== "string") throw payloadInvalid();
    return row.row_id;
  }));
  return recomputeFormulaRows(database, schema, new Map([[table.id, rowIds]]));
}

export function appendFormulaCellsForNewRow(
  database: DatabaseSync,
  table: DatasetSchemaRecord["tables"][number],
  rowId: string,
  schema?: DatasetSchemaRecord
): ReadonlyMap<string, FormulaProjectionStats> {
  assertRowBelongsToTable(database, table.id, rowId);
  const stats = new Map<string, MutableFormulaStats>();
  for (const column of assertFormulaGraph({ table })) {
    const encoded = evaluateFormulaCell(database, table, rowId, column, schema);
    const inserted = database.prepare([
      "INSERT INTO pige_dataset_cells",
      "(row_id, column_id, state, source_type, lexical_raw, lexical_text, quoted, projection_kind, projection_json, formula_json, source_style_json)",
      "VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, NULL)"
    ].join(" ")).run(
      rowId, column.id, encoded.state, FORMULA_SOURCE_TYPE, encoded.projectionKind,
      encoded.projectionJson, JSON.stringify(column.calculation)
    );
    if (inserted.changes !== 1) throw payloadInvalid();
    const columnStats = mutableStats();
    incrementStats(columnStats, encoded.state);
    stats.set(column.id, columnStats);
  }
  return freezeStats(stats);
}

export function recomputeFormulaProjectionsInStagedPayload(input: {
  readonly payloadPath: string;
  readonly datasetId: string;
  readonly beforeRevisionId: string;
  readonly revisionId: string;
  readonly table: DatasetSchemaRecord["tables"][number];
  readonly schema?: DatasetSchemaRecord;
  readonly rowIds?: readonly string[];
}): ReadonlyMap<string, FormulaProjectionStats> {
  const database = new DatabaseSync(input.payloadPath);
  try {
    database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    validatePayloadMeta(database, input.datasetId, input.beforeRevisionId);
    database.exec("BEGIN IMMEDIATE");
    try {
      const aggregate = new Map(assertFormulaGraph({ table: input.table })
        .map((column) => [column.id, mutableStats()]));
      const rowIds = input.rowIds ?? (database.prepare(
        "SELECT row_id FROM pige_dataset_rows WHERE table_id = ? ORDER BY ordinal"
      ).all(input.table.id) as Array<{ row_id?: unknown }>).map((row) => {
        if (typeof row.row_id !== "string") throw payloadInvalid();
        return row.row_id;
      });
      if (rowIds.length !== input.table.rowCount) throw payloadInvalid();
      for (const rowId of uniqueRowIds(rowIds)) {
        const rowStats = recomputeFormulaCellsForEditedRow(database, input.table, rowId, input.schema);
        for (const [columnId, value] of rowStats) {
          const total = aggregate.get(columnId);
          if (!total) throw payloadInvalid();
          total.null += value.null;
          total.value += value.value;
        }
      }
      const updateStats = database.prepare(
        "UPDATE pige_dataset_columns SET stats_json = ? WHERE table_id = ? AND column_id = ?"
      );
      for (const [columnId, value] of aggregate) {
        if (updateStats.run(JSON.stringify(value), input.table.id, columnId).changes !== 1) throw payloadInvalid();
      }
      if (database.prepare("UPDATE pige_dataset_meta SET value = ? WHERE key = 'revision_id'")
        .run(input.revisionId).changes !== 1) throw payloadInvalid();
      database.exec("COMMIT");
      assertPayloadIntegrity(database);
      return freezeStats(aggregate);
    } catch (caught) {
      database.exec("ROLLBACK");
      throw caught;
    }
  } finally {
    database.close();
    syncFile(input.payloadPath);
  }
}

export function commitCollectionCellMutation(input: {
  readonly binding: BundleBinding;
  readonly identity: { readonly revisionId: string; readonly operationId: string };
  readonly tableId: string;
  readonly rowId: string;
  readonly columnId: string;
  readonly value: CollectionScalarValue;
  readonly expectedRevisionId: string;
  readonly change: { readonly kind: "collection_cell_edit" } |
    { readonly kind: "collection_cell_undo"; readonly undoOfOperationId: string };
  readonly createOperation: (binding: BundleBinding, revision: DatasetRevision) => OperationRecord;
}): { readonly revision: DatasetRevision; readonly operation: OperationRecord } {
  const current = readBundle(input.binding.vaultPath, input.binding.manifest.datasetId);
  if (!current || current.manifest.activeRevision !== input.expectedRevisionId) {
    throw new PigeDomainError("collection.revision_changed", "The Collection revision changed before commit.");
  }
  const currentCell = readCollectionCell(current, input.tableId, input.rowId, input.columnId);
  const table = current.schema.tables.find((candidate) => candidate.id === input.tableId);
  if (!currentCell || !table) throw new PigeDomainError("collection.cell_not_found", "The Collection cell is unavailable.");
  const stagedRoot = path.join(current.bundlePath, ".staging", `${input.identity.revisionId}.${randomUUID()}`);
  const payloadRelativePath = `data/revisions/${input.identity.revisionId}.sqlite`;
  const schemaRelativePath = `schemas/${input.identity.revisionId}.json`;
  const revisionRelativePath = `revisions/${input.identity.revisionId}.json`;
  const stagedPayload = path.join(stagedRoot, "payload.sqlite");
  fs.mkdirSync(stagedRoot, { recursive: true, mode: 0o700 });
  try {
    fs.copyFileSync(current.payloadPath, stagedPayload);
    const formulaStats = mutateCellAndFormulas(stagedPayload, current.manifest.datasetId, current.revision.id,
      input.identity.revisionId, current.schema, table, input.rowId, currentCell, input.value);
    const schema = nextCellSchema(current.schema, input.identity.revisionId, currentCell, input.value, formulaStats);
    publishImmutableFile(stagedPayload, resolveBundleRelativePath(current.bundlePath, payloadRelativePath));
    writeJsonImmutable(resolveBundleRelativePath(current.bundlePath, schemaRelativePath), schema);
    const now = new Date().toISOString();
    const revision = DatasetRevisionSchema.parse({
      ...current.revision, id: input.identity.revisionId, parentRevisionId: current.revision.id,
      schema: fileRef(current.bundlePath, schemaRelativePath),
      payload: { ...fileRef(current.bundlePath, payloadRelativePath), format: "sqlite" },
      operationId: input.identity.operationId,
      change: { ...input.change, tableId: input.tableId, rowId: input.rowId, columnId: input.columnId },
      createdAt: now
    });
    writeJsonImmutable(resolveBundleRelativePath(current.bundlePath, revisionRelativePath), revision);
    replaceManifestCas(current, nextManifest(current, revision));
    const committed = readBundle(current.vaultPath, current.manifest.datasetId);
    if (!committed || committed.manifest.activeRevision !== revision.id) {
      throw new PigeDomainError("collection.commit_uncertain", "The Collection commit could not be adopted.");
    }
    const operation = input.createOperation(committed, revision);
    writeJsonExclusive(operationPathFor(current.vaultPath, operation.id), operation);
    return { revision, operation };
  } finally {
    fs.rmSync(stagedRoot, { recursive: true, force: true });
  }
}

function addFormulaColumnToPayload(input: {
  readonly payloadPath: string;
  readonly datasetId: string;
  readonly beforeRevisionId: string;
  readonly revisionId: string;
  readonly table: DatasetSchemaRecord["tables"][number];
  readonly schema: DatasetSchemaRecord;
  readonly column: DatasetColumn;
}): FormulaProjectionStats {
  const database = new DatabaseSync(input.payloadPath);
  try {
    database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    validatePayloadMeta(database, input.datasetId, input.beforeRevisionId);
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("INSERT INTO pige_dataset_columns VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        input.column.id, input.table.id, input.column.ordinal, input.column.name, "real",
        JSON.stringify(input.column.sourceTypes), JSON.stringify(input.column.stats)
      );
      const rows = database.prepare(
        "SELECT row_id FROM pige_dataset_rows WHERE table_id = ? ORDER BY ordinal"
      ).all(input.table.id) as Array<{ row_id?: unknown }>;
      if (rows.length !== input.table.rowCount) throw payloadInvalid();
      const stats = mutableStats();
      for (const row of rows) {
        if (typeof row.row_id !== "string") throw payloadInvalid();
        const encoded = evaluateFormulaCell(database, input.table, row.row_id, input.column, input.schema);
        database.prepare([
          "INSERT INTO pige_dataset_cells",
          "(row_id, column_id, state, source_type, lexical_raw, lexical_text, quoted, projection_kind, projection_json, formula_json, source_style_json)",
          "VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, NULL)"
        ].join(" ")).run(
          row.row_id, input.column.id, encoded.state, FORMULA_SOURCE_TYPE,
          encoded.projectionKind, encoded.projectionJson, JSON.stringify(input.column.calculation)
        );
        incrementStats(stats, encoded.state);
      }
      if (database.prepare(
        "UPDATE pige_dataset_tables SET column_count = column_count + 1 WHERE table_id = ? AND column_count = ?"
      ).run(input.table.id, input.table.columnCount).changes !== 1) throw payloadInvalid();
      if (database.prepare("UPDATE pige_dataset_meta SET value = ? WHERE key = 'revision_id'")
        .run(input.revisionId).changes !== 1) throw payloadInvalid();
      database.prepare("UPDATE pige_dataset_columns SET stats_json = ? WHERE column_id = ?")
        .run(JSON.stringify(stats), input.column.id);
      database.exec("COMMIT");
      assertPayloadIntegrity(database);
      return { ...stats };
    } catch (caught) {
      database.exec("ROLLBACK");
      throw caught;
    }
  } finally {
    database.close();
    syncFile(input.payloadPath);
  }
}

function mutateCellAndFormulas(
  payloadPath: string,
  datasetId: string,
  beforeRevisionId: string,
  revisionId: string,
  schema: DatasetSchemaRecord,
  table: DatasetSchemaRecord["tables"][number],
  rowId: string,
  cell: CollectionCellBinding,
  value: CollectionScalarValue
): FormulaProjectionStatsByTable {
  const database = new DatabaseSync(payloadPath);
  try {
    database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    validatePayloadMeta(database, datasetId, beforeRevisionId);
    const encoded = encodeCellValue(value, cell.column.logicalType);
    database.exec("BEGIN IMMEDIATE");
    try {
      const changed = database.prepare([
        "UPDATE pige_dataset_cells SET state = ?, source_type = ?, lexical_raw = NULL, lexical_text = NULL,",
        "quoted = NULL, projection_kind = ?, projection_json = ?, formula_json = NULL, source_style_json = NULL",
        "WHERE row_id = ? AND column_id = ? AND formula_json IS NULL"
      ].join(" ")).run(encoded.state, "pige_user_edit", encoded.projectionKind, encoded.projectionJson, rowId, cell.column.id);
      if (changed.changes !== 1) throw new PigeDomainError("collection.cell_changed", "The Collection cell changed before commit.");
      const rows = affectedFormulaRowsForCellEdit(database, schema, table.id, rowId, cell.column.id);
      const stats = recomputeFormulaRows(database, schema, rows);
      if (database.prepare("UPDATE pige_dataset_meta SET value = ? WHERE key = 'revision_id'").run(revisionId).changes !== 1) {
        throw payloadInvalid();
      }
      database.exec("COMMIT");
      assertPayloadIntegrity(database);
      return stats;
    } catch (caught) {
      database.exec("ROLLBACK");
      throw caught;
    }
  } finally {
    database.close();
    syncFile(payloadPath);
  }
}

function readFormulaStats(
  database: DatabaseSync,
  table: DatasetSchemaRecord["tables"][number]
): ReadonlyMap<string, FormulaProjectionStats> {
  const result = new Map<string, FormulaProjectionStats>();
  const count = database.prepare([
    "SELECT state, COUNT(*) AS count FROM pige_dataset_cells AS c",
    "JOIN pige_dataset_rows AS r ON r.row_id = c.row_id",
    "WHERE r.table_id = ? AND c.column_id = ? GROUP BY state"
  ].join(" "));
  for (const column of assertFormulaGraph({ table })) {
    const stats = mutableStats();
    for (const row of count.all(table.id, column.id) as Array<{ state?: unknown; count?: unknown }>) {
      if ((row.state !== "null" && row.state !== "value") || typeof row.count !== "number" || !Number.isSafeInteger(row.count)) {
        throw payloadInvalid();
      }
      stats[row.state] = row.count;
    }
    if (stats.null + stats.value !== table.rowCount) throw payloadInvalid();
    result.set(column.id, { ...stats });
  }
  return result;
}

function affectedFormulaRowsForCellEdit(
  database: DatabaseSync,
  schema: DatasetSchemaRecord,
  editedTableId: string,
  editedRowId: string,
  editedColumnId: string
): Map<string, Set<string>> {
  const rows = new Map<string, Set<string>>([[editedTableId, new Set([editedRowId])]]);
  for (const sourceTable of schema.tables) {
    const relationIds = new Set<string>();
    for (const column of sourceTable.columns) {
      const derived = column.lookup ?? column.rollup;
      if (!derived) continue;
      const relationColumn = sourceTable.columns.find((candidate) => candidate.id === derived.relationColumnId);
      const relation = relationColumn?.relation;
      if (!relation || relation.targetTableId !== editedTableId) continue;
      if (column.lookup?.targetColumnId === editedColumnId ||
          (column.rollup?.aggregation === "sum" && column.rollup.targetColumnId === editedColumnId)) {
        relationIds.add(relationColumn.id);
      }
    }
    if (relationIds.size === 0 || assertFormulaGraph({ table: sourceTable }).length === 0) continue;
    const sourceRows = rows.get(sourceTable.id) ?? new Set<string>();
    for (const relationId of relationIds) {
      const candidates = database.prepare([
        "SELECT c.row_id, c.state, c.projection_json FROM pige_dataset_cells AS c",
        "JOIN pige_dataset_rows AS r ON r.row_id = c.row_id",
        "WHERE r.table_id = ? AND c.column_id = ? ORDER BY r.ordinal"
      ].join(" ")).all(sourceTable.id, relationId) as Array<{
        row_id?: unknown; state?: unknown; projection_json?: unknown
      }>;
      for (const candidate of candidates) {
        if (typeof candidate.row_id !== "string") throw payloadInvalid();
        if (candidate.state === "null" && candidate.projection_json === "null") continue;
        if (candidate.state !== "value" || typeof candidate.projection_json !== "string") throw payloadInvalid();
        const target = DatasetPigeRelationCellSchema.parse(JSON.parse(candidate.projection_json));
        if (!target) throw payloadInvalid();
        if (target.targetRowId === editedRowId) sourceRows.add(candidate.row_id);
      }
    }
    if (sourceRows.size > 0) rows.set(sourceTable.id, sourceRows);
  }
  return rows;
}

function recomputeFormulaRows(
  database: DatabaseSync,
  schema: DatasetSchemaRecord,
  rows: ReadonlyMap<string, ReadonlySet<string>>
): FormulaProjectionStatsByTable {
  const result = new Map<string, ReadonlyMap<string, FormulaProjectionStats>>();
  const updateStats = database.prepare(
    "UPDATE pige_dataset_columns SET stats_json = ? WHERE table_id = ? AND column_id = ?"
  );
  for (const [tableId, rowIds] of rows) {
    const table = schema.tables.find((candidate) => candidate.id === tableId);
    if (!table) throw payloadInvalid();
    const formulas = assertFormulaGraph({ table });
    if (formulas.length === 0) continue;
    for (const rowId of [...rowIds].sort()) {
      recomputeFormulaCellsForEditedRow(database, table, rowId, schema);
    }
    const stats = readFormulaStats(database, table);
    for (const [columnId, formulaStats] of stats) {
      if (updateStats.run(JSON.stringify(formulaStats), table.id, columnId).changes !== 1) throw payloadInvalid();
    }
    result.set(table.id, stats);
  }
  return result;
}

function encodeCellValue(value: CollectionScalarValue, logicalType: DatasetLogicalType) {
  if (value === null) return { state: "null" as const, projectionKind: "null", projectionJson: null };
  if (logicalType === "string") return {
    state: value === "" ? "empty" as const : "value" as const,
    projectionKind: "text", projectionJson: JSON.stringify({ kind: "text", value })
  };
  const projectionKind = logicalType === "number" ? "real" : logicalType;
  if (!["integer", "number", "boolean", "date", "datetime"].includes(logicalType)) {
    throw new PigeDomainError("collection.type_mismatch", "The Collection cell type is not editable.");
  }
  return { state: "value" as const, projectionKind, projectionJson: JSON.stringify({ kind: projectionKind, value }) };
}

function nextCellSchema(
  current: DatasetSchemaRecord,
  revisionId: string,
  cell: CollectionCellBinding,
  value: CollectionScalarValue,
  formulaStats: FormulaProjectionStatsByTable
): DatasetSchemaRecord {
  const oldState = normalizedState(cell.state);
  const newState = value === null ? "null" : value === "" && cell.column.logicalType === "string" ? "empty" : "value";
  return DatasetSchemaRecordSchema.parse({
    ...current, revisionId, createdAt: new Date().toISOString(),
    tables: current.tables.map((table) => ({ ...table, columns: table.columns.map((column) => {
      const calculatedStats = formulaStats.get(table.id)?.get(column.id);
      if (calculatedStats) return { ...column, stats: calculatedStats };
      if (column.id !== cell.column.id || !column.stats || oldState === newState) return column;
      return { ...column, stats: { ...column.stats,
        [oldState]: Math.max(0, column.stats[oldState] - 1), [newState]: column.stats[newState] + 1 } };
    }) }))
  });
}

function normalizedState(value: string): "missing" | "empty" | "null" | "value" {
  if (value === "missing" || value === "empty" || value === "null" || value === "value") return value;
  throw payloadInvalid();
}

function evaluateFormulaCell(
  database: DatabaseSync,
  table: DatasetSchemaRecord["tables"][number],
  rowId: string,
  column: DatasetColumn,
  schema?: DatasetSchemaRecord
) {
  if (!isPigeFormulaColumn(column)) throw payloadInvalid();
  const columnsById = new Map(table.columns.map((candidate) => [candidate.id, candidate]));
  const value = evaluateFormulaExpression(column.calculation.expression, (columnId) => {
    const operand = columnsById.get(columnId);
    if (!operand || !isEligibleFormulaOperand(operand)) throw payloadInvalid();
    if (operand.lookup || operand.rollup) {
      if (!schema) throw payloadInvalid();
      return readDerivedNumericOperand(database, schema, table, rowId, operand);
    }
    const row = database.prepare(
      "SELECT state, projection_json FROM pige_dataset_cells WHERE row_id = ? AND column_id = ?"
    ).get(rowId, columnId) as { state?: unknown; projection_json?: unknown } | undefined;
    if (!row || typeof row.state !== "string" ||
        !(typeof row.projection_json === "string" || row.projection_json === null)) throw payloadInvalid();
    if (row.state === "missing" || row.state === "null" || row.state === "empty") return null;
    if (row.state !== "value" || row.projection_json === null) throw payloadInvalid();
    const projection = JSON.parse(row.projection_json) as { value?: unknown };
    const number = typeof projection.value === "number" ? projection.value : Number(projection.value);
    return Number.isFinite(number) ? number : null;
  });
  return value === null
    ? { state: "null" as const, projectionKind: "null", projectionJson: null }
    : { state: "value" as const, projectionKind: "real", projectionJson: JSON.stringify({ kind: "real", value }) };
}

function readDerivedNumericOperand(
  database: DatabaseSync,
  schema: DatasetSchemaRecord,
  sourceTable: DatasetSchemaRecord["tables"][number],
  sourceRowId: string,
  column: DatasetColumn
): number | null {
  const descriptor = column.lookup ?? column.rollup;
  if (!descriptor) throw payloadInvalid();
  const relationColumn = sourceTable.columns.find((candidate) => candidate.id === descriptor.relationColumnId);
  const relation = relationColumn?.relation;
  const targetTable = relation
    ? schema.tables.find((candidate) => candidate.id === relation.targetTableId)
    : undefined;
  if (!relationColumn || !relation || !targetTable) throw payloadInvalid();
  const targetRowId = readRelationTargetId(database, sourceRowId, relationColumn.id);
  if (column.rollup?.aggregation === "count") return targetRowId === null ? 0 : 1;
  if (targetRowId === null) return null;
  const targetColumnId = column.lookup?.targetColumnId ?? column.rollup?.targetColumnId;
  const targetColumn = targetTable.columns.find((candidate) => candidate.id === targetColumnId);
  if (!targetColumn || (targetColumn.logicalType !== "integer" && targetColumn.logicalType !== "number")) {
    throw payloadInvalid();
  }
  const target = database.prepare("SELECT table_id FROM pige_dataset_rows WHERE row_id = ?")
    .get(targetRowId) as { table_id?: unknown } | undefined;
  if (target?.table_id !== targetTable.id) throw payloadInvalid();
  return readNumericCell(database, targetRowId, targetColumn.id, targetColumn.logicalType);
}

function readRelationTargetId(database: DatabaseSync, rowId: string, columnId: string): string | null {
  const raw = database.prepare(
    "SELECT state, projection_json FROM pige_dataset_cells WHERE row_id = ? AND column_id = ?"
  ).get(rowId, columnId) as { state?: unknown; projection_json?: unknown } | undefined;
  if (raw?.state === "null" && raw.projection_json === "null") return null;
  if (raw?.state !== "value" || typeof raw.projection_json !== "string") throw payloadInvalid();
  const target = DatasetPigeRelationCellSchema.parse(JSON.parse(raw.projection_json));
  if (!target) throw payloadInvalid();
  return target.targetRowId;
}

function readNumericCell(
  database: DatabaseSync,
  rowId: string,
  columnId: string,
  logicalType: DatasetLogicalType
): number | null {
  const raw = database.prepare(
    "SELECT state, projection_json FROM pige_dataset_cells WHERE row_id = ? AND column_id = ?"
  ).get(rowId, columnId) as { state?: unknown; projection_json?: unknown } | undefined;
  if (!raw || raw.state === "missing" || raw.state === "empty" || raw.state === "null") return null;
  if (raw.state !== "value" || typeof raw.projection_json !== "string") throw payloadInvalid();
  const projection = JSON.parse(raw.projection_json) as { value?: unknown };
  const value = typeof projection.value === "number" ? projection.value : Number(projection.value);
  if (!Number.isFinite(value) || (logicalType === "integer" && !Number.isSafeInteger(value))) throw payloadInvalid();
  return Object.is(value, -0) ? 0 : value;
}

function makeFormulaColumn(
  columnId: string,
  label: string,
  table: DatasetSchemaRecord["tables"][number],
  expression: DatasetPigeFormulaExpression
): DatasetColumn {
  return {
    id: columnId,
    name: label,
    ordinal: table.columns.length,
    sourceType: FORMULA_SOURCE_TYPE,
    sourceTypes: [FORMULA_SOURCE_TYPE],
    logicalType: "number",
    nullable: true,
    calculation: { kind: "pige_numeric_formula", schemaVersion: 1, expression },
    stats: { missing: 0, empty: 0, null: table.rowCount, value: 0 }
  };
}

function assertFormulaRevision(
  binding: BundleBinding,
  request: CollectionAddFormulaColumnRequest,
  identity: FormulaColumnMutationIdentity,
  revision: DatasetRevision
): void {
  if (
    revision.id !== identity.revisionId || revision.operationId !== identity.operationId ||
    revision.parentRevisionId !== request.expectedRevisionId || revision.change?.kind !== "collection_column_add" ||
    revision.change.tableId !== request.tableId || revision.change.columnId !== identity.columnId ||
    identity.expressionIdentity !== canonicalFormulaExpressionIdentity(request.expression)
  ) throw requestConflict();
  const schema = DatasetSchemaRecordSchema.parse(readJsonRef(binding.bundlePath, revision.schema));
  const column = schema.tables.find((table) => table.id === request.tableId)
    ?.columns.find((candidate) => candidate.id === identity.columnId);
  if (
    !column || column.name !== request.label || column.calculation?.kind !== "pige_numeric_formula" ||
    canonicalFormulaExpressionIdentity(column.calculation.expression) !== identity.expressionIdentity
  ) throw requestConflict();
}

function assertEligibleOperands(
  table: DatasetSchemaRecord["tables"][number],
  expression: DatasetPigeFormulaExpression
): void {
  const columns = new Map(table.columns.map((column) => [column.id, column]));
  for (const columnId of formulaReferencedColumnIds(expression)) {
    const column = columns.get(columnId);
    if (!column || !isEligibleFormulaOperand(column)) {
      throw new PigeDomainError("collection.formula_operand_ineligible", "The Collection formula operand is unavailable.");
    }
  }
}

export function projectCollectionFormulaColumns(
  columns: readonly DatasetColumn[]
): readonly CollectionColumnSummary[] {
  const referenced = new Set(columns.flatMap((column) => column.calculation?.kind === "pige_numeric_formula"
    ? formulaReferencedColumnIds(column.calculation.expression)
    : []));
  return columns.map((column) => {
    const calculation = column.calculation;
    const pigeFormula = calculation?.kind === "pige_numeric_formula";
    const importedFormula = !pigeFormula && [column.sourceType, ...(column.sourceTypes ?? [])]
      .some((sourceType) => sourceType.toLowerCase().includes("formula"));
    const canUseAsFormulaOperand = isEligibleFormulaOperand(column);
    return {
      columnId: column.id,
      label: column.name,
      logicalType: column.logicalType,
      canRename: !importedFormula,
      canTrash: columns.length > 1 && !importedFormula && !referenced.has(column.id),
      canUseAsFormulaOperand,
      canEditFormula: pigeFormula && isBuilderRepresentable(calculation.expression),
      canUseAsRelationDisplay: false,
      canEditRelationDefinition: false,
      canEditRelation: false,
      canUseAsLookupTarget: false,
      canUseAsRollupTarget: false,
      canEditRollup: false,
      canEditLookup: false,
      hasInboundRelationDescriptors: false,
      ...(pigeFormula
        ? { calculation: column.calculation }
        : importedFormula
          ? { calculation: { kind: "imported_cached_formula" as const } }
          : {})
    };
  });
}
function isBuilderRepresentable(expression: DatasetPigeFormulaExpression): boolean { return expression.kind === "binary" && expression.left.kind === "column" && (expression.right.kind === "column" || expression.right.kind === "literal"); }
function nextManifest(binding: BundleBinding, revision: DatasetRevision) {
  return DatasetManifestSchema.parse({
    ...binding.manifest,
    initialRevision: binding.manifest.initialRevision ?? binding.manifest.activeRevision,
    activeRevision: revision.id,
    revision: fileRef(binding.bundlePath, `revisions/${revision.id}.json`),
    schema: revision.schema,
    payload: revision.payload,
    updatedAt: revision.createdAt
  });
}

function assertRowBelongsToTable(database: DatabaseSync, tableId: string, rowId: string): void {
  const row = database.prepare("SELECT table_id FROM pige_dataset_rows WHERE row_id = ?").get(rowId) as {
    table_id?: unknown;
  } | undefined;
  if (row?.table_id !== tableId) throw payloadInvalid();
}

function uniqueRowIds(rowIds: readonly string[]): readonly string[] {
  if (new Set(rowIds).size !== rowIds.length) throw payloadInvalid();
  return rowIds;
}

interface MutableFormulaStats { missing: 0; empty: 0; null: number; value: number }

function mutableStats(): MutableFormulaStats {
  return { missing: 0, empty: 0, null: 0, value: 0 };
}

function incrementStats(stats: MutableFormulaStats, state: "null" | "value"): void {
  stats[state] += 1;
}

function freezeStats(stats: ReadonlyMap<string, MutableFormulaStats>): ReadonlyMap<string, FormulaProjectionStats> {
  return new Map([...stats].map(([columnId, value]) => [columnId, { ...value }]));
}

function normalizeOperand(value: ReturnType<FormulaOperandReader>): number | null {
  return value === null || value === undefined || value === "" ? null : normalizeNumber(value);
}

function normalizeNumber(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Object.is(value, -0) ? 0 : value;
}

function normalizeLabel(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function assertPayloadIntegrity(database: DatabaseSync): void {
  const row = database.prepare("PRAGMA integrity_check").get() as { integrity_check?: unknown } | undefined;
  if (row?.integrity_check !== "ok") throw payloadInvalid();
}

function digest(...parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
}
