import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanMarkdownPages } from "../../apps/desktop/src/main/services/markdown-page-index";

const temporaryVaults: string[] = [];

afterEach(() => {
  for (const vault of temporaryVaults.splice(0)) fs.rmSync(vault, { recursive: true, force: true });
});

describe("Markdown page index strict frontmatter boundary", () => {
  it("indexes every validated page type and reads structured knowledge fields", () => {
    const vault = createVault();
    writePage(vault, "wiki/note.md", page("note", "note0001", 'note:\n  note_kind: "general"\n  review_state: "clean"'));
    writePage(vault, "wiki/topic.md", page("topic", "topic001", "", { topics: ["page_20260709_topic002"] }));
    writePage(vault, "wiki/concept.md", page("concept", "concept1", 'concept:\n  canonical_name: "Local-first"\n  parent_concepts: ["page_20260709_concept2"]\n  child_concepts: []'));
    writePage(vault, "wiki/entity.md", page("entity", "entity01", 'entity:\n  entity_type: "product"\n  canonical_name: "Pige"\n  identifiers: ["pige"]'));
    writePage(vault, "wiki/claim.md", page("claim", "claim001", 'claim:\n  confidence: "high"\n  evidence: ["src_20260709_schema001#p1"]\n  contradicts: ["page_20260709_claim002"]', { sourceIds: ["src_20260709_schema001"] }));
    writePage(vault, "wiki/question.md", page("question", "question1", 'question:\n  state: "answered"\n  answered_by: ["page_20260709_note0001"]'));
    writePage(vault, "sources/source.md", page("source", "source001", sourceProjection, { sourceIds: ["src_20260709_schema001"] }));

    const result = scanMarkdownPages(vault);
    expect(result.invalidPageCount).toBe(0);
    expect(result.pages.map((entry) => entry.summary.pageType).sort()).toEqual([
      "claim", "concept", "entity", "note", "question", "source", "topic"
    ]);
    expect(result.pages.find((entry) => entry.summary.pageType === "claim")?.knowledge.claimContradicts)
      .toEqual(["page_20260709_claim002"]);
    expect(result.pages.find((entry) => entry.summary.pageType === "question")?.knowledge.questionAnswers)
      .toEqual(["page_20260709_note0001"]);
    expect(result.pages.find((entry) => entry.summary.pageType === "concept")?.knowledge.conceptParents)
      .toEqual(["page_20260709_concept2"]);
  });

  it("counts and excludes malformed pages instead of leaking them into Library/index truth", () => {
    const vault = createVault();
    writePage(vault, "wiki/valid.md", page("note", "valid001", 'note:\n  note_kind: "general"\n  review_state: "clean"'));
    writePage(vault, "wiki/bad-id.md", page("note", "bad", 'note:\n  note_kind: "general"\n  review_state: "clean"'));
    writePage(vault, "wiki/missing-note.md", page("note", "missing1", ""));
    writePage(vault, "wiki/wrong-block.md", page("concept", "wrong001", 'entity:\n  entity_type: "other"\n  canonical_name: "Wrong"\n  identifiers: []'));
    writePage(vault, "wiki/duplicate-key.md", page("note", "dupe0001", 'note:\n  note_kind: "general"\n  review_state: "clean"').replace(
      'title: "note dupe0001"',
      'title: "note dupe0001"\ntitle: "duplicate"'
    ));
    writePage(vault, "wiki/bad-language.md", page("note", "lang0001", 'note:\n  note_kind: "general"\n  review_state: "clean"').replace('language: "en"', 'language: "not_a_tag"'));
    writePage(vault, "sources/locator.md", page("source", "source002", `${sourceProjection}\n  original_uri: "file:///private/source.pdf"`, { sourceIds: ["src_20260709_schema001"] }));

    const result = scanMarkdownPages(vault);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.summary.pageId).toBe("page_20260709_valid001");
    expect(result.invalidPageCount).toBe(6);
  });

  it("keeps bounded common-field compatibility for provenance-free schema-v1 user pages", () => {
    const vault = createVault();
    writePage(vault, "wiki/legacy-user.md", `---
id: "page_20260709_legacy01"
schema_version: 1
title: "Legacy user note"
type: "note"
created_at: "2026-07-09T12:00:00.000Z"
updated_at: "2026-07-09T12:00:00.000Z"
status: "active"
language: "en"
aliases: []
tags: []
topics: []
entities: []
source_ids: []
related_page_ids: []
---

# Legacy user note
`);

    const result = scanMarkdownPages(vault);
    expect(result.invalidPageCount).toBe(0);
    expect(result.pages[0]?.summary).toMatchObject({
      pageId: "page_20260709_legacy01",
      pageType: "note",
      title: "Legacy user note"
    });
  });
});

const sourceProjection = `source:
  id: "src_20260709_schema001"
  kind: "pdf_file"
  storage_strategy: "copy_to_source_library"
  source_record_path: ".pige/source-records/2026/07/src_20260709_schema001.json"
  source_record_schema_version: 1
  source_record_updated_at: "2026-07-09T12:00:00.000Z"
  captured_at: "2026-07-09T12:00:00.000Z"
  availability: "available"
  artifact_ids: ["art_schema_text"]`;

function createVault(): string {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "pige-markdown-index-"));
  temporaryVaults.push(vault);
  fs.mkdirSync(path.join(vault, "sources"), { recursive: true });
  fs.mkdirSync(path.join(vault, "wiki"), { recursive: true });
  return vault;
}

function writePage(vault: string, relativePath: string, markdown: string): void {
  const target = path.join(vault, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, markdown, "utf8");
}

function page(
  type: string,
  suffix: string,
  fields: string,
  options: { readonly sourceIds?: readonly string[]; readonly topics?: readonly string[] } = {}
): string {
  return `---
id: "page_20260709_${suffix}"
schema_version: 1
title: "${type} ${suffix}"
type: "${type}"
created_at: "2026-07-09T12:00:00.000Z"
updated_at: "2026-07-09T12:00:00.000Z"
status: "active"
language: "en"
aliases: []
tags: []
topics: ${JSON.stringify(options.topics ?? [])}
entities: []
source_ids: ${JSON.stringify(options.sourceIds ?? [])}
related_page_ids: []
provenance:
  generated_by: "pige"
${fields}
---

# ${type}

Body.
`;
}
