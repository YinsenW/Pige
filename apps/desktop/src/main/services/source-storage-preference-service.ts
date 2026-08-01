import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  KnowledgeActivitySummary,
  KnowledgeActivityUndoResult,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  OperationRecordSchema,
  UpdateSourceStoragePolicyRequestSchema,
  UpdateSourceStoragePolicyResultSchema,
  VaultConfigSchema,
  type OperationRecord,
  type SourceStorageStrategy,
  type UpdateSourceStoragePolicyRequest,
  type UpdateSourceStoragePolicyResult,
  type VaultConfig
} from "@pige/schemas";
import { flushDirectoryWhereSupported } from "./durable-directory-sync";
import { readVaultConfig } from "./vault-layout";

const RECEIPT_ROOT = ".pige/source-storage-preference-receipts";
const SETTING_ID = "sourceStorage.defaultStrategy";

interface SourceStoragePreferenceVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
  assertWriterLease(vaultPath: string): void;
  applySourceStorageStrategy(strategy: SourceStorageStrategy): VaultSummary;
  refreshActiveVaultSummary(): VaultSummary;
}

interface PreferenceReceipt {
  readonly schemaVersion: 1;
  readonly kind: "source_storage_preference_receipt";
  readonly requestId: string;
  readonly requestDigest: string;
  readonly activeVaultId: string;
  readonly beforeBytes: string;
  readonly afterBytes: string;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly beforeStrategy: SourceStorageStrategy;
  readonly afterStrategy: SourceStorageStrategy;
  readonly operationId: string;
  readonly createdAt: string;
}

export class SourceStoragePreferenceService {
  readonly #vault: SourceStoragePreferenceVaultPort;
  readonly #now: () => string;

  constructor(vault: SourceStoragePreferenceVaultPort, now: () => string = () => new Date().toISOString()) {
    this.#vault = vault;
    this.#now = now;
  }

  update(input: UpdateSourceStoragePolicyRequest): UpdateSourceStoragePolicyResult {
    const request = UpdateSourceStoragePolicyRequestSchema.parse(input);
    const binding = this.#binding();
    const identity = requestIdentity(request);
    if (!binding || request.activeVaultId !== binding.vaultId) {
      return UpdateSourceStoragePolicyResultSchema.parse({ ...identity, status: "not_found" });
    }
    const replay = readReceipt(binding.vaultPath, request.requestId);
    if (replay) {
      if (replay.requestDigest !== digestRequest(request) || readOperation(binding.vaultPath, undoOperationId(replay.operationId))) {
        return UpdateSourceStoragePolicyResultSchema.parse({ ...identity, status: "stale", summary: this.#summary() });
      }
      completeForward(this.#vault, binding.vaultPath, replay);
      return UpdateSourceStoragePolicyResultSchema.parse({
        ...identity, status: "updated", operationId: replay.operationId, summary: this.#summary()
      });
    }
    const current = this.#summary();
    if (request.expectedRevision !== current.revision) {
      return UpdateSourceStoragePolicyResultSchema.parse({ ...identity, status: "stale", summary: current });
    }
    if (request.defaultStrategy === current.defaultStrategy) {
      return UpdateSourceStoragePolicyResultSchema.parse({
        ...identity, status: "current", summary: current
      });
    }
    const afterConfig = VaultConfigSchema.parse({
      ...binding.config,
      sourceStorage: { ...binding.config.sourceStorage, defaultStrategy: request.defaultStrategy }
    });
    const receipt = createReceipt(request, binding.bytes, afterConfig, this.#now());
    persistReceipt(binding.vaultPath, receipt);
    this.#assertCurrent(binding, receipt.beforeHash);
    completeForward(this.#vault, binding.vaultPath, receipt);
    return UpdateSourceStoragePolicyResultSchema.parse({
      ...identity, status: "updated", operationId: receipt.operationId, summary: this.#summary()
    });
  }

  activitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    const vaultPath = this.#vault.activeVaultPath();
    if (!vaultPath || operation.kind !== "change_setting" || operation.targetRefs[0]?.id !== SETTING_ID) return undefined;
    const receipt = findReceipt(vaultPath, operation.id);
    if (!receipt || !matchesForward(receipt, operation)) return undefined;
    const undone = undo?.id === undoOperationId(operation.id);
    const current = configHash(vaultPath);
    const expected = undone ? receipt.beforeHash : receipt.afterHash;
    const canUndo = !undone && current === expected;
    return {
      operationId: operation.id,
      kind: "change_setting",
      createdAt: operation.createdAt,
      targetLabel: "Source storage for new files",
      status: undone ? "undone" : "applied",
      canUndo,
      ...(undone
        ? { undoUnavailableReason: "already_undone" as const }
        : canUndo ? {} : { undoUnavailableReason: "content_changed" as const })
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
    if (configHash(vaultPath) !== receipt.afterHash) return { status: "stale", operationId: operation.id };
    writeUndoIntent(vaultPath, receipt.requestId);
    completeUndo(this.#vault, vaultPath, receipt, operation);
    return { status: "undone", operationId: operation.id, undoOperationId: undoId };
  }

  recoverIncompleteOperations(): { readonly recovered: number; readonly failed: number } {
    const vaultPath = this.#vault.activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0, failed = 0;
    for (const receipt of listReceipts(vaultPath)) {
      try {
        const operation = readOperation(vaultPath, receipt.operationId);
        if (!operation) {
          completeForward(this.#vault, vaultPath, receipt); recovered += 1;
        } else if (!readOperation(vaultPath, undoOperationId(receipt.operationId)) && hasUndoIntent(vaultPath, receipt.requestId)) {
          completeUndo(this.#vault, vaultPath, receipt, operation); recovered += 1;
        }
      } catch { failed += 1; }
    }
    return { recovered, failed };
  }

  #binding(): { readonly vaultId: string; readonly vaultPath: string; readonly bytes: Buffer; readonly config: VaultConfig } | undefined {
    const current = this.#vault.current(), vaultPath = this.#vault.activeVaultPath();
    if (!current || !vaultPath) return undefined;
    this.#vault.assertWriterLease(vaultPath);
    return { vaultId: current.vaultId, vaultPath, bytes: readExact(configPath(vaultPath)), config: readVaultConfig(vaultPath) };
  }

  #summary() {
    const current = this.#vault.current();
    if (!current) throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    return {
      activeVaultId: current.vaultId,
      revision: current.managedCopyRoot.sourceStorageRevision,
      defaultStrategy: current.defaultSourceStorageStrategy
    } as const;
  }

  #assertCurrent(binding: { readonly vaultId: string; readonly vaultPath: string }, expectedHash: string): void {
    if (this.#vault.current()?.vaultId !== binding.vaultId || this.#vault.activeVaultPath() !== binding.vaultPath) throw stale();
    this.#vault.assertWriterLease(binding.vaultPath);
    if (configHash(binding.vaultPath) !== expectedHash) throw stale();
  }
}

function completeForward(vault: SourceStoragePreferenceVaultPort, vaultPath: string, receipt: PreferenceReceipt): void {
  const existing = readOperation(vaultPath, receipt.operationId);
  if (existing) {
    if (!matchesForward(receipt, existing) || configHash(vaultPath) !== receipt.afterHash) throw conflict();
    vault.refreshActiveVaultSummary();
    return;
  }
  const current = configHash(vaultPath);
  if (current === receipt.beforeHash) {
    vault.applySourceStorageStrategy(receipt.afterStrategy);
    if (configHash(vaultPath) !== receipt.afterHash) throw conflict();
  } else if (current === receipt.afterHash) vault.refreshActiveVaultSummary();
  else throw conflict();
  writeOperation(vaultPath, createForwardOperation(receipt));
}

function completeUndo(vault: SourceStoragePreferenceVaultPort, vaultPath: string, receipt: PreferenceReceipt, operation: OperationRecord): void {
  const undoId = undoOperationId(operation.id);
  if (readOperation(vaultPath, undoId)) {
    if (configHash(vaultPath) !== receipt.beforeHash) throw conflict();
    vault.refreshActiveVaultSummary();
    return;
  }
  const current = configHash(vaultPath);
  if (current === receipt.afterHash) {
    vault.applySourceStorageStrategy(receipt.beforeStrategy);
    if (configHash(vaultPath) !== receipt.beforeHash) throw conflict();
  } else if (current === receipt.beforeHash) vault.refreshActiveVaultSummary();
  else throw conflict();
  writeOperation(vaultPath, createUndoOperation(receipt, operation));
}

function createReceipt(request: UpdateSourceStoragePolicyRequest, beforeBytes: Buffer, afterConfig: VaultConfig, createdAt: string): PreferenceReceipt {
  const afterBytes = configBytes(afterConfig);
  return {
    schemaVersion: 1, kind: "source_storage_preference_receipt", requestId: request.requestId,
    requestDigest: digestRequest(request), activeVaultId: request.activeVaultId,
    beforeBytes: beforeBytes.toString("base64"), afterBytes: afterBytes.toString("base64"),
    beforeHash: hash(beforeBytes), afterHash: hash(afterBytes),
    beforeStrategy: VaultConfigSchema.parse(JSON.parse(beforeBytes.toString("utf8"))).sourceStorage.defaultStrategy,
    afterStrategy: afterConfig.sourceStorage.defaultStrategy,
    operationId: operationId(createdAt, request.requestId), createdAt
  };
}

function createForwardOperation(receipt: PreferenceReceipt): OperationRecord {
  return OperationRecordSchema.parse({
    id: receipt.operationId, schemaVersion: 1, createdAt: receipt.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "change_setting", targetRefs: [{ kind: "setting", id: SETTING_ID }], sourceRefs: [],
    before: { kind: "setting", id: SETTING_ID, checksum: receipt.beforeHash },
    after: { kind: "setting", id: SETTING_ID, checksum: receipt.afterHash },
    summary: receipt.afterStrategy === "copy_to_source_library"
      ? "Copied newly added files into Pige source storage by default."
      : "Referenced original files in place by default.",
    reversible: "yes", rollbackHint: "Undo this Activity or change the source storage preference again in Settings.", warnings: []
  });
}

function createUndoOperation(receipt: PreferenceReceipt, operation: OperationRecord): OperationRecord {
  return OperationRecordSchema.parse({
    id: undoOperationId(operation.id), schemaVersion: 1, createdAt: new Date().toISOString(),
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "change_setting", targetRefs: operation.targetRefs,
    sourceRefs: [{ kind: "operation", id: operation.id }], before: operation.after,
    after: { kind: "setting", id: SETTING_ID, checksum: receipt.beforeHash },
    summary: "Restored the previous source storage preference.", reversible: "no", warnings: []
  });
}

function persistReceipt(vaultPath: string, receipt: PreferenceReceipt): void {
  writeExclusive(receiptPath(vaultPath, receipt.requestId), Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"));
}
function readReceipt(vaultPath: string, requestId: string): PreferenceReceipt | undefined {
  const file = receiptPath(vaultPath, requestId); if (!fs.existsSync(file)) return undefined;
  const value = JSON.parse(readExact(file).toString("utf8")) as Partial<PreferenceReceipt>;
  if (value.schemaVersion !== 1 || value.kind !== "source_storage_preference_receipt" || value.requestId !== requestId ||
    typeof value.beforeBytes !== "string" || typeof value.afterBytes !== "string" || typeof value.operationId !== "string") throw conflict();
  const before = Buffer.from(value.beforeBytes, "base64"), after = Buffer.from(value.afterBytes, "base64");
  const beforeConfig = VaultConfigSchema.parse(JSON.parse(before.toString("utf8")));
  const afterConfig = VaultConfigSchema.parse(JSON.parse(after.toString("utf8")));
  if (hash(before) !== value.beforeHash || hash(after) !== value.afterHash || beforeConfig.sourceStorage.defaultStrategy !== value.beforeStrategy ||
    afterConfig.sourceStorage.defaultStrategy !== value.afterStrategy) throw conflict();
  return value as PreferenceReceipt;
}
function listReceipts(vaultPath: string): PreferenceReceipt[] {
  const root = path.join(vaultPath, RECEIPT_ROOT); if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
    try { const receipt = readReceipt(vaultPath, entry.name); return receipt ? [receipt] : []; } catch { return []; }
  });
}
function findReceipt(vaultPath: string, operationIdValue: string): PreferenceReceipt | undefined {
  return listReceipts(vaultPath).find((receipt) => receipt.operationId === operationIdValue);
}
function matchesForward(receipt: PreferenceReceipt, operation: OperationRecord): boolean {
  return operation.id === receipt.operationId && operation.kind === "change_setting" && operation.targetRefs[0]?.id === SETTING_ID &&
    operation.before?.checksum === receipt.beforeHash && operation.after?.checksum === receipt.afterHash;
}
function writeOperation(vaultPath: string, operation: OperationRecord): void {
  const file = operationPath(vaultPath, operation.id), bytes = Buffer.from(`${JSON.stringify(operation, null, 2)}\n`, "utf8");
  if (fs.existsSync(file)) { if (!readExact(file, 256 * 1024).equals(bytes)) throw conflict(); return; }
  writeExclusive(file, bytes);
}
function readOperation(vaultPath: string, operationIdValue: string): OperationRecord | undefined {
  const file = operationPath(vaultPath, operationIdValue);
  return fs.existsSync(file) ? OperationRecordSchema.parse(JSON.parse(readExact(file, 256 * 1024).toString("utf8"))) : undefined;
}
function operationPath(vaultPath: string, operationIdValue: string): string {
  const match = /^op_(\d{4})(\d{2})\d{2}_[a-z0-9]+$/u.exec(operationIdValue); if (!match) throw conflict();
  return path.join(vaultPath, ".pige", "operations", match[1]!, match[2]!, `${operationIdValue}.json`);
}
function receiptPath(vaultPath: string, requestId: string): string { return path.join(vaultPath, RECEIPT_ROOT, requestId, "receipt.json"); }
function undoIntentPath(vaultPath: string, requestId: string): string { return path.join(vaultPath, RECEIPT_ROOT, requestId, "undo.json"); }
function writeUndoIntent(vaultPath: string, requestId: string): void {
  const file = undoIntentPath(vaultPath, requestId);
  if (!fs.existsSync(file)) writeExclusive(file, Buffer.from('{"schemaVersion":1,"kind":"source_storage_preference_undo"}\n', "utf8"));
}
function hasUndoIntent(vaultPath: string, requestId: string): boolean { return fs.existsSync(undoIntentPath(vaultPath, requestId)); }
function configPath(vaultPath: string): string { return path.join(vaultPath, ".pige", "config.json"); }
function configHash(vaultPath: string): string { return hash(readExact(configPath(vaultPath))); }
function configBytes(config: VaultConfig): Buffer { return Buffer.from(`${JSON.stringify(config, null, 2)}\n`, "utf8"); }
function operationId(createdAt: string, requestId: string): string { return `op_${createdAt.slice(0, 10).replaceAll("-", "")}_${digest(Buffer.from(requestId)).slice(0, 48)}`; }
function undoOperationId(operationIdValue: string): string { return `${operationIdValue}undo`; }
function requestIdentity(request: UpdateSourceStoragePolicyRequest) {
  return { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId,
    expectedRevision: request.expectedRevision, defaultStrategy: request.defaultStrategy };
}
function digestRequest(request: UpdateSourceStoragePolicyRequest): string { return hash(Buffer.from(JSON.stringify(request), "utf8")); }
function hash(bytes: Buffer): string { return `sha256:${digest(bytes)}`; }
function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function writeExclusive(file: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  flushDirectoryWhereSupported(path.dirname(file));
}
function readExact(file: string, maximum = 128 * 1024): Buffer {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink < 1 || stat.size > maximum) throw conflict();
  return fs.readFileSync(file);
}
function conflict(): PigeDomainError { return new PigeDomainError("source_storage.preference_conflict", "The source storage preference changed unexpectedly."); }
function stale(): PigeDomainError { return new PigeDomainError("source_storage.preference_stale", "The active vault or source storage preference changed."); }
