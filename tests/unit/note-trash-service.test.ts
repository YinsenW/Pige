import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NoteTrashService } from "../../apps/desktop/src/main/services/note-trash-service";
import { NoteMarkdownEditorService } from "../../apps/desktop/src/main/services/note-markdown-editor-service";
import { NotesService } from "../../apps/desktop/src/main/services/notes-service";
import { KnowledgeActivityService } from "../../apps/desktop/src/main/services/knowledge-activity-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("NoteTrashService", () => {
  it("moves one exact rendered note to recoverable trash and restores it through Activity after restart", async () => {
    const fixture = createFixture();
    const rendered = await fixture.notes.render({ pageId: fixture.pageId }, fixture.ownerId);
    const request = {
      apiVersion: 1 as const,
      requestId: "notetrashreq_abcdefghijklmnop",
      activeVaultId: fixture.vault.vaultId,
      currentPageId: fixture.pageId,
      renderContextId: rendered.renderContextId!,
      expectedRevision: fixture.revision()
    };
    expect(fixture.notes.resolveTrashTarget(fixture.ownerId, {
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      renderContextId: request.renderContextId,
      expectedRevision: request.expectedRevision
    })).toMatchObject({ status: "ready" });
    const first = fixture.service.trash(fixture.ownerId, request);

    expect(first).toMatchObject({
      status: "committed",
      requestId: request.requestId,
      activeVaultId: fixture.vault.vaultId,
      currentPageId: fixture.pageId,
      operationId: expect.stringMatching(/^op_20260730_[a-f0-9]{16}$/u)
    });
    expect(fs.existsSync(fixture.pagePath)).toBe(false);
    expect(readTrashFiles(fixture.vaultPath)).toEqual([fixture.content]);

    const restarted = new NoteTrashService(fixture.vaults, fixture.notes, {
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      randomId: () => "must-not-be-used-on-replay"
    });
    expect(restarted.trash(fixture.ownerId, request)).toEqual(first);
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });

    const operation = readOperation(fixture.vaultPath, first.operationId!);
    expect(fs.readdirSync(path.join(fixture.vaultPath, ".pige", "trash", "note-receipts"))).toHaveLength(1);
    expect(restarted.activitySummary(operation, undefined)).toBeDefined();
    const activity = new KnowledgeActivityService(fixture.vaults, undefined, undefined, undefined, restarted);
    expect(activity.list()).toMatchObject({ total: 1, invalidOperationCount: 0, activities: [{
      operationId: first.operationId,
      kind: "trash_page",
      targetLabel: "Recoverable note",
      target: { kind: "page", pageId: fixture.pageId },
      status: "applied",
      canUndo: true
    }] });
    expect(JSON.stringify(activity.list())).not.toContain(fixture.pagePath);

    const restored = activity.undo({ operationId: operation.id });
    expect(restored).toMatchObject({
      status: "undone",
      operationId: first.operationId,
      undoOperationId: expect.stringMatching(/^op_20260730_[a-f0-9]{16}$/u)
    });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.content);
    expect(readTrashFiles(fixture.vaultPath)).toEqual([]);
    const undo = readOperation(fixture.vaultPath, restored.undoOperationId!);
    expect(restarted.activitySummary(operation, undo)).toMatchObject({
      status: "undone",
      canUndo: false,
      undoUnavailableReason: "already_undone"
    });
    expect(activity.undo({ operationId: operation.id })).toEqual({
      status: "already_undone",
      operationId: first.operationId,
      undoOperationId: restored.undoOperationId
    });
  });

  it("fails stale without replacing a note that changed or reoccupied its original path", async () => {
    const changed = createFixture();
    const rendered = await changed.notes.render({ pageId: changed.pageId }, changed.ownerId);
    fs.appendFileSync(changed.pagePath, "\nExternal edit.\n", "utf8");
    expect(changed.service.trash(changed.ownerId, {
      apiVersion: 1,
      requestId: "notetrashreq_changed123456789",
      activeVaultId: changed.vault.vaultId,
      currentPageId: changed.pageId,
      renderContextId: rendered.renderContextId!,
      expectedRevision: changed.revision()
    })).toMatchObject({ status: "stale" });
    expect(fs.readFileSync(changed.pagePath, "utf8")).toContain("External edit.");
    expect(readTrashFiles(changed.vaultPath)).toEqual([]);

    const occupied = createFixture();
    const occupiedRender = await occupied.notes.render({ pageId: occupied.pageId }, occupied.ownerId);
    const committed = occupied.service.trash(occupied.ownerId, {
      apiVersion: 1,
      requestId: "notetrashreq_occupied12345678",
      activeVaultId: occupied.vault.vaultId,
      currentPageId: occupied.pageId,
      renderContextId: occupiedRender.renderContextId!,
      expectedRevision: occupied.revision()
    });
    expect(committed.status).toBe("committed");
    fs.writeFileSync(occupied.pagePath, "Unrelated replacement.\n", "utf8");
    const operation = readOperation(occupied.vaultPath, committed.operationId!);
    expect(occupied.service.undo(operation)).toMatchObject({ status: "stale" });
    expect(fs.readFileSync(occupied.pagePath, "utf8")).toBe("Unrelated replacement.\n");
    expect(readTrashFiles(occupied.vaultPath)).toEqual([occupied.content]);
  });
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-note-trash-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Trash Notes",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-30T12:00:00.000Z")
  });
  const vaultPath = path.join(root, "Trash Notes");
  const vault = loadVaultSummary(vaultPath);
  const pageId = "page_20260730_recoverablenote";
  const pagePath = path.join(vaultPath, "wiki", "recoverable-note.md");
  const content = `---\nid: "${pageId}"\nschema_version: 1\ntitle: "Recoverable note"\ntype: "note"\ncreated_at: "2026-07-30T12:00:00.000Z"\nupdated_at: "2026-07-30T12:00:00.000Z"\nstatus: "active"\naliases: []\nsource_ids: []\n---\n\n# Recoverable note\n\nKeep these exact bytes.\n`;
  fs.writeFileSync(pagePath, content, { encoding: "utf8", mode: 0o600 });
  const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
  const editor = new NoteMarkdownEditorService(vaults, { recordPageUpdate: () => undefined });
  const notes = new NotesService(vaults, undefined, undefined, editor);
  return {
    vaultPath,
    vault,
    vaults,
    notes,
    service: new NoteTrashService(vaults, notes, {
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      randomId: () => "fixed-random-id"
    }),
    pageId,
    pagePath,
    content,
    ownerId: "note_trash_test_owner",
    revision: () => {
      const opened = editor.open({ activeVaultId: vault.vaultId, pageId });
      if (opened.status !== "opened") throw new Error("The fixture note did not open.");
      return `noteeditrev_${opened.revisionId.slice("sha256:".length)}`;
    }
  };
}

function readTrashFiles(vaultPath: string): string[] {
  const root = path.join(vaultPath, ".pige", "trash", "pages");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).flatMap((operationId) => {
    const directory = path.join(root, operationId);
    return fs.readdirSync(directory).filter((name) => !name.startsWith(".")).map((name) => fs.readFileSync(path.join(directory, name), "utf8"));
  });
}

function readOperation(vaultPath: string, operationId: string) {
  const dateKey = /^op_(\d{8})_/u.exec(operationId)?.[1];
  if (!dateKey) throw new Error("Invalid fixture Operation identity.");
  return JSON.parse(fs.readFileSync(path.join(
    vaultPath,
    ".pige",
    "operations",
    dateKey.slice(0, 4),
    dateKey.slice(4, 6),
    `${operationId}.json`
  ), "utf8"));
}
