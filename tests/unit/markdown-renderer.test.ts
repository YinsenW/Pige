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
    expect(rendered.html).toContain("<h1>Rendered</h1>");
    expect(rendered.html).toContain("<li>Item</li>");
    expect(rendered.html).not.toContain("frontmatter");
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
