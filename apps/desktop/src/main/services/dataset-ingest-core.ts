import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { constants as sqliteConstants, DatabaseSync } from "node:sqlite";
import { PigeDomainError } from "@pige/domain";
import { XMLParser } from "fast-xml-parser";
import { openPromise, validateFileName, type Entry } from "yauzl";
import {
  DATASET_INGEST_PLAN_SCHEMA_VERSION,
  DATASET_INGEST_PLANNER_ID,
  DATASET_INGEST_PLANNER_VERSION,
  type DatasetCellLexicalValue,
  type DatasetCellProjection,
  type DatasetCellState,
  type DatasetColumnStats,
  type DatasetCsvIngestRequest,
  type DatasetCsvSourceMetadata,
  type DatasetHeaderMode,
  type DatasetIngestCell,
  type DatasetIngestColumn,
  type DatasetIngestLimits,
  type DatasetIngestPlan,
  type DatasetIngestRequest,
  type DatasetIngestRow,
  type DatasetIngestSourceMetadata,
  type DatasetIngestTable,
  type DatasetIngestWarning,
  type DatasetProjectedType,
  type DatasetSqliteIngestRequest,
  type DatasetSqliteSourceMetadata,
  type DatasetXlsxFormula,
  type DatasetXlsxIngestRequest,
  type DatasetXlsxSourceMetadata
} from "./dataset-ingest-types";

type OrderedXmlNode = Record<string, unknown>;

interface VerifiedSourceBytes {
  readonly bytes: Buffer;
  readonly byteLength: number;
  readonly sha256: string;
}

interface CsvFieldToken {
  readonly raw: string;
  readonly text: string;
  readonly quoted: boolean;
}

interface CsvRecordToken {
  readonly sourceRow: number;
  readonly fields: readonly CsvFieldToken[];
  readonly terminator: "crlf" | "lf" | "cr" | "none";
}

interface SparseIngestRow {
  readonly sourceRow: number;
  readonly cells: ReadonlyMap<number, DatasetIngestCell>;
}

interface FinalizeTableInput {
  readonly sourceName: string;
  readonly sourceLocator: string;
  readonly sourceMetadata: Readonly<Record<string, string | number | boolean>>;
  readonly rows: readonly DatasetIngestRow[];
  readonly columnCount: number;
  readonly headerMode: DatasetHeaderMode;
  readonly fixedColumnNames?: readonly string[];
  readonly columnSourceMetadata?: readonly (Readonly<Record<string, string | number | boolean>> | undefined)[];
}

const CSV_AUTO_DELIMITERS = [",", "\t", ";", "|"] as const;
const CSV_DEFAULT_NULL_TOKENS = ["NULL", "\\N"] as const;
const MAX_ARCHIVE_ENTRY_NAME_LENGTH = 1_024;
const MAX_ARCHIVE_COMPRESSION_RATIO = 1_000;
const ARCHIVE_COMPRESSION_RATIO_MIN_BYTES = 1024 * 1024;
const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "binary");
const OLE_COMPOUND_HEADER = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const xmlParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: false,
  maxNestedTags: 100,
  strictReservedNames: true
});

export async function planDatasetIngest(request: DatasetIngestRequest): Promise<DatasetIngestPlan> {
  validateRequest(request);
  const source = readVerifiedSource(request.filePath, request.limits.maxSourceBytes);
  const budget = new IngestBudget(request.limits);
  const warnings: DatasetIngestWarning[] = [];

  let sourceMetadata: DatasetIngestSourceMetadata;
  let tables: readonly DatasetIngestTable[];
  if (request.sourceKind === "csv_file") {
    ({ sourceMetadata, tables } = planCsv(request, source, budget, warnings));
  } else if (request.sourceKind === "xlsx_file") {
    ({ sourceMetadata, tables } = await planXlsx(request, source, budget, warnings));
    assertSourceUnchanged(request.filePath, source, request.limits.maxSourceBytes);
  } else {
    ({ sourceMetadata, tables } = planSqlite(request, source, budget, warnings));
    assertSourceUnchanged(request.filePath, source, request.limits.maxSourceBytes);
  }

  return {
    schemaVersion: DATASET_INGEST_PLAN_SCHEMA_VERSION,
    planner: { id: DATASET_INGEST_PLANNER_ID, version: DATASET_INGEST_PLANNER_VERSION },
    source: sourceMetadata,
    target: {
      profile: "managed_collection",
      owner: "dataset_service",
      sourceDisposition: "preserve_as_evidence"
    },
    limits: { ...request.limits },
    stats: {
      tableCount: tables.length,
      rowCount: tables.reduce((total, table) => total + table.rows.length, 0),
      columnCount: tables.reduce((total, table) => total + table.columns.length, 0),
      cellCount: tables.reduce(
        (total, table) => total + table.rows.reduce((rowTotal, row) => rowTotal + row.cells.length, 0),
        0
      ),
      retainedValueBytes: budget.retainedValueBytes
    },
    tables,
    warnings: uniqueWarnings(warnings)
  };
}

function planCsv(
  request: DatasetCsvIngestRequest,
  source: VerifiedSourceBytes,
  budget: IngestBudget,
  warnings: DatasetIngestWarning[]
): { readonly sourceMetadata: DatasetCsvSourceMetadata; readonly tables: readonly DatasetIngestTable[] } {
  const decoded = decodeCsv(source.bytes);
  const configuredDelimiter = request.csv?.delimiter ?? "auto";
  const delimiter = configuredDelimiter === "auto"
    ? detectCsvDelimiter(decoded.text, request.limits)
    : validateCsvDelimiter(configuredDelimiter);
  const nullTokens = validateNullTokens(request.csv?.nullTokens ?? CSV_DEFAULT_NULL_TOKENS, request.limits.maxCellBytes);
  const records = parseCsvRecords(decoded.text, delimiter, request.limits);
  const columnCount = records.reduce((maximum, record) => Math.max(maximum, record.fields.length), 0);
  if (columnCount > request.limits.maxColumns) {
    throw limitError("column", `CSV input exceeds the configured ${request.limits.maxColumns}-column limit.`);
  }
  budget.claimRows(records.length);
  budget.claimCells(safeProduct(records.length, columnCount));

  const rows = records.map((record, rowIndex) => ({
    ordinal: rowIndex + 1,
    sourceRow: record.sourceRow,
    cells: Array.from({ length: columnCount }, (_unused, columnIndex) => {
      const token = record.fields[columnIndex];
      if (!token) return missingCell(columnIndex + 1, "csv.missing");
      return csvCell(columnIndex + 1, token, nullTokens, budget, request.limits);
    })
  }));
  const table = finalizeTable({
    sourceName: "CSV",
    sourceLocator: "csv:table:1",
    sourceMetadata: {
      sourceRecordCount: records.length,
      delimiter,
      encoding: decoded.encoding
    },
    rows,
    columnCount,
    headerMode: request.csv?.header ?? "auto"
  }, budget, warnings);

  return {
    sourceMetadata: {
      kind: "csv_file",
      byteLength: source.byteLength,
      sha256: source.sha256,
      encoding: decoded.encoding,
      bom: decoded.bom,
      delimiter,
      quote: "\"",
      nullTokens,
      lineEndings: uniqueLineEndings(records)
    },
    tables: [table]
  };
}

function decodeCsv(bytes: Buffer): {
  readonly text: string;
  readonly encoding: "utf-8" | "utf-16le" | "utf-16be";
  readonly bom: boolean;
} {
  let encoding: "utf-8" | "utf-16le" | "utf-16be" = "utf-8";
  let offset = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    offset = 3;
  } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = "utf-16le";
    offset = 2;
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = "utf-16be";
    offset = 2;
  }
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset));
    return { text, encoding, bom: offset > 0 };
  } catch {
    throw new PigeDomainError("dataset.ingest.csv.invalid_encoding", "The CSV is not valid UTF-8 or BOM-marked UTF-16 text.");
  }
}

function detectCsvDelimiter(text: string, limits: DatasetIngestLimits): string {
  let best: { readonly delimiter: string; readonly score: number } | undefined;
  for (const delimiter of CSV_AUTO_DELIMITERS) {
    let records: readonly CsvRecordToken[];
    try {
      records = parseCsvRecords(text, delimiter, {
        ...limits,
        maxRows: Math.min(limits.maxRows, 32),
        maxCells: Math.min(limits.maxCells, Math.max(limits.maxColumns * 32, 32))
      }, 32);
    } catch {
      continue;
    }
    const widths = records.map((record) => record.fields.length).filter((width) => width > 0);
    const maximum = Math.max(0, ...widths);
    if (maximum <= 1) continue;
    const frequencies = new Map<number, number>();
    for (const width of widths) frequencies.set(width, (frequencies.get(width) ?? 0) + 1);
    const mode = [...frequencies.entries()].sort((left, right) => right[1] - left[1] || right[0] - left[0])[0];
    if (!mode) continue;
    const score = mode[1] * 10_000 + mode[0] * 100 - (widths.length - mode[1]);
    if (!best || score > best.score) best = { delimiter, score };
  }
  return best?.delimiter ?? ",";
}

function validateCsvDelimiter(value: string): string {
  if (value.length !== 1 || value === "\"" || value === "\r" || value === "\n" || value === "\0") {
    throw new PigeDomainError("dataset.ingest.csv.invalid_delimiter", "The CSV delimiter must be one non-quote, non-newline character.");
  }
  return value;
}

function validateNullTokens(values: readonly string[], maxCellBytes: number): readonly string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || value.includes("\r") || value.includes("\n") || byteLength(value) > maxCellBytes) {
      throw new PigeDomainError("dataset.ingest.csv.invalid_null_token", "CSV null tokens must be non-empty, single-line bounded strings.");
    }
    if (!seen.has(value)) {
      seen.add(value);
      tokens.push(value);
    }
  }
  return tokens;
}

function parseCsvRecords(
  text: string,
  delimiter: string,
  limits: DatasetIngestLimits,
  stopAfterRows?: number
): readonly CsvRecordToken[] {
  type State = "field_start" | "unquoted" | "quoted" | "after_quote";
  let state: State = "field_start";
  let raw = "";
  let value = "";
  let quoted = false;
  let recordTouched = false;
  let sourceRow = 1;
  let parsedFieldCount = 0;
  let fields: CsvFieldToken[] = [];
  const records: CsvRecordToken[] = [];

  const finishField = (): void => {
    if (byteLength(raw) > limits.maxCellBytes || byteLength(value) > limits.maxCellBytes) {
      throw limitError("cell_bytes", "A CSV cell exceeds the configured byte limit.");
    }
    fields.push({ raw, text: value, quoted });
    parsedFieldCount += 1;
    if (parsedFieldCount > limits.maxCells) {
      throw limitError("cell", `CSV input exceeds the configured ${limits.maxCells}-cell limit.`);
    }
    if (fields.length > limits.maxColumns) {
      throw limitError("column", `CSV input exceeds the configured ${limits.maxColumns}-column limit.`);
    }
    raw = "";
    value = "";
    quoted = false;
    state = "field_start";
  };
  const finishRecord = (terminator: CsvRecordToken["terminator"]): boolean => {
    finishField();
    records.push({ sourceRow, fields, terminator });
    if (records.length > limits.maxRows) {
      throw limitError("row", `CSV input exceeds the configured ${limits.maxRows}-row limit.`);
    }
    fields = [];
    recordTouched = false;
    sourceRow += 1;
    return stopAfterRows !== undefined && records.length >= stopAfterRows;
  };

  for (let index = 0; index < text.length;) {
    const character = text[index]!;
    if (state === "quoted") {
      raw += character;
      if (character === "\"") {
        if (text[index + 1] === "\"") {
          raw += "\"";
          value += "\"";
          index += 2;
          continue;
        }
        state = "after_quote";
      } else {
        value += character;
      }
      index += 1;
      continue;
    }

    if (state === "after_quote") {
      if (character === delimiter) {
        finishField();
        recordTouched = true;
        index += 1;
        continue;
      }
      if (character === "\r" || character === "\n") {
        const crlf = character === "\r" && text[index + 1] === "\n";
        if (finishRecord(crlf ? "crlf" : character === "\r" ? "cr" : "lf")) return records;
        index += crlf ? 2 : 1;
        continue;
      }
      throw new PigeDomainError("dataset.ingest.csv.invalid_quote", "A quoted CSV field contains characters after its closing quote.");
    }

    if (state === "field_start" && character === "\"") {
      state = "quoted";
      quoted = true;
      recordTouched = true;
      raw += character;
      index += 1;
      continue;
    }
    if (character === "\"") {
      throw new PigeDomainError("dataset.ingest.csv.invalid_quote", "An unquoted CSV field contains an unexpected quote.");
    }
    if (character === delimiter) {
      finishField();
      recordTouched = true;
      index += 1;
      continue;
    }
    if (character === "\r" || character === "\n") {
      const crlf = character === "\r" && text[index + 1] === "\n";
      if (finishRecord(crlf ? "crlf" : character === "\r" ? "cr" : "lf")) return records;
      index += crlf ? 2 : 1;
      continue;
    }
    state = "unquoted";
    recordTouched = true;
    raw += character;
    value += character;
    index += 1;
  }

  if (state === "quoted") {
    throw new PigeDomainError("dataset.ingest.csv.unclosed_quote", "The CSV ends inside a quoted field.");
  }
  if (recordTouched || fields.length > 0 || state !== "field_start") finishRecord("none");
  return records;
}

function csvCell(
  columnOrdinal: number,
  token: CsvFieldToken,
  nullTokens: readonly string[],
  budget: IngestBudget,
  limits: DatasetIngestLimits
): DatasetIngestCell {
  let state: DatasetCellState;
  let projection: DatasetCellProjection;
  if (!token.quoted && nullTokens.includes(token.text)) {
    state = "null";
    projection = { kind: "null" };
  } else if (token.text.length === 0) {
    state = "empty";
    projection = { kind: "text", value: "" };
  } else {
    state = "value";
    projection = inferTextProjection(token.text);
  }
  const lexical: DatasetCellLexicalValue = { raw: token.raw, text: token.text, quoted: token.quoted };
  const cell: DatasetIngestCell = {
    columnOrdinal,
    state,
    sourceType: token.quoted ? "csv.quoted" : "csv.unquoted",
    lexical,
    projection
  };
  budget.retainCell(cell, limits.maxCellBytes);
  return cell;
}

function inferTextProjection(value: string): DatasetCellProjection {
  if (value !== value.trim()) return { kind: "text", value };
  const lower = value.toLowerCase();
  if (lower === "true" || lower === "false") return { kind: "boolean", value: lower === "true" };
  if (/^[+-]?(?:0|[1-9]\d*)$/u.test(value)) return { kind: "integer", value };
  if (/^[+-]?(?:(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+)$/u.test(value)) {
    const projected = Number(value);
    if (Number.isFinite(projected)) return { kind: "real", value: projected };
  }
  if (isIsoDate(value)) return { kind: "date", value };
  if (isIsoDateTime(value)) return { kind: "datetime", value };
  return { kind: "text", value };
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isIsoDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value));
}

function uniqueLineEndings(records: readonly CsvRecordToken[]): readonly CsvRecordToken["terminator"][] {
  return Array.from(new Set(records.map((record) => record.terminator)));
}

function finalizeTable(
  input: FinalizeTableInput,
  budget: IngestBudget,
  warnings: DatasetIngestWarning[]
): DatasetIngestTable {
  if (input.columnCount > budget.limits.maxColumns) {
    throw limitError("column", `A source table exceeds the configured ${budget.limits.maxColumns}-column limit.`);
  }
  budget.claimTable();
  budget.retainString(input.sourceName);
  const headerUsed = !input.fixedColumnNames && decideHeader(input.headerMode, input.rows, input.columnCount);
  const headerRow = headerUsed ? input.rows[0] : undefined;
  const sourceRows = headerUsed ? input.rows.slice(1) : input.rows;
  const rows = sourceRows.map((row, index) => ({ ...row, ordinal: index + 1 }));
  const rawNames = Array.from({ length: input.columnCount }, (_unused, index) => {
    if (input.fixedColumnNames) return input.fixedColumnNames[index];
    return headerRow ? cellText(headerRow.cells[index]) : undefined;
  });
  const suggestedNames = uniqueSuggestedNames(rawNames);
  const columns = Array.from({ length: input.columnCount }, (_unused, index) => {
    const cells = rows.map((row) => row.cells[index]!).filter(Boolean);
    const sourceTypes = Array.from(new Set(cells.map((cell) => cell.sourceType))).sort(compareBinary);
    const sourceName = rawNames[index];
    if (sourceName !== undefined) budget.retainString(sourceName);
    budget.retainString(suggestedNames[index]!);
    return {
      ordinal: index + 1,
      ...(sourceName !== undefined ? { sourceName } : {}),
      suggestedName: suggestedNames[index]!,
      projectedType: inferColumnType(cells),
      sourceTypes,
      ...(input.columnSourceMetadata?.[index] ? { sourceMetadata: input.columnSourceMetadata[index] } : {}),
      stats: countColumnStates(cells)
    } satisfies DatasetIngestColumn;
  });
  if (input.headerMode === "auto" && headerUsed) {
    warnings.push({
      code: "dataset.ingest.header_inferred",
      message: "The first source row was deterministically inferred as a header.",
      tableOrdinal: budget.tableCount
    });
  }
  return {
    ordinal: budget.tableCount,
    sourceName: input.sourceName,
    sourceLocator: input.sourceLocator,
    sourceMetadata: input.sourceMetadata,
    header: {
      mode: input.headerMode,
      used: headerUsed,
      ...(headerRow ? { sourceRow: headerRow } : {})
    },
    columns,
    rows
  };
}

function decideHeader(mode: DatasetHeaderMode, rows: readonly DatasetIngestRow[], columnCount: number): boolean {
  if (mode === "present") return rows.length > 0;
  if (mode === "absent" || rows.length < 2 || columnCount === 0) return false;
  const first = rows[0]!;
  const names = first.cells.map(cellText);
  if (names.some((name) => !name || name.length > 240)) return false;
  const normalized = names.map((name) => name!.trim().toLowerCase());
  if (new Set(normalized).size !== names.length) return false;
  const typeContrast = first.cells.some((cell, index) =>
    cell.projection.kind === "text" && rows.slice(1, 21).some((row) => {
      const kind = row.cells[index]?.projection.kind;
      return kind !== undefined && kind !== "text" && kind !== "null" && kind !== "unknown";
    })
  );
  const headerLike = names.every((name) => /^[\p{L}_][\p{L}\p{N} _.\-]{0,239}$/u.test(name!));
  return typeContrast || headerLike;
}

function cellText(cell: DatasetIngestCell | undefined): string | undefined {
  if (!cell || cell.state === "missing" || cell.state === "null") return undefined;
  return cell.lexical?.text;
}

function uniqueSuggestedNames(sourceNames: readonly (string | undefined)[]): readonly string[] {
  const counts = new Map<string, number>();
  return sourceNames.map((sourceName, index) => {
    const normalized = normalizeSuggestedName(sourceName) || `Column ${index + 1}`;
    const key = normalized.toLocaleLowerCase("en-US");
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return count === 1 ? normalized : `${normalized} (${count})`;
  });
}

function normalizeSuggestedName(value: string | undefined): string {
  return (value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240);
}

function inferColumnType(cells: readonly DatasetIngestCell[]): DatasetProjectedType {
  const kinds = new Set(cells
    .filter((cell) => cell.state === "value")
    .map((cell) => cell.projection.kind)
    .filter((kind) => kind !== "unknown" && kind !== "null"));
  if (kinds.size === 0) return cells.some((cell) => cell.state === "null") ? "null" : "unknown";
  if (kinds.size === 1) return [...kinds][0]!;
  if ([...kinds].every((kind) => kind === "integer" || kind === "real")) return "real";
  return "text";
}

function countColumnStates(cells: readonly DatasetIngestCell[]): DatasetColumnStats {
  const counts: Record<DatasetCellState, number> = { missing: 0, empty: 0, null: 0, value: 0 };
  for (const cell of cells) counts[cell.state] += 1;
  return counts;
}

function normalizeSparseRows(rows: readonly SparseIngestRow[], columnCount: number): readonly DatasetIngestRow[] {
  return rows.map((row, index) => ({
    ordinal: index + 1,
    sourceRow: row.sourceRow,
    cells: Array.from({ length: columnCount }, (_unused, columnIndex) =>
      row.cells.get(columnIndex + 1) ?? missingCell(columnIndex + 1, "source.missing"))
  }));
}

function missingCell(columnOrdinal: number, sourceType: string): DatasetIngestCell {
  return { columnOrdinal, state: "missing", sourceType, projection: { kind: "unknown" } };
}

class IngestBudget {
  readonly limits: DatasetIngestLimits;
  tableCount = 0;
  sourceRowCount = 0;
  sourceCellCount = 0;
  retainedValueBytes = 0;

  constructor(limits: DatasetIngestLimits) {
    this.limits = limits;
  }

  claimTable(): void {
    this.tableCount += 1;
    if (this.tableCount > this.limits.maxTables) {
      throw limitError("table", `Input exceeds the configured ${this.limits.maxTables}-table limit.`);
    }
  }

  claimRows(count: number): void {
    this.sourceRowCount = safeAdd(this.sourceRowCount, count);
    if (this.sourceRowCount > this.limits.maxRows) {
      throw limitError("row", `Input exceeds the configured ${this.limits.maxRows}-row limit.`);
    }
  }

  claimCells(count: number): void {
    this.sourceCellCount = safeAdd(this.sourceCellCount, count);
    if (this.sourceCellCount > this.limits.maxCells) {
      throw limitError("cell", `Input exceeds the configured ${this.limits.maxCells}-cell limit.`);
    }
  }

  retainString(value: string): void {
    this.retainedValueBytes = safeAdd(this.retainedValueBytes, byteLength(value));
    if (this.retainedValueBytes > this.limits.maxPlanValueBytes) {
      throw limitError("plan_bytes", "The retained import plan values exceed the configured byte limit.");
    }
  }

  retainCell(cell: DatasetIngestCell, maxCellBytes: number): void {
    const values = [
      cell.lexical?.raw,
      cell.lexical?.text,
      cell.formula?.text,
      cell.formula?.sharedIndex,
      cell.formula?.reference,
      projectionString(cell.projection),
      cell.sourceStyle?.numberFormatCode
    ].filter((value): value is string => value !== undefined);
    const blobValue = cell.projection.kind === "blob" ? cell.projection.value : undefined;
    const boundedCellValues = blobValue !== undefined
      ? values.filter((value) => value !== blobValue)
      : values;
    if (cell.projection.kind === "blob" && cell.projection.byteLength > maxCellBytes) {
      throw limitError("cell_bytes", "A source cell exceeds the configured byte limit.");
    }
    if (boundedCellValues.some((value) => byteLength(value) > maxCellBytes)) {
      throw limitError("cell_bytes", "A source cell exceeds the configured byte limit.");
    }
    for (const value of values) this.retainString(value);
  }
}

function projectionString(projection: DatasetCellProjection): string | undefined {
  if (projection.kind === "integer" || projection.kind === "date" || projection.kind === "datetime" ||
      projection.kind === "xlsx_date_serial" || projection.kind === "blob" || projection.kind === "text") {
    return projection.value;
  }
  if (projection.kind === "real") return String(projection.value);
  if (projection.kind === "boolean") return projection.value ? "true" : "false";
  return undefined;
}

function validateRequest(request: DatasetIngestRequest): void {
  if (!request.requestId || byteLength(request.requestId) > 256) {
    throw new PigeDomainError("dataset.ingest.invalid_request", "Dataset ingest requires a bounded request ID.");
  }
  for (const [name, value] of Object.entries(request.limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new PigeDomainError("dataset.ingest.invalid_limits", `Dataset ingest limit ${name} must be a positive safe integer.`);
    }
  }
}

function readVerifiedSource(filePath: string, maxBytes: number): VerifiedSourceBytes {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("not a regular file");
    if (!Number.isSafeInteger(stat.size) || stat.size > maxBytes) {
      throw limitError("source_bytes", "The source exceeds the configured Dataset ingest byte limit.");
    }
    const bytes = fs.readFileSync(filePath);
    if (bytes.length !== stat.size) {
      throw new PigeDomainError("dataset.ingest.source_changed", "The verified Dataset source changed while it was being read.");
    }
    return {
      bytes,
      byteLength: bytes.length,
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`
    };
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("dataset.ingest.source_unavailable", "The verified Dataset source is unavailable.");
  }
}

function assertSourceUnchanged(filePath: string, expected: VerifiedSourceBytes, maxBytes: number): void {
  const current = readVerifiedSource(filePath, maxBytes);
  if (current.byteLength !== expected.byteLength || current.sha256 !== expected.sha256) {
    throw new PigeDomainError("dataset.ingest.source_changed", "The verified Dataset source changed during import planning.");
  }
}

function uniqueWarnings(warnings: readonly DatasetIngestWarning[]): readonly DatasetIngestWarning[] {
  const seen = new Set<string>();
  const output: DatasetIngestWarning[] = [];
  for (const warning of warnings) {
    const key = JSON.stringify(warning);
    if (!seen.has(key)) {
      seen.add(key);
      output.push(warning);
    }
  }
  return output;
}

function limitError(kind: string, message: string): PigeDomainError {
  return new PigeDomainError(`dataset.ingest.limit.${kind}`, message);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function safeAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw limitError("numeric_overflow", "Dataset ingest bounds overflowed a safe integer.");
  return value;
}

function safeProduct(left: number, right: number): number {
  const value = left * right;
  if (!Number.isSafeInteger(value)) throw limitError("numeric_overflow", "Dataset ingest bounds overflowed a safe integer.");
  return value;
}

function compareBinary(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface XlsxPackageData {
  readonly entries: ReadonlyMap<string, string>;
  readonly entryNames: ReadonlySet<string>;
  readonly relationships: ReadonlyMap<string, readonly XlsxRelationship[]>;
  readonly entryCount: number;
  readonly totalUncompressedBytes: number;
}

interface XlsxRelationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly resolvedTarget: string;
}

interface XlsxSheetDescriptor {
  readonly name: string;
  readonly sheetId: string;
  readonly state: "visible" | "hidden" | "very_hidden";
  readonly packagePath: string;
}

interface XlsxStyleInfo {
  readonly index: number;
  readonly numberFormatId: number;
  readonly numberFormatCode?: string;
  readonly isDate: boolean;
}

interface XlsxParsedSheet {
  readonly rows: readonly DatasetIngestRow[];
  readonly columnCount: number;
  readonly formulaCount: number;
  readonly formulaWithoutCacheCount: number;
  readonly errorCellCount: number;
}

async function planXlsx(
  request: DatasetXlsxIngestRequest,
  source: VerifiedSourceBytes,
  budget: IngestBudget,
  warnings: DatasetIngestWarning[]
): Promise<{ readonly sourceMetadata: DatasetXlsxSourceMetadata; readonly tables: readonly DatasetIngestTable[] }> {
  if (source.bytes.subarray(0, OLE_COMPOUND_HEADER.length).equals(OLE_COMPOUND_HEADER)) {
    throw new PigeDomainError(
      "dataset.ingest.xlsx.legacy_encrypted_or_ole",
      "Legacy, encrypted, or OLE compound workbooks are not supported."
    );
  }
  const packageData = await readXlsxPackage(request.filePath, request.limits);
  validateXlsxContentTypes(requireXlsxPart(packageData, "[Content_Types].xml"));
  validateXlsxRootRelationship(packageData);

  const workbookXml = requireXlsxPart(packageData, "xl/workbook.xml");
  const workbookNodes = parseOrderedXml(workbookXml, "xlsx");
  const workbookRelationships = packageData.relationships.get("xl/_rels/workbook.xml.rels") ?? [];
  const relationById = new Map(workbookRelationships.map((relationship) => [relationship.id, relationship]));
  const sheets = parseWorkbookSheets(workbookNodes, relationById, packageData, request.limits);
  const dateSystem = workbookDateSystem(workbookNodes);
  const calculationMode = workbookCalculationMode(workbookNodes);
  const sharedStrings = parseXlsxSharedStrings(packageData.entries.get("xl/sharedStrings.xml"), request.limits);
  const styles = parseXlsxStyles(packageData.entries.get("xl/styles.xml"), request.limits);
  const tables: DatasetIngestTable[] = [];
  let formulaCount = 0;

  for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
    const descriptor = sheets[sheetIndex]!;
    const tableOrdinal = budget.tableCount + 1;
    const parsed = parseXlsxSheet(
      requireXlsxPart(packageData, descriptor.packagePath),
      sharedStrings,
      styles,
      dateSystem,
      request.limits,
      budget
    );
    formulaCount = safeAdd(formulaCount, parsed.formulaCount);
    if (descriptor.state !== "visible") {
      warnings.push({
        code: "dataset.ingest.xlsx.hidden_sheet",
        message: "A hidden workbook sheet was included in source order.",
        tableOrdinal
      });
    }
    if (parsed.formulaCount > 0) {
      warnings.push({
        code: "dataset.ingest.xlsx.formulas_not_evaluated",
        message: "Formula text and cached values were preserved without evaluating formulas; caches may be stale.",
        tableOrdinal
      });
    }
    if (parsed.formulaWithoutCacheCount > 0) {
      warnings.push({
        code: "dataset.ingest.xlsx.formula_cache_missing",
        message: `${parsed.formulaWithoutCacheCount} formula cell(s) have no cached value.`,
        tableOrdinal
      });
    }
    if (parsed.errorCellCount > 0) {
      warnings.push({
        code: "dataset.ingest.xlsx.error_cells",
        message: `${parsed.errorCellCount} workbook error cell(s) were preserved as typed source values.`,
        tableOrdinal
      });
    }
    tables.push(finalizeTable({
      sourceName: descriptor.name,
      sourceLocator: `sheet:${sheetIndex + 1}`,
      sourceMetadata: {
        sheetId: descriptor.sheetId,
        sheetOrder: sheetIndex + 1,
        state: descriptor.state,
        sourceRowCount: parsed.rows.length,
        formulaCount: parsed.formulaCount
      },
      rows: parsed.rows,
      columnCount: parsed.columnCount,
      headerMode: request.xlsx?.header ?? "auto"
    }, budget, warnings));
  }

  if (calculationMode === "manual" && formulaCount > 0) {
    warnings.push({
      code: "dataset.ingest.xlsx.manual_calculation",
      message: "The workbook uses manual calculation, so cached formula values are especially likely to be stale."
    });
  }
  if (packageData.entryNames.has("xl/calcChain.xml") && formulaCount > 0) {
    warnings.push({
      code: "dataset.ingest.xlsx.calculation_chain_ignored",
      message: "The workbook calculation chain was not executed."
    });
  }

  return {
    sourceMetadata: {
      kind: "xlsx_file",
      byteLength: source.byteLength,
      sha256: source.sha256,
      entryCount: packageData.entryCount,
      totalUncompressedBytes: packageData.totalUncompressedBytes,
      dateSystem,
      calculationMode,
      sheetCount: sheets.length,
      formulaCount
    },
    tables
  };
}

async function readXlsxPackage(filePath: string, limits: DatasetIngestLimits): Promise<XlsxPackageData> {
  let zipFile;
  try {
    zipFile = await openPromise(filePath, {
      autoClose: false,
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true
    });
  } catch {
    throw new PigeDomainError("dataset.ingest.xlsx.invalid_archive", "The XLSX source is not a valid OpenXML archive.");
  }

  try {
    if (zipFile.entryCount > limits.maxArchiveEntries) {
      throw limitError("archive_entries", "The XLSX package exceeds the configured archive entry limit.");
    }
    const entries = new Map<string, string>();
    const entryNames = new Set<string>();
    let entryCount = 0;
    let totalUncompressedBytes = 0;
    let selectedXmlBytes = 0;
    for await (const entry of zipFile.eachEntry()) {
      entryCount += 1;
      if (entryCount > limits.maxArchiveEntries) {
        throw limitError("archive_entries", "The XLSX package exceeds the configured archive entry limit.");
      }
      validateXlsxArchiveEntry(entry, limits);
      rejectDangerousXlsxEntry(entry.fileName);
      if (entryNames.has(entry.fileName)) {
        throw new PigeDomainError("dataset.ingest.xlsx.duplicate_entry", "The XLSX package contains duplicate parts.");
      }
      entryNames.add(entry.fileName);
      totalUncompressedBytes = safeAdd(totalUncompressedBytes, entry.uncompressedSize);
      if (totalUncompressedBytes > limits.maxArchiveUncompressedBytes) {
        throw limitError("archive_expanded_bytes", "The expanded XLSX package exceeds the configured byte limit.");
      }
      if (!shouldReadXlsxXml(entry.fileName)) continue;
      if (entry.uncompressedSize > limits.maxXmlEntryBytes) {
        throw limitError("xml_entry_bytes", "An XLSX XML part exceeds the configured byte limit.");
      }
      selectedXmlBytes = safeAdd(selectedXmlBytes, entry.uncompressedSize);
      if (selectedXmlBytes > limits.maxSelectedXmlBytes) {
        throw limitError("selected_xml_bytes", "Selected XLSX XML parts exceed the configured byte limit.");
      }
      const xml = await readArchiveEntryText(zipFile, entry, limits.maxXmlEntryBytes);
      if (/<!DOCTYPE/iu.test(xml)) {
        throw new PigeDomainError("dataset.ingest.xlsx.doctype_not_allowed", "DOCTYPE declarations are not allowed in XLSX input.");
      }
      entries.set(entry.fileName, xml);
    }
    for (const required of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels"]) {
      if (!entryNames.has(required)) {
        throw new PigeDomainError("dataset.ingest.xlsx.required_part_missing", "The XLSX package is missing a required OpenXML part.");
      }
    }
    const relationships = new Map<string, readonly XlsxRelationship[]>();
    for (const [entryName, xml] of entries) {
      if (entryName.endsWith(".rels")) relationships.set(entryName, parseXlsxRelationships(xml, entryName));
    }
    return { entries, entryNames, relationships, entryCount, totalUncompressedBytes };
  } finally {
    zipFile.close();
  }
}

function validateXlsxArchiveEntry(entry: Entry, limits: DatasetIngestLimits): void {
  const invalidName = validateFileName(entry.fileName);
  if (invalidName || entry.fileName.length > MAX_ARCHIVE_ENTRY_NAME_LENGTH ||
      entry.fileName.includes("\\") || entry.fileName.startsWith("/")) {
    throw new PigeDomainError("dataset.ingest.xlsx.unsafe_entry", "The XLSX package contains an unsafe part path.");
  }
  if (!Number.isSafeInteger(entry.compressedSize) || !Number.isSafeInteger(entry.uncompressedSize) ||
      entry.compressedSize < 0 || entry.uncompressedSize < 0) {
    throw new PigeDomainError("dataset.ingest.xlsx.invalid_entry_size", "The XLSX package contains an invalid part size.");
  }
  if (entry.isEncrypted()) {
    throw new PigeDomainError("dataset.ingest.xlsx.encrypted", "Encrypted XLSX packages are not supported.");
  }
  if (!entry.canDecodeFileData()) {
    throw new PigeDomainError("dataset.ingest.xlsx.unsupported_compression", "The XLSX package uses unsupported compression.");
  }
  if (entry.uncompressedSize > limits.maxArchiveUncompressedBytes) {
    throw limitError("archive_entry_bytes", "An XLSX package part exceeds the configured expanded byte limit.");
  }
  if (entry.uncompressedSize >= ARCHIVE_COMPRESSION_RATIO_MIN_BYTES && entry.compressedSize > 0 &&
      entry.uncompressedSize / entry.compressedSize > MAX_ARCHIVE_COMPRESSION_RATIO) {
    throw new PigeDomainError("dataset.ingest.xlsx.suspicious_compression", "The XLSX package has a suspicious compression ratio.");
  }
}

function rejectDangerousXlsxEntry(entryName: string): void {
  const normalized = entryName.toLowerCase();
  if (normalized === "xl/workbook.bin" || normalized.includes("vbaproject") || normalized.includes("vbadata") ||
      normalized.startsWith("xl/macrosheets/") || normalized.startsWith("xl/dialogsheets/") ||
      normalized.startsWith("customui/")) {
    throw new PigeDomainError("dataset.ingest.xlsx.macros_not_allowed", "Macro-enabled or legacy workbook parts are not supported.");
  }
  if (normalized.startsWith("xl/activex/") || normalized.startsWith("xl/ctrlprops/")) {
    throw new PigeDomainError("dataset.ingest.xlsx.activex_not_allowed", "ActiveX workbook parts are not supported.");
  }
  if (normalized.startsWith("xl/embeddings/")) {
    throw new PigeDomainError("dataset.ingest.xlsx.ole_not_allowed", "Embedded OLE workbook objects are not supported.");
  }
  if (normalized.startsWith("xl/externallinks/") || normalized === "xl/connections.xml" ||
      normalized.startsWith("xl/querytables/") || normalized.startsWith("xl/webextensions/")) {
    throw new PigeDomainError("dataset.ingest.xlsx.external_resources_not_allowed", "External workbook resources and data connections are not supported.");
  }
}

function shouldReadXlsxXml(entryName: string): boolean {
  return entryName === "[Content_Types].xml" || entryName.endsWith(".rels") ||
    entryName === "xl/workbook.xml" || entryName === "xl/sharedStrings.xml" ||
    entryName === "xl/styles.xml" || /^xl\/worksheets\/[^/]+\.xml$/u.test(entryName);
}

async function readArchiveEntryText(
  zipFile: Awaited<ReturnType<typeof openPromise>>,
  entry: Entry,
  maxBytes: number
): Promise<string> {
  const stream = await zipFile.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total = safeAdd(total, buffer.length);
    if (total > maxBytes) {
      stream.destroy();
      throw limitError("xml_entry_bytes", "An XLSX XML part exceeds the configured byte limit.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function validateXlsxContentTypes(xml: string): void {
  const nodes = parseOrderedXml(xml, "xlsx");
  const contentTypes = findElements(nodes, "Default")
    .concat(findElements(nodes, "Override"))
    .map((node) => (attribute(node, "ContentType") ?? "").toLowerCase());
  for (const contentType of contentTypes) {
    if (contentType.includes("macroenabled") || contentType.includes("vbaproject") ||
        contentType.includes("sheet.binary")) {
      throw new PigeDomainError("dataset.ingest.xlsx.macros_not_allowed", "Macro-enabled or binary workbook content is not supported.");
    }
    if (contentType.includes("activex") || contentType.includes("controlproperties")) {
      throw new PigeDomainError("dataset.ingest.xlsx.activex_not_allowed", "ActiveX workbook content is not supported.");
    }
    if (contentType.includes("oleobject")) {
      throw new PigeDomainError("dataset.ingest.xlsx.ole_not_allowed", "Embedded OLE workbook content is not supported.");
    }
    if (contentType.includes("externallink") || contentType.includes("connections") ||
        contentType.includes("querytable") || contentType.includes("webextension")) {
      throw new PigeDomainError("dataset.ingest.xlsx.external_resources_not_allowed", "External workbook resources and data connections are not supported.");
    }
  }
}

function parseXlsxRelationships(xml: string, relationshipPart: string): readonly XlsxRelationship[] {
  const basePart = relationshipBasePart(relationshipPart);
  const ids = new Set<string>();
  return findElements(parseOrderedXml(xml, "xlsx"), "Relationship").map((node) => {
    const id = attribute(node, "Id") ?? "";
    const type = attribute(node, "Type") ?? "";
    const target = attribute(node, "Target") ?? "";
    const external = (attribute(node, "TargetMode") ?? "").toLowerCase() === "external";
    if (!id || !type || !target) {
      throw new PigeDomainError("dataset.ingest.xlsx.invalid_relationship", "The XLSX package contains an incomplete relationship.");
    }
    if (ids.has(id)) {
      throw new PigeDomainError("dataset.ingest.xlsx.duplicate_relationship", "The XLSX package contains duplicate relationship IDs.");
    }
    ids.add(id);
    if (external) {
      throw new PigeDomainError("dataset.ingest.xlsx.external_resources_not_allowed", "External workbook relationships are not supported.");
    }
    rejectDangerousXlsxRelationshipType(type);
    return { id, type, target, resolvedTarget: resolvePackageTarget(basePart, target) };
  });
}

function rejectDangerousXlsxRelationshipType(type: string): void {
  const normalized = type.toLowerCase();
  if (/(?:\/vbaproject|\/macrosheet|\/dialogsheet)$/u.test(normalized)) {
    throw new PigeDomainError("dataset.ingest.xlsx.macros_not_allowed", "Macro workbook relationships are not supported.");
  }
  if (/(?:\/activexcontrol|\/control|\/ctrlprop)$/u.test(normalized)) {
    throw new PigeDomainError("dataset.ingest.xlsx.activex_not_allowed", "ActiveX workbook relationships are not supported.");
  }
  if (normalized.endsWith("/oleobject") || normalized.endsWith("/package")) {
    throw new PigeDomainError("dataset.ingest.xlsx.ole_not_allowed", "Embedded OLE workbook relationships are not supported.");
  }
  if (/(?:\/externallink|\/connections|\/querytable|\/webextension)$/u.test(normalized)) {
    throw new PigeDomainError("dataset.ingest.xlsx.external_resources_not_allowed", "External workbook resources and data connections are not supported.");
  }
}

function relationshipBasePart(relationshipPart: string): string {
  if (relationshipPart === "_rels/.rels") return "";
  const marker = "/_rels/";
  const markerIndex = relationshipPart.lastIndexOf(marker);
  if (markerIndex < 0 || !relationshipPart.endsWith(".rels")) {
    throw new PigeDomainError("dataset.ingest.xlsx.invalid_relationship_part", "The XLSX package contains an invalid relationship part path.");
  }
  return path.posix.join(
    relationshipPart.slice(0, markerIndex),
    path.posix.basename(relationshipPart, ".rels")
  );
}

function resolvePackageTarget(basePart: string, target: string): string {
  const normalizedTarget = target.replaceAll("\\", "/");
  if (/^[a-z][a-z0-9+.-]*:/iu.test(normalizedTarget) || normalizedTarget.startsWith("//")) {
    throw new PigeDomainError("dataset.ingest.xlsx.unsafe_relationship", "The XLSX package contains an unsafe relationship target.");
  }
  const resolved = normalizedTarget.startsWith("/")
    ? path.posix.normalize(normalizedTarget.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(basePart), normalizedTarget));
  if (!resolved || resolved === "." || resolved === ".." || resolved.startsWith("../") || path.posix.isAbsolute(resolved)) {
    throw new PigeDomainError("dataset.ingest.xlsx.unsafe_relationship", "An XLSX relationship escapes the package.");
  }
  return resolved;
}

function validateXlsxRootRelationship(packageData: XlsxPackageData): void {
  const rootRelationships = packageData.relationships.get("_rels/.rels") ?? [];
  const officeDocument = rootRelationships.find((relationship) => relationship.type.toLowerCase().endsWith("/officedocument"));
  if (!officeDocument || officeDocument.resolvedTarget !== "xl/workbook.xml") {
    throw new PigeDomainError("dataset.ingest.xlsx.invalid_root_relationship", "The XLSX package does not identify a supported workbook root.");
  }
}

function parseWorkbookSheets(
  workbookNodes: readonly OrderedXmlNode[],
  relationById: ReadonlyMap<string, XlsxRelationship>,
  packageData: XlsxPackageData,
  limits: DatasetIngestLimits
): readonly XlsxSheetDescriptor[] {
  const sheetNodes = findElements(workbookNodes, "sheet");
  if (sheetNodes.length > limits.maxTables) {
    throw limitError("table", `The workbook exceeds the configured ${limits.maxTables}-sheet limit.`);
  }
  const seenNames = new Set<string>();
  const seenTargets = new Set<string>();
  return sheetNodes.map((node) => {
    const name = attribute(node, "name") ?? "";
    const sheetId = attribute(node, "sheetId") ?? "";
    const relationshipId = attribute(node, "r:id") ?? "";
    if (!name || !sheetId || !relationshipId || byteLength(name) > limits.maxCellBytes) {
      throw new PigeDomainError("dataset.ingest.xlsx.invalid_sheet", "The workbook contains invalid or oversized sheet metadata.");
    }
    const nameKey = name.toLocaleLowerCase("en-US");
    if (seenNames.has(nameKey)) {
      throw new PigeDomainError("dataset.ingest.xlsx.duplicate_sheet_name", "The workbook contains duplicate sheet names.");
    }
    seenNames.add(nameKey);
    const relationship = relationById.get(relationshipId);
    if (!relationship || !relationship.type.toLowerCase().endsWith("/worksheet") ||
        !/^xl\/worksheets\/[^/]+\.xml$/u.test(relationship.resolvedTarget)) {
      throw new PigeDomainError("dataset.ingest.xlsx.unsupported_sheet_type", "Only ordinary XLSX worksheets are supported.");
    }
    if (!packageData.entryNames.has(relationship.resolvedTarget) || seenTargets.has(relationship.resolvedTarget)) {
      throw new PigeDomainError("dataset.ingest.xlsx.invalid_sheet_target", "A workbook sheet target is missing or duplicated.");
    }
    seenTargets.add(relationship.resolvedTarget);
    const rawState = (attribute(node, "state") ?? "visible").toLowerCase();
    const state = rawState === "visible" ? "visible" : rawState === "hidden" ? "hidden" :
      rawState === "veryhidden" ? "very_hidden" : undefined;
    if (!state) throw new PigeDomainError("dataset.ingest.xlsx.invalid_sheet_state", "The workbook contains an unsupported sheet state.");
    return { name, sheetId, state, packagePath: relationship.resolvedTarget };
  });
}

function workbookDateSystem(nodes: readonly OrderedXmlNode[]): "1900" | "1904" {
  const workbookProperties = findElements(nodes, "workbookPr")[0];
  const value = workbookProperties ? (attribute(workbookProperties, "date1904") ?? "") : "";
  return value === "1" || value.toLowerCase() === "true" ? "1904" : "1900";
}

function workbookCalculationMode(nodes: readonly OrderedXmlNode[]): DatasetXlsxSourceMetadata["calculationMode"] {
  const calculationProperties = findElements(nodes, "calcPr")[0];
  const value = calculationProperties ? (attribute(calculationProperties, "calcMode") ?? "") : "";
  if (value === "auto") return "automatic";
  if (value === "autoNoTable") return "automatic_except_tables";
  if (value === "manual") return "manual";
  return "unknown";
}

function parseXlsxSharedStrings(xml: string | undefined, limits: DatasetIngestLimits): readonly string[] {
  if (!xml) return [];
  const strings = findElements(parseOrderedXml(xml, "xlsx"), "si").map((node) =>
    findElements(elementChildren(node), "t").map((textNode) => rawText(elementChildren(textNode))).join(""));
  if (strings.length > limits.maxCells) {
    throw limitError("shared_strings", "The workbook shared-string table exceeds the configured cell limit.");
  }
  if (strings.some((value) => byteLength(value) > limits.maxCellBytes)) {
    throw limitError("cell_bytes", "A workbook shared string exceeds the configured cell byte limit.");
  }
  return strings;
}

function parseXlsxStyles(xml: string | undefined, limits: DatasetIngestLimits): readonly XlsxStyleInfo[] {
  if (!xml) return [{ index: 0, numberFormatId: 0, isDate: false }];
  const nodes = parseOrderedXml(xml, "xlsx");
  const customFormats = new Map<number, string>();
  for (const node of findElements(nodes, "numFmt")) {
    const id = parseNonNegativeInteger(attribute(node, "numFmtId"), "dataset.ingest.xlsx.invalid_style");
    const code = attribute(node, "formatCode") ?? "";
    if (byteLength(code) > limits.maxCellBytes) {
      throw limitError("cell_bytes", "An XLSX number format exceeds the configured cell byte limit.");
    }
    customFormats.set(id, code);
  }
  const cellXfs = findElements(nodes, "cellXfs")[0];
  if (!cellXfs) return [{ index: 0, numberFormatId: 0, isDate: false }];
  const styles = directElements(elementChildren(cellXfs), "xf").map((node, index) => {
    const numberFormatId = parseNonNegativeInteger(attribute(node, "numFmtId") ?? "0", "dataset.ingest.xlsx.invalid_style");
    const numberFormatCode = customFormats.get(numberFormatId);
    return {
      index,
      numberFormatId,
      ...(numberFormatCode !== undefined ? { numberFormatCode } : {}),
      isDate: isXlsxDateFormat(numberFormatId, numberFormatCode)
    };
  });
  if (styles.length > limits.maxCells) {
    throw limitError("styles", "The workbook style table exceeds the configured cell limit.");
  }
  return styles.length > 0 ? styles : [{ index: 0, numberFormatId: 0, isDate: false }];
}

function isXlsxDateFormat(numberFormatId: number, code: string | undefined): boolean {
  if ((numberFormatId >= 14 && numberFormatId <= 22) || (numberFormatId >= 27 && numberFormatId <= 36) ||
      (numberFormatId >= 45 && numberFormatId <= 47) || (numberFormatId >= 50 && numberFormatId <= 58)) {
    return true;
  }
  if (!code) return false;
  const stripped = code
    .replace(/"[^"]*"/gu, "")
    .replace(/\\./gu, "")
    .replace(/\[[^\]]*\]/gu, "")
    .replace(/_.|\*./gu, "");
  return /[ymdhis]/iu.test(stripped);
}

function parseXlsxSheet(
  xml: string,
  sharedStrings: readonly string[],
  styles: readonly XlsxStyleInfo[],
  dateSystem: "1900" | "1904",
  limits: DatasetIngestLimits,
  budget: IngestBudget
): XlsxParsedSheet {
  const nodes = parseOrderedXml(xml, "xlsx");
  const sheetData = findElements(nodes, "sheetData")[0];
  const sparseRows: SparseIngestRow[] = [];
  const rowNumbers = new Set<number>();
  let previousSourceRow = 0;
  let columnCount = 0;
  let formulaCount = 0;
  let formulaWithoutCacheCount = 0;
  let errorCellCount = 0;
  for (const rowNode of sheetData ? directElements(elementChildren(sheetData), "row") : []) {
    const sourceRow = attribute(rowNode, "r")
      ? parsePositiveInteger(attribute(rowNode, "r"), "dataset.ingest.xlsx.invalid_row")
      : previousSourceRow + 1;
    if (sourceRow > limits.maxRows) {
      throw limitError("row", "An XLSX row coordinate exceeds the configured row limit.");
    }
    if (rowNumbers.has(sourceRow)) {
      throw new PigeDomainError("dataset.ingest.xlsx.duplicate_row", "A worksheet contains duplicate row coordinates.");
    }
    rowNumbers.add(sourceRow);
    previousSourceRow = sourceRow;
    const cells = new Map<number, DatasetIngestCell>();
    let nextColumn = 1;
    for (const cellNode of directElements(elementChildren(rowNode), "c")) {
      const reference = attribute(cellNode, "r");
      const coordinate = reference ? parseCellReference(reference) : { column: nextColumn, row: sourceRow };
      if (coordinate.row !== sourceRow) {
        throw new PigeDomainError("dataset.ingest.xlsx.cell_row_mismatch", "A worksheet cell coordinate does not match its row.");
      }
      if (coordinate.column > limits.maxColumns) {
        throw limitError("column", "An XLSX cell coordinate exceeds the configured column limit.");
      }
      if (cells.has(coordinate.column)) {
        throw new PigeDomainError("dataset.ingest.xlsx.duplicate_cell", "A worksheet contains duplicate cell coordinates.");
      }
      const cell = parseXlsxCell(cellNode, coordinate.column, sharedStrings, styles, dateSystem, limits, budget);
      cells.set(coordinate.column, cell);
      nextColumn = coordinate.column + 1;
      columnCount = Math.max(columnCount, coordinate.column);
      if (cell.formula) {
        formulaCount += 1;
        if (!cell.formula.hasCachedValue) formulaWithoutCacheCount += 1;
      }
      if (cell.sourceType.includes(".error")) errorCellCount += 1;
    }
    sparseRows.push({ sourceRow, cells });
  }
  sparseRows.sort((left, right) => left.sourceRow - right.sourceRow);
  budget.claimRows(sparseRows.length);
  budget.claimCells(safeProduct(sparseRows.length, columnCount));
  return {
    rows: normalizeSparseRows(sparseRows, columnCount),
    columnCount,
    formulaCount,
    formulaWithoutCacheCount,
    errorCellCount
  };
}

function parseXlsxCell(
  node: OrderedXmlNode,
  columnOrdinal: number,
  sharedStrings: readonly string[],
  styles: readonly XlsxStyleInfo[],
  dateSystem: "1900" | "1904",
  limits: DatasetIngestLimits,
  budget: IngestBudget
): DatasetIngestCell {
  const type = attribute(node, "t") ?? "n";
  const styleIndex = attribute(node, "s") === undefined
    ? 0
    : parseNonNegativeInteger(attribute(node, "s"), "dataset.ingest.xlsx.invalid_style");
  const style = styles[styleIndex];
  if (!style) throw new PigeDomainError("dataset.ingest.xlsx.invalid_style", "A worksheet cell references a missing style.");
  const formulaNode = directElements(elementChildren(node), "f")[0];
  const valueNode = directElements(elementChildren(node), "v")[0];
  const inlineStringNode = directElements(elementChildren(node), "is")[0];
  const formula = formulaNode ? parseXlsxFormula(formulaNode, valueNode !== undefined || inlineStringNode !== undefined) : undefined;
  const value = parseXlsxCellValue(type, valueNode, inlineStringNode, sharedStrings, style, dateSystem);
  const sourceStyle = attribute(node, "s") === undefined ? undefined : {
    index: style.index,
    numberFormatId: style.numberFormatId,
    ...(style.numberFormatCode !== undefined ? { numberFormatCode: style.numberFormatCode } : {})
  };
  const cell: DatasetIngestCell = {
    columnOrdinal,
    state: formula && !formula.hasCachedValue ? "missing" : value.state,
    sourceType: formula ? `xlsx.formula.${value.sourceType}` : value.sourceType,
    ...(formula && !formula.hasCachedValue ? {} : { lexical: value.lexical }),
    projection: formula && !formula.hasCachedValue ? { kind: "unknown" } : value.projection,
    ...(formula ? { formula } : {}),
    ...(sourceStyle ? { sourceStyle } : {})
  };
  budget.retainCell(cell, limits.maxCellBytes);
  return cell;
}

function parseXlsxFormula(node: OrderedXmlNode, hasCachedValue: boolean): DatasetXlsxFormula {
  const rawKind = attribute(node, "t") ?? "normal";
  const kind = rawKind === "normal" ? "normal" : rawKind === "shared" ? "shared" :
    rawKind === "array" ? "array" : rawKind === "dataTable" ? "data_table" : undefined;
  if (!kind) throw new PigeDomainError("dataset.ingest.xlsx.unsupported_formula_type", "The workbook contains an unsupported formula type.");
  const sharedIndex = attribute(node, "si");
  const reference = attribute(node, "ref");
  return {
    text: rawText(elementChildren(node)),
    kind,
    ...(sharedIndex !== undefined ? { sharedIndex } : {}),
    ...(reference !== undefined ? { reference } : {}),
    hasCachedValue
  };
}

function parseXlsxCellValue(
  type: string,
  valueNode: OrderedXmlNode | undefined,
  inlineStringNode: OrderedXmlNode | undefined,
  sharedStrings: readonly string[],
  style: XlsxStyleInfo,
  dateSystem: "1900" | "1904"
): {
  readonly state: Exclude<DatasetCellState, "missing">;
  readonly sourceType: string;
  readonly lexical: DatasetCellLexicalValue;
  readonly projection: DatasetCellProjection;
} {
  if (type === "inlineStr") {
    const text = inlineStringNode
      ? findElements(elementChildren(inlineStringNode), "t").map((textNode) => rawText(elementChildren(textNode))).join("")
      : "";
    return lexicalXlsxValue("xlsx.inline_string", text, text, { kind: "text", value: text });
  }
  const raw = valueNode ? rawText(elementChildren(valueNode)) : "";
  if (type === "s") {
    if (!/^(?:0|[1-9]\d*)$/u.test(raw)) {
      throw new PigeDomainError("dataset.ingest.xlsx.invalid_shared_string", "A worksheet cell contains an invalid shared-string index.");
    }
    const index = Number(raw);
    if (!Number.isSafeInteger(index) || sharedStrings[index] === undefined) {
      throw new PigeDomainError("dataset.ingest.xlsx.invalid_shared_string", "A worksheet cell references a missing shared string.");
    }
    const text = sharedStrings[index]!;
    return lexicalXlsxValue("xlsx.shared_string", raw, text, { kind: "text", value: text });
  }
  if (type === "str") return lexicalXlsxValue("xlsx.string", raw, raw, { kind: "text", value: raw });
  if (type === "b") {
    if (raw !== "0" && raw !== "1") {
      throw new PigeDomainError("dataset.ingest.xlsx.invalid_boolean", "A worksheet boolean cell has an invalid cached value.");
    }
    return lexicalXlsxValue("xlsx.boolean", raw, raw, { kind: "boolean", value: raw === "1" });
  }
  if (type === "e") return lexicalXlsxValue("xlsx.error", raw, raw, { kind: "text", value: raw });
  if (type === "d") {
    const projection = inferTextProjection(raw);
    return lexicalXlsxValue("xlsx.date", raw, raw,
      projection.kind === "date" || projection.kind === "datetime" ? projection : { kind: "text", value: raw });
  }
  if (type !== "n" && type !== "") {
    throw new PigeDomainError("dataset.ingest.xlsx.unsupported_cell_type", "The workbook contains an unsupported cell type.");
  }
  if (raw === "") return lexicalXlsxValue("xlsx.number", raw, raw, { kind: "text", value: "" });
  if (!/^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/u.test(raw) || !Number.isFinite(Number(raw))) {
    throw new PigeDomainError("dataset.ingest.xlsx.invalid_number", "A worksheet numeric cell has an invalid cached value.");
  }
  if (style.isDate) {
    return lexicalXlsxValue("xlsx.date_serial", raw, raw, { kind: "xlsx_date_serial", value: raw, dateSystem });
  }
  const projection: DatasetCellProjection = /^[+-]?(?:0|[1-9]\d*)$/u.test(raw)
    ? { kind: "integer", value: raw }
    : { kind: "real", value: Number(raw) };
  return lexicalXlsxValue("xlsx.number", raw, raw, projection);
}

function lexicalXlsxValue(
  sourceType: string,
  raw: string,
  text: string,
  projection: DatasetCellProjection
): {
  readonly state: Exclude<DatasetCellState, "missing">;
  readonly sourceType: string;
  readonly lexical: DatasetCellLexicalValue;
  readonly projection: DatasetCellProjection;
} {
  return {
    state: text.length === 0 ? "empty" : "value",
    sourceType,
    lexical: { raw, text },
    projection
  };
}

function parseCellReference(value: string): { readonly column: number; readonly row: number } {
  const match = /^([A-Za-z]{1,4})([1-9]\d*)$/u.exec(value);
  if (!match) throw new PigeDomainError("dataset.ingest.xlsx.invalid_cell_reference", "A worksheet contains an invalid cell reference.");
  let column = 0;
  for (const character of match[1]!.toUpperCase()) column = safeAdd(safeProduct(column, 26), character.charCodeAt(0) - 64);
  const row = parsePositiveInteger(match[2], "dataset.ingest.xlsx.invalid_cell_reference");
  return { column, row };
}

function parsePositiveInteger(value: string | undefined, code: string): number {
  if (!value || !/^[1-9]\d*$/u.test(value)) throw new PigeDomainError(code, "The workbook contains an invalid positive integer.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new PigeDomainError(code, "The workbook contains an out-of-range integer.");
  return parsed;
}

function parseNonNegativeInteger(value: string | undefined, code: string): number {
  if (!value || !/^(?:0|[1-9]\d*)$/u.test(value)) throw new PigeDomainError(code, "The workbook contains an invalid non-negative integer.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new PigeDomainError(code, "The workbook contains an out-of-range integer.");
  return parsed;
}

function requireXlsxPart(packageData: XlsxPackageData, name: string): string {
  const value = packageData.entries.get(name);
  if (value === undefined) {
    throw new PigeDomainError("dataset.ingest.xlsx.required_part_missing", "The XLSX package is missing a required OpenXML part.");
  }
  return value;
}

function parseOrderedXml(xml: string, format: "xlsx"): readonly OrderedXmlNode[] {
  if (/<!DOCTYPE/iu.test(xml)) {
    throw new PigeDomainError(`dataset.ingest.${format}.doctype_not_allowed`, "DOCTYPE declarations are not allowed in XLSX input.");
  }
  let parsed: unknown;
  try {
    parsed = xmlParser.parse(xml, true) as unknown;
  } catch {
    throw new PigeDomainError(`dataset.ingest.${format}.invalid_xml`, "The XLSX package contains invalid XML.");
  }
  if (!Array.isArray(parsed)) {
    throw new PigeDomainError(`dataset.ingest.${format}.invalid_xml`, "The XLSX package contains invalid XML.");
  }
  return parsed.filter(isOrderedXmlNode);
}

function findElements(nodes: readonly OrderedXmlNode[], wantedName: string): OrderedXmlNode[] {
  const found: OrderedXmlNode[] = [];
  for (const node of nodes) {
    if (localName(elementName(node)) === wantedName) found.push(node);
    found.push(...findElements(elementChildren(node), wantedName));
  }
  return found;
}

function directElements(nodes: readonly OrderedXmlNode[], wantedName: string): OrderedXmlNode[] {
  return nodes.filter((node) => localName(elementName(node)) === wantedName);
}

function elementName(node: OrderedXmlNode): string {
  return Object.keys(node).find((key) => key !== ":@" && key !== "#text" && key !== "?xml") ?? "";
}

function localName(value: string): string {
  return value.includes(":") ? value.slice(value.lastIndexOf(":") + 1) : value;
}

function elementChildren(node: OrderedXmlNode): OrderedXmlNode[] {
  const value = node[elementName(node)];
  return Array.isArray(value) ? value.filter(isOrderedXmlNode) : [];
}

function attribute(node: OrderedXmlNode, name: string): string | undefined {
  const attributes = node[":@"];
  if (typeof attributes !== "object" || attributes === null) return undefined;
  const value = (attributes as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

function rawText(nodes: readonly OrderedXmlNode[]): string {
  let value = "";
  for (const node of nodes) {
    if (typeof node["#text"] === "string") value += node["#text"];
    value += rawText(elementChildren(node));
  }
  return value;
}

function isOrderedXmlNode(value: unknown): value is OrderedXmlNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function planSqlite(
  request: DatasetSqliteIngestRequest,
  source: VerifiedSourceBytes,
  budget: IngestBudget,
  warnings: DatasetIngestWarning[]
): { readonly sourceMetadata: DatasetSqliteSourceMetadata; readonly tables: readonly DatasetIngestTable[] } {
  if (source.bytes.length < SQLITE_HEADER.length || !source.bytes.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) {
    throw new PigeDomainError("dataset.ingest.sqlite.invalid_header", "The source is not a supported SQLite database file.");
  }
  for (const suffix of ["-journal", "-wal", "-shm"]) {
    if (fs.existsSync(`${request.filePath}${suffix}`)) {
      throw new PigeDomainError(
        "dataset.ingest.sqlite.live_sidecars_not_supported",
        "A SQLite source with live journal or WAL sidecars must be captured as a consistent private snapshot before import."
      );
    }
  }

  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(request.filePath, {
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
    const authorizerScope: SqliteAuthorizerScope = { readableTable: undefined, pragmaTable: undefined };
    database.setAuthorizer((actionCode, arg1, arg2, dbName, triggerOrView) =>
      authorizeSqliteRead(authorizerScope, actionCode, arg1, arg2, dbName, triggerOrView));

    const schemaRows = expectSqliteRows(database.prepare(
      "SELECT type, name, tbl_name, rootpage, sql " +
      "FROM main.sqlite_schema WHERE type IN ('table', 'view', 'trigger') " +
      "ORDER BY name COLLATE BINARY, type COLLATE BINARY"
    ).all());
    const schemaObjects = schemaRows.map(parseSqliteSchemaObject);
    const userObjects = schemaObjects.filter((object) => !object.name.toLowerCase().startsWith("sqlite_"));
    if (userObjects.some((object) => object.type === "view")) {
      throw new PigeDomainError("dataset.ingest.sqlite.views_not_allowed", "SQLite sources containing views are not supported.");
    }
    if (userObjects.some((object) => object.type === "trigger")) {
      throw new PigeDomainError("dataset.ingest.sqlite.triggers_not_allowed", "SQLite sources containing triggers are not supported.");
    }
    const tableObjects = userObjects.filter((object): object is SqliteSchemaObject & { readonly type: "table" } => object.type === "table");
    if (tableObjects.length > request.limits.maxTables) {
      throw limitError("table", `The SQLite source exceeds the configured ${request.limits.maxTables}-table limit.`);
    }
    const tables: DatasetIngestTable[] = [];
    for (const tableObject of tableObjects) {
      if (/^\s*CREATE\s+VIRTUAL\s+TABLE\b/iu.test(tableObject.sql)) {
        throw new PigeDomainError("dataset.ingest.sqlite.virtual_tables_not_allowed", "SQLite virtual tables are not supported.");
      }
      authorizerScope.pragmaTable = tableObject.name;
      authorizerScope.readableTable = undefined;
      const columnRows = expectSqliteRows(database.prepare(
        "SELECT cid, name, type, \"notnull\", dflt_value, pk, hidden " +
        "FROM pragma_table_xinfo(?) ORDER BY cid"
      ).all(tableObject.name));
      const columns = columnRows.map(parseSqliteColumn);
      if (columns.length === 0) {
        throw new PigeDomainError("dataset.ingest.sqlite.empty_schema", "A SQLite table has no ordinary columns.");
      }
      if (columns.length > request.limits.maxColumns) {
        throw limitError("column", `A SQLite table exceeds the configured ${request.limits.maxColumns}-column limit.`);
      }
      if (byteLength(tableObject.name) > request.limits.maxCellBytes ||
          columns.some((column) => byteLength(column.name) > request.limits.maxCellBytes ||
            byteLength(column.declaredType) > request.limits.maxCellBytes)) {
        throw limitError("cell_bytes", "SQLite schema metadata exceeds the configured cell byte limit.");
      }
      if (columns.some((column) => column.hidden !== 0)) {
        throw new PigeDomainError("dataset.ingest.sqlite.generated_columns_not_allowed", "SQLite generated or hidden columns are not supported.");
      }
      for (const column of columns) budget.retainString(column.declaredType);
      const remainingRows = request.limits.maxRows - budget.sourceRowCount;
      const remainingCells = request.limits.maxCells - budget.sourceCellCount;
      const rowsAllowedByCells = Math.floor(remainingCells / columns.length);
      const allowedRows = Math.max(0, Math.min(remainingRows, rowsAllowedByCells));
      const selectSql = buildSqliteSelect(tableObject, columns, allowedRows + 1);
      authorizerScope.pragmaTable = undefined;
      authorizerScope.readableTable = tableObject.name;
      const sourceRows = expectSqliteRows(database.prepare(selectSql).all());
      if (sourceRows.length > allowedRows) {
        if (rowsAllowedByCells < remainingRows) {
          throw limitError("cell", `The SQLite source exceeds the configured ${request.limits.maxCells}-cell limit.`);
        }
        throw limitError("row", `The SQLite source exceeds the configured ${request.limits.maxRows}-row limit.`);
      }
      budget.claimRows(sourceRows.length);
      budget.claimCells(safeProduct(sourceRows.length, columns.length));
      const rows = sourceRows.map((values, rowIndex) => {
        if (values.length !== columns.length) {
          throw new PigeDomainError("dataset.ingest.sqlite.invalid_result", "A SQLite table read returned an invalid row shape.");
        }
        return {
          ordinal: rowIndex + 1,
          sourceRow: rowIndex + 1,
          cells: values.map((value, columnIndex) => sqliteCell(
            columnIndex + 1,
            value,
            request.limits,
            budget
          ))
        } satisfies DatasetIngestRow;
      });
      const withoutRowid = /\bWITHOUT\s+ROWID\b/iu.test(tableObject.sql);
      const strict = /\bSTRICT\s*$/iu.test(tableObject.sql.trim());
      tables.push(finalizeTable({
        sourceName: tableObject.name,
        sourceLocator: `sqlite:table:${tables.length + 1}`,
        sourceMetadata: {
          sourceRowCount: rows.length,
          withoutRowid,
          strict
        },
        rows,
        columnCount: columns.length,
        headerMode: "absent",
        fixedColumnNames: columns.map((column) => column.name),
        columnSourceMetadata: columns.map((column) => ({
          declaredType: column.declaredType,
          notNull: column.notNull,
          primaryKeyOrdinal: column.primaryKeyOrdinal,
          hasDefault: column.hasDefault
        }))
      }, budget, warnings));
    }
    return {
      sourceMetadata: {
        kind: "sqlite_file",
        byteLength: source.byteLength,
        sha256: source.sha256,
        tableCount: tables.length,
        objectOrder: "name_binary",
        openedReadOnly: true,
        defensive: true,
        extensionsEnabled: false,
        authorizerPolicy: "schema_and_table_reads_only"
      },
      tables
    };
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("dataset.ingest.sqlite.invalid_database", "The SQLite source could not be inspected safely.");
  } finally {
    if (database?.isOpen) database.close();
  }
}

interface SqliteAuthorizerScope {
  readableTable: string | undefined;
  pragmaTable: string | undefined;
}

interface SqliteSchemaObject {
  readonly type: "table" | "view" | "trigger";
  readonly name: string;
  readonly tableName: string;
  readonly rootPage: number;
  readonly sql: string;
}

interface SqliteColumn {
  readonly cid: number;
  readonly name: string;
  readonly declaredType: string;
  readonly notNull: boolean;
  readonly hasDefault: boolean;
  readonly primaryKeyOrdinal: number;
  readonly hidden: number;
}

function authorizeSqliteRead(
  scope: SqliteAuthorizerScope,
  actionCode: number,
  arg1: string | null,
  arg2: string | null,
  dbName: string | null,
  triggerOrView: string | null
): number {
  if (actionCode === sqliteConstants.SQLITE_SELECT) return sqliteConstants.SQLITE_OK;
  if (actionCode === sqliteConstants.SQLITE_READ) {
    const allowedTable = arg1 === "sqlite_master" || arg1 === "pragma_table_xinfo" || arg1 === scope.readableTable;
    return dbName === "main" && triggerOrView === null && allowedTable
      ? sqliteConstants.SQLITE_OK
      : sqliteConstants.SQLITE_DENY;
  }
  if (actionCode === sqliteConstants.SQLITE_PRAGMA) {
    return arg1 === "table_xinfo" && arg2 === scope.pragmaTable
      ? sqliteConstants.SQLITE_OK
      : sqliteConstants.SQLITE_DENY;
  }
  return sqliteConstants.SQLITE_DENY;
}

function parseSqliteSchemaObject(row: readonly unknown[]): SqliteSchemaObject {
  if (row.length !== 5 || typeof row[0] !== "string" || typeof row[1] !== "string" ||
      typeof row[2] !== "string" || typeof row[4] !== "string" ||
      !["table", "view", "trigger"].includes(row[0])) {
    throw new PigeDomainError("dataset.ingest.sqlite.invalid_schema", "The SQLite source contains invalid schema metadata.");
  }
  return {
    type: row[0] as SqliteSchemaObject["type"],
    name: row[1],
    tableName: row[2],
    rootPage: sqliteSafeInteger(row[3], "dataset.ingest.sqlite.invalid_schema"),
    sql: row[4]
  };
}

function parseSqliteColumn(row: readonly unknown[]): SqliteColumn {
  if (row.length !== 7 || typeof row[1] !== "string" || !row[1] || typeof row[2] !== "string") {
    throw new PigeDomainError("dataset.ingest.sqlite.invalid_schema", "A SQLite table contains invalid column metadata.");
  }
  return {
    cid: sqliteSafeInteger(row[0], "dataset.ingest.sqlite.invalid_schema"),
    name: row[1],
    declaredType: row[2],
    notNull: sqliteSafeInteger(row[3], "dataset.ingest.sqlite.invalid_schema") !== 0,
    hasDefault: row[4] !== null,
    primaryKeyOrdinal: sqliteSafeInteger(row[5], "dataset.ingest.sqlite.invalid_schema"),
    hidden: sqliteSafeInteger(row[6], "dataset.ingest.sqlite.invalid_schema")
  };
}

function buildSqliteSelect(
  table: SqliteSchemaObject,
  columns: readonly SqliteColumn[],
  limit: number
): string {
  const columnSql = columns.map((column) => quoteSqliteIdentifier(column.name)).join(", ");
  const withoutRowid = /\bWITHOUT\s+ROWID\b/iu.test(table.sql);
  const names = new Set(columns.map((column) => column.name.toLocaleLowerCase("en-US")));
  let orderSql: string;
  if (!withoutRowid) {
    const rowidAlias = ["_rowid_", "rowid", "oid"].find((candidate) => !names.has(candidate));
    orderSql = rowidAlias ?? columns.map((column) => `${quoteSqliteIdentifier(column.name)} COLLATE BINARY`).join(", ");
  } else {
    const primaryKey = columns
      .filter((column) => column.primaryKeyOrdinal > 0)
      .sort((left, right) => left.primaryKeyOrdinal - right.primaryKeyOrdinal);
    if (primaryKey.length === 0) {
      throw new PigeDomainError("dataset.ingest.sqlite.invalid_without_rowid", "A WITHOUT ROWID table has no declared primary key.");
    }
    orderSql = primaryKey.map((column) => `${quoteSqliteIdentifier(column.name)} COLLATE BINARY`).join(", ");
  }
  return `SELECT ${columnSql} FROM main.${quoteSqliteIdentifier(table.name)} ORDER BY ${orderSql} LIMIT ${limit}`;
}

function quoteSqliteIdentifier(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function sqliteCell(
  columnOrdinal: number,
  value: unknown,
  limits: DatasetIngestLimits,
  budget: IngestBudget
): DatasetIngestCell {
  let cell: DatasetIngestCell;
  if (value === null) {
    cell = { columnOrdinal, state: "null", sourceType: "sqlite.null", projection: { kind: "null" } };
  } else if (typeof value === "bigint") {
    cell = {
      columnOrdinal,
      state: "value",
      sourceType: "sqlite.integer",
      projection: { kind: "integer", value: value.toString(10) }
    };
  } else if (typeof value === "number") {
    cell = {
      columnOrdinal,
      state: "value",
      sourceType: "sqlite.real",
      projection: { kind: "real", value }
    };
  } else if (typeof value === "string") {
    cell = {
      columnOrdinal,
      state: value.length === 0 ? "empty" : "value",
      sourceType: "sqlite.text",
      projection: { kind: "text", value }
    };
  } else if (value instanceof Uint8Array) {
    if (value.byteLength > limits.maxCellBytes) {
      throw limitError("cell_bytes", "A SQLite BLOB exceeds the configured cell byte limit.");
    }
    cell = {
      columnOrdinal,
      state: "value",
      sourceType: "sqlite.blob",
      projection: {
        kind: "blob",
        value: Buffer.from(value).toString("base64"),
        encoding: "base64",
        byteLength: value.byteLength
      }
    };
  } else {
    throw new PigeDomainError("dataset.ingest.sqlite.unsupported_value", "A SQLite cell contains an unsupported runtime value.");
  }
  budget.retainCell(cell, limits.maxCellBytes);
  return cell;
}

function expectSqliteRows(value: unknown): readonly (readonly unknown[])[] {
  if (!Array.isArray(value) || value.some((row) => !Array.isArray(row))) {
    throw new PigeDomainError("dataset.ingest.sqlite.invalid_result", "SQLite returned an invalid bounded result.");
  }
  return value as readonly (readonly unknown[])[];
}

function sqliteSafeInteger(value: unknown, code: string): number {
  if (typeof value === "bigint" && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  throw new PigeDomainError(code, "SQLite returned invalid integer metadata.");
}
