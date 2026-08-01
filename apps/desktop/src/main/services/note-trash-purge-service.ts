import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NoteTrashPurgeRequest, NoteTrashPurgeResult, VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { OperationRecordSchema, NoteTrashPurgeRequestSchema, type OperationRecord } from "@pige/schemas";
import { flushDirectoryWhereSupported } from "./durable-directory-sync";
import {
  commitOperationExclusive,
  hashBytes,
  matchesTrashOperation,
  readOperation,
  readReceiptByOperation,
  resolveVaultRelative,
  restoreOperationId,
  trashRevision,
  type NoteTrashReceipt
} from "./note-trash-service";

const MAX_NOTE_BYTES = 4 * 1024 * 1024;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_RECORDS = 10_000;
const OPERATION_ID = /^op_(\d{8})_[a-z0-9]{8,}$/u;

export interface NoteTrashPurgeVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

interface NoteTrashPurgeRecordBase {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly requestDigest: string;
  readonly activeVaultId: string;
  readonly pageId: string;
  readonly trashOperationId: string;
  readonly expectedTrashRevision: string;
  readonly purgeOperationId: string;
  readonly createdAt: string;
}

interface NoteTrashPurgeIntent extends NoteTrashPurgeRecordBase {
  readonly kind: "note_trash_purge_intent";
}

interface NoteTrashPurgeTombstone extends NoteTrashPurgeRecordBase {
  readonly kind: "note_trash_purge_tombstone";
  readonly trashPagePath: string;
  readonly contentHash: string;
  readonly title: string;
}

interface NoteTrashPurgeDependencies {
  readonly now?: () => Date;
  readonly randomId?: () => string;
}

export class NoteTrashPurgeService {
  readonly #vaults: NoteTrashPurgeVaultPort;
  readonly #now: () => Date;
  readonly #randomId: () => string;

  constructor(vaults: NoteTrashPurgeVaultPort, dependencies: NoteTrashPurgeDependencies = {}) {
    this.#vaults = vaults;
    this.#now = dependencies.now ?? (() => new Date());
    this.#randomId = dependencies.randomId ?? randomUUID;
  }

  purge(request: NoteTrashPurgeRequest): NoteTrashPurgeResult {
    const identity = requestIdentity(request);
    if (!NoteTrashPurgeRequestSchema.safeParse(request).success) return { ...identity, status: "failed" };
    const vaultPath = this.#scope(request.activeVaultId);
    if (!vaultPath) return { ...identity, status: "failed" };
    try {
      const replay = readPurgeTombstoneByRequest(vaultPath, request.requestId);
      if (replay) {
        if (!matchesRequestRecord(replay, request)) return { ...identity, status: "stale" };
        return matchesPurgeOperation(replay, readOperation(vaultPath, replay.purgeOperationId))
          ? { ...identity, status: "committed", operationId: replay.purgeOperationId }
          : { ...identity, status: "stale" };
      }
      const existingIntent = readPurgeIntentByRequest(vaultPath, request.requestId);
      if (existingIntent) {
        if (!matchesRequestRecord(existingIntent, request)) return { ...identity, status: "stale" };
        this.#complete(vaultPath, existingIntent);
        return { ...identity, status: "committed", operationId: existingIntent.purgeOperationId };
      }
      const receipt = readReceiptByOperation(vaultPath, request.trashOperationId);
      const status = validateReceipt(vaultPath, receipt, request);
      if (status !== "ready") return { ...identity, status };
      const createdAt = this.#now().toISOString();
      const intent: NoteTrashPurgeIntent = {
        schemaVersion: 1,
        kind: "note_trash_purge_intent",
        requestId: request.requestId,
        requestDigest: requestDigest(request),
        activeVaultId: request.activeVaultId,
        pageId: request.pageId,
        trashOperationId: request.trashOperationId,
        expectedTrashRevision: request.expectedTrashRevision,
        purgeOperationId: createPurgeOperationId(createdAt, request, this.#randomId()),
        createdAt
      };
      writeRecordExclusive(vaultPath, purgeIntentPath(vaultPath, request.requestId), intent);
      this.#complete(vaultPath, intent);
      return { ...identity, status: "committed", operationId: intent.purgeOperationId };
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "note_trash_purge.not_found") {
        return { ...identity, status: "not_found" };
      }
      if (caught instanceof PigeDomainError && caught.code === "note_trash_purge.stale") {
        return { ...identity, status: "stale" };
      }
      return { ...identity, status: "failed" };
    }
  }

  recoverIncompletePurges(): { readonly recovered: number; readonly failed: number } {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!this.#vaults.current() || !vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0;
    let failed = 0;
    for (const intent of readAllPurgeIntents(vaultPath)) {
      try {
        this.#complete(vaultPath, intent);
        recovered += 1;
      } catch {
        failed += 1;
      }
    }
    return { recovered, failed };
  }

  #complete(vaultPath: string, intent: NoteTrashPurgeIntent): void {
    let tombstone = readPurgeTombstoneByRequest(vaultPath, intent.requestId);
    const receipt = readReceiptByOperation(vaultPath, intent.trashOperationId);
    if (!tombstone) {
      if (!receipt || validateReceiptAgainstIntent(vaultPath, receipt, intent) !== "ready") throw staleError();
      tombstone = {
        ...intent,
        kind: "note_trash_purge_tombstone",
        trashPagePath: receipt.trashPagePath,
        contentHash: receipt.contentHash,
        title: receipt.title
      };
      writeRecordExclusive(vaultPath, purgeTombstonePath(vaultPath, intent.requestId), tombstone);
    } else if (!matchesIntent(tombstone, intent)) throw staleError();
    const existing = readOperation(vaultPath, tombstone.purgeOperationId);
    if (existing) {
      if (!matchesPurgeOperation(tombstone, existing)) throw staleError();
    } else {
      commitOperationExclusive(vaultPath, createPurgeOperation(tombstone));
    }
    removePayload(vaultPath, tombstone);
    if (receipt) removeReceipt(vaultPath, receipt);
    removeRestoreIntents(vaultPath, tombstone.trashOperationId);
    removeExactRecord(vaultPath, purgeIntentPath(vaultPath, intent.requestId), intent);
  }

  #scope(activeVaultId: string): string | undefined {
    const current = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    return current && vaultPath && current.vaultId === activeVaultId ? vaultPath : undefined;
  }
}

function validateReceipt(
  vaultPath: string,
  receipt: NoteTrashReceipt | undefined,
  request: NoteTrashPurgeRequest
): "ready" | "stale" | "not_found" {
  if (!receipt) return "not_found";
  if (receipt.activeVaultId !== request.activeVaultId || receipt.pageId !== request.pageId ||
    receipt.operationId !== request.trashOperationId || trashRevision(receipt) !== request.expectedTrashRevision) return "stale";
  return validateCurrentTrash(vaultPath, receipt);
}

function validateReceiptAgainstIntent(
  vaultPath: string,
  receipt: NoteTrashReceipt,
  intent: NoteTrashPurgeIntent
): "ready" | "stale" | "not_found" {
  if (receipt.activeVaultId !== intent.activeVaultId || receipt.pageId !== intent.pageId ||
    receipt.operationId !== intent.trashOperationId || trashRevision(receipt) !== intent.expectedTrashRevision) return "stale";
  return validateCurrentTrash(vaultPath, receipt);
}

function validateCurrentTrash(vaultPath: string, receipt: NoteTrashReceipt): "ready" | "stale" | "not_found" {
  const trashOperation = readOperation(vaultPath, receipt.operationId);
  if (!trashOperation || !matchesTrashOperation(receipt, trashOperation)) return "stale";
  if (readOperation(vaultPath, restoreOperationId(receipt.operationId))) return "stale";
  if (exists(resolveVaultRelative(vaultPath, receipt.originalPagePath))) return "stale";
  const payloadPath = resolveVaultRelative(vaultPath, receipt.trashPagePath);
  if (!exists(payloadPath)) return "not_found";
  return hashFile(vaultPath, payloadPath, MAX_NOTE_BYTES) === receipt.contentHash ? "ready" : "stale";
}

function createPurgeOperation(tombstone: NoteTrashPurgeTombstone): OperationRecord {
  return OperationRecordSchema.parse({
    id: tombstone.purgeOperationId,
    schemaVersion: 1,
    createdAt: tombstone.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "purge_page",
    targetRefs: [{ kind: "page", id: tombstone.pageId }],
    sourceRefs: [{ kind: "operation", id: tombstone.trashOperationId }],
    before: { kind: "page", id: tombstone.contentHash, path: tombstone.trashPagePath },
    summary: `Permanently deleted ${tombstone.title} from Trash.`,
    reversible: "no",
    warnings: ["The trashed knowledge page cannot be restored."]
  });
}

function matchesPurgeOperation(tombstone: NoteTrashPurgeTombstone, operation: OperationRecord | undefined): boolean {
  const target = operation?.targetRefs[0];
  return operation?.id === tombstone.purgeOperationId && operation.kind === "purge_page" &&
    operation.actor.kind === "user" && operation.reversible === "no" && operation.targetRefs.length === 1 &&
    target?.kind === "page" && target.id === tombstone.pageId &&
    operation.sourceRefs.some((ref) => ref.kind === "operation" && ref.id === tombstone.trashOperationId) &&
    operation.before?.kind === "page" && operation.before.id === tombstone.contentHash &&
    operation.before.path === tombstone.trashPagePath && operation.after === undefined;
}

function removePayload(vaultPath: string, tombstone: NoteTrashPurgeTombstone): void {
  const filePath = resolveVaultRelative(vaultPath, tombstone.trashPagePath);
  if (!exists(filePath)) return;
  if (hashFile(vaultPath, filePath, MAX_NOTE_BYTES) !== tombstone.contentHash) throw staleError();
  unlinkVerified(vaultPath, filePath);
  const operationDirectory = path.dirname(filePath);
  try {
    if (fs.readdirSync(operationDirectory).length === 0) {
      fs.rmdirSync(operationDirectory);
      flushDirectoryWhereSupported(path.dirname(operationDirectory));
    }
  } catch (caught) {
    if (!isErrno(caught, "ENOENT") && !isErrno(caught, "ENOTEMPTY")) throw caught;
  }
}

function removeReceipt(vaultPath: string, receipt: NoteTrashReceipt): void {
  const filePath = path.join(receiptRoot(vaultPath), `receipt_${recordKey(receipt.requestId)}.json`);
  if (!exists(filePath)) return;
  const value = JSON.parse(readBounded(filePath, MAX_RECORD_BYTES).toString("utf8"));
  if (JSON.stringify(value) !== JSON.stringify(receipt)) throw staleError();
  unlinkVerified(vaultPath, filePath);
}

function removeRestoreIntents(vaultPath: string, trashOperationId: string): void {
  const root = path.join(vaultPath, ".pige", "trash", "note-restore-intents");
  if (!exists(root)) return;
  assertSafeDirectory(vaultPath, root);
  const entries = fs.readdirSync(root, { withFileTypes: true });
  if (entries.length > MAX_RECORDS) throw staleError();
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !/^intent_[a-f0-9]{32}\.json$/u.test(entry.name)) continue;
    const filePath = path.join(root, entry.name);
    try {
      const value = JSON.parse(readBounded(filePath, MAX_RECORD_BYTES).toString("utf8")) as Record<string, unknown>;
      if (value.kind === "note_trash_restore_intent" && value.trashOperationId === trashOperationId) unlinkVerified(vaultPath, filePath);
    } catch {
      // Unrelated malformed recovery evidence is preserved for explicit repair.
    }
  }
}

function readAllPurgeIntents(vaultPath: string): NoteTrashPurgeIntent[] {
  const root = purgeIntentRoot(vaultPath);
  if (!exists(root)) return [];
  assertSafeDirectory(vaultPath, root);
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && /^intent_[a-f0-9]{32}\.json$/u.test(entry.name));
  if (entries.length > MAX_RECORDS) throw staleError();
  return entries.map((entry) => parseIntent(readBounded(path.join(root, entry.name), MAX_RECORD_BYTES)));
}

function readPurgeIntentByRequest(vaultPath: string, requestId: string): NoteTrashPurgeIntent | undefined {
  const filePath = purgeIntentPath(vaultPath, requestId);
  return exists(filePath) ? parseIntent(readBounded(filePath, MAX_RECORD_BYTES)) : undefined;
}

function readPurgeTombstoneByRequest(vaultPath: string, requestId: string): NoteTrashPurgeTombstone | undefined {
  const filePath = purgeTombstonePath(vaultPath, requestId);
  return exists(filePath) ? parseTombstone(readBounded(filePath, MAX_RECORD_BYTES)) : undefined;
}

function parseIntent(bytes: Buffer): NoteTrashPurgeIntent {
  const value = JSON.parse(bytes.toString("utf8")) as Partial<NoteTrashPurgeIntent>;
  const keys = "activeVaultId,createdAt,expectedTrashRevision,kind,pageId,purgeOperationId,requestDigest,requestId,schemaVersion,trashOperationId";
  if (Object.keys(value).sort().join(",") !== keys || value.schemaVersion !== 1 || value.kind !== "note_trash_purge_intent" ||
    typeof value.requestId !== "string" || !/^notetrashpurgereq_[a-z0-9]{16,64}$/u.test(value.requestId) ||
    typeof value.requestDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value.requestDigest) ||
    typeof value.activeVaultId !== "string" || typeof value.pageId !== "string" ||
    typeof value.trashOperationId !== "string" || !OPERATION_ID.test(value.trashOperationId) ||
    typeof value.expectedTrashRevision !== "string" || !/^notetrashrev_[a-f0-9]{64}$/u.test(value.expectedTrashRevision) ||
    typeof value.purgeOperationId !== "string" || !OPERATION_ID.test(value.purgeOperationId) ||
    typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) throw staleError();
  return value as NoteTrashPurgeIntent;
}

function parseTombstone(bytes: Buffer): NoteTrashPurgeTombstone {
  const value = JSON.parse(bytes.toString("utf8")) as Partial<NoteTrashPurgeTombstone>;
  const keys = "activeVaultId,contentHash,createdAt,expectedTrashRevision,kind,pageId,purgeOperationId,requestDigest,requestId,schemaVersion,title,trashOperationId,trashPagePath";
  if (Object.keys(value).sort().join(",") !== keys || value.kind !== "note_trash_purge_tombstone" ||
    typeof value.trashPagePath !== "string" || typeof value.contentHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.contentHash) || typeof value.title !== "string") throw staleError();
  return { ...parseIntent(Buffer.from(JSON.stringify({
    schemaVersion: value.schemaVersion, kind: "note_trash_purge_intent", requestId: value.requestId,
    requestDigest: value.requestDigest, activeVaultId: value.activeVaultId, pageId: value.pageId,
    trashOperationId: value.trashOperationId, expectedTrashRevision: value.expectedTrashRevision,
    purgeOperationId: value.purgeOperationId, createdAt: value.createdAt
  }))), kind: "note_trash_purge_tombstone", trashPagePath: value.trashPagePath,
  contentHash: value.contentHash, title: value.title };
}

function writeRecordExclusive(vaultPath: string, filePath: string, value: unknown): void {
  ensureSafeDirectory(vaultPath, path.dirname(filePath));
  try {
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW ?? 0), 0o600);
      fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      fs.fsyncSync(descriptor);
    } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
    flushDirectoryWhereSupported(path.dirname(filePath));
  } catch (caught) {
    if (!isErrno(caught, "EEXIST") || JSON.stringify(JSON.parse(readBounded(filePath, MAX_RECORD_BYTES).toString("utf8"))) !== JSON.stringify(value)) throw caught;
  }
}

function removeExactRecord(vaultPath: string, filePath: string, value: unknown): void {
  if (!exists(filePath)) return;
  if (JSON.stringify(JSON.parse(readBounded(filePath, MAX_RECORD_BYTES).toString("utf8"))) !== JSON.stringify(value)) throw staleError();
  unlinkVerified(vaultPath, filePath);
}

function hashFile(vaultPath: string, filePath: string, maximumBytes: number): string {
  assertConfined(vaultPath, filePath);
  assertSafeDirectory(vaultPath, path.dirname(filePath));
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximumBytes) throw staleError();
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (!sameFile(before, after)) throw staleError();
    return hashBytes(bytes);
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function unlinkVerified(vaultPath: string, filePath: string): void {
  assertConfined(vaultPath, filePath);
  assertSafeDirectory(vaultPath, path.dirname(filePath));
  const before = fs.lstatSync(filePath);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw staleError();
  fs.unlinkSync(filePath);
  flushDirectoryWhereSupported(path.dirname(filePath));
}

function readBounded(filePath: string, maximumBytes: number): Buffer {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximumBytes) throw staleError();
    const bytes = fs.readFileSync(descriptor);
    if (!sameFile(before, fs.fstatSync(descriptor))) throw staleError();
    return bytes;
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function ensureSafeDirectory(vaultPath: string, directoryPath: string): void {
  assertConfined(vaultPath, directoryPath);
  const root = path.resolve(vaultPath);
  let current = root;
  for (const part of path.relative(root, path.resolve(directoryPath)).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw staleError();
    } catch (caught) {
      if (!isErrno(caught, "ENOENT")) throw caught;
      fs.mkdirSync(current, { mode: 0o700 });
      flushDirectoryWhereSupported(path.dirname(current));
    }
  }
}

function assertSafeDirectory(vaultPath: string, directoryPath: string): void {
  assertConfined(vaultPath, directoryPath);
  const root = path.resolve(vaultPath);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw staleError();
  let current = root;
  for (const part of path.relative(root, path.resolve(directoryPath)).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw staleError();
  }
}

function requestIdentity(request: NoteTrashPurgeRequest) {
  return { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId,
    pageId: request.pageId, trashOperationId: request.trashOperationId,
    expectedTrashRevision: request.expectedTrashRevision, confirmation: request.confirmation };
}

function requestDigest(request: NoteTrashPurgeRequest): string {
  return `sha256:${createHash("sha256").update("pige.note.trash.purge-request.v1\0")
    .update(JSON.stringify(requestIdentity(request))).digest("hex")}`;
}

function matchesRequestRecord(record: NoteTrashPurgeRecordBase, request: NoteTrashPurgeRequest): boolean {
  return record.requestId === request.requestId && record.requestDigest === requestDigest(request) &&
    record.activeVaultId === request.activeVaultId && record.pageId === request.pageId &&
    record.trashOperationId === request.trashOperationId && record.expectedTrashRevision === request.expectedTrashRevision;
}

function matchesIntent(tombstone: NoteTrashPurgeTombstone, intent: NoteTrashPurgeIntent): boolean {
  return tombstone.requestId === intent.requestId && tombstone.requestDigest === intent.requestDigest &&
    tombstone.activeVaultId === intent.activeVaultId && tombstone.pageId === intent.pageId &&
    tombstone.trashOperationId === intent.trashOperationId && tombstone.expectedTrashRevision === intent.expectedTrashRevision &&
    tombstone.purgeOperationId === intent.purgeOperationId && tombstone.createdAt === intent.createdAt;
}

function createPurgeOperationId(createdAt: string, request: NoteTrashPurgeRequest, randomId: string): string {
  const dateKey = createdAt.slice(0, 10).replaceAll("-", "");
  const digest = createHash("sha256").update("pige.note.trash.purge-operation.v1\0")
    .update(requestDigest(request)).update(randomId).digest("hex").slice(0, 16);
  return `op_${dateKey}_${digest}`;
}

function purgeIntentRoot(vaultPath: string): string { return path.join(vaultPath, ".pige", "trash", "note-purge-intents"); }
function purgeTombstoneRoot(vaultPath: string): string { return path.join(vaultPath, ".pige", "trash", "note-purge-tombstones"); }
function receiptRoot(vaultPath: string): string { return path.join(vaultPath, ".pige", "trash", "note-receipts"); }
function recordKey(requestId: string): string { return createHash("sha256").update(requestId).digest("hex").slice(0, 32); }
function purgeIntentPath(vaultPath: string, requestId: string): string { return path.join(purgeIntentRoot(vaultPath), `intent_${recordKey(requestId)}.json`); }
function purgeTombstonePath(vaultPath: string, requestId: string): string { return path.join(purgeTombstoneRoot(vaultPath), `tombstone_${recordKey(requestId)}.json`); }

function assertConfined(vaultPath: string, candidatePath: string): void {
  const root = path.resolve(vaultPath);
  const candidate = path.resolve(candidatePath);
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) throw staleError();
}
function sameFile(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}
function exists(filePath: string): boolean {
  try { fs.lstatSync(filePath); return true; } catch (caught) { if (isErrno(caught, "ENOENT")) return false; throw caught; }
}
function isErrno(value: unknown, code: string): boolean {
  return typeof value === "object" && value !== null && "code" in value && (value as { code?: unknown }).code === code;
}
function staleError(): PigeDomainError { return new PigeDomainError("note_trash_purge.stale", "The trash item changed before permanent deletion."); }
