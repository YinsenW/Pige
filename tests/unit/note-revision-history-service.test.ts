import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { OperationRecord } from "@pige/schemas";
import {
  NoteMarkdownEditorActivityAdapter,
  NoteMarkdownEditorService
} from "../../apps/desktop/src/main/services/note-markdown-editor-service";
import { NoteMarkdownEditorRedoService } from "../../apps/desktop/src/main/services/note-markdown-editor-redo-service";
import { NoteRevisionHistoryService } from "../../apps/desktop/src/main/services/note-revision-history-service";

const VAULT_ID = "vault_20260731_notehistory";
const PAGE_ID = "page_20260731_notehistory";
const roots: string[] = [];
const HISTORY_PAGE_TYPES = ["note", "claim", "question", "concept", "entity"] as const;

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("NoteRevisionHistoryService", () => {
  it.each(HISTORY_PAGE_TYPES)("lists and restores immutable %s revisions with Undo and restart adoption", (pageType) => {
    const fixture = createFixture(pageType);
    const first = requireOpened(fixture.editor);
    const editedMarkdown = first.markdown.replace("Original body.", "Edited body.");
    const edited = fixture.editor.save({
      requestId: "notehistory_editor_request_0001",
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      expectedRevisionId: first.revisionId,
      renderIdentity: first.renderIdentity,
      markdown: editedMarkdown
    });
    expect(edited.status).toBe("committed");
    if (edited.status !== "committed") throw new Error("Expected edit to commit.");

    const listed = fixture.history.list({
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      expectedRevision: edited.revisionId
    });
    expect(listed.status).toBe("ready");
    if (listed.status !== "ready") throw new Error("Expected history to be ready.");
    expect(listed.entries).toHaveLength(2);
    expect(listed.entries.map(({ origin, isCurrent }) => ({ origin, isCurrent }))).toEqual([
      { origin: "current", isCurrent: true },
      { origin: "user", isCurrent: false }
    ]);
    const historical = listed.entries[1]!;
    expect(fixture.history.open({
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      expectedRevision: edited.revisionId,
      revisionId: historical.revisionId
    })).toMatchObject({ status: "opened", entry: { markdown: fixture.originalMarkdown } });

    const restored = fixture.history.restore({
      requestId: "notehistoryreq_restore0001",
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      expectedRevision: edited.revisionId,
      revisionId: historical.revisionId
    });
    expect(restored.status).toBe("committed");
    if (restored.status !== "committed") throw new Error("Expected history restore to commit.");
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.originalMarkdown);
    const operation = readOperation(fixture.vaultPath, restored.operationId);
    expect(operation).toMatchObject({ kind: "restore_page", targetRefs: [{ kind: "page", id: PAGE_ID }] });
    expect(fixture.adapter.activitySummary(operation)).toMatchObject({ kind: "restore_page", canUndo: true });

    expect(fixture.adapter.undo(operation, restored.revision)).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(editedMarkdown);

    const restartedEditor = new NoteMarkdownEditorService(fixture.vaults, fixture.adapter, editableTypes());
    const restarted = new NoteRevisionHistoryService(fixture.vaults, restartedEditor);
    const operationCount = operationFiles(fixture.vaultPath).length;
    expect(restarted.restore({
      requestId: "notehistoryreq_restore0001",
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      expectedRevision: edited.revisionId,
      revisionId: historical.revisionId
    })).toEqual({ status: "committed", operationId: restored.operationId, revision: restored.revision });
    expect(operationFiles(fixture.vaultPath)).toHaveLength(operationCount);

    expect(new NoteMarkdownEditorRedoService(fixture.vaults).redo({ operationId: restored.operationId }))
      .toMatchObject({ status: "redone" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.originalMarkdown);
  });

  it("fails closed for source pages, inactive typed pages, stale revisions, and tampered private images", () => {
    const sourceFixture = createFixture("source");
    const sourceRevision = requireRevision(sourceFixture.pagePath);
    expect(sourceFixture.history.list({
      activeVaultId: VAULT_ID, pageId: PAGE_ID, expectedRevision: sourceRevision
    })).toEqual({ status: "ineligible" });

    const inactiveFixture = createFixture("claim", "archived");
    expect(inactiveFixture.history.list({
      activeVaultId: VAULT_ID, pageId: PAGE_ID, expectedRevision: requireRevision(inactiveFixture.pagePath)
    })).toEqual({ status: "ineligible" });

    const fixture = createFixture();
    const opened = requireOpened(fixture.editor);
    const committed = fixture.editor.save({
      requestId: "notehistory_editor_request_0002",
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      markdown: opened.markdown.replace("Original body.", "Second body.")
    });
    if (committed.status !== "committed") throw new Error("Expected edit to commit.");
    expect(fixture.history.list({
      activeVaultId: VAULT_ID, pageId: PAGE_ID, expectedRevision: opened.revisionId
    })).toEqual({ status: "stale" });

    const operation = readOperation(fixture.vaultPath, committed.operationId);
    if (!operation.before?.path) throw new Error("Expected a private before image.");
    fs.appendFileSync(path.join(fixture.vaultPath, ...operation.before.path.split("/")), "tampered");
    const listed = fixture.history.list({
      activeVaultId: VAULT_ID, pageId: PAGE_ID, expectedRevision: committed.revisionId
    });
    expect(listed).toMatchObject({ status: "ready", entries: [{ isCurrent: true }] });
    if (listed.status !== "ready") throw new Error("Expected current history.");
    expect(listed.entries).toHaveLength(1);
  });
});

function createFixture(pageType: HistoryFixturePageType = "note", status: "active" | "archived" = "active") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-note-history-"));
  roots.push(root);
  const vaultPath = path.join(root, "vault");
  const pagePath = path.join(vaultPath, "wiki", `${PAGE_ID}.md`);
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  const originalMarkdown = markdown(pageType, status);
  fs.writeFileSync(pagePath, originalMarkdown, { mode: 0o600 });
  const vaults = {
    current: () => ({
      vaultId: VAULT_ID,
      name: "History vault",
      activeVaultPathDisplay: "History vault",
      knowledgeRootDisplay: "History vault",
      sourceAssetRootDisplay: "History sources",
      sourceAssetRootKind: "vault_internal" as const,
      defaultSourceStorageStrategy: "managed_copy" as const,
      schemaVersion: 1 as const
    }),
    activeVaultPath: () => vaultPath
  };
  const adapter = new NoteMarkdownEditorActivityAdapter(vaults);
  const editor = new NoteMarkdownEditorService(vaults, adapter, {
    now: () => new Date("2026-07-31T12:00:00.000Z"),
    randomId: () => "note-history-fixture-id",
    ...editableTypes()
  });
  return {
    vaultPath, pagePath, originalMarkdown, vaults, adapter, editor,
    history: new NoteRevisionHistoryService(vaults, editor)
  };
}

function operationFiles(vaultPath: string): readonly string[] {
  const root = path.join(vaultPath, ".pige", "operations");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".json"));
}

function requireOpened(editor: NoteMarkdownEditorService) {
  const result = editor.open({ activeVaultId: VAULT_ID, pageId: PAGE_ID });
  if (result.status !== "opened") throw new Error("Expected note to open.");
  return result;
}

function requireRevision(pagePath: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(fs.readFileSync(pagePath)).digest("hex")}`;
}

function readOperation(vaultPath: string, operationId: string): OperationRecord {
  const date = /^op_(\d{8})_/u.exec(operationId)?.[1];
  if (!date) throw new Error("Invalid operation id.");
  return JSON.parse(fs.readFileSync(path.join(
    vaultPath, ".pige", "operations", date.slice(0, 4), date.slice(4, 6), `${operationId}.json`
  ), "utf8")) as OperationRecord;
}

type HistoryFixturePageType = typeof HISTORY_PAGE_TYPES[number] | "source";

function editableTypes() {
  return { allowClaim: true, allowQuestion: true, allowConcept: true, allowEntity: true } as const;
}

function markdown(type: HistoryFixturePageType, status: "active" | "archived" = "active"): string {
  return `---\nid: "${PAGE_ID}"\nschema_version: 1\ntitle: "History fixture"\ntype: "${type}"\ncreated_at: "2026-07-31T10:00:00.000Z"\nupdated_at: "2026-07-31T10:00:00.000Z"\nstatus: "${status}"\nlanguage: "en"\naliases: []\ntags: []\ntopics: []\nsource_ids: []\n---\n\n# History fixture\n\nOriginal body.\n`;
}
