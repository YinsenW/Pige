import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  KnowledgeHealthCounts,
  KnowledgeHealthIssueSummary,
  KnowledgeHealthPageRef
} from "@pige/contracts";
import type { PigeMarkdownLinkRef } from "@pige/markdown";
import {
  KNOWLEDGE_HEALTH_MAX_DUPLICATE_TOPIC_PAGES,
  KNOWLEDGE_HEALTH_MAX_ISSUE_SUMMARIES
} from "@pige/schemas";
import type { MarkdownPageRecord } from "./markdown-page-index";

export type AmbiguityAwarePageLookup = ReadonlyMap<string, string | null>;

export interface LocalDatabaseKnowledgeHealthSnapshot {
  readonly indexGeneration: string;
  readonly invalidPageCount: number;
  readonly counts: KnowledgeHealthCounts;
  readonly issues: readonly KnowledgeHealthIssueSummary[];
  readonly truncated: boolean;
}

export function createAmbiguityAwarePageLookup(
  pages: readonly MarkdownPageRecord[]
): AmbiguityAwarePageLookup {
  const pageIdsByKey = new Map<string, Set<string>>();
  for (const page of pages) {
    const keys = [
      page.summary.pageId,
      page.summary.title,
      ...page.knowledge.aliases,
      page.summary.pagePath,
      page.summary.pagePath.replace(/\.md$/iu, ""),
      path.basename(page.summary.pagePath),
      path.basename(page.summary.pagePath).replace(/\.md$/iu, "")
    ];
    for (const key of keys) {
      const normalized = normalizeLocalReference(key);
      if (!normalized) continue;
      const pageIds = pageIdsByKey.get(normalized) ?? new Set<string>();
      pageIds.add(page.summary.pageId);
      pageIdsByKey.set(normalized, pageIds);
    }
  }
  return new Map([...pageIdsByKey].map(([key, pageIds]) => [
    key,
    pageIds.size === 1 ? [...pageIds][0]! : null
  ]));
}

export function resolveAmbiguityAwareLinkedPageId(
  lookup: AmbiguityAwarePageLookup,
  fromPagePath: string,
  link: PigeMarkdownLinkRef
): string | null {
  for (const target of createLinkTargetCandidates(fromPagePath, link)) {
    const pageId = lookup.get(normalizeLocalReference(target));
    if (pageId) return pageId;
  }
  return null;
}

export function normalizeLocalReference(value: string): string {
  const withoutAnchor = value.split("#", 1)[0] ?? value;
  return withoutAnchor
    .replace(/\\/gu, "/")
    .replace(/^\.?\//u, "")
    .replace(/\.md$/iu, "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ")
    .trim();
}

export function readKnowledgeHealthSnapshot(
  db: DatabaseSync
): LocalDatabaseKnowledgeHealthSnapshot | undefined {
  const state = db.prepare(
    "SELECT invalid_page_count, rebuilt_at FROM index_state WHERE id = 1"
  ).get();
  const indexGeneration = typeof state?.rebuilt_at === "string" ? state.rebuilt_at : undefined;
  if (!indexGeneration) return undefined;
  const invalidPageCount = toNonnegativeInteger(state?.invalid_page_count);

  const brokenRows = db.prepare(`
    SELECT p.page_id, p.title, COUNT(*) AS unresolved_count
    FROM links l
    JOIN pages p ON p.page_id = l.from_page_id
    WHERE l.to_page_id IS NULL AND p.status = 'active' AND p.page_type <> 'source'
      AND p.page_path LIKE 'wiki/%'
    GROUP BY p.page_id, p.title
    ORDER BY p.page_id ASC
  `).all();
  const orphanRows = db.prepare(`
    SELECT p.page_id, p.title
    FROM pages p
    WHERE p.status = 'active' AND p.page_type <> 'source' AND p.page_path LIKE 'wiki/%'
      AND NOT EXISTS (
        SELECT 1 FROM backlinks b
        JOIN pages origin ON origin.page_id = b.from_page_id
        WHERE b.to_page_id = p.page_id AND b.from_page_id <> p.page_id
          AND origin.status = 'active' AND origin.page_type <> 'source'
          AND origin.page_path LIKE 'wiki/%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM relation_edges e
        JOIN pages origin ON origin.page_id = e.from_page_id
        WHERE e.to_page_id = p.page_id AND e.from_page_id <> p.page_id
          AND e.relation_type = 'has_topic'
          AND origin.status = 'active' AND origin.page_type <> 'source'
          AND origin.page_path LIKE 'wiki/%'
      )
    ORDER BY p.page_id ASC
  `).all();
  const topicReferenceRows = db.prepare(`
    SELECT r.normalized_key, p.page_id, p.title
    FROM page_reference_keys r
    JOIN pages p ON p.page_id = r.page_id
    WHERE p.status = 'active' AND p.page_type = 'topic' AND p.page_path LIKE 'wiki/%'
      AND r.key_kind IN ('title', 'alias')
    ORDER BY r.normalized_key ASC, p.page_id ASC
  `).all();
  const claimRows = db.prepare(`
    SELECT page_id, title, source_ids_json
    FROM pages
    WHERE status = 'active' AND page_type = 'claim' AND page_path LIKE 'wiki/%'
    ORDER BY page_id ASC
  `).all();

  const brokenIssues: KnowledgeHealthIssueSummary[] = brokenRows.map((row) => ({
    kind: "broken_link",
    page: rowToPageRef(row),
    unresolvedLinkCount: toPositiveInteger(row.unresolved_count)
  }));
  const orphanIssues: KnowledgeHealthIssueSummary[] = orphanRows.map((row) => ({
    kind: "orphan_page",
    page: rowToPageRef(row)
  }));
  const duplicateIssues = createDuplicateTopicIssues(topicReferenceRows);
  const unsourcedIssues: KnowledgeHealthIssueSummary[] = claimRows
    .filter((row) => readSourceIds(row.source_ids_json).length === 0)
    .map((row) => ({ kind: "unsourced_claim", page: rowToPageRef(row) }));
  const allIssues = [...brokenIssues, ...orphanIssues, ...duplicateIssues, ...unsourcedIssues];
  const issues = allIssues.slice(0, KNOWLEDGE_HEALTH_MAX_ISSUE_SUMMARIES);
  const counts = {
    totalIssueCount: brokenIssues.length + orphanIssues.length + duplicateIssues.length + unsourcedIssues.length,
    brokenLinkPageCount: brokenIssues.length,
    unresolvedLinkCount: brokenIssues.reduce((total, issue) =>
      total + (issue.kind === "broken_link" ? issue.unresolvedLinkCount : 0), 0),
    orphanPageCount: orphanIssues.length,
    duplicateTopicGroupCount: duplicateIssues.length,
    unsourcedClaimCount: unsourcedIssues.length
  } satisfies KnowledgeHealthCounts;

  return {
    indexGeneration,
    invalidPageCount,
    counts,
    issues,
    truncated: counts.totalIssueCount > issues.length || duplicateIssues.some((issue) =>
      issue.kind === "duplicate_topic" && issue.candidatePageCount > issue.pages.length
    )
  };
}

export function readKnowledgeHealthIndexGeneration(db: DatabaseSync): string | undefined {
  const state = db.prepare("SELECT rebuilt_at FROM index_state WHERE id = 1").get();
  return typeof state?.rebuilt_at === "string" ? state.rebuilt_at : undefined;
}

function createLinkTargetCandidates(
  fromPagePath: string,
  link: PigeMarkdownLinkRef
): readonly string[] {
  const candidates = new Set<string>([link.target]);
  if (link.kind === "markdown_link") {
    const targetPath = link.target.split("#", 1)[0]?.replace(/\\/gu, "/") ?? "";
    if (targetPath.endsWith(".md")) {
      const fromDirectory = path.posix.dirname(fromPagePath.replace(/\\/gu, "/"));
      candidates.add(path.posix.normalize(path.posix.join(fromDirectory, targetPath)));
    }
  }
  return [...candidates];
}

function createDuplicateTopicIssues(
  rows: readonly Record<string, unknown>[]
): readonly KnowledgeHealthIssueSummary[] {
  const pagesByKey = new Map<string, Map<string, KnowledgeHealthPageRef>>();
  for (const row of rows) {
    const key = String(row.normalized_key);
    const pages = pagesByKey.get(key) ?? new Map<string, KnowledgeHealthPageRef>();
    const page = rowToPageRef(row);
    pages.set(page.pageId, page);
    pagesByKey.set(key, pages);
  }
  const groups = new Map<string, readonly KnowledgeHealthPageRef[]>();
  for (const pages of pagesByKey.values()) {
    const ordered = [...pages.values()].sort((left, right) => compareStrings(left.pageId, right.pageId));
    if (ordered.length < 2) continue;
    groups.set(ordered.map(({ pageId }) => pageId).join(":"), ordered);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([, pages]) => ({
      kind: "duplicate_topic" as const,
      candidatePageCount: pages.length,
      pages: pages.slice(0, KNOWLEDGE_HEALTH_MAX_DUPLICATE_TOPIC_PAGES)
    }));
}

function rowToPageRef(row: Record<string, unknown>): KnowledgeHealthPageRef {
  const pageId = String(row.page_id);
  const title = String(row.title);
  if (!pageId || !title) throw new Error("Knowledge Health indexed page identity is invalid.");
  return { pageId, title };
}

function readSourceIds(value: unknown): readonly string[] {
  if (typeof value !== "string") throw new Error("Knowledge Health source identity is invalid.");
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((sourceId) => typeof sourceId !== "string")) {
    throw new Error("Knowledge Health source identity is invalid.");
  }
  return parsed;
}

function toNonnegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Knowledge Health index count is invalid.");
  }
  return value;
}

function toPositiveInteger(value: unknown): number {
  const integer = toNonnegativeInteger(value);
  if (integer < 1) throw new Error("Knowledge Health unresolved-link count is invalid.");
  return integer;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
