import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { constants as sqliteConstants, DatabaseSync } from "node:sqlite";
import { PigeDomainError } from "@pige/domain";
import type { DatasetLogicalType } from "@pige/schemas";
import {
  DATASET_QUERY_DEFAULT_LIMITS,
  DATASET_QUERY_PROTOCOL_VERSION,
  createDatasetQueryPlanHash,
  createDatasetQueryResultHash,
  type DatasetQueryCellState,
  type DatasetQueryCoreColumn,
  type DatasetQueryCoreResult,
  type DatasetQueryCoreRow,
  type DatasetQueryInternalAggregate,
  type DatasetQueryInternalFilter,
  type DatasetQueryInternalOrder,
  type DatasetQueryLimits,
  type DatasetQueryScalar,
  type DatasetQueryWorkerRequest
} from "./dataset-query-types";

const FIXED_TABLE_SQL_SOURCE: readonly (readonly [string, string])[] = [
  ["pige_dataset_meta", `
    CREATE TABLE pige_dataset_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT
  `],
  ["pige_dataset_tables", `
    CREATE TABLE pige_dataset_tables (
      table_id TEXT PRIMARY KEY,
      ordinal INTEGER NOT NULL,
      source_name TEXT NOT NULL,
      source_locator TEXT NOT NULL,
      source_metadata_json TEXT NOT NULL,
      header_json TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      column_count INTEGER NOT NULL
    ) STRICT
  `],
  ["pige_dataset_columns", `
    CREATE TABLE pige_dataset_columns (
      column_id TEXT PRIMARY KEY,
      table_id TEXT NOT NULL REFERENCES pige_dataset_tables(table_id),
      ordinal INTEGER NOT NULL,
      name TEXT NOT NULL,
      projected_type TEXT NOT NULL,
      source_types_json TEXT NOT NULL,
      stats_json TEXT NOT NULL,
      UNIQUE(table_id, ordinal)
    ) STRICT
  `],
  ["pige_dataset_rows", `
    CREATE TABLE pige_dataset_rows (
      row_id TEXT PRIMARY KEY,
      table_id TEXT NOT NULL REFERENCES pige_dataset_tables(table_id),
      ordinal INTEGER NOT NULL,
      source_row INTEGER NOT NULL,
      UNIQUE(table_id, ordinal)
    ) STRICT
  `],
  ["pige_dataset_cells", `
    CREATE TABLE pige_dataset_cells (
      row_id TEXT NOT NULL REFERENCES pige_dataset_rows(row_id),
      column_id TEXT NOT NULL REFERENCES pige_dataset_columns(column_id),
      state TEXT NOT NULL,
      source_type TEXT NOT NULL,
      lexical_raw TEXT,
      lexical_text TEXT,
      quoted INTEGER,
      projection_kind TEXT NOT NULL,
      projection_json TEXT,
      formula_json TEXT,
      source_style_json TEXT,
      PRIMARY KEY(row_id, column_id)
    ) STRICT
  `]
];

const FIXED_TABLE_SQL = new Map<string, string>(
  FIXED_TABLE_SQL_SOURCE.map(([name, sql]): [string, string] => [name, normalizeSql(sql)])
);

const FIXED_AUTO_INDEXES = new Set([
  "sqlite_autoindex_pige_dataset_meta_1",
  "sqlite_autoindex_pige_dataset_tables_1",
  "sqlite_autoindex_pige_dataset_columns_1",
  "sqlite_autoindex_pige_dataset_columns_2",
  "sqlite_autoindex_pige_dataset_rows_1",
  "sqlite_autoindex_pige_dataset_rows_2",
  "sqlite_autoindex_pige_dataset_cells_1"
]);

const READABLE_COLUMNS = new Map<string, ReadonlySet<string>>([
  ["sqlite_master", new Set(["type", "name", "tbl_name", "sql"])],
  ["pige_dataset_meta", new Set(["key", "value"])],
  ["pige_dataset_tables", new Set([
    "table_id", "ordinal", "source_name", "source_locator", "source_metadata_json",
    "header_json", "row_count", "column_count"
  ])],
  ["pige_dataset_columns", new Set([
    "column_id", "table_id", "ordinal", "name", "projected_type", "source_types_json", "stats_json"
  ])],
  ["pige_dataset_rows", new Set(["row_id", "table_id", "ordinal", "source_row"])],
  ["pige_dataset_cells", new Set([
    "row_id", "column_id", "state", "source_type", "lexical_raw", "lexical_text", "quoted",
    "projection_kind", "projection_json", "formula_json", "source_style_json"
  ])]
]);

interface QueryCell {
  readonly state: DatasetQueryCellState;
  readonly logicalType: DatasetLogicalType;
  readonly value: DatasetQueryScalar;
}

interface ScannedRow {
  readonly rowId: string;
  readonly ordinal: number;
  readonly sourceRow: number;
  readonly cells: ReadonlyMap<string, QueryCell>;
}

interface SortableRow {
  readonly row: DatasetQueryCoreRow;
  readonly sortValues: ReadonlyMap<string, QueryCell>;
  readonly tieKey: string;
}

type AggregateAccumulator =
  | { readonly op: "count"; count: number }
  | { readonly op: "sum" | "avg"; sum: number; count: number; readonly integerInput: boolean }
  | { readonly op: "min" | "max"; value?: QueryCell };

interface GroupAccumulator {
  readonly key: string;
  readonly groupCells: readonly QueryCell[];
  readonly aggregates: AggregateAccumulator[];
}

export function executeDatasetQuery(request: DatasetQueryWorkerRequest): DatasetQueryCoreResult {
  validateWorkerRequest(request);
  const before = assertPayloadFile(request.payloadPath, request.limits);
  const beforeChecksum = checksumFile(request.payloadPath);
  if (beforeChecksum !== request.binding.payloadChecksum) {
    fail("dataset.query.payload_tampered", "The managed Dataset payload checksum does not match its active revision.");
  }

  let database: DatabaseSync | undefined;
  let result: DatasetQueryCoreResult;
  try {
    database = new DatabaseSync(request.payloadPath, {
      readOnly: true,
      allowExtension: false,
      defensive: true,
      enableForeignKeyConstraints: false,
      enableDoubleQuotedStringLiterals: false,
      timeout: 0,
      readBigInts: true,
      returnArrays: true,
      allowBareNamedParameters: false,
      allowUnknownNamedParameters: false
    });
    database.enableDefensive(true);
    database.enableLoadExtension(false);
    database.setAuthorizer(authorizeFixedDatasetRead);
    validateFixedSchema(database);
    validatePayloadBinding(database, request);
    result = runBoundedPlan(database, request);
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError(
      "dataset.query.payload_invalid",
      "The managed Dataset payload could not be queried through the fixed read-only schema."
    );
  } finally {
    if (database?.isOpen) database.close();
  }

  const after = assertPayloadFile(request.payloadPath, request.limits);
  if (!sameFileRevision(before, after) || checksumFile(request.payloadPath) !== beforeChecksum) {
    fail("dataset.query.payload_changed", "The managed Dataset payload changed during the bounded query.");
  }
  return result;
}

function runBoundedPlan(database: DatabaseSync, request: DatasetQueryWorkerRequest): DatasetQueryCoreResult {
  const planHash = createDatasetQueryPlanHash(request);
  const columnsById = new Map(request.columns.map((column) => [column.id, column]));
  const usedColumnIds = collectUsedColumnIds(request, columnsById);
  const readColumns = request.columns.filter((column) => usedColumnIds.includes(column.id));
  if (readColumns.length === 0) {
    fail("dataset.query.plan_invalid", "The Dataset query did not resolve any bounded columns.");
  }
  if (request.table.rowCount > request.limits.maxScanRows) {
    limitFail("scan_rows", "The Dataset query exceeds the bounded row scan limit.");
  }
  const predictedCells = request.table.rowCount * readColumns.length;
  if (!Number.isSafeInteger(predictedCells) || predictedCells > request.limits.maxScanCells) {
    limitFail("scan_cells", "The Dataset query exceeds the bounded cell scan limit.");
  }

  const projectionRows: SortableRow[] = [];
  const groups = new Map<string, GroupAccumulator>();
  let sourceMatchedRowCount = 0;
  let rangeStart: number | undefined;
  let rangeEnd: number | undefined;
  let scanBytes = 0;
  let observedRows = 0;
  let observedCells = 0;
  const projectionQuery = [
    "SELECT r.row_id, r.ordinal, r.source_row, c.column_id, c.state,",
    "c.projection_kind, c.projection_json",
    "FROM pige_dataset_rows AS r",
    "JOIN pige_dataset_cells AS c ON c.row_id = r.row_id",
    `WHERE r.table_id = ? AND c.column_id IN (${readColumns.map(() => "?").join(", ")})`,
    "ORDER BY r.ordinal ASC, c.column_id COLLATE BINARY ASC"
  ].join(" ");
  const rows = database.prepare(projectionQuery).iterate(
    request.table.id,
    ...readColumns.map((column) => column.id)
  );
  let currentRowId: string | undefined;
  let currentOrdinal = -1;
  let currentSourceRow = -1;
  let currentCells = new Map<string, QueryCell>();

  const finishRow = (): void => {
    if (currentRowId === undefined) return;
    if (currentCells.size !== readColumns.length) {
      fail("dataset.query.payload_invalid", "A managed Dataset row is missing a required normalized cell.");
    }
    const scanned: ScannedRow = {
      rowId: currentRowId,
      ordinal: currentOrdinal,
      sourceRow: currentSourceRow,
      cells: currentCells
    };
    if (!request.plan.filters.every((filter) => matchesFilter(scanned, filter))) return;
    sourceMatchedRowCount += 1;
    rangeStart = rangeStart === undefined ? scanned.sourceRow : Math.min(rangeStart, scanned.sourceRow);
    rangeEnd = rangeEnd === undefined ? scanned.sourceRow : Math.max(rangeEnd, scanned.sourceRow);
    if (request.plan.aggregates.length === 0) {
      const candidate = createProjectionRow(scanned, request, columnsById);
      insertBounded(
        projectionRows,
        candidate,
        (left, right) => compareSortableRows(left, right, request.plan.orderBy, columnsById),
        request.plan.limit
      );
      return;
    }
    updateGroup(groups, scanned, request, columnsById);
  };

  for (const raw of rows) {
    const values = expectArrayRow(raw, 7);
    const rowId = expectString(values[0]);
    const startsNewRow = currentRowId === undefined || rowId !== currentRowId;
    if (startsNewRow) {
      observedRows += 1;
      if (observedRows > request.limits.maxScanRows) {
        limitFail("scan_rows", "The Dataset query exceeds the bounded row scan limit.");
      }
    }
    observedCells += 1;
    if (observedCells > request.limits.maxScanCells) {
      limitFail("scan_cells", "The Dataset query exceeds the bounded cell scan limit.");
    }
    const ordinal = expectSafeCount(values[1]);
    const sourceRow = expectSafeCount(values[2]);
    const columnId = expectString(values[3]);
    const state = expectCellState(values[4]);
    const projectionKind = expectString(values[5]);
    const projectionJson = values[6];
    if (currentRowId !== undefined && startsNewRow) {
      finishRow();
      if (ordinal <= currentOrdinal) {
        fail("dataset.query.payload_invalid", "Managed Dataset row order is not deterministic.");
      }
      currentCells = new Map<string, QueryCell>();
    }
    if (startsNewRow) {
      if (!/^row_[a-z0-9]{12,}$/u.test(rowId)) {
        fail("dataset.query.payload_invalid", "A managed Dataset row has an invalid stable identity.");
      }
      currentRowId = rowId;
      currentOrdinal = ordinal;
      currentSourceRow = sourceRow;
    } else if (ordinal !== currentOrdinal || sourceRow !== currentSourceRow) {
      fail("dataset.query.payload_invalid", "A managed Dataset row has conflicting normalized coordinates.");
    }
    const column = columnsById.get(columnId);
    if (!column || !usedColumnIds.includes(columnId) || currentCells.has(columnId)) {
      fail("dataset.query.payload_invalid", "A managed Dataset cell has an invalid column binding.");
    }
    scanBytes += byteLength(rowId) + byteLength(columnId) + byteLength(projectionKind) +
      (typeof projectionJson === "string" ? byteLength(projectionJson) : 0);
    if (scanBytes > request.limits.maxScanBytes) {
      limitFail("scan_bytes", "The Dataset query exceeds the bounded scan-byte limit.");
    }
    currentCells.set(
      columnId,
      parseQueryCell(state, projectionKind, projectionJson, column.logicalType, request.limits)
    );
  }
  finishRow();
  if (observedRows !== request.table.rowCount) {
    fail("dataset.query.payload_invalid", "Managed Dataset row counts do not match the active schema revision.");
  }

  const aggregateQuery = request.plan.aggregates.length > 0;
  const finalizedRows = aggregateQuery
    ? finalizeGroups(groups, request, columnsById)
    : projectionRows.map(({ row }) => row);
  const resultColumns = createResultColumns(request, columnsById);
  if (resultColumns.length === 0 || resultColumns.length > request.limits.maxResultColumns) {
    limitFail("result_columns", "The Dataset query exceeds the bounded output-column limit.");
  }
  const matchedRowCount = aggregateQuery
    ? request.plan.groupByColumnIds.length === 0
      ? 1
      : groups.size
    : sourceMatchedRowCount;
  const rowsForResult = finalizedRows.slice(0, request.plan.limit);
  const withoutHash: Omit<DatasetQueryCoreResult, "resultHash"> = {
    planHash,
    columns: resultColumns,
    rows: rowsForResult,
    sourceMatchedRowCount,
    matchedRowCount,
    returnedRowCount: rowsForResult.length,
    truncated: matchedRowCount > rowsForResult.length,
    usedColumnIds,
    returnedRowIds: rowsForResult.flatMap((row) => row.rowId ? [row.rowId] : []),
    ...(rangeStart !== undefined && rangeEnd !== undefined
      ? { range: { startRow: rangeStart, endRow: rangeEnd } }
      : {})
  };
  if (byteLength(JSON.stringify(withoutHash)) > request.limits.maxResultBytes) {
    limitFail("result_bytes", "The Dataset query result exceeds the bounded output-byte limit.");
  }
  return { ...withoutHash, resultHash: createDatasetQueryResultHash(withoutHash) };
}

function validateFixedSchema(database: DatabaseSync): void {
  const rows = database.prepare(
    "SELECT type, name, tbl_name, sql FROM main.sqlite_schema " +
    "ORDER BY name COLLATE BINARY ASC, type COLLATE BINARY ASC"
  ).all();
  const tables = new Set<string>();
  const indexes = new Set<string>();
  for (const raw of rows) {
    const values = expectArrayRow(raw, 4);
    const type = expectString(values[0]);
    const name = expectString(values[1]);
    const tableName = expectString(values[2]);
    const sql = values[3];
    if (type === "table") {
      const expectedSql = FIXED_TABLE_SQL.get(name);
      if (!expectedSql || tableName !== name || typeof sql !== "string" || normalizeSql(sql) !== expectedSql) {
        fail("dataset.query.payload_schema_invalid", "The managed Dataset payload does not use Pige's fixed schema.");
      }
      tables.add(name);
      continue;
    }
    if (
      type === "index" &&
      FIXED_AUTO_INDEXES.has(name) &&
      FIXED_TABLE_SQL.has(tableName) &&
      sql === null
    ) {
      indexes.add(name);
      continue;
    }
    fail("dataset.query.payload_schema_invalid", "The managed Dataset payload contains an unsupported schema object.");
  }
  if (tables.size !== FIXED_TABLE_SQL.size || indexes.size !== FIXED_AUTO_INDEXES.size) {
    fail("dataset.query.payload_schema_invalid", "The managed Dataset payload fixed schema is incomplete.");
  }
}

function validatePayloadBinding(database: DatabaseSync, request: DatasetQueryWorkerRequest): void {
  const metaRows = database.prepare(
    "SELECT key, value FROM pige_dataset_meta ORDER BY key COLLATE BINARY ASC"
  ).all();
  const meta = new Map<string, string>();
  for (const raw of metaRows) {
    const values = expectArrayRow(raw, 2);
    const key = expectString(values[0]);
    const value = expectString(values[1]);
    if (meta.has(key)) fail("dataset.query.payload_invalid", "Managed Dataset metadata contains duplicate keys.");
    meta.set(key, value);
  }
  if (
    meta.size !== 5 ||
    meta.get("format") !== "pige-managed-collection-v1" ||
    meta.get("dataset_id") !== request.binding.datasetId ||
    meta.get("revision_id") !== request.binding.revisionId ||
    !/^[a-f0-9]{64}$/u.test(meta.get("source_sha256") ?? "") ||
    !/^[a-z0-9._-]+@[a-z0-9._-]+$/iu.test(meta.get("planner") ?? "")
  ) {
    fail("dataset.query.payload_binding_invalid", "Managed Dataset metadata does not match the active revision.");
  }

  const tableRaw = database.prepare(
    "SELECT table_id, ordinal, source_name, row_count, column_count " +
    "FROM pige_dataset_tables WHERE table_id = ?"
  ).get(request.table.id);
  const table = expectArrayRow(tableRaw, 5);
  if (
    table[0] !== request.table.id ||
    expectSafeCount(table[1]) < 0 ||
    table[2] !== request.table.name ||
    expectSafeCount(table[3]) !== request.table.rowCount ||
    expectSafeCount(table[4]) !== request.table.columnCount
  ) {
    fail("dataset.query.payload_binding_invalid", "The selected Dataset table does not match its active schema.");
  }

  const columnRows = database.prepare(
    "SELECT column_id, ordinal, name, projected_type FROM pige_dataset_columns " +
    "WHERE table_id = ? ORDER BY ordinal ASC, column_id COLLATE BINARY ASC"
  ).all(request.table.id);
  if (columnRows.length !== request.table.columnCount) {
    fail("dataset.query.payload_binding_invalid", "Managed Dataset columns do not match the active schema.");
  }
  const expectedColumns = new Map(request.columns.map((column) => [column.id, column]));
  const seenOrdinals = new Set<number>();
  for (const raw of columnRows) {
    const values = expectArrayRow(raw, 4);
    const columnId = expectString(values[0]);
    const ordinal = expectSafeCount(values[1]);
    const name = expectString(values[2]);
    const projectedType = expectString(values[3]);
    if (seenOrdinals.has(ordinal)) {
      fail("dataset.query.payload_invalid", "Managed Dataset column ordinals are not unique.");
    }
    seenOrdinals.add(ordinal);
    const expected = expectedColumns.get(columnId);
    if (expected && (
      expected.ordinal !== ordinal ||
      expected.name !== name ||
      expected.logicalType !== projectedTypeToLogicalType(projectedType)
    )) {
      fail("dataset.query.payload_binding_invalid", "A selected Dataset column changed from the active schema.");
    }
  }
  if ([...expectedColumns.keys()].some((columnId) =>
    !columnRows.some((raw) => expectArrayRow(raw, 4)[0] === columnId)
  )) {
    fail("dataset.query.payload_binding_invalid", "A selected Dataset column is missing from the managed payload.");
  }
}

function createProjectionRow(
  scanned: ScannedRow,
  request: DatasetQueryWorkerRequest,
  columnsById: ReadonlyMap<string, DatasetQueryWorkerRequest["columns"][number]>
): SortableRow {
  const selected = request.plan.selectColumnIds.map((columnId) => requireCell(scanned, columnId));
  const sortValues = new Map<string, QueryCell>();
  for (const order of request.plan.orderBy) {
    if (!order.by.startsWith("aggregate_")) sortValues.set(order.by, requireCell(scanned, order.by));
  }
  return {
    row: {
      rowId: scanned.rowId,
      ordinal: scanned.ordinal,
      sourceRow: scanned.sourceRow,
      values: selected.map((cell) => cell.value),
      states: selected.map((cell) => cell.state)
    },
    sortValues,
    tieKey: `${String(scanned.ordinal).padStart(16, "0")}:${scanned.rowId}`
  };
}

function updateGroup(
  groups: Map<string, GroupAccumulator>,
  scanned: ScannedRow,
  request: DatasetQueryWorkerRequest,
  columnsById: ReadonlyMap<string, DatasetQueryWorkerRequest["columns"][number]>
): void {
  const groupCells = request.plan.groupByColumnIds.map((columnId) => requireCell(scanned, columnId));
  const key = JSON.stringify(groupCells.map((cell) => [cell.state, cell.logicalType, cell.value]));
  let group = groups.get(key);
  if (!group) {
    if (groups.size >= request.limits.maxGroups) {
      limitFail("groups", "The Dataset query exceeds the bounded group-count limit.");
    }
    group = {
      key,
      groupCells,
      aggregates: request.plan.aggregates.map((aggregate) =>
        createAggregateAccumulator(aggregate, columnsById)
      )
    };
    groups.set(key, group);
  }
  for (const [index, aggregate] of request.plan.aggregates.entries()) {
    const accumulator = group.aggregates[index];
    if (!accumulator) fail("dataset.query.plan_invalid", "The Dataset aggregate binding is incomplete.");
    updateAggregateAccumulator(
      accumulator,
      aggregate.columnId ? requireCell(scanned, aggregate.columnId) : undefined
    );
  }
}

function finalizeGroups(
  groups: ReadonlyMap<string, GroupAccumulator>,
  request: DatasetQueryWorkerRequest,
  columnsById: ReadonlyMap<string, DatasetQueryWorkerRequest["columns"][number]>
): readonly DatasetQueryCoreRow[] {
  const sourceGroups = request.plan.groupByColumnIds.length === 0 && groups.size === 0
    ? [createEmptyAggregateGroup(request, columnsById)]
    : [...groups.values()];
  const rows = sourceGroups.map((group): SortableRow => {
    const aggregateCells = group.aggregates.map((accumulator, index) =>
      finalizeAggregateAccumulator(
        accumulator,
        request.plan.aggregates[index],
        columnsById
      )
    );
    const cells = [...group.groupCells, ...aggregateCells];
    const sortValues = new Map<string, QueryCell>();
    request.plan.groupByColumnIds.forEach((columnId, index) => {
      const cell = group.groupCells[index];
      if (cell) sortValues.set(columnId, cell);
    });
    request.plan.aggregates.forEach((aggregate, index) => {
      const cell = aggregateCells[index];
      if (cell) sortValues.set(aggregate.ref, cell);
    });
    return {
      row: {
        values: cells.map((cell) => cell.value),
        states: cells.map((cell) => cell.state)
      },
      sortValues,
      tieKey: group.key
    };
  });
  rows.sort((left, right) => compareSortableRows(left, right, request.plan.orderBy, columnsById));
  return rows.map(({ row }) => row);
}

function createEmptyAggregateGroup(
  request: DatasetQueryWorkerRequest,
  columnsById: ReadonlyMap<string, DatasetQueryWorkerRequest["columns"][number]>
): GroupAccumulator {
  return {
    key: "[]",
    groupCells: [],
    aggregates: request.plan.aggregates.map((aggregate) => createAggregateAccumulator(aggregate, columnsById))
  };
}

function createAggregateAccumulator(
  aggregate: DatasetQueryInternalAggregate,
  columnsById: ReadonlyMap<string, DatasetQueryWorkerRequest["columns"][number]>
): AggregateAccumulator {
  if (aggregate.op === "count") return { op: "count", count: 0 };
  const column = aggregate.columnId ? columnsById.get(aggregate.columnId) : undefined;
  if (!column) fail("dataset.query.plan_invalid", "The Dataset aggregate references an unavailable column.");
  if (aggregate.op === "sum" || aggregate.op === "avg") {
    return { op: aggregate.op, sum: 0, count: 0, integerInput: column.logicalType === "integer" };
  }
  return { op: aggregate.op };
}

function updateAggregateAccumulator(accumulator: AggregateAccumulator, cell: QueryCell | undefined): void {
  if (accumulator.op === "count") {
    if (!cell || (cell.state !== "missing" && cell.state !== "null")) accumulator.count += 1;
    return;
  }
  if (accumulator.op === "sum" || accumulator.op === "avg") {
    if (!cell || cell.state !== "value") return;
    const numeric = numericCellValue(cell);
    const next = accumulator.sum + numeric;
    if (!Number.isFinite(next) || (accumulator.integerInput && !Number.isSafeInteger(next))) {
      fail("dataset.query.numeric_out_of_range", "A numeric Dataset aggregate exceeds the exact local range.");
    }
    accumulator.sum = next;
    accumulator.count += 1;
    return;
  }
  if (!cell || (cell.state !== "value" && !(cell.state === "empty" && cell.logicalType === "string"))) return;
  if (!isExtremaAccumulator(accumulator)) {
    fail("dataset.query.plan_invalid", "The Dataset aggregate accumulator is invalid.");
  }
  if (!accumulator.value) {
    accumulator.value = cell;
    return;
  }
  const comparison = compareQueryCells(cell, accumulator.value);
  if ((accumulator.op === "min" && comparison < 0) || (accumulator.op === "max" && comparison > 0)) {
    accumulator.value = cell;
  }
}

function finalizeAggregateAccumulator(
  accumulator: AggregateAccumulator,
  aggregate: DatasetQueryInternalAggregate | undefined,
  columnsById: ReadonlyMap<string, DatasetQueryWorkerRequest["columns"][number]>
): QueryCell {
  if (!aggregate) fail("dataset.query.plan_invalid", "The Dataset aggregate result is incomplete.");
  if (accumulator.op === "count") {
    return { state: "value", logicalType: "integer", value: accumulator.count };
  }
  if (accumulator.op === "sum" || accumulator.op === "avg") {
    return accumulator.count === 0
      ? { state: "null", logicalType: "number", value: null }
      : {
          state: "value",
          logicalType: "number",
          value: accumulator.op === "avg" ? accumulator.sum / accumulator.count : accumulator.sum
        };
  }
  const logicalType = aggregate.columnId
    ? columnsById.get(aggregate.columnId)?.logicalType
    : undefined;
  if (!logicalType) fail("dataset.query.plan_invalid", "The Dataset aggregate type is unavailable.");
  if (!isExtremaAccumulator(accumulator)) {
    fail("dataset.query.plan_invalid", "The Dataset aggregate accumulator is invalid.");
  }
  return accumulator.value ?? { state: "null", logicalType, value: null };
}

function isExtremaAccumulator(
  accumulator: AggregateAccumulator
): accumulator is Extract<AggregateAccumulator, { readonly op: "min" | "max" }> {
  return accumulator.op === "min" || accumulator.op === "max";
}

function createResultColumns(
  request: DatasetQueryWorkerRequest,
  columnsById: ReadonlyMap<string, DatasetQueryWorkerRequest["columns"][number]>
): readonly DatasetQueryCoreColumn[] {
  const groupOrProjection = request.plan.selectColumnIds.map((columnId) => {
    const column = columnsById.get(columnId);
    if (!column) fail("dataset.query.plan_invalid", "The projected Dataset column is unavailable.");
    return {
      key: columnId,
      label: column.name,
      logicalType: column.logicalType,
      sourceColumnId: columnId
    } satisfies DatasetQueryCoreColumn;
  });
  const aggregates = request.plan.aggregates.map((aggregate) => {
    const source = aggregate.columnId ? columnsById.get(aggregate.columnId) : undefined;
    const label = truncateText(`${aggregate.op}(${source?.name ?? "*"})`, 512);
    return {
      key: aggregate.ref,
      label,
      logicalType: aggregate.op === "count"
        ? "integer" as const
        : aggregate.op === "sum" || aggregate.op === "avg"
          ? "number" as const
          : source?.logicalType ?? "unknown",
      ...(source ? { sourceColumnId: source.id } : {}),
      aggregate: aggregate.op
    } satisfies DatasetQueryCoreColumn;
  });
  return [...groupOrProjection, ...aggregates];
}

function matchesFilter(row: ScannedRow, filter: DatasetQueryInternalFilter): boolean {
  const cell = requireCell(row, filter.columnId);
  switch (filter.op) {
    case "is_missing": return cell.state === "missing";
    case "is_empty": return cell.state === "empty";
    case "is_null": return cell.state === "null";
    case "is_not_null": return cell.state !== "missing" && cell.state !== "null";
    case "contains":
      return typeof cell.value === "string" && typeof filter.value === "string" && cell.value.includes(filter.value);
    case "starts_with":
      return typeof cell.value === "string" && typeof filter.value === "string" && cell.value.startsWith(filter.value);
    default:
      if (cell.state === "missing" || cell.state === "null" || filter.value === undefined) return false;
      const comparison = compareCellToFilterValue(cell, filter.value);
      if (filter.op === "eq") return comparison === 0;
      if (filter.op === "ne") return comparison !== 0;
      if (filter.op === "lt") return comparison < 0;
      if (filter.op === "lte") return comparison <= 0;
      if (filter.op === "gt") return comparison > 0;
      return comparison >= 0;
  }
}

function compareCellToFilterValue(cell: QueryCell, value: string | number | boolean): number {
  if (cell.logicalType === "integer") {
    if (typeof cell.value !== "string" || typeof value !== "number" || !Number.isSafeInteger(value)) {
      fail("dataset.query.plan_invalid", "An integer Dataset filter has an incompatible value.");
    }
    return compareBigInts(BigInt(cell.value), BigInt(value));
  }
  if (cell.logicalType === "number") {
    if (typeof cell.value !== "number" || typeof value !== "number") {
      fail("dataset.query.plan_invalid", "A numeric Dataset filter has an incompatible value.");
    }
    return comparePrimitive(cell.value, value);
  }
  if (cell.logicalType === "boolean") {
    if (typeof cell.value !== "boolean" || typeof value !== "boolean") {
      fail("dataset.query.plan_invalid", "A boolean Dataset filter has an incompatible value.");
    }
    return comparePrimitive(cell.value ? 1 : 0, value ? 1 : 0);
  }
  if (typeof cell.value !== "string" || typeof value !== "string") {
    fail("dataset.query.plan_invalid", "A textual Dataset filter has an incompatible value.");
  }
  return comparePrimitive(cell.value, value);
}

function compareSortableRows(
  left: SortableRow,
  right: SortableRow,
  orderBy: readonly DatasetQueryInternalOrder[],
  columnsById: ReadonlyMap<string, DatasetQueryWorkerRequest["columns"][number]>
): number {
  for (const order of orderBy) {
    const leftValue = left.sortValues.get(order.by);
    const rightValue = right.sortValues.get(order.by);
    if (!leftValue || !rightValue) fail("dataset.query.plan_invalid", "Dataset ordering has no bounded output value.");
    const compared = compareQueryCells(leftValue, rightValue);
    if (compared !== 0) return order.direction === "asc" ? compared : -compared;
  }
  return comparePrimitive(left.tieKey, right.tieKey);
}

function compareQueryCells(left: QueryCell, right: QueryCell): number {
  const stateOrder: Record<DatasetQueryCellState, number> = { missing: 0, null: 1, empty: 2, value: 3 };
  const stateComparison = stateOrder[left.state] - stateOrder[right.state];
  if (stateComparison !== 0) return stateComparison;
  if (left.value === null || right.value === null) return 0;
  if (left.logicalType === "integer" && right.logicalType === "integer") {
    if (typeof left.value !== "string" || typeof right.value !== "string") {
      fail("dataset.query.payload_invalid", "A managed Dataset integer has an invalid projection.");
    }
    return compareBigInts(BigInt(left.value), BigInt(right.value));
  }
  if (typeof left.value === "number" && typeof right.value === "number") {
    return comparePrimitive(left.value, right.value);
  }
  if (typeof left.value === "boolean" && typeof right.value === "boolean") {
    return comparePrimitive(left.value ? 1 : 0, right.value ? 1 : 0);
  }
  return comparePrimitive(String(left.value), String(right.value));
}

function parseQueryCell(
  state: DatasetQueryCellState,
  projectionKind: string,
  projectionJson: unknown,
  logicalType: DatasetLogicalType,
  limits: DatasetQueryLimits
): QueryCell {
  if (state === "missing") {
    if (projectionKind !== "unknown" || projectionJson !== null) invalidProjection();
    return { state, logicalType, value: null };
  }
  if (state === "null") {
    if (projectionKind !== "null" || projectionJson !== null) invalidProjection();
    return { state, logicalType, value: null };
  }
  if (typeof projectionJson !== "string" || byteLength(projectionJson) > limits.maxCellBytes * 2) {
    limitFail("cell_bytes", "A Dataset cell exceeds the bounded query cell limit.");
  }
  let projection: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(projectionJson);
    if (!isPlainRecord(parsed)) invalidProjection();
    projection = parsed;
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    invalidProjection();
  }
  if (projection.kind !== projectionKind) invalidProjection();
  if (state === "empty") {
    if (projectionKind !== "text" || projection.value !== "") invalidProjection();
    return { state, logicalType, value: "" };
  }
  let value: DatasetQueryScalar;
  switch (logicalType) {
    case "string":
      if (projectionKind !== "text" || typeof projection.value !== "string") invalidProjection();
      value = projection.value;
      break;
    case "integer":
      if (projectionKind !== "integer" || typeof projection.value !== "string" || !/^-?(?:0|[1-9][0-9]*)$/u.test(projection.value)) {
        invalidProjection();
      }
      value = projection.value;
      break;
    case "number":
      if (projectionKind !== "real" || typeof projection.value !== "number" || !Number.isFinite(projection.value)) {
        invalidProjection();
      }
      value = projection.value;
      break;
    case "boolean":
      if (projectionKind !== "boolean" || typeof projection.value !== "boolean") invalidProjection();
      value = projection.value;
      break;
    case "date":
      if (!(["date", "xlsx_date_serial"].includes(projectionKind)) || typeof projection.value !== "string") {
        invalidProjection();
      }
      value = projection.value;
      break;
    case "datetime":
      if (projectionKind !== "datetime" || typeof projection.value !== "string") invalidProjection();
      value = projection.value;
      break;
    case "binary":
      if (
        projectionKind !== "blob" ||
        projection.encoding !== "base64" ||
        typeof projection.value !== "string" ||
        !Number.isSafeInteger(projection.byteLength) ||
        Number(projection.byteLength) < 0
      ) invalidProjection();
      value = projection.value;
      break;
    case "unknown":
      invalidProjection();
  }
  if (typeof value === "string" && (byteLength(value) > limits.maxCellBytes || Array.from(value).length > 4_096)) {
    limitFail("cell_bytes", "A Dataset cell exceeds the bounded query cell limit.");
  }
  if (state === "value" && value === "" && logicalType === "string") {
    fail("dataset.query.payload_invalid", "A managed Dataset empty value has an invalid lexical state.");
  }
  return { state, logicalType, value };
}

function validateWorkerRequest(request: DatasetQueryWorkerRequest): void {
  if (
    request.schemaVersion !== DATASET_QUERY_PROTOCOL_VERSION ||
    typeof request.requestId !== "string" ||
    request.requestId.length < 1 ||
    !path.isAbsolute(request.payloadPath) ||
    !/^dataset_\d{8}_[a-z0-9]{12,}$/u.test(request.binding.datasetId) ||
    !/^dataset_rev_\d{8}_[a-z0-9]{12,}$/u.test(request.binding.revisionId) ||
    !isSha256(request.binding.schemaChecksum) ||
    !isSha256(request.binding.payloadChecksum) ||
    !/^table_[a-z0-9]{12,}$/u.test(request.table.id) ||
    byteLength(request.table.name) > 2_048 ||
    !isSafeCount(request.table.rowCount) ||
    !isSafeCount(request.table.columnCount)
  ) {
    fail("dataset.query.worker_protocol", "The Dataset query worker received an invalid private request.");
  }
  validateLimits(request.limits);
  if (
    request.columns.length === 0 ||
    request.columns.length > request.limits.maxReferencedColumns ||
    new Set(request.columns.map((column) => column.id)).size !== request.columns.length ||
    new Set(request.columns.map((column) => column.ordinal)).size !== request.columns.length ||
    request.columns.some((column) =>
      !/^column_[a-z0-9]{12,}$/u.test(column.id) ||
      !column.name ||
      byteLength(column.name) > 2_048 ||
      !isSafeCount(column.ordinal) ||
      !isLogicalType(column.logicalType)
    )
  ) {
    fail("dataset.query.worker_protocol", "The Dataset query worker column binding is invalid.");
  }
  const available = new Set(request.columns.map((column) => column.id));
  const aggregateRefs = new Set(request.plan.aggregates.map((aggregate) => aggregate.ref));
  if (
    request.plan.selectColumnIds.length > request.limits.maxSelectedColumns ||
    request.plan.filters.length > request.limits.maxFilters ||
    request.plan.groupByColumnIds.length > request.limits.maxGroupByColumns ||
    request.plan.aggregates.length > request.limits.maxAggregates ||
    request.plan.orderBy.length > request.limits.maxOrderBy ||
    !Number.isSafeInteger(request.plan.limit) ||
    request.plan.limit < 1 ||
    request.plan.limit > request.limits.maxResultRows ||
    [...request.plan.selectColumnIds, ...request.plan.groupByColumnIds].some((id) => !available.has(id)) ||
    request.plan.filters.some((filter) => !available.has(filter.columnId)) ||
    request.plan.aggregates.some((aggregate) =>
      !/^aggregate_[1-9][0-9]*$/u.test(aggregate.ref) ||
      (aggregate.columnId !== undefined && !available.has(aggregate.columnId))
    ) ||
    request.plan.orderBy.some((order) => !available.has(order.by) && !aggregateRefs.has(order.by))
  ) {
    fail("dataset.query.plan_invalid", "The Dataset query plan exceeds its fixed typed contract.");
  }
}

function validateLimits(limits: DatasetQueryLimits): void {
  for (const key of Object.keys(DATASET_QUERY_DEFAULT_LIMITS) as (keyof DatasetQueryLimits)[]) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value <= 0 || value > DATASET_QUERY_DEFAULT_LIMITS[key]) {
      fail("dataset.query.worker_protocol", "Dataset query worker limits cannot exceed the service policy.");
    }
  }
}

function collectUsedColumnIds(
  request: DatasetQueryWorkerRequest,
  columnsById: ReadonlyMap<string, DatasetQueryWorkerRequest["columns"][number]>
): readonly string[] {
  const ids = new Set<string>();
  for (const id of request.plan.selectColumnIds) ids.add(id);
  for (const filter of request.plan.filters) ids.add(filter.columnId);
  for (const id of request.plan.groupByColumnIds) ids.add(id);
  for (const aggregate of request.plan.aggregates) if (aggregate.columnId) ids.add(aggregate.columnId);
  for (const order of request.plan.orderBy) if (!order.by.startsWith("aggregate_")) ids.add(order.by);
  if (ids.size === 0) {
    const anchor = request.columns[0];
    if (!anchor) fail("dataset.query.plan_invalid", "The Dataset query has no evidence column anchor.");
    ids.add(anchor.id);
  }
  return [...ids].sort((left, right) => {
    const leftOrdinal = columnsById.get(left)?.ordinal ?? Number.MAX_SAFE_INTEGER;
    const rightOrdinal = columnsById.get(right)?.ordinal ?? Number.MAX_SAFE_INTEGER;
    return leftOrdinal - rightOrdinal || comparePrimitive(left, right);
  });
}

function authorizeFixedDatasetRead(
  actionCode: number,
  arg1: string | null,
  arg2: string | null,
  dbName: string | null,
  triggerOrView: string | null
): number {
  if (actionCode === sqliteConstants.SQLITE_SELECT) return sqliteConstants.SQLITE_OK;
  if (actionCode !== sqliteConstants.SQLITE_READ || dbName !== "main" || triggerOrView !== null || !arg1 || !arg2) {
    return sqliteConstants.SQLITE_DENY;
  }
  return READABLE_COLUMNS.get(arg1)?.has(arg2) === true
    ? sqliteConstants.SQLITE_OK
    : sqliteConstants.SQLITE_DENY;
}

function assertPayloadFile(filePath: string, limits: DatasetQueryLimits): fs.Stats {
  try {
    const stat = fs.lstatSync(filePath);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.size <= 0 ||
      stat.size > limits.maxPayloadBytes ||
      fs.existsSync(`${filePath}-journal`) ||
      fs.existsSync(`${filePath}-wal`) ||
      fs.existsSync(`${filePath}-shm`)
    ) {
      fail("dataset.query.payload_unsafe", "The managed Dataset query snapshot is not a safe regular file.");
    }
    return stat;
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    fail("dataset.query.payload_unavailable", "The managed Dataset query snapshot is unavailable.");
  }
}

function checksumFile(filePath: string): string {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1 * 1_024 * 1_024);
  try {
    let position = 0;
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return `sha256:${hash.digest("hex")}`;
}

function sameFileRevision(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function projectedTypeToLogicalType(value: string): DatasetLogicalType {
  if (value === "text") return "string";
  if (value === "integer") return "integer";
  if (value === "real") return "number";
  if (value === "boolean") return "boolean";
  if (value === "date" || value === "xlsx_date_serial") return "date";
  if (value === "datetime") return "datetime";
  if (value === "blob") return "binary";
  if (value === "unknown" || value === "null") return "unknown";
  fail("dataset.query.payload_invalid", "A managed Dataset column has an unsupported projected type.");
}

function numericCellValue(cell: QueryCell): number {
  if (cell.logicalType === "number" && typeof cell.value === "number") return cell.value;
  if (cell.logicalType === "integer" && typeof cell.value === "string") {
    const value = Number(cell.value);
    if (Number.isSafeInteger(value)) return value;
  }
  fail("dataset.query.numeric_out_of_range", "A numeric Dataset value exceeds the exact aggregate range.");
}

function requireCell(row: ScannedRow, columnId: string): QueryCell {
  const cell = row.cells.get(columnId);
  if (!cell) fail("dataset.query.payload_invalid", "A managed Dataset row is missing a selected cell.");
  return cell;
}

function insertBounded<T>(items: T[], value: T, compare: (left: T, right: T) => number, limit: number): void {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const item = items[middle];
    if (item !== undefined && compare(item, value) <= 0) low = middle + 1;
    else high = middle;
  }
  items.splice(low, 0, value);
  if (items.length > limit) items.pop();
}

function expectArrayRow(value: unknown, length: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length !== length) {
    fail("dataset.query.payload_invalid", "The managed Dataset payload returned an invalid fixed row shape.");
  }
  return value;
}

function expectString(value: unknown): string {
  if (typeof value !== "string" || byteLength(value) > 8 * 1_024 * 1_024) {
    fail("dataset.query.payload_invalid", "The managed Dataset payload returned invalid text metadata.");
  }
  return value;
}

function expectSafeCount(value: unknown): number {
  const number = typeof value === "bigint" ? Number(value) : value;
  if (!isSafeCount(number)) {
    fail("dataset.query.payload_invalid", "The managed Dataset payload returned an invalid bounded count.");
  }
  return number;
}

function expectCellState(value: unknown): DatasetQueryCellState {
  if (value !== "missing" && value !== "empty" && value !== "null" && value !== "value") {
    fail("dataset.query.payload_invalid", "The managed Dataset payload returned an invalid lexical state.");
  }
  return value;
}

function invalidProjection(): never {
  fail("dataset.query.payload_invalid", "A managed Dataset cell has an invalid typed projection.");
}

function normalizeSql(value: string): string {
  return value.trim().replace(/;\s*$/u, "").replace(/\s+/gu, " ");
}

function compareBigInts(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparePrimitive(left: number | string, right: number | string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function truncateText(value: string, maximumCharacters: number): string {
  return Array.from(value).slice(0, maximumCharacters).join("");
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function isSafeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isLogicalType(value: unknown): value is DatasetLogicalType {
  return value === "string" || value === "integer" || value === "number" || value === "boolean" ||
    value === "date" || value === "datetime" || value === "binary" || value === "unknown";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function limitFail(kind: string, message: string): never {
  fail(`dataset.query.limit.${kind}`, message);
}

function fail(code: string, message: string): never {
  throw new PigeDomainError(code, message);
}
