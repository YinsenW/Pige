import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PigeDomainError } from "@pige/domain";
import {
  CollectionAddRelationColumnRequestSchema,
  CollectionAddRelationColumnResultSchema,
  CollectionUpdateRelationColumnRequestSchema,
  CollectionUpdateRelationColumnResultSchema,
  CollectionEditRelationCellRequestSchema,
  CollectionEditRelationCellResultSchema,
  CollectionRelationDisplayLabelSchema,
  DatasetManifestSchema,
  DatasetPigeRelationCellSchema,
  DatasetRevisionSchema,
  DatasetSchemaRecordSchema,
  OperationRecordSchema,
  type CollectionAddRelationColumnRequest,
  type CollectionAddRelationColumnResult,
  type CollectionColumnSummary,
  type CollectionEditRelationCellRequest,
  type CollectionEditRelationCellResult,
  type CollectionRelationCellValue,
  type CollectionSnapshot,
  type CollectionUpdateRelationColumnRequest,
  type CollectionUpdateRelationColumnResult,
  type DatasetColumn,
  type DatasetPigeRelationCell,
  type DatasetRevision,
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
  type BundleBinding,
  type CollectionCellBinding
} from "./managed-collection-storage";
import {
  recomputeFormulaDependenciesForRelationRow,
  type FormulaProjectionStatsByTable
} from "./managed-collection-formula-storage";

const MAX_COLLECTION_COLUMNS = 32;
const RELATION_SOURCE_TYPE = "pige.relation.single";
const RELATION_PROJECTION_KIND = "pige_relation_target_v1";

export interface RelationMutationIdentity {
  readonly revisionId: string;
  readonly operationId: string;
  readonly columnId?: string;
}

export function createRelationAddIdentity(request: CollectionAddRelationColumnRequest): RelationMutationIdentity {
  const dateKey = revisionDateKey(request.expectedRevisionId);
  return {
    revisionId: `dataset_rev_${dateKey}_${digest("pige:collection-relation-add:v1", request.requestId).slice(0, 20)}`,
    operationId: `op_${dateKey}_${digest("pige:collection-relation-add-operation:v1", request.requestId).slice(0, 20)}`,
    columnId: `column_${digest("pige:collection-relation-column:v1", request.tableId, request.requestId).slice(0, 20)}`
  };
}

export function createRelationEditIdentity(request: CollectionEditRelationCellRequest): RelationMutationIdentity {
  const dateKey = revisionDateKey(request.expectedRevisionId);
  return {
    revisionId: `dataset_rev_${dateKey}_${digest("pige:collection-relation-cell:v1", request.requestId).slice(0, 20)}`,
    operationId: `op_${dateKey}_${digest("pige:collection-relation-cell-operation:v1", request.requestId).slice(0, 20)}`
  };
}

export function createRelationUpdateIdentity(request: CollectionUpdateRelationColumnRequest): RelationMutationIdentity {
  const dateKey = revisionDateKey(request.expectedRevisionId);
  return {
    revisionId: `dataset_rev_${dateKey}_${digest("pige:collection-relation-update:v1", request.requestId).slice(0, 20)}`,
    operationId: `op_${dateKey}_${digest("pige:collection-relation-update-operation:v1", request.requestId).slice(0, 20)}`
  };
}

export function projectRelationColumns(
  columns: readonly DatasetColumn[],
  allColumns: readonly DatasetColumn[],
  base: readonly CollectionColumnSummary[]
): readonly CollectionColumnSummary[] {
  const inboundDisplay = new Set(allColumns.flatMap((column) => column.relation
    ? [column.relation.targetDisplayColumnId]
    : []));
  const derivedRelationSources = new Set(allColumns.flatMap((column) => [
    ...(column.lookup ? [column.lookup.relationColumnId] : []),
    ...(column.rollup ? [column.rollup.relationColumnId] : [])
  ]));
  return base.map((summary) => {
    const column = columns.find((candidate) => candidate.id === summary.columnId);
    if (!column) throw payloadInvalid();
    const relation = column.relation;
    const scalar = !column.calculation && !relation && !column.lookup &&
      ![column.sourceType, ...(column.sourceTypes ?? [])].some((value) => value.toLowerCase().includes("formula")) &&
      ["string", "integer", "number", "boolean", "date", "datetime"].includes(column.logicalType);
    return {
      ...summary,
      canTrash: summary.canTrash && !inboundDisplay.has(column.id),
      canUseAsFormulaOperand: summary.canUseAsFormulaOperand && !relation,
      canUseAsRelationDisplay: scalar,
      canEditRelationDefinition: relation?.kind === "pige_single_relation" && !derivedRelationSources.has(column.id),
      canEditRelation: relation?.kind === "pige_single_relation",
      hasInboundRelationDescriptors: inboundDisplay.has(column.id),
      ...(relation ? { relation } : {})
    };
  });
}

export function readRelationCellValue(
  database: DatabaseSync,
  schema: BundleBinding["schema"],
  cell: Omit<CollectionCellBinding, "tableName">
): CollectionRelationCellValue {
  const relation = cell.column.relation;
  if (!relation) throw payloadInvalid();
  if (cell.state === "null" && cell.projectionJson === "null") {
    return { kind: "relation", targetRowId: null, displayLabel: null };
  }
  if (cell.state !== "value" || cell.projectionKind !== RELATION_PROJECTION_KIND || cell.projectionJson === null) {
    throw payloadInvalid();
  }
  const target = DatasetPigeRelationCellSchema.parse(JSON.parse(cell.projectionJson));
  if (!target) throw payloadInvalid();
  const targetTable = schema.tables.find((candidate) => candidate.id === relation.targetTableId);
  const displayColumn = targetTable?.columns.find((candidate) => candidate.id === relation.targetDisplayColumnId);
  if (!targetTable || !displayColumn) throw payloadInvalid();
  const row = database.prepare("SELECT table_id FROM pige_dataset_rows WHERE row_id = ?")
    .get(target.targetRowId) as { table_id?: unknown } | undefined;
  if (row?.table_id !== targetTable.id) throw payloadInvalid();
  const raw = database.prepare(
    "SELECT state, projection_json FROM pige_dataset_cells WHERE row_id = ? AND column_id = ?"
  ).get(target.targetRowId, displayColumn.id) as { state?: unknown; projection_json?: unknown } | undefined;
  return {
    kind: "relation",
    targetRowId: target.targetRowId,
    displayLabel: deriveDisplayLabel(raw)
  };
}

export function rowHasInboundRelation(database: DatabaseSync, schema: BundleBinding["schema"], rowId: string): boolean {
  return readInboundRelationRowIds(database, schema).has(rowId);
}

export function readInboundRelationRowIds(
  database: DatabaseSync,
  schema: BundleBinding["schema"]
): ReadonlySet<string> {
  const result = new Set<string>();
  for (const table of schema.tables) {
    for (const column of table.columns.filter((candidate) => candidate.relation)) {
      const relation = column.relation!;
      const targetTable = schema.tables.find((candidate) => candidate.id === relation.targetTableId);
      const displayColumn = targetTable?.columns.find((candidate) => candidate.id === relation.targetDisplayColumnId);
      if (!targetTable || !displayColumn || !isRelationDisplayColumn(displayColumn)) throw payloadInvalid();
      const rows = database.prepare(
        "SELECT projection_json FROM pige_dataset_cells WHERE column_id = ? AND state = 'value'"
      ).all(column.id) as Array<{ projection_json?: unknown }>;
      for (const entry of rows) {
        const targetRowId = relationTargetId(entry.projection_json);
        if (!targetRowId) throw payloadInvalid();
        const target = database.prepare("SELECT table_id FROM pige_dataset_rows WHERE row_id = ?")
          .get(targetRowId) as { table_id?: unknown } | undefined;
        if (target?.table_id !== targetTable.id) throw payloadInvalid();
        result.add(targetRowId);
      }
    }
  }
  return result;
}

export function assertRelationTrashGuards(input: {
  readonly binding: BundleBinding;
  readonly tableId: string;
  readonly rowId?: string;
  readonly columnId?: string;
}): void {
  const database = new DatabaseSync(input.binding.payloadPath, { readOnly: true });
  try {
    database.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON;");
    validatePayloadMeta(database, input.binding.manifest.datasetId, input.binding.revision.id);
    if (input.rowId && rowHasInboundRelation(database, input.binding.schema, input.rowId)) {
      throw new PigeDomainError("collection.relation_inbound", "The Collection row is referenced by a relation.");
    }
    if (input.columnId) {
      const inbound = input.binding.schema.tables.some((table) => table.columns.some((column) =>
        column.relation?.targetTableId === input.tableId &&
        column.relation.targetDisplayColumnId === input.columnId) || table.columns.some((column) =>
        column.lookup?.relationColumnId === input.columnId || column.lookup?.targetColumnId === input.columnId));
      if (inbound) throw new PigeDomainError("collection.relation_inbound", "The Collection column labels a relation.");
      validateRelationSourceColumn(database, input.binding.schema, input.tableId, input.columnId);
    }
  } finally {
    database.close();
  }
}

export function executeRelationAdd(input: {
  readonly vaultPath?: string;
  readonly request: CollectionAddRelationColumnRequest;
  readonly isVaultActive: () => boolean;
  readonly readSnapshot: (binding: BundleBinding, tableId: string) => CollectionSnapshot | undefined;
  readonly createOperation: (binding: BundleBinding, revision: DatasetRevision) => OperationRecord;
}): CollectionAddRelationColumnResult {
  const request = CollectionAddRelationColumnRequestSchema.parse(input.request);
  const identity = resultIdentity(request);
  if (!input.vaultPath) return CollectionAddRelationColumnResultSchema.parse({ ...identity, status: "not_found" });
  try {
    const binding = readBundle(input.vaultPath, request.datasetId);
    if (!binding) return CollectionAddRelationColumnResultSchema.parse({ ...identity, status: "not_found" });
    const mutation = createRelationAddIdentity(request);
    const adopted = adoptRelationAdd({
      binding, request, identity: mutation,
      readSnapshot: input.readSnapshot, createOperation: input.createOperation
    });
    if (adopted) return adopted;
    const snapshot = input.readSnapshot(binding, request.tableId);
    if (!snapshot) return CollectionAddRelationColumnResultSchema.parse({ ...identity, status: "not_found" });
    if (binding.manifest.activeRevision !== request.expectedRevisionId) {
      return CollectionAddRelationColumnResultSchema.parse({ ...identity, status: "stale", snapshot });
    }
    const committed = commitRelationAdd(binding, request, mutation);
    const operation = input.createOperation(committed.binding, committed.revision);
    writeJsonExclusive(operationPathFor(committed.binding.vaultPath, operation.id), operation);
    if (!input.isVaultActive()) return CollectionAddRelationColumnResultSchema.parse({ ...identity, status: "not_found" });
    const next = input.readSnapshot(committed.binding, request.tableId);
    if (!next) throw payloadInvalid();
    return CollectionAddRelationColumnResultSchema.parse({
      ...identity, status: "committed", columnId: mutation.columnId!, operationId: operation.id, snapshot: next
    });
  } catch (caught) {
    if (caught instanceof PigeDomainError && caught.code === "collection.request_conflict") throw caught;
    const current = input.vaultPath ? readBundle(input.vaultPath, request.datasetId) : undefined;
    const snapshot = current ? input.readSnapshot(current, request.tableId) : undefined;
    if (snapshot && current?.manifest.activeRevision !== request.expectedRevisionId) {
      return CollectionAddRelationColumnResultSchema.parse({ ...identity, status: "stale", snapshot });
    }
    return CollectionAddRelationColumnResultSchema.parse({
      ...identity, status: caught instanceof PigeDomainError ? "ineligible" : "failed"
    });
  }
}

export function executeRelationEdit(input: {
  readonly vaultPath?: string;
  readonly request: CollectionEditRelationCellRequest;
  readonly isVaultActive: () => boolean;
  readonly readSnapshot: (binding: BundleBinding, tableId: string) => CollectionSnapshot | undefined;
  readonly createOperation: (binding: BundleBinding, revision: DatasetRevision) => OperationRecord;
}): CollectionEditRelationCellResult {
  const request = CollectionEditRelationCellRequestSchema.parse(input.request);
  const identity = editResultIdentity(request);
  if (!input.vaultPath) return CollectionEditRelationCellResultSchema.parse({ ...identity, status: "not_found" });
  try {
    const binding = readBundle(input.vaultPath, request.datasetId);
    if (!binding) return CollectionEditRelationCellResultSchema.parse({ ...identity, status: "not_found" });
    const mutation = createRelationEditIdentity(request);
    const adopted = adoptRelationEdit({
      binding, request, identity: mutation,
      readSnapshot: input.readSnapshot, createOperation: input.createOperation
    });
    if (adopted) return adopted;
    const snapshot = input.readSnapshot(binding, request.tableId);
    if (!snapshot) return CollectionEditRelationCellResultSchema.parse({ ...identity, status: "not_found" });
    if (binding.manifest.activeRevision !== request.expectedRevisionId) {
      return CollectionEditRelationCellResultSchema.parse({ ...identity, status: "stale", snapshot });
    }
    const committed = commitRelationEdit(binding, request, mutation);
    const operation = input.createOperation(committed.binding, committed.revision);
    writeJsonExclusive(operationPathFor(committed.binding.vaultPath, operation.id), operation);
    if (!input.isVaultActive()) return CollectionEditRelationCellResultSchema.parse({ ...identity, status: "not_found" });
    const next = input.readSnapshot(committed.binding, request.tableId);
    if (!next) throw payloadInvalid();
    return CollectionEditRelationCellResultSchema.parse({ ...identity, status: "committed", operationId: operation.id, snapshot: next });
  } catch (caught) {
    if (caught instanceof PigeDomainError && caught.code === "collection.request_conflict") throw caught;
    const current = input.vaultPath ? readBundle(input.vaultPath, request.datasetId) : undefined;
    const snapshot = current ? input.readSnapshot(current, request.tableId) : undefined;
    if (snapshot && current?.manifest.activeRevision !== request.expectedRevisionId) {
      return CollectionEditRelationCellResultSchema.parse({ ...identity, status: "stale", snapshot });
    }
    return CollectionEditRelationCellResultSchema.parse({
      ...identity, status: caught instanceof PigeDomainError ? "ineligible" : "failed"
    });
  }
}

export function executeRelationUpdate(input: {
  readonly vaultPath?: string;
  readonly request: CollectionUpdateRelationColumnRequest;
  readonly isVaultActive: () => boolean;
  readonly readSnapshot: (binding: BundleBinding, tableId: string) => CollectionSnapshot | undefined;
  readonly createOperation: (binding: BundleBinding, revision: DatasetRevision) => OperationRecord;
}): CollectionUpdateRelationColumnResult {
  const request = CollectionUpdateRelationColumnRequestSchema.parse(input.request);
  const identity = updateResultIdentity(request);
  if (!input.vaultPath) return CollectionUpdateRelationColumnResultSchema.parse({ ...identity, status: "not_found" });
  try {
    const binding = readBundle(input.vaultPath, request.datasetId);
    if (!binding) return CollectionUpdateRelationColumnResultSchema.parse({ ...identity, status: "not_found" });
    const mutation = createRelationUpdateIdentity(request);
    const adopted = adoptRelationUpdate({ binding, request, identity: mutation,
      readSnapshot: input.readSnapshot, createOperation: input.createOperation });
    if (adopted) return adopted;
    const snapshot = input.readSnapshot(binding, request.tableId);
    if (!snapshot) return CollectionUpdateRelationColumnResultSchema.parse({ ...identity, status: "not_found" });
    if (binding.manifest.activeRevision !== request.expectedRevisionId) {
      return CollectionUpdateRelationColumnResultSchema.parse({ ...identity, status: "stale", snapshot });
    }
    const committed = commitRelationUpdate(binding, request, mutation);
    const operation = input.createOperation(committed.binding, committed.revision);
    writeJsonExclusive(operationPathFor(committed.binding.vaultPath, operation.id), operation);
    if (!input.isVaultActive()) return CollectionUpdateRelationColumnResultSchema.parse({ ...identity, status: "not_found" });
    const next = input.readSnapshot(committed.binding, request.tableId);
    if (!next) throw payloadInvalid();
    return CollectionUpdateRelationColumnResultSchema.parse({ ...identity, status: "committed", operationId: operation.id, snapshot: next });
  } catch (caught) {
    if (caught instanceof PigeDomainError && caught.code === "collection.request_conflict") throw caught;
    const current = input.vaultPath ? readBundle(input.vaultPath, request.datasetId) : undefined;
    const snapshot = current ? input.readSnapshot(current, request.tableId) : undefined;
    if (snapshot && current?.manifest.activeRevision !== request.expectedRevisionId) {
      return CollectionUpdateRelationColumnResultSchema.parse({ ...identity, status: "stale", snapshot });
    }
    return CollectionUpdateRelationColumnResultSchema.parse({
      ...identity, status: caught instanceof PigeDomainError ? "ineligible" : "failed"
    });
  }
}

export function commitRelationUndo(input: {
  readonly binding: BundleBinding;
  readonly identity: RelationMutationIdentity;
  readonly afterRevisionId: string;
  readonly beforeRevisionId: string;
  readonly undoOfOperationId: string;
  readonly kind: "collection_relation_add" | "collection_relation_update" | "collection_relation_cell_edit";
}): { readonly binding: BundleBinding; readonly revision: DatasetRevision } {
  const current = requireCurrent(input.binding, input.afterRevisionId);
  const after = readRevisionById(current, input.afterRevisionId);
  const before = readRevisionById(current, input.beforeRevisionId);
  if (after.change?.kind !== input.kind || after.parentRevisionId !== before.id) throw requestConflict();
  const beforeSchema = DatasetSchemaRecordSchema.parse(readJsonRef(current.bundlePath, before.schema));
  const tableId = after.change.tableId;
  const columnId = after.change.columnId;
  const change = after.change.kind === "collection_relation_add"
    ? {
      kind: "collection_relation_add_undo" as const,
      targetTableId: after.change.targetTableId,
      targetDisplayColumnId: after.change.targetDisplayColumnId,
      undoOfOperationId: input.undoOfOperationId
    }
    : after.change.kind === "collection_relation_update"
      ? {
        kind: "collection_relation_update_undo" as const,
        targetTableId: beforeSchema.tables.find((candidate) => candidate.id === tableId)
          ?.columns.find((candidate) => candidate.id === columnId)?.relation?.targetTableId ?? after.change.targetTableId,
        targetDisplayColumnId: beforeSchema.tables.find((candidate) => candidate.id === tableId)
          ?.columns.find((candidate) => candidate.id === columnId)?.relation?.targetDisplayColumnId ?? after.change.targetDisplayColumnId,
        undoOfOperationId: input.undoOfOperationId
      }
    : {
      kind: "collection_relation_cell_edit_undo" as const,
      targetTableId: after.change.targetTableId,
      targetRowId: readRelationTargetFromRevision(current, before, after.change.rowId, columnId),
      undoOfOperationId: input.undoOfOperationId
    };
  return publishMutation({
    current,
    identity: input.identity,
    tableId,
    ...(after.change.kind === "collection_relation_cell_edit" ? { rowId: after.change.rowId } : {}),
    columnId,
    change,
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
}

export function commitRelationUndoOperation(input: Parameters<typeof commitRelationUndo>[0] & {
  readonly createOperation: (binding: BundleBinding, revision: DatasetRevision) => OperationRecord;
}): { readonly revision: DatasetRevision; readonly operation: OperationRecord } {
  const committed = commitRelationUndo(input);
  const operation = input.createOperation(committed.binding, committed.revision);
  writeJsonExclusive(operationPathFor(committed.binding.vaultPath, operation.id), operation);
  return { revision: committed.revision, operation };
}

function commitRelationAdd(
  binding: BundleBinding,
  request: CollectionAddRelationColumnRequest,
  identity: RelationMutationIdentity
): { readonly binding: BundleBinding; readonly revision: DatasetRevision } {
  const current = requireCurrent(binding, request.expectedRevisionId);
  const table = current.schema.tables.find((candidate) => candidate.id === request.tableId);
  const targetTable = current.schema.tables.find((candidate) => candidate.id === request.targetTableId);
  const display = targetTable?.columns.slice(0, MAX_COLLECTION_COLUMNS)
    .find((candidate) => candidate.id === request.targetDisplayColumnId);
  if (!table || !targetTable || !display || !isRelationDisplayColumn(display) || table.columns.length >= MAX_COLLECTION_COLUMNS ||
      table.columns.some((column) => normalize(column.name) === normalize(request.label))) {
    throw new PigeDomainError("collection.relation_ineligible", "The relation descriptor is ineligible.");
  }
  const column: DatasetColumn = {
    id: identity.columnId!, name: request.label.trim(), ordinal: table.columns.length,
    sourceType: RELATION_SOURCE_TYPE, sourceTypes: [RELATION_SOURCE_TYPE], logicalType: "string", nullable: true,
    relation: { kind: "pige_single_relation", schemaVersion: 1, targetTableId: targetTable.id, targetDisplayColumnId: display.id },
    stats: { missing: 0, empty: 0, null: table.rowCount, value: 0 }
  };
  return publishMutation({
    current, identity, tableId: table.id, columnId: column.id,
    change: { kind: "collection_relation_add", targetTableId: targetTable.id, targetDisplayColumnId: display.id },
    mutate: (database) => addRelationColumn(database, current, table, column, identity.revisionId),
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

function commitRelationEdit(
  binding: BundleBinding,
  request: CollectionEditRelationCellRequest,
  identity: RelationMutationIdentity
): { readonly binding: BundleBinding; readonly revision: DatasetRevision } {
  const current = requireCurrent(binding, request.expectedRevisionId);
  const table = current.schema.tables.find((candidate) => candidate.id === request.tableId);
  const column = table?.columns.find((candidate) => candidate.id === request.columnId);
  const relation = column?.relation;
  if (!table || !column || !relation) throw new PigeDomainError("collection.relation_ineligible", "The relation cell is unavailable.");
  let beforeState: "null" | "value";
  const database = new DatabaseSync(current.payloadPath, { readOnly: true });
  try {
    validatePayloadMeta(database, current.manifest.datasetId, current.revision.id);
    const source = database.prepare("SELECT table_id FROM pige_dataset_rows WHERE row_id = ?").get(request.rowId) as { table_id?: unknown } | undefined;
    const target = request.targetRowId === null ? undefined : database.prepare("SELECT table_id FROM pige_dataset_rows WHERE row_id = ?")
      .get(request.targetRowId) as { table_id?: unknown } | undefined;
    if (source?.table_id !== table.id || (request.targetRowId !== null && target?.table_id !== relation.targetTableId)) {
      throw new PigeDomainError("collection.relation_ineligible", "The relation row is unavailable.");
    }
    const currentCell = database.prepare(
      "SELECT state, projection_json FROM pige_dataset_cells WHERE row_id = ? AND column_id = ?"
    ).get(request.rowId, column.id) as { state?: unknown; projection_json?: unknown } | undefined;
    if (currentCell?.state !== "null" && currentCell?.state !== "value") throw payloadInvalid();
    beforeState = currentCell.state;
    const currentTarget = currentCell?.state === "null" && currentCell.projection_json === "null"
      ? null
      : relationTargetId(currentCell?.projection_json);
    if (currentTarget === undefined || currentTarget === request.targetRowId) {
      throw new PigeDomainError("collection.relation_ineligible", "The relation cell did not change.");
    }
  } finally {
    database.close();
  }
  const cell = request.targetRowId === null ? null : {
    kind: "pige_relation_target" as const, schemaVersion: 1 as const, targetRowId: request.targetRowId
  };
  const afterState = cell ? "value" : "null";
  const stats = column.stats ?? { missing: 0, empty: 0, null: 0, value: 0 };
  if (beforeState !== afterState && stats[beforeState] < 1) throw payloadInvalid();
  const nextStats = beforeState === afterState ? stats : {
    ...stats, [beforeState]: stats[beforeState] - 1, [afterState]: stats[afterState] + 1
  };
  const baseSchema = DatasetSchemaRecordSchema.parse({
    ...current.schema, revisionId: identity.revisionId, createdAt: new Date().toISOString(),
    tables: current.schema.tables.map((candidate) => candidate.id === table.id
      ? { ...candidate, columns: candidate.columns.map((entry) => entry.id === column.id
        ? { ...entry, stats: nextStats }
        : entry) }
      : candidate)
  });
  let formulaStats: FormulaProjectionStatsByTable = new Map();
  return publishMutation({
    current, identity, tableId: table.id, rowId: request.rowId, columnId: column.id,
    change: { kind: "collection_relation_cell_edit", targetTableId: relation.targetTableId, targetRowId: request.targetRowId },
    mutate: (database) => {
      editRelationCell(database, current, column, request.rowId, cell, identity.revisionId);
      formulaStats = recomputeFormulaDependenciesForRelationRow(database, current.schema, table.id, request.rowId);
    },
    schema: () => applyFormulaStats(baseSchema, formulaStats),
    stats: current.revision.stats
  });
}

function commitRelationUpdate(
  binding: BundleBinding,
  request: CollectionUpdateRelationColumnRequest,
  identity: RelationMutationIdentity
): { readonly binding: BundleBinding; readonly revision: DatasetRevision } {
  const current = requireCurrent(binding, request.expectedRevisionId);
  const table = current.schema.tables.find((candidate) => candidate.id === request.tableId);
  const column = table?.columns.find((candidate) => candidate.id === request.columnId);
  const relation = column?.relation;
  const targetTable = current.schema.tables.find((candidate) => candidate.id === request.targetTableId);
  const display = targetTable?.columns.find((candidate) => candidate.id === request.targetDisplayColumnId);
  const dependent = current.schema.tables.some((candidate) => candidate.columns.some((entry) =>
    entry.lookup?.relationColumnId === request.columnId || entry.rollup?.relationColumnId === request.columnId));
  if (!table || !column || relation?.kind !== "pige_single_relation" || !targetTable || !display ||
      !isRelationDisplayColumn(display) || dependent ||
      (relation.targetTableId === targetTable.id && relation.targetDisplayColumnId === display.id)) {
    throw new PigeDomainError("collection.relation_ineligible", "The relation descriptor is ineligible.");
  }
  const clearTargets = relation.targetTableId !== targetTable.id;
  const nextStats = clearTargets
    ? { missing: 0, empty: 0, null: table.rowCount, value: 0 }
    : column.stats;
  const descriptor = { kind: "pige_single_relation" as const, schemaVersion: 1 as const,
    targetTableId: targetTable.id, targetDisplayColumnId: display.id };
  return publishMutation({
    current, identity, tableId: table.id, columnId: column.id,
    change: { kind: "collection_relation_update", targetTableId: targetTable.id, targetDisplayColumnId: display.id },
    mutate: (database) => updateRelationDescriptorPayload(database, current, column, clearTargets, identity.revisionId),
    schema: DatasetSchemaRecordSchema.parse({
      ...current.schema, revisionId: identity.revisionId, createdAt: new Date().toISOString(),
      tables: current.schema.tables.map((candidate) => candidate.id === table.id
        ? { ...candidate, columns: candidate.columns.map((entry) => entry.id === column.id
          ? { ...entry, relation: descriptor, ...(nextStats ? { stats: nextStats } : {}) }
          : entry) }
        : candidate)
    }),
    stats: current.revision.stats
  });
}

function publishMutation(input: {
  readonly current: BundleBinding;
  readonly identity: RelationMutationIdentity;
  readonly tableId: string;
  readonly rowId?: string;
  readonly columnId: string;
  readonly change: Record<string, unknown> & { readonly kind:
    | "collection_relation_add"
    | "collection_relation_add_undo"
    | "collection_relation_update"
    | "collection_relation_update_undo"
    | "collection_relation_cell_edit"
    | "collection_relation_cell_edit_undo" };
  readonly mutate: (database: DatabaseSync) => void;
  readonly sourcePayload?: string;
  readonly sourceRevisionId?: string;
  readonly schema: BundleBinding["schema"] | (() => BundleBinding["schema"]);
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
    const schema = typeof input.schema === "function" ? input.schema() : input.schema;
    writeJsonImmutable(resolveBundleRelativePath(input.current.bundlePath, schemaRelativePath), schema);
    const now = new Date().toISOString();
    const revision = DatasetRevisionSchema.parse({
      ...input.current.revision, id: input.identity.revisionId, parentRevisionId: input.current.revision.id,
      schema: fileRef(input.current.bundlePath, schemaRelativePath),
      payload: { ...fileRef(input.current.bundlePath, payloadRelativePath), format: "sqlite" },
      stats: input.stats, operationId: input.identity.operationId,
      change: { ...input.change, tableId: input.tableId, ...(input.rowId ? { rowId: input.rowId } : {}), columnId: input.columnId },
      createdAt: now
    });
    writeJsonImmutable(resolveBundleRelativePath(input.current.bundlePath, revisionRelativePath), revision);
    replaceManifestCas(input.current, DatasetManifestSchema.parse({
      ...input.current.manifest, initialRevision: input.current.manifest.initialRevision ?? input.current.manifest.activeRevision,
      activeRevision: revision.id, revision: fileRef(input.current.bundlePath, revisionRelativePath),
      schema: revision.schema, payload: revision.payload, updatedAt: now
    }));
    const binding = readBundle(input.current.vaultPath, input.current.manifest.datasetId);
    if (!binding || binding.manifest.activeRevision !== revision.id) throw new PigeDomainError("collection.commit_uncertain", "The relation commit could not be adopted.");
    return { binding, revision };
  } finally { fs.rmSync(stagedRoot, { recursive: true, force: true }); }
}

function applyFormulaStats(
  schema: BundleBinding["schema"],
  stats: FormulaProjectionStatsByTable
): BundleBinding["schema"] {
  return DatasetSchemaRecordSchema.parse({
    ...schema,
    tables: schema.tables.map((table) => ({
      ...table,
      columns: table.columns.map((column) => {
        const next = stats.get(table.id)?.get(column.id);
        return next ? { ...column, stats: next } : column;
      })
    }))
  });
}

function readRelationTargetFromRevision(
  binding: BundleBinding,
  revision: DatasetRevision,
  rowId: string,
  columnId: string
): string | null {
  const database = new DatabaseSync(resolveBundleRelativePath(binding.bundlePath, revision.payload.path), { readOnly: true });
  try {
    validatePayloadMeta(database, binding.manifest.datasetId, revision.id);
    const row = database.prepare("SELECT state, projection_json FROM pige_dataset_cells WHERE row_id = ? AND column_id = ?")
      .get(rowId, columnId) as { state?: unknown; projection_json?: unknown } | undefined;
    if (row?.state === "null" && row.projection_json === "null") return null;
    const target = relationTargetId(row?.projection_json);
    if (!target) throw payloadInvalid();
    return target;
  } finally { database.close(); }
}

function addRelationColumn(database: DatabaseSync, current: BundleBinding, table: BundleBinding["schema"]["tables"][number], column: DatasetColumn, revisionId: string): void {
  database.prepare("INSERT INTO pige_dataset_columns VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    column.id, table.id, column.ordinal, column.name, "text", JSON.stringify(column.sourceTypes), JSON.stringify(column.stats)
  );
  const rows = database.prepare("SELECT row_id FROM pige_dataset_rows WHERE table_id = ? ORDER BY ordinal").all(table.id) as Array<{ row_id?: unknown }>;
  if (rows.length !== table.rowCount) throw payloadInvalid();
  const insert = database.prepare([
    "INSERT INTO pige_dataset_cells",
    "(row_id, column_id, state, source_type, lexical_raw, lexical_text, quoted, projection_kind, projection_json, formula_json, source_style_json)",
    "VALUES (?, ?, 'null', ?, NULL, NULL, NULL, ?, 'null', NULL, NULL)"
  ].join(" "));
  for (const row of rows) {
    if (typeof row.row_id !== "string" || insert.run(row.row_id, column.id, RELATION_SOURCE_TYPE, RELATION_PROJECTION_KIND).changes !== 1) throw payloadInvalid();
  }
  if (database.prepare("UPDATE pige_dataset_tables SET column_count = column_count + 1 WHERE table_id = ? AND column_count = ?")
    .run(table.id, table.columnCount).changes !== 1 ||
    database.prepare("UPDATE pige_dataset_meta SET value = ? WHERE key = 'revision_id'").run(revisionId).changes !== 1) throw payloadInvalid();
}

function editRelationCell(database: DatabaseSync, current: BundleBinding, column: DatasetColumn, rowId: string,
  target: DatasetPigeRelationCell, revisionId: string): void {
  const before = database.prepare("SELECT state FROM pige_dataset_cells WHERE row_id = ? AND column_id = ?")
    .get(rowId, column.id) as { state?: unknown } | undefined;
  if (!before || (before.state !== "null" && before.state !== "value")) throw payloadInvalid();
  const state = target ? "value" : "null";
  const changed = database.prepare([
    "UPDATE pige_dataset_cells SET state = ?, source_type = ?, lexical_raw = NULL, lexical_text = NULL, quoted = NULL,",
    "projection_kind = ?, projection_json = ?, formula_json = NULL, source_style_json = NULL WHERE row_id = ? AND column_id = ?"
  ].join(" ")).run(state, RELATION_SOURCE_TYPE, RELATION_PROJECTION_KIND, JSON.stringify(target), rowId, column.id);
  if (changed.changes !== 1 || database.prepare("UPDATE pige_dataset_meta SET value = ? WHERE key = 'revision_id'")
    .run(revisionId).changes !== 1) throw payloadInvalid();
  if (column.stats && before.state !== state) {
    const stats = { ...column.stats, [before.state]: column.stats[before.state as "null" | "value"] - 1,
      [state]: column.stats[state] + 1 };
    if (database.prepare("UPDATE pige_dataset_columns SET stats_json = ? WHERE column_id = ?").run(JSON.stringify(stats), column.id).changes !== 1) throw payloadInvalid();
  }
}

function updateRelationDescriptorPayload(database: DatabaseSync, current: BundleBinding, column: DatasetColumn,
  clearTargets: boolean, revisionId: string): void {
  validateRelationSourceColumn(database, current.schema,
    current.schema.tables.find((table) => table.columns.some((candidate) => candidate.id === column.id))?.id ?? "", column.id);
  if (clearTargets) {
    const changed = database.prepare([
      "UPDATE pige_dataset_cells SET state = 'null', source_type = ?, lexical_raw = NULL, lexical_text = NULL, quoted = NULL,",
      "projection_kind = ?, projection_json = 'null', formula_json = NULL, source_style_json = NULL WHERE column_id = ?"
    ].join(" ")).run(RELATION_SOURCE_TYPE, RELATION_PROJECTION_KIND, column.id);
    const table = current.schema.tables.find((candidate) => candidate.columns.some((entry) => entry.id === column.id));
    if (!table || changed.changes !== table.rowCount || database.prepare("UPDATE pige_dataset_columns SET stats_json = ? WHERE column_id = ?")
      .run(JSON.stringify({ missing: 0, empty: 0, null: table.rowCount, value: 0 }), column.id).changes !== 1) throw payloadInvalid();
  }
  if (database.prepare("UPDATE pige_dataset_meta SET value = ? WHERE key = 'revision_id'")
    .run(revisionId).changes !== 1) throw payloadInvalid();
}

function adoptRelationAdd(input: {
  readonly binding: BundleBinding; readonly request: CollectionAddRelationColumnRequest; readonly identity: RelationMutationIdentity;
  readonly readSnapshot: (binding: BundleBinding, tableId: string) => CollectionSnapshot | undefined;
  readonly createOperation: (binding: BundleBinding, revision: DatasetRevision) => OperationRecord;
}): CollectionAddRelationColumnResult | undefined {
  const adopted = adoptRevision(input.binding, input.request.expectedRevisionId, input.identity, "collection_relation_add", input.createOperation);
  if (!adopted) return undefined;
  const change = adopted.revision.change;
  if (change?.kind !== "collection_relation_add" || change.tableId !== input.request.tableId ||
      change.columnId !== input.identity.columnId || change.targetTableId !== input.request.targetTableId ||
      change.targetDisplayColumnId !== input.request.targetDisplayColumnId) throw requestConflict();
  const snapshot = input.readSnapshot(adopted.binding, input.request.tableId);
  if (!snapshot) throw requestConflict();
  const column = snapshot.columns.find((candidate) => candidate.columnId === input.identity.columnId);
  if (column?.label !== input.request.label.trim() ||
      column.relation?.targetTableId !== input.request.targetTableId ||
      column.relation.targetDisplayColumnId !== input.request.targetDisplayColumnId) throw requestConflict();
  const identity = resultIdentity(input.request);
  return CollectionAddRelationColumnResultSchema.parse({ ...identity, status: "committed", columnId: input.identity.columnId!, operationId: adopted.operation.id, snapshot });
}

function adoptRelationEdit(input: {
  readonly binding: BundleBinding; readonly request: CollectionEditRelationCellRequest; readonly identity: RelationMutationIdentity;
  readonly readSnapshot: (binding: BundleBinding, tableId: string) => CollectionSnapshot | undefined;
  readonly createOperation: (binding: BundleBinding, revision: DatasetRevision) => OperationRecord;
}): CollectionEditRelationCellResult | undefined {
  const adopted = adoptRevision(input.binding, input.request.expectedRevisionId, input.identity, "collection_relation_cell_edit", input.createOperation);
  if (!adopted) return undefined;
  const change = adopted.revision.change;
  if (change?.kind !== "collection_relation_cell_edit" || change.tableId !== input.request.tableId ||
      change.rowId !== input.request.rowId || change.columnId !== input.request.columnId ||
      change.targetRowId !== input.request.targetRowId) throw requestConflict();
  const snapshot = input.readSnapshot(adopted.binding, input.request.tableId);
  if (!snapshot) throw requestConflict();
  return CollectionEditRelationCellResultSchema.parse({ ...editResultIdentity(input.request), status: "committed", operationId: adopted.operation.id, snapshot });
}

function adoptRelationUpdate(input: {
  readonly binding: BundleBinding; readonly request: CollectionUpdateRelationColumnRequest; readonly identity: RelationMutationIdentity;
  readonly readSnapshot: (binding: BundleBinding, tableId: string) => CollectionSnapshot | undefined;
  readonly createOperation: (binding: BundleBinding, revision: DatasetRevision) => OperationRecord;
}): CollectionUpdateRelationColumnResult | undefined {
  const adopted = adoptRevision(input.binding, input.request.expectedRevisionId, input.identity,
    "collection_relation_update", input.createOperation);
  if (!adopted) return undefined;
  const change = adopted.revision.change;
  if (change?.kind !== "collection_relation_update" || change.tableId !== input.request.tableId ||
      change.columnId !== input.request.columnId || change.targetTableId !== input.request.targetTableId ||
      change.targetDisplayColumnId !== input.request.targetDisplayColumnId) throw requestConflict();
  const snapshot = input.readSnapshot(adopted.binding, input.request.tableId);
  if (!snapshot) throw requestConflict();
  const descriptor = snapshot.columns.find((candidate) => candidate.columnId === input.request.columnId)?.relation;
  if (descriptor?.targetTableId !== input.request.targetTableId ||
      descriptor.targetDisplayColumnId !== input.request.targetDisplayColumnId) throw requestConflict();
  return CollectionUpdateRelationColumnResultSchema.parse({ ...updateResultIdentity(input.request),
    status: "committed", operationId: adopted.operation.id, snapshot });
}

function adoptRevision(binding: BundleBinding, expectedRevisionId: string, identity: RelationMutationIdentity,
  kind: "collection_relation_add" | "collection_relation_update" | "collection_relation_cell_edit",
  createOperation: (binding: BundleBinding, revision: DatasetRevision) => OperationRecord
): { readonly binding: BundleBinding; readonly revision: DatasetRevision; readonly operation: OperationRecord } | undefined {
  const revisionPath = resolveBundleRelativePath(binding.bundlePath, `revisions/${identity.revisionId}.json`);
  if (!fs.existsSync(revisionPath)) return undefined;
  const revision = DatasetRevisionSchema.parse(readJsonBounded(revisionPath, MAX_COLLECTION_JSON_BYTES));
  if (revision.id !== identity.revisionId || revision.operationId !== identity.operationId ||
      revision.parentRevisionId !== expectedRevisionId || revision.change?.kind !== kind) throw requestConflict();
  let current = binding;
  if (current.manifest.activeRevision !== revision.id) {
    if (current.manifest.activeRevision !== expectedRevisionId) throw requestConflict();
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
  return { binding: current, revision, operation };
}

function validateRelationSourceColumn(database: DatabaseSync, schema: BundleBinding["schema"], tableId: string, columnId: string): void {
  const column = schema.tables.find((table) => table.id === tableId)?.columns.find((candidate) => candidate.id === columnId);
  if (!column?.relation) return;
  const targetTable = schema.tables.find((table) => table.id === column.relation!.targetTableId);
  const displayColumn = targetTable?.columns.find((candidate) => candidate.id === column.relation!.targetDisplayColumnId);
  if (!targetTable || !displayColumn || !isRelationDisplayColumn(displayColumn)) throw payloadInvalid();
  const rows = database.prepare("SELECT state, projection_json FROM pige_dataset_cells WHERE column_id = ?")
    .all(columnId) as Array<{ state?: unknown; projection_json?: unknown }>;
  for (const row of rows) {
    if (row.state === "null" && row.projection_json === "null") continue;
    const targetRowId = relationTargetId(row.projection_json);
    if (row.state !== "value" || !targetRowId) throw payloadInvalid();
    const target = database.prepare("SELECT table_id FROM pige_dataset_rows WHERE row_id = ?")
      .get(targetRowId) as { table_id?: unknown } | undefined;
    if (target?.table_id !== targetTable.id) throw payloadInvalid();
  }
}

function deriveDisplayLabel(raw: { state?: unknown; projection_json?: unknown } | undefined): string | null {
  if (!raw || raw.state === "missing" || raw.state === "null" || raw.state === "empty") return null;
  if (raw.state !== "value" || typeof raw.projection_json !== "string") throw payloadInvalid();
  const value = (JSON.parse(raw.projection_json) as { value?: unknown }).value;
  const text = typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value)
    ? String(Object.is(value, -0) ? 0 : value) : typeof value === "boolean" ? String(value) : null;
  if (text === null) throw payloadInvalid();
  if (text.length === 0) return null;
  const encoder = new TextEncoder();
  if (encoder.encode(text).byteLength <= 512 && text.length <= 160) return CollectionRelationDisplayLabelSchema.parse(text);
  let clipped = "";
  for (const character of text) {
    if (encoder.encode(`${clipped}${character}…`).byteLength > 512 || clipped.length + character.length + 1 > 160) break;
    clipped += character;
  }
  return CollectionRelationDisplayLabelSchema.parse(`${clipped}…`);
}

function relationTargetId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = DatasetPigeRelationCellSchema.safeParse(JSON.parse(value));
  return parsed.success && parsed.data ? parsed.data.targetRowId : undefined;
}
function isRelationDisplayColumn(column: DatasetColumn): boolean {
  return !column.calculation && !column.relation && !column.lookup && !column.rollup &&
    ![column.sourceType, ...(column.sourceTypes ?? [])].some((value) => value.toLowerCase().includes("formula")) &&
    ["string", "integer", "number", "boolean", "date", "datetime"].includes(column.logicalType);
}
function requireCurrent(binding: BundleBinding, revisionId: string): BundleBinding {
  const current = readBundle(binding.vaultPath, binding.manifest.datasetId);
  if (!current || current.manifest.activeRevision !== revisionId) throw new PigeDomainError("collection.revision_changed", "The Collection revision changed.");
  return current;
}
function resultIdentity(request: CollectionAddRelationColumnRequest) { return {
  apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
  datasetId: request.datasetId, tableId: request.tableId,
  targetTableId: request.targetTableId, targetDisplayColumnId: request.targetDisplayColumnId
}; }
function editResultIdentity(request: CollectionEditRelationCellRequest) { return {
  apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
  datasetId: request.datasetId, tableId: request.tableId, rowId: request.rowId,
  columnId: request.columnId, targetRowId: request.targetRowId
}; }
function updateResultIdentity(request: CollectionUpdateRelationColumnRequest) { return {
  apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
  datasetId: request.datasetId, tableId: request.tableId, columnId: request.columnId,
  targetTableId: request.targetTableId, targetDisplayColumnId: request.targetDisplayColumnId
}; }
function normalize(value: string): string { return value.trim().normalize("NFC").toLocaleLowerCase("en-US"); }
function revisionDateKey(revisionId: string): string {
  const match = /^dataset_rev_(\d{8})_[a-z0-9]{12,}$/u.exec(revisionId);
  if (!match) throw requestConflict();
  return match[1]!;
}
function digest(...parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
}
