import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteRelateService } from "../../apps/desktop/src/main/services/note-relate-service";
import {
  NoteMarkdownEditorActivityAdapter,
  NoteMarkdownEditorService,
} from "../../apps/desktop/src/main/services/note-markdown-editor-service";
import { NotesService } from "../../apps/desktop/src/main/services/notes-service";

const temporaryPaths: string[] = [];
const relatablePageTypes = ["note", "claim", "question", "concept", "entity"] as const;
type RelatablePageType = (typeof relatablePageTypes)[number];
const request = {
  apiVersion: 1 as const,
  requestId: "noterelatereq_abcdefghijklmnop",
  activeVaultId: "vault_20260730_relate",
  currentPageId: "page_20260730_relatesource",
  renderContextId: "notectx_0123456789abcdef0123456789abcdef",
  expectedRevision: `noteeditrev_${"a".repeat(64)}`,
  targetPageId: "page_20260730_relatetarget",
  expectedTargetUpdatedAt: "2026-07-30T10:00:00.000Z",
};

afterEach(() => {
  for (const entry of temporaryPaths.splice(0)) fs.rmSync(entry, { recursive: true, force: true });
});

describe("NoteRelateService", () => {
  it.each(relatablePageTypes)("adds one fixed related_to edge from an active %s through the existing user edit and Activity owner", async (pageType) => {
    const vaultPath = createVault();
    const assertCurrent = vi.fn(() => true);
    const save = vi.fn(() => ({
      status: "committed" as const,
      requestId: "noteeditreq_internal",
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      revisionId: `sha256:${"b".repeat(64)}`,
      renderIdentity: `sha256:${"c".repeat(64)}`,
      operationId: "op_20260730_noterelate12345",
    }));
    const render = vi.fn(async () => relatedRender(pageType));
    const service = new NoteRelateService({
      resolveTrashTarget: vi.fn(() => readyCurrent(assertCurrent, pageType)),
      render,
    } as never, { open: vi.fn(() => openedCurrent([], pageType)), save } as never, () => vaultPath,
    () => new Date("2026-07-30T11:00:00.000Z"));

    await expect(service.relate("reader_owner", request)).resolves.toMatchObject({
      ...request,
      status: "committed",
      operationId: "op_20260730_noterelate12345",
      render: { summary: { pageId: request.currentPageId, status: "active" } },
    });
    expect(assertCurrent).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.stringMatching(/^noteeditreq_[a-f0-9]{32}$/u),
      expectedRevisionId: `sha256:${"a".repeat(64)}`,
      markdown: expect.stringContaining(`related_page_ids: ["${request.targetPageId}"]`),
    }));
    expect(vi.mocked(save).mock.calls[0]?.[0].markdown).toContain('updated_at: "2026-07-30T11:00:00.000Z"');
    expect(render).toHaveBeenCalledWith({ pageId: request.currentPageId }, "reader_owner");
  });

  it("fails before mutation for target drift, self/duplicate edges, and current Reader drift", async () => {
    const vaultPath = createVault();
    const save = vi.fn();
    const service = new NoteRelateService({
      resolveTrashTarget: vi.fn(() => readyCurrent(() => true)),
      render: vi.fn(),
    } as never, { open: vi.fn(() => openedCurrent()), save } as never, () => vaultPath);
    await expect(service.relate("reader_owner", {
      ...request,
      expectedTargetUpdatedAt: "2026-07-30T10:01:00.000Z",
    })).resolves.toEqual({ ...request, expectedTargetUpdatedAt: "2026-07-30T10:01:00.000Z", status: "stale" });
    expect(save).not.toHaveBeenCalled();

    const duplicate = new NoteRelateService({
      resolveTrashTarget: vi.fn(() => readyCurrent(() => true)), render: vi.fn(),
    } as never, { open: vi.fn(() => openedCurrent([request.targetPageId])), save } as never, () => vaultPath);
    await expect(duplicate.relate("reader_owner", request)).resolves.toEqual({ ...request, status: "ineligible" });
    expect(save).not.toHaveBeenCalled();

    const staleCurrent = new NoteRelateService({
      resolveTrashTarget: vi.fn(() => readyCurrent(() => false)), render: vi.fn(),
    } as never, { open: vi.fn(() => openedCurrent()), save } as never, () => vaultPath);
    await expect(staleCurrent.relate("reader_owner", request)).resolves.toEqual({ ...request, status: "stale" });

    const mismatchedRender = new NoteRelateService({
      resolveTrashTarget: vi.fn(() => readyCurrent(() => true, "claim")), render: vi.fn(async () => relatedRender("note")),
    } as never, { open: vi.fn(() => openedCurrent([], "claim")), save: vi.fn(() => ({
      status: "committed", operationId: "op_20260730_noterelatemismatch",
    })) } as never, () => vaultPath);
    await expect(mismatchedRender.relate("reader_owner", request)).resolves.toEqual({ ...request, status: "failed" });
  });

  it("commits one real update_page Activity and restores exact bytes through Undo", async () => {
    const vaultPath = createVault();
    const sourcePath = path.join(vaultPath, "wiki", "source.md");
    const before = noteMarkdown(request.currentPageId, "Source note", "2026-07-30T09:00:00.000Z");
    fs.writeFileSync(sourcePath, before, "utf8");
    const vaults = {
      current: () => ({
        vaultId: request.activeVaultId, name: "Relate vault", activeVaultPathDisplay: "Relate vault",
        knowledgeRootDisplay: "Relate vault", sourceAssetRootDisplay: "Sources",
        sourceAssetRootKind: "vault_internal", defaultSourceStorageStrategy: "managed_copy", schemaVersion: 1,
      }),
      activeVaultPath: () => vaultPath,
    } as never;
    const activity = new NoteMarkdownEditorActivityAdapter(vaults);
    const editor = new NoteMarkdownEditorService(vaults, activity, {
      now: () => new Date("2026-07-30T11:00:00.000Z"), randomId: () => "relate-activity-fixture",
    });
    const notes = new NotesService(vaults, undefined, undefined, editor);
    const ownerId = "reader_relate_integration";
    const rendered = await notes.render({ pageId: request.currentPageId }, ownerId);
    const expectedRevision = rendered.trashEligibility?.revision;
    if (!rendered.renderContextId || !expectedRevision) throw new Error("Expected an editable Reader render.");
    const service = new NoteRelateService(notes, editor, () => vaultPath,
      () => new Date("2026-07-30T11:00:00.000Z"));

    const result = await service.relate(ownerId, {
      ...request,
      renderContextId: rendered.renderContextId,
      expectedRevision,
    });
    expect(result.status).toBe("committed");
    if (result.status !== "committed") throw new Error("Expected relation commit.");
    expect(fs.readFileSync(sourcePath, "utf8")).toContain(`related_page_ids: ["${request.targetPageId}"]`);
    const operation = readOperation(vaultPath, result.operationId);
    expect(activity.activitySummary(operation)).toMatchObject({ kind: "update_page", canUndo: true });
    expect(activity.undo(operation, operation.after?.id)).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(sourcePath, "utf8")).toBe(before);
  });

  it("unlinks one exact edge and restores it through the same Activity Undo owner", async () => {
    const vaultPath = createVault();
    const sourcePath = path.join(vaultPath, "wiki", "source.md");
    const before = noteMarkdown(request.currentPageId, "Source note", "2026-07-30T09:00:00.000Z", [request.targetPageId]);
    fs.writeFileSync(sourcePath, before, "utf8");
    const vaults = {
      current: () => ({
        vaultId: request.activeVaultId, name: "Relate vault", activeVaultPathDisplay: "Relate vault",
        knowledgeRootDisplay: "Relate vault", sourceAssetRootDisplay: "Sources",
        sourceAssetRootKind: "vault_internal", defaultSourceStorageStrategy: "managed_copy", schemaVersion: 1,
      }),
      activeVaultPath: () => vaultPath,
    } as never;
    const activity = new NoteMarkdownEditorActivityAdapter(vaults);
    const editor = new NoteMarkdownEditorService(vaults, activity, {
      now: () => new Date("2026-07-30T12:00:00.000Z"), randomId: () => "unlink-activity-fixture",
    });
    const notes = new NotesService(vaults, undefined, undefined, editor);
    const ownerId = "reader_unlink_integration";
    const rendered = await notes.render({ pageId: request.currentPageId }, ownerId);
    const expectedRevision = rendered.trashEligibility?.revision;
    if (!rendered.renderContextId || !expectedRevision) throw new Error("Expected an editable Reader render.");
    const service = new NoteRelateService(notes, editor, () => vaultPath,
      () => new Date("2026-07-30T12:00:00.000Z"));

    const result = await service.unlink(ownerId, {
      ...request,
      requestId: "noteunlinkreq_abcdefghijklmnop",
      renderContextId: rendered.renderContextId,
      expectedRevision,
    });
    expect(result.status).toBe("committed");
    if (result.status !== "committed") throw new Error("Expected unlink commit.");
    expect(fs.readFileSync(sourcePath, "utf8")).toContain("related_page_ids: []");
    const operation = readOperation(vaultPath, result.operationId);
    expect(activity.activitySummary(operation)).toMatchObject({ kind: "update_page", canUndo: true });
    expect(activity.undo(operation, operation.after?.id)).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(sourcePath, "utf8")).toBe(before);
    await expect(service.unlink(ownerId, {
      ...request,
      requestId: "noteunlinkreq_qrstuvwxyzabcdef",
      renderContextId: rendered.renderContextId,
      expectedRevision,
    })).resolves.toMatchObject({ status: "stale" });
  });
});

function createVault(): string {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-note-relate-"));
  temporaryPaths.push(vaultPath);
  fs.mkdirSync(path.join(vaultPath, "wiki"), { recursive: true });
  fs.writeFileSync(path.join(vaultPath, "wiki", "target.md"), noteMarkdown(
    request.targetPageId,
    "Target note",
    request.expectedTargetUpdatedAt,
  ));
  return vaultPath;
}

function readyCurrent(assertCurrent: () => boolean, pageType: RelatablePageType = "note") {
  return {
    status: "ready" as const,
    activeVaultId: request.activeVaultId,
    vaultPath: "/private/vault",
    pageId: request.currentPageId,
    pagePath: "wiki/source.md",
    absolutePath: "/private/vault/wiki/source.md",
    pageContentHash: `sha256:${"a".repeat(64)}`,
    pageType,
    title: "Source note",
    assertCurrent,
  };
}

function openedCurrent(relatedPageIds: readonly string[] = [], pageType: RelatablePageType = "note") {
  return {
    status: "opened" as const,
    activeVaultId: request.activeVaultId,
    pageId: request.currentPageId,
    revisionId: `sha256:${"a".repeat(64)}`,
    renderIdentity: `sha256:${"d".repeat(64)}`,
    markdown: noteMarkdown(request.currentPageId, "Source note", "2026-07-30T09:00:00.000Z", relatedPageIds, pageType),
  };
}

function noteMarkdown(pageId: string, title: string, updatedAt: string, relatedPageIds: readonly string[] = [], pageType: RelatablePageType = "note"): string {
  return `---\nid: ${JSON.stringify(pageId)}\nschema_version: 1\ntitle: ${JSON.stringify(title)}\ntype: ${JSON.stringify(pageType)}\ncreated_at: "2026-07-30T09:00:00.000Z"\nupdated_at: ${JSON.stringify(updatedAt)}\nstatus: "active"\nlanguage: "en"\naliases: []\ntags: []\ntopics: []\nentities: []\nsource_ids: []\nrelated_page_ids: ${JSON.stringify(relatedPageIds)}\nprovenance:\n  generated_by: "user"\n${pageType === "note" ? 'note:\n  note_kind: "user"\n  review_state: "clean"' : ""}\n---\n\n# ${title}\n\nBody.\n`;
}

function relatedRender(pageType: RelatablePageType = "note") {
  return {
    summary: {
      pageId: request.currentPageId, title: "Source note", pageType, status: "active" as const,
      pagePath: "wiki/source.md", createdAt: "2026-07-30T09:00:00.000Z",
      updatedAt: "2026-07-30T11:00:00.000Z", sourceIds: [],
    },
    html: "<h1>Source note</h1>", byteSize: 128,
    renderContextId: "notectx_fedcba9876543210fedcba9876543210",
    trashEligibility: { canTrash: true, revision: `sha256:${"b".repeat(64)}` },
  };
}

function readOperation(vaultPath: string, operationId: string) {
  const dateKey = /^op_(\d{8})_/u.exec(operationId)?.[1];
  if (!dateKey) throw new Error("Invalid Operation fixture identity.");
  return JSON.parse(fs.readFileSync(path.join(
    vaultPath, ".pige", "operations", dateKey.slice(0, 4), dateKey.slice(4, 6), `${operationId}.json`,
  ), "utf8"));
}
