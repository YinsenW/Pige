import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  NoteRenderResult,
  NoteRevisionHistoryListRequest,
  NoteRevisionHistoryListResult,
  NoteRevisionHistoryOpenRequest,
  NoteRevisionHistoryOpenResult,
  NoteRevisionHistoryRestoreRequest,
  NoteRevisionHistoryRestoreResult,
  VaultSummary
} from "@pige/contracts";
import { parsePigeFrontmatter, renderPigeMarkdownToHtml } from "@pige/markdown";
import { OperationRecordSchema, PageIdSchema, type OperationRecord } from "@pige/schemas";
import {
  MAX_NOTE_MARKDOWN_EDITOR_BYTES,
  type NoteMarkdownEditorSaveResult,
  type NoteMarkdownEditorService
} from "./note-markdown-editor-service";
import {
  findMarkdownPageByIdAtSignature,
  readMarkdownPageContentAtSignature
} from "./markdown-page-index";

const MAX_HISTORY_REVISIONS = 100;
const MAX_OPERATION_ENTRIES = 10_000;
const MAX_OPERATION_BYTES = 256 * 1024;
const MAX_OPERATION_SCAN_BYTES = 64 * 1024 * 1024;
const OPERATION_FILE = /^op_\d{8}_[a-z0-9]{8,}\.json$/u;
const YEAR_DIRECTORY = /^\d{4}$/u;
const MONTH_DIRECTORY = /^\d{2}$/u;

export interface NoteRevisionHistoryVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export interface NoteRevisionHistoryReaderPort {
  isRenderContextCurrent(ownerId: string, input: {
    readonly activeVaultId: string;
    readonly pageId: string;
    readonly renderContextId: string;
  }): boolean;
  render(request: { readonly pageId: string }, ownerId: string): Promise<NoteRenderResult>;
}

export interface NoteRevisionHistoryEntry {
  readonly revisionId: `notehistoryrev_${string}`;
  readonly privateRevision: `sha256:${string}`;
  readonly createdAt: string;
  readonly origin: "current" | "user" | "agent" | "restore";
  readonly isCurrent: boolean;
  readonly markdown: string;
}

export type NoteRevisionHistoryReadResult =
  | {
      readonly status: "ready";
      readonly currentRevision: `sha256:${string}`;
      readonly entries: readonly NoteRevisionHistoryEntry[];
    }
  | { readonly status: "stale" | "not_found" | "ineligible" | "failed" };

export type PrivateNoteRevisionHistoryRestoreResult =
  | {
      readonly status: "committed";
      readonly revision: `sha256:${string}`;
      readonly operationId: string;
    }
  | { readonly status: "stale" | "not_found" | "ineligible" | "failed" };

export class NoteRevisionHistoryService {
  readonly #vaults: NoteRevisionHistoryVaultPort;
  readonly #editor: Pick<NoteMarkdownEditorService, "open" | "save">;
  readonly #reader: NoteRevisionHistoryReaderPort | undefined;

  constructor(
    vaults: NoteRevisionHistoryVaultPort,
    editor: Pick<NoteMarkdownEditorService, "open" | "save">,
    reader?: NoteRevisionHistoryReaderPort
  ) {
    this.#vaults = vaults;
    this.#editor = editor;
    this.#reader = reader;
  }

  listForRenderer(ownerId: string, request: NoteRevisionHistoryListRequest): NoteRevisionHistoryListResult {
    const identity = historyIdentity(request);
    const expectedRevision = privateEditorRevision(request.expectedRevision);
    if (!expectedRevision || !this.#contextCurrent(ownerId, request)) return { ...identity, status: "stale" };
    const listed = this.list({ activeVaultId: request.activeVaultId, pageId: request.pageId, expectedRevision });
    if (listed.status !== "ready") return { ...identity, status: listed.status };
    return {
      ...identity, status: "ready", currentRevision: publicEditorRevision(listed.currentRevision),
      revisions: listed.entries.map(({ revisionId, createdAt, origin, isCurrent }) => ({
        revisionId, createdAt, origin, isCurrent, canOpen: true as const
      }))
    };
  }

  async openForRenderer(ownerId: string, request: NoteRevisionHistoryOpenRequest): Promise<NoteRevisionHistoryOpenResult> {
    const identity = { ...historyIdentity(request), revisionId: request.revisionId };
    const expectedRevision = privateEditorRevision(request.expectedRevision);
    if (!expectedRevision || !this.#contextCurrent(ownerId, request)) return { ...identity, status: "stale" };
    const opened = this.open({
      activeVaultId: request.activeVaultId, pageId: request.pageId,
      expectedRevision, revisionId: request.revisionId
    });
    if (opened.status !== "opened") return { ...identity, status: opened.status };
    const parsed = parsePigeFrontmatter(opened.entry.markdown);
    if (!parsed || parsed.frontmatter.id !== request.pageId || parsed.frontmatter.type !== "note") {
      return { ...identity, status: "ineligible" };
    }
    const rendered = await renderPigeMarkdownToHtml(opened.entry.markdown.slice(parsed.bodyStartOffset));
    if (!this.#contextCurrent(ownerId, request)) return { ...identity, status: "stale" };
    return {
      ...identity, status: "opened",
      revision: {
        revisionId: opened.entry.revisionId, createdAt: opened.entry.createdAt,
        origin: opened.entry.origin, isCurrent: opened.entry.isCurrent, canOpen: true
      },
      currentRevision: publicEditorRevision(opened.currentRevision),
      html: rendered.html,
      byteSize: Buffer.byteLength(opened.entry.markdown, "utf8")
    };
  }

  async restoreForRenderer(ownerId: string, request: NoteRevisionHistoryRestoreRequest): Promise<NoteRevisionHistoryRestoreResult> {
    const identity = { ...historyIdentity(request), revisionId: request.revisionId };
    const expectedRevision = privateEditorRevision(request.expectedRevision);
    if (!expectedRevision || !this.#contextCurrent(ownerId, request)) return { ...identity, status: "stale" };
    const restored = this.restore({
      requestId: request.requestId, activeVaultId: request.activeVaultId,
      pageId: request.pageId, expectedRevision, revisionId: request.revisionId
    });
    if (restored.status !== "committed") return { ...identity, status: restored.status };
    if (!this.#reader) return { ...identity, status: "failed" };
    const render = await this.#reader.render({ pageId: request.pageId }, ownerId);
    if (!render.renderContextId) return { ...identity, status: "failed" };
    return {
      ...identity, status: "committed", operationId: restored.operationId,
      revision: publicEditorRevision(restored.revision),
      render: { ...render, renderContextId: render.renderContextId }
    };
  }

  list(input: {
    readonly activeVaultId: string;
    readonly pageId: string;
    readonly expectedRevision: string;
  }): NoteRevisionHistoryReadResult {
    const scope = this.#scope(input.activeVaultId);
    if (!scope || !PageIdSchema.safeParse(input.pageId).success) return { status: "not_found" };
    try {
      const current = readCurrentNote(scope.vaultPath, input.pageId);
      if (!current) return { status: "not_found" };
      if (current.pageType !== "note") return { status: "ineligible" };
      if (current.privateRevision !== input.expectedRevision) return { status: "stale" };

      const byRevision = new Map<string, NoteRevisionHistoryEntry>();
      const currentEntry = createEntry(current.markdown, current.updatedAt, "current", true);
      byRevision.set(currentEntry.revisionId, currentEntry);
      for (const candidate of readHistoricalCandidates(scope.vaultPath, input.pageId)) {
        if (!byRevision.has(candidate.revisionId)) byRevision.set(candidate.revisionId, candidate);
      }
      if (!this.#scopeMatches(scope.activeVaultId, scope.vaultPath)) return { status: "stale" };
      return {
        status: "ready",
        currentRevision: current.privateRevision,
        entries: [currentEntry, ...[...byRevision.values()]
          .filter((entry) => !entry.isCurrent)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt) ||
            left.revisionId.localeCompare(right.revisionId, "en-US"))]
          .slice(0, MAX_HISTORY_REVISIONS)
      };
    } catch {
      return { status: "failed" };
    }
  }

  open(input: {
    readonly activeVaultId: string;
    readonly pageId: string;
    readonly expectedRevision: string;
    readonly revisionId: string;
  }): { readonly status: "opened"; readonly entry: NoteRevisionHistoryEntry; readonly currentRevision: `sha256:${string}` } |
    { readonly status: "stale" | "not_found" | "ineligible" | "failed" } {
    const listed = this.list(input);
    if (listed.status !== "ready") return listed;
    const entry = listed.entries.find((candidate) => candidate.revisionId === input.revisionId);
    return entry
      ? { status: "opened", entry, currentRevision: listed.currentRevision }
      : { status: "not_found" };
  }

  restore(input: {
    readonly requestId: string;
    readonly activeVaultId: string;
    readonly pageId: string;
    readonly expectedRevision: string;
    readonly revisionId: string;
  }): PrivateNoteRevisionHistoryRestoreResult {
    const opened = this.open(input);
    if (opened.status !== "opened") return opened;
    if (opened.entry.isCurrent || opened.entry.privateRevision === opened.currentRevision) {
      return { status: "ineligible" };
    }
    const operationId = restoreOperationId(input, opened.entry.privateRevision);
    const adopted = adoptRestoreOperation(
      this.#vaults.activeVaultPath(), operationId, input.pageId,
      opened.currentRevision, opened.entry.privateRevision
    );
    if (adopted) return { status: "committed", revision: adopted, operationId };
    const editor = this.#editor.open({ activeVaultId: input.activeVaultId, pageId: input.pageId });
    if (editor.status === "not_found") return { status: "not_found" };
    if (editor.status !== "opened") return { status: "failed" };
    if (editor.revisionId !== opened.currentRevision || editor.revisionId !== input.expectedRevision) {
      return { status: "stale" };
    }
    const saved = this.#editor.save({
      requestId: input.requestId,
      activeVaultId: input.activeVaultId,
      pageId: input.pageId,
      expectedRevisionId: editor.revisionId,
      renderIdentity: editor.renderIdentity,
      markdown: opened.entry.markdown,
      operationId
    }, "restore_page");
    return toRestoreResult(saved);
  }

  #scope(activeVaultId: string): { readonly activeVaultId: string; readonly vaultPath: string } | undefined {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    return vault?.vaultId === activeVaultId && vaultPath
      ? { activeVaultId, vaultPath: path.resolve(vaultPath) }
      : undefined;
  }

  #scopeMatches(activeVaultId: string, vaultPath: string): boolean {
    const currentPath = this.#vaults.activeVaultPath();
    return this.#vaults.current()?.vaultId === activeVaultId &&
      !!currentPath && path.resolve(currentPath) === vaultPath;
  }

  #contextCurrent(ownerId: string, request: {
    readonly activeVaultId: string;
    readonly pageId: string;
    readonly renderContextId: string;
  }): boolean {
    return this.#reader?.isRenderContextCurrent(ownerId, request) === true;
  }
}

function readCurrentNote(vaultPath: string, pageId: string): {
  readonly markdown: string;
  readonly privateRevision: `sha256:${string}`;
  readonly pageType: string;
  readonly updatedAt: string;
} | undefined {
  const located = findMarkdownPageByIdAtSignature(vaultPath, pageId);
  if (!located || located.signature.sizeBytes > MAX_NOTE_MARKDOWN_EDITOR_BYTES) return undefined;
  const content = readMarkdownPageContentAtSignature(
    vaultPath,
    located.signature,
    MAX_NOTE_MARKDOWN_EDITOR_BYTES
  );
  const parsed = parsePigeFrontmatter(content.markdown)?.frontmatter;
  if (!parsed || parsed.id !== pageId || !isIsoDateTime(String(parsed.updated_at))) return undefined;
  return {
    markdown: content.markdown,
    privateRevision: hashMarkdown(content.markdown),
    pageType: String(parsed.type),
    updatedAt: String(parsed.updated_at)
  };
}

function readHistoricalCandidates(vaultPath: string, pageId: string): readonly NoteRevisionHistoryEntry[] {
  const root = resolveVaultRelative(vaultPath, ".pige/operations");
  if (!exists(root)) return [];
  assertSafeDirectory(root);
  const entries: NoteRevisionHistoryEntry[] = [];
  let scannedEntries = 0;
  let scannedBytes = 0;
  for (const year of readSafeDirectories(root, YEAR_DIRECTORY)) {
    for (const month of readSafeDirectories(path.join(root, year), MONTH_DIRECTORY)) {
      const directory = path.join(root, year, month);
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink() || !OPERATION_FILE.test(entry.name)) continue;
        scannedEntries += 1;
        if (scannedEntries > MAX_OPERATION_ENTRIES) return entries;
        const operation = readOperation(path.join(directory, entry.name));
        if (!operation) continue;
        scannedBytes += Buffer.byteLength(JSON.stringify(operation), "utf8");
        if (scannedBytes > MAX_OPERATION_SCAN_BYTES) return entries;
        const candidate = readOperationBeforeImage(vaultPath, operation, pageId);
        if (candidate) entries.push(candidate);
      }
    }
  }
  return entries;
}

function readOperationBeforeImage(
  vaultPath: string,
  operation: OperationRecord,
  pageId: string
): NoteRevisionHistoryEntry | undefined {
  if (!operation.targetRefs.some((target) => target.kind === "page" && target.id === pageId)) return undefined;
  const before = operation.before;
  if (before?.kind !== "page" || !before.path || !before.path.startsWith(".pige/")) return undefined;
  const expectedRevision = privateRevision(before.id) ?? privateRevision(before.checksum);
  if (!expectedRevision) return undefined;
  const markdown = readPrivateText(resolveVaultRelative(vaultPath, before.path), MAX_NOTE_MARKDOWN_EDITOR_BYTES);
  if (markdown === undefined || hashMarkdown(markdown) !== expectedRevision) return undefined;
  const parsed = parsePigeFrontmatter(markdown)?.frontmatter;
  if (parsed?.id !== pageId || parsed.type !== "note") return undefined;
  return createEntry(
    markdown,
    operation.createdAt,
    operation.kind === "restore_page" ? "restore" : operation.actor.kind === "user" ? "user" : "agent",
    false
  );
}

function createEntry(
  markdown: string,
  createdAt: string,
  origin: NoteRevisionHistoryEntry["origin"],
  isCurrent: boolean
): NoteRevisionHistoryEntry {
  const privateRevision = hashMarkdown(markdown);
  return {
    revisionId: publicHistoryRevision(privateRevision),
    privateRevision,
    createdAt,
    origin,
    isCurrent,
    markdown
  };
}

function toRestoreResult(saved: NoteMarkdownEditorSaveResult): PrivateNoteRevisionHistoryRestoreResult {
  if (saved.status === "committed") {
    const revision = privateRevision(saved.revisionId);
    return revision
      ? { status: "committed", revision, operationId: saved.operationId }
      : { status: "failed" };
  }
  if (saved.status === "stale" || saved.status === "not_found") return { status: saved.status };
  if (saved.status === "invalid") return { status: "ineligible" };
  return { status: "failed" };
}

function readOperation(filePath: string): OperationRecord | undefined {
  const text = readPrivateText(filePath, MAX_OPERATION_BYTES);
  if (text === undefined) return undefined;
  try {
    return OperationRecordSchema.parse(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function restoreOperationId(
  input: { readonly requestId: string; readonly activeVaultId: string; readonly pageId: string; readonly expectedRevision: string; readonly revisionId: string },
  restoredRevision: string
): string {
  const suffix = createHash("sha256").update([
    "pige.note-history.restore.v1", input.requestId, input.activeVaultId, input.pageId,
    input.expectedRevision, input.revisionId, restoredRevision
  ].join("\0"), "utf8").digest("hex").slice(0, 16);
  return `op_19700101_${suffix}`;
}

function adoptRestoreOperation(
  vaultPath: string | undefined,
  operationId: string,
  pageId: string,
  beforeRevision: string,
  afterRevision: string
): `sha256:${string}` | undefined {
  if (!vaultPath) return undefined;
  const operation = readOperation(resolveVaultRelative(
    vaultPath, `.pige/operations/1970/01/${operationId}.json`
  ));
  if (!operation || operation.kind !== "restore_page" ||
    !operation.targetRefs.some((target) => target.kind === "page" && target.id === pageId) ||
    operation.before?.id !== beforeRevision || operation.after?.id !== afterRevision) return undefined;
  return privateRevision(operation.after.id);
}

function readPrivateText(filePath: string, maximumBytes: number): string | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximumBytes) return undefined;
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (read === 0) return undefined;
      offset += read;
    }
    const after = fs.fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || after.nlink !== 1) {
      return undefined;
    }
    return bytes.toString("utf8");
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* Preserve the fail-closed read result. */ }
    }
  }
}

function readSafeDirectories(root: string, pattern: RegExp): readonly string[] {
  assertSafeDirectory(root);
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && pattern.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en-US"));
}

function assertSafeDirectory(directoryPath: string): void {
  const stat = fs.lstatSync(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe note history directory.");
}

function resolveVaultRelative(vaultPath: string, relativePath: string): string {
  if (path.isAbsolute(relativePath) || relativePath.includes("\\") ||
    relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("The note history path is invalid.");
  }
  const root = path.resolve(vaultPath);
  const resolved = path.resolve(root, ...relativePath.split("/"));
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("The note history path escaped its vault.");
  return resolved;
}

function hashMarkdown(markdown: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(markdown, "utf8").digest("hex")}`;
}

function privateRevision(value: string | undefined): `sha256:${string}` | undefined {
  return value && /^sha256:[a-f0-9]{64}$/u.test(value) ? value as `sha256:${string}` : undefined;
}

function publicHistoryRevision(value: `sha256:${string}`): `notehistoryrev_${string}` {
  return `notehistoryrev_${value.slice("sha256:".length)}`;
}

function publicEditorRevision(value: `sha256:${string}`): `noteeditrev_${string}` {
  return `noteeditrev_${value.slice("sha256:".length)}`;
}

function privateEditorRevision(value: string): `sha256:${string}` | undefined {
  const match = /^noteeditrev_([a-f0-9]{64})$/u.exec(value);
  return match ? `sha256:${match[1]}` : undefined;
}

function historyIdentity(request: NoteRevisionHistoryListRequest): Pick<
  NoteRevisionHistoryListRequest,
  "apiVersion" | "requestId" | "activeVaultId" | "pageId" | "renderContextId" | "expectedRevision"
> {
  return {
    apiVersion: request.apiVersion, requestId: request.requestId,
    activeVaultId: request.activeVaultId, pageId: request.pageId,
    renderContextId: request.renderContextId, expectedRevision: request.expectedRevision
  };
}

function isIsoDateTime(value: string): boolean {
  return !Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/u.test(value);
}

function exists(filePath: string): boolean {
  try { fs.lstatSync(filePath); return true; } catch { return false; }
}
