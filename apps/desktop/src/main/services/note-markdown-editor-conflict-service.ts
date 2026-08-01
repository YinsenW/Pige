import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  NoteEditorSaveConflictAsNewRequest,
  NoteEditorSaveConflictAsNewResult,
  VaultSummary
} from "@pige/contracts";
import { parsePigeMarkdownPage, stripPigeFrontmatter } from "@pige/markdown";
import { NoteEditorSaveConflictAsNewRequestSchema, OperationRecordSchema, type OperationRecord } from "@pige/schemas";
import { z } from "zod";
import {
  createGeneratedNoteExclusive,
  readGeneratedNoteExact,
  removeGeneratedNoteExact
} from "./generated-note-file";
import type { NoteMarkdownEditorService } from "./note-markdown-editor-service";
import type { NotesService } from "./notes-service";

const MAX_MARKDOWN_BYTES = 4 * 1024 * 1024;
const MAX_OPERATION_BYTES = 256 * 1024;
const MAX_RECEIPT_BYTES = 64 * 1024;
const MAX_RECOVERY_ENTRIES = 1_024;

const ReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  requestId: z.string().regex(/^noteeditconflict_[a-z0-9]{16,64}$/u),
  activeVaultId: z.string().min(1).max(256),
  sourcePageId: z.string().min(1).max(256),
  expectedCurrentRevision: z.string().regex(/^noteeditrev_[a-f0-9]{64}$/u),
  draftHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  pageId: z.string().regex(/^page_\d{8}_[a-z0-9]{16}$/u),
  operationId: z.string().regex(/^op_\d{8}_[a-z0-9]{16}$/u),
  pagePath: z.string().regex(/^wiki\/generated\/\d{4}\/page_\d{8}_[a-z0-9]{16}\.md$/u),
  title: z.string().min(1).max(256),
  createdAt: z.string().datetime({ offset: true }),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u)
}).strict();
type Receipt = z.infer<typeof ReceiptSchema>;

export interface NoteMarkdownEditorConflictVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
  assertWriterLease(vaultPath: string): void;
}

export class NoteMarkdownEditorConflictService {
  readonly #vaults: NoteMarkdownEditorConflictVaultPort;
  readonly #notes: NotesService;
  readonly #editor: Pick<NoteMarkdownEditorService, "open">;
  readonly #now: () => Date;

  constructor(
    vaults: NoteMarkdownEditorConflictVaultPort,
    notes: NotesService,
    editor: Pick<NoteMarkdownEditorService, "open">,
    dependencies: { readonly now?: () => Date } = {}
  ) {
    this.#vaults = vaults;
    this.#notes = notes;
    this.#editor = editor;
    this.#now = dependencies.now ?? (() => new Date());
  }

  async saveAsNew(
    ownerId: string,
    requestInput: NoteEditorSaveConflictAsNewRequest
  ): Promise<NoteEditorSaveConflictAsNewResult> {
    const request = NoteEditorSaveConflictAsNewRequestSchema.parse(requestInput);
    const identity = resultIdentity(request);
    const scope = this.#scope(request.activeVaultId);
    if (!scope) return { ...identity, status: "stale" };
    try {
      const opened = this.#notes.openEditor(ownerId, {
        apiVersion: 1,
        requestId: `noteeditreq_${digest(`conflict-open\0${request.requestId}`).slice(0, 16)}`,
        activeVaultId: request.activeVaultId,
        pageId: request.pageId,
        renderContextId: request.currentRenderContextId
      });
      if (opened.status === "not_found") return { ...identity, status: "not_found" };
      if (opened.status !== "ready" || opened.revision !== request.expectedCurrentRevision) {
        return { ...identity, status: "stale" };
      }
      const parsedDraft = parsePigeMarkdownPage(request.markdown);
      if (!parsedDraft || parsedDraft.frontmatter.id !== request.pageId || request.markdown === opened.markdown) {
        return { ...identity, status: "invalid" };
      }
      let receipt = readReceipt(scope.vaultPath, request.requestId);
      if (!receipt) {
        const prepared = prepareConflictNote(request, this.#now());
        writeStage(scope.vaultPath, request.requestId, prepared.markdown);
        receipt = prepared.receipt;
        writeReceipt(scope.vaultPath, receipt);
      } else {
        assertReceiptIdentity(receipt, request);
      }
      completeConflictSave(scope.vaultPath, receipt, () => this.#assertSourceCurrent(request));
      if (!this.#scopeMatches(request.activeVaultId, scope.vaultPath)) return { ...identity, status: "stale" };
      const render = await this.#notes.render({ pageId: receipt.pageId }, ownerId);
      if (!render.renderContextId || !this.#scopeMatches(request.activeVaultId, scope.vaultPath)) {
        return { ...identity, status: "failed" };
      }
      return { ...identity, status: "saved", operationId: receipt.operationId, render };
    } catch {
      return { ...identity, status: "failed" };
    }
  }

  recoverIncompleteSaves(): { readonly recovered: number; readonly failed: number } {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vault || !vaultPath) return { recovered: 0, failed: 0 };
    this.#vaults.assertWriterLease(vaultPath);
    const directory = receiptDirectory(vaultPath);
    if (!fs.existsSync(directory)) return { recovered: 0, failed: 0 };
    let recovered = 0;
    let failed = 0;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).slice(0, MAX_RECOVERY_ENTRIES)) {
      if (!entry.isFile() || !/^noteeditconflict_[a-z0-9]{16,64}\.json$/u.test(entry.name)) continue;
      try {
        const receipt = readReceipt(vaultPath, entry.name.slice(0, -5));
        if (!receipt || receipt.activeVaultId !== vault.vaultId) throw new Error("invalid conflict receipt");
        completeConflictSave(vaultPath, receipt, () => this.#assertReceiptSourceCurrent(receipt));
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
    if (this.#vaults.current()?.vaultId !== activeVaultId || this.#vaults.activeVaultPath() !== vaultPath) return false;
    try { this.#vaults.assertWriterLease(vaultPath); return true; } catch { return false; }
  }

  #assertSourceCurrent(request: NoteEditorSaveConflictAsNewRequest): void {
    const opened = this.#editor.open({ activeVaultId: request.activeVaultId, pageId: request.pageId });
    if (opened.status !== "opened" || publicRevision(opened.revisionId) !== request.expectedCurrentRevision) {
      throw new Error("stale conflict source");
    }
  }

  #assertReceiptSourceCurrent(receipt: Receipt): void {
    const opened = this.#editor.open({ activeVaultId: receipt.activeVaultId, pageId: receipt.sourcePageId });
    if (opened.status !== "opened" || publicRevision(opened.revisionId) !== receipt.expectedCurrentRevision) {
      throw new Error("stale conflict recovery source");
    }
  }
}

function prepareConflictNote(
  request: NoteEditorSaveConflictAsNewRequest,
  now: Date
): { readonly receipt: Receipt; readonly markdown: string } {
  const parsed = parsePigeMarkdownPage(request.markdown);
  if (!parsed) throw new Error("invalid conflict draft");
  const body = stripPigeFrontmatter(request.markdown).trim();
  if (!body) throw new Error("empty conflict draft");
  const title = normalizeTitle(`${parsed.frontmatter.title} (conflict copy)`);
  const createdAt = now.toISOString();
  const date = createdAt.slice(0, 10).replaceAll("-", "");
  const suffix = digest(`note-editor-conflict\0${request.activeVaultId}\0${request.requestId}\0${hashText(request.markdown)}`).slice(0, 16);
  const pageId = `page_${date}_${suffix}`;
  const markdown = `---\nid: ${JSON.stringify(pageId)}\nschema_version: 1\ntitle: ${JSON.stringify(title)}\ntype: "note"\ncreated_at: ${JSON.stringify(createdAt)}\nupdated_at: ${JSON.stringify(createdAt)}\nstatus: "active"\nlanguage: ${JSON.stringify(parsed.frontmatter.language ?? "und")}\naliases: []\ntags: []\ntopics: []\nentities: []\nsource_ids: []\nrelated_page_ids: [${JSON.stringify(request.pageId)}]\nprovenance:\n  generated_by: "user"\nnote:\n  note_kind: "general"\n  review_state: "clean"\n---\n\n${body}\n`;
  if (Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_BYTES || !parsePigeMarkdownPage(markdown)) {
    throw new Error("invalid conflict note");
  }
  const pagePath = `wiki/generated/${createdAt.slice(0, 4)}/${pageId}.md`;
  const operationId = `op_${date}_${digest(`note-editor-conflict-operation\0${request.activeVaultId}\0${request.requestId}`).slice(0, 16)}`;
  return {
    markdown,
    receipt: ReceiptSchema.parse({
      schemaVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      sourcePageId: request.pageId,
      expectedCurrentRevision: request.expectedCurrentRevision,
      draftHash: hashText(request.markdown),
      pageId,
      operationId,
      pagePath,
      title,
      createdAt,
      contentHash: hashText(markdown)
    })
  };
}

function completeConflictSave(vaultPath: string, receipt: Receipt, assertSourceCurrent: () => void): void {
  const stage = readStage(vaultPath, receipt.requestId);
  if (!stage || hashText(stage) !== receipt.contentHash) throw new Error("conflict stage mismatch");
  const pagePath = resolveVaultPath(vaultPath, receipt.pagePath);
  const existing = readGeneratedNoteExact(vaultPath, pagePath, MAX_MARKDOWN_BYTES);
  if (existing === undefined) assertSourceCurrent();
  const pageStatus = createGeneratedNoteExclusive(vaultPath, pagePath, stage, {
    ...(existing === undefined ? { assertSourceCurrent } : {})
  });
  if (pageStatus === "exists" && readGeneratedNoteExact(vaultPath, pagePath, MAX_MARKDOWN_BYTES) !== stage) {
    throw new Error("conflict page mismatch");
  }
  const operation = createOperation(receipt);
  const operationText = `${JSON.stringify(operation, null, 2)}\n`;
  const operationStatus = createGeneratedNoteExclusive(
    vaultPath,
    resolveVaultPath(vaultPath, operationPath(operation.id)),
    operationText
  );
  if (operationStatus === "exists" && readGeneratedNoteExact(
    vaultPath,
    resolveVaultPath(vaultPath, operationPath(operation.id)),
    MAX_OPERATION_BYTES
  ) !== operationText) throw new Error("conflict operation mismatch");
  removeGeneratedNoteExact(vaultPath, stagePath(vaultPath, receipt.requestId), receipt.contentHash, MAX_MARKDOWN_BYTES);
}

function createOperation(receipt: Receipt): OperationRecord {
  return OperationRecordSchema.parse({
    id: receipt.operationId,
    schemaVersion: 1,
    createdAt: receipt.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "create_page",
    targetRefs: [{ kind: "page", id: receipt.pageId, path: receipt.pagePath }],
    sourceRefs: [{ kind: "page", id: receipt.sourcePageId }],
    after: { kind: "page", id: receipt.contentHash, path: receipt.pagePath },
    summary: `Saved conflicting draft as new note ${JSON.stringify(receipt.title)}.`,
    reversible: "best_effort",
    rollbackHint: "Move the conflict copy to trash after verifying that it has not changed.",
    warnings: []
  });
}

function resultIdentity(request: NoteEditorSaveConflictAsNewRequest) {
  return {
    apiVersion: 1 as const,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    pageId: request.pageId,
    currentRenderContextId: request.currentRenderContextId,
    expectedCurrentRevision: request.expectedCurrentRevision
  };
}

function assertReceiptIdentity(receipt: Receipt, request: NoteEditorSaveConflictAsNewRequest): void {
  if (receipt.requestId !== request.requestId || receipt.activeVaultId !== request.activeVaultId ||
      receipt.sourcePageId !== request.pageId || receipt.expectedCurrentRevision !== request.expectedCurrentRevision ||
      receipt.draftHash !== hashText(request.markdown)) throw new Error("conflict receipt identity mismatch");
}

function writeStage(vaultPath: string, requestId: string, markdown: string): void {
  const status = createGeneratedNoteExclusive(vaultPath, stagePath(vaultPath, requestId), markdown);
  if (status === "exists" && readStage(vaultPath, requestId) !== markdown) throw new Error("conflict stage mismatch");
}
function readStage(vaultPath: string, requestId: string): string | undefined {
  return readGeneratedNoteExact(vaultPath, stagePath(vaultPath, requestId), MAX_MARKDOWN_BYTES);
}
function writeReceipt(vaultPath: string, receipt: Receipt): void {
  const text = `${JSON.stringify(receipt, null, 2)}\n`;
  const status = createGeneratedNoteExclusive(vaultPath, receiptPath(vaultPath, receipt.requestId), text);
  if (status === "exists" && readGeneratedNoteExact(vaultPath, receiptPath(vaultPath, receipt.requestId), MAX_RECEIPT_BYTES) !== text) {
    throw new Error("conflict receipt mismatch");
  }
}
function readReceipt(vaultPath: string, requestId: string): Receipt | undefined {
  const text = readGeneratedNoteExact(vaultPath, receiptPath(vaultPath, requestId), MAX_RECEIPT_BYTES);
  return text === undefined ? undefined : ReceiptSchema.parse(JSON.parse(text));
}
function stagePath(vaultPath: string, requestId: string): string {
  return resolveVaultPath(vaultPath, `.pige/private/note-editor-conflicts/stages/${requestId}.md`);
}
function receiptDirectory(vaultPath: string): string {
  return resolveVaultPath(vaultPath, ".pige/private/note-editor-conflicts/receipts");
}
function receiptPath(vaultPath: string, requestId: string): string {
  return resolveVaultPath(vaultPath, `.pige/private/note-editor-conflicts/receipts/${requestId}.json`);
}
function operationPath(operationId: string): string {
  return `.pige/operations/${operationId.slice(3, 7)}/${operationId.slice(7, 9)}/${operationId}.json`;
}
function resolveVaultPath(vaultPath: string, relativePath: string): string {
  if (path.isAbsolute(relativePath) || relativePath.includes("\\") || relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("unsafe conflict path");
  }
  const root = path.resolve(vaultPath);
  const resolved = path.resolve(root, ...relativePath.split("/"));
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("conflict path escaped vault");
  return resolved;
}
function normalizeTitle(value: string): string {
  const title = value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  if (!title || Array.from(title).length > 256) throw new Error("invalid conflict title");
  return title;
}
function publicRevision(revisionId: string): string { return `noteeditrev_${revisionId.replace(/^sha256:/u, "")}`; }
function digest(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function hashText(value: string): string { return `sha256:${digest(value)}`; }
