import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { KnowledgeActivityRedoResult, KnowledgeActivitySummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { parsePigeFrontmatter } from "@pige/markdown";
import { OperationRecordSchema, type OperationRecord } from "@pige/schemas";
import { createGeneratedNoteExclusive, removeGeneratedNoteExact } from "./generated-note-file";
import {
  commitOperationExclusive,
  createUndoOperationId,
  generatedPageBinding,
  indexBackupPath,
  indexLinkLineIndexes,
  isGeneratedCreatePageOperation,
  isMatchingUndoOperation,
  readPrivateFile,
  replaceIndexConflictPreserving,
  trashPathFor,
  type GeneratedIndexUpdate
} from "./knowledge-activity-service";

const MAX_PAGE_BYTES = 1024 * 1024;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;

type RedoState = Pick<KnowledgeActivitySummary, "canRedo" | "redoUnavailableReason">;

export class AgentPageCreateRedoService {
  activityState(
    vaultPath: string,
    operation: OperationRecord,
    undo: OperationRecord | undefined,
    operations: readonly OperationRecord[]
  ): RedoState | undefined {
    if (!isGeneratedCreatePageOperation(operation) || !undo || !isMatchingUndoOperation(operation, undo)) return undefined;
    const redo = operations.find(({ id }) => id === createAgentPageCreateRedoOperationId(operation.id));
    try {
      if (redo) {
        assertCompletedCreateRedo(vaultPath, operation, undo, redo);
        return { canRedo: false, redoUnavailableReason: "already_redone" };
      }
      assertReadyToRedo(vaultPath, operation);
      return { canRedo: true };
    } catch (caught) {
      return { canRedo: false, redoUnavailableReason: isMissing(caught) ? "target_missing" : "content_changed" };
    }
  }

  redo(
    vaultPath: string,
    operation: OperationRecord,
    undo: OperationRecord | undefined,
    operations: readonly OperationRecord[],
    expectedRevisionId?: string
  ): KnowledgeActivityRedoResult {
    if (!isGeneratedCreatePageOperation(operation) || !undo || !isMatchingUndoOperation(operation, undo)) {
      return { status: "not_found", operationId: operation.id };
    }
    const binding = requireBinding(operation);
    if (expectedRevisionId !== undefined && expectedRevisionId !== binding.contentHash) {
      return { status: "stale", operationId: operation.id, currentRevisionId: binding.contentHash };
    }
    const redoId = createAgentPageCreateRedoOperationId(operation.id);
    const existing = operations.find(({ id }) => id === redoId);
    if (existing) {
      assertCompletedCreateRedo(vaultPath, operation, undo, existing);
      return {
        status: "already_redone",
        operationId: operation.id,
        undoOperationId: undo.id,
        redoOperationId: existing.id,
        revisionId: binding.contentHash
      };
    }
    const trashPath = path.resolve(vaultPath, trashPathFor(operation));
    const pagePath = path.resolve(vaultPath, binding.pagePath);
    const trash = readPrivateFile(vaultPath, trashPath, MAX_PAGE_BYTES, 1);
    if (hashBytes(trash.bytes) !== binding.contentHash) {
      return { status: "stale", operationId: operation.id, currentRevisionId: hashBytes(trash.bytes) };
    }
    const markdown = trash.bytes.toString("utf8");
    if (parsePigeFrontmatter(markdown)?.frontmatter.id !== operation.targetRefs[0]?.id) {
      throw new PigeDomainError("activity.content_changed", "The trashed Agent page identity is invalid.");
    }
    const created = createGeneratedNoteExclusive(vaultPath, pagePath, markdown);
    if (created === "exists") {
      const current = readPrivateFile(vaultPath, pagePath, MAX_PAGE_BYTES, 1);
      if (hashBytes(current.bytes) !== binding.contentHash) {
        return { status: "stale", operationId: operation.id, currentRevisionId: hashBytes(current.bytes) };
      }
    }
    restoreIndex(vaultPath, operation, redoId);
    const redo = commitOperationExclusive(vaultPath, createRedoOperation(operation, undo, redoId));
    removeGeneratedNoteExact(vaultPath, trashPath, binding.contentHash, MAX_PAGE_BYTES);
    return {
      status: "redone",
      operationId: operation.id,
      undoOperationId: undo.id,
      redoOperationId: redo.id,
      revisionId: binding.contentHash
    };
  }

  recoverIncompleteRedos(
    vaultPath: string,
    operations: readonly OperationRecord[]
  ): { readonly recovered: number; readonly failed: number } {
    const byId = new Map(operations.map((operation) => [operation.id, operation]));
    let recovered = 0;
    let failed = 0;
    for (const operation of operations.filter(isGeneratedCreatePageOperation)) {
      const undo = byId.get(createUndoOperationId(operation.id));
      const redoId = createAgentPageCreateRedoOperationId(operation.id);
      if (!undo || !isMatchingUndoOperation(operation, undo)) continue;
      const existing = byId.get(redoId);
      if (existing) {
        try {
          const hadTrash = fs.existsSync(path.resolve(vaultPath, trashPathFor(operation)));
          assertCompletedCreateRedo(vaultPath, operation, undo, existing);
          if (hadTrash) recovered += 1;
        } catch {
          failed += 1;
        }
        continue;
      }
      const binding = requireBinding(operation);
      const pagePath = path.resolve(vaultPath, binding.pagePath);
      if (!fs.existsSync(pagePath) && !fs.existsSync(indexBackupPath(vaultPath, redoId))) continue;
      try {
        const result = this.redo(vaultPath, operation, undo, operations);
        if (result.status === "redone" || result.status === "already_redone") recovered += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    return { recovered, failed };
  }
}

export function createAgentPageCreateRedoOperationId(operationId: string): string {
  const date = /^op_(\d{8})_/u.exec(operationId)?.[1] ?? "19700101";
  const suffix = createHash("sha256")
    .update(`pige.activity.redo.create-page.v1\0${operationId}`, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `op_${date}_${suffix}`;
}

function assertReadyToRedo(vaultPath: string, operation: OperationRecord): void {
  const binding = requireBinding(operation);
  if (fs.existsSync(path.resolve(vaultPath, binding.pagePath))) {
    throw new PigeDomainError("activity.content_changed", "The original Agent page path is occupied.");
  }
  const trash = readPrivateFile(vaultPath, path.resolve(vaultPath, trashPathFor(operation)), MAX_PAGE_BYTES, 1);
  if (hashBytes(trash.bytes) !== binding.contentHash) {
    throw new PigeDomainError("activity.content_changed", "The trashed Agent page changed after Undo.");
  }
}

function assertCompletedCreateRedo(
  vaultPath: string,
  operation: OperationRecord,
  undo: OperationRecord,
  redo: OperationRecord
): void {
  const binding = requireBinding(operation);
  if (!isMatchingCreateRedo(operation, undo, redo)) {
    throw new PigeDomainError("activity.operation_conflict", "The Agent page Redo bindings are inconsistent.");
  }
  const page = readPrivateFile(vaultPath, path.resolve(vaultPath, binding.pagePath), MAX_PAGE_BYTES, 1);
  if (hashBytes(page.bytes) !== binding.contentHash) {
    throw new PigeDomainError("activity.content_changed", "The completed Agent page Redo state changed.");
  }
  assertRestoredIndex(vaultPath, operation);
  const trashPath = path.resolve(vaultPath, trashPathFor(operation));
  if (fs.existsSync(trashPath)) {
    removeGeneratedNoteExact(vaultPath, trashPath, binding.contentHash, MAX_PAGE_BYTES);
  }
}

function restoreIndex(vaultPath: string, operation: OperationRecord, redoId: string): void {
  const update = prepareIndexRestore(vaultPath, operation, redoId);
  if (update) replaceIndexConflictPreserving(vaultPath, redoId, update);
}

function prepareIndexRestore(
  vaultPath: string,
  operation: OperationRecord,
  redoId: string
): GeneratedIndexUpdate | undefined {
  const binding = requireBinding(operation);
  const originalBackupPath = indexBackupPath(vaultPath, operation.id);
  if (!fs.existsSync(originalBackupPath)) return undefined;
  const original = readPrivateFile(vaultPath, originalBackupPath, MAX_INDEX_BYTES, 1);
  const originalLines = original.bytes.toString("utf8").split(/(?<=\n)/u);
  const originalMatches = indexLinkLineIndexes(originalLines, binding.pagePath);
  if (originalMatches.length !== 1) {
    throw new PigeDomainError("activity.index_conflict", "The preserved Agent page index entry is ambiguous.");
  }
  const indexPath = path.join(vaultPath, "index.md");
  const redoBackupPath = indexBackupPath(vaultPath, redoId);
  const basePath = fs.existsSync(redoBackupPath) ? redoBackupPath : indexPath;
  const base = readPrivateFile(vaultPath, basePath, MAX_INDEX_BYTES, 1);
  const baseText = base.bytes.toString("utf8");
  if (indexLinkLineIndexes(baseText.split(/(?<=\n)/u), binding.pagePath).length !== 0) {
    throw new PigeDomainError("activity.index_conflict", "The current index already contains the restored Agent page.");
  }
  const separator = baseText.length === 0 || baseText.endsWith("\n") ? "" : "\n";
  return {
    indexPath,
    basePath,
    expectedRevision: base.stat,
    originalContent: baseText,
    content: `${baseText}${separator}${originalLines[originalMatches[0]!]}`
  };
}

function assertRestoredIndex(vaultPath: string, operation: OperationRecord): void {
  const binding = requireBinding(operation);
  const originalBackupPath = indexBackupPath(vaultPath, operation.id);
  if (!fs.existsSync(originalBackupPath)) return;
  const index = readPrivateFile(vaultPath, path.join(vaultPath, "index.md"), MAX_INDEX_BYTES, 1);
  if (indexLinkLineIndexes(index.bytes.toString("utf8").split(/(?<=\n)/u), binding.pagePath).length !== 1) {
    throw new PigeDomainError("activity.index_conflict", "The restored Agent page index entry is unavailable.");
  }
}

function createRedoOperation(operation: OperationRecord, undo: OperationRecord, redoId: string): OperationRecord {
  const binding = requireBinding(operation);
  const target = operation.targetRefs[0]!;
  return OperationRecordSchema.parse({
    id: redoId,
    schemaVersion: 1,
    ...(operation.jobId ? { jobId: operation.jobId } : {}),
    createdAt: new Date().toISOString(),
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "restore_page",
    targetRefs: [{ kind: "page", id: target.id, path: binding.pagePath }],
    sourceRefs: [{ kind: "operation", id: operation.id }, { kind: "operation", id: undo.id }],
    before: { kind: "page", id: binding.contentHash, path: trashPathFor(operation) },
    after: { kind: "page", id: binding.contentHash, path: binding.pagePath },
    summary: `Redid Agent page creation ${operation.id} from recoverable trash.`,
    reversible: "best_effort",
    rollbackHint: "Use the original Activity entry to inspect this completed Redo.",
    warnings: []
  });
}

function isMatchingCreateRedo(
  operation: OperationRecord,
  undo: OperationRecord,
  candidate: OperationRecord
): boolean {
  const binding = generatedPageBinding(operation);
  const target = operation.targetRefs[0];
  return !!binding && isMatchingUndoOperation(operation, undo) &&
    candidate.id === createAgentPageCreateRedoOperationId(operation.id) &&
    candidate.kind === "restore_page" && candidate.actor.kind === "user" &&
    candidate.jobId === operation.jobId && candidate.reversible === "best_effort" &&
    candidate.targetRefs.length === 1 && candidate.targetRefs[0]?.kind === "page" &&
    candidate.targetRefs[0].id === target?.id && candidate.targetRefs[0].path === binding.pagePath &&
    candidate.sourceRefs.length === 2 &&
    candidate.sourceRefs[0]?.kind === "operation" && candidate.sourceRefs[0].id === operation.id &&
    candidate.sourceRefs[1]?.kind === "operation" && candidate.sourceRefs[1].id === undo.id &&
    candidate.before?.kind === "page" && candidate.before.id === binding.contentHash &&
    candidate.before.path === trashPathFor(operation) &&
    candidate.after?.kind === "page" && candidate.after.id === binding.contentHash &&
    candidate.after.path === binding.pagePath;
}

function requireBinding(operation: OperationRecord): NonNullable<ReturnType<typeof generatedPageBinding>> {
  const binding = generatedPageBinding(operation);
  if (!binding) throw new PigeDomainError("activity.operation_conflict", "The Agent create-page binding is invalid.");
  return binding;
}

function hashBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function isMissing(caught: unknown): boolean {
  return caught instanceof Error && "code" in caught && caught.code === "ENOENT";
}
