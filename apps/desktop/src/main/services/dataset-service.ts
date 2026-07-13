import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { PigeDomainError } from "@pige/domain";
import {
  DatasetManifestSchema,
  DatasetRevisionSchema,
  DatasetSchemaRecordSchema,
  OperationRecordSchema,
  SourceRecordSchema,
  type DatasetLogicalType,
  type DatasetManifest,
  type DatasetRevision,
  type DatasetSchemaRecord,
  type DatasetTable,
  type JobRecord,
  type OperationRecord,
  type SourceKind,
  type SourceRecord
} from "@pige/schemas";
import type { JobExecutionControl } from "./job-execution-control";
import { SourcePageService } from "./source-page-service";
import { createVerifiedSourceFileSnapshotAsync } from "./source-file-access";
import {
  DATASET_INGEST_PLANNER_ID,
  DATASET_INGEST_PLANNER_VERSION,
  DATASET_INGEST_DEFAULT_LIMITS,
  type DatasetCellProjection,
  type DatasetIngestPlan,
  type DatasetIngestSourceKind
} from "./dataset-ingest-types";

export interface DatasetImportPlanner {
  isAvailable?(): boolean;
  plan(filePath: string, sourceKind: DatasetIngestSourceKind, signal?: AbortSignal): Promise<DatasetIngestPlan>;
}

export interface DatasetMaterializationResult {
  readonly sourceRecord: SourceRecord;
  readonly created: boolean;
  readonly datasetId: string;
  readonly revisionId: string;
  readonly tableCount: number;
  readonly rowCount: number;
  readonly warnings: readonly string[];
  readonly operationIds: readonly string[];
}

export interface DatasetMaterializerPort {
  canMaterialize(sourceKind: SourceKind): boolean;
  materializeSource(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord,
    control?: JobExecutionControl
  ): Promise<DatasetMaterializationResult>;
}

const DATASET_WRITER_ID = "pige.managed-collection";
const DATASET_WRITER_VERSION = "1";
const DATASET_SCHEMA_VERSION = 1;
const DATASET_SOURCE_KINDS = new Set<SourceKind>(["csv_file", "xlsx_file", "sqlite_file"]);
const DATASET_PROJECTED_TYPES = new Set([
  "unknown",
  "null",
  "text",
  "boolean",
  "integer",
  "real",
  "date",
  "datetime",
  "xlsx_date_serial",
  "blob"
]);

export class DatasetService implements DatasetMaterializerPort {
  readonly #planner: DatasetImportPlanner;
  readonly #sourcePages: SourcePageService;

  constructor(planner: DatasetImportPlanner, sourcePages = new SourcePageService()) {
    this.#planner = planner;
    this.#sourcePages = sourcePages;
  }

  canMaterialize(sourceKind: SourceKind): boolean {
    return DATASET_SOURCE_KINDS.has(sourceKind) && this.#planner.isAvailable?.() !== false;
  }

  async materializeSource(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord,
    control?: JobExecutionControl
  ): Promise<DatasetMaterializationResult> {
    control?.throwIfCancellationRequested();
    const parsedSource = SourceRecordSchema.parse(sourceRecord);
    if (!isDatasetSourceKind(parsedSource.kind)) {
      throw new PigeDomainError("dataset.import.unsupported", "The Dataset Service cannot process this source kind.");
    }
    ensureConfinedDirectory(vaultPath, "datasets", true);
    ensureConfinedDirectory(vaultPath, ".pige/cache/dataset-staging", true);
    ensureConfinedDirectory(vaultPath, ".pige/operations", true);
    if (
      parsedSource.kind === "sqlite_file" &&
      Array.isArray(parsedSource.metadata.sqliteLiveSidecars) &&
      parsedSource.metadata.sqliteLiveSidecars.length > 0
    ) {
      throw new PigeDomainError(
        "dataset.ingest.sqlite.live_sidecars_not_supported",
        "The preserved SQLite source had live journal or WAL sidecars and cannot be imported losslessly."
      );
    }
    const sourceRecordHash = createDatasetSourceRecordHash(parsedSource);
    const absoluteSourceRecordPath = path.isAbsolute(sourceRecordPath)
      ? sourceRecordPath
      : resolveVaultRelativePath(vaultPath, sourceRecordPath);
    const sourceAssetChecksum = parsedSource.managedCopy?.checksum ?? parsedSource.original?.checksum;
    const sourceAssetSize = parsedSource.managedCopy?.size ?? parsedSource.original?.lastKnownSize;
    if (!sourceAssetChecksum || sourceAssetSize === undefined) {
      throw new PigeDomainError("dataset.import.invalid", "The structured source has no verified durable file binding.");
    }
    const identities = createDatasetIdentities(parsedSource, sourceRecordHash, sourceAssetChecksum);
    const existing = this.#readExisting(
      vaultPath,
      parsedSource,
      sourceRecordPath,
      job,
      identities,
      sourceRecordHash,
      sourceAssetChecksum,
      sourceAssetSize
    );
    if (existing) return existing;

    const sourceSnapshot = await createVerifiedSourceFileSnapshotAsync(vaultPath, parsedSource);
    let plan: DatasetIngestPlan;
    try {
      plan = await this.#planner.plan(sourceSnapshot.absolutePath, parsedSource.kind, control?.signal);
    } finally {
      await sourceSnapshot.dispose();
    }
    control?.throwIfCancellationRequested();
    validatePlan(plan, parsedSource.kind, sourceAssetChecksum, sourceAssetSize);
    assertCurrentSourceRecord(absoluteSourceRecordPath, parsedSource, sourceRecordHash);

    const now = new Date().toISOString();
    const tableBindings = createTableBindings(identities.datasetId, plan);
    const bundleRelativePath = ["datasets", `${datasetSlug(parsedSource)}--${identities.datasetId}`].join("/");
    const revisionRelativePath = ["revisions", `${identities.revisionId}.json`].join("/");
    const schemaRelativePath = ["schemas", `${identities.revisionId}.json`].join("/");
    const payloadRelativePath = "data/collection.sqlite";
    const operationId = createDatasetOperationId(job.id, identities.revisionId);
    const stagingRoot = resolveVaultRelativePath(
      vaultPath,
      [".pige", "cache", "dataset-staging", `${identities.revisionId}.${randomUUID()}`].join("/")
    );
    const stagingBundle = path.join(stagingRoot, path.basename(bundleRelativePath));
    fs.mkdirSync(path.join(stagingBundle, "schemas"), { recursive: true });
    fs.mkdirSync(path.join(stagingBundle, "revisions"), { recursive: true });
    fs.mkdirSync(path.join(stagingBundle, "data"), { recursive: true });

    try {
      const payloadPath = path.join(stagingBundle, ...payloadRelativePath.split("/"));
      await writeManagedCollection(
        payloadPath,
        identities.datasetId,
        identities.revisionId,
        tableBindings,
        plan,
        () => control?.throwIfCancellationRequested()
      );
      const schemaRecord = DatasetSchemaRecordSchema.parse({
        schemaVersion: DATASET_SCHEMA_VERSION,
        datasetId: identities.datasetId,
        revisionId: identities.revisionId,
        tables: tableBindings.map(({ table }) => table),
        createdAt: now
      });
      writeJsonAtomic(path.join(stagingBundle, ...schemaRelativePath.split("/")), schemaRecord);
      const schemaRef = fileRef(stagingBundle, schemaRelativePath);
      const payloadRef = { ...fileRef(stagingBundle, payloadRelativePath), format: "sqlite" as const };
      const revisionRecord = DatasetRevisionSchema.parse({
        schemaVersion: DATASET_SCHEMA_VERSION,
        id: identities.revisionId,
        datasetId: identities.datasetId,
        parentRevisionId: null,
        source: {
          sourceId: parsedSource.id,
          sourceKind: parsedSource.kind,
          sourceRecordHash,
          sourceAssetChecksum,
          sourceAssetSize
        },
        schema: schemaRef,
        payload: payloadRef,
        adapter: { id: plan.planner.id, version: plan.planner.version },
        writer: { id: DATASET_WRITER_ID, version: DATASET_WRITER_VERSION },
        stats: plan.stats,
        warnings: plan.warnings.map((warning) => warning.code).slice(0, 64),
        operationId,
        createdAt: now
      });
      writeJsonAtomic(path.join(stagingBundle, ...revisionRelativePath.split("/")), revisionRecord);
      const revisionRef = fileRef(stagingBundle, revisionRelativePath);
      const manifest = DatasetManifestSchema.parse({
        format: "pige-dataset",
        formatVersion: DATASET_SCHEMA_VERSION,
        datasetId: identities.datasetId,
        profile: "managed_collection",
        title: datasetTitle(parsedSource),
        sourceId: parsedSource.id,
        activeRevision: identities.revisionId,
        revision: revisionRef,
        schema: schemaRef,
        payload: payloadRef,
        compatibility: { minReaderFormatVersion: 1, maxReaderFormatVersion: 1 },
        createdAt: now,
        updatedAt: now
      });
      writeJsonAtomic(path.join(stagingBundle, "dataset.json"), manifest);
      syncBundle(stagingBundle);
      control?.throwIfCancellationRequested();
      assertCurrentSourceRecord(absoluteSourceRecordPath, parsedSource, sourceRecordHash);
      control?.markDurableCheckpoint("dataset_bundle_publication_started");
      publishBundle(vaultPath, bundleRelativePath, stagingBundle, manifest);
    } finally {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }

    const bundle = readDatasetBundle(vaultPath, bundleRelativePath);
    assertBundleBinding(bundle, identities, parsedSource, sourceRecordHash, sourceAssetChecksum, sourceAssetSize);
    const operation = writeDatasetOperation(vaultPath, job, bundleRelativePath, bundle, tableBindings, plan);
    const updatedSource = bindDatasetToSource(
      parsedSource,
      identities,
      bundleRelativePath,
      plan,
      operation.id,
      now
    );
    this.#sourcePages.refreshForSource(vaultPath, updatedSource, sourceRecordPath, job.id, parsedSource);
    return toMaterializationResult(updatedSource, bundle, plan, operation, true);
  }

  #readExisting(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord,
    identities: DatasetIdentities,
    sourceRecordHash: string,
    sourceAssetChecksum: string,
    sourceAssetSize: number
  ): DatasetMaterializationResult | undefined {
    const bundleRelativePath = ["datasets", `${datasetSlug(sourceRecord)}--${identities.datasetId}`].join("/");
    const manifestPath = resolveVaultRelativePath(vaultPath, `${bundleRelativePath}/dataset.json`);
    if (!fs.existsSync(manifestPath)) return undefined;
    const bundle = readDatasetBundle(vaultPath, bundleRelativePath);
    assertBundleBinding(bundle, identities, sourceRecord, sourceRecordHash, sourceAssetChecksum, sourceAssetSize);
    const plan = readPlanSummaryFromPayload(vaultPath, bundleRelativePath, bundle);
    const tableBindings = bundle.schema.tables.map((table) => ({ table }));
    const operation = writeDatasetOperation(vaultPath, job, bundleRelativePath, bundle, tableBindings, plan);
    const unchangedTimestampSource = bindDatasetToSource(
      sourceRecord,
      identities,
      bundleRelativePath,
      plan,
      operation.id,
      sourceRecord.updatedAt
    );
    const updatedSource = hashCanonical(unchangedTimestampSource) === hashCanonical(sourceRecord)
      ? sourceRecord
      : bindDatasetToSource(
        sourceRecord,
        identities,
        bundleRelativePath,
        plan,
        operation.id,
        new Date().toISOString()
      );
    if (hashCanonical(updatedSource) !== hashCanonical(sourceRecord)) {
      this.#sourcePages.refreshForSource(vaultPath, updatedSource, sourceRecordPath, job.id, sourceRecord);
    }
    return toMaterializationResult(updatedSource, bundle, plan, operation, false);
  }
}

interface DatasetIdentities {
  readonly datasetId: string;
  readonly revisionId: string;
}

interface DatasetBundleRecords {
  readonly manifest: DatasetManifest;
  readonly revision: DatasetRevision;
  readonly schema: DatasetSchemaRecord;
}

interface DatasetTableBinding {
  readonly table: DatasetTable;
  readonly rowIds?: readonly string[];
}

function createDatasetIdentities(
  sourceRecord: SourceRecord,
  sourceRecordHash: string,
  sourceAssetChecksum: string
): DatasetIdentities {
  const dateKey = /^src_(\d{8})_/u.exec(sourceRecord.id)?.[1] ??
    sourceRecord.createdAt.slice(0, 10).replaceAll("-", "");
  const datasetSuffix = digest("pige:dataset:v1", sourceRecord.id).slice(0, 16);
  const revisionSuffix = digest(
    "pige:dataset-revision:v1",
    sourceRecord.id,
    sourceRecordHash,
    sourceAssetChecksum,
    `${DATASET_INGEST_PLANNER_ID}@${DATASET_INGEST_PLANNER_VERSION}`,
    `${DATASET_WRITER_ID}@${DATASET_WRITER_VERSION}`
  ).slice(0, 16);
  return {
    datasetId: `dataset_${dateKey}_${datasetSuffix}`,
    revisionId: `dataset_rev_${dateKey}_${revisionSuffix}`
  };
}

function createTableBindings(datasetId: string, plan: DatasetIngestPlan): readonly DatasetTableBinding[] {
  return plan.tables.map((table) => {
    const tableId = `table_${digest("pige:dataset-table:v1", datasetId, table.sourceLocator, String(table.ordinal)).slice(0, 16)}`;
    const columns = table.columns.map((column) => ({
      id: `column_${digest("pige:dataset-column:v1", tableId, String(column.ordinal)).slice(0, 16)}`,
      name: column.suggestedName,
      ...(column.sourceName !== undefined ? { sourceName: column.sourceName } : {}),
      ordinal: column.ordinal,
      sourceType: (column.sourceTypes.join("|") || "unknown").slice(0, 160),
      sourceTypes: column.sourceTypes,
      ...(column.sourceMetadata ? { sourceMetadata: column.sourceMetadata } : {}),
      logicalType: toLogicalType(column.projectedType),
      nullable: column.stats.missing > 0 || column.stats.null > 0,
      stats: column.stats
    }));
    return {
      table: DatasetSchemaRecordSchema.shape.tables.element.parse({
        id: tableId,
        name: table.sourceName,
        sourceLocator: table.sourceLocator,
        sourceMetadata: table.sourceMetadata,
        header: {
          mode: table.header.mode,
          used: table.header.used,
          ...(table.header.sourceRow ? { sourceRow: table.header.sourceRow.sourceRow } : {})
        },
        ordinal: table.ordinal,
        rowCount: table.rows.length,
        columnCount: columns.length,
        columns
      }),
      rowIds: table.rows.map((row) =>
        `row_${digest("pige:dataset-row:v1", tableId, String(row.sourceRow), String(row.ordinal)).slice(0, 16)}`
      )
    };
  });
}

async function writeManagedCollection(
  filePath: string,
  datasetId: string,
  revisionId: string,
  bindings: readonly DatasetTableBinding[],
  plan: DatasetIngestPlan,
  throwIfCancellationRequested: () => void
): Promise<void> {
  const database = new DatabaseSync(filePath);
  try {
    database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    database.exec(`
      CREATE TABLE pige_dataset_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE pige_dataset_tables (
        table_id TEXT PRIMARY KEY,
        ordinal INTEGER NOT NULL,
        source_name TEXT NOT NULL,
        source_locator TEXT NOT NULL,
        source_metadata_json TEXT NOT NULL,
        header_json TEXT NOT NULL,
        row_count INTEGER NOT NULL,
        column_count INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE pige_dataset_columns (
        column_id TEXT PRIMARY KEY,
        table_id TEXT NOT NULL REFERENCES pige_dataset_tables(table_id),
        ordinal INTEGER NOT NULL,
        name TEXT NOT NULL,
        projected_type TEXT NOT NULL,
        source_types_json TEXT NOT NULL,
        stats_json TEXT NOT NULL,
        UNIQUE(table_id, ordinal)
      ) STRICT;
      CREATE TABLE pige_dataset_rows (
        row_id TEXT PRIMARY KEY,
        table_id TEXT NOT NULL REFERENCES pige_dataset_tables(table_id),
        ordinal INTEGER NOT NULL,
        source_row INTEGER NOT NULL,
        UNIQUE(table_id, ordinal)
      ) STRICT;
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
      ) STRICT;
    `);
    database.exec("BEGIN IMMEDIATE");
    try {
      const insertMeta = database.prepare("INSERT INTO pige_dataset_meta (key, value) VALUES (?, ?)");
      insertMeta.run("format", "pige-managed-collection-v1");
      insertMeta.run("dataset_id", datasetId);
      insertMeta.run("revision_id", revisionId);
      insertMeta.run("source_sha256", plan.source.sha256);
      insertMeta.run("planner", `${plan.planner.id}@${plan.planner.version}`);
      const insertTable = database.prepare("INSERT INTO pige_dataset_tables VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      const insertColumn = database.prepare("INSERT INTO pige_dataset_columns VALUES (?, ?, ?, ?, ?, ?, ?)");
      const insertRow = database.prepare("INSERT INTO pige_dataset_rows VALUES (?, ?, ?, ?)");
      const insertCell = database.prepare("INSERT INTO pige_dataset_cells VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      let insertedCells = 0;
      for (const [tableIndex, tablePlan] of plan.tables.entries()) {
        throwIfCancellationRequested();
        const binding = bindings[tableIndex];
        if (!binding) throw new PigeDomainError("dataset.import.invalid", "Dataset table binding is incomplete.");
        insertTable.run(
          binding.table.id,
          binding.table.ordinal,
          tablePlan.sourceName,
          tablePlan.sourceLocator,
          JSON.stringify(tablePlan.sourceMetadata),
          JSON.stringify({
            mode: tablePlan.header.mode,
            used: tablePlan.header.used,
            ...(tablePlan.header.sourceRow ? { sourceRow: tablePlan.header.sourceRow.sourceRow } : {})
          }),
          tablePlan.rows.length,
          tablePlan.columns.length
        );
        for (const [columnIndex, columnPlan] of tablePlan.columns.entries()) {
          const column = binding.table.columns[columnIndex];
          if (!column) throw new PigeDomainError("dataset.import.invalid", "Dataset column binding is incomplete.");
          insertColumn.run(
            column.id,
            binding.table.id,
            column.ordinal,
            column.name,
            columnPlan.projectedType,
            JSON.stringify(columnPlan.sourceTypes),
            JSON.stringify(columnPlan.stats)
          );
        }
        for (const [rowIndex, rowPlan] of tablePlan.rows.entries()) {
          const rowId = binding.rowIds?.[rowIndex];
          if (!rowId) throw new PigeDomainError("dataset.import.invalid", "Dataset row binding is incomplete.");
          insertRow.run(rowId, binding.table.id, rowPlan.ordinal, rowPlan.sourceRow);
          for (const cell of rowPlan.cells) {
            const column = binding.table.columns.find((candidate) => candidate.ordinal === cell.columnOrdinal);
            if (!column) throw new PigeDomainError("dataset.import.invalid", "Dataset cell references an unknown column.");
            insertCell.run(
              rowId,
              column.id,
              cell.state,
              cell.sourceType,
              cell.lexical?.raw ?? null,
              cell.lexical?.text ?? null,
              cell.lexical?.quoted === undefined ? null : cell.lexical.quoted ? 1 : 0,
              cell.projection.kind,
              projectionJson(cell.projection),
              cell.formula ? JSON.stringify(cell.formula) : null,
              cell.sourceStyle ? JSON.stringify(cell.sourceStyle) : null
            );
            insertedCells += 1;
            if (insertedCells % 1000 === 0) {
              throwIfCancellationRequested();
              await yieldToEventLoop();
            }
          }
        }
      }
      database.exec("COMMIT");
    } catch (caught) {
      database.exec("ROLLBACK");
      throw caught;
    }
    const integrity = database.prepare("PRAGMA integrity_check").get() as { integrity_check?: unknown } | undefined;
    if (integrity?.integrity_check !== "ok") {
      throw new PigeDomainError("dataset.import.invalid", "The managed Dataset payload failed SQLite integrity validation.");
    }
  } finally {
    database.close();
  }
  syncFile(filePath);
}

function projectionJson(projection: DatasetCellProjection): string | null {
  return projection.kind === "unknown" || projection.kind === "null"
    ? null
    : JSON.stringify(projection);
}

function toLogicalType(projectedType: DatasetIngestPlan["tables"][number]["columns"][number]["projectedType"]): DatasetLogicalType {
  if (projectedType === "integer") return "integer";
  if (projectedType === "real") return "number";
  if (projectedType === "boolean") return "boolean";
  if (projectedType === "date" || projectedType === "xlsx_date_serial") return "date";
  if (projectedType === "datetime") return "datetime";
  if (projectedType === "blob") return "binary";
  if (projectedType === "text") return "string";
  return "unknown";
}

function validatePlan(
  plan: DatasetIngestPlan,
  sourceKind: DatasetIngestSourceKind,
  expectedChecksum: string,
  expectedSize: number
): void {
  const limits = Object.entries(plan.limits) as readonly [keyof typeof plan.limits, number][];
  if (
    plan.schemaVersion !== 1 ||
    plan.planner.id !== DATASET_INGEST_PLANNER_ID ||
    plan.planner.version !== DATASET_INGEST_PLANNER_VERSION ||
    plan.source.kind !== sourceKind ||
    `sha256:${plan.source.sha256}` !== expectedChecksum ||
    plan.source.byteLength !== expectedSize ||
    plan.target.profile !== "managed_collection" ||
    plan.target.owner !== "dataset_service" ||
    plan.target.sourceDisposition !== "preserve_as_evidence" ||
    limits.some(([name, value]) =>
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > DATASET_INGEST_DEFAULT_LIMITS[name]
    ) ||
    plan.tables.length === 0 ||
    plan.tables.length > plan.limits.maxTables ||
    plan.stats.tableCount !== plan.tables.length ||
    !isBoundedCount(plan.stats.rowCount, plan.limits.maxRows) ||
    !isBoundedCount(plan.stats.columnCount, plan.limits.maxTables * plan.limits.maxColumns) ||
    !isBoundedCount(plan.stats.cellCount, plan.limits.maxCells) ||
    !isBoundedCount(plan.stats.retainedValueBytes, plan.limits.maxPlanValueBytes) ||
    plan.stats.rowCount !== plan.tables.reduce((sum, table) => sum + table.rows.length, 0) ||
    plan.stats.columnCount !== plan.tables.reduce((sum, table) => sum + table.columns.length, 0) ||
    plan.stats.cellCount !== plan.tables.reduce(
      (sum, table) => sum + table.rows.reduce((rowSum, row) => rowSum + row.cells.length, 0),
      0
    )
  ) {
    throw new PigeDomainError("dataset.import.invalid", "The Dataset planner returned an invalid or mismatched plan.");
  }
  if (
    (plan.source.kind === "csv_file" && plan.tables.length !== 1) ||
    (plan.source.kind === "xlsx_file" && plan.source.sheetCount !== plan.tables.length) ||
    (plan.source.kind === "sqlite_file" && plan.source.tableCount !== plan.tables.length) ||
    !/^[a-f0-9]{64}$/u.test(plan.source.sha256) ||
    !Number.isSafeInteger(plan.source.byteLength) ||
    plan.source.byteLength < 0 ||
    plan.source.byteLength > plan.limits.maxSourceBytes ||
    plan.warnings.length > 64
  ) {
    throw new PigeDomainError("dataset.import.invalid", "The Dataset planner returned invalid source metadata.");
  }
  const tableOrdinals = new Set(plan.tables.map((table) => table.ordinal));
  if (tableOrdinals.size !== plan.tables.length) {
    throw new PigeDomainError("dataset.import.invalid", "The Dataset planner returned duplicate table ordinals.");
  }
  for (const table of plan.tables) {
    const columnOrdinals = new Set(table.columns.map((column) => column.ordinal));
    const rowOrdinals = new Set(table.rows.map((row) => row.ordinal));
    if (
      !Number.isSafeInteger(table.ordinal) ||
      table.ordinal < 0 ||
      !isBoundedText(table.sourceName, 512, true) ||
      !isBoundedText(table.sourceLocator, 1000, true) ||
      columnOrdinals.size !== table.columns.length ||
      rowOrdinals.size !== table.rows.length ||
      table.columns.length === 0 ||
      table.columns.length > plan.limits.maxColumns ||
      table.rows.length > plan.limits.maxRows ||
      !isBoundedMetadata(table.sourceMetadata) ||
      !["auto", "present", "absent"].includes(table.header.mode) ||
      typeof table.header.used !== "boolean" ||
      table.header.used !== Boolean(table.header.sourceRow) ||
      (table.header.sourceRow !== undefined &&
        !isValidDatasetRow(table.header.sourceRow, columnOrdinals, table.columns.length, plan.limits.maxCellBytes)) ||
      table.columns.some((column) =>
        !Number.isSafeInteger(column.ordinal) ||
        column.ordinal < 0 ||
        !isBoundedText(column.suggestedName, 512, true) ||
        (column.sourceName !== undefined && !isBoundedText(column.sourceName, 512, false)) ||
        !DATASET_PROJECTED_TYPES.has(column.projectedType) ||
        column.sourceTypes.length > 64 ||
        column.sourceTypes.some((sourceType) => !isBoundedText(sourceType, 160, true)) ||
        (column.sourceMetadata !== undefined && !isBoundedMetadata(column.sourceMetadata)) ||
        !Object.values(column.stats).every((value) => isBoundedCount(value, table.rows.length)) ||
        !hasExactColumnStats(table.rows, column.ordinal, column.stats)
      ) ||
      table.rows.some((row) =>
        !isValidDatasetRow(row, columnOrdinals, table.columns.length, plan.limits.maxCellBytes)
      )
    ) {
      throw new PigeDomainError("dataset.import.invalid", "The Dataset planner returned inconsistent row or column identities.");
    }
  }
  if (plan.warnings.some((warning) =>
    !isBoundedText(warning.code, 160, true) ||
    !isBoundedText(warning.message, 1000, true) ||
    (warning.tableOrdinal !== undefined && !tableOrdinals.has(warning.tableOrdinal)) ||
    (warning.sourceRow !== undefined && (!Number.isSafeInteger(warning.sourceRow) || warning.sourceRow <= 0)) ||
    (warning.columnOrdinal !== undefined && (!Number.isSafeInteger(warning.columnOrdinal) || warning.columnOrdinal <= 0))
  )) {
    throw new PigeDomainError("dataset.import.invalid", "The Dataset planner returned invalid warning metadata.");
  }
}

function isValidDatasetRow(
  row: DatasetIngestPlan["tables"][number]["rows"][number],
  columnOrdinals: ReadonlySet<number>,
  columnCount: number,
  maximumCellBytes: number
): boolean {
  return Number.isSafeInteger(row.ordinal) &&
    row.ordinal >= 0 &&
    Number.isSafeInteger(row.sourceRow) &&
    row.sourceRow > 0 &&
    row.cells.length === columnCount &&
    new Set(row.cells.map((cell) => cell.columnOrdinal)).size === row.cells.length &&
    row.cells.every((cell) =>
      columnOrdinals.has(cell.columnOrdinal) && isValidDatasetCell(cell, maximumCellBytes)
    );
}

function hasExactColumnStats(
  rows: readonly DatasetIngestPlan["tables"][number]["rows"][number][],
  columnOrdinal: number,
  actual: DatasetIngestPlan["tables"][number]["columns"][number]["stats"]
): boolean {
  const expected = { missing: 0, empty: 0, null: 0, value: 0 };
  for (const row of rows) {
    const cell = row.cells.find((candidate) => candidate.columnOrdinal === columnOrdinal);
    if (!cell) return false;
    expected[cell.state] += 1;
  }
  return hashCanonical(actual) === hashCanonical(expected);
}

function isValidDatasetCell(
  cell: DatasetIngestPlan["tables"][number]["rows"][number]["cells"][number],
  maximumBytes: number
): boolean {
  if (
    !Number.isSafeInteger(cell.columnOrdinal) ||
    cell.columnOrdinal < 0 ||
    !["missing", "empty", "null", "value"].includes(cell.state) ||
    !isBoundedText(cell.sourceType, 160, true) ||
    (cell.lexical !== undefined && (
      !isBoundedText(cell.lexical.raw, maximumBytes, false) ||
      !isBoundedText(cell.lexical.text, maximumBytes, false) ||
      (cell.lexical.quoted !== undefined && typeof cell.lexical.quoted !== "boolean")
    ))
  ) return false;
  const projection = cell.projection as unknown;
  if (!projection || typeof projection !== "object" || !("kind" in projection)) return false;
  const runtimeProjection = projection as Record<string, unknown>;
  switch (runtimeProjection.kind) {
    case "unknown":
    case "null":
      if (cell.state === "value") return false;
      break;
    case "boolean":
      if (typeof runtimeProjection.value !== "boolean") return false;
      break;
    case "real":
      if (typeof runtimeProjection.value !== "number" || !Number.isFinite(runtimeProjection.value)) return false;
      break;
    case "blob":
      if (
        runtimeProjection.encoding !== "base64" ||
        !Number.isSafeInteger(runtimeProjection.byteLength) ||
        Number(runtimeProjection.byteLength) < 0 ||
        Number(runtimeProjection.byteLength) > maximumBytes ||
        !isBoundedText(runtimeProjection.value, Math.ceil(maximumBytes * 4 / 3) + 8, false)
      ) return false;
      break;
    case "xlsx_date_serial":
      if (
        !isBoundedText(runtimeProjection.value, maximumBytes, false) ||
        (runtimeProjection.dateSystem !== "1900" && runtimeProjection.dateSystem !== "1904")
      ) return false;
      break;
    case "integer":
    case "text":
    case "date":
    case "datetime":
      if (!isBoundedText(runtimeProjection.value, maximumBytes, false)) return false;
      break;
    default:
      return false;
  }
  if (cell.formula && (
    !["normal", "shared", "array", "data_table"].includes(cell.formula.kind) ||
    !isBoundedText(cell.formula.text, maximumBytes, false) ||
    (cell.formula.sharedIndex !== undefined && !isBoundedText(cell.formula.sharedIndex, 80, false)) ||
    (cell.formula.reference !== undefined && !isBoundedText(cell.formula.reference, 160, false)) ||
    typeof cell.formula.hasCachedValue !== "boolean"
  )) return false;
  return !cell.sourceStyle || (
    Number.isSafeInteger(cell.sourceStyle.index) &&
    cell.sourceStyle.index >= 0 &&
    (cell.sourceStyle.numberFormatId === undefined || (
      Number.isSafeInteger(cell.sourceStyle.numberFormatId) && cell.sourceStyle.numberFormatId >= 0
    )) &&
    (cell.sourceStyle.numberFormatCode === undefined ||
      isBoundedText(cell.sourceStyle.numberFormatCode, maximumBytes, false))
  );
}

function isBoundedMetadata(value: Readonly<Record<string, string | number | boolean>>): boolean {
  const entries = Object.entries(value);
  return entries.length <= 64 && entries.every(([key, item]) =>
    isBoundedText(key, 120, true) &&
    (typeof item === "string" ? isBoundedText(item, 4096, false) :
      typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item)))
  );
}

function isBoundedText(value: unknown, maximumBytes: number, requireNonEmpty: boolean): value is string {
  return typeof value === "string" &&
    (!requireNonEmpty || value.length > 0) &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/[\u0000]/u.test(value);
}

function isBoundedCount(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

function readDatasetBundle(vaultPath: string, bundleRelativePath: string): DatasetBundleRecords {
  const bundlePath = ensureConfinedDirectory(vaultPath, bundleRelativePath, false);
  const manifest = DatasetManifestSchema.parse(readJson(path.join(bundlePath, "dataset.json")));
  const revision = DatasetRevisionSchema.parse(readJson(resolveBundleRelativePath(bundlePath, manifest.revision.path)));
  const schema = DatasetSchemaRecordSchema.parse(readJson(resolveBundleRelativePath(bundlePath, manifest.schema.path)));
  assertFileRef(bundlePath, manifest.revision);
  assertFileRef(bundlePath, manifest.schema);
  assertFileRef(bundlePath, manifest.payload);
  assertFileRef(bundlePath, revision.schema);
  assertFileRef(bundlePath, revision.payload);
  return { manifest, revision, schema };
}

function assertBundleBinding(
  bundle: DatasetBundleRecords,
  identities: DatasetIdentities,
  sourceRecord: SourceRecord,
  sourceRecordHash: string,
  sourceAssetChecksum: string,
  sourceAssetSize: number
): void {
  if (
    bundle.manifest.datasetId !== identities.datasetId ||
    bundle.manifest.activeRevision !== identities.revisionId ||
    bundle.manifest.sourceId !== sourceRecord.id ||
    bundle.revision.id !== identities.revisionId ||
    bundle.revision.datasetId !== identities.datasetId ||
    bundle.revision.source.sourceId !== sourceRecord.id ||
    bundle.revision.source.sourceKind !== sourceRecord.kind ||
    bundle.revision.source.sourceRecordHash !== sourceRecordHash ||
    bundle.revision.source.sourceAssetChecksum !== sourceAssetChecksum ||
    bundle.revision.source.sourceAssetSize !== sourceAssetSize ||
    hashCanonical(bundle.revision.schema) !== hashCanonical(bundle.manifest.schema) ||
    hashCanonical(bundle.revision.payload) !== hashCanonical(bundle.manifest.payload) ||
    bundle.schema.datasetId !== identities.datasetId ||
    bundle.schema.revisionId !== identities.revisionId
  ) {
    throw new PigeDomainError("dataset.import.source_changed", "The durable Dataset Bundle conflicts with the current source binding.");
  }
}

function writeDatasetOperation(
  vaultPath: string,
  job: JobRecord,
  bundleRelativePath: string,
  bundle: DatasetBundleRecords,
  tableBindings: readonly DatasetTableBinding[],
  plan: Pick<DatasetIngestPlan, "warnings">
): OperationRecord {
  const operationId = bundle.revision.operationId;
  const dateKey = /^op_(\d{8})_/u.exec(operationId)?.[1];
  if (!dateKey) throw new PigeDomainError("dataset.operation_id_invalid", "The Dataset Operation ID is invalid.");
  const operationRelativePath = [
    ".pige",
    "operations",
    dateKey.slice(0, 4),
    dateKey.slice(4, 6),
    `${operationId}.json`
  ].join("/");
  const operationPath = resolveVaultRelativePath(vaultPath, operationRelativePath);
  ensureConfinedDirectory(vaultPath, path.posix.dirname(operationRelativePath), true);
  const revisionPath = `${bundleRelativePath}/${bundle.manifest.revision.path}`;
  const revisionChecksum = bundle.manifest.revision.checksum;
  const expected = OperationRecordSchema.parse({
    id: operationId,
    schemaVersion: 1,
    jobId: job.id,
    createdAt: bundle.revision.createdAt,
    actor: { kind: "system", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    permissionDecisionIds: [],
    ...(job.policyContextId && job.policyHash ? {
      policyAudit: {
        policyContextId: job.policyContextId,
        policyHash: job.policyHash,
        enforcementOwners: ["DatasetService", "JobsService"]
      }
    } : {}),
    kind: "create_dataset_revision",
    targetRefs: [
      { kind: "dataset", id: bundle.manifest.datasetId, path: bundleRelativePath },
      {
        kind: "dataset_revision",
        id: bundle.revision.id,
        path: revisionPath,
        checksum: revisionChecksum
      },
      ...tableBindings.map(({ table }) => ({ kind: "table" as const, id: table.id }))
    ],
    sourceRefs: [
      { kind: "job", id: job.id },
      { kind: "source", id: bundle.revision.source.sourceId, checksum: bundle.revision.source.sourceAssetChecksum }
    ],
    after: {
      kind: "dataset_revision",
      id: bundle.revision.id,
      path: revisionPath,
      checksum: revisionChecksum
    },
    summary: `Created validated Dataset revision ${bundle.revision.id} from preserved source ${bundle.revision.source.sourceId}.`,
    reversible: "yes",
    rollbackHint: "Trash the Dataset Bundle through the Dataset lifecycle without deleting the preserved source evidence.",
    warnings: plan.warnings.map((warning) => warning.code).slice(0, 64)
  });
  if (fs.existsSync(operationPath)) {
    const existing = OperationRecordSchema.parse(readJson(operationPath));
    assertExistingDatasetOperation(existing, expected, bundle);
    return existing;
  }
  writeJsonCreateExclusive(operationPath, expected);
  return OperationRecordSchema.parse(readJson(operationPath));
}

function assertExistingDatasetOperation(
  existing: OperationRecord,
  expected: OperationRecord,
  bundle: DatasetBundleRecords
): void {
  const expectedSourceRefs = [
    { kind: "job", id: existing.jobId },
    { kind: "source", id: bundle.revision.source.sourceId, checksum: bundle.revision.source.sourceAssetChecksum }
  ];
  if (
    existing.id !== expected.id ||
    existing.kind !== "create_dataset_revision" ||
    existing.createdAt !== bundle.revision.createdAt ||
    hashCanonical(existing.actor) !== hashCanonical(expected.actor) ||
    existing.permissionDecisionIds.length !== 0 ||
    hashCanonical(existing.targetRefs) !== hashCanonical(expected.targetRefs) ||
    hashCanonical(existing.sourceRefs) !== hashCanonical(expectedSourceRefs) ||
    hashCanonical(existing.after) !== hashCanonical(expected.after) ||
    existing.before !== undefined ||
    existing.summary !== expected.summary ||
    existing.reversible !== expected.reversible ||
    existing.rollbackHint !== expected.rollbackHint ||
    hashCanonical(existing.warnings) !== hashCanonical(expected.warnings)
  ) {
    throw new PigeDomainError("dataset.operation_conflict", "The deterministic Dataset Operation identity conflicts.");
  }
}

function bindDatasetToSource(
  sourceRecord: SourceRecord,
  identities: DatasetIdentities,
  bundleRelativePath: string,
  plan: Pick<DatasetIngestPlan, "stats" | "warnings">,
  operationId: string,
  now: string
): SourceRecord {
  return SourceRecordSchema.parse({
    ...sourceRecord,
    metadata: {
      ...sourceRecord.metadata,
      parserRequired: false,
      parserStatus: "dataset_materialized",
      datasetToolAvailable: true,
      datasetId: identities.datasetId,
      datasetRevisionId: identities.revisionId,
      datasetBundlePath: bundleRelativePath,
      datasetProfile: "managed_collection",
      datasetTableCount: plan.stats.tableCount,
      datasetRowCount: plan.stats.rowCount,
      datasetColumnCount: plan.stats.columnCount,
      datasetCellCount: plan.stats.cellCount,
      datasetOperationId: operationId,
      datasetWarnings: plan.warnings.map((warning) => warning.code).slice(0, 16)
    },
    updatedAt: now
  });
}

function toMaterializationResult(
  sourceRecord: SourceRecord,
  bundle: DatasetBundleRecords,
  plan: Pick<DatasetIngestPlan, "stats" | "warnings">,
  operation: OperationRecord,
  created: boolean
): DatasetMaterializationResult {
  return {
    sourceRecord,
    created,
    datasetId: bundle.manifest.datasetId,
    revisionId: bundle.revision.id,
    tableCount: plan.stats.tableCount,
    rowCount: plan.stats.rowCount,
    warnings: plan.warnings.map((warning) => warning.code),
    operationIds: [operation.id]
  };
}

function readPlanSummaryFromPayload(
  vaultPath: string,
  bundleRelativePath: string,
  bundle: DatasetBundleRecords
): Pick<DatasetIngestPlan, "stats" | "warnings"> {
  const payloadPath = resolveVaultRelativePath(vaultPath, `${bundleRelativePath}/${bundle.manifest.payload.path}`);
  const database = new DatabaseSync(payloadPath, { readOnly: true });
  try {
    const cellRow = database.prepare("SELECT COUNT(*) AS count FROM pige_dataset_cells").get() as { count?: unknown };
    const cellCount = Number(cellRow.count);
    if (
      !Number.isSafeInteger(cellCount) ||
      cellCount < 0 ||
      cellCount !== bundle.revision.stats.cellCount ||
      bundle.schema.tables.length !== bundle.revision.stats.tableCount ||
      bundle.schema.tables.reduce((sum, table) => sum + table.rowCount, 0) !== bundle.revision.stats.rowCount ||
      bundle.schema.tables.reduce((sum, table) => sum + table.columnCount, 0) !== bundle.revision.stats.columnCount
    ) {
      throw new PigeDomainError("dataset.import.invalid", "The durable Dataset payload has invalid bound statistics.");
    }
    return {
      stats: bundle.revision.stats,
      warnings: bundle.revision.warnings.map((code) => ({ code, message: code }))
    };
  } finally {
    database.close();
  }
}

function publishBundle(
  vaultPath: string,
  bundleRelativePath: string,
  stagingBundle: string,
  expectedManifest: DatasetManifest
): void {
  const destination = resolveVaultRelativePath(vaultPath, bundleRelativePath);
  const destinationParent = ensureConfinedDirectory(vaultPath, path.posix.dirname(bundleRelativePath), true);
  if (path.dirname(destination) !== destinationParent) {
    throw new PigeDomainError("dataset.path_unsafe", "The Dataset destination parent is unsafe.");
  }
  try {
    fs.renameSync(stagingBundle, destination);
    ensureConfinedDirectory(vaultPath, bundleRelativePath, false);
    syncDirectory(path.dirname(destination));
  } catch (caught) {
    if (!isFileExistsError(caught)) throw caught;
    const existingManifestPath = path.join(destination, "dataset.json");
    if (!fs.existsSync(existingManifestPath)) {
      throw new PigeDomainError(
        "dataset.identity_conflict",
        "The deterministic Dataset identity is occupied by an incomplete external directory."
      );
    }
    const existing = DatasetManifestSchema.parse(readJson(existingManifestPath));
    if (hashCanonical(existing) !== hashCanonical(expectedManifest)) {
      throw new PigeDomainError("dataset.identity_conflict", "The deterministic Dataset identity already contains different content.");
    }
  }
}

function assertCurrentSourceRecord(sourceRecordPath: string, expected: SourceRecord, expectedHash: string): void {
  const current = SourceRecordSchema.parse(readJson(sourceRecordPath));
  if (current.id !== expected.id || createDatasetSourceRecordHash(current) !== expectedHash) {
    throw new PigeDomainError("dataset.import.source_changed", "The structured source changed before Dataset publication.");
  }
}

function assertFileRef(bundlePath: string, ref: { readonly path: string; readonly checksum: string; readonly size: number }): void {
  const filePath = resolveBundleRelativePath(bundlePath, ref.path);
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== ref.size || checksumFile(filePath) !== ref.checksum) {
    throw new PigeDomainError("dataset.import.invalid", "A durable Dataset file failed integrity validation.");
  }
}

function fileRef(bundlePath: string, relativePath: string): { readonly path: string; readonly checksum: string; readonly size: number } {
  const filePath = resolveBundleRelativePath(bundlePath, relativePath);
  const stat = fs.lstatSync(filePath);
  return { path: relativePath, checksum: checksumFile(filePath), size: stat.size };
}

function resolveBundleRelativePath(bundlePath: string, relativePath: string): string {
  if (path.isAbsolute(relativePath) || relativePath.includes("\\")) {
    throw new PigeDomainError("dataset.path_invalid", "Dataset Bundle paths must be relative POSIX paths.");
  }
  const resolvedBundle = path.resolve(bundlePath);
  const resolved = path.resolve(bundlePath, ...relativePath.split("/"));
  if (resolved === resolvedBundle || !resolved.startsWith(`${resolvedBundle}${path.sep}`)) {
    throw new PigeDomainError("dataset.path_invalid", "Dataset Bundle path escapes its durable root.");
  }
  return resolved;
}

function resolveVaultRelativePath(vaultPath: string, relativePath: string): string {
  const resolvedVault = path.resolve(vaultPath);
  const resolved = path.resolve(vaultPath, ...relativePath.split("/"));
  if (resolved === resolvedVault || !resolved.startsWith(`${resolvedVault}${path.sep}`)) {
    throw new PigeDomainError("dataset.path_invalid", "Dataset path escapes the active vault.");
  }
  return resolved;
}

function ensureConfinedDirectory(vaultPath: string, relativePath: string, create: boolean): string {
  if (path.isAbsolute(relativePath) || relativePath.includes("\\")) {
    throw new PigeDomainError("dataset.path_invalid", "Dataset directories must use vault-relative POSIX paths.");
  }
  const resolvedVault = path.resolve(vaultPath);
  const vaultStat = fs.lstatSync(resolvedVault);
  if (!vaultStat.isDirectory() || vaultStat.isSymbolicLink()) {
    throw new PigeDomainError("dataset.path_unsafe", "The Dataset vault root is unsafe.");
  }
  const realVault = fs.realpathSync(resolvedVault);
  let current = resolvedVault;
  for (const segment of relativePath.split("/")) {
    if (!segment || segment === "." || segment === "..") {
      throw new PigeDomainError("dataset.path_invalid", "Dataset directory segments are invalid.");
    }
    current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new PigeDomainError("dataset.path_unsafe", "Dataset directories cannot traverse symbolic links.");
      }
    } catch (caught) {
      if (!isMissingPathError(caught) || !create) throw caught;
      fs.mkdirSync(current, { mode: 0o700 });
      const created = fs.lstatSync(current);
      if (!created.isDirectory() || created.isSymbolicLink()) {
        throw new PigeDomainError("dataset.path_unsafe", "The Dataset directory could not be created safely.");
      }
    }
    const realCurrent = fs.realpathSync(current);
    if (realCurrent === realVault || !realCurrent.startsWith(`${realVault}${path.sep}`)) {
      throw new PigeDomainError("dataset.path_unsafe", "Dataset directories escape the active vault.");
    }
  }
  return current;
}

function datasetSlug(sourceRecord: SourceRecord): string {
  const sourceName = sourceRecord.original?.displayName ??
    (typeof sourceRecord.metadata.title === "string" ? sourceRecord.metadata.title : "dataset");
  const withoutExtension = sourceName.replace(/\.[^.]+$/u, "");
  const slug = withoutExtension.normalize("NFKD").toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
  return slug || "dataset";
}

function datasetTitle(sourceRecord: SourceRecord): string {
  const title = typeof sourceRecord.metadata.title === "string"
    ? sourceRecord.metadata.title
    : sourceRecord.original?.displayName?.replace(/\.[^.]+$/u, "");
  return (title?.trim() || "Structured Dataset").slice(0, 240);
}

function createDatasetOperationId(jobId: string, revisionId: string): string {
  const dateKey = /^job_(\d{8})_/u.exec(jobId)?.[1] ?? /^dataset_rev_(\d{8})_/u.exec(revisionId)?.[1];
  if (!dateKey) throw new PigeDomainError("dataset.operation_id_invalid", "The Dataset Operation has no date bucket.");
  return `op_${dateKey}_${digest("pige:dataset-operation:v1", jobId, revisionId).slice(0, 16)}`;
}

function digest(domain: string, ...values: readonly string[]): string {
  const hash = createHash("sha256").update(`${domain}\0`, "utf8");
  for (const value of values) hash.update(value, "utf8").update("\0", "utf8");
  return hash.digest("hex");
}

function hashCanonical(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function createDatasetSourceRecordHash(sourceRecord: SourceRecord): string {
  return hashCanonical({
    id: sourceRecord.id,
    kind: sourceRecord.kind,
    storageStrategy: sourceRecord.storageStrategy,
    managedCopy: sourceRecord.managedCopy,
    original: sourceRecord.original ? {
      uri: sourceRecord.original.uri,
      path: sourceRecord.original.path,
      checksum: sourceRecord.original.checksum,
      lastKnownSize: sourceRecord.original.lastKnownSize
    } : undefined,
    createdAt: sourceRecord.createdAt
  });
}

function checksumFile(filePath: string): string {
  return `sha256:${createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonCreateExclusive(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const descriptor = fs.openSync(filePath, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  syncDirectory(path.dirname(filePath));
}

function writeFileAtomic(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporaryPath, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, value, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporaryPath, filePath);
  syncDirectory(path.dirname(filePath));
}

function syncBundle(root: string): void {
  for (const relativePath of ["dataset.json", "data/collection.sqlite"]) {
    syncFile(path.join(root, ...relativePath.split("/")));
  }
  syncDirectory(root);
}

function syncFile(filePath: string): void {
  const descriptor = fs.openSync(filePath, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function syncDirectory(directoryPath: string): void {
  const descriptor = fs.openSync(directoryPath, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isDatasetSourceKind(sourceKind: SourceKind): sourceKind is DatasetIngestSourceKind {
  return sourceKind === "csv_file" || sourceKind === "xlsx_file" || sourceKind === "sqlite_file";
}

function isFileExistsError(caught: unknown): boolean {
  return typeof caught === "object" && caught !== null && "code" in caught &&
    (caught.code === "EEXIST" || caught.code === "ENOTEMPTY");
}

function isMissingPathError(caught: unknown): boolean {
  return typeof caught === "object" && caught !== null && "code" in caught && caught.code === "ENOENT";
}
