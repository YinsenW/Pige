import type {
  LibraryBrowseRequest,
  LibraryBrowseResult,
  LibraryListRequest,
  LibraryListResult,
  KnowledgeTreeResult,
  KnowledgeTreeSnapshot,
  LibraryRelatedRequest,
  LibraryRelatedResult,
  VaultSummary
} from "@pige/contracts";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import type { MarkdownPageType } from "@pige/schemas";
import { compareMarkdownPageRecords, scanMarkdownPages } from "./markdown-page-index";
import type { LocalDatabaseService } from "./local-database-service";

export interface LibraryVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

const DEFAULT_LIBRARY_LIMIT = 50;
const MAX_LIBRARY_LIMIT = 200;

export class LibraryService {
  readonly #vaults: LibraryVaultPort;
  readonly #database: LocalDatabaseService | undefined;
  readonly #browseCursors = new Map<string, LibraryBrowseCursorState>();

  constructor(vaults: LibraryVaultPort, database?: LocalDatabaseService) {
    this.#vaults = vaults;
    this.#database = database;
  }

  list(request: LibraryListRequest = {}): LibraryListResult {
    const activeVault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!activeVault || !vaultPath) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }

    const pageTypes = new Set<MarkdownPageType>(request.pageTypes ?? []);
    const limit = clampLimit(request.limit);
    const indexed = this.#database?.listPages(vaultPath, { ...request, limit });
    if (indexed) {
      return {
        scannedAt: new Date().toISOString(),
        activeVaultId: activeVault.vaultId,
        total: indexed.total,
        invalidPageCount: indexed.invalidPageCount,
        pages: indexed.pages
      };
    }

    const scanned = scanMarkdownPages(vaultPath);
    const matchingPages = scanned.pages
      .map((page) => page.summary)
      .filter((page) => pageTypes.size === 0 || pageTypes.has(page.pageType))
      .sort(compareMarkdownPageRecords);
    const pages = matchingPages.slice(0, limit);

    return {
      scannedAt: new Date().toISOString(),
      activeVaultId: activeVault.vaultId,
      total: matchingPages.length,
      invalidPageCount: scanned.invalidPageCount,
      pages
    };
  }

  browse(request: LibraryBrowseRequest): LibraryBrowseResult {
    const activeVault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    const identity = {
      apiVersion: 1 as const,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId
    };
    if (!activeVault || !vaultPath) return { ...identity, status: "failed" };
    if (activeVault.vaultId !== request.activeVaultId) return { ...identity, status: "stale" };

    try {
      const canonicalVaultPath = path.resolve(vaultPath);
      let offset = 0;
      let expectedPreviousBoundary: string | undefined;
      let consumedCursor: string | undefined;
      if (request.cursor && request.snapshotId) {
        const cursor = this.#browseCursors.get(request.cursor);
        if (!cursor || cursor.activeVaultId !== request.activeVaultId ||
          cursor.vaultPath !== canonicalVaultPath || cursor.snapshotId !== request.snapshotId) {
          return { ...identity, status: "stale" };
        }
        offset = cursor.offset;
        expectedPreviousBoundary = cursor.previousBoundary;
        consumedCursor = request.cursor;
      }

      const slice = this.#readBrowseSlice(canonicalVaultPath, offset, request.limit);
      if (request.snapshotId && request.snapshotId !== slice.snapshotId) {
        return { ...identity, status: "stale" };
      }
      if (expectedPreviousBoundary !== undefined &&
        expectedPreviousBoundary !== boundaryOf(slice.previousPage)) {
        return { ...identity, status: "stale" };
      }

      const nextOffset = offset + slice.pages.length;
      const nextCursor = nextOffset < slice.total
        ? this.#rememberCursor({
            activeVaultId: request.activeVaultId,
            vaultPath: canonicalVaultPath,
            snapshotId: slice.snapshotId,
            offset: nextOffset,
            previousBoundary: boundaryOf(slice.pages.at(-1))
          })
        : undefined;
      if (consumedCursor) this.#browseCursors.delete(consumedCursor);
      return {
        ...identity,
        status: "ready",
        snapshotId: slice.snapshotId,
        scannedAt: new Date().toISOString(),
        total: slice.total,
        invalidPageCount: slice.invalidPageCount,
        pages: slice.pages,
        ...(nextCursor ? { nextCursor } : {})
      };
    } catch {
      return { ...identity, status: "failed" };
    }
  }

  #readBrowseSlice(vaultPath: string, offset: number, limit: number): LibraryBrowseSlice {
    const indexed = this.#database?.browseLibraryPages(vaultPath, { offset, limit });
    if (indexed) {
      return {
        snapshotId: createBrowseSnapshotId(JSON.stringify({
          source: "index",
          generation: indexed.indexGeneration,
          total: indexed.total,
          invalidPageCount: indexed.invalidPageCount
        })),
        total: indexed.total,
        invalidPageCount: indexed.invalidPageCount,
        pages: indexed.pages,
        ...(indexed.previousPage ? { previousPage: indexed.previousPage } : {})
      };
    }
    const scanned = scanMarkdownPages(vaultPath);
    const pages = scanned.pages.map((page) => page.summary).sort(compareMarkdownPageRecords);
    return {
      snapshotId: createBrowseSnapshotId(JSON.stringify({
        source: "markdown",
        invalidPageCount: scanned.invalidPageCount,
        pages
      })),
      total: pages.length,
      invalidPageCount: scanned.invalidPageCount,
      pages: pages.slice(offset, offset + limit),
      ...(offset > 0 && pages[offset - 1] ? { previousPage: pages[offset - 1] } : {})
    };
  }

  #rememberCursor(state: LibraryBrowseCursorState): string {
    const cursor = `library_browse_cursor_${randomBytes(32).toString("hex")}`;
    this.#browseCursors.set(cursor, state);
    while (this.#browseCursors.size > 128) {
      const oldest = this.#browseCursors.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#browseCursors.delete(oldest);
    }
    return cursor;
  }

  related(request: LibraryRelatedRequest): LibraryRelatedResult {
    const activeVault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!activeVault || !vaultPath) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }

    const related = this.#database?.relatedPages(vaultPath, request);
    if (related) {
      return {
        queriedAt: new Date().toISOString(),
        activeVaultId: activeVault.vaultId,
        pageId: request.pageId,
        totalOutgoing: related.totalOutgoing,
        totalBacklinks: related.totalBacklinks,
        invalidPageCount: related.invalidPageCount,
        outgoing: related.outgoing,
        backlinks: related.backlinks,
        degraded: false
      };
    }

    return {
      queriedAt: new Date().toISOString(),
      activeVaultId: activeVault.vaultId,
      pageId: request.pageId,
      totalOutgoing: 0,
      totalBacklinks: 0,
      invalidPageCount: 0,
      outgoing: [],
      backlinks: [],
      degraded: true,
      degradedReason: "local_database_not_ready"
    };
  }

  tree(): KnowledgeTreeResult {
    const activeVault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!activeVault || !vaultPath) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }

    const snapshot = this.#database?.knowledgeTree(vaultPath);
    return {
      ...(snapshot ?? emptyKnowledgeTreeSnapshot()),
      queriedAt: new Date().toISOString(),
      activeVaultId: activeVault.vaultId,
      degraded: !snapshot,
      ...(!snapshot ? { degradedReason: "local_database_not_ready" as const } : {})
    };
  }
}

interface LibraryBrowseCursorState {
  readonly activeVaultId: string;
  readonly vaultPath: string;
  readonly snapshotId: string;
  readonly offset: number;
  readonly previousBoundary: string;
}

interface LibraryBrowseSlice {
  readonly snapshotId: `library_browse_snapshot_${string}`;
  readonly total: number;
  readonly invalidPageCount: number;
  readonly pages: LibraryListResult["pages"];
  readonly previousPage?: LibraryListResult["pages"][number];
}

function createBrowseSnapshotId(value: string): `library_browse_snapshot_${string}` {
  return `library_browse_snapshot_${createHash("sha256").update(value).digest("hex")}`;
}

function boundaryOf(page: LibraryListResult["pages"][number] | undefined): string {
  return page ? `${page.updatedAt}\0${page.pagePath}\0${page.pageId}` : "";
}

function emptyKnowledgeTreeSnapshot(): KnowledgeTreeSnapshot {
  return {
    schemaVersion: 1,
    state: "empty",
    invalidPageCount: 0,
    totals: {
      pageCount: 0,
      topicCount: 0,
      conceptCount: 0,
      entityCount: 0,
      fragmentPageCount: 0,
      sourceCount: 0,
      leafCount: 0
    },
    roots: []
  };
}

function clampLimit(limit: number | undefined): number {
  if (!limit) return DEFAULT_LIBRARY_LIMIT;
  return Math.max(1, Math.min(MAX_LIBRARY_LIMIT, Math.floor(limit)));
}
