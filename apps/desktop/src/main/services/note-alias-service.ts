import { createHash } from "node:crypto";
import type { NoteAliasChangeRequest, NoteAliasChangeResult, NoteRenderResult } from "@pige/contracts";
import { parsePigeFrontmatter } from "@pige/markdown";
import { createMarkdownPageReferenceKeys, normalizeMarkdownPageReferenceKey, scanMarkdownPages } from "./markdown-page-index";
import type { NoteMarkdownEditorService } from "./note-markdown-editor-service";
import type { NotesService } from "./notes-service";
import { isTaxonomyKnowledgePage } from "./reader-generated-note-reveal-service";

type AliasTargetPort = Pick<NotesService, "resolveTrashTarget" | "render">;
type AliasEditorPort = Pick<NoteMarkdownEditorService, "open" | "save">;

export class NoteAliasService {
  readonly #targets: AliasTargetPort; readonly #editor: AliasEditorPort;
  readonly #activeVaultPath: () => string | undefined; readonly #now: () => Date;

  constructor(targets: AliasTargetPort, editor: AliasEditorPort, activeVaultPath: () => string | undefined,
    now: () => Date = () => new Date()) {
    this.#targets = targets; this.#editor = editor; this.#activeVaultPath = activeVaultPath; this.#now = now;
  }

  async change(ownerId: string, request: NoteAliasChangeRequest): Promise<NoteAliasChangeResult> {
    const target = this.#targets.resolveTrashTarget(ownerId, { activeVaultId: request.activeVaultId,
      pageId: request.currentPageId, renderContextId: request.renderContextId, expectedRevision: request.expectedRevision });
    if (target.status !== "ready") return closed(request, target.status);
    const vaultPath = this.#activeVaultPath();
    if (!vaultPath || vaultPath !== target.vaultPath || !target.assertCurrent()) return closed(request, "stale");
    const key = normalizeMarkdownPageReferenceKey(request.alias);
    if (!key || canonicalAlias(request.alias) !== request.alias) return closed(request, "ineligible");
    const opened = this.#editor.open({ activeVaultId: request.activeVaultId, pageId: request.currentPageId });
    if (opened.status !== "opened") return closed(request, opened.status === "not_found" ? "not_found" : "failed");
    if (opened.revisionId !== target.pageContentHash || !target.assertCurrent()) return closed(request, "stale");
    const parsed = parsePigeFrontmatter(opened.markdown), frontmatter = parsed?.frontmatter;
    const aliases = frontmatter?.aliases ?? [];
    const aliasKeys = aliases.map((alias) => normalizeMarkdownPageReferenceKey(alias));
    const pageType = frontmatter?.type;
    if (!frontmatter || frontmatter.id !== request.currentPageId ||
      !isTaxonomyKnowledgePage(pageType, frontmatter.status) || frontmatter.status !== "active" ||
      aliases.length > 64 || aliasKeys.some((currentKey, index) => !currentKey || canonicalAlias(aliases[index]!) !== aliases[index]) ||
      new Set(aliasKeys).size !== aliasKeys.length || normalizeMarkdownPageReferenceKey(frontmatter.title ?? "") === key) {
      return closed(request, "ineligible");
    }
    const ownMatches = aliases.filter((alias) => normalizeMarkdownPageReferenceKey(alias) === key);
    if ((request.action === "add" && (aliases.length >= 64 || ownMatches.length !== 0)) ||
      (request.action === "remove" && ownMatches.length !== 1)) return closed(request, "ineligible");
    const proof = referenceProof(vaultPath, key, request.currentPageId);
    if (!proof || proof.otherPageIds.length > 0 || (request.action === "add" && proof.currentKinds.length > 0)) {
      return closed(request, "conflict");
    }
    const markdown = changeAliasMarkdown(opened.markdown, request.action, request.alias, this.#now().toISOString());
    if (!markdown) return closed(request, "ineligible");
    const currentProof = referenceProof(vaultPath, key, request.currentPageId);
    if (!currentProof || JSON.stringify(currentProof) !== JSON.stringify(proof) || !target.assertCurrent()) {
      return closed(request, "conflict");
    }
    const saved = this.#editor.save({ requestId: internalRequestId(request), activeVaultId: request.activeVaultId,
      pageId: request.currentPageId, expectedRevisionId: opened.revisionId, renderIdentity: opened.renderIdentity, markdown });
    if (saved.status !== "committed") return closed(request, saved.status === "invalid" ? "ineligible" : saved.status);
    let render: NoteRenderResult;
    try { render = await this.#targets.render({ pageId: request.currentPageId }, ownerId); }
    catch { return closed(request, "failed"); }
    const present = render.aliasing?.aliases.some((alias) => normalizeMarkdownPageReferenceKey(alias) === key) === true;
    if (!render.renderContextId || render.summary.pageId !== request.currentPageId || render.summary.pageType !== pageType ||
      (request.action === "add" ? !present : present)) return closed(request, "failed");
    return { ...request, status: "committed", operationId: saved.operationId, render };
  }
}

function referenceProof(vaultPath: string, key: string, currentPageId: string):
  { readonly currentKinds: readonly string[]; readonly otherPageIds: readonly string[] } | undefined {
  const scan = scanMarkdownPages(vaultPath); if (scan.invalidPageCount > 0) return undefined;
  const currentKinds: string[] = [], others = new Set<string>();
  for (const page of scan.pages) for (const reference of createMarkdownPageReferenceKeys(page)) if (reference.key === key) {
    if (page.summary.pageId === currentPageId) currentKinds.push(reference.kind); else others.add(page.summary.pageId);
  }
  return { currentKinds: currentKinds.sort(), otherPageIds: [...others].sort() };
}

function changeAliasMarkdown(markdown: string, action: "add" | "remove", alias: string, updatedAt: string): string | undefined {
  const parsed = parsePigeFrontmatter(markdown); if (!parsed) return undefined;
  const matches = [...parsed.raw.matchAll(/^aliases:[^\r\n]*$/gmu)], updated = [...parsed.raw.matchAll(/^updated_at:[^\r\n]*$/gmu)];
  const rawStart = markdown.indexOf(parsed.raw), aliases = [...(parsed.frontmatter.aliases ?? [])];
  if (matches.length !== 1 || updated.length !== 1 || rawStart < 0 || !/^aliases:\s*\[[^\r\n]*\]\s*$/u.test(matches[0]![0])) return undefined;
  const key = normalizeMarkdownPageReferenceKey(alias), next = action === "add" ? [...aliases, alias]
    : aliases.filter((current) => normalizeMarkdownPageReferenceKey(current) !== key);
  const timestamp = monotonicTimestamp(String(parsed.frontmatter.updated_at ?? ""), updatedAt);
  const raw = parsed.raw.replace(/^aliases:[^\r\n]*$/mu, `aliases: ${JSON.stringify(next)}`)
    .replace(/^updated_at:[^\r\n]*$/mu, `updated_at: ${JSON.stringify(timestamp)}`);
  return `${markdown.slice(0, rawStart)}${raw}${markdown.slice(rawStart + parsed.raw.length)}`;
}

function canonicalAlias(value: string): string | undefined {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return normalized && normalized.length <= 120 && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(normalized) ? normalized : undefined;
}
function monotonicTimestamp(previous: string, requested: string): string { const before = Date.parse(previous), next = Date.parse(requested); return new Date(Number.isFinite(before) && next <= before ? before + 1 : next).toISOString(); }
function internalRequestId(request: NoteAliasChangeRequest): string { return `noteeditreq_${createHash("sha256").update(`pige.note-alias.v1\0${request.requestId}`).digest("hex").slice(0, 32)}`; }
function closed(request: NoteAliasChangeRequest, status: Exclude<NoteAliasChangeResult["status"], "committed">): NoteAliasChangeResult { return { ...request, status }; }
