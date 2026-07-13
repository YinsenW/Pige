import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalDatabaseService,
  NodeSqliteDriver
} from "../../apps/desktop/src/main/services/local-database-service";
import { listMarkdownTagCatalog } from "../../apps/desktop/src/main/services/markdown-page-index";

const tempRoots: string[] = [];

function makeVaultRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-db-test-"));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, ".pige/db"), { recursive: true });
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("local database service", () => {
  it("initializes the node sqlite migration state behind the driver abstraction", () => {
    const vaultPath = makeVaultRoot();
    const service = new LocalDatabaseService();

    const status = service.initialize(vaultPath);
    const state = JSON.parse(fs.readFileSync(path.join(vaultPath, ".pige/db/schema-state.json"), "utf8")) as {
      driver: string;
      appSchemaVersion: number;
      appliedMigrations: unknown[];
    };

    expect(status.driver).toBe("node_sqlite");
    expect(status.status).toBe("ready");
    expect(status.appSchemaVersion).toBe(1);
    expect(status.appliedMigrationCount).toBe(1);
    expect(state.driver).toBe("node_sqlite");
    expect(state.appliedMigrations).toHaveLength(1);
    expect(fs.existsSync(path.join(vaultPath, ".pige/db/vault.sqlite"))).toBe(true);
  });

  it("rebuilds page metadata and FTS search from Markdown files", () => {
    const vaultPath = makeVaultRoot();
    const service = new LocalDatabaseService();
    writePage(vaultPath, "wiki/local-rag.md", {
      id: "page_20260709_rag12345",
      title: "Local RAG",
      body: "Local RAG uses lexical search before vector retrieval."
    });
    writePage(vaultPath, "wiki/ocr.md", {
      id: "page_20260709_cjk12345",
      title: "本地 OCR",
      body: "图片和扫描 PDF 需要本地识别能力。",
      language: "zh-Hans"
    });

    const rebuild = service.rebuild(vaultPath);
    const pages = service.listPages(vaultPath, { limit: 10 });
    const latin = service.searchPages(vaultPath, { query: "lexical search" });
    const cjk = service.searchPages(vaultPath, { query: "本地识别" });

    expect(rebuild).toMatchObject({ pageCount: 2, invalidPageCount: 0 });
    expect(pages?.total).toBe(2);
    expect(pages?.pages.map((page) => page.title)).toContain("Local RAG");
    expect(latin?.results[0]?.summary.title).toBe("Local RAG");
    expect(cjk?.results[0]?.summary.title).toBe("本地 OCR");
  });

  it("indexes wiki links and local Markdown links as rebuildable related pages", () => {
    const vaultPath = makeVaultRoot();
    const service = new LocalDatabaseService();
    writePage(vaultPath, "wiki/topic.md", {
      id: "page_20260709_topic1",
      title: "Knowledge Tree",
      body: "A durable note that can be reached by explicit links."
    });
    writePage(vaultPath, "wiki/research/source.md", {
      id: "page_20260709_source1",
      title: "Source Note",
      body: `See [[Knowledge Tree]] and [the same topic](../topic.md#details).

[External](https://example.com) should not become a graph edge.
\`[[Ignored Code Link]]\`
`
    });

    service.rebuild(vaultPath);

    const outgoing = service.relatedPages(vaultPath, { pageId: "page_20260709_source1" });
    const backlinks = service.relatedPages(vaultPath, { pageId: "page_20260709_topic1" });

    expect(outgoing?.totalOutgoing).toBe(1);
    expect(outgoing?.outgoing).toHaveLength(1);
    expect(outgoing?.outgoing[0]?.summary).toMatchObject({
      pageId: "page_20260709_topic1",
      title: "Knowledge Tree"
    });
    expect(backlinks?.totalBacklinks).toBe(1);
    expect(backlinks?.backlinks[0]?.summary).toMatchObject({
      pageId: "page_20260709_source1",
      title: "Source Note"
    });
    expect(JSON.stringify(outgoing)).not.toContain("example.com");
  });

  it("rebuilds canonical tag facets from Markdown without treating SQLite as durable knowledge", () => {
    const vaultPath = makeVaultRoot();
    const service = new LocalDatabaseService();
    writePage(vaultPath, "wiki/tags.md", {
      id: "page_20260709_tags1234",
      title: "Tagged Knowledge",
      body: "The durable tag set lives in Markdown frontmatter.",
      tags: ["Research", "research", "  Durable   Knowledge  ", "Ｒｅｓｅａｒｃｈ"]
    });
    writeRawPage(vaultPath, "wiki/scalar-tags.md", "page_20260709_scalartags", "tags: Research");
    writeRawPage(vaultPath, "wiki/block-tags.md", "page_20260709_blocktags", "tags:\n  - Research");
    writeRawPage(vaultPath, "wiki/too-many-tags.md", "page_20260709_manytags1", `tags: ${JSON.stringify(
      Array.from({ length: 13 }, (_, index) => `tag-${index + 1}`)
    )}`);

    expect(service.rebuild(vaultPath)).toMatchObject({ pageCount: 1, invalidPageCount: 3 });
    expect(listMarkdownTagCatalog(vaultPath)).toEqual(["Durable Knowledge", "Research"]);
    expect(readTagProjection(vaultPath)).toEqual({
      tags: ["durable knowledge", "research"],
      pageTags: [
        { pageId: "page_20260709_tags1234", tag: "durable knowledge" },
        { pageId: "page_20260709_tags1234", tag: "research" }
      ],
      revision: 3
    });

    fs.rmSync(path.join(vaultPath, ".pige/db/vault.sqlite"), { force: true });
    expect(service.listPages(vaultPath)?.total).toBe(1);
    expect(readTagProjection(vaultPath)).toEqual({
      tags: ["durable knowledge", "research"],
      pageTags: [
        { pageId: "page_20260709_tags1234", tag: "durable knowledge" },
        { pageId: "page_20260709_tags1234", tag: "research" }
      ],
      revision: 3
    });
  });

  it("rebuilds after database deletion without losing Markdown knowledge", () => {
    const vaultPath = makeVaultRoot();
    const service = new LocalDatabaseService();
    writePage(vaultPath, "wiki/rebuild.md", {
      id: "page_20260709_rebuild1",
      title: "Rebuildable Knowledge",
      body: "The database can disappear while Markdown remains durable."
    });
    service.rebuild(vaultPath);
    fs.rmSync(path.join(vaultPath, ".pige/db/vault.sqlite"), { force: true });

    const result = service.listPages(vaultPath);

    expect(result?.total).toBe(1);
    expect(result?.pages[0]?.title).toBe("Rebuildable Knowledge");
  });

  it("keeps the previous committed index readable when rebuild progress fails", () => {
    const vaultPath = makeVaultRoot();
    const driver = new NodeSqliteDriver();
    writePage(vaultPath, "wiki/transaction.md", {
      id: "page_20260709_transaction",
      title: "Committed Before Rebuild",
      body: "Readers keep using this committed index while a replacement transaction is running."
    });
    driver.rebuild(vaultPath);
    writePage(vaultPath, "wiki/transaction.md", {
      id: "page_20260709_transaction",
      title: "Uncommitted Replacement",
      body: "This replacement must roll back when the rebuild worker fails."
    });

    let observedDuringRebuild: string | undefined;
    expect(() => driver.rebuild(vaultPath, {
      onProgress: (progress) => {
        if (progress.completedUnits !== 1) return;
        const reader = openReadOnlyDatabase(vaultPath);
        try {
          observedDuringRebuild = String(reader.prepare("SELECT title FROM pages").get()?.title ?? "");
        } finally {
          reader.close();
        }
        throw new Error("injected rebuild failure");
      }
    })).toThrow("injected rebuild failure");

    const reader = openReadOnlyDatabase(vaultPath);
    try {
      expect(observedDuringRebuild).toBe("Committed Before Rebuild");
      expect(reader.prepare("SELECT title FROM pages").get()?.title).toBe("Committed Before Rebuild");
      expect(reader.prepare("SELECT COUNT(*) AS count FROM pages_fts").get()?.count).toBe(1);
    } finally {
      reader.close();
    }
  });

  it("detects external Markdown edits and refreshes the FTS index", () => {
    const vaultPath = makeVaultRoot();
    const service = new LocalDatabaseService();
    writePage(vaultPath, "wiki/external.md", {
      id: "page_20260709_external",
      title: "External Edit",
      body: "Initial body."
    });
    service.rebuild(vaultPath);
    writePage(vaultPath, "wiki/external.md", {
      id: "page_20260709_external",
      title: "External Edit",
      body: "External editors can add nebula retrieval notes."
    });

    const result = service.searchPages(vaultPath, { query: "nebula retrieval" });

    expect(result?.total).toBe(1);
    expect(result?.results[0]?.snippets[0]).toContain("nebula retrieval");
  });
});

function openReadOnlyDatabase(vaultPath: string): DatabaseSync {
  return new DatabaseSync(path.join(vaultPath, ".pige/db/vault.sqlite"), {
    readOnly: true,
    allowExtension: false
  });
}

function readTagProjection(vaultPath: string): {
  readonly tags: readonly string[];
  readonly pageTags: readonly { readonly pageId: string; readonly tag: string }[];
  readonly revision: number;
} {
  const reader = openReadOnlyDatabase(vaultPath);
  try {
    return {
      tags: reader.prepare("SELECT tag FROM tags ORDER BY tag").all().map((row) => String(row.tag)),
      pageTags: reader.prepare("SELECT page_id, tag FROM page_tags ORDER BY page_id, tag").all().map((row) => ({
        pageId: String(row.page_id),
        tag: String(row.tag)
      })),
      revision: Number(reader.prepare("PRAGMA user_version").get()?.user_version ?? 0)
    };
  } finally {
    reader.close();
  }
}

function writePage(vaultPath: string, relativePath: string, input: {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly type?: string;
  readonly language?: string;
  readonly tags?: readonly string[];
}): void {
  const filePath = path.join(vaultPath, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---
id: "${input.id}"
schema_version: 1
title: "${input.title}"
type: "${input.type ?? "note"}"
created_at: "2026-07-09T12:00:00.000Z"
updated_at: "2026-07-09T12:00:00.000Z"
status: "active"
language: "${input.language ?? "en"}"
tags: ${JSON.stringify(input.tags ?? [])}
source_ids: []
---

${input.body}
`, "utf8");
}

function writeRawPage(
  vaultPath: string,
  relativePath: string,
  pageId: string,
  tagsLine: string
): void {
  const filePath = path.join(vaultPath, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---
id: "${pageId}"
schema_version: 1
title: "Invalid Tags"
type: "note"
created_at: "2026-07-09T12:00:00.000Z"
updated_at: "2026-07-09T12:00:00.000Z"
status: "active"
language: "en"
${tagsLine}
source_ids: []
---

This page must be counted as invalid without aborting the rebuild.
`, "utf8");
}
