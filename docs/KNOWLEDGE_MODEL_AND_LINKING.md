# Knowledge Model And Linking

Status: Draft baseline
Date: 2026-07-09

## 1. Purpose

This document defines how Pige represents, links, indexes, and visualizes knowledge.

It is the authority for:

- Tags, topics, concepts, entities, claims, and questions.
- Wiki links, backlinks, and source citations.
- Relationship types used by the Agent, the local database, retrieval, and Knowledge Tree.
- Autonomous linking eligibility and exceptional boundaries.
- How graph indexes are rebuilt from Markdown instead of becoming hidden knowledge truth.

The goal is to prevent future AI coding agents from inventing a new taxonomy or graph model during implementation.

## 2. Product Principle

Users should not have to organize before capturing.

Pige may maintain tags, topics, concepts, entities, relationships, backlinks, and graph indexes internally, but the default user experience remains:

1. Drop or type knowledge into Home.
2. Let the Agent file, link, cite, and index it.
3. Retrieve it through Home search, Library, reader context, and Knowledge Tree.

No user-facing workflow should require choosing a folder, tag, topic, relation type, graph edge, or Knowledge Tree branch before capture.

## 3. Source Of Truth

Durable truth:

- Markdown source pages under `sources/`.
- Markdown wiki pages under `wiki/`.
- Human-readable wiki links in Markdown bodies.
- Frontmatter IDs, aliases, tags, topics, entities, source IDs, and related page IDs.
- Source citations and locators in Markdown bodies.
- Operation records, plus exceptional proposals, that explain applied or pending changes.

Rebuildable working state:

- SQLite graph tables.
- Tag/topic/entity joins.
- Backlink indexes.
- Knowledge Tree aggregates.
- Search and retrieval ranking features.
- Tentative inferred relationship candidates.

Rule:

> If `.pige/db/` and `.pige/indexes/` are deleted, Pige must be able to rebuild the knowledge graph from Markdown, source records, artifacts, operation records, and `PIGE.md`.

## 4. Core Knowledge Units

Pige uses page types from `docs/MARKDOWN_SCHEMA.md` and `docs/DOMAIN_MODEL.md`.

| Unit | Durable form | Meaning | User burden |
| --- | --- | --- | --- |
| Source | `sources/**/*.md` plus source record | One captured input or evidence item. | None after capture. |
| Note | `wiki/notes/**/*.md` | Flexible idea, summary, memo, or generated standalone note. | Optional editing. |
| Topic | `wiki/topics/**/*.md` | Broad area that groups notes, concepts, sources, and questions. | Agent-maintained by default. |
| Concept | `wiki/concepts/**/*.md` | Stable explanation of an idea that can grow over time. | Agent-maintained by default. |
| Entity | `wiki/entities/**/*.md` | Person, organization, product, place, project, event, or named object. | Agent-maintained by default. |
| Claim | `wiki/claims/**/*.md` | Evidence-backed assertion, thesis, decision, or hypothesis. | Inspectable evidence and history. |
| Question | `wiki/questions/**/*.md` | Open research question or recurring retrieval intent. | Created when useful. |
| Tag | Frontmatter string plus rebuildable tag index | Lightweight facet for filtering and grouping. | Never required before capture. |
| Relationship | Wiki link, citation, frontmatter field, or managed related section | Typed connection between knowledge units. | Agent-maintained by default. |

## 5. Tags, Topics, Concepts, And Entities

### 5.1 Tags

Tags are lightweight facets, not the main knowledge hierarchy.

Use tags for:

- Source form: `article`, `book`, `paper`, `meeting`, `screenshot`.
- Workflow state: `needs-review`, `draft`, `imported`.
- Reusable content facets: `quote`, `example`, `decision`, `todo`.
- User-specific simple filters that do not deserve a full topic page.

Do not use tags for:

- Broad subject areas that should be topics.
- Named people, companies, products, or places that should be entities.
- Durable ideas that should be concept pages.
- Evidence-backed assertions that should be claim pages.
- Folder-like deep hierarchy.

Rules:

- Tags are readable frontmatter facets, not facts; a page normally needs 0 to 6.
- Current: after inspect/retrieval, Pi supplies one `related_NN`, 1–6 tags, cited reason,
  and high confidence. Host updates one clean active generated note, normalizes/dedupes,
  reuses catalog spelling, allows new tags, and caps 12/page.
- `update_page` recovery/Activity/Undo preserves body; removal/replacement/synonyms remain open.

### 5.2 Topics

Topics are durable grouping pages.

Use topic pages when:

- Multiple notes or sources belong to a broad area.
- The area is useful for Library browsing or Knowledge Tree branching.
- The area may contain concepts, entities, questions, and sources over time.

Examples:

- `Local RAG`
- `AI Note Taking`
- `Writing Workflow`
- `Personal Knowledge Management`

Topic rules:

- A topic can have parent and child topics through relationship edges.
- Topic hierarchy changes can affect many pages and should be conservative.
- Creating a new topic page can be automatic when no close match exists.
- Validated recoverable hierarchy changes apply; otherwise preserve alternatives or stage conflict.

### 5.3 Concepts

Concepts are evergreen knowledge pages.

Use concept pages when:

- The idea needs a stable explanation.
- Multiple sources discuss the same idea.
- Retrieval would benefit from a central synthesized page.

Concept rules:

- A concept page should have aliases for common names and translations.
- Concept pages can have broader, narrower, related, example, and evidence relationships.
- Existing concepts evolve when evidence, user text, base hash, schema, and recovery pass.

### 5.4 Entities

Entities are named things.

Use entity pages for:

- People.
- Organizations.
- Products.
- Projects.
- Places.
- Events.
- Named datasets, tools, models, papers, or standards when they behave like named objects.

Entity rules:

- Entity pages should store canonical name, aliases, and identifiers where known.
- Entity merges require identity, affected-link, base-hash, and recovery proof; otherwise preserve both.
- The Agent must not infer sensitive personal facts without source evidence.

### 5.5 Claims

Claims are evidence-backed assertions.

Use claim pages when:

- A statement is important enough to track over time.
- It may be supported, contradicted, updated, or superseded by later sources.
- The user may want to inspect evidence.

Claim rules:

- Claims require citations unless explicitly marked `needs_review`.
- `supports`, `contradicts`, `supersedes`, and `updates` relationships on claims require source evidence.
- Contradiction/supersession may apply while preserving both claims, citations, and history.

## 6. Relationship Model

Pige uses typed relationships internally, but Markdown remains readable.

### 6.1 Relationship Sources

Relationships can be derived from:

- Body wiki links such as `[[Local RAG]]`.
- Source citations such as `[source:src_20260709_120000_abcd#p3]`.
- Frontmatter fields: `source_ids`, `topics`, `entities`, `related_page_ids`, `aliases`.
- Page-type fields such as `concept.parent_concepts`, `claim.evidence`, and `claim.contradicts`.
- Pige-managed `## Related` or `## Evidence` sections.
- Operation records for renames, merges, and accepted relationship proposals.

Renderer and database code must not treat a SQLite edge as durable truth unless it can be traced back to one of these durable sources.

### 6.2 Relationship Edge Contract

SQLite may normalize relationships into this shape:

```ts
type KnowledgeRelation = {
  id: string;
  fromPageId: string;
  toPageId?: string;
  toSourceId?: string;
  type: KnowledgeRelationType;
  direction: "directed" | "undirected";
  confidence: "low" | "medium" | "high";
  reviewState: "inferred" | "auto_applied" | "confirmed" | "rejected" | "stale";
  evidenceRefs: CitationRef[];
  source: "frontmatter" | "wiki_link" | "citation" | "managed_section" | "operation" | "inference";
  operationId?: string;
  createdAt?: string;
  updatedAt?: string;
};
```

The relation `id` is stable within the rebuilt index only when the durable source is stable. Future sync should reconcile durable Markdown edits and operation records, not database-only relation IDs.

### 6.3 Relationship Types

Required v0.1 relation types:

| Type | Direction | Meaning | Durable source | Auto apply? |
| --- | --- | --- | --- | --- |
| `links_to` | directed | A Markdown wiki link from one page to another. | Body link | Yes |
| `backlink_from` | directed derived | Reverse view of `links_to`. | Rebuilt index | Yes |
| `cites_source` | directed | A page or claim cites a source record or artifact locator. | Citation | Yes |
| `derived_from` | directed | A page was created from a source or artifact. | Frontmatter/source page | Yes |
| `has_topic` | directed | A page belongs to a topic. | Frontmatter/body | Yes, conservative |
| `mentions_entity` | directed | A page mentions an entity. | Frontmatter/body | Yes, conservative |
| `explains_concept` | directed | A page explains or centers on a concept. | Body/frontmatter | Yes for new pages |
| `related_to` | undirected | Weak semantic relation. | Frontmatter/related section | Yes for low-risk suggestions |
| `part_of` | directed | Page or topic is part of a larger topic/project. | Managed section/frontmatter | Yes when recoverable |
| `broader_than` | directed | Topic or concept is broader than another. | Managed section/frontmatter | Yes when recoverable |
| `narrower_than` | directed | Topic or concept is narrower than another. | Managed section/frontmatter | Yes when recoverable |
| `supports` | directed | Evidence supports a claim. | Citation/claim field | Yes when cited |
| `contradicts` | directed | Evidence or claim conflicts with another claim. | Claim field/managed section | Yes; preserve both |
| `updates` | directed | Newer page updates older knowledge. | Operation/managed section | Yes with evidence/history |
| `supersedes` | directed | Newer page supersedes older knowledge. | Operation/managed section | Yes; preserve history |
| `answers` | directed | Page or source answers a question page. | Question field/managed section | Yes with citation |
| `example_of` | directed | Page/source is an example of a concept. | Managed section | Yes |
| `same_as` | undirected | Two entities/concepts are the same subject. | Operation/proposal | Yes if identity is proven |
| `duplicate_of` | directed | Page appears duplicate of another page. | Proposal/operation | Yes if reversible |

Do not add new relation types casually. If a new type matters for implementation, update this document, `docs/MARKDOWN_SCHEMA.md`, `docs/LOCAL_DATABASE_DESIGN.md`, `docs/PROMPT_DESIGN.md`, and `docs/SPEC_TRACEABILITY.md`.

## 7. Markdown Representation

### 7.1 Frontmatter

Frontmatter remains a compact index surface. Its exact fields and validation rules are
owned by [`MARKDOWN_SCHEMA.md`](MARKDOWN_SCHEMA.md#4-common-frontmatter); this model
defines how those fields participate in linking, not a second YAML shape.

Rules:

- `tags` are user-facing facets.
- `topics` and `entities` may contain stable page IDs or canonical names depending on schema maturity, but database indexes must resolve them to page IDs when possible.
- `related_page_ids` stores stable page IDs for important related pages, not every incidental link.
- Large relationship graphs should not bloat frontmatter.

### 7.2 Body Links

Readable durable links may use titles:

```md
[[Local RAG]]
[[Local RAG|local retrieval]]
```

Current slice: after inspect and one retrieval, Pi supplies two distinct `related_NN`
refs, cited reason, and high confidence. Host fixes one directed `links_to` between clean
active generated notes: source adds `related_page_ids` plus a canonical
`#wiki:<encoded-id>` managed link; target stays unchanged. Undo restores source and
rebuild derives/removes backlink. Other link shapes/pages/types remain open.

### 7.3 Citations

Use source citations for factual grounding:

```md
This approach keeps embeddings local. [source:src_20260709_120000_abcd#p3]
```

Rules:

- Citations point to source records or artifact locators.
- Claims and important summaries should cite sources when available.
- Citation-less generated factual content triggers more evidence, a warning, or abstention.

### 7.4 Managed Related Sections

When the Agent maintains relationship suggestions or related pages, prefer a managed block inside a normal Markdown section:

```md
## Related

<!-- pige:managed section="related" version="1" operation="op_20260709_120500_abcd" -->
- [[Local RAG]] - related retrieval architecture.
- [[Qwen3 Embedding]] - embedding model used by the local RAG plan.
<!-- /pige:managed -->
```

Rules:

- Managed related sections should stay short.
- They should explain why a link exists when the reason is not obvious.
- User-written related content outside the managed block must be preserved.

## 8. Autonomous Changes And Exceptional Intervention

### 8.1 Default Autonomous Changes

The Agent auto-applies source/knowledge pages, tags, citations, links, topics, entities,
indexes, and existing-page relationship/metadata changes when evidence, base hash, schema,
provenance, user-text preservation, and recovery pass. Dedup/merge additionally preserves
old bytes, IDs/aliases, affected links, citations, and Undo.

### 8.2 Replan, Preserve, Or Abstain

Low confidence, breadth, or incomplete evidence searches again, narrows, preserves both,
warns, or abstains; it does not ask by default.

### 8.3 Exceptional Intervention

Pause only for:

- Irreversible loss, authority/security escalation, destination drift, destructive vault
  policy, or an explicit stricter user policy.
- Conflict that lossless merge, preserved alternatives, or an additive page cannot reconcile.

## 9. Canonicalization And Deduplication

Before creating a new page, tag, or relationship, the Agent should search:

- Exact title.
- Aliases.
- Slug variants.
- Existing tags.
- Existing topics and concepts.
- Related entity names.
- High-ranking semantic matches.

Deduplication rules:

- Page identity comes from stable ID, not title or path.
- Slugs can change; IDs do not.
- Alias additions are safer than page merges.
- A merge records both pages, aliases, evidence, affected links, and recovery facts.
- If uncertain, preserve both and mark the relationship tentative instead of silently merging.

Multilingual rules:

- Preserve source language.
- Add aliases for common translations when useful.
- Do not create separate duplicate concept pages only because the source language differs.
- Retrieval should resolve aliases across supported languages when indexes allow.

## 10. Knowledge Tree

Knowledge Tree is a semantic exploration surface, not a file tree and not a separate storage system.

It is derived from:

- Topic and concept pages.
- `broader_than`, `narrower_than`, `part_of`, `related_to`, and `has_topic` relationships.
- Source counts and citation density.
- Page counts, chunk counts, and update recency.
- Claim/question density.
- Tentative growth relationships.

Visual model:

- Trunk: top-level knowledge domains or topic clusters.
- Branches: topics, concepts, projects, recurring questions, or entity clusters.
- Leaves: notes, claims, source fragments, examples, snippets, or accepted insights.

Visual encoding:

- Trunk thickness represents total domain weight.
- Branch thickness represents topic/concept weight.
- Leaf count represents fragmented knowledge quantity.
- Leaf size represents local density or importance.
- Leaf color depth represents evidence density, freshness, or confidence.
- Muted or outlined leaves represent `needs_review` or weakly sourced knowledge.

Rules:

- Knowledge Tree should help the user see where knowledge is growing.
- It should not require manual taxonomy management in v0.1.
- Autonomous relationship changes appear in compact Activity with provenance and Undo.
- Exceptional conflicts may appear as proposals; rejection is recorded to avoid repetition.

## 11. Retrieval And Ranking

Search and retrieval should use the knowledge model as ranking context.

Signals:

- Title, aliases, and slugs.
- Body text and headings.
- Tags, topics, and entities.
- Source citations and source metadata.
- Backlinks and outgoing links.
- Relationship type and confidence.
- Recency and update frequency.
- Page type.
- Current note context for Note Agent queries.

Ranking rules:

- Lexical search must work without embeddings.
- Local vector retrieval improves recall when installed.
- Relationship paths can boost results but should not hide direct text matches.
- Source-backed pages and claims should be preferred for factual queries.
- Orphan pages should remain searchable even if the graph is sparse.
- Query results should explain match reasons in user-friendly language, such as "title match", "cited source", "linked concept", or "same topic".

## 12. Local Database Indexes

SQLite graph tables are rebuildable indexes.

Recommended schema areas:

- `pages`: page ID, path, type, title, aliases, status, language.
- `tags`: canonical tag, display label, language, usage count.
- `page_tags`: page ID to tag.
- `topics`: topic page ID, canonical name, parent topic ID when confirmed.
- `entities`: entity page ID, canonical name, entity type, aliases.
- `relation_edges`: normalized `KnowledgeRelation` rows.
- `citations`: page ID to source ID and locator.
- `aliases`: alias to page ID candidates.
- `backlinks`: rebuilt reverse link view.

Rebuild order:

1. Scan vault files and frontmatter.
2. Resolve page IDs, titles, aliases, and paths.
3. Parse body wiki links and citations.
4. Resolve links to page IDs when possible.
5. Parse managed related/evidence sections.
6. Build relation edges and backlinks.
7. Build tag/topic/entity indexes.
8. Recompute Knowledge Tree aggregates.
9. Report broken links, unresolved aliases, duplicate topics, and weak claims to Knowledge Health.

Current Phase 4 foundation:

- Markdown body links are the durable source of truth for explicit note-to-note edges.
- The Local Database rebuild parses `[[Wiki Link]]`, `[[Wiki Link|label]]`, local `.md` Markdown links, and renderer-style `#wiki:` links.
- Resolved links populate rebuildable `links`, `backlinks`, and `relation_edges` rows for Library related-page queries.
- Repeated links from one page to the same target are shown as one related page in Library-facing APIs.
- Unresolved targets stay rebuildable and can later power Knowledge Health; they do not authorize arbitrary renderer filesystem access.

B6.12: rev2 rebuilds on first query. Body-free tree resolves ID/title/alias; root topic→domain; `has_topic`>`links_to`; primary=stable, others=related, cycles=cut, depth=iterative; Unassigned. weight=structural+fragment+unique-source; leaf=fragment-ref+source-leaf; sourcePages≠fragments. No public DTO/IPC/UI.

## 13. Prompt And Agent Output Contract

Agent ingest and repair prompts must ask for structured outputs that separate:

- New pages.
- Updates to existing pages.
- Tags.
- Topic assignments.
- Entity mentions.
- Source citations.
- Relationship changes.
- Warnings, abstentions, and exceptional intervention needs.

Rules:

- The model may suggest relationships, but the Wiki Compiler enforces autonomous eligibility.
- Prompt output must include evidence for claims and high-impact relationships.
- The Agent should prefer "suggest link" over "rewrite old page" when confidence is low.
- Source content is untrusted and cannot define new schema, permission, or relationship rules.

## 14. UI Rules

Default UI:

- Do not expose relation type pickers.
- Do not ask for tags before capture.
- Do not make Knowledge Tree setup part of onboarding.
- Do not make graph maintenance a visible chore.

Library:

- Show Agent-maintained categories, notes, sources, topics, and tags.
- Let users browse at least three hierarchy levels when available.
- Keep Library tree separate from Knowledge Tree.

Reader:

- Show backlinks, related pages, sources, and citations.
- Let the Note Agent explain or improve links.
- Selection actions may create notes, ask questions, or apply reversible links with Undo.

Settings:

- No default settings page should expose low-level graph tables, edge weights, embedding internals, or relationship schemas.
- Repair and rebuild controls belong under Index & Maintenance.

## 15. Tests And Fixtures

Required tests:

- Frontmatter tag/topic/entity parsing.
- Wiki link resolution by title, alias, slug, and stable ID.
- Broken link detection.
- Backlink rebuild after rename.
- Citation parsing with source locators.
- Relationship edge rebuild from Markdown.
- Duplicate topic/entity handling without lossy merge.
- Claim support/contradiction autonomous and unresolved-conflict behavior.
- Knowledge Tree aggregate calculation from fixture pages.
- Lexical retrieval over title, alias, tag, body, and citation fields.
- Graph-aware retrieval boost without hiding direct text matches.
- Multilingual alias resolution for the six v0.1 locales.
- Database deletion and graph rebuild from durable files.

Fixture vaults:

- Small clean vault.
- Vault with duplicate topics.
- Vault with aliases in multiple languages.
- Vault with broken links.
- Vault with unsupported or malformed Markdown.
- Vault with source-backed claims and contradictory evidence.
- Vault with 10,000 pages and 100,000 chunks for performance gates.

## 16. Implementation Checklist

Before implementing a feature that touches knowledge organization, answer:

- Does it write durable Markdown or only rebuildable indexes?
- Which page type owns the knowledge?
- Is the relationship represented in Markdown, frontmatter, citation, managed section, or operation record?
- Is it eligible for autonomous recovery-backed apply, or does it cross an exceptional boundary?
- Can the database rebuild the same graph from durable files?
- Does retrieval explain why a result matched?
- Does Knowledge Tree derive from existing knowledge, or did the feature introduce hidden graph-only state?
- Are tags being used as lightweight facets rather than a forced taxonomy?
- Are concepts, topics, entities, and claims kept distinct?
- Are user-written links and sections preserved?
- Are aliases and multilingual duplicates handled conservatively?
