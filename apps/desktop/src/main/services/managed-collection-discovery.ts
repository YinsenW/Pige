import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { PigeDomainError } from "@pige/domain";
import {
  CollectionListRequestSchema,
  CollectionListResultSchema,
  type CollectionDatasetSummary,
  type CollectionListRequest,
  type CollectionListResult,
  type CollectionRowCursor,
  type CollectionViewFilter,
  type CollectionViewSort,
  type DatasetColumn
} from "@pige/schemas";
import { hashCanonical, readAllBundles, type BundleBinding } from "./managed-collection-storage";

interface CatalogCursorBinding {
  readonly vaultId: string;
  readonly snapshotHash: string;
  readonly offset: number;
  readonly boundaryDatasetId: string;
}

export interface CollectionRowPageIdentity {
  readonly vaultId: string;
  readonly datasetId: string;
  readonly revisionId: string;
  readonly tableId: string;
  readonly viewId?: string;
  readonly viewFingerprint: string;
}

interface RowCursorBinding extends CollectionRowPageIdentity {
  readonly offset: number;
  readonly boundaryRowId: string;
}

export interface CollectionRowPage {
  readonly limit: number;
  readonly offset: number;
  readonly boundaryRowId?: string;
}

const MAX_CURSOR_BINDINGS = 512;
const MAX_TABLE_SUMMARIES = 32;
const MAX_ORDERED_ROWS = 100_000;

interface OrderedCell {
  readonly state: "missing" | "empty" | "null" | "value";
  readonly value: string | number | boolean | null;
  readonly logicalType: DatasetColumn["logicalType"];
}

export class ManagedCollectionDiscovery {
  readonly #catalogCursors = new Map<string, CatalogCursorBinding>();
  readonly #rowCursors = new Map<string, RowCursorBinding>();
  readonly #readBundles: (vaultPath: string) => readonly BundleBinding[];

  constructor(readBundles: (vaultPath: string) => readonly BundleBinding[] = readAllBundles) {
    this.#readBundles = readBundles;
  }

  list(vaultId: string, vaultPath: string, request: CollectionListRequest): CollectionListResult {
    const parsed = CollectionListRequestSchema.parse(request);
    const identity = { apiVersion: 1 as const, activeVaultId: parsed.activeVaultId };
    if (parsed.activeVaultId !== vaultId) {
      return CollectionListResultSchema.parse({ ...identity, status: "failed" });
    }
    try {
      const summaries = this.#readBundles(vaultPath).map(toSummary).sort(compareSummaries);
      const snapshotHash = hashCanonical(summaries);
      let offset = 0;
      if (parsed.cursor) {
        const cursor = this.#catalogCursors.get(parsed.cursor);
        if (!cursor || cursor.vaultId !== vaultId || cursor.snapshotHash !== snapshotHash ||
            summaries[cursor.offset - 1]?.datasetId !== cursor.boundaryDatasetId) {
          return CollectionListResultSchema.parse({ ...identity, status: "failed" });
        }
        offset = cursor.offset;
      }
      const datasets = summaries.slice(offset, offset + parsed.limit);
      const nextOffset = offset + datasets.length;
      const hasMore = nextOffset < summaries.length;
      const nextCursor = hasMore && datasets.length > 0
        ? this.#mintCatalogCursor({
            vaultId,
            snapshotHash,
            offset: nextOffset,
            boundaryDatasetId: datasets[datasets.length - 1]!.datasetId
          })
        : undefined;
      return CollectionListResultSchema.parse({
        ...identity,
        status: "ready",
        datasets,
        totalDatasetCount: summaries.length,
        hasMore,
        ...(nextCursor ? { nextCursor } : {})
      });
    } catch {
      return CollectionListResultSchema.parse({ ...identity, status: "failed" });
    }
  }

  resolveRowPage(
    identity: CollectionRowPageIdentity,
    limit: number,
    cursor: CollectionRowCursor | undefined
  ): CollectionRowPage | undefined {
    if (!cursor) return { limit, offset: 0 };
    const binding = this.#rowCursors.get(cursor);
    if (!binding || !sameRowIdentity(binding, identity)) return undefined;
    return { limit, offset: binding.offset, boundaryRowId: binding.boundaryRowId };
  }

  mintRowCursor(identity: CollectionRowPageIdentity, offset: number, boundaryRowId: string): CollectionRowCursor {
    return this.#mint(this.#rowCursors, "collection_rows_", { ...identity, offset, boundaryRowId });
  }

  orderedRowIds(
    binding: BundleBinding,
    tableId: string,
    filter?: CollectionViewFilter,
    sort?: CollectionViewSort
  ): readonly string[] {
    const table = binding.schema.tables.find((candidate) => candidate.id === tableId);
    if (!table || table.rowCount > MAX_ORDERED_ROWS) throw collectionInvalid();
    const filterColumn = filter ? table.columns.find(({ id }) => id === filter.columnId) : undefined;
    const sortColumn = sort ? table.columns.find(({ id }) => id === sort.columnId) : undefined;
    if ((filter && !filterColumn) || (sort && !sortColumn)) throw collectionInvalid();
    const database = new DatabaseSync(binding.payloadPath, { readOnly: true });
    try {
      const rows = database.prepare(
        "SELECT row_id, ordinal FROM pige_dataset_rows WHERE table_id = ? ORDER BY ordinal ASC"
      ).all(tableId) as Array<{ row_id?: unknown; ordinal?: unknown }>;
      if (rows.length !== table.rowCount) throw collectionInvalid();
      const cells = new Map<string, Map<string, OrderedCell>>();
      const columns = [...new Set([filterColumn, sortColumn].filter((value): value is DatasetColumn => !!value))];
      if (columns.length > 0) {
        const records = database.prepare([
          "SELECT r.row_id, c.column_id, c.state, c.projection_kind, c.projection_json",
          "FROM pige_dataset_rows AS r JOIN pige_dataset_cells AS c ON c.row_id = r.row_id",
          `WHERE r.table_id = ? AND c.column_id IN (${columns.map(() => "?").join(", ")})`,
          "ORDER BY r.ordinal ASC, c.column_id COLLATE BINARY ASC"
        ].join(" ")).all(tableId, ...columns.map(({ id }) => id)) as Array<Record<string, unknown>>;
        for (const record of records) {
          if (typeof record.row_id !== "string" || typeof record.column_id !== "string") throw collectionInvalid();
          const column = columns.find(({ id }) => id === record.column_id);
          if (!column) throw collectionInvalid();
          const row = cells.get(record.row_id) ?? new Map<string, OrderedCell>();
          if (row.has(column.id)) throw collectionInvalid();
          row.set(column.id, parseOrderedCell(record, column));
          cells.set(record.row_id, row);
        }
      }
      const selected = rows.flatMap((row) => {
        if (typeof row.row_id !== "string" || !Number.isSafeInteger(row.ordinal)) throw collectionInvalid();
        const rowId = row.row_id;
        const rowCells = cells.get(rowId);
        if (columns.some(({ id }) => !rowCells?.has(id))) throw collectionInvalid();
        if (filter && filterColumn && !matches(rowCells!.get(filterColumn.id)!, filter)) return [];
        return [{ rowId, ordinal: Number(row.ordinal), cells: rowCells }];
      });
      if (sort && sortColumn) {
        selected.sort((left, right) => {
          const compared = compareCells(left.cells!.get(sortColumn.id)!, right.cells!.get(sortColumn.id)!);
          const directed = sort.direction === "asc" ? compared : -compared;
          return directed || left.ordinal - right.ordinal || compareText(left.rowId, right.rowId);
        });
      }
      return selected.map(({ rowId }) => rowId);
    } finally {
      database.close();
    }
  }

  #mintCatalogCursor(binding: CatalogCursorBinding): string {
    return this.#mint(this.#catalogCursors, "collection_catalog_", binding);
  }

  #mint<T>(registry: Map<string, T>, prefix: string, binding: T): string {
    const token = `${prefix}${createHash("sha256").update(randomUUID()).digest("hex")}`;
    registry.set(token, binding);
    if (registry.size > MAX_CURSOR_BINDINGS) registry.delete(registry.keys().next().value as string);
    return token;
  }
}

function parseOrderedCell(record: Record<string, unknown>, column: DatasetColumn): OrderedCell {
  if (!(record.state === "missing" || record.state === "empty" || record.state === "null" || record.state === "value")) {
    throw collectionInvalid();
  }
  if (record.state === "missing" || record.state === "null") {
    if (record.projection_json !== null) throw collectionInvalid();
    return { state: record.state, value: null, logicalType: column.logicalType };
  }
  if (typeof record.projection_json !== "string" || record.projection_json.length > 16_384) throw collectionInvalid();
  const parsed = JSON.parse(record.projection_json) as Record<string, unknown>;
  let value: string | number | boolean;
  if (column.logicalType === "integer") {
    if (typeof parsed.value !== "string" || !/^-?(?:0|[1-9][0-9]*)$/u.test(parsed.value)) throw collectionInvalid();
    value = parsed.value;
  } else if (column.logicalType === "number") {
    if (typeof parsed.value !== "number" || !Number.isFinite(parsed.value)) throw collectionInvalid();
    value = parsed.value;
  } else if (column.logicalType === "boolean") {
    if (typeof parsed.value !== "boolean") throw collectionInvalid();
    value = parsed.value;
  } else {
    if (typeof parsed.value !== "string") throw collectionInvalid();
    value = parsed.value;
  }
  if (record.state === "empty" && value !== "") throw collectionInvalid();
  return { state: record.state, value, logicalType: column.logicalType };
}

function matches(cell: OrderedCell, filter: CollectionViewFilter): boolean {
  if (filter.operator === "is_null") return cell.state === "null";
  if (cell.state === "missing" || cell.state === "null") return false;
  if (cell.logicalType === "integer") {
    return typeof filter.value === "number" && Number.isSafeInteger(filter.value) &&
      typeof cell.value === "string" && BigInt(cell.value) === BigInt(filter.value);
  }
  return cell.value === filter.value;
}

function compareCells(left: OrderedCell, right: OrderedCell): number {
  const order = { missing: 0, null: 1, empty: 2, value: 3 } as const;
  const state = order[left.state] - order[right.state];
  if (state !== 0 || left.value === null || right.value === null) return state;
  if (left.logicalType === "integer" && right.logicalType === "integer") {
    const compared = BigInt(String(left.value)) - BigInt(String(right.value));
    return compared < 0n ? -1 : compared > 0n ? 1 : 0;
  }
  if (typeof left.value === "boolean" && typeof right.value === "boolean") {
    return Number(left.value) - Number(right.value);
  }
  if (typeof left.value === "number" && typeof right.value === "number") return left.value - right.value;
  return compareText(String(left.value), String(right.value));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function collectionInvalid(): PigeDomainError {
  return new PigeDomainError("collection.payload_invalid", "The Collection payload is invalid.");
}

function toSummary(binding: BundleBinding): CollectionDatasetSummary {
  const tables = binding.schema.tables.slice(0, MAX_TABLE_SUMMARIES).map((table) => ({
    tableId: table.id,
    tableName: table.name,
    columnCount: table.columnCount,
    rowCount: table.rowCount,
    canOpen: table.columns.length > 0
  }));
  return {
    datasetId: binding.manifest.datasetId,
    title: binding.manifest.title,
    activeRevisionId: binding.manifest.activeRevision,
    tableCount: binding.schema.tables.length,
    tables,
    tablesTruncated: binding.schema.tables.length > tables.length
  };
}

function compareSummaries(left: CollectionDatasetSummary, right: CollectionDatasetSummary): number {
  const title = compareText(normalizeTitle(left.title), normalizeTitle(right.title));
  return title || compareText(left.datasetId, right.datasetId);
}

function normalizeTitle(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function sameRowIdentity(left: CollectionRowPageIdentity, right: CollectionRowPageIdentity): boolean {
  return left.vaultId === right.vaultId && left.datasetId === right.datasetId &&
    left.revisionId === right.revisionId && left.tableId === right.tableId &&
    left.viewId === right.viewId && left.viewFingerprint === right.viewFingerprint;
}
