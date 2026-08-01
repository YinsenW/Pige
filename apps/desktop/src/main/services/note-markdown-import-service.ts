import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NoteImportMarkdownRequest, NoteImportMarkdownResult, VaultSummary } from "@pige/contracts";
import { parsePigeFrontmatter, parsePigeMarkdownPage, stripPigeFrontmatter } from "@pige/markdown";
import {
  NoteImportMarkdownRequestSchema,
  OperationRecordSchema,
  type OperationRecord
} from "@pige/schemas";
import { z } from "zod";
import {
  createGeneratedNoteExclusive,
  readGeneratedNoteExact,
  removeGeneratedNoteExact
} from "./generated-note-file";
import type { NotesService } from "./notes-service";

const MAX_MARKDOWN_BYTES = 4 * 1024 * 1024;
const MAX_OPERATION_BYTES = 256 * 1024;
const MAX_RECEIPT_BYTES = 32 * 1024;
const MAX_RECOVERY_ENTRIES = 1_024;

const ReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  requestId: z.string().regex(/^noteimport_[a-z0-9]{16,64}$/u),
  activeVaultId: z.string().min(1).max(256),
  pageId: z.string().regex(/^page_\d{8}_[a-z0-9]{16}$/u),
  operationId: z.string().regex(/^op_\d{8}_[a-z0-9]{16}$/u),
  pagePath: z.string().regex(/^wiki\/generated\/\d{4}\/page_\d{8}_[a-z0-9]{16}\.md$/u),
  title: z.string().min(1).max(256),
  createdAt: z.string().datetime({ offset: true }),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u)
}).strict();
type Receipt = z.infer<typeof ReceiptSchema>;

export interface NoteMarkdownImportVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
  assertWriterLease(vaultPath: string): void;
}

export interface NoteMarkdownImportPicker {
  pick(): Promise<string | undefined>;
}

export class NoteMarkdownImportService {
  readonly #vaults: NoteMarkdownImportVaultPort;
  readonly #notes: NotesService;

  constructor(vaults: NoteMarkdownImportVaultPort, notes: NotesService) {
    this.#vaults = vaults;
    this.#notes = notes;
  }

  async importMarkdown(
    ownerId: string,
    requestInput: NoteImportMarkdownRequest,
    picker: NoteMarkdownImportPicker
  ): Promise<NoteImportMarkdownResult> {
    const request = NoteImportMarkdownRequestSchema.parse(requestInput);
    const identity = { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId };
    const scope = this.#scope(request.activeVaultId);
    if (!scope) return { ...identity, status: "stale" };

    try {
      let receipt = readReceipt(scope.vaultPath, request.requestId);
      if (!receipt) {
        const staged = readStage(scope.vaultPath, request.requestId);
        if (!staged) {
          const selectedPath = await picker.pick();
          if (selectedPath === undefined) return { ...identity, status: "cancelled" };
          if (!this.#scopeMatches(request.activeVaultId, scope.vaultPath)) return { ...identity, status: "stale" };
          const source = readSelectedMarkdown(selectedPath);
          if (!source) return { ...identity, status: "invalid" };
          const prepared = prepareImportedMarkdown(request, source);
          writeStage(scope.vaultPath, request.requestId, prepared.markdown, () => {
            if (!this.#scopeMatches(request.activeVaultId, scope.vaultPath)) throw new Error("stale import scope");
          });
        }
        receipt = completeImport(scope.vaultPath, request, () => {
          if (!this.#scopeMatches(request.activeVaultId, scope.vaultPath)) throw new Error("stale import scope");
        });
      } else {
        assertReceiptIdentity(receipt, request);
        assertCommittedImport(scope.vaultPath, receipt);
        removeStageIfExact(scope.vaultPath, request.requestId, receipt.contentHash);
      }

      if (!this.#scopeMatches(request.activeVaultId, scope.vaultPath)) return { ...identity, status: "stale" };
      const render = await this.#notes.render({ pageId: receipt.pageId }, ownerId);
      if (!this.#scopeMatches(request.activeVaultId, scope.vaultPath)) return { ...identity, status: "stale" };
      return { ...identity, status: "imported", operationId: receipt.operationId, render };
    } catch {
      return { ...identity, status: "failed" };
    }
  }

  recoverIncompleteImports(): { readonly recovered: number; readonly failed: number } {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vault || !vaultPath) return { recovered: 0, failed: 0 };
    this.#vaults.assertWriterLease(vaultPath);
    const directory = stageDirectory(vaultPath);
    if (!fs.existsSync(directory)) return { recovered: 0, failed: 0 };
    let recovered = 0;
    let failed = 0;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).slice(0, MAX_RECOVERY_ENTRIES)) {
      const match = /^(noteimport_[a-z0-9]{16,64})\.md$/u.exec(entry.name);
      if (!entry.isFile() || !match) continue;
      try {
        const request = NoteImportMarkdownRequestSchema.parse({
          apiVersion: 1,
          requestId: match[1],
          activeVaultId: vault.vaultId
        });
        completeImport(vaultPath, request, () => {
          if (this.#vaults.current()?.vaultId !== vault.vaultId || this.#vaults.activeVaultPath() !== vaultPath) {
            throw new Error("stale import recovery scope");
          }
          this.#vaults.assertWriterLease(vaultPath);
        });
        recovered += 1;
      } catch {
        failed += 1;
      }
    }
    return { recovered, failed };
  }

  #scope(activeVaultId: string): { readonly vaultPath: string } | undefined {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vault || !vaultPath || vault.vaultId !== activeVaultId) return undefined;
    this.#vaults.assertWriterLease(vaultPath);
    return { vaultPath };
  }

  #scopeMatches(activeVaultId: string, vaultPath: string): boolean {
    const current = this.#vaults.current();
    const currentPath = this.#vaults.activeVaultPath();
    if (!current || current.vaultId !== activeVaultId || currentPath !== vaultPath) return false;
    try {
      this.#vaults.assertWriterLease(vaultPath);
      return true;
    } catch {
      return false;
    }
  }
}

function readSelectedMarkdown(filePath: string): { readonly markdown: string; readonly fallbackTitle: string } | undefined {
  if (path.extname(filePath).toLowerCase() !== ".md") return undefined;
  let before: fs.Stats;
  try {
    before = fs.lstatSync(filePath);
  } catch {
    return undefined;
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > MAX_MARKDOWN_BYTES) return undefined;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(descriptor);
    if (!sameRevision(before, opened) || opened.nlink !== 1 || opened.size > MAX_MARKDOWN_BYTES) return undefined;
    const bytes = Buffer.alloc(opened.size);
    const read = opened.size === 0 ? 0 : fs.readSync(descriptor, bytes, 0, opened.size, 0);
    const afterDescriptor = fs.fstatSync(descriptor);
    const afterPath = fs.lstatSync(filePath);
    if (read !== opened.size || !sameRevision(opened, afterDescriptor) || !sameRevision(afterDescriptor, afterPath)) return undefined;
    const markdown = bytes.toString("utf8");
    if (Buffer.from(markdown, "utf8").length !== bytes.length || markdown.includes("\0")) return undefined;
    return { markdown, fallbackTitle: path.basename(filePath, path.extname(filePath)) };
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function prepareImportedMarkdown(
  request: NoteImportMarkdownRequest,
  source: { readonly markdown: string; readonly fallbackTitle: string }
): { readonly markdown: string } {
  const normalized = source.markdown.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  const parsed = parsePigeFrontmatter(normalized);
  const body = (parsed ? stripPigeFrontmatter(normalized) : normalized).trim();
  if (!body) throw new Error("empty markdown");
  const title = normalizeTitle(parsed?.frontmatter.title ?? firstHeading(body) ?? source.fallbackTitle);
  const createdAt = new Date().toISOString();
  const date = createdAt.slice(0, 10).replaceAll("-", "");
  const suffix = digest(`note-import\0${request.activeVaultId}\0${request.requestId}`).slice(0, 16);
  const pageId = `page_${date}_${suffix}`;
  const markdown = `---\nid: ${JSON.stringify(pageId)}\nschema_version: 1\ntitle: ${JSON.stringify(title)}\ntype: "note"\ncreated_at: ${JSON.stringify(createdAt)}\nupdated_at: ${JSON.stringify(createdAt)}\nstatus: "active"\nlanguage: "und"\naliases: []\ntags: []\ntopics: []\nentities: []\nsource_ids: []\nrelated_page_ids: []\nprovenance:\n  generated_by: "user"\nnote:\n  note_kind: "imported"\n  review_state: "clean"\n---\n\n${body}\n`;
  if (Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_BYTES || !parsePigeMarkdownPage(markdown)) {
    throw new Error("invalid imported markdown");
  }
  return { markdown };
}

function completeImport(
  vaultPath: string,
  request: NoteImportMarkdownRequest,
  assertCurrent: () => void
): Receipt {
  assertCurrent();
  const staged = readStage(vaultPath, request.requestId);
  if (!staged) throw new Error("missing import stage");
  const parsed = parsePigeMarkdownPage(staged);
  const pageId = parsed?.frontmatter.id;
  const title = parsed?.frontmatter.title;
  const createdAt = parsed?.frontmatter.created_at;
  if (!pageId || !title || !createdAt) throw new Error("invalid import stage");
  const operationId = `op_${pageId.slice(5, 13)}_${digest(`note-import-operation\0${request.activeVaultId}\0${request.requestId}`).slice(0, 16)}`;
  const pagePath = `wiki/generated/${pageId.slice(5, 9)}/${pageId}.md`;
  const contentHash = hashText(staged);
  const receipt = ReceiptSchema.parse({
    schemaVersion: 1,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    pageId,
    operationId,
    pagePath,
    title,
    createdAt,
    contentHash
  });
  const pageStatus = createGeneratedNoteExclusive(vaultPath, resolveVaultPath(vaultPath, pagePath), staged, {
    assertSourceCurrent: assertCurrent
  });
  if (pageStatus === "exists") assertExactText(vaultPath, pagePath, staged, MAX_MARKDOWN_BYTES);
  assertCurrent();
  const operation = createOperation(receipt);
  const operationStatus = createGeneratedNoteExclusive(
    vaultPath,
    resolveVaultPath(vaultPath, operationPath(operation.id)),
    `${JSON.stringify(operation, null, 2)}\n`
  );
  if (operationStatus === "exists") assertExactOperation(vaultPath, operation);
  assertCurrent();
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
  const receiptStatus = createGeneratedNoteExclusive(vaultPath, receiptPath(vaultPath, request.requestId), receiptText);
  if (receiptStatus === "exists") assertExactText(vaultPath, receiptRelativePath(request.requestId), receiptText, MAX_RECEIPT_BYTES);
  assertCurrent();
  removeStageIfExact(vaultPath, request.requestId, contentHash);
  return receipt;
}

function createOperation(receipt: Receipt): OperationRecord {
  return OperationRecordSchema.parse({
    id: receipt.operationId,
    schemaVersion: 1,
    createdAt: receipt.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "create_page",
    targetRefs: [{ kind: "page", id: receipt.pageId, path: receipt.pagePath }],
    sourceRefs: [],
    after: { kind: "page", id: receipt.contentHash, path: receipt.pagePath },
    summary: `Imported Markdown note ${JSON.stringify(receipt.title)}.`,
    reversible: "best_effort",
    rollbackHint: "Move the imported note to trash after verifying that it has not changed.",
    warnings: []
  });
}

function readReceipt(vaultPath: string, requestId: string): Receipt | undefined {
  const text = readGeneratedNoteExact(vaultPath, receiptPath(vaultPath, requestId), MAX_RECEIPT_BYTES);
  if (text === undefined) return undefined;
  return ReceiptSchema.parse(JSON.parse(text));
}

function assertReceiptIdentity(receipt: Receipt, request: NoteImportMarkdownRequest): void {
  if (receipt.requestId !== request.requestId || receipt.activeVaultId !== request.activeVaultId) {
    throw new Error("import receipt identity mismatch");
  }
}

function assertCommittedImport(vaultPath: string, receipt: Receipt): void {
  const page = readGeneratedNoteExact(vaultPath, resolveVaultPath(vaultPath, receipt.pagePath), MAX_MARKDOWN_BYTES);
  if (page === undefined || hashText(page) !== receipt.contentHash) throw new Error("imported page changed");
  assertExactOperation(vaultPath, createOperation(receipt));
}

function assertExactOperation(vaultPath: string, expected: OperationRecord): void {
  const text = readGeneratedNoteExact(
    vaultPath,
    resolveVaultPath(vaultPath, operationPath(expected.id)),
    MAX_OPERATION_BYTES
  );
  if (!text || JSON.stringify(OperationRecordSchema.parse(JSON.parse(text))) !== JSON.stringify(expected)) {
    throw new Error("import operation mismatch");
  }
}

function writeStage(
  vaultPath: string,
  requestId: string,
  markdown: string,
  assertCurrent: () => void
): void {
  const status = createGeneratedNoteExclusive(vaultPath, stagePath(vaultPath, requestId), markdown, {
    assertSourceCurrent: assertCurrent
  });
  if (status === "exists") assertExactText(vaultPath, stageRelativePath(requestId), markdown, MAX_MARKDOWN_BYTES);
}

function readStage(vaultPath: string, requestId: string): string | undefined {
  return readGeneratedNoteExact(vaultPath, stagePath(vaultPath, requestId), MAX_MARKDOWN_BYTES);
}

function removeStageIfExact(vaultPath: string, requestId: string, expectedHash: string): void {
  removeGeneratedNoteExact(vaultPath, stagePath(vaultPath, requestId), expectedHash, MAX_MARKDOWN_BYTES);
}

function assertExactText(vaultPath: string, relativePath: string, expected: string, maximumBytes: number): void {
  if (readGeneratedNoteExact(vaultPath, resolveVaultPath(vaultPath, relativePath), maximumBytes) !== expected) {
    throw new Error("durable import record mismatch");
  }
}

function stageDirectory(vaultPath: string): string {
  return resolveVaultPath(vaultPath, ".pige/private/note-import/stages");
}
function stageRelativePath(requestId: string): string { return `.pige/private/note-import/stages/${requestId}.md`; }
function stagePath(vaultPath: string, requestId: string): string { return resolveVaultPath(vaultPath, stageRelativePath(requestId)); }
function receiptRelativePath(requestId: string): string { return `.pige/private/note-import/receipts/${requestId}.json`; }
function receiptPath(vaultPath: string, requestId: string): string { return resolveVaultPath(vaultPath, receiptRelativePath(requestId)); }
function operationPath(operationId: string): string { return `.pige/operations/${operationId.slice(3, 7)}/${operationId.slice(7, 9)}/${operationId}.json`; }

function resolveVaultPath(vaultPath: string, relativePath: string): string {
  if (path.isAbsolute(relativePath) || relativePath.includes("\\") || relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("unsafe import path");
  }
  const root = path.resolve(vaultPath);
  const resolved = path.resolve(root, ...relativePath.split("/"));
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("import path escaped vault");
  return resolved;
}

function firstHeading(body: string): string | undefined {
  return /^#\s+(.+)$/mu.exec(body)?.[1];
}
function normalizeTitle(value: string): string {
  const title = value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  if (!title || Array.from(title).length > 256) throw new Error("invalid import title");
  return title;
}
function digest(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function hashText(value: string): string { return `sha256:${digest(value)}`; }
function sameRevision(left: fs.Stats, right: fs.Stats): boolean {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}
