import { DatabaseSync } from "node:sqlite";
import {
  CollectionOpenRelatedRecordsRequestSchema,
  CollectionOpenRelatedRecordsResultSchema,
  DatasetPigeRelationCellSchema,
  type CollectionOpenRelatedRecordsRequest,
  type CollectionOpenRelatedRecordsResult
} from "@pige/schemas";
import {
  readBundle,
  readCollectionSnapshot,
  type BundleBinding
} from "./managed-collection-storage";

export type ManagedCollectionRelatedRecordRequest = CollectionOpenRelatedRecordsRequest;
export type ManagedCollectionRelatedRecordResult = CollectionOpenRelatedRecordsResult;

export interface ManagedCollectionRelatedRecordVaultPort {
  readonly current(): { readonly vaultId: string } | undefined;
  readonly activeVaultPath(): string | undefined;
}

/** Main-owned, bounded navigation from one relation cell to its target Dataset table. */
export class ManagedCollectionRelatedRecordService {
  readonly #vaults: ManagedCollectionRelatedRecordVaultPort;

  constructor(vaults: ManagedCollectionRelatedRecordVaultPort) {
    this.#vaults = vaults;
  }

  open(request: ManagedCollectionRelatedRecordRequest): ManagedCollectionRelatedRecordResult {
    const parsed = CollectionOpenRelatedRecordsRequestSchema.parse(request);
    const identity = {
      apiVersion: parsed.apiVersion,
      requestId: parsed.requestId,
      activeVaultId: parsed.activeVaultId,
      datasetId: parsed.datasetId,
      sourceTableId: parsed.sourceTableId,
      sourceColumnId: parsed.sourceColumnId,
      sourceRowId: parsed.sourceRowId
    };
    const result = (payload: Record<string, unknown>): ManagedCollectionRelatedRecordResult =>
      CollectionOpenRelatedRecordsResultSchema.parse({ ...identity, ...payload });
    const active = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!active || active.vaultId !== parsed.activeVaultId || !vaultPath) return result({ status: "not_found" });
    try {
      const binding = readBundle(vaultPath, parsed.datasetId);
      if (!binding) return result({ status: "not_found" });
      const sourceSnapshot = readCollectionSnapshot(binding, parsed.sourceTableId);
      if (!sourceSnapshot) return result({ status: "not_found" });
      if (binding.manifest.activeRevision !== parsed.expectedRevisionId) {
        return result({ status: "stale", snapshot: sourceSnapshot });
      }
      const sourceTable = binding.schema.tables.find((table) => table.id === parsed.sourceTableId);
      const relationColumn = sourceTable?.columns.find((column) => column.id === parsed.sourceColumnId);
      if (!sourceTable || !relationColumn?.relation) return result({ status: "ineligible", snapshot: sourceSnapshot });
      const relation = readRelationCell(
        binding,
        parsed.sourceTableId,
        parsed.sourceRowId,
        parsed.sourceColumnId,
        relationColumn.relation.targetTableId
      );
      if (!relation) return result({ status: "not_found", targetTableId: relationColumn.relation.targetTableId, snapshot: sourceSnapshot });
      const targetTableId = relationColumn.relation.targetTableId;
      const targetSnapshot = relation.targetRowId
        ? readCollectionSnapshot(binding, targetTableId, { rowIds: [relation.targetRowId] })
        : readCollectionSnapshot(binding, targetTableId);
      if (!targetSnapshot) return result({ status: "not_found", targetTableId, targetRowId: relation.targetRowId ?? undefined });
      if (!relation.targetRowId) return result({ status: "empty", targetTableId, snapshot: targetSnapshot });
      return result({
        status: "ready",
        targetTableId,
        targetRowId: relation.targetRowId,
        snapshot: targetSnapshot
      });
    } catch {
      return result({ status: "failed" });
    }
  }
}

function readRelationCell(
  binding: BundleBinding,
  sourceTableId: string,
  rowId: string,
  columnId: string,
  targetTableId: string
): { readonly targetRowId: string | null } | undefined {
  const database = new DatabaseSync(binding.payloadPath, { readOnly: true });
  try {
    const sourceRow = database.prepare("SELECT table_id FROM pige_dataset_rows WHERE row_id = ?").get(rowId) as {
      table_id?: unknown;
    } | undefined;
    if (sourceRow?.table_id !== sourceTableId) return undefined;
    const cell = database.prepare(
      "SELECT state, projection_kind, projection_json FROM pige_dataset_cells WHERE row_id = ? AND column_id = ?"
    ).get(rowId, columnId) as {
      state?: unknown;
      projection_kind?: unknown;
      projection_json?: unknown;
    } | undefined;
    if (!cell || cell.state !== "value" || cell.projection_kind !== "pige_relation_target_v1" || typeof cell.projection_json !== "string") {
      return cell?.state === "null" && cell.projection_json === "null" ? { targetRowId: null } : undefined;
    }
    const relation = DatasetPigeRelationCellSchema.parse(JSON.parse(cell.projection_json));
    if (!relation) return undefined;
    if (relation.targetRowId !== null) {
      const targetRow = database.prepare("SELECT table_id FROM pige_dataset_rows WHERE row_id = ?")
        .get(relation.targetRowId) as { table_id?: unknown } | undefined;
      if (targetRow?.table_id !== targetTableId) return undefined;
    }
    return { targetRowId: relation.targetRowId };
  } finally {
    database.close();
  }
}
