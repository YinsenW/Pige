import { createHash } from "node:crypto";
import type {
  NoteClaimConfidence,
  NoteRenderResult,
  NoteSetClaimConfidenceRequest,
  NoteSetClaimConfidenceResult
} from "@pige/contracts";
import { parsePigeFrontmatter } from "@pige/markdown";
import type { NoteMarkdownEditorService } from "./note-markdown-editor-service";
import type { NotesService } from "./notes-service";

type ClaimTargetPort = Pick<NotesService, "resolveManagedPageTarget" | "render">;
type ClaimEditorPort = Pick<NoteMarkdownEditorService, "open" | "save">;

const CLAIM_CONFIDENCES = new Set<NoteClaimConfidence>(["low", "medium", "high"]);

export class ClaimConfidenceService {
  readonly #targets: ClaimTargetPort;
  readonly #editor: ClaimEditorPort;
  readonly #now: () => Date;

  constructor(targets: ClaimTargetPort, editor: ClaimEditorPort, now: () => Date = () => new Date()) {
    this.#targets = targets;
    this.#editor = editor;
    this.#now = now;
  }

  async setConfidence(
    ownerId: string,
    request: NoteSetClaimConfidenceRequest
  ): Promise<NoteSetClaimConfidenceResult> {
    const target = this.#targets.resolveManagedPageTarget(ownerId, {
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      renderContextId: request.renderContextId,
      expectedRevision: request.expectedRevision
    }, "claim");
    if (target.status !== "ready") return closed(request, target.status);
    if (!target.assertCurrent()) return closed(request, "stale");

    const opened = this.#editor.open({ activeVaultId: request.activeVaultId, pageId: request.currentPageId });
    if (opened.status !== "opened") {
      return closed(request, opened.status === "not_found" ? "not_found" : "failed");
    }
    if (opened.revisionId !== target.pageContentHash || !target.assertCurrent()) {
      return closed(request, "stale");
    }
    const markdown = updateClaimConfidenceMarkdown(opened.markdown, request.confidence, this.#now().toISOString());
    if (!markdown) return closed(request, "ineligible");

    const saved = this.#editor.save({
      requestId: internalRequestId(request.requestId),
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      markdown
    });
    if (saved.status !== "committed") return closed(request, mapSaveStatus(saved.status));

    let render: NoteRenderResult;
    try {
      render = await this.#targets.render({ pageId: request.currentPageId }, ownerId);
    } catch {
      return closed(request, "failed");
    }
    if (
      !render.renderContextId ||
      render.summary.pageId !== request.currentPageId ||
      render.summary.pageType !== "claim" ||
      render.claimConfidence?.confidence !== request.confidence ||
      render.claimConfidence.canChange !== true
    ) return closed(request, "failed");
    return {
      ...request,
      status: "committed",
      operationId: saved.operationId,
      render: { ...render, renderContextId: render.renderContextId }
    };
  }
}

export function readClaimConfidence(rawFrontmatter: string): NoteClaimConfidence | undefined {
  const section = claimSection(rawFrontmatter);
  if (!section) return undefined;
  const matches = [...section.text.matchAll(/^  confidence:\s*(?:"([a-z]+)"|'([a-z]+)'|([a-z]+))\s*$/gmu)];
  if (matches.length !== 1) return undefined;
  const confidence = matches[0]![1] ?? matches[0]![2] ?? matches[0]![3];
  return CLAIM_CONFIDENCES.has(confidence as NoteClaimConfidence)
    ? confidence as NoteClaimConfidence
    : undefined;
}

export function updateClaimConfidenceMarkdown(
  markdown: string,
  confidence: NoteClaimConfidence,
  updatedAt: string
): string | undefined {
  const parsed = parsePigeFrontmatter(markdown);
  if (!parsed || parsed.frontmatter.type !== "claim" || parsed.frontmatter.status !== "active" ||
      !CLAIM_CONFIDENCES.has(confidence)) return undefined;
  const current = readClaimConfidence(parsed.raw);
  if (!current || current === confidence) return undefined;
  const section = claimSection(parsed.raw);
  if (!section) return undefined;
  const confidenceLines = [...section.text.matchAll(/^  confidence:\s*(?:"[a-z]+"|'[a-z]+'|[a-z]+)\s*$/gmu)];
  const updatedLines = [...parsed.raw.matchAll(/^updated_at:[^\r\n]*$/gmu)];
  if (confidenceLines.length !== 1 || updatedLines.length !== 1) return undefined;
  const match = confidenceLines[0]!;
  const start = section.start + (match.index ?? 0);
  const end = start + match[0].length;
  const withConfidence = `${parsed.raw.slice(0, start)}  confidence: "${confidence}"${parsed.raw.slice(end)}`;
  const nextRaw = withConfidence.replace(/^updated_at:[^\r\n]*$/mu, `updated_at: ${updatedAt}`);
  const rawStart = markdown.indexOf(parsed.raw);
  if (rawStart < 0) return undefined;
  return `${markdown.slice(0, rawStart)}${nextRaw}${markdown.slice(rawStart + parsed.raw.length)}`;
}

function claimSection(raw: string): { readonly start: number; readonly text: string } | undefined {
  const headings = [...raw.matchAll(/^claim:\s*$/gmu)];
  if (headings.length !== 1) return undefined;
  const heading = headings[0]!;
  const start = heading.index ?? 0;
  const following = raw.slice(start + heading[0].length);
  const nextTopLevel = following.search(/\r?\n(?=[a-z][a-z0-9_]*:)/u);
  const end = nextTopLevel < 0 ? raw.length : start + heading[0].length + nextTopLevel;
  return { start, text: raw.slice(start, end) };
}

function internalRequestId(requestId: string): string {
  const suffix = createHash("sha256").update(`pige.claim-confidence.v1\0${requestId}`, "utf8")
    .digest("hex").slice(0, 32);
  return `noteeditreq_${suffix}`;
}

function mapSaveStatus(
  status: "stale" | "not_found" | "invalid" | "failed"
): "stale" | "not_found" | "ineligible" | "failed" {
  return status === "invalid" ? "ineligible" : status;
}

function closed(
  request: NoteSetClaimConfidenceRequest,
  status: Exclude<NoteSetClaimConfidenceResult["status"], "committed">
): NoteSetClaimConfidenceResult {
  return { ...request, status };
}
