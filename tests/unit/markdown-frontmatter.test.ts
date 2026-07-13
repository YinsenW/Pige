import { describe, expect, it } from "vitest";
import {
  createPigeTagKey,
  normalizePigeTag,
  normalizePigeTags,
  parsePigeFrontmatter
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
source_ids: ["src_20260709_abcd1234"]
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
      source_ids: ["src_20260709_abcd1234"]
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
});
