import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  LibraryPageSummary,
  NoteDocument,
  NoteGetRequest,
  NoteResolveInlineReferenceRequest,
  NoteResolveInlineReferenceResult,
  NoteRenderRequest,
  NoteRenderResult,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { renderPigeMarkdownToHtml } from "@pige/markdown";
import {
  CitationLocatorSchema,
  NoteInlineReferenceHrefSchema,
  PageIdSchema,
  SourceIdSchema,
  SourceRecordSchema,
  type SourceRecord
} from "@pige/schemas";
import {
  createMarkdownPageReferenceKeys,
  findMarkdownPageByIdAtSignature,
  normalizeMarkdownPageReferenceKey,
  readMarkdownPageBodyAtSignature,
  readMarkdownPageByRelativePath
} from "./markdown-page-index";

const MAX_RENDER_CONTEXTS_PER_OWNER = 16;
const MAX_RENDER_CONTEXT_HREFS = 128;
const RENDER_CONTEXT_TTL_MS = 10 * 60 * 1000;
const MAX_SOURCE_RECORD_BYTES = 2 * 1024 * 1024;
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
  (markdown: string): Promise<{ readonly html: string }>;
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
  readonly pagePath: string;
  readonly absolutePath: string;
  readonly pageIdentity: FileIdentity;
  readonly hrefs: ReadonlySet<string>;
  readonly referenceIndexRevision?: string;
  readonly ownerEpoch: number;
  readonly expiresAt: number;
}

interface StableNoteDocument {
  readonly document: NoteDocument;
  readonly pagePath: string;
  readonly absolutePath: string;
  readonly identity: FileIdentity;
}

interface SourceRecordSnapshot {
  readonly record: SourceRecord;
  readonly identity: FileIdentity;
}

export class NotesService {
  readonly #vaults: NotesVaultPort;
  readonly #referenceIndex: NotesInlineReferenceIndexPort | undefined;
  readonly #renderMarkdown: NotesMarkdownRenderer;
  readonly #renderContexts = new Map<string, Map<string, NoteRenderContext>>();
  readonly #ownerEpochs = new Map<string, number>();

  constructor(
    vaults: NotesVaultPort,
    referenceIndex?: NotesInlineReferenceIndexPort,
    renderMarkdown: NotesMarkdownRenderer = renderPigeMarkdownToHtml
  ) {
    this.#vaults = vaults;
    this.#referenceIndex = referenceIndex;
    this.#renderMarkdown = renderMarkdown;
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

    const hrefs = extractRenderedInternalHrefs(rendered.html);
    const referenceIndexRevision = this.#referenceIndex?.inlineReferenceRevision(vaultPath);
    const renderContextId = ownerId === undefined || hrefs === undefined
      ? undefined
      : this.#registerRenderContext(ownerId, {
          vaultId: vault.vaultId,
          vaultPath,
          pageId: stable.document.summary.pageId,
          pagePath: stable.pagePath,
          absolutePath: stable.absolutePath,
          pageIdentity: stable.identity,
          hrefs,
          ownerEpoch: ownerEpoch!,
          ...(referenceIndexRevision ? { referenceIndexRevision } : {})
        });
    return {
      summary: stable.document.summary,
      html: rendered.html,
      byteSize: stable.document.byteSize,
      ...(renderContextId ? { renderContextId } : {})
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

  releaseOwner(ownerId: string): void {
    this.#renderContexts.delete(ownerId);
    this.#ownerEpochs.delete(ownerId);
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
    const source = readSourceRecordSnapshot(context.vaultPath, sourceId);
    const pageId = source?.record.knowledgePageId;
    if (!source || !pageId) return notFoundInlineReference(requestId);
    const candidates = this.#referenceIndex?.inlineReferenceCandidates(context.vaultPath, {
      normalizedKey: normalizeMarkdownPageReferenceKey(pageId),
      expectedRevision: context.referenceIndexRevision!,
      exactPageId: pageId
    });
    if (!candidates) return failedInlineReference(requestId);
    if (candidates.length !== 1) return notFoundInlineReference(requestId);
    const candidate = candidates[0]!;
    const current = readMarkdownPageByRelativePath(context.vaultPath, candidate.pagePath);
    if (
      !current ||
      current.summary.pageId !== pageId ||
      current.summary.pageType !== "source" ||
      !current.summary.sourceIds.includes(sourceId) ||
      (source.record.knowledgePagePath !== undefined && source.record.knowledgePagePath !== candidate.pagePath)
    ) {
      return failedInlineReference(requestId);
    }
    const after = readSourceRecordSnapshot(context.vaultPath, sourceId);
    if (!after || !sameFileIdentity(source.identity, after.identity)) {
      return failedInlineReference(requestId);
    }
    return {
      apiVersion: 1,
      requestId,
      status: "resolved",
      target: {
        kind: "source",
        sourceId,
        pageId,
        ...(locator ? { locator } : {})
      }
    };
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
    const markdownBody = readMarkdownPageBodyAtSignature(
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
        markdownBody,
        byteSize: located.signature.sizeBytes
      },
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

function readSourceRecordSnapshot(vaultPath: string, sourceId: string): SourceRecordSnapshot | undefined {
  const dateKey = /^src_(\d{8})_/u.exec(sourceId)?.[1];
  if (!dateKey) return undefined;
  const root = path.resolve(vaultPath, ".pige", "source-records");
  const filePath = path.resolve(
    root,
    dateKey.slice(0, 4),
    dateKey.slice(4, 6),
    `${sourceId}.json`
  );
  if (!filePath.startsWith(`${root}${path.sep}`)) return undefined;
  let descriptor: number | undefined;
  try {
    const namedBefore = assertConfinedSourceRecordPath(vaultPath, root, filePath);
    if (namedBefore.size > MAX_SOURCE_RECORD_BYTES || namedBefore.nlink !== 1) return undefined;
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = fs.fstatSync(descriptor);
    if (
      before.isSymbolicLink() ||
      !before.isFile() ||
      before.nlink !== 1 ||
      !sameFileIdentity(toFileIdentity(namedBefore), toFileIdentity(before))
    ) return undefined;
    const bytes = Buffer.alloc(before.size);
    const read = fs.readSync(descriptor, bytes, 0, before.size, 0);
    if (read !== before.size) return undefined;
    const after = fs.fstatSync(descriptor);
    const namedAfter = assertConfinedSourceRecordPath(vaultPath, root, filePath);
    if (
      after.nlink !== 1 ||
      namedAfter.nlink !== 1 ||
      !sameFileIdentity(toFileIdentity(before), toFileIdentity(after)) ||
      !sameFileIdentity(toFileIdentity(after), toFileIdentity(namedAfter))
    ) return undefined;
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = SourceRecordSchema.safeParse(JSON.parse(json) as unknown);
    if (!parsed.success || parsed.data.id !== sourceId) return undefined;
    return { record: parsed.data, identity: toFileIdentity(after) };
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function assertConfinedSourceRecordPath(vaultPath: string, root: string, filePath: string): fs.Stats {
  const resolvedVault = path.resolve(vaultPath);
  const vaultStat = fs.lstatSync(resolvedVault);
  if (vaultStat.isSymbolicLink() || !vaultStat.isDirectory()) {
    throw new Error("Vault root must remain a real directory.");
  }
  const canonicalVault = fs.realpathSync.native(resolvedVault);
  for (const governedDirectory of [
    path.join(resolvedVault, ".pige"),
    path.join(resolvedVault, ".pige", "source-records")
  ]) {
    const governedStat = fs.lstatSync(governedDirectory);
    if (governedStat.isSymbolicLink() || !governedStat.isDirectory()) {
      throw new Error("Source record governance directories must remain real directories.");
    }
  }
  const resolvedRoot = path.resolve(root);
  const rootStat = fs.lstatSync(resolvedRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("Source record root must remain a real directory.");
  }
  const canonicalRoot = fs.realpathSync.native(resolvedRoot);
  const rootRelativeToVault = path.relative(canonicalVault, canonicalRoot);
  if (
    !rootRelativeToVault ||
    rootRelativeToVault.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rootRelativeToVault)
  ) {
    throw new Error("Source record root escaped its governed vault.");
  }
  let parent = path.dirname(filePath);
  while (true) {
    const parentStat = fs.lstatSync(parent);
    if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
      throw new Error("Source record parents must remain real directories.");
    }
    const canonicalParent = fs.realpathSync.native(parent);
    const relative = path.relative(canonicalRoot, canonicalParent);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("Source record parent escaped its governed root.");
    }
    if (path.resolve(parent) === resolvedRoot) break;
    const next = path.dirname(parent);
    if (next === parent) throw new Error("Source record parent chain did not reach its root.");
    parent = next;
  }
  const named = fs.lstatSync(filePath);
  const canonicalFile = fs.realpathSync.native(filePath);
  if (
    named.isSymbolicLink() ||
    !named.isFile() ||
    !canonicalFile.startsWith(`${canonicalRoot}${path.sep}`)
  ) {
    throw new Error("Source record escaped its governed root.");
  }
  return named;
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
