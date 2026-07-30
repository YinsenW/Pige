import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  LibraryPageSummary,
  NoteDocument,
  NoteEditorOpenRequest,
  NoteEditorOpenResult,
  NoteEditorSaveRequest,
  NoteEditorSaveResult,
  NoteGetRequest,
  NoteOpenSourceReferenceRequest,
  NoteOpenSourceReferenceResult,
  NoteRevealSourceRequest,
  NoteResolveInlineReferenceRequest,
  NoteResolveInlineReferenceResult,
  NoteRenderRequest,
  NoteRenderResult,
  ReaderSelectionResolveRequest,
  ReaderSelectionResolveResult,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  parsePigeFrontmatter,
  renderPigeMarkdownToHtml,
  type PigeMarkdownSelectionSegment
} from "@pige/markdown";
import {
  CitationLocatorSchema,
  NoteInlineReferenceHrefSchema,
  PageIdSchema,
  SourceIdSchema,
  type SourceRecord
} from "@pige/schemas";
import {
  createMarkdownPageReferenceKeys,
  findMarkdownPageByIdAtSignature,
  normalizeMarkdownPageReferenceKey,
  readMarkdownPageContentAtSignature,
  readMarkdownPageByRelativePath
} from "./markdown-page-index";
import { NoteMarkdownEditorService } from "./note-markdown-editor-service";
import { reconnectableOriginalSourceIds } from "./reader-source-reconnect-service";
import { readCurrentSourceRecordSnapshot } from "./source-file-access";

const MAX_RENDER_CONTEXTS_PER_OWNER = 16, MAX_RENDER_CONTEXT_HREFS = 128, RENDER_CONTEXT_TTL_MS = 10 * 60 * 1000;
const MAX_NOTE_RENDER_BYTES = 4 * 1024 * 1024;
const UNSAFE_REFERENCE_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

export interface NotesVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export interface NotesInlineReferenceIndexPort {
  inlineReferenceRevision(vaultPath: string): string | undefined;
  inlineReferenceCandidates(
    vaultPath: string,
    request: {
      readonly normalizedKey: string;
      readonly expectedRevision: string;
      readonly exactPageId?: string;
    }
  ): readonly LibraryPageSummary[] | undefined;
}

export interface NotesMarkdownRenderer {
  (markdown: string): Promise<{
    readonly html: string;
    readonly selectionSegments?: readonly PigeMarkdownSelectionSegment[];
  }>;
}

interface FileIdentity {
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly deviceId: string;
  readonly fileId: string;
}

interface NoteRenderContext {
  readonly id: string;
  readonly vaultId: string;
  readonly vaultPath: string;
  readonly pageId: string;
  readonly pageType: NoteDocument["summary"]["pageType"];
  readonly pagePath: string;
  readonly absolutePath: string;
  readonly pageIdentity: FileIdentity;
  readonly pageContentHash: string;
  readonly markdown: string;
  readonly bodyStartOffset: number;
  readonly selectionSegments: ReadonlyMap<string, PigeMarkdownSelectionSegment>;
  readonly hrefs: ReadonlySet<string>;
  readonly sourceIds: ReadonlySet<string>;
  readonly referenceIndexRevision?: string;
  readonly ownerEpoch: number;
  readonly expiresAt: number;
}

interface StableNoteDocument {
  readonly document: NoteDocument;
  readonly markdown: string;
  readonly bodyStartOffset: number;
  readonly pageContentHash: string;
  readonly pagePath: string;
  readonly absolutePath: string;
  readonly identity: FileIdentity;
}

export type NotesSourceRevealResolution =
  | {
      readonly status: "ready";
      readonly vaultPath: string;
      readonly sourceRecord: SourceRecord;
      assertCurrent(): boolean;
    }
  | { readonly status: "stale" | "not_found" };

export type NotesTrashResolution =
  | {
      readonly status: "ready";
      readonly activeVaultId: string;
      readonly vaultPath: string;
      readonly pageId: string;
      readonly pagePath: string;
      readonly absolutePath: string;
      readonly pageContentHash: string;
      readonly title: string;
      assertCurrent(): boolean;
    }
  | { readonly status: "stale" | "not_found" | "ineligible" };

interface NoteEditorBinding {
  readonly privateRenderIdentity: string;
  readonly privateRevision: string;
}

type SourceReferenceResolution =
  | { readonly status: "resolved"; readonly pageId: string }
  | {
      readonly status:
        | "source_unresolved"
        | "index_unavailable"
        | "not_found"
        | "target_not_found"
        | "mismatch"
        | "changed";
    };

export class NotesService {
  readonly #vaults: NotesVaultPort;
  readonly #referenceIndex: NotesInlineReferenceIndexPort | undefined;
  readonly #renderMarkdown: NotesMarkdownRenderer;
  readonly #editor: NoteMarkdownEditorService | undefined;
  readonly #renderContexts = new Map<string, Map<string, NoteRenderContext>>();
  readonly #editorBindings = new Map<string, NoteEditorBinding>();
  readonly #ownerEpochs = new Map<string, number>();

  constructor(
    vaults: NotesVaultPort,
    referenceIndex?: NotesInlineReferenceIndexPort,
    renderMarkdown: NotesMarkdownRenderer = renderPigeMarkdownToHtml,
    editor?: NoteMarkdownEditorService
  ) {
    this.#vaults = vaults;
    this.#referenceIndex = referenceIndex;
    this.#renderMarkdown = renderMarkdown;
    this.#editor = editor;
  }

  get(request: NoteGetRequest): NoteDocument {
    return this.#readStableDocument(request.pageId).document;
  }

  async render(request: NoteRenderRequest, ownerId?: string): Promise<NoteRenderResult> {
    const vault = this.#vaults.current();
    const vaultPath = this.#requireActiveVaultPath();
    if (!vault) throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    const ownerEpoch = ownerId === undefined ? undefined : this.#beginOwnerRender(ownerId);
    const stable = this.#readStableDocument(request.pageId);
    const rendered = await this.#renderMarkdown(stable.document.markdownBody);
    if (
      !this.#matchesScope(vault.vaultId, vaultPath) ||
      !matchesNamedFileIdentity(stable.absolutePath, stable.identity) ||
      (ownerId !== undefined && this.#ownerEpochs.get(ownerId) !== ownerEpoch)
    ) {
      throw new PigeDomainError("note_changed", "The Markdown page changed while it was rendered.");
    }

    const hrefs = extractRenderedInternalHrefs(rendered.html), frontmatter = parsePigeFrontmatter(stable.markdown)?.frontmatter;
    const referenceIndexRevision = this.#referenceIndex?.inlineReferenceRevision(vaultPath);
    const renderContextId = ownerId === undefined
      ? undefined
      : this.#registerRenderContext(ownerId, {
          vaultId: vault.vaultId,
          vaultPath,
          pageId: stable.document.summary.pageId,
          pageType: stable.document.summary.pageType,
          pagePath: stable.pagePath,
          absolutePath: stable.absolutePath,
          pageIdentity: stable.identity,
          pageContentHash: stable.pageContentHash,
          markdown: stable.markdown,
          bodyStartOffset: stable.bodyStartOffset,
          selectionSegments: new Map(
            (rendered.selectionSegments ?? []).map((segment) => [segment.segmentId, segment])
          ),
          hrefs: hrefs ?? new Set<string>(),
          sourceIds: new Set(stable.document.summary.sourceIds),
          ownerEpoch: ownerEpoch!,
          ...(referenceIndexRevision ? { referenceIndexRevision } : {})
        });
    return {
      summary: {
        ...stable.document.summary,
        sourceIds: [...stable.document.summary.sourceIds]
      },
      html: rendered.html,
      byteSize: stable.document.byteSize,
      ...(ownerId === undefined ? {} : { reconnectOriginalSourceIds: reconnectableOriginalSourceIds(vaultPath, stable.document.summary.sourceIds) }),
      ...(renderContextId ? {
        renderContextId,
        ...(stable.document.summary.pageType === "note"
          ? {
              trashEligibility: { canTrash: true as const, revision: publicEditorRevision(stable.pageContentHash) },
              archiveEligibility: { canArchive: stable.document.summary.status === "active", revision: publicEditorRevision(stable.pageContentHash) },
              restoreEligibility: { canRestore: stable.document.summary.status === "archived", revision: publicEditorRevision(stable.pageContentHash) },
              tagging: { tags: [...(frontmatter?.tags ?? [])], canAdd: stable.document.summary.status === "active" && (frontmatter?.tags?.length ?? 0) < 12, revision: publicEditorRevision(stable.pageContentHash) }
            }
          : {})
      } : {})
    };
  }

  openEditor(ownerId: string, request: NoteEditorOpenRequest): NoteEditorOpenResult {
    const identity = editorIdentity(request);
    const context = this.#readRenderContext(ownerId, request.renderContextId);
    if (!this.#editor || !context || !this.#matchesEditorContext(ownerId, context, request)) {
      return { ...identity, status: "stale" };
    }
    if (context.pageType !== "note") return { ...identity, status: "failed" };
    const opened = this.#editor.open({ activeVaultId: request.activeVaultId, pageId: request.pageId });
    if (opened.status === "not_found") return { ...identity, status: "not_found" };
    if (
      opened.status !== "opened" ||
      opened.revisionId !== context.pageContentHash ||
      opened.markdown !== context.markdown
    ) {
      return { ...identity, status: "failed" };
    }
    this.#editorBindings.set(editorBindingKey(ownerId, request.renderContextId), {
      privateRenderIdentity: opened.renderIdentity,
      privateRevision: opened.revisionId
    });
    return {
      ...identity,
      status: "ready",
      renderContextId: request.renderContextId,
      revision: publicEditorRevision(opened.revisionId),
      markdown: opened.markdown
    };
  }

  async saveEditor(ownerId: string, request: NoteEditorSaveRequest): Promise<NoteEditorSaveResult> {
    const identity = editorIdentity(request);
    const context = this.#readRenderContext(ownerId, request.renderContextId);
    const binding = this.#editorBindings.get(editorBindingKey(ownerId, request.renderContextId));
    if (!this.#editor || !context || !binding || !this.#matchesEditorContext(ownerId, context, request)) {
      return { ...identity, status: "stale", revision: request.expectedRevision };
    }
    if (context.pageType !== "note") {
      return { ...identity, status: "invalid", reason: "unsupported_page_type" };
    }
    if (publicEditorRevision(binding.privateRevision) !== request.expectedRevision) {
      return { ...identity, status: "stale", revision: publicEditorRevision(binding.privateRevision) };
    }
    const saved = this.#editor.save({
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      pageId: request.pageId,
      expectedRevisionId: binding.privateRevision,
      renderIdentity: binding.privateRenderIdentity,
      markdown: request.markdown
    });
    if (saved.status === "not_found") return { ...identity, status: "not_found" };
    if (saved.status === "invalid") {
      return {
        ...identity,
        status: "invalid",
        reason: saved.invalidReason ?? "invalid_frontmatter"
      };
    }
    if (saved.status === "failed") return { ...identity, status: "failed" };
    if (saved.status === "stale") {
      return { ...identity, status: "stale", revision: request.expectedRevision };
    }
    if (saved.status !== "committed") return { ...identity, status: "failed" };

    const render = await this.render({ pageId: request.pageId }, ownerId);
    if (!render.renderContextId) return { ...identity, status: "failed" };
    const reopened = this.#editor.open({ activeVaultId: request.activeVaultId, pageId: request.pageId });
    if (reopened.status !== "opened" || reopened.revisionId !== saved.revisionId) {
      return { ...identity, status: "failed" };
    }
    this.#editorBindings.set(editorBindingKey(ownerId, render.renderContextId), {
      privateRenderIdentity: reopened.renderIdentity,
      privateRevision: reopened.revisionId
    });
    return {
      ...identity,
      status: "committed",
      revision: publicEditorRevision(saved.revisionId),
      operationId: saved.operationId,
      render: { ...render, renderContextId: render.renderContextId }
    };
  }

  resolveInlineReference(
    ownerId: string,
    request: NoteResolveInlineReferenceRequest
  ): NoteResolveInlineReferenceResult {
    const initialVault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!initialVault || !vaultPath || initialVault.vaultId !== request.activeVaultId) {
      return staleInlineReference(request.requestId, "vault");
    }

    const context = this.#readRenderContext(ownerId, request.renderContextId);
    if (
      !context ||
      context.vaultId !== request.activeVaultId ||
      context.vaultPath !== vaultPath ||
      context.pageId !== request.currentPageId ||
      this.#ownerEpochs.get(ownerId) !== context.ownerEpoch ||
      !context.hrefs.has(request.href)
    ) {
      return staleInlineReference(request.requestId, "render_context");
    }

    if (!this.#matchesCurrentPage(context)) {
      return staleInlineReference(request.requestId, "page");
    }
    if (!this.#referenceIndex || !context.referenceIndexRevision) {
      return failedInlineReference(request.requestId);
    }

    try {
      const parsed = parseInlineReferenceHref(request.href);
      if (!parsed) return failedInlineReference(request.requestId);
      const result = parsed.kind === "page"
        ? this.#resolvePageReference(request.requestId, context, parsed.target)
        : this.#resolveSourceReference(request.requestId, context, parsed.sourceId, parsed.locator);
      if (!this.#matchesCurrentScope(context)) {
        return staleInlineReference(request.requestId, "vault");
      }
      if (!this.#matchesCurrentPage(context)) {
        return staleInlineReference(request.requestId, "page");
      }
      return result;
    } catch {
      return failedInlineReference(request.requestId);
    }
  }

  isRenderContextCurrent(ownerId: string, input: {
    readonly activeVaultId: string;
    readonly pageId: string;
    readonly renderContextId: string;
  }): boolean {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    const context = this.#readRenderContext(ownerId, input.renderContextId);
    return Boolean(
      vault &&
      vaultPath &&
      vault.vaultId === input.activeVaultId &&
      context &&
      context.vaultId === input.activeVaultId &&
      context.vaultPath === vaultPath &&
      context.pageId === input.pageId &&
      this.#ownerEpochs.get(ownerId) === context.ownerEpoch &&
      this.#matchesCurrentPage(context)
    );
  }

  openSourceReference(
    ownerId: string,
    request: NoteOpenSourceReferenceRequest
  ): NoteOpenSourceReferenceResult {
    const initialVault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!initialVault || !vaultPath || initialVault.vaultId !== request.activeVaultId) {
      return sourceReferenceResult(request.requestId, "stale");
    }

    const context = this.#readRenderContext(ownerId, request.renderContextId);
    if (
      !context ||
      context.vaultId !== request.activeVaultId ||
      context.vaultPath !== vaultPath ||
      context.pageId !== request.currentPageId ||
      this.#ownerEpochs.get(ownerId) !== context.ownerEpoch
    ) {
      return sourceReferenceResult(request.requestId, "stale");
    }
    if (!context.sourceIds.has(request.sourceId)) {
      return sourceReferenceResult(request.requestId, "mismatch");
    }
    if (!this.#matchesCurrentPage(context)) {
      return sourceReferenceResult(request.requestId, "changed");
    }
    if (!this.#referenceIndex || !context.referenceIndexRevision) {
      return sourceReferenceResult(request.requestId, "unresolved");
    }

    try {
      const result = this.#resolveSourceReferenceTarget(context, request.sourceId);
      if (!this.#matchesCurrentScope(context)) {
        return sourceReferenceResult(request.requestId, "stale");
      }
      if (
        this.#ownerEpochs.get(ownerId) !== context.ownerEpoch ||
        !this.#matchesCurrentPage(context)
      ) {
        return sourceReferenceResult(request.requestId, "changed");
      }
      return result.status === "resolved"
        ? {
            apiVersion: 1,
            requestId: request.requestId,
            status: "resolved",
            target: { pageId: result.pageId }
          }
        : sourceReferenceResult(request.requestId, projectSourceReferenceStatus(result.status));
    } catch {
      return sourceReferenceResult(request.requestId, "unresolved");
    }
  }

  resolveSourceReveal(
    ownerId: string,
    request: NoteRevealSourceRequest
  ): NotesSourceRevealResolution {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vault || !vaultPath || vault.vaultId !== request.activeVaultId) return { status: "stale" };
    const context = this.#readRenderContext(ownerId, request.renderContextId);
    if (
      !context ||
      context.vaultId !== request.activeVaultId ||
      context.vaultPath !== vaultPath ||
      context.pageId !== request.currentPageId ||
      this.#ownerEpochs.get(ownerId) !== context.ownerEpoch ||
      !this.#matchesCurrentPage(context)
    ) return { status: "stale" };
    if (!context.sourceIds.has(request.sourceId)) return { status: "not_found" };
    const source = readCurrentSourceRecordSnapshot(vaultPath, request.sourceId);
    if (!source) return { status: "not_found" };
    return {
      status: "ready",
      vaultPath,
      sourceRecord: source.record,
      assertCurrent: () => {
        const current = this.#readRenderContext(ownerId, request.renderContextId);
        const latest = readCurrentSourceRecordSnapshot(vaultPath, request.sourceId);
        return Boolean(
          current === context &&
          latest &&
          this.#ownerEpochs.get(ownerId) === context.ownerEpoch &&
          this.#matchesCurrentPage(context) &&
          sameFileIdentity(source.identity, latest.identity)
        );
      }
    };
  }
  resolveTrashTarget(ownerId: string, input: {
    readonly activeVaultId: string;
    readonly pageId: string;
    readonly renderContextId: string;
    readonly expectedRevision: string;
  }): NotesTrashResolution {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vault || !vaultPath || vault.vaultId !== input.activeVaultId) return { status: "stale" };
    const context = this.#readRenderContext(ownerId, input.renderContextId);
    if (
      !context ||
      context.vaultId !== input.activeVaultId ||
      context.vaultPath !== vaultPath ||
      context.pageId !== input.pageId ||
      this.#ownerEpochs.get(ownerId) !== context.ownerEpoch ||
      publicEditorRevision(context.pageContentHash) !== input.expectedRevision
    ) return { status: "stale" };
    if (!this.#matchesCurrentPage(context)) {
      try {
        fs.lstatSync(context.absolutePath);
      } catch (caught) {
        if (typeof caught === "object" && caught !== null && "code" in caught && caught.code === "ENOENT") {
          return { status: "not_found" };
        }
      }
      return { status: "stale" };
    }
    if (context.pageType !== "note") return { status: "ineligible" };
    const title = parsePigeFrontmatter(context.markdown)?.frontmatter.title?.replace(/\s+/gu, " ").trim();
    if (!title) return { status: "ineligible" };
    return {
      status: "ready",
      activeVaultId: context.vaultId,
      vaultPath: context.vaultPath,
      pageId: context.pageId,
      pagePath: context.pagePath,
      absolutePath: context.absolutePath,
      pageContentHash: context.pageContentHash,
      title: title.slice(0, 120),
      assertCurrent: () => {
        const current = this.#readRenderContext(ownerId, input.renderContextId);
        return current === context &&
          this.#ownerEpochs.get(ownerId) === context.ownerEpoch &&
          this.#matchesCurrentPage(context);
      }
    };
  }
  resolveSelection(
    ownerId: string,
    request: ReaderSelectionResolveRequest
  ): ReaderSelectionResolveResult {
    const initialVault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!initialVault || !vaultPath || initialVault.vaultId !== request.activeVaultId) {
      return staleSelection(request.requestId, "vault");
    }

    const context = this.#readRenderContext(ownerId, request.renderContextId);
    if (
      !context ||
      context.vaultId !== request.activeVaultId ||
      context.vaultPath !== vaultPath ||
      context.pageId !== request.currentPageId ||
      this.#ownerEpochs.get(ownerId) !== context.ownerEpoch
    ) {
      return staleSelection(request.requestId, "render_context");
    }
    if (!this.#matchesCurrentPage(context)) {
      return staleSelection(request.requestId, "page");
    }

    try {
      const anchor = resolveSelectionEndpoint(context, request.anchor);
      const focus = resolveSelectionEndpoint(context, request.focus);
      if (anchor === undefined || focus === undefined) {
        return invalidSelection(request.requestId, "endpoint_not_found");
      }
      if (anchor === "invalid" || focus === "invalid") {
        return invalidSelection(request.requestId, "endpoint_offset_invalid");
      }
      const startOffset = Math.min(anchor, focus);
      const endOffset = Math.max(anchor, focus);
      if (startOffset === endOffset) {
        return invalidSelection(request.requestId, "selection_empty");
      }
      const startByte = Buffer.byteLength(context.markdown.slice(0, startOffset), "utf8");
      const endExclusive = Buffer.byteLength(context.markdown.slice(0, endOffset), "utf8");
      if (endExclusive - startByte > 64 * 1024) {
        return invalidSelection(request.requestId, "selection_too_large");
      }
      if (!this.#matchesCurrentScope(context)) {
        return staleSelection(request.requestId, "vault");
      }
      if (!this.#matchesCurrentPage(context)) {
        return staleSelection(request.requestId, "page");
      }
      const pageBytes = Buffer.from(context.markdown, "utf8");
      return {
        apiVersion: 1,
        requestId: request.requestId,
        status: "resolved",
        selection: {
          pageId: context.pageId,
          pageContentHash: context.pageContentHash,
          span: { unit: "utf8_bytes", start: startByte, endExclusive },
          selectedContentHash: hashBytes(pageBytes.subarray(startByte, endExclusive))
        }
      };
    } catch {
      return failedSelection(request.requestId);
    }
  }

  releaseOwner(ownerId: string): void {
    this.#renderContexts.delete(ownerId);
    this.#ownerEpochs.delete(ownerId);
    for (const key of this.#editorBindings.keys()) {
      if (key.startsWith(`${ownerId}\0`)) this.#editorBindings.delete(key);
    }
  }

  #matchesEditorContext(
    ownerId: string,
    context: NoteRenderContext,
    request: Pick<NoteEditorOpenRequest, "activeVaultId" | "pageId" | "renderContextId">
  ): boolean {
    return context.id === request.renderContextId &&
      context.vaultId === request.activeVaultId &&
      context.pageId === request.pageId &&
      this.#ownerEpochs.get(ownerId) === context.ownerEpoch &&
      this.#matchesCurrentPage(context);
  }

  #resolvePageReference(
    requestId: string,
    context: NoteRenderContext,
    target: string
  ): NoteResolveInlineReferenceResult {
    const normalizedKey = normalizeMarkdownPageReferenceKey(target);
    if (!normalizedKey) return failedInlineReference(requestId);
    const exactPageId = PageIdSchema.safeParse(target).success ? target : undefined;
    const candidates = this.#referenceIndex?.inlineReferenceCandidates(context.vaultPath, {
      normalizedKey,
      expectedRevision: context.referenceIndexRevision!,
      ...(exactPageId ? { exactPageId } : {})
    });
    if (!candidates) return failedInlineReference(requestId);
    if (candidates.length === 0) return notFoundInlineReference(requestId);
    if (candidates.length !== 1) return ambiguousInlineReference(requestId);

    const candidate = candidates[0]!;
    const current = readMarkdownPageByRelativePath(context.vaultPath, candidate.pagePath);
    if (!current || current.summary.pageId !== candidate.pageId) return failedInlineReference(requestId);
    if (
      !exactPageId &&
      !createMarkdownPageReferenceKeys(current).some((reference) => reference.key === normalizedKey)
    ) {
      return failedInlineReference(requestId);
    }
    return {
      apiVersion: 1,
      requestId,
      status: "resolved",
      target: { kind: "page", pageId: candidate.pageId }
    };
  }

  #resolveSourceReference(
    requestId: string,
    context: NoteRenderContext,
    sourceId: string,
    locator: string | undefined
  ): NoteResolveInlineReferenceResult {
    const result = this.#resolveSourceReferenceTarget(context, sourceId);
    if (result.status !== "resolved") {
      return result.status === "source_unresolved" || result.status === "not_found"
        ? notFoundInlineReference(requestId)
        : failedInlineReference(requestId);
    }
    return {
      apiVersion: 1,
      requestId,
      status: "resolved",
      target: {
        kind: "source",
        sourceId,
        pageId: result.pageId,
        ...(locator ? { locator } : {})
      }
    };
  }

  #resolveSourceReferenceTarget(
    context: NoteRenderContext,
    sourceId: string
  ): SourceReferenceResolution {
    const source = readCurrentSourceRecordSnapshot(context.vaultPath, sourceId);
    const pageId = source?.record.knowledgePageId;
    if (!source || !pageId) return { status: "source_unresolved" };
    const candidates = this.#referenceIndex?.inlineReferenceCandidates(context.vaultPath, {
      normalizedKey: normalizeMarkdownPageReferenceKey(pageId),
      expectedRevision: context.referenceIndexRevision!,
      exactPageId: pageId
    });
    if (!candidates) return { status: "index_unavailable" };
    if (candidates.length !== 1) return { status: "not_found" };
    const candidate = candidates[0]!;
    const current = readMarkdownPageByRelativePath(context.vaultPath, candidate.pagePath);
    if (!current) return { status: "target_not_found" };
    if (
      current.summary.pageId !== pageId ||
      current.summary.pageType !== "source" ||
      !current.summary.sourceIds.includes(sourceId) ||
      (source.record.knowledgePagePath !== undefined && source.record.knowledgePagePath !== candidate.pagePath)
    ) {
      return { status: "mismatch" };
    }
    const after = readCurrentSourceRecordSnapshot(context.vaultPath, sourceId);
    if (!after || !sameFileIdentity(source.identity, after.identity)) {
      return { status: "changed" };
    }
    return { status: "resolved", pageId };
  }

  #readStableDocument(pageId: string): StableNoteDocument {
    const vaultPath = this.#requireActiveVaultPath();
    const located = findMarkdownPageByIdAtSignature(vaultPath, pageId);
    if (!located) {
      throw new PigeDomainError("note_not_found", "The requested Markdown page was not found.");
    }
    if (located.signature.sizeBytes > MAX_NOTE_RENDER_BYTES) {
      throw new PigeDomainError("note_too_large", "The Markdown page exceeds the Reader byte limit.");
    }
    const content = readMarkdownPageContentAtSignature(
      vaultPath,
      located.signature,
      MAX_NOTE_RENDER_BYTES
    );
    const identity: FileIdentity = {
      size: located.signature.sizeBytes,
      mtimeMs: located.signature.mtimeMs,
      ctimeMs: located.signature.ctimeMs,
      deviceId: located.signature.deviceId,
      fileId: located.signature.fileId
    };
    return {
      document: {
        summary: located.page.summary,
        markdownBody: content.markdownBody,
        byteSize: located.signature.sizeBytes
      },
      markdown: content.markdown,
      bodyStartOffset: content.bodyStartOffset,
      pageContentHash: hashBytes(Buffer.from(content.markdown, "utf8")),
      pagePath: located.page.summary.pagePath,
      absolutePath: located.page.absolutePath,
      identity
    };
  }

  #registerRenderContext(
    ownerId: string,
    input: Omit<NoteRenderContext, "id" | "expiresAt">
  ): string {
    const now = Date.now();
    const ownerContexts = this.#renderContexts.get(ownerId) ?? new Map<string, NoteRenderContext>();
    for (const [id, context] of ownerContexts) {
      if (context.expiresAt <= now) ownerContexts.delete(id);
    }
    while (ownerContexts.size >= MAX_RENDER_CONTEXTS_PER_OWNER) {
      const oldest = ownerContexts.keys().next().value as string | undefined;
      if (!oldest) break;
      ownerContexts.delete(oldest);
    }
    const id = `notectx_${randomUUID().replace(/-/gu, "")}`;
    ownerContexts.set(id, { ...input, id, expiresAt: now + RENDER_CONTEXT_TTL_MS });
    this.#renderContexts.set(ownerId, ownerContexts);
    return id;
  }

  #readRenderContext(ownerId: string, contextId: string): NoteRenderContext | undefined {
    const ownerContexts = this.#renderContexts.get(ownerId);
    const context = ownerContexts?.get(contextId);
    if (!context) return undefined;
    if (context.expiresAt <= Date.now()) {
      ownerContexts?.delete(contextId);
      if (ownerContexts?.size === 0) this.#renderContexts.delete(ownerId);
      return undefined;
    }
    return context;
  }

  #beginOwnerRender(ownerId: string): number {
    const epoch = (this.#ownerEpochs.get(ownerId) ?? 0) + 1;
    this.#ownerEpochs.set(ownerId, epoch);
    this.#renderContexts.delete(ownerId);
    return epoch;
  }

  #matchesCurrentScope(context: NoteRenderContext): boolean {
    return this.#matchesScope(context.vaultId, context.vaultPath);
  }

  #matchesScope(vaultId: string, vaultPath: string): boolean {
    return this.#vaults.current()?.vaultId === vaultId &&
      this.#vaults.activeVaultPath() === vaultPath;
  }

  #matchesCurrentPage(context: NoteRenderContext): boolean {
    if (!this.#matchesCurrentScope(context)) return false;
    try {
      return matchesFileIdentity(fs.lstatSync(context.absolutePath), context.pageIdentity);
    } catch {
      return false;
    }
  }

  #requireActiveVaultPath(): string {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!this.#vaults.current() || !vaultPath) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }
    return vaultPath;
  }
}

function editorIdentity(request: Pick<NoteEditorOpenRequest, "apiVersion" | "requestId" | "activeVaultId" | "pageId">) {
  return {
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    pageId: request.pageId
  } as const;
}

function editorBindingKey(ownerId: string, renderContextId: string): string {
  return `${ownerId}\0${renderContextId}`;
}

function publicEditorRevision(privateRevision: string): `noteeditrev_${string}` {
  const match = /^sha256:([a-f0-9]{64})$/u.exec(privateRevision);
  if (!match) throw new Error("The private editor revision is invalid.");
  return `noteeditrev_${match[1]}`;
}

function extractRenderedInternalHrefs(html: string): ReadonlySet<string> | undefined {
  const hrefs = new Set<string>();
  for (const match of html.matchAll(/\shref="([^"]+)"/gu)) {
    const href = decodeHtmlAttribute(match[1] ?? "");
    if (!NoteInlineReferenceHrefSchema.safeParse(href).success) continue;
    hrefs.add(href);
    if (hrefs.size > MAX_RENDER_CONTEXT_HREFS) return undefined;
  }
  return hrefs;
}

function decodeHtmlAttribute(value: string): string {
  return value.replace(/&(amp|quot|#x27|lt|gt);/giu, (entity) => {
    switch (entity.toLocaleLowerCase("en-US")) {
      case "&amp;": return "&";
      case "&quot;": return "\"";
      case "&#x27;": return "'";
      case "&lt;": return "<";
      case "&gt;": return ">";
      default: return entity;
    }
  });
}

function parseInlineReferenceHref(href: string):
  | { readonly kind: "page"; readonly target: string }
  | { readonly kind: "source"; readonly sourceId: string; readonly locator?: string }
  | undefined {
  if (href.startsWith("#wiki:")) {
    const encoded = href.slice("#wiki:".length);
    if (!encoded || Buffer.byteLength(encoded, "utf8") > 1024) return undefined;
    try {
      const decoded = decodeURIComponent(encoded);
      if (
        encodeURIComponent(decoded) !== encoded ||
        /%[0-9a-f]{2}/iu.test(decoded) ||
        Array.from(decoded).length > 256 ||
        UNSAFE_REFERENCE_CHARACTER_PATTERN.test(decoded)
      ) {
        return undefined;
      }
      return { kind: "page", target: decoded.normalize("NFKC") };
    } catch {
      return undefined;
    }
  }
  if (!href.startsWith("#source:")) return undefined;
  const raw = href.slice("#source:".length);
  const separator = raw.indexOf("#");
  const sourceId = separator === -1 ? raw : raw.slice(0, separator);
  if (!SourceIdSchema.safeParse(sourceId).success) return undefined;
  if (separator === -1) return { kind: "source", sourceId };
  const locator = raw.slice(separator + 1);
  if (!CitationLocatorSchema.max(256).safeParse(locator).success) return undefined;
  return { kind: "source", sourceId, locator };
}

function toFileIdentity(stat: fs.Stats): FileIdentity {
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    deviceId: String(stat.dev),
    fileId: String(stat.ino)
  };
}

function matchesFileIdentity(stat: fs.Stats, expected: FileIdentity): boolean {
  return !stat.isSymbolicLink() && stat.isFile() && sameFileIdentity(toFileIdentity(stat), expected);
}

function matchesNamedFileIdentity(filePath: string, expected: FileIdentity): boolean {
  try {
    return matchesFileIdentity(fs.lstatSync(filePath), expected);
  } catch {
    return false;
  }
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.deviceId === right.deviceId &&
    left.fileId === right.fileId;
}

function resolveSelectionEndpoint(
  context: NoteRenderContext,
  endpoint: ReaderSelectionResolveRequest["anchor"]
): number | "invalid" | undefined {
  const segment = context.selectionSegments.get(endpoint.segmentId);
  if (!segment) return undefined;
  if (endpoint.utf16Offset > segment.text.length) return "invalid";
  if (
    endpoint.utf16Offset > 0 &&
    endpoint.utf16Offset < segment.text.length &&
    isHighSurrogate(segment.text.charCodeAt(endpoint.utf16Offset - 1)) &&
    isLowSurrogate(segment.text.charCodeAt(endpoint.utf16Offset))
  ) {
    return "invalid";
  }
  return context.bodyStartOffset + segment.sourceStartOffset + endpoint.utf16Offset;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function hashBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function invalidSelection(
  requestId: string,
  reason: Extract<ReaderSelectionResolveResult, { status: "invalid" }>["reason"]
): ReaderSelectionResolveResult {
  return { apiVersion: 1, requestId, status: "invalid", reason };
}

function staleSelection(
  requestId: string,
  scope: "vault" | "page" | "render_context"
): ReaderSelectionResolveResult {
  return { apiVersion: 1, requestId, status: "stale", scope };
}

function failedSelection(requestId: string): ReaderSelectionResolveResult {
  return { apiVersion: 1, requestId, status: "failed" };
}

function notFoundInlineReference(requestId: string): NoteResolveInlineReferenceResult {
  return { apiVersion: 1, requestId, status: "not_found" };
}

function ambiguousInlineReference(requestId: string): NoteResolveInlineReferenceResult {
  return { apiVersion: 1, requestId, status: "ambiguous" };
}

function staleInlineReference(
  requestId: string,
  scope: "vault" | "page" | "render_context"
): NoteResolveInlineReferenceResult {
  return { apiVersion: 1, requestId, status: "stale", scope };
}

function failedInlineReference(requestId: string): NoteResolveInlineReferenceResult {
  return { apiVersion: 1, requestId, status: "failed" };
}

function sourceReferenceResult(
  requestId: string,
  status: "unresolved" | "not_found" | "stale" | "mismatch" | "changed"
): NoteOpenSourceReferenceResult {
  return { apiVersion: 1, requestId, status };
}

function projectSourceReferenceStatus(
  status: Exclude<SourceReferenceResolution["status"], "resolved">
): "unresolved" | "not_found" | "mismatch" | "changed" {
  switch (status) {
    case "source_unresolved":
    case "index_unavailable":
      return "unresolved";
    case "not_found":
    case "target_not_found":
      return "not_found";
    case "mismatch":
    case "changed":
      return status;
  }
}
