import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  KnowledgeActivitySummary,
  KnowledgeActivityUndoResult,
  SourceTrashListRequest,
  SourceTrashListResult,
  SourceTrashRequest,
  SourceTrashRestoreRequest,
  SourceTrashRestoreResult,
  SourceTrashResult,
  SourceTrashSummary,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { parsePigeFrontmatter } from "@pige/markdown";
import {
  SourceTrashListRequestSchema,
  SourceTrashRequestSchema,
  SourceTrashRestoreRequestSchema,
  type OperationRecord,
  type SourceRecord
} from "@pige/schemas";
import { flushDirectoryWhereSupported } from "./durable-directory-sync";
import { commitOperationExclusive, readOperation } from "./note-trash-service";
import { readCurrentSourceRecordSnapshot } from "./source-file-access";
import { sourceRefreshDisplayName } from "./source-refresh-identity";

const MAX_RECEIPTS = 10_000;
const MAX_RECEIPT_BYTES = 128 * 1024;
const OPERATION_ID = /^op_(\d{8})_[a-z0-9]{8,}$/u;

function sourceRecordRevision(record: SourceRecord): string {
  return `sourcerev_${createHash("sha256").update(JSON.stringify(record)).digest("hex")}`;
}

function sourceRecordPath(vaultPath: string, sourceId: string): string {
  const dateKey = /^src_(\d{8})_/u.exec(sourceId)?.[1];
  if (!dateKey) throw new PigeDomainError("source.invalid_id", "The Source identity is invalid.");
  return path.join(vaultPath, ".pige", "source-records", dateKey.slice(0, 4), dateKey.slice(4, 6), `${sourceId}.json`);
}

function isSourceTrashStorageEligible(record: SourceRecord): boolean {
  if (record.storageStrategy === "reference_original") return true;
  const copy = record.managedCopy;
  return record.storageStrategy === "copy_to_source_library" && Boolean(copy) &&
    (!copy!.rootId || (copy!.rootId === "root_vault_managed" && copy!.pathBasis === "vault_relative"));
}

export interface SourceTrashVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export interface SourceTrashTargetPort {
  resolveSourceTrashTarget(ownerId: string, request: {
    readonly activeVaultId: string;
    readonly currentPageId: string;
    readonly renderContextId: string;
    readonly sourceId: string;
    readonly expectedSourceRevision: string;
  }): NotesSourceTrashResolution;
}

export interface SourceTrashUsagePort {
  hasActiveSourceUse(sourceId: string): boolean;
}

export interface NotesSourceTrashProjectionPort {
  canTrash(vaultPath: string, record: SourceRecord, pageId: string): boolean;
}

export type NotesSourceTrashResolution =
  | {
      readonly status: "ready";
      readonly vaultPath: string;
      readonly sourceRecord: SourceRecord;
      readonly sourceRecordPath: string;
      readonly sourceRecordRevision: string;
      readonly pagePath: string;
      readonly pageContentHash: string;
      readonly title: string;
      assertCurrent(): boolean;
    }
  | { readonly status: "stale" | "not_found" | "ineligible" };

interface SourceTrashRenderContext {
  readonly vaultId: string;
  readonly vaultPath: string;
  readonly pageId: string;
  readonly pageType: string;
  readonly pagePath: string;
  readonly pageContentHash: string;
  readonly sourceIds: ReadonlySet<string>;
  readonly ownerEpoch: number;
}

interface SourceTrashFileIdentity {
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly deviceId: string;
  readonly fileId: string;
}

export function projectSourceTrashEligibility(
  vaultPath: string,
  pageId: string,
  pageType: string,
  sourceIds: readonly string[],
  projection: NotesSourceTrashProjectionPort | undefined
) {
  if (pageType !== "source" || sourceIds.length !== 1) return undefined;
  const source = readCurrentSourceRecordSnapshot(vaultPath, sourceIds[0]!);
  if (!source || source.record.knowledgePageId !== pageId || !isSourceTrashStorageEligible(source.record) ||
    !projection?.canTrash(vaultPath, source.record, pageId)) return undefined;
  return { sourceTrashEligibility: {
    canTrash: true as const,
    sourceId: source.record.id,
    sourceRevision: sourceRecordRevision(source.record),
    storage: source.record.storageStrategy === "reference_original" ? "reference_original" as const : "managed_copy" as const
  } };
}

export function resolveNotesSourceTrashTarget(input: {
  readonly vault: VaultSummary | undefined;
  readonly vaultPath: string | undefined;
  readonly ownerId: string;
  readonly request: Parameters<SourceTrashTargetPort["resolveSourceTrashTarget"]>[1];
  readContext(ownerId: string, renderContextId: string): SourceTrashRenderContext | undefined;
  ownerEpoch(ownerId: string): number | undefined;
  matchesCurrentPage(context: SourceTrashRenderContext): boolean;
  sameIdentity(left: SourceTrashFileIdentity, right: SourceTrashFileIdentity): boolean;
}): NotesSourceTrashResolution {
  const { vault, vaultPath, ownerId, request } = input;
  if (!vault || !vaultPath || vault.vaultId !== request.activeVaultId) return { status: "stale" };
  const context = input.readContext(ownerId, request.renderContextId);
  if (!context || context.vaultId !== request.activeVaultId || context.vaultPath !== vaultPath ||
    context.pageId !== request.currentPageId || context.pageType !== "source" || context.sourceIds.size !== 1 ||
    !context.sourceIds.has(request.sourceId) || input.ownerEpoch(ownerId) !== context.ownerEpoch ||
    !input.matchesCurrentPage(context)) return { status: "stale" };
  const source = readCurrentSourceRecordSnapshot(vaultPath, request.sourceId);
  if (!source) return { status: "not_found" };
  const revision = sourceRecordRevision(source.record);
  if (revision !== request.expectedSourceRevision || source.record.knowledgePageId !== context.pageId ||
    source.record.knowledgePagePath !== context.pagePath || !isSourceTrashStorageEligible(source.record)) {
    return { status: "ineligible" };
  }
  return {
    status: "ready", vaultPath, sourceRecord: source.record,
    sourceRecordPath: sourceRecordPath(vaultPath, request.sourceId), sourceRecordRevision: revision,
    pagePath: context.pagePath, pageContentHash: context.pageContentHash, title: sourceRefreshDisplayName(source.record),
    assertCurrent: () => {
      const current = input.readContext(ownerId, request.renderContextId);
      const latest = readCurrentSourceRecordSnapshot(vaultPath, request.sourceId);
      return current === context && Boolean(latest) && input.ownerEpoch(ownerId) === context.ownerEpoch &&
        input.matchesCurrentPage(context) && input.sameIdentity(source.identity, latest!.identity) &&
        sourceRecordRevision(latest!.record) === revision;
    }
  };
}

export function sourceTrashCandidateEligible(
  vaultPath: string,
  record: SourceRecord,
  currentPageId: string,
  usage?: SourceTrashUsagePort
): boolean {
  if (record.storageStrategy === "reference_original") return true;
  const copy = record.managedCopy;
  if (!copy || (copy.rootId && copy.rootId !== "root_vault_managed") || copy.pathBasis === "root_relative" || !usage) return false;
  try { return !usage.hasActiveSourceUse(record.id) && !hasOtherPageReference(vaultPath, record.id, currentPageId); }
  catch { return false; }
}

interface StoredFileBinding {
  readonly originalPath: string;
  readonly trashPath: string;
  readonly checksum: string;
  readonly size: number;
}

interface SourceTrashReceipt {
  readonly schemaVersion: 1;
  readonly kind: "source_trash_receipt";
  readonly requestId: string;
  readonly requestDigest: string;
  readonly activeVaultId: string;
  readonly sourceId: string;
  readonly pageId: string;
  readonly operationId: string;
  readonly storage: "managed_copy" | "reference_original";
  readonly title: string;
  readonly createdAt: string;
  readonly sourceRecord: StoredFileBinding;
  readonly sourcePage: StoredFileBinding;
  readonly managedAsset?: StoredFileBinding;
}

interface SourceRestoreIntent {
  readonly schemaVersion: 1;
  readonly kind: "source_restore_intent";
  readonly requestId: string;
  readonly activeVaultId: string;
  readonly sourceId: string;
  readonly pageId: string;
  readonly trashOperationId: string;
  readonly expectedTrashRevision: string;
  readonly createdAt: string;
}

export class SourceTrashService {
  readonly #vaults: SourceTrashVaultPort;
  readonly #targets: SourceTrashTargetPort;
  readonly #usage: SourceTrashUsagePort | undefined;
  readonly #now: () => Date;
  readonly #randomId: () => string;

  constructor(vaults: SourceTrashVaultPort, targets: SourceTrashTargetPort, usage?: SourceTrashUsagePort, dependencies: {
    readonly now?: () => Date;
    readonly randomId?: () => string;
  } = {}) {
    this.#vaults = vaults;
    this.#targets = targets;
    this.#usage = usage;
    this.#now = dependencies.now ?? (() => new Date());
    this.#randomId = dependencies.randomId ?? randomUUID;
  }

  trash(ownerId: string, request: SourceTrashRequest): SourceTrashResult {
    const identity = trashIdentity(request);
    if (!SourceTrashRequestSchema.safeParse(request).success) return { ...identity, status: "failed" };
    const vaultPath = this.#scope(request.activeVaultId);
    if (!vaultPath) return { ...identity, status: "failed" };
    try {
      const replay = readReceiptByRequest(vaultPath, request.requestId);
      if (replay) {
        if (replay.requestDigest !== requestDigest(request)) return { ...identity, status: "stale" };
        completeTrash(vaultPath, replay, () => this.#assertReceiptEligible(vaultPath, replay));
        return { ...identity, status: "committed", operationId: replay.operationId };
      }
      const target = this.#targets.resolveSourceTrashTarget(ownerId, request);
      if (target.status !== "ready") return { ...identity, status: target.status };
      if (!target.assertCurrent()) return { ...identity, status: "stale" };
      const createdAt = this.#now().toISOString();
      const operationId = createOperationId(createdAt, request, this.#randomId());
      const payloadRoot = `.pige/trash/source-assets/${operationId}`;
      const recordRelative = relativeVaultPath(vaultPath, target.sourceRecordPath);
      const pageRelative = normalizeVaultRelative(target.pagePath);
      const recordSnapshot = readVerified(vaultPath, recordRelative);
      const pageSnapshot = readVerified(vaultPath, pageRelative);
      const managedAsset = managedAssetBinding(vaultPath, target.sourceRecord, payloadRoot);
      if (!sourceTrashCandidateEligible(vaultPath, target.sourceRecord, request.currentPageId, this.#usage)) {
        return { ...identity, status: "ineligible" };
      }
      const receipt: SourceTrashReceipt = {
        schemaVersion: 1,
        kind: "source_trash_receipt",
        requestId: request.requestId,
        requestDigest: requestDigest(request),
        activeVaultId: request.activeVaultId,
        sourceId: request.sourceId,
        pageId: request.currentPageId,
        operationId,
        storage: target.sourceRecord.storageStrategy === "reference_original" ? "reference_original" : "managed_copy",
        title: boundedTitle(target.title),
        createdAt,
        sourceRecord: fileBinding(recordRelative, `${payloadRoot}/record.json`, recordSnapshot),
        sourcePage: fileBinding(pageRelative, `${payloadRoot}/page.md`, pageSnapshot),
        ...(managedAsset ? { managedAsset } : {})
      };
      writeExclusive(receiptPathForRequest(vaultPath, request.requestId), receipt, vaultPath);
      if (!target.assertCurrent()) throw stale();
      if (managedAsset && (this.#usage!.hasActiveSourceUse(request.sourceId) ||
        hasOtherPageReference(vaultPath, request.sourceId, request.currentPageId))) throw stale();
      completeTrash(vaultPath, receipt, () => this.#assertReceiptEligible(vaultPath, receipt));
      return { ...identity, status: "committed", operationId };
    } catch (caught) {
      return { ...identity, status: caught instanceof PigeDomainError && caught.code === "source_trash.stale" ? "stale" : "failed" };
    }
  }

  list(request: SourceTrashListRequest): SourceTrashListResult {
    const identity = { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId };
    if (!SourceTrashListRequestSchema.safeParse(request).success) return { ...identity, status: "failed" };
    const vaultPath = this.#scope(request.activeVaultId);
    if (!vaultPath) return { ...identity, status: "failed" };
    try {
      const sources = readAllReceipts(vaultPath).flatMap((receipt): SourceTrashSummary[] =>
        isRestorable(vaultPath, receipt) ? [{ sourceId: receipt.sourceId, pageId: receipt.pageId,
          title: receipt.title, storage: receipt.storage, trashedAt: receipt.createdAt,
          trashOperationId: receipt.operationId, trashRevision: trashRevision(receipt) }] : [])
        .sort((left, right) => right.trashedAt.localeCompare(left.trashedAt) ||
          left.trashOperationId.localeCompare(right.trashOperationId));
      return { ...identity, status: "ready", sources };
    } catch {
      return { ...identity, status: "failed" };
    }
  }

  restore(request: SourceTrashRestoreRequest): SourceTrashRestoreResult {
    const identity = restoreIdentity(request);
    if (!SourceTrashRestoreRequestSchema.safeParse(request).success) return { ...identity, status: "failed" };
    const vaultPath = this.#scope(request.activeVaultId);
    if (!vaultPath) return { ...identity, status: "failed" };
    try {
      const replay = readIntentByRequest(vaultPath, request.requestId);
      if (replay) return matchesIntent(replay, request)
        ? this.#completeIntent(vaultPath, replay, identity)
        : { ...identity, status: "stale" };
      const receipt = readReceiptByOperation(vaultPath, request.trashOperationId);
      if (!receipt) return { ...identity, status: "not_found" };
      if (!matchesRestoreRequest(receipt, request)) return { ...identity, status: "stale" };
      const existing = readOperation(vaultPath, restoreOperationId(receipt.operationId));
      if (existing) return matchesRestoreOperation(receipt, existing)
        ? { ...identity, status: "committed", operationId: existing.id }
        : { ...identity, status: "stale" };
      if (!isRestorable(vaultPath, receipt)) return { ...identity, status: "not_found" };
      const intent: SourceRestoreIntent = { schemaVersion: 1, kind: "source_restore_intent",
        requestId: request.requestId, activeVaultId: request.activeVaultId, sourceId: request.sourceId,
        pageId: request.pageId, trashOperationId: request.trashOperationId,
        expectedTrashRevision: request.expectedTrashRevision, createdAt: this.#now().toISOString() };
      writeExclusive(intentPathForRequest(vaultPath, request.requestId), intent, vaultPath);
      return this.#completeIntent(vaultPath, intent, identity);
    } catch (caught) {
      const status = caught instanceof PigeDomainError && caught.code === "source_trash.stale" ? "stale" :
        caught instanceof PigeDomainError && caught.code === "source_trash.not_found" ? "not_found" : "failed";
      return { ...identity, status };
    }
  }

  activitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    if (operation.kind !== "trash_source_asset") return undefined;
    const vaultPath = this.#vaults.activeVaultPath();
    const receipt = vaultPath ? readReceiptByOperation(vaultPath, operation.id) : undefined;
    if (!vaultPath || !receipt || !matchesTrashOperation(receipt, operation)) return undefined;
    const restored = undo && matchesRestoreOperation(receipt, undo);
    return { operationId: operation.id, kind: "update_source_record", createdAt: operation.createdAt,
      targetLabel: receipt.title, ...(restored ? { target: { kind: "page" as const, pageId: receipt.pageId } } : {}),
      status: restored ? "undone" : "applied", canUndo: !restored && isRestorable(vaultPath, receipt),
      ...(restored ? { undoUnavailableReason: "already_undone" as const } :
        !isRestorable(vaultPath, receipt) ? { undoUnavailableReason: "target_missing" as const } : {}) };
  }

  findUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    return operation.kind === "trash_source_asset"
      ? operations.find((candidate) => candidate.id === restoreOperationId(operation.id)) : undefined;
  }

  undo(operation: OperationRecord): KnowledgeActivityUndoResult {
    const vaultPath = this.#requireVaultPath();
    const receipt = readReceiptByOperation(vaultPath, operation.id);
    if (!receipt || !matchesTrashOperation(receipt, operation)) return { status: "not_found", operationId: operation.id };
    const existing = readOperation(vaultPath, restoreOperationId(operation.id));
    if (existing) return matchesRestoreOperation(receipt, existing)
      ? { status: "already_undone", operationId: operation.id, undoOperationId: existing.id }
      : { status: "stale", operationId: operation.id };
    try {
      const restored = completeRestore(vaultPath, receipt);
      return { status: "undone", operationId: operation.id, undoOperationId: restored.id };
    } catch (caught) {
      return { status: caught instanceof PigeDomainError && caught.code === "source_trash.not_found" ? "not_found" : "stale",
        operationId: operation.id };
    }
  }

  recoverIncompleteOperations(): { readonly recovered: number; readonly failed: number } {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0, failed = 0;
    const intents = readAllIntents(vaultPath);
    for (const intent of intents) {
      try {
        const receipt = readReceiptByOperation(vaultPath, intent.trashOperationId);
        if (!receipt || !matchesIntentReceipt(intent, receipt)) throw stale();
        const before = readOperation(vaultPath, restoreOperationId(receipt.operationId));
        completeRestore(vaultPath, receipt);
        if (!before) recovered += 1;
      } catch { failed += 1; }
    }
    const intended = new Set(intents.map(({ trashOperationId }) => trashOperationId));
    for (const receipt of readAllReceipts(vaultPath)) {
      if (intended.has(receipt.operationId) || readOperation(vaultPath, restoreOperationId(receipt.operationId))) continue;
      try {
        const before = readOperation(vaultPath, receipt.operationId);
        completeTrash(vaultPath, receipt, () => this.#assertReceiptEligible(vaultPath, receipt));
        if (!before) recovered += 1;
      } catch { failed += 1; }
    }
    return { recovered, failed };
  }

  #completeIntent(vaultPath: string, intent: SourceRestoreIntent,
    identity: ReturnType<typeof restoreIdentity>): SourceTrashRestoreResult {
    const receipt = readReceiptByOperation(vaultPath, intent.trashOperationId);
    if (!receipt) return { ...identity, status: "not_found" };
    if (!matchesIntentReceipt(intent, receipt)) return { ...identity, status: "stale" };
    const restored = completeRestore(vaultPath, receipt);
    return { ...identity, status: "committed", operationId: restored.id };
  }

  #scope(activeVaultId: string): string | undefined {
    const current = this.#vaults.current(), vaultPath = this.#vaults.activeVaultPath();
    return current?.vaultId === activeVaultId ? vaultPath : undefined;
  }
  #assertReceiptEligible(vaultPath: string, receipt: SourceTrashReceipt): void {
    if (receipt.managedAsset && (!this.#usage || this.#usage.hasActiveSourceUse(receipt.sourceId) ||
      hasOtherPageReference(vaultPath, receipt.sourceId, receipt.pageId))) throw stale();
  }
  #requireVaultPath(): string {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) throw stale();
    return vaultPath;
  }
}

function completeTrash(vaultPath: string, receipt: SourceTrashReceipt, assertEligible: () => void): void {
  const existing = readOperation(vaultPath, receipt.operationId);
  if (existing) {
    if (!matchesTrashOperation(receipt, existing) || !isRestorable(vaultPath, receipt)) throw stale();
    return;
  }
  assertEligible();
  for (const binding of [receipt.sourceRecord, receipt.sourcePage, receipt.managedAsset].filter(Boolean) as StoredFileBinding[])
    { if (binding === receipt.managedAsset) assertEligible(); moveVerified(vaultPath, binding.originalPath, binding.trashPath, binding); }
  commitOperationExclusive(vaultPath, trashOperation(receipt));
}

function completeRestore(vaultPath: string, receipt: SourceTrashReceipt): OperationRecord {
  const existing = readOperation(vaultPath, restoreOperationId(receipt.operationId));
  if (existing) {
    if (!matchesRestoreOperation(receipt, existing)) throw stale();
    return existing;
  }
  const trash = readOperation(vaultPath, receipt.operationId);
  if (!trash || !matchesTrashOperation(receipt, trash)) throw stale();
  for (const binding of [receipt.managedAsset, receipt.sourcePage, receipt.sourceRecord].filter(Boolean) as StoredFileBinding[])
    moveVerified(vaultPath, binding.trashPath, binding.originalPath, binding);
  return commitOperationExclusive(vaultPath, restoreOperation(receipt));
}

function moveVerified(vaultPath: string, fromRelative: string, toRelative: string, expected: StoredFileBinding): void {
  const from = resolveVaultRelative(vaultPath, fromRelative), to = resolveVaultRelative(vaultPath, toRelative);
  const fromExists = exists(from), toExists = exists(to);
  if (fromExists && toExists) throw stale();
  if (!fromExists && !toExists) throw missing();
  if (toExists) { assertFile(to, expected); return; }
  assertFile(from, expected); ensureSafeDirectory(vaultPath, path.dirname(to));
  assertConfinedParents(vaultPath, from); assertConfinedParents(vaultPath, to);
  fs.renameSync(from, to);
  flushDirectoryWhereSupported(path.dirname(from)); flushDirectoryWhereSupported(path.dirname(to));
  assertFile(to, expected);
}

function managedAssetBinding(vaultPath: string, record: SourceRecord, trashRoot: string): StoredFileBinding | undefined {
  if (record.storageStrategy === "reference_original") return undefined;
  const copy = record.managedCopy;
  if (!copy || (copy.rootId && copy.rootId !== "root_vault_managed") || copy.pathBasis === "root_relative") throw stale();
  const originalPath = normalizeVaultRelative(copy.path);
  const snapshot = readVerified(vaultPath, originalPath);
  if (snapshot.checksum !== copy.checksum || snapshot.size !== copy.size) throw stale();
  return { originalPath, trashPath: `${trashRoot}/managed-copy`, checksum: copy.checksum, size: copy.size };
}

function hasOtherPageReference(vaultPath: string, sourceId: string, currentPageId: string): boolean {
  let scanned = 0;
  for (const rootName of ["wiki", "sources"] as const) {
    const root = path.join(vaultPath, rootName);
    if (!exists(root)) continue;
    const pending = [root];
    while (pending.length > 0) {
      const directory = pending.pop()!;
      assertConfinedParents(vaultPath, directory);
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isSymbolicLink()) throw stale();
        const candidate = path.join(directory, entry.name);
        if (entry.isDirectory()) { pending.push(candidate); continue; }
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        scanned += 1;
        if (scanned > 100_000) throw stale();
        const stat = fs.lstatSync(candidate);
        if (stat.nlink !== 1 || stat.size > 4 * 1024 * 1024) throw stale();
        const parsed = parsePigeFrontmatter(fs.readFileSync(candidate, "utf8"));
        if (!parsed) throw stale();
        if (parsed.frontmatter.id !== currentPageId && parsed.frontmatter.source_ids?.includes(sourceId) === true) return true;
      }
    }
  }
  return false;
}

function trashOperation(receipt: SourceTrashReceipt): OperationRecord {
  return {
    id: receipt.operationId, schemaVersion: 1, createdAt: receipt.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "trash_source_asset",
    targetRefs: [{ kind: "source", id: receipt.sourceId, path: receipt.sourceRecord.trashPath },
      { kind: "page", id: receipt.pageId, path: receipt.sourcePage.trashPath }],
    sourceRefs: [{ kind: "source", id: receipt.sourceId, path: receipt.sourceRecord.originalPath },
      { kind: "page", id: receipt.pageId, path: receipt.sourcePage.originalPath }],
    before: { kind: "source", id: receipt.sourceId, path: receipt.sourceRecord.originalPath,
      checksum: receipt.sourceRecord.checksum },
    after: { kind: "source", id: receipt.sourceId, path: receipt.sourceRecord.trashPath,
      checksum: receipt.sourceRecord.checksum },
    summary: `Moved ${receipt.title} source evidence to recoverable trash.`, reversible: "best_effort",
    rollbackHint: "Restore the exact SourceRecord, Source Page, and managed copy when their original paths remain free.", warnings: []
  };
}

function restoreOperation(receipt: SourceTrashReceipt): OperationRecord {
  return {
    id: restoreOperationId(receipt.operationId), schemaVersion: 1, createdAt: new Date().toISOString(),
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "restore_source_asset",
    targetRefs: [{ kind: "source", id: receipt.sourceId, path: receipt.sourceRecord.originalPath },
      { kind: "page", id: receipt.pageId, path: receipt.sourcePage.originalPath }],
    sourceRefs: [{ kind: "operation", id: receipt.operationId },
      { kind: "source", id: receipt.sourceId, path: receipt.sourceRecord.trashPath }],
    before: { kind: "source", id: receipt.sourceId, path: receipt.sourceRecord.trashPath,
      checksum: receipt.sourceRecord.checksum },
    after: { kind: "source", id: receipt.sourceId, path: receipt.sourceRecord.originalPath,
      checksum: receipt.sourceRecord.checksum },
    summary: `Restored ${receipt.title} source evidence.`, reversible: "no", warnings: []
  };
}

function matchesTrashOperation(receipt: SourceTrashReceipt, operation: OperationRecord): boolean {
  return operation.kind === "trash_source_asset" && operation.id === receipt.operationId &&
    operation.targetRefs.some((ref) => ref.kind === "source" && ref.id === receipt.sourceId && ref.path === receipt.sourceRecord.trashPath) &&
    operation.targetRefs.some((ref) => ref.kind === "page" && ref.id === receipt.pageId && ref.path === receipt.sourcePage.trashPath) &&
    operation.before?.checksum === receipt.sourceRecord.checksum;
}
function matchesRestoreOperation(receipt: SourceTrashReceipt, operation: OperationRecord): boolean {
  return operation.kind === "restore_source_asset" && operation.id === restoreOperationId(receipt.operationId) &&
    operation.sourceRefs.some((ref) => ref.kind === "operation" && ref.id === receipt.operationId) &&
    operation.targetRefs.some((ref) => ref.kind === "source" && ref.id === receipt.sourceId && ref.path === receipt.sourceRecord.originalPath);
}

function isRestorable(vaultPath: string, receipt: SourceTrashReceipt): boolean {
  if (!matchesTrashOperation(receipt, readOperation(vaultPath, receipt.operationId) ?? ({} as OperationRecord))) return false;
  if (readOperation(vaultPath, restoreOperationId(receipt.operationId))) return false;
  return [receipt.sourceRecord, receipt.sourcePage, receipt.managedAsset].filter(Boolean)
    .every((binding) => !exists(resolveVaultRelative(vaultPath, binding!.originalPath)) &&
      verified(resolveVaultRelative(vaultPath, binding!.trashPath), binding!));
}

function readAllReceipts(vaultPath: string): SourceTrashReceipt[] {
  return readDirectory(vaultPath, receiptRoot(vaultPath), /^receipt_[a-f0-9]{32}\.json$/u, readReceipt);
}
function readAllIntents(vaultPath: string): SourceRestoreIntent[] {
  return readDirectory(vaultPath, intentRoot(vaultPath), /^intent_[a-f0-9]{32}\.json$/u, readIntent);
}
function readDirectory<T>(vaultPath: string, root: string, pattern: RegExp, reader: (filePath: string) => T): T[] {
  if (!exists(root)) return [];
  assertConfinedParents(vaultPath, root);
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile() && !entry.isSymbolicLink() && pattern.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length > MAX_RECEIPTS) throw stale();
  return entries.map((entry) => reader(path.join(root, entry.name)));
}
function readReceiptByRequest(vaultPath: string, requestId: string) { const file = receiptPathForRequest(vaultPath, requestId); return exists(file) ? readReceipt(file) : undefined; }
function readReceiptByOperation(vaultPath: string, operationId: string) { return readAllReceipts(vaultPath).find((item) => item.operationId === operationId); }
function readIntentByRequest(vaultPath: string, requestId: string) { const file = intentPathForRequest(vaultPath, requestId); return exists(file) ? readIntent(file) : undefined; }

function readReceipt(filePath: string): SourceTrashReceipt {
  const value = readJson(filePath) as SourceTrashReceipt;
  if (value?.schemaVersion !== 1 || value.kind !== "source_trash_receipt" || !OPERATION_ID.test(value.operationId) ||
    !/^sourcetrashreq_[a-z0-9]{16,64}$/u.test(value.requestId) || !/^src_\d{8}_[a-z0-9]{8,}$/u.test(value.sourceId) ||
    !/^page_\d{8}_[a-z0-9]{8,}$/u.test(value.pageId) || !Number.isFinite(Date.parse(value.createdAt)) ||
    !validBinding(value.sourceRecord) || !validBinding(value.sourcePage) || (value.managedAsset && !validBinding(value.managedAsset))) throw stale();
  return value;
}
function readIntent(filePath: string): SourceRestoreIntent {
  const value = readJson(filePath) as SourceRestoreIntent;
  if (value?.schemaVersion !== 1 || value.kind !== "source_restore_intent" || !OPERATION_ID.test(value.trashOperationId) ||
    !/^sourcetrashrestorereq_[a-z0-9]{16,64}$/u.test(value.requestId)) throw stale();
  return value;
}
function readJson(filePath: string): unknown {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_RECEIPT_BYTES) throw stale();
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readVerified(vaultPath: string, relativePath: string): { readonly checksum: string; readonly size: number } {
  const absolute = resolveVaultRelative(vaultPath, relativePath), stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw stale();
  return { checksum: hashFile(absolute), size: stat.size };
}
function assertFile(filePath: string, expected: Pick<StoredFileBinding, "checksum" | "size">): void {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== expected.size || hashFile(filePath) !== expected.checksum) throw stale();
}
function verified(filePath: string, expected: StoredFileBinding): boolean { try { assertFile(filePath, expected); return true; } catch { return false; } }
function hashFile(filePath: string): string {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try { const hash = createHash("sha256"), buffer = Buffer.allocUnsafe(64 * 1024); let offset = 0, count;
    while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, offset)) > 0) { hash.update(buffer.subarray(0, count)); offset += count; }
    return `sha256:${hash.digest("hex")}`;
  } finally { fs.closeSync(descriptor); }
}

function writeExclusive(filePath: string, value: unknown, vaultPath: string): void {
  ensureSafeDirectory(vaultPath, path.dirname(filePath));
  let descriptor: number | undefined;
  try { descriptor = fs.openSync(filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(descriptor);
  } catch (caught) {
    if (!(typeof caught === "object" && caught && "code" in caught && caught.code === "EEXIST")) throw caught;
    if (JSON.stringify(readJson(filePath)) !== JSON.stringify(value)) throw stale();
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
  flushDirectoryWhereSupported(path.dirname(filePath));
}

function ensureSafeDirectory(vaultPath: string, directory: string): void {
  const root = path.resolve(vaultPath), resolved = path.resolve(directory);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw stale();
  let current = root;
  for (const part of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { const stat = fs.lstatSync(current); if (!stat.isDirectory() || stat.isSymbolicLink()) throw stale(); }
    catch (caught) { if (!(typeof caught === "object" && caught && "code" in caught && caught.code === "ENOENT")) throw caught;
      fs.mkdirSync(current, { mode: 0o700 }); flushDirectoryWhereSupported(path.dirname(current)); }
  }
}
function assertConfinedParents(vaultPath: string, candidate: string): void {
  const root = path.resolve(vaultPath), resolved = path.resolve(candidate);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw stale();
  let current = root;
  for (const part of path.relative(root, path.dirname(resolved)).split(path.sep).filter(Boolean)) {
    current = path.join(current, part); if (!exists(current)) break;
    const stat = fs.lstatSync(current); if (!stat.isDirectory() || stat.isSymbolicLink()) throw stale();
  }
}
function resolveVaultRelative(vaultPath: string, relative: string): string { const safe = normalizeVaultRelative(relative), resolved = path.resolve(vaultPath, ...safe.split("/")); if (!resolved.startsWith(`${path.resolve(vaultPath)}${path.sep}`)) throw stale(); return resolved; }
function normalizeVaultRelative(relative: string): string { if (path.posix.isAbsolute(relative) || relative.split("/").some((part) => !part || part === "." || part === "..")) throw stale(); return relative; }
function relativeVaultPath(vaultPath: string, absolute: string): string { return normalizeVaultRelative(path.relative(vaultPath, absolute).split(path.sep).join("/")); }
function fileBinding(originalPath: string, trashPath: string, snapshot: { checksum: string; size: number }): StoredFileBinding { return { originalPath, trashPath, ...snapshot }; }
function validBinding(value: StoredFileBinding | undefined): value is StoredFileBinding { return !!value && typeof value.originalPath === "string" && typeof value.trashPath === "string" && /^sha256:[a-f0-9]{64}$/u.test(value.checksum) && Number.isSafeInteger(value.size) && value.size >= 0; }
function exists(filePath: string): boolean { try { fs.lstatSync(filePath); return true; } catch (caught) { if (typeof caught === "object" && caught && "code" in caught && caught.code === "ENOENT") return false; throw caught; } }
function receiptRoot(vaultPath: string) { return path.join(vaultPath, ".pige", "trash", "source-receipts"); }
function intentRoot(vaultPath: string) { return path.join(vaultPath, ".pige", "trash", "source-restore-intents"); }
function receiptPathForRequest(vaultPath: string, requestId: string) { return path.join(receiptRoot(vaultPath), `receipt_${hashText(requestId).slice(7, 39)}.json`); }
function intentPathForRequest(vaultPath: string, requestId: string) { return path.join(intentRoot(vaultPath), `intent_${hashText(requestId).slice(7, 39)}.json`); }
function createOperationId(createdAt: string, request: SourceTrashRequest, random: string) { return `op_${createdAt.slice(0, 10).replaceAll("-", "")}_${createHash("sha256").update(`${request.requestId}\0${request.sourceId}\0${random}`).digest("hex").slice(0, 24)}`; }
function restoreOperationId(operationId: string) { const date = OPERATION_ID.exec(operationId)?.[1]; if (!date) throw stale(); return `op_${date}_${createHash("sha256").update(`restore\0${operationId}`).digest("hex").slice(0, 24)}`; }
function requestDigest(request: SourceTrashRequest) { return hashText(JSON.stringify(request)); }
function trashRevision(receipt: SourceTrashReceipt) { return `sourcetrashrev_${createHash("sha256").update(JSON.stringify(receipt)).digest("hex")}`; }
function hashText(value: string) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function boundedTitle(value: string) { return value.replace(/[\\/\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 160) || "Saved source"; }
function trashIdentity(request: SourceTrashRequest) { return { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId, currentPageId: request.currentPageId, renderContextId: request.renderContextId, sourceId: request.sourceId, expectedSourceRevision: request.expectedSourceRevision, confirmation: request.confirmation }; }
function restoreIdentity(request: SourceTrashRestoreRequest) { return { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId, sourceId: request.sourceId, pageId: request.pageId, trashOperationId: request.trashOperationId, expectedTrashRevision: request.expectedTrashRevision }; }
function matchesRestoreRequest(receipt: SourceTrashReceipt, request: SourceTrashRestoreRequest) { return receipt.activeVaultId === request.activeVaultId && receipt.sourceId === request.sourceId && receipt.pageId === request.pageId && receipt.operationId === request.trashOperationId && trashRevision(receipt) === request.expectedTrashRevision; }
function matchesIntent(intent: SourceRestoreIntent, request: SourceTrashRestoreRequest) { return intent.requestId === request.requestId && intent.activeVaultId === request.activeVaultId && intent.sourceId === request.sourceId && intent.pageId === request.pageId && intent.trashOperationId === request.trashOperationId && intent.expectedTrashRevision === request.expectedTrashRevision; }
function matchesIntentReceipt(intent: SourceRestoreIntent, receipt: SourceTrashReceipt) { return intent.activeVaultId === receipt.activeVaultId && intent.sourceId === receipt.sourceId && intent.pageId === receipt.pageId && intent.trashOperationId === receipt.operationId && intent.expectedTrashRevision === trashRevision(receipt); }
function stale() { return new PigeDomainError("source_trash.stale", "The source evidence changed."); }
function missing() { return new PigeDomainError("source_trash.not_found", "The source evidence is unavailable."); }
