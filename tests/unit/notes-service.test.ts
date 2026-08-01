import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { LocalDatabaseService } from "../../apps/desktop/src/main/services/local-database-service";
import { NoteMarkdownEditorService } from "../../apps/desktop/src/main/services/note-markdown-editor-service";
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
  readonly pageType?: "note" | "source" | "concept" | "entity" | "topic" | "claim" | "question";
  readonly status?: "active" | "archived";
  readonly aliases?: readonly string[];
  readonly tags?: readonly string[];
  readonly sourceIds?: readonly string[];
  readonly extraFrontmatter?: string;
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
status: "${input.status ?? "active"}"
aliases: ${JSON.stringify(input.aliases ?? [])}
tags: ${JSON.stringify(input.tags ?? [])}
source_ids: ${JSON.stringify(input.sourceIds ?? [])}
${input.extraFrontmatter ?? ""}
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
  readonly kind?: "text" | "image_file";
  readonly displayName?: string;
  readonly artifacts?: readonly { readonly id: string; readonly kind: "ocr" | "extracted_text"; readonly path: string }[];
}): void {
  const recordPath = sourceRecordPath(input.vaultPath, input.sourceId);
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  fs.writeFileSync(recordPath, JSON.stringify({
    schemaVersion: 1,
    id: input.sourceId,
    kind: input.kind ?? "text",
    storageStrategy: "reference_original",
    semanticOrchestration: "agent_turn",
    ...(input.pageId ? { knowledgePageId: input.pageId } : {}),
    ...(input.pagePath ? { knowledgePagePath: input.pagePath } : {}),
    original: { uri: `pige-test://${input.sourceId}`, ...(input.displayName ? { displayName: input.displayName } : {}) },
    artifacts: input.artifacts ?? [],
    metadata: {},
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z"
  }), "utf8");
}

function sourceRecordPath(vaultPath: string, sourceId: string): string {
  const dateKey = /^src_(\d{8})_/u.exec(sourceId)?.[1];
  if (!dateKey) throw new Error("Test source ID is invalid.");
  return path.join(vaultPath, ".pige", "source-records", dateKey.slice(0, 4), dateKey.slice(4, 6), `${sourceId}.json`);
}

const OWNER_ID = "notes_owner_test";
const REQUEST_ID = "noteref_abcdefghijklmnop";
const SELECTION_REQUEST_ID = "readerselreq_abcdefgh";

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

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
  it("projects exact mutable state only for a current valid question page", async () => {
    const { vaultPath, vault } = makeVault();
    const pageId = "page_20260801_question1";
    const answerPageId = "page_20260801_answer001";
    writePage({ vaultPath, fileName: "answer.md", pageId: answerPageId, title: "Answer", pageType: "note",
      sourceIds: ["src_20260801_answer0001"] });
    writePage({
      vaultPath, fileName: "question.md", pageId, title: "Question", pageType: "question",
      extraFrontmatter: `question:\n  state: "partially_answered"\n  answered_by: ["${answerPageId}"]`
    });
    const notes = makeNotes(vaultPath, vault);
    const rendered = await notes.render({ pageId }, OWNER_ID);
    expect(rendered.questionState).toEqual({
      state: "partially_answered", canChange: true,
      revision: expect.stringMatching(/^noteeditrev_[a-f0-9]{64}$/u)
    });
    expect(rendered.questionAnswers).toEqual({
      canEdit: true, revision: rendered.questionState!.revision,
      items: [expect.objectContaining({ pageId: answerPageId, title: "Answer", pageType: "note" })]
    });
    expect(notes.resolveManagedPageTarget(OWNER_ID, {
      activeVaultId: vault.vaultId,
      pageId,
      renderContextId: rendered.renderContextId!,
      expectedRevision: rendered.questionState!.revision
    }, "question")).toMatchObject({ status: "ready", pageId, title: "Question" });

    writePage({
      vaultPath, fileName: "malformed-question.md", pageId: "page_20260801_question2",
      title: "Malformed", pageType: "question",
      extraFrontmatter: 'question:\n  state: "open"\n  state: "answered"\n  answered_by: []'
    });
    await expect(notes.render({ pageId: "page_20260801_question2" }, OWNER_ID))
      .resolves.not.toHaveProperty("questionState");
  });

  it("projects five current SourceRecord summaries while retaining failures and omitting unsafe names", async () => {
    const { vaultPath, vault } = makeVault();
    const pageId = "page_20260709_metadata123";
    const sourceId = "src_20260709_metadata1234";
    const missingSourceId = "src_20260709_missing1234";
    const credentialSourceId = "src_20260709_credential12";
    const mismatchedSourceId = "src_20260709_mismatch123";
    const anotherMissingSourceId = "src_20260709_missing5678";
    const overflowSourceId = "src_20260709_overflow123";
    const secondOverflowSourceId = "src_20260709_overflow456";
    writePage({
      vaultPath,
      fileName: "metadata.md",
      pageId,
      title: "Metadata",
      sourceIds: [
        sourceId,
        missingSourceId,
        credentialSourceId,
        mismatchedSourceId,
        anotherMissingSourceId,
        overflowSourceId,
        secondOverflowSourceId,
      ],
    });
    writeSourceRecord({
      vaultPath,
      sourceId,
      pageId: "page_20260709_source1234",
      pagePath: "sources/source.md",
      kind: "image_file",
      displayName: "receipt.png",
      artifacts: [{ id: "art_20260709_metadata1234", kind: "ocr", path: "artifacts/private-ocr.txt" }],
    });
    writeSourceRecord({
      vaultPath,
      sourceId: credentialSourceId,
      displayName: "postgres:alice:hunter2@db.internal",
      artifacts: [{ id: "art_20260709_credential12", kind: "extracted_text", path: "artifacts/private-text.txt" }],
    });
    writeSourceRecord({ vaultPath, sourceId: mismatchedSourceId, displayName: "must-not-render.txt" });
    const mismatchedRecordPath = sourceRecordPath(vaultPath, mismatchedSourceId);
    const mismatchedRecord = JSON.parse(fs.readFileSync(mismatchedRecordPath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(mismatchedRecordPath, JSON.stringify({
      ...mismatchedRecord,
      id: "src_20260709_different123",
    }), "utf8");
    writeSourceRecord({ vaultPath, sourceId: overflowSourceId, displayName: "overflow-secret.txt" });

    const rendered = await new NotesService({
      current: () => vault,
      activeVaultPath: () => vaultPath
    }, undefined, undefined, undefined, {
      refreshableSourceIds: (sourceIds) => sourceIds.filter((id) => id === sourceId)
    }).render({ pageId }, OWNER_ID);
    expect(rendered.sourceMetadata).toEqual({
      items: [
        {
          sourceId,
          status: "current",
          displayName: "receipt.png",
          category: "image",
          storage: "reference_original",
          extraction: "ocr",
        },
        { sourceId: missingSourceId, status: "unavailable" },
        {
          sourceId: credentialSourceId,
          status: "current",
          category: "text",
          storage: "reference_original",
          extraction: "text",
        },
        { sourceId: mismatchedSourceId, status: "unavailable" },
        { sourceId: anotherMissingSourceId, status: "unavailable" },
      ],
      remainingCount: 2,
    });
    expect(rendered.reconnectOriginalSourceIds).toEqual(
      rendered.reconnectOriginalSources?.map((source) => source.sourceId)
    );
    expect(rendered.reconnectOriginalSourceIds).not.toContain(mismatchedSourceId);
    expect(rendered.refreshableSourceIds).toEqual([sourceId]);
    expect(JSON.stringify(rendered.sourceMetadata)).not.toMatch(
      /private-ocr|private-text|pige-test|checksum|path|hunter2|db\.internal|must-not-render|overflow-secret/iu
    );
  });

  it("opens and commits an owner-bound editor session with a refreshed canonical render", async () => {
    const { vaultPath, vault } = makeVault();
    const pageId = "page_20260709_editable1234";
    writePage({ vaultPath, fileName: "editable.md", pageId, title: "Editable", tags: ["draft"], body: "Before" });
    const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
    const operations: string[] = [];
    const editor = new NoteMarkdownEditorService(vaults, {
      recordPageUpdate: ({ operation }) => { operations.push(operation.id); }
    });
    const notes = new NotesService(vaults, undefined, undefined, editor);
    const rendered = await notes.render({ pageId }, OWNER_ID);
    expect(rendered.tagging).toEqual({
      tags: ["draft"], topics: [], canAdd: true, canEdit: true,
      revision: expect.stringMatching(/^noteeditrev_[a-f0-9]{32,64}$/u)
    });
    expect(rendered.aliasing).toEqual({ aliases: [], canAdd: true, canRemove: false,
      revision: expect.stringMatching(/^noteeditrev_[a-f0-9]{32,64}$/u) });
    const open = notes.openEditor(OWNER_ID, {
      apiVersion: 1,
      requestId: "noteeditreq_open1234",
      activeVaultId: vault.vaultId,
      pageId,
      renderContextId: rendered.renderContextId!
    });
    expect(open.status).toBe("ready");
    if (open.status !== "ready") throw new Error("Expected an editor-ready result.");
    const draft = open.markdown
      .replace('updated_at: "2026-07-09T12:00:00.000Z"', 'updated_at: "2026-07-09T12:01:00.000Z"')
      .replace("Before", "After");
    const saved = await notes.saveEditor(OWNER_ID, {
      apiVersion: 1,
      requestId: "noteeditreq_save1234",
      activeVaultId: vault.vaultId,
      pageId,
      renderContextId: open.renderContextId,
      expectedRevision: open.revision,
      markdown: draft
    });
    expect(saved.status).toBe("committed");
    if (saved.status !== "committed") throw new Error("Expected a committed editor result.");
    expect(saved.render.html).toContain("After");
    expect(saved.render.summary.pageId).toBe(pageId);
    expect(saved.render.renderContextId).not.toBe(open.renderContextId);
    expect(operations).toEqual([saved.operationId]);
  });

  it("keeps malformed or duplicate aliases out of the mutation eligibility projection without breaking Reader", async () => {
    const { vaultPath, vault } = makeVault(), pageId = "page_20260731_badaliases01";
    writePage({ vaultPath, fileName: "bad-aliases.md", pageId, title: "Alias safety", aliases: [" Existing ", "existing"] });
    const rendered = await makeNotes(vaultPath, vault).render({ pageId }, OWNER_ID);
    expect(rendered.summary.pageId).toBe(pageId);
    expect(rendered.aliasing).toBeUndefined();
  });

  it.each(["note", "claim", "question", "concept", "entity"] as const)(
    "projects active %s aliases and taxonomy", async (pageType) => {
      const { vaultPath, vault } = makeVault();
      const pageId = `page_20260801_taxonomy${pageType}`;
      writePage({ vaultPath, fileName: `${pageType}-taxonomy.md`, pageId, title: `Typed ${pageType}`,
        pageType, aliases: ["Alternate name"], tags: ["research"] });
      const notes = makeNotes(vaultPath, vault), rendered = await notes.render({ pageId }, OWNER_ID);
      expect(rendered.summary.pageType).toBe(pageType);
      expect(rendered.aliasing).toMatchObject({ aliases: ["Alternate name"], canAdd: true, canRemove: true });
      expect(rendered.tagging).toMatchObject({ tags: ["research"], topics: [], canAdd: true, canEdit: true });
    });

  it.each(["source", "topic"] as const)("does not project alias or taxonomy mutation authority for %s pages", async (pageType) => {
    const { vaultPath, vault } = makeVault(), pageId = `page_20260801_notaxonomy${pageType}`;
    writePage({ vaultPath, fileName: `${pageType}-no-taxonomy.md`, pageId, title: `Excluded ${pageType}`,
      pageType, aliases: ["Private alternate"], tags: ["private-tag"] });
    const rendered = await makeNotes(vaultPath, vault).render({ pageId }, OWNER_ID);
    expect(rendered.aliasing).toBeUndefined();
    expect(rendered.tagging).toBeUndefined();
  });

  it("opens active typed knowledge pages and Source Pages while keeping Topic out", async () => {
    const { vaultPath, vault } = makeVault();
    const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
    const editor = new NoteMarkdownEditorService(vaults, { recordPageUpdate: () => undefined }, {
      allowClaim: true, allowQuestion: true, allowConcept: true, allowEntity: true,
    });
    const notes = new NotesService(vaults, undefined, undefined, editor);

    for (const [index, pageType] of ["concept", "entity", "claim", "question"].entries()) {
      const pageId = `page_20260709_typededit${index}`;
      writePage({
        vaultPath,
        fileName: `${pageType}.md`,
        pageId,
        title: `Editable ${pageType}`,
        pageType: pageType as "concept" | "entity" | "claim" | "question",
        body: `Before ${pageType}`,
      });
      const rendered = await notes.render({ pageId }, OWNER_ID);
      const opened = notes.openEditor(OWNER_ID, {
        apiVersion: 1,
        requestId: `noteeditreq_typedopen${index}`,
        activeVaultId: vault.vaultId,
        pageId,
        renderContextId: rendered.renderContextId!
      });
      expect(opened).toMatchObject({ status: "ready" });
      if (opened.status !== "ready") throw new Error("Expected typed page editor to open.");
      await expect(notes.saveEditor(OWNER_ID, {
        apiVersion: 1, requestId: `noteeditreq_typedsave${index}`, activeVaultId: vault.vaultId,
        pageId, renderContextId: opened.renderContextId, expectedRevision: opened.revision,
        markdown: opened.markdown.replace(`Before ${pageType}`, `After ${pageType}`),
      })).resolves.toMatchObject({ status: "committed", render: { summary: { pageType } } });
    }

    const topicPageId = "page_20260709_noneditabletopic";
    writePage({ vaultPath, fileName: "topic.md", pageId: topicPageId, title: "Topic", pageType: "topic" });
    const topicRender = await notes.render({ pageId: topicPageId }, OWNER_ID);
    expect(notes.openEditor(OWNER_ID, { apiVersion: 1, requestId: "noteeditreq_topicclosed",
      activeVaultId: vault.vaultId, pageId: topicPageId, renderContextId: topicRender.renderContextId! }))
      .toMatchObject({ status: "failed" });

    const sourcePageId = "page_20260709_editablesource";
    writePage({
      vaultPath, fileName: "editable-source.md", pageId: sourcePageId, title: "Editable source",
      pageType: "source", sourceIds: ["src_20260709_editsource"], body: "Source sidecar notes"
    });
    const sourceRender = await notes.render({ pageId: sourcePageId }, OWNER_ID);
    const sourceOpen = notes.openEditor(OWNER_ID, {
      apiVersion: 1, requestId: "noteeditreq_sourceopen", activeVaultId: vault.vaultId,
      pageId: sourcePageId, renderContextId: sourceRender.renderContextId!
    });
    expect(sourceOpen.status).toBe("ready");
    if (sourceOpen.status !== "ready") throw new Error("Expected Source Page editor to open.");
    const sourceSave = await notes.saveEditor(OWNER_ID, {
      apiVersion: 1, requestId: "noteeditreq_sourcesave", activeVaultId: vault.vaultId,
      pageId: sourcePageId, renderContextId: sourceOpen.renderContextId,
      expectedRevision: sourceOpen.revision,
      markdown: sourceOpen.markdown.replace("Source sidecar notes", "Edited source sidecar notes")
    });
    expect(sourceSave).toMatchObject({ status: "committed", render: { summary: { pageType: "source" } } });

    const pageId = "page_20260709_typechange12";
    writePage({ vaultPath, fileName: "type-change.md", pageId, title: "Type change", body: "Before" });
    const rendered = await notes.render({ pageId }, OWNER_ID);
    const opened = notes.openEditor(OWNER_ID, {
      apiVersion: 1,
      requestId: "noteeditreq_typeopen12",
      activeVaultId: vault.vaultId,
      pageId,
      renderContextId: rendered.renderContextId!
    });
    if (opened.status !== "ready") throw new Error("Expected the note editor to open.");
    expect(await notes.saveEditor(OWNER_ID, {
      apiVersion: 1,
      requestId: "noteeditreq_typesave12",
      activeVaultId: vault.vaultId,
      pageId,
      renderContextId: opened.renderContextId,
      expectedRevision: opened.revision,
      markdown: opened.markdown.replace('type: "note"', 'type: "source"')
    })).toMatchObject({ status: "invalid", reason: "unsupported_page_type" });
  });

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
    expect(rendered.html).toContain(">Reader Page</span></h1>");
    expect(rendered.html).toContain('href="#wiki:Topic"');
    expect(rendered.html).not.toContain("<script");
  });

  it("resolves renderer segment endpoints to a body-free UTF-8 selection identity", async () => {
    const { vaultPath, vault } = makeVault();
    writePage({
      vaultPath,
      fileName: "selection.md",
      pageId: "page_20260709_select1234",
      title: "Selection",
      body: "Alpha 产品😀 é omega"
    });
    const notes = makeNotes(vaultPath, vault);
    const rendered = await notes.render({ pageId: "page_20260709_select1234" }, OWNER_ID);
    const segmentId = /<p><span data-pige-selection-segment="(readerseg_[a-f0-9]{16})">Alpha/u
      .exec(rendered.html)?.[1];
    expect(segmentId).toBeDefined();

    const result = notes.resolveSelection(OWNER_ID, {
      apiVersion: 1,
      requestId: SELECTION_REQUEST_ID,
      activeVaultId: vault.vaultId,
      currentPageId: "page_20260709_select1234",
      renderContextId: rendered.renderContextId!,
      anchor: { segmentId: segmentId!, utf16Offset: 10 },
      focus: { segmentId: segmentId!, utf16Offset: 6 }
    });
    const markdown = fs.readFileSync(path.join(vaultPath, "wiki", "selection.md"), "utf8");
    const selected = "产品😀";
    const selectionStart = markdown.indexOf(selected);
    expect(result).toEqual({
      apiVersion: 1,
      requestId: SELECTION_REQUEST_ID,
      status: "resolved",
      selection: {
        pageId: "page_20260709_select1234",
        pageContentHash: sha256(markdown),
        span: {
          unit: "utf8_bytes",
          start: Buffer.byteLength(markdown.slice(0, selectionStart), "utf8"),
          endExclusive: Buffer.byteLength(markdown.slice(0, selectionStart + selected.length), "utf8")
        },
        selectedContentHash: sha256(selected)
      }
    });
    expect(JSON.stringify(result)).not.toContain(selected);
    expect(JSON.stringify(result)).not.toContain("selection.md");
  });

  it("re-reads a search result and returns only the current matching Reader segment", async () => {
    const { vaultPath, vault } = makeVault();
    writePage({
      vaultPath,
      fileName: "search-focus.md",
      pageId: "page_20260801_searchfocus",
      title: "Search Focus",
      body: "First paragraph.\n\nThe durable nebula launch is documented here."
    });
    const notes = makeNotes(vaultPath, vault);
    const result = await notes.openSearchMatch({
      apiVersion: 1,
      requestId: "notesearch_20260801searchfocus",
      activeVaultId: vault.vaultId,
      pageId: "page_20260801_searchfocus",
      query: "nebula launch"
    }, OWNER_ID);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.focusSegmentId).toMatch(/^readerseg_[a-f0-9]{16}$/u);
    expect(result.render.html).toContain(
      `data-pige-selection-segment="${result.focusSegmentId}"`
    );
    expect(JSON.stringify(result)).not.toContain(vaultPath);
  });

  it("fails closed for unknown, split-surrogate, empty, and stale Reader selections", async () => {
    const { vaultPath, vault } = makeVault();
    writePage({
      vaultPath,
      fileName: "selection.md",
      pageId: "page_20260709_select1234",
      title: "Selection",
      body: "Alpha 😀 omega"
    });
    const notes = makeNotes(vaultPath, vault);
    const rendered = await notes.render({ pageId: "page_20260709_select1234" }, OWNER_ID);
    const segmentId = /<p><span data-pige-selection-segment="(readerseg_[a-f0-9]{16})">Alpha/u
      .exec(rendered.html)?.[1];
    const base = {
      apiVersion: 1 as const,
      requestId: SELECTION_REQUEST_ID,
      activeVaultId: vault.vaultId,
      currentPageId: "page_20260709_select1234",
      renderContextId: rendered.renderContextId!
    };
    expect(notes.resolveSelection(OWNER_ID, {
      ...base,
      anchor: { segmentId: "readerseg_ffffffffffffffff", utf16Offset: 0 },
      focus: { segmentId: segmentId!, utf16Offset: 1 }
    })).toMatchObject({ status: "invalid", reason: "endpoint_not_found" });
    expect(notes.resolveSelection(OWNER_ID, {
      ...base,
      anchor: { segmentId: segmentId!, utf16Offset: 7 },
      focus: { segmentId: segmentId!, utf16Offset: 9 }
    })).toMatchObject({ status: "invalid", reason: "endpoint_offset_invalid" });
    expect(notes.resolveSelection(OWNER_ID, {
      ...base,
      anchor: { segmentId: segmentId!, utf16Offset: 2 },
      focus: { segmentId: segmentId!, utf16Offset: 2 }
    })).toMatchObject({ status: "invalid", reason: "selection_empty" });

    fs.appendFileSync(path.join(vaultPath, "wiki", "selection.md"), "changed", "utf8");
    expect(notes.resolveSelection(OWNER_ID, {
      ...base,
      anchor: { segmentId: segmentId!, utf16Offset: 0 },
      focus: { segmentId: segmentId!, utf16Offset: 5 }
    })).toMatchObject({ status: "stale", scope: "page" });
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

  it("opens a saved-source row only through the rendered page and durable source owners", async () => {
    const { vaultPath, vault } = makeVault();
    const sourceId = "src_20260709_saved1234";
    writePage({
      vaultPath,
      fileName: "current.md",
      pageId: "page_20260709_current1234",
      title: "Current",
      sourceIds: [sourceId]
    });
    writePage({
      vaultPath,
      fileName: "source.md",
      pageId: "page_20260709_saved1234",
      title: "Source",
      pageType: "source",
      sourceIds: [sourceId]
    });
    writeSourceRecord({
      vaultPath,
      sourceId,
      pageId: "page_20260709_saved1234",
      pagePath: "sources/source.md"
    });
    const notes = makeIndexedNotes(vaultPath, vault);
    const rendered = await notes.render({ pageId: "page_20260709_current1234" }, OWNER_ID);

    expect(notes.openSourceReference(OWNER_ID, {
      apiVersion: 1,
      requestId: REQUEST_ID,
      activeVaultId: vault.vaultId,
      currentPageId: "page_20260709_current1234",
      renderContextId: rendered.renderContextId!,
      sourceId
    })).toEqual({
      apiVersion: 1,
      requestId: REQUEST_ID,
      status: "resolved",
      target: { pageId: "page_20260709_saved1234" }
    });
  });

  it("fails saved-source rows closed across page ownership and currentness fences", async () => {
    const { vaultPath, vault } = makeVault();
    const sourceId = "src_20260709_fenced123";
    writePage({
      vaultPath,
      fileName: "current.md",
      pageId: "page_20260709_current1234",
      title: "Current",
      sourceIds: [sourceId]
    });
    writePage({
      vaultPath,
      fileName: "source.md",
      pageId: "page_20260709_fenced123",
      title: "Source",
      pageType: "source",
      sourceIds: [sourceId]
    });
    writeSourceRecord({
      vaultPath,
      sourceId,
      pageId: "page_20260709_fenced123",
      pagePath: "sources/source.md"
    });
    const notes = makeIndexedNotes(vaultPath, vault);
    const rendered = await notes.render({ pageId: "page_20260709_current1234" }, OWNER_ID);
    const request = {
      apiVersion: 1 as const,
      requestId: REQUEST_ID,
      activeVaultId: vault.vaultId,
      currentPageId: "page_20260709_current1234",
      renderContextId: rendered.renderContextId!,
      sourceId
    };

    expect(notes.openSourceReference(OWNER_ID, {
      ...request,
      sourceId: "src_20260709_other1234"
    })).toEqual({
      apiVersion: 1,
      requestId: REQUEST_ID,
      status: "mismatch"
    });
    expect(notes.openSourceReference(`${OWNER_ID}_other`, request)).toEqual({
      apiVersion: 1,
      requestId: REQUEST_ID,
      status: "stale"
    });

    writePage({
      vaultPath,
      fileName: "current.md",
      pageId: "page_20260709_current1234",
      title: "Changed",
      sourceIds: [sourceId]
    });
    expect(notes.openSourceReference(OWNER_ID, request)).toEqual({
      apiVersion: 1,
      requestId: REQUEST_ID,
      status: "changed"
    });
  });

  it("leases an exact current Reader source and invalidates it on SourceRecord drift", async () => {
    const { vaultPath, vault } = makeVault();
    const sourceId = "src_20260709_reveal123";
    writePage({
      vaultPath, fileName: "current.md", pageId: "page_20260709_current1234",
      title: "Current", sourceIds: [sourceId]
    });
    writeSourceRecord({ vaultPath, sourceId });
    const notes = makeNotes(vaultPath, vault);
    const rendered = await notes.render({ pageId: "page_20260709_current1234" }, OWNER_ID);
    const resolved = notes.resolveSourceReveal(OWNER_ID, {
      apiVersion: 1,
      requestId: "notesourcereveal_abcdefghijklmnop",
      activeVaultId: vault.vaultId,
      currentPageId: "page_20260709_current1234",
      renderContextId: rendered.renderContextId!,
      sourceId
    });
    expect(resolved.status).toBe("ready");
    if (resolved.status !== "ready") throw new Error("Expected a reveal lease.");
    expect(resolved.sourceRecord.id).toBe(sourceId);
    expect(resolved.assertCurrent()).toBe(true);

    const recordPath = path.join(vaultPath, ".pige", "source-records", "2026", "07", `${sourceId}.json`);
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(recordPath, JSON.stringify({ ...record, updatedAt: "2026-07-09T13:00:00.000Z" }));
    expect(resolved.assertCurrent()).toBe(false);
  });

  it("projects only bounded reconnectable original identities into an owned Reader", async () => {
    const { vaultPath, vault } = makeVault();
    const sourceId = "src_20260709_reconnect12";
    const pageId = "page_20260709_current1234";
    writePage({ vaultPath, fileName: "current.md", pageId, title: "Current", sourceIds: [sourceId] });
    const dateKey = "20260709";
    const recordPath = path.join(
      vaultPath, ".pige", "source-records", dateKey.slice(0, 4), dateKey.slice(4, 6), `${sourceId}.json`
    );
    fs.mkdirSync(path.dirname(recordPath), { recursive: true });
    fs.writeFileSync(recordPath, JSON.stringify({
      schemaVersion: 1,
      id: sourceId,
      kind: "plain_text_file",
      storageStrategy: "reference_original",
      semanticOrchestration: "agent_turn",
      original: {
        uri: "file:///private/missing.txt",
        path: "/private/missing.txt",
        displayName: "missing.txt",
        checksum: sha256("missing bytes"),
        lastKnownSize: 13
      },
      artifacts: [],
      metadata: {},
      createdAt: "2026-07-09T12:00:00.000Z",
      updatedAt: "2026-07-09T12:00:00.000Z"
    }), "utf8");
    const notes = makeNotes(vaultPath, vault);

    await expect(notes.render({ pageId }, OWNER_ID)).resolves.toMatchObject({
      reconnectOriginalSourceIds: [sourceId]
    });
    await expect(notes.render({ pageId })).resolves.not.toHaveProperty("reconnectOriginalSourceIds");
  });

  it("does not resolve saved-source rows without the bounded reference index", async () => {
    const { vaultPath, vault } = makeVault();
    const sourceId = "src_20260709_noindex12";
    writePage({
      vaultPath,
      fileName: "current.md",
      pageId: "page_20260709_current1234",
      title: "Current",
      sourceIds: [sourceId]
    });
    const notes = makeNotes(vaultPath, vault);
    const rendered = await notes.render({ pageId: "page_20260709_current1234" }, OWNER_ID);

    expect(notes.openSourceReference(OWNER_ID, {
      apiVersion: 1,
      requestId: REQUEST_ID,
      activeVaultId: vault.vaultId,
      currentPageId: "page_20260709_current1234",
      renderContextId: rendered.renderContextId!,
      sourceId
    })).toEqual({
      apiVersion: 1,
      requestId: REQUEST_ID,
      status: "unresolved"
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

  it("projects and revalidates reveal only for the exact current Pige-generated page", async () => {
    const { vaultPath, vault } = makeVault();
    const generatedPageId = "page_20260801_generated1";
    writePage({ vaultPath, fileName: "generated.md", pageId: generatedPageId, title: "Generated",
      pageType: "claim", extraFrontmatter: 'provenance:\n  generated_by: "pige"' });
    writePage({ vaultPath, fileName: "imported.md", pageId: "page_20260801_imported01", title: "Imported",
      extraFrontmatter: 'provenance:\n  generated_by: "user"' });
    writePage({ vaultPath, fileName: "imported-claim.md", pageId: "page_20260801_imported02", title: "Imported claim",
      pageType: "claim", extraFrontmatter: 'provenance:\n  generated_by: "user"' });
    writePage({ vaultPath, fileName: "generated-source.md", pageId: "page_20260801_source001", title: "Source",
      pageType: "source", extraFrontmatter: 'provenance:\n  generated_by: "pige"' });
    writePage({ vaultPath, fileName: "archived-claim.md", pageId: "page_20260801_archived01", title: "Archived claim",
      pageType: "claim", status: "archived", extraFrontmatter: 'provenance:\n  generated_by: "user"' });
    const notes = makeNotes(vaultPath, vault);
    const rendered = await notes.render({ pageId: generatedPageId }, OWNER_ID);
    expect(rendered.revealGeneratedEligibility).toEqual({
      canReveal: true, revision: expect.stringMatching(/^noteeditrev_[a-f0-9]{64}$/u)
    });
    expect(rendered.trashEligibility).toEqual({
      canTrash: true, revision: expect.stringMatching(/^noteeditrev_[a-f0-9]{64}$/u)
    });
    const request = {
      apiVersion: 1 as const, requestId: "notegeneratedreveal_abcdefghijklmnop",
      activeVaultId: vault.vaultId, currentPageId: generatedPageId,
      renderContextId: rendered.renderContextId!, expectedRevision: rendered.revealGeneratedEligibility!.revision
    };
    const ready = notes.resolveGeneratedReveal(OWNER_ID, request);
    expect(ready).toMatchObject({ status: "ready", absolutePath: path.join(vaultPath, "wiki", "generated.md") });
    expect(ready.status === "ready" && ready.assertCurrent()).toBe(true);

    const imported = await notes.render({ pageId: "page_20260801_imported01" }, OWNER_ID);
    expect(imported.revealGeneratedEligibility).toBeUndefined();
    expect(notes.resolveGeneratedReveal(OWNER_ID, {
      ...request, currentPageId: imported.summary.pageId, renderContextId: imported.renderContextId!,
      expectedRevision: imported.trashEligibility!.revision
    })).toEqual({ status: "ineligible" });
    const importedClaim = await notes.render({ pageId: "page_20260801_imported02" }, OWNER_ID);
    expect(importedClaim.trashEligibility).toEqual({
      canTrash: true, revision: expect.stringMatching(/^noteeditrev_[a-f0-9]{64}$/u)
    });
    expect(importedClaim.renameEligibility).toEqual({
      canRename: true, revision: expect.stringMatching(/^noteeditrev_[a-f0-9]{64}$/u)
    });
    expect(importedClaim.historyEligibility).toEqual({
      canBrowse: true, revision: expect.stringMatching(/^noteeditrev_[a-f0-9]{64}$/u)
    });
    expect(importedClaim.archiveEligibility).toEqual({
      canArchive: true, revision: expect.stringMatching(/^noteeditrev_[a-f0-9]{64}$/u)
    });
    expect(importedClaim.restoreEligibility).toEqual({
      canRestore: false, revision: expect.stringMatching(/^noteeditrev_[a-f0-9]{64}$/u)
    });
    const source = await notes.render({ pageId: "page_20260801_source001" }, OWNER_ID);
    expect(source.revealGeneratedEligibility).toBeUndefined();
    expect(source.trashEligibility).toBeUndefined();
    expect(source.renameEligibility).toBeUndefined();
    expect(source.archiveEligibility).toBeUndefined();
    expect(source.restoreEligibility).toBeUndefined();
    const archivedClaim = await notes.render({ pageId: "page_20260801_archived01" }, OWNER_ID);
    expect(archivedClaim.trashEligibility).toBeUndefined();
    expect(archivedClaim.renameEligibility).toBeUndefined();
    expect(archivedClaim.historyEligibility).toBeUndefined();
    expect(archivedClaim.archiveEligibility).toEqual({
      canArchive: false, revision: expect.stringMatching(/^noteeditrev_[a-f0-9]{64}$/u)
    });
    expect(archivedClaim.restoreEligibility).toEqual({
      canRestore: true, revision: expect.stringMatching(/^noteeditrev_[a-f0-9]{64}$/u)
    });

    const current = await notes.render({ pageId: generatedPageId }, OWNER_ID);
    const currentRequest = { ...request, renderContextId: current.renderContextId!,
      expectedRevision: current.revealGeneratedEligibility!.revision };
    fs.appendFileSync(path.join(vaultPath, "wiki", "generated.md"), "\nchanged\n", "utf8");
    expect(notes.resolveGeneratedReveal(OWNER_ID, currentRequest)).toEqual({ status: "stale" });
  });
});
