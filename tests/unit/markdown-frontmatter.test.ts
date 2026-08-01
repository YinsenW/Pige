import { describe, expect, it } from "vitest";
import {
  createPigeTagKey,
  normalizePigeTag,
  normalizePigeTags,
  parsePigeFrontmatter,
  parsePigeMarkdownPage,
  rewritePigeMarkdownFrontmatter
} from "@pige/markdown";

describe("Pige Markdown frontmatter parser", () => {
  it("parses the known top-level fields used by library summaries", () => {
    const parsed = parsePigeFrontmatter(`---
id: "page_20260709_abcd1234"
schema_version: 1
title: "Captured Source"
type: "source"
created_at: "2026-07-09T12:00:00.000Z"
updated_at: "2026-07-09T12:00:00.000Z"
status: "active"
language: "en"
aliases: ["Captured Evidence", "Imported Source"]
tags: ["Local First", "Research"]
topics: ["Local RAG", "page_20260709_topic123"]
entities: ["Pige", "page_20260709_entity12"]
source_ids: ["src_20260709_abcd1234"]
related_page_ids: ["page_20260709_related1"]
source:
  managed_copy_path: "raw/files/2026/07/source.md"
---

# Captured Source
`);

    expect(parsed?.frontmatter).toEqual({
      id: "page_20260709_abcd1234",
      schema_version: 1,
      title: "Captured Source",
      type: "source",
      created_at: "2026-07-09T12:00:00.000Z",
      updated_at: "2026-07-09T12:00:00.000Z",
      status: "active",
      language: "en",
      aliases: ["Captured Evidence", "Imported Source"],
      tags: ["Local First", "Research"],
      topics: ["Local RAG", "page_20260709_topic123"],
      entities: ["Pige", "page_20260709_entity12"],
      source_ids: ["src_20260709_abcd1234"],
      related_page_ids: ["page_20260709_related1"]
    });
  });

  it("returns undefined when the prefix has no complete frontmatter block", () => {
    expect(parsePigeFrontmatter("# No frontmatter")).toBeUndefined();
    expect(parsePigeFrontmatter("---\nid: \"page\"\n")).toBeUndefined();
  });

  it("does not coerce malformed scalar or numeric tag fields into an array contract", () => {
    expect(parsePigeFrontmatter(`---
id: "page_20260709_scalar1"
tags: Research
---
`)?.frontmatter.tags).toBeUndefined();
    expect(parsePigeFrontmatter(`---
id: "page_20260709_numeric1"
tags: 123
---
`)?.frontmatter.tags).toBeUndefined();
  });

  it("normalizes bounded tags and deduplicates their canonical keys deterministically", () => {
    expect(normalizePigeTag("  Durable   Knowledge  ")).toBe("Durable Knowledge");
    expect(normalizePigeTag("Ｒｅｓｅａｒｃｈ")).toBe("Research");
    expect(createPigeTagKey("RESEARCH")).toBe("research");
    expect(normalizePigeTags([
      "Research",
      "research",
      "  Durable   Knowledge  ",
      "Ｒｅｓｅａｒｃｈ",
      "Local First"
    ])).toEqual(["Research", "Durable Knowledge", "Local First"]);
    expect(normalizePigeTag("unsafe\u0000tag")).toBeUndefined();
    expect(normalizePigeTag("x".repeat(49))).toBeUndefined();
  });

  it.each([
    ["note", 'note:\n  note_kind: "general"\n  review_state: "clean"', "active", ""],
    ["topic", "", "active", ""],
    ["concept", 'concept:\n  canonical_name: "Local-first"\n  parent_concepts: []\n  child_concepts: []', "active", ""],
    ["entity", 'entity:\n  entity_type: "product"\n  canonical_name: "Pige"\n  identifiers: ["pige"]', "active", ""],
    ["claim", 'claim:\n  confidence: "high"\n  evidence: ["src_20260709_schema001#p1"]\n  contradicts: []', "active", 'source_ids: ["src_20260709_schema001"]'],
    ["question", 'question:\n  state: "open"\n  answered_by: []', "active", ""],
    ["source", 'source:\n  id: "src_20260709_schema001"\n  kind: "pdf_file"\n  storage_strategy: "copy_to_source_library"\n  source_record_path: ".pige/source-records/2026/07/src_20260709_schema001.json"\n  source_record_schema_version: 1\n  source_record_updated_at: "2026-07-09T12:00:00.000Z"\n  captured_at: "2026-07-09T12:00:00.000Z"\n  availability: "available"\n  artifact_ids: ["art_schema_text"]', "active", 'source_ids: ["src_20260709_schema001"]']
  ])("strictly validates the complete %s page shape", (type, fields, status, sourceIds) => {
    const markdown = validPage(type, fields, status, sourceIds);
    const parsed = parsePigeMarkdownPage(markdown);
    expect(parsed?.frontmatter.type).toBe(type);
    expect(parsed?.markdownBody).toBe(`\n# Exact body\n\n  User spacing stays.${"  "}\n`);
  });

  it("rejects malformed YAML, aliases, duplicate keys, mismatched type blocks, and ungrounded active claims", () => {
    expect(parsePigeMarkdownPage(validPage("note", 'note:\n  note_kind: "general"\n  review_state: "clean"').replace(
      'title: "Exact note"',
      'title: "Exact note"\ntitle: "Duplicate"'
    ))).toBeUndefined();
    expect(parsePigeMarkdownPage(validPage("note", 'note:\n  note_kind: "general"\n  review_state: "clean"').replace(
      "aliases: []\ntags: []",
      "aliases: &same []\ntags: *same"
    ))).toBeUndefined();
    expect(parsePigeMarkdownPage(validPage("note", 'claim:\n  confidence: "medium"\n  evidence: []\n  contradicts: []'))).toBeUndefined();
    expect(parsePigeMarkdownPage(validPage(
      "claim",
      'claim:\n  confidence: "medium"\n  evidence: []\n  contradicts: []',
      "active"
    ))).toBeUndefined();
    expect(parsePigeMarkdownPage(validPage("note", 'note:\n  note_kind: "general"\n  review_state: "clean"').replace(
      "tags: []",
      "tags:\n  - Research"
    ))).toBeUndefined();
  });

  it("rejects source projections that contain an operational locator or disagree with source_ids", () => {
    const sourceFields = 'source:\n  id: "src_20260709_schema001"\n  kind: "pdf_file"\n  storage_strategy: "reference_original"\n  source_record_path: ".pige/source-records/2026/07/src_20260709_schema001.json"\n  source_record_schema_version: 1\n  source_record_updated_at: "2026-07-09T12:00:00.000Z"\n  captured_at: "2026-07-09T12:00:00.000Z"\n  availability: "available"\n  artifact_ids: []';
    expect(parsePigeMarkdownPage(validPage(
      "source",
      `${sourceFields}\n  managed_copy_path: "raw/private.pdf"`,
      "active",
      'source_ids: ["src_20260709_schema001"]'
    ))).toBeUndefined();
    expect(parsePigeMarkdownPage(validPage(
      "source",
      sourceFields,
      "active",
      'source_ids: ["src_20260709_other001"]'
    ))).toBeUndefined();
    expect(parsePigeMarkdownPage(validPage(
      "source",
      sourceFields.replace("src_20260709_schema001.json", "src_20260709_other001.json"),
      "active",
      'source_ids: ["src_20260709_schema001"]'
    ))).toBeUndefined();
  });

  it("rewrites validated frontmatter while preserving unknown fields and exact user body bytes", () => {
    const original = validPage("note", 'note:\n  note_kind: "general"\n  review_state: "clean"\n  future_note_field: 7')
      .replace("aliases: []\ntags: []\ntopics: []",
        'aliases: ["Alternative"]\ntags: ["Research"]\ntopics: ["Local First"]')
      .replace("note:\n",
        'future_owner:\n  enabled: true\n  nested:\n    - ["one", "two"]\n    - label: "future"\nnote:\n');
    const body = parsePigeMarkdownPage(original)?.markdownBody;
    const rewritten = rewritePigeMarkdownFrontmatter(original, {
      updated_at: "2026-07-10T12:00:00.000Z"
    });
    const parsed = rewritten ? parsePigeMarkdownPage(rewritten) : undefined;
    expect(parsed?.markdownBody).toBe(body);
    expect(parsed?.frontmatter.updated_at).toBe("2026-07-10T12:00:00.000Z");
    expect(parsed?.frontmatter.aliases).toEqual(["Alternative"]);
    expect(parsed?.frontmatter.tags).toEqual(["Research"]);
    expect(parsed?.frontmatter.topics).toEqual(["Local First"]);
    expect((parsed?.frontmatter as Record<string, unknown>).future_owner).toEqual({
      enabled: true,
      nested: [["one", "two"], { label: "future" }]
    });
    expect((parsed?.frontmatter.note as Record<string, unknown>).future_note_field).toBe(7);
    expect(rewritePigeMarkdownFrontmatter(original, { type: "claim" })).toBeUndefined();
  });

  it("rejects a canonical title repeated as an alias", () => {
    expect(parsePigeMarkdownPage(validPage(
      "note",
      'note:\n  note_kind: "general"\n  review_state: "clean"'
    ).replace("aliases: []", 'aliases: ["exact NOTE"]'))).toBeUndefined();
  });

  it("keeps frontmatter offsets exact when a UTF-8 BOM is present", () => {
    const markdown = `\uFEFF${validPage("note", 'note:\n  note_kind: "general"\n  review_state: "clean"')}`;
    expect(parsePigeMarkdownPage(markdown)?.markdownBody).toBe("\n# Exact body\n\n  User spacing stays.  \n");
  });
});

function validPage(type: string, fields: string, status = "active", sourceIds = "source_ids: []"): string {
  return `---
id: "page_20260709_schema001"
schema_version: 1
title: "Exact note"
type: "${type}"
created_at: "2026-07-09T12:00:00.000Z"
updated_at: "2026-07-09T12:00:00.000Z"
status: "${status}"
language: "en"
aliases: []
tags: []
topics: []
entities: []
${sourceIds}
related_page_ids: []
provenance:
  generated_by: "pige"
${fields}
---

# Exact body

  User spacing stays.${"  "}
`;
}
