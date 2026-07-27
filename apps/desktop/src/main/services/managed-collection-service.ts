import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  KnowledgeActivitySummary,
  KnowledgeActivityUndoResult,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  CollectionCellEditRequestSchema,
  CollectionCellEditResultSchema,
  CollectionOpenRequestSchema,
  CollectionOpenResultSchema,
  CollectionSnapshotSchema,
  DatasetManifestSchema,
  DatasetRevisionSchema,
  DatasetSchemaRecordSchema,
  OperationRecordSchema,
  SourceRecordSchema,
  type CollectionCell,
  type CollectionCellEditRequest,
  type CollectionCellEditResult,
  type CollectionOpenRequest,
  type CollectionOpenResult,
  type CollectionScalarValue,
  type DatasetColumn,
  type DatasetLogicalType,
  type DatasetManifest,
  type DatasetRevision,
  type DatasetSchemaRecord,
  type OperationRecord
} from "@pige/schemas";
import { createVaultRelativePathResolver } from "./vault-layout";

export interface ManagedCollectionVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export interface ManagedCollectionRecoveryResult {
  readonly recovered: number;
  readonly failed: number;
}

interface FileRef {
  readonly path: string;
  readonly checksum: string;
  readonly size: number;
}

interface BundleBinding {
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

interface CellBinding {
  readonly tableName: string;
  readonly column: DatasetColumn;
  readonly state: string;
  readonly projectionKind: string;
  readonly projectionJson: string | null;
  readonly formulaJson: string | null;
}

interface MutationIdentity {
  readonly revisionId: string;
  readonly operationId: string;
}

const MAX_DATASET_ENTRIES = 10_000;
const MAX_JSON_BYTES = 512 * 1024;
const MAX_PAYLOAD_BYTES = 512 * 1024 * 1024;
const MAX_OPEN_ROWS = 50;
const MAX_OPEN_COLUMNS = 32;
const MAX_STRING_BYTES = 4 * 1024;
const OPERATION_ID = /^op_(\d{8})_[a-z0-9]{8,}$/u;
const REVISION_ID = /^dataset_rev_(\d{8})_[a-z0-9]{12,}$/u;
const EDITABLE_LOGICAL_TYPES = new Set<DatasetLogicalType>([
  "string",
  "integer",
  "number",
  "boolean",
  "date",
  "datetime"
]);

export class ManagedCollectionService {
  readonly #vaults: ManagedCollectionVaultPort;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(vaults: ManagedCollectionVaultPort) {
    this.#vaults = vaults;
  }

  async open(request: CollectionOpenRequest): Promise<CollectionOpenResult> {
    const parsed = CollectionOpenRequestSchema.parse(request);
    const identity = resultIdentity(parsed);
    const active = this.#activeVault(parsed.activeVaultId);
    if (!active) return CollectionOpenResultSchema.parse({ ...identity, status: "stale" });
    try {
      const binding = readBundle(active.vaultPath, parsed.datasetId);
      if (!binding) return CollectionOpenResultSchema.parse({ ...identity, status: "not_found" });
      this.#recoverActiveOperation(binding);
      const snapshot = readSnapshot(binding, parsed.tableId);
      if (!snapshot) return CollectionOpenResultSchema.parse({ ...identity, status: "not_found" });
      if (!this.#activeVault(parsed.activeVaultId)) {
        return CollectionOpenResultSchema.parse({ ...identity, status: "stale" });
      }
      return CollectionOpenResultSchema.parse({ ...identity, status: "ready", snapshot });
    } catch {
      return CollectionOpenResultSchema.parse({ ...identity, status: "failed" });
    }
  }

  async editCell(request: CollectionCellEditRequest): Promise<CollectionCellEditResult> {
    const parsed = CollectionCellEditRequestSchema.parse(request);
    return this.#serialize(() => this.#editCell(parsed));
  }

  activitySummary(
    operation: OperationRecord,
    undoOperation: OperationRecord | undefined
  ): KnowledgeActivitySummary | undefined {
    const binding = readCollectionOperationBinding(operation);
    if (!binding) return undefined;
    const target = {
      kind: "collection" as const,
      datasetId: binding.datasetId,
      tableId: binding.tableId,
      revisionId: undoOperation ? binding.beforeRevisionId : binding.afterRevisionId
    };
    return {
      operationId: operation.id,
      kind: "update_collection_cell",
      createdAt: operation.createdAt,
      targetLabel: "Collection cell",
      target,
      status: undoOperation ? "undone" : "applied",
      canUndo: undoOperation === undefined,
      ...(undoOperation ? { undoUnavailableReason: "already_undone" as const } : {})
    };
  }

  findUndoOperation(
    operation: OperationRecord,
    operations: readonly OperationRecord[]
  ): OperationRecord | undefined {
    const binding = readCollectionOperationBinding(operation);
    if (!binding || binding.changeKind !== "collection_cell_edit") return undefined;
    const undoId = createUndoOperationId(operation.id);
    const candidate = operations.find((entry) => entry.id === undoId);
    return candidate && isMatchingUndoOperation(operation, candidate) ? candidate : undefined;
  }

  async undo(
    operation: OperationRecord,
    expectedRevisionId: string | undefined
  ): Promise<KnowledgeActivityUndoResult> {
    return this.#serialize(async () => {
      const binding = readCollectionOperationBinding(operation);
      if (!binding || binding.changeKind !== "collection_cell_edit") {
        return { status: "not_found", operationId: operation.id };
      }
      if (!expectedRevisionId || expectedRevisionId !== binding.afterRevisionId) {
        const current = this.#readCurrentRevision(binding.datasetId);
        return {
          status: "stale",
          operationId: operation.id,
          ...(current ? { currentRevisionId: current } : {})
        };
      }
      const existing = this.findUndoOperation(operation, readOperationRecords(this.#requireVaultPath()));
      if (existing) {
        const existingBinding = readCollectionOperationBinding(existing);
        if (!existingBinding) throw operationConflict();
        return {
          status: "already_undone",
          operationId: operation.id,
          undoOperationId: existing.id,
          revisionId: existingBinding.afterRevisionId
        };
      }
      const active = this.#activeVault();
      if (!active) return { status: "not_found", operationId: operation.id };
      const current = readBundle(active.vaultPath, binding.datasetId);
      if (!current) return { status: "not_found", operationId: operation.id };
      if (current.manifest.activeRevision !== binding.afterRevisionId) {
        return {
          status: "stale",
          operationId: operation.id,
          currentRevisionId: current.manifest.activeRevision
        };
      }
      const beforeRevision = readRevisionById(current, binding.beforeRevisionId);
      const beforeCell = readCellFromRevision(current, beforeRevision, binding.rowId, binding.columnId);
      if (!beforeCell) throw operationConflict();
      const identity = createUndoIdentity(operation.id, binding.afterRevisionId);
      const committed = commitMutation({
        binding: current,
        identity,
        tableId: binding.tableId,
        rowId: binding.rowId,
        columnId: binding.columnId,
        value: parseCellValue(beforeCell, beforeCell.column.logicalType),
        expectedRevisionId: binding.afterRevisionId,
        change: { kind: "collection_cell_undo", undoOfOperationId: operation.id }
      });
      return {
        status: "undone",
        operationId: operation.id,
        undoOperationId: committed.operation.id,
        revisionId: committed.revision.id
      };
    });
  }

  recoverIncompleteOperations(): ManagedCollectionRecoveryResult {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0;
    let failed = 0;
    for (const binding of readAllBundles(vaultPath)) {
      try {
        if (this.#recoverActiveOperation(binding)) recovered += 1;
      } catch {
        failed += 1;
      }
    }
    return { recovered, failed };
  }

  async #editCell(request: CollectionCellEditRequest): Promise<CollectionCellEditResult> {
    const identity = editResultIdentity(request);
    const active = this.#activeVault(request.activeVaultId);
    if (!active) return CollectionCellEditResultSchema.parse({ ...identity, status: "stale", currentRevisionId: request.expectedRevisionId });
    try {
      const binding = readBundle(active.vaultPath, request.datasetId);
      if (!binding) return CollectionCellEditResultSchema.parse({ ...identity, status: "not_found" });
      const mutationIdentity = createEditIdentity(request);
      const adopted = adoptExistingMutation(binding, request, mutationIdentity);
      if (adopted) return CollectionCellEditResultSchema.parse({ ...identity, ...adopted });
      if (binding.manifest.activeRevision !== request.expectedRevisionId) {
        return CollectionCellEditResultSchema.parse({
          ...identity,
          status: "stale",
          currentRevisionId: binding.manifest.activeRevision
        });
      }
      const cell = readCell(binding, request.tableId, request.rowId, request.columnId);
      if (!cell) return CollectionCellEditResultSchema.parse({ ...identity, status: "not_found" });
      const readOnlyReason = cellReadOnlyReason(cell);
      if (readOnlyReason) {
        return CollectionCellEditResultSchema.parse({ ...identity, status: "not_editable", reason: readOnlyReason });
      }
      const invalidReason = validateScalar(request.value, cell.column.logicalType);
      if (invalidReason) {
        return CollectionCellEditResultSchema.parse({ ...identity, status: "invalid", reason: invalidReason });
      }
      const committed = commitMutation({
        binding,
        identity: mutationIdentity,
        tableId: request.tableId,
        rowId: request.rowId,
        columnId: request.columnId,
        value: request.value,
        expectedRevisionId: request.expectedRevisionId,
        change: { kind: "collection_cell_edit" }
      });
      if (!this.#activeVault(request.activeVaultId)) {
        return CollectionCellEditResultSchema.parse({ ...identity, status: "failed" });
      }
      return CollectionCellEditResultSchema.parse({
        ...identity,
        status: "committed",
        revisionId: committed.revision.id,
        operationId: committed.operation.id
      });
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "collection.request_conflict") throw caught;
      return CollectionCellEditResultSchema.parse({ ...identity, status: "failed" });
    }
  }

  #recoverActiveOperation(binding: BundleBinding): boolean {
    if (!binding.revision.change || binding.revision.change.kind === "initial_import") return false;
    const operationPath = operationPathFor(binding.vaultPath, binding.revision.operationId);
    if (fs.existsSync(operationPath)) {
      const operation = OperationRecordSchema.parse(readJsonBounded(operationPath, MAX_JSON_BYTES));
      assertOperationMatchesRevision(binding, operation);
      return false;
    }
    const operation = createOperationForRevision(binding, binding.revision);
    writeJsonExclusive(operationPath, operation);
    return true;
  }

  #readCurrentRevision(datasetId: string): string | undefined {
    const active = this.#activeVault();
    return active ? readBundle(active.vaultPath, datasetId)?.manifest.activeRevision : undefined;
  }

  #activeVault(expectedVaultId?: string): { readonly vaultPath: string } | undefined {
    const current = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!current || !vaultPath || (expectedVaultId && current.vaultId !== expectedVaultId)) return undefined;
    assertSafeVaultRoot(vaultPath);
    return { vaultPath };
  }

  #requireVaultPath(): string {
    const active = this.#activeVault();
    if (!active) throw new PigeDomainError("vault.not_open", "Open a vault before changing a Collection.");
    return active.vaultPath;
  }

  async #serialize<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.#mutationTail;
    let release!: () => void;
    this.#mutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}

interface CommitMutationInput {
  readonly binding: BundleBinding;
  readonly identity: MutationIdentity;
  readonly tableId: string;
  readonly rowId: string;
  readonly columnId: string;
  readonly value: CollectionScalarValue;
  readonly expectedRevisionId: string;
  readonly change:
    | { readonly kind: "collection_cell_edit" }
    | { readonly kind: "collection_cell_undo"; readonly undoOfOperationId: string };
}

function commitMutation(input: CommitMutationInput): {
  readonly revision: DatasetRevision;
  readonly operation: OperationRecord;
} {
  const current = readBundle(input.binding.vaultPath, input.binding.manifest.datasetId);
  if (!current || current.manifest.activeRevision !== input.expectedRevisionId) {
    throw new PigeDomainError("collection.revision_changed", "The Collection revision changed before commit.");
  }
  const currentCell = readCell(current, input.tableId, input.rowId, input.columnId);
  if (!currentCell) throw new PigeDomainError("collection.cell_not_found", "The Collection cell is unavailable.");
  const stagedRoot = path.join(current.bundlePath, ".staging", `${input.identity.revisionId}.${randomUUID()}`);
  const payloadRelativePath = `data/revisions/${input.identity.revisionId}.sqlite`;
  const schemaRelativePath = `schemas/${input.identity.revisionId}.json`;
  const revisionRelativePath = `revisions/${input.identity.revisionId}.json`;
  const stagedPayload = path.join(stagedRoot, "payload.sqlite");
  fs.mkdirSync(stagedRoot, { recursive: true, mode: 0o700 });
  try {
    fs.copyFileSync(current.payloadPath, stagedPayload);
    mutatePayload(stagedPayload, input.identity.revisionId, input.rowId, currentCell, input.value);
    const schema = createNextSchema(current.schema, input.identity.revisionId, currentCell, input.value);
    const finalPayload = resolveBundleRelativePath(current.bundlePath, payloadRelativePath);
    const finalSchema = resolveBundleRelativePath(current.bundlePath, schemaRelativePath);
    const finalRevision = resolveBundleRelativePath(current.bundlePath, revisionRelativePath);
    publishImmutableFile(stagedPayload, finalPayload);
    writeJsonImmutable(finalSchema, schema);
    const now = new Date().toISOString();
    const revision = DatasetRevisionSchema.parse({
      ...current.revision,
      id: input.identity.revisionId,
      parentRevisionId: current.revision.id,
      schema: fileRef(current.bundlePath, schemaRelativePath),
      payload: { ...fileRef(current.bundlePath, payloadRelativePath), format: "sqlite" },
      operationId: input.identity.operationId,
      change: {
        ...input.change,
        tableId: input.tableId,
        rowId: input.rowId,
        columnId: input.columnId
      },
      createdAt: now
    });
    writeJsonImmutable(finalRevision, revision);
    const revisionRef = fileRef(current.bundlePath, revisionRelativePath);
    const nextManifest = DatasetManifestSchema.parse({
      ...current.manifest,
      initialRevision: current.manifest.initialRevision ?? current.manifest.activeRevision,
      activeRevision: revision.id,
      revision: revisionRef,
      schema: revision.schema,
      payload: revision.payload,
      updatedAt: now
    });
    replaceManifestCas(current, nextManifest);
    const committed = readBundle(current.vaultPath, current.manifest.datasetId);
    if (!committed || committed.manifest.activeRevision !== revision.id) {
      throw new PigeDomainError("collection.commit_uncertain", "The Collection commit could not be adopted.");
    }
    const operation = createOperationForRevision(committed, revision);
    writeJsonExclusive(operationPathFor(current.vaultPath, operation.id), operation);
    return { revision, operation };
  } finally {
    fs.rmSync(stagedRoot, { recursive: true, force: true });
  }
}

function readSnapshot(binding: BundleBinding, tableId: string) {
  const table = binding.schema.tables.find((candidate) => candidate.id === tableId);
  if (!table) return undefined;
  const columns = table.columns.slice(0, MAX_OPEN_COLUMNS);
  if (columns.length === 0) return undefined;
  const database = openReadOnlyPayload(binding.payloadPath);
  try {
    validatePayloadMeta(database, binding.manifest.datasetId, binding.revision.id);
    const rows = database.prepare(
      `SELECT row_id FROM pige_dataset_rows WHERE table_id = ? ORDER BY ordinal ASC LIMIT ${MAX_OPEN_ROWS}`
    ).all(tableId) as Array<{ row_id?: unknown }>;
    const readCellStatement = database.prepare([
      "SELECT state, projection_kind, projection_json, formula_json",
      "FROM pige_dataset_cells WHERE row_id = ? AND column_id = ?"
    ].join(" "));
    const projectedRows = rows.map((row) => {
      if (typeof row.row_id !== "string") throw payloadInvalid();
      const rowId = row.row_id;
      const cells = columns.map((column): CollectionCell => {
        const raw = readCellStatement.get(rowId, column.id) as Record<string, unknown> | undefined;
        if (!raw) throw payloadInvalid();
        const cell = parseCellRecord(column, raw);
        const reason = cellReadOnlyReason(cell);
        return {
          columnId: column.id,
          value: parseCellValue(cell, column.logicalType),
          editable: reason === undefined,
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
      truncated: table.rowCount > projectedRows.length
    });
  } finally {
    database.close();
  }
}

function readCell(
  binding: BundleBinding,
  tableId: string,
  rowId: string,
  columnId: string
): CellBinding | undefined {
  const table = binding.schema.tables.find((candidate) => candidate.id === tableId);
  const column = table?.columns.find((candidate) => candidate.id === columnId);
  if (!table || !column) return undefined;
  const database = openReadOnlyPayload(binding.payloadPath);
  try {
    validatePayloadMeta(database, binding.manifest.datasetId, binding.revision.id);
    const row = database.prepare(
      "SELECT table_id FROM pige_dataset_rows WHERE row_id = ?"
    ).get(rowId) as { table_id?: unknown } | undefined;
    if (row?.table_id !== tableId) return undefined;
    const raw = database.prepare([
      "SELECT state, projection_kind, projection_json, formula_json",
      "FROM pige_dataset_cells WHERE row_id = ? AND column_id = ?"
    ].join(" ")).get(rowId, columnId) as Record<string, unknown> | undefined;
    return raw ? { tableName: table.name, ...parseCellRecord(column, raw) } : undefined;
  } finally {
    database.close();
  }
}

function readCellFromRevision(
  binding: BundleBinding,
  revision: DatasetRevision,
  rowId: string,
  columnId: string
): CellBinding | undefined {
  const schema = DatasetSchemaRecordSchema.parse(readJsonRef(binding.bundlePath, revision.schema));
  const table = schema.tables.find((candidate) => candidate.columns.some((column) => column.id === columnId));
  const column = table?.columns.find((candidate) => candidate.id === columnId);
  if (!table || !column) return undefined;
  const payloadPath = resolveBundleRelativePath(binding.bundlePath, revision.payload.path);
  assertFileRef(binding.bundlePath, revision.payload);
  const database = openReadOnlyPayload(payloadPath);
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

function parseCellRecord(column: DatasetColumn, raw: Record<string, unknown>): Omit<CellBinding, "tableName"> {
  if (
    typeof raw.state !== "string" ||
    typeof raw.projection_kind !== "string" ||
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

function parseCellValue(cell: Omit<CellBinding, "tableName">, logicalType: DatasetLogicalType): CollectionScalarValue {
  if (cell.state === "missing" || cell.state === "null") return null;
  if (typeof cell.projectionJson !== "string") throw payloadInvalid();
  let projection: unknown;
  try {
    projection = JSON.parse(cell.projectionJson);
  } catch {
    throw payloadInvalid();
  }
  if (!projection || typeof projection !== "object" || Array.isArray(projection)) throw payloadInvalid();
  const value = (projection as Record<string, unknown>).value;
  switch (logicalType) {
    case "string":
    case "integer":
    case "date":
    case "datetime":
      if (typeof value !== "string") throw payloadInvalid();
      return value;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) throw payloadInvalid();
      return value;
    case "boolean":
      if (typeof value !== "boolean") throw payloadInvalid();
      return value;
    case "binary":
      if (typeof value !== "string") throw payloadInvalid();
      return value;
    case "unknown":
      throw payloadInvalid();
  }
}

function cellReadOnlyReason(cell: Omit<CellBinding, "tableName">): "formula" | "unsupported_type" | undefined {
  if (cell.formulaJson !== null) return "formula";
  return EDITABLE_LOGICAL_TYPES.has(cell.column.logicalType) ? undefined : "unsupported_type";
}

function validateScalar(
  value: CollectionScalarValue,
  logicalType: DatasetLogicalType
): "type_mismatch" | "value_too_large" | undefined {
  if (value === null) return undefined;
  if (typeof value === "string" && Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES) return "value_too_large";
  switch (logicalType) {
    case "string":
      return typeof value === "string" ? undefined : "type_mismatch";
    case "integer":
      return typeof value === "string" && /^-?(?:0|[1-9][0-9]*)$/u.test(value) ? undefined : "type_mismatch";
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? undefined : "type_mismatch";
    case "boolean":
      return typeof value === "boolean" ? undefined : "type_mismatch";
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? undefined : "type_mismatch";
    case "datetime":
      return typeof value === "string" && Number.isFinite(Date.parse(value)) ? undefined : "type_mismatch";
    case "binary":
    case "unknown":
      return "type_mismatch";
  }
}

function mutatePayload(
  payloadPath: string,
  revisionId: string,
  rowId: string,
  cell: CellBinding,
  value: CollectionScalarValue
): void {
  const database = new DatabaseSync(payloadPath);
  try {
    database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    validatePayloadMeta(database, undefined, undefined);
    const encoded = encodeCellValue(value, cell.column.logicalType);
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = database.prepare([
        "UPDATE pige_dataset_cells SET state = ?, source_type = ?, lexical_raw = NULL, lexical_text = NULL,",
        "quoted = NULL, projection_kind = ?, projection_json = ?, formula_json = NULL, source_style_json = NULL",
        "WHERE row_id = ? AND column_id = ? AND formula_json IS NULL"
      ].join(" ")).run(
        encoded.state,
        "pige_user_edit",
        encoded.projectionKind,
        encoded.projectionJson,
        rowId,
        cell.column.id
      );
      if (result.changes !== 1) throw new PigeDomainError("collection.cell_changed", "The Collection cell changed before commit.");
      const meta = database.prepare("UPDATE pige_dataset_meta SET value = ? WHERE key = 'revision_id'").run(revisionId);
      if (meta.changes !== 1) throw payloadInvalid();
      database.exec("COMMIT");
    } catch (caught) {
      database.exec("ROLLBACK");
      throw caught;
    }
    const integrity = database.prepare("PRAGMA integrity_check").get() as { integrity_check?: unknown } | undefined;
    if (integrity?.integrity_check !== "ok") throw payloadInvalid();
  } finally {
    database.close();
  }
  syncFile(payloadPath);
}

function encodeCellValue(value: CollectionScalarValue, logicalType: DatasetLogicalType): {
  readonly state: "null" | "empty" | "value";
  readonly projectionKind: string;
  readonly projectionJson: string | null;
} {
  if (value === null) return { state: "null", projectionKind: "null", projectionJson: null };
  switch (logicalType) {
    case "string":
      return {
        state: value === "" ? "empty" : "value",
        projectionKind: "text",
        projectionJson: JSON.stringify({ kind: "text", value })
      };
    case "integer":
      return { state: "value", projectionKind: "integer", projectionJson: JSON.stringify({ kind: "integer", value }) };
    case "number":
      return { state: "value", projectionKind: "real", projectionJson: JSON.stringify({ kind: "real", value }) };
    case "boolean":
      return { state: "value", projectionKind: "boolean", projectionJson: JSON.stringify({ kind: "boolean", value }) };
    case "date":
      return { state: "value", projectionKind: "date", projectionJson: JSON.stringify({ kind: "date", value }) };
    case "datetime":
      return { state: "value", projectionKind: "datetime", projectionJson: JSON.stringify({ kind: "datetime", value }) };
    case "binary":
    case "unknown":
      throw new PigeDomainError("collection.type_mismatch", "The Collection cell type is not editable.");
  }
}

function createNextSchema(
  current: DatasetSchemaRecord,
  revisionId: string,
  cell: CellBinding,
  value: CollectionScalarValue
): DatasetSchemaRecord {
  const oldState = normalizedState(cell.state);
  const newState = value === null ? "null" : value === "" && cell.column.logicalType === "string" ? "empty" : "value";
  return DatasetSchemaRecordSchema.parse({
    ...current,
    revisionId,
    createdAt: new Date().toISOString(),
    tables: current.tables.map((table) => ({
      ...table,
      columns: table.columns.map((column) => {
        if (column.id !== cell.column.id || !column.stats || oldState === newState) return column;
        return {
          ...column,
          stats: {
            ...column.stats,
            [oldState]: Math.max(0, column.stats[oldState] - 1),
            [newState]: column.stats[newState] + 1
          }
        };
      })
    }))
  });
}

function normalizedState(value: string): "missing" | "empty" | "null" | "value" {
  if (value === "missing" || value === "empty" || value === "null" || value === "value") return value;
  throw payloadInvalid();
}

function adoptExistingMutation(
  binding: BundleBinding,
  request: CollectionCellEditRequest,
  identity: MutationIdentity
): Pick<CollectionCellEditResult, "status"> & Partial<CollectionCellEditResult> | undefined {
  const revisionPath = resolveBundleRelativePath(binding.bundlePath, `revisions/${identity.revisionId}.json`);
  const operationPath = operationPathFor(binding.vaultPath, identity.operationId);
  if (!fs.existsSync(revisionPath) && !fs.existsSync(operationPath)) return undefined;
  if (!fs.existsSync(revisionPath)) throw requestConflict();
  const revision = DatasetRevisionSchema.parse(readJsonBounded(revisionPath, MAX_JSON_BYTES));
  if (
    revision.id !== identity.revisionId ||
    revision.operationId !== identity.operationId ||
    revision.parentRevisionId !== request.expectedRevisionId ||
    revision.change?.kind !== "collection_cell_edit" ||
    revision.change.tableId !== request.tableId ||
    revision.change.rowId !== request.rowId ||
    revision.change.columnId !== request.columnId
  ) throw requestConflict();
  const cell = readCellFromRevision(binding, revision, request.rowId, request.columnId);
  if (!cell || hashCanonical(parseCellValue(cell, cell.column.logicalType)) !== hashCanonical(request.value)) {
    throw requestConflict();
  }
  let committedBinding = binding;
  if (binding.manifest.activeRevision !== revision.id) {
    if (binding.manifest.activeRevision !== request.expectedRevisionId) {
      return {
        status: "stale",
        currentRevisionId: binding.manifest.activeRevision
      } as Pick<CollectionCellEditResult, "status"> & Partial<CollectionCellEditResult>;
    }
    const revisionRelativePath = `revisions/${revision.id}.json`;
    replaceManifestCas(binding, DatasetManifestSchema.parse({
      ...binding.manifest,
      initialRevision: binding.manifest.initialRevision ?? binding.manifest.activeRevision,
      activeRevision: revision.id,
      revision: fileRef(binding.bundlePath, revisionRelativePath),
      schema: revision.schema,
      payload: revision.payload,
      updatedAt: revision.createdAt
    }));
    const adoptedBinding = readBundle(binding.vaultPath, binding.manifest.datasetId);
    if (!adoptedBinding || adoptedBinding.manifest.activeRevision !== revision.id) {
      throw new PigeDomainError("collection.commit_uncertain", "The Collection replay could not be adopted.");
    }
    committedBinding = adoptedBinding;
  }
  const operation = fs.existsSync(operationPath)
    ? OperationRecordSchema.parse(readJsonBounded(operationPath, MAX_JSON_BYTES))
    : createOperationForRevision(committedBinding, revision);
  assertOperationMatchesRevision({ ...committedBinding, revision }, operation);
  if (!fs.existsSync(operationPath)) writeJsonExclusive(operationPath, operation);
  return {
    status: "committed",
    revisionId: revision.id,
    operationId: operation.id
  } as Pick<CollectionCellEditResult, "status"> & Partial<CollectionCellEditResult>;
}

function createEditIdentity(request: CollectionCellEditRequest): MutationIdentity {
  const dateKey = REVISION_ID.exec(request.expectedRevisionId)?.[1];
  if (!dateKey) throw requestConflict();
  const suffix = digest("pige:collection-edit:v1", request.requestId).slice(0, 20);
  return {
    revisionId: `dataset_rev_${dateKey}_${suffix}`,
    operationId: `op_${dateKey}_${digest("pige:collection-edit-operation:v1", request.requestId).slice(0, 20)}`
  };
}

function createUndoIdentity(operationId: string, revisionId: string): MutationIdentity {
  const dateKey = REVISION_ID.exec(revisionId)?.[1];
  if (!dateKey) throw operationConflict();
  return {
    revisionId: `dataset_rev_${dateKey}_${digest("pige:collection-undo:v1", operationId).slice(0, 20)}`,
    operationId: createUndoOperationId(operationId)
  };
}

function createUndoOperationId(operationId: string): string {
  const dateKey = OPERATION_ID.exec(operationId)?.[1];
  if (!dateKey) throw operationConflict();
  return `op_${dateKey}_${digest("pige:collection-undo-operation:v1", operationId).slice(0, 20)}`;
}

function readBundle(vaultPath: string, datasetId: string): BundleBinding | undefined {
  return readAllBundles(vaultPath).find((binding) => binding.manifest.datasetId === datasetId);
}

function readAllBundles(vaultPath: string): BundleBinding[] {
  assertSafeVaultRoot(vaultPath);
  const datasetsRoot = resolveVaultRelativePath(vaultPath, "datasets");
  if (!fs.existsSync(datasetsRoot)) return [];
  assertSafeDirectory(vaultPath, datasetsRoot);
  const entries = fs.readdirSync(datasetsRoot, { withFileTypes: true });
  if (entries.length > MAX_DATASET_ENTRIES) throw new PigeDomainError("collection.limit", "The Dataset directory is too large.");
  const result: BundleBinding[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const bundlePath = path.join(datasetsRoot, entry.name);
    assertSafeDirectory(vaultPath, bundlePath);
    const manifestPath = path.join(bundlePath, "dataset.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifestFile = readRegularFile(manifestPath, MAX_JSON_BYTES, bundlePath);
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
  const identities = new Set(result.map((binding) => binding.manifest.datasetId));
  if (identities.size !== result.length) throw new PigeDomainError("collection.identity_conflict", "Dataset identities are not unique.");
  return result;
}

function readRevisionById(binding: BundleBinding, revisionId: string): DatasetRevision {
  const revisionPath = resolveBundleRelativePath(binding.bundlePath, `revisions/${revisionId}.json`);
  if (!fs.existsSync(revisionPath)) throw operationConflict();
  const revision = DatasetRevisionSchema.parse(readJsonBounded(revisionPath, MAX_JSON_BYTES));
  if (revision.id !== revisionId || revision.datasetId !== binding.manifest.datasetId) throw operationConflict();
  assertFileRef(binding.bundlePath, revision.schema);
  assertFileRef(binding.bundlePath, revision.payload);
  return revision;
}

interface CollectionOperationBinding {
  readonly datasetId: string;
  readonly tableId: string;
  readonly rowId: string;
  readonly columnId: string;
  readonly beforeRevisionId: string;
  readonly afterRevisionId: string;
  readonly changeKind: "collection_cell_edit" | "collection_cell_undo";
}

function createOperationForRevision(
  binding: BundleBinding,
  revision: DatasetRevision
): OperationRecord {
  const change = revision.change;
  if (!change || change.kind === "initial_import" || !revision.parentRevisionId) throw operationConflict();
  const beforeRevision = readRevisionById(binding, revision.parentRevisionId);
  const schema = DatasetSchemaRecordSchema.parse(readJsonRef(binding.bundlePath, revision.schema));
  const column = schema.tables
    .find((table) => table.id === change.tableId)
    ?.columns.find((candidate) => candidate.id === change.columnId);
  if (!column) throw operationConflict();
  const revisionRelativePath = `revisions/${revision.id}.json`;
  const beforeRelativePath = `revisions/${beforeRevision.id}.json`;
  const targetRefs = [
    { kind: "dataset" as const, id: revision.datasetId, path: binding.bundleRelativePath },
    { kind: "dataset_revision" as const, id: revision.id, path: `${binding.bundleRelativePath}/${revisionRelativePath}`, checksum: fileRef(binding.bundlePath, revisionRelativePath).checksum },
    { kind: "table" as const, id: change.tableId },
    { kind: "row" as const, id: change.rowId },
    { kind: "column" as const, id: change.columnId }
  ];
  const sourceRefs = [
    { kind: "dataset_revision" as const, id: beforeRevision.id, path: `${binding.bundleRelativePath}/${beforeRelativePath}`, checksum: fileRef(binding.bundlePath, beforeRelativePath).checksum },
    ...(change.kind === "collection_cell_undo"
      ? [{ kind: "operation" as const, id: change.undoOfOperationId }]
      : [])
  ];
  return OperationRecordSchema.parse({
    id: revision.operationId,
    schemaVersion: 1,
    createdAt: revision.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "update_collection_cell",
    targetRefs,
    sourceRefs,
    before: sourceRefs[0],
    after: targetRefs[1],
    summary: change.kind === "collection_cell_undo"
      ? `Restored one Collection cell through forward revision ${revision.id}.`
      : `Updated one Collection cell through immutable revision ${revision.id}.`,
    reversible: change.kind === "collection_cell_undo" ? "best_effort" : "yes",
    rollbackHint: "Create another revision only while this Operation's after-revision remains current.",
    warnings: []
  });
}

function readCollectionOperationBinding(operation: OperationRecord): CollectionOperationBinding | undefined {
  if (operation.kind !== "update_collection_cell") return undefined;
  const dataset = operation.targetRefs.find((ref) => ref.kind === "dataset");
  const after = operation.after?.kind === "dataset_revision" ? operation.after : undefined;
  const before = operation.before?.kind === "dataset_revision" ? operation.before : undefined;
  const table = operation.targetRefs.find((ref) => ref.kind === "table");
  const row = operation.targetRefs.find((ref) => ref.kind === "row");
  const column = operation.targetRefs.find((ref) => ref.kind === "column");
  if (!dataset || !before || !after || !table || !row || !column) return undefined;
  const revisionId = after.id;
  const revisionDate = REVISION_ID.exec(revisionId);
  if (!revisionDate) return undefined;
  const sourceOperation = operation.sourceRefs.find((ref) => ref.kind === "operation");
  return {
    datasetId: dataset.id,
    tableId: table.id,
    rowId: row.id,
    columnId: column.id,
    beforeRevisionId: before.id,
    afterRevisionId: after.id,
    changeKind: sourceOperation ? "collection_cell_undo" : "collection_cell_edit"
  };
}

function isMatchingUndoOperation(original: OperationRecord, candidate: OperationRecord): boolean {
  const originalBinding = readCollectionOperationBinding(original);
  const candidateBinding = readCollectionOperationBinding(candidate);
  return originalBinding !== undefined && candidateBinding !== undefined &&
    candidate.id === createUndoOperationId(original.id) &&
    candidateBinding.changeKind === "collection_cell_undo" &&
    candidateBinding.datasetId === originalBinding.datasetId &&
    candidateBinding.tableId === originalBinding.tableId &&
    candidateBinding.rowId === originalBinding.rowId &&
    candidateBinding.columnId === originalBinding.columnId &&
    candidateBinding.beforeRevisionId === originalBinding.afterRevisionId &&
    candidate.sourceRefs.some((ref) => ref.kind === "operation" && ref.id === original.id);
}

function assertOperationMatchesRevision(binding: BundleBinding, operation: OperationRecord): void {
  if (operation.id !== binding.revision.operationId) throw operationConflict();
  const parsed = createOperationForRevision(binding, binding.revision);
  if (hashCanonical(operation) !== hashCanonical(parsed)) throw operationConflict();
}

function replaceManifestCas(binding: BundleBinding, next: DatasetManifest): void {
  const current = readRegularFile(binding.manifestPath, MAX_JSON_BYTES, binding.bundlePath);
  if (
    !current.bytes.equals(binding.manifestBytes) ||
    !sameFileRevision(current.stat, binding.manifestStat)
  ) throw new PigeDomainError("collection.revision_changed", "The Collection manifest changed before commit.");
  const temporaryPath = `${binding.manifestPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    syncFile(temporaryPath);
    const verify = readRegularFile(binding.manifestPath, MAX_JSON_BYTES, binding.bundlePath);
    if (!verify.bytes.equals(binding.manifestBytes) || !sameFileRevision(verify.stat, binding.manifestStat)) {
      throw new PigeDomainError("collection.revision_changed", "The Collection manifest changed before publication.");
    }
    fs.renameSync(temporaryPath, binding.manifestPath);
    syncDirectory(path.dirname(binding.manifestPath));
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function publishImmutableFile(stagedPath: string, destinationPath: string): void {
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

function writeJsonImmutable(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    fs.writeFileSync(filePath, bytes, { flag: "wx", mode: 0o600 });
    syncFile(filePath);
    syncDirectory(path.dirname(filePath));
  } catch (caught) {
    if (!isErrno(caught, "EEXIST")) throw caught;
    const existing = readRegularFile(filePath, MAX_JSON_BYTES, path.dirname(filePath));
    if (!existing.bytes.equals(bytes)) throw requestConflict();
  }
}

function writeJsonExclusive(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const expected = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    fs.writeFileSync(filePath, expected, { flag: "wx", mode: 0o600 });
    syncFile(filePath);
    syncDirectory(path.dirname(filePath));
  } catch (caught) {
    if (!isErrno(caught, "EEXIST")) throw caught;
    const existing = readRegularFile(filePath, MAX_JSON_BYTES, path.dirname(filePath));
    if (!existing.bytes.equals(expected)) throw operationConflict();
  }
}

function operationPathFor(vaultPath: string, operationId: string): string {
  const dateKey = OPERATION_ID.exec(operationId)?.[1];
  if (!dateKey) throw operationConflict();
  return resolveVaultRelativePath(
    vaultPath,
    `.pige/operations/${dateKey.slice(0, 4)}/${dateKey.slice(4, 6)}/${operationId}.json`
  );
}

function readOperationRecords(vaultPath: string): OperationRecord[] {
  const root = resolveVaultRelativePath(vaultPath, ".pige/operations");
  if (!fs.existsSync(root)) return [];
  const result: OperationRecord[] = [];
  const stack = [root];
  let seen = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      seen += 1;
      if (seen > MAX_DATASET_ENTRIES) throw new PigeDomainError("collection.limit", "The Operation store is too large.");
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        try {
          result.push(OperationRecordSchema.parse(readJsonBounded(absolute, MAX_JSON_BYTES)));
        } catch {
          // Activity separately reports malformed records; Collection adoption ignores them.
        }
      }
    }
  }
  return result;
}

function openReadOnlyPayload(filePath: string): DatabaseSync {
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

function validatePayloadMeta(database: DatabaseSync, datasetId?: string, revisionId?: string): void {
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

function readJsonRef(bundlePath: string, ref: FileRef): unknown {
  assertFileRef(bundlePath, ref);
  return readJsonBounded(resolveBundleRelativePath(bundlePath, ref.path), MAX_JSON_BYTES);
}

function assertFileRef(bundlePath: string, ref: FileRef): void {
  const filePath = resolveBundleRelativePath(bundlePath, ref.path);
  const file = readRegularFile(filePath, Math.max(MAX_JSON_BYTES, Math.min(MAX_PAYLOAD_BYTES, ref.size)), bundlePath);
  if (file.stat.size !== ref.size || hashBytes(file.bytes) !== ref.checksum) {
    throw new PigeDomainError("collection.file_changed", "A Collection file failed integrity validation.");
  }
}

function fileRef(bundlePath: string, relativePath: string): FileRef {
  const filePath = resolveBundleRelativePath(bundlePath, relativePath);
  const file = readRegularFile(filePath, MAX_PAYLOAD_BYTES, bundlePath);
  return { path: relativePath, checksum: hashBytes(file.bytes), size: file.stat.size };
}

function readRegularFile(
  filePath: string,
  maximumBytes: number,
  confinedRoot: string
): { readonly bytes: Buffer; readonly stat: fs.Stats } {
  const resolvedRoot = fs.realpathSync(confinedRoot);
  const parent = path.dirname(filePath);
  const realParent = fs.realpathSync(parent);
  if (realParent !== resolvedRoot && !realParent.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new PigeDomainError("collection.path_unsafe", "A Collection path escapes its durable root.");
  }
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes) throw payloadInvalid();
  const handle = fs.openSync(filePath, fs.constants.O_RDONLY | noFollowFlag());
  try {
    const descriptor = fs.fstatSync(handle);
    if (!descriptor.isFile() || descriptor.dev !== stat.dev || descriptor.ino !== stat.ino || descriptor.size !== stat.size) {
      throw new PigeDomainError("collection.file_changed", "A Collection file changed while it was read.");
    }
    const bytes = fs.readFileSync(handle);
    const after = fs.fstatSync(handle);
    if (after.size !== descriptor.size || after.mtimeMs !== descriptor.mtimeMs || bytes.byteLength !== descriptor.size) {
      throw new PigeDomainError("collection.file_changed", "A Collection file changed while it was read.");
    }
    return { bytes, stat: descriptor };
  } finally {
    fs.closeSync(handle);
  }
}

function readJsonBounded(filePath: string, maximumBytes: number): unknown {
  const root = path.dirname(filePath);
  return JSON.parse(readRegularFile(filePath, maximumBytes, root).bytes.toString("utf8"));
}

function resolveBundleRelativePath(bundlePath: string, relativePath: string): string {
  if (path.isAbsolute(relativePath) || relativePath.includes("\\") || relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new PigeDomainError("collection.path_unsafe", "Collection paths must be confined relative POSIX paths.");
  }
  const root = path.resolve(bundlePath);
  const resolved = path.resolve(root, ...relativePath.split("/"));
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new PigeDomainError("collection.path_unsafe", "A Collection path escapes its Bundle.");
  }
  return resolved;
}

const resolveVaultRelativePath = createVaultRelativePathResolver(
  () => new PigeDomainError("collection.path_unsafe", "A Collection path escapes the active vault."),
  { allowVaultRoot: false }
);

function assertSafeVaultRoot(vaultPath: string): void {
  const stat = fs.lstatSync(vaultPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new PigeDomainError("collection.path_unsafe", "The active vault root is unsafe.");
  }
}

function assertSafeDirectory(vaultPath: string, directoryPath: string): void {
  const realVault = fs.realpathSync(vaultPath);
  const stat = fs.lstatSync(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new PigeDomainError("collection.path_unsafe", "A Collection directory is unsafe.");
  const real = fs.realpathSync(directoryPath);
  if (real !== realVault && !real.startsWith(`${realVault}${path.sep}`)) {
    throw new PigeDomainError("collection.path_unsafe", "A Collection directory escapes the active vault.");
  }
}

function resultIdentity(request: CollectionOpenRequest) {
  return {
    apiVersion: 1 as const,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId
  };
}

function editResultIdentity(request: CollectionCellEditRequest) {
  return {
    apiVersion: 1 as const,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    rowId: request.rowId,
    columnId: request.columnId
  };
}

function sameFileRevision(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function digest(...parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
}

function hashCanonical(value: unknown): string {
  return hashBytes(Buffer.from(stableStringify(value), "utf8"));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function checksumFile(filePath: string): string {
  return hashBytes(fs.readFileSync(filePath));
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
  if (process.platform === "win32") return;
  const descriptor = fs.openSync(directoryPath, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function noFollowFlag(): number {
  return typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
}

function isErrno(value: unknown, code: string): value is NodeJS.ErrnoException {
  return typeof value === "object" && value !== null && "code" in value && (value as { code?: unknown }).code === code;
}

function payloadInvalid(): PigeDomainError {
  return new PigeDomainError("collection.payload_invalid", "The Collection payload is invalid.");
}

function requestConflict(): PigeDomainError {
  return new PigeDomainError("collection.request_conflict", "The Collection request identity conflicts with a durable mutation.");
}

function operationConflict(): PigeDomainError {
  return new PigeDomainError("activity.operation_conflict", "The Collection Operation binding is inconsistent.");
}
