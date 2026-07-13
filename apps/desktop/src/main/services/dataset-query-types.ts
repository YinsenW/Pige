import { createHash } from "node:crypto";
import type {
  DatasetAnswerCitation,
  DatasetQueryPreview,
  DatasetQueryScalar
} from "@pige/contracts";
import type { DatasetLogicalType } from "@pige/schemas";
import { z } from "zod";

export const DATASET_QUERY_PROTOCOL_VERSION = 1;

export const DATASET_QUERY_DEFAULT_LIMITS = Object.freeze({
  maxCatalogDirectoryEntries: 256,
  maxCatalogDatasets: 16,
  maxCatalogTables: 32,
  maxCatalogColumns: 128,
  maxBundleEntries: 4_096,
  maxJsonBytes: 8 * 1_024 * 1_024,
  maxSourceRecordBytes: 1 * 1_024 * 1_024,
  maxPayloadBytes: 512 * 1_024 * 1_024,
  maxSelectedColumns: 12,
  maxFilters: 8,
  maxGroupByColumns: 2,
  maxAggregates: 8,
  maxOrderBy: 2,
  maxReferencedColumns: 24,
  maxFilterTextBytes: 4 * 1_024,
  maxResultRows: 50,
  maxResultColumns: 32,
  maxResultBytes: 64 * 1_024,
  maxCellBytes: 4 * 1_024,
  maxScanRows: 100_000,
  maxScanCells: 500_000,
  maxScanBytes: 32 * 1_024 * 1_024,
  maxGroups: 1_000,
  timeoutMs: 30_000,
  workerOldGenerationMb: 256
} satisfies DatasetQueryLimits);

export interface DatasetQueryLimits {
  readonly maxCatalogDirectoryEntries: number;
  readonly maxCatalogDatasets: number;
  readonly maxCatalogTables: number;
  readonly maxCatalogColumns: number;
  readonly maxBundleEntries: number;
  readonly maxJsonBytes: number;
  readonly maxSourceRecordBytes: number;
  readonly maxPayloadBytes: number;
  readonly maxSelectedColumns: number;
  readonly maxFilters: number;
  readonly maxGroupByColumns: number;
  readonly maxAggregates: number;
  readonly maxOrderBy: number;
  readonly maxReferencedColumns: number;
  readonly maxFilterTextBytes: number;
  readonly maxResultRows: number;
  readonly maxResultColumns: number;
  readonly maxResultBytes: number;
  readonly maxCellBytes: number;
  readonly maxScanRows: number;
  readonly maxScanCells: number;
  readonly maxScanBytes: number;
  readonly maxGroups: number;
  readonly timeoutMs: number;
  readonly workerOldGenerationMb: number;
}

const DatasetOpaqueRefSchema = z.string().regex(/^dataset_[1-9][0-9]*$/u);
const TableOpaqueRefSchema = z.string().regex(/^table_[1-9][0-9]*$/u);
const ColumnOpaqueRefSchema = z.string().regex(/^column_[1-9][0-9]*$/u);
const AggregateOpaqueRefSchema = z.string().regex(/^aggregate_[1-9][0-9]*$/u);
const QueryScalarSchema = z.union([
  z.string().max(DATASET_QUERY_DEFAULT_LIMITS.maxFilterTextBytes),
  z.number().finite(),
  z.boolean()
]);

const DatasetQueryValueFilterSchema = z.object({
  column: ColumnOpaqueRefSchema,
  op: z.enum(["eq", "ne", "lt", "lte", "gt", "gte"]),
  value: QueryScalarSchema
}).strict();

const DatasetQueryTextFilterSchema = z.object({
  column: ColumnOpaqueRefSchema,
  op: z.enum(["contains", "starts_with"]),
  value: z.string().max(DATASET_QUERY_DEFAULT_LIMITS.maxFilterTextBytes)
}).strict();

const DatasetQueryStateFilterSchema = z.object({
  column: ColumnOpaqueRefSchema,
  op: z.enum(["is_missing", "is_empty", "is_null", "is_not_null"])
}).strict();

const DatasetQueryFilterSchema = z.union([
  DatasetQueryValueFilterSchema,
  DatasetQueryTextFilterSchema,
  DatasetQueryStateFilterSchema
]);

const DatasetQueryAggregateSchema = z.union([
  z.object({
    op: z.literal("count"),
    column: ColumnOpaqueRefSchema.optional()
  }).strict(),
  z.object({
    op: z.enum(["sum", "min", "max", "avg"]),
    column: ColumnOpaqueRefSchema
  }).strict()
]);

const DatasetQueryOrderSchema = z.object({
  by: z.union([ColumnOpaqueRefSchema, AggregateOpaqueRefSchema]),
  direction: z.enum(["asc", "desc"])
}).strict();

const DatasetCatalogToolRequestSchema = z.object({
  action: z.literal("catalog")
}).strict();

const DatasetQueryOnlyToolRequestSchema = z.object({
  action: z.literal("query"),
  datasetRef: DatasetOpaqueRefSchema,
  tableRef: TableOpaqueRefSchema,
  select: z.array(ColumnOpaqueRefSchema).max(DATASET_QUERY_DEFAULT_LIMITS.maxSelectedColumns),
  filters: z.array(DatasetQueryFilterSchema).max(DATASET_QUERY_DEFAULT_LIMITS.maxFilters).optional(),
  groupBy: z.array(ColumnOpaqueRefSchema).max(DATASET_QUERY_DEFAULT_LIMITS.maxGroupByColumns).optional(),
  aggregates: z.array(DatasetQueryAggregateSchema).max(DATASET_QUERY_DEFAULT_LIMITS.maxAggregates).optional(),
  orderBy: z.array(DatasetQueryOrderSchema).max(DATASET_QUERY_DEFAULT_LIMITS.maxOrderBy).optional(),
  limit: z.number().int().min(1).max(DATASET_QUERY_DEFAULT_LIMITS.maxResultRows)
}).strict().superRefine((request, context) => {
  const selected = request.select;
  const grouped = request.groupBy ?? [];
  const aggregates = request.aggregates ?? [];
  if (new Set(selected).size !== selected.length) {
    context.addIssue({ code: "custom", path: ["select"], message: "Selected Dataset columns must be unique." });
  }
  if (new Set(grouped).size !== grouped.length) {
    context.addIssue({ code: "custom", path: ["groupBy"], message: "Grouped Dataset columns must be unique." });
  }
  if (aggregates.length === 0) {
    if (selected.length === 0) {
      context.addIssue({ code: "custom", path: ["select"], message: "A projection query must select at least one column." });
    }
    if (grouped.length > 0) {
      context.addIssue({ code: "custom", path: ["groupBy"], message: "Grouping requires at least one aggregate." });
    }
  } else if (
    selected.length !== grouped.length ||
    selected.some((column, index) => column !== grouped[index])
  ) {
    context.addIssue({
      code: "custom",
      path: ["select"],
      message: "Aggregate queries must select exactly their groupBy columns in the same order."
    });
  }
  const aggregateCount = aggregates.length;
  for (const [index, order] of (request.orderBy ?? []).entries()) {
    const aggregateMatch = /^aggregate_([1-9][0-9]*)$/u.exec(order.by);
    if (aggregateMatch) {
      const aggregateIndex = Number(aggregateMatch[1]);
      if (aggregateIndex > aggregateCount) {
        context.addIssue({
          code: "custom",
          path: ["orderBy", index, "by"],
          message: "Aggregate ordering must reference an aggregate in this query."
        });
      }
      continue;
    }
    const outputColumns = aggregates.length > 0 ? grouped : selected;
    if (!outputColumns.includes(order.by)) {
      context.addIssue({
        code: "custom",
        path: ["orderBy", index, "by"],
        message: "Column ordering must reference a projected or grouped column."
      });
    }
  }
});

/** Home routes `catalog` to createCatalog/revalidateCatalog and `query` to execute. */
export const DatasetQueryToolRequestSchema = z.discriminatedUnion("action", [
  DatasetCatalogToolRequestSchema,
  DatasetQueryOnlyToolRequestSchema
]);

export type DatasetQueryToolRequest = z.infer<typeof DatasetQueryToolRequestSchema>;
export type DatasetQueryRequest = z.infer<typeof DatasetQueryOnlyToolRequestSchema>;
export type DatasetQueryFilter = z.infer<typeof DatasetQueryFilterSchema>;
export type DatasetQueryAggregate = z.infer<typeof DatasetQueryAggregateSchema>;
export type DatasetQueryOrder = z.infer<typeof DatasetQueryOrderSchema>;
export type DatasetOpaqueRef = z.infer<typeof DatasetOpaqueRefSchema>;
export type TableOpaqueRef = z.infer<typeof TableOpaqueRefSchema>;
export type ColumnOpaqueRef = z.infer<typeof ColumnOpaqueRefSchema>;

/** The bindings represented by this token remain in DatasetQueryService private state. */
export interface DatasetQueryCatalog {
  readonly schemaVersion: typeof DATASET_QUERY_PROTOCOL_VERSION;
  readonly catalogHash: string;
}

export interface DatasetQueryCatalogScope {
  readonly sourceId: string;
  readonly datasetId: string;
  readonly revisionId: string;
}

export interface DatasetQueryEvidenceSnapshot {
  readonly evidenceHash: string;
  readonly privateContent: boolean;
  readonly sensitiveContent: boolean;
  readonly restrictedContent: boolean;
  readonly modelText: string;
  readonly sourceIds: readonly string[];
}

export interface DatasetQueryEvidenceRevalidation {
  readonly evidence: DatasetQueryEvidenceSnapshot;
  readonly drifted: boolean;
}

export interface DatasetQueryExecutionResult {
  readonly preview: DatasetQueryPreview;
  readonly citations: readonly DatasetAnswerCitation[];
  readonly evidence: DatasetQueryEvidenceSnapshot;
}

export type DatasetQueryCellState = "missing" | "empty" | "null" | "value";

export interface DatasetQueryInternalColumn {
  readonly id: string;
  readonly name: string;
  readonly ordinal: number;
  readonly logicalType: DatasetLogicalType;
}

export interface DatasetQueryInternalFilter {
  readonly columnId: string;
  readonly op: DatasetQueryFilter["op"];
  readonly value?: string | number | boolean;
}

export interface DatasetQueryInternalAggregate {
  readonly ref: string;
  readonly op: DatasetQueryAggregate["op"];
  readonly columnId?: string;
}

export interface DatasetQueryInternalOrder {
  readonly by: string;
  readonly direction: "asc" | "desc";
}

export interface DatasetQueryInternalPlan {
  readonly selectColumnIds: readonly string[];
  readonly filters: readonly DatasetQueryInternalFilter[];
  readonly groupByColumnIds: readonly string[];
  readonly aggregates: readonly DatasetQueryInternalAggregate[];
  readonly orderBy: readonly DatasetQueryInternalOrder[];
  readonly limit: number;
}

export interface DatasetQueryWorkerInput {
  /** Private descriptor-copied snapshot path; never included in worker output. */
  readonly payloadPath: string;
  readonly binding: {
    readonly datasetId: string;
    readonly revisionId: string;
    readonly schemaChecksum: string;
    readonly payloadChecksum: string;
  };
  readonly table: {
    readonly id: string;
    readonly name: string;
    readonly rowCount: number;
    readonly columnCount: number;
  };
  readonly columns: readonly DatasetQueryInternalColumn[];
  readonly plan: DatasetQueryInternalPlan;
  readonly limits: DatasetQueryLimits;
}

export interface DatasetQueryWorkerRequest extends DatasetQueryWorkerInput {
  readonly schemaVersion: typeof DATASET_QUERY_PROTOCOL_VERSION;
  readonly requestId: string;
}

export interface DatasetQueryCoreColumn {
  readonly key: string;
  readonly label: string;
  readonly logicalType: DatasetLogicalType;
  readonly sourceColumnId?: string;
  readonly aggregate?: string;
}

export interface DatasetQueryCoreRow {
  readonly rowId?: string;
  readonly ordinal?: number;
  readonly sourceRow?: number;
  readonly values: readonly DatasetQueryScalar[];
  readonly states: readonly DatasetQueryCellState[];
}

export interface DatasetQueryCoreResult {
  readonly planHash: string;
  readonly resultHash: string;
  readonly columns: readonly DatasetQueryCoreColumn[];
  readonly rows: readonly DatasetQueryCoreRow[];
  /** Source rows satisfying filters; aggregate previews may contain fewer grouped rows. */
  readonly sourceMatchedRowCount: number;
  readonly matchedRowCount: number;
  readonly returnedRowCount: number;
  readonly truncated: boolean;
  readonly usedColumnIds: readonly string[];
  readonly returnedRowIds: readonly string[];
  readonly range?: {
    readonly startRow: number;
    readonly endRow: number;
  };
}

export type DatasetQueryWorkerResponse =
  | {
      readonly schemaVersion: typeof DATASET_QUERY_PROTOCOL_VERSION;
      readonly requestId: string;
      readonly ok: true;
      readonly result: DatasetQueryCoreResult;
    }
  | {
      readonly schemaVersion: typeof DATASET_QUERY_PROTOCOL_VERSION;
      readonly requestId: string;
      readonly ok: false;
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
    };

export interface DatasetQueryExecutor {
  execute(input: DatasetQueryWorkerInput, signal?: AbortSignal): Promise<DatasetQueryCoreResult>;
}

export function createDatasetQueryPlanHash(request: DatasetQueryWorkerRequest): string {
  return hashQueryProtocolValue("pige:dataset-query-plan:v1", {
    schemaVersion: request.schemaVersion,
    datasetId: request.binding.datasetId,
    revisionId: request.binding.revisionId,
    schemaChecksum: request.binding.schemaChecksum,
    payloadChecksum: request.binding.payloadChecksum,
    tableId: request.table.id,
    selectColumnIds: request.plan.selectColumnIds,
    filters: request.plan.filters,
    groupByColumnIds: request.plan.groupByColumnIds,
    aggregates: request.plan.aggregates,
    orderBy: request.plan.orderBy,
    limit: request.plan.limit
  });
}

export function createDatasetQueryResultHash(
  result: Omit<DatasetQueryCoreResult, "resultHash">
): string {
  return hashQueryProtocolValue("pige:dataset-query-result:v1", result);
}

function hashQueryProtocolValue(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0`, "utf8")
    .update(JSON.stringify(value), "utf8")
    .digest("hex")}`;
}

export type {
  DatasetAnswerCitation,
  DatasetQueryPreview,
  DatasetQueryScalar
} from "@pige/contracts";
