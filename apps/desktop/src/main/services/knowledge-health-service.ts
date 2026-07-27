import { createHash, randomUUID } from "node:crypto";
import type {
  KnowledgeHealthIssueSummary,
  KnowledgeHealthRepairRequest,
  KnowledgeHealthRepairResult,
  KnowledgeHealthRunRequest,
  KnowledgeHealthRunResult
} from "@pige/contracts";
import { extractPigeMarkdownLinkRefs, parsePigeFrontmatter } from "@pige/markdown";
import {
  KNOWLEDGE_HEALTH_MAX_RESULT_UTF8_BYTES,
  KnowledgeHealthRepairResultSchema,
  KnowledgeHealthRunResultSchema
} from "@pige/schemas";
import type { LocalDatabaseKnowledgeHealthSnapshot } from "./local-database-knowledge-health";
import type { NoteMarkdownEditorService } from "./note-markdown-editor-service";

const MAX_REPAIR_CONTEXTS = 64;

interface KnowledgeHealthDatabasePort {
  readonly knowledgeHealth: (vaultPath: string) => LocalDatabaseKnowledgeHealthSnapshot | undefined;
}

interface RepairContext {
  readonly activeVaultId: string;
  readonly indexGeneration: string;
  readonly pageId: string;
  readonly revisionId: string;
  readonly renderIdentity: string;
  readonly target: string;
  readonly start: number;
  readonly end: number;
  readonly source: string;
  readonly replacement: string;
}

interface EligibleUnlink {
  readonly start: number;
  readonly end: number;
  readonly source: string;
  readonly replacement: string;
}

export class KnowledgeHealthService {
  readonly #database: KnowledgeHealthDatabasePort;
  readonly #now: () => string;
  readonly #editor: Pick<NoteMarkdownEditorService, "open" | "save"> | undefined;
  readonly #randomId: () => string;
  readonly #repairContexts = new Map<string, RepairContext>();
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

  repair(vaultPath: string, request: KnowledgeHealthRepairRequest): KnowledgeHealthRepairResult {
    const context = this.#repairContexts.get(request.repairContextId);
    if (!context) return repairResult(request, "not_found");
    if (
      context.activeVaultId !== request.activeVaultId ||
      context.indexGeneration !== request.indexGeneration ||
      context.pageId !== request.pageId
    ) return repairResult(request, "ineligible");
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
      if (!snapshot || snapshot.invalidPageCount !== 0 || snapshot.indexGeneration !== request.indexGeneration) {
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
      const unlink = findEligibleUnlink(opened.markdown, target);
      if (!unlink || !sameUnlink(unlink, context)) return repairResult(request, "ineligible");
      const markdown = replaceOccurrence(opened.markdown, unlink);
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
      const unlink = findEligibleUnlink(opened.markdown, target);
      if (!unlink) {
        projected.push(issue);
        continue;
      }
      const repairContextId = this.#createRepairContextId();
      this.#repairContexts.set(repairContextId, {
        activeVaultId: request.activeVaultId,
        indexGeneration: snapshot.indexGeneration,
        pageId: issue.page.pageId,
        revisionId: opened.revisionId,
        renderIdentity: opened.renderIdentity,
        target,
        ...unlink
      });
      projected.push({ ...issue, repairContextId });
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

function findEligibleUnlink(markdown: string, expectedTarget: string): EligibleUnlink | undefined {
  const parsedRefs = extractPigeMarkdownLinkRefs(markdown)
    .filter((reference) => reference.target === expectedTarget);
  if (parsedRefs.length !== 1) return undefined;
  const bodyStart = parsePigeFrontmatter(markdown)?.bodyStartOffset ?? 0;
  const searchable = maskCode(markdown.slice(bodyStart));
  const matches: EligibleUnlink[] = [];
  for (const match of searchable.matchAll(/(?<!!)\[\[([^\]\n]+)\]\]/gu)) {
    const source = match[0];
    const parts = (match[1] ?? "").split("|");
    if (parts.length > 2) continue;
    const target = normalizeInline(parts[0] ?? "");
    const label = parts.length === 2 ? normalizePlainLabel(parts[1] ?? "") : target;
    if (!target || !label || target !== expectedTarget) continue;
    const start = bodyStart + (match.index ?? 0);
    matches.push({ start, end: start + source.length, source, replacement: label });
  }
  for (const match of searchable.matchAll(/(?<!!)\[([^\]\n]+)\]\(([^)\s]+)\)/gu)) {
    const source = match[0];
    const label = normalizePlainLabel(match[1] ?? "");
    const target = normalizeLocalMarkdownTarget(match[2] ?? "");
    if (!label || !target || target !== expectedTarget) continue;
    const start = bodyStart + (match.index ?? 0);
    matches.push({ start, end: start + source.length, source, replacement: label });
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

function replaceOccurrence(markdown: string, unlink: EligibleUnlink): string {
  if (markdown.slice(unlink.start, unlink.end) !== unlink.source) {
    throw new Error("The Knowledge Health repair occurrence changed.");
  }
  return markdown.slice(0, unlink.start) + unlink.replacement + markdown.slice(unlink.end);
}

function sameUnlink(unlink: EligibleUnlink, context: RepairContext): boolean {
  return unlink.start === context.start && unlink.end === context.end &&
    unlink.source === context.source && unlink.replacement === context.replacement;
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

function unavailable(request: KnowledgeHealthRunRequest): KnowledgeHealthRunResult {
  return KnowledgeHealthRunResultSchema.parse({ ...request, status: "unavailable" });
}

function failed(request: KnowledgeHealthRunRequest): KnowledgeHealthRunResult {
  return KnowledgeHealthRunResultSchema.parse({ ...request, status: "failed" });
}

function utf8ByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
