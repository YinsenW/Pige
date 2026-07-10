# Local Database Design

Status: Draft baseline
Date: 2026-07-09

## 1. Decision

Pige should use a local SQLite database, but the database must not become the source of truth for user knowledge.

Recommended v0.1 choice:

- Database engine: SQLite.
- Initial Node/Electron driver: Node `node:sqlite`, using the SQLite build bundled with the pinned Electron/Node runtime.
- Fallback driver candidate: `better-sqlite3` if platform smoke tests reject `node:sqlite` for v0.1.
- Access pattern: main process or dedicated database worker only, never renderer direct access.
- Abstraction: `LocalDatabaseDriver` interface so Pige can switch between `node:sqlite`, `better-sqlite3`, or another SQLite driver later.
- Source of truth: Markdown knowledge files, source records/source assets, extracted artifacts, Agent memory text, proposals, operation summaries, and vault config files.
- Database role: indexing, search, job acceleration, metadata joins, caches, and local app state.

## 2. Why A Database Is Still Needed

Markdown is excellent for ownership, portability, inspectability, and long-term durability. It is not ideal for every runtime query.

Pige benefits from a database for:

- Fast library lists and filters.
- Search indexes and FTS.
- Link graph queries.
- Tag/entity/topic joins.
- Job state lookup and progress views.
- Source-to-note relationships.
- Chunk metadata for RAG.
- Memory recall indexes.
- Deduplication hashes and path manifests.
- Rebuild status, schema versions, and migration tracking.

The database should make Pige feel fast. It should not be required to understand or recover the user's knowledge.

## 3. Source Of Truth Rules

Durable truth:

- `raw/`: managed source copies when `managedCopyRoot` uses its in-vault default.
- `.pige/source-records/`: source records for managed copies or verified original references; pasted text and downloaded snapshots necessarily use managed copies.
- `artifacts/`: extracted text, OCR, rendered pages, and extracted media under `<knowledgeRoot>/artifacts` in v0.1, independent of `managedCopyRoot`.
- `sources/`: Markdown source pages.
- `wiki/`: compiled Markdown knowledge pages.
- `.pige/memory/`: vault-scoped Agent memory as inspectable text.
- `.pige/proposals/`: pending confirmation proposals.
- `.pige/operations/`: durable operation summaries.
- `PIGE.md`, `index.md`, `log.md`, and `.pige/config.json`.

Derived database state:

- FTS tables.
- Vector/chunk metadata.
- Backlink and graph tables.
- Job lookup indexes.
- Library sorting/filtering tables.
- Cached computed summaries.
- Local health and rebuild state.

If the database is deleted, Pige should be able to rebuild it from the durable truth files, except for machine-local preferences that are intentionally not part of the vault.

## 4. Database Scope

Pige should use two scopes.

### 4.1 Vault Database

Location:

```txt
Pige Vault/
  .pige/
    db/
      vault.sqlite
      vault.sqlite-wal
      vault.sqlite-shm
```

Purpose:

- Vault manifest indexes.
- Note/source metadata.
- Link graph.
- FTS.
- RAG chunk metadata.
- Memory indexes.
- Job lookup acceleration.
- Rebuild status.

Backup policy:

- Excluded by default because it is rebuildable.
- May be included as an optional fast-restore cache later.
- Restore must work without it.

### 4.2 Machine-Local App Database

Location:

```txt
OS app data/
  Pige/
    app.sqlite
```

Purpose:

- Recent vault list.
- Window preferences.
- Installed-package inventory and its machine-local operation metadata.
- Local tool status.
- Non-secret provider profile metadata.
- App-level migration state.

Backup policy:

- `app.sqlite` is outside vault backup sets; portability is available only through an
  explicit settings export governed by `docs/DATA_ARCHITECTURE.md`.
- Exportable only through an explicit settings export.
- Must never contain API keys or tokens.

## 5. Driver Choice

### 5.1 Why `node:sqlite` First

Pige's initial Phase 4 implementation uses Node `node:sqlite` because:

- The repository pins Node 24 and Electron 43, so the runtime module is available in the controlled development and desktop runtime.
- It removes an immediate native npm module rebuild/signing/notarization risk from the first SQLite slice.
- It supports the simple synchronous access pattern needed by the current main-process repository layer.
- It can create SQLite FTS5 tables in the current runtime, which is enough for the first DB-backed Library and lexical retrieval slice.
- It keeps the installer smaller and the dependency manifest simpler while the database schema and service boundaries are still stabilizing.

### 5.2 Risks

The main risks are API maturity and runtime coupling:

- `node:sqlite` is still experimental in Node 24.
- Pige depends on the SQLite build bundled with the selected Electron/Node runtime.
- Vector extension behavior remains unproven and is not part of this initial driver decision.
- The current Phase 4 rebuild path creates a durable `index_rebuild` job before running the rebuild body, but the execution body is still synchronous and suitable only for the foundation slice. Large rebuilds must move to worker execution before the 10,000-page performance gate.

Mitigations:

- Keep database access behind `LocalDatabaseDriver`.
- Pin Electron/Node versions per release.
- Add platform smoke tests that open the database, run migrations, insert rows, run FTS queries, and close cleanly.
- Keep `better-sqlite3` as the fallback driver candidate if `node:sqlite` stability, packaging, or performance fails.
- Keep vector search behind a separate `VectorIndexDriver` and do not load arbitrary SQLite extensions.

### 5.3 Why Keep `better-sqlite3` As A Fallback

`better-sqlite3` remains a credible fallback because:

- It is mature and widely used.
- It has strong local desktop performance characteristics.
- It supports transactions, WAL mode, virtual tables, extensions, and worker-thread usage.
- It may become preferable if `node:sqlite` experimental status blocks release confidence.

Adopting `better-sqlite3` would require native-module rebuild, signing/notarization, Windows packaging, dependency manifest, and smoke-test updates.

## 6. SQLite Configuration

Recommended defaults:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;
```

Rules:

- Use migrations with `PRAGMA user_version` or a dedicated `schema_migrations` table.
- Store app schema version separately from vault schema version.
- Keep long-running index rebuilds outside the UI thread.
- Prefer transactions for ingest and index updates.
- Treat database corruption as recoverable: preserve files, rebuild database.
- Do not load arbitrary SQLite extensions from packages or source content.

## 7. Vector And FTS Strategy

v0.1:

- Use SQLite FTS5 for lexical search when available through the chosen driver/runtime.
- Store chunk metadata and embedding references in SQLite.
- Store vector data in a controlled local index format or SQLite-backed table depending on runtime validation.
- Evaluate `sqlite-vec` only after packaging, performance, and extension-loading safety are proven.

The vector store is a derived cache. It can be rebuilt from Markdown, source pages, artifacts, memory text, and local embedding model output.

## 8. Schema Areas

Initial schema areas:

- `vault_files`: path, hash, mtime, type, page ID.
- `pages`: page ID, type, title, aliases, tags, source refs.
- `sources`: source ID, source asset path/reference, artifact paths, canonical URL, checksum.
- `tags` and `page_tags`: canonical tags and page-to-tag joins.
- `topics`: topic page references and confirmed parent/child links.
- `entities`: entity records, aliases, identifiers, and page references.
- `relation_edges`: normalized relationship edges from Markdown, citations, frontmatter, managed sections, and operation records.
- `links` and `backlinks`: wiki link and reverse-link indexes.
- `citations`: page-to-source locator references.
- `chunks`: page/source/memory chunk metadata.
- `fts_*`: full-text search virtual tables.
- `jobs_index`: fast lookup over `.pige/jobs/`.
- `memory_index`: fast lookup over `.pige/memory/`.
- `operations_index`: fast lookup over `.pige/operations/`.
- `schema_migrations`: local database migration state.

Durable records still live in files. Database rows point to those files and make them fast to query.

`docs/KNOWLEDGE_MODEL_AND_LINKING.md` is the authority for tag semantics, relationship types, graph rebuild behavior, and Knowledge Tree aggregates.

## 9. User-Facing Behavior

The database should mostly be invisible.

Visible states:

- Indexing.
- Rebuilding database.
- Database repair needed.
- Search degraded because indexes are missing.
- Reset/rebuild local database.

User controls:

- Rebuild Index.
- Reset Local Database.
- Show storage size.
- Exclude derived database from backup.

## 10. Final Recommendation

Use SQLite with Node `node:sqlite` as the initial v0.1 implementation, behind a small driver abstraction. Keep `better-sqlite3` available as the reviewed fallback driver if release smoke tests reject `node:sqlite`.

Keep this invariant:

> If `.pige/db/vault.sqlite` disappears, Pige may be slower until it rebuilds, but the user's knowledge must still be intact.

Phase 1 implementation note:

- The first implementation introduces `LocalDatabaseDriver` and writes `.pige/db/schema-state.json` with an empty migration list through a `pending_sqlite_driver`.
- This proves reset/rebuild ownership and migration-state shape before adding native SQLite packaging.
- The pending driver is not a substitute for v0.1 SQLite search/indexing. Phase 4 replaces it with `node_sqlite` and updates dependency manifests.

Phase 4 implementation note:

- The initial real driver is `node_sqlite`.
- It creates `.pige/db/vault.sqlite`, migration state, page metadata tables, initial graph/job/source placeholder tables, and `pages_fts` for lexical search.
- It indexes sanitized/redacted Markdown bodies and CJK 2/3-gram augmentation so Chinese, Japanese, and Korean queries do not depend only on whitespace tokenization.
- It parses durable Markdown wiki links and local Markdown links into `links`, `backlinks`, and resolved `relation_edges` rows. Unresolved link targets remain rebuildable graph metadata for future Knowledge Health.
- Library and retrieval use SQLite when ready and fall back to Markdown scanning when the database is unavailable.
- `maintenance.rebuildLocalDatabase` creates an `index_rebuild` job before rebuilding, writes completion/failure state to the job record, and returns the completed job ID with rebuild counts.
- Database deletion is repaired by rebuilding from Markdown. Large-vault rebuilds must move from the current synchronous job runner to a worker-backed job with progress/cancellation before the 10,000-page performance gate is claimed.

## 11. References

Database/runtime sources and replacement policy are registered once in
[`TECH_ARCHITECTURE.md`](TECH_ARCHITECTURE.md#162-local-storage-database-and-indexing).
