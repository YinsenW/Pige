import { createHash } from "node:crypto";
import type {
  NoteChangeEntityMentionRequest,
  NoteChangeEntityMentionResult,
  NoteEntityMentionItem,
  NoteRenderResult,
  NoteSearchEntityMentionsRequest,
  NoteSearchEntityMentionsResult
} from "@pige/contracts";
import { parsePigeFrontmatter } from "@pige/markdown";
import { PageIdSchema } from "@pige/schemas";
import {
  findMarkdownPageByIdAtSignature,
  readMarkdownPageContentAtSignature,
  scanMarkdownPages
} from "./markdown-page-index";
import { hashMarkdown, type NoteMarkdownEditorService } from "./note-markdown-editor-service";
import type { NotesService } from "./notes-service";

type TargetPort = Pick<NotesService, "resolveManagedPageTarget" | "render">;
type EditorPort = Pick<NoteMarkdownEditorService, "open" | "save">;
const TARGET_TYPES = new Set(["note", "claim", "question", "concept", "topic"]);
const MAX_MENTIONS = 32;
const MAX_ENTITIES = 12;
const MAX_MARKDOWN_BYTES = 4 * 1024 * 1024;

export class EntityMentionService {
  constructor(
    readonly targets: TargetPort,
    readonly editor: EditorPort,
    readonly activeVaultPath: () => string | undefined,
    readonly now: () => Date = () => new Date()
  ) {}

  search(ownerId: string, request: NoteSearchEntityMentionsRequest): NoteSearchEntityMentionsResult {
    const current = this.targets.resolveManagedPageTarget(ownerId, ownerRequest(request), "entity");
    const vaultPath = this.activeVaultPath();
    if (current.status !== "ready") return { ...request, status: current.status };
    if (!vaultPath || !current.assertCurrent()) return { ...request, status: "stale" };
    const query = request.query.normalize("NFKC").toLocaleLowerCase("en-US");
    const candidates = scanMarkdownPages(vaultPath).pages
      .filter(({ summary }) => summary.status === "active" && TARGET_TYPES.has(summary.pageType) &&
        `${summary.title}\0${summary.pageId}`.normalize("NFKC").toLocaleLowerCase("en-US").includes(query))
      .sort(comparePages).slice(0, 20).map(({ summary }) => entityMentionItem(summary));
    return current.assertCurrent()
      ? { ...request, status: "ready", candidates }
      : { ...request, status: "stale" };
  }

  async change(ownerId: string, request: NoteChangeEntityMentionRequest): Promise<NoteChangeEntityMentionResult> {
    const current = this.targets.resolveManagedPageTarget(ownerId, ownerRequest(request), "entity");
    if (current.status !== "ready") return closed(request, current.status);
    const vaultPath = this.activeVaultPath();
    if (!vaultPath || !current.assertCurrent()) return closed(request, "stale");
    const target = readTarget(vaultPath, request.targetPageId, request.expectedTargetUpdatedAt);
    if (target.status !== "ready") return closed(request, target.status);
    const opened = this.editor.open({ activeVaultId: request.activeVaultId, pageId: request.targetPageId });
    if (opened.status !== "opened") return closed(request, opened.status === "not_found" ? "not_found" : "failed");
    if (opened.revisionId !== target.revisionId || !current.assertCurrent() || !target.assertCurrent()) {
      return closed(request, "stale");
    }
    const markdown = updateEntities(
      opened.markdown,
      request.action,
      request.currentPageId,
      this.now().toISOString()
    );
    if (!markdown) return closed(request, "ineligible");
    if (!current.assertCurrent() || !target.assertCurrent()) return closed(request, "stale");
    const saved = this.editor.save({
      requestId: internalRequestId(request),
      activeVaultId: request.activeVaultId,
      pageId: request.targetPageId,
      expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      markdown
    });
    if (saved.status !== "committed") {
      return closed(request, saved.status === "invalid" ? "ineligible" : saved.status);
    }
    try {
      const render = await this.targets.render({ pageId: request.currentPageId }, ownerId);
      const hasMention = render.entityMentions?.items.some(({ pageId }) => pageId === request.targetPageId) ?? false;
      if (!render.renderContextId || render.summary.pageId !== request.currentPageId ||
        render.summary.pageType !== "entity" || (request.action === "add") !== hasMention) {
        return closed(request, "failed");
      }
      return { ...request, status: "committed", operationId: saved.operationId,
        render: { ...render, renderContextId: render.renderContextId } };
    } catch {
      return closed(request, "failed");
    }
  }
}

export function projectEntityMentions(vaultPath: string, entityPageId: string): readonly NoteEntityMentionItem[] {
  return scanMarkdownPages(vaultPath).pages
    .filter(({ summary, knowledge }) => summary.status === "active" && TARGET_TYPES.has(summary.pageType) &&
      knowledge.entities.includes(entityPageId))
    .sort(comparePages).slice(0, MAX_MENTIONS).map(({ summary }) => entityMentionItem(summary));
}

function readTarget(vaultPath: string, pageId: string, expectedUpdatedAt: string):
  | { readonly status: "ready"; readonly revisionId: string; assertCurrent(): boolean }
  | { readonly status: "stale" | "not_found" | "ineligible" } {
  const located = findMarkdownPageByIdAtSignature(vaultPath, pageId);
  if (!located) return { status: "not_found" };
  const { summary } = located.page;
  if (summary.status !== "active" || !TARGET_TYPES.has(summary.pageType)) return { status: "ineligible" };
  if (summary.updatedAt !== expectedUpdatedAt || located.signature.sizeBytes > MAX_MARKDOWN_BYTES) return { status: "stale" };
  let markdown: string;
  try { markdown = readMarkdownPageContentAtSignature(vaultPath, located.signature, MAX_MARKDOWN_BYTES + 1).markdown; }
  catch { return { status: "stale" }; }
  const parsed = parsePigeFrontmatter(markdown)?.frontmatter;
  if (parsed?.id !== pageId || parsed.updated_at !== expectedUpdatedAt || parsed.status !== "active" ||
    !TARGET_TYPES.has(String(parsed.type))) return { status: "ineligible" };
  const signature = located.signature;
  return { status: "ready", revisionId: hashMarkdown(markdown), assertCurrent: () => {
    const live = findMarkdownPageByIdAtSignature(vaultPath, pageId);
    return Boolean(live && live.page.summary.updatedAt === expectedUpdatedAt &&
      live.signature.deviceId === signature.deviceId && live.signature.fileId === signature.fileId &&
      live.signature.mtimeMs === signature.mtimeMs && live.signature.sizeBytes === signature.sizeBytes);
  } };
}

function updateEntities(markdown: string, action: "add" | "remove", entityPageId: string, now: string): string | undefined {
  const parsed = parsePigeFrontmatter(markdown);
  if (!parsed || parsed.frontmatter.status !== "active" || !TARGET_TYPES.has(String(parsed.frontmatter.type)) ||
    !PageIdSchema.safeParse(entityPageId).success) return undefined;
  const matches = [...parsed.raw.matchAll(/^entities:[^\r\n]*$/gmu)];
  const updatedMatches = [...parsed.raw.matchAll(/^updated_at:[^\r\n]*$/gmu)];
  const rawStart = markdown.indexOf(parsed.raw);
  if (matches.length !== 1 || updatedMatches.length !== 1 || rawStart < 0) return undefined;
  let entities: unknown;
  try { entities = JSON.parse(matches[0]![0].slice("entities:".length).trim()); }
  catch { return undefined; }
  if (!Array.isArray(entities) || entities.length > MAX_ENTITIES ||
    entities.some((value) => typeof value !== "string" || value.length < 1 || value.length > 80)) return undefined;
  const current = entities as string[];
  if ((action === "add" && (current.includes(entityPageId) || current.length >= MAX_ENTITIES)) ||
    (action === "remove" && !current.includes(entityPageId))) return undefined;
  const next = action === "add" ? [...current, entityPageId] : current.filter((value) => value !== entityPageId);
  const updatedAt = monotonic(String(parsed.frontmatter.updated_at ?? ""), now);
  const nextRaw = parsed.raw.replace(/^entities:[^\r\n]*$/mu, `entities: ${JSON.stringify(next)}`)
    .replace(/^updated_at:[^\r\n]*$/mu, `updated_at: ${JSON.stringify(updatedAt)}`);
  return `${markdown.slice(0, rawStart)}${nextRaw}${markdown.slice(rawStart + parsed.raw.length)}`;
}

function entityMentionItem(summary: { readonly pageId: string; readonly title: string;
  readonly pageType: string; readonly updatedAt: string }): NoteEntityMentionItem {
  return { pageId: summary.pageId, title: summary.title,
    pageType: summary.pageType as NoteEntityMentionItem["pageType"], updatedAt: summary.updatedAt };
}
function comparePages(left: { readonly summary: { readonly title: string; readonly pageId: string } },
  right: { readonly summary: { readonly title: string; readonly pageId: string } }): number {
  return left.summary.title.localeCompare(right.summary.title, "en") || left.summary.pageId.localeCompare(right.summary.pageId, "en");
}
function monotonic(previous: string, requested: string): string {
  const a = Date.parse(previous), b = Date.parse(requested);
  return new Date(Number.isFinite(a) && b <= a ? a + 1 : b).toISOString();
}
function internalRequestId(request: NoteChangeEntityMentionRequest): string {
  return `noteeditreq_${createHash("sha256").update(
    `pige.entity-mention.v1\0${request.requestId}\0${request.action}\0${request.currentPageId}\0${request.targetPageId}`
  ).digest("hex").slice(0, 32)}`;
}
function ownerRequest(request: NoteSearchEntityMentionsRequest | NoteChangeEntityMentionRequest) {
  return { activeVaultId: request.activeVaultId, pageId: request.currentPageId,
    renderContextId: request.renderContextId, expectedRevision: request.expectedRevision };
}
function closed(request: NoteChangeEntityMentionRequest,
  status: Exclude<NoteChangeEntityMentionResult["status"], "committed">): NoteChangeEntityMentionResult {
  return { ...request, status };
}
