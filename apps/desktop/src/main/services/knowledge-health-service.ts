import { createHash, randomUUID } from "node:crypto";
import type {
  KnowledgeHealthIssueSummary,
  KnowledgeHealthOrphanParentCandidate,
  KnowledgeHealthOrphanParentSearchRequest,
  KnowledgeHealthOrphanParentSearchResult,
  KnowledgeHealthOrphanRepairRequest,
  KnowledgeHealthOrphanRepairResult,
  KnowledgeHealthRepairRequest,
  KnowledgeHealthRepairResult,
  KnowledgeHealthRunRequest,
  KnowledgeHealthRunResult,
  KnowledgeHealthTargetCandidate,
  KnowledgeHealthTargetSearchRequest,
  KnowledgeHealthTargetSearchResult
} from "@pige/contracts";
import { extractPigeMarkdownLinkRefs, parsePigeFrontmatter } from "@pige/markdown";
import {
  KNOWLEDGE_HEALTH_MAX_ORPHAN_PARENT_CANDIDATES,
  KNOWLEDGE_HEALTH_MAX_RESULT_UTF8_BYTES,
  KNOWLEDGE_HEALTH_MAX_TARGET_CANDIDATES,
  KnowledgeHealthOrphanParentSearchResultSchema,
  KnowledgeHealthOrphanRepairResultSchema,
  KnowledgeHealthRepairResultSchema,
  KnowledgeHealthRunResultSchema,
  KnowledgeHealthTargetSearchResultSchema,
  PageIdSchema
} from "@pige/schemas";
import type { LocalDatabaseKnowledgeHealthSnapshot } from "./local-database-knowledge-health";
import {
  findMarkdownPageByIdAtSignature,
  readMarkdownPageContentAtSignature,
  scanMarkdownPages
} from "./markdown-page-index";
import type { NoteMarkdownEditorService } from "./note-markdown-editor-service";

const MAX_KNOWLEDGE_HEALTH_PAGE_BYTES = 4 * 1024 * 1024;

const MAX_REPAIR_CONTEXTS = 64;

interface KnowledgeHealthDatabasePort {
  readonly knowledgeHealth: (vaultPath: string) => LocalDatabaseKnowledgeHealthSnapshot | undefined;
}

interface RepairContext {
  readonly reportEpoch: number;
  readonly reportRequestId: string;
  readonly activeVaultId: string;
  readonly indexGeneration: string;
  readonly pageId: string;
  readonly revisionId: string;
  readonly renderIdentity: string;
  readonly target: string;
  readonly start: number;
  readonly end: number;
  readonly source: string;
  readonly label: string;
  readonly sourceRevision: `noteeditrev_${string}`;
  readonly sourceRenderProof: `knowledge_health_render_${string}`;
  readonly occurrenceId: `knowledge_health_occurrence_${string}`;
}

interface TargetContext {
  readonly reportEpoch: number;
  readonly reportRequestId: string;
  readonly repairContextId: string;
  readonly activeVaultId: string;
  readonly indexGeneration: string;
  readonly sourcePageId: string;
  readonly targetPageId: string;
  readonly targetRevisionId: string;
  readonly targetRenderIdentity: string;
  readonly targetRevision: `noteeditrev_${string}`;
  readonly targetRenderProof: `knowledge_health_render_${string}`;
}

interface EligibleOccurrence {
  readonly start: number;
  readonly end: number;
  readonly source: string;
  readonly label: string;
}

interface OrphanRepairContext {
  readonly reportEpoch: number;
  readonly reportRequestId: string;
  readonly activeVaultId: string;
  readonly indexGeneration: string;
  readonly targetPageId: string;
  readonly targetTitle: string;
  readonly targetRevisionId: string;
  readonly targetRenderIdentity: string;
  readonly targetRevision: `noteeditrev_${string}`;
  readonly targetRenderProof: `knowledge_health_render_${string}`;
}

interface OrphanParentContext {
  readonly reportEpoch: number;
  readonly reportRequestId: string;
  readonly repairContextId: string;
  readonly activeVaultId: string;
  readonly indexGeneration: string;
  readonly targetPageId: string;
  readonly sourcePageId: string;
  readonly sourceRevisionId: string;
  readonly sourceRenderIdentity: string;
  readonly sourceRevision: `noteeditrev_${string}`;
  readonly sourceRenderProof: `knowledge_health_render_${string}`;
}

export class KnowledgeHealthService {
  readonly #database: KnowledgeHealthDatabasePort;
  readonly #now: () => string;
  readonly #editor: Pick<NoteMarkdownEditorService, "open" | "save"> | undefined;
  readonly #randomId: () => string;
  readonly #repairContexts = new Map<string, RepairContext>();
  readonly #targetContexts = new Map<string, TargetContext>();
  readonly #orphanRepairContexts = new Map<string, OrphanRepairContext>();
  readonly #orphanParentContexts = new Map<string, OrphanParentContext>();
  #reportEpoch = 0;

  constructor(
    database: KnowledgeHealthDatabasePort,
    now: () => string = () => new Date().toISOString(),
    editor?: Pick<NoteMarkdownEditorService, "open" | "save">,
    randomId: () => string = randomUUID
  ) {
    this.#database = database;
    this.#now = now;
    this.#editor = editor;
    this.#randomId = randomId;
  }

  run(vaultPath: string, request: KnowledgeHealthRunRequest): KnowledgeHealthRunResult {
    this.#repairContexts.clear();
    this.#targetContexts.clear();
    this.#orphanRepairContexts.clear();
    this.#orphanParentContexts.clear();
    this.#reportEpoch += 1;
    try {
      const snapshot = this.#database.knowledgeHealth(vaultPath);
      if (!snapshot) return unavailable(request);
      const issues = snapshot.invalidPageCount === 0
        ? this.#attachRepairContexts(vaultPath, request, snapshot)
        : [...snapshot.issues];
      let result = readyResult(request, snapshot, this.#now(), issues, snapshot.truncated);
      while (utf8ByteLength(result) > KNOWLEDGE_HEALTH_MAX_RESULT_UTF8_BYTES && issues.length > 0) {
        issues.pop();
        result = readyResult(request, snapshot, result.checkedAt, issues, true);
      }
      if (utf8ByteLength(result) > KNOWLEDGE_HEALTH_MAX_RESULT_UTF8_BYTES) return failed(request);
      return KnowledgeHealthRunResultSchema.parse(result);
    } catch {
      return failed(request);
    }
  }

  searchTargets(
    vaultPath: string,
    request: KnowledgeHealthTargetSearchRequest
  ): KnowledgeHealthTargetSearchResult {
    const context = this.#repairContexts.get(request.repairContextId);
    if (!context) return targetSearchResult(request, "not_found");
    if (!matchesRepairProof(context, request) || !this.#editor) {
      return targetSearchResult(request, "stale");
    }
    try {
      const snapshot = this.#database.knowledgeHealth(vaultPath);
      if (!snapshot || !snapshotStillMatches(snapshot, context)) return targetSearchResult(request, "stale");
      const source = this.#editor.open({ activeVaultId: request.activeVaultId, pageId: request.pageId });
      if (!sourcePageStillMatches(source, context)) return targetSearchResult(request, "stale");
      for (const [id, candidate] of this.#targetContexts) {
        if (candidate.repairContextId === request.repairContextId) this.#targetContexts.delete(id);
      }
      const query = normalizeSearchQuery(request.query);
      const matches = scanMarkdownPages(vaultPath).pages
        .filter(({ summary }) => summary.pageId !== context.pageId && summary.pageType === "note" &&
          summary.status !== "archived" && candidateMatches(summary.pageId, summary.title, query))
        .sort((left, right) => left.summary.title.localeCompare(right.summary.title, "en") ||
          left.summary.pageId.localeCompare(right.summary.pageId, "en"));
      const targets: KnowledgeHealthTargetCandidate[] = [];
      for (const candidate of matches) {
        if (targets.length >= KNOWLEDGE_HEALTH_MAX_TARGET_CANDIDATES) break;
        const opened = this.#editor.open({ activeVaultId: request.activeVaultId, pageId: candidate.summary.pageId });
        if (opened.status !== "opened") continue;
        const frontmatter = parsePigeFrontmatter(opened.markdown)?.frontmatter;
        if (!frontmatter || frontmatter.type !== "note" || frontmatter.status === "archived" ||
          typeof frontmatter.title !== "string") continue;
        const targetContextId = this.#createTargetContextId();
        const targetRevision = publicRevision(opened.revisionId);
        const targetRenderProof = renderProof(
          context.reportEpoch,
          "target",
          opened.renderIdentity,
          candidate.summary.pageId
        );
        this.#targetContexts.set(targetContextId, {
          reportEpoch: context.reportEpoch,
          reportRequestId: context.reportRequestId,
          repairContextId: request.repairContextId,
          activeVaultId: request.activeVaultId,
          indexGeneration: request.indexGeneration,
          sourcePageId: request.pageId,
          targetPageId: candidate.summary.pageId,
          targetRevisionId: opened.revisionId,
          targetRenderIdentity: opened.renderIdentity,
          targetRevision,
          targetRenderProof
        });
        targets.push({
          page: { pageId: candidate.summary.pageId, title: frontmatter.title },
          pageType: "note",
          targetContextId,
          targetRevision,
          targetRenderProof
        });
      }
      const current = this.#database.knowledgeHealth(vaultPath);
      if (!current || !snapshotStillMatches(current, context)) return targetSearchResult(request, "stale");
      const currentSource = this.#editor.open({ activeVaultId: request.activeVaultId, pageId: request.pageId });
      if (!sourcePageStillMatches(currentSource, context)) return targetSearchResult(request, "stale");
      return KnowledgeHealthTargetSearchResultSchema.parse({
        ...request,
        status: "ready",
        targets,
        truncated: matches.length > targets.length
      });
    } catch {
      return targetSearchResult(request, "failed");
    }
  }

  searchOrphanParents(
    vaultPath: string,
    request: KnowledgeHealthOrphanParentSearchRequest
  ): KnowledgeHealthOrphanParentSearchResult {
    const orphan = this.#orphanRepairContexts.get(request.repairContextId);
    if (!orphan) return orphanParentSearchResult(request, "not_found");
    if (!matchesOrphanProof(orphan, request) || !this.#editor) {
      return orphanParentSearchResult(request, "stale");
    }
    try {
      const snapshot = this.#database.knowledgeHealth(vaultPath);
      if (!snapshot || !orphanSnapshotStillMatches(snapshot, orphan) ||
        !orphanTargetStillMatches(vaultPath, orphan)) return orphanParentSearchResult(request, "stale");
      for (const [id, parent] of this.#orphanParentContexts) {
        if (parent.repairContextId === request.repairContextId) this.#orphanParentContexts.delete(id);
      }
      const query = normalizeSearchQuery(request.query);
      const candidates = scanMarkdownPages(vaultPath).pages
        .filter(({ summary }) => summary.pageId !== orphan.targetPageId && summary.pageType === "note" &&
          summary.status === "active" && candidateMatches(summary.pageId, summary.title, query))
        .sort((left, right) => left.summary.title.localeCompare(right.summary.title, "en-US") ||
          left.summary.pageId.localeCompare(right.summary.pageId, "en-US"));
      const parents: KnowledgeHealthOrphanParentCandidate[] = [];
      let truncated = false;
      for (const candidate of candidates) {
        const opened = this.#editor.open({ activeVaultId: request.activeVaultId, pageId: candidate.summary.pageId });
        if (opened.status !== "opened" || markdownLinksToPage(opened.markdown, orphan.targetPageId)) continue;
        const frontmatter = parsePigeFrontmatter(opened.markdown)?.frontmatter;
        if (!frontmatter || frontmatter.type !== "note" || frontmatter.status !== "active" ||
          typeof frontmatter.title !== "string" || frontmatter.title !== candidate.summary.title) continue;
        if (parents.length >= KNOWLEDGE_HEALTH_MAX_ORPHAN_PARENT_CANDIDATES) {
          truncated = true;
          break;
        }
        const sourceContextId = this.#createOrphanParentContextId();
        const sourceRevision = publicRevision(opened.revisionId);
        const sourceRenderProof = renderProof(
          orphan.reportEpoch,
          "source",
          opened.renderIdentity,
          candidate.summary.pageId
        );
        this.#orphanParentContexts.set(sourceContextId, {
          reportEpoch: orphan.reportEpoch,
          reportRequestId: orphan.reportRequestId,
          repairContextId: request.repairContextId,
          activeVaultId: request.activeVaultId,
          indexGeneration: request.indexGeneration,
          targetPageId: orphan.targetPageId,
          sourcePageId: candidate.summary.pageId,
          sourceRevisionId: opened.revisionId,
          sourceRenderIdentity: opened.renderIdentity,
          sourceRevision,
          sourceRenderProof
        });
        parents.push({
          page: { pageId: candidate.summary.pageId, title: candidate.summary.title },
          pageType: "note",
          sourceContextId,
          sourceRevision,
          sourceRenderProof
        });
      }
      const current = this.#database.knowledgeHealth(vaultPath);
      if (!current || !orphanSnapshotStillMatches(current, orphan) ||
        !orphanTargetStillMatches(vaultPath, orphan)) return orphanParentSearchResult(request, "stale");
      const currentParents = parents.filter((parent) => {
        const context = this.#orphanParentContexts.get(parent.sourceContextId);
        if (!context) return false;
        const opened = this.#editor!.open({ activeVaultId: request.activeVaultId, pageId: parent.page.pageId });
        const current = opened.status === "opened" && opened.revisionId === context.sourceRevisionId &&
          opened.renderIdentity === context.sourceRenderIdentity &&
          !markdownLinksToPage(opened.markdown, orphan.targetPageId);
        if (!current) this.#orphanParentContexts.delete(parent.sourceContextId);
        return current;
      });
      return KnowledgeHealthOrphanParentSearchResultSchema.parse({
        ...request,
        status: "ready",
        parents: currentParents,
        truncated: truncated || currentParents.length < parents.length
      });
    } catch {
      return orphanParentSearchResult(request, "failed");
    }
  }

  repairOrphan(
    vaultPath: string,
    request: KnowledgeHealthOrphanRepairRequest
  ): KnowledgeHealthOrphanRepairResult {
    const orphan = this.#orphanRepairContexts.get(request.repairContextId);
    if (!orphan) return orphanRepairResult(request, "not_found");
    const parent = this.#orphanParentContexts.get(request.sourceContextId);
    if (!matchesOrphanProof(orphan, request) || !parent || !matchesOrphanParentProof(parent, orphan, request)) {
      return orphanRepairResult(request, "ineligible");
    }
    if (!this.#editor) return orphanRepairResult(request, "failed");
    try {
      const snapshot = this.#database.knowledgeHealth(vaultPath);
      if (!snapshot || !orphanSnapshotStillMatches(snapshot, orphan) ||
        !orphanTargetStillMatches(vaultPath, orphan)) return orphanRepairResult(request, "stale");
      const opened = this.#editor.open({ activeVaultId: request.activeVaultId, pageId: request.sourcePageId });
      if (opened.status === "not_found") return orphanRepairResult(request, "not_found");
      if (opened.status !== "opened" || opened.revisionId !== parent.sourceRevisionId ||
        opened.renderIdentity !== parent.sourceRenderIdentity) return orphanRepairResult(request, "stale");
      if (markdownLinksToPage(opened.markdown, orphan.targetPageId)) {
        return orphanRepairResult(request, "ineligible");
      }
      const markdown = connectOrphanMarkdown(
        opened.markdown,
        orphan.targetPageId,
        orphan.targetTitle,
        request.repairContextId,
        this.#now()
      );
      if (!markdown) return orphanRepairResult(request, "ineligible");
      if (!orphanTargetStillMatches(vaultPath, orphan)) return orphanRepairResult(request, "stale");
      const saved = this.#editor.save({
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        pageId: request.sourcePageId,
        expectedRevisionId: opened.revisionId,
        renderIdentity: opened.renderIdentity,
        markdown
      });
      if (saved.status === "committed") {
        this.#orphanRepairContexts.delete(request.repairContextId);
        for (const [id, candidate] of this.#orphanParentContexts) {
          if (candidate.repairContextId === request.repairContextId) this.#orphanParentContexts.delete(id);
        }
        return KnowledgeHealthOrphanRepairResultSchema.parse({
          ...request,
          status: "committed",
          revision: publicRevision(saved.revisionId),
          operationId: saved.operationId
        });
      }
      return orphanRepairResult(request, saved.status === "not_found" ? "not_found" :
        saved.status === "invalid" ? "ineligible" : saved.status === "stale" ? "stale" : "failed");
    } catch {
      return orphanRepairResult(request, "failed");
    }
  }

  repair(vaultPath: string, request: KnowledgeHealthRepairRequest): KnowledgeHealthRepairResult {
    const context = this.#repairContexts.get(request.repairContextId);
    if (!context) return repairResult(request, "not_found");
    if (!matchesRepairProof(context, request)) return repairResult(request, "ineligible");
    if (!this.#editor) return repairResult(request, "failed");

    try {
      const opened = this.#editor.open({ activeVaultId: request.activeVaultId, pageId: request.pageId });
      if (opened.status === "not_found") return repairResult(request, "not_found");
      if (opened.status !== "opened") return repairResult(request, "failed");
      const stale = (): KnowledgeHealthRepairResult => repairResult(
        request,
        "stale",
        publicRevision(opened.revisionId)
      );
      const snapshot = this.#database.knowledgeHealth(vaultPath);
      if (!snapshot || !snapshotStillMatches(snapshot, context)) {
        return stale();
      }
      const issue = snapshot.issues.find((candidate) =>
        candidate.kind === "broken_link" && candidate.page.pageId === request.pageId
      );
      if (!issue || issue.kind !== "broken_link" || issue.unresolvedLinkCount !== 1) return stale();
      const target = snapshot.repairTargetsByPageId?.get(request.pageId);
      if (!target || target !== context.target) return stale();
      if (opened.revisionId !== context.revisionId || opened.renderIdentity !== context.renderIdentity) {
        return stale();
      }
      const occurrence = findEligibleOccurrence(opened.markdown, target);
      if (!occurrence || !sameOccurrence(occurrence, context)) return repairResult(request, "ineligible");
      let replacement = occurrence.label;
      if (request.action === "retarget_broken_reference") {
        const targetContext = request.targetContextId
          ? this.#targetContexts.get(request.targetContextId)
          : undefined;
        if (!targetContext || !matchesTargetProof(targetContext, context, request)) {
          return repairResult(request, "ineligible");
        }
        const openedTarget = this.#editor.open({
          activeVaultId: request.activeVaultId,
          pageId: targetContext.targetPageId
        });
        if (openedTarget.status !== "opened" ||
          openedTarget.revisionId !== targetContext.targetRevisionId ||
          openedTarget.renderIdentity !== targetContext.targetRenderIdentity) return stale();
        replacement = `[[${targetContext.targetPageId}|${occurrence.label}]]`;
      }
      const markdown = replaceOccurrence(opened.markdown, occurrence, replacement);
      const saved = this.#editor.save({
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        pageId: request.pageId,
        expectedRevisionId: opened.revisionId,
        renderIdentity: opened.renderIdentity,
        markdown
      });
      if (saved.status === "committed") {
        this.#repairContexts.delete(request.repairContextId);
        for (const [id, candidate] of this.#targetContexts) {
          if (candidate.repairContextId === request.repairContextId) this.#targetContexts.delete(id);
        }
        return KnowledgeHealthRepairResultSchema.parse({
          ...request,
          status: "committed",
          revision: publicRevision(saved.revisionId),
          operationId: saved.operationId
        });
      }
      if (saved.status === "stale") {
        const current = this.#editor.open({ activeVaultId: request.activeVaultId, pageId: request.pageId });
        return current.status === "opened"
          ? repairResult(request, "stale", publicRevision(current.revisionId))
          : repairResult(request, current.status === "not_found" ? "not_found" : "failed");
      }
      return repairResult(request, saved.status === "not_found" ? "not_found" :
        saved.status === "invalid" ? "ineligible" : "failed");
    } catch {
      return repairResult(request, "failed");
    }
  }

  #attachRepairContexts(
    vaultPath: string,
    request: KnowledgeHealthRunRequest,
    snapshot: LocalDatabaseKnowledgeHealthSnapshot
  ): KnowledgeHealthIssueSummary[] {
    if (!this.#editor) return [...snapshot.issues];
    const projected: KnowledgeHealthIssueSummary[] = [];
    for (const issue of snapshot.issues) {
      if (this.#repairContexts.size + this.#orphanRepairContexts.size >= MAX_REPAIR_CONTEXTS) {
        projected.push(issue);
        continue;
      }
      if (issue.kind === "orphan_page") {
        const target = readCurrentKnowledgePage(vaultPath, issue.page.pageId);
        if (!target || target.title !== issue.page.title) {
          projected.push(issue);
          continue;
        }
        const repairContextId = this.#createRepairContextId();
        const targetRevision = publicRevision(target.revisionId);
        const targetRenderProof = renderProof(
          this.#reportEpoch,
          "target",
          target.renderIdentity,
          issue.page.pageId
        );
        this.#orphanRepairContexts.set(repairContextId, {
          reportEpoch: this.#reportEpoch,
          reportRequestId: request.requestId,
          activeVaultId: request.activeVaultId,
          indexGeneration: snapshot.indexGeneration,
          targetPageId: issue.page.pageId,
          targetTitle: issue.page.title,
          targetRevisionId: target.revisionId,
          targetRenderIdentity: target.renderIdentity,
          targetRevision,
          targetRenderProof
        });
        projected.push({ ...issue, repairContextId, targetRevision, targetRenderProof });
        continue;
      }
      if (issue.kind !== "broken_link" || issue.unresolvedLinkCount !== 1) {
        projected.push(issue);
        continue;
      }
      const target = snapshot.repairTargetsByPageId?.get(issue.page.pageId);
      if (!target) {
        projected.push(issue);
        continue;
      }
      const opened = this.#editor!.open({ activeVaultId: request.activeVaultId, pageId: issue.page.pageId });
      if (opened.status !== "opened") {
        projected.push(issue);
        continue;
      }
      const occurrence = findEligibleOccurrence(opened.markdown, target);
      if (!occurrence) {
        projected.push(issue);
        continue;
      }
      const repairContextId = this.#createRepairContextId();
      const sourceRevision = publicRevision(opened.revisionId);
      const sourceRenderProof = renderProof(this.#reportEpoch, "source", opened.renderIdentity, issue.page.pageId);
      const occurrenceId = occurrenceProof(this.#reportEpoch, issue.page.pageId, target, occurrence);
      this.#repairContexts.set(repairContextId, {
        reportEpoch: this.#reportEpoch,
        reportRequestId: request.requestId,
        activeVaultId: request.activeVaultId,
        indexGeneration: snapshot.indexGeneration,
        pageId: issue.page.pageId,
        revisionId: opened.revisionId,
        renderIdentity: opened.renderIdentity,
        target,
        ...occurrence,
        sourceRevision,
        sourceRenderProof,
        occurrenceId
      });
      projected.push({
        ...issue,
        repairContextId,
        sourceRevision,
        sourceRenderProof,
        occurrenceId
      });
    }
    return projected;
  }

  #createRepairContextId(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const suffix = createHash("sha256")
        .update(`pige.knowledge-health.repair-context.v1\0${this.#reportEpoch}\0${attempt}\0${this.#randomId()}`)
        .digest("hex");
      const id = `knowledge_health_repair_context_${suffix}`;
      if (!this.#repairContexts.has(id) && !this.#orphanRepairContexts.has(id)) return id;
    }
    throw new Error("Unable to allocate a Knowledge Health repair context.");
  }

  #createTargetContextId(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const suffix = createHash("sha256")
        .update(`pige.knowledge-health.target-context.v1\0${this.#reportEpoch}\0${attempt}\0${this.#randomId()}`)
        .digest("hex");
      const id = `knowledge_health_target_context_${suffix}`;
      if (!this.#targetContexts.has(id)) return id;
    }
    throw new Error("Unable to allocate a Knowledge Health target context.");
  }

  #createOrphanParentContextId(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const suffix = createHash("sha256")
        .update(`pige.knowledge-health.orphan-parent-context.v1\0${this.#reportEpoch}\0${attempt}\0${this.#randomId()}`)
        .digest("hex");
      const id = `knowledge_health_orphan_parent_context_${suffix}`;
      if (!this.#orphanParentContexts.has(id)) return id;
    }
    throw new Error("Unable to allocate a Knowledge Health orphan parent context.");
  }
}

function readyResult(
  request: KnowledgeHealthRunRequest,
  snapshot: LocalDatabaseKnowledgeHealthSnapshot,
  checkedAt: string,
  issues: readonly KnowledgeHealthIssueSummary[],
  truncated: boolean
): Extract<KnowledgeHealthRunResult, { readonly status: "ready" }> {
  return {
    ...request,
    status: "ready",
    checkedAt,
    indexGeneration: snapshot.indexGeneration,
    coverage: snapshot.invalidPageCount === 0 ? "complete" : "partial",
    invalidPageCount: snapshot.invalidPageCount,
    counts: snapshot.counts,
    issues: [...issues],
    truncated: truncated || snapshot.counts.totalIssueCount > issues.length
  };
}

function findEligibleOccurrence(markdown: string, expectedTarget: string): EligibleOccurrence | undefined {
  const parsedRefs = extractPigeMarkdownLinkRefs(markdown)
    .filter((reference) => reference.target === expectedTarget);
  if (parsedRefs.length !== 1) return undefined;
  const bodyStart = parsePigeFrontmatter(markdown)?.bodyStartOffset ?? 0;
  const searchable = maskCode(markdown.slice(bodyStart));
  const matches: EligibleOccurrence[] = [];
  for (const match of searchable.matchAll(/(?<!!)\[\[([^\]\n]+)\]\]/gu)) {
    const source = match[0];
    const parts = (match[1] ?? "").split("|");
    if (parts.length > 2) continue;
    const target = normalizeInline(parts[0] ?? "");
    const label = parts.length === 2 ? normalizePlainLabel(parts[1] ?? "") : target;
    if (!target || !label || target !== expectedTarget) continue;
    const start = bodyStart + (match.index ?? 0);
    matches.push({ start, end: start + source.length, source, label });
  }
  for (const match of searchable.matchAll(/(?<!!)\[([^\]\n]+)\]\(([^)\s]+)\)/gu)) {
    const source = match[0];
    const label = normalizePlainLabel(match[1] ?? "");
    const target = normalizeLocalMarkdownTarget(match[2] ?? "");
    if (!label || !target || target !== expectedTarget) continue;
    const start = bodyStart + (match.index ?? 0);
    matches.push({ start, end: start + source.length, source, label });
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function maskCode(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/gu, (value) => " ".repeat(value.length))
    .replace(/`[^`\n]*`/gu, (value) => " ".repeat(value.length));
}

function normalizeInline(value: string): string | undefined {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return normalized.length > 0 && normalized.length <= 256 && isPlainText(normalized)
    ? normalized
    : undefined;
}

function normalizePlainLabel(value: string): string | undefined {
  const normalized = normalizeInline(value);
  return normalized && !/[\[\]()<>{}|*_~!]/u.test(normalized) ? normalized : undefined;
}

function normalizeLocalMarkdownTarget(value: string): string | undefined {
  let decoded: string;
  try { decoded = decodeURIComponent(value.trim()); } catch { return undefined; }
  if (
    !decoded ||
    /^[a-z][a-z0-9+.-]*:/iu.test(decoded) ||
    decoded.startsWith("/") ||
    decoded.startsWith("#") ||
    decoded.includes("?") ||
    decoded.includes("#") ||
    decoded.includes("\\")
  ) return undefined;
  const normalized = decoded.replace(/^\.\//u, "");
  if (!normalized.endsWith(".md") || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    return undefined;
  }
  return normalized;
}

function isPlainText(value: string): boolean {
  return !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value);
}

function replaceOccurrence(markdown: string, occurrence: EligibleOccurrence, replacement: string): string {
  if (markdown.slice(occurrence.start, occurrence.end) !== occurrence.source) {
    throw new Error("The Knowledge Health repair occurrence changed.");
  }
  return markdown.slice(0, occurrence.start) + replacement + markdown.slice(occurrence.end);
}

function sameOccurrence(occurrence: EligibleOccurrence, context: RepairContext): boolean {
  return occurrence.start === context.start && occurrence.end === context.end &&
    occurrence.source === context.source && occurrence.label === context.label;
}

function matchesRepairProof(
  context: RepairContext,
  request: KnowledgeHealthRepairRequest | KnowledgeHealthTargetSearchRequest
): boolean {
  return context.reportEpoch > 0 &&
    context.reportRequestId === request.reportRequestId &&
    context.activeVaultId === request.activeVaultId &&
    context.indexGeneration === request.indexGeneration &&
    context.pageId === request.pageId &&
    context.sourceRevision === request.sourceRevision &&
    context.sourceRenderProof === request.sourceRenderProof &&
    context.occurrenceId === request.occurrenceId;
}

function matchesTargetProof(
  target: TargetContext,
  source: RepairContext,
  request: KnowledgeHealthRepairRequest
): boolean {
  return request.action === "retarget_broken_reference" &&
    target.reportEpoch === source.reportEpoch &&
    target.reportRequestId === request.reportRequestId &&
    target.repairContextId === request.repairContextId &&
    target.activeVaultId === request.activeVaultId &&
    target.indexGeneration === request.indexGeneration &&
    target.sourcePageId === request.pageId &&
    target.targetPageId === request.targetPageId &&
    target.targetRevision === request.targetRevision &&
    target.targetRenderProof === request.targetRenderProof;
}

function snapshotStillMatches(
  snapshot: LocalDatabaseKnowledgeHealthSnapshot,
  context: RepairContext
): boolean {
  if (snapshot.invalidPageCount !== 0 || snapshot.indexGeneration !== context.indexGeneration) return false;
  const issue = snapshot.issues.find((candidate) =>
    candidate.kind === "broken_link" && candidate.page.pageId === context.pageId
  );
  return issue?.kind === "broken_link" && issue.unresolvedLinkCount === 1 &&
    snapshot.repairTargetsByPageId?.get(context.pageId) === context.target;
}

function sourcePageStillMatches(
  opened: ReturnType<Pick<NoteMarkdownEditorService, "open">["open"]>,
  context: RepairContext
): boolean {
  if (opened.status !== "opened" || opened.revisionId !== context.revisionId ||
    opened.renderIdentity !== context.renderIdentity) return false;
  const occurrence = findEligibleOccurrence(opened.markdown, context.target);
  return !!occurrence && sameOccurrence(occurrence, context);
}

function renderProof(
  reportEpoch: number,
  role: "source" | "target",
  renderIdentity: string,
  pageId: string
): `knowledge_health_render_${string}` {
  return `knowledge_health_render_${createHash("sha256")
    .update(`pige.knowledge-health.render-proof.v1\0${reportEpoch}\0${role}\0${pageId}\0${renderIdentity}`)
    .digest("hex")}`;
}

function occurrenceProof(
  reportEpoch: number,
  pageId: string,
  target: string,
  occurrence: EligibleOccurrence
): `knowledge_health_occurrence_${string}` {
  return `knowledge_health_occurrence_${createHash("sha256")
    .update(`pige.knowledge-health.occurrence.v1\0${reportEpoch}\0${pageId}\0${target}\0${occurrence.start}\0${occurrence.end}\0${occurrence.source}`)
    .digest("hex")}`;
}

function normalizeSearchQuery(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US");
}

function candidateMatches(pageId: string, title: string, query: string): boolean {
  if (!query) return true;
  return pageId.toLocaleLowerCase("en-US").includes(query) ||
    title.normalize("NFKC").toLocaleLowerCase("en-US").includes(query);
}

function readCurrentKnowledgePage(vaultPath: string, pageId: string): {
  readonly title: string;
  readonly revisionId: string;
  readonly renderIdentity: string;
} | undefined {
  const located = findMarkdownPageByIdAtSignature(vaultPath, pageId);
  if (!located || located.page.summary.status !== "active" || located.page.summary.pageType === "source" ||
    !located.signature.pagePath.startsWith("wiki/") ||
    located.signature.sizeBytes > MAX_KNOWLEDGE_HEALTH_PAGE_BYTES) return undefined;
  const content = readMarkdownPageContentAtSignature(
    vaultPath,
    located.signature,
    MAX_KNOWLEDGE_HEALTH_PAGE_BYTES + 1
  );
  const parsed = parsePigeFrontmatter(content.markdown);
  if (!parsed || parsed.frontmatter.id !== pageId || parsed.frontmatter.status !== "active" ||
    parsed.frontmatter.type === "source" || typeof parsed.frontmatter.title !== "string" ||
    parsed.frontmatter.title !== located.page.summary.title) return undefined;
  const revisionId = `sha256:${createHash("sha256").update(content.markdown, "utf8").digest("hex")}`;
  const renderIdentity = `sha256:${createHash("sha256")
    .update(`pige.knowledge-health.page-render.v1\0${pageId}\0${located.signature.pagePath}\0${revisionId}\0${located.signature.deviceId}\0${located.signature.fileId}\0${located.signature.mtimeMs}\0${located.signature.sizeBytes}`)
    .digest("hex")}`;
  return { title: parsed.frontmatter.title, revisionId, renderIdentity };
}

function orphanTargetStillMatches(vaultPath: string, context: OrphanRepairContext): boolean {
  const target = readCurrentKnowledgePage(vaultPath, context.targetPageId);
  return !!target && target.title === context.targetTitle && target.revisionId === context.targetRevisionId &&
    target.renderIdentity === context.targetRenderIdentity;
}

function orphanSnapshotStillMatches(
  snapshot: LocalDatabaseKnowledgeHealthSnapshot,
  context: OrphanRepairContext
): boolean {
  return snapshot.invalidPageCount === 0 && snapshot.indexGeneration === context.indexGeneration &&
    snapshot.issues.some((issue) => issue.kind === "orphan_page" &&
      issue.page.pageId === context.targetPageId && issue.page.title === context.targetTitle);
}

function matchesOrphanProof(
  context: OrphanRepairContext,
  request: KnowledgeHealthOrphanParentSearchRequest | KnowledgeHealthOrphanRepairRequest
): boolean {
  return context.reportEpoch > 0 && context.reportRequestId === request.reportRequestId &&
    context.activeVaultId === request.activeVaultId && context.indexGeneration === request.indexGeneration &&
    context.targetPageId === request.pageId && context.targetRevision === request.targetRevision &&
    context.targetRenderProof === request.targetRenderProof;
}

function matchesOrphanParentProof(
  parent: OrphanParentContext,
  orphan: OrphanRepairContext,
  request: KnowledgeHealthOrphanRepairRequest
): boolean {
  return parent.reportEpoch === orphan.reportEpoch && parent.reportRequestId === request.reportRequestId &&
    parent.repairContextId === request.repairContextId && parent.activeVaultId === request.activeVaultId &&
    parent.indexGeneration === request.indexGeneration && parent.targetPageId === request.pageId &&
    parent.sourcePageId === request.sourcePageId && parent.sourceRevision === request.sourceRevision &&
    parent.sourceRenderProof === request.sourceRenderProof;
}

function markdownLinksToPage(markdown: string, pageId: string): boolean {
  return extractPigeMarkdownLinkRefs(markdown).some((reference) => {
    if (reference.target === pageId) return true;
    if (!reference.target.startsWith("#wiki:")) return false;
    try { return decodeURIComponent(reference.target.slice("#wiki:".length)) === pageId; } catch { return false; }
  });
}

function connectOrphanMarkdown(
  markdown: string,
  targetPageId: string,
  targetTitle: string,
  repairContextId: string,
  now: string
): string | undefined {
  const parsed = parsePigeFrontmatter(markdown);
  if (!parsed || parsed.frontmatter.type !== "note" || parsed.frontmatter.status !== "active" ||
    markdown.includes(`<!-- pige:managed:start knowledge-health-orphan ${repairContextId} -->`)) return undefined;
  const relatedMatches = [...parsed.raw.matchAll(/^related_page_ids:[^\r\n]*$/gmu)];
  const updatedMatches = [...parsed.raw.matchAll(/^updated_at:[^\r\n]*$/gmu)];
  if (relatedMatches.length !== 1 || updatedMatches.length !== 1) return undefined;
  let related: unknown;
  try { related = JSON.parse(relatedMatches[0]![0].slice("related_page_ids:".length).trim()); } catch { return undefined; }
  if (!Array.isArray(related) || related.some((value) => !PageIdSchema.safeParse(value).success) ||
    (!related.includes(targetPageId) && related.length >= 64)) return undefined;
  const nextRelated = related.includes(targetPageId) ? related : [...related, targetPageId];
  const previousUpdatedAt = String(parsed.frontmatter.updated_at ?? "");
  const requestedMs = Date.parse(now);
  const previousMs = Date.parse(previousUpdatedAt);
  if (!Number.isFinite(requestedMs)) return undefined;
  const updatedAt = new Date(Number.isFinite(previousMs) && requestedMs <= previousMs ? previousMs + 1 : requestedMs)
    .toISOString();
  const nextRaw = parsed.raw
    .replace(/^related_page_ids:[^\r\n]*$/mu, `related_page_ids: ${JSON.stringify(nextRelated)}`)
    .replace(/^updated_at:[^\r\n]*$/mu, `updated_at: ${JSON.stringify(updatedAt)}`);
  const rawStart = markdown.indexOf(parsed.raw);
  if (rawStart < 0) return undefined;
  const withFrontmatter = `${markdown.slice(0, rawStart)}${nextRaw}${markdown.slice(rawStart + parsed.raw.length)}`;
  const label = targetTitle.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;")
    .replace(/\\/gu, "\\\\").replace(/\[/gu, "\\[").replace(/\]/gu, "\\]")
    .replace(/\s+/gu, " ").trim();
  if (!label) return undefined;
  const separator = withFrontmatter.endsWith("\n") ? "\n" : "\n\n";
  return `${withFrontmatter}${separator}<!-- pige:managed:start knowledge-health-orphan ${repairContextId} -->
## Related

- [${label}](#wiki:${encodeURIComponent(targetPageId)})
<!-- pige:managed:end -->
`;
}

function publicRevision(privateRevision: string): `noteeditrev_${string}` {
  const match = /^sha256:([a-f0-9]{64})$/u.exec(privateRevision);
  if (!match) throw new Error("The Knowledge Health page revision is invalid.");
  return `noteeditrev_${match[1]}`;
}

function repairResult(
  request: KnowledgeHealthRepairRequest,
  status: "stale",
  revision: `noteeditrev_${string}`
): KnowledgeHealthRepairResult;
function repairResult(
  request: KnowledgeHealthRepairRequest,
  status: "not_found" | "ineligible" | "failed"
): KnowledgeHealthRepairResult;
function repairResult(
  request: KnowledgeHealthRepairRequest,
  status: "stale" | "not_found" | "ineligible" | "failed",
  revision?: `noteeditrev_${string}`
): KnowledgeHealthRepairResult {
  return KnowledgeHealthRepairResultSchema.parse({ ...request, status, ...(revision ? { revision } : {}) });
}

function targetSearchResult(
  request: KnowledgeHealthTargetSearchRequest,
  status: "stale" | "not_found" | "failed"
): KnowledgeHealthTargetSearchResult {
  return KnowledgeHealthTargetSearchResultSchema.parse({ ...request, status });
}

function orphanParentSearchResult(
  request: KnowledgeHealthOrphanParentSearchRequest,
  status: "stale" | "not_found" | "failed"
): KnowledgeHealthOrphanParentSearchResult {
  return KnowledgeHealthOrphanParentSearchResultSchema.parse({ ...request, status });
}

function orphanRepairResult(
  request: KnowledgeHealthOrphanRepairRequest,
  status: "stale" | "not_found" | "ineligible" | "failed"
): KnowledgeHealthOrphanRepairResult {
  return KnowledgeHealthOrphanRepairResultSchema.parse({ ...request, status });
}

function unavailable(request: KnowledgeHealthRunRequest): KnowledgeHealthRunResult {
  return KnowledgeHealthRunResultSchema.parse({ ...request, status: "unavailable" });
}

function failed(request: KnowledgeHealthRunRequest): KnowledgeHealthRunResult {
  return KnowledgeHealthRunResultSchema.parse({ ...request, status: "failed" });
}

function utf8ByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
