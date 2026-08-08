import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  KnowledgeActivityRedoRequest,
  KnowledgeActivityRedoResult,
  KnowledgeActivitySummary,
  KnowledgeActivityUndoResult
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { OperationRecordSchema, VaultConfigSchema, type OperationRecord, type VaultConfig } from "@pige/schemas";
import { flushDirectoryWhereSupported } from "./durable-directory-sync";
import { readVaultConfig } from "./vault-layout";

export type BackupContentPreferenceKind = "memory" | "trash" | "conversations";

export interface BackupContentPreferenceVaultPort {
  current(): { readonly vaultId: string } | undefined;
  activeVaultPath(): string | undefined;
  assertWriterLease(vaultPath: string): void;
}

export interface BackupContentPreferenceActivityServiceOptions {
  readonly vault: BackupContentPreferenceVaultPort;
  readonly hasActiveBackupJob: () => boolean;
  readonly now?: () => string;
}

export interface BackupContentPreferenceSummary {
  readonly vaultId: string;
  readonly revision: string;
  readonly value: boolean;
  readonly canUpdate: boolean;
}

export interface BackupContentPreferenceUpdateInput {
  readonly requestId: string;
  readonly activeVaultId: string;
  readonly expectedRevision: string;
  readonly value: boolean;
}

export interface BackupContentPreferenceUpdateResult {
  readonly status: "updated" | "stale" | "blocked";
  readonly summary: BackupContentPreferenceSummary;
}

interface PreferenceDefinition {
  readonly settingId: string;
  readonly revisionPrefix: string;
  readonly receiptRoot: string;
  readonly receiptKind: string;
  readonly targetLabel: string;
  readonly enabledSummary: string;
  readonly disabledSummary: string;
  readonly restoredEnabledSummary: string;
  readonly restoredDisabledSummary: string;
  readonly reappliedSummary: string;
  readonly get: (config: VaultConfig) => boolean;
  readonly set: (config: VaultConfig, value: boolean) => VaultConfig;
}

interface PreferenceReceipt {
  readonly schemaVersion: 1;
  readonly kind: string;
  readonly preference: BackupContentPreferenceKind;
  readonly requestId: string;
  readonly requestDigest: string;
  readonly activeVaultId: string;
  readonly beforeBytes: string;
  readonly afterBytes: string;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly beforeConfig?: VaultConfig;
  readonly afterConfig?: VaultConfig;
  readonly beforeValue: boolean;
  readonly afterValue: boolean;
  readonly operationId: string;
  readonly createdAt: string;
  readonly redoOfOperationId?: string;
  readonly undoOperationId?: string;
  readonly legacyConversationReceipt?: true;
}

const DEFINITIONS: Readonly<Record<BackupContentPreferenceKind, PreferenceDefinition>> = {
  memory: {
    settingId: "memory.includeMemoryInBackup",
    revisionPrefix: "backupmemoryrev",
    receiptRoot: ".pige/backup-memory-preference-receipts",
    receiptKind: "backup_memory_preference_receipt",
    targetLabel: "Agent memory backups",
    enabledSummary: "Include vault Agent memory in future backups.",
    disabledSummary: "Exclude vault Agent memory from future backups.",
    restoredEnabledSummary: "Restored vault Agent memory inclusion in future backups.",
    restoredDisabledSummary: "Restored vault Agent memory exclusion from future backups.",
    reappliedSummary: "Reapplied the Agent memory backup preference.",
    get: (config) => config.backup.includeVaultMemory,
    set: (config, value) => VaultConfigSchema.parse({ ...config, backup: { ...config.backup, includeVaultMemory: value } })
  },
  trash: {
    settingId: "backup.includeTrash",
    revisionPrefix: "backuptrashrev",
    receiptRoot: ".pige/backup-trash-preference-receipts",
    receiptKind: "backup_trash_preference_receipt",
    targetLabel: "Recoverable trash backups",
    enabledSummary: "Include recoverable trash in future backups.",
    disabledSummary: "Exclude recoverable trash from future backups.",
    restoredEnabledSummary: "Restored recoverable trash inclusion in future backups.",
    restoredDisabledSummary: "Restored recoverable trash exclusion from future backups.",
    reappliedSummary: "Reapplied the recoverable trash backup preference.",
    get: (config) => config.backup.includeTrash,
    set: (config, value) => VaultConfigSchema.parse({ ...config, backup: { ...config.backup, includeTrash: value } })
  },
  conversations: {
    settingId: "backup.includeConversations",
    revisionPrefix: "backupconversationrev",
    receiptRoot: ".pige/backup-conversation-preference-receipts",
    receiptKind: "backup_conversation_preference_receipt",
    targetLabel: "Conversation history backups",
    enabledSummary: "Included conversation history in future backups.",
    disabledSummary: "Excluded conversation history from future backups.",
    restoredEnabledSummary: "Restored conversation history inclusion in future backups.",
    restoredDisabledSummary: "Restored conversation history exclusion from future backups.",
    reappliedSummary: "Reapplied the conversation history backup preference.",
    get: (config) => config.backup.includeConversations,
    set: (config, value) => VaultConfigSchema.parse({ ...config, backup: { ...config.backup, includeConversations: value } })
  }
};

export class BackupContentPreferenceActivityService {
  readonly #vault: BackupContentPreferenceVaultPort;
  readonly #hasActiveBackupJob: () => boolean;
  readonly #now: () => string;

  constructor(options: BackupContentPreferenceActivityServiceOptions) {
    this.#vault = options.vault;
    this.#hasActiveBackupJob = options.hasActiveBackupJob;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  summary(preference: BackupContentPreferenceKind): BackupContentPreferenceSummary {
    const binding = this.#binding();
    return this.#summary(preference, binding.vaultId, binding.bytes, binding.config);
  }

  update(preference: BackupContentPreferenceKind, input: BackupContentPreferenceUpdateInput): BackupContentPreferenceUpdateResult {
    const definition = DEFINITIONS[preference], binding = this.#binding(), current = this.#summary(preference, binding.vaultId, binding.bytes, binding.config);
    const replay = readReceipt(binding.vaultPath, definition, input.requestId);
    if (replay) {
      if (!matchesRequest(replay, input) || readOperation(binding.vaultPath, undoOperationId(replay.operationId))) {
        return { status: "stale", summary: this.summary(preference) };
      }
      completeForward(this.#vault, binding.vaultPath, definition, replay);
      return { status: "updated", summary: this.summary(preference) };
    }
    if (input.activeVaultId !== binding.vaultId || input.expectedRevision !== current.revision) return { status: "stale", summary: current };
    if (this.#hasActiveBackupJob()) return { status: "blocked", summary: { ...current, canUpdate: false } };
    if (definition.get(binding.config) === input.value) return { status: "updated", summary: current };

    this.#assertCurrent(binding, hash(binding.bytes));
    const receipt = createReceipt(preference, definition, input, binding.bytes, definition.set(binding.config, input.value), this.#now());
    persistReceipt(this.#vault, binding.vaultPath, definition, receipt);
    completeForward(this.#vault, binding.vaultPath, definition, receipt);
    return { status: "updated", summary: this.summary(preference) };
  }

  activitySummary(preference: BackupContentPreferenceKind, operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    const vaultPath = this.#vault.activeVaultPath(), definition = DEFINITIONS[preference];
    if (!vaultPath || operation.kind !== "change_setting" || operation.targetRefs[0]?.id !== definition.settingId) return undefined;
    const receipt = findReceipt(vaultPath, definition, operation.id);
    if (!receipt || !matchesForward(definition, receipt, operation)) return undefined;
    const undone = undo !== undefined && matchesUndo(operation, undo);
    const current = configHash(vaultPath), expected = undone ? receipt.beforeHash : receipt.afterHash;
    const canUndo = !undone && current === expected && !this.#hasActiveBackupJob();
    return {
      operationId: operation.id,
      kind: "change_setting",
      createdAt: operation.createdAt,
      targetLabel: definition.targetLabel,
      status: undone ? "undone" : "applied",
      canUndo,
      ...(undone ? { undoUnavailableReason: "already_undone" as const } : canUndo ? {} : {
        undoUnavailableReason: current === expected ? "revision_changed" as const : "content_changed" as const
      }),
      ...(undone ? this.activityState(preference, operation, undo) ?? {} : {})
    };
  }

  findUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    return operations.find((candidate) => candidate.id === undoOperationId(operation.id));
  }

  undo(preference: BackupContentPreferenceKind, operation: OperationRecord): KnowledgeActivityUndoResult {
    const vaultPath = this.#vault.activeVaultPath(), definition = DEFINITIONS[preference];
    if (!vaultPath) return { status: "not_found", operationId: operation.id };
    const receipt = findReceipt(vaultPath, definition, operation.id);
    if (!receipt || !matchesForward(definition, receipt, operation)) return { status: "not_found", operationId: operation.id };
    const undoId = undoOperationId(operation.id), existing = readOperation(vaultPath, undoId);
    if (existing) return matchesUndo(operation, existing)
      ? { status: "already_undone", operationId: operation.id, undoOperationId: undoId }
      : { status: "stale", operationId: operation.id };
    if (this.#hasActiveBackupJob() || configHash(vaultPath) !== receipt.afterHash) return { status: "stale", operationId: operation.id };
    writeUndoIntent(this.#vault, vaultPath, definition, receipt.requestId);
    completeUndo(this.#vault, vaultPath, definition, receipt, operation);
    return { status: "undone", operationId: operation.id, undoOperationId: undoId };
  }

  activityState(
    preference: BackupContentPreferenceKind,
    operation: OperationRecord,
    undo: OperationRecord | undefined
  ): Pick<KnowledgeActivitySummary, "canRedo" | "redoUnavailableReason"> | undefined {
    const vaultPath = this.#vault.activeVaultPath(), definition = DEFINITIONS[preference];
    if (!vaultPath || !undo || !matchesUndo(operation, undo)) return undefined;
    const receipt = findReceipt(vaultPath, definition, operation.id);
    if (!receipt || !matchesForward(definition, receipt, operation)) return undefined;
    try {
      const child = findRedoReceipt(vaultPath, definition, operation.id);
      if (child) {
        if (!matchesRedoReceipt(child, receipt, undo)) return { canRedo: false, redoUnavailableReason: "content_changed" };
        const redo = readOperation(vaultPath, child.operationId);
        return redo && matchesForward(definition, child, redo) && configHash(vaultPath) === child.afterHash
          ? { canRedo: false, redoUnavailableReason: "already_redone" }
          : { canRedo: false, redoUnavailableReason: "content_changed" };
      }
      return configHash(vaultPath) === receipt.beforeHash && !this.#hasActiveBackupJob()
        ? { canRedo: true }
        : { canRedo: false, redoUnavailableReason: "content_changed" };
    } catch {
      return { canRedo: false, redoUnavailableReason: "content_changed" };
    }
  }

  redo(preference: BackupContentPreferenceKind, request: KnowledgeActivityRedoRequest): KnowledgeActivityRedoResult {
    const definition = DEFINITIONS[preference];
    if (!request || typeof request !== "object" || !OPERATION_ID.test(request.operationId)) {
      throw new PigeDomainError("activity.invalid_operation_id", "The Activity operation identity is invalid.");
    }
    const vaultPath = this.#vault.activeVaultPath();
    if (!vaultPath) return { status: "not_found", operationId: request.operationId };
    try {
      const operation = readOperation(vaultPath, request.operationId), receipt = operation && findReceipt(vaultPath, definition, operation.id);
      if (!operation || !receipt || !matchesForward(definition, receipt, operation)) return { status: "not_found", operationId: request.operationId };
      const undo = readOperation(vaultPath, undoOperationId(operation.id));
      if (!undo || !matchesUndo(operation, undo)) return { status: "not_found", operationId: operation.id };
      const currentRevisionId = configHash(vaultPath);
      if (this.#hasActiveBackupJob()) return { status: "stale", operationId: operation.id, currentRevisionId };
      if (request.expectedRevisionId !== undefined && request.expectedRevisionId !== receipt.beforeHash) {
        return { status: "stale", operationId: operation.id, currentRevisionId };
      }
      const existing = findRedoReceipt(vaultPath, definition, operation.id);
      if (existing && !matchesRedoReceipt(existing, receipt, undo)) return { status: "stale", operationId: operation.id, currentRevisionId };
      const child = existing ?? createRedoReceipt(definition, receipt, undo, this.#now());
      const redo = readOperation(vaultPath, child.operationId);
      if (redo) {
        if (!matchesForward(definition, child, redo) || configHash(vaultPath) !== child.afterHash) {
          return { status: "stale", operationId: operation.id, currentRevisionId: configHash(vaultPath) };
        }
        return { status: "already_redone", operationId: operation.id, undoOperationId: undo.id, redoOperationId: redo.id, revisionId: child.afterHash };
      }
      const current = configHash(vaultPath);
      if ((!existing && current !== receipt.beforeHash) || (existing && current !== receipt.beforeHash && current !== receipt.afterHash)) {
        return { status: "stale", operationId: operation.id, currentRevisionId: current };
      }
      if (!existing) persistReceipt(this.#vault, vaultPath, definition, child);
      completeForward(this.#vault, vaultPath, definition, child);
      return { status: "redone", operationId: operation.id, undoOperationId: undo.id, redoOperationId: child.operationId, revisionId: child.afterHash };
    } catch {
      return { status: "stale", operationId: request.operationId };
    }
  }

  recoverIncompleteOperations(preference: BackupContentPreferenceKind): { readonly recovered: number; readonly failed: number } {
    const vaultPath = this.#vault.activeVaultPath(), definition = DEFINITIONS[preference];
    if (!vaultPath) return { recovered: 0, failed: 0 };
    if (this.#hasActiveBackupJob()) return { recovered: 0, failed: 0 };
    let recovered = 0, failed = 0;
    for (const receipt of listReceipts(vaultPath, definition)) {
      try {
        const operation = readOperation(vaultPath, receipt.operationId);
        if (!operation) {
          completeForward(this.#vault, vaultPath, definition, receipt);
          recovered += 1;
        } else if (!readOperation(vaultPath, undoOperationId(receipt.operationId)) && hasUndoIntent(vaultPath, definition, receipt.requestId)) {
          completeUndo(this.#vault, vaultPath, definition, receipt, operation);
          recovered += 1;
        }
      } catch {
        failed += 1;
      }
    }
    return { recovered, failed };
  }

  #binding(): { readonly vaultId: string; readonly vaultPath: string; readonly bytes: Buffer; readonly config: VaultConfig } {
    const active = this.#vault.current(), vaultPath = this.#vault.activeVaultPath();
    if (!active || !vaultPath) throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    this.#vault.assertWriterLease(vaultPath);
    return { vaultId: active.vaultId, vaultPath, bytes: readExact(configPath(vaultPath)), config: readVaultConfig(vaultPath) };
  }

  #summary(preference: BackupContentPreferenceKind, vaultId: string, bytes: Buffer, config: VaultConfig): BackupContentPreferenceSummary {
    const definition = DEFINITIONS[preference];
    return { vaultId, revision: `${definition.revisionPrefix}_${digest(bytes)}`, value: definition.get(config), canUpdate: !this.#hasActiveBackupJob() };
  }

  #assertCurrent(binding: { readonly vaultId: string; readonly vaultPath: string }, expectedHash: string): void {
    if (this.#vault.current()?.vaultId !== binding.vaultId || this.#vault.activeVaultPath() !== binding.vaultPath) throw stale();
    this.#vault.assertWriterLease(binding.vaultPath);
    if (configHash(binding.vaultPath) !== expectedHash) throw stale();
  }
}

function createReceipt(
  preference: BackupContentPreferenceKind,
  definition: PreferenceDefinition,
  input: BackupContentPreferenceUpdateInput,
  beforeBytes: Buffer,
  afterConfig: VaultConfig,
  createdAt: string
): PreferenceReceipt {
  const afterBytes = configBytes(afterConfig);
  return {
    schemaVersion: 1,
    kind: definition.receiptKind,
    preference,
    requestId: input.requestId,
    requestDigest: digestRequest(input),
    activeVaultId: input.activeVaultId,
    beforeBytes: beforeBytes.toString("base64"),
    afterBytes: afterBytes.toString("base64"),
    beforeHash: hash(beforeBytes),
    afterHash: hash(afterBytes),
    beforeValue: definition.get(VaultConfigSchema.parse(JSON.parse(beforeBytes.toString("utf8")))),
    afterValue: definition.get(afterConfig),
    operationId: operationId(preference, createdAt, input.requestId),
    createdAt
  };
}

function completeForward(vault: BackupContentPreferenceVaultPort, vaultPath: string, definition: PreferenceDefinition, receipt: PreferenceReceipt): void {
  const existing = readOperation(vaultPath, receipt.operationId);
  if (existing) {
    if (!matchesForward(definition, receipt, existing) || configHash(vaultPath) !== receipt.afterHash) throw conflict();
    return;
  }
  const current = configHash(vaultPath);
  if (current === receipt.beforeHash) atomicReplace(vault, vaultPath, Buffer.from(receipt.afterBytes, "base64"));
  else if (current !== receipt.afterHash) throw conflict();
  writeOperation(vault, vaultPath, createForwardOperation(definition, receipt));
}

function completeUndo(vault: BackupContentPreferenceVaultPort, vaultPath: string, definition: PreferenceDefinition, receipt: PreferenceReceipt, operation: OperationRecord): void {
  const undoId = undoOperationId(operation.id), existing = readOperation(vaultPath, undoId);
  if (existing) {
    if (!matchesUndo(operation, existing) || configHash(vaultPath) !== receipt.beforeHash) throw conflict();
    return;
  }
  const current = configHash(vaultPath);
  if (current === receipt.afterHash) atomicReplace(vault, vaultPath, Buffer.from(receipt.beforeBytes, "base64"));
  else if (current !== receipt.beforeHash) throw conflict();
  writeOperation(vault, vaultPath, createUndoOperation(definition, receipt, operation));
}

function createForwardOperation(definition: PreferenceDefinition, receipt: PreferenceReceipt): OperationRecord {
  return OperationRecordSchema.parse({
    id: receipt.operationId,
    schemaVersion: 1,
    createdAt: receipt.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "change_setting",
    targetRefs: [{ kind: "setting", id: definition.settingId }],
    sourceRefs: receipt.redoOfOperationId && receipt.undoOperationId
      ? [{ kind: "operation", id: receipt.redoOfOperationId }, { kind: "operation", id: receipt.undoOperationId }]
      : [],
    before: { kind: "setting", id: definition.settingId, checksum: receipt.beforeHash },
    after: { kind: "setting", id: definition.settingId, checksum: receipt.afterHash },
    summary: receipt.redoOfOperationId ? definition.reappliedSummary : receipt.afterValue ? definition.enabledSummary : definition.disabledSummary,
    reversible: "yes",
    rollbackHint: "Undo this Activity or change the backup preference again in Settings.",
    warnings: []
  });
}

function createUndoOperation(definition: PreferenceDefinition, receipt: PreferenceReceipt, operation: OperationRecord): OperationRecord {
  return OperationRecordSchema.parse({
    id: undoOperationId(operation.id),
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "change_setting",
    targetRefs: operation.targetRefs,
    sourceRefs: [{ kind: "operation", id: operation.id }],
    before: operation.after,
    after: { kind: "setting", id: definition.settingId, checksum: receipt.beforeHash },
    summary: receipt.beforeValue ? definition.restoredEnabledSummary : definition.restoredDisabledSummary,
    reversible: "no",
    warnings: []
  });
}

function createRedoReceipt(definition: PreferenceDefinition, parent: PreferenceReceipt, undo: OperationRecord, createdAt: string): PreferenceReceipt {
  const requestId = `backupprefredoreq_${digest(Buffer.from(`redo\0${parent.preference}\0${parent.operationId}`, "utf8")).slice(0, 32)}`;
  return {
    ...parent,
    requestId,
    requestDigest: hash(Buffer.from(`${parent.preference}\0${parent.operationId}\0${undo.id}\0${parent.beforeHash}\0${parent.afterHash}`, "utf8")),
    operationId: redoOperationId(parent.operationId, parent.preference),
    createdAt,
    redoOfOperationId: parent.operationId,
    undoOperationId: undo.id,
    kind: definition.receiptKind
  };
}

function persistReceipt(vault: BackupContentPreferenceVaultPort, vaultPath: string, definition: PreferenceDefinition, receipt: PreferenceReceipt): void {
  vault.assertWriterLease(vaultPath);
  writeExclusive(receiptPath(vaultPath, definition, receipt.requestId), Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"));
}

function readReceipt(vaultPath: string, definition: PreferenceDefinition, requestId: string): PreferenceReceipt | undefined {
  const file = receiptPath(vaultPath, definition, requestId);
  if (!fs.existsSync(file)) return undefined;
  const value = JSON.parse(readExact(file, 128 * 1024).toString("utf8")) as Partial<PreferenceReceipt>;
  if (value.schemaVersion !== 1 || value.kind !== definition.receiptKind || value.requestId !== requestId ||
    typeof value.operationId !== "string" || typeof value.beforeBytes !== "string" || typeof value.afterBytes !== "string" ||
    typeof value.beforeHash !== "string" || typeof value.afterHash !== "string") throw conflict();
  const before = Buffer.from(value.beforeBytes, "base64"), after = Buffer.from(value.afterBytes, "base64"),
    beforeConfig = VaultConfigSchema.parse(JSON.parse(before.toString("utf8"))), afterConfig = VaultConfigSchema.parse(JSON.parse(after.toString("utf8")));
  if (value.preference === undefined && definition === DEFINITIONS.conversations) {
    if (!matchesLegacyConversationReceipt(value, beforeConfig, afterConfig)) throw conflict();
    return {
      ...value,
      preference: "conversations",
      beforeValue: definition.get(beforeConfig),
      afterValue: definition.get(afterConfig),
      legacyConversationReceipt: true
    } as PreferenceReceipt;
  }
  if (!isPreference(value.preference) || typeof value.beforeValue !== "boolean" || typeof value.afterValue !== "boolean") throw conflict();
  const actualDefinition = DEFINITIONS[value.preference];
  if (actualDefinition !== definition || hash(before) !== value.beforeHash || hash(after) !== value.afterHash ||
    actualDefinition.get(beforeConfig) !== value.beforeValue || actualDefinition.get(afterConfig) !== value.afterValue ||
    (typeof value.redoOfOperationId === "string") !== (typeof value.undoOperationId === "string") ||
    (value.redoOfOperationId !== undefined && (!OPERATION_ID.test(value.redoOfOperationId) || !OPERATION_ID.test(value.undoOperationId!)))) throw conflict();
  return value as PreferenceReceipt;
}

function listReceipts(vaultPath: string, definition: PreferenceDefinition): PreferenceReceipt[] {
  const root = path.join(vaultPath, definition.receiptRoot);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
    try { const receipt = readReceipt(vaultPath, definition, entry.name); return receipt ? [receipt] : []; } catch { return []; }
  });
}

function findReceipt(vaultPath: string, definition: PreferenceDefinition, operationIdValue: string): PreferenceReceipt | undefined {
  return listReceipts(vaultPath, definition).find((receipt) => receipt.operationId === operationIdValue);
}

function findRedoReceipt(vaultPath: string, definition: PreferenceDefinition, operationIdValue: string): PreferenceReceipt | undefined {
  const matches = listReceipts(vaultPath, definition).filter((receipt) => receipt.redoOfOperationId === operationIdValue);
  if (matches.length > 1) throw conflict();
  return matches[0];
}

function matchesRequest(receipt: PreferenceReceipt, input: BackupContentPreferenceUpdateInput): boolean {
  return receipt.activeVaultId === input.activeVaultId && (
    receipt.requestDigest === digestRequest(input) ||
    (receipt.legacyConversationReceipt === true && receipt.requestDigest === hash(Buffer.from(JSON.stringify({
      apiVersion: 1,
      requestId: input.requestId,
      activeVaultId: input.activeVaultId,
      expectedRevision: input.expectedRevision,
      includeConversations: input.value
    }), "utf8")))
  );
}

function matchesForward(definition: PreferenceDefinition, receipt: PreferenceReceipt, operation: OperationRecord): boolean {
  return operation.id === receipt.operationId && operation.kind === "change_setting" && operation.targetRefs.length === 1 &&
    operation.targetRefs[0]?.id === definition.settingId && operation.before?.checksum === receipt.beforeHash &&
    operation.after?.checksum === receipt.afterHash &&
    (receipt.redoOfOperationId && receipt.undoOperationId
      ? operation.sourceRefs.length === 2 &&
        operation.sourceRefs.some((reference) => reference.kind === "operation" && reference.id === receipt.redoOfOperationId) &&
        operation.sourceRefs.some((reference) => reference.kind === "operation" && reference.id === receipt.undoOperationId)
      : operation.sourceRefs.length === 0);
}

function matchesUndo(operation: OperationRecord, undo: OperationRecord): boolean {
  return undo.id === undoOperationId(operation.id) && undo.kind === "change_setting" && undo.sourceRefs.length === 1 &&
    undo.sourceRefs.some((reference) => reference.kind === "operation" && reference.id === operation.id) &&
    undo.before?.checksum === operation.after?.checksum && undo.after?.checksum === operation.before?.checksum;
}

function matchesRedoReceipt(child: PreferenceReceipt, parent: PreferenceReceipt, undo: OperationRecord): boolean {
  return child.preference === parent.preference && child.redoOfOperationId === parent.operationId && child.undoOperationId === undo.id &&
    child.operationId === redoOperationId(parent.operationId, parent.preference) && child.activeVaultId === parent.activeVaultId &&
    child.beforeHash === parent.beforeHash && child.afterHash === parent.afterHash && child.beforeValue === parent.beforeValue &&
    child.afterValue === parent.afterValue && child.requestId === `backupprefredoreq_${digest(Buffer.from(`redo\0${parent.preference}\0${parent.operationId}`, "utf8")).slice(0, 32)}` &&
    child.requestDigest === hash(Buffer.from(`${parent.preference}\0${parent.operationId}\0${undo.id}\0${parent.beforeHash}\0${parent.afterHash}`, "utf8"));
}

function writeOperation(vault: BackupContentPreferenceVaultPort, vaultPath: string, operation: OperationRecord): void {
  const file = operationPath(vaultPath, operation.id), bytes = Buffer.from(`${JSON.stringify(operation, null, 2)}\n`, "utf8");
  if (fs.existsSync(file)) {
    if (!readExact(file, 256 * 1024).equals(bytes)) throw conflict();
    return;
  }
  vault.assertWriterLease(vaultPath);
  writeExclusive(file, bytes);
}

function readOperation(vaultPath: string, operationIdValue: string): OperationRecord | undefined {
  const file = operationPath(vaultPath, operationIdValue);
  return fs.existsSync(file) ? OperationRecordSchema.parse(JSON.parse(readExact(file, 256 * 1024).toString("utf8"))) : undefined;
}

function writeUndoIntent(vault: BackupContentPreferenceVaultPort, vaultPath: string, definition: PreferenceDefinition, requestId: string): void {
  const file = undoIntentPath(vaultPath, definition, requestId);
  if (!fs.existsSync(file)) {
    vault.assertWriterLease(vaultPath);
    writeExclusive(file, Buffer.from(`{"schemaVersion":1,"kind":"${definition.receiptKind}_undo"}\n`, "utf8"));
  }
}

function hasUndoIntent(vaultPath: string, definition: PreferenceDefinition, requestId: string): boolean {
  return fs.existsSync(undoIntentPath(vaultPath, definition, requestId));
}

function atomicReplace(vault: BackupContentPreferenceVaultPort, vaultPath: string, bytes: Buffer): void {
  const file = configPath(vaultPath), temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  vault.assertWriterLease(vaultPath);
  fs.renameSync(temporary, file);
  flushDirectoryWhereSupported(path.dirname(file));
}

function operationPath(vaultPath: string, operationIdValue: string): string {
  const match = /^op_(\d{4})(\d{2})\d{2}_[a-z0-9]+$/u.exec(operationIdValue);
  if (!match) throw conflict();
  return path.join(vaultPath, ".pige", "operations", match[1]!, match[2]!, `${operationIdValue}.json`);
}
function receiptPath(vaultPath: string, definition: PreferenceDefinition, requestId: string): string { return path.join(vaultPath, definition.receiptRoot, requestId, "receipt.json"); }
function undoIntentPath(vaultPath: string, definition: PreferenceDefinition, requestId: string): string { return path.join(vaultPath, definition.receiptRoot, requestId, "undo.json"); }
function configPath(vaultPath: string): string { return path.join(vaultPath, ".pige", "config.json"); }
function configHash(vaultPath: string): string { return hash(readExact(configPath(vaultPath))); }
function configBytes(config: VaultConfig): Buffer { return Buffer.from(`${JSON.stringify(config, null, 2)}\n`, "utf8"); }
function operationId(preference: BackupContentPreferenceKind, createdAt: string, requestId: string): string { return `op_${createdAt.slice(0, 10).replaceAll("-", "")}_${digest(Buffer.from(`pige.backup.${preference}.v1\0${requestId}`, "utf8")).slice(0, 48)}`; }
function undoOperationId(operationIdValue: string): string { return `${operationIdValue}undo`; }
function redoOperationId(operationIdValue: string, preference: BackupContentPreferenceKind): string {
  const date = /^op_(\d{8})_/u.exec(operationIdValue)?.[1];
  if (!date) throw conflict();
  return `op_${date}_${digest(Buffer.from(`pige.backup.${preference}.redo.v1\0${operationIdValue}`, "utf8")).slice(0, 48)}`;
}
function digestRequest(input: BackupContentPreferenceUpdateInput): string { return hash(Buffer.from(JSON.stringify(input), "utf8")); }
function hash(bytes: Buffer): string { return `sha256:${digest(bytes)}`; }
function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function isPreference(value: unknown): value is BackupContentPreferenceKind { return value === "memory" || value === "trash" || value === "conversations"; }
function matchesLegacyConversationReceipt(value: Partial<PreferenceReceipt>, before: VaultConfig, after: VaultConfig): boolean {
  const beforeConfig = value.beforeConfig, afterConfig = value.afterConfig;
  return beforeConfig !== undefined && afterConfig !== undefined &&
    JSON.stringify(VaultConfigSchema.parse(beforeConfig)) === JSON.stringify(before) &&
    JSON.stringify(VaultConfigSchema.parse(afterConfig)) === JSON.stringify(after) &&
    typeof value.requestDigest === "string" && typeof value.activeVaultId === "string" && typeof value.createdAt === "string";
}
function writeExclusive(file: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  flushDirectoryWhereSupported(path.dirname(file));
}
function readExact(file: string, max = 128 * 1024): Buffer {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink < 1 || stat.size > max) throw conflict();
  return fs.readFileSync(file);
}
const OPERATION_ID = /^op_\d{8}_[a-z0-9]{8,}$/u;
function conflict(): PigeDomainError { return new PigeDomainError("backup.preference_conflict", "The backup preference changed unexpectedly."); }
function stale(): PigeDomainError { return new PigeDomainError("backup.preference_stale", "The active vault or backup preference changed."); }
