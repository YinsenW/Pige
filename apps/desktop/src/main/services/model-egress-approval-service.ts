import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  ModelEgressApprovalRequestRecordSchema,
  type ModelEgressApprovalDecision,
  type ModelEgressApprovalRequestRecord,
  type ModelEgressContentClass,
  type ModelEgressReasonCode
} from "@pige/schemas";
import { readVaultManifest } from "./vault-layout";

const APPROVAL_DIRECTORY = "model-egress-approvals";
const MAX_APPROVAL_BYTES = 24 * 1024;
const MAX_APPROVAL_FILES = 512;
const PRIVATE_FILE_MODE = 0o600;

export interface ModelEgressApprovalBinding {
  readonly jobId: string;
  readonly vaultId: string;
  readonly providerProfileId: string;
  readonly modelProfileId: string;
  readonly providerIdentityHash: string;
  readonly modelIdentityHash: string;
  readonly policyHash: string;
  readonly payloadHash: string;
  readonly evidenceSummaryHash: string;
  readonly baseDecisionHash: string;
  readonly reasonCode: ModelEgressReasonCode;
  readonly contentClasses: readonly ModelEgressContentClass[];
  readonly payloadCharacters: number;
  readonly estimatedPayloadTokens: number;
  readonly normalPayloadCharacterLimit: number;
}

export type ModelEgressApprovalServiceOptions =
  | {
      readonly rootPath: string;
      readonly assertWriterLease: (vaultPath: string) => void;
      readonly unsafeAllowUnfenced?: never;
    }
  | {
      readonly rootPath: string;
      readonly assertWriterLease?: never;
      readonly unsafeAllowUnfenced: true;
    };

export class ModelEgressConfirmationRequiredError extends PigeDomainError {
  readonly requestId: string;

  constructor(requestId: string) {
    super(
      "model_egress.confirmation_required",
      "The exact model invocation requires a one-use model egress approval."
    );
    this.requestId = requestId;
  }
}

export class ModelEgressApprovalService {
  readonly #rootPath: string;
  readonly #assertWriterLease: ((vaultPath: string) => void) | undefined;
  readonly #waiters = new Map<string, {
    readonly resolve: (record: ModelEgressApprovalRequestRecord) => void;
    readonly reject: (error: Error) => void;
    readonly signal?: AbortSignal;
    readonly onAbort?: () => void;
  }>();

  constructor(options: ModelEgressApprovalServiceOptions) {
    if (!options || typeof options.rootPath !== "string" || options.rootPath.trim() === "" || (
      options.assertWriterLease === undefined &&
      !("unsafeAllowUnfenced" in options && options.unsafeAllowUnfenced === true)
    )) {
      throw new PigeDomainError(
        "model_egress.approval_store_invalid",
        "The model egress approval store requires an active vault writer lease."
      );
    }
    this.#rootPath = path.resolve(options.rootPath);
    this.#assertWriterLease = options.assertWriterLease;
  }

  prepare(vaultPath: string, binding: ModelEgressApprovalBinding): ModelEgressApprovalRequestRecord {
    const { root, vaultId } = this.#rootForVault(vaultPath, binding.vaultId);
    const records = readApprovalRecords(root, vaultId);
    const active = records.filter((record) =>
      record.jobId === binding.jobId && (record.state === "pending" || record.state === "approved")
    );
    const exact = active.filter((record) => approvalBindingMatches(record, binding));
    if (exact.length > 1) {
      throw new PigeDomainError(
        "model_egress.approval_conflict",
        "Multiple active model egress approvals claim the same exact invocation."
      );
    }
    for (const stale of active) {
      if (!approvalBindingMatches(stale, binding)) this.#invalidateRecord(vaultPath, stale);
    }
    if (exact[0]) return exact[0];
    this.#ensureCapacity(vaultPath, vaultId, root);

    const now = new Date().toISOString();
    const request = ModelEgressApprovalRequestRecordSchema.parse({
      schemaVersion: 1,
      id: createApprovalRequestId(now),
      authorizationLayer: "model_egress",
      state: "pending",
      ...binding,
      contentClasses: [...binding.contentClasses].sort(),
      createdAt: now,
      updatedAt: now
    });
    createRecord(root, request, () => this.#assertLease(vaultPath));
    return request;
  }

  bindAudit(
    vaultPath: string,
    requestId: string,
    binding: ModelEgressApprovalBinding,
    operationId: string,
    decisionHash: string
  ): ModelEgressApprovalRequestRecord {
    const current = this.read(vaultPath, requestId);
    assertApprovalBinding(current, binding);
    if (current.operationId || current.decisionHash) {
      if (current.operationId !== operationId || current.decisionHash !== decisionHash) {
        throw new PigeDomainError(
          "model_egress.approval_conflict",
          "The model egress approval audit binding changed."
        );
      }
      return current;
    }
    return this.#replace(vaultPath, current, ModelEgressApprovalRequestRecordSchema.parse({
      ...current,
      operationId,
      decisionHash,
      updatedAt: new Date().toISOString()
    }));
  }

  read(vaultPath: string, requestId: string): ModelEgressApprovalRequestRecord {
    const { root, vaultId } = this.#rootForVault(vaultPath);
    const record = readRecord(root, requestId);
    if (record.vaultId !== vaultId) throw approvalStoreInvalid();
    return record;
  }

  pending(vaultPath: string, requestId: string): ModelEgressApprovalRequestRecord | undefined {
    const { root } = this.#rootForVault(vaultPath);
    if (!/^egressreq_\d{8}_[a-z0-9]{16,}$/u.test(requestId)) throw approvalStoreInvalid();
    if (!fs.existsSync(path.join(root, `${requestId}.json`))) return undefined;
    const record = this.read(vaultPath, requestId);
    return record.state === "pending" ? record : undefined;
  }

  listForJob(vaultPath: string, jobId: string): readonly ModelEgressApprovalRequestRecord[] {
    const { root, vaultId } = this.#rootForVault(vaultPath);
    return readApprovalRecords(root, vaultId)
      .filter((record) => record.jobId === jobId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  listResolvable(vaultPath: string): readonly ModelEgressApprovalRequestRecord[] {
    const { root, vaultId } = this.#rootForVault(vaultPath);
    return readApprovalRecords(root, vaultId).filter((record) =>
      record.state === "approved" || record.state === "denied" || record.state === "consumed"
    );
  }

  assertProviderInactive(vaultPath: string, providerProfileId: string): void {
    const { root, vaultId } = this.#rootForVault(vaultPath);
    const active = readApprovalRecords(root, vaultId).some((record) =>
      record.providerProfileId === providerProfileId &&
      (record.state === "pending" || record.state === "approved" || this.#waiters.has(record.id))
    );
    if (active) {
      throw new PigeDomainError(
        "model_provider.active_reference",
        "This Provider Profile still owns an active model egress request."
      );
    }
  }

  resolve(
    vaultPath: string,
    requestId: string,
    decision: ModelEgressApprovalDecision
  ): ModelEgressApprovalRequestRecord {
    const resolved = this.commitDecision(vaultPath, requestId, decision);
    this.releaseDecision(vaultPath, resolved.id);
    return resolved;
  }

  commitDecision(
    vaultPath: string,
    requestId: string,
    decision: ModelEgressApprovalDecision
  ): ModelEgressApprovalRequestRecord {
    const current = this.read(vaultPath, requestId);
    if (!current.operationId || !current.decisionHash) {
      throw new PigeDomainError(
        "model_egress.approval_invalid",
        "The model egress approval has no durable audit binding."
      );
    }
    if (current.state !== "pending") {
      if (
        (decision === "allow_once" && current.state === "approved") ||
        (decision === "deny" && current.state === "denied")
      ) return current;
      throw new PigeDomainError(
        "model_egress.approval_replay",
        "The model egress approval is no longer pending."
      );
    }
    const now = new Date().toISOString();
    return this.#replace(vaultPath, current, ModelEgressApprovalRequestRecordSchema.parse({
      ...current,
      state: decision === "allow_once" ? "approved" : "denied",
      decision,
      decidedAt: now,
      updatedAt: now
    }));
  }

  releaseDecision(vaultPath: string, requestId: string): ModelEgressApprovalRequestRecord {
    const current = this.read(vaultPath, requestId);
    if (current.state !== "approved" && current.state !== "denied") {
      throw new PigeDomainError(
        "model_egress.approval_stale",
        "Only a committed model egress decision may resume its exact invocation."
      );
    }
    this.#settleWaiter(current);
    return current;
  }

  hasLiveWaiter(requestId: string): boolean {
    return this.#waiters.has(requestId);
  }

  waitForDecision(
    vaultPath: string,
    requestId: string,
    binding: ModelEgressApprovalBinding,
    signal?: AbortSignal
  ): Promise<ModelEgressApprovalRequestRecord> {
    const current = this.read(vaultPath, requestId);
    assertApprovalBinding(current, binding);
    if (current.state === "approved") return Promise.resolve(current);
    if (current.state === "denied") {
      return Promise.reject(new PigeDomainError("model_egress.denied", "The exact model send was denied."));
    }
    if (current.state !== "pending") {
      return Promise.reject(new PigeDomainError(
        "model_egress.approval_stale",
        "The model egress approval can no longer resume this invocation."
      ));
    }
    if (signal?.aborted) return Promise.reject(createAbortError());
    if (this.#waiters.has(requestId)) {
      return Promise.reject(new PigeDomainError(
        "model_egress.approval_conflict",
        "Another runtime invocation already waits on this model egress approval."
      ));
    }
    return new Promise<ModelEgressApprovalRequestRecord>((resolve, reject) => {
      const onAbort = signal ? (): void => {
        const waiter = this.#waiters.get(requestId);
        if (!waiter) return;
        this.#waiters.delete(requestId);
        reject(createAbortError());
      } : undefined;
      this.#waiters.set(requestId, { resolve, reject, ...(signal ? { signal } : {}), ...(onAbort ? { onAbort } : {}) });
      signal?.addEventListener("abort", onAbort!, { once: true });
    });
  }

  assertApproved(
    vaultPath: string,
    requestId: string,
    binding: ModelEgressApprovalBinding
  ): ModelEgressApprovalRequestRecord {
    const current = this.read(vaultPath, requestId);
    assertApprovalBinding(current, binding);
    if (current.state === "pending") {
      throw new ModelEgressConfirmationRequiredError(current.id);
    }
    if (current.state !== "approved") {
      throw new PigeDomainError(
        current.state === "denied" ? "model_egress.denied" : "model_egress.approval_stale",
        "The model egress approval cannot authorize this invocation."
      );
    }
    return current;
  }

  consume(
    vaultPath: string,
    requestId: string,
    binding: ModelEgressApprovalBinding
  ): ModelEgressApprovalRequestRecord {
    const current = this.assertApproved(vaultPath, requestId, binding);
    const now = new Date().toISOString();
    return this.#replace(vaultPath, current, ModelEgressApprovalRequestRecordSchema.parse({
      ...current,
      state: "consumed",
      consumedAt: now,
      updatedAt: now
    }));
  }

  invalidate(vaultPath: string, requestId: string): ModelEgressApprovalRequestRecord {
    return this.#invalidateRecord(vaultPath, this.read(vaultPath, requestId));
  }

  markReconciled(vaultPath: string, requestId: string): ModelEgressApprovalRequestRecord {
    const current = this.read(vaultPath, requestId);
    if (!new Set(["denied", "consumed", "invalidated"]).has(current.state)) {
      throw new PigeDomainError(
        "model_egress.approval_stale",
        "Only a terminal model egress decision may be marked safe for machine-local retention cleanup."
      );
    }
    if (this.#waiters.has(requestId)) {
      throw new PigeDomainError(
        "model_egress.approval_conflict",
        "A live model invocation still owns this model egress decision."
      );
    }
    if (current.reconciledAt) return current;
    const now = new Date().toISOString();
    return this.#replace(vaultPath, current, ModelEgressApprovalRequestRecordSchema.parse({
      ...current,
      reconciledAt: now,
      updatedAt: now
    }));
  }

  #invalidateRecord(
    vaultPath: string,
    current: ModelEgressApprovalRequestRecord
  ): ModelEgressApprovalRequestRecord {
    if (current.state === "invalidated" || current.state === "denied" || current.state === "consumed") {
      return current;
    }
    const now = new Date().toISOString();
    const {
      decision: _decision,
      decidedAt: _decidedAt,
      consumedAt: _consumedAt,
      ...rest
    } = current;
    const invalidated = this.#replace(vaultPath, current, ModelEgressApprovalRequestRecordSchema.parse({
      ...rest,
      state: "invalidated",
      invalidatedAt: now,
      reconciledAt: now,
      updatedAt: now
    }));
    this.#settleWaiter(invalidated);
    return invalidated;
  }

  #ensureCapacity(vaultPath: string, vaultId: string, root: string): void {
    const records = readApprovalRecords(root, vaultId);
    if (records.length < MAX_APPROVAL_FILES) return;
    const candidates = records
      .filter((record) =>
        record.vaultId === vaultId &&
        record.reconciledAt !== undefined &&
        new Set(["denied", "consumed", "invalidated"]).has(record.state) &&
        !this.#waiters.has(record.id)
      )
      .sort((left, right) =>
        (left.reconciledAt ?? left.updatedAt).localeCompare(right.reconciledAt ?? right.updatedAt) ||
        left.id.localeCompare(right.id)
      );
    let remaining = records.length;
    for (const candidate of candidates) {
      if (remaining < MAX_APPROVAL_FILES) break;
      retireRecord(root, candidate, () => this.#assertLease(vaultPath));
      remaining -= 1;
    }
    if (remaining >= MAX_APPROVAL_FILES) throw approvalCapacityExceeded();
  }

  #settleWaiter(record: ModelEgressApprovalRequestRecord): void {
    const waiter = this.#waiters.get(record.id);
    if (!waiter) return;
    this.#waiters.delete(record.id);
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
    if (record.state === "approved") {
      waiter.resolve(record);
      return;
    }
    waiter.reject(new PigeDomainError(
      record.state === "denied" ? "model_egress.denied" : "model_egress.approval_stale",
      record.state === "denied"
        ? "The exact model send was denied."
        : "The model egress approval no longer authorizes this invocation."
    ));
  }

  #replace(
    vaultPath: string,
    expected: ModelEgressApprovalRequestRecord,
    next: ModelEgressApprovalRequestRecord
  ): ModelEgressApprovalRequestRecord {
    const { root } = this.#rootForVault(vaultPath, expected.vaultId);
    replaceRecord(root, expected, next, () => this.#assertLease(vaultPath));
    return next;
  }

  #rootForVault(
    vaultPath: string,
    expectedVaultId?: string
  ): { readonly root: string; readonly vaultId: string } {
    this.#assertLease(vaultPath);
    const vaultId = readVaultManifest(path.resolve(vaultPath)).vault_id;
    if (expectedVaultId !== undefined && expectedVaultId !== vaultId) {
      throw new PigeDomainError("vault.binding_changed", "The active vault identity changed.");
    }
    return { root: ensureApprovalRoot(this.#rootPath, vaultId), vaultId };
  }

  #assertLease(vaultPath: string): void {
    this.#assertWriterLease?.(vaultPath);
  }
}

function approvalBindingMatches(
  record: ModelEgressApprovalRequestRecord,
  binding: ModelEgressApprovalBinding
): boolean {
  return record.jobId === binding.jobId &&
    record.vaultId === binding.vaultId &&
    record.providerProfileId === binding.providerProfileId &&
    record.modelProfileId === binding.modelProfileId &&
    record.providerIdentityHash === binding.providerIdentityHash &&
    record.modelIdentityHash === binding.modelIdentityHash &&
    record.policyHash === binding.policyHash &&
    record.payloadHash === binding.payloadHash &&
    record.evidenceSummaryHash === binding.evidenceSummaryHash &&
    record.baseDecisionHash === binding.baseDecisionHash &&
    record.reasonCode === binding.reasonCode &&
    record.payloadCharacters === binding.payloadCharacters &&
    record.estimatedPayloadTokens === binding.estimatedPayloadTokens &&
    record.normalPayloadCharacterLimit === binding.normalPayloadCharacterLimit &&
    JSON.stringify([...record.contentClasses].sort()) === JSON.stringify([...binding.contentClasses].sort());
}

function assertApprovalBinding(
  record: ModelEgressApprovalRequestRecord,
  binding: ModelEgressApprovalBinding
): void {
  if (!approvalBindingMatches(record, binding)) {
    throw new PigeDomainError(
      "model_egress.approval_stale",
      "The model, endpoint, policy, payload, evidence, or privacy binding changed."
    );
  }
}

function createApprovalRequestId(now: string): string {
  return `egressreq_${now.slice(0, 10).replaceAll("-", "")}_${randomBytes(12).toString("hex")}`;
}

function approvalRoot(rootPath: string, vaultId: string): string {
  return path.join(path.resolve(rootPath), "model-egress", APPROVAL_DIRECTORY, vaultId);
}

function ensureApprovalRoot(rootPath: string, vaultId: string): string {
  const resolvedRoot = path.resolve(rootPath);
  const approvalsRoot = path.join(resolvedRoot, "model-egress", APPROVAL_DIRECTORY);
  const root = approvalRoot(resolvedRoot, vaultId);
  ensureDirectory(resolvedRoot, false);
  ensureDirectory(path.join(resolvedRoot, "model-egress"), true);
  ensureDirectory(approvalsRoot, true);
  ensureDirectory(root, true);
  const realMachineRoot = fs.realpathSync.native(resolvedRoot);
  const realApprovalRoot = fs.realpathSync.native(root);
  if (realApprovalRoot !== realMachineRoot && !realApprovalRoot.startsWith(`${realMachineRoot}${path.sep}`)) {
    throw approvalStoreInvalid();
  }
  return root;
}

function ensureDirectory(directoryPath: string, create: boolean): void {
  if (!fs.existsSync(directoryPath)) {
    if (!create) throw approvalStoreInvalid();
    fs.mkdirSync(directoryPath, { mode: 0o700 });
  }
  const stat = fs.lstatSync(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw approvalStoreInvalid();
  if (process.platform !== "win32") fs.chmodSync(directoryPath, 0o700);
}

function readApprovalRecords(root: string, vaultId: string): ModelEgressApprovalRequestRecord[] {
  const names = fs.readdirSync(root)
    .filter((name) => /^egressreq_\d{8}_[a-z0-9]{16,}\.json$/u.test(name))
    .sort();
  if (names.length > MAX_APPROVAL_FILES) throw approvalStoreInvalid();
  return names.map((name) => {
    const record = readRecord(root, name.slice(0, -5));
    if (record.vaultId !== vaultId) throw approvalStoreInvalid();
    return record;
  });
}

function readRecord(root: string, requestId: string): ModelEgressApprovalRequestRecord {
  if (!/^egressreq_\d{8}_[a-z0-9]{16,}$/u.test(requestId)) throw approvalStoreInvalid();
  return readRecordAtPath(path.join(root, `${requestId}.json`), requestId);
}

function readRecordAtPath(filePath: string, requestId: string): ModelEgressApprovalRequestRecord {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.size <= 0 || before.size > MAX_APPROVAL_BYTES) throw approvalStoreInvalid();
    const bytes = Buffer.alloc(before.size);
    if (fs.readSync(descriptor, bytes, 0, bytes.length, 0) !== bytes.length) throw approvalStoreInvalid();
    const named = fs.lstatSync(filePath);
    if (!named.isFile() || named.isSymbolicLink() || named.dev !== before.dev || named.ino !== before.ino) {
      throw approvalStoreInvalid();
    }
    const parsed = ModelEgressApprovalRequestRecordSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (parsed.id !== requestId) throw approvalStoreInvalid();
    return parsed;
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw approvalStoreInvalid();
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function serializeRecord(record: ModelEgressApprovalRequestRecord): Buffer {
  const bytes = Buffer.from(`${JSON.stringify(ModelEgressApprovalRequestRecordSchema.parse(record), null, 2)}\n`, "utf8");
  if (bytes.length > MAX_APPROVAL_BYTES) throw approvalStoreInvalid();
  return bytes;
}

function createRecord(
  root: string,
  record: ModelEgressApprovalRequestRecord,
  assertLease: () => void
): void {
  const filePath = path.join(root, `${record.id}.json`);
  const temporaryPath = writeTemporary(root, serializeRecord(record));
  try {
    assertLease();
    fs.linkSync(temporaryPath, filePath);
    fs.unlinkSync(temporaryPath);
    flushDirectory(root);
  } catch (caught) {
    tryUnlink(temporaryPath);
    if (isErrno(caught, "EEXIST")) {
      throw new PigeDomainError("model_egress.approval_conflict", "The model egress approval identity already exists.");
    }
    throw approvalStoreInvalid();
  }
}

function replaceRecord(
  root: string,
  expected: ModelEgressApprovalRequestRecord,
  next: ModelEgressApprovalRequestRecord,
  assertLease: () => void
): void {
  if (expected.id !== next.id) throw approvalStoreInvalid();
  const filePath = path.join(root, `${expected.id}.json`);
  const expectedRevision = hashBytes(serializeRecord(expected));
  const current = readRecord(root, expected.id);
  if (hashBytes(serializeRecord(current)) !== expectedRevision) {
    throw new PigeDomainError("model_egress.approval_conflict", "The model egress approval revision changed.");
  }
  const temporaryPath = writeTemporary(root, serializeRecord(next));
  try {
    const beforeCommit = readRecord(root, expected.id);
    if (hashBytes(serializeRecord(beforeCommit)) !== expectedRevision) {
      throw new PigeDomainError("model_egress.approval_conflict", "The model egress approval revision changed.");
    }
    assertLease();
    fs.renameSync(temporaryPath, filePath);
    flushDirectory(root);
  } catch (caught) {
    tryUnlink(temporaryPath);
    if (caught instanceof PigeDomainError) throw caught;
    throw approvalStoreInvalid();
  }
}

function retireRecord(
  root: string,
  expected: ModelEgressApprovalRequestRecord,
  assertLease: () => void
): void {
  const filePath = path.join(root, `${expected.id}.json`);
  const expectedRevision = hashBytes(serializeRecord(expected));
  const current = readRecord(root, expected.id);
  if (hashBytes(serializeRecord(current)) !== expectedRevision) {
    throw new PigeDomainError("model_egress.approval_conflict", "The model egress approval revision changed.");
  }
  const retiredPath = path.join(root, `.retire-${randomUUID()}`);
  let moved = false;
  try {
    assertLease();
    fs.renameSync(filePath, retiredPath);
    moved = true;
    const retired = readRecordAtPath(retiredPath, expected.id);
    if (hashBytes(serializeRecord(retired)) !== expectedRevision) {
      throw new PigeDomainError("model_egress.approval_conflict", "The model egress approval revision changed.");
    }
    fs.unlinkSync(retiredPath);
    moved = false;
    flushDirectory(root);
  } catch (caught) {
    if (moved && fs.existsSync(retiredPath) && !fs.existsSync(filePath)) {
      try {
        fs.renameSync(retiredPath, filePath);
        flushDirectory(root);
      } catch {
        // Preserve the quarantined bytes and fail closed if the authoritative name cannot be restored.
      }
    }
    if (caught instanceof PigeDomainError) throw caught;
    throw approvalStoreInvalid();
  }
}

function writeTemporary(root: string, bytes: Buffer): string {
  const temporaryPath = path.join(root, `.tmp-${randomUUID()}`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, PRIVATE_FILE_MODE);
    if (process.platform !== "win32") fs.fchmodSync(descriptor, PRIVATE_FILE_MODE);
    if (fs.writeSync(descriptor, bytes, 0, bytes.length, 0) !== bytes.length) throw approvalStoreInvalid();
    fs.fsyncSync(descriptor);
    return temporaryPath;
  } catch (caught) {
    tryUnlink(temporaryPath);
    if (caught instanceof PigeDomainError) throw caught;
    throw approvalStoreInvalid();
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function flushDirectory(directoryPath: string): void {
  if (process.platform === "win32") return;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch {
    // Some filesystems do not support directory fsync; file fsync still protects contents.
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function tryUnlink(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Cleanup never replaces the authoritative failure.
  }
}

function isErrno(caught: unknown, code: string): boolean {
  return typeof caught === "object" && caught !== null && "code" in caught && caught.code === code;
}

function approvalStoreInvalid(): PigeDomainError {
  return new PigeDomainError(
    "model_egress.approval_store_invalid",
    "The machine-local model egress approval store is unavailable or unsafe."
  );
}

function approvalCapacityExceeded(): PigeDomainError {
  return new PigeDomainError(
    "model_egress.approval_capacity",
    "The machine-local model egress approval store is full of unreconciled decisions."
  );
}

function createAbortError(): Error {
  const error = new Error("The model egress approval wait was cancelled.");
  error.name = "AbortError";
  return error;
}
