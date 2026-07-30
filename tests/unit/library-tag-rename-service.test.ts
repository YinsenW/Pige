import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LibraryMergeTagRequest, LibraryRemovePageTagRequest, LibraryRemoveTagRequest, LibraryRenameTagRequest, VaultSummary } from "@pige/contracts";
import { LibraryTagRenameService } from "../../apps/desktop/src/main/services/library-tag-rename-service";
import { LibraryTagsService } from "../../apps/desktop/src/main/services/library-tags-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("LibraryTagRenameService", () => {
  it("renames every exact page once, adopts replay, and restores exact bytes through Activity Undo", () => {
    const fixture = makeFixture();
    const before = fixture.taggedPaths.map((file) => fs.readFileSync(file, "utf8"));
    const request = renameRequest(fixture);

    const committed = fixture.service.rename(request);
    expect(committed).toMatchObject({ status: "committed", renamedPageCount: 2 });
    if (committed.status !== "committed") throw new Error("tag rename did not commit");
    for (const file of fixture.taggedPaths) {
      const markdown = fs.readFileSync(file, "utf8");
      expect(markdown).toContain('"Renamed tag"');
      expect(markdown).not.toMatch(/"[Oo]riginal"/u);
      expect(markdown).toContain("private body");
    }
    expect(fs.readFileSync(fixture.unrelatedPath, "utf8")).toBe(fixture.unrelatedMarkdown);

    expect(fixture.service.rename(request)).toEqual(committed);
    expect(findOperations(fixture.vaultPath).filter((operation) => operation.id === committed.operationId)).toHaveLength(1);

    const operation = findOperations(fixture.vaultPath).find((item) => item.id === committed.operationId)!;
    expect(fixture.service.activitySummary(operation)).toMatchObject({ status: "applied", canUndo: true });
    expect(fixture.service.undo(operation)).toMatchObject({ status: "undone", operationId: operation.id });
    expect(fixture.taggedPaths.map((file) => fs.readFileSync(file, "utf8"))).toEqual(before);
    expect(fixture.service.undo(operation)).toMatchObject({ status: "already_undone" });
  });

  it("rejects target collisions and snapshot drift before changing any page", () => {
    const fixture = makeFixture();
    const before = fixture.taggedPaths.map((file) => fs.readFileSync(file, "utf8"));
    expect(fixture.service.rename({ ...renameRequest(fixture), replacementTag: "Existing" })).toMatchObject({ status: "ineligible" });
    expect(fixture.taggedPaths.map((file) => fs.readFileSync(file, "utf8"))).toEqual(before);

    writePage(fixture.vaultPath, "late", "page_20260730_late0001", "Late", ["Original"]);
    expect(fixture.service.rename(renameRequest(fixture))).toMatchObject({ status: "stale" });
    expect(fixture.taggedPaths.map((file) => fs.readFileSync(file, "utf8"))).toEqual(before);
    expect(findOperations(fixture.vaultPath)).toHaveLength(0);
  });

  it("adopts an interrupted exact file commit after restart without duplicating its Operation", () => {
    const fixture = makeFixture();
    const committed = fixture.service.rename(renameRequest(fixture));
    if (committed.status !== "committed") throw new Error("tag rename did not commit");
    const operationFile = findOperationFiles(fixture.vaultPath).find((file) => file.endsWith(`${committed.operationId}.json`))!;
    fs.unlinkSync(operationFile);

    const restarted = new LibraryTagRenameService(fixture.vaults);
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    expect(findOperations(fixture.vaultPath).filter((operation) => operation.id === committed.operationId)).toHaveLength(1);
    expect(restarted.rename(renameRequest(fixture))).toEqual(committed);
  });

  it("merges into an existing tag, deduplicates overlap, adopts replay, and restores exact tags", () => {
    const fixture = makeFixture(["original", "Existing"]);
    const before = fixture.taggedPaths.map((file) => fs.readFileSync(file, "utf8"));
    const request = mergeRequest(fixture);
    const committed = fixture.service.merge(request);
    expect(committed).toMatchObject({ status: "committed", mergedPageCount: 2 });
    if (committed.status !== "committed") throw new Error("tag merge did not commit");
    const merged = fixture.taggedPaths.map((file) => fs.readFileSync(file, "utf8"));
    expect(merged[0]).toContain('tags: ["Existing"]');
    expect(merged[1]).toContain('tags: ["Existing"]');
    expect(merged[1]?.match(/"Existing"/gu)).toHaveLength(1);
    expect(merged.join("\n")).not.toMatch(/"[Oo]riginal"/u);
    const operationFile = findOperationFiles(fixture.vaultPath).find((file) => file.endsWith(`${committed.operationId}.json`))!;
    fs.unlinkSync(operationFile);
    const restarted = new LibraryTagRenameService(fixture.vaults);
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    expect(restarted.merge(request)).toEqual(committed);

    const operation = findOperations(fixture.vaultPath).find((item) => item.id === committed.operationId)!;
    expect(restarted.activitySummary(operation)).toMatchObject({ status: "applied", canUndo: true });
    expect(restarted.undo(operation)).toMatchObject({ status: "undone" });
    expect(fixture.taggedPaths.map((file) => fs.readFileSync(file, "utf8"))).toEqual(before);
  });

  it("fails a merge closed when either tag count or exact snapshot drifts", () => {
    const fixture = makeFixture(["original", "Existing"]);
    const before = fixture.taggedPaths.map((file) => fs.readFileSync(file, "utf8"));
    expect(fixture.service.merge({ ...mergeRequest(fixture), expectedTargetPageCount: 1 })).toMatchObject({ status: "stale" });
    expect(fixture.taggedPaths.map((file) => fs.readFileSync(file, "utf8"))).toEqual(before);

    writePage(fixture.vaultPath, "late-target", "page_20260730_latemerg", "Late target", ["Existing"]);
    expect(fixture.service.merge(mergeRequest(fixture))).toMatchObject({ status: "stale" });
    expect(fixture.taggedPaths.map((file) => fs.readFileSync(file, "utf8"))).toEqual(before);
    expect(findOperations(fixture.vaultPath)).toHaveLength(0);
  });

  it("removes one tag from every exact page, adopts restart, and restores exact bytes through Undo", () => {
    const fixture = makeFixture();
    const before = fixture.taggedPaths.map((file) => fs.readFileSync(file, "utf8"));
    const request = removeRequest(fixture);
    const committed = fixture.service.remove(request);
    expect(committed).toMatchObject({ status: "committed", removedPageCount: 2 });
    if (committed.status !== "committed") throw new Error("tag removal did not commit");
    const removed = fixture.taggedPaths.map((file) => fs.readFileSync(file, "utf8"));
    expect(removed[0]).toContain("tags: []");
    expect(removed[1]).toContain('tags: ["Other"]');
    expect(removed.join("\n")).not.toMatch(/"[Oo]riginal"/u);
    expect(fs.readFileSync(fixture.unrelatedPath, "utf8")).toBe(fixture.unrelatedMarkdown);

    const operationFile = findOperationFiles(fixture.vaultPath).find((file) => file.endsWith(`${committed.operationId}.json`))!;
    fs.unlinkSync(operationFile);
    const restarted = new LibraryTagRenameService(fixture.vaults);
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    expect(restarted.remove(request)).toEqual(committed);
    const operation = findOperations(fixture.vaultPath).find((item) => item.id === committed.operationId)!;
    expect(restarted.activitySummary(operation)).toMatchObject({ status: "applied", canUndo: true });
    expect(restarted.undo(operation)).toMatchObject({ status: "undone" });
    expect(fixture.taggedPaths.map((file) => fs.readFileSync(file, "utf8"))).toEqual(before);
  });

  it("fails tag removal before mutation when count or snapshot authority drifts", () => {
    const fixture = makeFixture();
    const before = fixture.taggedPaths.map((file) => fs.readFileSync(file, "utf8"));
    expect(fixture.service.remove({ ...removeRequest(fixture), expectedPageCount: 1 })).toMatchObject({ status: "stale" });
    expect(fixture.taggedPaths.map((file) => fs.readFileSync(file, "utf8"))).toEqual(before);
    writePage(fixture.vaultPath, "late-remove", "page_20260730_lateremv", "Late remove", ["Original"]);
    expect(fixture.service.remove(removeRequest(fixture))).toMatchObject({ status: "stale" });
    expect(fixture.taggedPaths.map((file) => fs.readFileSync(file, "utf8"))).toEqual(before);
    expect(findOperations(fixture.vaultPath)).toHaveLength(0);
  });

  it("removes a tag from one exact page, adopts restart, and restores it through Undo", () => {
    const fixture = makeFixture();
    const before = fs.readFileSync(fixture.taggedPaths[0]!, "utf8");
    const request = removePageTagRequest(fixture);
    const committed = fixture.service.removeFromPage(request);
    expect(committed).toMatchObject({ status: "committed" });
    if (committed.status !== "committed") throw new Error("page tag removal did not commit");
    expect(fs.readFileSync(fixture.taggedPaths[0]!, "utf8")).toContain("tags: []");
    expect(fs.readFileSync(fixture.taggedPaths[1]!, "utf8")).toMatch(/"[Oo]riginal"/u);
    const operationFile = findOperationFiles(fixture.vaultPath).find((file) => file.endsWith(`${committed.operationId}.json`))!;
    fs.unlinkSync(operationFile);
    const restarted = new LibraryTagRenameService(fixture.vaults);
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    expect(restarted.removeFromPage(request)).toEqual(committed);
    const operation = findOperations(fixture.vaultPath).find((item) => item.id === committed.operationId)!;
    expect(restarted.undo(operation)).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(fixture.taggedPaths[0]!, "utf8")).toBe(before);
  });

  it("fails one-page tag removal closed on page or snapshot drift", () => {
    const fixture = makeFixture();
    const before = fs.readFileSync(fixture.taggedPaths[0]!, "utf8");
    expect(fixture.service.removeFromPage({
      ...removePageTagRequest(fixture), expectedPageUpdatedAt: "2026-07-30T07:00:00.000Z"
    })).toMatchObject({ status: "stale" });
    writePage(fixture.vaultPath, "late-page-tag", "page_20260730_lateptag", "Late page tag", ["Original"]);
    expect(fixture.service.removeFromPage(removePageTagRequest(fixture))).toMatchObject({ status: "stale" });
    expect(fs.readFileSync(fixture.taggedPaths[0]!, "utf8")).toBe(before);
    expect(findOperations(fixture.vaultPath)).toHaveLength(0);
  });
});

function makeFixture(secondTags: readonly string[] = ["original", "Other"]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-library-tag-rename-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Primary",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-30T08:00:00.000Z")
  });
  const vaultPath = path.join(root, "Primary");
  const vault = loadVaultSummary(vaultPath);
  const firstPath = writePage(vaultPath, "first", "page_20260730_first001", "First", ["Original"]);
  const secondPath = writePage(vaultPath, "second", "page_20260730_second01", "Second", secondTags);
  const unrelatedPath = writePage(vaultPath, "other", "page_20260730_other001", "Other", ["Existing"]);
  const unrelatedMarkdown = fs.readFileSync(unrelatedPath, "utf8");
  const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
  const tags = new LibraryTagsService(vaults).browse({
    apiVersion: 1,
    requestId: "library_tags_request_0123456789abcdef",
    activeVaultId: vault.vaultId,
    mode: "list_tags",
    limit: 100
  });
  if (tags.status !== "ready" || tags.mode !== "list_tags") throw new Error("missing tag snapshot");
  const tagPages = new LibraryTagsService(vaults).browse({
    apiVersion: 1,
    requestId: "library_tags_request_fedcba9876543210",
    activeVaultId: vault.vaultId,
    mode: "list_pages_for_tag",
    tag: "Original",
    limit: 100
  });
  if (tagPages.status !== "ready" || tagPages.mode !== "list_pages_for_tag") throw new Error("missing tag pages snapshot");
  return {
    vaultPath,
    vault,
    vaults,
    taggedPaths: [firstPath, secondPath],
    unrelatedPath,
    unrelatedMarkdown,
    snapshotId: tags.snapshotId,
    pageSnapshotId: tagPages.snapshotId,
    firstPageUpdatedAt: tagPages.pages.find((page) => page.pageId === "page_20260730_first001")!.updatedAt,
    service: new LibraryTagRenameService(vaults, {
      now: () => new Date("2026-07-30T09:00:00.000Z"),
      randomId: () => "fixedtagrename"
    })
  };
}

function mergeRequest(fixture: ReturnType<typeof makeFixture>): LibraryMergeTagRequest {
  return {
    apiVersion: 1,
    requestId: "library_tag_merge_request_0123456789abcdef",
    activeVaultId: fixture.vault.vaultId,
    sourceTag: "Original",
    targetTag: "Existing",
    expectedSnapshotId: fixture.snapshotId,
    expectedSourcePageCount: 2,
    expectedTargetPageCount: 2
  };
}

function removeRequest(fixture: ReturnType<typeof makeFixture>): LibraryRemoveTagRequest {
  return {
    apiVersion: 1,
    requestId: "library_tag_remove_request_0123456789abcdef",
    activeVaultId: fixture.vault.vaultId,
    tag: "Original",
    expectedSnapshotId: fixture.snapshotId,
    expectedPageCount: 2
  };
}

function removePageTagRequest(fixture: ReturnType<typeof makeFixture>): LibraryRemovePageTagRequest {
  return {
    apiVersion: 1,
    requestId: "library_page_tag_remove_request_0123456789abcdef",
    activeVaultId: fixture.vault.vaultId,
    tag: "Original",
    pageId: "page_20260730_first001",
    expectedSnapshotId: fixture.pageSnapshotId,
    expectedPageUpdatedAt: fixture.firstPageUpdatedAt
  };
}

function renameRequest(fixture: ReturnType<typeof makeFixture>): LibraryRenameTagRequest {
  return {
    apiVersion: 1,
    requestId: "library_tag_rename_request_0123456789abcdef",
    activeVaultId: fixture.vault.vaultId,
    tag: "Original",
    replacementTag: "Renamed tag",
    expectedSnapshotId: fixture.snapshotId,
    expectedPageCount: 2
  };
}

function writePage(vaultPath: string, slug: string, pageId: string, title: string, tags: readonly string[]): string {
  const file = path.join(vaultPath, "wiki", `${slug}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\nid: ${JSON.stringify(pageId)}\nschema_version: 1\ntitle: ${JSON.stringify(title)}\ntype: note\ncreated_at: "2026-07-30T08:00:00.000Z"\nupdated_at: "2026-07-30T08:00:00.000Z"\nstatus: active\nlanguage: en\nsource_ids: []\ntags: ${JSON.stringify(tags)}\n---\n\n# ${title}\n\nprivate body ${slug}\n`, "utf8");
  return file;
}

function findOperationFiles(vaultPath: string): string[] {
  const root = path.join(vaultPath, ".pige", "operations");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((entry) => path.join(root, entry))
    .filter((entry) => entry.endsWith(".json"));
}

function findOperations(vaultPath: string): Array<{ id: string; kind: string; targetRefs: unknown[]; [key: string]: unknown }> {
  return findOperationFiles(vaultPath).map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
}
