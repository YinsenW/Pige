import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { KnowledgeActivitySummary, KnowledgeActivityUndoResult, VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  BackupConversationPreferenceSummarySchema,
  BackupConversationPreferenceUpdateRequestSchema,
  BackupConversationPreferenceUpdateResultSchema,
  OperationRecordSchema,
  VaultConfigSchema,
  type BackupConversationPreferenceSummary,
  type BackupConversationPreferenceUpdateRequest,
  type BackupConversationPreferenceUpdateResult,
  type OperationRecord,
  type VaultConfig
} from "@pige/schemas";
import { flushDirectoryWhereSupported } from "./durable-directory-sync";
import { readVaultConfig } from "./vault-layout";

const RECEIPT_ROOT = ".pige/backup-conversation-preference-receipts";
const SETTING_ID = "backup.includeConversations";

interface BackupConversationPreferenceVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
  assertWriterLease(vaultPath: string): void;
}

interface PreferenceReceipt {
  readonly schemaVersion: 1;
  readonly kind: "backup_conversation_preference_receipt";
  readonly requestId: string;
  readonly requestDigest: string;
  readonly activeVaultId: string;
  readonly beforeConfig: VaultConfig;
  readonly afterConfig: VaultConfig;
  readonly beforeBytes: string;
  readonly afterBytes: string;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly operationId: string;
  readonly createdAt: string;
}

export interface BackupConversationPreferenceServiceOptions {
  readonly vault: BackupConversationPreferenceVaultPort;
  readonly hasActiveBackupJob: () => boolean;
  readonly now?: () => string;
}

export class BackupConversationPreferenceService {
  readonly #vault: BackupConversationPreferenceVaultPort;
  readonly #hasActiveBackupJob: () => boolean;
  readonly #now: () => string;

  constructor(options: BackupConversationPreferenceServiceOptions) {
    this.#vault = options.vault;
    this.#hasActiveBackupJob = options.hasActiveBackupJob;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  summary(): BackupConversationPreferenceSummary {
    const binding = this.#binding();
    return this.#summary(binding.vaultId, binding.bytes, binding.config);
  }

  update(input: BackupConversationPreferenceUpdateRequest): BackupConversationPreferenceUpdateResult {
    const request = BackupConversationPreferenceUpdateRequestSchema.parse(input);
    const binding = this.#binding();
    const identity = { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId };
    const replay = readReceipt(binding.vaultPath, request.requestId);
    if (replay) {
      if (replay.requestDigest !== digestRequest(request) || readOperation(binding.vaultPath, undoOperationId(replay.operationId))) {
        return BackupConversationPreferenceUpdateResultSchema.parse({ ...identity, status: "stale", summary: this.summary() });
      }
      completeForward(binding.vaultPath, replay, () => this.#vault.assertWriterLease(binding.vaultPath));
      return BackupConversationPreferenceUpdateResultSchema.parse({ ...identity, status: "updated", summary: this.summary() });
    }
    const current = this.#summary(binding.vaultId, binding.bytes, binding.config);
    if (request.activeVaultId !== binding.vaultId || request.expectedRevision !== current.revision) {
      return BackupConversationPreferenceUpdateResultSchema.parse({ ...identity, status: "stale", summary: current });
    }
    if (this.#hasActiveBackupJob()) {
      return BackupConversationPreferenceUpdateResultSchema.parse({ ...identity, status: "blocked", summary: { ...current, canUpdate: false } });
    }
    if (binding.config.backup.includeConversations === request.includeConversations) {
      return BackupConversationPreferenceUpdateResultSchema.parse({ ...identity, status: "updated", summary: current });
    }
    const afterConfig = VaultConfigSchema.parse({
      ...binding.config,
      backup: { ...binding.config.backup, includeConversations: request.includeConversations }
    });
    const createdAt = this.#now();
    const receipt = createReceipt(request, binding.bytes, binding.config, afterConfig, createdAt);
    persistReceipt(binding.vaultPath, receipt);
    this.#assertCurrent(binding, receipt.beforeHash);
    completeForward(binding.vaultPath, receipt, () => this.#vault.assertWriterLease(binding.vaultPath));
    return BackupConversationPreferenceUpdateResultSchema.parse({ ...identity, status: "updated", summary: this.summary() });
  }

  activitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    const vaultPath = this.#vault.activeVaultPath();
    if (!vaultPath || operation.kind !== "change_setting" || operation.targetRefs[0]?.id !== SETTING_ID) return undefined;
    const receipt = findReceipt(vaultPath, operation.id);
    if (!receipt || !matchesForward(receipt, operation)) return undefined;
    const undone = undo?.id === undoOperationId(operation.id);
    const current = configHash(vaultPath);
    const expected = undone ? receipt.beforeHash : receipt.afterHash;
    const canUndo = !undone && current === expected && !this.#hasActiveBackupJob();
    return {
      operationId: operation.id,
      kind: "change_setting",
      createdAt: operation.createdAt,
      targetLabel: "Conversation history backups",
      status: undone ? "undone" : "applied",
      canUndo,
      ...(undone
        ? { undoUnavailableReason: "already_undone" as const }
        : canUndo
          ? {}
          : { undoUnavailableReason: current === expected ? "revision_changed" as const : "content_changed" as const })
    };
  }

  findUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    return operations.find((candidate) => candidate.id === undoOperationId(operation.id));
  }

  undo(operation: OperationRecord): KnowledgeActivityUndoResult {
    const vaultPath = this.#vault.activeVaultPath();
    if (!vaultPath) return { status: "not_found", operationId: operation.id };
    const receipt = findReceipt(vaultPath, operation.id);
    if (!receipt || !matchesForward(receipt, operation)) return { status: "not_found", operationId: operation.id };
    const undoId = undoOperationId(operation.id);
    if (readOperation(vaultPath, undoId)) return { status: "already_undone", operationId: operation.id, undoOperationId: undoId };
    if (this.#hasActiveBackupJob() || configHash(vaultPath) !== receipt.afterHash) return { status: "stale", operationId: operation.id };
    writeUndoIntent(vaultPath, receipt.requestId);
    completeUndo(vaultPath, receipt, operation, () => this.#vault.assertWriterLease(vaultPath));
    return { status: "undone", operationId: operation.id, undoOperationId: undoId };
  }

  recoverIncompleteOperations(): { readonly recovered: number; readonly failed: number } {
    const vaultPath = this.#vault.activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0;
    let failed = 0;
    for (const receipt of listReceipts(vaultPath)) {
      try {
        const operation = readOperation(vaultPath, receipt.operationId);
        if (!operation) {
          completeForward(vaultPath, receipt, () => this.#vault.assertWriterLease(vaultPath));
          recovered += 1;
        } else if (!readOperation(vaultPath, undoOperationId(receipt.operationId)) && hasUndoIntent(vaultPath, receipt.requestId)) {
          completeUndo(vaultPath, receipt, operation, () => this.#vault.assertWriterLease(vaultPath));
          recovered += 1;
        }
      } catch {
        failed += 1;
      }
    }
    return { recovered, failed };
  }

  #binding(): { readonly vaultId: string; readonly vaultPath: string; readonly configPath: string; readonly bytes: Buffer; readonly config: VaultConfig } {
    const active = this.#vault.current();
    const vaultPath = this.#vault.activeVaultPath();
    if (!active || !vaultPath) throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    this.#vault.assertWriterLease(vaultPath);
    const configPath = path.join(vaultPath, ".pige", "config.json");
    return { vaultId: active.vaultId, vaultPath, configPath, bytes: readExact(configPath), config: readVaultConfig(vaultPath) };
  }

  #assertCurrent(binding: { readonly vaultId: string; readonly vaultPath: string; readonly configPath: string }, expectedHash: string): void {
    if (this.#vault.current()?.vaultId !== binding.vaultId || this.#vault.activeVaultPath() !== binding.vaultPath) throw stale();
    this.#vault.assertWriterLease(binding.vaultPath);
    if (hash(readExact(binding.configPath)) !== expectedHash) throw stale();
  }

  #summary(vaultId: string, bytes: Buffer, config: VaultConfig): BackupConversationPreferenceSummary {
    return BackupConversationPreferenceSummarySchema.parse({
      apiVersion: 1,
      activeVaultId: vaultId,
      revision: `backupconversationrev_${digest(bytes)}`,
      includeConversations: config.backup.includeConversations,
      canUpdate: !this.#hasActiveBackupJob()
    });
  }
}

export function includesConversationHistoryInBackup(vaultPath?: string): boolean {
  return vaultPath ? readVaultConfig(vaultPath).backup.includeConversations : true;
}

export function filterConversationBackupPaths(paths: readonly string[], includeConversations: boolean): readonly string[] {
  return includeConversations ? paths : paths.filter((relativePath) => !relativePath.startsWith(".pige/conversations/"));
}

function createReceipt(request: BackupConversationPreferenceUpdateRequest, beforeBytes: Buffer, beforeConfig: VaultConfig, afterConfig: VaultConfig, createdAt: string): PreferenceReceipt {
  const afterBytes = configBytes(afterConfig);
  return {
    schemaVersion: 1,
    kind: "backup_conversation_preference_receipt",
    requestId: request.requestId,
    requestDigest: digestRequest(request),
    activeVaultId: request.activeVaultId,
    beforeConfig,
    afterConfig,
    beforeBytes: beforeBytes.toString("base64"),
    afterBytes: afterBytes.toString("base64"),
    beforeHash: hash(beforeBytes),
    afterHash: hash(afterBytes),
    operationId: `op_${createdAt.slice(0, 10).replaceAll("-", "")}_${digest(Buffer.from(request.requestId)).slice(0, 48)}`,
    createdAt
  };
}

function completeForward(vaultPath: string, receipt: PreferenceReceipt, assertWriterLease: () => void): void {
  const existing = readOperation(vaultPath, receipt.operationId);
  if (existing) {
    if (!matchesForward(receipt, existing) || configHash(vaultPath) !== receipt.afterHash) throw conflict();
    return;
  }
  const currentHash = configHash(vaultPath);
  if (currentHash === receipt.beforeHash) atomicReplace(configPath(vaultPath), Buffer.from(receipt.afterBytes, "base64"), assertWriterLease);
  else if (currentHash !== receipt.afterHash) throw conflict();
  writeOperation(vaultPath, createForwardOperation(receipt));
}

function completeUndo(vaultPath: string, receipt: PreferenceReceipt, operation: OperationRecord, assertWriterLease: () => void): void {
  const undoId = undoOperationId(operation.id);
  if (readOperation(vaultPath, undoId)) {
    if (configHash(vaultPath) !== receipt.beforeHash) throw conflict();
    return;
  }
  const currentHash = configHash(vaultPath);
  if (currentHash === receipt.afterHash) atomicReplace(configPath(vaultPath), Buffer.from(receipt.beforeBytes, "base64"), assertWriterLease);
  else if (currentHash !== receipt.beforeHash) throw conflict();
  writeOperation(vaultPath, createUndoOperation(receipt, operation));
}

function createForwardOperation(receipt: PreferenceReceipt): OperationRecord {
  return OperationRecordSchema.parse({
    id: receipt.operationId,
    schemaVersion: 1,
    createdAt: receipt.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "change_setting",
    targetRefs: [{ kind: "setting", id: SETTING_ID }],
    sourceRefs: [],
    before: { kind: "setting", id: SETTING_ID, checksum: receipt.beforeHash },
    after: { kind: "setting", id: SETTING_ID, checksum: receipt.afterHash },
    summary: receipt.afterConfig.backup.includeConversations
      ? "Included conversation history in future backups."
      : "Excluded conversation history from future backups.",
    reversible: "yes",
    rollbackHint: "Undo this Activity or change the backup preference again in Settings.",
    warnings: []
  });
}

function createUndoOperation(receipt: PreferenceReceipt, operation: OperationRecord): OperationRecord {
  return OperationRecordSchema.parse({
    id: undoOperationId(operation.id),
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "change_setting",
    targetRefs: operation.targetRefs,
    sourceRefs: [{ kind: "operation", id: operation.id }],
    before: operation.after,
    after: { kind: "setting", id: SETTING_ID, checksum: receipt.beforeHash },
    summary: receipt.beforeConfig.backup.includeConversations
      ? "Restored conversation history inclusion in future backups."
      : "Restored conversation history exclusion from future backups.",
    reversible: "no",
    warnings: []
  });
}

function persistReceipt(vaultPath: string, receipt: PreferenceReceipt): void {
  writeExclusive(receiptPath(vaultPath, receipt.requestId), Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"));
}

function readReceipt(vaultPath: string, requestId: string): PreferenceReceipt | undefined {
  const file = receiptPath(vaultPath, requestId);
  if (!fs.existsSync(file)) return undefined;
  const value = JSON.parse(readExact(file, 128 * 1024).toString("utf8")) as Partial<PreferenceReceipt>;
  if (value.schemaVersion !== 1 || value.kind !== "backup_conversation_preference_receipt" || value.requestId !== requestId || typeof value.operationId !== "string" || typeof value.beforeBytes !== "string" || typeof value.afterBytes !== "string") throw conflict();
  const beforeBytes = Buffer.from(value.beforeBytes, "base64"), afterBytes = Buffer.from(value.afterBytes, "base64");
  const beforeConfig = VaultConfigSchema.parse(JSON.parse(beforeBytes.toString("utf8"))), afterConfig = VaultConfigSchema.parse(JSON.parse(afterBytes.toString("utf8")));
  if (hash(beforeBytes) !== value.beforeHash || hash(afterBytes) !== value.afterHash || JSON.stringify(beforeConfig) !== JSON.stringify(VaultConfigSchema.parse(value.beforeConfig)) || JSON.stringify(afterConfig) !== JSON.stringify(VaultConfigSchema.parse(value.afterConfig))) throw conflict();
  return { ...value, beforeConfig, afterConfig } as PreferenceReceipt;
}

function listReceipts(vaultPath: string): PreferenceReceipt[] {
  const root = path.join(vaultPath, RECEIPT_ROOT);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
    try { const receipt = readReceipt(vaultPath, entry.name); return receipt ? [receipt] : []; } catch { return []; }
  });
}

function findReceipt(vaultPath: string, operationId: string): PreferenceReceipt | undefined {
  return listReceipts(vaultPath).find((receipt) => receipt.operationId === operationId);
}

function matchesForward(receipt: PreferenceReceipt, operation: OperationRecord): boolean {
  return operation.id === receipt.operationId && operation.kind === "change_setting" && operation.targetRefs[0]?.id === SETTING_ID
    && operation.before?.checksum === receipt.beforeHash && operation.after?.checksum === receipt.afterHash;
}

function writeOperation(vaultPath: string, operation: OperationRecord): void {
  const file = operationPath(vaultPath, operation.id);
  const bytes = Buffer.from(`${JSON.stringify(operation, null, 2)}\n`, "utf8");
  if (fs.existsSync(file)) {
    if (!readExact(file, 256 * 1024).equals(bytes)) throw conflict();
    return;
  }
  writeExclusive(file, bytes);
}

function readOperation(vaultPath: string, operationId: string): OperationRecord | undefined {
  const file = operationPath(vaultPath, operationId);
  return fs.existsSync(file) ? OperationRecordSchema.parse(JSON.parse(readExact(file, 256 * 1024).toString("utf8"))) : undefined;
}

function operationPath(vaultPath: string, operationId: string): string {
  const match = /^op_(\d{4})(\d{2})\d{2}_[a-z0-9]+$/u.exec(operationId);
  if (!match) throw conflict();
  return path.join(vaultPath, ".pige", "operations", match[1]!, match[2]!, `${operationId}.json`);
}

function receiptPath(vaultPath: string, requestId: string): string {
  return path.join(vaultPath, RECEIPT_ROOT, requestId, "receipt.json");
}
function undoIntentPath(vaultPath: string, requestId: string): string {
  return path.join(vaultPath, RECEIPT_ROOT, requestId, "undo.json");
}
function writeUndoIntent(vaultPath: string, requestId: string): void {
  const file = undoIntentPath(vaultPath, requestId);
  if (!fs.existsSync(file)) writeExclusive(file, Buffer.from("{\"schemaVersion\":1,\"kind\":\"backup_conversation_preference_undo\"}\n", "utf8"));
}
function hasUndoIntent(vaultPath: string, requestId: string): boolean { return fs.existsSync(undoIntentPath(vaultPath, requestId)); }
function configPath(vaultPath: string): string { return path.join(vaultPath, ".pige", "config.json"); }
function configHash(vaultPath: string): string { return hash(readExact(configPath(vaultPath))); }
function configBytes(config: VaultConfig): Buffer { return Buffer.from(`${JSON.stringify(config, null, 2)}\n`, "utf8"); }
function hash(bytes: Buffer): string { return `sha256:${digest(bytes)}`; }
function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function digestRequest(request: BackupConversationPreferenceUpdateRequest): string { return hash(Buffer.from(JSON.stringify(request), "utf8")); }
function undoOperationId(operationId: string): string { return `${operationId}undo`; }

function atomicReplace(file: string, bytes: Buffer, assertWriterLease: () => void): void {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  assertWriterLease();
  fs.renameSync(temporary, file);
  flushDirectoryWhereSupported(path.dirname(file));
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

function conflict(): PigeDomainError {
  return new PigeDomainError("backup.conversation_preference_conflict", "The conversation backup preference changed unexpectedly.");
}
function stale(): PigeDomainError {
  return new PigeDomainError("backup.conversation_preference_stale", "The active vault or conversation backup preference changed.");
}
