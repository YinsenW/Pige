import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { VaultSummary } from "@pige/contracts";
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
  assertMarkdownPagePathConfined,
  findMarkdownPageByIdAtSignature,
  readMarkdownPageContentAtSignature,
  type MarkdownFileSignatureRecord
} from "./markdown-page-index";

export const MAX_NOTE_MARKDOWN_EDITOR_BYTES = 4 * 1024 * 1024;
const MAX_RENDER_BINDINGS = 64;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_REFERENCE_LENGTH = 256;
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
    };

interface RenderBinding {
  readonly activeVaultId: string;
  readonly vaultPath: string;
  readonly pageId: string;
  readonly pagePath: string;
  readonly signature: MarkdownFileSignatureRecord;
  readonly revisionId: string;
  readonly renderIdentity: string;
}

interface NoteMarkdownEditorDependencies {
  readonly now?: () => Date;
  readonly randomId?: () => string;
}

export class NoteMarkdownEditorService {
  readonly #vaults: NoteMarkdownEditorVaultPort;
  readonly #activity: NoteMarkdownEditorActivityPort;
  readonly #now: () => Date;
  readonly #randomId: () => string;
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
      if (!validatePortableMarkdown(content.markdown, request.pageId)) return { status: "failed" };
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

  save(request: NoteMarkdownEditorSaveRequest): NoteMarkdownEditorSaveResult {
    const identity = saveIdentity(request);
    if (!isValidSaveRequest(request)) return { status: "invalid", ...identity };
    if (!validatePortableMarkdown(request.markdown, request.pageId)) {
      return { status: "invalid", ...identity };
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
      afterRevisionId
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
      if (committed !== afterMarkdown || !validatePortableMarkdown(committed, binding.pageId)) {
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
  return extractPigeMarkdownLinkRefs(markdown).every(
    (reference) => reference.target.length <= MAX_REFERENCE_LENGTH && !UNSAFE_TEXT_PATTERN.test(reference.target)
  );
}

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

function createUpdateOperation(input: {
  readonly operationId: string;
  readonly createdAt: string;
  readonly pageId: string;
  readonly pagePath: string;
  readonly beforeRevisionId: string;
  readonly afterRevisionId: string;
}): OperationRecord {
  const dateKey = /^op_(\d{8})_/u.exec(input.operationId)?.[1] ?? "19700101";
  const beforePath = `.pige/operations/${dateKey.slice(0, 4)}/${dateKey.slice(4, 6)}/${input.operationId}.before.md`;
  return OperationRecordSchema.parse({
    id: input.operationId,
    schemaVersion: 1,
    createdAt: input.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "update_page",
    targetRefs: [{ kind: "page", id: input.pageId, path: input.pagePath }],
    sourceRefs: [],
    before: { kind: "page", id: input.beforeRevisionId, path: beforePath },
    after: { kind: "page", id: input.afterRevisionId, path: input.pagePath },
    summary: "Edited a Markdown knowledge page.",
    reversible: "yes",
    rollbackHint: "Restore the exact private before-image while the current page revision still matches.",
    warnings: []
  });
}

function createOperationId(
  now: Date,
  randomId: string,
  request: NoteMarkdownEditorSaveRequest,
  afterRevisionId: string
): string {
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

function hashMarkdown(markdown: string): string {
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
