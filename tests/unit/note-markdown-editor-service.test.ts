import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OperationRecord } from "@pige/schemas";
import {
  NoteMarkdownEditorService,
  type NoteMarkdownEditorActivityPort
} from "../../apps/desktop/src/main/services/note-markdown-editor-service";

const PAGE_ID = "page_20260727_markdowneditor";
const VAULT_ID = "vault_20260727_markdowneditor";
const SOURCE_ID = "src_20260727_markdowneditor";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("NoteMarkdownEditorService", () => {
  it("opens and atomically saves exact portable Markdown with one update_page Activity record", () => {
    const fixture = createFixture();
    const opened = fixture.service.open({ activeVaultId: VAULT_ID, pageId: PAGE_ID });
    expect(opened).toMatchObject({ status: "opened", activeVaultId: VAULT_ID, pageId: PAGE_ID });
    if (opened.status !== "opened") throw new Error("Expected an opened Markdown page.");

    const next = opened.markdown.replace(
      "Original body.",
      `Edited body with [[Related page|context]] and [source:${SOURCE_ID}#p1].`
    );
    const result = fixture.service.save({
      requestId: "request_markdown_editor_save",
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      markdown: next
    });

    expect(result).toMatchObject({
      status: "committed",
      requestId: "request_markdown_editor_save",
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID
    });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(next);
    expect(fixture.records).toHaveLength(1);
    expect(fixture.records[0]).toMatchObject({
      vaultPath: fixture.vaultPath,
      beforeMarkdown: fixture.markdown,
      afterMarkdown: next,
      operation: {
        id: result.status === "committed" ? result.operationId : "missing",
        schemaVersion: 1,
        actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
        kind: "update_page",
        targetRefs: [{ kind: "page", id: PAGE_ID, path: `wiki/${PAGE_ID}.md` }],
        sourceRefs: [],
        before: {
          kind: "page",
          id: opened.revisionId,
          path: expect.stringMatching(/^\.pige\/operations\/2026\/07\/op_20260727_[a-f0-9]{16}\.before\.md$/u)
        },
        after: {
          kind: "page",
          id: result.status === "committed" ? result.revisionId : "missing",
          path: `wiki/${PAGE_ID}.md`
        },
        reversible: "yes",
        warnings: []
      }
    });
  });

  it("fails stale without side effects after an external edit", () => {
    const fixture = createFixture();
    const opened = requireOpened(fixture.service);
    const external = fixture.markdown.replace("Original body.", "External body.");
    fs.writeFileSync(fixture.pagePath, external, "utf8");

    expect(fixture.service.save({
      requestId: "request_external_stale",
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      markdown: fixture.markdown.replace("Original body.", "Local body.")
    })).toMatchObject({ status: "stale" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(external);
    expect(fixture.records).toEqual([]);
  });

  it("fails stale when the named file is externally replaced with a different stable page identity", () => {
    const fixture = createFixture();
    const opened = requireOpened(fixture.service);
    const replacement = fixture.markdown.replace(PAGE_ID, "page_20260727_replacedidentity");
    fs.writeFileSync(fixture.pagePath, replacement, "utf8");

    expect(fixture.service.save({
      requestId: "request_identity_stale",
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      markdown: fixture.markdown.replace("Original body.", "Local body.")
    })).toMatchObject({ status: "stale" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(replacement);
    expect(fixture.records).toEqual([]);
  });

  it("rejects invalid page identities and invalid frontmatter, wiki links, and citations", () => {
    const fixture = createFixture();
    expect(fixture.service.open({ activeVaultId: VAULT_ID, pageId: "../outside" })).toEqual({ status: "invalid" });
    const opened = requireOpened(fixture.service);

    for (const invalid of [
      fixture.markdown.replace(PAGE_ID, "page_20260727_differentpage"),
      fixture.markdown.replace("schema_version: 1", "schema_version: 2"),
      fixture.markdown.replace("Original body.", "Broken [[wiki link."),
      fixture.markdown.replace("Original body.", `[source:${SOURCE_ID}#bad locator]`)
    ]) {
      expect(fixture.service.save({
        requestId: "request_invalid_markdown",
        activeVaultId: VAULT_ID,
        pageId: PAGE_ID,
        expectedRevisionId: opened.revisionId,
        renderIdentity: opened.renderIdentity,
        markdown: invalid
      })).toMatchObject({ status: "invalid" });
    }
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.markdown);
    expect(fixture.records).toEqual([]);
  });

  it("fails closed when a governed Markdown parent becomes a symlink", () => {
    const fixture = createFixture();
    const opened = requireOpened(fixture.service);
    const realWiki = path.join(fixture.vaultPath, "wiki-real");
    const outside = path.join(fixture.root, "outside");
    fs.renameSync(path.join(fixture.vaultPath, "wiki"), realWiki);
    fs.mkdirSync(outside);
    const sentinel = path.join(outside, `${PAGE_ID}.md`);
    fs.writeFileSync(sentinel, "outside sentinel", "utf8");
    fs.symlinkSync(outside, path.join(fixture.vaultPath, "wiki"), "dir");

    expect(fixture.service.save({
      requestId: "request_symlink_parent",
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      markdown: fixture.markdown.replace("Original body.", "Must not commit.")
    })).toMatchObject({ status: "stale" });
    expect(fs.readFileSync(sentinel, "utf8")).toBe("outside sentinel");
    expect(fs.readFileSync(path.join(realWiki, `${PAGE_ID}.md`), "utf8")).toBe(fixture.markdown);
    expect(fixture.records).toEqual([]);
  });

  it("returns not_found when the exact opened page is removed before save", () => {
    const fixture = createFixture();
    const opened = requireOpened(fixture.service);
    fs.unlinkSync(fixture.pagePath);
    expect(fixture.service.save({
      requestId: "request_missing_page",
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      markdown: fixture.markdown.replace("Original body.", "Local body.")
    })).toMatchObject({ status: "not_found" });
    expect(fixture.records).toEqual([]);
  });
});

interface ActivityRecord {
  readonly vaultPath: string;
  readonly operation: OperationRecord;
  readonly beforeMarkdown: string;
  readonly afterMarkdown: string;
}

function createFixture(): {
  readonly root: string;
  readonly vaultPath: string;
  readonly pagePath: string;
  readonly markdown: string;
  readonly records: ActivityRecord[];
  readonly service: NoteMarkdownEditorService;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-note-markdown-editor-"));
  roots.push(root);
  const vaultPath = path.join(root, "vault");
  const pagePath = path.join(vaultPath, "wiki", `${PAGE_ID}.md`);
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  const markdown = createMarkdown();
  fs.writeFileSync(pagePath, markdown, { encoding: "utf8", mode: 0o600 });
  const records: ActivityRecord[] = [];
  const activity: NoteMarkdownEditorActivityPort = {
    recordPageUpdate: (input) => records.push(input)
  };
  const service = new NoteMarkdownEditorService(
    {
      current: () => ({
        vaultId: VAULT_ID,
        name: "Markdown editor vault",
        activeVaultPathDisplay: "Markdown editor vault",
        knowledgeRootDisplay: "Markdown editor vault",
        sourceAssetRootDisplay: "Markdown editor sources",
        sourceAssetRootKind: "vault_internal",
        defaultSourceStorageStrategy: "managed_copy",
        schemaVersion: 1
      }),
      activeVaultPath: () => vaultPath
    },
    activity,
    {
      now: () => new Date("2026-07-27T12:00:00.000Z"),
      randomId: () => "fixture-random-id"
    }
  );
  return { root, vaultPath, pagePath, markdown, records, service };
}

function requireOpened(service: NoteMarkdownEditorService) {
  const opened = service.open({ activeVaultId: VAULT_ID, pageId: PAGE_ID });
  if (opened.status !== "opened") throw new Error("Expected an opened Markdown page.");
  return opened;
}

function createMarkdown(): string {
  return `---
id: "${PAGE_ID}"
schema_version: 1
title: "Markdown editor fixture"
type: "note"
created_at: "2026-07-27T10:00:00.000Z"
updated_at: "2026-07-27T10:00:00.000Z"
status: "active"
language: "en"
aliases: []
tags: ["editing"]
topics: []
source_ids: ["${SOURCE_ID}"]
---

# Markdown editor fixture

Original body.
`;
}
