import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  KnowledgeActivitySummary,
  KnowledgeActivityUndoResult,
  VaultSummary
} from "@pige/contracts";
import {
  extractPigeMarkdownLinkRefs,
  normalizePigeTag,
  parsePigeFrontmatter
} from "@pige/markdown";
import {
  MarkdownPageStatusSchema,
  MarkdownPageTypeSchema,
  OperationRecordSchema,
  PageIdSchema,
  SourceIdSchema,
  type OperationRecord
} from "@pige/schemas";
import { flushDirectoryWhereSupported } from "./durable-directory-sync";
import {
  createGeneratedNoteExclusive,
  readGeneratedNoteExact,
  replaceGeneratedNoteExact
} from "./generated-note-file";
import {
  assertMarkdownPagePathConfined,
  findMarkdownPageByIdAtSignature,
  readMarkdownPageContentAtSignature,
  type MarkdownFileSignatureRecord
} from "./markdown-page-index";
import { createUserPageUpdateRedoOperationId, createUserPageUpdateUndoOperationId } from "./note-markdown-editor-activity-ids";
import { isEditableMarkdownPage, isEditableMarkdownPageType, preservesEditableMarkdownOwnership, preservesEditableMarkdownPageOwnership } from "./markdown-source-editor-policy";
export const MAX_NOTE_MARKDOWN_EDITOR_BYTES = 4 * 1024 * 1024;
const MAX_RENDER_BINDINGS = 64;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_REFERENCE_LENGTH = 256;
const MAX_OPERATION_BYTES = 256 * 1024;
const UNSAFE_TEXT_PATTERN = /[\u0000\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const SOURCE_CITATION_PATTERN = /^source:src_\d{8}_[a-z0-9]{8,}(?:#[^\s\]\u0000-\u001f\u007f-\u009f]{1,256})?$/u;
export interface NoteMarkdownEditorVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}
export interface NoteMarkdownEditorActivityPort {
  recordPageUpdate(input: {
    readonly vaultPath: string;
    readonly operation: OperationRecord;
    readonly beforeMarkdown: string;
    readonly afterMarkdown: string;
  }): void;
}
export interface NoteMarkdownEditorOpenRequest {
  readonly activeVaultId: string;
  readonly pageId: string;
}
export type NoteMarkdownEditorOpenResult =
  | {
      readonly status: "opened";
      readonly activeVaultId: string;
      readonly pageId: string;
      readonly markdown: string;
      readonly revisionId: string;
      readonly renderIdentity: string;
    }
  | { readonly status: "invalid" | "not_found" | "failed" };
export interface NoteMarkdownEditorSaveRequest {
  readonly requestId: string;
  readonly activeVaultId: string;
  readonly pageId: string;
  readonly expectedRevisionId: string;
  readonly renderIdentity: string;
  readonly markdown: string;
  readonly operationId?: string;
}
export type NoteMarkdownEditorSaveResult =
  | {
      readonly status: "committed";
      readonly requestId: string;
      readonly activeVaultId: string;
      readonly pageId: string;
      readonly revisionId: string;
      readonly renderIdentity: string;
      readonly operationId: string;
    }
  | {
      readonly status: "stale" | "not_found" | "invalid" | "failed";
      readonly requestId: string;
      readonly activeVaultId: string;
      readonly pageId: string;
      readonly invalidReason?: "unsupported_page_type";
    };
interface RenderBinding {
  readonly activeVaultId: string; readonly vaultPath: string;
  readonly pageId: string; readonly pagePath: string;
  readonly signature: MarkdownFileSignatureRecord;
  readonly revisionId: string; readonly renderIdentity: string;
}
interface NoteMarkdownEditorDependencies {
  readonly now?: () => Date; readonly randomId?: () => string;
  readonly allowClaim?: boolean; readonly allowQuestion?: boolean; readonly allowConcept?: boolean; readonly allowEntity?: boolean; }
export interface NoteMarkdownEditorActivityRecoveryResult { readonly recovered: number; readonly failed: number }
export class NoteMarkdownEditorService {
  readonly #vaults: NoteMarkdownEditorVaultPort;
  readonly #activity: NoteMarkdownEditorActivityPort;
  readonly #now: () => Date;
  readonly #randomId: () => string;
  readonly #allowClaim: boolean; readonly #allowQuestion: boolean; readonly #allowConcept: boolean; readonly #allowEntity: boolean;
  readonly #bindings = new Map<string, RenderBinding>();
  constructor(
    vaults: NoteMarkdownEditorVaultPort,
    activity: NoteMarkdownEditorActivityPort,
    dependencies: NoteMarkdownEditorDependencies = {}
  ) {
    this.#vaults = vaults;
    this.#activity = activity;
    this.#now = dependencies.now ?? (() => new Date());
    this.#randomId = dependencies.randomId ?? randomUUID;
    this.#allowClaim = dependencies.allowClaim ?? false; this.#allowQuestion = dependencies.allowQuestion ?? false; this.#allowConcept = dependencies.allowConcept ?? false; this.#allowEntity = dependencies.allowEntity ?? false;
  }
  open(request: NoteMarkdownEditorOpenRequest): NoteMarkdownEditorOpenResult {
    if (!isNonemptyBoundedString(request?.activeVaultId, 256) || !PageIdSchema.safeParse(request?.pageId).success) {
      return { status: "invalid" };
    }
    const scope = this.#currentScope(request.activeVaultId);
    if (!scope) return { status: "not_found" };
    try {
      const located = findMarkdownPageByIdAtSignature(scope.vaultPath, request.pageId);
      if (!located) return { status: "not_found" };
      const content = readMarkdownPageContentAtSignature(
        scope.vaultPath,
        located.signature,
        MAX_NOTE_MARKDOWN_EDITOR_BYTES + 1
      );
      if (!validateEditablePageMarkdown(content.markdown, request.pageId, this.#allowClaim, this.#allowQuestion, this.#allowConcept, this.#allowEntity)) return { status: "failed" };
      if (!this.#scopeMatches(scope.activeVaultId, scope.vaultPath)) return { status: "failed" };
      const revisionId = hashMarkdown(content.markdown);
      const renderIdentity = createRenderIdentity({
        activeVaultId: scope.activeVaultId,
        pageId: request.pageId,
        pagePath: located.signature.pagePath,
        revisionId
      });
      this.#registerBinding({
        activeVaultId: scope.activeVaultId,
        vaultPath: scope.vaultPath,
        pageId: request.pageId,
        pagePath: located.signature.pagePath,
        signature: located.signature,
        revisionId,
        renderIdentity
      });
      return {
        status: "opened",
        activeVaultId: scope.activeVaultId,
        pageId: request.pageId,
        markdown: content.markdown,
        revisionId,
        renderIdentity
      };
    } catch {
      return { status: "failed" };
    }
  }
  save(request: NoteMarkdownEditorSaveRequest, operationKind: "update_page" | "archive_page" | "restore_page" = "update_page"): NoteMarkdownEditorSaveResult {
    const identity = saveIdentity(request);
    if (!isValidSaveRequest(request)) return { status: "invalid", ...identity };
    if (!validatePortableMarkdown(request.markdown, request.pageId)) {
      return { status: "invalid", ...identity };
    }
    if (!isEditableMarkdownPageType(request.markdown, this.#allowClaim, this.#allowQuestion, this.#allowConcept, this.#allowEntity)) {
      return { status: "invalid", ...identity, invalidReason: "unsupported_page_type" };
    }
    const binding = this.#bindings.get(request.renderIdentity);
    if (
      !binding ||
      binding.activeVaultId !== request.activeVaultId ||
      binding.pageId !== request.pageId ||
      binding.revisionId !== request.expectedRevisionId
    ) {
      return { status: "stale", ...identity };
    }
    if (!this.#scopeMatches(binding.activeVaultId, binding.vaultPath)) {
      return { status: "stale", ...identity };
    }
    let beforeMarkdown: string;
    try {
      beforeMarkdown = readMarkdownPageContentAtSignature(
        binding.vaultPath,
        binding.signature,
        MAX_NOTE_MARKDOWN_EDITOR_BYTES + 1
      ).markdown;
    } catch (caught) {
      return { status: pathStillExists(binding.signature.absolutePath) ? "stale" : "not_found", ...identity };
    }
    if (hashMarkdown(beforeMarkdown) !== binding.revisionId) {
      return { status: "stale", ...identity };
    }
    if (!preservesEditableMarkdownPageOwnership(beforeMarkdown, request.markdown, this.#allowClaim, this.#allowQuestion, this.#allowConcept, this.#allowEntity)) {
      return { status: "invalid", ...identity, invalidReason: "unsupported_page_type" };
    }
    if (request.markdown === beforeMarkdown) {
      return { status: "invalid", ...identity };
    }
    const afterRevisionId = hashMarkdown(request.markdown);
    const operationId = createOperationId(this.#now(), this.#randomId(), request, afterRevisionId);
    const operation = createUpdateOperation({
      operationId,
      createdAt: this.#now().toISOString(),
      pageId: binding.pageId,
      pagePath: binding.pagePath,
      beforeRevisionId: binding.revisionId,
      afterRevisionId,
      operationKind
    });
    let committedSignature: MarkdownFileSignatureRecord;
    try {
      committedSignature = this.#replaceExact(binding, beforeMarkdown, request.markdown);
      this.#activity.recordPageUpdate({
        vaultPath: binding.vaultPath,
        operation,
        beforeMarkdown,
        afterMarkdown: request.markdown
      });
    } catch (caught) {
      return {
        status: caught instanceof StaleMarkdownPageError ? "stale" : "failed",
        ...identity
      };
    }
    const renderIdentity = createRenderIdentity({
      activeVaultId: binding.activeVaultId,
      pageId: binding.pageId,
      pagePath: binding.pagePath,
      revisionId: afterRevisionId
    });
    this.#bindings.delete(binding.renderIdentity);
    this.#registerBinding({
      ...binding,
      signature: committedSignature,
      revisionId: afterRevisionId,
      renderIdentity
    });
    return {
      status: "committed",
      ...identity,
      revisionId: afterRevisionId,
      renderIdentity,
      operationId
    };
  }
  #replaceExact(binding: RenderBinding, beforeMarkdown: string, afterMarkdown: string): MarkdownFileSignatureRecord {
    assertMarkdownPagePathConfined(binding.vaultPath, binding.signature.absolutePath);
    const parentPath = path.dirname(binding.signature.absolutePath);
    const parentBefore = readRealDirectoryIdentity(binding.vaultPath, parentPath);
    const temporaryPath = path.join(
      parentPath,
      `.${path.basename(binding.signature.absolutePath)}.${process.pid}.${this.#randomId()}.tmp`
    );
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(
        temporaryPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
        0o600
      );
      const temporaryBefore = fs.fstatSync(descriptor);
      if (!temporaryBefore.isFile() || temporaryBefore.isSymbolicLink() || temporaryBefore.nlink !== 1) {
        throw new Error("The Markdown replacement is not a private regular file.");
      }
      fs.writeFileSync(descriptor, afterMarkdown, "utf8");
      fs.fsyncSync(descriptor);
      const temporaryAfter = fs.fstatSync(descriptor);
      if (!sameInode(temporaryBefore, temporaryAfter) || temporaryAfter.nlink !== 1) {
        throw new Error("The Markdown replacement changed while it was written.");
      }
      fs.closeSync(descriptor);
      descriptor = undefined;
      if (!this.#scopeMatches(binding.activeVaultId, binding.vaultPath)) throw new StaleMarkdownPageError();
      assertSameDirectoryIdentity(binding.vaultPath, parentPath, parentBefore);
      const current = readMarkdownPageContentAtSignature(
        binding.vaultPath,
        binding.signature,
        MAX_NOTE_MARKDOWN_EDITOR_BYTES + 1
      ).markdown;
      if (current !== beforeMarkdown || hashMarkdown(current) !== binding.revisionId) {
        throw new StaleMarkdownPageError();
      }
      const temporaryNamed = fs.lstatSync(temporaryPath);
      if (temporaryNamed.isSymbolicLink() || !temporaryNamed.isFile() || temporaryNamed.nlink !== 1) {
        throw new Error("The Markdown replacement changed before commit.");
      }
      assertSameDirectoryIdentity(binding.vaultPath, parentPath, parentBefore);
      fs.renameSync(temporaryPath, binding.signature.absolutePath);
      flushDirectoryWhereSupported(parentPath);
      const stat = fs.lstatSync(binding.signature.absolutePath);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
        throw new Error("The committed Markdown page is not a private regular file.");
      }
      const signature = signatureFromStat(binding.signature, stat);
      const committed = readMarkdownPageContentAtSignature(
        binding.vaultPath,
        signature,
        MAX_NOTE_MARKDOWN_EDITOR_BYTES + 1
      ).markdown;
      if (committed !== afterMarkdown || !validateEditablePageMarkdown(committed, binding.pageId, this.#allowClaim, this.#allowQuestion, this.#allowConcept, this.#allowEntity)) {
        throw new Error("The committed Markdown page could not be verified.");
      }
      return signature;
    } catch (caught) {
      if (caught instanceof StaleMarkdownPageError) throw caught;
      if (!pathStillExists(binding.signature.absolutePath)) throw new StaleMarkdownPageError();
      throw caught;
    } finally {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch { /* Preserve the authoritative result. */ }
      }
      try { fs.unlinkSync(temporaryPath); } catch { /* The temporary may already be committed or absent. */ }
    }
  }
  #currentScope(activeVaultId: string): { readonly activeVaultId: string; readonly vaultPath: string } | undefined {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    return vault && vaultPath && vault.vaultId === activeVaultId
      ? { activeVaultId, vaultPath: path.resolve(vaultPath) }
      : undefined;
  }
  #scopeMatches(activeVaultId: string, vaultPath: string): boolean {
    const vault = this.#vaults.current();
    const currentPath = this.#vaults.activeVaultPath();
    return vault?.vaultId === activeVaultId && !!currentPath && path.resolve(currentPath) === vaultPath;
  }
  #registerBinding(binding: RenderBinding): void {
    this.#bindings.delete(binding.renderIdentity);
    this.#bindings.set(binding.renderIdentity, binding);
    while (this.#bindings.size > MAX_RENDER_BINDINGS) {
      const oldest = this.#bindings.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#bindings.delete(oldest);
    }
  }
}
export interface UserPageUpdateBinding {
  readonly pageId: string;
  readonly pagePath: string;
  readonly beforeHash: string;
  readonly beforePath: string;
  readonly afterHash: string;
}
/**
 * Private Activity adapter for direct user Markdown edits. Main can compose this
 * behind the shared Activity owner without exposing paths or content to the renderer.
 */
export class NoteMarkdownEditorActivityAdapter implements NoteMarkdownEditorActivityPort {
  readonly #vaults: NoteMarkdownEditorVaultPort;
  constructor(vaults: NoteMarkdownEditorVaultPort) {
    this.#vaults = vaults;
  }
  recordPageUpdate(input: {
    readonly vaultPath: string;
    readonly operation: OperationRecord;
    readonly beforeMarkdown: string;
    readonly afterMarkdown: string;
  }): void {
    const binding = readUserPageUpdateBinding(input.operation);
    if (
      !binding ||
      hashMarkdown(input.beforeMarkdown) !== binding.beforeHash ||
      hashMarkdown(input.afterMarkdown) !== binding.afterHash ||
      !validateActivityMarkdown(input.beforeMarkdown, binding.pageId) ||
      !validateActivityMarkdown(input.afterMarkdown, binding.pageId) ||
      !preservesEditableMarkdownPageOwnership(input.beforeMarkdown, input.afterMarkdown, true, true, true, true)
    ) {
      throw new Error("The Markdown Activity update binding is invalid.");
    }
    const active = this.#activeVaultPath();
    if (!active || active !== path.resolve(input.vaultPath)) {
      throw new Error("The Markdown Activity vault binding is stale.");
    }
    const livePath = resolvePrivateVaultPath(active, binding.pagePath);
    const live = readGeneratedNoteExact(active, livePath, MAX_NOTE_MARKDOWN_EDITOR_BYTES);
    if (live === undefined || hashMarkdown(live) !== binding.afterHash) {
      throw new Error("The Markdown Activity target does not match its committed revision.");
    }
    persistExactPrivateFile(active, binding.beforePath, input.beforeMarkdown, MAX_NOTE_MARKDOWN_EDITOR_BYTES);
    persistExactOperation(active, input.operation);
  }
  activitySummary(
    operation: OperationRecord,
    undoOperation?: OperationRecord
  ): KnowledgeActivitySummary | undefined {
    const binding = readUserPageUpdateBinding(operation);
    if (!binding) return undefined;
    if (undoOperation && !isMatchingUserPageUpdateUndo(operation, undoOperation)) return undefined;
    const vaultPath = this.#activeVaultPath();
    const current = vaultPath
      ? readPrivateTextOrUndefined(vaultPath, binding.pagePath, MAX_NOTE_MARKDOWN_EDITOR_BYTES)
      : undefined;
    const redoOperation = undoOperation && vaultPath
      ? readOperationOrUndefined(vaultPath, createUserPageUpdateRedoOperationId(operation.id))
      : undefined;
    const matchingRedo = !!redoOperation && isMatchingUserPageUpdateRedo(operation, redoOperation);
    const targetMissing = !undoOperation && current === undefined;
    const contentChanged = !undoOperation && current !== undefined && hashMarkdown(current) !== binding.afterHash;
    const canRedo = !!undoOperation && !redoOperation && current !== undefined && hashMarkdown(current) === binding.beforeHash;
    const targetLabel = current ? safePageTitle(current, binding.pageId) : undefined;
    return {
      operationId: operation.id,
      kind: operation.kind as "update_page" | "archive_page" | "restore_page",
      createdAt: operation.createdAt,
      ...(targetLabel ? { targetLabel } : {}),
      target: { kind: "page", pageId: binding.pageId },
      status: undoOperation ? "undone" : "applied",
      canUndo: !undoOperation && !targetMissing && !contentChanged,
      ...(undoOperation ? {
        canRedo,
        ...(!canRedo ? { redoUnavailableReason: matchingRedo
          ? "already_redone" as const
          : current === undefined ? "target_missing" as const : "content_changed" as const } : {})
      } : {}),
      ...(undoOperation
        ? { undoUnavailableReason: "already_undone" as const }
        : targetMissing
          ? { undoUnavailableReason: "target_missing" as const }
          : contentChanged
            ? { undoUnavailableReason: "content_changed" as const }
            : {})
    };
  }
  findUndoOperation(
    operation: OperationRecord,
    operations: readonly OperationRecord[]
  ): OperationRecord | undefined {
    if (!readUserPageUpdateBinding(operation)) return undefined;
    const candidate = operations.find((entry) => entry.id === createUserPageUpdateUndoOperationId(operation.id));
    return candidate && isMatchingUserPageUpdateUndo(operation, candidate) ? candidate : undefined;
  }
  undo(operation: OperationRecord, expectedRevisionId?: string): KnowledgeActivityUndoResult {
    const binding = readUserPageUpdateBinding(operation);
    if (!binding) return { status: "not_found", operationId: operation.id };
    const vaultPath = this.#activeVaultPath();
    if (!vaultPath) return { status: "not_found", operationId: operation.id };
    if (expectedRevisionId !== undefined && expectedRevisionId !== binding.afterHash) {
      const current = readPrivateTextOrUndefined(vaultPath, binding.pagePath, MAX_NOTE_MARKDOWN_EDITOR_BYTES);
      return {
        status: "stale",
        operationId: operation.id,
        ...(current ? { currentRevisionId: hashMarkdown(current) } : {})
      };
    }
    const existing = readOperationOrUndefined(vaultPath, createUserPageUpdateUndoOperationId(operation.id));
    if (existing) {
      if (!isMatchingUserPageUpdateUndo(operation, existing)) {
        throw new Error("The deterministic Markdown Undo identity is occupied.");
      }
      return {
        status: "already_undone",
        operationId: operation.id,
        undoOperationId: existing.id,
        revisionId: binding.beforeHash
      };
    }
    const live = readPrivateTextOrUndefined(vaultPath, binding.pagePath, MAX_NOTE_MARKDOWN_EDITOR_BYTES);
    if (live === undefined) return { status: "not_found", operationId: operation.id };
    const currentRevisionId = hashMarkdown(live);
    if (currentRevisionId !== binding.afterHash) {
      return { status: "stale", operationId: operation.id, currentRevisionId };
    }
    const before = requireExactPrivateFile(
      vaultPath,
      binding.beforePath,
      binding.beforeHash,
      MAX_NOTE_MARKDOWN_EDITOR_BYTES
    );
    if (!validateActivityMarkdown(before, binding.pageId)) {
      throw new Error("The Markdown Activity before-image is invalid.");
    }
    const undo = createUserPageUpdateUndoOperation(operation, binding);
    const undoBinding = readUserPageUpdateUndoBinding(undo);
    if (!undoBinding) throw new Error("The Markdown Undo operation is invalid.");
    persistExactPrivateFile(vaultPath, undoBinding.beforePath, live, MAX_NOTE_MARKDOWN_EDITOR_BYTES);
    persistExactPrivateFile(vaultPath, undoBinding.stagedPath, before, MAX_NOTE_MARKDOWN_EDITOR_BYTES);
    replaceGeneratedNoteExact(
      vaultPath,
      resolvePrivateVaultPath(vaultPath, binding.pagePath),
      resolvePrivateVaultPath(vaultPath, undoBinding.stagedPath),
      {
        beforeHash: binding.afterHash,
        afterHash: binding.beforeHash,
        maximumBytes: MAX_NOTE_MARKDOWN_EDITOR_BYTES
      }
    );
    persistExactOperation(vaultPath, undo);
    return {
      status: "undone",
      operationId: operation.id,
      undoOperationId: undo.id,
      revisionId: binding.beforeHash
    };
  }
  recoverIncompleteOperations(): NoteMarkdownEditorActivityRecoveryResult {
    const vaultPath = this.#activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0;
    let failed = 0;
    for (const operation of readUserPageUpdateOperations(vaultPath)) {
      const binding = readUserPageUpdateBinding(operation);
      if (!binding) continue;
      try {
        const undoId = createUserPageUpdateUndoOperationId(operation.id);
        const existing = readOperationOrUndefined(vaultPath, undoId);
        if (existing) {
          if (!isMatchingUserPageUpdateUndo(operation, existing)) throw new Error("Invalid Markdown Undo record.");
          continue;
        }
        const undo = createUserPageUpdateUndoOperation(operation, binding);
        const undoBinding = readUserPageUpdateUndoBinding(undo);
        if (!undoBinding) throw new Error("Invalid Markdown Undo binding.");
        const live = readPrivateTextOrUndefined(vaultPath, binding.pagePath, MAX_NOTE_MARKDOWN_EDITOR_BYTES);
        const undoBefore = readPrivateTextOrUndefined(
          vaultPath,
          undoBinding.beforePath,
          MAX_NOTE_MARKDOWN_EDITOR_BYTES
        );
        if (
          live !== undefined &&
          hashMarkdown(live) === binding.beforeHash &&
          undoBefore !== undefined &&
          hashMarkdown(undoBefore) === binding.afterHash
        ) {
          persistExactOperation(vaultPath, undo);
          recovered += 1;
        }
      } catch {
        failed += 1;
      }
    }
    return { recovered, failed };
  }
  #activeVaultPath(): string | undefined {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    return vault && vaultPath ? path.resolve(vaultPath) : undefined;
  }
}
class StaleMarkdownPageError extends Error {}
function isValidSaveRequest(request: NoteMarkdownEditorSaveRequest): boolean {
  return !!request &&
    isNonemptyBoundedString(request.requestId, MAX_REQUEST_ID_LENGTH) &&
    isNonemptyBoundedString(request.activeVaultId, 256) &&
    PageIdSchema.safeParse(request.pageId).success &&
    /^sha256:[a-f0-9]{64}$/u.test(request.expectedRevisionId) &&
    /^sha256:[a-f0-9]{64}$/u.test(request.renderIdentity) &&
    typeof request.markdown === "string" &&
    Buffer.byteLength(request.markdown, "utf8") <= MAX_NOTE_MARKDOWN_EDITOR_BYTES;
}
function validatePortableMarkdown(markdown: string, expectedPageId: string): boolean {
  if (
    typeof markdown !== "string" ||
    Buffer.byteLength(markdown, "utf8") > MAX_NOTE_MARKDOWN_EDITOR_BYTES ||
    UNSAFE_TEXT_PATTERN.test(markdown)
  ) return false;
  const parsed = parsePigeFrontmatter(markdown);
  if (!parsed) return false;
  const frontmatter = parsed.frontmatter;
  if (
    frontmatter.id !== expectedPageId ||
    frontmatter.schema_version !== 1 ||
    !isNonemptyBoundedString(frontmatter.title, 256) ||
    frontmatter.title !== frontmatter.title.trim() ||
    !MarkdownPageTypeSchema.safeParse(frontmatter.type).success ||
    !MarkdownPageStatusSchema.safeParse(frontmatter.status).success ||
    !isIsoDateTime(frontmatter.created_at) ||
    !isIsoDateTime(frontmatter.updated_at)
  ) return false;
  if (!hasExactlyOneRequiredFrontmatterField(parsed.raw)) return false;
  if (!validFrontmatterArrays(parsed.raw, frontmatter)) return false;
  if (!validWikiLinks(markdown) || !validSourceCitations(markdown)) return false;
  return extractPigeMarkdownLinkRefs(markdown).every((reference) => reference.target.length <= MAX_REFERENCE_LENGTH && !UNSAFE_TEXT_PATTERN.test(reference.target));
}
export function validateEditableMarkdown(markdown: string, expectedPageId: string): boolean {
  return validatePortableMarkdown(markdown, expectedPageId) && isEditableMarkdownPage(markdown);
}
function validateEditablePageMarkdown(markdown: string, expectedPageId: string, allowClaim: boolean,
  allowQuestion = false, allowConcept = false, allowEntity = false): boolean { return validatePortableMarkdown(markdown, expectedPageId) && isEditableMarkdownPageType(markdown, allowClaim, allowQuestion, allowConcept, allowEntity); }
export function validateActivityMarkdown(markdown: string, expectedPageId: string): boolean { return validateEditablePageMarkdown(markdown, expectedPageId, true, true, true, true); }
function hasExactlyOneRequiredFrontmatterField(raw: string): boolean {
  const required = ["id", "schema_version", "title", "type", "created_at", "updated_at", "status"];
  return required.every((key) => raw.split(/\r?\n/u).filter((line) => line.startsWith(`${key}:`)).length === 1);
}
function validFrontmatterArrays(
  raw: string,
  frontmatter: ReturnType<typeof parsePigeFrontmatter> extends infer _T ? NonNullable<ReturnType<typeof parsePigeFrontmatter>>["frontmatter"] : never
): boolean {
  for (const key of ["aliases", "tags", "topics", "source_ids"] as const) {
    const present = raw.split(/\r?\n/u).some((line) => line.startsWith(`${key}:`));
    const values = frontmatter[key];
    if (present && !Array.isArray(values)) return false;
    if ((values?.length ?? 0) > (key === "tags" ? 12 : 64)) return false;
    if (values?.some((value) => !isNonemptyBoundedString(value, key === "tags" ? 48 : 256))) return false;
    if (key === "tags" && values?.some((value) => normalizePigeTag(value) !== value)) return false;
    if (key === "source_ids" && values?.some((value) => !SourceIdSchema.safeParse(value).success)) return false;
  }
  return true;
}
function validWikiLinks(markdown: string): boolean {
  const body = stripCode(markdown.slice(parsePigeFrontmatter(markdown)?.bodyStartOffset ?? 0));
  let cursor = 0;
  while (cursor < body.length) {
    const start = body.indexOf("[[", cursor);
    if (start === -1) return !body.includes("]]", cursor);
    const end = body.indexOf("]]", start + 2);
    if (end === -1 || body.slice(start + 2, end).includes("[[")) return false;
    const [target, label, extra] = body.slice(start + 2, end).split("|");
    if (
      extra !== undefined ||
      !validReferencePart(target) ||
      (label !== undefined && !validReferencePart(label))
    ) return false;
    cursor = end + 2;
  }
  return true;
}
function validSourceCitations(markdown: string): boolean {
  const body = stripCode(markdown.slice(parsePigeFrontmatter(markdown)?.bodyStartOffset ?? 0));
  for (let cursor = 0; cursor < body.length;) {
    const start = body.indexOf("[source:", cursor);
    if (start === -1) return true;
    const end = body.indexOf("]", start + 1);
    if (end === -1 || !SOURCE_CITATION_PATTERN.test(body.slice(start + 1, end))) return false;
    cursor = end + 1;
  }
  return true;
}
function stripCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/gu, " ").replace(/`[^`\n]*`/gu, " ");
}
function validReferencePart(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return normalized.length > 0 && normalized.length <= MAX_REFERENCE_LENGTH && !UNSAFE_TEXT_PATTERN.test(normalized);
}
export function createUpdateOperation(input: {
  readonly operationId: string;
  readonly createdAt: string;
  readonly pageId: string;
  readonly pagePath: string;
  readonly beforeRevisionId: string;
  readonly afterRevisionId: string;
  readonly operationKind: "update_page" | "archive_page" | "restore_page";
}): OperationRecord {
  const dateKey = /^op_(\d{8})_/u.exec(input.operationId)?.[1] ?? "19700101";
  const beforePath = `.pige/operations/${dateKey.slice(0, 4)}/${dateKey.slice(4, 6)}/${input.operationId}.before.md`;
  return OperationRecordSchema.parse({
    id: input.operationId,
    schemaVersion: 1,
    createdAt: input.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: input.operationKind,
    targetRefs: [{ kind: "page", id: input.pageId, path: input.pagePath }],
    sourceRefs: [],
    before: { kind: "page", id: input.beforeRevisionId, path: beforePath },
    after: { kind: "page", id: input.afterRevisionId, path: input.pagePath },
    summary: input.operationKind === "archive_page"
      ? "Archived a Markdown knowledge page."
      : input.operationKind === "restore_page"
        ? "Restored an archived Markdown knowledge page."
        : "Edited a Markdown knowledge page.",
    reversible: "yes",
    rollbackHint: "Restore the exact private before-image while the current page revision still matches.",
    warnings: []
  });
}
export function readUserPageUpdateBinding(operation: OperationRecord): UserPageUpdateBinding | undefined {
  const target = operation.targetRefs[0];
  const before = operation.before;
  const after = operation.after;
  if (
    (operation.kind !== "update_page" && operation.kind !== "archive_page" && operation.kind !== "restore_page") ||
    operation.actor.kind !== "user" ||
    operation.actor.runtimeKind !== "desktop_local" ||
    operation.sourceRefs.length !== 0 ||
    operation.targetRefs.length !== 1 ||
    target?.kind !== "page" ||
    !PageIdSchema.safeParse(target.id).success ||
    !isSafePagePath(target.path, target.id) ||
    before?.kind !== "page" ||
    !isSha256(before.id) ||
    before.path !== createUserPageUpdateBeforePath(operation.id) ||
    after?.kind !== "page" ||
    !isSha256(after.id) ||
    after.path !== target.path ||
    operation.reversible !== "yes" ||
    operation.jobId !== undefined ||
    operation.proposalId !== undefined ||
    operation.modelProfileId !== undefined ||
    operation.skillId !== undefined ||
    operation.packageId !== undefined ||
    operation.policyAudit !== undefined
  ) return undefined;
  return {
    pageId: target.id,
    pagePath: target.path!,
    beforeHash: before.id,
    beforePath: before.path,
    afterHash: after.id
  };
}
export function readUserPageUpdateUndoBinding(operation: OperationRecord): {
  readonly originalOperationId: string;
  readonly pageId: string;
  readonly pagePath: string;
  readonly beforeHash: string;
  readonly beforePath: string;
  readonly afterHash: string;
  readonly stagedPath: string;
} | undefined {
  const target = operation.targetRefs[0];
  const source = operation.sourceRefs[0];
  const before = operation.before;
  const after = operation.after;
  if (
    operation.kind !== "update_page" ||
    operation.actor.kind !== "user" ||
    operation.actor.runtimeKind !== "desktop_local" ||
    operation.targetRefs.length !== 1 ||
    target?.kind !== "page" ||
    !PageIdSchema.safeParse(target.id).success ||
    !isSafePagePath(target.path, target.id) ||
    operation.sourceRefs.length !== 1 ||
    source?.kind !== "operation" ||
    !/^op_\d{8}_[a-z0-9]{8,}$/u.test(source.id) ||
    operation.id !== createUserPageUpdateUndoOperationId(source.id) ||
    before?.kind !== "page" ||
    !isSha256(before.id) ||
    before.path !== createUserPageUpdateBeforePath(operation.id) ||
    after?.kind !== "page" ||
    !isSha256(after.id) ||
    after.path !== target.path ||
    operation.reversible !== "best_effort"
  ) return undefined;
  return {
    originalOperationId: source.id,
    pageId: target.id,
    pagePath: target.path!,
    beforeHash: before.id,
    beforePath: before.path,
    afterHash: after.id,
    stagedPath: createUserPageUpdateStagedPath(operation.id)
  };
}
function createUserPageUpdateUndoOperation(
  original: OperationRecord,
  binding: UserPageUpdateBinding
): OperationRecord {
  const operationId = createUserPageUpdateUndoOperationId(original.id);
  return OperationRecordSchema.parse({
    id: operationId,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "update_page",
    targetRefs: [{ kind: "page", id: binding.pageId, path: binding.pagePath }],
    sourceRefs: [{ kind: "operation", id: original.id }],
    before: { kind: "page", id: binding.afterHash, path: createUserPageUpdateBeforePath(operationId) },
    after: { kind: "page", id: binding.beforeHash, path: binding.pagePath },
    summary: "Restored a Markdown knowledge page through a forward user update.",
    reversible: "best_effort",
    rollbackHint: "Create another user edit only while the restored page revision remains current.",
    warnings: []
  });
}
export function isMatchingUserPageUpdateUndo(original: OperationRecord, candidate: OperationRecord): boolean {
  const originalBinding = readUserPageUpdateBinding(original);
  const undoBinding = readUserPageUpdateUndoBinding(candidate);
  return !!originalBinding && !!undoBinding &&
    undoBinding.originalOperationId === original.id &&
    undoBinding.pageId === originalBinding.pageId &&
    undoBinding.pagePath === originalBinding.pagePath &&
    undoBinding.beforeHash === originalBinding.afterHash &&
    undoBinding.afterHash === originalBinding.beforeHash;
}
export function isMatchingUserPageUpdateRedo(original: OperationRecord, candidate: OperationRecord): boolean {
  const originalBinding = readUserPageUpdateBinding(original);
  const redoBinding = readUserPageUpdateBinding(candidate);
  return !!originalBinding && !!redoBinding && candidate.id === createUserPageUpdateRedoOperationId(original.id) &&
    redoBinding.pageId === originalBinding.pageId && redoBinding.pagePath === originalBinding.pagePath &&
    redoBinding.beforeHash === originalBinding.beforeHash && redoBinding.afterHash === originalBinding.afterHash;
}
export function createUserPageUpdateBeforePath(operationId: string): string {
  const dateKey = /^op_(\d{8})_[a-z0-9]{8,}$/u.exec(operationId)?.[1];
  if (!dateKey) throw new Error("The Markdown Activity operation identity is invalid.");
  return `.pige/operations/${dateKey.slice(0, 4)}/${dateKey.slice(4, 6)}/${operationId}.before.md`;
}
export function createUserPageUpdateStagedPath(operationId: string): string {
  const dateKey = /^op_(\d{8})_[a-z0-9]{8,}$/u.exec(operationId)?.[1];
  if (!dateKey) throw new Error("The Markdown Activity operation identity is invalid.");
  return `.pige/operations/${dateKey.slice(0, 4)}/${dateKey.slice(4, 6)}/${operationId}.after.pending.md`;
}
export function persistExactPrivateFile(
  vaultPath: string,
  relativePath: string,
  content: string,
  maximumBytes: number
): void {
  if (Buffer.byteLength(content, "utf8") > maximumBytes) {
    throw new Error("The Markdown Activity private file exceeds its bound.");
  }
  const filePath = resolvePrivateVaultPath(vaultPath, relativePath);
  const result = createGeneratedNoteExclusive(vaultPath, filePath, content);
  if (result === "exists") {
    const existing = readGeneratedNoteExact(vaultPath, filePath, maximumBytes);
    if (existing !== content) throw new Error("The Markdown Activity private identity is occupied.");
  }
}
export function requireExactPrivateFile(
  vaultPath: string,
  relativePath: string,
  expectedHash: string,
  maximumBytes: number
): string {
  const content = readPrivateTextOrUndefined(vaultPath, relativePath, maximumBytes);
  if (content === undefined || hashMarkdown(content) !== expectedHash) {
    throw new Error("The Markdown Activity private file is missing or changed.");
  }
  return content;
}
export function persistExactOperation(vaultPath: string, operation: OperationRecord): void {
  const serialized = `${JSON.stringify(OperationRecordSchema.parse(operation), null, 2)}\n`;
  persistExactPrivateFile(vaultPath, operationRelativePath(operation.id), serialized, MAX_OPERATION_BYTES);
  const current = readOperationOrUndefined(vaultPath, operation.id);
  if (!current || stableJson(current) !== stableJson(operation)) {
    throw new Error("The Markdown Activity Operation could not be adopted exactly.");
  }
}
export function readOperationOrUndefined(vaultPath: string, operationId: string): OperationRecord | undefined {
  const content = readPrivateTextOrUndefined(vaultPath, operationRelativePath(operationId), MAX_OPERATION_BYTES);
  if (content === undefined) return undefined;
  try {
    return OperationRecordSchema.parse(JSON.parse(content));
  } catch {
    throw new Error("The Markdown Activity Operation is malformed.");
  }
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
export function readPrivateTextOrUndefined(
  vaultPath: string,
  relativePath: string,
  maximumBytes: number
): string | undefined {
  try {
    return readGeneratedNoteExact(vaultPath, resolvePrivateVaultPath(vaultPath, relativePath), maximumBytes);
  } catch {
    return undefined;
  }
}
function operationRelativePath(operationId: string): string {
  const dateKey = /^op_(\d{8})_[a-z0-9]{8,}$/u.exec(operationId)?.[1];
  if (!dateKey) throw new Error("The Markdown Activity operation identity is invalid.");
  return `.pige/operations/${dateKey.slice(0, 4)}/${dateKey.slice(4, 6)}/${operationId}.json`;
}
function resolvePrivateVaultPath(vaultPath: string, relativePath: string): string {
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
function isSafePagePath(value: string | undefined, pageId: string): value is string {
  if (!value || !/^(?:wiki|sources)\/.+\.md$/u.test(value)) return false;
  if (value.includes("\\") || value.split("/").some((part) => !part || part === "." || part === "..")) return false;
  return path.posix.basename(value).length > 3 && PageIdSchema.safeParse(pageId).success;
}
function safePageTitle(markdown: string, pageId: string): string | undefined {
  const frontmatter = parsePigeFrontmatter(markdown)?.frontmatter;
  return frontmatter?.id === pageId && isNonemptyBoundedString(frontmatter.title, 256)
    ? frontmatter.title.replace(/\s+/gu, " ").trim()
    : undefined;
}
function isSha256(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/u.test(value);
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en-US"))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function createOperationId(
  now: Date,
  randomId: string,
  request: NoteMarkdownEditorSaveRequest,
  afterRevisionId: string
): string {
  if (request.operationId && /^op_\d{8}_[a-z0-9]{8,}$/u.test(request.operationId)) {
    return request.operationId;
  }
  const dateKey = now.toISOString().slice(0, 10).replace(/-/gu, "");
  const suffix = createHash("sha256")
    .update(`${request.requestId}\0${request.activeVaultId}\0${request.pageId}\0${request.expectedRevisionId}\0${afterRevisionId}\0${randomId}`)
    .digest("hex")
    .slice(0, 16);
  return `op_${dateKey}_${suffix}`;
}
function createRenderIdentity(input: {
  readonly activeVaultId: string;
  readonly pageId: string;
  readonly pagePath: string;
  readonly revisionId: string;
}): string {
  return hashMarkdown(`pige.note-markdown-editor.render.v1\0${input.activeVaultId}\0${input.pageId}\0${input.pagePath}\0${input.revisionId}`);
}
export function hashMarkdown(markdown: string): string {
  return `sha256:${createHash("sha256").update(markdown, "utf8").digest("hex")}`;
}
function saveIdentity(request: NoteMarkdownEditorSaveRequest): {
  readonly requestId: string;
  readonly activeVaultId: string;
  readonly pageId: string;
} {
  return {
    requestId: typeof request?.requestId === "string" ? request.requestId : "invalid",
    activeVaultId: typeof request?.activeVaultId === "string" ? request.activeVaultId : "invalid",
    pageId: typeof request?.pageId === "string" ? request.pageId : "invalid"
  };
}
function readRealDirectoryIdentity(vaultPath: string, directoryPath: string): fs.Stats {
  const stat = fs.lstatSync(directoryPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new StaleMarkdownPageError();
  const realVault = fs.realpathSync.native(path.resolve(vaultPath));
  const realDirectory = fs.realpathSync.native(directoryPath);
  if (!isWithin(realVault, realDirectory)) throw new StaleMarkdownPageError();
  return stat;
}
function assertSameDirectoryIdentity(vaultPath: string, directoryPath: string, expected: fs.Stats): void {
  const current = readRealDirectoryIdentity(vaultPath, directoryPath);
  if (!sameInode(expected, current)) throw new StaleMarkdownPageError();
}
function signatureFromStat(previous: MarkdownFileSignatureRecord, stat: fs.Stats): MarkdownFileSignatureRecord {
  return {
    ...previous,
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    deviceId: String(stat.dev),
    fileId: String(stat.ino)
  };
}
function sameInode(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function pathStillExists(filePath: string): boolean {
  try { fs.lstatSync(filePath); return true; } catch { return false; }
}
function isIsoDateTime(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && !Number.isNaN(Date.parse(value));
}
function isNonemptyBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !UNSAFE_TEXT_PATTERN.test(value);
}
