import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LocalDatabaseService,
  NodeSqliteDriver
} from "../../apps/desktop/src/main/services/local-database-service";
import {
  listMarkdownTagCatalog,
  readMarkdownPageBody
} from "../../apps/desktop/src/main/services/markdown-page-index";
import { sanitizeSearchBody } from "../../apps/desktop/src/main/services/search-text-utils";

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
    expect(status.appSchemaVersion).toBe(2);
    expect(status.appliedMigrationCount).toBe(2);
    expect(state.driver).toBe("node_sqlite");
    expect(state.appliedMigrations).toHaveLength(2);
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

  it("rebuilds exact-range chunk metadata without persisting chunk text", () => {
    const vaultPath = makeVaultRoot();
    const service = new LocalDatabaseService();
    const relativePath = "wiki/chunk-metadata.md";
    writePage(vaultPath, relativePath, {
      id: "page_20260715_chunkmeta",
      title: "Chunk Metadata",
      sourceIds: ["src_20260715_sourcebbbb", "src_20260715_sourceaaaa"],
      body: `Preamble evidence.

managed_copy: synthetic-reference

# Alpha
${"alpha retrieval evidence. ".repeat(75)}

## Beta
Beta conclusion.`
    });

    service.rebuild(vaultPath);
    const status = service.chunkIndexStatus(vaultPath);
    const pageBody = readMarkdownPageBody(path.join(vaultPath, relativePath));
    const reader = openReadOnlyDatabase(vaultPath);
    try {
      const columns = reader.prepare("PRAGMA table_info(chunks)").all().map((row) => String(row.name));
      const rows = reader.prepare(`
        SELECT chunk_id, owner_id, source_ids_json, heading_path_json,
          character_start, character_end, text_hash, token_count, chunker_version
        FROM chunks ORDER BY character_start
      `).all();
      const searchBody = String(reader.prepare("SELECT body FROM pages_fts").get()?.body ?? "");

      expect(status).toMatchObject({
        indexedPageCount: 1,
        chunkCount: rows.length,
        chunkerVersion: "pige-markdown-v1",
        indexRevision: 4
      });
      expect(rows.length).toBeGreaterThan(2);
      expect(columns).not.toContain("body");
      expect(columns).not.toContain("text");
      expect(searchBody).not.toContain("managed_copy");
      for (const row of rows) {
        const start = Number(row.character_start);
        const end = Number(row.character_end);
        const text = pageBody.slice(start, end);
        expect(row.chunk_id).toMatch(/^chunk_[a-f0-9]{32}$/u);
        expect(row.owner_id).toBe("page_20260715_chunkmeta");
        expect(JSON.parse(String(row.source_ids_json))).toEqual([
          "src_20260715_sourceaaaa",
          "src_20260715_sourcebbbb"
        ]);
        expect(JSON.parse(String(row.heading_path_json))).toEqual(expect.any(Array));
        expect(row.text_hash).toBe(`sha256:${createHash("sha256").update(sanitizeSearchBody(text)).digest("hex")}`);
        expect(Number(row.token_count)).toBeGreaterThan(0);
        expect(row.chunker_version).toBe("pige-markdown-v1");
      }
      expect(rows.some((row) => JSON.stringify(JSON.parse(String(row.heading_path_json))) === '["Alpha"]')).toBe(true);
      expect(rows.at(-1)?.heading_path_json).toBe('["Alpha","Beta"]');
    } finally {
      reader.close();
    }

    const firstIds = readChunkIds(vaultPath);
    service.rebuild(vaultPath);
    expect(readChunkIds(vaultPath)).toEqual(firstIds);
  });

  it("replaces the skeletal derived chunk schema without preserving stale rows", () => {
    const vaultPath = makeVaultRoot();
    const service = new LocalDatabaseService();
    service.initialize(vaultPath);

    const databasePath = path.join(vaultPath, ".pige/db/vault.sqlite");
    const oldDatabase = new DatabaseSync(databasePath, { allowExtension: false });
    try {
      oldDatabase.exec(`
        DELETE FROM schema_migrations WHERE id = '002_rebuildable_chunk_metadata';
        DROP TABLE vault_files;
        CREATE TABLE vault_files (
          path TEXT PRIMARY KEY,
          page_id TEXT,
          file_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          mtime_ms INTEGER NOT NULL
        );
        CREATE INDEX vault_files_page_id_idx ON vault_files(page_id);
        DROP TABLE chunks;
        CREATE TABLE chunks (
          chunk_id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          owner_type TEXT NOT NULL,
          text_hash TEXT NOT NULL,
          token_count INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO chunks(chunk_id, owner_id, owner_type, text_hash, token_count)
          VALUES ('stale_chunk', 'page_stale', 'page', 'sha256:stale', 1);
      `);
    } finally {
      oldDatabase.close();
    }

    const statePath = path.join(vaultPath, ".pige/db/schema-state.json");
    const oldState = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
      appSchemaVersion: number;
      appliedMigrations: unknown[];
    };
    oldState.appSchemaVersion = 1;
    oldState.appliedMigrations = oldState.appliedMigrations.slice(0, 1);
    fs.writeFileSync(statePath, `${JSON.stringify(oldState, null, 2)}\n`, "utf8");

    const status = service.status(vaultPath);
    const reader = openReadOnlyDatabase(vaultPath);
    try {
      const columns = reader.prepare("PRAGMA table_info(chunks)").all().map((row) => String(row.name));
      expect(status).toMatchObject({ appSchemaVersion: 2, appliedMigrationCount: 2, status: "ready" });
      expect(columns).toContain("heading_path_json");
      expect(columns).toContain("character_start");
      expect(columns).not.toContain("body");
      expect(reader.prepare("SELECT COUNT(*) AS count FROM chunks").get()?.count).toBe(0);
      expect(reader.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()?.count).toBe(2);
    } finally {
      reader.close();
    }
  });

  it("recovers a malformed derived schema-state file from the SQLite migration truth", () => {
    const vaultPath = makeVaultRoot();
    const service = new LocalDatabaseService();
    service.initialize(vaultPath);
    const statePath = path.join(vaultPath, ".pige/db/schema-state.json");
    fs.writeFileSync(statePath, "{\"partial\":", "utf8");

    expect(service.status(vaultPath)).toMatchObject({
      driver: "node_sqlite",
      appSchemaVersion: 2,
      appliedMigrationCount: 2,
      status: "ready"
    });
    expect(JSON.parse(fs.readFileSync(statePath, "utf8"))).toMatchObject({
      driver: "node_sqlite",
      appSchemaVersion: 2
    });
    expect(fs.readdirSync(path.dirname(statePath)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
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
      revision: 4
    });

    fs.rmSync(path.join(vaultPath, ".pige/db/vault.sqlite"), { force: true });
    expect(service.listPages(vaultPath)?.total).toBe(1);
    expect(readTagProjection(vaultPath)).toEqual({
      tags: ["durable knowledge", "research"],
      pageTags: [
        { pageId: "page_20260709_tags1234", tag: "durable knowledge" },
        { pageId: "page_20260709_tags1234", tag: "research" }
      ],
      revision: 4
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

  it("detects same-size external replacement even when mtime is restored", () => {
    const vaultPath = makeVaultRoot();
    const service = new LocalDatabaseService();
    const relativePath = "wiki/same-size.md";
    writePage(vaultPath, relativePath, {
      id: "page_20260715_samesize1",
      title: "Same Size",
      body: "alpha"
    });
    service.rebuild(vaultPath);
    const filePath = path.join(vaultPath, relativePath);
    const before = fs.statSync(filePath);
    const original = fs.readFileSync(filePath, "utf8");
    fs.writeFileSync(filePath, original.replace("alpha", "bravo"), "utf8");
    fs.utimesSync(filePath, before.atime, before.mtime);

    const result = service.searchPages(vaultPath, { query: "bravo" });

    expect(result?.total).toBe(1);
    expect(result?.results[0]?.snippets[0]).toContain("bravo");
  });

  it("rejects a symlinked Markdown root instead of indexing outside the vault", () => {
    const vaultPath = makeVaultRoot();
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-db-outside-"));
    tempRoots.push(externalRoot);
    fs.mkdirSync(path.join(externalRoot, "wiki"), { recursive: true });
    writePage(externalRoot, "wiki/outside.md", {
      id: "page_20260715_outside1",
      title: "Outside",
      body: "This external file must never enter the vault index."
    });
    fs.symlinkSync(
      path.join(externalRoot, "wiki"),
      path.join(vaultPath, "wiki"),
      process.platform === "win32" ? "junction" : "dir"
    );

    expect(() => new LocalDatabaseService().rebuild(vaultPath)).toThrow("real directories");
  });

  it.runIf(process.platform !== "win32")(
    "rejects a same-name successor installed while a held Markdown descriptor is read",
    () => {
      const vaultPath = makeVaultRoot();
      const relativePath = "wiki/held-read.md";
      writePage(vaultPath, relativePath, {
        id: "page_20260715_heldread1",
        title: "Held Read",
        body: "The original inode must remain bound through body readback."
      });
      const filePath = path.join(vaultPath, relativePath);
      const retiredPath = `${filePath}.retired`;
      const originalRead = fs.readSync.bind(fs);
      let readCalls = 0;
      let replaced = false;
      const readSpy = vi.spyOn(fs, "readSync").mockImplementation(((
        fileDescriptor: number,
        buffer: NodeJS.ArrayBufferView,
        offset: number,
        length: number,
        position: fs.ReadPosition | null
      ) => {
        const result = originalRead(fileDescriptor, buffer, offset, length, position);
        readCalls += 1;
        if (readCalls === 2 && !replaced) {
          replaced = true;
          fs.renameSync(filePath, retiredPath);
          fs.writeFileSync(filePath, fs.readFileSync(retiredPath));
        }
        return result;
      }) as typeof fs.readSync);
      try {
        expect(() => new LocalDatabaseService().rebuild(vaultPath)).toThrow(
          "Markdown changed while the local index was rebuilding"
        );
      } finally {
        readSpy.mockRestore();
      }
      expect(replaced).toBe(true);
    }
  );

  it("detects an invalid Markdown file becoming valid through the signature-only warm check", () => {
    const vaultPath = makeVaultRoot();
    const service = new LocalDatabaseService();
    writeRawPage(vaultPath, "wiki/repaired.md", "page_20260715_repaired1", "tags: Research");
    const filePath = path.join(vaultPath, "wiki/repaired.md");
    fs.writeFileSync(filePath, "---\nid: broken\n---\ninvalid\n", "utf8");
    expect(service.rebuild(vaultPath)).toMatchObject({ pageCount: 0, invalidPageCount: 1 });

    writePage(vaultPath, "wiki/repaired.md", {
      id: "page_20260715_repaired1",
      title: "Repaired Page",
      body: "A repaired page must replace the invalid index entry immediately."
    });

    expect(service.listPages(vaultPath)).toMatchObject({ total: 1, invalidPageCount: 0 });
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

function readChunkIds(vaultPath: string): readonly string[] {
  const reader = openReadOnlyDatabase(vaultPath);
  try {
    return reader.prepare("SELECT chunk_id FROM chunks ORDER BY chunk_id").all().map((row) => String(row.chunk_id));
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
  readonly sourceIds?: readonly string[];
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
source_ids: ${JSON.stringify(input.sourceIds ?? [])}
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
