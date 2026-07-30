import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  NOTE_IMPORT_MARKDOWN_CHANNEL,
  NoteImportMarkdownRequestSchema,
  NoteImportMarkdownResultSchema,
  OperationRecordSchema
} from "@pige/schemas";
import { NoteMarkdownImportService } from "../../apps/desktop/src/main/services/note-markdown-import-service";
import { KnowledgeActivityService } from "../../apps/desktop/src/main/services/knowledge-activity-service";
import { readMarkdownPageByRelativePath } from "../../apps/desktop/src/main/services/markdown-page-index";

const request = {
  apiVersion: 1 as const,
  requestId: "noteimport_abcdefghijklmnop",
  activeVaultId: "vault_20260730_noteimport"
};

describe("NoteMarkdownImportService", () => {
  it("imports one selected Markdown file as a new editable note without modifying or projecting the original", async () => {
    const fixture = createFixture();
    const original = "# Imported title\n\nKeep **all** of this body.\n";
    fs.writeFileSync(fixture.sourcePath, original, "utf8");

    const render = vi.fn(async ({ pageId }: { readonly pageId: string }) => renderResult(pageId));
    const service = new NoteMarkdownImportService(fixture.vaults as never, { render } as never);
    const result = await service.importMarkdown("reader_owner", request, {
      pick: vi.fn(async () => fixture.sourcePath)
    });

    expect(result).toMatchObject({
      ...request,
      status: "imported",
      operationId: expect.stringMatching(/^op_\d{8}_[a-f0-9]{16}$/u),
      render: { summary: { title: "Imported title", pageType: "note", status: "active" } }
    });
    expect(fs.readFileSync(fixture.sourcePath, "utf8")).toBe(original);

    const imported = findFiles(fixture.vaultPath, (file) => file.endsWith(".md") && file.includes("wiki/generated"));
    expect(imported).toHaveLength(1);
    const markdown = fs.readFileSync(imported[0]!, "utf8");
    expect(markdown).toContain('type: "note"');
    expect(markdown).toContain('note_kind: "imported"');
    expect(markdown).toContain("Keep **all** of this body.");
    expect(markdown).not.toContain(fixture.sourcePath);
    expect(readMarkdownPageByRelativePath(
      fixture.vaultPath,
      path.relative(fixture.vaultPath, imported[0]!).split(path.sep).join("/")
    )?.summary).toMatchObject({ title: "Imported title", pageType: "note", status: "active" });

    const operations = findFiles(fixture.vaultPath, (file) => file.includes(".pige/operations") && file.endsWith(".json"));
    expect(operations).toHaveLength(1);
    const operation = OperationRecordSchema.parse(JSON.parse(fs.readFileSync(operations[0]!, "utf8")));
    expect(operation).toMatchObject({
      kind: "create_page",
      actor: { kind: "user" },
      sourceRefs: [],
      reversible: "best_effort"
    });
    const activity = new KnowledgeActivityService(fixture.vaults as never);
    expect(activity.list({ limit: 5 }).activities[0]).toMatchObject({
      operationId: operation.id,
      kind: "create_page",
      targetLabel: "Imported title",
      canUndo: true
    });
    expect(activity.undo({ operationId: operation.id })).toMatchObject({ status: "undone" });
    expect(fs.existsSync(imported[0]!)).toBe(false);
  });

  it("adopts the exact committed effect after a post-commit failure without picking or duplicating", async () => {
    const fixture = createFixture();
    fs.writeFileSync(fixture.sourcePath, "# Retry-safe import\n\nOne effect.\n", "utf8");
    const firstRender = vi.fn(async () => { throw new Error("renderer owner disappeared"); });
    const service = new NoteMarkdownImportService(fixture.vaults as never, { render: firstRender } as never);
    await expect(service.importMarkdown("reader_owner", request, {
      pick: async () => fixture.sourcePath
    })).resolves.toEqual({ ...request, status: "failed" });

    const secondPicker = vi.fn(async () => path.join(fixture.root, "different.md"));
    const adopted = new NoteMarkdownImportService(fixture.vaults as never, {
      render: async ({ pageId }: { readonly pageId: string }) => renderResult(pageId)
    } as never);
    await expect(adopted.importMarkdown("reader_owner", request, { pick: secondPicker })).resolves.toMatchObject({
      ...request,
      status: "imported"
    });
    expect(secondPicker).not.toHaveBeenCalled();
    expect(findFiles(fixture.vaultPath, (file) => file.includes("wiki/generated") && file.endsWith(".md"))).toHaveLength(1);
    expect(findFiles(fixture.vaultPath, (file) => file.includes(".pige/operations") && file.endsWith(".json"))).toHaveLength(1);
  });

  it("fails closed for cancellation, stale vault identity, symlinks, and malformed DTOs", async () => {
    const fixture = createFixture();
    const service = new NoteMarkdownImportService(fixture.vaults as never, { render: vi.fn() } as never);
    await expect(service.importMarkdown("reader_owner", request, { pick: async () => undefined }))
      .resolves.toEqual({ ...request, status: "cancelled" });

    fs.writeFileSync(fixture.sourcePath, "# Outside identity\n", "utf8");
    const symlink = path.join(fixture.root, "linked.md");
    fs.symlinkSync(fixture.sourcePath, symlink);
    await expect(service.importMarkdown("reader_owner", { ...request, requestId: "noteimport_qrstuvwxyzabcdef" }, { pick: async () => symlink }))
      .resolves.toEqual({ ...request, requestId: "noteimport_qrstuvwxyzabcdef", status: "invalid" });

    await expect(service.importMarkdown("reader_owner", { ...request, activeVaultId: "vault_20260730_otherxx" }, { pick: async () => fixture.sourcePath }))
      .resolves.toEqual({ ...request, activeVaultId: "vault_20260730_otherxx", status: "stale" });
    expect(() => NoteImportMarkdownRequestSchema.parse({ ...request, sourcePath: fixture.sourcePath })).toThrow();
    expect(NOTE_IMPORT_MARKDOWN_CHANNEL).toBe("notes.importMarkdown");
    expect(NoteImportMarkdownResultSchema.parse({ ...request, status: "failed" })).toEqual({ ...request, status: "failed" });
  });
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-note-import-"));
  const vaultPath = path.join(root, "vault");
  fs.mkdirSync(vaultPath, { recursive: true });
  const sourcePath = path.join(root, "selected.md");
  const vaults = {
    current: () => ({ vaultId: request.activeVaultId }),
    activeVaultPath: () => vaultPath,
    assertWriterLease: vi.fn()
  };
  return { root, vaultPath, sourcePath, vaults };
}

function renderResult(pageId: string) {
  return {
    summary: {
      pageId,
      title: "Imported title",
      pageType: "note" as const,
      status: "active" as const,
      pagePath: `wiki/generated/2026/${pageId}.md`,
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:00.000Z",
      sourceIds: []
    },
    html: "<h1>Imported title</h1>",
    byteSize: 100,
    renderContextId: "notectx_abcdefghijklmnopqrstuvwx12345678"
  };
}

function findFiles(root: string, predicate: (file: string) => boolean): string[] {
  if (!fs.existsSync(root)) return [];
  const result: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...findFiles(target, predicate));
    else if (predicate(target)) result.push(target);
  }
  return result;
}
