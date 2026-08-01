import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { OperationRecordSchema } from "@pige/schemas";
import { NoteMarkdownEditorConflictService } from "../../apps/desktop/src/main/services/note-markdown-editor-conflict-service";

const revisionHash = "a".repeat(64);
const request = {
  apiVersion: 1 as const,
  requestId: "noteeditconflict_abcdefghijklmnop",
  activeVaultId: "vault_20260802_editorconflict",
  pageId: "page_20260802_abcdefghijklmnop",
  currentRenderContextId: `notectx_${"b".repeat(32)}`,
  expectedCurrentRevision: `noteeditrev_${revisionHash}`,
  markdown: `---\nid: "page_20260802_abcdefghijklmnop"\nschema_version: 1\ntitle: "Local draft"\ntype: "note"\ncreated_at: "2026-08-02T00:00:00.000Z"\nupdated_at: "2026-08-02T00:00:00.000Z"\nstatus: "active"\nlanguage: "en"\naliases: []\ntags: []\ntopics: []\nentities: []\nsource_ids: []\nrelated_page_ids: []\nprovenance:\n  generated_by: "user"\nnote:\n  note_kind: "general"\n  review_state: "clean"\n---\n\n# Local draft\n\nKeep this exact body.\n`
};

describe("NoteMarkdownEditorConflictService", () => {
  it("saves a current conflict draft as one new generated note and one reversible create_page Operation", async () => {
    const fixture = createFixture();
    const service = new NoteMarkdownEditorConflictService(
      fixture.vaults as never,
      fixture.notes as never,
      fixture.editor as never,
      { now: () => new Date("2026-08-02T04:00:00.000Z") }
    );
    const result = await service.saveAsNew("owner", request);
    expect(result).toMatchObject({ ...identity(), status: "saved", operationId: expect.stringMatching(/^op_/u) });
    const pages = files(fixture.vaultPath).filter((file) => file.includes("wiki/generated") && file.endsWith(".md"));
    expect(pages).toHaveLength(1);
    const markdown = fs.readFileSync(pages[0]!, "utf8");
    expect(markdown).toContain("Keep this exact body.");
    expect(markdown).toContain(`related_page_ids: [${JSON.stringify(request.pageId)}]`);
    expect(markdown).not.toContain(request.currentRenderContextId);
    const operationFile = files(fixture.vaultPath).find((file) => file.includes(".pige/operations"));
    const operation = OperationRecordSchema.parse(JSON.parse(fs.readFileSync(operationFile!, "utf8")));
    expect(operation).toMatchObject({ kind: "create_page", actor: { kind: "user" }, reversible: "best_effort",
      sourceRefs: [{ kind: "page", id: request.pageId }] });
    expect(fixture.notes.openEditor).toHaveBeenCalledWith("owner", expect.objectContaining({
      pageId: request.pageId, renderContextId: request.currentRenderContextId
    }));
  });

  it("fails closed before durable effects when the reviewed current revision drifts", async () => {
    const fixture = createFixture();
    fixture.notes.openEditor.mockReturnValue({ ...identity(), status: "ready",
      renderContextId: request.currentRenderContextId, revision: `noteeditrev_${"c".repeat(64)}`,
      markdown: "current" });
    const service = new NoteMarkdownEditorConflictService(fixture.vaults as never, fixture.notes as never, fixture.editor as never);
    await expect(service.saveAsNew("owner", request)).resolves.toEqual({ ...identity(), status: "stale" });
    expect(files(fixture.vaultPath)).toEqual([]);
  });
});

function identity() {
  return { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId,
    pageId: request.pageId, currentRenderContextId: request.currentRenderContextId,
    expectedCurrentRevision: request.expectedCurrentRevision };
}
function createFixture() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-editor-conflict-"));
  const vaults = { current: () => ({ vaultId: request.activeVaultId }), activeVaultPath: () => vaultPath,
    assertWriterLease: vi.fn() };
  const notes = {
    openEditor: vi.fn(() => ({ ...identity(), status: "ready", renderContextId: request.currentRenderContextId,
      revision: request.expectedCurrentRevision, markdown: "current external bytes" })),
    render: vi.fn(async ({ pageId }: { readonly pageId: string }) => ({ summary: { pageId, title: "Local draft (conflict copy)",
      pageType: "note", status: "active", pagePath: `wiki/generated/2026/${pageId}.md`,
      createdAt: "2026-08-02T04:00:00.000Z", updatedAt: "2026-08-02T04:00:00.000Z", sourceIds: [] },
      html: "<h1>Local draft</h1>", byteSize: 100, renderContextId: `notectx_${"d".repeat(32)}` }))
  };
  const editor = { open: vi.fn(() => ({ status: "opened", revisionId: `sha256:${revisionHash}` })) };
  return { vaultPath, vaults, notes, editor };
}
function files(root: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...files(target)); else result.push(target);
  }
  return result;
}
