export const DATASET_INGEST_PLAN_SCHEMA_VERSION = 1;
export const DATASET_INGEST_PLANNER_ID = "dataset_ingest";
export const DATASET_INGEST_PLANNER_VERSION = "1";

export const DATASET_INGEST_DEFAULT_LIMITS = Object.freeze({
  maxSourceBytes: 100 * 1024 * 1024,
  maxRows: 100_000,
  maxColumns: 1_024,
  maxCells: 5_000_000,
  maxCellBytes: 1024 * 1024,
  maxPlanValueBytes: 128 * 1024 * 1024,
  maxTables: 256,
  maxArchiveEntries: 10_000,
  maxArchiveUncompressedBytes: 512 * 1024 * 1024,
  maxXmlEntryBytes: 64 * 1024 * 1024,
  maxSelectedXmlBytes: 256 * 1024 * 1024
} satisfies DatasetIngestLimits);

export type DatasetIngestSourceKind = "csv_file" | "xlsx_file" | "sqlite_file";
export type DatasetHeaderMode = "auto" | "present" | "absent";
export type DatasetCellState = "missing" | "empty" | "null" | "value";
export type DatasetProjectedType =
  | "unknown"
  | "null"
  | "text"
  | "boolean"
  | "integer"
  | "real"
  | "date"
  | "datetime"
  | "xlsx_date_serial"
  | "blob";

export interface DatasetIngestLimits {
  readonly maxSourceBytes: number;
  readonly maxRows: number;
  readonly maxColumns: number;
  readonly maxCells: number;
  readonly maxCellBytes: number;
  readonly maxPlanValueBytes: number;
  readonly maxTables: number;
  readonly maxArchiveEntries: number;
  readonly maxArchiveUncompressedBytes: number;
  readonly maxXmlEntryBytes: number;
  readonly maxSelectedXmlBytes: number;
}

interface DatasetIngestRequestBase {
  readonly requestId: string;
  /** A private, verified source snapshot owned by the calling main-process service. */
  readonly filePath: string;
  readonly limits: DatasetIngestLimits;
}

export interface DatasetCsvOptions {
  readonly delimiter?: "auto" | string;
  readonly header?: DatasetHeaderMode;
  /** Exact, unquoted tokens that represent null. Defaults to `NULL` and `\\N`. */
  readonly nullTokens?: readonly string[];
}

export interface DatasetXlsxOptions {
  readonly header?: DatasetHeaderMode;
}

export interface DatasetCsvIngestRequest extends DatasetIngestRequestBase {
  readonly sourceKind: "csv_file";
  readonly csv?: DatasetCsvOptions;
}

export interface DatasetXlsxIngestRequest extends DatasetIngestRequestBase {
  readonly sourceKind: "xlsx_file";
  readonly xlsx?: DatasetXlsxOptions;
}

export interface DatasetSqliteIngestRequest extends DatasetIngestRequestBase {
  readonly sourceKind: "sqlite_file";
}

export type DatasetIngestRequest =
  | DatasetCsvIngestRequest
  | DatasetXlsxIngestRequest
  | DatasetSqliteIngestRequest;

export interface DatasetCellLexicalValue {
  /** Exact CSV token, XLSX cached `<v>` text, or another adapter-owned lexical value. */
  readonly raw: string;
  readonly text: string;
  readonly quoted?: boolean;
}

export type DatasetCellProjection =
  | { readonly kind: "unknown" }
  | { readonly kind: "null" }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "integer"; readonly value: string }
  | { readonly kind: "real"; readonly value: number }
  | { readonly kind: "date"; readonly value: string }
  | { readonly kind: "datetime"; readonly value: string }
  | {
      readonly kind: "xlsx_date_serial";
      readonly value: string;
      readonly dateSystem: "1900" | "1904";
    }
  | {
      readonly kind: "blob";
      readonly value: string;
      readonly encoding: "base64";
      readonly byteLength: number;
    };

export interface DatasetXlsxFormula {
  readonly text: string;
  readonly kind: "normal" | "shared" | "array" | "data_table";
  readonly sharedIndex?: string;
  readonly reference?: string;
  /** The enclosing cell state describes this cached value, not formula evaluation. */
  readonly hasCachedValue: boolean;
}

export interface DatasetIngestCell {
  readonly columnOrdinal: number;
  readonly state: DatasetCellState;
  readonly sourceType: string;
  readonly lexical?: DatasetCellLexicalValue;
  readonly projection: DatasetCellProjection;
  readonly formula?: DatasetXlsxFormula;
  readonly sourceStyle?: {
    readonly index: number;
    readonly numberFormatId?: number;
    readonly numberFormatCode?: string;
  };
}

export interface DatasetIngestRow {
  readonly ordinal: number;
  /** One-based CSV record, XLSX worksheet row, or SQLite result position. */
  readonly sourceRow: number;
  readonly cells: readonly DatasetIngestCell[];
}

export interface DatasetColumnStats {
  readonly missing: number;
  readonly empty: number;
  readonly null: number;
  readonly value: number;
}

export interface DatasetIngestColumn {
  readonly ordinal: number;
  readonly sourceName?: string;
  /** A deterministic, unique suggestion; DatasetService owns the committed name and ID. */
  readonly suggestedName: string;
  readonly projectedType: DatasetProjectedType;
  readonly sourceTypes: readonly string[];
  readonly sourceMetadata?: Readonly<Record<string, string | number | boolean>>;
  readonly stats: DatasetColumnStats;
}

export interface DatasetIngestHeader {
  readonly mode: DatasetHeaderMode;
  readonly used: boolean;
  readonly sourceRow?: DatasetIngestRow;
}

export interface DatasetIngestTable {
  readonly ordinal: number;
  readonly sourceName: string;
  readonly sourceLocator: string;
  readonly sourceMetadata: Readonly<Record<string, string | number | boolean>>;
  readonly header: DatasetIngestHeader;
  readonly columns: readonly DatasetIngestColumn[];
  readonly rows: readonly DatasetIngestRow[];
}

export interface DatasetIngestWarning {
  readonly code: string;
  readonly message: string;
  readonly tableOrdinal?: number;
  readonly sourceRow?: number;
  readonly columnOrdinal?: number;
}

export interface DatasetCsvSourceMetadata {
  readonly kind: "csv_file";
  readonly byteLength: number;
  readonly sha256: string;
  readonly encoding: "utf-8" | "utf-16le" | "utf-16be";
  readonly bom: boolean;
  readonly delimiter: string;
  readonly quote: "\"";
  readonly nullTokens: readonly string[];
  readonly lineEndings: readonly ("crlf" | "lf" | "cr" | "none")[];
}

export interface DatasetXlsxSourceMetadata {
  readonly kind: "xlsx_file";
  readonly byteLength: number;
  readonly sha256: string;
  readonly entryCount: number;
  readonly totalUncompressedBytes: number;
  readonly dateSystem: "1900" | "1904";
  readonly calculationMode: "automatic" | "automatic_except_tables" | "manual" | "unknown";
  readonly sheetCount: number;
  readonly formulaCount: number;
}

export interface DatasetSqliteSourceMetadata {
  readonly kind: "sqlite_file";
  readonly byteLength: number;
  readonly sha256: string;
  readonly tableCount: number;
  readonly objectOrder: "name_binary";
  readonly openedReadOnly: true;
  readonly defensive: true;
  readonly extensionsEnabled: false;
  readonly authorizerPolicy: "schema_and_table_reads_only";
}

export type DatasetIngestSourceMetadata =
  | DatasetCsvSourceMetadata
  | DatasetXlsxSourceMetadata
  | DatasetSqliteSourceMetadata;

export interface DatasetIngestPlan {
  readonly schemaVersion: typeof DATASET_INGEST_PLAN_SCHEMA_VERSION;
  readonly planner: {
    readonly id: typeof DATASET_INGEST_PLANNER_ID;
    readonly version: typeof DATASET_INGEST_PLANNER_VERSION;
  };
  readonly source: DatasetIngestSourceMetadata;
  readonly target: {
    readonly profile: "managed_collection";
    readonly owner: "dataset_service";
    readonly sourceDisposition: "preserve_as_evidence";
  };
  readonly limits: DatasetIngestLimits;
  readonly stats: {
    readonly tableCount: number;
    readonly rowCount: number;
    readonly columnCount: number;
    readonly cellCount: number;
    readonly retainedValueBytes: number;
  };
  readonly tables: readonly DatasetIngestTable[];
  readonly warnings: readonly DatasetIngestWarning[];
}

export interface DatasetIngestWorkerSuccess {
  readonly requestId: string;
  readonly ok: true;
  readonly plan: DatasetIngestPlan;
}

export interface DatasetIngestWorkerFailure {
  readonly requestId: string;
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export type DatasetIngestWorkerResponse = DatasetIngestWorkerSuccess | DatasetIngestWorkerFailure;
