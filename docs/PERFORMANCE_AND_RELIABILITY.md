# Performance And Reliability

Status: Draft baseline
Date: 2026-07-09

## 1. Purpose

Pige must feel light enough for daily capture and reliable enough for a 100 GB local knowledge vault.

This document defines:

- Scale targets.
- Latency budgets.
- Memory and CPU budgets.
- Background job behavior.
- Indexing strategy.
- Reliability and crash recovery requirements.
- Test fixtures and acceptance gates.

## 2. Target Workload

v0.1 should be engineered and tested against:

- 10,000 notes and source pages.
- 100 GB vault size.
- 100,000 retrieval chunks.
- 2,000 source files.
- 500 PDFs.
- 200 DOCX/PPTX files.
- 20,000 images or extracted visual assets.
- 1 year of conversation event records.
- 1,000 Agent memory records.
- Multiple installed Skills and curated packages.

These targets are baseline test fixtures. Real-world results depend on machine class, storage speed, OCR workload, and local model availability.

## 3. Product Performance Budgets

### 3.1 User-Perceived Latency

| Flow | Target |
| --- | --- |
| Cold launch to usable compact Home screen | Under 3 seconds after first-run setup |
| Warm launch to usable Home screen | Under 1.5 seconds |
| Capture preservation after submit/drop | Under 500 ms before expensive work, excluding large file copy |
| Typing in compact input | No visible lag, including IME composition |
| Open recent note | Under 500 ms for normal notes |
| Open long note | Show readable shell under 1 second; heavy blocks continue progressively |
| Library list with warm DB and 10,000 pages | Under 1 second initial render |
| Home query lexical first results | Under 2 seconds on warm DB |
| Home query semantic rerank | May continue in background with visible status |
| Eligible Home draft snapshot to visible replacement | Under 250 ms at p95; provider generation time is measured separately |
| Settings open | Under 500 ms |
| Permission dialog display | Immediate after sensitive action request |

Draft-stream rules:

- Record submit-to-first-safe-draft and final-answer latency separately. Provider/network
  time may vary, but Pige's parsed-snapshot-to-render overhead must stay within the table.
- Draft replacement is coalesced and bounded; it must not block typing, duplicate text,
  rerender the whole timeline, or grow memory with every intermediate snapshot.
- Cancellation stops draft delivery promptly. Restart loads no provisional buffer and
  does not spend recovery time replaying it.

### 3.2 Memory Budgets

Targets:

- Idle compact window acceptance: total app-process resident memory below 200 MiB on
  each declared reference platform after a packaged release build opens the compact
  Home against the scale fixture, completes startup work, runs no Job or local model,
  and settles for 60 seconds; record the median of three samples.
- Ordinary active-use acceptance: total app-process resident memory below 1 GiB at the
  95th percentile during the owner-defined 10-minute capture/open/search/read scenario,
  excluding separately measured heavy Jobs. Within 60 seconds after a heavy Job, memory
  must return to no more than 125% of the idle ceiling.
- Heavy transient tasks such as OCR, PDF rendering, embedding rebuild, or backup may exceed ordinary use, but must show progress and release memory afterward.

Rules:

- Do not keep the full vault, full conversation history, full vector index, or all note bodies in renderer memory.
- Library lists must not carry note bodies. Note body and rendered HTML are loaded only for the explicitly opened page.
- Do not load local embedding/reranker models until needed.
- Unload or idle local models after configurable inactivity when memory pressure is detected.
- Use pagination/windowing for lists.
- Use virtualized or chunked rendering for long notes and expensive blocks.
- Keep large OCR/page-render buffers in worker processes, not renderer state.

### 3.3 CPU Budgets

Targets:

- Idle CPU should be near zero.
- File watchers should debounce bursts and avoid repeated full-vault scans.
- Background indexing should yield to active typing, scrolling, capture, and note reading.
- OCR and embedding tasks should limit concurrency by default.

Rules:

- Use job priority levels.
- Pause or slow background work on battery saver or high system load when possible.
- Avoid polling loops when OS file events or persisted job state can be used.
- Batch database writes.
- Avoid recomputing hashes, chunks, embeddings, and thumbnails unless source checksum changed.

### 3.4 Disk Budgets

Installer:

- Core installer target: at most 300,000,000 bytes; the public-alpha hard ceiling is
  330,000,000 bytes for the distributable platform artifact, excluding optional model
  and OCR weights. Exceeding the hard ceiling blocks release until the product and
  release contracts are deliberately revised.
- Local models are not bundled.
- PaddleOCR models, Qwen embedding files, reranker files, and other large assets are downloaded explicitly after user consent.

Vault:

- Source assets and Markdown knowledge files are user-owned durable data.
- Generated artifacts are included by default because they make backup/restore useful.
- Database, indexes, thumbnails, and model files are excluded from vault backup by default.

## 4. Architecture Rules For Responsiveness

Renderer:

- Never performs raw filesystem scans.
- Never opens SQLite directly.
- Never runs OCR, PDF rendering, model inference, backup compression, or full index rebuilds.
- Receives incremental progress and paged data from main/worker services.

Main process:

- Owns permissions, routing, IPC, vault paths, and service orchestration.
- Does not run long CPU-bound tasks inline when they can block IPC responsiveness.

Workers/utility processes:

- Parse large files.
- Run OCR.
- Render PDF pages.
- Build embeddings.
- Rebuild indexes.
- Compress backups.
- Execute permission-scoped Skill/package tools.

Database:

- Use WAL mode.
- Use batched transactions.
- Keep long-running rebuilds resumable.
- Keep query shapes predictable and indexed.

## 5. Job Queue Reliability

`docs/JOB_OPERATION_AND_RECOVERY.md` is the detailed job, proposal, operation, retry, cancellation, and recovery contract. This section defines performance and reliability budgets around that contract.

Every expensive or failure-prone operation should run through the job system.

Canonical job classes, states, and the `state` field are owned by `JobClassSchema`, `JobStateSchema`, and `JobRecordSchema` in `packages/schemas/src/index.ts`, with lifecycle semantics in `docs/JOB_OPERATION_AND_RECOVERY.md`. Reliability code must not translate them into aliases such as `capture_preserve`, `parse_source`, `backup_create`, or `restore_validate`.

`waiting_dependency` is a canonical state for a missing model, tool, runtime capability, vault binding, or external source root. A network backoff within an otherwise runnable job is stage/retry metadata; it must not invent another canonical state. A genuine permission decision uses `waiting_permission`.

Rules:

- Persist job state before work starts.
- Persist step checkpoints for long jobs.
- Jobs must be idempotent or detect already-created outputs by ID/checksum.
- Retry only safe operations automatically.
- Never retry destructive actions without user confirmation.
- Process-local parse/OCR/index work checkpoints progress; parse/OCR/Agent ingest/index rebuild cooperatively cancels. Other classes and cross-process routing remain open.
- Reopening the app resumes queued and retryable jobs.
- Minimal source page generation must not read an entire large managed source just to create a preview. Read a bounded prefix for title/excerpt and keep the complete body in the managed source copy.
- Markdown-scan Library fallback must read only bounded file prefixes for frontmatter. Full page body reads belong to note rendering, search indexing, or explicit open actions, not list queries.

## 6. Priority Model

Priority levels:

1. User interaction: typing, scrolling, opening notes, permission decisions.
2. Capture preservation.
3. Search and note retrieval.
4. Current visible job progress.
5. Ingest and parsing.
6. OCR and embedding.
7. Maintenance, health checks, cleanup, compaction.

Rules:

- A new capture should not wait behind a full index rebuild.
- Search should return lexical results even if semantic index is rebuilding.
- Phase 2/3 Markdown-scan retrieval is a bridge before SQLite/FTS. It must return bounded snippets only and keep full page bodies out of renderer state; Phase 4 indexing owns the 10k-page performance target.
- Explicit Phase 4 rebuild is worker-backed, process-local serialized, cancellable, and bounded by a 15-minute timeout plus 512 MiB V8 old-generation limit; two-pass indexing retains bounded metadata and one capped body. Formal 10k CPU/RSS/latency, incremental/staging-swap, implicit first-query workerization, cross-process locking, crash fencing, and packaged-platform proof remain open.
- OCR and embedding workers should pause or reduce concurrency when the user is actively interacting.

## 7. Indexing Strategy

### 7.1 Incremental Indexing

Pige should maintain dirty sets:

- Dirty files.
- Dirty pages.
- Dirty source artifacts.
- Dirty chunks.
- Dirty embeddings.
- Dirty backlinks.
- Dirty FTS rows.
- Dirty graph rows.

Rules:

- External file changes mark affected objects dirty.
- Dirty work is batched and prioritized.
- Rebuild only what changed.
- Full rebuild is a repair action, not the normal path.

### 7.2 Search Degradation

Search capabilities degrade in layers:

1. Warm SQLite metadata and FTS.
2. Cold SQLite metadata and FTS after quick open.
3. Markdown scan fallback for essential results.
4. Semantic retrieval when embeddings are available.
5. Reranking when installed and fast enough.

User-visible states:

- Indexing.
- Semantic index missing.
- Semantic index rebuilding.
- Search degraded.
- Database repair needed.

## 8. Local RAG Performance

Rules:

- Chunking must be deterministic from durable source spans.
- Embeddings are built incrementally.
- Embedding model loads only when needed.
- Embedding build jobs checkpoint progress.
- Embedding index can be deleted and rebuilt.
- Reranker is optional and not auto-downloaded in v0.1.
- Home knowledge retrieval must remain usable before model download.
- Context assembly must use bounded budget classes from `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`; model calls must not receive the whole vault, full source asset bodies, or unbounded conversation history.

Recommended defaults:

- Batch embeddings.
- Limit embedding concurrency based on CPU/GPU availability.
- Prioritize recently captured and recently opened notes.
- Defer low-value chunks when the user is actively interacting.

## 9. Web, OCR, And Document Parsing Performance

### 9.1 Web Capture

Rules:

- Exact URL fetch/extraction limits and fallback semantics are owned once by
  `docs/PARSER_INGEST_SPEC.md#82-url`; performance fixtures MUST read the same manifest or
  constants and reject an unreviewed increase.
- Fetch remains off the renderer, extraction remains outside the Electron main loop,
  and every worker is terminated before the next queued extraction begins.
- Worker failure or timeout must release the worker and return to a bounded DOM-less fallback so the already fetched source can still be preserved with a reduced-quality warning.
- Raw snapshots and extracted artifacts are reference-based; they are not copied into conversation events, job messages, operation records, prompts beyond the bounded selected artifact, or SQLite indexes as full bodies.
- Browser-rendered capture, parallel web extraction, and unbounded subresource fetching are not v0.1 fallbacks.

### 9.2 OCR And Document Parsing

Rules:

- Exact parser, Office, page-materializer, and native-OCR limits/routing are owned once by
  `docs/PARSER_INGEST_SPEC.md#8-adapter-requirements`; performance fixtures MUST bind to
  the same constants and reject silent increases.
- Parsing, rendering, and OCR stay outside the renderer/main event loop where heavy;
  checksums stream asynchronously, buffers are released after transfer, and equivalent
  verified outputs are reused rather than recomputed.
- OCR work remains proportional to selected pages/images; exact sparse/image-only
  selection and snapshot integrity are Parser/Source Storage contracts.
- Persist bounded progress for files expected to exceed 2 seconds; numeric Home display remains open.
- Use the Job owner’s bounded, yielding scheduler rather than duplicating queue limits here.
- Keep source records, source assets, and partial artifacts even if OCR fails.
- Retry/recovery, Artifact integrity, Source Page conflict protection, and startup resume
  follow the Parser and Job Owner contracts; this document measures latency, memory,
  throughput, progress visibility, and resource release.

Fallback behavior:

- Parser/Job degraded-path fixtures must preserve the source, expose repair/retry, and
  keep any sufficient verified native text usable without presenting incomplete OCR as
  complete coverage.

## 10. Conversation History Performance

Pige keeps complete conversation history, but uses reference-based storage.

Rules:

- Conversation lists load by recent metadata first.
- Long messages are paged.
- Large pasted source bodies are referenced, not duplicated.
- Search over conversation history uses indexes.
- Conversation compaction keeps readable events and references.
- Chat timeline should not render thousands of events at once.

## 11. File Watcher Reliability

Rules:

- Watch durable vault files.
- Debounce bursts from editors, sync tools, or archive extraction.
- Detect atomic writes and temporary files.
- Avoid full vault rescan on every event.
- Schedule reconciliation scans after startup and restore.
- Stage conflicts instead of overwriting external edits.

## 12. Crash Recovery

Crash-safe write pattern:

1. Write temp file.
2. Flush where supported.
3. Rename atomically.
4. Record operation summary.
5. Mark job step complete.
6. Update indexes.

Recovery on launch:

- Scan unfinished jobs.
- Validate temp files and partial outputs.
- Reconcile operation records with file existence and checksums.
- Rebuild dirty indexes.
- Show recoverable failures in Home status and exceptional conflicts in decision surfaces.

Rules:

- Preserve user data over completing automation.
- If recovery is uncertain, preserve alternatives and warn/abstain; stage a proposal only
  when conflict cannot be reconciled without loss.

## 13. Resource Pressure Handling

Memory pressure:

- Stop starting new heavy jobs.
- Unload local models if idle.
- Clear thumbnail/search caches.
- Reduce OCR/embedding concurrency.
- Show "Paused to keep Pige responsive" when useful.

Disk pressure:

- Warn before large downloads.
- Show local model and cache sizes.
- Let user remove model files.
- Let user clear caches/indexes.
- Never silently delete source records, source assets, notes, memory, conversations, or operation records.

Network pressure:

- Downloads are resumable where possible.
- Model downloads are explicit and cancelable.
- Supported model acquisition and packaging boundaries are owned by
  `docs/RELEASE_ENGINEERING.md`; this document measures only download and cache pressure.

## 14. Reliability Metrics

Diagnostic metric storage, export, redaction, and retention rules are defined in `docs/DIAGNOSTICS_AND_OBSERVABILITY.md`.

Track locally for diagnostics only:

- Time to capture preservation.
- Job duration by type.
- Job retry count.
- Index rebuild duration.
- Search first-result latency.
- Memory high-water marks.
- Crash recovery count.
- Database repair count.

No automatic telemetry upload in v0.1.

## 15. Test Fixtures

Required fixtures:

- 10,000 generated Markdown notes.
- 100,000 generated chunks.
- 100 GB synthetic vault layout, with sparse large files where possible for CI.
- Long conversation history with referenced source bodies.
- Long Markdown note with tables, images, code blocks, and citations.
- 500 PDF fixture set: text PDFs, scanned PDFs, mixed PDFs.
- Image-heavy PPTX fixture.
- DOCX fixture with headings, tables, images.
- Multilingual CJK/Latin search fixture.
- Broken/corrupted source fixture.
- External-edit conflict fixture.
- Crash-mid-ingest fixture.
- Backup/restore fixture.

## 16. Acceptance Gates

Before v0.1 public alpha:

- App opens compact capture view within target on a modern macOS machine.
- Input remains responsive during background indexing.
- 10,000-page Library renders from warm DB within target.
- Search returns lexical results within target on warm DB.
- Index rebuild resumes after forced quit.
- OCR failure does not lose the source record or source asset.
- Backup/restore succeeds without `.pige/db/` and `.pige/indexes/`.
- Backup/restore crash tests resume or fail from durable staging checkpoints without exposing a partial archive/vault.
- A missing external managed-copy root yields bounded `waiting_dependency` work and does not trigger repeated filesystem polling or path guessing.
- Reset Local Database does not delete durable truth.
- Memory drops back after heavy OCR or indexing jobs complete.
- Permission dialogs appear immediately when sensitive Skill/package actions request capabilities.

## 17. Implementation Checklist

For each feature:

- Does it run on renderer, main, worker, or utility process?
- Can it block typing, scrolling, search, or capture?
- Does it have a persisted job record?
- Does it checkpoint progress?
- Can it be canceled?
- Can it resume after crash?
- Does it duplicate large data?
- Does it have a benchmark fixture?
- Does it respect memory and CPU pressure?
- Does it degrade gracefully when indexes or models are unavailable?
