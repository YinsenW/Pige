# Markdown Schema

Status: Draft baseline
Date: 2026-07-09

## 1. Purpose

This document is the implementation contract for Pige Markdown files.

Pige's durable knowledge layer is Markdown. Every generated or maintained knowledge page must be readable without Pige, but structured enough for the Agent, search, future sync, backup, and repair workflows.

Use this document when implementing:

- Vault creation.
- `PIGE.md`, `index.md`, and `log.md`.
- Source pages under `sources/`.
- Wiki pages under `wiki/`.
- Markdown rendering and editing.
- Agent write validation.
- Database/index rebuilds from Markdown.

## 2. Schema Principles

- Markdown knowledge files are the knowledge source of truth.
- YAML frontmatter is required for every Pige-managed page except `log.md` entries.
- IDs are stable and do not depend on file path, title, slug, or language.
- Source asset bodies are not copied into unrelated pages or conversation logs.
- Generated claims should cite source records or source fragments.
- User-written prose remains plain Markdown and should not be trapped inside opaque JSON blocks.
- Pige-managed metadata must be small, explicit, and validatable.

## 3. File Classes

| File | Role | Durable? | User editable? |
| --- | --- | --- | --- |
| `PIGE.md` | Vault-level Agent policy and schema guidance. | Yes | Yes, with validation and confirmation. |
| `index.md` | Human-readable knowledge index maintained by Pige. | Yes | Yes, Pige may repair managed sections. |
| `log.md` | Append-only human-readable activity log. | Yes | Usually no, but plain Markdown. |
| `sources/*.md` | Source pages that summarize captured material and point to source records/assets. | Yes | Yes |
| `wiki/**/*.md` | Notes, concepts, entities, topics, claims, and questions. | Yes | Yes |
| `.pige/**/*.jsonl` | Conversations, operations, proposals, memory events. | Yes, but not Markdown knowledge. | No direct editing in v0.1. |

## 4. Common Frontmatter

All Pige-managed Markdown pages except `PIGE.md`, `index.md`, and `log.md` should use this base shape.

```yaml
---
id: "page_20260709_abcd1234"
schema_version: 1
title: "Page Title"
type: "source"
created_at: "2026-07-09T12:00:00+08:00"
updated_at: "2026-07-09T12:00:00+08:00"
status: "active"
language: "zh-Hans"
language_confidence: 0.92
detected_languages: ["zh-Hans", "en"]
aliases: []
tags: []
topics: []
entities: []
source_ids: []
related_page_ids: []
provenance:
  generated_by: "pige"
  last_job_id: "job_20260709_abcd1234"
  last_operation_id: "op_20260709_bcde2345"
  model_profile_id: "model_profile_default"
  confidence: "medium"
---
```

Field rules:

- `id`: required stable `page_` ID validated by `PageIdSchema` in `packages/schemas/src/index.ts`.
- `schema_version`: required integer.
- `title`: required user-visible title.
- `type`: one of `source`, `note`, `concept`, `entity`, `topic`, `claim`, `question`.
- `created_at`, `updated_at`: required ISO 8601 with timezone.
- `status`: one of `active`, `archived`, `draft`, `needs_review`, `missing_source`, `conflict`.
- `language`: BCP 47 tag when known.
- `language_confidence`: `0` to `1`; omit only when unknown.
- `source_ids`: source record IDs used by the page.
- `related_page_ids`: stable IDs, not file paths.
- `provenance`: Pige-managed, never a place for secrets or full prompts.

## 5. Page-Type Fields

### 5.1 Source Page

Source pages summarize a captured input and point to the durable source record.

```yaml
source:
  id: "src_20260709_abcd1234"
  kind: "pdf_file"
  storage_strategy: "copy_to_source_library"
  source_record_path: ".pige/source-records/2026/07/src_20260709_abcd1234.json"
  source_record_schema_version: 1
  source_record_updated_at: "2026-07-09T12:00:00+08:00"
  captured_at: "2026-07-09T12:00:00+08:00"
  availability: "available"
  artifact_ids:
    - "art_20260709_abcd1234_text"
```

Rules:

- `.pige/source-records/**/*.json` is the operational authority for source kind, storage strategy, original URI/path, managed-copy locator, checksums, availability evidence, and artifact locators.
- Source frontmatter is a bounded human-readable projection. `source.id` and `source_record_path` must resolve to the same sidecar; `source_record_schema_version` and `source_record_updated_at` are required drift evidence. A writer may also add `source_record_sha256` when its transaction can keep that file hash consistent without creating a circular page-hash/source-record-hash update.
- A source page never becomes an alternate file locator. Capture, parser, backup, restore, and repair services resolve assets from the sidecar, not from mirrored Markdown paths.
- Existing Phase 2 pages may contain compatibility mirrors such as `managed_copy_path`, `original_uri`, `checksum`, or `artifact_paths`. Readers may display them after redaction, but must not use them for filesystem access. New writers must not emit those mirrors; the next safe source-page refresh replaces them with the bounded projection above.
- `availability` is one of `available`, `missing`, `changed`, `permission_needed`, `unknown`.
- Phase 2/3 bridge source pages may be generated without a model. Text-readable sources may inline only short excerpts in fenced code blocks; preserved PDF/DOCX/PPTX/image sources remain metadata-only until parser/OCR artifacts exist. Long source bodies and binary source bodies remain in managed source copies to avoid duplication and accidental prompt ingestion.
- Phase 2/3 Library summaries are derived from common frontmatter fields only: `id`, `schema_version`, `title`, `type`, `created_at`, `updated_at`, `status`, `language`, and `source_ids`.
- If the page and sidecar disagree, preserve user-authored Markdown, use the sidecar for operational resolution, mark the projection stale/conflicted, and create a `repair_record` operation or confirmation proposal. Never silently copy a Markdown path into the sidecar.

### 5.2 Note Page

Notes are flexible user-facing pages.

```yaml
note:
  note_kind: "general"
  review_state: "clean"
```

`note_kind` can be `general`, `memo`, `summary`, `research`, `meeting`, `draft`, or `imported`.

Phase 3 bridge generated notes:

- Basic Agent ingest can auto-create simple `type: "note"` pages under `wiki/generated/YYYY/`.
- These notes use `note_kind: "summary"` and cite one preserved `source_id`.
- The page ID and path are deterministic from the source ID so retry cannot create duplicates.
- Frontmatter includes `provenance.last_job_id`, `provenance.model_profile_id`, and `provenance.confidence`.
- If the model output has low confidence or warnings, frontmatter uses `status: "needs_review"` and `note.review_state: "needs_review"` instead of pretending the note is clean.
- The page body contains a concise summary, key points, inline source citations resolved from the validated Evidence Pack, and optional warnings.
- Each generated summary and key point carries one or more canonical `[source:<source-id>#<locator>]` citations when the model selected valid evidence refs. Model-authored citation tokens are not trusted or copied through.
- Unknown evidence refs fail before the page write. Missing refs add a warning and force `needs_review`; Pige does not invent a `#summary` or other fallback locator for an uncited claim.
- Raw prompts, raw model responses, API keys, managed source paths, original absolute paths, and large source bodies must not be written into the generated note.

### 5.3 Concept Page

```yaml
concept:
  canonical_name: "Local-first software"
  parent_concepts: []
  child_concepts: []
```

### 5.4 Entity Page

```yaml
entity:
  entity_type: "person"
  canonical_name: "Ada Lovelace"
  identifiers: []
```

`entity_type` can be `person`, `organization`, `product`, `place`, `project`, `event`, or `other`.

### 5.5 Claim Page

```yaml
claim:
  confidence: "medium"
  evidence:
    - "src_20260709_abcd1234#p3"
  contradicts: []
```

Claims require at least one source citation unless they are explicitly marked `needs_review`.

### 5.6 Question Page

```yaml
question:
  state: "open"
  answered_by: []
```

`state` can be `open`, `partially_answered`, `answered`, or `stale`.

## 6. Body Structure

Generated pages should prefer predictable sections.

Source page minimum:

```md
# Title

## Summary

## Key Points

## Extracted Structure

## Source References

## Related Pages
```

Wiki page recommended:

```md
# Title

## Summary

## Key Points

## Details

## Evidence

## Related
```

Pige may add type-specific sections, but should not require every page to look identical when the user has edited it.

## 7. Citations And Locators

Inline citation syntax:

```md
The claim text. [source:src_20260709_abcd1234#p3]
```

Locator examples:

- `p3`: PDF page 3.
- `slide5`: presentation slide 5.
- `span_abcd`: stable extracted-text span.
- `img2`: second image artifact.
- `url`: canonical web page.
- `t00:01:23`: media timestamp.

Rules:

- Citations point to source records or extracted artifacts, not directly to transient database rows.
- Agent-generated factual claims should cite at least one source when available.
- Missing citation should lower confidence or create a review warning.

## 8. Links

Internal links:

```md
[[Local-first software]]
[[Local-first software|local-first]]
```

Pige stores `page_` stable IDs in frontmatter and can resolve wiki links by title, alias, and slug. Retired `pg_` IDs are migration input only and must never be emitted.

Rules:

- Renames update links through a confirmed operation.
- Broken links are reported by Knowledge Health.
- File paths should not be used as durable cross-page IDs.
- Relationship types, tag/topic/entity boundaries, backlink rebuild behavior, and Knowledge Tree graph rules are defined in `docs/KNOWLEDGE_MODEL_AND_LINKING.md`.

## 9. Managed Blocks

Pige may maintain specific sections using HTML comments.

```md
<!-- pige:managed section="related" version="1" operation="op_20260709_bcde2345" -->
- [[Example]]
<!-- /pige:managed -->
```

Rules:

- Managed blocks must be readable as normal Markdown when comments are ignored.
- Pige may replace managed blocks only after validating the surrounding file checksum.
- User edits outside managed blocks must not be overwritten.
- Large rewrites outside managed blocks require confirmation.

## 10. `PIGE.md` Contract

`PIGE.md` is vault-level policy, not a place for secrets.

Required sections:

```md
# PIGE

## Vault Identity

## Page Types

## Naming Rules

## Frontmatter Rules

## Link Rules

## Source Handling Rules

## Agent Review Rules

## Prompt Injection Rules
```

Rules:

- Editing `PIGE.md` requires validation.
- Agent-proposed edits to `PIGE.md` require explicit confirmation.
- Source content, Skills, packages, or model output cannot modify `PIGE.md` directly.

## 11. Validation

Every Markdown write must validate:

- Required frontmatter fields.
- Type-specific fields.
- Stable ID format.
- ISO timestamps.
- BCP 47 language tags where present.
- No secrets in frontmatter or body.
- Citations reference existing source records when possible.
- Managed block markers are balanced.
- Pige-reserved fields are not malformed.

Failed validation should produce a repair proposal, not corrupt the file.

## 12. Migration

Schema migrations must:

- Never rewrite user-owned Markdown without backup or confirmation.
- Be resumable.
- Keep old IDs stable.
- Record operation summaries.
- Rebuild database/index caches after completion.
- Leave readable Markdown if migration fails.

Detailed schema-version, migration-plan, conflict, and future-sync rules live in `docs/SYNC_CONFLICT_AND_MIGRATION.md`.

## 13. Required Tests

- Frontmatter parse and validation.
- Invalid YAML recovery.
- Page type validation.
- Citation parsing.
- Managed block replacement.
- Link resolution and rename.
- Secret scanning.
- New source pages contain only the bounded sidecar projection and artifact IDs; they never emit managed-copy or artifact paths as compatibility mirrors.
- Source-page projection mismatch never changes sidecar locators silently.
- Retired `pg_` IDs are rejected for new writes; a documented legacy page keeps its ID until an explicit identity migration can preserve references safely.
- Migration dry run.
- Database rebuild from Markdown.
