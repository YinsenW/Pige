import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PigeDomainError } from "@pige/domain";
import {
  CollectionRenameColumnResultSchema,
  CollectionTrashColumnResultSchema,
  DatasetManifestSchema,
  DatasetRevisionSchema,
  DatasetSchemaRecordSchema,
  OperationRecordSchema,
  type CollectionRenameColumnRequest,
  type CollectionRenameColumnResult,
  type CollectionTrashColumnRequest,
  type CollectionTrashColumnResult,
  type DatasetColumn,
  type DatasetLogicalType,
  type DatasetRevision,
  type DatasetSchemaRecord,
  type OperationRecord
} from "@pige/schemas";
import {
  MAX_COLLECTION_JSON_BYTES,
  adoptColumnRenameMutation,
  columnUsesImportedFormula,
  fileRef,
  hashCanonical,
  operationConflict,
  operationPathFor,
  payloadInvalid,
  publishImmutableFile,
  readBundle,
  readCollectionSnapshot,
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
  type BundleBinding, type CollectionColumnMutationIdentity
} from "./managed-collection-storage";
import { assertRelationTrashGuards } from "./managed-collection-relation-storage";
import { assertRollupTrashGuards } from "./managed-collection-rollup-storage";
import { formulaReferencedColumnIds } from "./managed-collection-formula-storage";

const MAX_OPEN_COLUMNS = 32;

export function executeColumnRename(input: {
  readonly vaultPath: string | undefined;
  readonly request: CollectionRenameColumnRequest;
  readonly identity: CollectionColumnMutationIdentity;
  readonly isVaultActive: () => boolean;
  readonly createOperation: (binding: BundleBinding, revision: DatasetRevision) => OperationRecord;
}): CollectionRenameColumnResult {
  const resultIdentity = {
    apiVersion: input.request.apiVersion,
    requestId: input.request.requestId,
    activeVaultId: input.request.activeVaultId,
    datasetId: input.request.datasetId,
    tableId: input.request.tableId,
    columnId: input.request.columnId
  };
  if (!input.vaultPath) return CollectionRenameColumnResultSchema.parse({ ...resultIdentity, status: "not_found" });
  try {
    const binding = readBundle(input.vaultPath, input.request.datasetId);
    if (!binding) return CollectionRenameColumnResultSchema.parse({ ...resultIdentity, status: "not_found" });
    const adopted = adoptColumnRenameMutation({
      binding, request: input.request, identity: input.identity, createOperation: input.createOperation
    });
    if (adopted) return CollectionRenameColumnResultSchema.parse({ ...resultIdentity, ...adopted });
    const snapshot = readCollectionSnapshot(binding, input.request.tableId);
    if (!snapshot) return CollectionRenameColumnResultSchema.parse({ ...resultIdentity, status: "not_found" });
    if (binding.manifest.activeRevision !== input.request.expectedRevisionId) {
      return CollectionRenameColumnResultSchema.parse({ ...resultIdentity, status: "stale", snapshot });
    }
    const column = snapshot.columns.find((candidate) => candidate.columnId === input.request.columnId);
    if (!column) return CollectionRenameColumnResultSchema.parse({ ...resultIdentity, status: "not_found" });
    if (!column.canRename) return CollectionRenameColumnResultSchema.parse({ ...resultIdentity, status: "ineligible", snapshot });
    const normalized = normalizeColumnLabel(input.request.label);
    if (snapshot.columns.some((candidate) => normalizeColumnLabel(candidate.label) === normalized)) {
      return CollectionRenameColumnResultSchema.parse({ ...resultIdentity, status: "duplicate", snapshot });
    }
    const committed = commitColumnRename({
      binding, identity: input.identity, tableId: input.request.tableId, columnId: input.request.columnId,
      label: input.request.label, expectedRevisionId: input.request.expectedRevisionId
    });
    const operation = input.createOperation(committed.binding, committed.revision);
    writeJsonExclusive(operationPathFor(committed.binding.vaultPath, operation.id), operation);
    if (!input.isVaultActive()) return CollectionRenameColumnResultSchema.parse({ ...resultIdentity, status: "not_found" });
    const nextSnapshot = readCollectionSnapshot(committed.binding, input.request.tableId);
    if (!nextSnapshot || nextSnapshot.revisionId !== committed.revision.id) throw operationConflict();
    return CollectionRenameColumnResultSchema.parse({
      ...resultIdentity, status: "committed", operationId: operation.id, snapshot: nextSnapshot
    });
  } catch (caught) {
    if (caught instanceof PigeDomainError && caught.code === "collection.request_conflict") throw caught;
    const latest = readBundle(input.vaultPath, input.request.datasetId);
    const snapshot = latest ? readCollectionSnapshot(latest, input.request.tableId) : undefined;
    if (caught instanceof PigeDomainError && caught.code === "collection.duplicate_label" && snapshot) {
      return CollectionRenameColumnResultSchema.parse({ ...resultIdentity, status: "duplicate", snapshot });
    }
    if (caught instanceof PigeDomainError && caught.code === "collection.column_ineligible" && snapshot) {
      return CollectionRenameColumnResultSchema.parse({ ...resultIdentity, status: "ineligible", snapshot });
    }
    return CollectionRenameColumnResultSchema.parse(snapshot
      ? { ...resultIdentity, status: "stale", snapshot }
      : { ...resultIdentity, status: caught instanceof PigeDomainError && caught.code === "collection.column_not_found" ? "not_found" : "failed" });
  }
}

export function executeColumnTrash(input: {
  readonly vaultPath: string | undefined;
  readonly request: CollectionTrashColumnRequest;
  readonly identity: CollectionColumnMutationIdentity;
  readonly isVaultActive: () => boolean;
  readonly createOperation: (binding: BundleBinding, revision: DatasetRevision) => OperationRecord;
}): CollectionTrashColumnResult {
  const resultIdentity = {
    apiVersion: input.request.apiVersion, requestId: input.request.requestId,
    activeVaultId: input.request.activeVaultId, datasetId: input.request.datasetId,
    tableId: input.request.tableId, columnId: input.request.columnId
  };
  if (!input.vaultPath) return CollectionTrashColumnResultSchema.parse({ ...resultIdentity, status: "not_found" });
  try {
    const binding = readBundle(input.vaultPath, input.request.datasetId);
    if (!binding) return CollectionTrashColumnResultSchema.parse({ ...resultIdentity, status: "not_found" });
    const adopted = adoptColumnTrashMutation({
      binding, request: input.request, identity: input.identity, createOperation: input.createOperation
    });
    if (adopted) return CollectionTrashColumnResultSchema.parse({ ...resultIdentity, ...adopted });
    const snapshot = readCollectionSnapshot(binding, input.request.tableId);
    if (!snapshot) return CollectionTrashColumnResultSchema.parse({ ...resultIdentity, status: "not_found" });
    if (binding.manifest.activeRevision !== input.request.expectedRevisionId) {
      return CollectionTrashColumnResultSchema.parse({ ...resultIdentity, status: "stale", snapshot });
    }
    const column = snapshot.columns.find((candidate) => candidate.columnId === input.request.columnId);
    if (!column) return CollectionTrashColumnResultSchema.parse({ ...resultIdentity, status: "not_found" });
    if (!column.canTrash) return CollectionTrashColumnResultSchema.parse({ ...resultIdentity, status: "ineligible", snapshot });
    assertRelationTrashGuards({ binding, tableId: input.request.tableId, columnId: input.request.columnId });
    assertRollupTrashGuards({ binding, tableId: input.request.tableId, columnId: input.request.columnId });
    const committed = commitColumnTrash({
      binding, identity: input.identity, tableId: input.request.tableId, columnId: input.request.columnId,
      expectedRevisionId: input.request.expectedRevisionId
    });
    const operation = input.createOperation(committed.binding, committed.revision);
    writeJsonExclusive(operationPathFor(committed.binding.vaultPath, operation.id), operation);
    if (!input.isVaultActive()) return CollectionTrashColumnResultSchema.parse({ ...resultIdentity, status: "not_found" });
    const nextSnapshot = readCollectionSnapshot(committed.binding, input.request.tableId);
    if (!nextSnapshot || nextSnapshot.revisionId !== committed.revision.id) throw operationConflict();
    return CollectionTrashColumnResultSchema.parse({
      ...resultIdentity, status: "committed", operationId: operation.id, snapshot: nextSnapshot
    });
  } catch (caught) {
    if (caught instanceof PigeDomainError && caught.code === "collection.request_conflict") throw caught;
    const latest = readBundle(input.vaultPath, input.request.datasetId);
    const snapshot = latest ? readCollectionSnapshot(latest, input.request.tableId) : undefined;
    if (caught instanceof PigeDomainError &&
        (caught.code === "collection.column_ineligible" || caught.code === "collection.relation_inbound" || caught.code === "collection.rollup_inbound") && snapshot) {
      return CollectionTrashColumnResultSchema.parse({ ...resultIdentity, status: "ineligible", snapshot });
    }
    return CollectionTrashColumnResultSchema.parse(snapshot
      ? { ...resultIdentity, status: "stale", snapshot }
      : { ...resultIdentity, status: caught instanceof PigeDomainError && caught.code === "collection.column_not_found" ? "not_found" : "failed" });
  }
}

function adoptColumnTrashMutation(input: {
  readonly binding: BundleBinding;
  readonly request: CollectionTrashColumnRequest;
  readonly identity: CollectionColumnMutationIdentity;
  readonly createOperation: (binding: BundleBinding, revision: DatasetRevision) => OperationRecord;
}): Partial<CollectionTrashColumnResult> | undefined {
  const revisionPath = resolveBundleRelativePath(input.binding.bundlePath, `revisions/${input.identity.revisionId}.json`);
  const operationPath = operationPathFor(input.binding.vaultPath, input.identity.operationId);
  if (!fs.existsSync(revisionPath) && !fs.existsSync(operationPath)) return undefined;
  if (!fs.existsSync(revisionPath)) throw requestConflict();
  const revision = DatasetRevisionSchema.parse(readJsonBounded(revisionPath, MAX_COLLECTION_JSON_BYTES));
  if (revision.id !== input.identity.revisionId || revision.operationId !== input.identity.operationId ||
      revision.parentRevisionId !== input.request.expectedRevisionId || revision.change?.kind !== "collection_column_trash" ||
      revision.change.tableId !== input.request.tableId || revision.change.columnId !== input.request.columnId) {
    throw requestConflict();
  }
  const schema = DatasetSchemaRecordSchema.parse(readJsonRef(input.binding.bundlePath, revision.schema));
  if (schema.tables.find((table) => table.id === input.request.tableId)
    ?.columns.some((column) => column.id === input.request.columnId) !== false) throw requestConflict();
  let committed = input.binding;
  if (committed.manifest.activeRevision !== revision.id) {
    if (committed.manifest.activeRevision !== input.request.expectedRevisionId) {
      const snapshot = readCollectionSnapshot(committed, input.request.tableId);
      return snapshot ? { status: "stale", columnId: input.request.columnId, snapshot } : { status: "not_found" };
    }
    replaceManifestCas(committed, DatasetManifestSchema.parse({
      ...committed.manifest, initialRevision: committed.manifest.initialRevision ?? committed.manifest.activeRevision,
      activeRevision: revision.id, revision: fileRef(committed.bundlePath, `revisions/${revision.id}.json`),
      schema: revision.schema, payload: revision.payload, updatedAt: revision.createdAt
    }));
    const adopted = readBundle(committed.vaultPath, committed.manifest.datasetId);
    if (!adopted || adopted.manifest.activeRevision !== revision.id) {
      throw new PigeDomainError("collection.commit_uncertain", "The Collection replay could not be adopted.");
    }
    committed = adopted;
  }
  const expectedOperation = input.createOperation(committed, revision);
  const operation = fs.existsSync(operationPath)
    ? OperationRecordSchema.parse(readJsonBounded(operationPath, MAX_COLLECTION_JSON_BYTES))
    : expectedOperation;
  if (hashCanonical(operation) !== hashCanonical(expectedOperation)) throw requestConflict();
  if (!fs.existsSync(operationPath)) writeJsonExclusive(operationPath, operation);
  const snapshot = readCollectionSnapshot(committed, input.request.tableId);
  return snapshot
    ? { status: "committed", columnId: input.request.columnId, operationId: operation.id, snapshot }
    : { status: "not_found" };
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

export function commitColumnRename(input: {
  readonly binding: BundleBinding;
  readonly identity: CollectionColumnMutationIdentity;
  readonly tableId: string;
  readonly columnId: string;
  readonly label: string;
  readonly expectedRevisionId: string;
  readonly undoOfOperationId?: string;
}): { readonly binding: BundleBinding; readonly revision: DatasetRevision } {
  const current = requireCurrentRevision(input.binding, input.expectedRevisionId);
  const table = current.schema.tables.find((candidate) => candidate.id === input.tableId);
  const column = table?.columns.find((candidate) => candidate.id === input.columnId);
  if (!table || !column) throw new PigeDomainError("collection.column_not_found", "The Collection column is unavailable.");
  if (columnUsesImportedFormula(column)) throw new PigeDomainError("collection.column_ineligible", "The Collection column cannot be renamed.");
  const normalized = normalizeColumnLabel(input.label);
  if (table.columns.some((candidate) => normalizeColumnLabel(candidate.name) === normalized)) {
    throw new PigeDomainError("collection.duplicate_label", "The Collection already has this column label.");
  }
  return publishColumnMutation({
    current,
    identity: input.identity,
    tableId: input.tableId,
    columnId: input.columnId,
    expectedRevisionId: input.expectedRevisionId,
    change: input.undoOfOperationId
      ? { kind: "collection_column_rename_undo", undoOfOperationId: input.undoOfOperationId }
      : { kind: "collection_column_rename" },
    createPayload: (payloadPath) => renamePayloadColumn(
      payloadPath, current.manifest.datasetId, current.revision.id, input.identity.revisionId,
      input.tableId, input.columnId, input.label
    ),
    createSchema: () => DatasetSchemaRecordSchema.parse({
      ...current.schema,
      revisionId: input.identity.revisionId,
      createdAt: new Date().toISOString(),
      tables: current.schema.tables.map((candidate) => candidate.id === table.id
        ? { ...candidate, columns: candidate.columns.map((entry) => entry.id === column.id ? { ...entry, name: input.label } : entry) }
        : candidate)
    }),
    stats: current.revision.stats
  });
}

export function commitColumnRenameUndo(input: {
  readonly binding: BundleBinding;
  readonly identity: CollectionColumnMutationIdentity;
  readonly tableId: string;
  readonly columnId: string;
  readonly expectedRevisionId: string;
  readonly beforeRevisionId: string;
  readonly undoOfOperationId: string;
}): { readonly binding: BundleBinding; readonly revision: DatasetRevision } {
  const before = readRevisionById(input.binding, input.beforeRevisionId);
  const schema = DatasetSchemaRecordSchema.parse(readJsonRef(input.binding.bundlePath, before.schema));
  const label = schema.tables.find((table) => table.id === input.tableId)
    ?.columns.find((column) => column.id === input.columnId)?.name;
  if (!label) throw operationConflict();
  return commitColumnRename({ ...input, label });
}

export function commitColumnTrash(input: {
  readonly binding: BundleBinding;
  readonly identity: CollectionColumnMutationIdentity;
  readonly tableId: string;
  readonly columnId: string;
  readonly expectedRevisionId: string;
}): { readonly binding: BundleBinding; readonly revision: DatasetRevision } {
  const current = requireCurrentRevision(input.binding, input.expectedRevisionId);
  const table = current.schema.tables.find((candidate) => candidate.id === input.tableId);
  const column = table?.columns.find((candidate) => candidate.id === input.columnId);
  if (!table || !column) throw new PigeDomainError("collection.column_not_found", "The Collection column is unavailable.");
  if (table.columns.length <= 1 || columnUsesImportedFormula(column) || table.columns.some((candidate) => candidate.calculation?.kind === "pige_numeric_formula" && formulaReferencedColumnIds(candidate.calculation.expression).includes(column.id))) {
    throw new PigeDomainError("collection.column_ineligible", "The Collection column cannot be trashed.");
  }
  return publishColumnMutation({
    current, identity: input.identity, tableId: input.tableId, columnId: input.columnId,
    expectedRevisionId: input.expectedRevisionId, change: { kind: "collection_column_trash" },
    createPayload: (payloadPath) => trashPayloadColumn(
      payloadPath, current.manifest.datasetId, current.revision.id, input.identity.revisionId,
      table.id, column.id, column.ordinal, table.rowCount, table.columnCount
    ),
    createSchema: () => DatasetSchemaRecordSchema.parse({
      ...current.schema, revisionId: input.identity.revisionId, createdAt: new Date().toISOString(),
      tables: current.schema.tables.map((candidate) => candidate.id === table.id
        ? { ...candidate, columnCount: candidate.columnCount - 1, columns: candidate.columns
          .filter((entry) => entry.id !== column.id)
          .map((entry) => entry.ordinal > column.ordinal ? { ...entry, ordinal: entry.ordinal - 1 } : entry) }
        : candidate)
    }),
    stats: {
      ...current.revision.stats,
      columnCount: current.revision.stats.columnCount - 1,
      cellCount: current.revision.stats.cellCount - table.rowCount
    }
  });
}

export function commitColumnTrashUndo(input: {
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
  if (!schema.tables.find((table) => table.id === input.tableId)
    ?.columns.some((column) => column.id === input.columnId)) throw operationConflict();
  return publishColumnMutation({
    current, identity: input.identity, tableId: input.tableId, columnId: input.columnId,
    expectedRevisionId: input.expectedRevisionId,
    sourcePayload: resolveBundleRelativePath(current.bundlePath, before.payload.path),
    change: { kind: "collection_column_trash_undo", undoOfOperationId: input.undoOfOperationId },
    createPayload: (payloadPath) => rebindPayloadRevision(
      payloadPath, current.manifest.datasetId, before.id, input.identity.revisionId
    ),
    createSchema: () => DatasetSchemaRecordSchema.parse({
      ...schema, revisionId: input.identity.revisionId, createdAt: new Date().toISOString()
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
    | { readonly kind: "collection_column_add_undo"; readonly undoOfOperationId: string }
    | { readonly kind: "collection_column_rename" }
    | { readonly kind: "collection_column_rename_undo"; readonly undoOfOperationId: string }
    | { readonly kind: "collection_column_trash" }
    | { readonly kind: "collection_column_trash_undo"; readonly undoOfOperationId: string };
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

function renamePayloadColumn(
  payloadPath: string,
  datasetId: string,
  beforeRevisionId: string,
  revisionId: string,
  tableId: string,
  columnId: string,
  label: string
): void {
  const database = new DatabaseSync(payloadPath);
  try {
    database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    validatePayloadMeta(database, datasetId, beforeRevisionId);
    database.exec("BEGIN IMMEDIATE");
    try {
      if (database.prepare("UPDATE pige_dataset_columns SET name = ? WHERE column_id = ? AND table_id = ?")
        .run(label, columnId, tableId).changes !== 1) throw payloadInvalid();
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

function trashPayloadColumn(
  payloadPath: string,
  datasetId: string,
  beforeRevisionId: string,
  revisionId: string,
  tableId: string,
  columnId: string,
  ordinal: number,
  rowCount: number,
  columnCount: number
): void {
  const database = new DatabaseSync(payloadPath);
  try {
    database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    validatePayloadMeta(database, datasetId, beforeRevisionId);
    database.exec("BEGIN IMMEDIATE");
    try {
      if (database.prepare("DELETE FROM pige_dataset_cells WHERE column_id = ?").run(columnId).changes !== rowCount) {
        throw payloadInvalid();
      }
      if (database.prepare("DELETE FROM pige_dataset_columns WHERE column_id = ? AND table_id = ? AND ordinal = ?")
        .run(columnId, tableId, ordinal).changes !== 1) throw payloadInvalid();
      database.prepare("UPDATE pige_dataset_columns SET ordinal = ordinal - 1 WHERE table_id = ? AND ordinal > ?")
        .run(tableId, ordinal);
      if (database.prepare(
        "UPDATE pige_dataset_tables SET column_count = column_count - 1 WHERE table_id = ? AND column_count = ?"
      ).run(tableId, columnCount).changes !== 1) throw payloadInvalid();
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

export function normalizeColumnLabel(label: string): string {
  return label.normalize("NFKC").toLocaleLowerCase("en-US");
}

function projectedType(logicalType: DatasetLogicalType): string {
  if (logicalType === "string") return "text";
  if (logicalType === "number") return "real";
  return logicalType;
}
