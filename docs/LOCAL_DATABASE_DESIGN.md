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
- Source of truth: narrative Markdown, versioned Dataset Bundles, source records/assets,
  durable artifacts, memory, proposals, operations, and vault config files.
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

The internal database should make Pige feel fast. It must not be required to recover the
user's knowledge. A Dataset's `data/collection.sqlite` is a separate documented
application-file format and is durable structured knowledge; none of its rows may be
silently treated as `.pige/db/vault.sqlite` cache rows.

## 3. Source Of Truth Rules

Durable truth:

- `raw/`: managed source copies when `managedCopyRoot` uses its in-vault default.
- `.pige/source-records/`: source records for managed copies or verified original references; pasted text and downloaded snapshots necessarily use managed copies.
- `artifacts/`: extracted text, OCR, rendered pages, and extracted media under `<knowledgeRoot>/artifacts` in v0.1, independent of `managedCopyRoot`.
- `sources/`: Markdown source pages.
- `wiki/`: compiled Markdown knowledge pages.
- `datasets/`: Dataset manifests, schemas, revisions, views, changes, and open payloads.
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

If `.pige/db/vault.sqlite` is deleted, Pige rebuilds it from durable truth without
deleting or rewriting Dataset payloads.

### 3.1 Structured Query Engine Boundary

Dataset access uses a separate query interface. The current managed-collection foundation
has main-process Dataset Query Service validate opaque refs and revision/privacy bindings,
copy the exact payload into a private `0600` snapshot, and send one strict typed plan to a
bounded worker. Only that worker opens the fixed Pige SQLite application schema in
read-only defensive mode with extensions disabled, an authorizer, row/cell/byte/group/
result limits, timeout, and cancellation. Main and renderer receive no SQL or database
handle. DuckDB remains a candidate for later local analytical query over Parquet; no
dependency is selected until licensing, package size, Electron/macOS/Windows, memory,
extension/network behavior, and deterministic smoke tests pass.

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
- Explicit Phase 4 maintenance rebuilds use a dedicated worker; implicit first-query rebuild remains synchronous. The 10,000-page budget, packaged platforms, strict cross-process writer/CAS, and complete crash/stale-worker recovery remain open.

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

- Use SQLite FTS5 for lexical search; store chunk metadata and embedding refs in SQLite.
- Keep vectors in a controlled local index/table. Adopt `sqlite-vec` only after package,
  performance and extension-loading safety proof.

The vector store is a derived cache. It can be rebuilt from Markdown, source pages, artifacts, memory text, and local embedding model output.

## 8. Schema Areas

Initial areas are file/page/source metadata; tag/topic/entity/link/backlink/citation/relation
indexes; FTS and body-free chunk metadata; Job/memory/Operation lookup acceleration; and
migrations. `page_reference_keys` stores normalized stable ID, title, alias, governed path,
and filename/slug candidates for the Main-owned Reader resolver.

Durable truth stays in files. App schema v3/index revision 5 adds
`003_inline_reference_keys` after v2 body-free chunks. Lookup checks revision+rebuild
generation before/after a maximum-two query; exact page ID wins only in a current index.
Main watches `wiki/`, `sources/`, and replacement, with signatures covering missed events.
Dirty/missing/changed state is unavailable until rebuild; watcher state is never truth.
No-follow/named checks reject successors. Keys/results persist no bodies, candidates, or
renderer paths; tags/display remain Markdown-owned rebuildable projections.

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

Current driver, schema, rebuild, locale-search, graph, worker, scale, and platform evidence
live in the Playbook and acceptance manifest. Legacy `pending_sqlite_driver` migration
state remains readable; it never substitutes for the real driver contract above.

## 11. References

Database/runtime sources and replacement policy are registered once in
[`TECH_ARCHITECTURE.md`](TECH_ARCHITECTURE.md#162-local-storage-database-and-indexing).
