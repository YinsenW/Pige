import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  KnowledgeActivityListRequest,
  KnowledgeActivityListResult,
  KnowledgeActivitySummary,
  KnowledgeActivityUndoRequest,
  KnowledgeActivityUndoResult,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { parsePigeFrontmatter } from "@pige/markdown";
import { OperationRecordSchema, type OperationRecord } from "@pige/schemas";
import {
  assertCompletedAgentPageUpdateUndo,
  createAgentPageUpdateUndoOperationId,
  finalizeAgentPageUpdateUndo,
  hasAgentPageUpdateUndoMarker,
  isMatchingAgentPageUpdateUndo,
  readAgentPageUpdateOperationBinding
} from "./agent-page-update-service";

export interface KnowledgeActivityVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export interface KnowledgeActivityRecoveryResult {
  readonly recovered: number;
  readonly failed: number;
}

interface OperationScanResult {
  readonly operations: readonly OperationRecord[];
  readonly invalidOperationCount: number;
}

interface PrivateFileSnapshot {
  readonly bytes: Buffer;
  readonly stat: fs.Stats;
}

interface GeneratedIndexUpdate {
  readonly indexPath: string;
  readonly basePath: string;
  readonly expectedRevision: fs.Stats;
  readonly originalContent: string;
  readonly content: string;
}

const DEFAULT_ACTIVITY_LIMIT = 5;
const MAX_ACTIVITY_LIMIT = 20;
const MAX_OPERATION_SCAN_ENTRIES = 10_000;
const MAX_OPERATION_BYTES = 256 * 1024;
const MAX_OPERATION_SCAN_BYTES = 64 * 1024 * 1024;
const MAX_GENERATED_PAGE_BYTES = 1024 * 1024;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const GENERATED_PAGE_ID = /^page_\d{8}_[a-z0-9]{8,}$/u;
const GENERATED_PAGE_PATH = /^wiki\/generated\/\d{4}\/page_\d{8}_[a-z0-9]{8,}\.md$/u;
const OPERATION_ID = /^op_\d{8}_[a-z0-9]{8,}$/u;
const CONTENT_HASH = /^sha256:[a-f0-9]{64}$/u;

export class KnowledgeActivityService {
  readonly #vaults: KnowledgeActivityVaultPort;

  constructor(vaults: KnowledgeActivityVaultPort) {
    this.#vaults = vaults;
  }

  list(request: KnowledgeActivityListRequest = {}): KnowledgeActivityListResult {
    if (!request || typeof request !== "object") {
      throw new PigeDomainError("activity.invalid_request", "The Activity list request is invalid.");
    }
    const activeVault = this.#requireActiveVault();
    const vaultPath = this.#requireActiveVaultPath();
    const scan = readOperationRecords(vaultPath);
    const undoByOperationId = createUndoOperationMap(scan.operations);
    const activities = scan.operations
      .filter(isKnowledgeActivityOperation)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));

    return {
      scannedAt: new Date().toISOString(),
      activeVaultId: activeVault.vaultId,
      total: activities.length,
      invalidOperationCount: scan.invalidOperationCount,
      activities: activities
        .slice(0, clampLimit(request.limit))
        .map((operation) => toActivitySummary(vaultPath, operation, undoByOperationId.get(operation.id)))
    };
  }

  undo(request: KnowledgeActivityUndoRequest): KnowledgeActivityUndoResult {
    if (
      !request ||
      typeof request !== "object" ||
      typeof request.operationId !== "string" ||
      !OPERATION_ID.test(request.operationId)
    ) {
      throw new PigeDomainError("activity.invalid_operation_id", "The Activity operation identity is invalid.");
    }
    const vaultPath = this.#requireActiveVaultPath();
    const scan = readOperationRecords(vaultPath);
    const operation = scan.operations.find((candidate) => candidate.id === request.operationId);
    if (!operation || !isKnowledgeActivityOperation(operation)) {
      throw new PigeDomainError("activity.not_allowed", "This Activity cannot be undone by the current bounded path.");
    }
    const existingUndo = createUndoOperationMap(scan.operations).get(operation.id);
    if (existingUndo) {
      assertCompletedUndoState(vaultPath, operation, existingUndo);
      return {
        status: "already_undone",
        operationId: operation.id,
        undoOperationId: existingUndo.id
      };
    }
    assertUndoOperationIdentityAvailable(scan.operations, operation);

    const undoOperation = isGeneratedCreatePageOperation(operation)
      ? finalizeCreatePageUndo(vaultPath, operation, true)
      : finalizeAgentPageUpdateUndo(vaultPath, operation, true);
    if (!undoOperation) {
      throw new PigeDomainError("activity.target_missing", "The generated page is no longer available to undo.");
    }
    return {
      status: "undone",
      operationId: operation.id,
      undoOperationId: undoOperation.id
    };
  }

  recoverIncompleteUndos(): KnowledgeActivityRecoveryResult {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    const scan = readOperationRecords(vaultPath);
    const undoByOperationId = createUndoOperationMap(scan.operations);
    let recovered = 0;
    let failed = 0;
    for (const operation of scan.operations.filter(isGeneratedCreatePageOperation)) {
      const existingUndo = undoByOperationId.get(operation.id);
      if (existingUndo) {
        try {
          assertCompletedUndoState(vaultPath, operation, existingUndo);
        } catch {
          failed += 1;
        }
        continue;
      }
      if (!pathExists(resolveVaultPath(vaultPath, trashPathFor(operation)))) {
        continue;
      }
      try {
        assertUndoOperationIdentityAvailable(scan.operations, operation);
        if (finalizeCreatePageUndo(vaultPath, operation, false)) recovered += 1;
      } catch {
        failed += 1;
      }
    }
    for (const operation of scan.operations.filter(isAgentPageUpdateOperation)) {
      const existingUndo = undoByOperationId.get(operation.id);
      if (existingUndo) {
        try {
          assertCompletedUndoState(vaultPath, operation, existingUndo);
        } catch {
          failed += 1;
        }
        continue;
      }
      try {
        if (!hasAgentPageUpdateUndoMarker(vaultPath, operation)) continue;
        assertUndoOperationIdentityAvailable(scan.operations, operation);
        if (finalizeAgentPageUpdateUndo(vaultPath, operation, false)) recovered += 1;
      } catch {
        failed += 1;
      }
    }
    return { recovered, failed };
  }

  #requireActiveVault(): VaultSummary {
    const activeVault = this.#vaults.current();
    if (!activeVault) throw new PigeDomainError("vault.not_open", "Open a vault before reading Activity.");
    return activeVault;
  }

  #requireActiveVaultPath(): string {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) throw new PigeDomainError("vault.not_open", "Open a vault before changing Activity.");
    assertSafeRoot(vaultPath);
    return vaultPath;
  }
}

function toActivitySummary(
  vaultPath: string,
  operation: OperationRecord,
  undoOperation: OperationRecord | undefined
): KnowledgeActivitySummary {
  if (isAgentPageUpdateOperation(operation)) {
    return toPageUpdateActivitySummary(vaultPath, operation, undoOperation);
  }
  const targetLabel = readActivityTargetLabel(vaultPath, operation, undoOperation);
  if (undoOperation) {
    return {
      operationId: operation.id,
      kind: "create_page",
      createdAt: operation.createdAt,
      ...(targetLabel ? { targetLabel } : {}),
      status: "undone",
      canUndo: false,
      undoUnavailableReason: "already_undone"
    };
  }
  const binding = generatedPageBinding(operation);
  if (!binding) {
    return {
      operationId: operation.id,
      kind: "create_page",
      createdAt: operation.createdAt,
      ...(targetLabel ? { targetLabel } : {}),
      status: "applied",
      canUndo: false,
      undoUnavailableReason: "legacy_record"
    };
  }
  const absolutePagePath = resolveVaultPath(vaultPath, binding.pagePath);
  if (!pathExists(absolutePagePath)) {
    const pendingTrashPath = resolveVaultPath(vaultPath, trashPathFor(operation));
    if (pathExists(pendingTrashPath)) {
      try {
        const pendingTrash = readPrivateFile(vaultPath, pendingTrashPath, MAX_GENERATED_PAGE_BYTES, 1);
        if (hashBytes(pendingTrash.bytes) === binding.contentHash) {
          return {
            operationId: operation.id,
            kind: "create_page",
            createdAt: operation.createdAt,
            ...(targetLabel ? { targetLabel } : {}),
            status: "applied",
            canUndo: true
          };
        }
      } catch {
        // Fall through to the fail-closed missing-target summary.
      }
    }
    return {
      operationId: operation.id,
      kind: "create_page",
      createdAt: operation.createdAt,
      ...(targetLabel ? { targetLabel } : {}),
      status: "applied",
      canUndo: false,
      undoUnavailableReason: "target_missing"
    };
  }
  try {
    const current = readPrivateFile(vaultPath, absolutePagePath, MAX_GENERATED_PAGE_BYTES, 1);
    const currentHash = hashBytes(current.bytes);
    return {
      operationId: operation.id,
      kind: "create_page",
      createdAt: operation.createdAt,
      ...(targetLabel ? { targetLabel } : {}),
      status: "applied",
      canUndo: currentHash === binding.contentHash,
      ...(currentHash === binding.contentHash ? {} : { undoUnavailableReason: "content_changed" as const })
    };
  } catch {
    return {
      operationId: operation.id,
      kind: "create_page",
      createdAt: operation.createdAt,
      ...(targetLabel ? { targetLabel } : {}),
      status: "applied",
      canUndo: false,
      undoUnavailableReason: "content_changed"
    };
  }
}

function toPageUpdateActivitySummary(
  vaultPath: string,
  operation: OperationRecord,
  undoOperation: OperationRecord | undefined
): KnowledgeActivitySummary {
  const targetLabel = readActivityTargetLabel(vaultPath, operation, undoOperation);
  if (undoOperation) {
    return {
      operationId: operation.id,
      kind: "update_page",
      createdAt: operation.createdAt,
      ...(targetLabel ? { targetLabel } : {}),
      status: "undone",
      canUndo: false,
      undoUnavailableReason: "already_undone"
    };
  }
  const binding = readAgentPageUpdateOperationBinding(operation);
  if (!binding) {
    return {
      operationId: operation.id,
      kind: "update_page",
      createdAt: operation.createdAt,
      ...(targetLabel ? { targetLabel } : {}),
      status: "applied",
      canUndo: false,
      undoUnavailableReason: "legacy_record"
    };
  }
  const pagePath = resolveVaultPath(vaultPath, binding.pagePath);
  if (!pathExists(pagePath)) {
    return {
      operationId: operation.id,
      kind: "update_page",
      createdAt: operation.createdAt,
      ...(targetLabel ? { targetLabel } : {}),
      status: "applied",
      canUndo: false,
      undoUnavailableReason: "target_missing"
    };
  }
  try {
    const current = readPrivateFile(vaultPath, pagePath, MAX_GENERATED_PAGE_BYTES, 1);
    const canUndo = hashBytes(current.bytes) === binding.afterHash;
    return {
      operationId: operation.id,
      kind: "update_page",
      createdAt: operation.createdAt,
      ...(targetLabel ? { targetLabel } : {}),
      status: "applied",
      canUndo,
      ...(canUndo ? {} : { undoUnavailableReason: "content_changed" as const })
    };
  } catch {
    return {
      operationId: operation.id,
      kind: "update_page",
      createdAt: operation.createdAt,
      ...(targetLabel ? { targetLabel } : {}),
      status: "applied",
      canUndo: false,
      undoUnavailableReason: "content_changed"
    };
  }
}

function readActivityTargetLabel(
  vaultPath: string,
  operation: OperationRecord,
  undoOperation: OperationRecord | undefined
): string | undefined {
  const updateBinding = readAgentPageUpdateOperationBinding(operation);
  if (updateBinding) {
    try {
      const snapshot = readPrivateFile(
        vaultPath,
        resolveVaultPath(vaultPath, updateBinding.pagePath),
        MAX_GENERATED_PAGE_BYTES,
        1
      );
      const expectedHash = undoOperation ? updateBinding.beforeHash : updateBinding.afterHash;
      if (hashBytes(snapshot.bytes) !== expectedHash) return undefined;
      const title = parsePigeFrontmatter(snapshot.bytes.toString("utf8"))?.frontmatter.title
        ?.replace(/\s+/gu, " ").trim().slice(0, 120);
      return title || undefined;
    } catch {
      return undefined;
    }
  }
  const binding = generatedPageBinding(operation);
  if (!binding) return undefined;
  const relativePath = undoOperation?.targetRefs[0]?.path ?? operation.targetRefs[0]?.path;
  if (!relativePath) return undefined;
  const preferredPath = undoOperation
    ? relativePath
    : pathExists(resolveVaultPath(vaultPath, relativePath))
      ? relativePath
      : trashPathFor(operation);
  try {
    const snapshot = readPrivateFile(
      vaultPath,
      resolveVaultPath(vaultPath, preferredPath),
      MAX_GENERATED_PAGE_BYTES,
      1
    );
    if (hashBytes(snapshot.bytes) !== binding.contentHash) return undefined;
    const body = snapshot.bytes.toString("utf8");
    const title = parsePigeFrontmatter(body)?.frontmatter.title?.replace(/\s+/gu, " ").trim().slice(0, 120);
    return title || undefined;
  } catch {
    return undefined;
  }
}

function finalizeCreatePageUndo(
  vaultPath: string,
  operation: OperationRecord,
  allowStart: boolean
): OperationRecord | undefined {
  const binding = generatedPageBinding(operation);
  if (!binding) {
    throw new PigeDomainError("activity.legacy_record", "This Operation does not contain a verifiable result hash.");
  }
  const pagePath = resolveVaultPath(vaultPath, binding.pagePath);
  const trashRelativePath = trashPathFor(operation);
  const trashPath = resolveVaultPath(vaultPath, trashRelativePath);
  const pageExists = pathExists(pagePath);
  const trashExists = pathExists(trashPath);

  if (!trashExists && !allowStart) return undefined;
  if (!pageExists && !trashExists) return undefined;
  const indexUpdate = prepareGeneratedIndexUpdate(vaultPath, binding.pagePath, operation.id);
  if (pageExists && !trashExists) {
    moveGeneratedPageToTrash(vaultPath, pagePath, trashPath, binding.contentHash);
  } else if (trashExists) {
    adoptOrFinishTrashMove(vaultPath, pagePath, trashPath, binding.contentHash);
  }

  if (indexUpdate) {
    replaceIndexConflictPreserving(vaultPath, operation.id, indexUpdate);
  }
  if (pathExists(pagePath)) {
    throw new PigeDomainError("activity.undo_conflict", "The generated page reappeared before Undo completed.");
  }
  const undoOperation = createUndoOperation(operation, trashRelativePath, binding.contentHash);
  return commitOperationExclusive(vaultPath, undoOperation);
}

function moveGeneratedPageToTrash(
  vaultPath: string,
  pagePath: string,
  trashPath: string,
  expectedHash: string
): void {
  const source = readPrivateFile(vaultPath, pagePath, MAX_GENERATED_PAGE_BYTES, 1);
  if (hashBytes(source.bytes) !== expectedHash) {
    throw new PigeDomainError("activity.content_changed", "The generated page changed after the recorded Operation.");
  }
  ensureSafeDirectory(vaultPath, path.dirname(trashPath));
  const sourceParent = captureSafeDirectoryIdentity(vaultPath, path.dirname(pagePath));
  const trashParent = captureSafeDirectoryIdentity(vaultPath, path.dirname(trashPath));
  if (pathExists(trashPath)) {
    adoptOrFinishTrashMove(vaultPath, pagePath, trashPath, expectedHash);
    return;
  }
  assertSafeDirectoryIdentity(vaultPath, path.dirname(pagePath), sourceParent);
  assertSafeDirectoryIdentity(vaultPath, path.dirname(trashPath), trashParent);
  try {
    fs.linkSync(pagePath, trashPath);
  } catch (caught) {
    if (isErrno(caught, "EEXIST")) {
      adoptOrFinishTrashMove(vaultPath, pagePath, trashPath, expectedHash);
      return;
    }
    throw new PigeDomainError("activity.undo_unavailable", "The generated page could not be moved to recoverable trash.");
  }
  assertSafeDirectoryIdentity(vaultPath, path.dirname(pagePath), sourceParent);
  assertSafeDirectoryIdentity(vaultPath, path.dirname(trashPath), trashParent);
  const linkedSource = readPrivateFile(vaultPath, pagePath, MAX_GENERATED_PAGE_BYTES, 2);
  const linkedTrash = readPrivateFile(vaultPath, trashPath, MAX_GENERATED_PAGE_BYTES, 2);
  if (
    !sameInode(linkedSource.stat, linkedTrash.stat) ||
    hashBytes(linkedSource.bytes) !== expectedHash ||
    hashBytes(linkedTrash.bytes) !== expectedHash
  ) {
    throw new PigeDomainError("activity.content_changed", "The generated page changed while Undo was being committed.");
  }
  assertSafeDirectoryIdentity(vaultPath, path.dirname(pagePath), sourceParent);
  assertSafeDirectoryIdentity(vaultPath, path.dirname(trashPath), trashParent);
  flushDirectory(path.dirname(trashPath));
  removeVerifiedSourceLinkViaQuarantine(
    vaultPath,
    pagePath,
    sourceQuarantinePath(pagePath, trashPath),
    linkedSource.stat,
    expectedHash,
    MAX_GENERATED_PAGE_BYTES
  );
  const committedTrash = readPrivateFile(vaultPath, trashPath, MAX_GENERATED_PAGE_BYTES, 1);
  if (hashBytes(committedTrash.bytes) !== expectedHash) {
    throw new PigeDomainError("activity.undo_unavailable", "The trashed page could not be verified after Undo.");
  }
}

function adoptOrFinishTrashMove(
  vaultPath: string,
  pagePath: string,
  trashPath: string,
  expectedHash: string
): void {
  const pageStillExists = pathExists(pagePath);
  const quarantinePath = sourceQuarantinePath(pagePath, trashPath);
  const quarantineExists = pathExists(quarantinePath);
  const trash = readPrivateFile(
    vaultPath,
    trashPath,
    MAX_GENERATED_PAGE_BYTES,
    pageStillExists || quarantineExists ? 2 : 1
  );
  if (hashBytes(trash.bytes) !== expectedHash) {
    throw new PigeDomainError("activity.undo_conflict", "The deterministic trash target contains different content.");
  }
  if (pageStillExists) {
    const source = readPrivateFile(vaultPath, pagePath, MAX_GENERATED_PAGE_BYTES, 2);
    if (!sameInode(source.stat, trash.stat) || hashBytes(source.bytes) !== expectedHash) {
      throw new PigeDomainError("activity.undo_conflict", "The generated page and trash target are not one interrupted Undo.");
    }
  }
  if (pageStillExists || quarantineExists) {
    flushDirectory(path.dirname(trashPath));
    removeVerifiedSourceLinkViaQuarantine(
      vaultPath,
      pagePath,
      quarantinePath,
      trash.stat,
      expectedHash,
      MAX_GENERATED_PAGE_BYTES
    );
  }
  const committedTrash = readPrivateFile(vaultPath, trashPath, MAX_GENERATED_PAGE_BYTES, 1);
  if (hashBytes(committedTrash.bytes) !== expectedHash) {
    throw new PigeDomainError("activity.undo_unavailable", "The interrupted Undo could not be finalized safely.");
  }
}

function removeVerifiedSourceLinkViaQuarantine(
  vaultPath: string,
  sourcePath: string,
  quarantinePath: string,
  expected: fs.Stats,
  expectedHash: string,
  maximumBytes: number
): void {
  const sourceParent = captureSafeDirectoryIdentity(vaultPath, path.dirname(sourcePath));
  const quarantineParent = captureSafeDirectoryIdentity(vaultPath, path.dirname(quarantinePath));
  const sourceExists = pathExists(sourcePath);
  const quarantineExists = pathExists(quarantinePath);
  if (sourceExists && quarantineExists) {
    throw new PigeDomainError("activity.undo_conflict", "The source and its private Undo quarantine both exist.");
  }
  if (!sourceExists && !quarantineExists) {
    throw new PigeDomainError("activity.undo_conflict", "The source link disappeared before private quarantine.");
  }
  if (sourceExists) {
    assertSafeDirectoryIdentity(vaultPath, path.dirname(sourcePath), sourceParent);
    assertSafeDirectoryIdentity(vaultPath, path.dirname(quarantinePath), quarantineParent);
    fs.renameSync(sourcePath, quarantinePath);
  }
  const quarantined = readPrivateFile(vaultPath, quarantinePath, maximumBytes, 2);
  if (!sameInode(expected, quarantined.stat) || hashBytes(quarantined.bytes) !== expectedHash) {
    restoreUnexpectedQuarantine(vaultPath, sourcePath, quarantinePath, quarantined.stat, sourceParent);
    throw new PigeDomainError("activity.undo_conflict", "An unexpected source replacement was preserved during Undo.");
  }
  flushDirectory(path.dirname(quarantinePath));
  flushDirectory(path.dirname(sourcePath));
  assertSafeDirectoryIdentity(vaultPath, path.dirname(sourcePath), sourceParent);
  assertSafeDirectoryIdentity(vaultPath, path.dirname(quarantinePath), quarantineParent);
  const currentQuarantine = fs.lstatSync(quarantinePath);
  if (!sameInode(quarantined.stat, currentQuarantine)) {
    throw new PigeDomainError("activity.undo_conflict", "The private Undo quarantine changed before cleanup.");
  }
  fs.unlinkSync(quarantinePath);
  flushDirectory(path.dirname(quarantinePath));
}

function restoreUnexpectedQuarantine(
  vaultPath: string,
  sourcePath: string,
  quarantinePath: string,
  quarantineIdentity: fs.Stats,
  sourceParent: fs.Stats
): void {
  try {
    assertSafeDirectoryIdentity(vaultPath, path.dirname(sourcePath), sourceParent);
    fs.linkSync(quarantinePath, sourcePath);
    const restored = fs.lstatSync(sourcePath);
    if (sameInode(quarantineIdentity, restored)) flushDirectory(path.dirname(sourcePath));
  } catch {
    // Preserve the quarantined replacement when its original path cannot be restored exclusively.
  }
}

function sourceQuarantinePath(sourcePath: string, durablePath: string): string {
  return path.join(path.dirname(durablePath), `.${path.basename(sourcePath)}.source-quarantine`);
}

function prepareGeneratedIndexUpdate(
  vaultPath: string,
  pagePath: string,
  operationId: string
): GeneratedIndexUpdate | undefined {
  const indexPath = path.join(vaultPath, "index.md");
  const backupPath = indexBackupPath(vaultPath, operationId);
  reconcilePreservedIndexLink(vaultPath, indexPath, backupPath, pagePath);
  const basePath = pathExists(backupPath) ? backupPath : pathExists(indexPath) ? indexPath : undefined;
  if (!basePath) return undefined;
  const snapshot = readPrivateFile(vaultPath, basePath, MAX_INDEX_BYTES, 1);
  const text = snapshot.bytes.toString("utf8");
  const lines = text.split(/(?<=\n)/u);
  const matches = indexLinkLineIndexes(lines, pagePath);
  if (matches.length > 1) {
    throw new PigeDomainError("activity.index_conflict", "The generated-note index contains ambiguous duplicate entries.");
  }
  if (matches.length === 0) return undefined;
  const next = lines.filter((_, index) => index !== matches[0]).join("");
  return {
    indexPath,
    basePath,
    expectedRevision: snapshot.stat,
    originalContent: text,
    content: next
  };
}

function createUndoOperation(
  operation: OperationRecord,
  trashRelativePath: string,
  contentHash: string
): OperationRecord {
  const target = operation.targetRefs[0];
  if (!target?.id || !target.path) {
    throw new PigeDomainError("activity.operation_conflict", "The Activity target binding is incomplete.");
  }
  return OperationRecordSchema.parse({
    id: createUndoOperationId(operation.id),
    schemaVersion: 1,
    ...(operation.jobId ? { jobId: operation.jobId } : {}),
    createdAt: new Date().toISOString(),
    actor: {
      kind: "user",
      runtimeKind: "desktop_local",
      clientCapabilityTier: "desktop_full"
    },
    permissionDecisionIds: [],
    kind: "trash_page",
    targetRefs: [{ kind: "page", id: target.id, path: trashRelativePath }],
    sourceRefs: [
      { kind: "operation", id: operation.id },
      { kind: "page", id: target.id, path: target.path }
    ],
    before: { kind: "page", id: contentHash, path: target.path },
    after: { kind: "page", id: contentHash, path: trashRelativePath },
    summary: `Undid ${boundedSummary(operation.summary)} The generated page was moved to recoverable trash.`,
    reversible: "best_effort",
    rollbackHint: "Restore the unchanged page from Pige trash after checking that its original path is free.",
    warnings: []
  });
}

function generatedPageBinding(operation: OperationRecord): {
  readonly pagePath: string;
  readonly contentHash: string;
} | undefined {
  const target = operation.targetRefs[0];
  const after = operation.after;
  if (
    operation.targetRefs.length !== 1 ||
    target?.kind !== "page" ||
    !target.id ||
    !target.path ||
    !GENERATED_PAGE_ID.test(target.id) ||
    !GENERATED_PAGE_PATH.test(target.path) ||
    path.posix.basename(target.path) !== `${target.id}.md` ||
    after?.kind !== "page" ||
    after.path !== target.path ||
    !CONTENT_HASH.test(after.id)
  ) {
    return undefined;
  }
  return { pagePath: target.path, contentHash: after.id };
}

function isGeneratedCreatePageOperation(operation: OperationRecord): boolean {
  const target = operation.targetRefs[0];
  return operation.kind === "create_page" &&
    operation.reversible !== "no" &&
    operation.targetRefs.length === 1 &&
    target?.kind === "page" &&
    typeof target.id === "string" &&
    typeof target.path === "string" &&
    GENERATED_PAGE_ID.test(target.id) &&
    GENERATED_PAGE_PATH.test(target.path) &&
    path.posix.basename(target.path) === `${target.id}.md`;
}

function isAgentPageUpdateOperation(operation: OperationRecord): boolean {
  return readAgentPageUpdateOperationBinding(operation) !== undefined;
}

function isKnowledgeActivityOperation(operation: OperationRecord): boolean {
  return isGeneratedCreatePageOperation(operation) || isAgentPageUpdateOperation(operation);
}

function createUndoOperationMap(operations: readonly OperationRecord[]): Map<string, OperationRecord> {
  const result = new Map<string, OperationRecord>();
  const byId = new Map(operations.map((operation) => [operation.id, operation]));
  for (const operation of operations.filter(isGeneratedCreatePageOperation)) {
    const candidate = byId.get(createUndoOperationId(operation.id));
    if (candidate && isMatchingUndoOperation(operation, candidate)) result.set(operation.id, candidate);
  }
  for (const operation of operations.filter(isAgentPageUpdateOperation)) {
    const candidate = byId.get(createAgentPageUpdateUndoOperationId(operation.id));
    if (candidate && isMatchingAgentPageUpdateUndo(operation, candidate)) result.set(operation.id, candidate);
  }
  return result;
}

function assertUndoOperationIdentityAvailable(
  operations: readonly OperationRecord[],
  operation: OperationRecord
): void {
  const candidateId = isAgentPageUpdateOperation(operation)
    ? createAgentPageUpdateUndoOperationId(operation.id)
    : createUndoOperationId(operation.id);
  const candidate = operations.find((entry) => entry.id === candidateId);
  const matches = candidate && (isAgentPageUpdateOperation(operation)
    ? isMatchingAgentPageUpdateUndo(operation, candidate)
    : isMatchingUndoOperation(operation, candidate));
  if (candidate && !matches) {
    throw new PigeDomainError(
      "activity.operation_conflict",
      "The deterministic Undo Operation identity is already occupied by different audit facts."
    );
  }
}

function isMatchingUndoOperation(operation: OperationRecord, candidate: OperationRecord): boolean {
  const binding = generatedPageBinding(operation);
  const target = operation.targetRefs[0];
  const candidateTarget = candidate.targetRefs[0];
  const expectedTrashPath = trashPathFor(operation);
  return binding !== undefined &&
    target?.id !== undefined &&
    candidate.kind === "trash_page" &&
    candidate.id === createUndoOperationId(operation.id) &&
    candidate.jobId === operation.jobId &&
    candidate.actor.kind === "user" &&
    candidate.permissionDecisionIds.length === 0 &&
    candidate.reversible === "best_effort" &&
    candidate.targetRefs.length === 1 &&
    candidateTarget?.kind === "page" &&
    candidateTarget.id === target.id &&
    candidateTarget.path === expectedTrashPath &&
    candidate.sourceRefs.length === 2 &&
    candidate.sourceRefs.some((ref) => ref.kind === "operation" && ref.id === operation.id) &&
    candidate.sourceRefs.some((ref) => ref.kind === "page" && ref.id === target.id && ref.path === binding.pagePath) &&
    candidate.before?.kind === "page" &&
    candidate.before.id === binding.contentHash &&
    candidate.before.path === binding.pagePath &&
    candidate.after?.kind === "page" &&
    candidate.after.id === binding.contentHash &&
    candidate.after.path === expectedTrashPath;
}

function assertCompletedUndoState(
  vaultPath: string,
  operation: OperationRecord,
  undoOperation: OperationRecord
): void {
  if (isAgentPageUpdateOperation(operation)) {
    assertCompletedAgentPageUpdateUndo(vaultPath, operation, undoOperation);
    return;
  }
  if (!isMatchingUndoOperation(operation, undoOperation)) {
    throw new PigeDomainError("activity.operation_conflict", "The Undo Operation bindings are inconsistent.");
  }
  const binding = generatedPageBinding(operation);
  if (!binding) {
    throw new PigeDomainError("activity.operation_conflict", "The original create Operation is not checksum-bound.");
  }
  const pagePath = resolveVaultPath(vaultPath, binding.pagePath);
  if (pathExists(pagePath)) {
    throw new PigeDomainError("activity.undo_conflict", "The original page path reappeared after Undo.");
  }
  const trashPath = resolveVaultPath(vaultPath, trashPathFor(operation));
  if (!pathExists(trashPath)) {
    throw new PigeDomainError("activity.undo_conflict", "The recoverable trash target is missing after Undo.");
  }
  const trash = readPrivateFile(vaultPath, trashPath, MAX_GENERATED_PAGE_BYTES, 1);
  if (hashBytes(trash.bytes) !== binding.contentHash) {
    throw new PigeDomainError("activity.undo_conflict", "The recoverable trash target changed after Undo.");
  }
  const indexPath = path.join(vaultPath, "index.md");
  if (pathExists(indexPath)) {
    const index = readPrivateFile(vaultPath, indexPath, MAX_INDEX_BYTES, 1);
    if (indexLinkLineIndexes(index.bytes.toString("utf8").split(/(?<=\n)/u), binding.pagePath).length > 0) {
      throw new PigeDomainError("activity.undo_conflict", "The live index references a page that was already undone.");
    }
  }
}

function trashPathFor(operation: OperationRecord): string {
  const target = operation.targetRefs[0];
  if (!target?.path) throw new PigeDomainError("activity.operation_conflict", "The Activity page path is missing.");
  return [".pige", "trash", "pages", operation.id, path.posix.basename(target.path)].join("/");
}

function createUndoOperationId(operationId: string): string {
  const dateKey = /^op_(\d{8})_/.exec(operationId)?.[1];
  if (!dateKey) throw new PigeDomainError("activity.invalid_operation_id", "The Activity operation identity is invalid.");
  const digest = createHash("sha256")
    .update("pige.activity.undo.create-page.v1\0", "utf8")
    .update(operationId, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `op_${dateKey}_${digest}`;
}

function readOperationRecords(vaultPath: string): OperationScanResult {
  const root = path.join(vaultPath, ".pige", "operations");
  if (!pathExists(root)) return { operations: [], invalidOperationCount: 0 };
  assertSafeDirectory(vaultPath, root);
  const files: string[] = [];
  const state = { entries: 0, bytes: 0, invalid: 0, temporaryFiles: [] as string[] };
  collectOperationFiles(vaultPath, root, root, 0, files, state);
  for (const temporaryPath of state.temporaryFiles) {
    try {
      reconcileOperationTemporary(vaultPath, temporaryPath);
    } catch {
      state.invalid += 1;
    }
  }
  const operations: OperationRecord[] = [];
  for (const filePath of files) {
    try {
      const snapshot = readPrivateFile(vaultPath, filePath, MAX_OPERATION_BYTES, 1);
      const operation = OperationRecordSchema.parse(JSON.parse(snapshot.bytes.toString("utf8")));
      if (
        path.basename(filePath) !== `${operation.id}.json` ||
        path.resolve(filePath) !== path.resolve(operationFilePath(vaultPath, operation.id))
      ) {
        throw new Error("Operation file identity mismatch.");
      }
      operations.push(operation);
    } catch {
      state.invalid += 1;
    }
  }
  return { operations, invalidOperationCount: state.invalid };
}

function collectOperationFiles(
  vaultPath: string,
  root: string,
  directory: string,
  depth: number,
  files: string[],
  state: { entries: number; bytes: number; invalid: number; temporaryFiles: string[] }
): void {
  assertSafeDirectory(vaultPath, directory);
  const handle = fs.opendirSync(directory);
  try {
    for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
      state.entries += 1;
      if (state.entries > MAX_OPERATION_SCAN_ENTRIES) {
        throw new PigeDomainError("activity.scan_limit", "The durable Operation store exceeds its bounded scan limit.");
      }
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        state.invalid += 1;
        continue;
      }
      if (entry.isDirectory()) {
        const validDirectory = depth === 0 ? /^\d{4}$/u.test(entry.name) : /^\d{2}$/u.test(entry.name);
        if (!validDirectory || depth >= 2) {
          state.invalid += 1;
          continue;
        }
        collectOperationFiles(vaultPath, root, fullPath, depth + 1, files, state);
        continue;
      }
      const isOperation = entry.isFile() &&
        depth === 2 &&
        /^op_\d{8}_[a-z0-9]{8,}\.json$/u.test(entry.name);
      const isTemporary = entry.isFile() &&
        depth === 2 &&
        /^\.op_\d{8}_[a-z0-9]{8,}\.\d+\.[a-f0-9-]{16,}\.tmp$/u.test(entry.name);
      if (!isOperation && !isTemporary) {
        state.invalid += 1;
        continue;
      }
      const stat = fs.lstatSync(fullPath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        state.invalid += 1;
        continue;
      }
      state.bytes += stat.size;
      if (state.bytes > MAX_OPERATION_SCAN_BYTES) {
        throw new PigeDomainError("activity.scan_limit", "The durable Operation store exceeds its bounded byte limit.");
      }
      if (isOperation) files.push(fullPath);
      else state.temporaryFiles.push(fullPath);
    }
  } finally {
    handle.closeSync();
  }
}

function reconcileOperationTemporary(vaultPath: string, temporaryPath: string): void {
  const operationId = /^\.(op_\d{8}_[a-z0-9]{8,})\./u.exec(path.basename(temporaryPath))?.[1];
  if (!operationId) {
    throw new PigeDomainError("activity.operation_conflict", "An Operation temporary identity is invalid.");
  }
  const operationPath = operationFilePath(vaultPath, operationId);
  const directory = path.dirname(temporaryPath);
  const parent = captureSafeDirectoryIdentity(vaultPath, directory);
  if (!pathExists(operationPath)) {
    const temporary = readPrivateFile(vaultPath, temporaryPath, MAX_OPERATION_BYTES, 1);
    if (temporary.stat.nlink !== 1) {
      throw new PigeDomainError("activity.operation_conflict", "An uncommitted Operation temporary has extra links.");
    }
    assertSafeDirectoryIdentity(vaultPath, directory, parent);
    const currentTemporary = fs.lstatSync(temporaryPath);
    if (!sameInode(temporary.stat, currentTemporary)) {
      throw new PigeDomainError("activity.operation_conflict", "An uncommitted Operation temporary changed during cleanup.");
    }
    fs.unlinkSync(temporaryPath);
    flushDirectory(directory);
    return;
  }
  const temporary = readPrivateFile(vaultPath, temporaryPath, MAX_OPERATION_BYTES, 2);
  const operation = readPrivateFile(vaultPath, operationPath, MAX_OPERATION_BYTES, 2);
  if (
    temporary.stat.nlink !== 2 ||
    operation.stat.nlink !== 2 ||
    !sameInode(temporary.stat, operation.stat) ||
    !temporary.bytes.equals(operation.bytes)
  ) {
    throw new PigeDomainError(
      "activity.operation_conflict",
      "An interrupted Operation commit does not have one matching private inode."
    );
  }
  flushDirectory(directory);
  assertSafeDirectoryIdentity(vaultPath, directory, parent);
  const currentTemporary = fs.lstatSync(temporaryPath);
  const currentOperation = fs.lstatSync(operationPath);
  if (!sameInode(temporary.stat, currentTemporary) || !sameInode(operation.stat, currentOperation)) {
    throw new PigeDomainError("activity.operation_conflict", "The interrupted Operation changed during cleanup.");
  }
  fs.unlinkSync(temporaryPath);
  const committed = readPrivateFile(vaultPath, operationPath, MAX_OPERATION_BYTES, 1);
  if (!committed.bytes.equals(operation.bytes)) {
    throw new PigeDomainError("activity.operation_conflict", "The recovered Operation changed during commit cleanup.");
  }
  flushDirectory(directory);
}

function commitOperationExclusive(vaultPath: string, operation: OperationRecord): OperationRecord {
  const operationPath = operationFilePath(vaultPath, operation.id);
  const directory = path.dirname(operationPath);
  ensureSafeDirectory(vaultPath, directory);
  if (pathExists(operationPath)) return requireMatchingOperation(vaultPath, operationPath, operation);
  const parent = captureSafeDirectoryIdentity(vaultPath, directory);
  const temporaryPath = path.join(
    directory,
    `.${operation.id}.${process.pid}.${randomUUID()}.tmp`
  );
  const serialized = `${JSON.stringify(operation, null, 2)}\n`;
  let descriptor: number | undefined;
  let temporaryIdentity: fs.Stats | undefined;
  let linkedOperation = false;
  let operationLinkDurable = false;
  try {
    assertSafeDirectoryIdentity(vaultPath, directory, parent);
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
      0o600
    );
    temporaryIdentity = fs.fstatSync(descriptor);
    assertSafeDirectoryIdentity(vaultPath, directory, parent);
    const openedPath = fs.lstatSync(temporaryPath);
    if (
      !temporaryIdentity.isFile() ||
      temporaryIdentity.nlink !== 1 ||
      openedPath.isSymbolicLink() ||
      openedPath.nlink !== 1 ||
      !sameInode(temporaryIdentity, openedPath)
    ) {
      throw new PigeDomainError("activity.operation_conflict", "The Undo Operation temporary is not private.");
    }
    fs.writeFileSync(descriptor, serialized, "utf8");
    fs.fsyncSync(descriptor);
    const written = fs.fstatSync(descriptor);
    if (!sameInode(temporaryIdentity, written) || written.nlink !== 1 || written.size !== Buffer.byteLength(serialized)) {
      throw new PigeDomainError("activity.operation_conflict", "The Undo Operation temporary changed during write.");
    }
    temporaryIdentity = written;
    fs.closeSync(descriptor);
    descriptor = undefined;
    assertSafeDirectoryIdentity(vaultPath, directory, parent);
    const privateTemporary = readPrivateFile(vaultPath, temporaryPath, MAX_OPERATION_BYTES, 1);
    if (!sameInode(temporaryIdentity, privateTemporary.stat) || privateTemporary.bytes.toString("utf8") !== serialized) {
      throw new PigeDomainError("activity.operation_conflict", "The Undo Operation temporary changed before commit.");
    }
    try {
      fs.linkSync(temporaryPath, operationPath);
      linkedOperation = true;
    } catch (caught) {
      if (!isErrno(caught, "EEXIST")) throw caught;
      return requireMatchingOperation(vaultPath, operationPath, operation);
    }
    assertSafeDirectoryIdentity(vaultPath, directory, parent);
    const linkedTemporary = readPrivateFile(vaultPath, temporaryPath, MAX_OPERATION_BYTES, 2);
    const linkedRecord = readPrivateFile(vaultPath, operationPath, MAX_OPERATION_BYTES, 2);
    if (
      !sameInode(linkedTemporary.stat, linkedRecord.stat) ||
      linkedTemporary.bytes.toString("utf8") !== serialized ||
      !linkedTemporary.bytes.equals(linkedRecord.bytes)
    ) {
      throw new PigeDomainError("activity.operation_conflict", "The Undo Operation changed during exclusive commit.");
    }
    flushDirectory(directory);
    operationLinkDurable = true;
    assertSafeDirectoryIdentity(vaultPath, directory, parent);
    const currentTemporary = fs.lstatSync(temporaryPath);
    const currentOperation = fs.lstatSync(operationPath);
    if (!sameInode(linkedTemporary.stat, currentTemporary) || !sameInode(linkedRecord.stat, currentOperation)) {
      throw new PigeDomainError("activity.operation_conflict", "The Undo Operation changed before commit cleanup.");
    }
    fs.unlinkSync(temporaryPath);
    temporaryIdentity = undefined;
    flushDirectory(directory);
    return requireMatchingOperation(vaultPath, operationPath, operation);
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("activity.operation_unavailable", "The Undo Operation could not be committed safely.");
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the authoritative commit result.
      }
    }
    if (temporaryIdentity && (!linkedOperation || operationLinkDurable)) {
      try {
        const operationStillOwnsLink = !linkedOperation ||
          sameInode(temporaryIdentity, fs.lstatSync(operationPath));
        if (operationStillOwnsLink) removeMatchingLink(vaultPath, temporaryPath, temporaryIdentity, parent);
      } catch {
        // Preserve an uncertain temporary rather than deleting an unverified path.
      }
    }
  }
}

function requireMatchingOperation(
  vaultPath: string,
  operationPath: string,
  expected: OperationRecord
): OperationRecord {
  const existing = OperationRecordSchema.parse(JSON.parse(
    readPrivateFile(vaultPath, operationPath, MAX_OPERATION_BYTES, 1).bytes.toString("utf8")
  ));
  if (stableStringify(existing) !== stableStringify(expected)) {
    throw new PigeDomainError("activity.operation_conflict", "The deterministic Undo Operation identity is already occupied.");
  }
  return existing;
}

function operationFilePath(vaultPath: string, operationId: string): string {
  const dateKey = /^op_(\d{8})_/.exec(operationId)?.[1];
  if (!dateKey) throw new PigeDomainError("activity.invalid_operation_id", "The Operation identity is invalid.");
  return path.join(
    vaultPath,
    ".pige",
    "operations",
    dateKey.slice(0, 4),
    dateKey.slice(4, 6),
    `${operationId}.json`
  );
}

function readPrivateFile(
  vaultPath: string,
  filePath: string,
  maximumBytes: number,
  allowedLinkCount: 1 | 2
): PrivateFileSnapshot {
  assertSafeParent(vaultPath, filePath);
  let pathStatBefore: fs.Stats;
  try {
    pathStatBefore = fs.lstatSync(filePath);
  } catch {
    throw new PigeDomainError("activity.record_unavailable", "A durable Activity file could not be inspected.");
  }
  if (
    !pathStatBefore.isFile() ||
    pathStatBefore.isSymbolicLink() ||
    pathStatBefore.nlink > allowedLinkCount ||
    pathStatBefore.size > maximumBytes
  ) {
    throw new PigeDomainError("activity.record_unsafe", "A durable Activity file is not a bounded private regular file.");
  }
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const descriptorStatBefore = fs.fstatSync(descriptor);
    if (!sameRevision(pathStatBefore, descriptorStatBefore) || descriptorStatBefore.nlink > allowedLinkCount) {
      throw new PigeDomainError("activity.record_changed", "A durable Activity file changed before it could be read.");
    }
    const bytes = Buffer.alloc(descriptorStatBefore.size);
    const bytesRead = descriptorStatBefore.size === 0
      ? 0
      : fs.readSync(descriptor, bytes, 0, descriptorStatBefore.size, 0);
    const descriptorStatAfter = fs.fstatSync(descriptor);
    const pathStatAfter = fs.lstatSync(filePath);
    if (
      bytesRead !== descriptorStatBefore.size ||
      !sameRevision(descriptorStatBefore, descriptorStatAfter) ||
      !sameRevision(descriptorStatAfter, pathStatAfter) ||
      pathStatAfter.isSymbolicLink() ||
      pathStatAfter.nlink > allowedLinkCount
    ) {
      throw new PigeDomainError("activity.record_changed", "A durable Activity file changed while it was being read.");
    }
    return { bytes, stat: pathStatAfter };
  } finally {
    fs.closeSync(descriptor);
  }
}

function reconcilePreservedIndexLink(
  vaultPath: string,
  indexPath: string,
  backupPath: string,
  pagePath: string
): void {
  const quarantinePath = sourceQuarantinePath(indexPath, backupPath);
  if (pathExists(quarantinePath)) {
    if (!pathExists(backupPath)) {
      throw new PigeDomainError("activity.index_conflict", "The private index quarantine has no preserved base.");
    }
    const backup = readPrivateFile(vaultPath, backupPath, MAX_INDEX_BYTES, 2);
    if (indexLinkLineIndexes(backup.bytes.toString("utf8").split(/(?<=\n)/u), pagePath).length !== 1) {
      throw new PigeDomainError("activity.index_conflict", "The quarantined index base does not bind the generated page.");
    }
    removeVerifiedSourceLinkViaQuarantine(
      vaultPath,
      indexPath,
      quarantinePath,
      backup.stat,
      hashBytes(backup.bytes),
      MAX_INDEX_BYTES
    );
  }
  if (!pathExists(indexPath) || !pathExists(backupPath)) return;
  const index = readPrivateFile(vaultPath, indexPath, MAX_INDEX_BYTES, 2);
  const backup = readPrivateFile(vaultPath, backupPath, MAX_INDEX_BYTES, 2);
  if (!sameInode(index.stat, backup.stat)) return;
  const backupText = backup.bytes.toString("utf8");
  if (
    index.stat.nlink !== 2 ||
    backup.stat.nlink !== 2 ||
    !index.bytes.equals(backup.bytes) ||
    indexLinkLineIndexes(backupText.split(/(?<=\n)/u), pagePath).length !== 1
  ) {
    throw new PigeDomainError("activity.index_conflict", "An interrupted index preservation has ambiguous links.");
  }
  flushDirectory(path.dirname(backupPath));
  removeVerifiedSourceLinkViaQuarantine(
    vaultPath,
    indexPath,
    quarantinePath,
    index.stat,
    hashBytes(index.bytes),
    MAX_INDEX_BYTES
  );
  const privateBackup = readPrivateFile(vaultPath, backupPath, MAX_INDEX_BYTES, 1);
  if (!privateBackup.bytes.equals(backup.bytes)) {
    throw new PigeDomainError("activity.index_conflict", "The preserved index base changed during recovery.");
  }
}

function indexLinkLineIndexes(lines: readonly string[], pagePath: string): number[] {
  return lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.startsWith("- [") && line.includes(`](${pagePath})`))
    .map(({ index }) => index);
}

function replaceIndexConflictPreserving(
  vaultPath: string,
  operationId: string,
  update: GeneratedIndexUpdate
): void {
  const backupPath = indexBackupPath(vaultPath, operationId);
  ensureSafeDirectory(vaultPath, path.dirname(backupPath));
  const baseIsBackup = path.resolve(update.basePath) === path.resolve(backupPath);

  if (baseIsBackup) {
    const backup = readPrivateFile(vaultPath, backupPath, MAX_INDEX_BYTES, 1);
    if (
      !sameRevision(update.expectedRevision, backup.stat) ||
      backup.bytes.toString("utf8") !== update.originalContent
    ) {
      throw new PigeDomainError("activity.index_conflict", "The preserved index base changed during Undo recovery.");
    }
  } else {
    if (pathExists(backupPath)) {
      if (pathExists(update.indexPath)) {
        const current = readPrivateFile(vaultPath, update.indexPath, MAX_INDEX_BYTES, 1);
        if (current.bytes.toString("utf8") === update.content) return;
      }
      throw new PigeDomainError("activity.index_conflict", "A preserved index base already exists for this Undo.");
    }
    const current = readPrivateFile(vaultPath, update.indexPath, MAX_INDEX_BYTES, 1);
    if (
      !sameRevision(update.expectedRevision, current.stat) ||
      current.bytes.toString("utf8") !== update.originalContent
    ) {
      throw new PigeDomainError("activity.index_conflict", "The generated-note index changed before Undo commit.");
    }
    try {
      preserveIndexBaseExclusive(vaultPath, update.indexPath, backupPath, current, update.originalContent);
    } catch (caught) {
      if (caught instanceof PigeDomainError) throw caught;
      throw new PigeDomainError("activity.index_conflict", "The generated-note index base could not be preserved.");
    }
  }

  installIndexExclusive(vaultPath, update.indexPath, update.content);
}

function preserveIndexBaseExclusive(
  vaultPath: string,
  indexPath: string,
  backupPath: string,
  expected: PrivateFileSnapshot,
  expectedContent: string
): void {
  const indexParent = captureSafeDirectoryIdentity(vaultPath, path.dirname(indexPath));
  const backupParent = captureSafeDirectoryIdentity(vaultPath, path.dirname(backupPath));
  assertSafeDirectoryIdentity(vaultPath, path.dirname(indexPath), indexParent);
  assertSafeDirectoryIdentity(vaultPath, path.dirname(backupPath), backupParent);
  try {
    fs.linkSync(indexPath, backupPath);
  } catch (caught) {
    if (isErrno(caught, "EEXIST")) {
      throw new PigeDomainError("activity.index_conflict", "A preserved index base already exists for this Undo.");
    }
    throw caught;
  }

  try {
    const linkedIndex = readPrivateFile(vaultPath, indexPath, MAX_INDEX_BYTES, 2);
    const linkedBackup = readPrivateFile(vaultPath, backupPath, MAX_INDEX_BYTES, 2);
    if (
      !sameDataRevision(expected.stat, linkedIndex.stat) ||
      !sameInode(linkedIndex.stat, linkedBackup.stat) ||
      linkedIndex.bytes.toString("utf8") !== expectedContent ||
      !linkedIndex.bytes.equals(linkedBackup.bytes)
    ) {
      throw new PigeDomainError("activity.index_conflict", "The generated-note index changed while its base was preserved.");
    }
    flushDirectory(path.dirname(backupPath));
    removeVerifiedSourceLinkViaQuarantine(
      vaultPath,
      indexPath,
      sourceQuarantinePath(indexPath, backupPath),
      linkedIndex.stat,
      hashBytes(linkedIndex.bytes),
      MAX_INDEX_BYTES
    );
    const privateBackup = readPrivateFile(vaultPath, backupPath, MAX_INDEX_BYTES, 1);
    if (privateBackup.bytes.toString("utf8") !== expectedContent) {
      throw new PigeDomainError("activity.index_conflict", "The preserved index base changed before replacement.");
    }
  } catch (caught) {
    // Keep every surviving path intact; recovery may adopt the deterministic backup.
    throw caught;
  }
}

function installIndexExclusive(vaultPath: string, indexPath: string, value: string): void {
  assertSafeParent(vaultPath, indexPath);
  const directory = path.dirname(indexPath);
  if (pathExists(indexPath)) {
    reconcileInstalledIndexTemporary(vaultPath, indexPath, value);
    const current = readPrivateFile(vaultPath, indexPath, MAX_INDEX_BYTES, 1);
    if (current.bytes.toString("utf8") === value) {
      flushDirectory(directory);
      return;
    }
    throw new PigeDomainError("activity.index_conflict", "A concurrent index revision appeared during Undo.");
  }
  const parent = captureSafeDirectoryIdentity(vaultPath, directory);
  const temporaryPath = path.join(directory, `.${path.basename(indexPath)}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  let temporaryIdentity: fs.Stats | undefined;
  let linkedIndex = false;
  let indexLinkDurable = false;
  try {
    assertSafeDirectoryIdentity(vaultPath, directory, parent);
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
      0o600
    );
    temporaryIdentity = fs.fstatSync(descriptor);
    assertSafeDirectoryIdentity(vaultPath, directory, parent);
    const openedPath = fs.lstatSync(temporaryPath);
    if (
      !temporaryIdentity.isFile() ||
      temporaryIdentity.nlink !== 1 ||
      openedPath.isSymbolicLink() ||
      openedPath.nlink !== 1 ||
      !sameInode(temporaryIdentity, openedPath)
    ) {
      throw new PigeDomainError("activity.index_conflict", "The index replacement temporary is not private.");
    }
    fs.writeFileSync(descriptor, value, "utf8");
    fs.fsyncSync(descriptor);
    const written = fs.fstatSync(descriptor);
    if (!sameInode(temporaryIdentity, written) || written.nlink !== 1 || written.size !== Buffer.byteLength(value)) {
      throw new PigeDomainError("activity.index_conflict", "The index replacement temporary changed during write.");
    }
    temporaryIdentity = written;
    fs.closeSync(descriptor);
    descriptor = undefined;
    assertSafeDirectoryIdentity(vaultPath, directory, parent);
    const privateTemporary = readPrivateFile(vaultPath, temporaryPath, MAX_INDEX_BYTES, 1);
    if (!sameInode(temporaryIdentity, privateTemporary.stat) || privateTemporary.bytes.toString("utf8") !== value) {
      throw new PigeDomainError("activity.index_conflict", "The index replacement temporary changed before commit.");
    }
    try {
      fs.linkSync(temporaryPath, indexPath);
      linkedIndex = true;
    } catch (caught) {
      if (!isErrno(caught, "EEXIST")) throw caught;
      const concurrent = readPrivateFile(vaultPath, indexPath, MAX_INDEX_BYTES, 1);
      if (concurrent.bytes.toString("utf8") === value) return;
      throw new PigeDomainError("activity.index_conflict", "A concurrent index revision appeared during Undo.");
    }
    assertSafeDirectoryIdentity(vaultPath, directory, parent);
    const committed = readPrivateFile(vaultPath, indexPath, MAX_INDEX_BYTES, 2);
    const temporary = readPrivateFile(vaultPath, temporaryPath, MAX_INDEX_BYTES, 2);
    if (
      !sameInode(committed.stat, temporary.stat) ||
      committed.bytes.toString("utf8") !== value ||
      !committed.bytes.equals(temporary.bytes)
    ) {
      throw new PigeDomainError("activity.index_conflict", "The new index revision changed during Undo commit.");
    }
    flushDirectory(directory);
    indexLinkDurable = true;
    assertSafeDirectoryIdentity(vaultPath, directory, parent);
    const currentTemporary = fs.lstatSync(temporaryPath);
    const currentIndex = fs.lstatSync(indexPath);
    if (!sameInode(temporary.stat, currentTemporary) || !sameInode(committed.stat, currentIndex)) {
      throw new PigeDomainError("activity.index_conflict", "The new index revision changed before cleanup.");
    }
    fs.unlinkSync(temporaryPath);
    temporaryIdentity = undefined;
    const privateCommitted = readPrivateFile(vaultPath, indexPath, MAX_INDEX_BYTES, 1);
    if (privateCommitted.bytes.toString("utf8") !== value) {
      throw new PigeDomainError("activity.index_conflict", "The new index revision could not be verified.");
    }
    flushDirectory(directory);
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("activity.index_conflict", "The new index revision could not be installed safely.");
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the authoritative write result.
      }
    }
    if (temporaryIdentity && (!linkedIndex || indexLinkDurable)) {
      try {
        const indexStillOwnsLink = !linkedIndex || sameInode(temporaryIdentity, fs.lstatSync(indexPath));
        if (indexStillOwnsLink) removeMatchingLink(vaultPath, temporaryPath, temporaryIdentity, parent);
      } catch {
        // Preserve an uncertain temporary rather than deleting an unverified path.
      }
    }
  }
}

function reconcileInstalledIndexTemporary(vaultPath: string, indexPath: string, value: string): void {
  const indexStat = fs.lstatSync(indexPath);
  if (indexStat.nlink === 1) return;
  if (!indexStat.isFile() || indexStat.isSymbolicLink() || indexStat.nlink !== 2) {
    throw new PigeDomainError("activity.index_conflict", "An interrupted index replacement has ambiguous links.");
  }
  const directory = path.dirname(indexPath);
  const matchingTemporaries: string[] = [];
  const handle = fs.opendirSync(directory);
  let entries = 0;
  try {
    for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
      entries += 1;
      if (entries > MAX_OPERATION_SCAN_ENTRIES) {
        throw new PigeDomainError("activity.scan_limit", "The index directory exceeds its bounded recovery scan limit.");
      }
      if (!entry.isFile() || !/^\.index\.md\.\d+\.[a-f0-9-]{16,}\.tmp$/u.test(entry.name)) continue;
      const temporaryPath = path.join(directory, entry.name);
      const temporaryStat = fs.lstatSync(temporaryPath);
      if (!temporaryStat.isSymbolicLink() && sameInode(indexStat, temporaryStat)) {
        matchingTemporaries.push(temporaryPath);
      }
    }
  } finally {
    handle.closeSync();
  }
  if (matchingTemporaries.length !== 1) {
    throw new PigeDomainError("activity.index_conflict", "The interrupted index replacement cannot be identified uniquely.");
  }
  const temporaryPath = matchingTemporaries[0] as string;
  const committed = readPrivateFile(vaultPath, indexPath, MAX_INDEX_BYTES, 2);
  const temporary = readPrivateFile(vaultPath, temporaryPath, MAX_INDEX_BYTES, 2);
  if (
    !sameInode(committed.stat, temporary.stat) ||
    committed.bytes.toString("utf8") !== value ||
    !committed.bytes.equals(temporary.bytes)
  ) {
    throw new PigeDomainError("activity.index_conflict", "The interrupted index replacement does not match the expected revision.");
  }
  const parent = captureSafeDirectoryIdentity(vaultPath, directory);
  flushDirectory(directory);
  assertSafeDirectoryIdentity(vaultPath, directory, parent);
  const currentTemporary = fs.lstatSync(temporaryPath);
  const currentIndex = fs.lstatSync(indexPath);
  if (!sameInode(temporary.stat, currentTemporary) || !sameInode(committed.stat, currentIndex)) {
    throw new PigeDomainError("activity.index_conflict", "The interrupted index replacement changed during recovery.");
  }
  fs.unlinkSync(temporaryPath);
  const privateIndex = readPrivateFile(vaultPath, indexPath, MAX_INDEX_BYTES, 1);
  if (privateIndex.bytes.toString("utf8") !== value) {
    throw new PigeDomainError("activity.index_conflict", "The recovered index replacement changed during cleanup.");
  }
  flushDirectory(directory);
}

function indexBackupPath(vaultPath: string, operationId: string): string {
  if (!OPERATION_ID.test(operationId)) {
    throw new PigeDomainError("activity.invalid_operation_id", "The Activity operation identity is invalid.");
  }
  return path.join(vaultPath, ".pige", "trash", "index", operationId, "index.md.before");
}

function ensureSafeDirectory(vaultPath: string, directory: string): void {
  assertSafeRoot(vaultPath);
  const resolvedVault = path.resolve(vaultPath);
  const resolvedDirectory = path.resolve(directory);
  if (!resolvedDirectory.startsWith(`${resolvedVault}${path.sep}`)) {
    throw new PigeDomainError("activity.path_escape", "The Activity directory escapes the active vault.");
  }
  let current = resolvedVault;
  for (const component of path.relative(resolvedVault, resolvedDirectory).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new PigeDomainError("activity.path_unsafe", "An Activity directory is not a safe local directory.");
      }
    } catch (caught) {
      if (!isErrno(caught, "ENOENT")) throw caught;
      fs.mkdirSync(current, { mode: 0o700 });
      flushDirectory(path.dirname(current));
    }
  }
  assertSafeDirectory(vaultPath, resolvedDirectory);
}

function assertSafeDirectory(vaultPath: string, directory: string): void {
  assertSafeParent(vaultPath, path.join(directory, ".activity-boundary"));
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new PigeDomainError("activity.path_unsafe", "An Activity root is not a safe local directory.");
  }
}

function assertSafeParent(vaultPath: string, filePath: string): void {
  assertSafeRoot(vaultPath);
  const resolvedVault = path.resolve(vaultPath);
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(`${resolvedVault}${path.sep}`)) {
    throw new PigeDomainError("activity.path_escape", "An Activity path escapes the active vault.");
  }
  let current = resolvedVault;
  for (const component of path.relative(resolvedVault, path.dirname(resolvedFile)).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new PigeDomainError("activity.path_unsafe", "An Activity path contains an unsafe directory.");
    }
  }
  const realParent = fs.realpathSync(path.dirname(resolvedFile));
  const realVault = fs.realpathSync(resolvedVault);
  if (realParent !== realVault && !realParent.startsWith(`${realVault}${path.sep}`)) {
    throw new PigeDomainError("activity.path_escape", "An Activity path resolves outside the active vault.");
  }
}

function assertSafeRoot(vaultPath: string): void {
  const stat = fs.lstatSync(vaultPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new PigeDomainError("activity.vault_unsafe", "The active vault is not a safe local directory.");
  }
}

function captureSafeDirectoryIdentity(vaultPath: string, directory: string): fs.Stats {
  assertSafeDirectory(vaultPath, directory);
  return fs.lstatSync(directory);
}

function assertSafeDirectoryIdentity(vaultPath: string, directory: string, expected: fs.Stats): void {
  assertSafeDirectory(vaultPath, directory);
  const current = fs.lstatSync(directory);
  if (!sameInode(expected, current) || !current.isDirectory() || current.isSymbolicLink()) {
    throw new PigeDomainError("activity.path_changed", "An Activity directory changed during Undo.");
  }
}

function resolveVaultPath(vaultPath: string, relativePath: string): string {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedPath = path.resolve(vaultPath, ...relativePath.split("/"));
  if (!resolvedPath.startsWith(`${resolvedVault}${path.sep}`)) {
    throw new PigeDomainError("activity.path_escape", "An Activity path escapes the active vault.");
  }
  return resolvedPath;
}

function hashBytes(value: Buffer | string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function clampLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_ACTIVITY_LIMIT;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PigeDomainError("activity.invalid_limit", "The Activity list limit is invalid.");
  }
  return Math.min(value, MAX_ACTIVITY_LIMIT);
}

function boundedSummary(value: string): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, 240) || "Knowledge changed.";
}

function sameRevision(left: fs.Stats, right: fs.Stats): boolean {
  return sameInode(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function sameDataRevision(left: fs.Stats, right: fs.Stats): boolean {
  return sameInode(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs;
}

function sameInode(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function pathExists(filePath: string): boolean {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (caught) {
    if (isErrno(caught, "ENOENT")) return false;
    throw caught;
  }
}

function removeMatchingLink(
  vaultPath: string,
  filePath: string,
  expected: fs.Stats,
  expectedParent: fs.Stats
): void {
  try {
    assertSafeDirectoryIdentity(vaultPath, path.dirname(filePath), expectedParent);
    const current = fs.lstatSync(filePath);
    if (!current.isSymbolicLink() && sameInode(current, expected)) fs.unlinkSync(filePath);
  } catch {
    // Never remove a path whose identity cannot be proven.
  }
}

function flushDirectory(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch {
    throw new PigeDomainError(
      "activity.durability_unavailable",
      "The filesystem could not durably commit the Activity directory change."
    );
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // The required fsync result is authoritative once it succeeds.
      }
    }
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isErrno(value: unknown, code: string): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value && value.code === code;
}
