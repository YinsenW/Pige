import { createHash } from "node:crypto";
import type {
  NoteArchiveCurrentRequest,
  NoteArchiveCurrentResult,
  NoteRestoreArchivedRequest,
  NoteRestoreArchivedResult,
  NoteRenderResult
} from "@pige/contracts";
import { parsePigeFrontmatter } from "@pige/markdown";
import type { NoteMarkdownEditorService } from "./note-markdown-editor-service";
import type { NotesService } from "./notes-service";
import { isLifecycleKnowledgePage } from "./reader-generated-note-reveal-service";

type NoteArchiveTargetPort = Pick<NotesService, "resolveLifecycleTarget" | "render">;
type NoteArchiveEditorPort = Pick<NoteMarkdownEditorService, "open" | "save">;

export class NoteArchiveService {
  readonly #targets: NoteArchiveTargetPort;
  readonly #editor: NoteArchiveEditorPort;
  readonly #now: () => Date;

  constructor(targets: NoteArchiveTargetPort, editor: NoteArchiveEditorPort, now: () => Date = () => new Date()) {
    this.#targets = targets;
    this.#editor = editor;
    this.#now = now;
  }

  async archive(ownerId: string, request: NoteArchiveCurrentRequest): Promise<NoteArchiveCurrentResult> {
    const target = this.#targets.resolveLifecycleTarget(ownerId, {
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      renderContextId: request.renderContextId,
      expectedRevision: request.expectedRevision
    });
    if (target.status !== "ready") return closedResult(request, target.status);
    if (!target.assertCurrent()) return closedResult(request, "stale");

    const opened = this.#editor.open({ activeVaultId: request.activeVaultId, pageId: request.currentPageId });
    if (opened.status !== "opened") return closedResult(request, opened.status === "not_found" ? "not_found" : "failed");
    if (opened.revisionId !== target.pageContentHash || !target.assertCurrent()) return closedResult(request, "stale");
    const markdown = archivedMarkdown(opened.markdown, this.#now().toISOString());
    if (!markdown) return closedResult(request, "ineligible");
    const saved = this.#editor.save({
      requestId: internalRequestId(request.requestId),
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      markdown
    }, "archive_page");
    if (saved.status !== "committed") return closedResult(request, mapSaveStatus(saved.status));

    let render: NoteRenderResult;
    try {
      render = await this.#targets.render({ pageId: request.currentPageId }, ownerId);
    } catch {
      return closedResult(request, "failed");
    }
    if (
      !render.renderContextId ||
      render.summary.pageId !== request.currentPageId ||
      render.summary.pageType !== target.pageType ||
      render.summary.status !== "archived" ||
      render.archiveEligibility?.canArchive === true
    ) return closedResult(request, "failed");
    return { ...request, status: "committed", operationId: saved.operationId, render };
  }

  async restore(ownerId: string, request: NoteRestoreArchivedRequest): Promise<NoteRestoreArchivedResult> {
    const target = this.#targets.resolveLifecycleTarget(ownerId, {
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      renderContextId: request.renderContextId,
      expectedRevision: request.expectedRevision
    });
    if (target.status !== "ready") return restoreClosedResult(request, target.status);
    if (!target.assertCurrent()) return restoreClosedResult(request, "stale");

    const opened = this.#editor.open({ activeVaultId: request.activeVaultId, pageId: request.currentPageId });
    if (opened.status !== "opened") {
      return restoreClosedResult(request, opened.status === "not_found" ? "not_found" : "failed");
    }
    if (opened.revisionId !== target.pageContentHash || !target.assertCurrent()) {
      return restoreClosedResult(request, "stale");
    }
    const markdown = restoredMarkdown(opened.markdown, this.#now().toISOString());
    if (!markdown) return restoreClosedResult(request, "ineligible");
    const saved = this.#editor.save({
      requestId: internalRestoreRequestId(request.requestId),
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      markdown
    }, "restore_page");
    if (saved.status !== "committed") return restoreClosedResult(request, mapSaveStatus(saved.status));

    let render: NoteRenderResult;
    try {
      render = await this.#targets.render({ pageId: request.currentPageId }, ownerId);
    } catch {
      return restoreClosedResult(request, "failed");
    }
    if (
      !render.renderContextId ||
      render.summary.pageId !== request.currentPageId ||
      render.summary.pageType !== target.pageType ||
      render.summary.status !== "active" ||
      render.archiveEligibility?.canArchive !== true ||
      render.restoreEligibility?.canRestore === true
    ) return restoreClosedResult(request, "failed");
    return { ...request, status: "committed", operationId: saved.operationId, render };
  }
}

function internalRequestId(requestId: string): string {
  const suffix = createHash("sha256").update(`pige.note-archive.v1\0${requestId}`, "utf8").digest("hex").slice(0, 32);
  return `noteeditreq_${suffix}`;
}

function internalRestoreRequestId(requestId: string): string {
  const suffix = createHash("sha256").update(`pige.note-restore.v1\0${requestId}`, "utf8").digest("hex").slice(0, 32);
  return `noteeditreq_${suffix}`;
}

function archivedMarkdown(markdown: string, updatedAt: string): string | undefined {
  return markdownWithStatus(markdown, "active", "archived", updatedAt);
}

function restoredMarkdown(markdown: string, updatedAt: string): string | undefined {
  return markdownWithStatus(markdown, "archived", "active", updatedAt);
}

function markdownWithStatus(
  markdown: string,
  currentStatus: "active" | "archived",
  nextStatus: "active" | "archived",
  updatedAt: string
): string | undefined {
  const parsed = parsePigeFrontmatter(markdown);
  if (!isLifecycleKnowledgePage(parsed?.frontmatter.type, parsed?.frontmatter.status) ||
    parsed?.frontmatter.status !== currentStatus) return undefined;
  const statusMatches = [...parsed.raw.matchAll(/^status:[^\r\n]*$/gmu)];
  const updatedMatches = [...parsed.raw.matchAll(/^updated_at:[^\r\n]*$/gmu)];
  const rawStart = markdown.indexOf(parsed.raw);
  if (statusMatches.length !== 1 || updatedMatches.length !== 1 || rawStart < 0) return undefined;
  const nextRaw = parsed.raw
    .replace(/^status:[^\r\n]*$/mu, `status: ${nextStatus}`)
    .replace(/^updated_at:[^\r\n]*$/mu, `updated_at: ${updatedAt}`);
  return `${markdown.slice(0, rawStart)}${nextRaw}${markdown.slice(rawStart + parsed.raw.length)}`;
}

function restoreClosedResult(
  request: NoteRestoreArchivedRequest,
  status: Exclude<NoteRestoreArchivedResult["status"], "committed">
): NoteRestoreArchivedResult {
  return { ...request, status };
}

function mapSaveStatus(status: "stale" | "not_found" | "invalid" | "failed"): "stale" | "not_found" | "ineligible" | "failed" {
  return status === "invalid" ? "ineligible" : status;
}

function closedResult(
  request: NoteArchiveCurrentRequest,
  status: Exclude<NoteArchiveCurrentResult["status"], "committed">
): NoteArchiveCurrentResult {
  return { ...request, status };
}
