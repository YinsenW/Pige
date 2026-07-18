import { describe, expect, it } from "vitest";
import { extractPigeMarkdownLinkRefs, renderPigeMarkdownToHtml } from "@pige/markdown";

describe("Pige Markdown renderer", () => {
  it("renders Markdown body while hiding frontmatter", async () => {
    const rendered = await renderPigeMarkdownToHtml(`---
id: "page_20260709_abcd1234"
schema_version: 1
title: "Rendered"
type: "note"
created_at: "2026-07-09T12:00:00.000Z"
updated_at: "2026-07-09T12:00:00.000Z"
status: "active"
---

# Rendered

- Item
`);

    expect(rendered.markdownBody).not.toContain("schema_version");
    expect(rendered.html).toContain("<h1><span data-pige-selection-segment=");
    expect(rendered.html).toContain(">Rendered</span></h1>");
    expect(rendered.html).toContain("<li><span data-pige-selection-segment=");
    expect(rendered.html).toContain(">Item</span></li>");
    expect(rendered.html).not.toContain("frontmatter");
  });

  it("projects only exact selectable text leaves back to original Markdown offsets", async () => {
    const markdown = "第一段 😀 cafe\u0301\r\n\r\n**Bold text** and [local label](#wiki:Local).\n";
    const rendered = await renderPigeMarkdownToHtml(markdown);

    expect(rendered.selectionSegments.map((segment) => segment.text)).toEqual([
      "第一段 😀 cafe\u0301",
      "Bold text",
      " and ",
      "local label",
      "."
    ]);
    for (const segment of rendered.selectionSegments) {
      expect(segment.segmentId).toMatch(/^readerseg_[a-f0-9]{16}$/u);
      expect(rendered.markdownBody.slice(segment.sourceStartOffset, segment.sourceEndOffset)).toBe(segment.text);
      expect(rendered.html).toContain(`data-pige-selection-segment="${segment.segmentId}"`);
    }
  });

  it("keeps later source offsets exact after generated wiki and source references", async () => {
    const markdown = "[[Target|Label]] then ordinary. [source:src_20260709_abcd1234#page=2] after source.";
    const rendered = await renderPigeMarkdownToHtml(markdown);
    const ordinary = rendered.selectionSegments.find((segment) => segment.text === " then ordinary. ");
    const afterSource = rendered.selectionSegments.find((segment) => segment.text === " after source.");

    expect(ordinary).toBeDefined();
    expect(afterSource).toBeDefined();
    expect(rendered.selectionSegments.some((segment) => segment.text === "Label")).toBe(false);
    expect(rendered.selectionSegments.some((segment) => segment.text.startsWith("source:"))).toBe(false);
    for (const segment of [ordinary!, afterSource!]) {
      expect(markdown.slice(segment.sourceStartOffset, segment.sourceEndOffset)).toBe(segment.text);
    }
  });

  it("fails closed for escaped/entity/code leaves while preserving ordinary neighbors", async () => {
    const rendered = await renderPigeMarkdownToHtml("before \\*escaped &amp; `inline` after\n\n```ts\nconst secret = 1;\n```");
    const texts = rendered.selectionSegments.map((segment) => segment.text);

    expect(texts).toContain(" after");
    expect(texts.some((text) => text.includes("escaped"))).toBe(false);
    expect(texts.some((text) => text.includes("const secret"))).toBe(false);
    expect(rendered.html).not.toMatch(/<code[^>]*data-pige-selection-segment/u);
  });

  it("sanitizes raw HTML and renders Pige inline references as safe anchors", async () => {
    const rendered = await renderPigeMarkdownToHtml(`# Safe

<script>alert("x")</script>
<a href="javascript:alert(1)" onclick="alert(2)">unsafe</a>

[[Local First|local-first]] [source:src_20260709_abcd1234#source]
`);

    expect(rendered.html).not.toContain("<script");
    expect(rendered.html).not.toContain("javascript:");
    expect(rendered.html).not.toContain("onclick");
    expect(rendered.html).toContain('href="#wiki:Local%20First"');
    expect(rendered.html).toContain('href="#source:src_20260709_abcd1234#source"');
  });

  it("fails closed in linear time for hostile unclosed wiki reference prefixes", async () => {
    const hostile = `${"[[\\".repeat(20_000)}tail`;
    const rendered = await renderPigeMarkdownToHtml(hostile);

    expect(rendered.html).not.toContain('href="#wiki:');
    expect(rendered.markdownBody).toBe(hostile);
  }, 1_000);

  it("keeps reader content from navigating or loading remote resources", async () => {
    const rendered = await renderPigeMarkdownToHtml(`# Safe reader

[External](https://example.com/private) [Protocol relative](//example.com/private)
[Relative](../wiki/private.md) [Local file](file:///Users/alice/private.md)

![Remote](https://example.com/private.png)
![Protocol relative](//example.com/private.png)
![Encoded traversal](%252e%252e/private.png)
![Safe relative](assets/figure.png)

[[Local First]] [source:src_20260709_abcd1234#page=2]
`);

    expect(rendered.html).not.toContain('href="https:');
    expect(rendered.html).not.toContain('href="//');
    expect(rendered.html).not.toContain('href="../');
    expect(rendered.html).not.toContain('href="file:');
    expect(rendered.html).not.toContain('src="https:');
    expect(rendered.html).not.toContain('src="//');
    expect(rendered.html).not.toContain("%252e%252e");
    expect(rendered.html).toContain('src="assets/figure.png"');
    expect(rendered.html).toContain('href="#wiki:Local%20First"');
    expect(rendered.html).toContain('href="#source:src_20260709_abcd1234#page=2"');
  });

  it.each([
    "http://example.com/tracker.png",
    "https://example.com/tracker.png",
    "//example.com/tracker.png",
    "\\\\example.com\\tracker.png",
    "/absolute/tracker.png",
    "file:///Users/alice/tracker.png",
    "data:image/png;base64,AAAA",
    "%2f%2fexample.com%2ftracker.png",
    "%252f%252fexample.com%252ftracker.png",
    "http%3a%2f%2fexample.com%2ftracker.png",
    "%0ahttps%3a%2f%2fexample.com%2ftracker.png",
    "assets/%2e%2e/tracker.png",
    "assets/%252e%252e/tracker.png",
    "%2e%2e/tracker.png?%ZZ",
    "assets/%2e%2e/tracker.png?%ZZ",
    "assets/%2e%2e/tracker.png#%ZZ",
    "assets/%ZZ/%2e%2e/tracker.png",
    "assets/tracker.svg"
  ])("removes unsafe reader image source %s", async (source) => {
    const rendered = await renderPigeMarkdownToHtml(`![blocked](${source})`);
    expect(rendered.html).not.toMatch(/\ssrc=/u);
  });

  it.each([
    "https://example.com/private",
    "//example.com/private",
    "../wiki/private.md",
    "file:///Users/alice/private.md",
    "mailto:alice@example.com",
    "data:text/html,private"
  ])("removes non-Pige reader link %s", async (target) => {
    const rendered = await renderPigeMarkdownToHtml(`[blocked](${target})`);
    expect(rendered.html).not.toMatch(/\shref=/u);
  });

  it("extracts durable wiki and local Markdown links while ignoring unsafe or code links", () => {
    const refs = extractPigeMarkdownLinkRefs(`---
id: "page_20260709_links"
schema_version: 1
title: "Links"
type: "note"
created_at: "2026-07-09T12:00:00.000Z"
updated_at: "2026-07-09T12:00:00.000Z"
status: "active"
---

[[Local First|local-first]]
[Topic](../wiki/topic.md#details)
[Rendered](#wiki:Rendered)
![Ignored](assets/image.png)
[Unsafe](https://example.com)
\`[[Ignored Code]]\`

\`\`\`
[Ignored Block](wiki/block.md)
\`\`\`
`);

    expect(refs).toEqual([
      { kind: "wiki_link", target: "Local First", label: "local-first" },
      { kind: "markdown_link", target: "../wiki/topic.md#details", label: "Topic" },
      { kind: "markdown_link", target: "Rendered", label: "Rendered" }
    ]);
  });
});
