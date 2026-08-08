import { createHash } from "node:crypto";
import type {
  NoteChangeClaimEvidenceRequest,
  NoteChangeClaimEvidenceResult,
  NoteClaimEvidenceItem,
  NoteSearchClaimEvidenceRequest,
  NoteSearchClaimEvidenceResult
} from "@pige/contracts";
import { parsePigeFrontmatter } from "@pige/markdown";
import { PageIdSchema, SourceIdSchema } from "@pige/schemas";
import { findMarkdownPageByIdAtSignature, scanMarkdownPages } from "./markdown-page-index";
import type { NoteMarkdownEditorService } from "./note-markdown-editor-service";
import type { NotesService } from "./notes-service";
import { readCurrentSourceRecordSnapshot } from "./source-file-access";

type TargetPort = Pick<NotesService, "resolveManagedPageTarget" | "render">;
type EditorPort = Pick<NoteMarkdownEditorService, "open" | "save">;
const MAX_EVIDENCE = 32;

export class ClaimEvidenceService {
  constructor(
    private readonly targets: TargetPort,
    private readonly editor: EditorPort,
    private readonly activeVaultPath: () => string | undefined,
    private readonly now: () => Date = () => new Date()
  ) {}

  search(ownerId: string, request: NoteSearchClaimEvidenceRequest): NoteSearchClaimEvidenceResult {
    const current = this.targets.resolveManagedPageTarget(ownerId, targetRequest(request), "claim");
    const vaultPath = this.activeVaultPath();
    if (current.status !== "ready") return { ...request, status: current.status };
    if (!vaultPath || !current.assertCurrent()) return { ...request, status: "stale" };
    const query = request.query.normalize("NFKC").toLocaleLowerCase("en-US");
    const candidates = scanMarkdownPages(vaultPath).pages
      .filter(({ summary }) => summary.status === "active" && summary.pageType === "source" &&
        summary.sourceIds.length === 1 && `${summary.title}\0${summary.sourceIds[0]}`
          .normalize("NFKC").toLocaleLowerCase("en-US").includes(query))
      .sort((left, right) => left.summary.title.localeCompare(right.summary.title, "en") ||
        left.summary.pageId.localeCompare(right.summary.pageId, "en"))
      .flatMap(({ summary }) => {
        const sourceId = summary.sourceIds[0]!;
        return sourceCurrent(vaultPath, summary.pageId, sourceId, summary.updatedAt)
          ? [{ sourcePageId: summary.pageId, sourceId, title: summary.title, updatedAt: summary.updatedAt }]
          : [];
      })
      .slice(0, 20);
    return current.assertCurrent() ? { ...request, status: "ready", candidates } : { ...request, status: "stale" };
  }

  async change(ownerId: string, request: NoteChangeClaimEvidenceRequest): Promise<NoteChangeClaimEvidenceResult> {
    const current = this.targets.resolveManagedPageTarget(ownerId, targetRequest(request), "claim");
    if (current.status !== "ready") return closed(request, current.status);
    const vaultPath = this.activeVaultPath();
    if (!vaultPath || !current.assertCurrent()) return closed(request, "stale");
    if (request.action === "add" && !sourceCurrent(
      vaultPath, request.sourcePageId, request.sourceId, request.expectedSourceUpdatedAt
    )) return closed(request, "stale");
    const opened = this.editor.open({ activeVaultId: request.activeVaultId, pageId: request.currentPageId });
    if (opened.status !== "opened") return closed(request, opened.status === "not_found" ? "not_found" : "failed");
    if (opened.revisionId !== current.pageContentHash || !current.assertCurrent()) return closed(request, "stale");
    if (request.action === "remove" && !projectClaimEvidence(vaultPath, parsePigeFrontmatter(opened.markdown)?.raw ?? "")
      ?.some((item) => item.sourceId === request.sourceId && item.sourcePageId === request.sourcePageId)) {
      return closed(request, "stale");
    }
    const markdown = updateEvidence(opened.markdown, request.action, request.sourceId, this.now().toISOString());
    if (!markdown) return closed(request, "ineligible");
    if (request.action === "add" && !sourceCurrent(
      vaultPath, request.sourcePageId, request.sourceId, request.expectedSourceUpdatedAt
    )) return closed(request, "stale");
    const saved = this.editor.save({
      requestId: internalRequestId(request), activeVaultId: request.activeVaultId,
      pageId: request.currentPageId, expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity, markdown,
      ...(request.action === "add" ? { recoveryKind: "claim_source" as const } : {})
    });
    if (saved.status !== "committed") {
      return closed(request, saved.status === "invalid" ? "ineligible" : saved.status);
    }
    try {
      const render = await this.targets.render({ pageId: request.currentPageId }, ownerId);
      if (!render.renderContextId || render.summary.pageId !== request.currentPageId ||
        render.summary.pageType !== "claim" || !render.claimEvidence ||
        (request.action === "add") !== render.claimEvidence.items.some(({ sourceId }) => sourceId === request.sourceId)) {
        return closed(request, "failed");
      }
      return { ...request, status: "committed", operationId: saved.operationId,
        render: { ...render, renderContextId: render.renderContextId } };
    } catch {
      return closed(request, "failed");
    }
  }
}

export function readClaimEvidenceRefs(raw: string): readonly string[] | undefined {
  const section = claimSection(raw);
  if (!section) return undefined;
  const lines = section.split(/\r?\n/u).filter((line) => /^  evidence:/u.test(line));
  if (lines.length !== 1) return undefined;
  try {
    const value: unknown = JSON.parse(lines[0]!.slice(lines[0]!.indexOf(":") + 1).trim());
    if (!Array.isArray(value) || value.length > MAX_EVIDENCE || !value.every((ref) => typeof ref === "string")) return undefined;
    const refs = value as string[];
    return refs.every((ref) => sourceIdFromEvidence(ref) !== undefined) && new Set(refs).size === refs.length
      ? refs : undefined;
  } catch {
    return undefined;
  }
}

export function projectClaimEvidence(vaultPath: string, raw: string): readonly NoteClaimEvidenceItem[] | undefined {
  const refs = readClaimEvidenceRefs(raw);
  if (!refs) return undefined;
  const items: NoteClaimEvidenceItem[] = [];
  for (const ref of refs) {
    const sourceId = sourceIdFromEvidence(ref)!;
    if (items.some((item) => item.sourceId === sourceId)) continue;
    const record = readCurrentSourceRecordSnapshot(vaultPath, sourceId);
    const pageId = record?.record.knowledgePageId;
    if (!pageId || !PageIdSchema.safeParse(pageId).success) continue;
    const page = findMarkdownPageByIdAtSignature(vaultPath, pageId)?.page.summary;
    if (!page || page.status !== "active" || page.pageType !== "source" || page.sourceIds.length !== 1 ||
      page.sourceIds[0] !== sourceId || !sourceCurrent(vaultPath, pageId, sourceId, page.updatedAt)) continue;
    items.push({ sourcePageId: pageId, sourceId, title: page.title, updatedAt: page.updatedAt });
  }
  return items;
}

function sourceCurrent(vaultPath: string, pageId: string, sourceId: string, updatedAt: string | undefined): boolean {
  if (!updatedAt) return false;
  const page = findMarkdownPageByIdAtSignature(vaultPath, pageId)?.page.summary;
  const record = readCurrentSourceRecordSnapshot(vaultPath, sourceId)?.record;
  return !!page && page.status === "active" && page.pageType === "source" && page.updatedAt === updatedAt &&
    page.sourceIds.length === 1 && page.sourceIds[0] === sourceId && record?.knowledgePageId === pageId &&
    (!record.knowledgePagePath || record.knowledgePagePath === page.pagePath);
}

function updateEvidence(markdown: string, action: "add" | "remove", sourceId: string, now: string): string | undefined {
  const parsed = parsePigeFrontmatter(markdown);
  if (parsed?.frontmatter.type !== "claim" || parsed.frontmatter.status !== "active") return undefined;
  const refs = readClaimEvidenceRefs(parsed.raw);
  const sourceIds = parsed.frontmatter.source_ids;
  if (!refs || !sourceIds || new Set(sourceIds).size !== sourceIds.length) return undefined;
  const existing = refs.filter((ref) => sourceIdFromEvidence(ref) === sourceId);
  if ((action === "add" && (existing.length > 0 || refs.length >= MAX_EVIDENCE)) ||
    (action === "remove" && (existing.length === 0 || refs.length === existing.length))) return undefined;
  const nextRefs = action === "add" ? [...refs, `${sourceId}#source`] : refs.filter((ref) => sourceIdFromEvidence(ref) !== sourceId);
  const nextSourceIds = action === "add" ? [...new Set([...sourceIds, sourceId])] :
    sourceIds.filter((id) => id !== sourceId || nextRefs.some((ref) => sourceIdFromEvidence(ref) === id));
  const nextRaw = parsed.raw
    .replace(/^  evidence:[^\r\n]*$/mu, `  evidence: ${JSON.stringify(nextRefs)}`)
    .replace(/^source_ids:[^\r\n]*$/mu, `source_ids: ${JSON.stringify(nextSourceIds)}`)
    .replace(/^updated_at:[^\r\n]*$/mu, `updated_at: ${JSON.stringify(monotonic(String(parsed.frontmatter.updated_at ?? ""), now))}`);
  const start = markdown.indexOf(parsed.raw);
  return start < 0 ? undefined : `${markdown.slice(0, start)}${nextRaw}${markdown.slice(start + parsed.raw.length)}`;
}

function sourceIdFromEvidence(ref: string): string | undefined {
  const sourceId = ref.split("#", 1)[0];
  return SourceIdSchema.safeParse(sourceId).success ? sourceId : undefined;
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

function internalRequestId(request: NoteChangeClaimEvidenceRequest): string {
  return `noteeditreq_${createHash("sha256")
    .update(`pige.claim-evidence.v1\0${request.requestId}\0${request.action}\0${request.sourceId}`)
    .digest("hex").slice(0, 32)}`;
}

function closed(request: NoteChangeClaimEvidenceRequest,
  status: Exclude<NoteChangeClaimEvidenceResult["status"], "committed">): NoteChangeClaimEvidenceResult {
  return { ...request, status };
}

function targetRequest(request: NoteSearchClaimEvidenceRequest | NoteChangeClaimEvidenceRequest) {
  return { activeVaultId: request.activeVaultId, pageId: request.currentPageId,
    renderContextId: request.renderContextId, expectedRevision: request.expectedRevision };
}
