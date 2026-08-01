import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePigeFrontmatter } from "@pige/markdown";
import { OperationRecordSchema, type OperationRecord } from "@pige/schemas";
import { LocalDatabaseService } from "../../apps/desktop/src/main/services/local-database-service";
import { NoteRenameService } from "../../apps/desktop/src/main/services/note-rename-service";

const roots: string[] = [];
const pageId = "page_20260731_rename12345678";
const request = { apiVersion: 1 as const, requestId: "noterenamereq_abcdefghijklmnop",
  activeVaultId: "vault_20260731_rename01", currentPageId: pageId,
  renderContextId: "notectx_0123456789abcdef0123456789abcdef",
  expectedRevision: `noteeditrev_${"a".repeat(64)}`, title: "Renamed Note" };

describe("NoteRenameService", () => {
  it.each(["note", "claim", "question", "concept", "entity"] as const)(
    "renames one exact active %s and Git-friendly filename, preserves old-title links, and supports repeatable Activity Undo/Redo",
    async (pageType) => {
    const fixture = makeFixture();
    const before = noteMarkdown("Original Note", ["Existing alias"], "Keep this body byte-for-byte.", pageId, pageType);
    write(fixture.vaultPath, "wiki/original.md", before);
    write(fixture.vaultPath, "wiki/linker.md", noteMarkdown("Linker", [], "See [[Original Note]].", "page_20260731_linker123456"));
    const service = makeService(fixture, before);

    const result = await service.rename("reader_owner", request);
    expect(result.status).toBe("committed");
    if (result.status !== "committed") throw new Error("expected commit");
    const renamedPath = path.join(fixture.vaultPath, "wiki/renamed-note--rename12345678.md");
    expect(fs.existsSync(path.join(fixture.vaultPath, "wiki/original.md"))).toBe(false);
    const renamed = fs.readFileSync(renamedPath, "utf8"), frontmatter = parsePigeFrontmatter(renamed)!.frontmatter;
    expect(frontmatter).toMatchObject({ id: pageId, type: pageType, title: "Renamed Note", aliases: ["Existing alias", "Original Note"] });
    expect(renamed).toContain("Keep this body byte-for-byte.");

    const database = new LocalDatabaseService();
    expect(database.rebuild(fixture.vaultPath)).toMatchObject({ pageCount: 2, invalidPageCount: 0 });
    expect(database.relatedPages(fixture.vaultPath, { pageId })?.backlinks[0]?.summary.pageId)
      .toBe("page_20260731_linker123456");

    const operation = readOperation(fixture.vaultPath, result.operationId);
    expect(operation).toMatchObject({ kind: "rename_page", before: { checksum: sha(before) }, after: { checksum: sha(renamed) } });
    expect(service.activitySummary(operation)).toMatchObject({ kind: "rename_page", status: "applied", canUndo: true });
    expect(service.undo(operation)).toMatchObject({ status: "undone", operationId: result.operationId });
    expect(fs.readFileSync(path.join(fixture.vaultPath, "wiki/original.md"), "utf8")).toBe(before);
    expect(fs.existsSync(renamedPath)).toBe(false);

    const restarted = makeService(fixture, before);
    const undo = readOperation(fixture.vaultPath, `${result.operationId}undo`);
    expect(restarted.activitySummary(operation, undo)).toMatchObject({ status: "undone", canUndo: false, canRedo: true });
    const redone = restarted.redo({ operationId: operation.id });
    expect(redone).toMatchObject({ status: "redone", operationId: operation.id, undoOperationId: undo.id,
      redoOperationId: expect.stringMatching(/^op_/u), revisionId: sha(renamed) });
    if (redone.status !== "redone") throw new Error("expected Redo");
    expect(fs.readFileSync(renamedPath, "utf8")).toBe(renamed);
    expect(fs.existsSync(path.join(fixture.vaultPath, "wiki/original.md"))).toBe(false);
    expect(restarted.redo({ operationId: operation.id })).toEqual({ ...redone, status: "already_redone" });

    fs.unlinkSync(operationPath(fixture.vaultPath, redone.redoOperationId));
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    const redoOperation = readOperation(fixture.vaultPath, redone.redoOperationId);
    expect(restarted.undo(redoOperation)).toMatchObject({ status: "undone", operationId: redoOperation.id });
    const redoUndo = readOperation(fixture.vaultPath, `${redoOperation.id}undo`);
    expect(restarted.activitySummary(redoOperation, redoUndo)).toMatchObject({ status: "undone", canRedo: true });
    expect(restarted.redo({ operationId: redoOperation.id })).toMatchObject({ status: "redone" });
    expect(fs.readFileSync(renamedPath, "utf8")).toBe(renamed);
  });

  it("fails Redo closed when the restored note changes after Undo", async () => {
    const fixture = makeFixture(), before = noteMarkdown("Original Note");
    write(fixture.vaultPath, "wiki/original.md", before);
    const service = makeService(fixture, before);
    const result = await service.rename("reader_owner", request);
    if (result.status !== "committed") throw new Error("expected commit");
    const operation = readOperation(fixture.vaultPath, result.operationId);
    expect(service.undo(operation)).toMatchObject({ status: "undone" });
    const original = path.join(fixture.vaultPath, "wiki/original.md");
    fs.appendFileSync(original, "\nExternal edit\n", "utf8");
    const changed = fs.readFileSync(original, "utf8");
    expect(service.redo({ operationId: operation.id })).toMatchObject({ status: "stale", operationId: operation.id });
    expect(fs.readFileSync(original, "utf8")).toBe(changed);
    expect(fs.existsSync(path.join(fixture.vaultPath, "wiki/renamed-note--rename12345678.md"))).toBe(false);
  });

  it("fails closed before writing for stale identity, source/non-note/inactive pages, invalid aliases, and filename conflicts", async () => {
    for (const [markdown, targetCurrent, expected] of [
      [noteMarkdown("Original Note"), false, "stale"],
      [noteMarkdown("Original Note").replace('type: "note"', 'type: "source"'), true, "ineligible"],
      [noteMarkdown("Original Note").replace('type: "note"', 'type: "topic"'), true, "ineligible"],
      [noteMarkdown("Original Note").replace('status: "active"', 'status: "archived"'), true, "ineligible"],
      [noteMarkdown("Original Note").replace("aliases: []", "aliases:\n  - Existing"), true, "ineligible"]
    ] as const) {
      const fixture = makeFixture(); write(fixture.vaultPath, "wiki/original.md", markdown);
      const service = makeService(fixture, markdown, targetCurrent);
      await expect(service.rename("reader_owner", request)).resolves.toMatchObject({ status: expected });
      expect(fs.readFileSync(path.join(fixture.vaultPath, "wiki/original.md"), "utf8")).toBe(markdown);
    }
    const conflict = makeFixture(), before = noteMarkdown("Original Note");
    write(conflict.vaultPath, "wiki/original.md", before);
    write(conflict.vaultPath, "wiki/renamed-note--rename12345678.md", noteMarkdown("Different", [], "Do not overwrite.", "page_20260731_other1234567"));
    await expect(makeService(conflict, before).rename("reader_owner", request)).resolves.toMatchObject({ status: "conflict" });
    expect(fs.readFileSync(path.join(conflict.vaultPath, "wiki/renamed-note--rename12345678.md"), "utf8")).toContain("Do not overwrite.");

    const illegal = makeFixture(); write(illegal.vaultPath, "wiki/original.md", before);
    await expect(makeService(illegal, before).rename("reader_owner", { ...request, title: "  not canonical  " }))
      .resolves.toMatchObject({ status: "ineligible" });
    await expect(makeService(illegal, before).rename("reader_owner", { ...request, title: "🦉" }))
      .resolves.toMatchObject({ status: "ineligible" });
    expect(fs.readFileSync(path.join(illegal.vaultPath, "wiki/original.md"), "utf8")).toBe(before);
  });

  it("adopts a restart after the path moved but before replacement/Operation and recovers an interrupted Undo", async () => {
    const fixture = makeFixture(), before = noteMarkdown("Original Note"); write(fixture.vaultPath, "wiki/original.md", before);
    const service = makeService(fixture, before);
    const result = await service.rename("reader_owner", request);
    if (result.status !== "committed") throw new Error("expected commit");
    const operation = readOperation(fixture.vaultPath, result.operationId);
    fs.unlinkSync(operationPath(fixture.vaultPath, result.operationId));
    expect(service.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    expect(readOperation(fixture.vaultPath, result.operationId)).toMatchObject({ kind: "rename_page" });

    const renamed = path.join(fixture.vaultPath, "wiki/renamed-note--rename12345678.md");
    const original = path.join(fixture.vaultPath, "wiki/original.md");
    fs.linkSync(renamed, original);
    expect(service.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    expect(fs.readFileSync(original, "utf8")).toBe(before);
    expect(fs.existsSync(renamed)).toBe(false);
    expect(readOperation(fixture.vaultPath, `${result.operationId}undo`)).toMatchObject({ sourceRefs: [{ id: result.operationId }] });
    expect(service.activitySummary(operation, readOperation(fixture.vaultPath, `${result.operationId}undo`))).toMatchObject({ status: "undone" });
  });
});

function makeFixture() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-note-rename-")); roots.push(vaultPath);
  fs.mkdirSync(path.join(vaultPath, "wiki"), { recursive: true }); fs.mkdirSync(path.join(vaultPath, ".pige/db"), { recursive: true });
  return { vaultPath, vaults: { current: () => ({ vaultId: request.activeVaultId, name: "Rename", path: vaultPath,
    sourceStorageStrategy: "copy_to_source_library" as const, sourceAssetRoot: { kind: "inside_vault" as const, label: "Vault" } }), activeVaultPath: () => vaultPath } };
}

function makeService(fixture: ReturnType<typeof makeFixture>, before: string, current = true): NoteRenameService {
  const absolutePath = path.join(fixture.vaultPath, "wiki/original.md"), beforeHash = sha(before);
  const pageType = parsePigeFrontmatter(before)?.frontmatter.type ?? "note";
  const assertCurrent = vi.fn(() => current && fs.existsSync(absolutePath) && sha(fs.readFileSync(absolutePath, "utf8")) === beforeHash);
  return new NoteRenameService(fixture.vaults, {
    resolveTrashTarget: vi.fn(() => ({ status: "ready", activeVaultId: request.activeVaultId, vaultPath: fixture.vaultPath,
      pageId, pagePath: "wiki/original.md", absolutePath, pageContentHash: beforeHash, title: "Original Note", assertCurrent })),
    render: vi.fn(async () => {
      const afterPath = "wiki/renamed-note--rename12345678.md", markdown = fs.readFileSync(path.join(fixture.vaultPath, afterPath), "utf8");
      return { summary: { pageId, title: "Renamed Note", pageType, status: "active" as const,
        pagePath: afterPath, createdAt: "2026-07-31T10:00:00.000Z", updatedAt: "2026-07-31T12:00:00.000Z", sourceIds: [] },
        html: "<h1>Renamed Note</h1>", byteSize: Buffer.byteLength(markdown), renderContextId: `notectx_${"b".repeat(32)}`,
        renameEligibility: { canRename: true, revision: `noteeditrev_${"b".repeat(64)}` } };
    })
  } as never, { now: () => new Date("2026-07-31T12:00:00.000Z"), randomId: () => "rename-random" });
}

function noteMarkdown(title: string, aliases: readonly string[] = [], body = "Keep this body byte-for-byte.", id = pageId,
  pageType: "note" | "source" | "claim" | "question" | "concept" | "entity" | "topic" = "note"): string {
  return `---\nid: "${id}"\nschema_version: 1\ntitle: ${JSON.stringify(title)}\ntype: "${pageType}"\ncreated_at: "2026-07-31T10:00:00.000Z"\nupdated_at: "2026-07-31T10:00:00.000Z"\nstatus: "active"\naliases: ${JSON.stringify(aliases)}\nsource_ids: []\n---\n\n# ${title}\n\n${body}\n`;
}
function write(vaultPath: string, relative: string, content: string): void { const file = path.join(vaultPath, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content, "utf8"); }
function sha(content: string | Buffer): `sha256:${string}` { return `sha256:${createHash("sha256").update(content).digest("hex")}`; }
function operationPath(vaultPath: string, id: string): string { return path.join(vaultPath, `.pige/operations/${id.slice(3, 7)}/${id.slice(7, 9)}/${id}.json`); }
function readOperation(vaultPath: string, id: string): OperationRecord { return OperationRecordSchema.parse(JSON.parse(fs.readFileSync(operationPath(vaultPath, id), "utf8"))); }

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
