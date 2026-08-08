import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  CollectionAnalyticalSnapshotIdSchema,
  CollectionRequestIdSchema,
  CollectionSnapshotSchema,
  DatasetIdSchema,
  DatasetRevisionIdSchema,
  OperationIdSchema,
  OperationRecordSchema,
  TableIdSchema,
  type CollectionSnapshot,
  type OperationRecord
} from "@pige/schemas";
import { z } from "zod";
import {
  hashCanonical,
  readBundle,
  readCollectionSnapshot,
  readImmutableCollectionRevision,
  readJsonBounded,
  writeJsonImmutable,
  operationPathFor
} from "./managed-collection-storage";

const SNAPSHOT_RECORD_BYTES = 128 * 1024;
const SNAPSHOT_DIRECTORY = ".pige/analytical-snapshots";

export const AnalyticalSnapshotRecordSchema = z.object({
  schemaVersion: z.literal(1),
  snapshotId: CollectionAnalyticalSnapshotIdSchema,
  requestId: CollectionRequestIdSchema,
  datasetId: DatasetIdSchema,
  revisionId: DatasetRevisionIdSchema,
  tableId: TableIdSchema,
  title: z.string().trim().min(1).max(240),
  tableName: z.string().trim().min(1).max(512),
  sourceRevisionHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  rowCount: z.number().int().nonnegative().max(10_000_000),
  columnCount: z.number().int().positive().max(32),
  operationId: OperationIdSchema,
  createdAt: z.string().datetime({ offset: true })
}).strict();

export type AnalyticalSnapshotRecord = z.infer<typeof AnalyticalSnapshotRecordSchema>;

export interface AnalyticalSnapshotCreateRequest {
  readonly requestId: string;
  readonly activeVaultId: string;
  readonly datasetId: string;
  readonly tableId: string;
  readonly expectedRevisionId: string;
}

export interface AnalyticalSnapshotSummary {
  readonly snapshotId: string;
  readonly datasetId: string;
  readonly revisionId: string;
  readonly tableId: string;
  readonly title: string;
  readonly tableName: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly operationId: string;
  readonly createdAt: string;
}

export interface AnalyticalSnapshotPreview {
  readonly snapshotId: string;
  readonly datasetId: string;
  readonly revisionId: string;
  readonly tableId: string;
  readonly title: string;
  readonly tableName: string;
  readonly columns: CollectionSnapshot["columns"];
  readonly rows: CollectionSnapshot["rows"];
  readonly totalRowCount: number;
  readonly returnedRowCount: number;
  readonly truncated: boolean;
  readonly snapshotHash: string;
}

export interface AnalyticalSnapshotCitation {
  readonly snapshotId: string;
  readonly citationRef: string;
  readonly rowId: string;
  readonly columnIds: readonly string[];
  readonly resultHash: string;
  readonly preview: AnalyticalSnapshotPreview;
}

export type AnalyticalSnapshotCreateResult =
  | { readonly status: "committed" | "already_committed"; readonly record: AnalyticalSnapshotRecord }
  | { readonly status: "stale" | "not_found" | "failed" };

export type AnalyticalSnapshotOpenResult =
  | { readonly status: "ready"; readonly preview: AnalyticalSnapshotPreview }
  | { readonly status: "stale" | "not_found" | "failed" };

export type AnalyticalSnapshotCitationResult =
  | { readonly status: "ready"; readonly citation: AnalyticalSnapshotCitation }
  | { readonly status: "stale" | "not_found" | "failed" };

export interface AnalyticalSnapshotServiceVaultPort {
  activeVaultPath(): string | undefined;
  current(): { readonly vaultId: string } | undefined;
}

/**
 * Owns immutable analytical snapshot descriptors. Payload truth stays in the
 * checksummed historical Dataset revision; this owner never copies whole rows
 * into the descriptor or exposes a filesystem path to the renderer.
 */
export class AnalyticalSnapshotService {
  readonly #vaults: AnalyticalSnapshotServiceVaultPort;

  constructor(vaults: AnalyticalSnapshotServiceVaultPort) {
    this.#vaults = vaults;
  }

  create(request: AnalyticalSnapshotCreateRequest): AnalyticalSnapshotCreateResult {
    if (!CollectionRequestIdSchema.safeParse(request.requestId).success) return { status: "failed" };
    const vaultPath = this.#activeVaultPath(request.activeVaultId);
    if (!vaultPath) return { status: "stale" };
    try {
      const binding = readBundle(vaultPath, request.datasetId);
      if (!binding) return { status: "not_found" };
      if (binding.manifest.activeRevision !== request.expectedRevisionId) return { status: "stale" };
      const table = binding.schema.tables.find(({ id }) => id === request.tableId);
      if (!table) return { status: "not_found" };

      const existing = this.#findByRequest(vaultPath, request.requestId);
      if (existing) {
        if (existing.datasetId !== request.datasetId || existing.revisionId !== request.expectedRevisionId ||
            existing.tableId !== request.tableId) return { status: "stale" };
        const expectedOperation = this.#createOperation(existing);
        const operationPath = this.#operationPath(vaultPath, existing.operationId);
        if (fs.existsSync(operationPath)) {
          const operation = OperationRecordSchema.parse(readJsonBounded(operationPath, SNAPSHOT_RECORD_BYTES));
          if (hashCanonical(operation) !== hashCanonical(expectedOperation)) return { status: "failed" };
        } else {
          writeJsonImmutable(operationPath, expectedOperation);
        }
        return { status: "already_committed", record: existing };
      }

      const now = new Date().toISOString();
      const snapshotId = `snapshot_${dateKey(now)}_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
      const operationId = `op_${dateKey(now)}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
      const record = AnalyticalSnapshotRecordSchema.parse({
        schemaVersion: 1,
        snapshotId,
        requestId: request.requestId,
        datasetId: binding.manifest.datasetId,
        revisionId: binding.revision.id,
        tableId: table.id,
        title: `${binding.manifest.title} snapshot`,
        tableName: table.name,
        sourceRevisionHash: snapshotSourceRevisionHash(binding.manifest.datasetId, binding.revision),
        rowCount: table.rowCount,
        columnCount: table.columnCount,
        operationId,
        createdAt: now
      });
      const recordPath = this.#recordPath(vaultPath, record.snapshotId);
      writeJsonImmutable(recordPath, record);
      const operation = this.#createOperation(record);
      writeJsonImmutable(this.#operationPath(vaultPath, operation.id), operation);
      return { status: "committed", record };
    } catch (error) {
      if (error instanceof PigeDomainError && error.code === "collection.revision_changed") return { status: "stale" };
      return { status: "failed" };
    }
  }

  list(activeVaultId: string): readonly AnalyticalSnapshotSummary[] {
    const vaultPath = this.#activeVaultPath(activeVaultId);
    if (!vaultPath) return [];
    const root = path.join(vaultPath, SNAPSHOT_DIRECTORY);
    if (!fs.existsSync(root)) return [];
    const entries = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .slice(0, 256);
    const summaries: AnalyticalSnapshotSummary[] = [];
    for (const entry of entries) {
      try {
        const record = AnalyticalSnapshotRecordSchema.parse(readJsonBounded(path.join(root, entry.name), SNAPSHOT_RECORD_BYTES));
        summaries.push(toAnalyticalSnapshotSummary(record));
      } catch {
        // A malformed descriptor is not user-visible and cannot grant access.
      }
    }
    return summaries.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.snapshotId.localeCompare(right.snapshotId));
  }

  /** Re-proves a descriptor after its own file has been moved to recoverable trash. */
  isCurrentRecord(activeVaultId: string, record: AnalyticalSnapshotRecord): boolean {
    const vaultPath = this.#activeVaultPath(activeVaultId);
    if (!vaultPath) return false;
    try {
      const binding = readBundle(vaultPath, record.datasetId);
      if (!binding) return false;
      const revision = readImmutableCollectionRevision(binding, record.revisionId);
      const table = revision.schema.tables.find(({ id }) => id === record.tableId);
      if (!table || table.rowCount !== record.rowCount || table.columnCount !== record.columnCount ||
          snapshotSourceRevisionHash(binding.manifest.datasetId, revision.revision) !== record.sourceRevisionHash) return false;
      return readCollectionSnapshot(revision, record.tableId, { totalRowCount: record.rowCount }) !== undefined;
    } catch {
      return false;
    }
  }

  open(activeVaultId: string, snapshotId: string): AnalyticalSnapshotOpenResult {
    const vaultPath = this.#activeVaultPath(activeVaultId);
    if (!vaultPath || !CollectionAnalyticalSnapshotIdSchema.safeParse(snapshotId).success) return { status: "stale" };
    try {
      const record = this.#readRecord(vaultPath, snapshotId);
      if (!record) return { status: "not_found" };
      const binding = readBundle(vaultPath, record.datasetId);
      if (!binding) return { status: "not_found" };
      const revision = readImmutableCollectionRevision(binding, record.revisionId);
      const table = revision.schema.tables.find(({ id }) => id === record.tableId);
      if (!table || table.rowCount !== record.rowCount || table.columnCount !== record.columnCount ||
          snapshotSourceRevisionHash(binding.manifest.datasetId, revision.revision) !== record.sourceRevisionHash) return { status: "stale" };
      const source = readCollectionSnapshot(revision, record.tableId, { totalRowCount: record.rowCount });
      if (!source) return { status: "not_found" };
      const preview = toPreview(record, source);
      return { status: "ready", preview };
    } catch {
      return { status: "failed" };
    }
  }

  openCitation(activeVaultId: string, snapshotId: string, rowId: string): AnalyticalSnapshotCitationResult {
    const opened = this.open(activeVaultId, snapshotId);
    if (opened.status !== "ready") return opened;
    const row = opened.preview.rows.find((candidate) => candidate.rowId === rowId);
    if (!row) return { status: "not_found" };
    const columnIds = row.cells.map(({ columnId }) => columnId);
    const resultHash = hashCanonical({ snapshotId, rowId, columnIds, values: row.cells.map(({ value }) => value) });
    return {
      status: "ready",
      citation: {
        snapshotId,
        citationRef: `snapshot_citation_${resultHash.slice("sha256:".length, "sha256:".length + 16)}`,
        rowId,
        columnIds,
        resultHash,
        preview: opened.preview
      }
    };
  }

  #activeVaultPath(activeVaultId: string): string | undefined {
    const current = this.#vaults.current();
    if (!current || current.vaultId !== activeVaultId) return undefined;
    return this.#vaults.activeVaultPath();
  }

  #recordPath(vaultPath: string, snapshotId: string): string {
    if (!CollectionAnalyticalSnapshotIdSchema.safeParse(snapshotId).success) throw new PigeDomainError("dataset.snapshot.path_unsafe", "Invalid snapshot identity.");
    return path.join(vaultPath, SNAPSHOT_DIRECTORY, `${snapshotId}.json`);
  }

  #operationPath(vaultPath: string, operationId: string): string {
    try {
      return operationPathFor(vaultPath, operationId);
    } catch {
      throw new PigeDomainError("dataset.snapshot.path_unsafe", "Invalid snapshot operation identity.");
    }
  }

  #readRecord(vaultPath: string, snapshotId: string): AnalyticalSnapshotRecord | undefined {
    const recordPath = this.#recordPath(vaultPath, snapshotId);
    if (!fs.existsSync(recordPath)) return undefined;
    return AnalyticalSnapshotRecordSchema.parse(readJsonBounded(recordPath, SNAPSHOT_RECORD_BYTES));
  }

  #findByRequest(vaultPath: string, requestId: string): AnalyticalSnapshotRecord | undefined {
    const root = path.join(vaultPath, SNAPSHOT_DIRECTORY);
    if (!fs.existsSync(root)) return undefined;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const record = AnalyticalSnapshotRecordSchema.parse(readJsonBounded(path.join(root, entry.name), SNAPSHOT_RECORD_BYTES));
        if (record.requestId === requestId) return record;
      } catch {
        // Ignore malformed records; they cannot be adopted.
      }
    }
    return undefined;
  }

  #createOperation(record: AnalyticalSnapshotRecord): OperationRecord {
    return OperationRecordSchema.parse({
      id: record.operationId,
      schemaVersion: 1,
      createdAt: record.createdAt,
      actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
      kind: "create_dataset_snapshot",
      targetRefs: [{ kind: "dataset", id: record.snapshotId }],
      sourceRefs: [{ kind: "dataset", id: record.datasetId }],
      after: { kind: "dataset", id: record.snapshotId },
      summary: "Created analytical snapshot",
      reversible: "no",
      warnings: []
    });
  }
}

export function toAnalyticalSnapshotSummary(record: AnalyticalSnapshotRecord): AnalyticalSnapshotSummary {
  return {
    snapshotId: record.snapshotId,
    datasetId: record.datasetId,
    revisionId: record.revisionId,
    tableId: record.tableId,
    title: record.title,
    tableName: record.tableName,
    rowCount: record.rowCount,
    columnCount: record.columnCount,
    operationId: record.operationId,
    createdAt: record.createdAt
  };
}

function toPreview(record: AnalyticalSnapshotRecord, source: CollectionSnapshot): AnalyticalSnapshotPreview {
  const preview = CollectionSnapshotSchema.parse({
    ...source,
    canAppendDefaultRow: false,
    canAddColumn: false,
    canAddFormulaColumn: false,
    canAddRelationColumn: false,
    canAddLookupColumn: false,
    canAddRollupColumn: false,
    canTrashTable: false,
    views: []
  });
  return {
    snapshotId: record.snapshotId,
    datasetId: record.datasetId,
    revisionId: record.revisionId,
    tableId: record.tableId,
    title: record.title,
    tableName: record.tableName,
    columns: preview.columns,
    rows: preview.rows,
    totalRowCount: preview.totalRowCount,
    returnedRowCount: preview.returnedRowCount,
    truncated: preview.truncated,
    snapshotHash: hashCanonical({ record, columns: preview.columns, rows: preview.rows })
  };
}

function dateKey(value: string): string {
  return value.slice(0, 10).replaceAll("-", "");
}

function snapshotSourceRevisionHash(datasetId: string, revision: { readonly id: string; readonly schema: unknown; readonly payload: unknown }): string {
  return hashCanonical({ datasetId, revisionId: revision.id, schema: revision.schema, payload: revision.payload });
}
