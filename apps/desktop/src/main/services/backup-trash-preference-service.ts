import type {
  KnowledgeActivityRedoRequest,
  KnowledgeActivityRedoResult,
  KnowledgeActivitySummary,
  KnowledgeActivityUndoResult
} from "@pige/contracts";
import {
  BackupTrashPreferenceSummarySchema,
  BackupTrashPreferenceUpdateRequestSchema,
  BackupTrashPreferenceUpdateResultSchema,
  type BackupTrashPreferenceSummary,
  type BackupTrashPreferenceUpdateRequest,
  type BackupTrashPreferenceUpdateResult,
  type OperationRecord
} from "@pige/schemas";
import {
  BackupContentPreferenceActivityService,
  type BackupContentPreferenceActivityServiceOptions
} from "./backup-content-preference-activity-service";
import { readVaultConfig } from "./vault-layout";

export interface BackupTrashPreferenceServiceOptions extends BackupContentPreferenceActivityServiceOptions {}

export class BackupTrashPreferenceService {
  readonly #activity: BackupContentPreferenceActivityService;

  constructor(options: BackupTrashPreferenceServiceOptions) {
    this.#activity = new BackupContentPreferenceActivityService(options);
  }

  summary(): BackupTrashPreferenceSummary {
    return toSummary(this.#activity.summary("trash"));
  }

  update(input: BackupTrashPreferenceUpdateRequest): BackupTrashPreferenceUpdateResult {
    const request = BackupTrashPreferenceUpdateRequestSchema.parse(input);
    const result = this.#activity.update("trash", {
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      expectedRevision: request.expectedRevision,
      value: request.includeTrash
    });
    return BackupTrashPreferenceUpdateResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      status: result.status,
      summary: toSummary(result.summary)
    });
  }

  activitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    return this.#activity.activitySummary("trash", operation, undo);
  }

  findUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    return this.#activity.findUndoOperation(operation, operations);
  }

  undo(operation: OperationRecord): KnowledgeActivityUndoResult {
    return this.#activity.undo("trash", operation);
  }

  activityState(operation: OperationRecord, undo: OperationRecord | undefined): Pick<KnowledgeActivitySummary, "canRedo" | "redoUnavailableReason"> | undefined {
    return this.#activity.activityState("trash", operation, undo);
  }

  redo(request: KnowledgeActivityRedoRequest): KnowledgeActivityRedoResult {
    return this.#activity.redo("trash", request);
  }

  recoverIncompleteOperations(): { readonly recovered: number; readonly failed: number } {
    return this.#activity.recoverIncompleteOperations("trash");
  }
}

export function includesTrashInBackup(vaultPath?: string): boolean {
  return vaultPath ? readVaultConfig(vaultPath).backup.includeTrash : true;
}

export function filterTrashBackupPaths(paths: readonly string[], includeTrash: boolean): readonly string[] {
  return includeTrash ? paths : paths.filter((relativePath) => !relativePath.startsWith(".pige/trash/"));
}

function toSummary(summary: { readonly vaultId: string; readonly revision: string; readonly value: boolean; readonly canUpdate: boolean }): BackupTrashPreferenceSummary {
  return BackupTrashPreferenceSummarySchema.parse({
    apiVersion: 1,
    activeVaultId: summary.vaultId,
    revision: summary.revision,
    includeTrash: summary.value,
    canUpdate: summary.canUpdate
  });
}
