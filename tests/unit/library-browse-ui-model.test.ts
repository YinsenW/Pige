import { describe, expect, it } from "vitest";
import type { LibraryBrowseResult, LibraryListResult, LibraryPageSummary } from "@pige/contracts";
import {
  appendLibraryBrowsePage,
  groupLibrarySearchItems,
  libraryBrowseItems,
  libraryFamilyPageTypes
} from "../../apps/desktop/src/renderer/src/components/library-panel-model";

function page(id: string, pagePath: string, updatedAt: string): LibraryPageSummary {
  return {
    pageId: id, title: id, pageType: "note", status: "active", pagePath,
    createdAt: updatedAt, updatedAt, language: "en", sourceIds: []
  };
}

const current: LibraryListResult = {
  scannedAt: "2026-07-31T00:00:00.000Z",
  activeVaultId: "vault_20260731_browse001",
  total: 3,
  invalidPageCount: 0,
  pages: [page("page_20260731_browse01", "wiki/a.md", "2026-07-31T03:00:00.000Z")]
};

function continuation(pages: readonly LibraryPageSummary[]): Extract<LibraryBrowseResult, { status: "ready" }> {
  return {
    apiVersion: 1,
    requestId: "library_browse_request_1111111111111111",
    activeVaultId: current.activeVaultId,
    status: "ready",
    snapshotId: `library_browse_snapshot_${"a".repeat(64)}`,
    scannedAt: "2026-07-31T01:00:00.000Z",
    total: current.total,
    invalidPageCount: 0,
    pages
  };
}

describe("Library browse UI model", () => {
  it("appends a valid continuation without replacing visible rows", () => {
    const next = page("page_20260731_browse02", "wiki/b.md", "2026-07-31T02:00:00.000Z");
    expect(appendLibraryBrowsePage(current, continuation([next]))?.pages).toEqual([...current.pages, next]);
  });

  it("rejects duplicates, reordered boundaries, and owner drift", () => {
    expect(appendLibraryBrowsePage(current, continuation(current.pages))).toBeUndefined();
    expect(appendLibraryBrowsePage(current, continuation([
      page("page_20260731_browse03", "wiki/c.md", "2026-07-31T04:00:00.000Z")
    ]))).toBeUndefined();
    expect(appendLibraryBrowsePage(current, {
      ...continuation([]), activeVaultId: "vault_20260731_other0001"
    })).toBeUndefined();
  });

  it("keeps every typed Knowledge family exact in browse and search", () => {
    const typed = (["topic", "concept", "entity", "claim", "question"] as const).map((pageType, index) => ({
      ...page(`page_20260802_typed000${index}`, `wiki/${pageType}.md`, `2026-08-02T0${index}:00:00.000Z`),
      pageType
    }));
    const pages = [...current.pages, ...typed];
    const expected = [
      ["topics", "topic"], ["concepts", "concept"], ["entities", "entity"],
      ["claims", "claim"], ["questions", "question"]
    ] as const;
    for (const [family, pageType] of expected) {
      expect(libraryFamilyPageTypes(family)).toEqual([pageType]);
      expect(libraryBrowseItems(pages, family).map((item) => item.summary.pageType)).toEqual([pageType]);
    }
    const grouped = groupLibrarySearchItems(pages.map((summary) => ({
      summary, score: 0, snippets: [], matchReasons: []
    })));
    for (const [family, pageType] of expected) {
      expect(grouped[family].map((item) => item.summary.pageType)).toEqual([pageType]);
    }
  });
});
