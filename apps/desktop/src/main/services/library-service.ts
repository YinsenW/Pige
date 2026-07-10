import type {
  LibraryListRequest,
  LibraryListResult,
  LibraryRelatedRequest,
  LibraryRelatedResult,
  VaultSummary
} from "@pige/contracts";
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
}

function clampLimit(limit: number | undefined): number {
  if (!limit) return DEFAULT_LIBRARY_LIMIT;
  return Math.max(1, Math.min(MAX_LIBRARY_LIMIT, Math.floor(limit)));
}
