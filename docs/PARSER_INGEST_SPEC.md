# Parser And Ingest Specification

Status: Draft baseline
Date: 2026-07-09

## 1. Purpose

This document defines the deterministic source-preservation, parser, OCR, and Artifact
tools Pige exposes to Agent-orchestrated ingest. It does not own the semantic workflow.

Use it when implementing capture, URL fetch, file ingest, OCR routing, parser adapters, source preservation, or Agent ingest.

## 2. Pipeline

Source-bearing Home turns preserve the Source Record and asset/reference first. Pi then
selects and replans parser, OCR, retrieval, and write tools; Host services enforce each
call but never choose the semantic route.

Parser/OCR may resume the same call but cannot choose the next semantic step. Current
direct capture-to-parse/OCR routing is transitional and does not satisfy B3.13/E3.08.

## 3. Capture Request

Capture IPC request shapes are owned by `packages/contracts/src/index.ts` and
`docs/API_AND_IPC_DESIGN.md`. Runtime kind and client capability tier are separate
executable vocabularies owned by `packages/domain/src/index.ts`; parser contracts MUST
NOT merge them into one union.

Parser work begins from a durable Job plus a preserved Source Record or scoped source
handle. Requests carry references and bounded metadata, never a second copy of a large
source body.

Under B3.13, only a validated Pi tool event creates `ParseRequest`; format detection may
choose its adapter, not another tool.

## 4. Source Preservation

The Source Storage Service creates:

- A stable source ID.
- A source record.
- A managed copy or verified original-file reference according to the two v0.1 storage strategies.
- Initial checksum and metadata when available.

Storage strategies are defined in `docs/SOURCE_STORAGE_STRATEGY.md`. A filesystem link is
a future design topic, not a v0.1 source-preservation outcome.

## 5. Parse Request

```ts
type ParseRequest = {
  jobId: string;
  sourceId: string;
  sourceKind: SourceKind;
  sourceHandle: SourceHandle;
  preferredLanguages: string[];
  maxBytes: number;
  timeoutMs: number;
};
```

Rules:

- Parser workers receive scoped source handles, not arbitrary filesystem access.
- External PDF/Office parser, page-renderer, and native-OCR adapters receive only an
  app-owned private input snapshot created from the already-open verified source or
  rendered Artifact descriptor; they never receive the live mutable pathname.
- Parser services check for reusable verified output before creating a new source
  snapshot, pass the snapshot path only for the adapter call, and dispose it in `finally`
  on success or failure. Snapshot creation and integrity semantics are owned by
  `docs/SOURCE_STORAGE_STRATEGY.md`; an unexpected creation failure uses
  `source.snapshot_failed`.
- Parser workers cannot modify managed source copies or referenced originals.
- Parser jobs must not download parser binaries or package dependencies at task time.
- Missing parser tools produce a repair-needed state and retry path.
- Parse returns quality and OCR candidates but never invokes OCR; only a later Pi OCR
  event may recognize them.

## 6. Parse Result

The executable main-process result is `DocumentParseSourceResult` in
`apps/desktop/src/main/services/parser-artifact-service.ts`; worker protocols are owned
by their format-specific shared type modules. This document owns the durable outcome,
not a second TypeScript shape.

A successful parse outcome MUST identify the Source, checksummed text/metadata
Artifacts, text coverage and OCR readiness, warnings, and whether the Source Page was
updated or conflicted. Body text and locators live in their owned Artifacts/sidecars;
later citation fragments use stable locators derived from those verified records.

## 7. Artifact Layout

Derived artifacts live under the portable `artifactRoot`, which is
`<knowledgeRoot>/artifacts` in v0.1. The `sourceAssetRoot` compatibility/UI field means
`managedCopyRoot`; changing it must not move or retarget derived artifacts.

```txt
artifacts/
  extracted-text/
  ocr/
  rendered-pages/
  thumbnails/
  metadata/
```

Artifact files should include metadata sidecars when needed:

```json
{
  "artifact_id": "art_20260709_120000_abcd",
  "source_id": "src_20260709_120000_abcd",
  "kind": "extracted_text",
  "created_at": "2026-07-09T12:00:00+08:00",
  "tool": "pdf-text-extractor",
  "tool_version": "1.2.3",
  "checksum": "sha256:..."
}
```

Current parser artifact references in the Source Record also store SHA-256 checksum and byte size. Parser retries verify the preserved source, expected parser identity/version, metadata sidecar, and extracted-text artifact before reuse; a mismatch regenerates derived artifacts and never rewrites the preserved source.

Agent Evidence Assembly does not associate a text Artifact with the first metadata Artifact in a Source Record. A sidecar must identify its own Artifact ID and Source ID and match the selected text checksum through `extractedTextChecksum` or `ocrTextChecksum`. Unpaired text may be exposed only as a coarse preview with an explicit review warning; it cannot borrow another Artifact's locators.

After a new document-parser or direct-image OCR Artifact is persisted, its owner passes the pre-Artifact Source Record as `SourcePageService`'s expected baseline. PDF OCR first commits its merge against the reread whole-file Source Record checksum, then refreshes from that committed revision. Both paths stop on a detected Source Record or user-Markdown change. `docs/SOURCE_STORAGE_STRATEGY.md` section 5 owns the path boundary, pending-recovery protocol, revision checks, and remaining commit windows.

## 8. Adapter Requirements

### 8.1 Text And Markdown

- Preserve original text as a managed text source or referenced file.
- Detect frontmatter-like content as untrusted source content.
- Keep line numbers when useful.
- Phase 2 implementation preserves typed/pasted text and `.md`, `.markdown`, and `.txt` files before parser/model work. Typed/pasted text necessarily uses a managed source; file capture follows the selected managed-copy or reference-original strategy, writes a checksummed source record, and creates reference-based conversation events and queued capture jobs.
- Phase 2/3 bridge implementation can create minimal no-model source pages for text/Markdown/TXT sources. These pages provide frontmatter, provenance, source references, and a short trusted wrapper around untrusted source excerpts. Markdown structure extraction, AI summaries, and wiki compilation remain later parser/Agent stages.
- Current file capture preserves or verifiably references `.pdf`, `.docx`, `.pptx`, and common images before parser/OCR work. PDF, Office, image OCR, and Agent text readers share `verifyReadableSourceFile`, so a missing reference waits for reconnection and checksum/path failures stop safely. Direct images queue Agent work; only a Pi OCR event invokes the verified Apple Vision helper, while missing model or capability stays waiting.
- Agent ingest must treat PDF/DOCX/PPTX/image sources without `extracted_text` or `ocr` artifacts as unavailable text, not as raw UTF-8 input.

### 8.2 URL

- Fetch only through an Agent-selected Source Fetch tool.
- Block local/private network targets unless explicitly allowed.
- Store canonical URL, final URL, capture timestamp, content type, and extraction warnings.
- Preserve a readable snapshot when feasible.
- Current Phase 5 still auto-fetches URL capture through pinned Undici before the Agent;
  the SSRF/redirect/body safety remains valid, but that semantic route is transitional.
- Declared and decompressed streamed response bodies are capped at 2 MiB. Charset is detected from HTTP metadata, BOM, or leading HTML metadata before the decoded snapshot is preserved under `raw/web/YYYY/MM/` as untrusted source evidence.
- HTML article extraction runs in the bounded `workers/web-extractor-worker.js` entry with exact Mozilla Readability and jsdom dependencies. Script execution and external resource loading are not enabled. The worker returns plain text and selected metadata, never trusted article HTML.
- The serial worker allows eight pending requests, a 5-second deadline, 256 MiB old-generation heap, 2,097,152 decoded input characters, 20,000 inspected elements, 1,000,000 output characters, and 64 HTTP(S) image references. A worker/dependency failure terminates the worker, falls back to bounded DOM-less extraction, and records a reduced-extraction warning.
- Extracted readable text is stored once as a checksummed `extracted_text` artifact under `artifacts/web/YYYY/MM/` and is the preferred input for source pages and Agent ingest.
- The Source Record stores effective charset, title, canonical URL, site, author, publication time, language, excerpt, redacted image references, parser identity/version/mode, counts, truncation, and warnings. Reduced or truncated extraction is carried into Agent context and forces review-quality warnings.
- Durable URL fields shown in Markdown, source records, prompts, operation records, jobs, diagnostics, or conversations must redact sensitive query values such as token, api_key, password, secret, signature, and similar keys.
- Browser-rendered JavaScript-heavy capture remains deferred and must not silently enable page-script execution in this path.

### 8.3 PDF

- Extract embedded text with page locators.
- Render pages for OCR only when text is absent, sparse, or visibly image-heavy.
- Keep page count and per-page warnings.
- Current Phase 5 foundation pins `pdfjs-dist` `6.1.200` and `@napi-rs/canvas` `1.0.2`. One bounded worker extracts embedded text; a separate explicit page-materializer worker rasterizes only verified OCR candidate pages. Neither path has network access or task-time downloads.
- The embedded-text worker caps input at 200 MiB, pages at 2,000, execution at 60 seconds, and old-generation memory at 512 MiB.
- The parser writes one normalized `artifacts/extracted-text/YYYY/MM/<source-id>.txt` file and one text-free `artifacts/metadata/YYYY/MM/<source-id>.pdf.json` sidecar containing parser version, page locators, exact `characterStart`/`characterEnd` spans for text-bearing pages, page character counts, warnings, coverage, page-limit truncation, and OCR candidate pages. Evidence Assembly uses offsets first; marker-based splitting is legacy compatibility only.
- A deterministic, idempotent `create_artifact` Operation Record references the parse job, source, and artifact paths without copying PDF text into operational history.
- Medium/high native coverage returns to the same Agent run. Sparse/image-only or low/no coverage returns typed `needs_ocr`; only a subsequent Pi OCR call starts the bounded PDF path below. Unavailable or empty OCR waits without a note. Native and OCR bodies remain separate checksummed Artifacts.
- Source-page refresh uses stored checksums and a durable pending checksum record. A restart can finish Pige's own interrupted write, while a user-edited Markdown source page is preserved and marked conflicted instead of overwritten.
- On supported macOS 26 systems, a fully inspected PDF with at most 20 ordered parser-selected OCR candidates can continue through `PdfPageRendererService` to Apple Vision OCR. Image-only targets must cover every page; mixed-text targets render only sparse candidate pages. Parser-truncated PDFs, incomplete or changed target lists, and larger candidate sets remain visibly waiting or fail closed rather than replacing or omitting native evidence.
- The materializer caps the source at 200 MiB, selected pages at 20, each edge at 3,072 pixels, each page at 9,437,184 pixels and 16 MiB encoded PNG, aggregate PNG output at 64 MiB, worker old-generation memory at 512 MiB, and execution at 120 seconds. It disables PDF.js network fetch, XFA, system fonts, range/stream/autofetch, annotations, and WASM, rejects symlinks, and returns pixel data only; the main process owns Artifact writes.
- Rendered pages use deterministic `rendered_page` Artifacts under `artifacts/rendered-pages/`; render and OCR sidecars are text-free and checksummed. Both sidecars bind the parser-metadata Artifact ID/checksum, target mode, exact requested page set, and native-text readiness. PDF OCR text is stored once with `page:N/ocr:block:M` locators, character spans, normalized top-left geometry, confidence, language, engine, and rendered-Artifact provenance.
- Rendering and recognition each create a body-free idempotent `create_artifact` Operation Record linked to parser/render provenance. Render-operation identity includes the rendered output set's Artifact ID/checksum/size digest, so an incomplete render followed by a complete retry does not reuse stale provenance while identical output remains idempotent. Source checksum and parser target are reverified before rendering and final OCR persistence; the latest Source Record is reread, merged, and protected by an expected-file-checksum check immediately before atomic replacement. A detected concurrent Source Record change fails safely instead of being overwritten. Valid completed output is reused after restart, incomplete rendering remains retryable with validated page Artifacts preserved, and user-edited Source Pages are never overwritten.
- PDF Artifact, sidecar, Source Record, and Operation Record writes reject lexical escapes, parents that resolve outside the active vault, symlink parents or targets, and non-regular existing targets before atomic replacement.

### 8.4 DOCX

- Extract headings, paragraphs, lists, tables, links, and images when feasible.
- Preserve document structure without pretending layout is perfect.
- DOCX/PPTX parsing shares one Office worker capped at 100 MiB input, 10,000 archive entries, 512 MiB expanded data, 10 MiB per selected XML part, 128 MiB selected XML total, 2,000 slides, 10,000,000 output characters, 60 seconds, and 512 MiB old-generation memory. Selected PPTX media separately caps 20 targets, 16 MiB each, 64 MiB total, and 60 seconds.
- Current Phase 5 adapter pins Mammoth `1.12.0`, performs bounded OpenXML ZIP preflight across every DOCX XML/relationship part with yauzl `3.4.0`, disables embedded style maps and external file access, replaces images with local references, and never renders converter HTML in the product UI.
- DOCX output preserves heading/list/table/link structure as normalized text plus `block:N` units, redacts secret-like URL query values, records referenced embedded media, and emits `image:N` OCR candidates only for images reached from document content.
- The bounded worker returns data only. Main-process Parser Service writes checksummed
  text/metadata Artifacts and safely refreshes the source projection. Only the enclosing
  Pi tool event creates or reuses its parse child and selects any supported follow-up OCR.

### 8.5 PPTX

- Extract slide text, speaker notes, image references, and slide order.
- OCR slide images when visible text is not otherwise recoverable.
- Current Phase 5 adapter uses yauzl `3.4.0` plus fast-xml-parser `5.9.3` over selected bounded OpenXML parts. Presentation relationships determine slide order; speaker notes, external counts, `slide:N` units, and schema-v1 `slide:N/media:M` raster targets are preserved.
- XML value coercion and entity processing are disabled, DOCTYPE is rejected, nesting is capped, internal relationship traversal is rejected, and external targets are recorded but never opened.
- Image-bearing slides with sparse text return OCR candidates to Pi; they do not execute
  or delay another semantic step themselves.

### 8.6 Images

- Preserve first; run OCR only after the Agent selects OCR and a supported local engine is available.
- Store OCR confidence and engine metadata.
- If OCR is unavailable, keep the source and mark it searchable by filename/metadata only.
- Current macOS 26 adapter accepts preserved direct `image_file` sources only. It preflights actual image type, one-frame support, source dimensions/pixels, and bounded decode before Apple Vision document recognition with text-recognition fallback.
- The app-owned helper runs in a separate native process with a versioned bounded stdin/stdout protocol, no shell, no OCR network access, and a reduced environment. It caps source bytes at 50 MiB, source pixels at 40 million, each dimension at 20,000, decoded long edge at 4,096, frames at one, blocks at 10,000, recognized characters at 1,000,000, protocol output at 8 MiB, and execution at 60 seconds.
- Source checksum is verified before and after recognition. Valid deterministic Artifacts are reused after restart; stale derived output is regenerated; changed or path-escaping source evidence fails without invoking the adapter.
- OCR text is stored once in `artifacts/ocr/`. A separate checksummed metadata sidecar stores engine/version, confidence, language hints, image dimensions, normalized bounding boxes, character spans, and warnings without copying the recognized body.
- Source Page refresh and the body-free `create_artifact` Operation Record are idempotent. Empty OCR completes its child with warnings and leaves the Agent parent waiting without a note.
- PDF pages use their reviewed materializer. PPTX uses the bounded Office worker to materialize only parser-selected raster media into private disposable inputs for the same native OCR adapter. Text and body-free metadata persist with `slide:N/media:M/ocr:block:K` locators, checksum reuse, Source Record revision checks, and Source Page/Agent handoff. Full-slide, vector/chart, DOCX-media, and unsupported or oversized targets remain waiting.

### 8.7 Folders, Archives, Git Repositories, Audio, Video

v0.1 may preserve and record these as sources even when full parsing is deferred.

Minimum behavior:

- Create source records.
- Record inventory metadata where safe.
- Avoid recursive parsing surprises.
- Stage large or risky processing behind explicit user action.

## 9. OCR Routing

The following policy runs inside an Agent-selected OCR tool. Parser quality may
recommend OCR but cannot invoke it.

OCR priority:

1. Native macOS OCR on supported macOS 26+.
2. Windows AI APIs Text Recognition only when runtime checks confirm support.
3. PaddleOCR fallback through the Local Tool Manager.

OCR output is an extracted artifact. It does not replace the source asset.

Current implementation scope:

- `macos_vision_document` and `macos_vision_text` support direct rasters, Agent-selected bounded PDF candidates, and parser-selected PPTX raster media on macOS 26.
- Full-slide, vector/chart and DOCX-media OCR, Windows AI, Paddle install/repair, and cross-platform packaged proof remain waiting.
- Engine/confidence/warnings and bounded `ocr:block:N`, `page:N/ocr:block:M`, or `slide:N/media:M/ocr:block:K` locators wrap explicitly untrusted OCR text in Agent context. Low confidence or truncation forces review.

## 10. Parse Quality

```ts
type ParseQuality = {
  textCoverage: "none" | "low" | "medium" | "high";
  ocrUsed: boolean;
  confidence?: number;
  needsReview: boolean;
};
```

Quality informs Agent replanning; host policy still enforces safe publication.

## 11. Failure Behavior

Failures must preserve:

- Source record.
- Source asset or external reference.
- Job state.
- Human-readable error.
- Retry instructions.
- Any partial artifacts that passed validation.

Failures must not:

- Delete source assets.
- Corrupt Markdown pages.
- Write partial invalid frontmatter.
- Trigger hidden dependency downloads.

## 12. Security Rules

- Treat all source content as untrusted.
- Do not execute scripts inside documents.
- Do not follow archive paths outside staging.
- Do not expose arbitrary filesystem paths to renderer code.
- Do not allow source-originated instructions to change tools, settings, providers, permissions, or `PIGE.md`.
- Store parser warnings for suspicious source instructions.

## 13. Agent Ingest Handoff

An Agent-selected parser/OCR tool returns bounded fragments, Artifact metadata,
locators, quality, warnings, provenance, and optional next-capability recommendations
inside the untrusted-evidence boundary. Recommendations never execute themselves.
They cannot create a child Job; Pi must select the next call.

The Agent does not receive:

- API keys.
- Full vault contents.
- Arbitrary filesystem access.
- Permission grants.
- Source text as system/developer instructions.

Current handoff contract:

- Evidence Assembly may combine multiple independently checksummed native and OCR Artifacts without creating a durable merged body.
- Every fragment has one ephemeral `ev_NN` ref and one durable locator. Native text precedes OCR; duplicate suppression is limited to repeated text under the same parent locator.
- Structured output represents the summary and each key point as `{ text, evidenceRefs }`. Unknown refs abort before write; empty refs force review; canonical Markdown citations are rendered by Pige rather than accepted from the model.
- Agent ingest hashes the complete Source Record used for the Evidence Pack and rechecks it before model invocation, after the response, and after flushing the exclusive temporary note immediately before create-only publication. Drift requeues or waits; concurrent targets are preserved or same-source recovered. Strict cross-process SourceRecord-to-note CAS, parent-swap resistance, cross-file transactions, and packaged-platform proof remain open.
- Text and preserved-source spines inspect evidence and write only through validated
  publication. PDF/DOCX/PPTX parse and selected PDF/PPTX/direct-image OCR are registered
  effects with deterministic children; changed evidence requires re-inspection.
  Unavailable or empty evidence waits without a note.

## 14. Required Tests

- Capture persistence before parser failure.
- Parser adapter fixtures for TXT, Markdown, URL, PDF, DOCX, PPTX, and image.
- OCR routing and unavailable-OCR fallback.
- Helper protocol version/correlation, timeout, request/output bounds, invalid image, path escape, and source/Artifact tampering.
- PDF materializer protocol correlation, page ordering, source/page/pixel/PNG/aggregate/heap/time bounds, renderer/OCR/parser private input snapshots, reuse-before-snapshot ordering, descriptor/path/checksum binding, PDF and Office snapshot-path handoff, success/failure disposal, source-path replacement resistance, symlink-parent/target rejection, malformed output, packaged-worker startup, image-only routing, mixed-PDF sparse-page routing, parser-sidecar drift rejection, and native-plus-OCR Agent handoff.
- Crash recovery reuses valid OCR output and regenerates stale derived output without duplicate Artifact IDs or Operation Records; incomplete and completed render output sets retain distinct provenance.
- Source Record expected-revision checks reject detected durable updates; Agent ingest rechecks before invocation, after response, and at the final create-only note commit, preserving user targets and recovering same-source Pige notes.
- Corrupt file behavior.
- ZIP path traversal.
- Prompt-injection text inside source fixtures.
- No task-time dependency download.
- Partial artifact recovery.
- Citation locator stability.
- Parser/OCR stays idle before its Pi event; different quality results yield different
  Agent traces, and no-model capture performs no semantic work.
