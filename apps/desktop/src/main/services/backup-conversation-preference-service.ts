import type {
  KnowledgeActivityRedoRequest,
  KnowledgeActivityRedoResult,
  KnowledgeActivitySummary,
  KnowledgeActivityUndoResult,
  VaultSummary
} from "@pige/contracts";
import {
  BackupConversationPreferenceSummarySchema,
  BackupConversationPreferenceUpdateRequestSchema,
  BackupConversationPreferenceUpdateResultSchema,
  type BackupConversationPreferenceSummary,
  type BackupConversationPreferenceUpdateRequest,
  type BackupConversationPreferenceUpdateResult,
  type OperationRecord
} from "@pige/schemas";
import {
  BackupContentPreferenceActivityService,
  type BackupContentPreferenceActivityServiceOptions,
  type BackupContentPreferenceVaultPort
} from "./backup-content-preference-activity-service";
import { readVaultConfig } from "./vault-layout";

export interface BackupConversationPreferenceVaultPort extends BackupContentPreferenceVaultPort {
  current(): VaultSummary | undefined;
}

export interface BackupConversationPreferenceServiceOptions extends Omit<BackupContentPreferenceActivityServiceOptions, "vault"> {
  readonly vault: BackupConversationPreferenceVaultPort;
}

export class BackupConversationPreferenceService {
  readonly #activity: BackupContentPreferenceActivityService;

  constructor(options: BackupConversationPreferenceServiceOptions) {
    this.#activity = new BackupContentPreferenceActivityService(options);
  }

  summary(): BackupConversationPreferenceSummary {
    return toSummary(this.#activity.summary("conversations"));
  }

  update(input: BackupConversationPreferenceUpdateRequest): BackupConversationPreferenceUpdateResult {
    const request = BackupConversationPreferenceUpdateRequestSchema.parse(input);
    const result = this.#activity.update("conversations", {
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      expectedRevision: request.expectedRevision,
      value: request.includeConversations
    });
    return BackupConversationPreferenceUpdateResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      status: result.status,
      summary: toSummary(result.summary)
    });
  }

  activitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    return this.#activity.activitySummary("conversations", operation, undo);
  }

  findUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    return this.#activity.findUndoOperation(operation, operations);
  }

  undo(operation: OperationRecord): KnowledgeActivityUndoResult {
    return this.#activity.undo("conversations", operation);
  }

  activityState(operation: OperationRecord, undo: OperationRecord | undefined): Pick<KnowledgeActivitySummary, "canRedo" | "redoUnavailableReason"> | undefined {
    return this.#activity.activityState("conversations", operation, undo);
  }

  redo(request: KnowledgeActivityRedoRequest): KnowledgeActivityRedoResult {
    return this.#activity.redo("conversations", request);
  }

  recoverIncompleteOperations(): { readonly recovered: number; readonly failed: number } {
    return this.#activity.recoverIncompleteOperations("conversations");
  }
}

export function includesConversationHistoryInBackup(vaultPath?: string): boolean {
  return vaultPath ? readVaultConfig(vaultPath).backup.includeConversations : true;
}

export function filterConversationBackupPaths(paths: readonly string[], includeConversations: boolean): readonly string[] {
  return includeConversations ? paths : paths.filter((relativePath) => !relativePath.startsWith(".pige/conversations/"));
}

function toSummary(summary: { readonly vaultId: string; readonly revision: string; readonly value: boolean; readonly canUpdate: boolean }): BackupConversationPreferenceSummary {
  return BackupConversationPreferenceSummarySchema.parse({
    apiVersion: 1,
    activeVaultId: summary.vaultId,
    revision: summary.revision,
    includeConversations: summary.value,
    canUpdate: summary.canUpdate
  });
}
