import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LibraryTagsRequest, VaultSummary } from "@pige/contracts";
import { LibraryTagsService } from "../../apps/desktop/src/main/services/library-tags-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("library tags service", () => {
  it("lists canonical facets and opens safe page summaries in deterministic order", () => {
    const { vaultPath, vault } = makeVault("Primary");
    writePage(vaultPath, "older", "page_20260730_older001", "Older", "2026-07-30T09:00:00.000Z", ["Research"]);
    writePage(vaultPath, "newer", "page_20260730_newer001", "Newer", "2026-07-30T10:00:00.000Z", ["research", "Local First"]);
    const service = makeService(vaultPath, vault);

    const facets = service.browse(request(vault, { mode: "list_tags", limit: 10 }));
    expect(facets).toMatchObject({
      status: "ready",
      total: 2,
      tags: [
        { tag: "Local First", pageCount: 1 },
        { tag: "research", pageCount: 2 }
      ]
    });
    if (facets.status !== "ready" || facets.mode !== "list_tags") throw new Error("Expected tag facets.");

    const pages = service.browse(request(vault, { mode: "list_pages_for_tag", tag: "Research", limit: 10 }));
    expect(pages).toMatchObject({
      status: "ready",
      total: 2,
      pages: [
        { pageId: "page_20260730_newer001", title: "Newer", pageType: "note", status: "active" },
        { pageId: "page_20260730_older001", title: "Older", pageType: "note", status: "active" }
      ]
    });
    expect(JSON.stringify(pages)).not.toContain(vaultPath);
    expect(JSON.stringify(pages)).not.toContain("private body");
  });

  it("continues only the exact vault, tag, snapshot, and exclusive boundary", () => {
    const { vaultPath, vault } = makeVault("Paged");
    writePage(vaultPath, "a", "page_20260730_pagea001", "A", "2026-07-30T12:00:00.000Z", ["Paged"]);
    writePage(vaultPath, "b", "page_20260730_pageb001", "B", "2026-07-30T11:00:00.000Z", ["Paged"]);
    writePage(vaultPath, "c", "page_20260730_pagec001", "C", "2026-07-30T10:00:00.000Z", ["Paged"]);
    const service = makeService(vaultPath, vault);
    const first = service.browse(request(vault, { mode: "list_pages_for_tag", tag: "Paged", limit: 1 }));
    if (first.status !== "ready" || first.mode !== "list_pages_for_tag" || !first.nextCursor) {
      throw new Error("Expected a continuation.");
    }

    const second = service.browse(request(vault, {
      mode: "list_pages_for_tag",
      tag: "Paged",
      limit: 1,
      snapshotId: first.snapshotId,
      cursor: first.nextCursor
    }));
    expect(second).toMatchObject({ status: "ready", pages: [{ pageId: "page_20260730_pageb001" }] });

    const tampered = first.nextCursor.replace(/.$/u, first.nextCursor.endsWith("0") ? "1" : "0");
    expect(service.browse(request(vault, {
      mode: "list_pages_for_tag",
      tag: "Paged",
      limit: 1,
      snapshotId: first.snapshotId,
      cursor: tampered as typeof first.nextCursor
    }))).toMatchObject({ status: "stale" });

    writePage(vaultPath, "d", "page_20260730_paged001", "D", "2026-07-30T13:00:00.000Z", ["Paged"]);
    expect(service.browse(request(vault, {
      mode: "list_pages_for_tag",
      tag: "Paged",
      limit: 1,
      snapshotId: first.snapshotId,
      cursor: first.nextCursor
    }))).toMatchObject({ status: "stale" });
  });

  it("fails closed across vault identity drift without exposing the active vault", () => {
    const first = makeVault("First");
    const second = makeVault("Second");
    writePage(first.vaultPath, "one", "page_20260730_first001", "First", "2026-07-30T10:00:00.000Z", ["Private"]);
    const service = makeService(first.vaultPath, first.vault);

    const result = service.browse(request(second.vault, { mode: "list_tags", limit: 10 }));
    expect(result).toEqual({
      apiVersion: 1,
      requestId: "library_tags_request_0123456789abcdef",
      activeVaultId: second.vault.vaultId,
      mode: "list_tags",
      status: "stale"
    });
  });
});

function makeVault(name: string): { vaultPath: string; vault: VaultSummary } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-library-tags-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: name,
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-30T08:00:00.000Z")
  });
  const vaultPath = path.join(root, name);
  return { vaultPath, vault: loadVaultSummary(vaultPath) };
}

function makeService(vaultPath: string, vault: VaultSummary): LibraryTagsService {
  return new LibraryTagsService({ current: () => vault, activeVaultPath: () => vaultPath });
}

function request(
  vault: VaultSummary,
  input: Omit<LibraryTagsRequest, "apiVersion" | "requestId" | "activeVaultId">
): LibraryTagsRequest {
  return {
    apiVersion: 1,
    requestId: "library_tags_request_0123456789abcdef",
    activeVaultId: vault.vaultId,
    ...input
  } as LibraryTagsRequest;
}

function writePage(
  vaultPath: string,
  slug: string,
  pageId: string,
  title: string,
  updatedAt: string,
  tags: readonly string[]
): void {
  const filePath = path.join(vaultPath, "wiki", `${slug}.md`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---
id: "${pageId}"
schema_version: 1
title: "${title}"
type: "note"
created_at: "2026-07-30T08:00:00.000Z"
updated_at: "${updatedAt}"
status: "active"
language: "en"
source_ids: []
tags: ${JSON.stringify(tags)}
---

# ${title}

private body ${slug}
`, "utf8");
}
