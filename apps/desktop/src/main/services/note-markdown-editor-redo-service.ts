import path from "node:path";
import fs from "node:fs";
import type {
  KnowledgeActivityRedoRequest,
  KnowledgeActivityRedoResult
} from "@pige/contracts";
import type { OperationRecord } from "@pige/schemas";
import { PigeDomainError } from "@pige/domain";
import { replaceGeneratedNoteExact } from "./generated-note-file";
import {
  MAX_NOTE_MARKDOWN_EDITOR_BYTES,
  createUpdateOperation,
  createUserPageUpdateBeforePath,
  createUserPageUpdateStagedPath,
  hashMarkdown,
  isMatchingUserPageUpdateRedo,
  isMatchingUserPageUpdateUndo,
  persistExactOperation,
  persistExactPrivateFile,
  readOperationOrUndefined,
  readPrivateTextOrUndefined,
  readUserPageUpdateBinding,
  readUserPageUpdateOperations,
  readUserPageUpdateUndoBinding,
  requireExactPrivateFile,
  validateActivityMarkdown,
  type NoteMarkdownEditorVaultPort,
  type UserPageUpdateBinding
} from "./note-markdown-editor-service";
import { preservesEditableMarkdownPageOwnership } from "./markdown-source-editor-policy";
import {
  createUserPageUpdateRedoOperationId,
  createUserPageUpdateUndoOperationId
} from "./note-markdown-editor-activity-ids";

const OPERATION_ID = /^op_\d{8}_[a-z0-9]{8,}$/u;

export class NoteMarkdownEditorRedoService {
  readonly #vaults: NoteMarkdownEditorVaultPort;

  constructor(vaults: NoteMarkdownEditorVaultPort) {
    this.#vaults = vaults;
  }

  redo(request: KnowledgeActivityRedoRequest): KnowledgeActivityRedoResult {
    if (!request || typeof request !== "object" || !OPERATION_ID.test(request.operationId)) {
      throw new PigeDomainError("activity.invalid_operation_id", "The Activity operation identity is invalid.");
    }
    const vaultPath = this.#activeVaultPath();
    if (!vaultPath) return { status: "not_found", operationId: request.operationId };
    const original = readOperationOrUndefined(vaultPath, request.operationId);
    const binding = original && readUserPageUpdateBinding(original);
    if (!original || !binding) return { status: "not_found", operationId: request.operationId };
    return this.#redoExact(vaultPath, original, binding, request.expectedRevisionId, true);
  }

  recoverIncompleteRedos(): { readonly recovered: number; readonly failed: number } {
    const vaultPath = this.#activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0;
    let failed = 0;
    for (const original of readUserPageUpdateOperations(vaultPath)) {
      const binding = readUserPageUpdateBinding(original);
      if (!binding) continue;
      const redoId = createUserPageUpdateRedoOperationId(original.id);
      if (readOperationOrUndefined(vaultPath, redoId)) continue;
      const staged = readPrivateTextOrUndefined(
        vaultPath,
        createUserPageUpdateStagedPath(redoId),
        MAX_NOTE_MARKDOWN_EDITOR_BYTES
      );
      const beforeMarker = readPrivateTextOrUndefined(
        vaultPath,
        createUserPageUpdateBeforePath(redoId),
        MAX_NOTE_MARKDOWN_EDITOR_BYTES
      );
      const live = readPrivateTextOrUndefined(vaultPath, binding.pagePath, MAX_NOTE_MARKDOWN_EDITOR_BYTES);
      if (staged === undefined && !(
        beforeMarker !== undefined && hashMarkdown(beforeMarker) === binding.beforeHash &&
        live !== undefined && hashMarkdown(live) === binding.afterHash
      )) continue;
      try {
        const result = this.#redoExact(vaultPath, original, binding, undefined, false);
        if (result.status === "redone" || result.status === "already_redone") recovered += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    return { recovered, failed };
  }

  #redoExact(
    vaultPath: string,
    original: OperationRecord,
    binding: UserPageUpdateBinding,
    expectedRevisionId: string | undefined,
    allowStart: boolean
  ): KnowledgeActivityRedoResult {
    const undo = readOperationOrUndefined(vaultPath, createUserPageUpdateUndoOperationId(original.id));
    if (!undo || !isMatchingUserPageUpdateUndo(original, undo)) {
      return { status: "not_found", operationId: original.id };
    }
    const redoId = createUserPageUpdateRedoOperationId(original.id);
    const existing = readOperationOrUndefined(vaultPath, redoId);
    if (existing) {
      if (!isMatchingUserPageUpdateRedo(original, existing)) {
        throw new Error("The deterministic Markdown Redo identity is occupied.");
      }
      return {
        status: "already_redone",
        operationId: original.id,
        undoOperationId: undo.id,
        redoOperationId: existing.id,
        revisionId: binding.afterHash
      };
    }
    const live = readPrivateTextOrUndefined(vaultPath, binding.pagePath, MAX_NOTE_MARKDOWN_EDITOR_BYTES);
    if (live === undefined) return { status: "not_found", operationId: original.id };
    const currentRevisionId = hashMarkdown(live);
    if (expectedRevisionId !== undefined && expectedRevisionId !== binding.beforeHash) {
      return { status: "stale", operationId: original.id, currentRevisionId };
    }
    if (currentRevisionId !== binding.beforeHash && currentRevisionId !== binding.afterHash) {
      return { status: "stale", operationId: original.id, currentRevisionId };
    }
    const undoBinding = readUserPageUpdateUndoBinding(undo);
    if (!undoBinding) throw new Error("The Markdown Undo binding is invalid.");
    const after = requireExactPrivateFile(
      vaultPath,
      undoBinding.beforePath,
      binding.afterHash,
      MAX_NOTE_MARKDOWN_EDITOR_BYTES
    );
    const before = requireExactPrivateFile(
      vaultPath,
      binding.beforePath,
      binding.beforeHash,
      MAX_NOTE_MARKDOWN_EDITOR_BYTES
    );
    if (
      !validateActivityMarkdown(after, binding.pageId) ||
      !preservesEditableMarkdownPageOwnership(before, after, true, true)
    ) {
      throw new Error("The Markdown Redo after-image is invalid.");
    }
    if (currentRevisionId === binding.afterHash) {
      const beforeMarker = readPrivateTextOrUndefined(
        vaultPath,
        createUserPageUpdateBeforePath(redoId),
        MAX_NOTE_MARKDOWN_EDITOR_BYTES
      );
      if (beforeMarker === undefined || hashMarkdown(beforeMarker) !== binding.beforeHash) {
        return { status: "stale", operationId: original.id, currentRevisionId };
      }
    }
    if (currentRevisionId === binding.beforeHash) {
      if (!allowStart && readPrivateTextOrUndefined(
        vaultPath,
        createUserPageUpdateStagedPath(redoId),
        MAX_NOTE_MARKDOWN_EDITOR_BYTES
      ) === undefined) return { status: "not_found", operationId: original.id };
      persistExactPrivateFile(
        vaultPath,
        createUserPageUpdateBeforePath(redoId),
        live,
        MAX_NOTE_MARKDOWN_EDITOR_BYTES
      );
      persistExactPrivateFile(
        vaultPath,
        createUserPageUpdateStagedPath(redoId),
        after,
        MAX_NOTE_MARKDOWN_EDITOR_BYTES
      );
      replaceGeneratedNoteExact(
        vaultPath,
        path.resolve(vaultPath, binding.pagePath),
        path.resolve(vaultPath, createUserPageUpdateStagedPath(redoId)),
        {
          beforeHash: binding.beforeHash,
          afterHash: binding.afterHash,
          maximumBytes: MAX_NOTE_MARKDOWN_EDITOR_BYTES
        }
      );
    }
    const beforePath = createUserPageUpdateBeforePath(redoId);
    const redo = createUpdateOperation({
      operationId: redoId,
      createdAt: fs.lstatSync(path.resolve(vaultPath, beforePath)).mtime.toISOString(),
      pageId: binding.pageId,
      pagePath: binding.pagePath,
      beforeRevisionId: binding.beforeHash,
      afterRevisionId: binding.afterHash,
      operationKind: "update_page"
    });
    persistExactOperation(vaultPath, redo);
    return {
      status: "redone",
      operationId: original.id,
      undoOperationId: undo.id,
      redoOperationId: redo.id,
      revisionId: binding.afterHash
    };
  }

  #activeVaultPath(): string | undefined {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    return vault && vaultPath ? path.resolve(vaultPath) : undefined;
  }
}
