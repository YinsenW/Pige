import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PigeDomainError } from "@pige/domain";
import {
  CollectionUpdateFormulaColumnRequestSchema,
  CollectionUpdateFormulaColumnResultSchema,
  DatasetManifestSchema,
  DatasetRevisionSchema,
  DatasetSchemaRecordSchema,
  OperationRecordSchema,
  type CollectionSnapshot,
  type CollectionUpdateFormulaColumnRequest,
  type CollectionUpdateFormulaColumnResult,
  type DatasetColumn,
  type DatasetPigeFormulaExpression,
  type DatasetRevision,
  type DatasetSchemaRecord,
  type OperationRecord
} from "@pige/schemas";
import {
  canonicalFormulaExpressionIdentity,
  evaluateFormulaExpression,
  formulaReferencedColumnIds
} from "./managed-collection-formula-storage";
import {
  fileRef,
  hashCanonical,
  MAX_COLLECTION_JSON_BYTES,
  operationPathFor,
  payloadInvalid,
  publishImmutableFile,
  readBundle,
  readJsonBounded,
  readJsonRef,
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

const FORMULA_SOURCE_TYPE = "pige_numeric_formula_v1";

export interface FormulaUpdateMutationIdentity {
  readonly revisionId: string;
  readonly operationId: string;
  readonly expressionIdentity: string;
}

export function createFormulaUpdateMutationIdentity(
  rawRequest: CollectionUpdateFormulaColumnRequest
): FormulaUpdateMutationIdentity {
  const request = CollectionUpdateFormulaColumnRequestSchema.parse(rawRequest);
  const dateKey = /^dataset_rev_(\d{8})_[a-z0-9]{12,}$/u.exec(request.expectedRevisionId)?.[1];
  if (!dateKey) throw requestConflict();
  return {
    revisionId: `dataset_rev_${dateKey}_${digest("pige:collection-formula-update-revision:v1", request.requestId).slice(0, 20)}`,
    operationId: `op_${dateKey}_${digest("pige:collection-formula-update-operation:v1", request.requestId).slice(0, 20)}`,
    expressionIdentity: canonicalFormulaExpressionIdentity(request.expression)
  };
}

export function adoptFormulaUpdateMutation(input: {
  readonly binding: BundleBinding;
  readonly request: CollectionUpdateFormulaColumnRequest;
  readonly identity: FormulaUpdateMutationIdentity;
  readonly readSnapshot: (binding: BundleBinding, tableId: string) => CollectionSnapshot | undefined;
  readonly createOperation: (binding: BundleBinding, revision: DatasetRevision) => OperationRecord;
}): Partial<CollectionUpdateFormulaColumnResult> | undefined {
  const request = CollectionUpdateFormulaColumnRequestSchema.parse(input.request);
  const revisionPath = resolveBundleRelativePath(input.binding.bundlePath, `revisions/${input.identity.revisionId}.json`);
  const operationPath = operationPathFor(input.binding.vaultPath, input.identity.operationId);
  if (!fs.existsSync(revisionPath) && !fs.existsSync(operationPath)) return undefined;
  if (!fs.existsSync(revisionPath)) throw requestConflict();
  const revision = DatasetRevisionSchema.parse(readJsonBounded(revisionPath, MAX_COLLECTION_JSON_BYTES));
  assertUpdateRevision(input.binding, request, input.identity, revision);
  let committed = input.binding;
  if (input.binding.manifest.activeRevision !== revision.id) {
    if (input.binding.manifest.activeRevision !== request.expectedRevisionId) {
      const snapshot = input.readSnapshot(input.binding, request.tableId);
      return snapshot ? { status: "stale", snapshot } : { status: "not_found" };
    }
    replaceManifestCas(input.binding, nextManifest(input.binding, revision));
    const adopted = readBundle(input.binding.vaultPath, input.binding.manifest.datasetId);
    if (!adopted || adopted.manifest.activeRevision !== revision.id) throw commitUncertain();
    committed = adopted;
  }
  const expectedOperation = input.createOperation(committed, revision);
  const operation = fs.existsSync(operationPath)
    ? OperationRecordSchema.parse(readJsonBounded(operationPath, MAX_COLLECTION_JSON_BYTES))
    : expectedOperation;
  if (hashCanonical(operation) !== hashCanonical(expectedOperation)) throw requestConflict();
  if (!fs.existsSync(operationPath)) writeJsonExclusive(operationPath, operation);
  const snapshot = input.readSnapshot(committed, request.tableId);
  return snapshot
    ? CollectionUpdateFormulaColumnResultSchema.parse({
      ...resultIdentity(request), status: "committed", operationId: operation.id, snapshot
    })
    : { status: "not_found" };
}

export function commitFormulaUpdate(input: {
  readonly binding: BundleBinding;
  readonly request: CollectionUpdateFormulaColumnRequest;
  readonly identity: FormulaUpdateMutationIdentity;
}): { readonly binding: BundleBinding; readonly revision: DatasetRevision } {
  const request = CollectionUpdateFormulaColumnRequestSchema.parse(input.request);
  if (input.identity.expressionIdentity !== canonicalFormulaExpressionIdentity(request.expression)) throw requestConflict();
  const current = readCurrent(input.binding, request.expectedRevisionId);
  const table = current.schema.tables.find((candidate) => candidate.id === request.tableId);
  const column = table?.columns.find((candidate) => candidate.id === request.columnId);
  if (!table || !column) throw new PigeDomainError("collection.column_not_found", "The Collection column is unavailable.");
  if (column.calculation?.kind !== "pige_numeric_formula") {
    const imported = [column.sourceType, ...(column.sourceTypes ?? [])].some((value) => value.toLowerCase().includes("formula"));
    throw new PigeDomainError(imported ? "collection.imported_formula" : "collection.not_pige_formula", "The Collection column is not editable.");
  }
  if (canonicalFormulaExpressionIdentity(column.calculation.expression) === input.identity.expressionIdentity) {
    throw new PigeDomainError("collection.formula_no_change", "The Collection formula is unchanged.");
  }
  assertEligibleOperands(table, request.expression);
  return commitRevision({
    current,
    identity: input.identity,
    tableId: request.tableId,
    columnId: request.columnId,
    expression: request.expression,
    change: { kind: "collection_formula_update" }
  });
}

export function commitFormulaUpdateUndo(input: {
  readonly binding: BundleBinding;
  readonly identity: { readonly revisionId: string; readonly operationId: string };
  readonly tableId: string;
  readonly columnId: string;
  readonly expectedRevisionId: string;
  readonly beforeRevisionId: string;
  readonly undoOfOperationId: string;
}): { readonly binding: BundleBinding; readonly revision: DatasetRevision } {
  const current = readCurrent(input.binding, input.expectedRevisionId);
  const beforeRevision = readRevisionById(current, input.beforeRevisionId);
  const beforeSchema = DatasetSchemaRecordSchema.parse(readJsonRef(current.bundlePath, beforeRevision.schema));
  const beforeTable = beforeSchema.tables.find((candidate) => candidate.id === input.tableId);
  const beforeColumn = beforeTable?.columns.find((candidate) => candidate.id === input.columnId);
  if (!beforeTable || beforeColumn?.calculation?.kind !== "pige_numeric_formula") throw requestConflict();
  return commitRevision({
    current,
    identity: { ...input.identity, expressionIdentity: canonicalFormulaExpressionIdentity(beforeColumn.calculation.expression) },
    tableId: input.tableId,
    columnId: input.columnId,
    expression: beforeColumn.calculation.expression,
    restore: { revision: beforeRevision, schema: beforeSchema },
    change: { kind: "collection_formula_update_undo", undoOfOperationId: input.undoOfOperationId }
  });
}

function commitRevision(input: {
  readonly current: BundleBinding;
  readonly identity: FormulaUpdateMutationIdentity;
  readonly tableId: string;
  readonly columnId: string;
  readonly expression: DatasetPigeFormulaExpression;
  readonly restore?: { readonly revision: DatasetRevision; readonly schema: DatasetSchemaRecord };
  readonly change: { readonly kind: "collection_formula_update" } |
    { readonly kind: "collection_formula_update_undo"; readonly undoOfOperationId: string };
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
    let stats;
    if (input.restore) {
      adoptRestoredPayload(stagedPayload, input.current.manifest.datasetId, input.restore.revision.id, input.identity.revisionId);
      stats = requireTable(input.restore.schema, input.tableId).columns
        .find((column) => column.id === input.columnId)?.stats;
      if (!stats) throw requestConflict();
    } else stats = recomputeTargetFormula({
        payloadPath: stagedPayload,
        datasetId: input.current.manifest.datasetId,
        beforeRevisionId: input.current.revision.id,
        revisionId: input.identity.revisionId,
        table: requireTable(input.current.schema, input.tableId),
        columnId: input.columnId,
        expression: input.expression
      });
    const baseSchema = input.restore?.schema ?? input.current.schema;
    const schema = DatasetSchemaRecordSchema.parse({
      ...baseSchema,
      revisionId: input.identity.revisionId,
      createdAt: new Date().toISOString(),
      tables: baseSchema.tables.map((table) => table.id === input.tableId
        ? { ...table, columns: table.columns.map((column) => column.id === input.columnId
          ? { ...column, calculation: { kind: "pige_numeric_formula", schemaVersion: 1, expression: input.expression }, stats }
          : column) }
        : table)
    });
    publishImmutableFile(stagedPayload, resolveBundleRelativePath(input.current.bundlePath, payloadRelativePath));
    writeJsonImmutable(resolveBundleRelativePath(input.current.bundlePath, schemaRelativePath), schema);
    const revision = DatasetRevisionSchema.parse({
      ...(input.restore?.revision ?? input.current.revision),
      id: input.identity.revisionId,
      datasetId: input.current.manifest.datasetId,
      parentRevisionId: input.current.revision.id,
      schema: fileRef(input.current.bundlePath, schemaRelativePath),
      payload: { ...fileRef(input.current.bundlePath, payloadRelativePath), format: "sqlite" },
      operationId: input.identity.operationId,
      change: { ...input.change, tableId: input.tableId, columnId: input.columnId },
      createdAt: new Date().toISOString()
    });
    writeJsonImmutable(resolveBundleRelativePath(input.current.bundlePath, revisionRelativePath), revision);
    replaceManifestCas(input.current, nextManifest(input.current, revision));
    const adopted = readBundle(input.current.vaultPath, input.current.manifest.datasetId);
    if (!adopted || adopted.manifest.activeRevision !== revision.id) throw commitUncertain();
    return { binding: adopted, revision };
  } finally {
    fs.rmSync(stagedRoot, { recursive: true, force: true });
  }
}

function recomputeTargetFormula(input: {
  readonly payloadPath: string;
  readonly datasetId: string;
  readonly beforeRevisionId: string;
  readonly revisionId: string;
  readonly table: DatasetSchemaRecord["tables"][number];
  readonly columnId: string;
  readonly expression: DatasetPigeFormulaExpression;
}) {
  const database = new DatabaseSync(input.payloadPath);
  const stats = { missing: 0 as const, empty: 0 as const, null: 0, value: 0 };
  try {
    database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    validatePayloadMeta(database, input.datasetId, input.beforeRevisionId);
    database.exec("BEGIN IMMEDIATE");
    try {
      const rows = database.prepare("SELECT row_id FROM pige_dataset_rows WHERE table_id = ? ORDER BY ordinal")
        .all(input.table.id) as Array<{ row_id?: unknown }>;
      if (rows.length !== input.table.rowCount) throw payloadInvalid();
      const update = database.prepare([
        "UPDATE pige_dataset_cells SET state = ?, source_type = ?, lexical_raw = NULL, lexical_text = NULL,",
        "quoted = NULL, projection_kind = ?, projection_json = ?, formula_json = ?, source_style_json = NULL",
        "WHERE row_id = ? AND column_id = ?"
      ].join(" "));
      for (const row of rows) {
        if (typeof row.row_id !== "string") throw payloadInvalid();
        const rowId = row.row_id;
        const value = evaluateFormulaExpression(input.expression, (columnId) => readNumericOperand(database, input.table, rowId, columnId));
        const encoded = value === null
          ? { state: "null" as const, kind: "null", projection: null }
          : { state: "value" as const, kind: "real", projection: JSON.stringify({ kind: "real", value }) };
        if (update.run(encoded.state, FORMULA_SOURCE_TYPE, encoded.kind, encoded.projection,
          JSON.stringify({ kind: "pige_numeric_formula", schemaVersion: 1, expression: input.expression }),
          rowId, input.columnId).changes !== 1) throw payloadInvalid();
        stats[encoded.state] += 1;
      }
      if (database.prepare("UPDATE pige_dataset_columns SET stats_json = ? WHERE table_id = ? AND column_id = ?")
        .run(JSON.stringify(stats), input.table.id, input.columnId).changes !== 1) throw payloadInvalid();
      updateRevisionMeta(database, input.revisionId);
      database.exec("COMMIT");
      assertIntegrity(database);
      return stats;
    } catch (caught) {
      database.exec("ROLLBACK");
      throw caught;
    }
  } finally {
    database.close();
    syncFile(input.payloadPath);
  }
}

function adoptRestoredPayload(payloadPath: string, datasetId: string, beforeRevisionId: string, revisionId: string) {
  const database = new DatabaseSync(payloadPath);
  try {
    database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;");
    validatePayloadMeta(database, datasetId, beforeRevisionId);
    updateRevisionMeta(database, revisionId);
    database.exec("COMMIT");
    assertIntegrity(database);
    return;
  } catch (caught) {
    try { database.exec("ROLLBACK"); } catch { /* transaction may not have started */ }
    throw caught;
  } finally {
    database.close();
    syncFile(payloadPath);
  }
}

function readNumericOperand(
  database: DatabaseSync,
  table: DatasetSchemaRecord["tables"][number],
  rowId: string,
  columnId: string
): number | null {
  const column = table.columns.find((candidate) => candidate.id === columnId);
  if (!column || !isEligibleOperand(column)) throw payloadInvalid();
  const row = database.prepare("SELECT state, projection_json FROM pige_dataset_cells WHERE row_id = ? AND column_id = ?")
    .get(rowId, columnId) as { state?: unknown; projection_json?: unknown } | undefined;
  if (!row || typeof row.state !== "string" || !(typeof row.projection_json === "string" || row.projection_json === null)) {
    throw payloadInvalid();
  }
  if (row.state === "missing" || row.state === "null" || row.state === "empty") return null;
  if (row.state !== "value" || row.projection_json === null) throw payloadInvalid();
  const value = (JSON.parse(row.projection_json) as { value?: unknown }).value;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function assertUpdateRevision(
  binding: BundleBinding,
  request: CollectionUpdateFormulaColumnRequest,
  identity: FormulaUpdateMutationIdentity,
  revision: DatasetRevision
): void {
  if (revision.id !== identity.revisionId || revision.operationId !== identity.operationId ||
      revision.parentRevisionId !== request.expectedRevisionId || revision.change?.kind !== "collection_formula_update" ||
      revision.change.tableId !== request.tableId || revision.change.columnId !== request.columnId) throw requestConflict();
  const schema = DatasetSchemaRecordSchema.parse(readJsonRef(binding.bundlePath, revision.schema));
  const column = schema.tables.find((table) => table.id === request.tableId)
    ?.columns.find((candidate) => candidate.id === request.columnId);
  if (column?.calculation?.kind !== "pige_numeric_formula" ||
      canonicalFormulaExpressionIdentity(column.calculation.expression) !== identity.expressionIdentity ||
      identity.expressionIdentity !== canonicalFormulaExpressionIdentity(request.expression)) throw requestConflict();
}

function assertEligibleOperands(table: DatasetSchemaRecord["tables"][number], expression: DatasetPigeFormulaExpression): void {
  for (const columnId of formulaReferencedColumnIds(expression)) {
    const column = table.columns.find((candidate) => candidate.id === columnId);
    if (!column || !isEligibleOperand(column)) {
      throw new PigeDomainError("collection.formula_operand_ineligible", "The Collection formula operand is unavailable.");
    }
  }
}

function isEligibleOperand(column: DatasetColumn): boolean {
  return column.calculation === undefined && column.relation === undefined && column.lookup === undefined && column.rollup === undefined &&
    (column.logicalType === "integer" || column.logicalType === "number") &&
    ![column.sourceType, ...(column.sourceTypes ?? [])].some((value) => value.toLowerCase().includes("formula"));
}

function requireTable(schema: DatasetSchemaRecord, tableId: string) {
  const table = schema.tables.find((candidate) => candidate.id === tableId);
  if (!table) throw new PigeDomainError("collection.table_not_found", "The Collection table is unavailable.");
  return table;
}

function readCurrent(binding: BundleBinding, expectedRevisionId: string): BundleBinding {
  const current = readBundle(binding.vaultPath, binding.manifest.datasetId);
  if (!current || current.manifest.activeRevision !== expectedRevisionId) {
    throw new PigeDomainError("collection.revision_changed", "The Collection revision changed before formula commit.");
  }
  return current;
}

function updateRevisionMeta(database: DatabaseSync, revisionId: string): void {
  if (database.prepare("UPDATE pige_dataset_meta SET value = ? WHERE key = 'revision_id'").run(revisionId).changes !== 1) {
    throw payloadInvalid();
  }
}

function assertIntegrity(database: DatabaseSync): void {
  const row = database.prepare("PRAGMA integrity_check").get() as { integrity_check?: unknown } | undefined;
  if (row?.integrity_check !== "ok") throw payloadInvalid();
}

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

function resultIdentity(request: CollectionUpdateFormulaColumnRequest) {
  return {
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    columnId: request.columnId
  };
}

function commitUncertain(): PigeDomainError {
  return new PigeDomainError("collection.commit_uncertain", "The Collection formula update could not be adopted.");
}

function digest(...parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
}
