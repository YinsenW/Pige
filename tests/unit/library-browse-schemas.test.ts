import { describe, expect, it } from "vitest";
import {
  LIBRARY_BROWSE_CHANNEL,
  LibraryBrowseRequestSchema,
  LibraryBrowseResultSchema
} from "@pige/schemas";

const request = {
  apiVersion: 1 as const,
  requestId: "library_browse_request_1111111111111111",
  activeVaultId: "vault_20260731_browse001",
  limit: 50
};

function page(id: string, pagePath: string, updatedAt: string) {
  return {
    pageId: id,
    title: id,
    pageType: "note" as const,
    status: "active" as const,
    pagePath,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt,
    language: "en",
    sourceIds: []
  };
}

describe("Library browse schemas", () => {
  it("uses a strict pathless request and paired opaque continuation", () => {
    expect(LIBRARY_BROWSE_CHANNEL).toBe("library.browse");
    expect(LibraryBrowseRequestSchema.parse(request)).toEqual(request);
    expect(() => LibraryBrowseRequestSchema.parse({ ...request, vaultPath: "/private/vault" })).toThrow();
    expect(() => LibraryBrowseRequestSchema.parse({
      ...request,
      snapshotId: `library_browse_snapshot_${"a".repeat(64)}`
    })).toThrow();
    expect(LibraryBrowseRequestSchema.parse({
      ...request,
      snapshotId: `library_browse_snapshot_${"a".repeat(64)}`,
      cursor: `library_browse_cursor_${"b".repeat(64)}`
    })).toBeTruthy();
  });

  it("rejects duplicate, unsafe, or unstably ordered result pages", () => {
    const identity = {
      apiVersion: 1 as const,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      status: "ready" as const,
      snapshotId: `library_browse_snapshot_${"a".repeat(64)}`,
      scannedAt: "2026-07-31T00:00:00.000Z",
      total: 2,
      invalidPageCount: 0
    };
    const first = page("page_20260731_browse01", "wiki/a.md", "2026-07-31T02:00:00.000Z");
    const second = page("page_20260731_browse02", "wiki/b.md", "2026-07-31T01:00:00.000Z");
    expect(LibraryBrowseResultSchema.parse({ ...identity, pages: [first, second] })).toBeTruthy();
    expect(() => LibraryBrowseResultSchema.parse({ ...identity, pages: [first, first] })).toThrow();
    expect(() => LibraryBrowseResultSchema.parse({ ...identity, pages: [second, first] })).toThrow();
    expect(() => LibraryBrowseResultSchema.parse({
      ...identity,
      pages: [{ ...first, pagePath: "/private/vault/wiki/a.md" }]
    })).toThrow();
  });
});
