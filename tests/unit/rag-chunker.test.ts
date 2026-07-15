import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createMarkdownRagChunks,
  RAG_CHUNK_MAX_CHARACTERS,
  RAG_CHUNKER_VERSION
} from "../../apps/desktop/src/main/services/rag-chunker";

describe("Markdown RAG chunker", () => {
  it("creates stable bounded metadata with heading paths and exact character ranges", () => {
    const body = `Preamble evidence.\n\n# Alpha\n${"alpha evidence ".repeat(120)}\n\n## Beta\nBeta conclusion.`;
    const input = {
      pageId: "page_20260715_chunkstable",
      pagePath: "wiki/chunk-stable.md",
      pageType: "note" as const,
      sourceIds: ["src_20260715_sourcebbbb", "src_20260715_sourceaaaa", "src_20260715_sourcebbbb"],
      body
    };

    const first = createMarkdownRagChunks(input);
    const second = createMarkdownRagChunks(input);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(3);
    expect(first.every((chunk) => chunk.characterEnd - chunk.characterStart <= RAG_CHUNK_MAX_CHARACTERS)).toBe(true);
    expect(first.every((chunk) => body.slice(chunk.characterStart, chunk.characterEnd).trim().length > 0)).toBe(true);
    expect(first.every((chunk) => chunk.chunkerVersion === RAG_CHUNKER_VERSION)).toBe(true);
    expect(first.every((chunk) => /^chunk_[a-f0-9]{32}$/u.test(chunk.chunkId))).toBe(true);
    expect(first.every((chunk) => /^sha256:[a-f0-9]{64}$/u.test(chunk.textHash))).toBe(true);
    expect(first.every((chunk) => chunk.tokenCount > 0)).toBe(true);
    expect(first[0]?.headingPath).toEqual([]);
    expect(first.some((chunk) => JSON.stringify(chunk.headingPath) === JSON.stringify(["Alpha"]))).toBe(true);
    expect(first.at(-1)?.headingPath).toEqual(["Alpha", "Beta"]);
    expect(first[0]?.sourceIds).toEqual(["src_20260715_sourceaaaa", "src_20260715_sourcebbbb"]);
  });

  it("keeps chunk identities stable when only display metadata changes", () => {
    const body = `# Stable\n${"retrieval context ".repeat(90)}`;
    const base = createMarkdownRagChunks({
      pageId: "page_20260715_identity1",
      pagePath: "wiki/identity.md",
      pageType: "note",
      sourceIds: [],
      body
    });
    const same = createMarkdownRagChunks({
      pageId: "page_20260715_identity1",
      pagePath: "wiki/renamed-display-path.md",
      pageType: "note",
      sourceIds: [],
      body
    });
    const changedOwner = createMarkdownRagChunks({
      pageId: "page_20260715_identity2",
      pagePath: "wiki/identity.md",
      pageType: "note",
      sourceIds: [],
      body
    });

    expect(same.map((chunk) => chunk.chunkId)).toEqual(base.map((chunk) => chunk.chunkId));
    expect(changedOwner.map((chunk) => chunk.chunkId)).not.toEqual(base.map((chunk) => chunk.chunkId));
  });

  it("changes identity with heading context and hashes only redacted chunk text", () => {
    const privateField = ["api", "key"].join("_");
    const privateValue = ["synthetic", "redaction", "sentinel"].join("-");
    const privateLine = `${privateField}=${privateValue} retrieval evidence`;
    const firstBody = `# First context\n${privateLine}`;
    const secondBody = `# Other context\n${privateLine}`;
    const first = createMarkdownRagChunks({
      pageId: "page_20260715_safehash1",
      pagePath: "wiki/safe-hash.md",
      pageType: "note",
      sourceIds: [],
      body: firstBody
    });
    const second = createMarkdownRagChunks({
      pageId: "page_20260715_safehash1",
      pagePath: "wiki/safe-hash.md",
      pageType: "note",
      sourceIds: [],
      body: secondBody
    });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]?.chunkId).not.toBe(second[0]?.chunkId);
    expect(first[0]?.textHash).toBe(sha256(`${privateField}=[redacted-secret] retrieval evidence`));
    expect(first[0]?.textHash).not.toBe(sha256(privateLine));
  });

  it("does not split a surrogate pair at a hard chunk boundary", () => {
    const prefix = "a".repeat(RAG_CHUNK_MAX_CHARACTERS - 1);
    const body = `${prefix}😀${" tail".repeat(80)}`;
    const chunks = createMarkdownRagChunks({
      pageId: "page_20260715_unicode1",
      pagePath: "wiki/unicode.md",
      pageType: "note",
      sourceIds: [],
      body
    });

    for (const chunk of chunks) {
      const text = body.slice(chunk.characterStart, chunk.characterEnd);
      expect(text).not.toMatch(/[\uD800-\uDBFF]$/u);
      expect(text).not.toMatch(/^[\uDC00-\uDFFF]/u);
    }
  });

  it("does not begin an overlap range inside a surrogate pair", () => {
    const body = `${"a".repeat(1_079)}😀${"b".repeat(1_000)}`;
    const chunks = createMarkdownRagChunks({
      pageId: "page_20260715_overlap1",
      pagePath: "wiki/overlap.md",
      pageType: "note",
      sourceIds: [],
      body
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const text = body.slice(chunk.characterStart, chunk.characterEnd);
      expect(text).not.toMatch(/^[\uDC00-\uDFFF]/u);
      expect(text).not.toMatch(/[\uD800-\uDBFF]$/u);
    }
  });

  it("redacts private heading fields before persisting heading metadata", () => {
    const privateField = ["api", "key"].join("_");
    const chunks = createMarkdownRagChunks({
      pageId: "page_20260715_heading1",
      pagePath: "wiki/private-heading.md",
      pageType: "note",
      sourceIds: [],
      body: `# ${privateField}=synthetic-heading-value\nSafe evidence.`
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.headingPath).toEqual([`${privateField}=[redacted-secret]`]);
    expect(JSON.stringify(chunks)).not.toContain("synthetic-heading-value");
  });

  it("returns no metadata for empty or heading-only Markdown", () => {
    expect(createMarkdownRagChunks({
      pageId: "page_20260715_empty111",
      pagePath: "wiki/empty.md",
      pageType: "note",
      sourceIds: [],
      body: "\n# Heading only\n\n"
    })).toEqual([]);
  });
});

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
