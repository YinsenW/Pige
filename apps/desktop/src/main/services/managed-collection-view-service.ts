import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  CollectionCreateViewRequestSchema,
  CollectionCreateViewResultSchema,
  CollectionOpenRequestSchema,
  CollectionOpenResultSchema,
  CollectionViewFilterSchema,
  CollectionViewSortSchema,
  OperationRecordSchema,
  ViewIdSchema,
  type CollectionCreateViewRequest,
  type CollectionCreateViewResult,
  type CollectionOpenRequest,
  type CollectionOpenResult,
  type CollectionSnapshot,
  type CollectionViewFilter,
  type CollectionViewSort,
  type CollectionViewSummary,
  type DatasetLogicalType,
  type OperationRecord
} from "@pige/schemas";
import { z } from "zod";
import {
  DATASET_QUERY_DEFAULT_LIMITS,
  type DatasetQueryExecutor,
  type DatasetQueryInternalColumn,
  type DatasetQueryWorkerInput
} from "./dataset-query-types";
import { DatasetQueryWorkerService } from "./dataset-query-worker-service";
import {
  MAX_COLLECTION_JSON_BYTES,
  assertFileRef,
  fileRef,
  hashCanonical,
  operationPathFor,
  readBundle,
  readCollectionSnapshot,
  readJsonBounded,
  readRevisionById,
  requestConflict,
  resolveBundleRelativePath,
  syncFile,
  writeJsonExclusive,
  writeJsonImmutable,
  type BundleBinding,
  type FileRef
} from "./managed-collection-storage";

export interface ManagedCollectionViewVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export interface CollectionViewUndoRequest {
  readonly activeVaultId: string;
  readonly datasetId: string;
  readonly tableId: string;
  readonly viewId: string;
  readonly expectedViewRevision: number;
}

const FileRefSchema = z.object({
  path: z.string().min(1).max(1024),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  size: z.number().int().nonnegative()
}).strict();

const ViewRevisionSchema = z.object({
  schemaVersion: z.literal(1),
  viewId: ViewIdSchema,
  viewRevision: z.number().int().positive(),
  state: z.enum(["active", "trashed"]),
  datasetId: z.string().regex(/^dataset_\d{8}_[a-z0-9]{12,}$/),
  tableId: z.string().regex(/^table_[a-z0-9]{12,}$/),
  datasetRevisionId: z.string().regex(/^dataset_rev_\d{8}_[a-z0-9]{12,}$/),
  name: z.string().trim().min(1).max(120),
  filter: CollectionViewFilterSchema.optional(),
  sort: CollectionViewSortSchema.optional(),
  requestHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  operationId: z.string().regex(/^op_\d{8}_[a-z0-9]{8,}$/),
  undoOfOperationId: z.string().regex(/^op_\d{8}_[a-z0-9]{8,}$/).optional(),
  createdAt: z.string().datetime({ offset: true })
}).strict();

const ViewPointerSchema = z.object({
  schemaVersion: z.literal(1),
  viewId: ViewIdSchema,
  datasetId: z.string().regex(/^dataset_\d{8}_[a-z0-9]{12,}$/),
  tableId: z.string().regex(/^table_[a-z0-9]{12,}$/),
  activeRevision: z.number().int().positive(),
  revision: FileRefSchema,
  updatedAt: z.string().datetime({ offset: true })
}).strict();

type ViewRevision = z.infer<typeof ViewRevisionSchema>;
type ViewPointer = z.infer<typeof ViewPointerSchema>;
const MAX_VIEWS = 32;
const MAX_OPEN_ROWS = 50;
const REVISION_DATE = /^dataset_rev_(\d{8})_[a-z0-9]{12,}$/u;

export class ManagedCollectionViewService {
  readonly #vaults: ManagedCollectionViewVaultPort;
  readonly #executor: DatasetQueryExecutor;
  #tail: Promise<void> = Promise.resolve();

  constructor(
    vaults: ManagedCollectionViewVaultPort,
    executor: DatasetQueryExecutor = new DatasetQueryWorkerService()
  ) {
    this.#vaults = vaults;
    this.#executor = executor;
  }

  async open(request: CollectionOpenRequest): Promise<CollectionOpenResult> {
    const parsed = CollectionOpenRequestSchema.parse(request);
    const identity = resultIdentity(parsed);
    const vaultPath = this.#activeVaultPath(parsed.activeVaultId);
    if (!vaultPath) return CollectionOpenResultSchema.parse({ ...identity, status: "stale" });
    try {
      const binding = readBundle(vaultPath, parsed.datasetId);
      if (!binding) return CollectionOpenResultSchema.parse({ ...identity, status: "not_found" });
      const snapshot = await this.#readSnapshot(binding, parsed.tableId, parsed.viewId);
      if (!snapshot) return CollectionOpenResultSchema.parse({ ...identity, status: "not_found" });
      if (!this.#activeVaultPath(parsed.activeVaultId)) {
        return CollectionOpenResultSchema.parse({ ...identity, status: "stale" });
      }
      return CollectionOpenResultSchema.parse({ ...identity, status: "ready", snapshot });
    } catch {
      return CollectionOpenResultSchema.parse({ ...identity, status: "failed" });
    }
  }

  async createView(request: CollectionCreateViewRequest): Promise<CollectionCreateViewResult> {
    const parsed = CollectionCreateViewRequestSchema.parse(request);
    return this.#serialize(() => this.#createView(parsed));
  }

  async undoCreateView(request: CollectionViewUndoRequest): Promise<CollectionSnapshot | undefined> {
    return this.#serialize(() => this.#undoCreateView(request));
  }

  async #createView(request: CollectionCreateViewRequest): Promise<CollectionCreateViewResult> {
    const identity = resultIdentity(request);
    const vaultPath = this.#activeVaultPath(request.activeVaultId);
    if (!vaultPath) return CollectionCreateViewResultSchema.parse({ ...identity, status: "not_found" });
    try {
      const binding = readBundle(vaultPath, request.datasetId);
      if (!binding) return CollectionCreateViewResultSchema.parse({ ...identity, status: "not_found" });
      const existing = this.#readViews(binding);
      const replay = await this.#readReplay(binding, request, existing);
      if (replay) return replay;
      const baseSnapshot = readCollectionSnapshot(binding, request.tableId, {
        views: activeSummaries(existing)
      });
      if (!baseSnapshot) return CollectionCreateViewResultSchema.parse({ ...identity, status: "not_found" });
      if (binding.manifest.activeRevision !== request.expectedRevisionId) {
        return CollectionCreateViewResultSchema.parse({ ...identity, status: "stale", snapshot: baseSnapshot });
      }
      if (existing.filter(({ revision }) => revision.state === "active").length >= MAX_VIEWS ||
          !this.#eligible(binding, request.tableId, request.filter, request.sort)) {
        return CollectionCreateViewResultSchema.parse({ ...identity, status: "ineligible", snapshot: baseSnapshot });
      }
      const normalizedName = normalizeName(request.name);
      if (existing.some(({ revision }) => revision.state === "active" && normalizeName(revision.name) === normalizedName)) {
        return CollectionCreateViewResultSchema.parse({ ...identity, status: "duplicate", snapshot: baseSnapshot });
      }
      const stable = createIdentity(request);
      const now = new Date().toISOString();
      const revision = ViewRevisionSchema.parse({
        schemaVersion: 1,
        viewId: stable.viewId,
        viewRevision: 1,
        state: "active",
        datasetId: request.datasetId,
        tableId: request.tableId,
        datasetRevisionId: request.expectedRevisionId,
        name: request.name,
        ...(request.filter ? { filter: request.filter } : {}),
        ...(request.sort ? { sort: request.sort } : {}),
        requestHash: stable.requestHash,
        operationId: stable.operationId,
        createdAt: now
      });
      const revisionRelativePath = viewRevisionPath(stable.viewId, 1);
      writeJsonImmutable(resolveBundleRelativePath(binding.bundlePath, revisionRelativePath), revision);
      const pointer = ViewPointerSchema.parse({
        schemaVersion: 1,
        viewId: stable.viewId,
        datasetId: request.datasetId,
        tableId: request.tableId,
        activeRevision: 1,
        revision: fileRef(binding.bundlePath, revisionRelativePath),
        updatedAt: now
      });
      writeJsonExclusive(viewPointerPath(binding, stable.viewId), pointer);
      this.#writeOperation(binding, revision, pointer.revision);
      const current = this.#requireUnchangedBinding(binding);
      const snapshot = await this.#readSnapshot(current, request.tableId, stable.viewId);
      if (!snapshot || !this.#activeVaultPath(request.activeVaultId)) {
        return CollectionCreateViewResultSchema.parse({ ...identity, status: "failed" });
      }
      return CollectionCreateViewResultSchema.parse({
        ...identity,
        status: "committed",
        viewId: stable.viewId,
        operationId: stable.operationId,
        snapshot
      });
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "collection.request_conflict") throw caught;
      return CollectionCreateViewResultSchema.parse({ ...identity, status: "failed" });
    }
  }

  async #undoCreateView(request: CollectionViewUndoRequest): Promise<CollectionSnapshot | undefined> {
    const vaultPath = this.#activeVaultPath(request.activeVaultId);
    if (!vaultPath) return undefined;
    const binding = readBundle(vaultPath, request.datasetId);
    if (!binding) return undefined;
    const entry = this.#readViews(binding).find(({ pointer }) => pointer.viewId === request.viewId);
    if (!entry || entry.pointer.tableId !== request.tableId) return undefined;
    if (entry.pointer.activeRevision !== request.expectedViewRevision) {
      throw new PigeDomainError("collection.view_revision_changed", "The saved view changed before Undo.");
    }
    if (entry.revision.state === "trashed") return this.#readSnapshot(binding, request.tableId);
    const nextRevision = entry.revision.viewRevision + 1;
    const operationId = createUndoOperationId(entry.revision.operationId);
    const revision = ViewRevisionSchema.parse({
      ...entry.revision,
      viewRevision: nextRevision,
      state: "trashed",
      operationId,
      undoOfOperationId: entry.revision.operationId,
      createdAt: new Date().toISOString()
    });
    const relativePath = viewRevisionPath(request.viewId, nextRevision);
    writeJsonImmutable(resolveBundleRelativePath(binding.bundlePath, relativePath), revision);
    const nextPointer = ViewPointerSchema.parse({
      ...entry.pointer,
      activeRevision: nextRevision,
      revision: fileRef(binding.bundlePath, relativePath),
      updatedAt: revision.createdAt
    });
    replacePointer(entry.path, entry.bytes, nextPointer);
    this.#writeOperation(binding, revision, nextPointer.revision, entry.pointer.revision);
    const current = this.#requireUnchangedBinding(binding);
    return this.#readSnapshot(current, request.tableId);
  }

  async #readSnapshot(
    binding: BundleBinding,
    tableId: string,
    activeViewId?: string
  ): Promise<CollectionSnapshot | undefined> {
    const entries = this.#readViews(binding);
    const views = activeSummaries(entries);
    if (!activeViewId) return readCollectionSnapshot(binding, tableId, { views });
    const selected = entries.find(({ revision }) => revision.viewId === activeViewId && revision.state === "active");
    if (!selected || selected.revision.tableId !== tableId ||
        !this.#eligible(binding, tableId, selected.revision.filter, selected.revision.sort)) return undefined;
    const before = viewIdentity(selected);
    const query = await this.#query(binding, tableId, selected.revision);
    const current = this.#requireUnchangedBinding(binding);
    const after = this.#readViews(current).find(({ revision }) => revision.viewId === activeViewId);
    if (!after || viewIdentity(after) !== before || after.revision.state !== "active" ||
        !this.#eligible(current, tableId, after.revision.filter, after.revision.sort)) {
      throw new PigeDomainError("collection.view_changed", "The saved view changed during execution.");
    }
    return readCollectionSnapshot(current, tableId, {
      rowIds: query.returnedRowIds,
      totalRowCount: query.sourceMatchedRowCount,
      views: activeSummaries(this.#readViews(current)),
      activeViewId
    });
  }

  async #query(binding: BundleBinding, tableId: string, view: ViewRevision) {
    const table = binding.schema.tables.find((candidate) => candidate.id === tableId);
    if (!table) throw new PigeDomainError("collection.table_not_found", "The Collection table is unavailable.");
    const referencedIds = new Set<string>([
      view.filter?.columnId,
      view.sort?.columnId,
      table.columns[0]?.id
    ].filter((value): value is string => !!value));
    const columns = table.columns.filter((column) => referencedIds.has(column.id)).map(toWorkerColumn);
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-collection-view-"));
    const payloadPath = path.join(temporaryRoot, "collection.sqlite");
    try {
      assertFileRef(binding.bundlePath, binding.manifest.payload);
      fs.copyFileSync(binding.payloadPath, payloadPath, fs.constants.COPYFILE_EXCL);
      const input: DatasetQueryWorkerInput = {
        payloadPath,
        binding: {
          datasetId: binding.manifest.datasetId,
          revisionId: binding.revision.id,
          schemaChecksum: binding.manifest.schema.checksum,
          payloadChecksum: binding.manifest.payload.checksum
        },
        table: { id: table.id, name: table.name, rowCount: table.rowCount, columnCount: table.columnCount },
        columns,
        plan: {
          selectColumnIds: columns.map(({ id }) => id),
          filters: view.filter ? [{
            columnId: view.filter.columnId,
            op: view.filter.operator,
            ...(view.filter.operator === "eq" ? { value: view.filter.value } : {})
          }] : [],
          groupByColumnIds: [],
          aggregates: [],
          orderBy: view.sort ? [{ by: view.sort.columnId, direction: view.sort.direction }] : [],
          limit: MAX_OPEN_ROWS
        },
        limits: { ...DATASET_QUERY_DEFAULT_LIMITS }
      };
      return await this.#executor.execute(input);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }

  #readViews(binding: BundleBinding): ViewEntry[] {
    const root = resolveBundleRelativePath(binding.bundlePath, "views");
    if (!fs.existsSync(root)) return [];
    const rootStat = fs.lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw requestConflict();
    const names = fs.readdirSync(root).filter((name) => /^view_[a-z0-9]{12,}\.json$/u.test(name)).sort();
    if (names.length > MAX_VIEWS) throw requestConflict();
    return names.map((name) => {
      const pointerPath = path.join(root, name);
      const pointerStat = fs.lstatSync(pointerPath);
      if (!pointerStat.isFile() || pointerStat.isSymbolicLink()) throw requestConflict();
      const bytes = fs.readFileSync(pointerPath);
      if (bytes.length > MAX_COLLECTION_JSON_BYTES) throw requestConflict();
      const pointer = ViewPointerSchema.parse(JSON.parse(bytes.toString("utf8")));
      if (name !== `${pointer.viewId}.json` || pointer.datasetId !== binding.manifest.datasetId) throw requestConflict();
      assertFileRef(binding.bundlePath, pointer.revision);
      const revision = ViewRevisionSchema.parse(readJsonBounded(
        resolveBundleRelativePath(binding.bundlePath, pointer.revision.path),
        MAX_COLLECTION_JSON_BYTES
      ));
      if (revision.viewId !== pointer.viewId || revision.viewRevision !== pointer.activeRevision ||
          revision.datasetId !== pointer.datasetId || revision.tableId !== pointer.tableId) throw requestConflict();
      return { pointer, revision, path: pointerPath, bytes };
    });
  }

  async #readReplay(
    binding: BundleBinding,
    request: CollectionCreateViewRequest,
    entries: readonly ViewEntry[]
  ): Promise<CollectionCreateViewResult | undefined> {
    const stable = createIdentity(request);
    const entry = entries.find(({ pointer }) => pointer.viewId === stable.viewId);
    const operationPath = operationPathFor(binding.vaultPath, stable.operationId);
    if (!entry && !fs.existsSync(operationPath)) return undefined;
    if (!entry || entry.revision.requestHash !== stable.requestHash || entry.revision.operationId !== stable.operationId ||
        entry.revision.state !== "active") throw requestConflict();
    const expectedOperation = createViewOperation(binding, entry.revision, entry.pointer.revision);
    if (fs.existsSync(operationPath)) {
      const operation = OperationRecordSchema.parse(readJsonBounded(operationPath, MAX_COLLECTION_JSON_BYTES));
      if (hashCanonical(operation) !== hashCanonical(expectedOperation)) throw requestConflict();
    } else {
      writeJsonExclusive(operationPath, expectedOperation);
    }
    const snapshot = await this.#readSnapshot(binding, request.tableId, stable.viewId);
    if (!snapshot) return undefined;
    return CollectionCreateViewResultSchema.parse({
      ...resultIdentity(request), status: "committed", viewId: stable.viewId,
      operationId: stable.operationId, snapshot
    });
  }

  #eligible(
    binding: BundleBinding,
    tableId: string,
    filter?: CollectionViewFilter,
    sort?: CollectionViewSort
  ): boolean {
    const table = binding.schema.tables.find((candidate) => candidate.id === tableId);
    if (!table) return false;
    const byId = new Map(table.columns.map((column) => [column.id, column]));
    const filterColumn = filter ? byId.get(filter.columnId) : undefined;
    const sortColumn = sort ? byId.get(sort.columnId) : undefined;
    if ((filter && !filterColumn) || (sort && !sortColumn)) return false;
    if (filter?.operator === "eq" && filterColumn && !valueMatchesType(filter.value, filterColumn.logicalType)) return false;
    return sortColumn?.logicalType !== "binary" && sortColumn?.logicalType !== "unknown";
  }

  #requireUnchangedBinding(before: BundleBinding): BundleBinding {
    const current = readBundle(before.vaultPath, before.manifest.datasetId);
    if (!current || hashCanonical(current.manifest) !== hashCanonical(before.manifest) ||
        hashCanonical(current.schema) !== hashCanonical(before.schema)) {
      throw new PigeDomainError("collection.revision_changed", "The Collection changed during view execution.");
    }
    return current;
  }

  #writeOperation(
    binding: BundleBinding,
    revision: ViewRevision,
    revisionRef: FileRef,
    beforeRef?: FileRef
  ): void {
    writeJsonExclusive(
      operationPathFor(binding.vaultPath, revision.operationId),
      createViewOperation(binding, revision, revisionRef, beforeRef)
    );
  }

  #activeVaultPath(vaultId: string): string | undefined {
    const current = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    return current?.vaultId === vaultId && vaultPath ? vaultPath : undefined;
  }

  async #serialize<T>(work: () => Promise<T>): Promise<T> {
    const prior = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    try { return await work(); } finally { release(); }
  }
}

interface ViewEntry {
  readonly pointer: ViewPointer;
  readonly revision: ViewRevision;
  readonly path: string;
  readonly bytes: Buffer;
}

function activeSummaries(entries: readonly ViewEntry[]): CollectionViewSummary[] {
  return entries.filter(({ revision }) => revision.state === "active").map(({ revision }) => ({
    viewId: revision.viewId,
    viewRevision: revision.viewRevision,
    name: revision.name,
    ...(revision.filter ? { filter: revision.filter } : {}),
    ...(revision.sort ? { sort: revision.sort } : {})
  }));
}

function createIdentity(request: CollectionCreateViewRequest) {
  const date = REVISION_DATE.exec(request.expectedRevisionId)?.[1];
  if (!date) throw requestConflict();
  const requestHash = digest("pige:collection-view-request:v1", JSON.stringify(request));
  return {
    viewId: ViewIdSchema.parse(`view_${digest("pige:collection-view:v1", request.requestId).slice(7, 27)}`),
    operationId: `op_${date}_${digest("pige:collection-view-operation:v1", request.requestId).slice(7, 27)}`,
    requestHash
  };
}

function createUndoOperationId(operationId: string): string {
  const date = /^op_(\d{8})_[a-z0-9]{8,}$/u.exec(operationId)?.[1];
  if (!date) throw requestConflict();
  return `op_${date}_${digest("pige:collection-view-undo:v1", operationId).slice(7, 27)}`;
}

function createViewOperation(
  binding: BundleBinding,
  revision: ViewRevision,
  revisionRef: FileRef,
  beforeRef?: FileRef
): OperationRecord {
  const datasetRevision = readRevisionById(binding, revision.datasetRevisionId);
  const datasetRevisionPath = `revisions/${datasetRevision.id}.json`;
  const viewRef = {
    kind: "view" as const,
    id: revision.viewId,
    path: `${binding.bundleRelativePath}/${revisionRef.path}`,
    checksum: revisionRef.checksum
  };
  const sourceRefs = revision.undoOfOperationId
    ? [{ kind: "operation" as const, id: revision.undoOfOperationId }]
    : [{
      kind: "dataset_revision" as const,
      id: revision.datasetRevisionId,
      path: `${binding.bundleRelativePath}/${datasetRevisionPath}`,
      checksum: fileRef(binding.bundlePath, datasetRevisionPath).checksum
    }];
  return OperationRecordSchema.parse({
    id: revision.operationId,
    schemaVersion: 1,
    createdAt: revision.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "create_collection_view",
    targetRefs: [
      { kind: "dataset", id: revision.datasetId, path: binding.bundleRelativePath },
      { kind: "table", id: revision.tableId },
      viewRef
    ],
    sourceRefs,
    ...(beforeRef ? { before: {
      kind: "view" as const,
      id: revision.viewId,
      path: `${binding.bundleRelativePath}/${beforeRef.path}`,
      checksum: beforeRef.checksum
    } } : {}),
    after: viewRef,
    summary: revision.state === "active"
      ? `Created saved Collection view ${revision.viewId}.`
      : `Moved saved Collection view ${revision.viewId} out of the active set.`,
    reversible: revision.state === "active" ? "yes" : "best_effort",
    rollbackHint: "Advance this saved view through another immutable view revision.",
    warnings: []
  });
}

function replacePointer(filePath: string, expected: Buffer, next: ViewPointer): void {
  const current = fs.readFileSync(filePath);
  if (!current.equals(expected)) throw new PigeDomainError("collection.view_revision_changed", "The saved view changed before publication.");
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    syncFile(temporary);
    if (!fs.readFileSync(filePath).equals(expected)) {
      throw new PigeDomainError("collection.view_revision_changed", "The saved view changed before publication.");
    }
    fs.renameSync(temporary, filePath);
    syncFile(filePath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function viewPointerPath(binding: BundleBinding, viewId: string): string {
  return resolveBundleRelativePath(binding.bundlePath, `views/${viewId}.json`);
}

function viewRevisionPath(viewId: string, revision: number): string {
  return `views/${viewId}/revisions/${revision}.json`;
}

function viewIdentity(entry: ViewEntry): string {
  return hashCanonical({ pointer: entry.pointer, revision: entry.revision });
}

function resultIdentity(request: CollectionOpenRequest | CollectionCreateViewRequest) {
  return {
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId
  };
}

function toWorkerColumn(column: {
  readonly id: string;
  readonly name: string;
  readonly ordinal: number;
  readonly logicalType: DatasetLogicalType;
}): DatasetQueryInternalColumn {
  return { id: column.id, name: column.name, ordinal: column.ordinal, logicalType: column.logicalType };
}

function valueMatchesType(value: string | number | boolean, logicalType: DatasetLogicalType): boolean {
  if (typeof value === "boolean") return logicalType === "boolean";
  if (typeof value === "number") return logicalType === "integer" || logicalType === "number";
  return logicalType === "string" || logicalType === "date" || logicalType === "datetime";
}

function normalizeName(name: string): string {
  return name.normalize("NFKC").toLocaleLowerCase("en-US");
}

function digest(domain: string, value: string): string {
  return `sha256:${createHash("sha256").update(domain).update("\0").update(value).digest("hex")}`;
}
