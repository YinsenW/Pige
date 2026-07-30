import { createHash, randomBytes } from "node:crypto";
import type {
  LibraryTagFacet,
  LibraryTaggedPageSummary,
  LibraryTagsCursor,
  LibraryTagsRequest,
  LibraryTagsResult,
  LibraryTagsSnapshotId,
  VaultSummary
} from "@pige/contracts";
import { createPigeTagKey, normalizePigeTag } from "@pige/markdown";
import { LibraryTagsResultSchema } from "@pige/schemas";
import { scanMarkdownPages } from "./markdown-page-index";

export interface LibraryTagsVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

interface CursorBinding {
  readonly activeVaultId: string;
  readonly vaultPath: string;
  readonly mode: LibraryTagsRequest["mode"];
  readonly tag?: string;
  readonly snapshotId: LibraryTagsSnapshotId;
  readonly offset: number;
  readonly boundary: string;
}

export interface LibraryTagSnapshot {
  readonly tags: readonly LibraryTagFacet[];
  readonly pagesByTag: ReadonlyMap<string, readonly LibraryTaggedPageSummary[]>;
}

const DEFAULT_CURSOR_CAPACITY = 128;

export class LibraryTagsService {
  readonly #vaults: LibraryTagsVaultPort;
  readonly #cursors = new Map<LibraryTagsCursor, CursorBinding>();
  readonly #cursorCapacity: number;

  constructor(vaults: LibraryTagsVaultPort, cursorCapacity = DEFAULT_CURSOR_CAPACITY) {
    this.#vaults = vaults;
    this.#cursorCapacity = Math.max(1, cursorCapacity);
  }

  browse(request: LibraryTagsRequest): LibraryTagsResult {
    const identity = request.mode === "list_tags"
      ? {
          apiVersion: 1 as const,
          requestId: request.requestId,
          activeVaultId: request.activeVaultId,
          mode: request.mode
        }
      : {
          apiVersion: 1 as const,
          requestId: request.requestId,
          activeVaultId: request.activeVaultId,
          mode: request.mode,
          tag: request.tag
        };
    const activeVault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!activeVault || !vaultPath) return LibraryTagsResultSchema.parse({ ...identity, status: "failed" });
    if (activeVault.vaultId !== request.activeVaultId) {
      return LibraryTagsResultSchema.parse({ ...identity, status: "stale" });
    }

    try {
      const snapshot = readLibraryTagSnapshot(vaultPath);
      const items = request.mode === "list_tags"
        ? snapshot.tags
        : snapshot.pagesByTag.get(createPigeTagKey(request.tag) ?? "") ?? [];
      const snapshotId = createLibraryTagsSnapshotId(request.mode, request.mode === "list_tags" ? undefined : request.tag, items);
      const offset = this.#resolveOffset(request, vaultPath, snapshotId, items);
      if (offset === undefined) return LibraryTagsResultSchema.parse({ ...identity, status: "stale" });

      const page = items.slice(offset, offset + request.limit);
      const nextOffset = offset + page.length;
      const nextCursor = nextOffset < items.length
        ? this.#registerCursor({
            activeVaultId: request.activeVaultId,
            vaultPath,
            mode: request.mode,
            ...(request.mode === "list_pages_for_tag" ? { tag: request.tag } : {}),
            snapshotId,
            offset: nextOffset,
            boundary: itemBoundary(items[nextOffset - 1]!)
          })
        : undefined;
      return LibraryTagsResultSchema.parse({
        ...identity,
        status: "ready",
        snapshotId,
        ...(request.mode === "list_tags" ? { tags: page } : { pages: page }),
        total: items.length,
        ...(nextCursor ? { nextCursor } : {})
      });
    } catch {
      return LibraryTagsResultSchema.parse({ ...identity, status: "failed" });
    }
  }

  #resolveOffset(
    request: LibraryTagsRequest,
    vaultPath: string,
    snapshotId: LibraryTagsSnapshotId,
    items: readonly (LibraryTagFacet | LibraryTaggedPageSummary)[]
  ): number | undefined {
    if (!request.cursor || !request.snapshotId) return 0;
    const binding = this.#cursors.get(request.cursor);
    if (
      !binding ||
      request.snapshotId !== snapshotId ||
      binding.snapshotId !== snapshotId ||
      binding.activeVaultId !== request.activeVaultId ||
      binding.vaultPath !== vaultPath ||
      binding.mode !== request.mode ||
      binding.tag !== (request.mode === "list_pages_for_tag" ? request.tag : undefined) ||
      binding.offset < 1 ||
      binding.offset >= items.length ||
      itemBoundary(items[binding.offset - 1]!) !== binding.boundary
    ) {
      return undefined;
    }
    return binding.offset;
  }

  #registerCursor(binding: CursorBinding): LibraryTagsCursor {
    const cursor = `library_tags_cursor_${randomBytes(32).toString("hex")}` as LibraryTagsCursor;
    this.#cursors.set(cursor, binding);
    while (this.#cursors.size > this.#cursorCapacity) {
      const oldest = this.#cursors.keys().next().value as LibraryTagsCursor | undefined;
      if (!oldest) break;
      this.#cursors.delete(oldest);
    }
    return cursor;
  }
}

export function readLibraryTagSnapshot(vaultPath: string): LibraryTagSnapshot {
  const byKey = new Map<string, { tag: string; pages: Map<string, LibraryTaggedPageSummary> }>();
  for (const page of scanMarkdownPages(vaultPath).pages) {
    const summary: LibraryTaggedPageSummary = {
      pageId: page.summary.pageId,
      title: page.summary.title,
      pageType: page.summary.pageType,
      status: page.summary.status,
      updatedAt: page.summary.updatedAt
    };
    for (const rawTag of page.knowledge.tags) {
      const tag = normalizePigeTag(rawTag);
      const key = tag ? createPigeTagKey(tag) : undefined;
      if (!tag || !key) continue;
      const entry = byKey.get(key) ?? { tag, pages: new Map() };
      entry.pages.set(summary.pageId, summary);
      byKey.set(key, entry);
    }
  }
  const ordered = [...byKey.entries()].sort(([left], [right]) => left.localeCompare(right, "en-US"));
  return {
    tags: ordered.map(([, entry]) => ({ tag: entry.tag, pageCount: entry.pages.size })),
    pagesByTag: new Map(ordered.map(([key, entry]) => [key, [...entry.pages.values()].sort(comparePages)]))
  };
}

function comparePages(left: LibraryTaggedPageSummary, right: LibraryTaggedPageSummary): number {
  const updated = right.updatedAt.localeCompare(left.updatedAt, "en-US");
  return updated || left.pageId.localeCompare(right.pageId, "en-US");
}

export function createLibraryTagsSnapshotId(
  mode: LibraryTagsRequest["mode"],
  tag: string | undefined,
  items: readonly (LibraryTagFacet | LibraryTaggedPageSummary)[]
): LibraryTagsSnapshotId {
  const digest = createHash("sha256").update(JSON.stringify({ mode, tag, items }), "utf8").digest("hex");
  return `library_tags_snapshot_${digest}` as LibraryTagsSnapshotId;
}

function itemBoundary(item: LibraryTagFacet | LibraryTaggedPageSummary): string {
  return "pageId" in item ? `${item.updatedAt}\0${item.pageId}` : `${item.tag}\0${item.pageCount}`;
}
