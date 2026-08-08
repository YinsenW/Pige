import { createHash, randomUUID } from "node:crypto";
import type {
  KnowledgeHealthClaimSourceRepairRequest,
  KnowledgeHealthClaimSourceRepairResult,
  KnowledgeHealthClaimSourceSearchRequest,
  KnowledgeHealthClaimSourceSearchResult,
  KnowledgeHealthIssueSummary,
  KnowledgeHealthRunRequest,
  KnowledgeHealthRunResult
} from "@pige/contracts";
import { parsePigeFrontmatter } from "@pige/markdown";
import {
  KNOWLEDGE_HEALTH_MAX_CLAIM_SOURCE_CANDIDATES,
  KnowledgeHealthClaimSourceRepairResultSchema,
  KnowledgeHealthClaimSourceSearchResultSchema,
  KnowledgeHealthRunResultSchema
} from "@pige/schemas";
import type { LocalDatabaseKnowledgeHealthSnapshot } from "./local-database-knowledge-health";
import {
  findMarkdownPageByIdAtSignature,
  readMarkdownPageContentAtSignature,
  scanMarkdownPages
} from "./markdown-page-index";
import type { NoteMarkdownEditorService } from "./note-markdown-editor-service";
import { readCurrentSourceRecordSnapshot, type CurrentSourceRecordSnapshot } from "./source-file-access";

interface DatabasePort {
  readonly knowledgeHealth: (vaultPath: string) => LocalDatabaseKnowledgeHealthSnapshot | undefined;
}

interface ClaimContext {
  readonly epoch: number;
  readonly reportRequestId: string;
  readonly activeVaultId: string;
  readonly indexGeneration: string;
  readonly pageId: string;
  readonly revisionId: string;
  readonly renderIdentity: string;
  readonly claimRevision: `noteeditrev_${string}`;
  readonly claimRenderProof: `knowledge_health_render_${string}`;
}

interface SourceContext {
  readonly claimContextId: string;
  readonly sourceId: string;
  readonly sourcePageId: string;
  readonly sourcePagePath: string;
  readonly sourcePageTitle: string;
  readonly sourcePageRevision: string;
  readonly sourcePageRenderIdentity: string;
  readonly record: CurrentSourceRecordSnapshot;
}

export class KnowledgeHealthUnsourcedClaimService {
  readonly #claims = new Map<string, ClaimContext>();
  readonly #sources = new Map<string, SourceContext>();
  #epoch = 0;

  constructor(
    private readonly database: DatabasePort,
    private readonly editor: Pick<NoteMarkdownEditorService, "open" | "save">,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly randomId: () => string = randomUUID
  ) {}

  project(
    vaultPath: string,
    request: KnowledgeHealthRunRequest,
    result: KnowledgeHealthRunResult
  ): KnowledgeHealthRunResult {
    this.#claims.clear();
    this.#sources.clear();
    this.#epoch = result.status === "ready" ? result.reportEpoch : 0;
    if (result.status !== "ready" || result.coverage !== "complete") return result;
    const issues = result.issues.map((issue) => this.#projectIssue(vaultPath, request, result, issue));
    const candidate = { ...result, issues };
    return KnowledgeHealthRunResultSchema.safeParse(candidate).success ? candidate : result;
  }

  search(vaultPath: string, request: KnowledgeHealthClaimSourceSearchRequest): KnowledgeHealthClaimSourceSearchResult {
    const claim = this.#claims.get(request.repairContextId);
    if (!claim) return searchResult(request, "not_found");
    if (!matchesClaim(claim, request)) return searchResult(request, "stale");
    try {
      if (!this.#claimStillCurrent(vaultPath, claim)) return searchResult(request, "stale");
      for (const [id, context] of this.#sources) {
        if (context.claimContextId === request.repairContextId) this.#sources.delete(id);
      }
      const query = request.query.normalize("NFKC").trim().toLocaleLowerCase("en-US");
      const eligible = scanMarkdownPages(vaultPath).pages
        .filter(({ summary }) => summary.pageType === "source" && summary.status === "active" && summary.sourceIds.length === 1)
        .filter(({ summary }) => !query || summary.title.toLocaleLowerCase("en-US").includes(query))
        .sort((left, right) => left.summary.title.localeCompare(right.summary.title, "en-US") ||
          left.summary.pageId.localeCompare(right.summary.pageId, "en-US"));
      const sources: Array<{ sourceContextId: string; page: { pageId: string; title: string } }> = [];
      let eligibleSourceCount = 0;
      let truncated = false;
      for (const page of eligible) {
        const sourceId = page.summary.sourceIds[0]!;
        const sourcePage = currentSourcePage(vaultPath, page.summary.pageId);
        if (!sourcePage || sourcePage.page.summary.pageType !== "source" || sourcePage.page.summary.status !== "active" ||
          sourcePage.page.summary.pagePath !== page.summary.pagePath || sourcePage.page.summary.title !== page.summary.title ||
          sourcePage.page.summary.sourceIds.length !== 1 || sourcePage.page.summary.sourceIds[0] !== sourceId) continue;
        const record = readCurrentSourceRecordSnapshot(vaultPath, sourceId);
        if (!record || record.record.knowledgePageId !== sourcePage.page.summary.pageId ||
          (record.record.knowledgePagePath && record.record.knowledgePagePath !== sourcePage.page.summary.pagePath)) continue;
        eligibleSourceCount += 1;
        if (sources.length >= KNOWLEDGE_HEALTH_MAX_CLAIM_SOURCE_CANDIDATES) {
          truncated = true;
          continue;
        }
        const sourceContextId = this.#contextId("source");
        this.#sources.set(sourceContextId, {
          claimContextId: request.repairContextId,
          sourceId,
          sourcePageId: page.summary.pageId,
          sourcePagePath: page.summary.pagePath,
          sourcePageTitle: page.summary.title,
          sourcePageRevision: sourcePage.revision,
          sourcePageRenderIdentity: sourcePage.renderIdentity,
          record
        });
        sources.push({ sourceContextId, page: { pageId: page.summary.pageId, title: page.summary.title } });
      }
      if (!this.#claimStillCurrent(vaultPath, claim)) return searchResult(request, "stale");
      return KnowledgeHealthClaimSourceSearchResultSchema.parse({
        ...request,
        status: "ready",
        sources,
        truncated: truncated || eligibleSourceCount > sources.length
      });
    } catch {
      return searchResult(request, "failed");
    }
  }

  repair(vaultPath: string, request: KnowledgeHealthClaimSourceRepairRequest): KnowledgeHealthClaimSourceRepairResult {
    const claim = this.#claims.get(request.repairContextId);
    if (!claim) return repairResult(request, "not_found");
    const source = this.#sources.get(request.sourceContextId);
    if (!matchesClaim(claim, request) || !source || source.claimContextId !== request.repairContextId) {
      return repairResult(request, "ineligible");
    }
    try {
      if (!this.#claimStillCurrent(vaultPath, claim) || !sourceStillCurrent(vaultPath, source)) {
        return repairResult(request, "stale");
      }
      const opened = this.editor.open({ activeVaultId: request.activeVaultId, pageId: request.pageId });
      if (opened.status === "not_found") return repairResult(request, "not_found");
      if (opened.status !== "opened" || opened.revisionId !== claim.revisionId ||
        opened.renderIdentity !== claim.renderIdentity) return repairResult(request, "stale");
      const markdown = bindClaimSource(opened.markdown, source.sourceId, this.now());
      if (!markdown || !sourceStillCurrent(vaultPath, source)) return repairResult(request, "ineligible");
      const saved = this.editor.save({
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        pageId: request.pageId,
        expectedRevisionId: opened.revisionId,
        renderIdentity: opened.renderIdentity,
        markdown,
        recoveryKind: "claim_source"
      });
      if (saved.status === "committed") {
        this.#claims.delete(request.repairContextId);
        this.#sources.delete(request.sourceContextId);
        return KnowledgeHealthClaimSourceRepairResultSchema.parse({
          ...request,
          status: "committed",
          revision: publicRevision(saved.revisionId),
          operationId: saved.operationId
        });
      }
      return repairResult(request, saved.status === "not_found" ? "not_found" :
        saved.status === "invalid" ? "ineligible" : saved.status === "stale" ? "stale" : "failed");
    } catch {
      return repairResult(request, "failed");
    }
  }

  #projectIssue(
    vaultPath: string,
    request: KnowledgeHealthRunRequest,
    result: Extract<KnowledgeHealthRunResult, { status: "ready" }>,
    issue: KnowledgeHealthIssueSummary
  ): KnowledgeHealthIssueSummary {
    if (issue.kind !== "unsourced_claim" || this.#claims.size >= 32) return issue;
    const opened = this.editor.open({ activeVaultId: request.activeVaultId, pageId: issue.page.pageId });
    if (opened.status !== "opened" || !isCanonicalUnsourcedClaim(opened.markdown)) return issue;
    const repairContextId = this.#contextId("claim");
    const claimRevision = publicRevision(opened.revisionId);
    const claimRenderProof = renderProof(this.#epoch, opened.renderIdentity, issue.page.pageId);
    this.#claims.set(repairContextId, {
      epoch: this.#epoch,
      reportRequestId: request.requestId,
      activeVaultId: request.activeVaultId,
      indexGeneration: result.indexGeneration,
      pageId: issue.page.pageId,
      revisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      claimRevision,
      claimRenderProof
    });
    return { ...issue, repairContextId, claimRevision, claimRenderProof };
  }

  #claimStillCurrent(vaultPath: string, claim: ClaimContext): boolean {
    if (claim.epoch < 1 || claim.claimRenderProof !== renderProof(claim.epoch, claim.renderIdentity, claim.pageId)) {
      return false;
    }
    const snapshot = this.database.knowledgeHealth(vaultPath);
    if (!snapshot || snapshot.indexGeneration !== claim.indexGeneration ||
      !snapshot.issues.some((issue) => issue.kind === "unsourced_claim" && issue.page.pageId === claim.pageId)) return false;
    const opened = this.editor.open({ activeVaultId: claim.activeVaultId, pageId: claim.pageId });
    return opened.status === "opened" && opened.revisionId === claim.revisionId &&
      opened.renderIdentity === claim.renderIdentity && isCanonicalUnsourcedClaim(opened.markdown);
  }

  #contextId(kind: "claim" | "source"): string {
    return kind === "claim"
      ? `knowledge_health_repair_context_${digest(`${kind}\0${this.#epoch}\0${this.randomId()}`)}`
      : `knowledge_health_claim_source_context_${digest(`${kind}\0${this.#epoch}\0${this.randomId()}`)}`;
  }
}

function matchesClaim(claim: ClaimContext, request: KnowledgeHealthClaimSourceSearchRequest | KnowledgeHealthClaimSourceRepairRequest): boolean {
  return claim.reportRequestId === request.reportRequestId && claim.activeVaultId === request.activeVaultId &&
    claim.epoch === request.reportEpoch && claim.indexGeneration === request.indexGeneration && claim.pageId === request.pageId &&
    claim.claimRevision === request.claimRevision && claim.claimRenderProof === request.claimRenderProof;
}

function sourceStillCurrent(vaultPath: string, context: SourceContext): boolean {
  const page = currentSourcePage(vaultPath, context.sourcePageId);
  if (!page || page.page.summary.pageType !== "source" || page.page.summary.status !== "active" ||
    page.page.summary.pagePath !== context.sourcePagePath || page.page.summary.title !== context.sourcePageTitle ||
    page.page.summary.sourceIds.length !== 1 || page.page.summary.sourceIds[0] !== context.sourceId ||
    page.revision !== context.sourcePageRevision || page.renderIdentity !== context.sourcePageRenderIdentity) return false;
  const current = readCurrentSourceRecordSnapshot(vaultPath, context.sourceId);
  return !!current && current.record.knowledgePageId === context.sourcePageId &&
    (!current.record.knowledgePagePath || current.record.knowledgePagePath === context.sourcePagePath) &&
    JSON.stringify(current.identity) === JSON.stringify(context.record.identity) &&
    JSON.stringify(current.record) === JSON.stringify(context.record.record);
}

function currentSourcePage(vaultPath: string, pageId: string): {
  readonly page: NonNullable<ReturnType<typeof findMarkdownPageByIdAtSignature>>["page"];
  readonly revision: string;
  readonly renderIdentity: string;
} | undefined {
  const located = findMarkdownPageByIdAtSignature(vaultPath, pageId);
  if (!located) return undefined;
  try {
    const markdown = readMarkdownPageContentAtSignature(vaultPath, located.signature, 4 * 1024 * 1024 + 1).markdown;
    const revision = `sha256:${digest(markdown)}`;
    return {
      page: located.page,
      revision,
      renderIdentity: digest(`pige.knowledge-health.source-page-render.v1\0${pageId}\0${located.signature.pagePath}\0${revision}`)
    };
  } catch {
    return undefined;
  }
}

function isCanonicalUnsourcedClaim(markdown: string): boolean {
  const parsed = parsePigeFrontmatter(markdown);
  if (!parsed || parsed.frontmatter.type !== "claim" || (parsed.frontmatter.source_ids ?? []).length !== 0) return false;
  const frontmatter = parsed.raw;
  return (frontmatter.match(/^source_ids:\s*\[\]\s*$/gmu)?.length ?? 0) === 1 &&
    (frontmatter.match(/^claim:\s*\n  confidence:\s*[^\n]+\n  evidence:\s*\[\]\s*\n  contradicts:\s*\[\]\s*$/gmu)?.length ?? 0) === 1;
}

function bindClaimSource(markdown: string, sourceId: string, updatedAt: string): string | undefined {
  if (!isCanonicalUnsourcedClaim(markdown)) return undefined;
  const evidence = `${sourceId}#source`;
  let next = markdown.replace(/^source_ids:\s*\[\]\s*$/mu, `source_ids: ["${sourceId}"]`)
    .replace(/^  evidence:\s*\[\]\s*$/mu, `  evidence: ["${evidence}"]`)
    .replace(/^updated_at:\s*[^\n]+$/mu, `updated_at: "${updatedAt}"`);
  const parsed = parsePigeFrontmatter(next);
  if (!parsed || parsed.frontmatter.type !== "claim" || parsed.frontmatter.source_ids?.length !== 1 ||
    parsed.frontmatter.source_ids[0] !== sourceId ||
    !next.includes(`  evidence: ["${evidence}"]`)) return undefined;
  return next;
}

function publicRevision(revision: string): `noteeditrev_${string}` {
  const match = /^sha256:([a-f0-9]{64})$/u.exec(revision);
  if (!match) throw new Error("Invalid note revision.");
  return `noteeditrev_${match[1]}`;
}

function renderProof(epoch: number, renderIdentity: string, pageId: string): `knowledge_health_render_${string}` {
  return `knowledge_health_render_${digest(`${epoch}\0${renderIdentity}\0${pageId}`)}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function searchResult(
  request: KnowledgeHealthClaimSourceSearchRequest,
  status: "stale" | "not_found" | "failed"
): KnowledgeHealthClaimSourceSearchResult {
  return KnowledgeHealthClaimSourceSearchResultSchema.parse({ ...request, status });
}

function repairResult(
  request: KnowledgeHealthClaimSourceRepairRequest,
  status: "stale" | "not_found" | "ineligible" | "failed"
): KnowledgeHealthClaimSourceRepairResult {
  return KnowledgeHealthClaimSourceRepairResultSchema.parse({ ...request, status });
}
