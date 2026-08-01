import fs from "node:fs";
import path from "node:path";
import type { KnowledgeActivitySummary, KnowledgeActivityUndoResult } from "@pige/contracts";
import {
  MemoryTrashListRequestSchema,
  MemoryTrashRestoreRequestSchema,
  MemoryTrashRestoreResultSchema,
  MemoryTrashSummarySchema,
  OperationRecordSchema,
  type MemorySummary,
  type MemoryTrashListRequest,
  type MemoryTrashRestoreRequest,
  type MemoryTrashRestoreResult,
  type MemoryTrashSummary,
  type OperationRecord
} from "@pige/schemas";
import {
  createMemoryLifecycleOperation,
  createMemoryUndoOperationId,
  isMatchingMemoryRestoreOperation,
  memoryLifecycleConflict,
  memoryOperationRelativePath,
  readMemoryOperationBinding,
  stableJson
} from "./agent-memory-lifecycle";
import { parseMemoryLifecycleReceipt } from "./agent-memory-service";

const MAX_PRIVATE_RECORD_BYTES = 4 * 1024 * 1024;
const TRASH_RECEIPT_NAME = /^memory_request_[a-z0-9]{16,64}\.json$/u;

export interface AgentMemoryTrashPort {
  list(vaultPath: string, activeVaultId: string): MemorySummary;
  activitySummary(operation: OperationRecord, undoOperation?: OperationRecord): KnowledgeActivitySummary | undefined;
  undo(operation: OperationRecord, expectedRevisionId?: string): KnowledgeActivityUndoResult;
  recoverIncompleteOperations(): { readonly recovered: number; readonly failed: number };
}

export class AgentMemoryTrashService {
  constructor(private readonly memory: AgentMemoryTrashPort) {}

  list(vaultPath: string, request: MemoryTrashListRequest): MemoryTrashSummary {
    const parsed = MemoryTrashListRequestSchema.parse(request);
    this.memory.list(vaultPath, parsed.activeVaultId);
    if (this.memory.recoverIncompleteOperations().failed > 0) throw memoryLifecycleConflict();
    const current = this.memory.list(vaultPath, parsed.activeVaultId);
    const trashRoot = existingDirectory(vaultPath, ".pige/trash/memory");
    if (!trashRoot) return trashSummary(parsed.activeVaultId, current.revision, []);

    const records = fs.readdirSync(trashRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && TRASH_RECEIPT_NAME.test(entry.name))
      .map((entry) => {
        const receiptPath = `.pige/trash/memory/${entry.name}`;
        const receipt = parseMemoryLifecycleReceipt(readJson(vaultPath, receiptPath));
        if (receipt.action !== "delete" || receipt.activeVaultId !== parsed.activeVaultId || !receipt.memoryId) return undefined;
        const removed = receipt.removedRecords[0];
        if (!removed || removed.id !== receipt.memoryId) throw memoryLifecycleConflict();
        const operation = readOperation(vaultPath, receipt.operationId);
        if (!operation || stableJson(operation) !== stableJson(createMemoryLifecycleOperation(receipt))) {
          throw memoryLifecycleConflict();
        }
        const binding = readMemoryOperationBinding(operation);
        if (
          binding?.action !== "delete" || binding.memoryId !== removed.id ||
          binding.receiptPath !== receiptPath || binding.afterRevision !== receipt.afterRevision
        ) throw memoryLifecycleConflict();
        const undo = readOperation(vaultPath, createMemoryUndoOperationId(operation.id));
        if (undo && !isMatchingMemoryRestoreOperation(operation, undo)) throw memoryLifecycleConflict();
        const activity = this.memory.activitySummary(operation, undo);
        if (!activity || activity.status !== "applied" || !activity.canUndo) return undefined;
        return {
          memoryId: removed.id,
          trashOperationId: operation.id,
          kind: removed.kind,
          title: removed.title,
          trashedAt: receipt.createdAt
        } as const;
      })
      .filter((record): record is NonNullable<typeof record> => record !== undefined)
      .sort((left, right) => right.trashedAt.localeCompare(left.trashedAt) ||
        left.trashOperationId.localeCompare(right.trashOperationId))
      .slice(0, 1_000);
    return trashSummary(parsed.activeVaultId, current.revision, records);
  }

  restore(vaultPath: string, request: MemoryTrashRestoreRequest): MemoryTrashRestoreResult {
    const parsed = MemoryTrashRestoreRequestSchema.parse(request);
    const listRequest = { apiVersion: 1 as const, activeVaultId: parsed.activeVaultId };
    const trash = this.list(vaultPath, listRequest);
    const summary = this.memory.list(vaultPath, parsed.activeVaultId);
    if (trash.revision !== parsed.expectedRevision || summary.revision !== parsed.expectedRevision) {
      return restoreResult(parsed, "stale", summary, trash);
    }
    const candidate = trash.records.find((record) =>
      record.memoryId === parsed.memoryId && record.trashOperationId === parsed.trashOperationId);
    if (!candidate) return restoreResult(parsed, "not_found", summary, trash);
    const operation = readOperation(vaultPath, candidate.trashOperationId);
    if (!operation) return restoreResult(parsed, "not_found", summary, trash);
    const binding = readMemoryOperationBinding(operation);
    if (binding?.action !== "delete" || binding.memoryId !== parsed.memoryId) {
      throw memoryLifecycleConflict();
    }
    const result = this.memory.undo(operation, String(binding.afterRevision));
    const nextSummary = this.memory.list(vaultPath, parsed.activeVaultId);
    const nextTrash = this.list(vaultPath, listRequest);
    if (result.status === "undone" || result.status === "already_undone") {
      return MemoryTrashRestoreResultSchema.parse({
        apiVersion: 1,
        requestId: parsed.requestId,
        activeVaultId: parsed.activeVaultId,
        status: "committed",
        operationId: result.undoOperationId,
        summary: nextSummary,
        trash: nextTrash
      });
    }
    return restoreResult(parsed, result.status === "stale" ? "stale" : "not_found", nextSummary, nextTrash);
  }
}

function trashSummary(
  activeVaultId: string,
  revision: number,
  records: MemoryTrashSummary["records"]
): MemoryTrashSummary {
  return MemoryTrashSummarySchema.parse({ apiVersion: 1, activeVaultId, revision, records });
}

function restoreResult(
  request: MemoryTrashRestoreRequest,
  status: "stale" | "not_found",
  summary: MemorySummary,
  trash: MemoryTrashSummary
): MemoryTrashRestoreResult {
  return MemoryTrashRestoreResultSchema.parse({
    apiVersion: 1,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    status,
    summary,
    trash
  });
}

function readOperation(vaultPath: string, operationId: string): OperationRecord | undefined {
  const value = readJson(vaultPath, memoryOperationRelativePath(operationId), true);
  return value === undefined ? undefined : OperationRecordSchema.parse(value);
}

function readJson(vaultPath: string, relativePath: string, optional = false): unknown | undefined {
  const file = existingFile(vaultPath, relativePath);
  if (!file) {
    if (optional) return undefined;
    throw memoryLifecycleConflict();
  }
  const stats = fs.lstatSync(file);
  if (stats.size > MAX_PRIVATE_RECORD_BYTES) throw memoryLifecycleConflict();
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw memoryLifecycleConflict();
  }
}

function existingFile(vaultPath: string, relativePath: string): string | undefined {
  const parts = safeParts(relativePath);
  const parent = existingDirectory(vaultPath, parts.slice(0, -1).join("/"));
  if (!parent) return undefined;
  const file = path.join(parent, parts.at(-1)!);
  if (!fs.existsSync(file)) return undefined;
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) throw memoryLifecycleConflict();
  return file;
}

function existingDirectory(vaultPath: string, relativePath: string): string | undefined {
  const root = fs.realpathSync.native(vaultPath);
  let current = root;
  for (const part of safeParts(relativePath)) {
    const next = path.join(current, part);
    if (!fs.existsSync(next)) return undefined;
    const stats = fs.lstatSync(next);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw memoryLifecycleConflict();
    current = next;
  }
  return current;
}

function safeParts(relativePath: string): readonly string[] {
  if (path.isAbsolute(relativePath) || relativePath.includes("\\")) throw memoryLifecycleConflict();
  const parts = relativePath.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw memoryLifecycleConflict();
  return parts;
}
