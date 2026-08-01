import { createHash } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  createPigeTagKey,
  extractPigeMarkdownCitationRefs,
  extractPigeMarkdownLinkRefs
} from "@pige/markdown";
import {
  createAmbiguityAwarePageLookup,
  normalizeLocalReference
} from "./local-database-knowledge-health";
import type { MarkdownPageRecord } from "./markdown-page-index";
import { readCurrentSourceRecordSnapshot } from "./source-file-access";

export const KNOWLEDGE_RELATION_SOURCE_MIGRATION_ID = "004_knowledge_relation_sources";

export type DurableKnowledgeRelationType =
  | "has_topic" | "links_to" | "cites_source" | "derived_from" | "mentions_entity"
  | "related_to" | "contradicts" | "answers" | "broader_than";

export interface KnowledgeTreeEntityInput {
  readonly entityId: string;
  readonly pageId?: string;
  readonly name: string;
}

export function migrateKnowledgeRelationIndex(db: DatabaseSync): void {
  if (db.prepare("SELECT id FROM schema_migrations WHERE id = ?").all(KNOWLEDGE_RELATION_SOURCE_MIGRATION_ID).length) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    const columns = db.prepare("PRAGMA table_info(relation_edges)").all();
    if (!columns.some((column) => column.name === "to_source_id")) {
      db.exec("ALTER TABLE relation_edges ADD COLUMN to_source_id TEXT");
    }
    db.prepare("INSERT INTO schema_migrations(id, applied_at) VALUES (?, ?)")
      .run(KNOWLEDGE_RELATION_SOURCE_MIGRATION_ID, new Date().toISOString());
    db.exec("COMMIT");
  } catch (caught) {
    db.exec("ROLLBACK");
    throw caught;
  }
}

export function indexPageDurableBodyRelations(
  db: DatabaseSync,
  vaultPath: string,
  page: MarkdownPageRecord,
  markdown: string,
  resolvePageId: (target: string) => string | undefined
): void {
  const insertSource = db.prepare(`
    INSERT INTO sources(source_id, page_id, display_name, canonical_url, checksum, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      page_id = excluded.page_id, display_name = excluded.display_name,
      canonical_url = excluded.canonical_url, checksum = excluded.checksum,
      created_at = excluded.created_at, updated_at = excluded.updated_at
  `);
  const insertCitation = db.prepare(`
    INSERT OR IGNORE INTO citations(citation_id, page_id, source_id, locator) VALUES (?, ?, ?, ?)
  `);
  const insertSourceRelation = db.prepare(`
    INSERT OR IGNORE INTO relation_edges(
      edge_id, from_page_id, to_page_id, to_source_id, relation_type, evidence_json
    ) VALUES (?, ?, NULL, ?, ?, ?)
  `);
  const insertPageRelation = db.prepare(`
    INSERT OR IGNORE INTO relation_edges(edge_id, from_page_id, to_page_id, relation_type, evidence_json)
    VALUES (?, ?, ?, 'related_to', ?)
  `);
  const citations = extractPigeMarkdownCitationRefs(markdown);
  const sourceIds = new Set([...page.summary.sourceIds, ...citations.map((citation) => citation.sourceId)]);
  const validSources = new Set<string>();
  for (const sourceId of sourceIds) {
    const source = readCurrentSourceRecordSnapshot(vaultPath, sourceId)?.record;
    if (!source) continue;
    validSources.add(sourceId);
    insertSource.run(
      sourceId,
      source.knowledgePageId ?? null,
      source.original?.displayName ?? null,
      source.kind === "url" ? source.original?.uri ?? null : null,
      source.managedCopy?.checksum ?? source.original?.checksum ?? null,
      source.createdAt,
      source.updatedAt
    );
    if (page.summary.sourceIds.includes(sourceId)) {
      insertSourceEdge(insertSourceRelation, "derived_from", page.summary.pageId, sourceId, {
        source: "frontmatter", field: "source_ids", target: sourceId
      });
    }
  }
  for (const citation of citations) {
    if (!validSources.has(citation.sourceId)) continue;
    const locator = citation.locator ?? null;
    insertCitation.run(
      `citation_${stableHash(`${page.summary.pageId}:${citation.sourceId}:${locator ?? ""}`).slice(0, 24)}`,
      page.summary.pageId,
      citation.sourceId,
      locator
    );
    insertSourceEdge(insertSourceRelation, "cites_source", page.summary.pageId, citation.sourceId, {
      source: "citation", target: citation.sourceId, ...(citation.locator ? { locator: citation.locator } : {})
    });
  }
  for (const link of extractManagedRelatedLinks(markdown)) {
    const targetPageId = resolvePageId(link.target);
    if (!targetPageId || targetPageId === page.summary.pageId) continue;
    insertPageRelation.run(
      `edge_${stableHash(`related_to:${page.summary.pageId}:${targetPageId}:managed:${link.target}`).slice(0, 24)}`,
      page.summary.pageId,
      targetPageId,
      JSON.stringify([{ source: "managed_section", target: link.target, label: link.label }])
    );
  }
}

export function indexPageKnowledgeRelations(db: DatabaseSync, pages: readonly MarkdownPageRecord[]): void {
  const pageById = new Map(pages.map((page) => [page.summary.pageId, page]));
  const lookup = createAmbiguityAwarePageLookup(pages);
  const insertTag = db.prepare("INSERT OR IGNORE INTO tags(tag) VALUES (?)");
  const insertPageTag = db.prepare("INSERT OR IGNORE INTO page_tags(page_id, tag) VALUES (?, ?)");
  const insertTopic = db.prepare("INSERT OR REPLACE INTO topics(topic_id, page_id, title) VALUES (?, ?, ?)");
  const insertEntity = db.prepare(`
    INSERT OR REPLACE INTO entities(entity_id, page_id, name, aliases_json) VALUES (?, ?, ?, ?)
  `);
  const insertMentionedEntity = db.prepare(`
    INSERT OR IGNORE INTO entities(entity_id, page_id, name, aliases_json) VALUES (?, ?, ?, ?)
  `);
  const insertRelation = db.prepare(`
    INSERT OR IGNORE INTO relation_edges(edge_id, from_page_id, to_page_id, relation_type, evidence_json)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const page of pages) {
    for (const tag of page.knowledge.tags) {
      const key = createPigeTagKey(tag);
      if (!key) continue;
      insertTag.run(key);
      insertPageTag.run(page.summary.pageId, key);
    }
    if (page.summary.pageType === "topic") {
      insertTopic.run(page.summary.pageId, page.summary.pageId, page.summary.title);
    }
    if (page.summary.pageType === "entity") {
      insertEntity.run(
        page.summary.pageId,
        page.summary.pageId,
        page.summary.title,
        JSON.stringify(page.knowledge.aliases)
      );
    }
  }

  for (const page of pages) {
    for (const topicRef of page.knowledge.topics) {
      const target = resolvePage(topicRef, lookup, pageById);
      if (!target || target.summary.pageType !== "topic" || target.summary.pageId === page.summary.pageId) continue;
      insertEdge(insertRelation, "has_topic", page.summary.pageId, target.summary.pageId, "topics", topicRef);
    }
    for (const entityRef of page.knowledge.entities) {
      const resolved = resolvePage(entityRef, lookup, pageById);
      const target = resolved?.summary.pageType === "entity" ? resolved : undefined;
      const name = target?.summary.title ?? normalizeEntityName(entityRef);
      if (!name || target?.summary.pageId === page.summary.pageId) continue;
      const entityId = target?.summary.pageId ?? createSyntheticEntityId(name);
      insertMentionedEntity.run(entityId, target?.summary.pageId ?? null, name, JSON.stringify(target?.knowledge.aliases ?? []));
      insertEdge(insertRelation, "mentions_entity", page.summary.pageId, entityId, "entities", entityRef);
    }
    for (const pageRef of page.knowledge.relatedPageIds) {
      const target = resolvePage(pageRef, lookup, pageById);
      if (!target || target.summary.pageId === page.summary.pageId) continue;
      insertEdge(insertRelation, "related_to", page.summary.pageId, target.summary.pageId, "related_page_ids", pageRef);
    }
    if (page.summary.pageType === "claim" && isActiveSourced(page)) {
      for (const pageId of page.knowledge.claimContradicts) {
        const target = pageById.get(pageId);
        if (!target || target.summary.pageType !== "claim" || !isActiveSourced(target) || pageId === page.summary.pageId) continue;
        insertEdge(insertRelation, "contradicts", page.summary.pageId, pageId, "claim.contradicts", pageId);
      }
    }
    if (page.summary.pageType === "question" && page.summary.status === "active") {
      for (const pageId of page.knowledge.questionAnswers) {
        const target = pageById.get(pageId);
        if (!target || !isActiveSourced(target) || !["note", "claim"].includes(target.summary.pageType) || pageId === page.summary.pageId) continue;
        insertEdge(insertRelation, "answers", page.summary.pageId, pageId, "question.answered_by", pageId);
      }
    }
    if (page.summary.pageType === "concept" && page.summary.status === "active") {
      for (const pageId of page.knowledge.conceptParents) {
        const target = pageById.get(pageId);
        if (!target || target.summary.pageType !== "concept" || target.summary.status !== "active" ||
            pageId === page.summary.pageId) continue;
        insertEdge(insertRelation, "broader_than", page.summary.pageId, pageId, "concept.parent_concepts", pageId);
      }
    }
  }
}

function isActiveSourced(page: MarkdownPageRecord): boolean {
  return page.summary.status === "active" && page.summary.sourceIds.length > 0;
}

export function createSyntheticEntityId(name: string): string {
  return `entity_${stableHash((normalizeEntityName(name) ?? name).toLocaleLowerCase("en-US")).slice(0, 24)}`;
}

function resolvePage(
  value: string,
  lookup: ReadonlyMap<string, string | null>,
  pageById: ReadonlyMap<string, MarkdownPageRecord>
): MarkdownPageRecord | undefined {
  const id = lookup.get(normalizeLocalReference(value));
  return id ? pageById.get(id) : undefined;
}

function normalizeEntityName(value: string): string | undefined {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return normalized && normalized.length <= 256 ? normalized : undefined;
}

function insertEdge(
  statement: { run(...params: SQLInputValue[]): unknown },
  relationType: Exclude<DurableKnowledgeRelationType, "links_to">,
  fromPageId: string,
  toId: string,
  field: string,
  target: string
): void {
  statement.run(
    `edge_${stableHash(`${relationType}:${fromPageId}:${toId}:${target}`).slice(0, 24)}`,
    fromPageId,
    toId,
    relationType,
    JSON.stringify([{ source: "frontmatter", field, target }])
  );
}

function insertSourceEdge(
  statement: { run(...params: SQLInputValue[]): unknown },
  relationType: "cites_source" | "derived_from",
  fromPageId: string,
  toSourceId: string,
  evidence: Readonly<Record<string, string>>
): void {
  statement.run(
    `edge_${stableHash(`${relationType}:${fromPageId}:${toSourceId}:${JSON.stringify(evidence)}`).slice(0, 24)}`,
    fromPageId,
    toSourceId,
    relationType,
    JSON.stringify([evidence])
  );
}

function extractManagedRelatedLinks(markdown: string): ReturnType<typeof extractPigeMarkdownLinkRefs> {
  const blocks: string[] = [];
  let active: string[] | undefined;
  for (const line of markdown.split(/\r?\n/u)) {
    const trimmed = line.trim();
    const startsRelated =
      /^<!-- pige:managed:start agent-link [^\r\n]+ -->$/u.test(trimmed) ||
      /^<!-- pige:managed section="related" [^\r\n]*-->$/u.test(trimmed);
    if (startsRelated) {
      if (active) return [];
      active = [];
      continue;
    }
    if (trimmed === "<!-- pige:managed:end -->" || trimmed === "<!-- /pige:managed -->") {
      if (active) blocks.push(active.join("\n"));
      active = undefined;
      continue;
    }
    active?.push(line);
  }
  if (active) return [];
  return blocks.flatMap((block) => [...extractPigeMarkdownLinkRefs(block)]);
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
