import { createHash, randomUUID } from "node:crypto";
import type {
  KnowledgeHealthIssueSummary,
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
  KNOWLEDGE_HEALTH_MAX_RESULT_UTF8_BYTES,
  KNOWLEDGE_HEALTH_MAX_TARGET_CANDIDATES,
  KnowledgeHealthRepairResultSchema,
  KnowledgeHealthRunResultSchema,
  KnowledgeHealthTargetSearchResultSchema
} from "@pige/schemas";
import type { LocalDatabaseKnowledgeHealthSnapshot } from "./local-database-knowledge-health";
import { scanMarkdownPages } from "./markdown-page-index";
import type { NoteMarkdownEditorService } from "./note-markdown-editor-service";

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

export class KnowledgeHealthService {
  readonly #database: KnowledgeHealthDatabasePort;
  readonly #now: () => string;
  readonly #editor: Pick<NoteMarkdownEditorService, "open" | "save"> | undefined;
  readonly #randomId: () => string;
  readonly #repairContexts = new Map<string, RepairContext>();
  readonly #targetContexts = new Map<string, TargetContext>();
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
    this.#reportEpoch += 1;
    try {
      const snapshot = this.#database.knowledgeHealth(vaultPath);
      if (!snapshot) return unavailable(request);
      const issues = snapshot.invalidPageCount === 0
        ? this.#attachRepairContexts(request, snapshot)
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
    request: KnowledgeHealthRunRequest,
    snapshot: LocalDatabaseKnowledgeHealthSnapshot
  ): KnowledgeHealthIssueSummary[] {
    if (!this.#editor) return [...snapshot.issues];
    const projected: KnowledgeHealthIssueSummary[] = [];
    for (const issue of snapshot.issues) {
      if (this.#repairContexts.size >= MAX_REPAIR_CONTEXTS) {
        projected.push(issue);
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
      if (!this.#repairContexts.has(id)) return id;
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

function unavailable(request: KnowledgeHealthRunRequest): KnowledgeHealthRunResult {
  return KnowledgeHealthRunResultSchema.parse({ ...request, status: "unavailable" });
}

function failed(request: KnowledgeHealthRunRequest): KnowledgeHealthRunResult {
  return KnowledgeHealthRunResultSchema.parse({ ...request, status: "failed" });
}

function utf8ByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
