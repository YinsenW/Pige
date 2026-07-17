import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { LocalDatabaseService } from "../../apps/desktop/src/main/services/local-database-service";
import { NotesService } from "../../apps/desktop/src/main/services/notes-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const tempRoots: string[] = [];

function makeVault(): { vaultPath: string; vault: VaultSummary } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-notes-test-"));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Notes",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-09T12:00:00.000Z")
  });
  const vaultPath = path.join(root, "Notes");
  return { vaultPath, vault: loadVaultSummary(vaultPath) };
}

function makeNotes(vaultPath: string, vault: VaultSummary): NotesService {
  return new NotesService({
    current: () => vault,
    activeVaultPath: () => vaultPath
  });
}

function writePage(input: {
  readonly vaultPath: string;
  readonly fileName: string;
  readonly pageId: string;
  readonly title: string;
  readonly pageType?: "note" | "source";
  readonly aliases?: readonly string[];
  readonly sourceIds?: readonly string[];
  readonly body?: string;
}): void {
  const pagePath = path.join(input.vaultPath, input.pageType === "source" ? "sources" : "wiki", input.fileName);
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.writeFileSync(pagePath, `---
id: "${input.pageId}"
schema_version: 1
title: "${input.title}"
type: "${input.pageType ?? "note"}"
created_at: "2026-07-09T12:00:00.000Z"
updated_at: "2026-07-09T12:00:00.000Z"
status: "active"
aliases: ${JSON.stringify(input.aliases ?? [])}
source_ids: ${JSON.stringify(input.sourceIds ?? [])}
---

# ${input.title}

${input.body ?? ""}
`, "utf8");
}

function makeIndexedNotes(vaultPath: string, vault: VaultSummary): NotesService {
  const database = new LocalDatabaseService();
  database.rebuild(vaultPath);
  return new NotesService({
    current: () => vault,
    activeVaultPath: () => vaultPath
  }, database);
}

function writeSourceRecord(input: {
  readonly vaultPath: string;
  readonly sourceId: string;
  readonly pageId?: string;
  readonly pagePath?: string;
}): void {
  const dateKey = /^src_(\d{8})_/u.exec(input.sourceId)?.[1];
  if (!dateKey) throw new Error("Test source ID is invalid.");
  const recordPath = path.join(
    input.vaultPath,
    ".pige",
    "source-records",
    dateKey.slice(0, 4),
    dateKey.slice(4, 6),
    `${input.sourceId}.json`
  );
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  fs.writeFileSync(recordPath, JSON.stringify({
    schemaVersion: 1,
    id: input.sourceId,
    kind: "text",
    storageStrategy: "reference_original",
    semanticOrchestration: "capture_only",
    ...(input.pageId ? { knowledgePageId: input.pageId } : {}),
    ...(input.pagePath ? { knowledgePagePath: input.pagePath } : {}),
    original: { uri: `pige-test://${input.sourceId}` },
    artifacts: [],
    metadata: {},
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z"
  }), "utf8");
}

const OWNER_ID = "notes_owner_test";
const REQUEST_ID = "noteref_abcdefghijklmnop";

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => { resolve = done; }),
    resolve
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("notes service", () => {
  it("reads and renders a vault Markdown page by stable page ID", async () => {
    const { vaultPath, vault } = makeVault();
    const notes = makeNotes(vaultPath, vault);
    const pagePath = path.join(vaultPath, "wiki", "reader.md");
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(pagePath, `---
id: "page_20260709_abcd1234"
schema_version: 1
title: "Reader Page"
type: "note"
created_at: "2026-07-09T12:00:00.000Z"
updated_at: "2026-07-09T12:00:00.000Z"
status: "active"
language: "en"
source_ids: ["src_20260709_abcd1234"]
---

# Reader Page

[[Topic]]

<script>alert("x")</script>
`, "utf8");

    const document = notes.get({ pageId: "page_20260709_abcd1234" });
    const rendered = await notes.render({ pageId: "page_20260709_abcd1234" });

    expect(document.summary.title).toBe("Reader Page");
    expect(document.summary.pagePath).toBe("wiki/reader.md");
    expect(document.markdownBody).not.toContain("schema_version");
    expect(rendered.html).toContain("<h1>Reader Page</h1>");
    expect(rendered.html).toContain('href="#wiki:Topic"');
    expect(rendered.html).not.toContain("<script");
  });

  it("does not open files outside the Library page roots", () => {
    const { vaultPath, vault } = makeVault();
    const notes = makeNotes(vaultPath, vault);
    fs.writeFileSync(path.join(vaultPath, "outside.md"), `---
id: "page_20260709_outside1234"
schema_version: 1
title: "Outside"
type: "note"
created_at: "2026-07-09T12:00:00.000Z"
updated_at: "2026-07-09T12:00:00.000Z"
status: "active"
---

# Outside
`, "utf8");

    expect(() => notes.get({ pageId: "page_20260709_outside1234" })).toThrow(PigeDomainError);
  });

  it("does not return network-capable links or images to the renderer", async () => {
    const { vaultPath, vault } = makeVault();
    const notes = makeNotes(vaultPath, vault);
    const pagePath = path.join(vaultPath, "wiki", "remote-content.md");
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(pagePath, `---
id: "page_20260709_remote1234"
schema_version: 1
title: "Remote Content"
type: "note"
created_at: "2026-07-09T12:00:00.000Z"
updated_at: "2026-07-09T12:00:00.000Z"
status: "active"
---

[External](https://example.com/private)
![Remote](//example.com/tracker.png)
[[Safe Wiki]]
`, "utf8");

    const rendered = await notes.render({ pageId: "page_20260709_remote1234" });

    expect(rendered.html).not.toContain('href="https:');
    expect(rendered.html).not.toContain('src="//');
    expect(rendered.html).toContain('href="#wiki:Safe%20Wiki"');
  });

  it("keeps only the latest sender render and does not revive a released owner", async () => {
    const { vaultPath, vault } = makeVault();
    writePage({
      vaultPath,
      fileName: "first.md",
      pageId: "page_20260709_first1234",
      title: "First",
      body: "[[First]]"
    });
    writePage({
      vaultPath,
      fileName: "second.md",
      pageId: "page_20260709_second1234",
      title: "Second",
      body: "[[Second]]"
    });
    const first = deferred<{ readonly html: string }>();
    const second = deferred<{ readonly html: string }>();
    const notes = new NotesService({
      current: () => vault,
      activeVaultPath: () => vaultPath
    }, undefined, (markdown) => markdown.includes("# First") ? first.promise : second.promise);

    const firstRender = notes.render({ pageId: "page_20260709_first1234" }, OWNER_ID);
    const secondRender = notes.render({ pageId: "page_20260709_second1234" }, OWNER_ID);
    second.resolve({ html: '<a href="#wiki:Second">Second</a>' });
    const current = await secondRender;
    first.resolve({ html: '<a href="#wiki:First">First</a>' });

    await expect(firstRender).rejects.toMatchObject({ code: "note_changed" });
    expect(current.renderContextId).toBeDefined();
    notes.releaseOwner(OWNER_ID);
    expect(notes.resolveInlineReference(OWNER_ID, {
      apiVersion: 1,
      requestId: REQUEST_ID,
      activeVaultId: vault.vaultId,
      currentPageId: "page_20260709_second1234",
      renderContextId: current.renderContextId!,
      href: "#wiki:Second"
    })).toEqual({
      apiVersion: 1,
      requestId: REQUEST_ID,
      status: "stale",
      scope: "render_context"
    });
  });

  it("decodes rendered href entities exactly once when binding a render context", async () => {
    const { vaultPath, vault } = makeVault();
    writePage({
      vaultPath,
      fileName: "current.md",
      pageId: "page_20260709_current1234",
      title: "Current"
    });
    writePage({
      vaultPath,
      fileName: "target.md",
      pageId: "page_20260709_target1234",
      title: "Target"
    });
    const database = new LocalDatabaseService();
    database.rebuild(vaultPath);
    const notes = new NotesService({
      current: () => vault,
      activeVaultPath: () => vaultPath
    }, database, async () => ({
      html: '<a href="#wiki:Target">Target</a><a href="#wiki:Target&amp;quot;Suffix">Nested entity</a>'
    }));

    const rendered = await notes.render({ pageId: "page_20260709_current1234" }, OWNER_ID);
    expect(rendered.renderContextId).toBeDefined();
    expect(notes.resolveInlineReference(OWNER_ID, {
      apiVersion: 1,
      requestId: `${REQUEST_ID}1`,
      activeVaultId: vault.vaultId,
      currentPageId: "page_20260709_current1234",
      renderContextId: rendered.renderContextId!,
      href: "#wiki:Target"
    })).toEqual({
      apiVersion: 1,
      requestId: `${REQUEST_ID}1`,
      status: "resolved",
      target: { kind: "page", pageId: "page_20260709_target1234" }
    });
    expect(notes.resolveInlineReference(OWNER_ID, {
      apiVersion: 1,
      requestId: `${REQUEST_ID}2`,
      activeVaultId: vault.vaultId,
      currentPageId: "page_20260709_current1234",
      renderContextId: rendered.renderContextId!,
      href: "#wiki:Target&quot;Suffix"
    })).toEqual({
      apiVersion: 1,
      requestId: `${REQUEST_ID}2`,
      status: "failed"
    });
  });

  it("rejects an in-flight render after its owner is released or active vault changes", async () => {
    const first = makeVault();
    const second = makeVault();
    writePage({
      vaultPath: first.vaultPath,
      fileName: "current.md",
      pageId: "page_20260709_current1234",
      title: "Current"
    });
    let active = first;
    const released = deferred<{ readonly html: string }>();
    const switched = deferred<{ readonly html: string }>();
    let renderCount = 0;
    const notes = new NotesService({
      current: () => active.vault,
      activeVaultPath: () => active.vaultPath
    }, undefined, () => (renderCount++ === 0 ? released.promise : switched.promise));

    const releasedRender = notes.render({ pageId: "page_20260709_current1234" }, OWNER_ID);
    notes.releaseOwner(OWNER_ID);
    released.resolve({ html: "<p>released</p>" });
    await expect(releasedRender).rejects.toMatchObject({ code: "note_changed" });

    const switchedRender = notes.render({ pageId: "page_20260709_current1234" }, OWNER_ID);
    active = second;
    switched.resolve({ html: "<p>switched</p>" });
    await expect(switchedRender).rejects.toMatchObject({ code: "note_changed" });
  });

  it("bounds Reader page bytes before returning Markdown or rendered HTML", async () => {
    const { vaultPath, vault } = makeVault();
    writePage({
      vaultPath,
      fileName: "oversized.md",
      pageId: "page_20260709_oversize1234",
      title: "Oversized"
    });
    fs.truncateSync(path.join(vaultPath, "wiki", "oversized.md"), (4 * 1024 * 1024) + 1);
    const notes = makeNotes(vaultPath, vault);

    try {
      notes.get({ pageId: "page_20260709_oversize1234" });
      throw new Error("Expected the oversized Reader page to be rejected.");
    } catch (caught) {
      expect(caught).toBeInstanceOf(PigeDomainError);
      expect((caught as PigeDomainError).code).toBe("note_too_large");
    }
  });

  it("resolves unique wiki IDs, multilingual titles, aliases, and slugs from one owned render context", async () => {
    const { vaultPath, vault } = makeVault();
    const hrefs = [
      "#wiki:page_20260709_target1234",
      "#wiki:%E4%BA%A7%E5%93%81%E5%AE%9A%E4%BD%8D",
      "#wiki:Product%20North%20Star",
      "#wiki:product-positioning",
      "#wiki:wiki%2Fproduct-positioning"
    ];
    writePage({
      vaultPath,
      fileName: "current.md",
      pageId: "page_20260709_current1234",
      title: "Current",
      body: hrefs.map((href, index) => `[Ref ${index}](${href})`).join("\n")
    });
    writePage({
      vaultPath,
      fileName: "product-positioning.md",
      pageId: "page_20260709_target1234",
      title: "产品定位",
      aliases: ["Positioning", "Product North Star"]
    });
    const notes = makeIndexedNotes(vaultPath, vault);
    const rendered = await notes.render({ pageId: "page_20260709_current1234" }, OWNER_ID);
    expect(rendered.renderContextId).toBeDefined();

    for (const [index, href] of hrefs.entries()) {
      expect(notes.resolveInlineReference(OWNER_ID, {
        apiVersion: 1,
        requestId: `${REQUEST_ID}${index}`,
        activeVaultId: vault.vaultId,
        currentPageId: "page_20260709_current1234",
        renderContextId: rendered.renderContextId!,
        href
      })).toEqual({
        apiVersion: 1,
        requestId: `${REQUEST_ID}${index}`,
        status: "resolved",
        target: { kind: "page", pageId: "page_20260709_target1234" }
      });
    }
  });

  it("prioritizes an exact stable page ID and fails closed for title or alias ambiguity", async () => {
    const { vaultPath, vault } = makeVault();
    const stableId = "page_20260709_first1234";
    writePage({
      vaultPath,
      fileName: "current.md",
      pageId: "page_20260709_current1234",
      title: "Current",
      body: `[[Shared]]\n[[Collision]]\n[[${stableId}]]`
    });
    writePage({
      vaultPath,
      fileName: "first.md",
      pageId: stableId,
      title: "Shared",
      aliases: ["Collision"]
    });
    writePage({
      vaultPath,
      fileName: "second.md",
      pageId: "page_20260709_second1234",
      title: "Shared",
      aliases: ["Collision", stableId]
    });
    const notes = makeIndexedNotes(vaultPath, vault);
    const rendered = await notes.render({ pageId: "page_20260709_current1234" }, OWNER_ID);
    const request = (href: string, suffix: string) => notes.resolveInlineReference(OWNER_ID, {
      apiVersion: 1,
      requestId: `${REQUEST_ID}${suffix}`,
      activeVaultId: vault.vaultId,
      currentPageId: "page_20260709_current1234",
      renderContextId: rendered.renderContextId!,
      href
    });

    expect(request("#wiki:Shared", "a")).toEqual({
      apiVersion: 1,
      requestId: `${REQUEST_ID}a`,
      status: "ambiguous"
    });
    expect(request("#wiki:Collision", "b")).toEqual({
      apiVersion: 1,
      requestId: `${REQUEST_ID}b`,
      status: "ambiguous"
    });
    expect(request(`#wiki:${stableId}`, "c")).toEqual({
      apiVersion: 1,
      requestId: `${REQUEST_ID}c`,
      status: "resolved",
      target: { kind: "page", pageId: stableId }
    });
  });

  it("resolves source references through the durable SourceRecord knowledge-page owner", async () => {
    const { vaultPath, vault } = makeVault();
    const sourceId = "src_20260709_source1234";
    const href = `#source:${sourceId}#utf8_bytes:10:24`;
    writePage({
      vaultPath,
      fileName: "current.md",
      pageId: "page_20260709_current1234",
      title: "Current",
      body: `[source:${sourceId}#utf8_bytes:10:24]`
    });
    writePage({
      vaultPath,
      fileName: "source.md",
      pageId: "page_20260709_source1234",
      title: "Source",
      pageType: "source",
      sourceIds: [sourceId]
    });
    writeSourceRecord({
      vaultPath,
      sourceId,
      pageId: "page_20260709_source1234",
      pagePath: "sources/source.md"
    });
    const notes = makeIndexedNotes(vaultPath, vault);
    const rendered = await notes.render({ pageId: "page_20260709_current1234" }, OWNER_ID);

    expect(notes.resolveInlineReference(OWNER_ID, {
      apiVersion: 1,
      requestId: REQUEST_ID,
      activeVaultId: vault.vaultId,
      currentPageId: "page_20260709_current1234",
      renderContextId: rendered.renderContextId!,
      href
    })).toEqual({
      apiVersion: 1,
      requestId: REQUEST_ID,
      status: "resolved",
      target: {
        kind: "source",
        sourceId,
        pageId: "page_20260709_source1234",
        locator: "utf8_bytes:10:24"
      }
    });
  });

  it("resolves a source reference without inventing a locator", async () => {
    const { vaultPath, vault } = makeVault();
    const sourceId = "src_20260709_plain1234";
    const href = `#source:${sourceId}`;
    writePage({
      vaultPath,
      fileName: "current.md",
      pageId: "page_20260709_current1234",
      title: "Current",
      body: `[Source](${href})`
    });
    writePage({
      vaultPath,
      fileName: "source.md",
      pageId: "page_20260709_plain1234",
      title: "Source",
      pageType: "source",
      sourceIds: [sourceId]
    });
    writeSourceRecord({
      vaultPath,
      sourceId,
      pageId: "page_20260709_plain1234",
      pagePath: "sources/source.md"
    });
    const notes = makeIndexedNotes(vaultPath, vault);
    const rendered = await notes.render({ pageId: "page_20260709_current1234" }, OWNER_ID);

    expect(notes.resolveInlineReference(OWNER_ID, {
      apiVersion: 1,
      requestId: REQUEST_ID,
      activeVaultId: vault.vaultId,
      currentPageId: "page_20260709_current1234",
      renderContextId: rendered.renderContextId!,
      href
    })).toEqual({
      apiVersion: 1,
      requestId: REQUEST_ID,
      status: "resolved",
      target: { kind: "source", sourceId, pageId: "page_20260709_plain1234" }
    });
  });

  it("rejects a source record reached through a replaced parent symlink", async () => {
    const { vaultPath, vault } = makeVault();
    const sourceId = "src_20260709_parent1234";
    const href = `#source:${sourceId}`;
    writePage({
      vaultPath,
      fileName: "current.md",
      pageId: "page_20260709_current1234",
      title: "Current",
      body: `[Source](${href})`
    });
    writePage({
      vaultPath,
      fileName: "source.md",
      pageId: "page_20260709_parent1234",
      title: "Source",
      pageType: "source",
      sourceIds: [sourceId]
    });
    writeSourceRecord({
      vaultPath,
      sourceId,
      pageId: "page_20260709_parent1234",
      pagePath: "sources/source.md"
    });
    const notes = makeIndexedNotes(vaultPath, vault);
    const rendered = await notes.render({ pageId: "page_20260709_current1234" }, OWNER_ID);
    const governedYear = path.join(vaultPath, ".pige", "source-records", "2026");
    const externalYear = path.join(path.dirname(vaultPath), "external-source-records");
    fs.renameSync(governedYear, externalYear);
    fs.symlinkSync(externalYear, governedYear);

    expect(notes.resolveInlineReference(OWNER_ID, {
      apiVersion: 1,
      requestId: REQUEST_ID,
      activeVaultId: vault.vaultId,
      currentPageId: "page_20260709_current1234",
      renderContextId: rendered.renderContextId!,
      href
    })).toEqual({ apiVersion: 1, requestId: REQUEST_ID, status: "not_found" });
  });

  it("rejects source records when the governed .pige directory escapes through a symlink", async () => {
    const { vaultPath, vault } = makeVault();
    const sourceId = "src_20260709_rootsym1";
    const href = `#source:${sourceId}`;
    writePage({
      vaultPath,
      fileName: "current.md",
      pageId: "page_20260709_current1234",
      title: "Current",
      body: `[Source](${href})`
    });
    writePage({
      vaultPath,
      fileName: "source.md",
      pageId: "page_20260709_rootsym1",
      title: "Source",
      pageType: "source",
      sourceIds: [sourceId]
    });
    writeSourceRecord({
      vaultPath,
      sourceId,
      pageId: "page_20260709_rootsym1",
      pagePath: "sources/source.md"
    });
    const notes = makeIndexedNotes(vaultPath, vault);
    const rendered = await notes.render({ pageId: "page_20260709_current1234" }, OWNER_ID);
    const governedPige = path.join(vaultPath, ".pige");
    const externalPige = path.join(path.dirname(vaultPath), "external-pige-root");
    fs.renameSync(governedPige, externalPige);
    fs.symlinkSync(externalPige, governedPige);

    expect(notes.resolveInlineReference(OWNER_ID, {
      apiVersion: 1,
      requestId: REQUEST_ID,
      activeVaultId: vault.vaultId,
      currentPageId: "page_20260709_current1234",
      renderContextId: rendered.renderContextId!,
      href
    })).toEqual({ apiVersion: 1, requestId: REQUEST_ID, status: "not_found" });
  });

  it("rejects double-encoded and bidirectional wiki targets from an owned rendered href", async () => {
    const { vaultPath, vault } = makeVault();
    const hrefs = ["#wiki:%252e%252e", "#wiki:%E2%80%AEhidden"];
    writePage({
      vaultPath,
      fileName: "current.md",
      pageId: "page_20260709_current1234",
      title: "Current",
      body: hrefs.map((href, index) => `[Unsafe ${index}](${href})`).join("\n")
    });
    const notes = makeIndexedNotes(vaultPath, vault);
    const rendered = await notes.render({ pageId: "page_20260709_current1234" }, OWNER_ID);

    for (const [index, href] of hrefs.entries()) {
      expect(notes.resolveInlineReference(OWNER_ID, {
        apiVersion: 1,
        requestId: `${REQUEST_ID}${index}`,
        activeVaultId: vault.vaultId,
        currentPageId: "page_20260709_current1234",
        renderContextId: rendered.renderContextId!,
        href
      })).toEqual({
        apiVersion: 1,
        requestId: `${REQUEST_ID}${index}`,
        status: "failed"
      });
    }
  });

  it("fails closed when the reference index or target page changes after render", async () => {
    const { vaultPath, vault } = makeVault();
    writePage({
      vaultPath,
      fileName: "current.md",
      pageId: "page_20260709_current1234",
      title: "Current",
      body: "[[Target]]"
    });
    writePage({
      vaultPath,
      fileName: "reference-page.md",
      pageId: "page_20260709_target1234",
      title: "Target"
    });
    const database = new LocalDatabaseService();
    database.rebuild(vaultPath);
    const notes = new NotesService({
      current: () => vault,
      activeVaultPath: () => vaultPath
    }, database);
    const requestFor = (renderContextId: string) => ({
      apiVersion: 1 as const,
      requestId: REQUEST_ID,
      activeVaultId: vault.vaultId,
      currentPageId: "page_20260709_current1234",
      renderContextId,
      href: "#wiki:Target"
    });

    const beforeTargetChange = await notes.render({ pageId: "page_20260709_current1234" }, OWNER_ID);
    writePage({
      vaultPath,
      fileName: "reference-page.md",
      pageId: "page_20260709_target1234",
      title: "Renamed"
    });
    expect(notes.resolveInlineReference(
      OWNER_ID,
      requestFor(beforeTargetChange.renderContextId!)
    )).toEqual({ apiVersion: 1, requestId: REQUEST_ID, status: "failed" });

    database.rebuild(vaultPath);
    const beforeIndexChange = await notes.render({ pageId: "page_20260709_current1234" }, OWNER_ID);
    writePage({
      vaultPath,
      fileName: "new.md",
      pageId: "page_20260709_newpage1234",
      title: "New"
    });
    database.rebuild(vaultPath);
    expect(notes.resolveInlineReference(
      OWNER_ID,
      requestFor(beforeIndexChange.renderContextId!)
    )).toEqual({ apiVersion: 1, requestId: REQUEST_ID, status: "failed" });
  });

  it("does not infer source ownership from ordinary page source_ids", async () => {
    const { vaultPath, vault } = makeVault();
    const sourceId = "src_20260709_noteonly1234";
    const href = `#source:${sourceId}#source`;
    writePage({
      vaultPath,
      fileName: "current.md",
      pageId: "page_20260709_current1234",
      title: "Current",
      body: `[source:${sourceId}#source]`
    });
    writePage({
      vaultPath,
      fileName: "mention.md",
      pageId: "page_20260709_mention1234",
      title: "Mention",
      sourceIds: [sourceId]
    });
    const notes = makeIndexedNotes(vaultPath, vault);
    const rendered = await notes.render({ pageId: "page_20260709_current1234" }, OWNER_ID);

    expect(notes.resolveInlineReference(OWNER_ID, {
      apiVersion: 1,
      requestId: REQUEST_ID,
      activeVaultId: vault.vaultId,
      currentPageId: "page_20260709_current1234",
      renderContextId: rendered.renderContextId!,
      href
    })).toEqual({ apiVersion: 1, requestId: REQUEST_ID, status: "not_found" });
  });

  it("fences owner, href, vault, page revision, and unavailable index state", async () => {
    const { vaultPath, vault } = makeVault();
    const currentPath = path.join(vaultPath, "wiki", "current.md");
    writePage({
      vaultPath,
      fileName: "current.md",
      pageId: "page_20260709_current1234",
      title: "Current",
      body: "[[Current]]"
    });
    const notes = makeIndexedNotes(vaultPath, vault);
    const rendered = await notes.render({ pageId: "page_20260709_current1234" }, OWNER_ID);
    const base = {
      apiVersion: 1 as const,
      requestId: REQUEST_ID,
      activeVaultId: vault.vaultId,
      currentPageId: "page_20260709_current1234",
      renderContextId: rendered.renderContextId!,
      href: "#wiki:Current"
    };

    expect(notes.resolveInlineReference(`${OWNER_ID}_other`, base)).toEqual({
      apiVersion: 1,
      requestId: REQUEST_ID,
      status: "stale",
      scope: "render_context"
    });
    expect(notes.resolveInlineReference(OWNER_ID, { ...base, href: "#wiki:Other" })).toEqual({
      apiVersion: 1,
      requestId: REQUEST_ID,
      status: "stale",
      scope: "render_context"
    });
    expect(notes.resolveInlineReference(OWNER_ID, {
      ...base,
      activeVaultId: "vault_20260709_stale1234"
    })).toEqual({ apiVersion: 1, requestId: REQUEST_ID, status: "stale", scope: "vault" });

    fs.appendFileSync(currentPath, "\nchanged\n", "utf8");
    expect(notes.resolveInlineReference(OWNER_ID, base)).toEqual({
      apiVersion: 1,
      requestId: REQUEST_ID,
      status: "stale",
      scope: "page"
    });

    const noIndex = makeNotes(vaultPath, vault);
    const noIndexRendered = await noIndex.render({ pageId: "page_20260709_current1234" }, OWNER_ID);
    expect(noIndex.resolveInlineReference(OWNER_ID, {
      ...base,
      renderContextId: noIndexRendered.renderContextId!
    })).toEqual({ apiVersion: 1, requestId: REQUEST_ID, status: "failed" });
    noIndex.releaseOwner(OWNER_ID);
    expect(noIndex.resolveInlineReference(OWNER_ID, {
      ...base,
      renderContextId: noIndexRendered.renderContextId!
    })).toEqual({
      apiVersion: 1,
      requestId: REQUEST_ID,
      status: "stale",
      scope: "render_context"
    });
  });
});
