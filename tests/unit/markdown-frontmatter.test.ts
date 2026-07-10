import { describe, expect, it } from "vitest";
import { parsePigeFrontmatter } from "@pige/markdown";

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
      source_ids: ["src_20260709_abcd1234"]
    });
  });

  it("returns undefined when the prefix has no complete frontmatter block", () => {
    expect(parsePigeFrontmatter("# No frontmatter")).toBeUndefined();
    expect(parsePigeFrontmatter("---\nid: \"page\"\n")).toBeUndefined();
  });
});
