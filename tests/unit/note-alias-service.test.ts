import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePigeFrontmatter } from "@pige/markdown";
import { OperationRecordSchema } from "@pige/schemas";
import { NoteAliasService } from "../../apps/desktop/src/main/services/note-alias-service";
import { NoteMarkdownEditorActivityAdapter, NoteMarkdownEditorService } from "../../apps/desktop/src/main/services/note-markdown-editor-service";
import { NoteMarkdownEditorRedoService } from "../../apps/desktop/src/main/services/note-markdown-editor-redo-service";

const roots: string[] = [], pageId = "page_20260731_aliasfixture";
const baseRequest = { apiVersion: 1 as const, requestId: "notealiasreq_abcdefghijklmnop", activeVaultId: "vault_20260731_aliases",
  currentPageId: pageId, renderContextId: "notectx_0123456789abcdef0123456789abcdef",
  expectedRevision: `noteeditrev_${"a".repeat(64)}`, action: "add" as const, alias: "Second Name" };

describe("NoteAliasService", () => {
  it.each(["note", "claim", "question", "concept", "entity"] as const)(
    "adds and removes one unique alias on an active %s with Activity, Undo/Redo, and restart",
    async (pageType) => {
    const fixture = makeFixture(), before = noteMarkdown("Primary Name", [], pageId, pageType);
    write(fixture, "wiki/current.md", before);
    const adapter = new NoteMarkdownEditorActivityAdapter(fixture.vaults), editor = new NoteMarkdownEditorService(fixture.vaults, adapter,
      { now: () => new Date("2026-07-31T13:00:00.000Z"), randomId: () => "alias-fixture",
        allowClaim: true, allowQuestion: true, allowConcept: true, allowEntity: true });
    const service = makeService(fixture, editor);
    const added = await service.change("reader_owner", baseRequest);
    expect(added.status).toBe("committed"); if (added.status !== "committed") throw new Error("expected commit");
    expect(parsePigeFrontmatter(read(fixture, "wiki/current.md"))?.frontmatter.aliases).toEqual(["Second Name"]);
    const operation = readOperation(fixture.vaultPath, added.operationId);
    expect(operation).toMatchObject({ kind: "update_page", targetRefs: [{ id: pageId }] });
    expect(adapter.activitySummary(operation)).toMatchObject({ status: "applied", canUndo: true });
    const restarted = new NoteMarkdownEditorActivityAdapter(fixture.vaults);
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 0, failed: 0 });
    expect(restarted.undo(operation)).toMatchObject({ status: "undone", operationId: operation.id });
    expect(read(fixture, "wiki/current.md")).toBe(before);
    expect(new NoteMarkdownEditorRedoService(fixture.vaults).redo({
      operationId: operation.id,
      expectedRevisionId: operation.before?.id
    })).toMatchObject({ status: "redone" });
    expect(parsePigeFrontmatter(read(fixture, "wiki/current.md"))?.frontmatter.aliases).toEqual(["Second Name"]);

    write(fixture, "wiki/current.md", noteMarkdown("Primary Name", ["Second Name"], pageId, pageType));
    const removeEditor = new NoteMarkdownEditorService(fixture.vaults, new NoteMarkdownEditorActivityAdapter(fixture.vaults),
      { allowClaim: true, allowQuestion: true, allowConcept: true, allowEntity: true });
    const removed = await makeService(fixture, removeEditor).change("reader_owner", { ...baseRequest,
      requestId: "notealiasreq_removeabcdefghijkl", action: "remove" });
    expect(removed.status).toBe("committed");
    expect(parsePigeFrontmatter(read(fixture, "wiki/current.md"))?.frontmatter.aliases).toEqual([]);
  });

  it("fails closed for title equality, duplicates, malformed arrays, source pages, and stale identity", async () => {
    for (const [markdown, request, current, status] of [
      [noteMarkdown("Primary Name", []), { ...baseRequest, alias: "Primary Name" }, true, "ineligible"],
      [noteMarkdown("Primary Name", ["second name"]), baseRequest, true, "ineligible"],
      [noteMarkdown("Primary Name", ["Existing", "existing"]), baseRequest, true, "ineligible"],
      [noteMarkdown("Primary Name", []).replace("aliases: []", "aliases:\n  - Existing"), baseRequest, true, "ineligible"],
      [noteMarkdown("Primary Name", []).replace('type: "note"', 'type: "source"'), baseRequest, true, "ineligible"],
      [noteMarkdown("Primary Name", []).replace('type: "note"', 'type: "topic"'), baseRequest, true, "ineligible"],
      [noteMarkdown("Primary Name", []), baseRequest, false, "stale"]
    ] as const) {
      const fixture = makeFixture(); write(fixture, "wiki/current.md", markdown);
      const save = vi.fn(() => ({ status: "failed" as const }));
      const service = makeService(fixture, { open: vi.fn(() => opened(markdown)), save } as never, current);
      await expect(service.change("reader_owner", request)).resolves.toMatchObject({ status });
      expect(save).not.toHaveBeenCalled(); expect(read(fixture, "wiki/current.md")).toBe(markdown);
    }
  });

  it("rejects cross-page title/alias/path ambiguity and preserves the draft target bytes", async () => {
    for (const [otherPath, other] of [["other.md", noteMarkdown("Second Name", [], "page_20260731_otheralias01")],
      ["other.md", noteMarkdown("Other", ["second name"], "page_20260731_otheralias02")],
      ["second name.md", noteMarkdown("Other", [], "page_20260731_otheralias03")]] as const) {
      const fixture = makeFixture(), before = noteMarkdown("Primary Name", []); write(fixture, "wiki/current.md", before);
      write(fixture, `wiki/${otherPath}`, other); const save = vi.fn(() => ({ status: "failed" as const }));
      await expect(makeService(fixture, { open: vi.fn(() => opened(before)), save } as never).change("reader_owner", baseRequest))
        .resolves.toMatchObject({ status: "conflict" });
      expect(save).not.toHaveBeenCalled(); expect(read(fixture, "wiki/current.md")).toBe(before);
    }
  });
});

function makeFixture() { const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-note-alias-")); roots.push(vaultPath);
  fs.mkdirSync(path.join(vaultPath, "wiki"), { recursive: true }); const vaults = { current: () => ({ vaultId: baseRequest.activeVaultId,
    name: "Aliases", sourceStorageStrategy: "copy_to_source_library" as const, sourceAssetRoot: { kind: "inside_vault" as const, label: "Vault" } }), activeVaultPath: () => vaultPath };
  return { vaultPath, vaults }; }
function makeService(fixture: ReturnType<typeof makeFixture>, editor: Pick<NoteMarkdownEditorService, "open" | "save">, current = true) {
  return new NoteAliasService({ resolveTrashTarget: vi.fn(() => { const markdown = read(fixture, "wiki/current.md"); return { status: "ready",
    activeVaultId: baseRequest.activeVaultId, vaultPath: fixture.vaultPath, pageId, pagePath: "wiki/current.md",
    absolutePath: path.join(fixture.vaultPath, "wiki/current.md"), pageContentHash: sha(markdown), title: "Primary Name", assertCurrent: () => current }; }),
    render: vi.fn(async () => { const markdown = read(fixture, "wiki/current.md"), frontmatter = parsePigeFrontmatter(markdown)?.frontmatter;
      const aliases = frontmatter?.aliases ?? [];
      return { summary: { pageId, title: "Primary Name", pageType: frontmatter?.type ?? "note", status: "active" as const, pagePath: "wiki/current.md",
        createdAt: "2026-07-31T10:00:00.000Z", updatedAt: "2026-07-31T13:00:00.000Z", sourceIds: [] }, html: "<h1>Primary Name</h1>",
        byteSize: Buffer.byteLength(markdown), renderContextId: `notectx_${"b".repeat(32)}`, aliasing: { aliases, canAdd: aliases.length < 64,
          canRemove: aliases.length > 0, revision: `noteeditrev_${"b".repeat(64)}` } }; }) } as never, editor, () => fixture.vaultPath,
    () => new Date("2026-07-31T13:00:00.000Z")); }
function opened(markdown: string) { return { status: "opened" as const, activeVaultId: baseRequest.activeVaultId, pageId,
  revisionId: sha(markdown), renderIdentity: `sha256:${"d".repeat(64)}`, markdown }; }
function noteMarkdown(title: string, aliases: readonly string[], id = pageId,
  pageType: "note" | "source" | "claim" | "question" | "concept" | "entity" | "topic" = "note") {
  return `---\nid: ${JSON.stringify(id)}\nschema_version: 1\ntitle: ${JSON.stringify(title)}\ntype: "${pageType}"\ncreated_at: "2026-07-31T10:00:00.000Z"\nupdated_at: "2026-07-31T10:00:00.000Z"\nstatus: "active"\naliases: ${JSON.stringify(aliases)}\nsource_ids: []\n---\n\n# ${title}\n\nKeep body.\n`;
}
function write(fixture: ReturnType<typeof makeFixture>, relative: string, markdown: string) { fs.writeFileSync(path.join(fixture.vaultPath, relative), markdown); }
function read(fixture: ReturnType<typeof makeFixture>, relative: string) { return fs.readFileSync(path.join(fixture.vaultPath, relative), "utf8"); }
function sha(value: string) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function readOperation(vaultPath: string, id: string) { return OperationRecordSchema.parse(JSON.parse(fs.readFileSync(path.join(vaultPath, `.pige/operations/${id.slice(3, 7)}/${id.slice(7, 9)}/${id}.json`), "utf8"))); }
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
