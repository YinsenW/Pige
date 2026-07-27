import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PigeDomainError } from "@pige/domain";
import {
  CollectionSnapshotSchema,
  DatasetManifestSchema,
  DatasetRevisionSchema,
  DatasetSchemaRecordSchema,
  OperationRecordSchema,
  type CollectionCell,
  type CollectionScalarValue,
  type DatasetColumn,
  type DatasetLogicalType,
  type DatasetManifest,
  type DatasetRevision,
  type DatasetSchemaRecord,
  type OperationRecord
} from "@pige/schemas";
import { createVaultRelativePathResolver } from "./vault-layout";

export interface FileRef {
  readonly path: string;
  readonly checksum: string;
  readonly size: number;
}

export interface BundleBinding {
  readonly vaultPath: string;
  readonly bundlePath: string;
  readonly bundleRelativePath: string;
  readonly manifestPath: string;
  readonly manifestBytes: Buffer;
  readonly manifestStat: fs.Stats;
  readonly manifest: DatasetManifest;
  readonly revision: DatasetRevision;
  readonly schema: DatasetSchemaRecord;
  readonly payloadPath: string;
}

export interface CollectionCellBinding {
  readonly tableName: string;
  readonly column: DatasetColumn;
  readonly state: string;
  readonly projectionKind: string;
  readonly projectionJson: string | null;
  readonly formulaJson: string | null;
}

export interface CollectionColumnMutationIdentity {
  readonly revisionId: string;
  readonly operationId: string;
}

export const MAX_COLLECTION_JSON_BYTES = 512 * 1024;
const MAX_OPEN_ROWS = 50;
const MAX_OPEN_COLUMNS = 32;
const MAX_DATASET_ENTRIES = 10_000;
const MAX_PAYLOAD_BYTES = 512 * 1024 * 1024;
const OPERATION_ID = /^op_(\d{8})_[a-z0-9]{8,}$/u;
const EDITABLE_TYPES = new Set<DatasetLogicalType>([
  "string", "integer", "number", "boolean", "date", "datetime"
]);

export function readCollectionSnapshot(binding: BundleBinding, tableId: string) {
  const table = binding.schema.tables.find((candidate) => candidate.id === tableId);
  if (!table) return undefined;
  const columns = table.columns.slice(0, MAX_OPEN_COLUMNS);
  if (columns.length === 0) return undefined;
  const database = openReadOnlyPayload(binding.payloadPath);
  try {
    validatePayloadMeta(database, binding.manifest.datasetId, binding.revision.id);
    const formulaCount = database.prepare([
      "SELECT COUNT(*) AS count FROM pige_dataset_cells AS c",
      "JOIN pige_dataset_rows AS r ON r.row_id = c.row_id",
      "WHERE r.table_id = ? AND c.formula_json IS NOT NULL"
    ].join(" ")).get(tableId) as { count?: unknown } | undefined;
    const rows = database.prepare(
      `SELECT row_id FROM pige_dataset_rows WHERE table_id = ? ORDER BY ordinal ASC LIMIT ${MAX_OPEN_ROWS}`
    ).all(tableId) as Array<{ row_id?: unknown }>;
    const statement = database.prepare(
      "SELECT state, projection_kind, projection_json, formula_json FROM pige_dataset_cells WHERE row_id = ? AND column_id = ?"
    );
    const projectedRows = rows.map((row) => {
      if (typeof row.row_id !== "string") throw payloadInvalid();
      const rowId = row.row_id;
      const cells = columns.map((column): CollectionCell => {
        const raw = statement.get(rowId, column.id) as Record<string, unknown> | undefined;
        if (!raw) throw payloadInvalid();
        const cell = parseCellRecord(column, raw);
        const reason = collectionCellReadOnlyReason(cell);
        return {
          columnId: column.id,
          value: parseCollectionCellValue(cell, column.logicalType),
          editable: !reason,
          ...(reason ? { readOnlyReason: reason } : {})
        };
      });
      return { rowId, cells };
    });
    return CollectionSnapshotSchema.parse({
      datasetId: binding.manifest.datasetId,
      revisionId: binding.revision.id,
      title: binding.manifest.title,
      tableId,
      tableName: table.name,
      columns: columns.map((column) => ({
        columnId: column.id,
        label: column.name,
        logicalType: column.logicalType
      })),
      rows: projectedRows,
      totalRowCount: table.rowCount,
      returnedRowCount: projectedRows.length,
      truncated: table.rowCount > projectedRows.length,
      canAppendDefaultRow: table.columns.length <= MAX_OPEN_COLUMNS &&
        table.columns.every((column) => column.nullable && !columnUsesFormula(column)) &&
        formulaCount?.count === 0,
      canAddColumn: table.columns.length < MAX_OPEN_COLUMNS
    });
  } finally {
    database.close();
  }
}

export function readCollectionCell(
  binding: BundleBinding,
  tableId: string,
  rowId: string,
  columnId: string
): CollectionCellBinding | undefined {
  const table = binding.schema.tables.find((candidate) => candidate.id === tableId);
  const column = table?.columns.find((candidate) => candidate.id === columnId);
  if (!table || !column) return undefined;
  const database = openReadOnlyPayload(binding.payloadPath);
  try {
    validatePayloadMeta(database, binding.manifest.datasetId, binding.revision.id);
    const row = database.prepare("SELECT table_id FROM pige_dataset_rows WHERE row_id = ?").get(rowId) as {
      table_id?: unknown;
    } | undefined;
    if (row?.table_id !== tableId) return undefined;
    const raw = database.prepare(
      "SELECT state, projection_kind, projection_json, formula_json FROM pige_dataset_cells WHERE row_id = ? AND column_id = ?"
    ).get(rowId, columnId) as Record<string, unknown> | undefined;
    return raw ? { tableName: table.name, ...parseCellRecord(column, raw) } : undefined;
  } finally {
    database.close();
  }
}

export function readCollectionCellFromRevision(
  binding: BundleBinding,
  revision: DatasetRevision,
  rowId: string,
  columnId: string
): CollectionCellBinding | undefined {
  const schema = DatasetSchemaRecordSchema.parse(readJsonRef(binding.bundlePath, revision.schema));
  const table = schema.tables.find((candidate) => candidate.columns.some((column) => column.id === columnId));
  const column = table?.columns.find((candidate) => candidate.id === columnId);
  if (!table || !column) return undefined;
  assertFileRef(binding.bundlePath, revision.payload);
  const database = openReadOnlyPayload(resolveBundleRelativePath(binding.bundlePath, revision.payload.path));
  try {
    validatePayloadMeta(database, revision.datasetId, revision.id);
    const raw = database.prepare([
      "SELECT c.state, c.projection_kind, c.projection_json, c.formula_json",
      "FROM pige_dataset_cells AS c JOIN pige_dataset_rows AS r ON r.row_id = c.row_id",
      "WHERE c.row_id = ? AND c.column_id = ? AND r.table_id = ?"
    ].join(" ")).get(rowId, columnId, table.id) as Record<string, unknown> | undefined;
    return raw ? { tableName: table.name, ...parseCellRecord(column, raw) } : undefined;
  } finally {
    database.close();
  }
}

export function parseCollectionCellValue(
  cell: Omit<CollectionCellBinding, "tableName">,
  logicalType: DatasetLogicalType
): CollectionScalarValue {
  if (cell.state === "missing" || cell.state === "null") return null;
  if (cell.state === "empty") return "";
  if (cell.state !== "value" || cell.projectionJson === null) throw payloadInvalid();
  const projection = JSON.parse(cell.projectionJson) as Record<string, unknown>;
  if (logicalType === "string" || logicalType === "date" || logicalType === "datetime") {
    if (typeof projection.value !== "string") throw payloadInvalid();
    return projection.value;
  }
  if (logicalType === "integer") {
    const value = typeof projection.value === "number" ? projection.value : Number(projection.value);
    if (!Number.isSafeInteger(value)) throw payloadInvalid();
    return value;
  }
  if (logicalType === "number") {
    const value = typeof projection.value === "number" ? projection.value : Number(projection.value);
    if (!Number.isFinite(value)) throw payloadInvalid();
    return value;
  }
  if (logicalType === "boolean" && typeof projection.value === "boolean") return projection.value;
  throw payloadInvalid();
}

export function collectionCellReadOnlyReason(
  cell: Omit<CollectionCellBinding, "tableName">
): "formula" | "unsupported_type" | undefined {
  if (cell.formulaJson !== null) return "formula";
  return EDITABLE_TYPES.has(cell.column.logicalType) ? undefined : "unsupported_type";
}

function parseCellRecord(
  column: DatasetColumn,
  raw: Record<string, unknown>
): Omit<CollectionCellBinding, "tableName"> {
  if (
    typeof raw.state !== "string" || typeof raw.projection_kind !== "string" ||
    !(typeof raw.projection_json === "string" || raw.projection_json === null) ||
    !(typeof raw.formula_json === "string" || raw.formula_json === null)
  ) throw payloadInvalid();
  return {
    column,
    state: raw.state,
    projectionKind: raw.projection_kind,
    projectionJson: raw.projection_json,
    formulaJson: raw.formula_json
  };
}

function columnUsesFormula(column: DatasetColumn): boolean {
  return [column.sourceType, ...(column.sourceTypes ?? [])]
    .some((sourceType) => sourceType.toLowerCase().includes("formula"));
}

export function createNullableColumnId(tableId: string, requestId: string): string {
  return `column_${createHash("sha256")
    .update("pige:collection-column:v1").update("\0")
    .update(tableId).update("\0")
    .update(requestId).digest("hex").slice(0, 16)}`;
}

export function commitNullableColumnAdd(input: {
  readonly binding: BundleBinding;
  readonly identity: CollectionColumnMutationIdentity;
  readonly tableId: string;
  readonly columnId: string;
  readonly label: string;
  readonly logicalType: Exclude<DatasetLogicalType, "binary" | "unknown">;
  readonly expectedRevisionId: string;
}): { readonly binding: BundleBinding; readonly revision: DatasetRevision } {
  const current = requireCurrentRevision(input.binding, input.expectedRevisionId);
  const table = current.schema.tables.find((candidate) => candidate.id === input.tableId);
  if (!table) throw new PigeDomainError("collection.table_not_found", "The Collection table is unavailable.");
  if (table.columns.length >= MAX_OPEN_COLUMNS) {
    throw new PigeDomainError("collection.column_limit", "The Collection column limit was reached.");
  }
  const normalized = normalizeColumnLabel(input.label);
  if (table.columns.some((column) => normalizeColumnLabel(column.name) === normalized)) {
    throw new PigeDomainError("collection.duplicate_label", "The Collection already has this column label.");
  }
  const column: DatasetColumn = {
    id: input.columnId,
    name: input.label,
    ordinal: table.columns.length,
    sourceType: "pige_user_nullable",
    sourceTypes: ["pige_user_nullable"],
    logicalType: input.logicalType,
    nullable: true,
    stats: { missing: 0, empty: 0, null: table.rowCount, value: 0 }
  };
  return publishColumnMutation({
    current,
    identity: input.identity,
    tableId: input.tableId,
    columnId: input.columnId,
    expectedRevisionId: input.expectedRevisionId,
    change: { kind: "collection_column_add" },
    createPayload: (payloadPath) => appendNullableColumn(payloadPath, current, table, column, input.identity.revisionId),
    createSchema: () => DatasetSchemaRecordSchema.parse({
      ...current.schema,
      revisionId: input.identity.revisionId,
      createdAt: new Date().toISOString(),
      tables: current.schema.tables.map((candidate) => candidate.id === table.id
        ? { ...candidate, columnCount: candidate.columnCount + 1, columns: [...candidate.columns, column] }
        : candidate)
    }),
    stats: {
      ...current.revision.stats,
      columnCount: current.revision.stats.columnCount + 1,
      cellCount: current.revision.stats.cellCount + table.rowCount
    }
  });
}

export function commitNullableColumnUndo(input: {
  readonly binding: BundleBinding;
  readonly identity: CollectionColumnMutationIdentity;
  readonly tableId: string;
  readonly columnId: string;
  readonly expectedRevisionId: string;
  readonly beforeRevisionId: string;
  readonly undoOfOperationId: string;
}): { readonly binding: BundleBinding; readonly revision: DatasetRevision } {
  const current = requireCurrentRevision(input.binding, input.expectedRevisionId);
  const before = readRevisionById(current, input.beforeRevisionId);
  const schema = DatasetSchemaRecordSchema.parse(readJsonRef(current.bundlePath, before.schema));
  return publishColumnMutation({
    current,
    identity: input.identity,
    tableId: input.tableId,
    columnId: input.columnId,
    expectedRevisionId: input.expectedRevisionId,
    sourcePayload: resolveBundleRelativePath(current.bundlePath, before.payload.path),
    change: { kind: "collection_column_add_undo", undoOfOperationId: input.undoOfOperationId },
    createPayload: (payloadPath) => rebindPayloadRevision(
      payloadPath,
      current.manifest.datasetId,
      before.id,
      input.identity.revisionId
    ),
    createSchema: () => DatasetSchemaRecordSchema.parse({
      ...schema,
      revisionId: input.identity.revisionId,
      createdAt: new Date().toISOString()
    }),
    stats: before.stats
  });
}

function publishColumnMutation(input: {
  readonly current: BundleBinding;
  readonly identity: CollectionColumnMutationIdentity;
  readonly tableId: string;
  readonly columnId: string;
  readonly expectedRevisionId: string;
  readonly sourcePayload?: string;
  readonly change:
    | { readonly kind: "collection_column_add" }
    | { readonly kind: "collection_column_add_undo"; readonly undoOfOperationId: string };
  readonly createPayload: (payloadPath: string) => void;
  readonly createSchema: () => DatasetSchemaRecord;
  readonly stats: DatasetRevision["stats"];
}): { readonly binding: BundleBinding; readonly revision: DatasetRevision } {
  const stagedRoot = path.join(input.current.bundlePath, ".staging", `${input.identity.revisionId}.${randomUUID()}`);
  const payloadPath = `data/revisions/${input.identity.revisionId}.sqlite`;
  const schemaPath = `schemas/${input.identity.revisionId}.json`;
  const revisionPath = `revisions/${input.identity.revisionId}.json`;
  const stagedPayload = path.join(stagedRoot, "payload.sqlite");
  fs.mkdirSync(stagedRoot, { recursive: true, mode: 0o700 });
  try {
    fs.copyFileSync(input.sourcePayload ?? input.current.payloadPath, stagedPayload);
    input.createPayload(stagedPayload);
    const schema = input.createSchema();
    publishImmutableFile(stagedPayload, resolveBundleRelativePath(input.current.bundlePath, payloadPath));
    writeJsonImmutable(resolveBundleRelativePath(input.current.bundlePath, schemaPath), schema);
    const now = new Date().toISOString();
    const revision = DatasetRevisionSchema.parse({
      ...input.current.revision,
      id: input.identity.revisionId,
      parentRevisionId: input.current.revision.id,
      schema: fileRef(input.current.bundlePath, schemaPath),
      payload: { ...fileRef(input.current.bundlePath, payloadPath), format: "sqlite" },
      stats: input.stats,
      operationId: input.identity.operationId,
      change: { ...input.change, tableId: input.tableId, columnId: input.columnId },
      createdAt: now
    });
    writeJsonImmutable(resolveBundleRelativePath(input.current.bundlePath, revisionPath), revision);
    replaceManifestCas(input.current, DatasetManifestSchema.parse({
      ...input.current.manifest,
      initialRevision: input.current.manifest.initialRevision ?? input.current.manifest.activeRevision,
      activeRevision: revision.id,
      revision: fileRef(input.current.bundlePath, revisionPath),
      schema: revision.schema,
      payload: revision.payload,
      updatedAt: now
    }));
    const binding = readBundle(input.current.vaultPath, input.current.manifest.datasetId);
    if (!binding || binding.manifest.activeRevision !== revision.id) {
      throw new PigeDomainError("collection.commit_uncertain", "The Collection commit could not be adopted.");
    }
    return { binding, revision };
  } finally {
    fs.rmSync(stagedRoot, { recursive: true, force: true });
  }
}

function requireCurrentRevision(binding: BundleBinding, expectedRevisionId: string): BundleBinding {
  const current = readBundle(binding.vaultPath, binding.manifest.datasetId);
  if (!current || current.manifest.activeRevision !== expectedRevisionId) {
    throw new PigeDomainError("collection.revision_changed", "The Collection revision changed before commit.");
  }
  return current;
}

function appendNullableColumn(
  payloadPath: string,
  binding: BundleBinding,
  table: DatasetSchemaRecord["tables"][number],
  column: DatasetColumn,
  revisionId: string
): void {
  const database = new DatabaseSync(payloadPath);
  try {
    database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    validatePayloadMeta(database, binding.manifest.datasetId, binding.revision.id);
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("INSERT INTO pige_dataset_columns VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        column.id,
        table.id,
        column.ordinal,
        column.name,
        projectedType(column.logicalType),
        JSON.stringify(column.sourceTypes),
        JSON.stringify(column.stats)
      );
      const insert = database.prepare([
        "INSERT INTO pige_dataset_cells",
        "(row_id, column_id, state, source_type, lexical_raw, lexical_text, quoted, projection_kind, projection_json, formula_json, source_style_json)",
        "SELECT row_id, ?, 'null', 'pige_user_nullable', NULL, NULL, NULL, 'null', NULL, NULL, NULL",
        "FROM pige_dataset_rows WHERE table_id = ?"
      ].join(" ")).run(column.id, table.id);
      if (insert.changes !== table.rowCount) throw payloadInvalid();
      if (database.prepare(
        "UPDATE pige_dataset_tables SET column_count = column_count + 1 WHERE table_id = ? AND column_count = ?"
      ).run(table.id, table.columnCount).changes !== 1) throw payloadInvalid();
      if (database.prepare("UPDATE pige_dataset_meta SET value = ? WHERE key = 'revision_id'")
        .run(revisionId).changes !== 1) throw payloadInvalid();
      database.exec("COMMIT");
    } catch (caught) {
      database.exec("ROLLBACK");
      throw caught;
    }
    assertPayloadIntegrity(database);
  } finally {
    database.close();
  }
  syncFile(payloadPath);
}

function rebindPayloadRevision(payloadPath: string, datasetId: string, beforeRevisionId: string, revisionId: string): void {
  const database = new DatabaseSync(payloadPath);
  try {
    database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;");
    validatePayloadMeta(database, datasetId, beforeRevisionId);
    if (database.prepare("UPDATE pige_dataset_meta SET value = ? WHERE key = 'revision_id'")
      .run(revisionId).changes !== 1) throw payloadInvalid();
    assertPayloadIntegrity(database);
  } finally {
    database.close();
  }
  syncFile(payloadPath);
}

function assertPayloadIntegrity(database: DatabaseSync): void {
  const result = database.prepare("PRAGMA integrity_check").get() as { integrity_check?: unknown } | undefined;
  if (result?.integrity_check !== "ok") throw payloadInvalid();
}

function normalizeColumnLabel(label: string): string {
  return label.normalize("NFKC").toLocaleLowerCase("en-US");
}

function projectedType(logicalType: DatasetLogicalType): string {
  if (logicalType === "string") return "text";
  if (logicalType === "number") return "real";
  return logicalType;
}

export function readBundle(vaultPath: string, datasetId: string): BundleBinding | undefined {
  return readAllBundles(vaultPath).find((binding) => binding.manifest.datasetId === datasetId);
}

export function readAllBundles(vaultPath: string): BundleBinding[] {
  assertSafeVaultRoot(vaultPath);
  const datasetsRoot = resolveVaultRelativePath(vaultPath, "datasets");
  if (!fs.existsSync(datasetsRoot)) return [];
  assertSafeDirectory(vaultPath, datasetsRoot);
  const entries = fs.readdirSync(datasetsRoot, { withFileTypes: true });
  if (entries.length > MAX_DATASET_ENTRIES) {
    throw new PigeDomainError("collection.limit", "The Dataset directory is too large.");
  }
  const result: BundleBinding[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const bundlePath = path.join(datasetsRoot, entry.name);
    assertSafeDirectory(vaultPath, bundlePath);
    const manifestPath = path.join(bundlePath, "dataset.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifestFile = readRegularFile(manifestPath, MAX_COLLECTION_JSON_BYTES, bundlePath);
    const manifest = DatasetManifestSchema.parse(JSON.parse(manifestFile.bytes.toString("utf8")));
    const revision = DatasetRevisionSchema.parse(readJsonRef(bundlePath, manifest.revision));
    const schema = DatasetSchemaRecordSchema.parse(readJsonRef(bundlePath, manifest.schema));
    assertFileRef(bundlePath, manifest.payload);
    assertFileRef(bundlePath, revision.schema);
    assertFileRef(bundlePath, revision.payload);
    if (
      manifest.profile !== "managed_collection" ||
      manifest.activeRevision !== revision.id ||
      manifest.datasetId !== revision.datasetId ||
      manifest.datasetId !== schema.datasetId ||
      revision.id !== schema.revisionId ||
      hashCanonical(manifest.schema) !== hashCanonical(revision.schema) ||
      hashCanonical(manifest.payload) !== hashCanonical(revision.payload)
    ) throw new PigeDomainError("collection.revision_invalid", "The Collection revision binding is invalid.");
    result.push({
      vaultPath,
      bundlePath,
      bundleRelativePath: path.posix.join("datasets", entry.name),
      manifestPath,
      manifestBytes: manifestFile.bytes,
      manifestStat: manifestFile.stat,
      manifest,
      revision,
      schema,
      payloadPath: resolveBundleRelativePath(bundlePath, manifest.payload.path)
    });
  }
  if (new Set(result.map((binding) => binding.manifest.datasetId)).size !== result.length) {
    throw new PigeDomainError("collection.identity_conflict", "Dataset identities are not unique.");
  }
  return result;
}

export function readRevisionById(binding: BundleBinding, revisionId: string): DatasetRevision {
  const revisionPath = resolveBundleRelativePath(binding.bundlePath, `revisions/${revisionId}.json`);
  if (!fs.existsSync(revisionPath)) throw operationConflict();
  const revision = DatasetRevisionSchema.parse(readJsonBounded(revisionPath, MAX_COLLECTION_JSON_BYTES));
  if (revision.id !== revisionId || revision.datasetId !== binding.manifest.datasetId) throw operationConflict();
  assertFileRef(binding.bundlePath, revision.schema);
  assertFileRef(binding.bundlePath, revision.payload);
  return revision;
}

export function replaceManifestCas(binding: BundleBinding, next: DatasetManifest): void {
  const current = readRegularFile(binding.manifestPath, MAX_COLLECTION_JSON_BYTES, binding.bundlePath);
  if (!current.bytes.equals(binding.manifestBytes) || !sameFileRevision(current.stat, binding.manifestStat)) {
    throw new PigeDomainError("collection.revision_changed", "The Collection manifest changed before commit.");
  }
  const temporaryPath = `${binding.manifestPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    syncFile(temporaryPath);
    const verify = readRegularFile(binding.manifestPath, MAX_COLLECTION_JSON_BYTES, binding.bundlePath);
    if (!verify.bytes.equals(binding.manifestBytes) || !sameFileRevision(verify.stat, binding.manifestStat)) {
      throw new PigeDomainError("collection.revision_changed", "The Collection manifest changed before publication.");
    }
    fs.renameSync(temporaryPath, binding.manifestPath);
    syncDirectory(path.dirname(binding.manifestPath));
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

export function publishImmutableFile(stagedPath: string, destinationPath: string): void {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  try {
    fs.linkSync(stagedPath, destinationPath);
  } catch (caught) {
    if (!isErrno(caught, "EEXIST")) throw caught;
    if (checksumFile(stagedPath) !== checksumFile(destinationPath)) throw requestConflict();
    return;
  }
  syncDirectory(path.dirname(destinationPath));
}

export function writeJsonImmutable(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    fs.writeFileSync(filePath, bytes, { flag: "wx", mode: 0o600 });
    syncFile(filePath);
    syncDirectory(path.dirname(filePath));
  } catch (caught) {
    if (!isErrno(caught, "EEXIST")) throw caught;
    if (!readRegularFile(filePath, MAX_COLLECTION_JSON_BYTES, path.dirname(filePath)).bytes.equals(bytes)) {
      throw requestConflict();
    }
  }
}

export function writeJsonExclusive(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const expected = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    fs.writeFileSync(filePath, expected, { flag: "wx", mode: 0o600 });
    syncFile(filePath);
    syncDirectory(path.dirname(filePath));
  } catch (caught) {
    if (!isErrno(caught, "EEXIST")) throw caught;
    if (!readRegularFile(filePath, MAX_COLLECTION_JSON_BYTES, path.dirname(filePath)).bytes.equals(expected)) {
      throw operationConflict();
    }
  }
}

export function operationPathFor(vaultPath: string, operationId: string): string {
  const dateKey = OPERATION_ID.exec(operationId)?.[1];
  if (!dateKey) throw operationConflict();
  return resolveVaultRelativePath(
    vaultPath,
    `.pige/operations/${dateKey.slice(0, 4)}/${dateKey.slice(4, 6)}/${operationId}.json`
  );
}

export function readOperationRecords(vaultPath: string): OperationRecord[] {
  const root = resolveVaultRelativePath(vaultPath, ".pige/operations");
  if (!fs.existsSync(root)) return [];
  const result: OperationRecord[] = [];
  const stack = [root];
  let seen = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (++seen > MAX_DATASET_ENTRIES) {
        throw new PigeDomainError("collection.limit", "The Operation store is too large.");
      }
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        try {
          result.push(OperationRecordSchema.parse(readJsonBounded(absolute, MAX_COLLECTION_JSON_BYTES)));
        } catch {
          // The Activity owner reports malformed records; recovery ignores them.
        }
      }
    }
  }
  return result;
}

export function openReadOnlyPayload(filePath: string): DatabaseSync {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PAYLOAD_BYTES) throw payloadInvalid();
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    database.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON;");
    validatePayloadSchema(database);
    return database;
  } catch (caught) {
    database.close();
    throw caught;
  }
}

function validatePayloadSchema(database: DatabaseSync): void {
  const expectedTables = new Set([
    "pige_dataset_meta",
    "pige_dataset_tables",
    "pige_dataset_columns",
    "pige_dataset_rows",
    "pige_dataset_cells"
  ]);
  const expectedIndexes = new Set([
    "sqlite_autoindex_pige_dataset_meta_1",
    "sqlite_autoindex_pige_dataset_tables_1",
    "sqlite_autoindex_pige_dataset_columns_1",
    "sqlite_autoindex_pige_dataset_columns_2",
    "sqlite_autoindex_pige_dataset_rows_1",
    "sqlite_autoindex_pige_dataset_rows_2",
    "sqlite_autoindex_pige_dataset_cells_1"
  ]);
  const objects = database.prepare(
    "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' OR name LIKE 'sqlite_autoindex_pige_dataset_%'"
  ).all() as Array<{ type?: unknown; name?: unknown }>;
  for (const object of objects) {
    if (typeof object.type !== "string" || typeof object.name !== "string") throw payloadInvalid();
    if (object.type === "table" && expectedTables.delete(object.name)) continue;
    if (object.type === "index" && expectedIndexes.delete(object.name)) continue;
    throw payloadInvalid();
  }
  if (expectedTables.size !== 0 || expectedIndexes.size !== 0) throw payloadInvalid();
}

export function validatePayloadMeta(database: DatabaseSync, datasetId?: string, revisionId?: string): void {
  validatePayloadSchema(database);
  const rows = database.prepare("SELECT key, value FROM pige_dataset_meta").all() as Array<{
    key?: unknown;
    value?: unknown;
  }>;
  const meta = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.key !== "string" || typeof row.value !== "string" || meta.has(row.key)) throw payloadInvalid();
    meta.set(row.key, row.value);
  }
  if (
    meta.get("format") !== "pige-managed-collection-v1" ||
    (datasetId !== undefined && meta.get("dataset_id") !== datasetId) ||
    (revisionId !== undefined && meta.get("revision_id") !== revisionId)
  ) throw payloadInvalid();
}

export function readJsonRef(bundlePath: string, ref: FileRef): unknown {
  assertFileRef(bundlePath, ref);
  return readJsonBounded(resolveBundleRelativePath(bundlePath, ref.path), MAX_COLLECTION_JSON_BYTES);
}

export function assertFileRef(bundlePath: string, ref: FileRef): void {
  const filePath = resolveBundleRelativePath(bundlePath, ref.path);
  const file = readRegularFile(
    filePath,
    Math.max(MAX_COLLECTION_JSON_BYTES, Math.min(MAX_PAYLOAD_BYTES, ref.size)),
    bundlePath
  );
  if (file.stat.size !== ref.size || hashBytes(file.bytes) !== ref.checksum) {
    throw new PigeDomainError("collection.file_changed", "A Collection file failed integrity validation.");
  }
}

export function fileRef(bundlePath: string, relativePath: string): FileRef {
  const filePath = resolveBundleRelativePath(bundlePath, relativePath);
  const file = readRegularFile(filePath, MAX_PAYLOAD_BYTES, bundlePath);
  return { path: relativePath, checksum: hashBytes(file.bytes), size: file.stat.size };
}

function readRegularFile(
  filePath: string,
  maximumBytes: number,
  confinementRoot: string
): { readonly bytes: Buffer; readonly stat: fs.Stats } {
  const resolvedRoot = fs.realpathSync(confinementRoot);
  const resolvedParent = fs.realpathSync(path.dirname(filePath));
  const relativeParent = path.relative(resolvedRoot, resolvedParent);
  if (relativeParent === ".." || relativeParent.startsWith(`..${path.sep}`) || path.isAbsolute(relativeParent)) {
    throw payloadInvalid();
  }
  const descriptor = fs.openSync(filePath, noFollowFlag());
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 0 || stat.size > maximumBytes) throw payloadInvalid();
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw payloadInvalid();
      offset += count;
    }
    const after = fs.fstatSync(descriptor);
    if (!sameFileRevision(stat, after)) throw payloadInvalid();
    return { bytes, stat: after };
  } finally {
    fs.closeSync(descriptor);
  }
}

export function readJsonBounded(filePath: string, maximumBytes: number): unknown {
  return JSON.parse(readRegularFile(filePath, maximumBytes, path.dirname(filePath)).bytes.toString("utf8"));
}

export function resolveBundleRelativePath(bundlePath: string, relativePath: string): string {
  if (
    !relativePath ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath) ||
    relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) throw payloadInvalid();
  const resolved = path.resolve(bundlePath, ...relativePath.split("/"));
  const relative = path.relative(path.resolve(bundlePath), resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw payloadInvalid();
  return resolved;
}

export function assertSafeVaultRoot(vaultPath: string): void {
  const stat = fs.lstatSync(vaultPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new PigeDomainError("collection.path_unsafe", "The active vault root is unsafe.");
  }
}

function assertSafeDirectory(vaultPath: string, directoryPath: string): void {
  const stat = fs.lstatSync(directoryPath);
  const relative = path.relative(fs.realpathSync(vaultPath), fs.realpathSync(directoryPath));
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) throw payloadInvalid();
}

function sameFileRevision(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

export function hashCanonical(value: unknown): string {
  return hashBytes(Buffer.from(stableStringify(value), "utf8"));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

function hashBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function checksumFile(filePath: string): string {
  return hashBytes(fs.readFileSync(filePath));
}

export function syncFile(filePath: string): void {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function syncDirectory(directoryPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (caught) {
    if (!isErrno(caught, "EINVAL") && !isErrno(caught, "ENOTSUP") && !isErrno(caught, "EBADF")) throw caught;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function noFollowFlag(): number {
  return fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
}

function isErrno(value: unknown, code: string): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value && (value as NodeJS.ErrnoException).code === code;
}

export function payloadInvalid(): PigeDomainError {
  return new PigeDomainError("collection.payload_invalid", "The Collection payload is invalid.");
}

export function requestConflict(): PigeDomainError {
  return new PigeDomainError("collection.request_conflict", "The Collection request identity was reused with different input.");
}

export function operationConflict(): PigeDomainError {
  return new PigeDomainError("collection.operation_conflict", "The Collection Operation is inconsistent.");
}

const resolveVaultRelativePath = createVaultRelativePathResolver(
  () => new PigeDomainError("collection.path_unsafe", "A Collection path escapes the active vault."),
  { allowVaultRoot: false }
);
