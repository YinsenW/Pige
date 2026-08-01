import { createHash } from "node:crypto";
import type {
  NoteEntityType,
  NoteRenderResult,
  NoteSetEntityTypeRequest,
  NoteSetEntityTypeResult
} from "@pige/contracts";
import { parsePigeFrontmatter } from "@pige/markdown";
import type { NoteMarkdownEditorService } from "./note-markdown-editor-service";
import type { NotesService } from "./notes-service";

type EntityTargetPort = Pick<NotesService, "resolveManagedPageTarget" | "render">;
type EntityEditorPort = Pick<NoteMarkdownEditorService, "open" | "save">;

const ENTITY_TYPES = new Set<NoteEntityType>([
  "person", "organization", "product", "place", "project", "event", "other"
]);

export class EntityTypeService {
  constructor(
    readonly targets: EntityTargetPort,
    readonly editor: EntityEditorPort,
    readonly now: () => Date = () => new Date()
  ) {}

  async setType(ownerId: string, request: NoteSetEntityTypeRequest): Promise<NoteSetEntityTypeResult> {
    const target = this.targets.resolveManagedPageTarget(ownerId, {
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      renderContextId: request.renderContextId,
      expectedRevision: request.expectedRevision
    }, "entity");
    if (target.status !== "ready") return closed(request, target.status);
    if (!target.assertCurrent()) return closed(request, "stale");

    const opened = this.editor.open({ activeVaultId: request.activeVaultId, pageId: request.currentPageId });
    if (opened.status !== "opened") return closed(request, opened.status === "not_found" ? "not_found" : "failed");
    if (opened.revisionId !== target.pageContentHash || !target.assertCurrent()) return closed(request, "stale");

    const markdown = updateEntityTypeMarkdown(opened.markdown, request.entityType, this.now().toISOString());
    if (!markdown) return closed(request, "ineligible");
    const saved = this.editor.save({
      requestId: internalRequestId(request.requestId),
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      markdown
    });
    if (saved.status !== "committed") return closed(request, saved.status === "invalid" ? "ineligible" : saved.status);

    let render: NoteRenderResult;
    try { render = await this.targets.render({ pageId: request.currentPageId }, ownerId); }
    catch { return closed(request, "failed"); }
    if (!render.renderContextId || render.summary.pageId !== request.currentPageId ||
      render.summary.pageType !== "entity" || render.entityType?.entityType !== request.entityType ||
      render.entityType.canChange !== true) return closed(request, "failed");
    return { ...request, status: "committed", operationId: saved.operationId,
      render: { ...render, renderContextId: render.renderContextId } };
  }
}

export function readEntityType(rawFrontmatter: string): NoteEntityType | undefined {
  const section = entitySection(rawFrontmatter); if (!section) return undefined;
  const matches = [...section.text.matchAll(/^  entity_type:\s*(?:"([a-z_]+)"|'([a-z_]+)'|([a-z_]+))\s*$/gmu)];
  if (matches.length !== 1) return undefined;
  const value = matches[0]![1] ?? matches[0]![2] ?? matches[0]![3];
  return ENTITY_TYPES.has(value as NoteEntityType) ? value as NoteEntityType : undefined;
}

export function updateEntityTypeMarkdown(markdown: string, entityType: NoteEntityType, updatedAt: string): string | undefined {
  const parsed = parsePigeFrontmatter(markdown);
  if (!parsed || parsed.frontmatter.type !== "entity" || parsed.frontmatter.status !== "active" || !ENTITY_TYPES.has(entityType)) return undefined;
  const current = readEntityType(parsed.raw); if (!current || current === entityType) return undefined;
  const section = entitySection(parsed.raw); if (!section) return undefined;
  const typeLines = [...section.text.matchAll(/^  entity_type:\s*(?:"[a-z_]+"|'[a-z_]+'|[a-z_]+)\s*$/gmu)];
  const updatedLines = [...parsed.raw.matchAll(/^updated_at:[^\r\n]*$/gmu)];
  if (typeLines.length !== 1 || updatedLines.length !== 1) return undefined;
  const match = typeLines[0]!, start = section.start + (match.index ?? 0), end = start + match[0].length;
  const timestamp = monotonicTimestamp(String(parsed.frontmatter.updated_at ?? ""), updatedAt);
  const raw = `${parsed.raw.slice(0, start)}  entity_type: "${entityType}"${parsed.raw.slice(end)}`
    .replace(/^updated_at:[^\r\n]*$/mu, `updated_at: ${timestamp}`);
  const rawStart = markdown.indexOf(parsed.raw);
  return rawStart < 0 ? undefined : `${markdown.slice(0, rawStart)}${raw}${markdown.slice(rawStart + parsed.raw.length)}`;
}

function entitySection(raw: string): { readonly start: number; readonly text: string } | undefined {
  const headings = [...raw.matchAll(/^entity:\s*$/gmu)]; if (headings.length !== 1) return undefined;
  const start = headings[0]!.index ?? 0, following = raw.slice(start + headings[0]![0].length);
  const next = following.search(/\r?\n(?=[a-z][a-z0-9_]*:)/u);
  return { start, text: raw.slice(start, next < 0 ? raw.length : start + headings[0]![0].length + next) };
}

function monotonicTimestamp(previous: string, requested: string): string {
  const before = Date.parse(previous), after = Date.parse(requested);
  return new Date(Number.isFinite(before) && after <= before ? before + 1 : after).toISOString();
}
function internalRequestId(requestId: string): string {
  return `noteeditreq_${createHash("sha256").update(`pige.entity-type.v1\0${requestId}`).digest("hex").slice(0, 32)}`;
}
function closed(request: NoteSetEntityTypeRequest,
  status: Exclude<NoteSetEntityTypeResult["status"], "committed">): NoteSetEntityTypeResult { return { ...request, status }; }
