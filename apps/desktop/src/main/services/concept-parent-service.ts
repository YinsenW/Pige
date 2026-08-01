import { createHash } from "node:crypto";
import type {
  NoteChangeConceptParentRequest,
  NoteChangeConceptParentResult,
  NoteConceptParentItem,
  NoteSearchConceptParentsRequest,
  NoteSearchConceptParentsResult
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
const MAX_PARENTS = 32;

export class ConceptParentService {
  constructor(
    readonly targets: TargetPort,
    readonly editor: EditorPort,
    readonly activeVaultPath: () => string | undefined,
    readonly now: () => Date = () => new Date()
  ) {}

  search(ownerId: string, request: NoteSearchConceptParentsRequest): NoteSearchConceptParentsResult {
    const current = this.targets.resolveManagedPageTarget(ownerId, targetRequest(request), "concept");
    const vaultPath = this.activeVaultPath();
    if (current.status !== "ready") return { ...request, status: current.status };
    if (!vaultPath || !current.assertCurrent()) return { ...request, status: "stale" };
    const query = request.query.normalize("NFKC").toLocaleLowerCase("en-US");
    const candidates = scanMarkdownPages(vaultPath).pages
      .filter(({ summary }) => summary.pageId !== request.currentPageId && summary.status === "active" &&
        summary.pageType === "concept" && `${summary.title}\0${summary.pageId}`
          .normalize("NFKC").toLocaleLowerCase("en-US").includes(query) &&
        !wouldCreateCycle(vaultPath, request.currentPageId, summary.pageId))
      .sort((left, right) => left.summary.title.localeCompare(right.summary.title, "en") ||
        left.summary.pageId.localeCompare(right.summary.pageId, "en"))
      .slice(0, 20)
      .map(({ summary }) => ({ pageId: summary.pageId, title: summary.title, updatedAt: summary.updatedAt }));
    return current.assertCurrent() ? { ...request, status: "ready", candidates } : { ...request, status: "stale" };
  }

  async change(ownerId: string, request: NoteChangeConceptParentRequest): Promise<NoteChangeConceptParentResult> {
    const current = this.targets.resolveManagedPageTarget(ownerId, targetRequest(request), "concept");
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
    const markdown = updateConceptParents(opened.markdown, request.action, request.targetPageId, this.now().toISOString());
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
        render.summary.pageType !== "concept" || !render.conceptParents ||
        (request.action === "add") !== render.conceptParents.items.some(({ pageId }) => pageId === request.targetPageId)) {
        return closed(request, "failed");
      }
      return { ...request, status: "committed", operationId: saved.operationId,
        render: { ...render, renderContextId: render.renderContextId } };
    } catch {
      return closed(request, "failed");
    }
  }
}

export function readConceptParentIds(raw: string): readonly string[] | undefined {
  const section = conceptSection(raw);
  if (!section) return undefined;
  const lines = section.split(/\r?\n/u).filter((line) => /^  parent_concepts:/u.test(line));
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

export function projectConceptParents(vaultPath: string, raw: string): readonly NoteConceptParentItem[] | undefined {
  const ids = readConceptParentIds(raw);
  if (!ids) return undefined;
  const items: NoteConceptParentItem[] = [];
  for (const pageId of ids) {
    const located = findMarkdownPageByIdAtSignature(vaultPath, pageId);
    if (!located) continue;
    const { summary } = located.page;
    if (summary.status !== "active" || summary.pageType !== "concept") continue;
    items.push({ pageId, title: summary.title, updatedAt: summary.updatedAt });
  }
  return items;
}

function targetCurrent(vaultPath: string, pageId: string, updatedAt: string | undefined): boolean {
  if (!updatedAt) return false;
  const located = findMarkdownPageByIdAtSignature(vaultPath, pageId);
  if (!located) return false;
  const { summary } = located.page;
  if (summary.updatedAt !== updatedAt || summary.status !== "active" || summary.pageType !== "concept") return false;
  const parsed = parsePigeFrontmatter(
    readMarkdownPageContentAtSignature(vaultPath, located.signature, 4 * 1024 * 1024 + 1).markdown
  )?.frontmatter;
  return parsed?.id === pageId && parsed.updated_at === updatedAt && parsed.type === "concept" && parsed.status === "active";
}

function wouldCreateCycle(vaultPath: string, currentPageId: string, targetPageId: string): boolean {
  const parents = new Map<string, readonly string[]>();
  for (const record of scanMarkdownPages(vaultPath).pages) {
    if (record.summary.pageType !== "concept" || record.summary.status !== "active") continue;
    try {
      const located = findMarkdownPageByIdAtSignature(vaultPath, record.summary.pageId);
      if (!located) return true;
      const raw = readMarkdownPageContentAtSignature(vaultPath, located.signature, 4 * 1024 * 1024 + 1).markdown;
      parents.set(record.summary.pageId, readConceptParentIds(parsePigeFrontmatter(raw)?.raw ?? "") ?? []);
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

function updateConceptParents(markdown: string, action: "add" | "remove", target: string, now: string): string | undefined {
  const parsed = parsePigeFrontmatter(markdown);
  if (parsed?.frontmatter.type !== "concept" || parsed.frontmatter.status !== "active") return undefined;
  const current = readConceptParentIds(parsed.raw);
  if (!current) return undefined;
  if ((action === "add" && (current.includes(target) || current.length >= MAX_PARENTS)) ||
      (action === "remove" && !current.includes(target))) return undefined;
  const next = action === "add" ? [...current, target] : current.filter((pageId) => pageId !== target);
  const nextRaw = parsed.raw
    .replace(/^  parent_concepts:[^\r\n]*$/mu, `  parent_concepts: ${JSON.stringify(next)}`)
    .replace(/^updated_at:[^\r\n]*$/mu, `updated_at: ${monotonic(String(parsed.frontmatter.updated_at ?? ""), now)}`);
  const start = markdown.indexOf(parsed.raw);
  return start < 0 ? undefined : `${markdown.slice(0, start)}${nextRaw}${markdown.slice(start + parsed.raw.length)}`;
}

function conceptSection(raw: string): string | undefined {
  const matches = [...raw.matchAll(/^concept:\s*$/gmu)];
  if (matches.length !== 1) return undefined;
  const start = matches[0]!.index ?? 0;
  const following = raw.slice(start + matches[0]![0].length);
  const next = following.search(/\r?\n(?=[a-z][a-z0-9_]*:)/u);
  return raw.slice(start, next < 0 ? raw.length : start + matches[0]![0].length + next);
}

function monotonic(previous: string, requested: string): string {
  const before = Date.parse(previous), after = Date.parse(requested);
  return new Date(Number.isFinite(before) && after <= before ? before + 1 : after).toISOString();
}

function internalRequestId(request: NoteChangeConceptParentRequest): string {
  return `noteeditreq_${createHash("sha256")
    .update(`pige.concept-parent.v1\0${request.requestId}\0${request.action}\0${request.targetPageId}`)
    .digest("hex").slice(0, 32)}`;
}

function closed(request: NoteChangeConceptParentRequest,
  status: Exclude<NoteChangeConceptParentResult["status"], "committed">): NoteChangeConceptParentResult {
  return { ...request, status };
}

function targetRequest(request: NoteSearchConceptParentsRequest | NoteChangeConceptParentRequest) {
  return { activeVaultId: request.activeVaultId, pageId: request.currentPageId,
    renderContextId: request.renderContextId, expectedRevision: request.expectedRevision };
}
