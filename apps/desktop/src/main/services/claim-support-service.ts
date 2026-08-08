import { createHash } from "node:crypto";
import type { NoteChangeClaimSupportRequest, NoteChangeClaimSupportResult, NoteClaimSupportItem, NoteSearchClaimSupportsRequest, NoteSearchClaimSupportsResult } from "@pige/contracts";
import { parsePigeFrontmatter } from "@pige/markdown";
import { PageIdSchema } from "@pige/schemas";
import { findMarkdownPageByIdAtSignature, readMarkdownPageContentAtSignature, scanMarkdownPages } from "./markdown-page-index";
import type { NoteMarkdownEditorService } from "./note-markdown-editor-service";
import type { NotesService } from "./notes-service";

type TargetPort = Pick<NotesService, "resolveManagedPageTarget" | "render">;
type EditorPort = Pick<NoteMarkdownEditorService, "open" | "save">;
const MAX_SUPPORTS = 32, MAX_NOTE_BYTES = 4 * 1024 * 1024;

export class ClaimSupportService {
  constructor(readonly targets: TargetPort, readonly editor: EditorPort, readonly activeVaultPath: () => string | undefined, readonly now: () => Date = () => new Date()) {}

  search(ownerId: string, request: NoteSearchClaimSupportsRequest): NoteSearchClaimSupportsResult {
    const current = this.targets.resolveManagedPageTarget(ownerId, owner(request), "claim"), vaultPath = this.activeVaultPath();
    if (current.status !== "ready") return { ...request, status: current.status };
    if (!vaultPath || !current.assertCurrent()) return { ...request, status: "stale" };
    const query = request.query.normalize("NFKC").toLocaleLowerCase("en-US");
    const candidates = scanMarkdownPages(vaultPath).pages.filter(({ summary }) => summary.pageId !== request.currentPageId &&
      summary.status === "active" && summary.pageType === "claim" && summary.sourceIds.length > 0 &&
      `${summary.title}\0${summary.pageId}`.normalize("NFKC").toLocaleLowerCase("en-US").includes(query))
      .sort((left, right) => left.summary.title.localeCompare(right.summary.title, "en") || left.summary.pageId.localeCompare(right.summary.pageId, "en"))
      .slice(0, 20).flatMap(({ summary }) => targetCurrent(vaultPath, summary.pageId, summary.updatedAt, request.currentPageId)
        ? [{ pageId: summary.pageId, title: summary.title, updatedAt: summary.updatedAt }] : []);
    return current.assertCurrent() ? { ...request, status: "ready", candidates } : { ...request, status: "stale" };
  }

  async change(ownerId: string, request: NoteChangeClaimSupportRequest): Promise<NoteChangeClaimSupportResult> {
    const current = this.targets.resolveManagedPageTarget(ownerId, owner(request), "claim"), vaultPath = this.activeVaultPath();
    if (current.status !== "ready") return closed(request, current.status);
    if (!vaultPath || !current.assertCurrent()) return closed(request, "stale");
    if (request.action === "add" && !targetCurrent(vaultPath, request.targetPageId, request.expectedTargetUpdatedAt, request.currentPageId)) return closed(request, "stale");
    const opened = this.editor.open({ activeVaultId: request.activeVaultId, pageId: request.currentPageId });
    if (opened.status !== "opened") return closed(request, opened.status === "not_found" ? "not_found" : "failed");
    if (opened.revisionId !== current.pageContentHash || !current.assertCurrent()) return closed(request, "stale");
    const markdown = updateSupports(opened.markdown, request.action, request.targetPageId, this.now().toISOString());
    if (!markdown || (request.action === "add" && !targetCurrent(vaultPath, request.targetPageId, request.expectedTargetUpdatedAt, request.currentPageId))) return closed(request, markdown ? "stale" : "ineligible");
    const saved = this.editor.save({ requestId: internalRequestId(request), activeVaultId: request.activeVaultId, pageId: request.currentPageId,
      expectedRevisionId: opened.revisionId, renderIdentity: opened.renderIdentity, markdown });
    if (saved.status !== "committed") return closed(request, saved.status === "invalid" ? "ineligible" : saved.status);
    try {
      const render = await this.targets.render({ pageId: request.currentPageId }, ownerId);
      if (!render.renderContextId || render.summary.pageId !== request.currentPageId || render.summary.pageType !== "claim" || !render.claimSupports ||
        (request.action === "add") !== render.claimSupports.items.some(({ pageId }) => pageId === request.targetPageId)) return closed(request, "failed");
      return { ...request, status: "committed", operationId: saved.operationId, render: { ...render, renderContextId: render.renderContextId } };
    } catch { return closed(request, "failed"); }
  }
}

export function readClaimSupportIds(raw: string): readonly string[] | undefined {
  const section = claimSection(raw); if (!section) return undefined;
  const lines = section.split(/\r?\n/u).filter((line) => /^  supports:/u.test(line));
  if (lines.length > 1) return undefined;
  if (lines.length === 0) return [];
  try { const value: unknown = JSON.parse(lines[0]!.slice(lines[0]!.indexOf(":") + 1).trim()); return Array.isArray(value) && value.length <= MAX_SUPPORTS && value.every((id) => PageIdSchema.safeParse(id).success) && new Set(value).size === value.length ? value as string[] : undefined; } catch { return undefined; }
}

export function projectClaimSupports(vaultPath: string, raw: string): readonly NoteClaimSupportItem[] | undefined {
  const ids = readClaimSupportIds(raw); if (!ids) return undefined;
  return ids.flatMap((pageId) => { const summary = findMarkdownPageByIdAtSignature(vaultPath, pageId)?.page.summary;
    return summary?.status === "active" && summary.pageType === "claim" && summary.sourceIds.length > 0 ? [{ pageId, title: summary.title, updatedAt: summary.updatedAt }] : []; });
}

function targetCurrent(vaultPath: string, pageId: string, updatedAt: string | undefined, currentPageId: string): boolean {
  if (!updatedAt || pageId === currentPageId) return false;
  const located = findMarkdownPageByIdAtSignature(vaultPath, pageId); if (!located) return false;
  const { summary } = located.page; if (summary.updatedAt !== updatedAt || summary.status !== "active" || summary.pageType !== "claim" || summary.sourceIds.length === 0) return false;
  const markdown = readMarkdownPageContentAtSignature(vaultPath, located.signature, MAX_NOTE_BYTES + 1).markdown;
  const parsed = parsePigeFrontmatter(markdown);
  return parsed?.frontmatter.id === pageId && parsed.frontmatter.type === "claim" && parsed.frontmatter.status === "active" &&
    (parsed.frontmatter.source_ids?.length ?? 0) > 0 && !wouldFormSupportCycle(vaultPath, pageId, currentPageId);
}

function wouldFormSupportCycle(vaultPath: string, targetPageId: string, currentPageId: string): boolean {
  const pending = [targetPageId], visited = new Set<string>();
  while (pending.length > 0 && visited.size <= MAX_SUPPORTS) {
    const pageId = pending.pop()!;
    if (pageId === currentPageId) return true;
    if (visited.has(pageId)) continue;
    visited.add(pageId);
    const located = findMarkdownPageByIdAtSignature(vaultPath, pageId); if (!located) continue;
    const parsed = parsePigeFrontmatter(readMarkdownPageContentAtSignature(vaultPath, located.signature, MAX_NOTE_BYTES + 1).markdown);
    if (parsed?.frontmatter.type === "claim" && parsed.frontmatter.status === "active" && (parsed.frontmatter.source_ids?.length ?? 0) > 0) {
      pending.push(...(readClaimSupportIds(parsed.raw) ?? []));
    }
  }
  return pending.length > 0;
}

function updateSupports(markdown: string, action: "add" | "remove", targetPageId: string, now: string): string | undefined {
  const parsed = parsePigeFrontmatter(markdown); if (parsed?.frontmatter.type !== "claim" || parsed.frontmatter.status !== "active" || (parsed.frontmatter.source_ids?.length ?? 0) === 0) return undefined;
  const current = readClaimSupportIds(parsed.raw); if (!current || (action === "add" && (current.includes(targetPageId) || current.length >= MAX_SUPPORTS)) || (action === "remove" && !current.includes(targetPageId))) return undefined;
  const next = action === "add" ? [...current, targetPageId] : current.filter((pageId) => pageId !== targetPageId), raw = parsed.raw;
  const supportLine = `  supports: ${JSON.stringify(next)}`, nextRaw = /^  supports:[^\r\n]*$/mu.test(raw)
    ? raw.replace(/^  supports:[^\r\n]*$/mu, supportLine)
    : raw.replace(/^  contradicts:[^\r\n]*$/mu, (line) => `${line}\n${supportLine}`);
  const updated = nextRaw.replace(/^updated_at:[^\r\n]*$/mu, `updated_at: ${JSON.stringify(monotonic(String(parsed.frontmatter.updated_at ?? ""), now))}`), start = markdown.indexOf(raw);
  return start < 0 || updated === raw ? undefined : `${markdown.slice(0, start)}${updated}${markdown.slice(start + raw.length)}`;
}
function claimSection(raw: string): string | undefined { const matches = [...raw.matchAll(/^claim:\s*$/gmu)]; if (matches.length !== 1) return undefined; const start = matches[0]!.index ?? 0, following = raw.slice(start + matches[0]![0].length), next = following.search(/\r?\n(?=[a-z][a-z0-9_]*:)/u); return raw.slice(start, next < 0 ? raw.length : start + matches[0]![0].length + next); }
function owner(request: Pick<NoteSearchClaimSupportsRequest, "activeVaultId" | "currentPageId" | "renderContextId" | "expectedRevision">) { return { activeVaultId: request.activeVaultId, pageId: request.currentPageId, renderContextId: request.renderContextId, expectedRevision: request.expectedRevision }; }
function monotonic(previous: string, requested: string): string { const before = Date.parse(previous), after = Date.parse(requested); return new Date(Number.isFinite(before) && after <= before ? before + 1 : after).toISOString(); }
function internalRequestId(request: NoteChangeClaimSupportRequest): string { return `noteeditreq_${createHash("sha256").update(`pige.claim-support.v1\0${request.requestId}\0${request.action}\0${request.targetPageId}`).digest("hex").slice(0, 32)}`; }
function closed(request: NoteChangeClaimSupportRequest, status: Exclude<NoteChangeClaimSupportResult["status"], "committed">): NoteChangeClaimSupportResult { return { ...request, status }; }
