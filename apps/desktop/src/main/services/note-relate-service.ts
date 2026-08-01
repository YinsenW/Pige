import { createHash } from "node:crypto";
import type {
  NoteRelateRequest,
  NoteRelateResult,
  NoteRenderResult,
  NoteUnlinkRelationRequest,
  NoteUnlinkRelationResult,
} from "@pige/contracts";
import { parsePigeFrontmatter } from "@pige/markdown";
import { PageIdSchema } from "@pige/schemas";
import {
  findMarkdownPageByIdAtSignature,
  readMarkdownPageContentAtSignature,
} from "./markdown-page-index";
import type { NoteMarkdownEditorService } from "./note-markdown-editor-service";
import type { NotesService } from "./notes-service";

const MAX_NOTE_BYTES = 4 * 1024 * 1024;
const RELATABLE_PAGE_TYPES = new Set(["note", "claim", "question", "concept", "entity"]);
type NoteRelateTargetPort = Pick<NotesService, "resolveTrashTarget" | "render">;
type NoteRelateEditorPort = Pick<NoteMarkdownEditorService, "open" | "save">;

export class NoteRelateService {
  readonly #targets: NoteRelateTargetPort;
  readonly #editor: NoteRelateEditorPort;
  readonly #activeVaultPath: () => string | undefined;
  readonly #now: () => Date;

  constructor(
    targets: NoteRelateTargetPort,
    editor: NoteRelateEditorPort,
    activeVaultPath: () => string | undefined,
    now: () => Date = () => new Date(),
  ) {
    this.#targets = targets;
    this.#editor = editor;
    this.#activeVaultPath = activeVaultPath;
    this.#now = now;
  }

  async relate(ownerId: string, request: NoteRelateRequest): Promise<NoteRelateResult> {
    const current = this.#targets.resolveTrashTarget(ownerId, {
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      renderContextId: request.renderContextId,
      expectedRevision: request.expectedRevision,
    });
    if (current.status !== "ready") return closed(request, current.status);
    const vaultPath = this.#activeVaultPath();
    if (!vaultPath || !current.assertCurrent()) return closed(request, "stale");
    const target = readTarget(vaultPath, request.targetPageId, request.expectedTargetUpdatedAt);
    if (target.status !== "ready") return closed(request, target.status);

    const opened = this.#editor.open({ activeVaultId: request.activeVaultId, pageId: request.currentPageId });
    if (opened.status !== "opened") return closed(request, opened.status === "not_found" ? "not_found" : "failed");
    if (opened.revisionId !== current.pageContentHash || !current.assertCurrent() || !target.assertCurrent()) {
      return closed(request, "stale");
    }
    const markdown = relateMarkdown(opened.markdown, request.targetPageId, this.#now().toISOString());
    if (!markdown) return closed(request, "ineligible");
    const saved = this.#editor.save({
      requestId: internalRequestId(request.requestId),
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      markdown,
    });
    if (saved.status !== "committed") return closed(request, mapSaveStatus(saved.status));

    let render: NoteRenderResult;
    try {
      render = await this.#targets.render({ pageId: request.currentPageId }, ownerId);
    } catch {
      return closed(request, "failed");
    }
    const renderContextId = render.renderContextId;
    if (
      !renderContextId ||
      render.summary.pageId !== request.currentPageId ||
      render.summary.pageType !== current.pageType ||
      render.summary.status !== "active"
    ) return closed(request, "failed");
    return { ...request, status: "committed", operationId: saved.operationId, render: { ...render, renderContextId } };
  }

  async unlink(ownerId: string, request: NoteUnlinkRelationRequest): Promise<NoteUnlinkRelationResult> {
    const current = this.#targets.resolveTrashTarget(ownerId, {
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      renderContextId: request.renderContextId,
      expectedRevision: request.expectedRevision,
    });
    if (current.status !== "ready") return unlinkClosed(request, current.status);
    const vaultPath = this.#activeVaultPath();
    if (!vaultPath || !current.assertCurrent()) return unlinkClosed(request, "stale");
    const target = readTarget(vaultPath, request.targetPageId, request.expectedTargetUpdatedAt);
    if (target.status !== "ready") return unlinkClosed(request, target.status);

    const opened = this.#editor.open({ activeVaultId: request.activeVaultId, pageId: request.currentPageId });
    if (opened.status !== "opened") return unlinkClosed(request, opened.status === "not_found" ? "not_found" : "failed");
    if (opened.revisionId !== current.pageContentHash || !current.assertCurrent() || !target.assertCurrent()) {
      return unlinkClosed(request, "stale");
    }
    const markdown = unlinkMarkdown(opened.markdown, request.targetPageId, this.#now().toISOString());
    if (!markdown) return unlinkClosed(request, "ineligible");
    const saved = this.#editor.save({
      requestId: internalRequestId(request.requestId, "unlink"),
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      markdown,
    });
    if (saved.status !== "committed") return unlinkClosed(request, mapSaveStatus(saved.status));

    let render: NoteRenderResult;
    try {
      render = await this.#targets.render({ pageId: request.currentPageId }, ownerId);
    } catch {
      return unlinkClosed(request, "failed");
    }
    if (!render.renderContextId || render.summary.pageId !== request.currentPageId ||
      render.summary.pageType !== current.pageType || render.summary.status !== "active") {
      return unlinkClosed(request, "failed");
    }
    return { ...request, status: "committed", operationId: saved.operationId, render: { ...render, renderContextId: render.renderContextId } };
  }
}

function readTarget(vaultPath: string, pageId: string, expectedUpdatedAt: string):
  | { readonly status: "ready"; assertCurrent(): boolean }
  | { readonly status: "stale" | "not_found" | "ineligible" } {
  const located = findMarkdownPageByIdAtSignature(vaultPath, pageId);
  if (!located) return { status: "not_found" };
  if (!isRelatablePage(located.page.summary.pageType, located.page.summary.status)) {
    return { status: "ineligible" };
  }
  if (located.page.summary.updatedAt !== expectedUpdatedAt || located.signature.sizeBytes > MAX_NOTE_BYTES) {
    return { status: "stale" };
  }
  const markdown = readMarkdownPageContentAtSignature(vaultPath, located.signature, MAX_NOTE_BYTES + 1).markdown;
  const parsed = parsePigeFrontmatter(markdown);
  if (parsed?.frontmatter.id !== pageId || !isRelatablePage(parsed.frontmatter.type, parsed.frontmatter.status)) {
    return { status: "ineligible" };
  }
  const signature = located.signature;
  return {
    status: "ready",
    assertCurrent: () => {
      const live = findMarkdownPageByIdAtSignature(vaultPath, pageId);
      return Boolean(live && live.page.summary.updatedAt === expectedUpdatedAt &&
        live.signature.deviceId === signature.deviceId && live.signature.fileId === signature.fileId &&
        live.signature.mtimeMs === signature.mtimeMs && live.signature.sizeBytes === signature.sizeBytes);
    },
  };
}

function relateMarkdown(markdown: string, targetPageId: string, now: string): string | undefined {
  const parsed = parsePigeFrontmatter(markdown);
  if (!parsed || !isRelatablePage(parsed.frontmatter.type, parsed.frontmatter.status)) return undefined;
  const related = readInlinePageIds(parsed.raw);
  if (!Array.isArray(related) || related.length >= 64 || related.includes(targetPageId) ||
      related.some((pageId) => !PageIdSchema.safeParse(pageId).success)) return undefined;
  const updatedAt = monotonicTimestamp(String(parsed.frontmatter.updated_at ?? ""), now);
  const relatedMatches = [...parsed.raw.matchAll(/^related_page_ids:[^\r\n]*$/gmu)];
  const updatedMatches = [...parsed.raw.matchAll(/^updated_at:[^\r\n]*$/gmu)];
  const rawStart = markdown.indexOf(parsed.raw);
  if (relatedMatches.length !== 1 || updatedMatches.length !== 1 || rawStart < 0) return undefined;
  const nextRaw = parsed.raw
    .replace(/^related_page_ids:[^\r\n]*$/mu, `related_page_ids: ${JSON.stringify([...related, targetPageId])}`)
    .replace(/^updated_at:[^\r\n]*$/mu, `updated_at: ${JSON.stringify(updatedAt)}`);
  return `${markdown.slice(0, rawStart)}${nextRaw}${markdown.slice(rawStart + parsed.raw.length)}`;
}

function unlinkMarkdown(markdown: string, targetPageId: string, now: string): string | undefined {
  const parsed = parsePigeFrontmatter(markdown);
  if (!parsed || !isRelatablePage(parsed.frontmatter.type, parsed.frontmatter.status)) return undefined;
  const related = readInlinePageIds(parsed.raw);
  if (!Array.isArray(related) || !related.includes(targetPageId) ||
      related.some((pageId) => !PageIdSchema.safeParse(pageId).success)) return undefined;
  const updatedAt = monotonicTimestamp(String(parsed.frontmatter.updated_at ?? ""), now);
  const relatedMatches = [...parsed.raw.matchAll(/^related_page_ids:[^\r\n]*$/gmu)];
  const updatedMatches = [...parsed.raw.matchAll(/^updated_at:[^\r\n]*$/gmu)];
  const rawStart = markdown.indexOf(parsed.raw);
  if (relatedMatches.length !== 1 || updatedMatches.length !== 1 || rawStart < 0) return undefined;
  const nextRaw = parsed.raw
    .replace(/^related_page_ids:[^\r\n]*$/mu, `related_page_ids: ${JSON.stringify(related.filter((pageId) => pageId !== targetPageId))}`)
    .replace(/^updated_at:[^\r\n]*$/mu, `updated_at: ${JSON.stringify(updatedAt)}`);
  return `${markdown.slice(0, rawStart)}${nextRaw}${markdown.slice(rawStart + parsed.raw.length)}`;
}

function isRelatablePage(pageType: unknown, status: unknown): boolean {
  return status === "active" && typeof pageType === "string" && RELATABLE_PAGE_TYPES.has(pageType);
}

function readInlinePageIds(raw: string): readonly string[] | undefined {
  const matches = raw.split(/\r?\n/u).filter((line) => line.startsWith("related_page_ids:"));
  if (matches.length !== 1) return undefined;
  try {
    const value: unknown = JSON.parse(matches[0]!.slice("related_page_ids:".length).trim());
    return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined;
  } catch {
    return undefined;
  }
}

function monotonicTimestamp(previous: string, requested: string): string {
  const previousMs = Date.parse(previous);
  const requestedMs = Date.parse(requested);
  return new Date(Number.isFinite(previousMs) && requestedMs <= previousMs ? previousMs + 1 : requestedMs).toISOString();
}

function internalRequestId(requestId: string, action: "relate" | "unlink" = "relate"): string {
  const suffix = createHash("sha256").update(`pige.note-${action}.v1\0${requestId}`, "utf8").digest("hex").slice(0, 32);
  return `noteeditreq_${suffix}`;
}

function mapSaveStatus(status: "stale" | "not_found" | "invalid" | "failed"): "stale" | "not_found" | "ineligible" | "failed" {
  return status === "invalid" ? "ineligible" : status;
}

function closed(request: NoteRelateRequest, status: Exclude<NoteRelateResult["status"], "committed">): NoteRelateResult {
  return { ...request, status };
}

function unlinkClosed(request: NoteUnlinkRelationRequest, status: Exclude<NoteUnlinkRelationResult["status"], "committed">): NoteUnlinkRelationResult {
  return { ...request, status };
}
