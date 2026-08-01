import { createHash } from "node:crypto";
import type {
  NoteChangeClaimContradictionRequest,
  NoteChangeClaimContradictionResult,
  NoteClaimContradictionItem,
  NoteSearchClaimContradictionsRequest,
  NoteSearchClaimContradictionsResult
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
const MAX_CONTRADICTIONS = 32;

export class ClaimContradictionService {
  constructor(
    readonly targets: TargetPort,
    readonly editor: EditorPort,
    readonly activeVaultPath: () => string | undefined,
    readonly now: () => Date = () => new Date()
  ) {}

  search(ownerId: string, request: NoteSearchClaimContradictionsRequest): NoteSearchClaimContradictionsResult {
    const current = this.targets.resolveManagedPageTarget(ownerId, targetRequest(request), "claim");
    const vaultPath = this.activeVaultPath();
    if (current.status !== "ready") return { ...request, status: current.status };
    if (!vaultPath || !current.assertCurrent()) return { ...request, status: "stale" };
    const query = request.query.normalize("NFKC").toLocaleLowerCase("en-US");
    const candidates = scanMarkdownPages(vaultPath).pages
      .filter(({ summary }) =>
        summary.pageId !== request.currentPageId &&
        summary.status === "active" &&
        summary.pageType === "claim" &&
        summary.sourceIds.length > 0 &&
        `${summary.title}\0${summary.pageId}`.normalize("NFKC").toLocaleLowerCase("en-US").includes(query)
      )
      .sort((left, right) =>
        left.summary.title.localeCompare(right.summary.title, "en") ||
        left.summary.pageId.localeCompare(right.summary.pageId, "en")
      )
      .slice(0, 20)
      .map(({ summary }) => ({ pageId: summary.pageId, title: summary.title, updatedAt: summary.updatedAt }));
    return current.assertCurrent() ? { ...request, status: "ready", candidates } : { ...request, status: "stale" };
  }

  async change(ownerId: string, request: NoteChangeClaimContradictionRequest): Promise<NoteChangeClaimContradictionResult> {
    const current = this.targets.resolveManagedPageTarget(ownerId, targetRequest(request), "claim");
    if (current.status !== "ready") return closed(request, current.status);
    const vaultPath = this.activeVaultPath();
    if (!vaultPath || !current.assertCurrent()) return closed(request, "stale");
    if (request.action === "add" && !targetCurrent(vaultPath, request.targetPageId, request.expectedTargetUpdatedAt)) {
      return closed(request, "stale");
    }
    const opened = this.editor.open({ activeVaultId: request.activeVaultId, pageId: request.currentPageId });
    if (opened.status !== "opened") return closed(request, opened.status === "not_found" ? "not_found" : "failed");
    if (opened.revisionId !== current.pageContentHash || !current.assertCurrent()) return closed(request, "stale");
    const markdown = updateContradictions(opened.markdown, request.action, request.targetPageId, this.now().toISOString());
    if (!markdown) return closed(request, "ineligible");
    if (request.action === "add" && !targetCurrent(vaultPath, request.targetPageId, request.expectedTargetUpdatedAt)) {
      return closed(request, "stale");
    }
    const saved = this.editor.save({
      requestId: internalRequestId(request),
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      markdown
    });
    if (saved.status !== "committed") {
      return closed(request, saved.status === "invalid" ? "ineligible" : saved.status);
    }
    try {
      const render = await this.targets.render({ pageId: request.currentPageId }, ownerId);
      if (
        !render.renderContextId ||
        render.summary.pageId !== request.currentPageId ||
        render.summary.pageType !== "claim" ||
        !render.claimContradictions ||
        (request.action === "add") !== render.claimContradictions.items.some(({ pageId }) => pageId === request.targetPageId)
      ) return closed(request, "failed");
      return { ...request, status: "committed", operationId: saved.operationId,
        render: { ...render, renderContextId: render.renderContextId } };
    } catch {
      return closed(request, "failed");
    }
  }
}

export function readClaimContradictionIds(raw: string): readonly string[] | undefined {
  const section = claimSection(raw);
  if (!section) return undefined;
  const lines = section.split(/\r?\n/u).filter((line) => /^  contradicts:/u.test(line));
  if (lines.length !== 1) return undefined;
  try {
    const value: unknown = JSON.parse(lines[0]!.slice(lines[0]!.indexOf(":") + 1).trim());
    return Array.isArray(value) && value.length <= MAX_CONTRADICTIONS &&
      value.every((id) => PageIdSchema.safeParse(id).success) && new Set(value).size === value.length
      ? value as string[] : undefined;
  } catch {
    return undefined;
  }
}

export function projectClaimContradictions(vaultPath: string, raw: string): readonly NoteClaimContradictionItem[] | undefined {
  const ids = readClaimContradictionIds(raw);
  if (!ids) return undefined;
  const items: NoteClaimContradictionItem[] = [];
  for (const pageId of ids) {
    const located = findMarkdownPageByIdAtSignature(vaultPath, pageId);
    if (!located) continue;
    const { summary } = located.page;
    if (summary.status !== "active" || summary.pageType !== "claim" || summary.sourceIds.length === 0) continue;
    items.push({ pageId, title: summary.title, updatedAt: summary.updatedAt });
  }
  return items;
}

function targetCurrent(vaultPath: string, pageId: string, updatedAt: string | undefined): boolean {
  if (!updatedAt) return false;
  const located = findMarkdownPageByIdAtSignature(vaultPath, pageId);
  if (!located) return false;
  const { summary } = located.page;
  if (summary.updatedAt !== updatedAt || summary.status !== "active" || summary.pageType !== "claim") return false;
  const parsed = parsePigeFrontmatter(
    readMarkdownPageContentAtSignature(vaultPath, located.signature, 4 * 1024 * 1024 + 1).markdown
  )?.frontmatter;
  return parsed?.id === pageId && parsed.updated_at === updatedAt && parsed.type === "claim" &&
    parsed.status === "active" && (parsed.source_ids?.length ?? 0) > 0;
}

function updateContradictions(markdown: string, action: "add" | "remove", target: string, now: string): string | undefined {
  const parsed = parsePigeFrontmatter(markdown);
  if (parsed?.frontmatter.type !== "claim" || parsed.frontmatter.status !== "active") return undefined;
  const current = readClaimContradictionIds(parsed.raw);
  if (!current) return undefined;
  if ((action === "add" && (current.includes(target) || current.length >= MAX_CONTRADICTIONS)) ||
      (action === "remove" && !current.includes(target))) return undefined;
  const next = action === "add" ? [...current, target] : current.filter((pageId) => pageId !== target);
  const nextRaw = parsed.raw
    .replace(/^  contradicts:[^\r\n]*$/mu, `  contradicts: ${JSON.stringify(next)}`)
    .replace(/^updated_at:[^\r\n]*$/mu, `updated_at: ${monotonic(String(parsed.frontmatter.updated_at ?? ""), now)}`);
  const start = markdown.indexOf(parsed.raw);
  return start < 0 ? undefined : `${markdown.slice(0, start)}${nextRaw}${markdown.slice(start + parsed.raw.length)}`;
}

function claimSection(raw: string): string | undefined {
  const matches = [...raw.matchAll(/^claim:\s*$/gmu)];
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

function internalRequestId(request: NoteChangeClaimContradictionRequest): string {
  return `noteeditreq_${createHash("sha256")
    .update(`pige.claim-contradiction.v1\0${request.requestId}\0${request.action}\0${request.targetPageId}`)
    .digest("hex").slice(0, 32)}`;
}

function closed(
  request: NoteChangeClaimContradictionRequest,
  status: Exclude<NoteChangeClaimContradictionResult["status"], "committed">
): NoteChangeClaimContradictionResult {
  return { ...request, status };
}

function targetRequest(request: NoteSearchClaimContradictionsRequest | NoteChangeClaimContradictionRequest) {
  return {
    activeVaultId: request.activeVaultId,
    pageId: request.currentPageId,
    renderContextId: request.renderContextId,
    expectedRevision: request.expectedRevision
  };
}
