import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  KnowledgeActivityRedoRequest,
  KnowledgeActivityRedoResult,
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
  readonly redoOfOperationId?: string;
  readonly undoOperationId?: string;
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
    const undone = !!undo && matchesUndo(operation, undo);
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
    return operations.find((candidate) => matchesUndo(operation, candidate));
  }

  undo(operation: OperationRecord): KnowledgeActivityUndoResult {
    const vaultPath = this.#vault.activeVaultPath();
    if (!vaultPath) return { status: "not_found", operationId: operation.id };
    const receipt = findReceipt(vaultPath, operation.id);
    if (!receipt || !matchesForward(receipt, operation)) return { status: "not_found", operationId: operation.id };
    const undoId = undoOperationId(operation.id);
    const existing = readOperation(vaultPath, undoId);
    if (existing) return matchesUndo(operation, existing)
      ? { status: "already_undone", operationId: operation.id, undoOperationId: undoId }
      : { status: "stale", operationId: operation.id };
    if (configHash(vaultPath) !== receipt.afterHash) return { status: "stale", operationId: operation.id };
    writeUndoIntent(vaultPath, receipt.requestId);
    completeUndo(this.#vault, vaultPath, receipt, operation);
    return { status: "undone", operationId: operation.id, undoOperationId: undoId };
  }

  activityState(
    operation: OperationRecord,
    undo: OperationRecord | undefined
  ): Pick<KnowledgeActivitySummary, "canRedo" | "redoUnavailableReason"> | undefined {
    const vaultPath = this.#vault.activeVaultPath();
    if (!vaultPath || !undo || operation.kind !== "change_setting" || operation.targetRefs[0]?.id !== SETTING_ID) return undefined;
    const receipt = findReceipt(vaultPath, operation.id);
    if (!receipt || !matchesForward(receipt, operation) || !matchesUndo(operation, undo)) return undefined;
    try {
      const child = findRedoReceipt(vaultPath, operation.id);
      if (child) {
        if (!matchesRedoReceipt(child, receipt, undo)) return { canRedo: false, redoUnavailableReason: "content_changed" };
        const redo = readOperation(vaultPath, child.operationId);
        return redo && matchesForward(child, redo) && configHash(vaultPath) === child.afterHash
          ? { canRedo: false, redoUnavailableReason: "already_redone" }
          : { canRedo: false, redoUnavailableReason: "content_changed" };
      }
      return configHash(vaultPath) === receipt.beforeHash
        ? { canRedo: true }
        : { canRedo: false, redoUnavailableReason: "content_changed" };
    } catch {
      return { canRedo: false, redoUnavailableReason: "content_changed" };
    }
  }

  redo(request: KnowledgeActivityRedoRequest): KnowledgeActivityRedoResult {
    if (!request || typeof request !== "object" || !OPERATION_ID.test(request.operationId)) {
      throw new PigeDomainError("activity.invalid_operation_id", "The Activity operation identity is invalid.");
    }
    const vaultPath = this.#vault.activeVaultPath();
    if (!vaultPath) return { status: "not_found", operationId: request.operationId };
    try {
      const operation = readOperation(vaultPath, request.operationId);
      const receipt = operation && findReceipt(vaultPath, operation.id);
      if (!operation || !receipt || !matchesForward(receipt, operation)) {
        return { status: "not_found", operationId: request.operationId };
      }
      const undo = readOperation(vaultPath, undoOperationId(operation.id));
      if (!undo || !matchesUndo(operation, undo)) return { status: "not_found", operationId: operation.id };
      const currentRevisionId = configHash(vaultPath);
      if (request.expectedRevisionId !== undefined && request.expectedRevisionId !== receipt.beforeHash) {
        return { status: "stale", operationId: operation.id, currentRevisionId };
      }
      const existing = findRedoReceipt(vaultPath, operation.id);
      if (existing && !matchesRedoReceipt(existing, receipt, undo)) {
        return { status: "stale", operationId: operation.id, currentRevisionId };
      }
      const redoReceipt = existing ?? createRedoReceipt(receipt, undo, this.#now());
      const redo = readOperation(vaultPath, redoReceipt.operationId);
      if (redo) {
        if (!matchesForward(redoReceipt, redo) || configHash(vaultPath) !== redoReceipt.afterHash) {
          return { status: "stale", operationId: operation.id, currentRevisionId: configHash(vaultPath) };
        }
        return { status: "already_redone", operationId: operation.id, undoOperationId: undo.id,
          redoOperationId: redo.id, revisionId: redoReceipt.afterHash };
      }
      const currentHash = configHash(vaultPath);
      if ((!existing && currentHash !== receipt.beforeHash) ||
        (existing && currentHash !== receipt.beforeHash && currentHash !== receipt.afterHash)) {
        return { status: "stale", operationId: operation.id, currentRevisionId: configHash(vaultPath) };
      }
      if (!existing) persistReceipt(vaultPath, redoReceipt);
      completeForward(this.#vault, vaultPath, redoReceipt);
      return { status: "redone", operationId: operation.id, undoOperationId: undo.id,
        redoOperationId: redoReceipt.operationId, revisionId: redoReceipt.afterHash };
    } catch {
      return { status: "stale", operationId: request.operationId };
    }
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
    kind: "change_setting", targetRefs: [{ kind: "setting", id: SETTING_ID }],
    sourceRefs: receipt.redoOfOperationId && receipt.undoOperationId
      ? [{ kind: "operation", id: receipt.redoOfOperationId }, { kind: "operation", id: receipt.undoOperationId }]
      : [],
    before: { kind: "setting", id: SETTING_ID, checksum: receipt.beforeHash },
    after: { kind: "setting", id: SETTING_ID, checksum: receipt.afterHash },
    summary: receipt.redoOfOperationId
      ? "Reapplied the source storage preference for new files."
      : receipt.afterStrategy === "copy_to_source_library"
        ? "Copied newly added files into Pige source storage by default."
        : "Referenced original files in place by default.",
    reversible: "yes", rollbackHint: "Undo this Activity or change the source storage preference again in Settings.", warnings: []
  });
}

function createRedoReceipt(parent: PreferenceReceipt, undo: OperationRecord, createdAt: string): PreferenceReceipt {
  const requestId = `sourcepolicyredoreq_${digest(Buffer.from(`redo\0${parent.operationId}`, "utf8")).slice(0, 32)}`;
  return {
    ...parent,
    requestId,
    requestDigest: hash(Buffer.from(`${parent.operationId}\0${undo.id}\0${parent.beforeHash}\0${parent.afterHash}`, "utf8")),
    operationId: redoOperationId(parent.operationId),
    createdAt,
    redoOfOperationId: parent.operationId,
    undoOperationId: undo.id
  };
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
  if ((typeof value.redoOfOperationId === "string") !== (typeof value.undoOperationId === "string") ||
    (value.redoOfOperationId !== undefined && (!OPERATION_ID.test(value.redoOfOperationId) || !OPERATION_ID.test(value.undoOperationId!)))) throw conflict();
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
function findRedoReceipt(vaultPath: string, operationIdValue: string): PreferenceReceipt | undefined {
  const matches = listReceipts(vaultPath).filter((receipt) => receipt.redoOfOperationId === operationIdValue);
  if (matches.length > 1) throw conflict();
  return matches[0];
}
function matchesForward(receipt: PreferenceReceipt, operation: OperationRecord): boolean {
  return operation.id === receipt.operationId && operation.kind === "change_setting" && operation.targetRefs.length === 1 &&
    operation.targetRefs[0]?.id === SETTING_ID &&
    operation.before?.checksum === receipt.beforeHash && operation.after?.checksum === receipt.afterHash &&
    (receipt.redoOfOperationId && receipt.undoOperationId
      ? operation.sourceRefs.length === 2 &&
        operation.sourceRefs.some((reference) => reference.kind === "operation" && reference.id === receipt.redoOfOperationId) &&
        operation.sourceRefs.some((reference) => reference.kind === "operation" && reference.id === receipt.undoOperationId)
      : operation.sourceRefs.length === 0);
}
function matchesUndo(operation: OperationRecord, undo: OperationRecord): boolean {
  return undo.id === undoOperationId(operation.id) && undo.kind === "change_setting" &&
    undo.sourceRefs.length === 1 && undo.sourceRefs.some((reference) => reference.kind === "operation" && reference.id === operation.id) &&
    undo.before?.checksum === operation.after?.checksum && undo.after?.checksum === operation.before?.checksum;
}
function matchesRedoReceipt(child: PreferenceReceipt, parent: PreferenceReceipt, undo: OperationRecord): boolean {
  return child.redoOfOperationId === parent.operationId && child.undoOperationId === undo.id &&
    child.operationId === redoOperationId(parent.operationId) && child.activeVaultId === parent.activeVaultId &&
    child.beforeHash === parent.beforeHash && child.afterHash === parent.afterHash &&
    child.beforeStrategy === parent.beforeStrategy && child.afterStrategy === parent.afterStrategy &&
    child.requestId === `sourcepolicyredoreq_${digest(Buffer.from(`redo\0${parent.operationId}`, "utf8")).slice(0, 32)}` &&
    child.requestDigest === hash(Buffer.from(`${parent.operationId}\0${undo.id}\0${parent.beforeHash}\0${parent.afterHash}`, "utf8"));
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
function redoOperationId(operationIdValue: string): string {
  const date = /^op_(\d{8})_/u.exec(operationIdValue)?.[1];
  if (!date) throw conflict();
  return `op_${date}_${digest(Buffer.from(`pige.source-storage-preference.redo.v1\0${operationIdValue}`, "utf8")).slice(0, 48)}`;
}
const OPERATION_ID = /^op_\d{8}_[a-z0-9]{8,}$/u;
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
