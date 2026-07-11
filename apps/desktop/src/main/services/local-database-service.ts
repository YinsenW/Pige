import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type {
  LibraryListRequest,
  LibraryPageSummary,
  LibraryRelatedPage,
  LibraryRelatedRequest,
  LocalDatabaseRebuildResult,
  LocalDatabaseStatus,
  RetrievalSearchRequest,
  RetrievalSearchResultItem
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { extractPigeMarkdownLinkRefs, type PigeMarkdownLinkRef } from "@pige/markdown";
import { LocalDatabaseSchemaStateSchema, type LocalDatabaseSchemaState, type MarkdownPageType } from "@pige/schemas";
import {
  buildKnowledgeTreeSnapshot,
  type KnowledgeTreeRelationInput,
  type KnowledgeTreeSnapshot
} from "./knowledge-tree-aggregate";
import { readMarkdownPageBody, scanMarkdownPages, type MarkdownPageRecord } from "./markdown-page-index";
import {
  LOCAL_DATABASE_REBUILD_ERROR_MESSAGES,
  type LocalDatabaseRebuildExecutionOptions,
  type LocalDatabaseRebuildPort,
  type LocalDatabaseRebuildProgress
} from "./local-database-rebuild-types";
import {
  createCjkSearchAugmentation,
  createQueryTerms,
  normalizeSearchText,
  sanitizeSearchBody,
  type QueryTerms
} from "./search-text-utils";

export interface LocalDatabaseDriver {
  readonly id: "pending_sqlite_driver" | "better_sqlite3" | "node_sqlite";
  readonly initialize: (vaultPath: string) => LocalDatabaseSchemaState;
  readonly status: (vaultPath: string) => LocalDatabaseStatus;
  readonly rebuild: (
    vaultPath: string,
    callbacks?: LocalDatabaseRebuildCallbacks
  ) => LocalDatabaseRebuildResult | undefined;
  readonly listPages: (vaultPath: string, request?: LibraryListRequest) => LocalDatabasePageList | undefined;
  readonly relatedPages: (vaultPath: string, request: LibraryRelatedRequest) => LocalDatabaseRelatedPages | undefined;
  readonly searchPages: (vaultPath: string, request: RetrievalSearchRequest) => LocalDatabaseSearchResult | undefined;
  readonly knowledgeTree: (vaultPath: string) => KnowledgeTreeSnapshot | undefined;
}

export interface LocalDatabaseRebuildCallbacks {
  readonly onProgress?: (progress: LocalDatabaseRebuildProgress) => void;
}

export class PendingSqliteDriver implements LocalDatabaseDriver {
  readonly id = "pending_sqlite_driver";

  initialize(vaultPath: string): LocalDatabaseSchemaState {
    const state = createEmptySchemaState();
    writeSchemaState(vaultPath, state);
    return state;
  }

  status(vaultPath: string): LocalDatabaseStatus {
    const state = readSchemaState(vaultPath) ?? this.initialize(vaultPath);
    return {
      driver: state.driver,
      appSchemaVersion: state.appSchemaVersion,
      appliedMigrationCount: state.appliedMigrations.length,
      status: "not_initialized",
      updatedAt: state.updatedAt
    };
  }

  rebuild(): undefined {
    return undefined;
  }

  listPages(): undefined {
    return undefined;
  }

  searchPages(): undefined {
    return undefined;
  }

  relatedPages(): undefined {
    return undefined;
  }

  knowledgeTree(): undefined {
    return undefined;
  }
}

export interface LocalDatabasePageList {
  readonly total: number;
  readonly invalidPageCount: number;
  readonly pages: readonly LibraryPageSummary[];
}

export interface LocalDatabaseSearchResult {
  readonly total: number;
  readonly invalidPageCount: number;
  readonly results: readonly RetrievalSearchResultItem[];
}

export interface LocalDatabaseRelatedPages {
  readonly totalOutgoing: number;
  readonly totalBacklinks: number;
  readonly invalidPageCount: number;
  readonly outgoing: readonly LibraryRelatedPage[];
  readonly backlinks: readonly LibraryRelatedPage[];
}

export class NodeSqliteDriver implements LocalDatabaseDriver {
  readonly id = "node_sqlite";

  initialize(vaultPath: string): LocalDatabaseSchemaState {
    const db = openVaultDatabase(vaultPath);
    try {
      migrate(db);
    } finally {
      db.close();
    }
    const state = createSchemaState("node_sqlite", 1, [INITIAL_MIGRATION_ID]);
    writeSchemaState(vaultPath, state);
    return state;
  }

  status(vaultPath: string): LocalDatabaseStatus {
    try {
      const state = readSchemaState(vaultPath) ?? this.initialize(vaultPath);
      const dbPath = getDatabasePath(vaultPath);
      const ready = fs.existsSync(dbPath) && state.driver === this.id && hasInitialMigration(vaultPath);
      return {
        driver: state.driver,
        appSchemaVersion: state.appSchemaVersion,
        appliedMigrationCount: state.appliedMigrations.length,
        status: ready ? "ready" : "needs_rebuild",
        updatedAt: state.updatedAt
      };
    } catch {
      return {
        driver: this.id,
        appSchemaVersion: 0,
        appliedMigrationCount: 0,
        status: "error",
        updatedAt: new Date().toISOString()
      };
    }
  }

  rebuild(vaultPath: string, callbacks: LocalDatabaseRebuildCallbacks = {}): LocalDatabaseRebuildResult {
    this.initialize(vaultPath);
    const scanned = scanMarkdownPages(vaultPath);
    const rebuiltAt = new Date().toISOString();
    const totalUnits = Math.max(1, (scanned.pages.length * 2) + 1);
    let completedUnits = 0;
    reportRebuildProgress(callbacks, completedUnits, totalUnits);
    const db = openVaultDatabase(vaultPath);
    try {
      transaction(db, () => {
        clearRebuildableRows(db);
        const insertVaultFile = db.prepare(`
          INSERT INTO vault_files(path, page_id, file_type, size_bytes, mtime_ms)
          VALUES (?, ?, 'markdown_page', ?, ?)
        `);
        const insertPage = db.prepare(`
          INSERT INTO pages(
            page_id, page_type, status, title, page_path, language, created_at, updated_at, source_ids_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertPageFts = db.prepare("INSERT INTO pages_fts(page_id, title, body, grams) VALUES (?, ?, ?, ?)");
        const insertSource = db.prepare(`
          INSERT OR IGNORE INTO sources(source_id, page_id, created_at, updated_at)
          VALUES (?, ?, ?, ?)
        `);
        const signatures = new Map<string, PageSignature>();

        for (const page of scanned.pages) {
          const stablePage = readStableIndexedBody(page);
          const signature = stablePage.signature;
          const safeBody = stablePage.body;
          const grams = createCjkSearchAugmentation(`${page.summary.title}\n${safeBody}`);
          insertVaultFile.run(page.summary.pagePath, page.summary.pageId, signature.sizeBytes, signature.mtimeMs);
          insertPage.run(
            page.summary.pageId,
            page.summary.pageType,
            page.summary.status,
            page.summary.title,
            page.summary.pagePath,
            page.summary.language ?? null,
            page.summary.createdAt,
            page.summary.updatedAt,
            JSON.stringify(page.summary.sourceIds)
          );
          insertPageFts.run(page.summary.pageId, page.summary.title, safeBody, grams);
          for (const sourceId of page.summary.sourceIds) {
            insertSource.run(sourceId, page.summary.pageId, page.summary.createdAt, page.summary.updatedAt);
          }
          signatures.set(page.summary.pageId, signature);
          completedUnits += 1;
          reportRebuildProgress(callbacks, completedUnits, totalUnits);
        }

        indexPageKnowledge(db, scanned.pages);
        indexPageLinks(db, scanned.pages, signatures, () => {
          completedUnits += 1;
          reportRebuildProgress(callbacks, completedUnits, totalUnits);
        });
        db.prepare(
          "INSERT OR REPLACE INTO index_state(id, invalid_page_count, rebuilt_at) VALUES (1, ?, ?)"
        ).run(scanned.invalidPageCount, rebuiltAt);
      });
      db.exec(`PRAGMA user_version = ${CURRENT_INDEX_REVISION}`);
    } finally {
      db.close();
    }
    const state = createSchemaState("node_sqlite", 1, [INITIAL_MIGRATION_ID]);
    writeSchemaState(vaultPath, state);
    completedUnits = totalUnits;
    reportRebuildProgress(callbacks, completedUnits, totalUnits);
    return { rebuiltAt, pageCount: scanned.pages.length, invalidPageCount: scanned.invalidPageCount };
  }

  listPages(vaultPath: string, request: LibraryListRequest = {}): LocalDatabasePageList | undefined {
    if (!this.ensureReady(vaultPath)) return undefined;
    const db = openVaultDatabase(vaultPath);
    try {
      const pageTypes = sanitizePageTypes(request.pageTypes);
      const where = pageTypeWhereSql(pageTypes);
      const params = pageTypes as SQLInputValue[];
      const total = readCount(db, `SELECT COUNT(*) AS count FROM pages ${where.sql}`, params);
      const limit = clampLimit(request.limit, DEFAULT_LIBRARY_LIMIT, MAX_LIBRARY_LIMIT);
      const rows = db.prepare(
        `SELECT * FROM pages ${where.sql} ORDER BY updated_at DESC, page_path ASC LIMIT ?`
      ).all(...params, limit);
      return {
        total,
        invalidPageCount: readInvalidPageCount(db),
        pages: rows.map(rowToSummary)
      };
    } finally {
      db.close();
    }
  }

  relatedPages(vaultPath: string, request: LibraryRelatedRequest): LocalDatabaseRelatedPages | undefined {
    if (!this.ensureReady(vaultPath)) return undefined;
    const limit = clampLimit(request.limit, DEFAULT_RELATED_LIMIT, MAX_RELATED_LIMIT);
    const db = openVaultDatabase(vaultPath);
    try {
      if (!pageExists(db, request.pageId)) return undefined;
      const outgoingRows = db.prepare(
        `
          SELECT p.*, MIN(l.target) AS target
          FROM links l
          JOIN pages p ON p.page_id = l.to_page_id
          WHERE l.from_page_id = ?
          GROUP BY p.page_id
          ORDER BY p.updated_at DESC, p.page_path ASC
          LIMIT ?
        `
      ).all(request.pageId, limit);
      const backlinkRows = db.prepare(
        `
          SELECT p.*, MIN(l.target) AS target
          FROM backlinks b
          JOIN pages p ON p.page_id = b.from_page_id
          LEFT JOIN links l ON l.from_page_id = b.from_page_id AND l.to_page_id = b.to_page_id
          WHERE b.to_page_id = ?
          GROUP BY p.page_id
          ORDER BY p.updated_at DESC, p.page_path ASC
          LIMIT ?
        `
      ).all(request.pageId, limit);

      return {
        totalOutgoing: readCount(
          db,
          "SELECT COUNT(DISTINCT to_page_id) AS count FROM links WHERE from_page_id = ? AND to_page_id IS NOT NULL",
          [request.pageId]
        ),
        totalBacklinks: readCount(db, "SELECT COUNT(*) AS count FROM backlinks WHERE to_page_id = ?", [request.pageId]),
        invalidPageCount: readInvalidPageCount(db),
        outgoing: outgoingRows.map((row) => rowToRelatedPage(row, "outgoing")),
        backlinks: backlinkRows.map((row) => rowToRelatedPage(row, "backlink"))
      };
    } finally {
      db.close();
    }
  }

  knowledgeTree(vaultPath: string): KnowledgeTreeSnapshot | undefined {
    if (!this.ensureReady(vaultPath)) return undefined;
    const db = openVaultDatabase(vaultPath);
    try {
      const pages = db.prepare("SELECT * FROM pages ORDER BY title ASC, page_id ASC").all().map(rowToSummary);
      const relations = db.prepare(`
        SELECT from_page_id, to_page_id, relation_type
        FROM relation_edges
        WHERE relation_type IN ('has_topic', 'links_to')
          AND from_page_id IS NOT NULL
          AND to_page_id IS NOT NULL
        ORDER BY relation_type ASC, from_page_id ASC, to_page_id ASC
      `).all().map(rowToKnowledgeTreeRelation);
      return buildKnowledgeTreeSnapshot(pages, relations, readInvalidPageCount(db));
    } finally {
      db.close();
    }
  }

  searchPages(vaultPath: string, request: RetrievalSearchRequest): LocalDatabaseSearchResult | undefined {
    if (!this.ensureReady(vaultPath)) return undefined;
    const terms = createQueryTerms(request.query);
    const ftsQuery = createFtsQuery(terms.normalizedQuery, terms.terms);
    if (!ftsQuery) return { total: 0, invalidPageCount: 0, results: [] };

    const db = openVaultDatabase(vaultPath);
    try {
      const pageTypes = sanitizePageTypes(request.pageTypes);
      const where = pageTypeWhereSql(pageTypes, "p");
      const params = [ftsQuery, ...(pageTypes as SQLInputValue[])];
      const countSql = `
        SELECT COUNT(*) AS count
        FROM pages_fts
        JOIN pages p ON p.page_id = pages_fts.page_id
        WHERE pages_fts MATCH ? ${where.andSql}
      `;
      const rows = db.prepare(
        `
          SELECT
            p.*,
            snippet(pages_fts, 2, '', '', '...', 32) AS snippet,
            bm25(pages_fts, 8.0, 3.0, 1.0, 0.5) AS rank
          FROM pages_fts
          JOIN pages p ON p.page_id = pages_fts.page_id
          WHERE pages_fts MATCH ? ${where.andSql}
          ORDER BY rank ASC, p.updated_at DESC
          LIMIT ?
        `
      ).all(...params, clampLimit(request.limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT));

      return {
        total: readCount(db, countSql, params),
        invalidPageCount: readInvalidPageCount(db),
        results: rows.map((row) => rowToSearchResult(row, terms))
      };
    } finally {
      db.close();
    }
  }

  private ensureReady(vaultPath: string): boolean {
    try {
      const status = this.status(vaultPath);
      if (status.status !== "ready") this.initialize(vaultPath);
      if (this.needsRebuild(vaultPath)) this.rebuild(vaultPath);
      return this.status(vaultPath).status === "ready";
    } catch {
      return false;
    }
  }

  private needsRebuild(vaultPath: string): boolean {
    const scanned = scanMarkdownPages(vaultPath);
    const db = openVaultDatabase(vaultPath);
    try {
      migrate(db);
      const indexRevision = toNumber(db.prepare("PRAGMA user_version").all()[0]?.user_version);
      if (indexRevision !== CURRENT_INDEX_REVISION) return true;
      const stateRows = db.prepare("SELECT invalid_page_count FROM index_state WHERE id = 1").all();
      if (stateRows.length === 0) return true;
      const invalidPageCount = toNumber(stateRows[0]?.invalid_page_count);
      if (invalidPageCount !== scanned.invalidPageCount) return true;

      const rows = db.prepare(
        "SELECT path, page_id, size_bytes, mtime_ms FROM vault_files WHERE file_type = 'markdown_page'"
      ).all();
      if (rows.length !== scanned.pages.length) return true;

      const stored = new Map(rows.map((row) => [String(row.path), row]));
      for (const page of scanned.pages) {
        const row = stored.get(page.summary.pagePath);
        if (!row || String(row.page_id) !== page.summary.pageId) return true;
        const signature = getPageSignature(page);
        if (toNumber(row.size_bytes) !== signature.sizeBytes || toNumber(row.mtime_ms) !== signature.mtimeMs) {
          return true;
        }
      }
      return false;
    } finally {
      db.close();
    }
  }
}

export class LocalDatabaseService {
  readonly #backgroundRebuilder: LocalDatabaseRebuildPort | undefined;
  readonly #driver: LocalDatabaseDriver;

  constructor(
    driver: LocalDatabaseDriver = new NodeSqliteDriver(),
    backgroundRebuilder?: LocalDatabaseRebuildPort
  ) {
    this.#driver = driver;
    this.#backgroundRebuilder = backgroundRebuilder;
  }

  initialize(vaultPath: string): LocalDatabaseStatus {
    this.#driver.initialize(vaultPath);
    return this.#driver.status(vaultPath);
  }

  status(vaultPath: string): LocalDatabaseStatus {
    return this.#driver.status(vaultPath);
  }

  rebuild(vaultPath: string): LocalDatabaseRebuildResult | undefined {
    return this.#driver.rebuild(vaultPath);
  }

  rebuildInWorker(
    vaultPath: string,
    options: LocalDatabaseRebuildExecutionOptions = {}
  ): Promise<LocalDatabaseRebuildResult> {
    if (!this.#backgroundRebuilder) {
      return Promise.reject(new PigeDomainError(
        "database.index_rebuild.worker_failed",
        LOCAL_DATABASE_REBUILD_ERROR_MESSAGES["database.index_rebuild.worker_failed"]
      ));
    }
    return this.#backgroundRebuilder.rebuild(vaultPath, options);
  }

  listPages(vaultPath: string, request?: LibraryListRequest): LocalDatabasePageList | undefined {
    return this.#driver.listPages(vaultPath, request);
  }

  searchPages(vaultPath: string, request: RetrievalSearchRequest): LocalDatabaseSearchResult | undefined {
    return this.#driver.searchPages(vaultPath, request);
  }

  relatedPages(vaultPath: string, request: LibraryRelatedRequest): LocalDatabaseRelatedPages | undefined {
    return this.#driver.relatedPages(vaultPath, request);
  }

  knowledgeTree(vaultPath: string): KnowledgeTreeSnapshot | undefined {
    return this.#driver.knowledgeTree(vaultPath);
  }
}

export function createEmptySchemaState(): LocalDatabaseSchemaState {
  return createSchemaState("pending_sqlite_driver", 0, []);
}

function createSchemaState(
  driver: LocalDatabaseSchemaState["driver"],
  appSchemaVersion: number,
  appliedMigrations: readonly string[]
): LocalDatabaseSchemaState {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    driver,
    appSchemaVersion,
    appliedMigrations: appliedMigrations.map((id) => ({ id, appliedAt: now })),
    updatedAt: now
  };
}

function readSchemaState(vaultPath: string): LocalDatabaseSchemaState | undefined {
  const statePath = getSchemaStatePath(vaultPath);
  if (!fs.existsSync(statePath)) return undefined;
  return LocalDatabaseSchemaStateSchema.parse(JSON.parse(fs.readFileSync(statePath, "utf8")));
}

function writeSchemaState(vaultPath: string, state: LocalDatabaseSchemaState): void {
  const statePath = getSchemaStatePath(vaultPath);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(LocalDatabaseSchemaStateSchema.parse(state), null, 2)}\n`, "utf8");
}

function getSchemaStatePath(vaultPath: string): string {
  return path.join(vaultPath, ".pige/db/schema-state.json");
}

function getDatabasePath(vaultPath: string): string {
  return path.join(vaultPath, ".pige/db/vault.sqlite");
}

const INITIAL_MIGRATION_ID = "001_node_sqlite_initial_index";
const CURRENT_INDEX_REVISION = 2;
const DEFAULT_LIBRARY_LIMIT = 50;
const MAX_LIBRARY_LIMIT = 200;
const DEFAULT_SEARCH_LIMIT = 8;
const MAX_SEARCH_LIMIT = 20;
const DEFAULT_RELATED_LIMIT = 12;
const MAX_RELATED_LIMIT = 50;
const MAX_INDEXED_BODY_CHARS = 500_000;
const REBUILD_PROGRESS_INTERVAL = 100;

function openVaultDatabase(vaultPath: string): DatabaseSync {
  const databasePath = getDatabasePath(vaultPath);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath, {
    timeout: 5000,
    enableForeignKeyConstraints: true,
    allowExtension: false
  });
  configureDatabase(db);
  return db;
}

function configureDatabase(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA temp_store = MEMORY;
  `);
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = db.prepare("SELECT id FROM schema_migrations WHERE id = ?").all(INITIAL_MIGRATION_ID);
  if (applied.length > 0) return;

  transaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS vault_files (
        path TEXT PRIMARY KEY,
        page_id TEXT,
        file_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pages (
        page_id TEXT PRIMARY KEY,
        page_type TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        page_path TEXT NOT NULL UNIQUE,
        language TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        source_ids_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sources (
        source_id TEXT PRIMARY KEY,
        page_id TEXT,
        display_name TEXT,
        canonical_url TEXT,
        checksum TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tags (
        tag TEXT PRIMARY KEY
      );

      CREATE TABLE IF NOT EXISTS page_tags (
        page_id TEXT NOT NULL REFERENCES pages(page_id) ON DELETE CASCADE,
        tag TEXT NOT NULL REFERENCES tags(tag) ON DELETE CASCADE,
        PRIMARY KEY(page_id, tag)
      );

      CREATE TABLE IF NOT EXISTS topics (
        topic_id TEXT PRIMARY KEY,
        page_id TEXT REFERENCES pages(page_id) ON DELETE SET NULL,
        title TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS entities (
        entity_id TEXT PRIMARY KEY,
        page_id TEXT REFERENCES pages(page_id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        aliases_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS relation_edges (
        edge_id TEXT PRIMARY KEY,
        from_page_id TEXT,
        to_page_id TEXT,
        relation_type TEXT NOT NULL,
        evidence_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS links (
        from_page_id TEXT NOT NULL,
        to_page_id TEXT,
        target TEXT NOT NULL,
        PRIMARY KEY(from_page_id, target)
      );

      CREATE TABLE IF NOT EXISTS backlinks (
        to_page_id TEXT NOT NULL,
        from_page_id TEXT NOT NULL,
        PRIMARY KEY(to_page_id, from_page_id)
      );

      CREATE TABLE IF NOT EXISTS citations (
        citation_id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL,
        source_id TEXT,
        locator TEXT
      );

      CREATE TABLE IF NOT EXISTS chunks (
        chunk_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        owner_type TEXT NOT NULL,
        text_hash TEXT NOT NULL,
        token_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS jobs_index (
        job_id TEXT PRIMARY KEY,
        job_type TEXT NOT NULL,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_index (
        memory_id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        text_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS operations_index (
        operation_id TEXT PRIMARY KEY,
        operation_type TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS index_state (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        invalid_page_count INTEGER NOT NULL,
        rebuilt_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS pages_updated_at_idx ON pages(updated_at DESC);
      CREATE INDEX IF NOT EXISTS pages_page_type_idx ON pages(page_type);
      CREATE INDEX IF NOT EXISTS vault_files_page_id_idx ON vault_files(page_id);
    `);
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(page_id UNINDEXED, title, body, grams)");
    db.prepare("INSERT INTO schema_migrations(id, applied_at) VALUES (?, ?)").run(
      INITIAL_MIGRATION_ID,
      new Date().toISOString()
    );
    db.exec("PRAGMA user_version = 1");
  });
}

function transaction(db: DatabaseSync, work: () => void): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    work();
    db.exec("COMMIT");
  } catch (caught) {
    db.exec("ROLLBACK");
    throw caught;
  }
}

function clearRebuildableRows(db: DatabaseSync): void {
  db.exec(`
    DELETE FROM pages_fts;
    DELETE FROM page_tags;
    DELETE FROM tags;
    DELETE FROM topics;
    DELETE FROM entities;
    DELETE FROM relation_edges;
    DELETE FROM links;
    DELETE FROM backlinks;
    DELETE FROM citations;
    DELETE FROM chunks;
    DELETE FROM sources;
    DELETE FROM pages;
    DELETE FROM vault_files;
  `);
}

function indexPageKnowledge(db: DatabaseSync, pages: readonly MarkdownPageRecord[]): void {
  const pageById = new Map(pages.map((page) => [page.summary.pageId, page]));
  const lookup = createPageLookup(pages);
  const insertTopic = db.prepare(`
    INSERT OR REPLACE INTO topics(topic_id, page_id, title)
    VALUES (?, ?, ?)
  `);
  const insertRelation = db.prepare(`
    INSERT OR IGNORE INTO relation_edges(edge_id, from_page_id, to_page_id, relation_type, evidence_json)
    VALUES (?, ?, ?, 'has_topic', ?)
  `);

  for (const page of pages) {
    if (page.summary.pageType === "topic") {
      insertTopic.run(page.summary.pageId, page.summary.pageId, page.summary.title);
    }
  }

  for (const page of pages) {
    for (const topicRef of page.knowledge.topics) {
      const targetId = lookup.get(normalizeLinkTarget(topicRef));
      const target = targetId ? pageById.get(targetId) : undefined;
      if (!target || target.summary.pageType !== "topic" || target.summary.pageId === page.summary.pageId) continue;
      insertRelation.run(
        createRelationEdgeId("has_topic", page.summary.pageId, target.summary.pageId, target.summary.pageId),
        page.summary.pageId,
        target.summary.pageId,
        JSON.stringify([{ source: "frontmatter", field: "topics", target: topicRef }])
      );
    }
  }
}

function indexPageLinks(
  db: DatabaseSync,
  pages: readonly MarkdownPageRecord[],
  expectedSignatures: ReadonlyMap<string, PageSignature>,
  onPageIndexed: () => void
): void {
  const lookup = createPageLookup(pages);
  const insertLink = db.prepare("INSERT OR IGNORE INTO links(from_page_id, to_page_id, target) VALUES (?, ?, ?)");
  const insertBacklink = db.prepare("INSERT OR IGNORE INTO backlinks(to_page_id, from_page_id) VALUES (?, ?)");
  const insertRelation = db.prepare(`
    INSERT OR IGNORE INTO relation_edges(edge_id, from_page_id, to_page_id, relation_type, evidence_json)
    VALUES (?, ?, ?, 'links_to', ?)
  `);

  for (const page of pages) {
    const expectedSignature = expectedSignatures.get(page.summary.pageId);
    if (!expectedSignature) throw new Error("Indexed page signature is missing during link rebuild.");
    const body = readStableIndexedBody(page, expectedSignature).body;
    for (const link of extractPigeMarkdownLinkRefs(body)) {
      const resolvedPageId = resolveLinkedPageId(lookup, page.summary.pagePath, link);
      insertLink.run(page.summary.pageId, resolvedPageId, link.target);
      if (resolvedPageId) {
        insertBacklink.run(resolvedPageId, page.summary.pageId);
        insertRelation.run(
          createRelationEdgeId("links_to", page.summary.pageId, resolvedPageId, link.target),
          page.summary.pageId,
          resolvedPageId,
          JSON.stringify([{ source: link.kind, target: link.target, label: link.label }])
        );
      }
    }
    onPageIndexed();
  }
}

function createPageLookup(pages: readonly MarkdownPageRecord[]): Map<string, string> {
  const lookup = new Map<string, string>();
  const sortedPages = [...pages].sort((left, right) => {
    const leftPath = left.summary.pagePath.normalize("NFKC").toLocaleLowerCase("en-US");
    const rightPath = right.summary.pagePath.normalize("NFKC").toLocaleLowerCase("en-US");
    if (leftPath !== rightPath) return leftPath < rightPath ? -1 : 1;
    return left.summary.pageId < right.summary.pageId ? -1 : left.summary.pageId > right.summary.pageId ? 1 : 0;
  });
  for (const page of sortedPages) {
    const keys = [
      page.summary.pageId,
      page.summary.title,
      ...page.knowledge.aliases,
      page.summary.pagePath,
      page.summary.pagePath.replace(/\.md$/iu, ""),
      path.basename(page.summary.pagePath),
      path.basename(page.summary.pagePath).replace(/\.md$/iu, "")
    ];
    for (const key of keys) {
      const normalized = normalizeLinkTarget(key);
      if (normalized && !lookup.has(normalized)) lookup.set(normalized, page.summary.pageId);
    }
  }
  return lookup;
}

function resolveLinkedPageId(
  lookup: ReadonlyMap<string, string>,
  fromPagePath: string,
  link: PigeMarkdownLinkRef
): string | null {
  for (const target of createLinkTargetCandidates(fromPagePath, link)) {
    const pageId = lookup.get(normalizeLinkTarget(target));
    if (pageId) return pageId;
  }
  return null;
}

function createLinkTargetCandidates(fromPagePath: string, link: PigeMarkdownLinkRef): readonly string[] {
  const candidates = new Set<string>([link.target]);
  if (link.kind === "markdown_link") {
    const targetPath = link.target.split("#", 1)[0]?.replace(/\\/gu, "/") ?? "";
    if (targetPath.endsWith(".md")) {
      const fromDirectory = path.posix.dirname(fromPagePath.replace(/\\/gu, "/"));
      candidates.add(path.posix.normalize(path.posix.join(fromDirectory, targetPath)));
    }
  }
  return Array.from(candidates);
}

function hasInitialMigration(vaultPath: string): boolean {
  if (!fs.existsSync(getDatabasePath(vaultPath))) return false;
  const db = openVaultDatabase(vaultPath);
  try {
    migrate(db);
    return db.prepare("SELECT id FROM schema_migrations WHERE id = ?").all(INITIAL_MIGRATION_ID).length === 1;
  } finally {
    db.close();
  }
}

interface PageSignature {
  readonly sizeBytes: number;
  readonly mtimeMs: number;
}

function getPageSignature(page: MarkdownPageRecord): PageSignature {
  const stat = fs.statSync(page.absolutePath);
  return { sizeBytes: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
}

function readStableIndexedBody(page: MarkdownPageRecord, expected?: PageSignature): {
  readonly body: string;
  readonly signature: PageSignature;
} {
  const before = getPageSignature(page);
  if (expected && !samePageSignature(before, expected)) {
    throw new Error("Markdown changed while the local index was rebuilding.");
  }
  const body = sanitizeSearchBody(readMarkdownPageBody(page.absolutePath)).slice(0, MAX_INDEXED_BODY_CHARS);
  const after = getPageSignature(page);
  if (!samePageSignature(before, after)) {
    throw new Error("Markdown changed while the local index was rebuilding.");
  }
  return { body, signature: after };
}

function samePageSignature(left: PageSignature, right: PageSignature): boolean {
  return left.sizeBytes === right.sizeBytes && left.mtimeMs === right.mtimeMs;
}

function reportRebuildProgress(
  callbacks: LocalDatabaseRebuildCallbacks,
  completedUnits: number,
  totalUnits: number
): void {
  if (
    completedUnits !== 0 &&
    completedUnits !== totalUnits &&
    totalUnits > REBUILD_PROGRESS_INTERVAL &&
    completedUnits % REBUILD_PROGRESS_INTERVAL !== 0
  ) {
    return;
  }
  callbacks.onProgress?.({ completedUnits, totalUnits, unit: "index_item" });
}

function sanitizePageTypes(pageTypes: readonly MarkdownPageType[] | undefined): readonly MarkdownPageType[] {
  return Array.from(new Set(pageTypes ?? []));
}

function pageTypeWhereSql(
  pageTypes: readonly MarkdownPageType[],
  tableAlias?: string
): { readonly sql: string; readonly andSql: string } {
  if (pageTypes.length === 0) return { sql: "", andSql: "" };
  const prefix = tableAlias ? `${tableAlias}.` : "";
  const placeholders = pageTypes.map(() => "?").join(", ");
  return {
    sql: `WHERE ${prefix}page_type IN (${placeholders})`,
    andSql: `AND ${prefix}page_type IN (${placeholders})`
  };
}

function readCount(db: DatabaseSync, sql: string, params: readonly SQLInputValue[]): number {
  const row = db.prepare(sql).all(...params)[0];
  return toNumber(row?.count);
}

function readInvalidPageCount(db: DatabaseSync): number {
  const row = db.prepare("SELECT invalid_page_count FROM index_state WHERE id = 1").all()[0];
  return toNumber(row?.invalid_page_count);
}

function rowToSummary(row: Record<string, unknown>): LibraryPageSummary {
  const language = typeof row.language === "string" && row.language.length > 0 ? row.language : undefined;
  return {
    pageId: String(row.page_id),
    title: String(row.title),
    pageType: String(row.page_type) as MarkdownPageType,
    status: String(row.status) as LibraryPageSummary["status"],
    pagePath: String(row.page_path),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(language ? { language } : {}),
    sourceIds: parseSourceIds(row.source_ids_json)
  };
}

function rowToKnowledgeTreeRelation(row: Record<string, unknown>): KnowledgeTreeRelationInput {
  return {
    fromPageId: String(row.from_page_id),
    toPageId: String(row.to_page_id),
    relationType: String(row.relation_type) as KnowledgeTreeRelationInput["relationType"]
  };
}

function rowToSearchResult(row: Record<string, unknown>, query: QueryTerms): RetrievalSearchResultItem {
  const summary = rowToSummary(row);
  const snippet = String(row.snippet ?? "").trim();
  const rank = toNumber(row.rank);
  return {
    summary,
    score: Number(Math.max(0.001, Math.abs(rank) * 100000).toFixed(3)),
    snippets: [snippet || summary.title],
    matchReasons: inferMatchReasons(summary, snippet, query)
  };
}

function rowToRelatedPage(row: Record<string, unknown>, relation: LibraryRelatedPage["relation"]): LibraryRelatedPage {
  return {
    summary: rowToSummary(row),
    relation,
    target: String(row.target ?? "")
  };
}

function parseSourceIds(value: unknown): readonly string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function inferMatchReasons(summary: LibraryPageSummary, snippet: string, query: QueryTerms): readonly string[] {
  const reasons = new Set<string>();
  const title = normalizeSearchText(summary.title);
  const body = normalizeSearchText(snippet);
  const needles = [query.normalizedQuery, ...query.terms].filter((term) => term.length > 0);
  if (needles.some((term) => title.includes(term))) reasons.add("title");
  if (needles.some((term) => body.includes(term))) reasons.add("body");
  if (reasons.size === 0) reasons.add("body");
  return Array.from(reasons);
}

function createFtsQuery(normalizedQuery: string, terms: readonly string[]): string {
  const candidates = [normalizedQuery, ...terms]
    .map((term) => term.trim())
    .filter((term, index, values) => term.length >= 2 && values.indexOf(term) === index)
    .slice(0, 24);
  return candidates.map((term) => `"${term.replace(/"/gu, "\"\"")}"`).join(" OR ");
}

function pageExists(db: DatabaseSync, pageId: string): boolean {
  return db.prepare("SELECT page_id FROM pages WHERE page_id = ?").all(pageId).length > 0;
}

function createRelationEdgeId(
  relationType: KnowledgeTreeRelationInput["relationType"],
  fromPageId: string,
  toPageId: string,
  target: string
): string {
  return `edge_${stableHash(`${relationType}:${fromPageId}:${toPageId}:${target}`).slice(0, 24)}`;
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeLinkTarget(value: string): string {
  const withoutAnchor = value.split("#", 1)[0] ?? value;
  return withoutAnchor
    .replace(/\\/gu, "/")
    .replace(/^\.?\//u, "")
    .replace(/\.md$/iu, "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  if (!limit) return fallback;
  return Math.max(1, Math.min(max, Math.floor(limit)));
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
