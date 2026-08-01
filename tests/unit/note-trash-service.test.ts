import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteTrashService } from "../../apps/desktop/src/main/services/note-trash-service";
import { NoteTrashRedoService } from "../../apps/desktop/src/main/services/note-trash-redo-service";
import { NoteMarkdownEditorService } from "../../apps/desktop/src/main/services/note-markdown-editor-service";
import { NotesService } from "../../apps/desktop/src/main/services/notes-service";
import { KnowledgeActivityService } from "../../apps/desktop/src/main/services/knowledge-activity-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("NoteTrashService", () => {
  it.each(["claim", "question", "concept", "entity", "topic"] as const)(
    "trashes one exact active user-authored %s and converges through Undo, Redo, restart, and public restore",
    async (pageType) => {
    const fixture = createFixture({ pageId: `page_20260801_${pageType}trash`, pageType,
      title: `Recoverable ${pageType}`, generatedBy: "user" });
    const rendered = await fixture.notes.render({ pageId: fixture.pageId }, fixture.ownerId);
    expect(rendered.trashEligibility).toEqual({
      canTrash: true,
      revision: fixture.revision()
    });
    const trashed = fixture.service.trash(fixture.ownerId, {
      apiVersion: 1,
      requestId: `notetrashreq_${pageType}lifecycle1234`,
      activeVaultId: fixture.vault.vaultId,
      currentPageId: fixture.pageId,
      renderContextId: rendered.renderContextId!,
      expectedRevision: rendered.trashEligibility!.revision
    });
    expect(trashed).toMatchObject({ status: "committed" });

    const restarted = new NoteTrashService(fixture.vaults, fixture.notes);
    const activity = new KnowledgeActivityService(fixture.vaults, undefined, undefined, undefined, restarted);
    const trashOperation = readOperation(fixture.vaultPath, trashed.operationId!);
    expect(activity.undo({ operationId: trashOperation.id })).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.content);

    const redone = new NoteTrashRedoService(fixture.vaults, {
      now: () => new Date("2026-08-01T12:01:00.000Z")
    }).redo({ operationId: trashOperation.id });
    expect(redone).toMatchObject({ status: "redone" });
    const listed = restarted.list({
      apiVersion: 1,
      requestId: `notetrashlistreq_${pageType}lifecycle12`,
      activeVaultId: fixture.vault.vaultId
    });
    expect(listed).toMatchObject({ status: "ready", notes: [{
      pageId: fixture.pageId,
      title: `Recoverable ${pageType}`,
      canRestore: true
    }] });
    if (listed.status !== "ready" || !listed.notes[0]) throw new Error(`Expected one recoverable ${pageType}.`);
    expect(new NoteTrashService(fixture.vaults, fixture.notes).restore({
      apiVersion: 1,
      requestId: `notetrashrestorereq_${pageType}lifecycle12`,
      activeVaultId: fixture.vault.vaultId,
      pageId: fixture.pageId,
      trashOperationId: listed.notes[0].trashOperationId,
      expectedTrashRevision: listed.notes[0].expectedTrashRevision
    })).toMatchObject({ status: "committed" });
    expect((await fixture.notes.render({ pageId: fixture.pageId }, fixture.ownerId)).summary.pageType).toBe(pageType);
  });

  it("lists pathless recoverable notes after restart and restores one exact receipt into Reader truth", async () => {
    const fixture = createFixture();
    const rendered = await fixture.notes.render({ pageId: fixture.pageId }, fixture.ownerId);
    const trashed = fixture.service.trash(fixture.ownerId, {
      apiVersion: 1,
      requestId: "notetrashreq_publicrestore12345",
      activeVaultId: fixture.vault.vaultId,
      currentPageId: fixture.pageId,
      renderContextId: rendered.renderContextId!,
      expectedRevision: fixture.revision()
    });
    expect(trashed.status).toBe("committed");

    const restarted = new NoteTrashService(fixture.vaults, fixture.notes);
    const listed = restarted.list({
      apiVersion: 1,
      requestId: "notetrashlistreq_afterrestart1234",
      activeVaultId: fixture.vault.vaultId
    });
    expect(listed).toMatchObject({ status: "ready", notes: [{
      pageId: fixture.pageId,
      title: "Recoverable note",
      trashOperationId: trashed.operationId,
      expectedTrashRevision: expect.stringMatching(/^notetrashrev_[a-f0-9]{64}$/u),
      canRestore: true
    }] });
    expect(JSON.stringify(listed)).not.toContain(fixture.vaultPath);
    expect(JSON.stringify(listed)).not.toContain("Keep these exact bytes");
    if (listed.status !== "ready" || !listed.notes[0]) throw new Error("Expected one recoverable note.");
    const request = {
      apiVersion: 1 as const,
      requestId: "notetrashrestorereq_afterrestart1234",
      activeVaultId: fixture.vault.vaultId,
      pageId: listed.notes[0].pageId,
      trashOperationId: listed.notes[0].trashOperationId,
      expectedTrashRevision: listed.notes[0].expectedTrashRevision
    };
    const restored = restarted.restore(request);
    expect(restored).toMatchObject({ status: "committed", operationId: expect.stringMatching(/^op_\d{8}_[a-f0-9]{16}$/u) });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.content);
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain("src_20260730_recoverable01");
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain("[[Linked note]]");
    expect(restarted.list({
      apiVersion: 1,
      requestId: "notetrashlistreq_afterrestore1234",
      activeVaultId: request.activeVaultId
    }))
      .toMatchObject({ status: "ready", notes: [] });
    expect(new NoteTrashService(fixture.vaults, fixture.notes).restore(request)).toEqual(restored);
  });

  it("fails missing, tampered, active-vault, and reoccupied-path restore candidates closed", async () => {
    const fixture = createFixture();
    const rendered = await fixture.notes.render({ pageId: fixture.pageId }, fixture.ownerId);
    fixture.service.trash(fixture.ownerId, {
      apiVersion: 1, requestId: "notetrashreq_failclosed123456", activeVaultId: fixture.vault.vaultId,
      currentPageId: fixture.pageId, renderContextId: rendered.renderContextId!, expectedRevision: fixture.revision()
    });
    const listed = fixture.service.list({ apiVersion: 1, requestId: "notetrashlistreq_failclosed123456",
      activeVaultId: fixture.vault.vaultId });
    if (listed.status !== "ready" || !listed.notes[0]) throw new Error("Expected one recoverable note.");
    const request = { apiVersion: 1 as const, requestId: "notetrashrestorereq_failclosed123456",
      activeVaultId: fixture.vault.vaultId, pageId: fixture.pageId,
      trashOperationId: listed.notes[0].trashOperationId, expectedTrashRevision: listed.notes[0].expectedTrashRevision };
    expect(fixture.service.restore({ ...request, activeVaultId: "vault_20260730_wrongactive" }))
      .toMatchObject({ status: "failed" });
    const receiptRoot = path.join(fixture.vaultPath, ".pige", "trash", "note-receipts");
    const receiptPath = path.join(receiptRoot, fs.readdirSync(receiptRoot)[0]!);
    const receiptBytes = fs.readFileSync(receiptPath, "utf8");
    const receipt = JSON.parse(receiptBytes);
    fs.writeFileSync(receiptPath, `${JSON.stringify({ ...receipt, contentHash: `sha256:${"c".repeat(64)}` }, null, 2)}\n`, "utf8");
    expect(fixture.service.restore(request)).toMatchObject({ status: "stale" });
    fs.writeFileSync(receiptPath, receiptBytes, "utf8");
    fs.writeFileSync(fixture.pagePath, "Unrelated replacement.\n", "utf8");
    expect(fixture.service.restore(request)).toMatchObject({ status: "stale" });
    fs.unlinkSync(fixture.pagePath);
    const trashRoot = path.join(fixture.vaultPath, ".pige", "trash", "pages", request.trashOperationId);
    const trashPath = path.join(trashRoot, fs.readdirSync(trashRoot)[0]!);
    fs.appendFileSync(trashPath, "\nTampered.\n", "utf8");
    expect(fixture.service.restore(request)).toMatchObject({ status: "not_found" });
    fs.unlinkSync(trashPath);
    expect(fixture.service.restore(request)).toMatchObject({ status: "not_found" });
  });

  it("adopts a prepared public restore after restart without duplicating its Operation", async () => {
    const fixture = createFixture();
    const rendered = await fixture.notes.render({ pageId: fixture.pageId }, fixture.ownerId);
    const trashed = fixture.service.trash(fixture.ownerId, {
      apiVersion: 1, requestId: "notetrashreq_restorecrash1234", activeVaultId: fixture.vault.vaultId,
      currentPageId: fixture.pageId, renderContextId: rendered.renderContextId!, expectedRevision: fixture.revision()
    });
    expect(trashed.status).toBe("committed");
    const listed = fixture.service.list({ apiVersion: 1, requestId: "notetrashlistreq_restorecrash1234",
      activeVaultId: fixture.vault.vaultId });
    if (listed.status !== "ready" || !listed.notes[0]) throw new Error("Expected one recoverable note.");
    const request = { apiVersion: 1 as const, requestId: "notetrashrestorereq_restorecrash1234",
      activeVaultId: fixture.vault.vaultId, pageId: fixture.pageId,
      trashOperationId: listed.notes[0].trashOperationId, expectedTrashRevision: listed.notes[0].expectedTrashRevision };
    const openSync = fs.openSync.bind(fs);
    const spy = vi.spyOn(fs, "openSync").mockImplementation(((filePath: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
      if (String(filePath).includes(`${path.sep}.pige${path.sep}operations${path.sep}`) &&
        !String(filePath).endsWith(`${request.trashOperationId}.json`)) throw new Error("crash before restore Operation");
      return openSync(filePath, flags, mode);
    }) as typeof fs.openSync);
    expect(fixture.service.restore(request)).toMatchObject({ status: "failed" });
    spy.mockRestore();
    expect(fs.existsSync(fixture.pagePath)).toBe(true);
    expect(readTrashFiles(fixture.vaultPath)).toEqual([fixture.content]);

    const restarted = new NoteTrashService(fixture.vaults, fixture.notes);
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.content);
    expect(readTrashFiles(fixture.vaultPath)).toEqual([]);
    expect(restarted.restore(request)).toMatchObject({ status: "committed" });
    expect(readOperationKinds(fixture.vaultPath).filter((kind) => kind === "restore_page")).toHaveLength(1);
  });

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
      status: "applied",
      canUndo: true
    }] });
    expect(activity.list().activities[0]).not.toHaveProperty("target");
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
      undoUnavailableReason: "already_undone",
      target: { kind: "page", pageId: fixture.pageId }
    });
    expect(activity.undo({ operationId: operation.id })).toEqual({
      status: "already_undone",
      operationId: first.operationId,
      undoOperationId: restored.undoOperationId
    });
  });

  it("redoes an undone note trash as one new recoverable Activity and can undo it again", async () => {
    const fixture = createFixture();
    const original = await trashAndUndo(fixture, "notetrashreq_redohappypath1234");
    const redo = new NoteTrashRedoService(fixture.vaults, {
      now: () => new Date("2026-07-30T12:01:00.000Z")
    });

    expect(redo.activityState(original.trash, original.undo)).toEqual({ canRedo: true });
    const result = redo.redo({ operationId: original.trash.id });
    expect(result).toMatchObject({
      status: "redone",
      operationId: original.trash.id,
      undoOperationId: original.undo.id,
      redoOperationId: expect.stringMatching(/^op_20260730_[a-f0-9]{16}$/u)
    });
    expect(fs.existsSync(fixture.pagePath)).toBe(false);
    expect(readTrashFiles(fixture.vaultPath)).toEqual([fixture.content]);
    expect(redo.redo({ operationId: original.trash.id })).toEqual({ ...result, status: "already_redone" });
    expect(redo.activityState(original.trash, original.undo)).toEqual({
      canRedo: false,
      redoUnavailableReason: "already_redone"
    });

    const redoneOperation = readOperation(fixture.vaultPath, result.redoOperationId!);
    expect(fixture.service.activitySummary(redoneOperation, undefined)).toMatchObject({
      status: "applied",
      canUndo: true,
      targetLabel: "Recoverable note"
    });
    expect(fixture.service.undo(redoneOperation)).toMatchObject({
      status: "undone",
      operationId: redoneOperation.id
    });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.content);
  });

  it("fails note trash Redo closed when the restored note changed", async () => {
    const fixture = createFixture();
    const original = await trashAndUndo(fixture, "notetrashreq_redodrift1234567");
    fs.appendFileSync(fixture.pagePath, "\nExternal change.\n", "utf8");
    const redo = new NoteTrashRedoService(fixture.vaults);

    expect(redo.activityState(original.trash, original.undo)).toEqual({
      canRedo: false,
      redoUnavailableReason: "content_changed"
    });
    expect(redo.redo({ operationId: original.trash.id })).toMatchObject({ status: "stale" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain("External change.");
    expect(readTrashFiles(fixture.vaultPath)).toEqual([]);
  });

  it("adopts a prepared note trash Redo after restart without duplicating its effect", async () => {
    const fixture = createFixture();
    const original = await trashAndUndo(fixture, "notetrashreq_redorestart12345");
    const interrupted = new NoteTrashRedoService(fixture.vaults, {
      now: () => new Date("2026-07-30T12:01:00.000Z"),
      afterReceiptPersisted: () => { throw new Error("simulated process exit"); }
    });
    expect(interrupted.redo({ operationId: original.trash.id })).toMatchObject({ status: "stale" });
    expect(fs.existsSync(fixture.pagePath)).toBe(true);

    const restarted = new NoteTrashRedoService(fixture.vaults);
    expect(restarted.recoverIncompleteRedos()).toEqual({ recovered: 1, failed: 0 });
    expect(fs.existsSync(fixture.pagePath)).toBe(false);
    expect(readTrashFiles(fixture.vaultPath)).toEqual([fixture.content]);
    expect(restarted.redo({ operationId: original.trash.id })).toMatchObject({ status: "already_redone" });
    expect(fixture.service.recoverIncompleteOperations()).toEqual({ recovered: 2, failed: 0 });
    expect(readOperationKinds(fixture.vaultPath).filter((kind) => kind === "trash_page")).toHaveLength(2);
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

    const missing = createFixture();
    const missingRender = await missing.notes.render({ pageId: missing.pageId }, missing.ownerId);
    const missingRevision = missing.revision();
    fs.unlinkSync(missing.pagePath);
    expect(missing.service.trash(missing.ownerId, {
      apiVersion: 1,
      requestId: "notetrashreq_missing123456789",
      activeVaultId: missing.vault.vaultId,
      currentPageId: missing.pageId,
      renderContextId: missingRender.renderContextId!,
      expectedRevision: missingRevision
    })).toMatchObject({
      status: "not_found",
      authority: { pageId: missing.pageId, pageState: "missing", readerState: "closed" }
    });
    expect(readTrashFiles(missing.vaultPath)).toEqual([]);

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

function createFixture(options: {
  readonly pageId?: string;
  readonly pageType?: "note" | "claim" | "question" | "concept" | "entity" | "topic";
  readonly title?: string;
  readonly generatedBy?: "pige" | "user";
} = {}) {
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
  const pageId = options.pageId ?? "page_20260730_recoverablenote";
  const pagePath = path.join(vaultPath, "wiki", "recoverable-note.md");
  const title = options.title ?? "Recoverable note";
  const pageType = options.pageType ?? "note";
  const content = `---\nid: "${pageId}"\nschema_version: 1\ntitle: "${title}"\ntype: "${pageType}"\ncreated_at: "2026-07-30T12:00:00.000Z"\nupdated_at: "2026-07-30T12:00:00.000Z"\nstatus: "active"\naliases: []\nsource_ids: ["src_20260730_recoverable01"]\n${options.generatedBy ? `provenance:\n  generated_by: "${options.generatedBy}"\n` : ""}${trashPageTypeBlock(pageType, title)}\n---\n\n# ${title}\n\nKeep these exact bytes and [[Linked note]].\n`;
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
    revision: () => `noteeditrev_${createHash("sha256").update(fs.readFileSync(pagePath)).digest("hex")}`
  };
}

function trashPageTypeBlock(pageType: "note" | "claim" | "question" | "concept" | "entity" | "topic", title: string): string {
  switch (pageType) {
    case "note": return 'note:\n  note_kind: "general"\n  review_state: "clean"';
    case "claim": return 'claim:\n  confidence: "medium"\n  evidence: ["src_20260730_recoverable01#p1"]\n  contradicts: []';
    case "question": return 'question:\n  state: "open"\n  answered_by: []';
    case "concept": return `concept:\n  canonical_name: ${JSON.stringify(title)}\n  parent_concepts: []\n  child_concepts: []`;
    case "entity": return `entity:\n  entity_type: "other"\n  canonical_name: ${JSON.stringify(title)}\n  identifiers: []`;
    case "topic": return "";
  }
}

async function trashAndUndo(fixture: ReturnType<typeof createFixture>, requestId: string) {
  const rendered = await fixture.notes.render({ pageId: fixture.pageId }, fixture.ownerId);
  const result = fixture.service.trash(fixture.ownerId, {
    apiVersion: 1,
    requestId,
    activeVaultId: fixture.vault.vaultId,
    currentPageId: fixture.pageId,
    renderContextId: rendered.renderContextId!,
    expectedRevision: fixture.revision()
  });
  if (result.status !== "committed" || !result.operationId) throw new Error("The note was not trashed.");
  const trash = readOperation(fixture.vaultPath, result.operationId);
  const undone = fixture.service.undo(trash);
  if (undone.status !== "undone" || !undone.undoOperationId) throw new Error("The note trash was not undone.");
  return { trash, undo: readOperation(fixture.vaultPath, undone.undoOperationId) };
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

function readOperationKinds(vaultPath: string): string[] {
  const root = path.join(vaultPath, ".pige", "operations");
  return fs.readdirSync(root).flatMap((year) => fs.readdirSync(path.join(root, year)).flatMap((month) =>
    fs.readdirSync(path.join(root, year, month)).map((name) => JSON.parse(
      fs.readFileSync(path.join(root, year, month, name), "utf8")
    ).kind as string)));
}
