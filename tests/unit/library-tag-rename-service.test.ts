import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LibraryRenameTagRequest, VaultSummary } from "@pige/contracts";
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
});

function makeFixture() {
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
  const secondPath = writePage(vaultPath, "second", "page_20260730_second01", "Second", ["original", "Other"]);
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
  return {
    vaultPath,
    vault,
    vaults,
    taggedPaths: [firstPath, secondPath],
    unrelatedPath,
    unrelatedMarkdown,
    snapshotId: tags.snapshotId,
    service: new LibraryTagRenameService(vaults, {
      now: () => new Date("2026-07-30T09:00:00.000Z"),
      randomId: () => "fixedtagrename"
    })
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
