import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { KnowledgeActivitySummary, KnowledgeActivityUndoResult, VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  CollectionAddNullableColumnRequestSchema, CollectionAddNullableColumnResultSchema,
  CollectionAddFormulaColumnRequestSchema, CollectionAddFormulaColumnResultSchema, CollectionAddRelationColumnRequestSchema,
  CollectionUpdateFormulaColumnRequestSchema, CollectionUpdateFormulaColumnResultSchema, CollectionEditRelationCellRequestSchema,
  CollectionAppendDefaultRowRequestSchema, CollectionAppendDefaultRowResultSchema,
  CollectionCellEditRequestSchema, CollectionCellEditResultSchema,
  CollectionRenameColumnRequestSchema, CollectionTrashColumnRequestSchema,
  CollectionTrashRowRequestSchema, CollectionTrashRowResultSchema, CollectionOpenRequestSchema, CollectionOpenResultSchema,
  DatasetManifestSchema,
  DatasetRevisionSchema, DatasetSchemaRecordSchema, OperationRecordSchema,
  type CollectionAddNullableColumnRequest, type CollectionAddNullableColumnResult,
  type CollectionAddFormulaColumnRequest, type CollectionAddFormulaColumnResult,
  type CollectionAddRelationColumnRequest, type CollectionAddRelationColumnResult,
  type CollectionUpdateFormulaColumnRequest, type CollectionUpdateFormulaColumnResult,
  type CollectionEditRelationCellRequest, type CollectionEditRelationCellResult,
  type CollectionAppendDefaultRowRequest, type CollectionAppendDefaultRowResult,
  type CollectionCellEditRequest, type CollectionCellEditResult,
  type CollectionRenameColumnRequest, type CollectionRenameColumnResult, type CollectionTrashColumnRequest, type CollectionTrashColumnResult,
  type CollectionTrashRowRequest, type CollectionTrashRowResult, type CollectionOpenRequest, type CollectionOpenResult,
  type CollectionScalarValue,
  type DatasetLogicalType, type DatasetRevision, type DatasetSchemaRecord, type OperationRecord
} from "@pige/schemas";
import {
  MAX_COLLECTION_JSON_BYTES, adoptNullableColumnMutation, assertSafeVaultRoot, collectionCellReadOnlyReason,
  createNullableColumnId, fileRef, hashCanonical,
  openReadOnlyPayload, operationConflict, operationPathFor, payloadInvalid,
  parseCollectionCellValue, readAllBundles, readBundle, readCollectionCell, readCollectionCellFromRevision,
  readCollectionSnapshot, readJsonBounded, readJsonRef, readOperationRecords, readRevisionById,
  replaceManifestCas, requestConflict, resolveBundleRelativePath,
  writeJsonExclusive,
  type BundleBinding, type CollectionCellBinding
} from "./managed-collection-storage";
import { commitColumnRenameUndo, commitColumnTrashUndo, commitNullableColumnAdd, commitNullableColumnUndo, executeColumnRename, executeColumnTrash, normalizeColumnLabel } from "./managed-collection-column-storage";
import {
  adoptFormulaColumnMutation, commitCollectionCellMutation, commitFormulaColumnAdd,
  createFormulaColumnId, createFormulaMutationIdentity
} from "./managed-collection-formula-storage";
import {
  adoptFormulaUpdateMutation, commitFormulaUpdate, commitFormulaUpdateUndo,
  createFormulaUpdateMutationIdentity
} from "./managed-collection-formula-update-storage";
import {
  adoptDefaultRowAppend,
  commitDefaultRowAppend,
  commitDefaultRowUndo,
  commitRowTrashUndo,
  createDefaultRowId,
  createDefaultRowMutationIdentity,
  executeRowTrash
} from "./managed-collection-row-storage";
import { commitRelationUndoOperation, executeRelationAdd, executeRelationEdit } from "./managed-collection-relation-storage";
export interface ManagedCollectionVaultPort { current(): VaultSummary | undefined; activeVaultPath(): string | undefined; }
export interface ManagedCollectionRecoveryResult { readonly recovered: number; readonly failed: number; }
interface MutationIdentity { readonly revisionId: string; readonly operationId: string; }
interface CollectionOperationBinding {
  readonly datasetId: string; readonly tableId: string; readonly rowId?: string; readonly columnId?: string;
  readonly beforeRevisionId: string; readonly afterRevisionId: string;
  readonly changeKind:
    | "collection_cell_edit"
    | "collection_cell_undo"
    | "collection_row_add"
    | "collection_row_add_undo"
    | "collection_column_add"
    | "collection_column_add_undo"
    | "collection_formula_update" | "collection_formula_update_undo"
    | "collection_relation_add" | "collection_relation_add_undo"
    | "collection_relation_cell_edit" | "collection_relation_cell_edit_undo"
    | "collection_column_rename" | "collection_column_rename_undo"
    | "collection_column_trash" | "collection_column_trash_undo"
    | "collection_row_trash"
    | "collection_row_trash_undo";
}
const MAX_OPEN_COLUMNS = 32, MAX_STRING_BYTES = 4 * 1024;
const OPERATION_ID = /^op_(\d{8})_[a-z0-9]{8,}$/u, REVISION_ID = /^dataset_rev_(\d{8})_[a-z0-9]{12,}$/u;
const EDITABLE_TYPES = new Set<DatasetLogicalType>(["string", "integer", "number", "boolean", "date", "datetime"]);
export class ManagedCollectionService {
  readonly #vaults: ManagedCollectionVaultPort;
  #mutationTail: Promise<void> = Promise.resolve();
  constructor(vaults: ManagedCollectionVaultPort) { this.#vaults = vaults; }
  async open(request: CollectionOpenRequest): Promise<CollectionOpenResult> {
    const parsed = CollectionOpenRequestSchema.parse(request);
    const identity = openIdentity(parsed);
    const active = this.#activeVault(parsed.activeVaultId);
    if (!active) return CollectionOpenResultSchema.parse({ ...identity, status: "stale" });
    try {
      const binding = readBundle(active.vaultPath, parsed.datasetId);
      if (!binding) return CollectionOpenResultSchema.parse({ ...identity, status: "not_found" });
      this.#recoverActiveOperation(binding);
      const snapshot = readCollectionSnapshot(binding, parsed.tableId);
      if (!snapshot) return CollectionOpenResultSchema.parse({ ...identity, status: "not_found" });
      if (!this.#activeVault(parsed.activeVaultId)) {
        return CollectionOpenResultSchema.parse({ ...identity, status: "stale" });
      }
      return CollectionOpenResultSchema.parse({ ...identity, status: "ready", snapshot });
    } catch {
      return CollectionOpenResultSchema.parse({ ...identity, status: "failed" });
    }
  }
  async editCell(request: CollectionCellEditRequest): Promise<CollectionCellEditResult> { return this.#serialize(() => this.#editCell(CollectionCellEditRequestSchema.parse(request))); }
  async appendDefaultRow(request: CollectionAppendDefaultRowRequest): Promise<CollectionAppendDefaultRowResult> { return this.#serialize(() => this.#appendDefaultRow(CollectionAppendDefaultRowRequestSchema.parse(request))); }
  async addNullableColumn(request: CollectionAddNullableColumnRequest): Promise<CollectionAddNullableColumnResult> { return this.#serialize(() => this.#addNullableColumn(CollectionAddNullableColumnRequestSchema.parse(request))); }
  async addFormulaColumn(request: CollectionAddFormulaColumnRequest): Promise<CollectionAddFormulaColumnResult> { return this.#serialize(() => this.#addFormulaColumn(CollectionAddFormulaColumnRequestSchema.parse(request))); }
  async addRelationColumn(request: CollectionAddRelationColumnRequest): Promise<CollectionAddRelationColumnResult> { const parsed = CollectionAddRelationColumnRequestSchema.parse(request), active = this.#activeVault(parsed.activeVaultId); return this.#serialize(() => executeRelationAdd({ ...(active ? { vaultPath: active.vaultPath } : {}), request: parsed, isVaultActive: () => !!this.#activeVault(parsed.activeVaultId), readSnapshot: readCollectionSnapshot, createOperation: createOperationForRevision })); }
  async editRelationCell(request: CollectionEditRelationCellRequest): Promise<CollectionEditRelationCellResult> { const parsed = CollectionEditRelationCellRequestSchema.parse(request), active = this.#activeVault(parsed.activeVaultId); return this.#serialize(() => executeRelationEdit({ ...(active ? { vaultPath: active.vaultPath } : {}), request: parsed, isVaultActive: () => !!this.#activeVault(parsed.activeVaultId), readSnapshot: readCollectionSnapshot, createOperation: createOperationForRevision })); }
  async updateFormulaColumn(request: CollectionUpdateFormulaColumnRequest): Promise<CollectionUpdateFormulaColumnResult> { return this.#serialize(() => this.#updateFormulaColumn(CollectionUpdateFormulaColumnRequestSchema.parse(request))); }
  async renameColumn(request: CollectionRenameColumnRequest): Promise<CollectionRenameColumnResult> {
    const parsed = CollectionRenameColumnRequestSchema.parse(request);
    return this.#serialize(async () => {
      const active = this.#activeVault(parsed.activeVaultId);
      return executeColumnRename({
        vaultPath: active?.vaultPath, request: parsed, identity: createColumnTargetMutationIdentity(parsed),
        isVaultActive: () => !!this.#activeVault(parsed.activeVaultId), createOperation: createOperationForRevision
      });
    });
  }
  async trashColumn(request: CollectionTrashColumnRequest): Promise<CollectionTrashColumnResult> {
    const parsed = CollectionTrashColumnRequestSchema.parse(request);
    return this.#serialize(async () => {
      const active = this.#activeVault(parsed.activeVaultId);
      return executeColumnTrash({
        vaultPath: active?.vaultPath, request: parsed,
        identity: createColumnTargetMutationIdentity(parsed, "trash"),
        isVaultActive: () => !!this.#activeVault(parsed.activeVaultId), createOperation: createOperationForRevision
      });
    });
  }
  async trashRow(request: CollectionTrashRowRequest): Promise<CollectionTrashRowResult> {
    const parsed = CollectionTrashRowRequestSchema.parse(request);
    return this.#serialize(async () => {
      const active = this.#activeVault(parsed.activeVaultId);
      if (!active) return CollectionTrashRowResultSchema.parse({ ...openIdentity(parsed), rowId: parsed.rowId, status: "not_found" });
      return executeRowTrash({
        vaultPath: active.vaultPath,
        request: parsed,
        isVaultActive: () => !!this.#activeVault(parsed.activeVaultId),
        readSnapshot: readCollectionSnapshot, createOperation: createOperationForRevision
      });
    });
  }
  activitySummary(operation: OperationRecord, undoOperation?: OperationRecord): KnowledgeActivitySummary | undefined {
    const binding = readOperationBinding(operation);
    if (!binding) return undefined;
    const undoBinding = undoOperation ? readOperationBinding(undoOperation) : undefined;
    if (undoOperation && !undoBinding) return undefined;
    const active = this.#activeVault();
    const current = active ? readBundle(active.vaultPath, binding.datasetId) : undefined;
    const targetMissing = !undoOperation && !current;
    const revisionChanged = !undoOperation && !!current && current.manifest.activeRevision !== binding.afterRevisionId;
    return {
      operationId: operation.id,
      kind: binding.changeKind.startsWith("collection_row_add")
        ? "add_collection_row"
        : binding.changeKind.startsWith("collection_row_trash")
          ? "trash_collection_row"
        : binding.changeKind.startsWith("collection_column_add")
          ? "add_collection_column"
        : binding.changeKind.startsWith("collection_column_rename")
          ? "rename_collection_column"
        : binding.changeKind.startsWith("collection_column_trash")
          ? "trash_collection_column"
        : binding.changeKind.startsWith("collection_formula_update")
          ? "update_collection_formula"
        : binding.changeKind.startsWith("collection_relation_add")
          ? "add_collection_relation"
        : binding.changeKind.startsWith("collection_relation_cell_edit")
          ? "update_collection_relation_cell"
          : "update_collection_cell",
      createdAt: operation.createdAt,
      ...(current?.manifest.title ? { targetLabel: current.manifest.title } : {}),
      target: {
        kind: "collection",
        datasetId: binding.datasetId,
        tableId: binding.tableId,
        revisionId: undoBinding?.afterRevisionId ?? binding.afterRevisionId
      },
      status: undoOperation ? "undone" : "applied",
      canUndo: !undoOperation && !targetMissing && !revisionChanged,
      ...(undoOperation
        ? { undoUnavailableReason: "already_undone" as const }
        : targetMissing
          ? { undoUnavailableReason: "target_missing" as const }
        : revisionChanged
          ? { undoUnavailableReason: "revision_changed" as const }
          : {})
    };
  }
  findUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    const binding = readOperationBinding(operation);
    if (!binding || !isUndoableCollectionChange(binding.changeKind)) return undefined;
    const candidate = operations.find((entry) => entry.id === createUndoOperationId(operation.id));
    return candidate && isMatchingUndoOperation(operation, candidate) ? candidate : undefined;
  }
  async undo(operation: OperationRecord, expectedRevisionId?: string): Promise<KnowledgeActivityUndoResult> {
    return this.#serialize(async () => {
      const binding = readOperationBinding(operation);
      if (!binding || !isUndoableCollectionChange(binding.changeKind)) {
        return { status: "not_found", operationId: operation.id };
      }
      if (expectedRevisionId !== binding.afterRevisionId) {
        const current = this.#readCurrentRevision(binding.datasetId);
        return { status: "stale", operationId: operation.id, ...(current ? { currentRevisionId: current } : {}) };
      }
      const operations = readOperationRecords(this.#requireVaultPath());
      const existing = this.findUndoOperation(operation, operations);
      if (existing) {
        const existingBinding = readOperationBinding(existing);
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
        return { status: "stale", operationId: operation.id, currentRevisionId: current.manifest.activeRevision };
      }
      const committed = binding.changeKind === "collection_row_add"
        ? commitRowAddUndo({
          binding: current,
          identity: createUndoIdentity(operation.id, binding.afterRevisionId),
          tableId: binding.tableId,
          rowId: requireRowId(binding),
          expectedRevisionId: binding.afterRevisionId,
          beforeRevisionId: binding.beforeRevisionId,
          undoOfOperationId: operation.id
        })
        : binding.changeKind === "collection_row_trash"
          ? commitRowTrashUndoOperation({
            binding: current,
            identity: createUndoIdentity(operation.id, binding.afterRevisionId),
            tableId: binding.tableId,
            rowId: requireRowId(binding),
            expectedRevisionId: binding.afterRevisionId,
            beforeRevisionId: binding.beforeRevisionId,
            undoOfOperationId: operation.id
          })
        : binding.changeKind === "collection_column_add" || binding.changeKind === "collection_column_rename" ||
            binding.changeKind === "collection_column_trash"
          ? commitColumnUndo(current, binding, operation.id)
        : binding.changeKind === "collection_formula_update"
          ? commitFormulaUndo(current, binding, operation.id)
        : binding.changeKind === "collection_relation_add" || binding.changeKind === "collection_relation_cell_edit"
          ? commitRelationUndoOperation({
            binding: current, identity: createUndoIdentity(operation.id, binding.afterRevisionId),
            afterRevisionId: binding.afterRevisionId, beforeRevisionId: binding.beforeRevisionId,
            undoOfOperationId: operation.id,
            kind: binding.changeKind === "collection_relation_add" ? "collection_relation_add" : "collection_relation_cell_edit",
            createOperation: createOperationForRevision
          })
          : commitCellUndo(current, binding, operation.id);
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
    const identity = editIdentity(request);
    const active = this.#activeVault(request.activeVaultId);
    if (!active) {
      return CollectionCellEditResultSchema.parse({
        ...identity,
        status: "stale",
        currentRevisionId: request.expectedRevisionId
      });
    }
    try {
      const binding = readBundle(active.vaultPath, request.datasetId);
      if (!binding) return CollectionCellEditResultSchema.parse({ ...identity, status: "not_found" });
      const mutationIdentity = createEditMutationIdentity(request);
      const adopted = adoptExistingMutation(binding, request, mutationIdentity);
      if (adopted) return CollectionCellEditResultSchema.parse({ ...identity, ...adopted });
      if (binding.manifest.activeRevision !== request.expectedRevisionId) {
        return CollectionCellEditResultSchema.parse({
          ...identity,
          status: "stale",
          currentRevisionId: binding.manifest.activeRevision
        });
      }
      const cell = readCollectionCell(binding, request.tableId, request.rowId, request.columnId);
      if (!cell) return CollectionCellEditResultSchema.parse({ ...identity, status: "not_found" });
      if (cell.column.relation) {
        return CollectionCellEditResultSchema.parse({ ...identity, status: "not_editable", reason: "unsupported_type" });
      }
      const readOnlyReason = collectionCellReadOnlyReason(cell);
      if (readOnlyReason) {
        return CollectionCellEditResultSchema.parse({ ...identity, status: "not_editable", reason: readOnlyReason });
      }
      const invalidReason = validateScalar(request.value, cell.column.logicalType);
      if (invalidReason) {
        return CollectionCellEditResultSchema.parse({ ...identity, status: "invalid", reason: invalidReason });
      }
      const committed = commitCollectionCellMutation({
        binding,
        identity: mutationIdentity,
        tableId: request.tableId,
        rowId: request.rowId,
        columnId: request.columnId,
        value: request.value,
        expectedRevisionId: request.expectedRevisionId,
        change: { kind: "collection_cell_edit" }, createOperation: createOperationForRevision
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
  async #appendDefaultRow(request: CollectionAppendDefaultRowRequest): Promise<CollectionAppendDefaultRowResult> {
    const identity = openIdentity(request);
    const active = this.#activeVault(request.activeVaultId);
    if (!active) return CollectionAppendDefaultRowResultSchema.parse({ ...identity, status: "not_found" });
    try {
      const binding = readBundle(active.vaultPath, request.datasetId);
      if (!binding) return CollectionAppendDefaultRowResultSchema.parse({ ...identity, status: "not_found" });
      const mutationIdentity = createDefaultRowMutationIdentity(request);
      const adopted = adoptDefaultRowAppend({
        binding,
        request,
        identity: mutationIdentity,
        readSnapshot: readCollectionSnapshot,
        createOperation: createOperationForRevision
      });
      if (adopted) return CollectionAppendDefaultRowResultSchema.parse({ ...identity, ...adopted });
      const currentSnapshot = readCollectionSnapshot(binding, request.tableId);
      if (!currentSnapshot) {
        return CollectionAppendDefaultRowResultSchema.parse({ ...identity, status: "not_found" });
      }
      if (
        binding.manifest.activeRevision !== request.expectedRevisionId ||
        !currentSnapshot.canAppendDefaultRow
      ) {
        return CollectionAppendDefaultRowResultSchema.parse({
          ...identity,
          status: "stale",
          snapshot: currentSnapshot
        });
      }
      const rowId = createDefaultRowId(request);
      const committed = commitRowAdd({
        binding,
        identity: mutationIdentity,
        tableId: request.tableId,
        rowId,
        expectedRevisionId: request.expectedRevisionId
      });
      if (!this.#activeVault(request.activeVaultId)) {
        return CollectionAppendDefaultRowResultSchema.parse({ ...identity, status: "not_found" });
      }
      const snapshot = readCollectionSnapshot(committed.binding, request.tableId);
      if (!snapshot || snapshot.revisionId !== committed.revision.id) throw operationConflict();
      return CollectionAppendDefaultRowResultSchema.parse({
        ...identity,
        status: "committed",
        rowId,
        operationId: committed.operation.id,
        snapshot
      });
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "collection.request_conflict") throw caught;
      const latest = readBundle(active.vaultPath, request.datasetId);
      const snapshot = latest ? readCollectionSnapshot(latest, request.tableId) : undefined;
      return snapshot
        ? CollectionAppendDefaultRowResultSchema.parse({ ...identity, status: "stale", snapshot })
        : CollectionAppendDefaultRowResultSchema.parse({ ...identity, status: "not_found" });
    }
  }
  async #addNullableColumn(request: CollectionAddNullableColumnRequest): Promise<CollectionAddNullableColumnResult> {
    const identity = openIdentity(request);
    const active = this.#activeVault(request.activeVaultId);
    if (!active) return CollectionAddNullableColumnResultSchema.parse({ ...identity, status: "not_found" });
    try {
      const binding = readBundle(active.vaultPath, request.datasetId);
      if (!binding) return CollectionAddNullableColumnResultSchema.parse({ ...identity, status: "not_found" });
      const mutationIdentity = createColumnMutationIdentity(request);
      const columnId = createNullableColumnId(request.tableId, request.requestId);
      const adopted = adoptNullableColumnMutation({
        binding,
        request,
        identity: mutationIdentity,
        columnId,
        createOperation: createOperationForRevision
      });
      if (adopted) return CollectionAddNullableColumnResultSchema.parse({ ...identity, ...adopted });
      const snapshot = readCollectionSnapshot(binding, request.tableId);
      if (!snapshot) return CollectionAddNullableColumnResultSchema.parse({ ...identity, status: "not_found" });
      if (binding.manifest.activeRevision !== request.expectedRevisionId) {
        return CollectionAddNullableColumnResultSchema.parse({ ...identity, status: "stale", snapshot });
      }
      if (!snapshot.canAddColumn) {
        return CollectionAddNullableColumnResultSchema.parse({ ...identity, status: "invalid", reason: "column_limit" });
      }
      const table = binding.schema.tables.find((candidate) => candidate.id === request.tableId);
      if (!table) return CollectionAddNullableColumnResultSchema.parse({ ...identity, status: "not_found" });
      const normalizedLabel = normalizeColumnLabel(request.label);
      if (table.columns.some((column) => normalizeColumnLabel(column.name) === normalizedLabel)) {
        return CollectionAddNullableColumnResultSchema.parse({ ...identity, status: "invalid", reason: "duplicate_label" });
      }
      const committed = commitNullableColumnAdd({
        binding,
        identity: mutationIdentity,
        tableId: request.tableId,
        columnId,
        label: request.label,
        logicalType: request.logicalType,
        expectedRevisionId: request.expectedRevisionId
      });
      const operation = createOperationForRevision(committed.binding, committed.revision);
      writeJsonExclusive(operationPathFor(committed.binding.vaultPath, operation.id), operation);
      if (!this.#activeVault(request.activeVaultId)) {
        return CollectionAddNullableColumnResultSchema.parse({ ...identity, status: "not_found" });
      }
      const nextSnapshot = readCollectionSnapshot(committed.binding, request.tableId);
      if (!nextSnapshot || nextSnapshot.revisionId !== committed.revision.id ||
          !nextSnapshot.columns.some((column) => column.columnId === columnId)) throw operationConflict();
      return CollectionAddNullableColumnResultSchema.parse({
        ...identity,
        status: "committed",
        columnId,
        operationId: operation.id,
        snapshot: nextSnapshot
      });
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "collection.request_conflict") throw caught;
      const latest = readBundle(active.vaultPath, request.datasetId);
      const snapshot = latest ? readCollectionSnapshot(latest, request.tableId) : undefined;
      return snapshot
        ? CollectionAddNullableColumnResultSchema.parse({ ...identity, status: "stale", snapshot })
        : CollectionAddNullableColumnResultSchema.parse({ ...identity, status: "not_found" });
    }
  }
  async #addFormulaColumn(request: CollectionAddFormulaColumnRequest): Promise<CollectionAddFormulaColumnResult> {
    const identity = openIdentity(request), active = this.#activeVault(request.activeVaultId);
    if (!active) return CollectionAddFormulaColumnResultSchema.parse({ ...identity, status: "not_found" });
    try {
      const binding = readBundle(active.vaultPath, request.datasetId);
      if (!binding) return CollectionAddFormulaColumnResultSchema.parse({ ...identity, status: "not_found" });
      const mutationIdentity = createFormulaMutationIdentity(request), columnId = createFormulaColumnId(request.tableId, request.requestId);
      const adopted = adoptFormulaColumnMutation({
        binding, request, identity: mutationIdentity, readSnapshot: readCollectionSnapshot, createOperation: createOperationForRevision
      });
      if (adopted) return CollectionAddFormulaColumnResultSchema.parse({ ...identity, ...adopted });
      const snapshot = readCollectionSnapshot(binding, request.tableId);
      if (!snapshot) return CollectionAddFormulaColumnResultSchema.parse({ ...identity, status: "not_found" });
      if (binding.manifest.activeRevision !== request.expectedRevisionId) return CollectionAddFormulaColumnResultSchema.parse({ ...identity, status: "stale", snapshot });
      if (!snapshot.canAddFormulaColumn) return CollectionAddFormulaColumnResultSchema.parse({ ...identity, status: "invalid", reason: "ineligible_operand" });
      const committed = commitFormulaColumnAdd({ binding, request, identity: mutationIdentity });
      const operation = createOperationForRevision(committed.binding, committed.revision);
      writeJsonExclusive(operationPathFor(committed.binding.vaultPath, operation.id), operation);
      if (!this.#activeVault(request.activeVaultId)) return CollectionAddFormulaColumnResultSchema.parse({ ...identity, status: "not_found" });
      const nextSnapshot = readCollectionSnapshot(committed.binding, request.tableId);
      if (!nextSnapshot || nextSnapshot.revisionId !== committed.revision.id ||
          !nextSnapshot.columns.some((column) => column.columnId === columnId && column.calculation?.kind === "pige_numeric_formula")) throw operationConflict();
      return CollectionAddFormulaColumnResultSchema.parse({ ...identity, status: "committed", columnId, operationId: operation.id, snapshot: nextSnapshot });
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "collection.request_conflict") throw caught;
      const latest = readBundle(active.vaultPath, request.datasetId);
      const snapshot = latest ? readCollectionSnapshot(latest, request.tableId) : undefined;
      const reason = caught instanceof PigeDomainError ? formulaAddReason(caught.code) : undefined;
      return reason
        ? CollectionAddFormulaColumnResultSchema.parse({ ...identity, status: "invalid", reason })
        : snapshot
          ? CollectionAddFormulaColumnResultSchema.parse({ ...identity, status: "stale", snapshot })
          : CollectionAddFormulaColumnResultSchema.parse({ ...identity, status: "not_found" });
    }
  }
  async #updateFormulaColumn(request: CollectionUpdateFormulaColumnRequest): Promise<CollectionUpdateFormulaColumnResult> {
    const identity = { ...openIdentity(request), columnId: request.columnId }, active = this.#activeVault(request.activeVaultId);
    if (!active) return CollectionUpdateFormulaColumnResultSchema.parse({ ...identity, status: "not_found" });
    try {
      const binding = readBundle(active.vaultPath, request.datasetId);
      if (!binding) return CollectionUpdateFormulaColumnResultSchema.parse({ ...identity, status: "not_found" });
      const mutationIdentity = createFormulaUpdateMutationIdentity(request);
      const adopted = adoptFormulaUpdateMutation({
        binding, request, identity: mutationIdentity, readSnapshot: readCollectionSnapshot, createOperation: createOperationForRevision
      });
      if (adopted) return CollectionUpdateFormulaColumnResultSchema.parse({ ...identity, ...adopted });
      const snapshot = readCollectionSnapshot(binding, request.tableId);
      if (!snapshot) return CollectionUpdateFormulaColumnResultSchema.parse({ ...identity, status: "not_found" });
      if (binding.manifest.activeRevision !== request.expectedRevisionId) return CollectionUpdateFormulaColumnResultSchema.parse({ ...identity, status: "stale", snapshot });
      const committed = commitFormulaUpdate({ binding, request, identity: mutationIdentity });
      const operation = createOperationForRevision(committed.binding, committed.revision);
      writeJsonExclusive(operationPathFor(committed.binding.vaultPath, operation.id), operation);
      if (!this.#activeVault(request.activeVaultId)) return CollectionUpdateFormulaColumnResultSchema.parse({ ...identity, status: "not_found" });
      const nextSnapshot = readCollectionSnapshot(committed.binding, request.tableId);
      if (!nextSnapshot || nextSnapshot.revisionId !== committed.revision.id) throw operationConflict();
      return CollectionUpdateFormulaColumnResultSchema.parse({ ...identity, status: "committed", operationId: operation.id, snapshot: nextSnapshot });
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "collection.request_conflict") throw caught;
      const latest = readBundle(active.vaultPath, request.datasetId);
      const snapshot = latest ? readCollectionSnapshot(latest, request.tableId) : undefined;
      const reason = caught instanceof PigeDomainError ? formulaUpdateReason(caught.code) : undefined;
      return reason
        ? CollectionUpdateFormulaColumnResultSchema.parse({ ...identity, status: "invalid", reason })
        : snapshot
          ? CollectionUpdateFormulaColumnResultSchema.parse({ ...identity, status: "stale", snapshot })
          : CollectionUpdateFormulaColumnResultSchema.parse({ ...identity, status: "not_found" });
    }
  }
  #recoverActiveOperation(binding: BundleBinding): boolean {
    if (!binding.revision.change || binding.revision.change.kind === "initial_import") return false;
    const operationPath = operationPathFor(binding.vaultPath, binding.revision.operationId);
    if (fs.existsSync(operationPath)) {
      const operation = OperationRecordSchema.parse(readJsonBounded(operationPath, MAX_COLLECTION_JSON_BYTES));
      assertOperationMatchesRevision(binding, operation);
      return false;
    }
    writeJsonExclusive(operationPath, createOperationForRevision(binding, binding.revision));
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
    const previous = this.#mutationTail; let release!: () => void;
    this.#mutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await task(); } finally { release(); }
  }
}
interface CommitRowAddInput {
  readonly binding: BundleBinding; readonly identity: MutationIdentity; readonly tableId: string;
  readonly rowId: string; readonly expectedRevisionId: string;
}
function commitRowAdd(input: CommitRowAddInput) { return finishMutation(commitDefaultRowAppend(input)); }
function commitRowAddUndo(input: CommitRowAddInput & {
  readonly beforeRevisionId: string; readonly undoOfOperationId: string;
}) { return finishMutation(commitDefaultRowUndo(input)); }
function commitRowTrashUndoOperation(input: CommitRowAddInput & {
  readonly beforeRevisionId: string; readonly undoOfOperationId: string;
}) { return finishMutation(commitRowTrashUndo(input)); }
function commitCellUndo(
  current: BundleBinding,
  binding: CollectionOperationBinding,
  operationId: string
): { readonly revision: DatasetRevision; readonly operation: OperationRecord } {
  if (!binding.columnId) throw operationConflict();
  const rowId = requireRowId(binding);
  const beforeRevision = readRevisionById(current, binding.beforeRevisionId);
  const beforeCell = readCollectionCellFromRevision(current, beforeRevision, rowId, binding.columnId);
  if (!beforeCell) throw operationConflict();
  return commitCollectionCellMutation({
    binding: current, identity: createUndoIdentity(operationId, binding.afterRevisionId),
    tableId: binding.tableId, rowId, columnId: binding.columnId,
    value: parseCollectionCellValue(beforeCell, beforeCell.column.logicalType),
    expectedRevisionId: binding.afterRevisionId, change: { kind: "collection_cell_undo", undoOfOperationId: operationId },
    createOperation: createOperationForRevision
  });
}
function commitColumnUndo(
  current: BundleBinding,
  binding: CollectionOperationBinding,
  operationId: string
): { readonly revision: DatasetRevision; readonly operation: OperationRecord } {
  if (!binding.columnId) throw operationConflict();
  const input = {
    binding: current, identity: createUndoIdentity(operationId, binding.afterRevisionId),
    tableId: binding.tableId, columnId: binding.columnId, expectedRevisionId: binding.afterRevisionId,
    beforeRevisionId: binding.beforeRevisionId, undoOfOperationId: operationId
  };
  const committed = binding.changeKind === "collection_column_rename"
    ? commitColumnRenameUndo(input)
    : binding.changeKind === "collection_column_trash"
      ? commitColumnTrashUndo(input)
      : commitNullableColumnUndo(input);
  return finishMutation(committed);
}
function commitFormulaUndo(
  current: BundleBinding,
  binding: CollectionOperationBinding,
  operationId: string
): { readonly revision: DatasetRevision; readonly operation: OperationRecord } {
  if (!binding.columnId) throw operationConflict();
  const committed = commitFormulaUpdateUndo({
    binding: current, identity: createUndoIdentity(operationId, binding.afterRevisionId),
    tableId: binding.tableId, columnId: binding.columnId, expectedRevisionId: binding.afterRevisionId,
    beforeRevisionId: binding.beforeRevisionId, undoOfOperationId: operationId
  });
  return finishMutation(committed);
}
function finishMutation(committed: { readonly binding: BundleBinding; readonly revision: DatasetRevision }) {
  const operation = createOperationForRevision(committed.binding, committed.revision);
  writeJsonExclusive(operationPathFor(committed.binding.vaultPath, operation.id), operation);
  return { ...committed, operation };
}
function requireRowId(binding: CollectionOperationBinding): string {
  if (!binding.rowId) throw operationConflict();
  return binding.rowId;
}
function validateScalar(value: CollectionScalarValue, logicalType: DatasetLogicalType): string | undefined {
  if (value === null) return undefined;
  if (logicalType === "string") {
    return typeof value === "string" && Buffer.byteLength(value, "utf8") <= MAX_STRING_BYTES
      ? undefined
      : "type_mismatch";
  }
  if (logicalType === "integer") return typeof value === "number" && Number.isSafeInteger(value) ? undefined : "type_mismatch";
  if (logicalType === "number") return typeof value === "number" && Number.isFinite(value) ? undefined : "type_mismatch";
  if (logicalType === "boolean") return typeof value === "boolean" ? undefined : "type_mismatch";
  if (logicalType === "date") return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? undefined : "type_mismatch";
  if (logicalType === "datetime") {
    return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? undefined : "type_mismatch";
  }
  return "type_mismatch";
}
function adoptExistingMutation(
  binding: BundleBinding,
  request: CollectionCellEditRequest,
  identity: MutationIdentity
): Partial<CollectionCellEditResult> | undefined {
  const revisionPath = resolveBundleRelativePath(binding.bundlePath, `revisions/${identity.revisionId}.json`);
  const operationPath = operationPathFor(binding.vaultPath, identity.operationId);
  if (!fs.existsSync(revisionPath) && !fs.existsSync(operationPath)) return undefined;
  if (!fs.existsSync(revisionPath)) throw requestConflict();
  const revision = DatasetRevisionSchema.parse(readJsonBounded(revisionPath, MAX_COLLECTION_JSON_BYTES));
  if (
    revision.id !== identity.revisionId ||
    revision.operationId !== identity.operationId ||
    revision.parentRevisionId !== request.expectedRevisionId ||
    revision.change?.kind !== "collection_cell_edit" ||
    revision.change.tableId !== request.tableId ||
    revision.change.rowId !== request.rowId ||
    revision.change.columnId !== request.columnId
  ) throw requestConflict();
  const cell = readCollectionCellFromRevision(binding, revision, request.rowId, request.columnId);
  if (!cell || hashCanonical(parseCollectionCellValue(cell, cell.column.logicalType)) !== hashCanonical(request.value)) {
    throw requestConflict();
  }
  let committedBinding = binding;
  if (binding.manifest.activeRevision !== revision.id) {
    if (binding.manifest.activeRevision !== request.expectedRevisionId) {
      return { status: "stale", currentRevisionId: binding.manifest.activeRevision };
    }
    replaceManifestCas(binding, DatasetManifestSchema.parse({
      ...binding.manifest,
      initialRevision: binding.manifest.initialRevision ?? binding.manifest.activeRevision,
      activeRevision: revision.id,
      revision: fileRef(binding.bundlePath, `revisions/${revision.id}.json`),
      schema: revision.schema,
      payload: revision.payload,
      updatedAt: revision.createdAt
    }));
    const adopted = readBundle(binding.vaultPath, binding.manifest.datasetId);
    if (!adopted || adopted.manifest.activeRevision !== revision.id) {
      throw new PigeDomainError("collection.commit_uncertain", "The Collection replay could not be adopted.");
    }
    committedBinding = adopted;
  }
  const operation = fs.existsSync(operationPath)
    ? OperationRecordSchema.parse(readJsonBounded(operationPath, MAX_COLLECTION_JSON_BYTES))
    : createOperationForRevision(committedBinding, revision);
  assertOperationMatchesRevision({ ...committedBinding, revision }, operation);
  if (!fs.existsSync(operationPath)) writeJsonExclusive(operationPath, operation);
  return { status: "committed", revisionId: revision.id, operationId: operation.id };
}
function createEditMutationIdentity(request: CollectionCellEditRequest): MutationIdentity {
  const dateKey = REVISION_ID.exec(request.expectedRevisionId)?.[1];
  if (!dateKey) throw requestConflict();
  return {
    revisionId: `dataset_rev_${dateKey}_${digest("pige:collection-edit:v1", request.requestId).slice(0, 20)}`,
    operationId: `op_${dateKey}_${digest("pige:collection-edit-operation:v1", request.requestId).slice(0, 20)}`
  };
}
function createColumnMutationIdentity(request: CollectionAddNullableColumnRequest): MutationIdentity {
  const dateKey = REVISION_ID.exec(request.expectedRevisionId)?.[1];
  if (!dateKey) throw requestConflict();
  return {
    revisionId: `dataset_rev_${dateKey}_${digest("pige:collection-column:v1", request.requestId).slice(0, 20)}`,
    operationId: `op_${dateKey}_${digest("pige:collection-column-operation:v1", request.requestId).slice(0, 20)}`
  };
}
function createColumnTargetMutationIdentity(request: CollectionRenameColumnRequest | CollectionTrashColumnRequest,
  kind: "rename" | "trash" = "rename"): MutationIdentity {
  const dateKey = REVISION_ID.exec(request.expectedRevisionId)?.[1];
  if (!dateKey) throw requestConflict();
  return {
    revisionId: `dataset_rev_${dateKey}_${digest(`pige:collection-column-${kind}:v1`, request.requestId).slice(0, 20)}`,
    operationId: `op_${dateKey}_${digest(`pige:collection-column-${kind}-operation:v1`, request.requestId).slice(0, 20)}`
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
function createOperationForRevision(binding: BundleBinding, revision: DatasetRevision): OperationRecord {
  const change = revision.change;
  if (!change || change.kind === "initial_import" || !revision.parentRevisionId) throw operationConflict();
  const beforeRevision = readRevisionById(binding, revision.parentRevisionId);
  const schema = DatasetSchemaRecordSchema.parse(readJsonRef(binding.bundlePath, revision.schema));
  const table = schema.tables.find((candidate) => candidate.id === change.tableId);
  const rowId = "rowId" in change ? change.rowId : undefined;
  const columnId = "columnId" in change ? change.columnId : undefined;
  const column = columnId ? table?.columns.find((candidate) => candidate.id === columnId) : undefined;
  if (!table || (columnId && !column && change.kind !== "collection_column_add_undo" &&
      change.kind !== "collection_relation_add_undo" && change.kind !== "collection_column_trash")) throw operationConflict();
  const revisionRelativePath = `revisions/${revision.id}.json`;
  const beforeRelativePath = `revisions/${beforeRevision.id}.json`;
  const targetRefs = [
    { kind: "dataset" as const, id: revision.datasetId, path: binding.bundleRelativePath },
    {
      kind: "dataset_revision" as const,
      id: revision.id,
      path: `${binding.bundleRelativePath}/${revisionRelativePath}`,
      checksum: fileRef(binding.bundlePath, revisionRelativePath).checksum
    },
    { kind: "table" as const, id: change.tableId },
    ...(rowId ? [{ kind: "row" as const, id: rowId }] : []),
    ...(columnId ? [{ kind: "column" as const, id: columnId }] : [])
  ];
  const sourceRefs = [
    {
      kind: "dataset_revision" as const,
      id: beforeRevision.id,
      path: `${binding.bundleRelativePath}/${beforeRelativePath}`,
      checksum: fileRef(binding.bundlePath, beforeRelativePath).checksum
    },
    ...((change.kind === "collection_cell_undo" || change.kind === "collection_row_add_undo" ||
        change.kind === "collection_row_trash_undo" ||
        change.kind === "collection_column_add_undo" || change.kind === "collection_column_rename_undo" ||
        change.kind === "collection_column_trash_undo" || change.kind === "collection_formula_update_undo" ||
        change.kind === "collection_relation_add_undo" || change.kind === "collection_relation_cell_edit_undo")
      ? [{ kind: "operation" as const, id: change.undoOfOperationId }]
      : [])
  ];
  return OperationRecordSchema.parse({
    id: revision.operationId,
    schemaVersion: 1,
    createdAt: revision.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: collectionOperationKind(change.kind),
    targetRefs,
    sourceRefs,
    before: sourceRefs[0],
    after: targetRefs[1],
    summary: collectionOperationSummary(change.kind, revision.id),
    reversible: change.kind.endsWith("_undo") ? "best_effort" : "yes",
    rollbackHint: "Create another revision only while this Operation's after-revision remains current.",
    warnings: []
  });
}
function readOperationBinding(operation: OperationRecord): CollectionOperationBinding | undefined {
  if (operation.kind !== "update_collection_cell" && operation.kind !== "add_collection_row" &&
      operation.kind !== "add_collection_column" && operation.kind !== "rename_collection_column" &&
      operation.kind !== "trash_collection_column" &&
      operation.kind !== "trash_collection_row" && operation.kind !== "update_collection_formula" &&
      operation.kind !== "add_collection_relation" && operation.kind !== "update_collection_relation_cell") return undefined;
  const dataset = operation.targetRefs.find((ref) => ref.kind === "dataset");
  const after = operation.after?.kind === "dataset_revision" ? operation.after : undefined;
  const before = operation.before?.kind === "dataset_revision" ? operation.before : undefined;
  const table = operation.targetRefs.find((ref) => ref.kind === "table");
  const row = operation.targetRefs.find((ref) => ref.kind === "row");
  const column = operation.targetRefs.find((ref) => ref.kind === "column");
  if (!dataset || !before || !after || !table || !REVISION_ID.test(after.id)) return undefined;
  if (operation.kind !== "add_collection_column" && operation.kind !== "add_collection_relation" &&
      operation.kind !== "rename_collection_column" &&
      operation.kind !== "update_collection_formula" &&
      operation.kind !== "trash_collection_column" && !row) return undefined;
  if ((operation.kind === "update_collection_cell" || operation.kind === "add_collection_column" ||
      operation.kind === "rename_collection_column" || operation.kind === "trash_collection_column" ||
      operation.kind === "update_collection_formula" || operation.kind === "add_collection_relation" ||
      operation.kind === "update_collection_relation_cell") && !column) return undefined;
  const undo = operation.sourceRefs.some((ref) => ref.kind === "operation");
  return {
    datasetId: dataset.id,
    tableId: table.id,
    ...(row ? { rowId: row.id } : {}),
    ...(column ? { columnId: column.id } : {}),
    beforeRevisionId: before.id,
    afterRevisionId: after.id,
    changeKind: operation.kind === "add_collection_row"
      ? (undo ? "collection_row_add_undo" : "collection_row_add")
      : operation.kind === "trash_collection_row"
        ? (undo ? "collection_row_trash_undo" : "collection_row_trash")
      : operation.kind === "add_collection_column"
        ? (undo ? "collection_column_add_undo" : "collection_column_add")
      : operation.kind === "rename_collection_column"
        ? (undo ? "collection_column_rename_undo" : "collection_column_rename")
      : operation.kind === "trash_collection_column"
        ? (undo ? "collection_column_trash_undo" : "collection_column_trash")
      : operation.kind === "update_collection_formula"
        ? (undo ? "collection_formula_update_undo" : "collection_formula_update")
      : operation.kind === "add_collection_relation"
        ? (undo ? "collection_relation_add_undo" : "collection_relation_add")
      : operation.kind === "update_collection_relation_cell"
        ? (undo ? "collection_relation_cell_edit_undo" : "collection_relation_cell_edit")
        : (undo ? "collection_cell_undo" : "collection_cell_edit")
  };
}
function isMatchingUndoOperation(original: OperationRecord, candidate: OperationRecord): boolean {
  const originalBinding = readOperationBinding(original);
  const candidateBinding = readOperationBinding(candidate);
  return !!originalBinding && !!candidateBinding &&
    candidate.id === createUndoOperationId(original.id) &&
    candidateBinding.changeKind === (originalBinding.changeKind === "collection_row_add"
      ? "collection_row_add_undo"
      : originalBinding.changeKind === "collection_row_trash"
        ? "collection_row_trash_undo"
      : originalBinding.changeKind === "collection_column_add"
        ? "collection_column_add_undo"
      : originalBinding.changeKind === "collection_column_rename"
        ? "collection_column_rename_undo"
      : originalBinding.changeKind === "collection_column_trash"
        ? "collection_column_trash_undo"
      : originalBinding.changeKind === "collection_formula_update"
        ? "collection_formula_update_undo"
      : originalBinding.changeKind === "collection_relation_add"
        ? "collection_relation_add_undo"
      : originalBinding.changeKind === "collection_relation_cell_edit"
        ? "collection_relation_cell_edit_undo"
        : "collection_cell_undo") &&
    candidateBinding.datasetId === originalBinding.datasetId &&
    candidateBinding.tableId === originalBinding.tableId &&
    candidateBinding.rowId === originalBinding.rowId &&
    candidateBinding.columnId === originalBinding.columnId &&
    candidateBinding.beforeRevisionId === originalBinding.afterRevisionId &&
    candidate.sourceRefs.some((ref) => ref.kind === "operation" && ref.id === original.id);
}
function isUndoableCollectionChange(changeKind: CollectionOperationBinding["changeKind"]): boolean {
  return changeKind === "collection_cell_edit" || changeKind === "collection_row_add" ||
    changeKind === "collection_column_add" || changeKind === "collection_column_rename" ||
    changeKind === "collection_column_trash" || changeKind === "collection_formula_update" ||
    changeKind === "collection_relation_add" || changeKind === "collection_relation_cell_edit" ||
    changeKind === "collection_row_trash";
}
function assertOperationMatchesRevision(binding: BundleBinding, operation: OperationRecord): void {
  if (
    operation.id !== binding.revision.operationId ||
    hashCanonical(operation) !== hashCanonical(createOperationForRevision(binding, binding.revision))
  ) throw operationConflict();
}
function openIdentity(request: CollectionOpenRequest) { return { apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId, datasetId: request.datasetId, tableId: request.tableId }; }
function editIdentity(request: CollectionCellEditRequest) { return { ...openIdentity(request), rowId: request.rowId, columnId: request.columnId }; }
function formulaAddReason(code: string) { return ({ "collection.duplicate_label": "duplicate_label", "collection.column_limit": "column_limit", "collection.formula_operand_ineligible": "ineligible_operand" } as Record<string, "duplicate_label" | "column_limit" | "ineligible_operand">)[code]; }
function formulaUpdateReason(code: string) { return ({ "collection.not_pige_formula": "not_pige_formula", "collection.imported_formula": "imported_formula", "collection.formula_operand_ineligible": "ineligible_operand", "collection.formula_no_change": "no_change" } as Record<string, "not_pige_formula" | "imported_formula" | "ineligible_operand" | "no_change">)[code]; }
function collectionOperationKind(kind: string): OperationRecord["kind"] { return kind.startsWith("collection_row_add") ? "add_collection_row" : kind.startsWith("collection_row_trash") ? "trash_collection_row" : kind.startsWith("collection_column_add") ? "add_collection_column" : kind.startsWith("collection_column_rename") ? "rename_collection_column" : kind.startsWith("collection_column_trash") ? "trash_collection_column" : kind.startsWith("collection_formula_update") ? "update_collection_formula" : kind.startsWith("collection_relation_add") ? "add_collection_relation" : kind.startsWith("collection_relation_cell_edit") ? "update_collection_relation_cell" : "update_collection_cell"; }
function collectionOperationSummary(kind: string, revisionId: string): string { const summaries: Record<string, string> = { collection_cell_undo: "Restored one Collection cell through forward revision", collection_row_add_undo: "Removed one appended Collection row through forward revision", collection_row_trash_undo: "Restored one trashed Collection row through forward revision", collection_column_add_undo: "Removed one added Collection column through forward revision", collection_column_rename_undo: "Restored one Collection column label through forward revision", collection_column_trash_undo: "Restored one trashed Collection column through forward revision", collection_formula_update_undo: "Restored one Collection formula through forward revision", collection_formula_update: "Updated one Collection formula through immutable revision", collection_column_trash: "Moved one Collection column out of the current revision", collection_column_rename: "Renamed one Collection column through immutable revision", collection_column_add: "Added one nullable Collection column through immutable revision", collection_row_trash: "Moved one Collection row out of the current revision", collection_row_add: "Added one Collection row through immutable revision" }; return `${summaries[kind] ?? "Updated one Collection cell through immutable revision"} ${revisionId}.`; }
function digest(...parts: readonly string[]): string { const hash = createHash("sha256"); for (const part of parts) hash.update(part).update("\0"); return hash.digest("hex"); }
