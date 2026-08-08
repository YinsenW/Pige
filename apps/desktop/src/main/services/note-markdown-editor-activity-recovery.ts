import fs from "node:fs";
import path from "node:path";
import { OperationRecordSchema, type OperationRecord } from "@pige/schemas";
import { flushDirectoryWhereSupported } from "./durable-directory-sync";
import { replaceGeneratedNoteExact } from "./generated-note-file";
import { preservesEditableMarkdownPageOwnership } from "./markdown-source-editor-policy";
import {
  MAX_NOTE_MARKDOWN_EDITOR_BYTES,
  MAX_OPERATION_BYTES,
  createUserPageUpdateStagedPath,
  hashMarkdown,
  persistExactOperation,
  persistExactPrivateFile,
  readOperationOrUndefined,
  readPrivateTextOrUndefined,
  readUserPageUpdateBinding,
  requireExactPrivateFile,
  validateActivityMarkdown,
  type NoteMarkdownEditorActivityRecoveryResult,
  type NoteMarkdownEditorActivityUpdateInput
} from "./note-markdown-editor-service";

export function assertValidActivityUpdate(input: NoteMarkdownEditorActivityUpdateInput): void {
  const binding = readUserPageUpdateBinding(input.operation);
  if (
    !binding ||
    hashMarkdown(input.beforeMarkdown) !== binding.beforeHash ||
    hashMarkdown(input.afterMarkdown) !== binding.afterHash ||
    !validateActivityMarkdown(input.beforeMarkdown, binding.pageId) ||
    !validateActivityMarkdown(input.afterMarkdown, binding.pageId) ||
    !preservesEditableMarkdownPageOwnership(input.beforeMarkdown, input.afterMarkdown, true, true, true, true, true)
  ) {
    throw new Error("The Markdown Activity update binding is invalid.");
  }
}

export function removeExactPrivateFile(vaultPath: string, relativePath: string, expected: string, maximumBytes = MAX_OPERATION_BYTES): void {
  const current = readPrivateTextOrUndefined(vaultPath, relativePath, maximumBytes);
  if (current === undefined) return;
  if (current !== expected) throw new Error("The Markdown Activity private file changed before cleanup.");
  const filePath = resolvePrivateVaultPath(vaultPath, relativePath);
  fs.unlinkSync(filePath);
  flushDirectoryWhereSupported(path.dirname(filePath));
}

export function resolvePrivateVaultPath(vaultPath: string, relativePath: string): string {
  if (
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) throw new Error("The Markdown Activity path is invalid.");
  const root = path.resolve(vaultPath);
  const resolved = path.resolve(root, ...relativePath.split("/"));
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("The Markdown Activity path escaped its vault.");
  return resolved;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en-US"))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createUserPageUpdatePendingPath(operationId: string): string {
  const dateKey = /^op_(\d{8})_[a-z0-9]{8,}$/u.exec(operationId)?.[1];
  if (!dateKey) throw new Error("The Markdown Activity operation identity is invalid.");
  return `.pige/operations/${dateKey.slice(0, 4)}/${dateKey.slice(4, 6)}/${operationId}.pending.json`;
}

export function prepareClaimSourcePageUpdate(
  input: NoteMarkdownEditorActivityUpdateInput,
  active: string | undefined
): void {
  if (input.recoveryKind !== "claim_source") return;
  assertValidActivityUpdate(input);
  if (!active || active !== path.resolve(input.vaultPath)) {
    throw new Error("The Markdown Activity vault binding is stale.");
  }
  const binding = readUserPageUpdateBinding(input.operation)!;
  const live = readPrivateTextOrUndefined(active, binding.pagePath, MAX_NOTE_MARKDOWN_EDITOR_BYTES);
  if (live === undefined || hashMarkdown(live) !== binding.beforeHash) {
    throw new Error("The Markdown Activity target changed before its recovery receipt was prepared.");
  }
  persistExactPrivateFile(active, binding.beforePath, input.beforeMarkdown, MAX_NOTE_MARKDOWN_EDITOR_BYTES);
  persistExactPrivateFile(active, createUserPageUpdateStagedPath(input.operation.id), input.afterMarkdown, MAX_NOTE_MARKDOWN_EDITOR_BYTES);
  persistExactPrivateFile(active, createUserPageUpdatePendingPath(input.operation.id), pendingPageUpdateReceipt(input.operation), MAX_OPERATION_BYTES);
}

export function abortClaimSourcePageUpdate(
  input: NoteMarkdownEditorActivityUpdateInput,
  active: string | undefined
): void {
  if (input.recoveryKind !== "claim_source") return;
  const binding = readUserPageUpdateBinding(input.operation);
  if (!binding || !active || active !== path.resolve(input.vaultPath)) return;
  const live = readPrivateTextOrUndefined(active, binding.pagePath, MAX_NOTE_MARKDOWN_EDITOR_BYTES);
  if (live !== undefined && hashMarkdown(live) === binding.beforeHash) {
    removeExactPrivateFile(active, createUserPageUpdatePendingPath(input.operation.id), pendingPageUpdateReceipt(input.operation));
    removeExactPrivateFile(active, createUserPageUpdateStagedPath(input.operation.id), input.afterMarkdown, MAX_NOTE_MARKDOWN_EDITOR_BYTES);
  }
}

export function recoverPendingPageUpdates(vaultPath: string): NoteMarkdownEditorActivityRecoveryResult {
  let recovered = 0;
  let failed = 0;
  for (const receipt of readPendingPageUpdateReceipts(vaultPath)) {
    try {
      const binding = readUserPageUpdateBinding(receipt.operation);
      if (!binding) throw new Error("Invalid pending Markdown Activity binding.");
      const before = requireExactPrivateFile(vaultPath, binding.beforePath, binding.beforeHash, MAX_NOTE_MARKDOWN_EDITOR_BYTES);
      const afterPath = createUserPageUpdateStagedPath(receipt.operation.id);
      const after = readPrivateTextOrUndefined(vaultPath, afterPath, MAX_NOTE_MARKDOWN_EDITOR_BYTES);
      if (after === undefined || hashMarkdown(after) !== binding.afterHash) throw new Error("Missing pending after-image.");
      assertValidActivityUpdate({ vaultPath, operation: receipt.operation, beforeMarkdown: before, afterMarkdown: after, recoveryKind: "claim_source" });
      const existing = readOperationOrUndefined(vaultPath, receipt.operation.id);
      if (existing && stableJson(existing) !== stableJson(receipt.operation)) throw new Error("Pending operation identity is occupied.");
      const live = readPrivateTextOrUndefined(vaultPath, binding.pagePath, MAX_NOTE_MARKDOWN_EDITOR_BYTES);
      if (live === undefined) throw new Error("Pending Markdown Activity target is missing.");
      if (hashMarkdown(live) === binding.beforeHash) {
        replaceGeneratedNoteExact(
          vaultPath,
          resolvePrivateVaultPath(vaultPath, binding.pagePath),
          resolvePrivateVaultPath(vaultPath, afterPath),
          { beforeHash: binding.beforeHash, afterHash: binding.afterHash, maximumBytes: MAX_NOTE_MARKDOWN_EDITOR_BYTES }
        );
      } else if (hashMarkdown(live) !== binding.afterHash) {
        throw new Error("Pending Markdown Activity target changed independently.");
      }
      if (!existing) persistExactOperation(vaultPath, receipt.operation);
      removeExactPrivateFile(vaultPath, createUserPageUpdatePendingPath(receipt.operation.id), pendingPageUpdateReceipt(receipt.operation));
      removeExactPrivateFile(vaultPath, afterPath, after, MAX_NOTE_MARKDOWN_EDITOR_BYTES);
      recovered += 1;
    } catch {
      failed += 1;
    }
  }
  return { recovered, failed };
}

interface PendingPageUpdateReceipt {
  readonly operation: OperationRecord;
}

export function pendingPageUpdateReceipt(operation: OperationRecord): string {
  return `${JSON.stringify({ schemaVersion: 1, kind: "claim_source", operation: OperationRecordSchema.parse(operation) }, null, 2)}\n`;
}

function readPendingPageUpdateReceipts(vaultPath: string): readonly PendingPageUpdateReceipt[] {
  const root = resolvePrivateVaultPath(vaultPath, ".pige/operations");
  if (!pathStillExists(root)) return [];
  const receipts: PendingPageUpdateReceipt[] = [];
  for (const year of readSafeDirectories(root, /^\d{4}$/u)) {
    for (const month of readSafeDirectories(path.join(root, year), /^\d{2}$/u)) {
      const directory = path.join(root, year, month);
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !/^op_\d{8}_[a-z0-9]{8,}\.pending\.json$/u.test(entry.name)) continue;
        const relativePath = `.pige/operations/${year}/${month}/${entry.name}`;
        const content = readPrivateTextOrUndefined(vaultPath, relativePath, MAX_OPERATION_BYTES);
        if (!content) continue;
        try {
          const parsed = JSON.parse(content) as { readonly schemaVersion?: unknown; readonly kind?: unknown; readonly operation?: unknown };
          if (parsed.schemaVersion !== 1 || parsed.kind !== "claim_source") continue;
          const operation = OperationRecordSchema.parse(parsed.operation);
          if (operation.id === entry.name.slice(0, -".pending.json".length) && readUserPageUpdateBinding(operation)) {
            receipts.push({ operation });
          }
        } catch {
          // A malformed receipt has no authority to change a page.
        }
      }
    }
  }
  return receipts;
}

export function readUserPageUpdateOperations(vaultPath: string): readonly OperationRecord[] {
  const root = resolvePrivateVaultPath(vaultPath, ".pige/operations");
  if (!pathStillExists(root)) return [];
  const operations: OperationRecord[] = [];
  for (const year of readSafeDirectories(root, /^\d{4}$/u)) {
    for (const month of readSafeDirectories(path.join(root, year), /^\d{2}$/u)) {
      const directory = path.join(root, year, month);
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !/^op_\d{8}_[a-z0-9]{8,}\.json$/u.test(entry.name)) continue;
        try {
          const operation = readOperationOrUndefined(vaultPath, entry.name.slice(0, -5));
          if (operation && readUserPageUpdateBinding(operation)) operations.push(operation);
        } catch {
          // A malformed record cannot gain recovery authority.
        }
      }
    }
  }
  return operations;
}

function readSafeDirectories(root: string, namePattern: RegExp): readonly string[] {
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("Unsafe Activity directory.");
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && namePattern.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en-US"));
}

function pathStillExists(filePath: string): boolean {
  try { fs.lstatSync(filePath); return true; } catch { return false; }
}
