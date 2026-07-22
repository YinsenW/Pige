import { createHash } from "node:crypto";
import type {
  LibraryPageSummary,
  RetrievalAnswerCitation,
  RetrievalAnswerWarning,
  RetrievalAskResult,
  RetrievalSearchRequest,
  RetrievalSearchResult,
  RetrievalSearchResultItem,
  RetrievalSearchScope,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { RetrievalSearchResultItemSchema, type MarkdownPageType } from "@pige/schemas";
import type { LocalDatabaseService } from "./local-database-service";
import {
  MARKDOWN_FRONTMATTER_READ_LIMIT_BYTES,
  readMarkdownPageBodyAtSignature,
  scanMarkdownPages
} from "./markdown-page-index";
import {
  countOccurrences,
  createQueryTerms,
  createSnippet,
  normalizeSearchText,
  sanitizeSearchBody,
  type QueryTerms
} from "./search-text-utils";

export interface RetrievalVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

interface ScoredMatch {
  readonly summary: LibraryPageSummary;
  readonly score: number;
  readonly snippets: readonly string[];
  readonly matchReasons: readonly string[];
}

interface ActiveVaultBinding {
  readonly vaultId: string;
  readonly vaultPath: string;
}

const DEFAULT_SEARCH_LIMIT = 8;
const MAX_SEARCH_LIMIT = 20;
const MAX_BODY_CHARS_FOR_SCAN = 120_000;
const MAX_BODY_BYTES_FOR_SCAN = MARKDOWN_FRONTMATTER_READ_LIMIT_BYTES + (MAX_BODY_CHARS_FOR_SCAN * 4);
const MAX_HOME_EVIDENCE = 8;

export interface HomeQueryEvidenceRef {
  readonly refId: string;
  readonly kind: "markdown_page" | "source_page";
  readonly pageId: string;
  readonly locator: string;
  readonly citationRefs: readonly string[];
  readonly score: number;
  readonly budgetTokens: number;
  readonly trust: "vault_knowledge" | "untrusted_source";
}

export interface HomeQueryContextPack {
  readonly schemaVersion: 1;
  readonly contextPackId: string;
  readonly workflow: "query";
  readonly budgetClass: "home_query";
  readonly retrievalScope: { readonly kind: "vault"; readonly vaultId: string };
  readonly indexHealth: {
    readonly mode: RetrievalSearchResult["mode"];
    readonly degraded: boolean;
    readonly degradedReason?: RetrievalSearchResult["degradedReason"];
    readonly invalidPageCount: number;
  };
  readonly evidenceRefs: readonly HomeQueryEvidenceRef[];
  readonly omitted: readonly { readonly reason: "evidence_limit"; readonly count: number }[];
  readonly warnings: readonly RetrievalAnswerWarning[];
}

interface SelectedHomeEvidence {
  readonly item: RetrievalSearchResultItem;
  readonly citation: RetrievalAnswerCitation;
}

export interface BuiltHomeQueryContext {
  readonly pack: HomeQueryContextPack;
  readonly selectedEvidence: readonly SelectedHomeEvidence[];
}

export class RetrievalService {
  readonly #vaults: RetrievalVaultPort;
  readonly #database: LocalDatabaseService | undefined;

  constructor(vaults: RetrievalVaultPort, database?: LocalDatabaseService) {
    this.#vaults = vaults;
    this.#database = database;
  }

  search(request: RetrievalSearchRequest): RetrievalSearchResult {
    const binding = this.#captureActiveVaultBinding(request.scope);

    const query = request.query.trim();
    if (!query) {
      throw new PigeDomainError("retrieval_empty", "Search query cannot be empty.");
    }
    if (Array.from(query).length > 320) {
      throw new PigeDomainError("retrieval_query_too_long", "Search query exceeds the local retrieval bound.");
    }

    const terms = createQueryTerms(query);
    const pageTypes = new Set<MarkdownPageType>(request.pageTypes ?? []);
    const limit = clampLimit(request.limit);
    const indexed = this.#database?.searchPages(binding.vaultPath, { ...request, query, limit });
    if (indexed) {
      const projected = projectSearchItems(indexed.results);
      const result: RetrievalSearchResult = {
        searchedAt: new Date().toISOString(),
        activeVaultId: binding.vaultId,
        query,
        mode: "lexical_sqlite_fts",
        total: indexed.total,
        invalidPageCount: indexed.invalidPageCount + projected.invalidCount,
        degraded: false,
        results: projected.items
      };
      this.#assertActiveVaultBinding(request.scope, binding);
      return result;
    }

    const scanned = scanMarkdownPages(binding.vaultPath);
    const signatures = new Map(scanned.files.map((file) => [file.absolutePath, file]));
    const matches: ScoredMatch[] = [];
    let invalidPageCount = scanned.invalidPageCount;
    for (const page of scanned.pages) {
      if (pageTypes.size > 0 && !pageTypes.has(page.summary.pageType)) continue;
      const signature = signatures.get(page.absolutePath);
      if (!signature) {
        invalidPageCount += 1;
        continue;
      }
      try {
        const body = sanitizeSearchBody(
          readMarkdownPageBodyAtSignature(binding.vaultPath, signature, MAX_BODY_BYTES_FOR_SCAN)
        ).slice(0, MAX_BODY_CHARS_FOR_SCAN);
        const match = scorePage(page.summary, body, terms);
        if (!match) continue;
        const projected = RetrievalSearchResultItemSchema.safeParse(match);
        if (projected.success) matches.push(match);
        else invalidPageCount += 1;
      } catch {
        invalidPageCount += 1;
      }
    }
    matches.sort(compareMatches);

    const result: RetrievalSearchResult = {
      searchedAt: new Date().toISOString(),
      activeVaultId: binding.vaultId,
      query,
      mode: "lexical_markdown_scan",
      total: matches.length,
      invalidPageCount,
      degraded: true,
      degradedReason: "local_database_not_ready",
      results: matches.slice(0, limit)
    };
    this.#assertActiveVaultBinding(request.scope, binding);
    return result;
  }

  #captureActiveVaultBinding(scope: RetrievalSearchScope): ActiveVaultBinding {
    const activeVault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!activeVault || !vaultPath) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }
    const binding = { vaultId: activeVault.vaultId, vaultPath };
    this.#assertActiveVaultBinding(scope, binding);
    return binding;
  }

  #assertActiveVaultBinding(scope: RetrievalSearchScope, binding: ActiveVaultBinding): void {
    const activeVault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (
      scope.kind !== "active_vault" ||
      scope.vaultId !== binding.vaultId ||
      activeVault?.vaultId !== binding.vaultId ||
      vaultPath !== binding.vaultPath
    ) {
      throw new PigeDomainError(
        "vault.binding_changed",
        "The active vault binding changed during local search."
      );
    }
  }
}

function projectSearchItems(items: readonly RetrievalSearchResultItem[]): {
  readonly items: readonly RetrievalSearchResultItem[];
  readonly invalidCount: number;
} {
  const projected: RetrievalSearchResultItem[] = [];
  let invalidCount = 0;
  for (const item of items) {
    const parsed = RetrievalSearchResultItemSchema.safeParse(item);
    if (parsed.success) projected.push(parsed.data);
    else invalidCount += 1;
  }
  return { items: projected, invalidCount };
}

export function buildHomeQueryContextPack(result: RetrievalSearchResult): BuiltHomeQueryContext {
  const selected = result.results.slice(0, MAX_HOME_EVIDENCE).map((item, index): SelectedHomeEvidence => {
    const citationNumber = index + 1;
    return {
      item,
      citation: {
        refId: `citation_${citationNumber}`,
        label: `[${citationNumber}]`,
        pageId: item.summary.pageId,
        title: item.summary.title,
        pageType: item.summary.pageType,
        locator: "snippet:1"
      }
    };
  });
  const omittedCount = Math.max(0, result.total - selected.length);
  const warnings = createAnswerWarnings(result, selected.length === 0 ? "insufficient" : selected.length === 1 ? "limited" : "grounded");
  const contextPackSeed = JSON.stringify({
    vaultId: result.activeVaultId,
    query: result.query,
    searchedAt: result.searchedAt,
    pages: selected.map(({ item }) => item.summary.pageId)
  });

  return {
    pack: {
      schemaVersion: 1,
      contextPackId: `context_${createHash("sha256").update(contextPackSeed).digest("hex").slice(0, 16)}`,
      workflow: "query",
      budgetClass: "home_query",
      retrievalScope: { kind: "vault", vaultId: result.activeVaultId },
      indexHealth: {
        mode: result.mode,
        degraded: result.degraded,
        ...(result.degradedReason ? { degradedReason: result.degradedReason } : {}),
        invalidPageCount: result.invalidPageCount
      },
      evidenceRefs: selected.map(({ item, citation }, index) => ({
        refId: `evidence_${index + 1}`,
        kind: item.summary.pageType === "source" ? "source_page" : "markdown_page",
        pageId: item.summary.pageId,
        locator: citation.locator,
        citationRefs: [citation.refId],
        score: item.score,
        budgetTokens: estimateSnippetTokens(item.snippets[0] ?? ""),
        trust: item.summary.pageType === "source" ? "untrusted_source" : "vault_knowledge"
      })),
      omitted: omittedCount > 0 ? [{ reason: "evidence_limit", count: omittedCount }] : [],
      warnings
    },
    selectedEvidence: selected
  };
}

function scorePage(summary: LibraryPageSummary, body: string, query: QueryTerms): ScoredMatch | undefined {
  const titleText = normalizeSearchText(summary.title);
  const pathText = normalizeSearchText(summary.pagePath);
  const bodyText = normalizeSearchText(body);
  let score = 0;
  const reasons = new Set<string>();

  if (titleText.includes(query.normalizedQuery)) {
    score += 18;
    reasons.add("title");
  }
  if (bodyText.includes(query.normalizedQuery)) {
    score += 10;
    reasons.add("body");
  }

  for (const term of query.terms) {
    if (titleText.includes(term)) {
      score += 6;
      reasons.add("title");
    }
    if (pathText.includes(term)) {
      score += 2;
      reasons.add("path");
    }
    const bodyCount = countOccurrences(bodyText, term);
    if (bodyCount > 0) {
      score += Math.min(8, bodyCount);
      reasons.add("body");
    }
  }

  if (summary.pageType === "note" || summary.pageType === "source") {
    score += 0.5;
  }

  if (score <= 0) return undefined;

  return {
    summary,
    score: Number(score.toFixed(3)),
    snippets: [createSnippet(body, query)],
    matchReasons: Array.from(reasons)
  };
}

function compareMatches(left: RetrievalSearchResultItem, right: RetrievalSearchResultItem): number {
  const score = right.score - left.score;
  return score === 0 ? right.summary.updatedAt.localeCompare(left.summary.updatedAt) : score;
}

function clampLimit(limit: number | undefined): number {
  if (!limit) return DEFAULT_SEARCH_LIMIT;
  return Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.floor(limit)));
}

function createAnswerWarnings(
  result: RetrievalSearchResult,
  confidence: RetrievalAskResult["confidence"]
): readonly RetrievalAnswerWarning[] {
  const warnings = new Set<RetrievalAnswerWarning>(["local_extractive_only"]);
  if (confidence === "insufficient") warnings.add("insufficient_evidence");
  if (confidence === "limited") warnings.add("limited_evidence");
  if (result.degraded) warnings.add("search_degraded");
  return Array.from(warnings);
}

function estimateSnippetTokens(snippet: string): number {
  return Math.max(1, Math.ceil(Array.from(snippet).length / 4));
}
