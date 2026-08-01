import { createHash } from "node:crypto";
import type {
  NoteChangeTopicParentRequest,
  NoteChangeTopicParentResult,
  NoteSearchTopicParentsRequest,
  NoteSearchTopicParentsResult,
  NoteTopicParentItem
} from "@pige/contracts";
import { parsePigeFrontmatter } from "@pige/markdown";
import { PageIdSchema } from "@pige/schemas";
import {
  findMarkdownPageByIdAtSignature,
  readMarkdownPageContentAtSignature,
  scanMarkdownPages
} from "./markdown-page-index";
import type { NoteMarkdownEditorService } from "./note-markdown-editor-service";
import type { NotesService } from "./notes-service";

type TargetPort = Pick<NotesService, "resolveManagedPageTarget" | "render">;
type EditorPort = Pick<NoteMarkdownEditorService, "open" | "save">;
const MAX_PARENTS = 8;

export class TopicParentService {
  constructor(
    readonly targets: TargetPort,
    readonly editor: EditorPort,
    readonly activeVaultPath: () => string | undefined,
    readonly now: () => Date = () => new Date()
  ) {}

  search(ownerId: string, request: NoteSearchTopicParentsRequest): NoteSearchTopicParentsResult {
    const current = this.targets.resolveManagedPageTarget(ownerId, targetRequest(request), "topic");
    const vaultPath = this.activeVaultPath();
    if (current.status !== "ready") return { ...request, status: current.status };
    if (!vaultPath || !current.assertCurrent()) return { ...request, status: "stale" };
    const query = request.query.normalize("NFKC").toLocaleLowerCase("en-US");
    const candidates = scanMarkdownPages(vaultPath).pages
      .filter(({ summary }) => summary.pageId !== request.currentPageId && summary.status === "active" &&
        summary.pageType === "topic" && `${summary.title}\0${summary.pageId}`
          .normalize("NFKC").toLocaleLowerCase("en-US").includes(query) &&
        !wouldCreateCycle(vaultPath, request.currentPageId, summary.pageId))
      .sort((left, right) => left.summary.title.localeCompare(right.summary.title, "en") ||
        left.summary.pageId.localeCompare(right.summary.pageId, "en"))
      .slice(0, 20)
      .map(({ summary }) => ({ pageId: summary.pageId, title: summary.title, updatedAt: summary.updatedAt }));
    return current.assertCurrent() ? { ...request, status: "ready", candidates } : { ...request, status: "stale" };
  }

  async change(ownerId: string, request: NoteChangeTopicParentRequest): Promise<NoteChangeTopicParentResult> {
    const current = this.targets.resolveManagedPageTarget(ownerId, targetRequest(request), "topic");
    if (current.status !== "ready") return closed(request, current.status);
    const vaultPath = this.activeVaultPath();
    if (!vaultPath || !current.assertCurrent()) return closed(request, "stale");
    if (request.action === "add" && !targetCurrent(vaultPath, request.targetPageId, request.expectedTargetUpdatedAt)) {
      return closed(request, "stale");
    }
    if (request.action === "add" && wouldCreateCycle(vaultPath, request.currentPageId, request.targetPageId)) {
      return closed(request, "ineligible");
    }
    const opened = this.editor.open({ activeVaultId: request.activeVaultId, pageId: request.currentPageId });
    if (opened.status !== "opened") return closed(request, opened.status === "not_found" ? "not_found" : "failed");
    if (opened.revisionId !== current.pageContentHash || !current.assertCurrent()) return closed(request, "stale");
    const markdown = updateTopicParents(opened.markdown, request.action, request.targetPageId, this.now().toISOString());
    if (!markdown) return closed(request, "ineligible");
    if (request.action === "add" && !targetCurrent(vaultPath, request.targetPageId, request.expectedTargetUpdatedAt)) {
      return closed(request, "stale");
    }
    const saved = this.editor.save({
      requestId: internalRequestId(request), activeVaultId: request.activeVaultId, pageId: request.currentPageId,
      expectedRevisionId: opened.revisionId, renderIdentity: opened.renderIdentity, markdown
    });
    if (saved.status !== "committed") return closed(request, saved.status === "invalid" ? "ineligible" : saved.status);
    try {
      const render = await this.targets.render({ pageId: request.currentPageId }, ownerId);
      if (!render.renderContextId || render.summary.pageId !== request.currentPageId ||
        render.summary.pageType !== "topic" || !render.topicParents ||
        (request.action === "add") !== render.topicParents.items.some(({ pageId }) => pageId === request.targetPageId)) {
        return closed(request, "failed");
      }
      return { ...request, status: "committed", operationId: saved.operationId,
        render: { ...render, renderContextId: render.renderContextId } };
    } catch {
      return closed(request, "failed");
    }
  }
}

export function readTopicParentIds(raw: string): readonly string[] | undefined {
  const lines = raw.split(/\r?\n/u).filter((line) => /^topics:/u.test(line));
  if (lines.length !== 1) return undefined;
  try {
    const value: unknown = JSON.parse(lines[0]!.slice(lines[0]!.indexOf(":") + 1).trim());
    return Array.isArray(value) && value.length <= MAX_PARENTS &&
      value.every((id) => PageIdSchema.safeParse(id).success) && new Set(value).size === value.length
      ? value as string[] : undefined;
  } catch {
    return undefined;
  }
}

export function projectTopicParents(vaultPath: string, raw: string): readonly NoteTopicParentItem[] | undefined {
  const ids = readTopicParentIds(raw);
  if (!ids) return undefined;
  const items: NoteTopicParentItem[] = [];
  for (const pageId of ids) {
    const located = findMarkdownPageByIdAtSignature(vaultPath, pageId);
    if (!located) continue;
    const { summary } = located.page;
    if (summary.status !== "active" || summary.pageType !== "topic") continue;
    items.push({ pageId, title: summary.title, updatedAt: summary.updatedAt });
  }
  return items;
}

function targetCurrent(vaultPath: string, pageId: string, updatedAt: string | undefined): boolean {
  if (!updatedAt) return false;
  const located = findMarkdownPageByIdAtSignature(vaultPath, pageId);
  if (!located) return false;
  const { summary } = located.page;
  if (summary.updatedAt !== updatedAt || summary.status !== "active" || summary.pageType !== "topic") return false;
  const parsed = parsePigeFrontmatter(
    readMarkdownPageContentAtSignature(vaultPath, located.signature, 4 * 1024 * 1024 + 1).markdown
  )?.frontmatter;
  return parsed?.id === pageId && parsed.updated_at === updatedAt && parsed.type === "topic" && parsed.status === "active";
}

function wouldCreateCycle(vaultPath: string, currentPageId: string, targetPageId: string): boolean {
  const parents = new Map<string, readonly string[]>();
  for (const record of scanMarkdownPages(vaultPath).pages) {
    if (record.summary.pageType !== "topic" || record.summary.status !== "active") continue;
    try {
      const located = findMarkdownPageByIdAtSignature(vaultPath, record.summary.pageId);
      if (!located) return true;
      const raw = readMarkdownPageContentAtSignature(vaultPath, located.signature, 4 * 1024 * 1024 + 1).markdown;
      const parentIds = readTopicParentIds(parsePigeFrontmatter(raw)?.raw ?? "");
      if (!parentIds) return true;
      parents.set(record.summary.pageId, parentIds);
    } catch { return true; }
  }
  const pending = [targetPageId], visited = new Set<string>();
  while (pending.length > 0) {
    const pageId = pending.pop()!;
    if (pageId === currentPageId) return true;
    if (visited.has(pageId)) continue;
    visited.add(pageId); pending.push(...(parents.get(pageId) ?? []));
  }
  return false;
}

function updateTopicParents(markdown: string, action: "add" | "remove", target: string, now: string): string | undefined {
  const parsed = parsePigeFrontmatter(markdown);
  if (parsed?.frontmatter.type !== "topic" || parsed.frontmatter.status !== "active") return undefined;
  const current = readTopicParentIds(parsed.raw);
  if (!current) return undefined;
  if ((action === "add" && (current.includes(target) || current.length >= MAX_PARENTS)) ||
      (action === "remove" && !current.includes(target))) return undefined;
  const next = action === "add" ? [...current, target] : current.filter((pageId) => pageId !== target);
  const nextRaw = parsed.raw
    .replace(/^topics:[^\r\n]*$/mu, `topics: ${JSON.stringify(next)}`)
    .replace(/^updated_at:[^\r\n]*$/mu, `updated_at: ${monotonic(String(parsed.frontmatter.updated_at ?? ""), now)}`);
  const start = markdown.indexOf(parsed.raw);
  return start < 0 ? undefined : `${markdown.slice(0, start)}${nextRaw}${markdown.slice(start + parsed.raw.length)}`;
}

function monotonic(previous: string, requested: string): string {
  const before = Date.parse(previous), after = Date.parse(requested);
  return new Date(Number.isFinite(before) && after <= before ? before + 1 : after).toISOString();
}

function internalRequestId(request: NoteChangeTopicParentRequest): string {
  return `noteeditreq_${createHash("sha256")
    .update(`pige.topic-parent.v1\0${request.requestId}\0${request.action}\0${request.targetPageId}`)
    .digest("hex").slice(0, 32)}`;
}

function closed(request: NoteChangeTopicParentRequest,
  status: Exclude<NoteChangeTopicParentResult["status"], "committed">): NoteChangeTopicParentResult {
  return { ...request, status };
}

function targetRequest(request: NoteSearchTopicParentsRequest | NoteChangeTopicParentRequest) {
  return { activeVaultId: request.activeVaultId, pageId: request.currentPageId,
    renderContextId: request.renderContextId, expectedRevision: request.expectedRevision };
}
