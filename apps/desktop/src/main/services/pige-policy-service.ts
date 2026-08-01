import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { KnowledgeActivitySummary, KnowledgeActivityUndoResult, VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  OperationRecordSchema,
  PigePolicySummarySchema,
  PigePolicyUpdateRequestSchema,
  PigePolicyUpdateResultSchema,
  type OperationRecord,
  type PigePolicySummary,
  type PigePolicyRevision,
  type PigePolicyUpdateRequest,
  type PigePolicyUpdateResult,
  type PigePolicyValidationIssue
} from "@pige/schemas";
import { flushDirectoryWhereSupported } from "./durable-directory-sync";

const POLICY_FILE = "PIGE.md";
const RECEIPT_ROOT = ".pige/pige-policy-receipts";
const SETTING_ID = "vault.pigePolicy";
const MAX_POLICY_BYTES = 65_536;
export const PIGE_POLICY_REQUIRED_SECTIONS = [
  "Vault Identity",
  "Page Types",
  "Naming Rules",
  "Frontmatter Rules",
  "Link Rules",
  "Source Handling Rules",
  "Agent Review Rules",
  "Prompt Injection Rules"
] as const;

interface PigePolicyVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
  assertWriterLease(vaultPath: string): void;
}

interface PolicyReceipt {
  readonly schemaVersion: 1;
  readonly kind: "pige_policy_receipt";
  readonly requestId: string;
  readonly requestDigest: string;
  readonly activeVaultId: string;
  readonly beforeBytes: string;
  readonly afterBytes: string;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly operationId: string;
  readonly createdAt: string;
}

export interface PigePolicyPreparedUpdate {
  readonly status: "ready";
  readonly request: PigePolicyUpdateRequest;
  readonly vaultPath: string;
  readonly beforeBytes: Buffer;
  readonly afterBytes: Buffer;
}

export type PigePolicyPrepareResult = PigePolicyPreparedUpdate | PigePolicyUpdateResult;

export interface AgentPigePolicySnapshot {
  readonly revision: PigePolicyRevision;
  readonly markdown: string;
}

export class PigePolicyService {
  readonly #vault: PigePolicyVaultPort;
  readonly #now: () => string;

  constructor(vault: PigePolicyVaultPort, now: () => string = () => new Date().toISOString()) {
    this.#vault = vault;
    this.#now = now;
  }

  summary(): PigePolicySummary {
    const binding = this.#binding();
    return summary(binding.vaultId, binding.bytes);
  }

  prepare(input: PigePolicyUpdateRequest): PigePolicyPrepareResult {
    const request = PigePolicyUpdateRequestSchema.parse(input);
    const identity = requestIdentity(request);
    const binding = this.#binding();
    const current = summary(binding.vaultId, binding.bytes);
    const replay = readReceipt(binding.vaultPath, request.requestId);
    if (replay) {
      if (
        replay.requestDigest !== digestRequest(request) ||
        readOperation(binding.vaultPath, undoOperationId(replay.operationId))
      ) return PigePolicyUpdateResultSchema.parse({ ...identity, status: "stale", summary: current });
      completeForward(binding.vaultPath, replay, () => this.#vault.assertWriterLease(binding.vaultPath));
      return PigePolicyUpdateResultSchema.parse({
        ...identity,
        status: "updated",
        summary: this.summary(),
        operationId: replay.operationId
      });
    }
    if (request.activeVaultId !== binding.vaultId || request.expectedRevision !== current.revision) {
      return PigePolicyUpdateResultSchema.parse({ ...identity, status: "stale", summary: current });
    }
    const afterBytes = canonicalPolicyBytes(request.markdown);
    const issues = validatePolicy(afterBytes.toString("utf8"));
    if (issues.length > 0) {
      return PigePolicyUpdateResultSchema.parse({ ...identity, status: "invalid", summary: current, issues });
    }
    if (afterBytes.equals(binding.bytes)) {
      return PigePolicyUpdateResultSchema.parse({ ...identity, status: "updated", summary: current });
    }
    return { status: "ready", request, vaultPath: binding.vaultPath, beforeBytes: binding.bytes, afterBytes };
  }

  commit(prepared: PigePolicyPreparedUpdate): PigePolicyUpdateResult {
    const identity = requestIdentity(prepared.request);
    try {
      const binding = this.#binding();
      if (binding.vaultId !== prepared.request.activeVaultId || binding.vaultPath !== prepared.vaultPath) {
        return PigePolicyUpdateResultSchema.parse({ ...identity, status: "stale", summary: summary(binding.vaultId, binding.bytes) });
      }
      const current = summary(binding.vaultId, binding.bytes);
      if (current.revision !== prepared.request.expectedRevision || !binding.bytes.equals(prepared.beforeBytes)) {
        return PigePolicyUpdateResultSchema.parse({ ...identity, status: "stale", summary: current });
      }
      const receipt = createReceipt(prepared.request, prepared.beforeBytes, prepared.afterBytes, this.#now());
      persistReceipt(binding.vaultPath, receipt);
      completeForward(binding.vaultPath, receipt, () => this.#vault.assertWriterLease(binding.vaultPath));
      return PigePolicyUpdateResultSchema.parse({
        ...identity,
        status: "updated",
        summary: this.summary(),
        operationId: receipt.operationId
      });
    } catch {
      return PigePolicyUpdateResultSchema.parse({ ...identity, status: "failed" });
    }
  }

  denied(request: PigePolicyUpdateRequest): PigePolicyUpdateResult {
    return PigePolicyUpdateResultSchema.parse({ ...requestIdentity(request), status: "denied", summary: this.summary() });
  }

  failed(request: PigePolicyUpdateRequest): PigePolicyUpdateResult {
    return PigePolicyUpdateResultSchema.parse({ ...requestIdentity(request), status: "failed" });
  }

  activitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    const vaultPath = this.#vault.activeVaultPath();
    if (!vaultPath || operation.kind !== "change_setting" || operation.targetRefs[0]?.id !== SETTING_ID) return undefined;
    const receipt = findReceipt(vaultPath, operation.id);
    if (!receipt || !matchesForward(receipt, operation)) return undefined;
    const undone = undo?.id === undoOperationId(operation.id);
    const current = policyHash(vaultPath);
    const expected = undone ? receipt.beforeHash : receipt.afterHash;
    const canUndo = !undone && current === expected;
    return {
      operationId: operation.id,
      kind: "change_setting",
      createdAt: operation.createdAt,
      targetLabel: "PIGE.md policy",
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
    if (policyHash(vaultPath) !== receipt.afterHash) return { status: "stale", operationId: operation.id };
    writeUndoIntent(vaultPath, receipt.requestId);
    completeUndo(vaultPath, receipt, operation, () => this.#vault.assertWriterLease(vaultPath));
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
          completeForward(vaultPath, receipt, () => this.#vault.assertWriterLease(vaultPath));
          recovered += 1;
        } else if (!readOperation(vaultPath, undoOperationId(receipt.operationId)) && hasUndoIntent(vaultPath, receipt.requestId)) {
          completeUndo(vaultPath, receipt, operation, () => this.#vault.assertWriterLease(vaultPath));
          recovered += 1;
        }
      } catch { failed += 1; }
    }
    return { recovered, failed };
  }

  #binding(): { readonly vaultId: string; readonly vaultPath: string; readonly bytes: Buffer } {
    const active = this.#vault.current();
    const vaultPath = this.#vault.activeVaultPath();
    if (!active || !vaultPath) throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    this.#vault.assertWriterLease(vaultPath);
    return { vaultId: active.vaultId, vaultPath, bytes: readExact(policyPath(vaultPath), MAX_POLICY_BYTES) };
  }
}

export function validatePolicy(markdown: string): readonly PigePolicyValidationIssue[] {
  const issues = new Set<PigePolicyValidationIssue>();
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  if (lines[0]?.trim() !== "# PIGE" || lines.some((line, index) => index > 0 && /^#\s+/u.test(line))) {
    issues.add("invalid_heading_structure");
  }
  const headings = lines.filter((line) => /^##\s+/u.test(line)).map((line) => line.replace(/^##\s+/u, "").trim());
  let previous = -1;
  for (const section of PIGE_POLICY_REQUIRED_SECTIONS) {
    const matches = headings.reduce<number[]>((result, heading, index) => heading === section ? [...result, index] : result, []);
    if (matches.length === 0) issues.add("missing_required_section");
    if (matches.length > 1) issues.add("duplicate_required_section");
    if (matches[0] !== undefined && matches[0] <= previous) issues.add("invalid_heading_structure");
    if (matches[0] !== undefined) previous = matches[0];
  }
  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
    /\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b/u,
    /\b(?:api[_ -]?key|access[_ -]?token|client[_ -]?secret)\s*[:=]\s*[^\s<>{}]{8,}/iu,
    /\bAuthorization\s*:\s*Bearer\s+\S+/iu
  ];
  if (secretPatterns.some((pattern) => pattern.test(markdown))) issues.add("secret_like_content");
  return [...issues];
}

export function readPigePolicyForAgent(vaultPath: string): AgentPigePolicySnapshot {
  try {
    const bytes = readExact(policyPath(vaultPath), MAX_POLICY_BYTES);
    const markdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (validatePolicy(markdown).length > 0) throw conflict();
    return { revision: `pigepolicyrev_${digest(bytes)}`, markdown };
  } catch {
    throw new PigeDomainError(
      "agent_runtime.policy_invalid",
      "The active Vault PIGE.md policy is unavailable or invalid."
    );
  }
}

function canonicalPolicyBytes(markdown: string): Buffer {
  const normalized = markdown.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/\n*$/u, "\n");
  return Buffer.from(normalized, "utf8");
}

function summary(vaultId: string, bytes: Buffer): PigePolicySummary {
  return PigePolicySummarySchema.parse({
    apiVersion: 1,
    activeVaultId: vaultId,
    revision: `pigepolicyrev_${digest(bytes)}`,
    markdown: bytes.toString("utf8"),
    requiredSections: PIGE_POLICY_REQUIRED_SECTIONS,
    canEdit: true
  });
}

function requestIdentity(request: PigePolicyUpdateRequest) {
  return { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId };
}

function createReceipt(request: PigePolicyUpdateRequest, beforeBytes: Buffer, afterBytes: Buffer, createdAt: string): PolicyReceipt {
  return {
    schemaVersion: 1,
    kind: "pige_policy_receipt",
    requestId: request.requestId,
    requestDigest: digestRequest(request),
    activeVaultId: request.activeVaultId,
    beforeBytes: beforeBytes.toString("base64"),
    afterBytes: afterBytes.toString("base64"),
    beforeHash: hash(beforeBytes),
    afterHash: hash(afterBytes),
    operationId: `op_${createdAt.slice(0, 10).replaceAll("-", "")}_${digest(Buffer.from(request.requestId)).slice(0, 48)}`,
    createdAt
  };
}

function completeForward(vaultPath: string, receipt: PolicyReceipt, assertWriterLease: () => void): void {
  const existing = readOperation(vaultPath, receipt.operationId);
  if (existing) {
    if (!matchesForward(receipt, existing) || policyHash(vaultPath) !== receipt.afterHash) throw conflict();
    return;
  }
  const current = policyHash(vaultPath);
  if (current === receipt.beforeHash) atomicReplace(policyPath(vaultPath), Buffer.from(receipt.afterBytes, "base64"), assertWriterLease);
  else if (current !== receipt.afterHash) throw conflict();
  writeOperation(vaultPath, createForwardOperation(receipt));
}

function completeUndo(vaultPath: string, receipt: PolicyReceipt, operation: OperationRecord, assertWriterLease: () => void): void {
  const undoId = undoOperationId(operation.id);
  if (readOperation(vaultPath, undoId)) {
    if (policyHash(vaultPath) !== receipt.beforeHash) throw conflict();
    return;
  }
  const current = policyHash(vaultPath);
  if (current === receipt.afterHash) atomicReplace(policyPath(vaultPath), Buffer.from(receipt.beforeBytes, "base64"), assertWriterLease);
  else if (current !== receipt.beforeHash) throw conflict();
  writeOperation(vaultPath, createUndoOperation(receipt, operation));
}

function createForwardOperation(receipt: PolicyReceipt): OperationRecord {
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
    summary: "Updated the Vault PIGE.md policy.",
    reversible: "yes",
    rollbackHint: "Undo this Activity or edit PIGE.md again in Settings.",
    warnings: []
  });
}

function createUndoOperation(receipt: PolicyReceipt, operation: OperationRecord): OperationRecord {
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
    summary: "Restored the previous Vault PIGE.md policy.",
    reversible: "no",
    warnings: []
  });
}

function persistReceipt(vaultPath: string, receipt: PolicyReceipt): void {
  const file = receiptPath(vaultPath, receipt.requestId);
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  if (fs.existsSync(file)) {
    if (!readExact(file, 256 * 1024).equals(bytes)) throw conflict();
    return;
  }
  writeExclusive(file, bytes);
}

function readReceipt(vaultPath: string, requestId: string): PolicyReceipt | undefined {
  const file = receiptPath(vaultPath, requestId);
  if (!fs.existsSync(file)) return undefined;
  const value = JSON.parse(readExact(file, 256 * 1024).toString("utf8")) as Partial<PolicyReceipt>;
  if (value.schemaVersion !== 1 || value.kind !== "pige_policy_receipt" || value.requestId !== requestId ||
      typeof value.requestDigest !== "string" || typeof value.activeVaultId !== "string" ||
      typeof value.beforeBytes !== "string" || typeof value.afterBytes !== "string" ||
      typeof value.beforeHash !== "string" || typeof value.afterHash !== "string" ||
      typeof value.operationId !== "string" || typeof value.createdAt !== "string") throw conflict();
  const before = Buffer.from(value.beforeBytes, "base64"), after = Buffer.from(value.afterBytes, "base64");
  if (hash(before) !== value.beforeHash || hash(after) !== value.afterHash || validatePolicy(after.toString("utf8")).length > 0) throw conflict();
  return value as PolicyReceipt;
}

function listReceipts(vaultPath: string): PolicyReceipt[] {
  const root = path.join(vaultPath, RECEIPT_ROOT);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
    try { const receipt = readReceipt(vaultPath, entry.name); return receipt ? [receipt] : []; } catch { return []; }
  });
}

function findReceipt(vaultPath: string, operationId: string): PolicyReceipt | undefined {
  return listReceipts(vaultPath).find((receipt) => receipt.operationId === operationId);
}

function matchesForward(receipt: PolicyReceipt, operation: OperationRecord): boolean {
  return operation.id === receipt.operationId && operation.kind === "change_setting" && operation.targetRefs[0]?.id === SETTING_ID &&
    operation.before?.checksum === receipt.beforeHash && operation.after?.checksum === receipt.afterHash;
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

function policyPath(vaultPath: string): string { return path.join(vaultPath, POLICY_FILE); }
function receiptPath(vaultPath: string, requestId: string): string { return path.join(vaultPath, RECEIPT_ROOT, requestId, "receipt.json"); }
function undoIntentPath(vaultPath: string, requestId: string): string { return path.join(vaultPath, RECEIPT_ROOT, requestId, "undo.json"); }
function writeUndoIntent(vaultPath: string, requestId: string): void {
  const file = undoIntentPath(vaultPath, requestId);
  if (!fs.existsSync(file)) writeExclusive(file, Buffer.from('{"schemaVersion":1,"kind":"pige_policy_undo"}\n', "utf8"));
}
function hasUndoIntent(vaultPath: string, requestId: string): boolean { return fs.existsSync(undoIntentPath(vaultPath, requestId)); }
function policyHash(vaultPath: string): string { return hash(readExact(policyPath(vaultPath), MAX_POLICY_BYTES)); }
function hash(bytes: Buffer): string { return `sha256:${digest(bytes)}`; }
function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function digestRequest(request: PigePolicyUpdateRequest): string { return hash(Buffer.from(JSON.stringify(request), "utf8")); }
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

function readExact(file: string, max: number): Buffer {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > max) throw conflict();
  return fs.readFileSync(file);
}

function conflict(): PigeDomainError {
  return new PigeDomainError("settings.pige_policy_conflict", "The Vault PIGE.md policy changed unexpectedly.");
}
