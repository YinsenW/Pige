import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  DatasetAnswerCitation,
  DatasetQueryPreview
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  DatasetAnswerCitationSchema,
  DatasetManifestSchema,
  DatasetQueryPreviewSchema,
  DatasetRevisionSchema,
  DatasetSchemaRecordSchema,
  SourceRecordSchema,
  type DatasetLogicalType,
  type DatasetManifest,
  type DatasetRevision,
  type DatasetSchemaRecord,
  type DatasetTable,
  type SourceRecord
} from "@pige/schemas";
import { containsRestrictedModelContent } from "./model-egress-content";
import {
  DATASET_QUERY_DEFAULT_LIMITS,
  DATASET_QUERY_PROTOCOL_VERSION,
  DatasetQueryToolRequestSchema,
  createDatasetQueryPlanHash,
  createDatasetQueryResultHash,
  type ColumnOpaqueRef,
  type DatasetOpaqueRef,
  type DatasetQueryCatalog,
  type DatasetQueryCoreResult,
  type DatasetQueryEvidenceRevalidation,
  type DatasetQueryEvidenceSnapshot,
  type DatasetQueryExecutionResult,
  type DatasetQueryExecutor,
  type DatasetQueryInternalAggregate,
  type DatasetQueryInternalColumn,
  type DatasetQueryInternalFilter,
  type DatasetQueryInternalOrder,
  type DatasetQueryLimits,
  type DatasetQueryRequest,
  type DatasetQueryToolRequest,
  type DatasetQueryWorkerInput,
  type DatasetQueryWorkerRequest,
  type TableOpaqueRef
} from "./dataset-query-types";
import { DatasetQueryWorkerService } from "./dataset-query-worker-service";

const UNTRUSTED_DATASET_START = "<PIGE_UNTRUSTED_DATASET_V1>";
const UNTRUSTED_DATASET_END = "</PIGE_UNTRUSTED_DATASET_V1>";
const STALE_DATASET_MODEL_TEXT = `${UNTRUSTED_DATASET_START}\n{"status":"stale_evidence"}\n${UNTRUSTED_DATASET_END}`;
const CITATION_REF = "citation_1";

interface BoundColumn {
  readonly ref: ColumnOpaqueRef;
  readonly column: DatasetTable["columns"][number];
}

interface BoundTable {
  readonly ref: TableOpaqueRef;
  readonly table: DatasetTable;
  readonly columns: readonly BoundColumn[];
}

interface SourceEvidenceFact {
  readonly sourceId: string;
  readonly sourceRevisionHash: string;
  readonly updatedAt: string;
  readonly privateContent: boolean;
  readonly sensitiveContent: boolean;
  readonly restrictedContent: boolean;
}

interface BundleEvidenceIdentity {
  readonly bundleRelativePath: string;
  readonly manifestHash: string;
  readonly revisionChecksum: string;
  readonly schemaChecksum: string;
  readonly payloadChecksum: string;
  readonly sourceRevisionHash: string;
}

interface BundleSnapshot {
  readonly bundleRelativePath: string;
  readonly bundlePath: string;
  readonly manifest: DatasetManifest;
  readonly revision: DatasetRevision;
  readonly schema: DatasetSchemaRecord;
  readonly payloadPath: string;
  readonly source: SourceEvidenceFact;
  readonly identity: BundleEvidenceIdentity;
}

interface BoundDataset {
  readonly ref: DatasetOpaqueRef;
  readonly snapshot: BundleSnapshot;
  readonly tables: readonly BoundTable[];
}

interface CatalogEnvelope {
  readonly schemaVersion: 1;
  readonly status: "ready" | "empty";
  readonly datasets: readonly {
    readonly datasetRef: DatasetOpaqueRef;
    readonly title: string;
    readonly tables: readonly {
      readonly tableRef: TableOpaqueRef;
      readonly name: string;
      readonly columns: readonly {
        readonly columnRef: ColumnOpaqueRef;
        readonly name: string;
        readonly logicalType: DatasetLogicalType;
      }[];
    }[];
  }[];
  readonly queryContract: {
    readonly action: "query";
    readonly filterOperators: readonly string[];
    readonly aggregateOperators: readonly string[];
    readonly orderDirections: readonly string[];
    readonly aggregateRefs: string;
    readonly limits: {
      readonly selectedColumns: number;
      readonly filters: number;
      readonly groupByColumns: number;
      readonly aggregates: number;
      readonly orderBy: number;
      readonly rows: number;
    };
  };
  readonly omitted: {
    readonly datasets: number;
    readonly tables: number;
    readonly columns: number;
  };
}

interface CatalogState {
  readonly vaultPath: string;
  readonly realVaultPath: string;
  readonly catalog: DatasetQueryCatalog;
  readonly datasets: readonly BoundDataset[];
  readonly envelope: CatalogEnvelope;
  readonly modelText: string;
  readonly evidence: DatasetQueryEvidenceSnapshot;
  queryStarted: boolean;
}

interface ResultState {
  readonly vaultPath: string;
  readonly realVaultPath: string;
  readonly bundleRelativePath: string;
  readonly bundleIdentity: BundleEvidenceIdentity;
  readonly publicHash: string;
}

interface PrivatePayloadSnapshot {
  readonly filePath: string;
  dispose(): Promise<void>;
}

export class DatasetQueryService {
  readonly #executor: DatasetQueryExecutor;
  readonly #limits: DatasetQueryLimits;
  readonly #catalogs = new WeakMap<DatasetQueryCatalog, CatalogState>();
  readonly #results = new WeakMap<DatasetQueryExecutionResult, ResultState>();

  constructor(
    executor: DatasetQueryExecutor = new DatasetQueryWorkerService(),
    limits: DatasetQueryLimits = DATASET_QUERY_DEFAULT_LIMITS
  ) {
    validateServiceLimits(limits);
    this.#executor = executor;
    this.#limits = Object.freeze({ ...limits });
  }

  async createCatalog(vaultPath: string, signal?: AbortSignal): Promise<DatasetQueryCatalog> {
    const state = await this.#buildCatalog(vaultPath, signal);
    this.#catalogs.set(state.catalog, state);
    return state.catalog;
  }

  async revalidateCatalog(
    vaultPath: string,
    catalog: DatasetQueryCatalog,
    signal?: AbortSignal
  ): Promise<DatasetQueryEvidenceRevalidation> {
    const { current, drifted } = await this.#readCurrentCatalogState(vaultPath, catalog, signal);
    return Object.freeze({
      drifted,
      evidence: drifted
        ? createCatalogEvidence(STALE_DATASET_MODEL_TEXT, current.catalog.catalogHash, current.datasets)
        : current.evidence
    });
  }

  async execute(
    vaultPath: string,
    catalog: DatasetQueryCatalog,
    request: DatasetQueryToolRequest,
    signal?: AbortSignal
  ): Promise<DatasetQueryExecutionResult> {
    if (signal?.aborted) throw abortedError();
    const parsed = DatasetQueryToolRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new PigeDomainError("dataset.query.plan_invalid", "The Dataset query request is not a strict bounded typed plan.");
    }
    if (parsed.data.action !== "query") {
      throw new PigeDomainError(
        "dataset.query.catalog_action_routed_wrong",
        "Home must route the Dataset catalog action to createCatalog and revalidateCatalog."
      );
    }
    if (byteLength(JSON.stringify(parsed.data)) > 16 * 1_024) {
      throw new PigeDomainError("dataset.query.plan_invalid", "The Dataset query request exceeds its bounded input size.");
    }
    const originalState = this.#catalogs.get(catalog);
    if (!originalState) throw unboundCatalogError();
    if (originalState.queryStarted) {
      throw new PigeDomainError("dataset.query.repeated", "A bounded Dataset catalog may execute one query.");
    }
    const currentState = await this.#revalidateCatalogState(vaultPath, catalog, signal);
    originalState.queryStarted = true;
    const binding = resolveQueryBinding(currentState, parsed.data, this.#limits);
    const workerInput = createWorkerInput(binding, parsed.data, this.#limits);
    const privatePayload = await createPrivatePayloadSnapshot(binding.dataset.snapshot, this.#limits, signal);
    let coreResult: DatasetQueryCoreResult;
    try {
      coreResult = await this.#executor.execute(
        { ...workerInput, payloadPath: privatePayload.filePath },
        signal
      );
    } finally {
      await privatePayload.dispose();
    }
    if (signal?.aborted) throw abortedError();
    const afterState = await this.#revalidateCatalogState(vaultPath, catalog, signal);
    const afterBinding = resolveQueryBinding(afterState, parsed.data, this.#limits);
    if (hashCanonical(binding.dataset.snapshot.identity) !== hashCanonical(afterBinding.dataset.snapshot.identity)) {
      throw staleEvidenceError();
    }
    validateCoreResult(coreResult, workerInput);
    const result = createExecutionResult(afterBinding, parsed.data, coreResult, afterState.catalog.catalogHash, this.#limits);
    this.#results.set(result, {
      vaultPath: afterState.vaultPath,
      realVaultPath: afterState.realVaultPath,
      bundleRelativePath: afterBinding.dataset.snapshot.bundleRelativePath,
      bundleIdentity: afterBinding.dataset.snapshot.identity,
      publicHash: hashCanonical(result)
    });
    return result;
  }

  async revalidateResult(
    vaultPath: string,
    result: DatasetQueryExecutionResult,
    signal?: AbortSignal
  ): Promise<DatasetQueryEvidenceRevalidation> {
    const state = this.#results.get(result);
    if (!state || hashCanonical(result) !== state.publicHash) {
      throw new PigeDomainError("dataset.query.result_unbound", "The Dataset query result is not bound to this service instance.");
    }
    const vault = await assertVaultAndDatasetsRoot(vaultPath, signal);
    if (vault.resolvedVault !== state.vaultPath || vault.realVault !== state.realVaultPath) throw staleEvidenceError();
    const current = await readBundleSnapshot(vault, state.bundleRelativePath, this.#limits, signal);
    const currentEvidence = createResultEvidence(
      result.evidence.modelText,
      current,
      result.preview.planHash,
      result.preview.resultHash
    );
    const drifted =
      hashCanonical(current.identity) !== hashCanonical(state.bundleIdentity) ||
      currentEvidence.evidenceHash !== result.evidence.evidenceHash;
    return Object.freeze({
      drifted,
      evidence: drifted
        ? createResultEvidence(
            STALE_DATASET_MODEL_TEXT,
            current,
            result.preview.planHash,
            result.preview.resultHash
          )
        : currentEvidence
    });
  }

  async #revalidateCatalogState(
    vaultPath: string,
    catalog: DatasetQueryCatalog,
    signal?: AbortSignal
  ): Promise<CatalogState> {
    const { current, drifted } = await this.#readCurrentCatalogState(vaultPath, catalog, signal);
    if (drifted) throw staleEvidenceError();
    return current;
  }

  async #readCurrentCatalogState(
    vaultPath: string,
    catalog: DatasetQueryCatalog,
    signal?: AbortSignal
  ): Promise<{ readonly current: CatalogState; readonly drifted: boolean }> {
    const previous = this.#catalogs.get(catalog);
    if (!previous || hashCanonical(catalog) !== hashCanonical(previous.catalog)) throw unboundCatalogError();
    const current = await this.#buildCatalog(vaultPath, signal);
    if (current.vaultPath !== previous.vaultPath || current.realVaultPath !== previous.realVaultPath) {
      throw staleEvidenceError();
    }
    return {
      current,
      drifted:
        current.catalog.catalogHash !== previous.catalog.catalogHash ||
        current.evidence.evidenceHash !== previous.evidence.evidenceHash ||
        current.modelText !== previous.modelText
    };
  }

  async #buildCatalog(vaultPath: string, signal?: AbortSignal): Promise<CatalogState> {
    assertNotAborted(signal);
    const vault = await assertVaultAndDatasetsRoot(vaultPath, signal);
    const entries = await fs.promises.readdir(vault.datasetsPath, { withFileTypes: true });
    if (entries.length > this.#limits.maxCatalogDirectoryEntries) {
      throw new PigeDomainError("dataset.query.limit.catalog_entries", "The Dataset catalog exceeds its bounded directory-entry limit.");
    }
    const bundleNames: string[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw symlinkError();
      if (entry.isDirectory()) {
        await assertTreeWithoutSymlinks(
          path.join(vault.datasetsPath, entry.name),
          vault.realDatasets,
          this.#limits.maxBundleEntries,
          signal
        );
        bundleNames.push(entry.name);
      } else if (!entry.isFile()) {
        throw new PigeDomainError("dataset.query.path_unsafe", "The Dataset root contains an unsupported filesystem object.");
      }
    }
    bundleNames.sort(binaryCompare);
    const selectedNames = bundleNames.slice(0, this.#limits.maxCatalogDatasets);
    const snapshots: BundleSnapshot[] = [];
    for (const name of selectedNames) {
      assertNotAborted(signal);
      snapshots.push(await readBundleSnapshot(vault, `datasets/${name}`, this.#limits, signal));
    }
    snapshots.sort((left, right) => binaryCompare(left.manifest.datasetId, right.manifest.datasetId));

    let tableNumber = 0;
    let columnNumber = 0;
    let omittedTables = 0;
    let omittedColumns = 0;
    const datasets: BoundDataset[] = [];
    for (const [datasetIndex, snapshot] of snapshots.entries()) {
      const tables: BoundTable[] = [];
      const sortedTables = [...snapshot.schema.tables].sort((left, right) =>
        left.ordinal - right.ordinal || binaryCompare(left.id, right.id)
      );
      for (const table of sortedTables) {
        if (tableNumber >= this.#limits.maxCatalogTables) {
          omittedTables += 1;
          omittedColumns += table.columns.length;
          continue;
        }
        const columns: BoundColumn[] = [];
        const sortedColumns = [...table.columns].sort((left, right) =>
          left.ordinal - right.ordinal || binaryCompare(left.id, right.id)
        );
        for (const column of sortedColumns) {
          if (columnNumber >= this.#limits.maxCatalogColumns) {
            omittedColumns += 1;
            continue;
          }
          columnNumber += 1;
          columns.push({ ref: `column_${columnNumber}` as ColumnOpaqueRef, column });
        }
        if (columns.length === 0) {
          omittedTables += 1;
          continue;
        }
        tableNumber += 1;
        tables.push({ ref: `table_${tableNumber}` as TableOpaqueRef, table, columns });
      }
      if (tables.length > 0) {
        datasets.push({ ref: `dataset_${datasetIndex + 1}` as DatasetOpaqueRef, snapshot, tables });
      }
    }
    let envelope = createCatalogEnvelope(
      datasets,
      bundleNames.length - snapshots.length,
      omittedTables,
      omittedColumns,
      this.#limits
    );
    let modelText = createUntrustedEnvelope(envelope);
    while (byteLength(modelText) > this.#limits.maxResultBytes && trimCatalogTail(datasets)) {
      omittedColumns += 1;
      envelope = createCatalogEnvelope(
        datasets,
        bundleNames.length - snapshots.length,
        omittedTables,
        omittedColumns,
        this.#limits
      );
      modelText = createUntrustedEnvelope(envelope);
    }
    if (byteLength(modelText) > this.#limits.maxResultBytes) {
      throw new PigeDomainError("dataset.query.limit.catalog_bytes", "The Dataset catalog exceeds its bounded model-output size.");
    }
    const catalog = Object.freeze({
      schemaVersion: DATASET_QUERY_PROTOCOL_VERSION,
      catalogHash: hashCanonical(envelope)
    }) satisfies DatasetQueryCatalog;
    const evidence = createCatalogEvidence(modelText, catalog.catalogHash, datasets);
    return {
      vaultPath: vault.resolvedVault,
      realVaultPath: vault.realVault,
      catalog,
      datasets,
      envelope,
      modelText,
      evidence,
      queryStarted: false
    };
  }
}

interface VaultRoots {
  readonly resolvedVault: string;
  readonly realVault: string;
  readonly datasetsPath: string;
  readonly realDatasets: string;
}

interface ResolvedQueryBinding {
  readonly dataset: BoundDataset;
  readonly table: BoundTable;
  readonly columnsByRef: ReadonlyMap<ColumnOpaqueRef, BoundColumn>;
}

async function assertVaultAndDatasetsRoot(vaultPath: string, signal?: AbortSignal): Promise<VaultRoots> {
  const resolvedVault = path.resolve(vaultPath);
  try {
    assertNotAborted(signal);
    const vaultStat = await fs.promises.lstat(resolvedVault);
    if (vaultStat.isSymbolicLink() || !vaultStat.isDirectory()) throw symlinkError();
    const realVault = await fs.promises.realpath(resolvedVault);
    const datasetsPath = path.join(resolvedVault, "datasets");
    const datasetsStat = await fs.promises.lstat(datasetsPath);
    if (datasetsStat.isSymbolicLink() || !datasetsStat.isDirectory()) throw symlinkError();
    const realDatasets = await fs.promises.realpath(datasetsPath);
    if (realDatasets === realVault || !realDatasets.startsWith(`${realVault}${path.sep}`)) throw symlinkError();
    assertNotAborted(signal);
    return { resolvedVault, realVault, datasetsPath, realDatasets };
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("dataset.query.catalog_unavailable", "The active vault Dataset root is unavailable.");
  }
}

async function assertTreeWithoutSymlinks(
  rootPath: string,
  realParent: string,
  maximumEntries: number,
  signal?: AbortSignal
): Promise<void> {
  let entriesSeen = 0;
  const visit = async (directoryPath: string): Promise<void> => {
    assertNotAborted(signal);
    const before = await fs.promises.lstat(directoryPath);
    if (before.isSymbolicLink() || !before.isDirectory()) throw symlinkError();
    const realDirectory = await fs.promises.realpath(directoryPath);
    if (realDirectory === realParent || !realDirectory.startsWith(`${realParent}${path.sep}`)) throw symlinkError();
    const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      assertNotAborted(signal);
      entriesSeen += 1;
      if (entriesSeen > maximumEntries) {
        throw new PigeDomainError("dataset.query.limit.bundle_entries", "A Dataset Bundle exceeds its bounded entry limit.");
      }
      const entryPath = path.join(directoryPath, entry.name);
      const stat = await fs.promises.lstat(entryPath);
      if (entry.isSymbolicLink() || stat.isSymbolicLink()) throw symlinkError();
      if (stat.isDirectory()) await visit(entryPath);
      else if (!stat.isFile()) {
        throw new PigeDomainError("dataset.query.path_unsafe", "A Dataset Bundle contains an unsupported filesystem object.");
      } else {
        const realFile = await fs.promises.realpath(entryPath);
        if (!realFile.startsWith(`${realParent}${path.sep}`)) throw symlinkError();
      }
    }
    const after = await fs.promises.lstat(directoryPath);
    if (!sameFileRevision(before, after)) throw staleEvidenceError();
  };
  await visit(rootPath);
}

async function readBundleSnapshot(
  vault: VaultRoots,
  bundleRelativePath: string,
  limits: DatasetQueryLimits,
  signal?: AbortSignal
): Promise<BundleSnapshot> {
  assertNotAborted(signal);
  const bundleSegments = parseSafeRelativePath(bundleRelativePath);
  if (bundleSegments.length !== 2 || bundleSegments[0] !== "datasets") {
    throw new PigeDomainError("dataset.query.path_unsafe", "The Dataset Bundle binding is outside the active Dataset root.");
  }
  const bundlePath = path.resolve(vault.resolvedVault, ...bundleSegments);
  if (path.dirname(bundlePath) !== vault.datasetsPath) throw symlinkError();
  await assertTreeWithoutSymlinks(bundlePath, vault.realDatasets, limits.maxBundleEntries, signal);

  const manifestPath = path.join(bundlePath, "dataset.json");
  const manifestFile = await readBoundedRegularFile(manifestPath, limits.maxJsonBytes, bundlePath, signal);
  const manifest = parseJsonRecord(manifestFile.bytes, DatasetManifestSchema, "dataset.query.manifest_invalid");
  const revisionPath = await resolveBundleRef(bundlePath, manifest.revision.path, signal);
  const schemaPath = await resolveBundleRef(bundlePath, manifest.schema.path, signal);
  const payloadPath = await resolveBundleRef(bundlePath, manifest.payload.path, signal);
  if (new Set([revisionPath, schemaPath, payloadPath]).size !== 3) {
    throw new PigeDomainError("dataset.query.manifest_invalid", "The active Dataset files must have distinct fixed roles.");
  }
  const revisionFile = await readBoundedRegularFile(revisionPath, limits.maxJsonBytes, bundlePath, signal);
  assertFileRef(revisionFile, manifest.revision, "revision");
  const revision = parseJsonRecord(revisionFile.bytes, DatasetRevisionSchema, "dataset.query.revision_invalid");
  const schemaFile = await readBoundedRegularFile(schemaPath, limits.maxJsonBytes, bundlePath, signal);
  assertFileRef(schemaFile, manifest.schema, "schema");
  const schema = parseJsonRecord(schemaFile.bytes, DatasetSchemaRecordSchema, "dataset.query.schema_invalid");
  const payloadFile = await checksumRegularFile(payloadPath, limits.maxPayloadBytes, bundlePath, signal);
  assertFileRef(payloadFile, manifest.payload, "payload");
  const sidecars = await Promise.all(
    ["-journal", "-wal", "-shm"].map((suffix) => pathExists(`${payloadPath}${suffix}`))
  );
  if (sidecars.some(Boolean)) {
    throw new PigeDomainError("dataset.query.payload_unsafe", "The active managed Dataset payload has live SQLite sidecars.");
  }
  if (
    manifest.profile !== "managed_collection" ||
    manifest.activeRevision !== revision.id ||
    manifest.datasetId !== revision.datasetId ||
    manifest.datasetId !== schema.datasetId ||
    revision.id !== schema.revisionId ||
    manifest.sourceId !== revision.source.sourceId ||
    hashCanonical(manifest.schema) !== hashCanonical(revision.schema) ||
    hashCanonical(manifest.payload) !== hashCanonical(revision.payload) ||
    revision.schema.path !== manifest.schema.path ||
    revision.payload.path !== manifest.payload.path ||
    schema.tables.length !== revision.stats.tableCount ||
    schema.tables.reduce((sum, table) => sum + table.rowCount, 0) !== revision.stats.rowCount ||
    schema.tables.reduce((sum, table) => sum + table.columnCount, 0) !== revision.stats.columnCount
  ) {
    throw new PigeDomainError("dataset.query.revision_stale", "The Dataset Bundle active revision and schema binding is stale or inconsistent.");
  }
  const source = await readSourceEvidenceFact(vault, revision, manifest, bundleRelativePath, limits, signal);
  return {
    bundleRelativePath,
    bundlePath,
    manifest,
    revision,
    schema,
    payloadPath,
    source,
    identity: {
      bundleRelativePath,
      manifestHash: manifestFile.checksum,
      revisionChecksum: revisionFile.checksum,
      schemaChecksum: schemaFile.checksum,
      payloadChecksum: payloadFile.checksum,
      sourceRevisionHash: source.sourceRevisionHash
    }
  };
}

async function readSourceEvidenceFact(
  vault: VaultRoots,
  revision: DatasetRevision,
  manifest: DatasetManifest,
  bundleRelativePath: string,
  limits: DatasetQueryLimits,
  signal?: AbortSignal
): Promise<SourceEvidenceFact> {
  const match = /^src_(\d{8})_[a-z0-9]{8,}$/u.exec(revision.source.sourceId);
  const dateKey = match?.[1];
  if (!dateKey) throw sourceStaleError();
  const directorySegments = [".pige", "source-records", dateKey.slice(0, 4), dateKey.slice(4, 6)];
  let current = vault.resolvedVault;
  for (const segment of directorySegments) {
    assertNotAborted(signal);
    current = path.join(current, segment);
    const stat = await fs.promises.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw symlinkError();
    const real = await fs.promises.realpath(current);
    if (!real.startsWith(`${vault.realVault}${path.sep}`)) throw symlinkError();
  }
  const sourcePath = path.join(current, `${revision.source.sourceId}.json`);
  const sourceFile = await readBoundedRegularFile(sourcePath, limits.maxSourceRecordBytes, current, signal);
  const source = parseJsonRecord(sourceFile.bytes, SourceRecordSchema, "dataset.query.source_stale");
  const sourceAssetChecksum = source.managedCopy?.checksum ?? source.original?.checksum;
  const sourceAssetSize = source.managedCopy?.size ?? source.original?.lastKnownSize;
  if (
    source.id !== revision.source.sourceId ||
    source.kind !== revision.source.sourceKind ||
    createDatasetSourceBindingHash(source) !== revision.source.sourceRecordHash ||
    sourceAssetChecksum !== revision.source.sourceAssetChecksum ||
    sourceAssetSize !== revision.source.sourceAssetSize ||
    source.metadata.datasetId !== manifest.datasetId ||
    source.metadata.datasetRevisionId !== manifest.activeRevision ||
    source.metadata.datasetBundlePath !== bundleRelativePath ||
    source.metadata.datasetProfile !== "managed_collection"
  ) throw sourceStaleError();
  const privacy = typeof source.metadata.privacy === "string" ? source.metadata.privacy : undefined;
  return {
    sourceId: source.id,
    sourceRevisionHash: hashCanonical(source),
    updatedAt: source.updatedAt,
    privateContent: source.metadata.private === true || privacy === "private",
    sensitiveContent: source.metadata.sensitive === true || privacy === "sensitive",
    restrictedContent: source.metadata.restricted === true || privacy === "restricted"
  };
}

function createDatasetSourceBindingHash(source: SourceRecord): string {
  return hashCanonical({
    id: source.id,
    kind: source.kind,
    storageStrategy: source.storageStrategy,
    managedCopy: source.managedCopy,
    original: source.original ? {
      uri: source.original.uri,
      path: source.original.path,
      checksum: source.original.checksum,
      lastKnownSize: source.original.lastKnownSize
    } : undefined,
    createdAt: source.createdAt
  });
}

function createCatalogEnvelope(
  datasets: readonly BoundDataset[],
  omittedDatasets: number,
  omittedTables: number,
  omittedColumns: number,
  limits: DatasetQueryLimits
): CatalogEnvelope {
  return {
    schemaVersion: 1,
    status: datasets.length > 0 ? "ready" : "empty",
    datasets: datasets.map((dataset) => ({
      datasetRef: dataset.ref,
      title: dataset.snapshot.manifest.title,
      tables: dataset.tables.map((table) => ({
        tableRef: table.ref,
        name: table.table.name,
        columns: table.columns.map(({ ref, column }) => ({
          columnRef: ref,
          name: column.name,
          logicalType: column.logicalType
        }))
      }))
    })),
    queryContract: {
      action: "query",
      filterOperators: [
        "eq", "ne", "lt", "lte", "gt", "gte", "contains", "starts_with",
        "is_missing", "is_empty", "is_null", "is_not_null"
      ],
      aggregateOperators: ["count", "sum", "min", "max", "avg"],
      orderDirections: ["asc", "desc"],
      aggregateRefs: "aggregate_N refers to the Nth aggregate in this query",
      limits: {
        selectedColumns: limits.maxSelectedColumns,
        filters: limits.maxFilters,
        groupByColumns: limits.maxGroupByColumns,
        aggregates: limits.maxAggregates,
        orderBy: limits.maxOrderBy,
        rows: limits.maxResultRows
      }
    },
    omitted: {
      datasets: Math.max(0, omittedDatasets),
      tables: Math.max(0, omittedTables),
      columns: Math.max(0, omittedColumns)
    }
  };
}

function trimCatalogTail(datasets: BoundDataset[]): boolean {
  const dataset = datasets.at(-1);
  if (!dataset) return false;
  const tables = dataset.tables as BoundTable[];
  const table = tables.at(-1);
  if (!table) {
    datasets.pop();
    return true;
  }
  const columns = table.columns as BoundColumn[];
  if (columns.length > 0) columns.pop();
  if (columns.length === 0) tables.pop();
  if (tables.length === 0) datasets.pop();
  return true;
}

function createCatalogEvidence(
  modelText: string,
  catalogHash: string,
  datasets: readonly BoundDataset[]
): DatasetQueryEvidenceSnapshot {
  const snapshots = datasets.map(({ snapshot }) => snapshot);
  const sourceIds = [...new Set(snapshots.map(({ source }) => source.sourceId))].sort(binaryCompare);
  const privateContent = snapshots.some(({ source }) => source.privateContent);
  const sensitiveContent = snapshots.some(({ source }) => source.sensitiveContent);
  const restrictedContent = snapshots.some(({ source }) => source.restrictedContent) ||
    containsRestrictedModelContent(modelText);
  return Object.freeze({
    evidenceHash: hashCanonical({
      kind: "dataset_catalog",
      catalogHash,
      bundleIdentities: snapshots.map(({ identity }) => identity),
      modelTextHash: hashText(modelText),
      privateContent,
      sensitiveContent,
      restrictedContent,
      sourceIds
    }),
    privateContent,
    sensitiveContent,
    restrictedContent,
    modelText,
    sourceIds
  });
}

function resolveQueryBinding(
  state: CatalogState,
  request: DatasetQueryRequest,
  limits: DatasetQueryLimits
): ResolvedQueryBinding {
  const dataset = state.datasets.find((candidate) => candidate.ref === request.datasetRef);
  const table = dataset?.tables.find((candidate) => candidate.ref === request.tableRef);
  if (!dataset || !table) {
    throw new PigeDomainError("dataset.query.ref_invalid", "The Dataset query references an unavailable opaque catalog item.");
  }
  const columnsByRef = new Map(table.columns.map((column) => [column.ref, column]));
  const referenced = collectRequestColumnRefs(request);
  if (referenced.size > limits.maxReferencedColumns) {
    throw new PigeDomainError("dataset.query.limit.referenced_columns", "The Dataset query references too many bounded columns.");
  }
  for (const ref of referenced) {
    const column = columnsByRef.get(ref);
    if (!column) {
      throw new PigeDomainError("dataset.query.ref_invalid", "The Dataset query references a column outside its selected table.");
    }
  }
  validateQueryColumnTypes(request, columnsByRef);
  return { dataset, table, columnsByRef };
}

function collectRequestColumnRefs(request: DatasetQueryRequest): Set<ColumnOpaqueRef> {
  const refs = new Set<ColumnOpaqueRef>(request.select);
  for (const filter of request.filters ?? []) refs.add(filter.column);
  for (const ref of request.groupBy ?? []) refs.add(ref);
  for (const aggregate of request.aggregates ?? []) if (aggregate.column) refs.add(aggregate.column);
  for (const order of request.orderBy ?? []) {
    if (order.by.startsWith("column_")) refs.add(order.by as ColumnOpaqueRef);
  }
  return refs;
}

function validateQueryColumnTypes(
  request: DatasetQueryRequest,
  columnsByRef: ReadonlyMap<ColumnOpaqueRef, BoundColumn>
): void {
  for (const filter of request.filters ?? []) {
    const logicalType = columnsByRef.get(filter.column)?.column.logicalType;
    if (!logicalType) throw invalidPlanError();
    if (filter.op === "is_missing" || filter.op === "is_empty" || filter.op === "is_null" || filter.op === "is_not_null") {
      continue;
    }
    if (filter.op === "contains" || filter.op === "starts_with") {
      if (logicalType !== "string") throw invalidPlanError();
      continue;
    }
    if (!("value" in filter)) throw invalidPlanError();
    const value = filter.value;
    if (logicalType === "integer") {
      if (typeof value !== "number" || !Number.isSafeInteger(value)) throw invalidPlanError();
    } else if (logicalType === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) throw invalidPlanError();
    } else if (logicalType === "boolean") {
      if (typeof value !== "boolean" || !["eq", "ne"].includes(filter.op)) throw invalidPlanError();
    } else if (logicalType === "string" || logicalType === "date" || logicalType === "datetime") {
      if (typeof value !== "string") throw invalidPlanError();
    } else {
      throw invalidPlanError();
    }
    if (typeof value === "string" && byteLength(value) > DATASET_QUERY_DEFAULT_LIMITS.maxFilterTextBytes) {
      throw invalidPlanError();
    }
  }
  for (const aggregate of request.aggregates ?? []) {
    if (!aggregate.column) continue;
    const logicalType = columnsByRef.get(aggregate.column)?.column.logicalType;
    if (!logicalType) throw invalidPlanError();
    if ((aggregate.op === "sum" || aggregate.op === "avg") && logicalType !== "integer" && logicalType !== "number") {
      throw invalidPlanError();
    }
    if ((aggregate.op === "min" || aggregate.op === "max") && (logicalType === "binary" || logicalType === "unknown")) {
      throw invalidPlanError();
    }
  }
}

type PreparedWorkerInput = Omit<DatasetQueryWorkerInput, "payloadPath">;

function createWorkerInput(
  binding: ResolvedQueryBinding,
  request: DatasetQueryRequest,
  limits: DatasetQueryLimits
): PreparedWorkerInput {
  const referenced = collectRequestColumnRefs(request);
  if (referenced.size === 0) {
    const anchor = binding.table.columns[0];
    if (!anchor) throw invalidPlanError();
    referenced.add(anchor.ref);
  }
  const boundColumns = [...referenced].map((ref) => {
    const bound = binding.columnsByRef.get(ref);
    if (!bound) throw invalidPlanError();
    return bound;
  }).sort((left, right) =>
    left.column.ordinal - right.column.ordinal || binaryCompare(left.column.id, right.column.id)
  );
  const toColumnId = (ref: ColumnOpaqueRef): string => {
    const column = binding.columnsByRef.get(ref);
    if (!column) throw invalidPlanError();
    return column.column.id;
  };
  const filters: DatasetQueryInternalFilter[] = (request.filters ?? []).map((filter) => ({
    columnId: toColumnId(filter.column),
    op: filter.op,
    ...("value" in filter ? { value: filter.value } : {})
  }));
  const aggregates: DatasetQueryInternalAggregate[] = (request.aggregates ?? []).map((aggregate, index) => ({
    ref: `aggregate_${index + 1}`,
    op: aggregate.op,
    ...(aggregate.column ? { columnId: toColumnId(aggregate.column) } : {})
  }));
  const orders: DatasetQueryInternalOrder[] = (request.orderBy ?? []).map((order) => ({
    by: order.by.startsWith("column_") ? toColumnId(order.by as ColumnOpaqueRef) : order.by,
    direction: order.direction
  }));
  const columns: DatasetQueryInternalColumn[] = boundColumns.map(({ column }) => ({
    id: column.id,
    name: column.name,
    ordinal: column.ordinal,
    logicalType: column.logicalType
  }));
  return {
    binding: {
      datasetId: binding.dataset.snapshot.manifest.datasetId,
      revisionId: binding.dataset.snapshot.revision.id,
      schemaChecksum: binding.dataset.snapshot.identity.schemaChecksum,
      payloadChecksum: binding.dataset.snapshot.identity.payloadChecksum
    },
    table: {
      id: binding.table.table.id,
      name: binding.table.table.name,
      rowCount: binding.table.table.rowCount,
      columnCount: binding.table.table.columnCount
    },
    columns,
    plan: {
      selectColumnIds: request.select.map(toColumnId),
      filters,
      groupByColumnIds: (request.groupBy ?? []).map(toColumnId),
      aggregates,
      orderBy: orders,
      limit: request.limit
    },
    limits: { ...limits }
  };
}

async function createPrivatePayloadSnapshot(
  bundle: BundleSnapshot,
  limits: DatasetQueryLimits,
  signal?: AbortSignal
): Promise<PrivatePayloadSnapshot> {
  if (signal?.aborted) throw abortedError();
  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pige-dataset-query-"));
  const destinationPath = path.join(temporaryRoot, "collection.sqlite");
  let source: fs.promises.FileHandle | undefined;
  let destination: fs.promises.FileHandle | undefined;
  try {
    const rootStat = await fs.promises.lstat(temporaryRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw symlinkError();
    source = await fs.promises.open(
      bundle.payloadPath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
    );
    const sourceBefore = await source.stat();
    if (
      !sourceBefore.isFile() ||
      sourceBefore.size <= 0 ||
      sourceBefore.size > limits.maxPayloadBytes ||
      sourceBefore.size !== bundle.manifest.payload.size
    ) throw staleEvidenceError();
    destination = await fs.promises.open(
      destinationPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
      0o600
    );
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1 * 1_024 * 1_024);
    let position = 0;
    while (position < sourceBefore.size) {
      if (signal?.aborted) throw abortedError();
      const read = await source.read(buffer, 0, Math.min(buffer.length, sourceBefore.size - position), position);
      if (read.bytesRead <= 0) throw staleEvidenceError();
      const chunk = buffer.subarray(0, read.bytesRead);
      hash.update(chunk);
      let written = 0;
      while (written < chunk.length) {
        const result = await destination.write(chunk, written, chunk.length - written, position + written);
        if (result.bytesWritten <= 0) throw staleEvidenceError();
        written += result.bytesWritten;
      }
      position += read.bytesRead;
    }
    await destination.sync();
    const sourceAfter = await source.stat();
    const currentPath = await fs.promises.lstat(bundle.payloadPath);
    if (
      !sameFileRevision(sourceBefore, sourceAfter) ||
      currentPath.isSymbolicLink() ||
      !sameFileRevision(sourceAfter, currentPath) ||
      `sha256:${hash.digest("hex")}` !== bundle.identity.payloadChecksum
    ) throw staleEvidenceError();
  } catch (caught) {
    await source?.close().catch(() => undefined);
    await destination?.close().catch(() => undefined);
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("dataset.query.payload_unavailable", "The active Dataset payload could not be bound to a private query snapshot.");
  }
  await source.close();
  await destination.close();
  return {
    filePath: destinationPath,
    dispose: async () => {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    }
  };
}

function validateCoreResult(result: DatasetQueryCoreResult, input: PreparedWorkerInput): void {
  const hashRequest: DatasetQueryWorkerRequest = {
    ...input,
    payloadPath: path.resolve(os.tmpdir(), "pige-private-dataset-query-snapshot"),
    schemaVersion: DATASET_QUERY_PROTOCOL_VERSION,
    requestId: "result-validation"
  };
  if (
    typeof result !== "object" ||
    result === null ||
    result.planHash !== createDatasetQueryPlanHash(hashRequest) ||
    result.resultHash !== createDatasetQueryResultHash(withoutResultHash(result)) ||
    !Number.isSafeInteger(result.sourceMatchedRowCount) ||
    result.sourceMatchedRowCount < 0 ||
    !Number.isSafeInteger(result.matchedRowCount) ||
    result.matchedRowCount < 0 ||
    result.returnedRowCount !== result.rows.length ||
    result.rows.length > input.limits.maxResultRows ||
    result.columns.length === 0 ||
    result.columns.length > input.limits.maxResultColumns ||
    result.truncated !== (result.matchedRowCount > result.returnedRowCount) ||
    result.rows.some((row) => row.values.length !== result.columns.length || row.states.length !== result.columns.length) ||
    result.usedColumnIds.length === 0 ||
    result.usedColumnIds.some((id) => !input.columns.some((column) => column.id === id)) ||
    result.returnedRowIds.length > input.limits.maxResultRows ||
    byteLength(JSON.stringify(result)) > input.limits.maxResultBytes + 1_024
  ) {
    throw new PigeDomainError("dataset.query.worker_protocol", "The Dataset query worker returned an invalid bounded result.");
  }
}

function withoutResultHash(result: DatasetQueryCoreResult): Omit<DatasetQueryCoreResult, "resultHash"> {
  return {
    planHash: result.planHash,
    columns: result.columns,
    rows: result.rows,
    sourceMatchedRowCount: result.sourceMatchedRowCount,
    matchedRowCount: result.matchedRowCount,
    returnedRowCount: result.returnedRowCount,
    truncated: result.truncated,
    usedColumnIds: result.usedColumnIds,
    returnedRowIds: result.returnedRowIds,
    ...(result.range ? { range: result.range } : {})
  };
}

function createExecutionResult(
  binding: ResolvedQueryBinding,
  request: DatasetQueryRequest,
  core: DatasetQueryCoreResult,
  catalogHash: string,
  limits: DatasetQueryLimits
): DatasetQueryExecutionResult {
  const refsByColumnId = new Map(
    binding.table.columns.map(({ ref, column }) => [column.id, ref] as const)
  );
  const previewColumns = core.columns.map((column) => ({
    key: refsByColumnId.get(column.key) ?? column.key,
    label: column.label,
    logicalType: column.logicalType,
    ...(column.sourceColumnId ? { sourceColumnId: column.sourceColumnId } : {}),
    ...(column.aggregate ? { aggregate: column.aggregate } : {})
  }));
  const preview: DatasetQueryPreview = DatasetQueryPreviewSchema.parse({
    datasetId: binding.dataset.snapshot.manifest.datasetId,
    revisionId: binding.dataset.snapshot.revision.id,
    tableId: binding.table.table.id,
    tableName: binding.table.table.name,
    planHash: core.planHash,
    resultHash: core.resultHash,
    columns: previewColumns,
    rows: core.rows.map((row) => ({
      ...(row.rowId ? { rowId: row.rowId } : {}),
      values: row.values
    })),
    matchedRowCount: core.matchedRowCount,
    returnedRowCount: core.returnedRowCount,
    truncated: core.truncated,
    citationRefs: [CITATION_REF]
  });
  const citation: DatasetAnswerCitation = DatasetAnswerCitationSchema.parse({
    kind: "dataset",
    refId: CITATION_REF,
    label: truncateText(
      `${binding.dataset.snapshot.manifest.title}: ${binding.table.table.name}`,
      160
    ),
    title: binding.dataset.snapshot.manifest.title,
    locator: truncateText(
      `dataset:${preview.datasetId}#revision=${preview.revisionId};table=${preview.tableId};result=${preview.resultHash}`,
      512
    ),
    evidence: {
      datasetId: preview.datasetId,
      revisionId: preview.revisionId,
      tableId: preview.tableId,
      schemaId: binding.dataset.snapshot.identity.schemaChecksum,
      columnIds: core.usedColumnIds,
      ...(core.returnedRowIds.length > 0 ? { rowIds: core.returnedRowIds } : {}),
      ...(core.range ? { range: core.range } : {}),
      queryPlanHash: preview.planHash,
      resultHash: preview.resultHash,
      sourceId: binding.dataset.snapshot.source.sourceId,
      sourceRevisionHash: binding.dataset.snapshot.source.sourceRevisionHash
    }
  });
  const modelEnvelope = {
    schemaVersion: 1,
    status: "result",
    datasetRef: request.datasetRef,
    tableRef: request.tableRef,
    tableName: binding.table.table.name,
    planHash: core.planHash,
    resultHash: core.resultHash,
    columns: core.columns.map((column) => ({
      key: refsByColumnId.get(column.key) ?? column.key,
      name: column.label,
      logicalType: column.logicalType,
      ...(column.aggregate ? { aggregate: column.aggregate } : {})
    })),
    rows: core.rows.map((row, index) => ({
      rowRef: `${row.rowId ? "row" : "group"}_${index + 1}`,
      ...(row.sourceRow !== undefined ? { sourceRow: row.sourceRow } : {}),
      cells: row.values.map((value, cellIndex) => ({
        column: refsByColumnId.get(core.columns[cellIndex]?.key ?? "") ?? core.columns[cellIndex]?.key,
        state: row.states[cellIndex],
        value
      }))
    })),
    sourceRowsMatched: core.sourceMatchedRowCount,
    resultRowsMatched: core.matchedRowCount,
    returnedRowCount: core.returnedRowCount,
    truncated: core.truncated,
    citationRefs: [CITATION_REF]
  };
  const modelText = createUntrustedEnvelope(modelEnvelope);
  if (byteLength(modelText) > limits.maxResultBytes) {
    throw new PigeDomainError("dataset.query.limit.result_bytes", "The Dataset query model envelope exceeds its bounded output size.");
  }
  const evidence = createResultEvidence(
    modelText,
    binding.dataset.snapshot,
    core.planHash,
    core.resultHash
  );
  return deepFreeze({ preview, citations: [citation], evidence });
}

function createResultEvidence(
  modelText: string,
  bundle: BundleSnapshot,
  planHash: string,
  resultHash: string
): DatasetQueryEvidenceSnapshot {
  const privateContent = bundle.source.privateContent;
  const sensitiveContent = bundle.source.sensitiveContent;
  const restrictedContent = bundle.source.restrictedContent || containsRestrictedModelContent(modelText);
  const sourceIds = [bundle.source.sourceId];
  return Object.freeze({
    evidenceHash: hashCanonical({
      kind: "dataset_query_result",
      bundleIdentity: bundle.identity,
      planHash,
      resultHash,
      modelTextHash: hashText(modelText),
      privateContent,
      sensitiveContent,
      restrictedContent,
      sourceIds
    }),
    privateContent,
    sensitiveContent,
    restrictedContent,
    modelText,
    sourceIds
  });
}

interface ReadFileResult {
  readonly bytes: Buffer;
  readonly checksum: string;
  readonly size: number;
  readonly stat: fs.Stats;
}

interface ChecksumFileResult {
  readonly checksum: string;
  readonly size: number;
  readonly stat: fs.Stats;
}

async function readBoundedRegularFile(
  filePath: string,
  maximumBytes: number,
  confinedRoot: string,
  signal?: AbortSignal
): Promise<ReadFileResult> {
  const beforePath = await assertConfinedRegularFile(filePath, maximumBytes, confinedRoot, signal);
  const descriptor = await fs.promises.open(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const before = await descriptor.stat();
    if (!sameFileRevision(beforePath, before)) throw staleEvidenceError();
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      assertNotAborted(signal);
      const read = await descriptor.read(bytes, offset, Math.min(1 * 1_024 * 1_024, bytes.length - offset), offset);
      if (read.bytesRead <= 0) throw staleEvidenceError();
      offset += read.bytesRead;
    }
    const after = await descriptor.stat();
    const current = await fs.promises.lstat(filePath);
    if (!sameFileRevision(before, after) || !sameFileRevision(after, current) || current.isSymbolicLink()) {
      throw staleEvidenceError();
    }
    return {
      bytes,
      checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      size: before.size,
      stat: before
    };
  } finally {
    await descriptor.close();
  }
}

async function checksumRegularFile(
  filePath: string,
  maximumBytes: number,
  confinedRoot: string,
  signal?: AbortSignal
): Promise<ChecksumFileResult> {
  const beforePath = await assertConfinedRegularFile(filePath, maximumBytes, confinedRoot, signal);
  const descriptor = await fs.promises.open(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1 * 1_024 * 1_024);
  try {
    const before = await descriptor.stat();
    if (!sameFileRevision(beforePath, before)) throw staleEvidenceError();
    let position = 0;
    while (position < before.size) {
      assertNotAborted(signal);
      const read = await descriptor.read(buffer, 0, Math.min(buffer.length, before.size - position), position);
      if (read.bytesRead <= 0) throw staleEvidenceError();
      hash.update(buffer.subarray(0, read.bytesRead));
      position += read.bytesRead;
    }
    const after = await descriptor.stat();
    const current = await fs.promises.lstat(filePath);
    if (!sameFileRevision(before, after) || !sameFileRevision(after, current) || current.isSymbolicLink()) {
      throw staleEvidenceError();
    }
    return { checksum: `sha256:${hash.digest("hex")}`, size: before.size, stat: before };
  } finally {
    await descriptor.close();
  }
}

async function assertConfinedRegularFile(
  filePath: string,
  maximumBytes: number,
  confinedRoot: string,
  signal?: AbortSignal
): Promise<fs.Stats> {
  assertNotAborted(signal);
  const stat = await fs.promises.lstat(filePath);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 0 || stat.size > maximumBytes) throw symlinkError();
  const realRoot = await fs.promises.realpath(confinedRoot);
  const realFile = await fs.promises.realpath(filePath);
  if (realFile === realRoot || !realFile.startsWith(`${realRoot}${path.sep}`)) throw symlinkError();
  assertNotAborted(signal);
  return stat;
}

async function resolveBundleRef(bundlePath: string, relativePath: string, signal?: AbortSignal): Promise<string> {
  const segments = parseSafeRelativePath(relativePath);
  const resolved = path.resolve(bundlePath, ...segments);
  if (resolved === bundlePath || !resolved.startsWith(`${bundlePath}${path.sep}`)) throw symlinkError();
  let current = bundlePath;
  for (const segment of segments.slice(0, -1)) {
    assertNotAborted(signal);
    current = path.join(current, segment);
    const stat = await fs.promises.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw symlinkError();
  }
  return resolved;
}

function parseSafeRelativePath(relativePath: string): readonly string[] {
  if (
    typeof relativePath !== "string" ||
    !relativePath ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    relativePath.includes(":") ||
    relativePath.includes("\u0000")
  ) throw new PigeDomainError("dataset.query.path_unsafe", "Dataset paths must be confined relative POSIX paths.");
  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new PigeDomainError("dataset.query.path_unsafe", "Dataset paths contain an unsafe segment.");
  }
  return segments;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.lstat(filePath);
    return true;
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw caught;
  }
}

function parseJsonRecord<T>(
  bytes: Buffer,
  schema: { parse(value: unknown): T },
  code: string
): T {
  try {
    return schema.parse(JSON.parse(bytes.toString("utf8")));
  } catch {
    throw new PigeDomainError(code, "A durable Dataset evidence record is invalid or unsupported.");
  }
}

function assertFileRef(
  file: Pick<ReadFileResult, "checksum" | "size"> | Pick<ChecksumFileResult, "checksum" | "size">,
  ref: { readonly checksum: string; readonly size: number },
  role: string
): void {
  if (file.checksum !== ref.checksum || file.size !== ref.size) {
    throw new PigeDomainError(
      "dataset.query.payload_tampered",
      `The active Dataset ${role} checksum or size does not match its manifest.`
    );
  }
}

function validateServiceLimits(limits: DatasetQueryLimits): void {
  for (const key of Object.keys(DATASET_QUERY_DEFAULT_LIMITS) as (keyof DatasetQueryLimits)[]) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value <= 0 || value > DATASET_QUERY_DEFAULT_LIMITS[key]) {
      throw new PigeDomainError("dataset.query.limit_invalid", "Dataset query service limits cannot exceed the repository policy.");
    }
  }
}

function createUntrustedEnvelope(value: unknown): string {
  const serialized = JSON.stringify(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `${UNTRUSTED_DATASET_START}\n${serialized}\n${UNTRUSTED_DATASET_END}`;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function hashCanonical(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function sameFileRevision(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function binaryCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function truncateText(value: string, maximumCharacters: number): string {
  return Array.from(value).slice(0, maximumCharacters).join("");
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function invalidPlanError(): PigeDomainError {
  return new PigeDomainError("dataset.query.plan_invalid", "The Dataset query plan is incompatible with the catalog's logical types.");
}

function unboundCatalogError(): PigeDomainError {
  return new PigeDomainError("dataset.query.catalog_unbound", "The Dataset catalog is not bound to this service instance.");
}

function staleEvidenceError(): PigeDomainError {
  return new PigeDomainError("dataset.query.evidence_stale", "The Dataset revision, payload, schema, or source evidence changed.");
}

function sourceStaleError(): PigeDomainError {
  return new PigeDomainError("dataset.query.source_stale", "The Dataset source evidence no longer matches the active revision.");
}

function symlinkError(): PigeDomainError {
  return new PigeDomainError("dataset.query.symlink_rejected", "Dataset query paths cannot traverse symbolic links.");
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortedError();
}

function abortedError(): PigeDomainError {
  return new PigeDomainError("dataset.query.aborted", "The bounded local Dataset query was canceled.");
}
