import type {
  KnowledgeActivityRedoRequest,
  KnowledgeActivityRedoResult,
  KnowledgeActivitySummary,
  KnowledgeActivityUndoResult
} from "@pige/contracts";
import {
  BackupMemoryPreferenceSummarySchema,
  BackupMemoryPreferenceUpdateRequestSchema,
  BackupMemoryPreferenceUpdateResultSchema,
  type BackupMemoryPreferenceSummary,
  type BackupMemoryPreferenceUpdateRequest,
  type BackupMemoryPreferenceUpdateResult,
  type OperationRecord
} from "@pige/schemas";
import {
  BackupContentPreferenceActivityService,
  type BackupContentPreferenceActivityServiceOptions
} from "./backup-content-preference-activity-service";

export interface BackupMemoryPreferenceServiceOptions extends BackupContentPreferenceActivityServiceOptions {}

export class BackupMemoryPreferenceService {
  readonly #activity: BackupContentPreferenceActivityService;

  constructor(options: BackupMemoryPreferenceServiceOptions) {
    this.#activity = new BackupContentPreferenceActivityService(options);
  }

  summary(): BackupMemoryPreferenceSummary {
    const summary = this.#activity.summary("memory");
    return BackupMemoryPreferenceSummarySchema.parse({
      apiVersion: 1,
      activeVaultId: summary.vaultId,
      revision: summary.revision,
      includeVaultMemory: summary.value,
      canUpdate: summary.canUpdate
    });
  }

  update(input: BackupMemoryPreferenceUpdateRequest): BackupMemoryPreferenceUpdateResult {
    const request = BackupMemoryPreferenceUpdateRequestSchema.parse(input);
    const result = this.#activity.update("memory", {
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      expectedRevision: request.expectedRevision,
      value: request.includeVaultMemory
    });
    return BackupMemoryPreferenceUpdateResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      status: result.status,
      summary: toSummary(result.summary)
    });
  }

  activitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    return this.#activity.activitySummary("memory", operation, undo);
  }

  findUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    return this.#activity.findUndoOperation(operation, operations);
  }

  undo(operation: OperationRecord): KnowledgeActivityUndoResult {
    return this.#activity.undo("memory", operation);
  }

  activityState(operation: OperationRecord, undo: OperationRecord | undefined): Pick<KnowledgeActivitySummary, "canRedo" | "redoUnavailableReason"> | undefined {
    return this.#activity.activityState("memory", operation, undo);
  }

  redo(request: KnowledgeActivityRedoRequest): KnowledgeActivityRedoResult {
    return this.#activity.redo("memory", request);
  }

  recoverIncompleteOperations(): { readonly recovered: number; readonly failed: number } {
    return this.#activity.recoverIncompleteOperations("memory");
  }
}

function toSummary(summary: { readonly vaultId: string; readonly revision: string; readonly value: boolean; readonly canUpdate: boolean }): BackupMemoryPreferenceSummary {
  return BackupMemoryPreferenceSummarySchema.parse({
    apiVersion: 1,
    activeVaultId: summary.vaultId,
    revision: summary.revision,
    includeVaultMemory: summary.value,
    canUpdate: summary.canUpdate
  });
}
