import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OperationRecord } from "@pige/schemas";
import {
  NoteMarkdownEditorActivityAdapter,
  NoteMarkdownEditorService,
  type NoteMarkdownEditorActivityPort,
  type NoteMarkdownEditorVaultPort
} from "../../apps/desktop/src/main/services/note-markdown-editor-service";
import { NoteMarkdownEditorRedoService } from "../../apps/desktop/src/main/services/note-markdown-editor-redo-service";

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

  it("edits a Source Page body while preserving its source-owned identity fields", () => {
    const fixture = createFixture({ pageType: "source", pageRelativePath: `sources/${PAGE_ID}.md` });
    const opened = requireOpened(fixture.service);
    const edited = opened.markdown.replace("Original body.", "User-maintained source notes.");
    expect(fixture.service.save({
      requestId: "request_source_page_edit",
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      markdown: edited
    })).toMatchObject({ status: "committed" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(edited);
    expect(fixture.records).toHaveLength(1);

    const reopened = requireOpened(fixture.service);
    for (const [index, changedOwner] of [
      reopened.markdown.replace(`source_ids: ["${SOURCE_ID}"]`, "source_ids: []"),
      reopened.markdown.replace('type: "source"', 'type: "note"'),
      reopened.markdown.replace('status: "active"', 'status: "missing_source"'),
      reopened.markdown.replace('created_at: "2026-07-27T10:00:00.000Z"', 'created_at: "2026-07-28T10:00:00.000Z"'),
      reopened.markdown.replace('title: "Markdown editor fixture"', 'title: "Changed source title"'),
      reopened.markdown.replace('last_job_id: "job_20260727_markdowneditor"', 'last_job_id: "job_20260727_changedsource"'),
      reopened.markdown.replace(`id: "${SOURCE_ID}"`, 'id: "src_20260727_changedsource"'),
      reopened.markdown.replace('source_record_path: ".pige/source-records/2026/07/source.json"', 'source_record_path: ".pige/source-records/2026/07/changed.json"')
    ].entries()) expect(fixture.service.save({
      requestId: `request_source_owner_change_${index}`,
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      expectedRevisionId: reopened.revisionId,
      renderIdentity: reopened.renderIdentity,
      markdown: changedOwner
    })).toMatchObject({ status: "invalid", invalidReason: "unsupported_page_type" });
  });

  it("fails closed for unsupported page types and rejects a page-type change on save", () => {
    for (const pageType of ["concept", "entity", "topic", "claim", "question"] as const) {
      const fixture = createFixture({ pageType });
      expect(fixture.service.open({ activeVaultId: VAULT_ID, pageId: PAGE_ID })).toEqual({ status: "failed" });
      expect(fixture.records).toEqual([]);
    }

    const fixture = createFixture();
    const opened = requireOpened(fixture.service);
    expect(fixture.service.save({
      requestId: "request_page_type_change",
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      markdown: opened.markdown.replace('type: "note"', 'type: "source"')
    })).toMatchObject({ status: "invalid", invalidReason: "unsupported_page_type" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.markdown);
    expect(fixture.records).toEqual([]);
  });

  it("preserves exact CAS and forward Undo for a generated type-note page", () => {
    const fixture = createAdapterFixture({ pageRelativePath: `wiki/generated/${PAGE_ID}.md` });
    const committed = commitEdit(fixture);
    const operation = readOperation(fixture.vaultPath, committed.operationId);

    expect(operation.targetRefs).toEqual([
      { kind: "page", id: PAGE_ID, path: `wiki/generated/${PAGE_ID}.md` }
    ]);
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(committed.markdown);
    expect(fixture.adapter.undo(operation, committed.revisionId)).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.markdown);
  });

  it("persists archive_page Activity and Undo restores the exact active bytes", () => {
    const fixture = createAdapterFixture();
    const opened = requireOpened(fixture.service);
    const markdown = opened.markdown
      .replace('updated_at: "2026-07-27T10:00:00.000Z"', "updated_at: 2026-07-27T12:00:00.000Z")
      .replace('status: "active"', "status: archived");
    const committed = fixture.service.save({
      requestId: "noteeditreq_archivefixture",
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      markdown
    }, "archive_page");
    expect(committed.status).toBe("committed");
    if (committed.status !== "committed") throw new Error("Expected archive to commit.");
    const operation = readOperation(fixture.vaultPath, committed.operationId);
    expect(fixture.adapter.activitySummary(operation)).toMatchObject({ kind: "archive_page", canUndo: true });
    expect(fixture.adapter.undo(operation, committed.revisionId)).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.markdown);
  });

  it.each(["claim", "question", "concept", "entity"] as const)(
    "keeps typed %s archive Activity undoable and redoable after restart",
    (pageType) => {
      const fixture = createAdapterFixture({
        pageType, allowClaim: true, allowQuestion: true, allowConcept: true, allowEntity: true
      });
      const opened = requireOpened(fixture.service);
      const archived = opened.markdown
        .replace('updated_at: "2026-07-27T10:00:00.000Z"', "updated_at: 2026-07-27T12:00:00.000Z")
        .replace('status: "active"', "status: archived");
      const committed = fixture.service.save({
        requestId: `noteeditreq_archive_${pageType}`,
        activeVaultId: VAULT_ID, pageId: PAGE_ID,
        expectedRevisionId: opened.revisionId, renderIdentity: opened.renderIdentity, markdown: archived
      }, "archive_page");
      expect(committed.status).toBe("committed");
      if (committed.status !== "committed") throw new Error("Expected typed archive to commit.");
      const operation = readOperation(fixture.vaultPath, committed.operationId);
      const restarted = new NoteMarkdownEditorActivityAdapter(fixture.vaults);
      expect(restarted.activitySummary(operation)).toMatchObject({ kind: "archive_page", canUndo: true });
      expect(restarted.undo(operation, committed.revisionId)).toMatchObject({ status: "undone" });
      expect(new NoteMarkdownEditorRedoService(fixture.vaults).redo({ operationId: operation.id }))
        .toMatchObject({ status: "redone" });
      expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(archived);
    }
  );

  it("persists restore_page Activity and Undo restores the exact archived bytes", () => {
    const fixture = createAdapterFixture();
    const archived = fixture.markdown
      .replace('status: "active"', "status: archived")
      .replace('updated_at: "2026-07-27T10:00:00.000Z"', "updated_at: 2026-07-27T11:00:00.000Z");
    fs.writeFileSync(fixture.pagePath, archived, "utf8");
    const opened = requireOpened(fixture.service);
    const active = opened.markdown
      .replace("status: archived", "status: active")
      .replace("updated_at: 2026-07-27T11:00:00.000Z", "updated_at: 2026-07-27T12:00:00.000Z");
    const committed = fixture.service.save({
      requestId: "noteeditreq_restorefixture",
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      markdown: active
    }, "restore_page");
    expect(committed.status).toBe("committed");
    if (committed.status !== "committed") throw new Error("Expected restore to commit.");
    const operation = readOperation(fixture.vaultPath, committed.operationId);
    expect(fixture.adapter.activitySummary(operation)).toMatchObject({ kind: "restore_page", canUndo: true });
    expect(fixture.adapter.undo(operation, committed.revisionId)).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(archived);
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

describe("NoteMarkdownEditorActivityAdapter", () => {
  it("persists and idempotently adopts one exact before-image and user update_page Operation", () => {
    const fixture = createAdapterFixture();
    const committed = commitEdit(fixture);
    const operation = readOperation(fixture.vaultPath, committed.operationId);
    const beforePath = resolveRelative(fixture.vaultPath, operation.before?.path);

    expect(fs.readFileSync(beforePath, "utf8")).toBe(fixture.markdown);
    expect(operation).toMatchObject({
      actor: { kind: "user", runtimeKind: "desktop_local" },
      kind: "update_page",
      sourceRefs: [],
      reversible: "yes"
    });
    expect(() => fixture.adapter.recordPageUpdate({
      vaultPath: fixture.vaultPath,
      operation,
      beforeMarkdown: fixture.markdown,
      afterMarkdown: committed.markdown
    })).not.toThrow();
    expect(() => fixture.adapter.recordPageUpdate({
      vaultPath: fixture.vaultPath,
      operation,
      beforeMarkdown: fixture.markdown.replace("Original body.", "Wrong before body."),
      afterMarkdown: committed.markdown
    })).toThrow("invalid");
    expect(listOperationFiles(fixture.vaultPath)).toHaveLength(1);
  });

  it("projects a safe Activity and restores exact bytes through one forward user update", () => {
    const fixture = createAdapterFixture();
    const committed = commitEdit(fixture);
    const operation = readOperation(fixture.vaultPath, committed.operationId);
    const summary = fixture.adapter.activitySummary(operation);

    expect(summary).toEqual({
      operationId: operation.id,
      kind: "update_page",
      createdAt: operation.createdAt,
      targetLabel: "Markdown editor fixture",
      target: { kind: "page", pageId: PAGE_ID },
      status: "applied",
      canUndo: true
    });
    expect(JSON.stringify(summary)).not.toContain("wiki/");
    expect(JSON.stringify(summary)).not.toContain("sha256:");
    expect(JSON.stringify(summary)).not.toContain("Edited body");

    const undone = fixture.adapter.undo(operation, committed.revisionId);
    expect(undone).toMatchObject({
      status: "undone",
      operationId: operation.id,
      revisionId: operation.before?.id
    });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.markdown);
    const undo = readOperation(fixture.vaultPath, requireValue(undone.undoOperationId));
    expect(undo).toMatchObject({
      actor: { kind: "user" },
      kind: "update_page",
      sourceRefs: [{ kind: "operation", id: operation.id }],
      before: { id: operation.after?.id },
      after: { id: operation.before?.id },
      reversible: "best_effort"
    });
    expect(fixture.adapter.findUndoOperation(operation, [operation, undo])).toEqual(undo);
    expect(fixture.adapter.activitySummary(operation, undo)).toMatchObject({
      status: "undone",
      canUndo: false,
      undoUnavailableReason: "already_undone"
    });
    expect(fixture.adapter.undo(operation, committed.revisionId)).toMatchObject({
      status: "already_undone",
      undoOperationId: undo.id
    });
  });

  it("records and restores a Source Page sidecar edit without changing its source ownership", () => {
    const fixture = createAdapterFixture({ pageType: "source", pageRelativePath: `sources/${PAGE_ID}.md` });
    const committed = commitEdit(fixture);
    const operation = readOperation(fixture.vaultPath, committed.operationId);
    expect(operation).toMatchObject({ kind: "update_page", targetRefs: [{ kind: "page", id: PAGE_ID }] });
    expect(fixture.adapter.activitySummary(operation)).toMatchObject({ status: "applied", canUndo: true });
    expect(fixture.adapter.undo(operation, committed.revisionId)).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.markdown);
    const redoService = new NoteMarkdownEditorRedoService(fixture.vaults);
    const redone = redoService.redo({
      operationId: operation.id,
      expectedRevisionId: operation.before?.id
    });
    expect(redone).toMatchObject({ status: "redone", revisionId: committed.revisionId });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(committed.markdown);
    fs.unlinkSync(operationPath(fixture.vaultPath, requireValue(redone.redoOperationId)));
    expect(redoService.recoverIncompleteRedos()).toEqual({ recovered: 1, failed: 0 });
    expect(fixture.adapter.recoverIncompleteOperations()).toEqual({ recovered: 0, failed: 0 });
  });

  it("records an allowed question-state and answer-link update and converges Undo and Redo after restart", () => {
    const fixture = createAdapterFixture({ pageType: "question", allowQuestion: true });
    const opened = requireOpened(fixture.service);
    const markdown = opened.markdown
      .replace('  state: "open"', '  state: "answered"')
      .replace("  answered_by: []", '  answered_by: ["page_20260801_answer001"]')
      .replace('updated_at: "2026-07-27T10:00:00.000Z"', "updated_at: 2026-07-27T12:00:00.000Z");
    const committed = fixture.service.save({
      requestId: "noteeditreq_questionstatefixture",
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      markdown
    });
    expect(committed.status).toBe("committed");
    if (committed.status !== "committed") throw new Error("Expected question state to commit.");
    const operation = readOperation(fixture.vaultPath, committed.operationId);
    const restartedActivity = new NoteMarkdownEditorActivityAdapter(fixture.vaults);
    expect(restartedActivity.activitySummary(operation)).toMatchObject({ status: "applied", canUndo: true });
    expect(restartedActivity.undo(operation, committed.revisionId)).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain('  state: "open"');
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain("  answered_by: []");
    expect(new NoteMarkdownEditorRedoService(fixture.vaults).redo({
      operationId: operation.id,
      expectedRevisionId: operation.before?.id
    })).toMatchObject({ status: "redone", revisionId: committed.revisionId });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain('  state: "answered"');
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain('  answered_by: ["page_20260801_answer001"]');
  });

  it("records an allowed concept hierarchy update and converges Undo and Redo after restart", () => {
    const fixture = createAdapterFixture({ pageType: "concept", allowConcept: true });
    const opened = requireOpened(fixture.service);
    const markdown = opened.markdown
      .replace("  parent_concepts: []", '  parent_concepts: ["page_20260801_parentconcept"]')
      .replace('updated_at: "2026-07-27T10:00:00.000Z"', "updated_at: 2026-07-27T12:00:00.000Z");
    const committed = fixture.service.save({ requestId: "noteeditreq_conceptparentfixture", activeVaultId: VAULT_ID,
      pageId: PAGE_ID, expectedRevisionId: opened.revisionId, renderIdentity: opened.renderIdentity, markdown });
    expect(committed.status).toBe("committed");
    if (committed.status !== "committed") throw new Error("Expected concept parent update to commit.");
    const operation = readOperation(fixture.vaultPath, committed.operationId);
    const restarted = new NoteMarkdownEditorActivityAdapter(fixture.vaults);
    expect(restarted.activitySummary(operation)).toMatchObject({ status: "applied", canUndo: true });
    expect(restarted.undo(operation, committed.revisionId)).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain("  parent_concepts: []");
    expect(new NoteMarkdownEditorRedoService(fixture.vaults).redo({ operationId: operation.id,
      expectedRevisionId: operation.before?.id })).toMatchObject({ status: "redone", revisionId: committed.revisionId });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain('  parent_concepts: ["page_20260801_parentconcept"]');
  });

  it("recovers only an exact interrupted forward Undo and remains idempotent", () => {
    const fixture = createAdapterFixture();
    const committed = commitEdit(fixture);
    const operation = readOperation(fixture.vaultPath, committed.operationId);
    const undone = fixture.adapter.undo(operation, committed.revisionId);
    const undoOperationId = requireValue(undone.undoOperationId);
    fs.unlinkSync(operationPath(fixture.vaultPath, undoOperationId));

    expect(fixture.adapter.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    const recoveredUndo = readOperation(fixture.vaultPath, undoOperationId);
    expect(fixture.adapter.findUndoOperation(operation, [operation, recoveredUndo])).toEqual(recoveredUndo);
    expect(fixture.adapter.recoverIncompleteOperations()).toEqual({ recovered: 0, failed: 0 });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.markdown);
  });

  it("redoes an exact Undo as a new reversible update and adopts an interrupted commit", () => {
    const fixture = createAdapterFixture();
    const committed = commitEdit(fixture);
    const operation = readOperation(fixture.vaultPath, committed.operationId);
    const undone = fixture.adapter.undo(operation, committed.revisionId);
    const undo = readOperation(fixture.vaultPath, requireValue(undone.undoOperationId));
    expect(fixture.adapter.activitySummary(operation, undo)).toMatchObject({
      status: "undone",
      canRedo: true
    });

    const redoService = new NoteMarkdownEditorRedoService(fixture.vaults);
    const redone = redoService.redo({ operationId: operation.id, expectedRevisionId: operation.before?.id });
    expect(redone).toMatchObject({
      status: "redone",
      operationId: operation.id,
      undoOperationId: undo.id,
      revisionId: operation.after?.id
    });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(committed.markdown);
    const redo = readOperation(fixture.vaultPath, requireValue(redone.redoOperationId));
    expect(redo).toMatchObject({
      kind: "update_page",
      sourceRefs: [],
      before: { id: operation.before?.id },
      after: { id: operation.after?.id },
      reversible: "yes"
    });
    expect(fixture.adapter.activitySummary(operation, undo)).toMatchObject({
      status: "undone",
      canRedo: false,
      redoUnavailableReason: "already_redone"
    });
    expect(fixture.adapter.activitySummary(redo)).toMatchObject({ status: "applied", canUndo: true });
    expect(redoService.redo({ operationId: operation.id })).toMatchObject({ status: "already_redone" });

    fs.unlinkSync(operationPath(fixture.vaultPath, redo.id));
    expect(redoService.recoverIncompleteRedos()).toEqual({ recovered: 1, failed: 0 });
    expect(readOperation(fixture.vaultPath, redo.id)).toEqual(redo);
    expect(redoService.recoverIncompleteRedos()).toEqual({ recovered: 0, failed: 0 });
  });

  it("fails Redo closed after current Markdown or durable history drifts", () => {
    const fixture = createAdapterFixture();
    const committed = commitEdit(fixture);
    const operation = readOperation(fixture.vaultPath, committed.operationId);
    fixture.adapter.undo(operation, committed.revisionId);
    fs.writeFileSync(fixture.pagePath, fixture.markdown.replace("Original body.", "External body."), "utf8");
    const redoService = new NoteMarkdownEditorRedoService(fixture.vaults);

    expect(redoService.redo({ operationId: operation.id })).toMatchObject({ status: "stale" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain("External body.");
    expect(listOperationFiles(fixture.vaultPath)).toHaveLength(2);
  });

  it("rejects malformed or non-user update operations without granting Activity or Undo authority", () => {
    const fixture = createAdapterFixture();
    const committed = commitEdit(fixture);
    const operation = readOperation(fixture.vaultPath, committed.operationId);
    const malformed = {
      ...operation,
      sourceRefs: [{ kind: "operation" as const, id: "op_20260727_untrustedref" }]
    };

    expect(fixture.adapter.activitySummary(malformed)).toBeUndefined();
    expect(fixture.adapter.findUndoOperation(malformed, [])).toBeUndefined();
    expect(fixture.adapter.undo(malformed)).toEqual({ status: "not_found", operationId: operation.id });
    expect(() => fixture.adapter.recordPageUpdate({
      vaultPath: fixture.vaultPath,
      operation: malformed,
      beforeMarkdown: fixture.markdown,
      afterMarkdown: committed.markdown
    })).toThrow("invalid");
    expect(listOperationFiles(fixture.vaultPath)).toHaveLength(1);
  });
});

interface ActivityRecord {
  readonly vaultPath: string;
  readonly operation: OperationRecord;
  readonly beforeMarkdown: string;
  readonly afterMarkdown: string;
}

function createFixture(options: {
  readonly pageType?: "note" | "source" | "concept" | "entity" | "topic" | "claim" | "question";
  readonly pageRelativePath?: string;
  readonly allowQuestion?: boolean;
  readonly allowConcept?: boolean;
  readonly allowClaim?: boolean;
  readonly allowEntity?: boolean;
} = {}): {
  readonly root: string;
  readonly vaultPath: string;
  readonly pagePath: string;
  readonly markdown: string;
  readonly records: ActivityRecord[];
  readonly vaults: NoteMarkdownEditorVaultPort;
  readonly service: NoteMarkdownEditorService;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-note-markdown-editor-"));
  roots.push(root);
  const vaultPath = path.join(root, "vault");
  const pagePath = path.join(vaultPath, options.pageRelativePath ?? `wiki/${PAGE_ID}.md`);
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  const markdown = createMarkdown(options.pageType);
  fs.writeFileSync(pagePath, markdown, { encoding: "utf8", mode: 0o600 });
  const records: ActivityRecord[] = [];
  const activity: NoteMarkdownEditorActivityPort = {
    recordPageUpdate: (input) => records.push(input)
  };
  const vaults = createVaultPort(vaultPath);
  const service = new NoteMarkdownEditorService(
    vaults,
    activity,
    {
      now: () => new Date("2026-07-27T12:00:00.000Z"),
      randomId: () => "fixture-random-id",
      allowClaim: options.allowClaim,
      allowQuestion: options.allowQuestion,
      allowConcept: options.allowConcept,
      allowEntity: options.allowEntity
    }
  );
  return { root, vaultPath, pagePath, markdown, records, vaults, service };
}

function createAdapterFixture(options: Parameters<typeof createFixture>[0] = {}) {
  const fixture = createFixture(options);
  const adapter = new NoteMarkdownEditorActivityAdapter(fixture.vaults);
  const service = new NoteMarkdownEditorService(
    fixture.vaults,
    adapter,
    {
      now: () => new Date("2026-07-27T12:00:00.000Z"),
      randomId: () => "adapter-fixture-random-id",
      allowClaim: options.allowClaim,
      allowQuestion: options.allowQuestion,
      allowConcept: options.allowConcept,
      allowEntity: options.allowEntity
    }
  );
  return { ...fixture, adapter, service };
}

function commitEdit(fixture: ReturnType<typeof createAdapterFixture>) {
  const opened = requireOpened(fixture.service);
  const markdown = opened.markdown.replace("Original body.", "Edited body.");
  const committed = fixture.service.save({
    requestId: "request_activity_adapter_save",
    activeVaultId: VAULT_ID,
    pageId: PAGE_ID,
    expectedRevisionId: opened.revisionId,
    renderIdentity: opened.renderIdentity,
    markdown
  });
  if (committed.status !== "committed") throw new Error("Expected the adapter edit to commit.");
  return { ...committed, markdown };
}

function createVaultPort(vaultPath: string): NoteMarkdownEditorVaultPort {
  return {
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
  };
}

function readOperation(vaultPath: string, operationId: string): OperationRecord {
  return JSON.parse(fs.readFileSync(operationPath(vaultPath, operationId), "utf8")) as OperationRecord;
}

function operationPath(vaultPath: string, operationId: string): string {
  const dateKey = /^op_(\d{8})_/u.exec(operationId)?.[1];
  if (!dateKey) throw new Error("Invalid Operation fixture identity.");
  return path.join(
    vaultPath,
    ".pige",
    "operations",
    dateKey.slice(0, 4),
    dateKey.slice(4, 6),
    `${operationId}.json`
  );
}

function listOperationFiles(vaultPath: string): readonly string[] {
  const root = path.join(vaultPath, ".pige", "operations");
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(entryPath);
    }
  };
  visit(root);
  return files;
}

function resolveRelative(vaultPath: string, relativePath: string | undefined): string {
  if (!relativePath) throw new Error("Expected a private relative path.");
  return path.join(vaultPath, ...relativePath.split("/"));
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected a value.");
  return value;
}

function requireOpened(service: NoteMarkdownEditorService) {
  const opened = service.open({ activeVaultId: VAULT_ID, pageId: PAGE_ID });
  if (opened.status !== "opened") throw new Error("Expected an opened Markdown page.");
  return opened;
}

function createMarkdown(pageType: "note" | "source" | "concept" | "entity" | "topic" | "claim" | "question" = "note"): string {
  const sourceOwnership = pageType === "source" ? `provenance:
  generated_by: "pige"
  last_job_id: "job_20260727_markdowneditor"
source:
  id: "${SOURCE_ID}"
  kind: "text_file"
  storage_strategy: "copy_to_source_library"
  source_record_path: ".pige/source-records/2026/07/source.json"
  source_record_schema_version: 1
  source_record_updated_at: "2026-07-27T10:00:00.000Z"
  captured_at: "2026-07-27T10:00:00.000Z"
  availability: "available"
` : "";
  const questionState = pageType === "question" ? `question:
  state: "open"
  answered_by: []
` : "";
  const conceptHierarchy = pageType === "concept" ? `concept:
  parent_concepts: []
  child_concepts: []
` : "";
  return `---
id: "${PAGE_ID}"
schema_version: 1
title: "Markdown editor fixture"
type: "${pageType}"
created_at: "2026-07-27T10:00:00.000Z"
updated_at: "2026-07-27T10:00:00.000Z"
status: "active"
language: "en"
aliases: []
tags: ["editing"]
topics: []
source_ids: ["${SOURCE_ID}"]
${sourceOwnership}${questionState}${conceptHierarchy}---

# Markdown editor fixture

Original body.
`;
}
