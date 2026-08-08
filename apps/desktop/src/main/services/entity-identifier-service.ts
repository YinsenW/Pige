import { createHash } from "node:crypto";
import type { NoteChangeEntityIdentifierRequest, NoteChangeEntityIdentifierResult, NoteReadEntityIdentifiersRequest, NoteReadEntityIdentifiersResult, NoteRenderResult } from "@pige/contracts";
import { parsePigeMarkdownPage, rewritePigeMarkdownFrontmatter } from "@pige/markdown";
import type { NoteMarkdownEditorService } from "./note-markdown-editor-service";
import type { NotesService } from "./notes-service";

type TargetPort = Pick<NotesService, "resolveManagedPageTarget" | "render">;
type EditorPort = Pick<NoteMarkdownEditorService, "open" | "save">;

export class EntityIdentifierService {
  constructor(readonly targets: TargetPort, readonly editor: EditorPort, readonly now: () => Date = () => new Date()) {}

  read(ownerId: string, request: NoteReadEntityIdentifiersRequest): NoteReadEntityIdentifiersResult {
    const target = this.targets.resolveManagedPageTarget(ownerId, pageTarget(request), "entity");
    if (target.status !== "ready") return { ...request, status: target.status };
    const opened = this.editor.open({ activeVaultId: request.activeVaultId, pageId: request.currentPageId });
    if (opened.status !== "opened") return { ...request, status: opened.status === "not_found" ? "not_found" : "failed" };
    const identifiers = entityIdentifiers(opened.markdown);
    return identifiers && opened.revisionId === target.pageContentHash && target.assertCurrent()
      ? { ...request, status: "ready", identifiers: [...identifiers], canEdit: true, revision: request.expectedRevision }
      : { ...request, status: identifiers ? "stale" : "ineligible" };
  }

  async change(ownerId: string, request: NoteChangeEntityIdentifierRequest): Promise<NoteChangeEntityIdentifierResult> {
    const target = this.targets.resolveManagedPageTarget(ownerId, pageTarget(request), "entity");
    if (target.status !== "ready" || !target.assertCurrent()) return closed(request, target.status === "ready" ? "stale" : target.status);
    const opened = this.editor.open({ activeVaultId: request.activeVaultId, pageId: request.currentPageId });
    if (opened.status !== "opened" || opened.revisionId !== target.pageContentHash || !target.assertCurrent()) return closed(request, opened.status === "not_found" ? "not_found" : "stale");
    const identifiers = entityIdentifiers(opened.markdown); if (!identifiers) return closed(request, "ineligible");
    const exists = identifiers.includes(request.identifier);
    if ((request.action === "add" && (exists || identifiers.length >= 32)) || (request.action === "remove" && !exists)) return closed(request, "ineligible");
    const next = request.action === "add" ? [...identifiers, request.identifier] : identifiers.filter((value) => value !== request.identifier);
    const parsed = parsePigeMarkdownPage(opened.markdown); if (!parsed?.frontmatter.entity) return closed(request, "ineligible");
    const markdown = rewritePigeMarkdownFrontmatter(opened.markdown, { updated_at: monotonic(String(parsed.frontmatter.updated_at), this.now()), entity: { ...parsed.frontmatter.entity, identifiers: next } });
    if (!markdown || !target.assertCurrent()) return closed(request, markdown ? "stale" : "ineligible");
    const saved = this.editor.save({ requestId: `noteeditreq_${createHash("sha256").update(`pige.entity-identifier.v1\0${request.requestId}`).digest("hex").slice(0, 32)}`,
      activeVaultId: request.activeVaultId, pageId: request.currentPageId, expectedRevisionId: opened.revisionId, renderIdentity: opened.renderIdentity, markdown });
    if (saved.status !== "committed") return closed(request, saved.status === "invalid" ? "ineligible" : saved.status);
    let render: NoteRenderResult; try { render = await this.targets.render({ pageId: request.currentPageId }, ownerId); } catch { return closed(request, "failed"); }
    return render.renderContextId && render.summary.pageId === request.currentPageId && render.summary.pageType === "entity"
      ? { ...request, status: "committed", operationId: saved.operationId, render: { ...render, renderContextId: render.renderContextId } }
      : closed(request, "failed");
  }
}

function entityIdentifiers(markdown: string): readonly string[] | undefined {
  const parsed = parsePigeMarkdownPage(markdown); const values = parsed?.frontmatter.type === "entity" ? parsed.frontmatter.entity?.identifiers : undefined;
  return values && values.length <= 32 && values.every((value, index) => value.length > 0 && value.length <= 256 && values.indexOf(value) === index) ? values : undefined;
}
function pageTarget(request: Pick<NoteReadEntityIdentifiersRequest, "activeVaultId" | "currentPageId" | "renderContextId" | "expectedRevision">) {
  return { activeVaultId: request.activeVaultId, pageId: request.currentPageId, renderContextId: request.renderContextId, expectedRevision: request.expectedRevision };
}
function monotonic(previous: string, now: Date): string { const before = Date.parse(previous), after = now.getTime(); return new Date(Number.isFinite(before) && after <= before ? before + 1 : after).toISOString(); }
function closed(request: NoteChangeEntityIdentifierRequest, status: Exclude<NoteChangeEntityIdentifierResult["status"], "committed">): NoteChangeEntityIdentifierResult { return { ...request, status }; }
