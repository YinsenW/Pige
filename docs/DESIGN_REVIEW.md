# Pige Design Review Notes

Status: Draft baseline review
Date: 2026-07-09
Authority: Historical review and rationale. Do not load by default for implementation. Normative requirements from this file must live in the owning design document or `docs/DECISION_LOG.md`.

## 1. Review Summary

The initial design direction is strong: Pige should be a local-first, Agent-maintained Markdown wiki rather than a chatbot over files.

The biggest design risk is not missing features. The biggest risk is uncontrolled Agent behavior: silent wiki rewrites, weak citations, prompt injection from sources, and weakly disclosed data boundaries when cloud models are used.

This review converts those risks into explicit product and architecture rules.

## 2. Accepted Design Improvements

### 2.1 Add Processing Status And Confirmation Proposals

Problem:

- The first draft assumed captures go straight from input to compiled wiki.
- Real ingest jobs can fail, partially succeed, or produce risky edits.

Decision:

- Add Home status cards for queued, processing, failed, and partially processed captures.
- Add confirmation proposals for risky Agent changes.
- Do not expose Inbox or Review as default top-level navigation items.

Why:

- Users never lose a capture.
- Pige can stay fast for safe writes while still earning trust for major edits.

### 2.2 Define Agent Trust Levels

Problem:

- "Agent maintains the wiki" is powerful but too broad.

Decision:

- Auto-apply safe writes such as source records, source pages, simple new notes, index updates, and log entries.
- Stage substantial edits, merges, renames, contradiction markers, and low-confidence updates.
- Require explicit confirmation for delete, vault structure changes, `PIGE.md` edits, secret export, and unusually sensitive model calls.

Why:

- This keeps the magic of automatic capture without making the knowledge base feel haunted by invisible edits.

### 2.3 Strengthen Provenance And Citations

Problem:

- `source_ids` alone are not enough for later question answering, contradiction checks, or user trust.

Decision:

- Add source-level and fragment-level provenance.
- Preserve page numbers for PDFs when possible.
- Preserve canonical URL and capture timestamp for web sources.
- Distinguish source-backed facts from Agent interpretation.

Why:

- Pige's wiki should be inspectable, not just plausible.

### 2.4 Add Prompt Injection Defense

Problem:

- Web pages and documents can contain instructions aimed at the Agent.

Decision:

- Treat all source content as untrusted data.
- Source content cannot override `PIGE.md`, user intent, model settings, tool permissions, or filesystem scope.
- Suspicious source instructions should be ignored and optionally logged as warnings.

Why:

- Pige reads arbitrary pages and files. Prompt injection is part of the threat model from day one.

### 2.5 Add Persistent Job And Change Records

Problem:

- Long-running local parsing and model calls can fail or be interrupted.
- Without operation records, rollback and debugging are hard.

Decision:

- Store jobs under `.pige/jobs/`.
- Store pending proposals under `.pige/proposals/`.
- Store applied change sets under `.pige/operations/`.

Why:

- Agent work becomes recoverable, auditable, and easier to repair.

### 2.6 Improve BYOK Data Boundary Design

Problem:

- Users may assume BYOK means local-only processing.

Decision:

- Model setup and inline status must show whether a provider is local, self-hosted, or cloud-hosted when content may leave the machine.
- Settings and provider records may store provider capabilities, context windows, and optional cost hints internally, but the default UI should not expose capability matrices or model-routing controls.
- UI should disclose when captured content may be sent to a cloud model provider.

Why:

- BYOK is about user-controlled credentials. It is not automatically a privacy guarantee.

### 2.7 Add Deduplication And Slug Policy

Problem:

- Agent-maintained wikis can grow messy by creating near-duplicate pages.

Decision:

- Separate stable page IDs from file paths.
- Use checksums and canonical URLs for exact source duplicates.
- Search titles, aliases, tags, and concepts before creating new wiki pages.

Why:

- This reduces page sprawl without forcing users to manually organize.

### 2.8 Specify `PIGE.md`

Problem:

- The schema file was named but not governed.

Decision:

- `PIGE.md` must include vault schema version, page definitions, frontmatter rules, citation rules, trust levels, source handling, and index/log rules.

Why:

- The Agent needs a stable local constitution, not just a prompt.

### 2.9 Separate Raw, Artifacts, Sources, And Wiki

Problem:

- The earlier vault layout mixed immutable raw evidence and Agent-generated source summary pages under `sources/`.

Decision:

- `raw/` stores immutable originals.
- `artifacts/` stores parser output that can be regenerated.
- `sources/` stores Markdown source pages.
- `wiki/` stores compiled knowledge pages.

Why:

- This makes the evidence layer, parser layer, and Agent-written layer easier to reason about, backup, restore, and eventually sync.

### 2.10 Simplify v0.1 Navigation

Problem:

- The first sidebar design exposed too many top-level items for a narrow vertical window.

Decision:

- Keep top-level navigation focused on Home, Library, Knowledge Tree, and Settings.
- Put capture, questions, processing status, and confirmation-needed changes inside Home.
- Put notes, sources, topics, and tags inside Library.

Why:

- Pige should feel like a capture companion first, not a crowded document manager.

### 2.11 Clarify Timeline Durability

Problem:

- A chat-like interface can accidentally become an unbounded hidden database.

Decision:

- Treat the conversation timeline as recent activity over jobs and logs.
- Durable knowledge belongs in Markdown pages, source pages, `index.md`, and `log.md`.

Why:

- This reinforces Pige's promise that the user's knowledge is local, inspectable, and portable.

### 2.12 Require Basic Diff For Confirmation

Problem:

- Confirmation summaries alone are not enough when the Agent edits existing pages.

Decision:

- v0.1 should show a unified text diff for confirmation-needed edits.
- New pages can use summary plus Markdown preview.
- A rich side-by-side diff editor can wait.

Why:

- The user needs enough visibility to trust Agent-maintained wiki updates.

### 2.13 Make Retrieval A First-Class Experience

Problem:

- Earlier drafts focused heavily on ingest, but knowledge is only valuable if it can be retrieved naturally.
- A plain chatbot answer hides the underlying notes and weakens trust.

Decision:

- Add Home knowledge retrieval as the default behavior for questions typed into the Home composer.
- Home knowledge retrieval returns a grounded synthesis plus ranked notes and source pages.
- Results show snippets, match reasons, citations, and open-original actions.

Why:

- Pige should feel like search upgraded by an Agent, not a chatbot that forgets the user's knowledge structure.

### 2.14 Add Note Agent And Selection Actions

Problem:

- Once a user opens a note, they need contextual help without leaving the reading surface.
- Common text operations should not require copying text into a separate chat box.

Decision:

- Add a right-side Note Agent panel scoped to the current note.
- Add Notion-like selection actions for copy, quote, ask, translate, polish, expand, summarize, and create-note flows.
- Mutating actions should preview or create confirmation proposals.

Why:

- This makes retrieval and editing feel continuous: find a note, inspect it, ask about it, transform a passage, and save useful outcomes back into the wiki.

### 2.15 Make Minimal Capture The Default Mental Model

Problem:

- The feature set can easily make Pige feel like a complex knowledge-management dashboard.
- That would fight the core promise: users should not need to learn the system before capturing knowledge.

Decision:

- The default screen should be almost empty, with one dominant input.
- The whole window becomes a drag-and-drop hot zone.
- Sidebar, Library, confirmation cards, Home retrieval results, Note Agent, and selection actions are progressively disclosed.
- The visual language should feel clean, fresh, quiet, and closer to a calm chat input than a document manager.

Why:

- The strongest user mental model is "just throw it into Pige." Everything else should emerge only when it helps.

### 2.16 Add Native Voice Input On Supported macOS

Problem:

- Typing and file dropping are not always the lowest-friction capture paths. Many quick thoughts start as speech.

Decision:

- Add a microphone button to the capture input toolbar.
- On macOS 26 or later, use Apple's SpeechAnalyzer/SpeechTranscriber APIs for local dictation.
- Keep the transcript editable in the main input before submission.
- Do not implement Windows voice input in v0.1.
- Do not silently fall back to older lower-accuracy macOS speech APIs by default.

Why:

- Voice input supports the same "throw it into Pige" mental model while preserving the product's local-first privacy stance.
- Using the latest Apple speech stack avoids shipping a visibly worse dictation experience just to check a cross-platform box.

### 2.17 Make Markdown Reading A First-Class Surface

Problem:

- The product promise says Markdown is the durable artifact, but a weak renderer would make Markdown feel like a storage detail instead of the user's real knowledge surface.
- The user specifically wants to borrow from polished Markdown editors and the elegance of artifact-style Markdown rendering.

Decision:

- Treat the Note Reader as a core product experience in v0.1.
- Default opened notes to a refined rendered view, with clean typography, stable layout, readable code blocks, tables, images, wiki links, and citations.
- Keep editing source-preserving: Pige writes normal Markdown, not a proprietary rich-text document.
- Let selection actions operate on rendered text and map paragraphs, headings, list items, blockquotes, and table cells back to source spans. Disable mutating selection actions for unsupported spans while keeping read-only copy available.
- Sanitize raw HTML and keep captured web HTML out of the trusted renderer.

Why:

- Pige should not only create Markdown files. It should make them pleasant to read, safe to inspect, and easy to continue working with.

### 2.18 Add OCR As A Core Ingest Fallback

Problem:

- Real sources often contain text as pixels: screenshots, scanned PDFs, exported slides, embedded images, and diagrams.
- If Pige only extracts embedded text, many important documents will look empty or incomplete.
- A fully open, unreviewed plugin marketplace would be too broad for v0.1, but OCR fallback needs a way to install heavier local tools.

Decision:

- Treat OCR as part of the v0.1 ingest baseline when a local engine is available.
- On macOS 26 or later, prefer Apple Vision document/text recognition.
- On supported Windows devices, use Windows AI APIs Text Recognition when runtime checks confirm availability.
- Use PaddleOCR as the cross-platform fallback through a constrained Local Tools manager.
- Keep the fully open third-party plugin marketplace out of v0.1; ship the local tool path needed for OCR fallback and the curated package-management path separately.

Why:

- This preserves the "throw anything into Pige" promise for screenshots and image-heavy documents without forcing cloud OCR or bloating the core app bundle.

### 2.19 Make RAG Local And Invisible By Default

Problem:

- Retrieval is central to Pige, but asking users to configure embedding models, reranking models, vector databases, and API keys would create too much cognitive load.
- Cloud embeddings would also weaken the local-first privacy promise.
- The Agent needs high-quality local context preparation before it calls the configured language model.

Decision:

- Treat RAG as a built-in local capability, not a BYOK provider setup.
- Ship a built-in local inference engine for embeddings and optional reranking.
- Download `Qwen3-Embedding-0.6B-Q8_0.gguf` from `Qwen/Qwen3-Embedding-0.6B-GGUF` as the default local embedding model after user consent.
- Keep local lexical and vector indexes as rebuildable derived caches.
- Use local reranking when a supported reranker is installed, but do not require users to understand or configure it.
- Send only selected snippets and citations to the configured online language model for synthesis.

Why:

- This keeps the user-facing setup simple: configure one language model API, then let Pige handle retrieval locally.

### 2.20 Bundle The Core Agent Toolchain

Problem:

- Agent workflows may need Git/Git Bash, Bun, `uv`, Python helper tools, PDF renderers, and Office parsers.
- Downloading these tools during a user job would make capture reliability depend on network quality, mirrors, package-manager state, and platform quirks.
- Cross-platform behavior will drift if macOS and Windows rely on whatever happens to be installed on the user's machine. Linux is deferred, but the same rule should apply later.

Decision:

- Ship a pinned core toolchain with the desktop app.
- Include Git/shell support, Bun, `uv`, PDF parsing/rendering tools, and DOCX/PPTX parsing tools in the v0.1 package after license and size review.
- Let Agent jobs call only declared bundled tools and local capability-registry tools.
- Forbid task-time installation of executables or parser dependencies.
- Keep large model weights as explicit optional downloads, not hidden Agent actions.
- Expose a repair state in Settings when a bundled tool is missing, blocked, or corrupted.

Why:

- This makes ordinary ingest and Agent maintenance feel dependable even on poor networks, and it gives Pige one predictable cross-platform execution environment.

### 2.21 Add Curated Pi Package Management

Problem:

- The Pi package catalog is large and fast-moving. A crawl of `pi.dev/packages` found 5,007 packages.
- Many packages are relevant to Pige: memory, local RAG, source capture, context compression, local inference, workflow, safety, and knowledge-system bridges.
- Blindly bundling or auto-installing community packages would create security, quality, privacy, and UX risk.

Decision:

- Add a curated Pi Package Manager to Settings.
- Support explicit install, disable, uninstall, update, and version pinning.
- Show package metadata, trust tier, source links, permissions, and data boundary before install.
- Start with a curated review set documented in `docs/PI_PACKAGE_RESEARCH.md`.
- Keep visible recommendations narrow and vertical: only packages with direct personal knowledge management value should be promoted.
- Block Agent task-time package installation.
- Keep installed package files outside the vault and route durable package outputs through Pige-approved write paths.

Why:

- Pige can benefit from the Pi ecosystem without becoming chaotic or unsafe. The user gets a rich extension path, while the product keeps local-first trust and predictable behavior.
- The product should remain an extremely simple personal knowledge app. Pi packages are a capability layer behind the scenes, not a reason to expose a broad Agent marketplace to ordinary users.

### 2.22 Treat Window Modes As Product Design

Problem:

- A single narrow layout is excellent for daily capture, but poor for deep reading, source inspection, note linking, and current-note Agent work.
- A full document workspace is excellent for reading, but too heavy as the default entry point.

Decision:

- Keep compact Home as the default first-run and daily-use mode.
- Add explicit always-on-top support for compact mode so Pige can sit beside other apps with low screen cost.
- Support expanded workspace mode with sidebar for Home, Library, Knowledge Tree, and Settings.
- Support full-screen reading mode for notes, with a comfortable Markdown column and optional side rails for navigation, sources, related notes, backlinks, and Note Agent.
- Let users hide side rails independently so full-screen can become either a knowledge workspace or a distraction-free reader.

Why:

- Pige has two rhythms: quick capture and deep retrieval. Treating window modes as a first-class design keeps the default interface extremely simple while still giving serious reading and knowledge work enough space.

### 2.23 Implement Pige-Native Agent Memory

Problem:

- Agent memory is important, but it is not the same thing as the user's knowledge wiki.
- External memory projects such as TencentDB Agent Memory, `pi-hermes-memory`, `pi-memctx`, `pi-memory`, and Engram are promising, but each brings its own storage model, prompt behavior, permissions, lifecycle, or agent-platform assumptions.
- Directly adopting one as the default core would make it harder to enforce Pige's vault schema, confirmation gates, local-first privacy, backup rules, and minimal UI.

Decision:

- Implement a Pige-native Agent Memory Core.
- Use a layered model inspired by TencentDB Agent Memory: events, atoms, scenarios, and compact profile/policy.
- Store vault-scoped memory as inspectable local text under `.pige/memory/`.
- Use rebuildable indexes under `.pige/indexes/memory/`, reusing the Local RAG Pack when embeddings are available.
- Treat external memory projects and Pi packages as references or optional curated extensions, not default dependencies.
- Require secret scanning, provenance, confirmation gates for sensitive memories, and user controls for inspect, undo, disable, export, delete, and reset.

Why:

- Pige should remember enough to become personal and less repetitive, while keeping memory visible and governable. The product should not hide user modeling inside an opaque plugin.

### 2.24 Use SQLite As A Working Database

Problem:

- Pure Markdown storage is excellent for ownership, but large vaults still need fast Library views, search, link graphs, job status, RAG chunk lookup, memory recall indexes, and rebuild state.
- A hidden database can undermine the local Markdown promise if it becomes the only place where knowledge exists.

Decision:

- Use a local SQLite working database.
- Keep Markdown knowledge files, source records/source assets, extracted artifacts, memory text, proposals, operation summaries, and vault config as durable truth.
- Treat `.pige/db/vault.sqlite` as rebuildable.
- Use `better-sqlite3` as the v0.1 driver candidate, behind a `LocalDatabaseDriver` abstraction.
- Keep database access in Electron main process or a dedicated worker/utility process, never in the renderer.
- Track `node:sqlite` as a future driver option when Electron's bundled Node version and API stability are ready.

Why:

- Pige needs database-backed speed without becoming a proprietary database note app. If the SQLite file disappears, the app may rebuild for a while, but the user's knowledge should remain intact.

### 2.25 Add Skill Extension Management

Problem:

- Pige is vertical, but users should be able to extend repeatable knowledge workflows without waiting for core releases.
- Allowing hidden arbitrary plugin execution from chat would be unsafe and would pull Pige toward a general Agent platform.
- Treating every Skill as a full package would make lightweight Markdown workflows too heavy.

Decision:

- Add a Skill Manager to Settings.
- Allow explicit chat-initiated Skill installation from URL, Markdown file, ZIP, reviewed package source, or external/Web Skill source.
- Stage and preview Skills before enabling.
- Define pure Skills as Markdown instruction packs, not executable plugins.
- Support external/Web Skills when capabilities are declared and mediated by Pige's Permission Broker.
- Store vault-scoped Skills under `.pige/skills/` and machine-local Skills under app data.
- Prevent scripts, binaries, npm packages, MCP configs, and executable archives from running during staging.
- Route executable/package-backed runtime actions through Package Manager, Local Tools, reviewed adapters, and permission prompts.
- Support default permission modes, including Ask Every Time, Remember Scoped Grants, and explicit YOLO Full Access.
- Require Skill installs to be explicit, inspectable, reversible, and scoped.

Why:

- This gives Pige extensibility where it matters: custom knowledge workflows and user-approved Web/Agent skills. The user can teach Pige new methods without turning the app into a hidden plugin launcher.

### 2.26 Make I18N A v0.1 Requirement

Problem:

- Pige handles personal knowledge, and real vaults will contain mixed-language sources.
- Adding localization after UI and Agent prompts are built would force expensive rewrites.
- CJK languages need different lexical search behavior than whitespace-separated Latin scripts.

Decision:

- Support UI locales for Simplified Chinese, English, Japanese, Korean, French, and German in v0.1.
- Add a Settings language selector with system locale default.
- Store language metadata on sources, generated pages, chunks, OCR artifacts, and memory records where useful.
- Preserve source language by default.
- Answer Home knowledge retrieval in query language by default.
- Add CJK-friendly lexical fallback, plus multilingual semantic retrieval through Local RAG.
- Test compact window layouts in all six locales.

Why:

- Internationalization affects storage, retrieval, OCR, speech, prompts, and layout. Treating it as a first-version architecture requirement keeps Pige usable for multilingual knowledge from the start.

## 3. Design Choices To Keep Lean In v0.1

These are important, but should not bloat the first implementation:

- Full visual diff editor can wait, but v0.1 should show a unified text diff for edits and a preview for new pages.
- Advanced graph analytics can wait; the lightweight Knowledge Tree visualization can exist as an explainable exploration surface.
- Local RAG should ship in v0.1, but Home knowledge retrieval must still work with lexical and metadata ranking before the embedding model is downloaded.
- Embedding provider configuration should not exist in v0.1; local RAG model download and indexing should be handled by Local Tools.
- Sync can wait; backup and restore come first.
- Word and PowerPoint should ship as best-effort extraction in v0.1, but perfect layout fidelity can wait.
- General unreviewed plugin marketplace can wait; curated Pi package management, permission-scoped external/Web Skills, a constrained local tool manager, and bundled core toolchain should ship earlier.
- Bundled toolchain size and licensing need review before final release packaging.

## 4. Resolved v0.1 Defaults

- Confirmation threshold: low-risk auto-apply requires confidence `>= 0.85`; mutating actions below that require confirmation.
- Chat history: store complete reference-based conversation history under `.pige/conversations/`, but do not duplicate large source asset bodies, files, or saved wiki page bodies in chat logs.
- Git: no automatic internal Git history in v0.1; keep the vault Git-friendly.
- `PIGE.md`: editable through Advanced Settings with validation and confirmation.
- Default vault paths: `~/Documents/Pige Vault` on macOS and `%USERPROFILE%\\Documents\\Pige Vault` on Windows. Linux support and default path are deferred.
- Citations: use stable Markdown fallback syntax `[source:<source_id>#<locator>]` with machine-readable metadata.
- Windows OCR: Windows AI OCR when supported; PaddleOCR fallback; no legacy Windows.Media.Ocr default path.
- Qwen embedding: default `Qwen3-Embedding-0.6B-Q8_0.gguf`.
- CJK lexical indexing: Unicode bigram+trigram fallback.
- Telemetry: none by default.
- Accessibility: v0.1 baseline includes keyboard reachability, focus states, labels, contrast, and reduced motion.

## 4.1 Post-v0.1 Exploration Items

- Whether to add optional Git-backed history.
- Whether translation deserves a first-class workspace.
- How to evolve permission-scoped package/Skill execution into stronger sandboxing and signing.
- Which signed Skill/package registry model to use later.
- How much cost estimation can be reliable across custom providers.

## 5. Implementation-Ready Artifacts To Create During M1

These are implementation artifacts, not product-design blockers:

- Default `PIGE.md` template file.
- Exact vault manifest JSON schema.
- SQLite migration files.
- Local RAG manifest and chunk schema implementation.
- Bundled toolchain manifest with checksums and license notices.
- Skill metadata parser and validation schema.
- Pi package permission schema.
- Locale message files for six v0.1 languages.
- First-run onboarding strings.
- v0.1 smoke and acceptance test suite.
- Contribution guide and issue templates.
