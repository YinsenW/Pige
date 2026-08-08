import { Buffer } from "node:buffer";
import type { DatabaseSync } from "node:sqlite";
import { PigeDomainError } from "@pige/domain";
import type { DatasetLogicalType } from "@pige/schemas";
import {
  createDatasetQueryPlanHash,
  createDatasetQueryResultHash,
  type DatasetQueryCellState,
  type DatasetQueryCoreColumn,
  type DatasetQueryCoreRow,
  type DatasetQueryCoreResult,
  type DatasetQueryInternalAggregate,
  type DatasetQueryInternalColumn,
  type DatasetQueryInternalFilter,
  type DatasetQueryLimits,
  type DatasetQueryScalar,
  type DatasetQueryWorkerRequest
} from "./dataset-query-types";

interface QueryCell {
  readonly state: DatasetQueryCellState;
  readonly logicalType: DatasetLogicalType;
  readonly value: DatasetQueryScalar;
}

interface JoinedRow {
  readonly rowId: string;
  readonly ordinal: number;
  readonly sourceRow: number;
  readonly cells: ReadonlyMap<string, QueryCell>;
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

interface AggregateRow {
  readonly row: DatasetQueryCoreRow;
  readonly sortValues: ReadonlyMap<string, QueryCell>;
  readonly tieKey: string;
}

/** Executes up to four bounded inner joins by Pige-owned single-row relations. */
export function executeDatasetRelationQuery(
  database: DatabaseSync,
  request: DatasetQueryWorkerRequest
): DatasetQueryCoreResult {
  const joins = request.joins;
  if (!joins || joins.length < 1 || joins.length > request.limits.maxRelationHops) {
    limit("relation_hops");
  }
  validateTargetBindings(database, request);
  const columnsById = new Map(request.columns.map((column) => [column.id, column]));
  const usedColumnIds = collectUsedColumnIds(request);
  const sourceColumns = request.columns.filter((column) =>
    column.tableId === request.table.id && usedColumnIds.includes(column.id)
  );
  const targetColumns = joins.map(({ targetTable }) => request.columns.filter((column) =>
    column.tableId === targetTable.id && usedColumnIds.includes(column.id)
  ));
  const totalRows = request.table.rowCount + joins.reduce((sum, { targetTable }) => sum + targetTable.rowCount, 0);
  const predictedCells = request.table.rowCount * (sourceColumns.length + 1) + joins.reduce(
    (sum, { targetTable }, index) => sum + targetTable.rowCount *
      ((targetColumns[index]?.length ?? 0) + (index < joins.length - 1 ? 1 : 0)),
    0
  );
  if (totalRows > request.limits.maxScanRows) limit("scan_rows");
  if (!Number.isSafeInteger(predictedCells) || predictedCells > request.limits.maxScanCells) limit("scan_cells");

  const targetsByHop = joins.map(({ targetTable }, index) => new Map(
    readTableRows(database, targetTable.id, targetTable.rowCount, targetColumns[index] ?? [], request.limits)
      .map((target) => [target.rowId, target])
  ));
  const sources = readTableRows(database, request.table.id, request.table.rowCount, sourceColumns, request.limits);
  const relationRowsByHop = joins.map((join, index) => readRelationTargets(
    database,
    index === 0 ? request.table.id : joins[index - 1]!.targetTable.id,
    index === 0 ? request.table.rowCount : joins[index - 1]!.targetTable.rowCount,
    join.relationColumnId,
    request.limits
  ));
  const joined: JoinedRow[] = [];
  for (const source of sources) {
    let current = source;
    const cells = new Map(source.cells);
    let complete = true;
    for (const [index, relationRows] of relationRowsByHop.entries()) {
      const targetRowId = relationRows.get(current.rowId);
      if (targetRowId === undefined || targetRowId === null) { complete = false; break; }
      const target = targetsByHop[index]!.get(targetRowId);
      if (!target) fail("dataset.query.payload_invalid", "A Dataset relation points outside its bound target table.");
      for (const [columnId, cell] of target.cells) cells.set(columnId, cell);
      current = target;
    }
    if (!complete) continue;
    const row: JoinedRow = {
      rowId: source.rowId,
      ordinal: source.ordinal,
      sourceRow: source.sourceRow,
      cells
    };
    if (request.plan.filters.every((filter) => matchesFilter(row, filter))) joined.push(row);
  }
  const aggregateRows = request.plan.aggregates.length > 0
    ? finalizeGroups(buildGroups(joined, request, columnsById), request, columnsById)
    : undefined;
  if (aggregateRows) aggregateRows.sort((left, right) => compareAggregateRows(left, right, request));
  else joined.sort((left, right) => compareRows(left, right, request));
  const matchedRowCount = aggregateRows?.length ?? joined.length;
  const returnedRows = aggregateRows?.slice(0, request.plan.limit);
  const returned = aggregateRows ? [] : joined.slice(0, request.plan.limit);
  const planHash = createDatasetQueryPlanHash(request);
  const withoutHash: Omit<DatasetQueryCoreResult, "resultHash"> = {
    planHash,
    columns: createResultColumns(request, columnsById),
    rows: returnedRows?.map(({ row }) => row) ?? returned.map((row) => ({
      rowId: row.rowId, ordinal: row.ordinal, sourceRow: row.sourceRow,
      values: request.plan.selectColumnIds.map((columnId) => requireCell(row, columnId).value),
      states: request.plan.selectColumnIds.map((columnId) => requireCell(row, columnId).state)
    })),
    sourceMatchedRowCount: joined.length,
    matchedRowCount,
    returnedRowCount: returnedRows?.length ?? returned.length,
    truncated: matchedRowCount > (returnedRows?.length ?? returned.length),
    usedColumnIds,
    returnedRowIds: aggregateRows ? [] : returned.map(({ rowId }) => rowId),
    ...(joined.length > 0 ? {
      range: {
        startRow: Math.min(...joined.map(({ sourceRow }) => sourceRow)),
        endRow: Math.max(...joined.map(({ sourceRow }) => sourceRow))
      }
    } : {})
  };
  if (byteLength(JSON.stringify(withoutHash)) > request.limits.maxResultBytes) limit("result_bytes");
  return { ...withoutHash, resultHash: createDatasetQueryResultHash(withoutHash) };
}

function validateTargetBindings(database: DatabaseSync, request: DatasetQueryWorkerRequest): void {
  let sourceTableId = request.table.id;
  for (const join of request.joins!) {
    validateTargetBinding(database, request, join, sourceTableId);
    sourceTableId = join.targetTable.id;
  }
}

function validateTargetBinding(
  database: DatabaseSync,
  request: DatasetQueryWorkerRequest,
  join: NonNullable<DatasetQueryWorkerRequest["joins"]>[number],
  sourceTableId: string
): void {
  const target = join.targetTable;
  const table = database.prepare(
    "SELECT table_id, source_name, row_count, column_count FROM pige_dataset_tables WHERE table_id = ?"
  ).get(target.id) as unknown as readonly unknown[] | undefined;
  if (!table || table[0] !== target.id || table[1] !== target.name ||
      Number(table[2]) !== target.rowCount || Number(table[3]) !== target.columnCount) {
    fail("dataset.query.payload_binding_invalid", "The joined Dataset table does not match its active schema.");
  }
  const columns = database.prepare(
    "SELECT column_id, name, projected_type FROM pige_dataset_columns WHERE table_id = ? ORDER BY ordinal ASC"
  ).all(target.id) as unknown as readonly (readonly unknown[])[];
  if (columns.length !== target.columnCount) fail("dataset.query.payload_binding_invalid", "The joined Dataset columns are incomplete.");
  const expected = new Map(request.columns.filter(({ tableId }) => tableId === target.id).map((column) => [column.id, column]));
  for (const row of columns) {
    const column = expected.get(String(row[0]));
    if (column && (row[1] !== column.name || row[2] !== projectedType(column.logicalType))) {
      fail("dataset.query.payload_binding_invalid", "A joined Dataset column changed after catalog binding.");
    }
  }
  const relation = database.prepare(
    "SELECT table_id FROM pige_dataset_columns WHERE column_id = ?"
  ).get(join.relationColumnId) as unknown as readonly unknown[] | undefined;
  if (!relation || relation[0] !== sourceTableId) {
    fail("dataset.query.payload_binding_invalid", "The Dataset relation column is not owned by the selected table.");
  }
}

function readTableRows(
  database: DatabaseSync,
  tableId: string,
  expectedRows: number,
  columns: readonly DatasetQueryInternalColumn[],
  limits: DatasetQueryLimits
): JoinedRow[] {
  const rows = database.prepare(
    "SELECT row_id, ordinal, source_row FROM pige_dataset_rows WHERE table_id = ? ORDER BY ordinal ASC"
  ).all(tableId) as unknown as readonly (readonly unknown[])[];
  if (rows.length !== expectedRows) fail("dataset.query.payload_invalid", "Dataset row counts changed after catalog binding.");
  const result = rows.map((row) => ({
    rowId: expectRowId(row[0]), ordinal: expectCount(row[1]), sourceRow: expectCount(row[2]),
    cells: new Map<string, QueryCell>()
  }));
  const byId = new Map(result.map((row) => [row.rowId, row]));
  if (columns.length === 0) return result;
  const cells = database.prepare([
    "SELECT c.row_id, c.column_id, c.state, c.projection_kind, c.projection_json",
    "FROM pige_dataset_cells AS c JOIN pige_dataset_rows AS r ON r.row_id = c.row_id",
    `WHERE r.table_id = ? AND c.column_id IN (${columns.map(() => "?").join(", ")})`,
    "ORDER BY r.ordinal ASC, c.column_id COLLATE BINARY ASC"
  ].join(" ")).all(tableId, ...columns.map(({ id }) => id)) as unknown as readonly (readonly unknown[])[];
  if (cells.length !== expectedRows * columns.length) fail("dataset.query.payload_invalid", "A joined Dataset row is missing a normalized cell.");
  let scannedBytes = 0;
  const columnMap = new Map(columns.map((column) => [column.id, column]));
  for (const raw of cells) {
    const row = byId.get(expectRowId(raw[0]));
    const columnId = String(raw[1]);
    const column = columnMap.get(columnId);
    if (!row || !column || row.cells.has(columnId)) fail("dataset.query.payload_invalid", "A joined Dataset cell has an invalid binding.");
    scannedBytes += byteLength(String(raw[0])) + byteLength(columnId) + byteLength(String(raw[3])) +
      (typeof raw[4] === "string" ? byteLength(raw[4]) : 0);
    if (scannedBytes > limits.maxScanBytes) limit("scan_bytes");
    row.cells.set(columnId, parseCell(String(raw[2]), String(raw[3]), raw[4], column.logicalType, limits));
  }
  return result;
}

function readRelationTargets(
  database: DatabaseSync,
  tableId: string,
  expectedRows: number,
  relationColumnId: string,
  limits: DatasetQueryLimits
): Map<string, string | null> {
  const rows = database.prepare([
    "SELECT r.row_id, c.state, c.projection_kind, c.projection_json",
    "FROM pige_dataset_rows AS r JOIN pige_dataset_cells AS c ON c.row_id = r.row_id",
    "WHERE r.table_id = ? AND c.column_id = ? ORDER BY r.ordinal ASC"
  ].join(" ")).all(tableId, relationColumnId) as unknown as readonly (readonly unknown[])[];
  if (rows.length !== expectedRows) fail("dataset.query.payload_invalid", "The Dataset relation column is incomplete.");
  return new Map(rows.map((row) => {
    const rowId = expectRowId(row[0]);
    const state = String(row[1]);
    if (row[2] !== "pige_relation_target_v1") fail("dataset.query.payload_invalid", "The Dataset relation projection is invalid.");
    if (state === "null" && row[3] === "null") return [rowId, null] as const;
    if (state !== "value" || typeof row[3] !== "string" || byteLength(row[3]) > limits.maxCellBytes) {
      fail("dataset.query.payload_invalid", "The Dataset relation value is invalid.");
    }
    let parsed: unknown;
    try { parsed = JSON.parse(row[3]); } catch { fail("dataset.query.payload_invalid", "The Dataset relation JSON is invalid."); }
    if (!isRecord(parsed) || parsed.kind !== "pige_relation_target" || parsed.schemaVersion !== 1 ||
        typeof parsed.targetRowId !== "string" || !/^row_[a-z0-9]{12,}$/u.test(parsed.targetRowId)) {
      fail("dataset.query.payload_invalid", "The Dataset relation target is invalid.");
    }
    return [rowId, parsed.targetRowId] as const;
  }));
}

function collectUsedColumnIds(request: DatasetQueryWorkerRequest): string[] {
  return [...new Set([
    ...request.joins!.map(({ relationColumnId }) => relationColumnId),
    ...request.plan.selectColumnIds,
    ...request.plan.filters.map(({ columnId }) => columnId),
    ...request.plan.groupByColumnIds,
    ...request.plan.aggregates.flatMap(({ columnId }) => columnId ? [columnId] : []),
    ...request.plan.orderBy.flatMap(({ by }) => by.startsWith("aggregate_") ? [] : [by])
  ])].sort();
}

function buildGroups(
  rows: readonly JoinedRow[],
  request: DatasetQueryWorkerRequest,
  columnsById: ReadonlyMap<string, DatasetQueryWorkerRequest["columns"][number]>
): Map<string, GroupAccumulator> {
  const groups = new Map<string, GroupAccumulator>();
  for (const row of rows) {
    const groupCells = request.plan.groupByColumnIds.map((columnId) => requireCell(row, columnId));
    const key = JSON.stringify(groupCells.map((cell) => [cell.state, cell.logicalType, cell.value]));
    let group = groups.get(key);
    if (!group) {
      if (groups.size >= request.limits.maxGroups) limit("groups");
      group = {
        key,
        groupCells,
        aggregates: request.plan.aggregates.map((aggregate) => createAccumulator(aggregate, columnsById))
      };
      groups.set(key, group);
    }
    request.plan.aggregates.forEach((aggregate, index) => {
      const accumulator = group!.aggregates[index];
      if (!accumulator) fail("dataset.query.plan_invalid", "The joined Dataset aggregate is incomplete.");
      updateAccumulator(accumulator, aggregate.columnId ? requireCell(row, aggregate.columnId) : undefined);
    });
  }
  return groups;
}

function finalizeGroups(
  groups: ReadonlyMap<string, GroupAccumulator>,
  request: DatasetQueryWorkerRequest,
  columnsById: ReadonlyMap<string, DatasetQueryWorkerRequest["columns"][number]>
): AggregateRow[] {
  const source = request.plan.groupByColumnIds.length === 0 && groups.size === 0
    ? [{ key: "[]", groupCells: [], aggregates: request.plan.aggregates.map((aggregate) => createAccumulator(aggregate, columnsById)) }]
    : [...groups.values()];
  return source.map((group) => {
    const aggregateCells = group.aggregates.map((accumulator, index) =>
      finalizeAccumulator(accumulator, request.plan.aggregates[index], columnsById));
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
      row: { values: cells.map(({ value }) => value), states: cells.map(({ state }) => state) },
      sortValues,
      tieKey: group.key
    };
  });
}

function createAccumulator(
  aggregate: DatasetQueryInternalAggregate,
  columnsById: ReadonlyMap<string, DatasetQueryWorkerRequest["columns"][number]>
): AggregateAccumulator {
  if (aggregate.op === "count") return { op: "count", count: 0 };
  const column = aggregate.columnId ? columnsById.get(aggregate.columnId) : undefined;
  if (!column) fail("dataset.query.plan_invalid", "The joined Dataset aggregate column is unavailable.");
  return aggregate.op === "sum" || aggregate.op === "avg"
    ? { op: aggregate.op, sum: 0, count: 0, integerInput: column.logicalType === "integer" }
    : { op: aggregate.op };
}

function updateAccumulator(accumulator: AggregateAccumulator, cell: QueryCell | undefined): void {
  if (accumulator.op === "count") {
    if (!cell || (cell.state !== "missing" && cell.state !== "null")) accumulator.count += 1;
    return;
  }
  if (accumulator.op === "sum" || accumulator.op === "avg") {
    if (!cell || cell.state !== "value") return;
    const numeric = numericCellValue(cell);
    const next = accumulator.sum + numeric;
    if (!Number.isFinite(next) || (accumulator.integerInput && !Number.isSafeInteger(next))) {
      fail("dataset.query.numeric_out_of_range", "A joined Dataset aggregate exceeds the exact local range.");
    }
    accumulator.sum = next;
    accumulator.count += 1;
    return;
  }
  if (accumulator.op !== "min" && accumulator.op !== "max") {
    fail("dataset.query.plan_invalid", "The joined Dataset aggregate accumulator is invalid.");
  }
  if (!cell || (cell.state !== "value" && !(cell.state === "empty" && cell.logicalType === "string"))) return;
  if (!accumulator.value ||
      (accumulator.op === "min" && compareCells(cell, accumulator.value) < 0) ||
      (accumulator.op === "max" && compareCells(cell, accumulator.value) > 0)) accumulator.value = cell;
}

function finalizeAccumulator(
  accumulator: AggregateAccumulator,
  aggregate: DatasetQueryInternalAggregate | undefined,
  columnsById: ReadonlyMap<string, DatasetQueryWorkerRequest["columns"][number]>
): QueryCell {
  if (!aggregate) fail("dataset.query.plan_invalid", "The joined Dataset aggregate result is incomplete.");
  if (accumulator.op === "count") return { state: "value", logicalType: "integer", value: accumulator.count };
  if (accumulator.op === "sum" || accumulator.op === "avg") {
    return accumulator.count === 0
      ? { state: "null", logicalType: "number", value: null }
      : { state: "value", logicalType: "number",
          value: accumulator.op === "avg" ? accumulator.sum / accumulator.count : accumulator.sum };
  }
  if (accumulator.op !== "min" && accumulator.op !== "max") {
    fail("dataset.query.plan_invalid", "The joined Dataset aggregate accumulator is invalid.");
  }
  const logicalType = aggregate.columnId ? columnsById.get(aggregate.columnId)?.logicalType : undefined;
  if (!logicalType) fail("dataset.query.plan_invalid", "The joined Dataset aggregate type is unavailable.");
  return accumulator.value ?? { state: "null", logicalType, value: null };
}

function createResultColumns(
  request: DatasetQueryWorkerRequest,
  columnsById: ReadonlyMap<string, DatasetQueryWorkerRequest["columns"][number]>
): DatasetQueryCoreColumn[] {
  const projected = request.plan.selectColumnIds.map((columnId) => {
    const column = columnsById.get(columnId);
    if (!column) fail("dataset.query.plan_invalid", "A joined projection column is unavailable.");
    return { key: column.id, label: column.name, logicalType: column.logicalType, sourceColumnId: column.id };
  });
  return [...projected, ...request.plan.aggregates.map((aggregate) => {
    const source = aggregate.columnId ? columnsById.get(aggregate.columnId) : undefined;
    return {
      key: aggregate.ref,
      label: `${aggregate.op}(${source?.name ?? "*"})`.slice(0, 512),
      logicalType: aggregate.op === "count" ? "integer" as const
        : aggregate.op === "sum" || aggregate.op === "avg" ? "number" as const
          : source?.logicalType ?? "unknown",
      ...(source ? { sourceColumnId: source.id } : {}),
      aggregate: aggregate.op
    };
  })];
}

function compareAggregateRows(left: AggregateRow, right: AggregateRow, request: DatasetQueryWorkerRequest): number {
  for (const order of request.plan.orderBy) {
    const leftCell = left.sortValues.get(order.by), rightCell = right.sortValues.get(order.by);
    if (!leftCell || !rightCell) fail("dataset.query.plan_invalid", "Joined Dataset ordering has no output value.");
    const compared = compareCells(leftCell, rightCell);
    if (compared !== 0) return order.direction === "asc" ? compared : -compared;
  }
  return left.tieKey.localeCompare(right.tieKey, "en-US");
}

function numericCellValue(cell: QueryCell): number {
  if (cell.logicalType === "number" && typeof cell.value === "number") return cell.value;
  if (cell.logicalType === "integer" && typeof cell.value === "string") {
    const value = Number(cell.value);
    if (Number.isSafeInteger(value)) return value;
  }
  return fail("dataset.query.numeric_out_of_range", "A joined Dataset numeric value exceeds the exact local range.");
}

function matchesFilter(row: JoinedRow, filter: DatasetQueryInternalFilter): boolean {
  const cell = requireCell(row, filter.columnId);
  if (filter.op === "is_missing") return cell.state === "missing";
  if (filter.op === "is_empty") return cell.state === "empty";
  if (filter.op === "is_null") return cell.state === "null";
  if (filter.op === "is_not_null") return cell.state !== "missing" && cell.state !== "null";
  if (filter.op === "contains") return typeof cell.value === "string" && typeof filter.value === "string" && cell.value.includes(filter.value);
  if (filter.op === "starts_with") return typeof cell.value === "string" && typeof filter.value === "string" && cell.value.startsWith(filter.value);
  if (cell.state === "missing" || cell.state === "null" || filter.value === undefined) return false;
  const compared = compareValue(cell, filter.value);
  return filter.op === "eq" ? compared === 0 : filter.op === "ne" ? compared !== 0 :
    filter.op === "lt" ? compared < 0 : filter.op === "lte" ? compared <= 0 :
      filter.op === "gt" ? compared > 0 : compared >= 0;
}

function compareRows(left: JoinedRow, right: JoinedRow, request: DatasetQueryWorkerRequest): number {
  for (const order of request.plan.orderBy) {
    const compared = compareCells(requireCell(left, order.by), requireCell(right, order.by));
    if (compared !== 0) return order.direction === "asc" ? compared : -compared;
  }
  return left.ordinal - right.ordinal || left.rowId.localeCompare(right.rowId, "en-US");
}

function compareCells(left: QueryCell, right: QueryCell): number {
  const ranks: Record<DatasetQueryCellState, number> = { missing: 0, null: 1, empty: 2, value: 3 };
  if (left.state !== right.state) return ranks[left.state] - ranks[right.state];
  if (left.value === null || right.value === null) return 0;
  if (left.logicalType === "integer" && right.logicalType === "integer") return BigInt(String(left.value)) < BigInt(String(right.value)) ? -1 : BigInt(String(left.value)) > BigInt(String(right.value)) ? 1 : 0;
  return left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
}

function compareValue(cell: QueryCell, value: string | number | boolean): number {
  if (cell.logicalType === "integer") {
    const left = BigInt(String(cell.value)), right = BigInt(value as number);
    return left < right ? -1 : left > right ? 1 : 0;
  }
  return cell.value! < value ? -1 : cell.value! > value ? 1 : 0;
}

function requireCell(row: JoinedRow, columnId: string): QueryCell {
  const cell = row.cells.get(columnId);
  if (!cell) fail("dataset.query.payload_invalid", "A joined Dataset cell is unavailable.");
  return cell;
}

function parseCell(stateValue: string, kind: string, json: unknown, logicalType: DatasetLogicalType, limits: DatasetQueryLimits): QueryCell {
  const state = stateValue as DatasetQueryCellState;
  if (state === "missing" && kind === "unknown" && json === null) return { state, logicalType, value: null };
  if (state === "null" && kind === "null" && json === null) return { state, logicalType, value: null };
  if (!(["empty", "value"] as string[]).includes(state) || typeof json !== "string" || byteLength(json) > limits.maxCellBytes * 2) invalidProjection();
  let projection: Record<string, unknown>;
  try { const parsed: unknown = JSON.parse(json); if (!isRecord(parsed)) invalidProjection(); projection = parsed; } catch (caught) { if (caught instanceof PigeDomainError) throw caught; invalidProjection(); }
  if (projection.kind !== kind) invalidProjection();
  let value: DatasetQueryScalar;
  if (logicalType === "string") { if (kind !== "text" || typeof projection.value !== "string") invalidProjection(); value = projection.value; }
  else if (logicalType === "integer") { if (kind !== "integer" || typeof projection.value !== "string" || !/^-?(?:0|[1-9][0-9]*)$/u.test(projection.value)) invalidProjection(); value = projection.value; }
  else if (logicalType === "number") { if (kind !== "real" || typeof projection.value !== "number" || !Number.isFinite(projection.value)) invalidProjection(); value = projection.value; }
  else if (logicalType === "boolean") { if (kind !== "boolean" || typeof projection.value !== "boolean") invalidProjection(); value = projection.value; }
  else if (logicalType === "date") { if (!(["date", "xlsx_date_serial"] as string[]).includes(kind) || typeof projection.value !== "string") invalidProjection(); value = projection.value; }
  else if (logicalType === "datetime") { if (kind !== "datetime" || typeof projection.value !== "string") invalidProjection(); value = projection.value; }
  else if (logicalType === "binary") { if (kind !== "blob" || projection.encoding !== "base64" || typeof projection.value !== "string") invalidProjection(); value = projection.value; }
  else invalidProjection();
  if (typeof value === "string" && byteLength(value) > limits.maxCellBytes) limit("cell_bytes");
  return { state, logicalType, value };
}

function projectedType(type: DatasetLogicalType): string {
  return type === "string" ? "text" : type === "number" ? "real" : type;
}

function expectRowId(value: unknown): string {
  if (typeof value !== "string" || !/^row_[a-z0-9]{12,}$/u.test(value)) fail("dataset.query.payload_invalid", "A Dataset row identity is invalid.");
  return value;
}
function expectCount(value: unknown): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) fail("dataset.query.payload_invalid", "A Dataset row coordinate is invalid.");
  return count;
}
function byteLength(value: string): number { return Buffer.byteLength(value, "utf8"); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function invalidProjection(): never { return fail("dataset.query.payload_invalid", "A Dataset cell projection is invalid."); }
function limit(kind: string): never { return fail(`dataset.query.limit.${kind}`, `The Dataset relation join exceeds its bounded ${kind} limit.`); }
function fail(code: string, message: string): never { throw new PigeDomainError(code, message); }
