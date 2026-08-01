import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { KnowledgeActivityRedoResult, KnowledgeActivitySummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { parsePigeFrontmatter } from "@pige/markdown";
import { OperationRecordSchema, type OperationRecord } from "@pige/schemas";
import {
  MAX_AGENT_PAGE_UPDATE_BYTES,
  commitUpdateOperation,
  createAgentPageUpdateBeforePath,
  createAgentPageUpdateUndoOperationId,
  createAgentPageUpdateStagedPath,
  hashText,
  isMatchingAgentPageUpdateUndo,
  readAgentPageUpdateOperationBinding,
  requireExact,
  requireExisting,
  stageExact
} from "./agent-page-update-service";
import { removeGeneratedNoteExact, replaceGeneratedNoteExact } from "./generated-note-file";
import { preservesEditableMarkdownPageOwnership } from "./markdown-source-editor-policy";
import { validateActivityMarkdown } from "./note-markdown-editor-service";

type RedoState = Pick<KnowledgeActivitySummary, "canRedo" | "redoUnavailableReason">;

export class AgentPageUpdateRedoService {
  activityState(
    vaultPath: string,
    operation: OperationRecord,
    undo: OperationRecord | undefined,
    operations: readonly OperationRecord[]
  ): RedoState | undefined {
    const binding = readAgentPageUpdateOperationBinding(operation);
    if (!binding || !undo || !isMatchingAgentPageUpdateUndo(operation, undo)) return undefined;
    const redo = operations.find(({ id }) => id === createAgentPageUpdateRedoOperationId(operation.id));
    if (redo) {
      try {
        assertCompletedAgentPageUpdateRedo(vaultPath, operation, undo, redo);
        return { canRedo: false, redoUnavailableReason: "already_redone" };
      } catch {
        return { canRedo: false, redoUnavailableReason: "content_changed" };
      }
    }
    let current: string;
    try {
      current = requireExisting(vaultPath, binding.pagePath);
    } catch {
      return { canRedo: false, redoUnavailableReason: "target_missing" };
    }
    if (hashText(current) !== binding.beforeHash) {
      return { canRedo: false, redoUnavailableReason: "content_changed" };
    }
    try {
      requireRedoImages(vaultPath, operation, undo);
      assertCurrentRelationshipTarget(vaultPath, binding.relationshipPageId, binding.relationshipPagePath);
      return { canRedo: true };
    } catch {
      return { canRedo: false, redoUnavailableReason: "content_changed" };
    }
  }

  redo(
    vaultPath: string,
    operation: OperationRecord,
    undo: OperationRecord | undefined,
    operations: readonly OperationRecord[],
    expectedRevisionId?: string
  ): KnowledgeActivityRedoResult {
    const binding = readAgentPageUpdateOperationBinding(operation);
    if (!binding || !undo || !isMatchingAgentPageUpdateUndo(operation, undo)) {
      return { status: "not_found", operationId: operation.id };
    }
    const redoId = createAgentPageUpdateRedoOperationId(operation.id);
    const existing = operations.find(({ id }) => id === redoId);
    if (existing) {
      if (!isMatchingAgentPageUpdateRedo(operation, undo, existing)) {
        throw new PigeDomainError("activity.operation_conflict", "The deterministic Agent page Redo identity is occupied.");
      }
      const currentRevisionId = hashText(requireExisting(vaultPath, binding.pagePath));
      if (currentRevisionId !== binding.afterHash) {
        return { status: "stale", operationId: operation.id, currentRevisionId };
      }
      assertCompletedAgentPageUpdateRedo(vaultPath, operation, undo, existing);
      return {
        status: "already_redone",
        operationId: operation.id,
        undoOperationId: undo.id,
        redoOperationId: existing.id,
        revisionId: binding.afterHash
      };
    }
    const live = requireExisting(vaultPath, binding.pagePath);
    const currentRevisionId = hashText(live);
    if (expectedRevisionId !== undefined && expectedRevisionId !== binding.beforeHash) {
      return { status: "stale", operationId: operation.id, currentRevisionId };
    }
    if (currentRevisionId !== binding.beforeHash && currentRevisionId !== binding.afterHash) {
      return { status: "stale", operationId: operation.id, currentRevisionId };
    }
    assertCurrentRelationshipTarget(vaultPath, binding.relationshipPageId, binding.relationshipPagePath);
    const { after } = requireRedoImages(vaultPath, operation, undo);
    const beforePath = createAgentPageUpdateBeforePath(redoId);
    const stagedPath = createAgentPageUpdateStagedPath(redoId);
    if (currentRevisionId === binding.beforeHash) {
      stageExact(vaultPath, beforePath, live, binding.beforeHash);
      stageExact(vaultPath, stagedPath, after, binding.afterHash);
      replaceGeneratedNoteExact(
        vaultPath,
        path.resolve(vaultPath, binding.pagePath),
        path.resolve(vaultPath, stagedPath),
        { beforeHash: binding.beforeHash, afterHash: binding.afterHash, maximumBytes: MAX_AGENT_PAGE_UPDATE_BYTES }
      );
    } else {
      requireExact(vaultPath, beforePath, binding.beforeHash);
    }
    const createdAt = fs.lstatSync(path.resolve(vaultPath, beforePath)).mtime.toISOString();
    const redo = createAgentPageUpdateRedoOperation(operation, undo, redoId, beforePath, createdAt);
    const committed = commitUpdateOperation(vaultPath, redo);
    removeGeneratedNoteExact(
      vaultPath,
      path.resolve(vaultPath, stagedPath),
      binding.afterHash,
      MAX_AGENT_PAGE_UPDATE_BYTES
    );
    return {
      status: "redone",
      operationId: operation.id,
      undoOperationId: undo.id,
      redoOperationId: committed.id,
      revisionId: binding.afterHash
    };
  }

  recoverIncompleteRedos(
    vaultPath: string,
    operations: readonly OperationRecord[]
  ): { readonly recovered: number; readonly failed: number } {
    const byId = new Map(operations.map((operation) => [operation.id, operation]));
    let recovered = 0;
    let failed = 0;
    for (const operation of operations) {
      const binding = readAgentPageUpdateOperationBinding(operation);
      if (!binding) continue;
      const undo = byId.get(createAgentPageUpdateUndoOperationId(operation.id));
      if (!undo || !isMatchingAgentPageUpdateUndo(operation, undo) ||
          byId.has(createAgentPageUpdateRedoOperationId(operation.id))) continue;
      const redoId = createAgentPageUpdateRedoOperationId(operation.id);
      const beforePath = path.resolve(vaultPath, createAgentPageUpdateBeforePath(redoId));
      const stagedPath = path.resolve(vaultPath, createAgentPageUpdateStagedPath(redoId));
      if (!fs.existsSync(beforePath) && !fs.existsSync(stagedPath)) continue;
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

function requireRedoImages(
  vaultPath: string,
  operation: OperationRecord,
  undo: OperationRecord
): { readonly before: string; readonly after: string } {
  const binding = readAgentPageUpdateOperationBinding(operation);
  const undoBeforePath = undo.before?.path;
  if (!binding || !undoBeforePath) {
    throw new PigeDomainError("activity.operation_conflict", "The Agent page Redo image binding is unavailable.");
  }
  const after = requireExact(vaultPath, undoBeforePath, binding.afterHash);
  const before = requireExact(vaultPath, binding.beforePath, binding.beforeHash);
  if (!validateActivityMarkdown(after, binding.pageId) ||
      !preservesEditableMarkdownPageOwnership(before, after, true, true, true, true, true)) {
    throw new PigeDomainError("activity.content_changed", "The Agent page Redo after-image is invalid.");
  }
  return { before, after };
}

function assertCompletedAgentPageUpdateRedo(
  vaultPath: string,
  operation: OperationRecord,
  undo: OperationRecord,
  redo: OperationRecord
): void {
  const binding = readAgentPageUpdateOperationBinding(operation);
  if (!binding || !isMatchingAgentPageUpdateRedo(operation, undo, redo)) {
    throw new PigeDomainError("activity.operation_conflict", "The Agent page Redo bindings are inconsistent.");
  }
  assertCurrentRelationshipTarget(vaultPath, binding.relationshipPageId, binding.relationshipPagePath);
  requireExact(vaultPath, binding.pagePath, binding.afterHash);
  requireExact(vaultPath, createAgentPageUpdateBeforePath(redo.id), binding.beforeHash);
  const stagedPath = path.resolve(vaultPath, createAgentPageUpdateStagedPath(redo.id));
  if (fs.existsSync(stagedPath)) {
    removeGeneratedNoteExact(vaultPath, stagedPath, binding.afterHash, MAX_AGENT_PAGE_UPDATE_BYTES);
  }
}

function assertCurrentRelationshipTarget(
  vaultPath: string,
  pageId: string | undefined,
  pagePath: string | undefined
): void {
  if (!pageId && !pagePath) return;
  if (!pageId || !pagePath) throw new PigeDomainError("activity.operation_conflict", "The relationship target binding is incomplete.");
  const markdown = requireExisting(vaultPath, pagePath);
  const parsed = parsePigeFrontmatter(markdown);
  if (!parsed || parsed.frontmatter.id !== pageId || parsed.frontmatter.status === "trashed") {
    throw new PigeDomainError("activity.content_changed", "The relationship target is no longer current for Redo.");
  }
}

export function createAgentPageUpdateRedoOperationId(operationId: string): string {
  const date = /^op_(\d{8})_/u.exec(operationId)?.[1] ?? "19700101";
  const suffix = createHash("sha256").update(`pige.activity.redo.agent-page-update.v1\0${operationId}`, "utf8")
    .digest("hex").slice(0, 16);
  return `op_${date}_${suffix}`;
}

export function isMatchingAgentPageUpdateRedo(
  operation: OperationRecord,
  undo: OperationRecord,
  candidate: OperationRecord
): boolean {
  const binding = readAgentPageUpdateOperationBinding(operation);
  const target = candidate.targetRefs[0];
  return binding !== undefined && isMatchingAgentPageUpdateUndo(operation, undo) &&
    candidate.id === createAgentPageUpdateRedoOperationId(operation.id) &&
    candidate.kind === "update_page" && candidate.actor.kind === "user" &&
    candidate.jobId === operation.jobId && candidate.reversible === "best_effort" &&
    candidate.targetRefs.length === 1 && target?.kind === "page" &&
    target.id === binding.pageId && target.path === binding.pagePath &&
    candidate.sourceRefs.length === 2 &&
    candidate.sourceRefs[0]?.kind === "operation" && candidate.sourceRefs[0].id === operation.id &&
    candidate.sourceRefs[1]?.kind === "operation" && candidate.sourceRefs[1].id === undo.id &&
    candidate.before?.kind === "page" && candidate.before.id === binding.beforeHash &&
    candidate.before.path === createAgentPageUpdateBeforePath(candidate.id) &&
    candidate.after?.kind === "page" && candidate.after.id === binding.afterHash &&
    candidate.after.path === binding.pagePath;
}

function createAgentPageUpdateRedoOperation(
  operation: OperationRecord,
  undo: OperationRecord,
  redoId: string,
  beforePath: string,
  createdAt: string
): OperationRecord {
  const binding = readAgentPageUpdateOperationBinding(operation);
  if (!binding) throw new PigeDomainError("activity.operation_conflict", "The Agent page update binding is invalid.");
  return OperationRecordSchema.parse({
    id: redoId,
    schemaVersion: 1,
    ...(operation.jobId ? { jobId: operation.jobId } : {}),
    createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "update_page",
    targetRefs: [{ kind: "page", id: binding.pageId, path: binding.pagePath }],
    sourceRefs: [{ kind: "operation", id: operation.id }, { kind: "operation", id: undo.id }],
    before: { kind: "page", id: binding.beforeHash, path: beforePath },
    after: { kind: "page", id: binding.afterHash, path: binding.pagePath },
    summary: `Redid Agent page update ${operation.id} from its exact preserved after-image.`,
    reversible: "best_effort",
    rollbackHint: "Use the original Activity history entry to inspect this completed Redo.",
    warnings: []
  });
}
