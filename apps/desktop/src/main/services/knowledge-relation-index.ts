import { createHash } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { createPigeTagKey } from "@pige/markdown";
import {
  createAmbiguityAwarePageLookup,
  normalizeLocalReference
} from "./local-database-knowledge-health";
import type { MarkdownPageRecord } from "./markdown-page-index";

export type DurableKnowledgeRelationType = "has_topic" | "links_to" | "mentions_entity" | "related_to";

export interface KnowledgeTreeEntityInput {
  readonly entityId: string;
  readonly pageId?: string;
  readonly name: string;
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
  }
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

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
