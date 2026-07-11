# Pige Product Requirements

Status: Active product contract
Baseline date: 2026-07-09
Last reviewed: 2026-07-10

## 0. Contract Authority And AI Use

This PRD is written for AI Coding Agents that implement and maintain Pige. It is a
normative product contract, not a marketing narrative, implementation-status report, or
second copy of specialized technical contracts.

This document owns:

- The product optimization order and default user mental model.
- User-visible behavior, product workflows, degraded behavior, and forbidden behavior.
- `v0.1 Public Alpha` P0 scope, P1/P2 disposition, product acceptance outcomes, and
  product risks.

This document does not own executable types, schemas, internal paths, dependency
versions, model files, parser limits, IPC payloads, storage layouts, or current
implementation evidence. Those facts live in the specialized owner documents and
machine-readable resources routed by `docs/START_HERE_FOR_AI_AGENTS.md`.

Normative language:

- **MUST / MUST NOT**: release-blocking product contract.
- **SHOULD / SHOULD NOT**: required default unless an owner documents a compatible
  reason and verification for another path.
- **MAY**: permitted behavior, not a release requirement by itself.
- Examples and recommendations are non-normative unless a requirement explicitly
  promotes them.

Requirement and evidence ownership:

- The P0 bullets in section 8 are the complete release-scope ledger. Their stable
  `P0-*` identities and requirement coverage are projected by
  `resources/traceability/p0-coverage.manifest.json`.
- Stable `PIGE-*` requirements and their owner, phase, milestone, and verification
  class are registered in `docs/SPEC_TRACEABILITY.md`.
- Phase order and Build/Exit gates are owned by
  `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`; they do not redefine product scope.
- Current status and evidence are owned by
  `resources/traceability/acceptance.manifest.json`; current implementation notes MUST
  NOT be maintained in this PRD.

Changes to this contract follow the bidirectional PRD-impact rule in `AGENTS.md` and the
classification/propagation procedure in `docs/AI_DEVELOPMENT_GUIDE.md`.

For every requirement, an implementing Agent must be able to determine the product
intent, trigger or precondition, required observable behavior, degraded or blocked
behavior, forbidden behavior, user-visible completion evidence, specialized owners,
and verification path. A section may state those facts directly or reference their
single owner; it must not create a competing technical definition.

## 1. Summary

Pige is a local-first Agent note application. Users capture information through a
chat-like input box by typing text, pasting web links, or dropping files. Pige preserves
or references the source according to the user's storage choice, asks an Agent to
understand it when a model is available, and maintains an interlinked Markdown wiki on
the user's machine.

The product combines three familiar metaphors:

- Flomo-like lightweight capture.
- ChatGPT-like conversational input.
- Obsidian-like local Markdown vault.

The core product mechanism follows the LLM Wiki pattern: instead of only retrieving raw chunks at question time, the Agent incrementally compiles knowledge into a persistent Markdown wiki and keeps it current.

## 2. Product Positioning

One-line positioning:

> Pige turns anything you throw at it into a local, agent-maintained Markdown wiki.

This is the long-term positioning, not permission to claim unsupported v0.1 formats.
Sections 8–10 own the accepted release inputs and degraded behavior.

Short positioning:

> Pige is a local-first knowledge companion. You capture casually, the Agent organizes deliberately, and your knowledge remains readable, portable, and owned by you.

Product contrast:

- Not a manual folder/tag note app.
- Not a pure RAG chatbot over uploaded files.
- Not a cloud-first AI knowledge base.
- Not an Obsidian clone with AI features bolted on.

Pige's center of gravity is an Agent that writes, updates, links, and audits a local Markdown wiki.

## 3. Problem

People save articles, documents, snippets, ideas, meeting notes, and references across too many tools. Manual organization breaks down because every capture requires decisions: title, folder, tag, format, backlink, summary, and future retrieval path.

AI note tools often solve only the answer layer. They let users ask questions over a pile of documents, but they do not create a durable knowledge artifact. The same synthesis gets re-derived in chat again and again.

Pige solves the maintenance burden:

- Users should not decide where every note belongs before capturing it.
- Sources should remain preserved and inspectable.
- Useful knowledge should become Markdown pages, not disappear into chat history.
- Cross-links, tags, summaries, conflicts, and indexes should be maintained by the Agent.

## 4. Target Users

Primary users:

- Researchers, builders, writers, founders, analysts, and students who collect many sources over time.
- Users who like local Markdown ownership but do not enjoy manual knowledge-base maintenance.
- Users who want BYOK AI tools and do not want their knowledge base locked into one cloud provider.

Secondary or future users that do not define the v0.1 default experience:

- Teams that may later want a shared local-first or Git-backed knowledge base.
- Power users who already use Obsidian, Logseq, VS Code, or Git.

## 5. Product Optimization Order

When product requirements compete, AI Coding Agents MUST resolve them in the following
order. A lower group cannot weaken a higher group merely to simplify implementation.

### 5.1 Preserve Data, Ownership, And Trust

1. Captures and durable user data MUST survive parser, model, dependency, cancellation,
   crash, and restart failures. Recovery beats completing an uncertain automation.
2. Markdown remains the durable knowledge source of truth; databases, indexes,
   thumbnails, embeddings, and caches remain rebuildable working layers.
3. Original files remain user-owned. Pige may make a managed copy or retain a verified
   reference according to the source-storage contract, but MUST NOT force migration,
   silently rewrite evidence, or treat a future link strategy as a v0.1 strategy.
4. Agent changes MUST be visible, attributable, reversible where possible, and staged
   when risky. Destructive actions require explicit confirmation.
5. Ingested content is untrusted and MUST NOT change user intent, product policy,
   settings, tools, schemas, or permission boundaries.
6. Durable truth, regenerable artifacts, machine-local preferences, secrets, caches,
   and temporary state MUST remain distinguishable. Large source bodies and saved page
   bodies MUST NOT be duplicated into conversation history.

### 5.2 Keep The Default Product Simple And Useful

1. The default experience is capture-first: one calm Home composer accepts knowledge
   and questions without requiring a type, folder, tag, or mode choice.
2. After source preservation, the Agent chooses bounded knowledge tools; product
   services enforce safety and persistence without replacing its semantic plan.
3. The Agent maintains naming, linking, filing, summaries, and bookkeeping. Users guide
   intent and correct outcomes; they do not maintain a taxonomy before capture.
4. Chat and activity are operational surfaces, not the final knowledge artifact. Useful
   knowledge and reusable answers belong in the Markdown wiki.
5. Retrieval is a first-class experience: natural-language questions return grounded
   synthesis plus ranked inspectable notes and sources, not answer-only chat.
6. The interface MUST be keyboard usable, screen-reader understandable, contrast-safe,
   IME-safe, and usable with larger text. Simplicity cannot depend on tiny controls or
   visual-only cues.

### 5.3 Hide Runtime Complexity Behind Effective Defaults

1. BYOK is available from the first release. One provider and one default model are
   enough; after one boundary disclosure, routine bounded calls to that selected
   destination run without repeated prompts and use calm status instead.
2. Agent-affecting settings compile into typed runtime policy and are enforced by the
   owning services; prompt text alone is not enforcement.
3. Retrieval indexes, embeddings, and reranking run locally by default. Missing optional
   model assets degrade to a usable local fallback instead of blocking capture.
4. Speech and OCR prefer high-quality on-device platform capabilities. Optional local
   downloads are explicit; ordinary work never performs hidden task-time dependency
   installation.
5. The core toolchain is available or visibly repairable before a dependent workflow
   runs. Exact tools, versions, model files, and packaging choices are owned outside this
   PRD.
6. Agent memory remains distinct from the wiki: local, inspectable, scoped, reversible,
   provenance-linked, and never treated as unsupported factual evidence.

### 5.4 Extend Vertically Without Turning Pige Into A Platform Console

1. Skills and packages are admitted only when they improve personal knowledge capture,
   preservation, understanding, retrieval, linking, review, or reuse.
2. Extension installation is explicit, staged, reversible, capability-declared, and
   permission-mediated. Source content and model output cannot install or enable an
   extension.
3. Internationalization and multilingual knowledge are part of v0.1; language behavior
   is explicit rather than inferred from one global locale.
4. Backup and restore precede sync. Cloud sync, Web, mobile clients, and remote Agent
   execution are later products, while v0.1 contracts remain portable enough to avoid a
   forced rewrite.

## 6. Default User Model And Product Concepts

Default user model:

- The primary v0.1 user is an individual who repeatedly captures text, links, and
  documents, values local ownership, and wants useful knowledge without manually
  maintaining folders, tags, backlinks, or an AI toolchain.
- The user understands ordinary product concepts such as local notes, original files,
  sources, search results, model provider, permission, backup, and restore.
- The default UI MUST NOT require the user to understand Source Records, Artifacts,
  Jobs, RAG, embeddings, runtime adapters, schemas, package types, or provider taxonomy.
- Teams, shared vaults, remote Agent execution, and broad automation are outside the
  v0.1 user model even when the underlying contracts reserve a future path.

Default product loop:

```text
capture or ask
-> preserve the input before expensive work
-> understand and connect when dependencies are available
-> show what was created, updated, paused, or needs confirmation
-> retrieve, inspect, and reuse the resulting knowledge
-> apply user corrections without losing provenance
```

The concepts below exist to make that loop deterministic for implementation. Internal
names may appear in diagnostics or advanced inspection, but the default product copy
uses the user-facing language owned by `docs/UI_PROTOTYPE.md` and
`docs/I18N_DESIGN.md`.

### 6.1 Home Composer

The Home Composer is the user's only required interaction surface. It accepts both knowledge capture and knowledge-base questions. Inputs include:

- Typed or pasted text.
- Natural language questions.
- Voice dictation on supported macOS versions.
- Markdown or plain text files.
- Web links.
- PDF, Word, and PowerPoint files.
- Images and screenshots with OCR.
- Multi-file drops as later v0.1 phase work; P0 requires the whole window to accept a
  file drop, while batch size and scheduling are owned by the phase plan.

The home timeline should show recent captures, retrieved answers, job progress, and Agent summaries. Durable knowledge belongs in Markdown pages, source pages, `index.md`, and `log.md`.

Default home requirements:

- The first screen should be dominated by a single bottom composer.
- The user should not need to choose a type, folder, tag, capture mode, or ask mode before typing.
- The composer should not expose user-selectable "deep organize", "smart search", capture, ask, or retrieval mode chips. Agent intent routing should infer whether to save, organize, retrieve, answer, or request confirmation.
- The whole window should become a drop target when files are dragged over it.
- Empty state should be calm and sparse, with minimal chrome.
- Advanced navigation should be hidden behind progressive disclosure.
- The primary input supports both capture and knowledge retrieval intent; Pige infers intent from the content and attached context.
- Question-like input should retrieve from the local knowledge base first and return grounded summaries plus ranked notes, not generic chat by default.
- Voice input should be available from the composer toolbar as a low-friction alternative to typing.

#### 6.1.1 Window And Layout Modes

Pige should support distinct window modes because capture and reading have different ergonomics.

Default compact mode:

- Narrow vertical window optimized as the daily home entry point.
- Suitable as a side-window next to a browser, PDF reader, editor, meeting app, or chat app.
- Sidebar hidden by default.
- Whole-window drag-and-drop remains active.
- Optional always-on-top toggle so the user can keep Pige available during multi-window work.
- Always-on-top should be user-controlled and visually indicated when active.

Expanded mode:

- Wider window with sidebar and Library available.
- Used for continuing the home dialogue, browsing notes, inspecting sources, and confirming Agent proposals when needed.
- Home composer remains accessible but no longer dominates the whole interface.

Reading/full-screen mode:

- Full-screen or large-window layout optimized for Markdown reading.
- Uses a comfortable centered reading column, not stretched full-width prose.
- Can show navigation, related notes, sources, backlinks, and the Note Agent as side rails when width allows.
- Lets the user hide side rails for distraction-free reading.
- Preserves quick access to Home and current-note Agent actions.

Layout mode is part of the product experience, not just responsive CSS. The app should remember the user's preferred compact size, expanded size, full-screen state, and always-on-top preference per machine.

### 6.2 Source Record And Source Asset

A source record is Pige's durable provenance record for an input. A source asset is the
original evidence or Pige-managed copy used by parsers and citations. Extracted text,
rendered pages, thumbnails, and OCR output are derived artifacts, not original evidence.

v0.1 supports exactly two source-storage outcomes:

- Pige makes a managed copy when the input has no independently owned durable original
  or when the selected strategy requires a stable managed source.
- Pige retains a verified reference to an original file that remains in the user's
  location.

A filesystem link is not a v0.1 storage strategy. The user-visible `source asset root`
setting is the compatibility name for the managed-copy location; it is independently
configurable from the knowledge root. Derived artifacts remain under the portable
artifact root owned by the vault in v0.1 and MUST NOT silently follow an external
managed-copy root.

The executable strategies, root bindings, locators, unavailable-original behavior,
backup implications, and future link exploration are owned by
`docs/SOURCE_STORAGE_STRATEGY.md`, `docs/DATA_ARCHITECTURE.md`, and the shared schemas.

#### 6.2.1 Extracted Artifact

An extracted artifact is bounded parser or OCR output created from a source asset. It
may be regenerated when parsers improve, while the source evidence remains unchanged.
Artifact types, storage paths, checksums, locators, and parser/OCR sidecars are owned by
`docs/PARSER_INGEST_SPEC.md` and `docs/SOURCE_STORAGE_STRATEGY.md`.

### 6.3 Compiled Wiki

The compiled wiki is the Agent-maintained Markdown layer. It contains source summaries, normal notes, topic pages, concept pages, entity pages, claims, questions, indexes, and logs.

#### 6.3.1 Knowledge Model And Linking

Pige's knowledge organization is Agent-maintained and Markdown-first. Tags, topics, concepts, entities, claims, questions, backlinks, source citations, and Knowledge Tree relationships are governed by `docs/KNOWLEDGE_MODEL_AND_LINKING.md`.

User-facing simplicity rule:

- Users should not have to choose tags, folders, topics, or relation types before capture.
- Tags are lightweight facets, not the main hierarchy.
- Topics, concepts, entities, claims, and questions are durable Markdown pages when they matter.
- Graph indexes and Knowledge Tree aggregates are rebuildable working layers, not hidden knowledge truth.
- Risky graph changes such as merges, contradictions, supersession, and broad hierarchy edits require confirmation.

### 6.4 Schema

The schema is a local instruction file named `PIGE.md`, stored in the vault. It tells the Agent how to maintain the wiki: naming rules, frontmatter rules, page types, link conventions, ingest workflow, query workflow, and lint workflow.

The implementation contract for frontmatter, page types, citations, managed blocks, and `PIGE.md` lives in `docs/MARKDOWN_SCHEMA.md`.

### 6.5 Knowledge Health

Knowledge health is the quality of the wiki as a maintained system:

- Are important pages linked?
- Are claims sourced?
- Are there contradictions?
- Are there stale pages?
- Are tags coherent?
- Are orphan pages intentional?

### 6.6 Processing Status

Processing status is the user-visible surface for captures and Agent jobs that are not fully compiled yet. It includes queued, processing, failed, partially processed, and confirmation-needed jobs.

This capability is important because the user should never lose a capture just because parsing, model calls, or wiki compilation failed.

The detailed lifecycle for durable jobs, checkpoints, retry, cancellation, confirmation proposals, operation records, compaction, and crash recovery lives in `docs/JOB_OPERATION_AND_RECOVERY.md`.

UI rule:

- Do not expose "Inbox" as a default first-level navigation item.
- Show processing status inside Home as activity rows, compact status cards, or notifications.
- A deeper job-management view may exist behind status cards or Settings for troubleshooting.

### 6.7 Confirmation Queue

The confirmation queue holds Agent-proposed changes that should not be silently applied.

Proposal and operation lifecycle rules are defined in `docs/JOB_OPERATION_AND_RECOVERY.md`.

Examples:

- Merging pages.
- Renaming existing pages.
- Rewriting an existing concept or entity page substantially.
- Marking a claim as contradicted.
- Deleting or archiving pages.
- Editing `PIGE.md`.
- Any operation with low confidence.

UI rule:

- Do not expose "Review" as a default first-level navigation item.
- Show confirmation-needed changes as Home cards, inline note banners, or a focused confirmation surface.
- The user should feel they are confirming a specific change, not managing an abstract review inbox.

### 6.8 Home Knowledge Retrieval

Home knowledge retrieval is Pige's primary retrieval experience. It combines search, ranking, and grounded summarization inside the Home Composer flow.

Home knowledge retrieval should not behave like a generic chatbot that only returns one answer. It should:

- Interpret a natural language question.
- Find highly relevant notes, source pages, topics, and entities through local hybrid retrieval.
- Show ranked results with snippets and why they matched.
- Produce a short synthesis grounded in those results.
- Let the user open the original Markdown page or source page immediately.
- Let useful answers be saved back into the wiki when the user chooses.

The retrieval layer should be local even when the synthesis model is cloud-hosted. Pige may send only the selected grounded context to the configured language model after local retrieval has prepared it. Context source selection, snippet budgets, citations, memory injection, and conversation compaction are governed by `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`.

UI rule:

- Do not create a separate default "Ask" or "Search" navigation entry in v0.1.
- Full search views can exist as expanded result states from Home, not as a competing primary entry.

### 6.9 Note Agent

The Note Agent is a contextual Agent panel attached to an opened note.

It should help the user interact with the current note without losing reading context:

- Ask questions about the current note.
- Explain a selected passage.
- Find related notes.
- Suggest backlinks.
- Summarize or restructure the note.
- Produce proposed edits that can be previewed before applying.

### 6.10 Selection Actions

Selection actions are lightweight commands shown when the user selects text in a note.

Examples:

- Copy.
- Quote into capture.
- Translate.
- Polish.
- Expand.
- Shorten.
- Summarize.
- Explain.
- Create note from selection.
- Ask Agent about selection.

Read-only actions may return inline results. Mutating actions should preview changes or create confirmation proposals.

### 6.11 Bundled Toolchain And Local Tool Manager

The bundled toolchain makes supported knowledge workflows available without asking the
Agent or user to improvise dependency installation during a job. Local Capabilities
makes readiness, optional downloads, repair, and local/cloud boundaries visible without
becoming a general tool marketplace. Normative product behavior is in section 16;
technical identity and packaging are owned by Technical Architecture, Release
Engineering, and the dependency manifests.

#### 6.11.1 Local Database

The local database exists to make search, Library, links, jobs, retrieval, and memory
fast. It is never the only copy of knowledge; deleting or rebuilding it can degrade
speed and derived views but cannot delete Markdown or source evidence. Its complete
contract is owned by Local Database Design, Technical Architecture, and Data
Architecture.

### 6.12 Local RAG Pack

The Local RAG Pack is Pige's built-in local retrieval substrate. It hides embedding,
indexing, and reranking setup behind product defaults, keeps lexical search usable when
optional assets are absent, and sends only selected cited context for cloud synthesis.
Normative product behavior is in section 14; runtime, storage, context, and performance
details remain in their specialized owners.

### 6.13 Agent Memory

Agent Memory is distinct from the compiled wiki:

- The wiki is the user's knowledge artifact.
- RAG retrieves notes, sources, and extracted artifacts.
- Agent Memory guides future behavior using local, provenance-linked preferences,
  corrections, and workflow lessons.
- Memory can help interpret intent, but it should not be treated as external evidence unless the user explicitly asks about memory itself.

Normative user controls are in section 15. Memory layers, files, provenance, recall,
indexes, prompt injection, and conversation relationships remain in Agent Memory Design,
Data Architecture, and Context Assembly.

### 6.14 Skill Manager

Skill Manager lets a user explicitly stage, inspect, enable, disable, update, export, and
uninstall repeatable personal-knowledge workflows. It never turns ambiguous capture
into a silent install. Normative product behavior is in section 17; formats, metadata,
storage, capability vocabulary, and security boundaries remain in their specialized
owners.

### 6.15 Internationalization

Pige separates app language from content language. v0.1 UI locales:

- `zh-Hans`: 简体中文.
- `en`: English.
- `ja`: 日本語.
- `ko`: 한국어.
- `fr`: Français.
- `de`: Deutsch.

The UI locale, source language, generated knowledge language, query language, OCR hints,
and dictation language are distinct concepts. The default experience preserves source
language and answers in the query language when possible. Exact locale catalogs,
metadata, fallback, formatting, IME, CJK retrieval, OCR, and speech rules are owned by
`docs/I18N_DESIGN.md`.

### 6.16 Pi Package Manager

Pi Package Manager is a deliberately narrow extension surface for packages that improve
personal knowledge workflows. Curated recommendations precede advanced community
search; the default product never resembles a general Agent marketplace. Normative
product behavior is in section 18; package metadata, trust, lifecycle, write mediation,
and permissions remain in their specialized owners.

### 6.17 Vault Runtime Semantics

Pige's vault is a normal local folder. The first run and Settings let the user create or
open a compatible vault, see where notes and managed source copies live, reveal the
vault in the system file manager, and switch recent vaults without deleting files.

v0.1 product rules:

- One vault path has at most one active Pige window; simultaneous multi-vault work is
  outside v0.1.
- The active path is a machine-local preference, not portable vault identity.
- External Markdown changes are never silently overwritten; a conflict becomes a
  visible proposal.
- Agent actions never rewrite source evidence. Deletion is explicit and trash-first.
- Switching vaults pauses or closes current work safely before services reopen.
- Moving a vault is not a simple inline setting in v0.1. The supported path is to reveal,
  move with the operating system, and open the compatible folder, or restore into a new
  folder.
- Index/database repair is visibly separate from durable note storage and cannot delete
  the knowledge source of truth.

Default paths, root identity, settings fields, atomic writes, external-change detection,
job compaction, durable/rebuildable inventories, backup behavior, and migration safety
are owned by `docs/ONBOARDING_AND_FIRST_RUN.md`, `docs/SETTINGS_AND_PREFERENCES.md`,
`docs/SOURCE_STORAGE_STRATEGY.md`, `docs/DATA_ARCHITECTURE.md`, and
`docs/SYNC_CONFLICT_AND_MIGRATION.md`.

### 6.18 Accessibility

v0.1 accessibility baseline:

- All primary actions are keyboard reachable.
- Focus states are visible.
- Icon-only buttons have accessible labels and tooltips.
- Home composer, home retrieval results, note reader, settings, and confirmation flows support keyboard navigation.
- UI does not rely on color alone for status.
- Core UI text contrast meets WCAG AA targets.
- App respects OS reduced-motion settings.
- App remains usable at larger system text sizes.
- Error and progress messages are screen-reader understandable.

## 7. Core User Jobs And Observable State Contract

The following jobs define why the capabilities exist. They are decision inputs for AI
Coding Agents, not separate feature backlogs.

| User trigger | Required product outcome | Primary requirement refs |
| --- | --- | --- |
| Paste a useful article URL. | Preserve the source, extract readable content, create a source-backed Markdown result, and connect useful knowledge without asking for a folder first. | `PIGE-CAP-001`, `PIGE-INGEST-003`, `PIGE-KNOW-006` |
| Capture a messy idea. | Preserve it immediately and produce a readable titled note when a model is available. | `PIGE-CAP-001`, `PIGE-KNOW-006` |
| Drop a PDF, document, screenshot, or scanned page. | Preserve the input, recover useful text and evidence locators with the best available local parser/OCR path, and expose any partial result or warning. | `PIGE-INGEST-003`, `PIGE-INGEST-004` |
| Ask about previously captured knowledge. | Return ranked relevant notes and a grounded synthesis with inspectable citations; allow a useful answer to become durable knowledge. | `PIGE-SEARCH-001`, `PIGE-CONTEXT-001`, `PIGE-CONTEXT-002` |
| Open or select text in a note. | Support reading, contextual questions, and reversible transformations without losing the note or its sources. | `PIGE-UI-001`, `PIGE-UI-005`, `PIGE-UI-006` |
| Correct Pige or explicitly ask it to remember a preference. | Apply the current correction, and keep any durable memory local, inspectable, scoped, and reversible. | `PIGE-MEM-001` |
| Inspect a growing vault. | Find broken links, weak provenance, duplicate-topic candidates, stale knowledge, and missing connections without silently reshaping the wiki. | `PIGE-KNOW-005` |
| Move or recover the knowledge base. | Back up and restore durable knowledge and evidence into a fresh folder, then rebuild derived search state. | `PIGE-BACKUP-001`, `PIGE-BACKUP-002`, `PIGE-BACKUP-003`, `PIGE-BACKUP-004` |

User-visible processing states:

| Product state | User-visible contract |
| --- | --- |
| Ready to capture | Home accepts supported input without requiring a mode, taxonomy, or model configuration. |
| Saved locally | The durable source record/reference exists before parser or model work starts. |
| Organizing | Bounded parser, OCR, retrieval, or Agent work is active and progress is visible. |
| Complete | The UI distinguishes what was created, updated, skipped, or warned and links to durable results. |
| Needs confirmation | A specific risky change is previewed with the evidence and consequence needed for a decision. |
| Paused; source safe | A dependency, permission, unsupported capability, or recoverable failure blocks further work, but the input remains preserved and a single repair/resume action is available. |

State rules:

- Capture preservation MUST precede parsing, OCR, model calls, retrieval synthesis, and
  wiki compilation.
- Retry, resume, crash recovery, and model configuration MUST NOT duplicate sources,
  conversations, pages, proposals, or applied operations.
- When Home intent is ambiguous, Pige MUST preserve the input first, expose the inferred
  result, and allow the user to correct save/query/install/memory intent without hidden
  destructive rollback.
- User-facing state names are product copy, not a competing executable Job vocabulary.
  Their mapping to durable states and repair actions is owned by
  `docs/JOB_OPERATION_AND_RECOVERY.md` and `docs/API_AND_IPC_DESIGN.md`.

## 8. v0.1 Public Alpha Scope

Scope interpretation:

- P0 is the release-level acceptance scope for `v0.1 Public Alpha`, not the implementation scope for a single task, PR, AI session, or phase.
- Implementation must follow `docs/MILESTONES.md` and `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`, building vertical slices that preserve data safety and user-visible usefulness at each step.
- A feature may appear in P0 while still being scheduled for a later implementation phase. Future agents must not treat the whole P0 list as one work item.
- Any task that moves a P0 item to P1/P2, or promotes P1/P2 into P0, must update PRD, Milestones, Playbook, Spec Traceability, and Decision Log together.

### 8.1 P0 Must Have

Home and capture:

- Chat-like bottom home composer.
- Default empty state with only the essential home composer visible.
- Home composer supports both capture and knowledge-base questions.
- Home composer does not expose mode chips; intent classification is handled by the Agent and can be corrected through normal conversation.
- Whole-window drag-and-drop hot zone.
- On-device voice input on supported macOS 26-or-later systems.
- Plain text capture.
- Markdown and plain text file ingest.
- Web URL ingest with a preserved readable local snapshot and visible bounded-failure behavior.
- PDF ingest with local text extraction.
- Word `.docx` ingest.
- PowerPoint `.pptx` best-effort ingest.
- Image and screenshot ingest with OCR where a supported local engine is available.
- OCR fallback for image-heavy PDFs and PowerPoint slides.
- Local tool manager for explicitly installing and managing a supported optional OCR fallback.
- Processing status visible in the home timeline.
- Status states for queued, processing, failed, and confirmation-needed captures.

Agent output:

- Title generation.
- Summary.
- Tags.
- Category/topic suggestion.
- Key entities.
- Related note suggestions.
- Markdown page generation.
- Source summary page generation.
- Basic index update.
- Append-only log update.
- Source references with enough detail to trace claims back to source files, URLs, pages, or text spans.
- Change summary that separates created, updated, skipped, failed, and confirmation-needed actions.

Vault:

- User-selected local knowledge root folder.
- Independently configurable managed-copy location for source copies and web snapshots; derived artifacts remain portable with the vault.
- Default vault path per platform.
- Markdown storage.
- Managed source copies remain durable and resolvable under the selected managed-copy location.
- Extracted parser and OCR artifacts remain durable, portable, and regenerable without changing source evidence.
- Markdown source pages remain part of the portable knowledge root.
- Compiled knowledge pages remain part of the portable knowledge root.
- User-visible media remains portable with the knowledge that references it.
- Vault-scoped Agent memory remains inspectable and follows the vault backup policy.
- Complete chat history remains reference-based and portable without duplicating large bodies.
- Vault-scoped Pige Skills remain inspectable and portable.
- Local database files remain rebuildable working state rather than knowledge truth.
- Pige-managed deletion and archive remain recoverable through trash-first lifecycle rules.
- `index.md`, `log.md`, and `PIGE.md`.
- Stable YAML frontmatter schema.
- Atomic write and external-change conflict handling for Markdown pages.
- Archive/trash-first deletion policy.
- Stable IDs and conflict metadata prepared for future sync.
- Runtime capability boundaries prepared for future mobile apps and optional cloud/self-hosted Agent execution.

Scale and platform:

- Design target: 10,000 notes/source pages, 100 GB vault, and 100,000 retrieval chunks.
- Minimum v0.1 platform: macOS 26 or later.
- Windows target: Windows 11 and Windows 10 when the packaged runtime, updater, and bundled tools pass release tests.
- Linux is deferred from v0.1.
- Core installer meets the release size ceiling without bundling optional model/OCR
  downloads.

Navigation:

- Collapsible sidebar.
- Home as the single default input and knowledge-retrieval surface.
- Processing and confirmation-needed cards surfaced from Home when relevant.
- Library view with an Agent-maintained note tree plus notes, sources, topics, and tags.
- Expanded sidebar should expose the Library tree directly, including at least three levels of hierarchy when available, so browsing does not require a separate Library page first.
- Knowledge Tree as a semantic tree of domains, topics, concepts, sources, fragments, and backlinks, distinct from the Library's category/folder tree.
- Knowledge Tree visual encoding: trunk thickness represents domain weight, branch thickness represents topic weight, leaf count/size/color depth represents fragmented knowledge quantity and density.
- Home knowledge retrieval with ranked results and grounded synthesis.
- Note reader with source metadata and related pages.
- Note Agent side panel.
- Selection actions in note content.
- Skill Manager for pure Skills and permission-scoped external/Web Skills.
- Curated Pi Package Manager for reviewed package install, disable, uninstall, and update flows.
- Elegant permission dialogs for sensitive Agent, Skill, package, model, file, network, shell, and delete actions.
- Permission Settings with Ask Every Time, Remember Scoped Grants, and YOLO Full Access modes.
- Settings IA grouped as Basic, Knowledge Base, AI, Security, Extensions, and System.
- Setting ownership, scope, storage, backup behavior, permission requirement, and apply behavior are governed by `docs/SETTINGS_AND_PREFERENCES.md`.
- Knowledge Base settings must include a real Vault & Note Storage page for local note storage: current vault name, active vault path, knowledge root path, managed source-copy path (the v1 UI compatibility label is Source asset root), default source storage strategy, reveal in file manager, open existing vault folder, create new vault, recent vaults, backup, restore, trash policy, and safe index repair entry points.
- Models settings contain BYOK provider details, model list status, and one default Pi Agent model. Advanced/Fast model assignment is not a v0.1 visible setting unless a real Pi-compatible routing layer exists.
- Local Capabilities settings contain local RAG, embeddings/reranking downloads, OCR, speech input, document parsers, and bundled toolchain health.
- Permissions & Privacy settings contain permission modes, saved grants, API key storage, cloud-send policy, secret redaction, and YOLO.
- Skills and Pi Packages live under Extensions, not under Models.

Internationalization:

- UI localization for Simplified Chinese, English, Japanese, Korean, French, and German.
- System locale default with Settings override.
- Language metadata for captured sources, generated pages, OCR artifacts, chunks, and memory records where useful.
- Home knowledge retrieval can accept and answer in the user's query language.
- Source language is preserved by default.
- CJK-friendly lexical search fallback plus multilingual semantic retrieval through Local RAG.

Accessibility:

- Keyboard reachable primary flows.
- Visible focus states.
- Accessible labels for icon buttons.
- Contrast-safe status and error states.
- Reduced-motion support.

Models:

- BYOK settings.
- OpenAI provider.
- Anthropic provider.
- OpenAI-compatible provider.
- Anthropic-compatible provider.
- No user-facing per-workflow model selection in v0.1. Pige uses sensible internal defaults after one provider is connected.
- No required user-facing embedding or reranker provider setup. Local RAG uses Pige-managed local models.
- After BYOK setup, bounded selected context uses the configured provider with visible status; stricter confirmation remains configurable.
- API keys are stored encrypted by default through OS keychain or encrypted local storage; plaintext portable/developer mode is explicit and warned.

Local RAG:

- Built-in local inference engine for embedding and retrieval support.
- Explicit, verified Pige-managed download path for the default local embedding asset.
- Local semantic and lexical retrieval indexes as rebuildable working state.
- Local reranking when a supported reranker model is installed; otherwise use hybrid scoring without exposing extra setup to the user.
- Model files are explicit cloud downloads in v0.1; manual local model import is not supported.

Local database:

- Rebuildable local working data for Library views, search, relationships, job status,
  retrieval, memory lookup, and rebuild status.
- Internal storage technology can be replaced without changing product workflows or
  durable vault data.
- Vault database is rebuildable from durable files.
- Machine-local app database is excluded from vault backups by default.

Agent memory:

- Pige-native local memory core for stable preferences, corrections, recurring workflows, and vault-maintenance lessons.
- Layered memory model from events to atoms, scenarios, and compact profile/policy.
- Inspectable memory text stored locally with rebuildable memory indexes.
- Explicit remember, undo, inspect, disable, export, delete, and reset controls.
- Secret scanning and confirmation gates for sensitive or broad behavior-changing memories.
- Vault-scoped Agent memory is included in backup by default, with an explicit exclude option.

Conversation history:

- Complete reference-based chat history retained as portable vault state.
- Large pasted content, source bodies, files, and saved answers are stored once and referenced from conversation events.
- Conversation history is included in backup by default, with an explicit exclude option.

Bundled toolchain:

- Core Agent helper tools are available immediately after install.
- The supported Agent, shell/runtime, PDF, and Office parser toolchain is version-pinned per release.
- Agent jobs must not attempt ad hoc dependency installation during normal capture, parsing, retrieval, or wiki maintenance.
- If a bundled tool is missing or damaged, Pige should show a repair action in Settings instead of asking the Agent to improvise.

Pi packages:

- Search and inspect Pi package catalog metadata.
- Show curated packages for knowledge management, retrieval, memory, local inference, source capture, workflow, and safety.
- Install only after explicit user confirmation.
- Show package permissions and data boundary before install.
- Support disable, uninstall, update, and version pinning.

Skills:

- Install pure Markdown Skills and external/Web Skills from URL, local `.md`, local `.zip`, or reviewed package sources.
- Chat can initiate Skill installation when the user explicitly asks.
- Stage Skill installs for preview and confirmation.
- Enable, disable, uninstall, export, and update Skills.
- Execute sensitive Skill capabilities only through Pige permission prompts.
- Show capability scope and allow/deny controls before file writes, shell, network, package, brokered credential use, model, settings, or destructive operations; raw-secret access is rejected rather than offered as a grant.

Native platform capabilities:

- macOS 26 or later: on-device voice transcription through the supported platform capability.
- macOS 26 or later: local document and text recognition through the supported platform capability.
- Windows on supported hardware/runtime combinations: local text recognition when the platform capability is available.
- Unsupported OS or hardware: an explicitly installed optional local OCR fallback.
- Windows: voice input can be unavailable in v0.1 with a clear disabled state.
- Older macOS versions: voice input can be unavailable or marked as unsupported instead of falling back to lower-accuracy APIs by default.
- Linux support is deferred from v0.1.

Backup:

- Export `.pige-backup.zip`.
- Restore from `.pige-backup.zip`.
- API keys excluded by default.
- Agent memory and conversation history included by default.

Release:

- Reproducible public-alpha release pipeline on the repository's supported release infrastructure.
- Automatic update support from one compatible public-alpha build to the next.
- Signed/notarized artifacts where release credentials are available.
- Release notes, dependency manifest, and license notices for every release.

Safety and trust:

- New source pages and simple new notes may be auto-applied.
- Risky edits must be staged for confirmation.
- Every Agent write operation must be logged with job ID, model profile, source IDs, and changed paths.
- External file changes must not be overwritten silently.
- No product analytics, background telemetry, or automatic crash/diagnostic upload in v0.1; support export is local, user-initiated, previewed, and redacted.
- Diagnostics, logs, crash recovery summaries, and support bundles follow `docs/DIAGNOSTICS_AND_OBSERVABILITY.md`.
- Packaged builds meet the owner-defined idle, ordinary-use, and post-heavy-Job memory
  ceilings on every declared reference platform.

### 8.2 P1 Should Have

- More advanced OCR layout recovery beyond the v0.1 baseline, including richer table reconstruction and handwriting handling.
- Richer knowledge health actions beyond the first report.
- Rich approve/reject flow for suggested links and wiki edits.
- Advanced retrieval tuning, saved ranking profiles, and larger optional local embedding or reranker models.
- Saved queries and smart collections for recurring retrieval needs.
- Compare mode for synthesizing differences across several notes or sources.
- Retrieval history so useful searches can be revisited or saved as wiki pages.
- Git-friendly change history.
- Import from an existing Obsidian vault.

### 8.3 P2 Later

- Cloud or device-to-device sync.
- Browser extension.
- Mobile capture.
- Remote Agent backend for Web/mobile clients.
- Mobile Lite client for capture, offline capture queue, reading, cached/metadata search, and queued remote/desktop processing.
- Audio/video transcription.
- Team vaults.
- Collaboration workflow.
- Fully open unreviewed third-party plugin marketplace.
- Advanced graph analytics and dense network visualization.

## 9. Explicit Non-Goals For v0.1

- No cloud account requirement.
- No built-in paid model gateway as the only option.
- No proprietary database as the only storage layer.
- No real-time multiplayer collaboration.
- No mobile app.
- No Web app.
- No remote Agent backend.
- No automatic sync.
- No complex force-directed graph, graph analytics, or dense visual knowledge network in the first release. v0.1 may include a simple, explainable Knowledge Tree visualization.
- No unreviewed free-for-all plugin marketplace. v0.1 includes a curated Pi package manager, but community package installation must be explicit, permission-scoped, and reversible.
- No attempt to parse every file type perfectly in the first release.

## 10. Input Handling Requirements

Sections 10.1–10.6 define bounded capabilities, not a fixed workflow; section 11.1 owns
Agent selection and degraded behavior.

### 10.1 Text

Plain text entered in the capture box MUST first be saved as a managed text source. When
a tested default model is available, the ingest workflow MUST transform it into at least
one readable Markdown page. Without that model, preservation still completes, while
knowledge compilation enters the visible `Paused; source safe` state and resumes without
duplicate output after setup.

Minimum output:

- Title.
- Cleaned Markdown body.
- Summary.
- Tags.
- Entities.
- Source reference.

#### 10.1.1 Voice Input

Voice input is a capture-input convenience, not a separate audio-note feature in v0.1.

macOS requirements:

- Use the supported high-quality on-device speech capability on macOS 26 or later.
- Prefer the highest-accuracy supported on-device transcription configuration.
- Show live transcription in the input box when available.
- Keep finalized transcription as editable text before submission.
- Ask for microphone permission only when the user first starts voice input.
- Do not send microphone audio to cloud model providers for dictation.

Unsupported platforms:

- On Windows, hide or disable the microphone button for v0.1.
- On older macOS versions, show an unsupported message rather than silently using older lower-accuracy APIs.

Minimum output:

- Final transcript inserted into the home composer.
- Optional raw transcript artifact if the user submits the voice capture.
- Normal ingest flow after submission.

Platform API selection, availability probes, language assets, permissions, artifacts,
and adapter behavior are owned by `docs/I18N_DESIGN.md`,
`docs/ONBOARDING_AND_FIRST_RUN.md`, and the runtime capability contracts.

### 10.2 Markdown And Plain Text Files

Markdown and text files should be parsed locally. Markdown structure should be preserved where useful.

Minimum output:

- Source record with the selected storage strategy.
- Managed copy or verified original-file reference according to the selected v0.1
  storage outcome.
- Extracted artifact when useful.
- Normalized source summary page.
- Wiki page or wiki page updates.

### 10.3 Web Links

When the user pastes a URL, Pige should:

1. Detect the URL.
2. Use the bounded static web-capture path to retrieve it without executing page scripts.
3. Store a raw HTML snapshot where legally and technically possible.
4. Extract readable article text, title, author, publish date, canonical URL, site name, and image references.
5. Generate a Markdown source page.
6. Compile useful knowledge into the wiki.

Future fallback:

- For JavaScript-heavy pages, a browser-rendered extraction path may be added.

Fetch implementation, redirects, SSRF protection, response limits, snapshots, parser
artifacts, and failure taxonomy are owned by `docs/PARSER_INGEST_SPEC.md`,
`docs/SECURITY_THREAT_MODEL.md`, and `docs/TECH_ARCHITECTURE.md`.

#### 10.3.1 Skill Install Intent

Links, Markdown files, and ZIP files can also be Skill install sources, but only when the user's intent is explicit.

Examples:

- "Install this Skill: <url>"
- "把这个 Markdown 当成 Skill 安装"
- "安装这个 zip 里的 Skill"

Requirements:

- If the user intent is explicit, route the input to Skill Manager staging.
- If intent is ambiguous, ask for confirmation or treat the input as ordinary knowledge capture.
- Skill installation must show a preview before enabling.
- Skill install flow must not execute code, scripts, or package install hooks.
- Files that contain executable or package-backed content must be staged with warnings and declared capabilities. They can be enabled only through a reviewed runtime adapter, Package Manager, or Local Tools flow, and sensitive runtime actions require Permission Broker mediation.

### 10.4 PDF

PDF files should be preserved as source assets without modifying the original. Pige should extract text locally and preserve page references when possible.

Minimum output:

- Source record.
- Managed PDF copy or original-path reference according to source storage strategy.
- Extracted text artifact.
- OCR artifact for rendered pages when embedded text is missing, sparse, or obviously poor.
- Source summary Markdown page.
- Wiki updates.

### 10.5 Word And PowerPoint

Word and PowerPoint support should be included in the first highly usable release as best-effort local extraction. Perfect fidelity is not required, but the user should be able to drop common `.docx` and `.pptx` files and receive useful extracted text plus preserved originals.

Minimum output:

- Source record.
- Managed file copy or original-path reference according to source storage strategy.
- Extracted text.
- Extracted images when the source format exposes embedded image assets or a page/slide render path is available.
- OCR output from embedded or rendered images when ordinary text extraction misses important visible text.
- Source summary Markdown page.
- Wiki updates.

### 10.6 Images, Screenshots, And OCR

Images and screenshots should be first-class capture inputs in v0.1 when a local OCR engine is available.

OCR should also act as a fallback inside document parsing:

- If a PDF page has no embedded text, render the page and OCR it.
- If a PDF page has very little embedded text but substantial visible text, add OCR as a second pass.
- If a PowerPoint slide contains screenshots or image-only text, OCR those regions or rendered slide images.
- If OCR confidence is low, keep partial text but attach a warning to the source page.

Engine priority:

1. Use a supported high-quality on-device platform OCR capability when runtime probes
   prove it is ready.
2. Otherwise offer an explicit optional local OCR fallback through Local Capabilities.
3. If no OCR path is runnable, preserve the source and native extraction, expose the
   limitation, and keep the job safely resumable when the missing capability matters.

Minimum OCR output:

- Source record and source asset reference or managed copy.
- Extracted plain text.
- Page, slide, image, or region reference.
- Engine name and version.
- Confidence score where available.
- Bounding boxes or line/region geometry where available.
- Warning when OCR was partial, low confidence, or skipped.

OCR should remain local-first. v0.1 should not send images to cloud OCR providers unless the user explicitly chooses a future cloud OCR integration.

Parser-selected page routing, sparse/image-only decisions, sidecars, checksums, engine
adapters, confidence handling, bounds, tool identity, and platform-specific APIs are
owned by `docs/PARSER_INGEST_SPEC.md`, `docs/PERFORMANCE_AND_RELIABILITY.md`,
`docs/TECH_ARCHITECTURE.md`, and `docs/I18N_DESIGN.md`.

## 11. Agent Workflows

### 11.1 Ingest

The ingest workflow happens when a new source enters Pige.

Required invariants and outcomes:

1. Pige validates the capture envelope, creates a Source Record, and preserves a managed
   copy or verified original reference before expensive work.
2. After preservation, Pi Agent is the sole semantic orchestrator. It receives bounded
   source metadata and available-tool contracts, then chooses inspection, extraction,
   OCR, retrieval, organization, analysis, and knowledge-write calls from their results.
3. Parser, OCR, retrieval, and write services execute only an Agent-selected scoped tool
   call or resume that same authorized call. They enforce deterministic limits, policy,
   validation, provenance, and commit fences, and can refuse unsafe work.
4. The result is source-backed, schema-valid Markdown plus citations, index/log
   projections, an operation summary, and visible created/updated/skipped/failed or
   confirmation-needed status.
5. Risky changes are staged for confirmation. If the Agent, model, or required tool is
   unavailable, the preserved source remains visible and resumable; no hidden semantic
   pipeline substitutes for the Agent.

Example result:

> Processed 1 web article. Created 1 source page, updated 2 concept pages, added 5 tags, and found 3 related notes.

### 11.2 Home Query

The home query workflow is Agent-orchestrated over the maintained Markdown knowledge
base first, then source records, artifacts, and available original sources if needed.
It is triggered from the same Home Composer used for capture. Local search may still
serve a direct deterministic fallback when no model is configured, but it does not
pretend to be Agent synthesis.

Required outcomes:

1. Pi Agent interprets the request and chooses scoped retrieval tools; tool-internal
   lexical, metadata, vector, and reranking policy remains deterministic and locally
   available according to capability state.
2. The Agent can inspect ranked results, request another bounded retrieval when useful,
   and build a cited Context Pack without receiving the whole vault.
3. The product returns ranked inspectable notes and sources plus a concise grounded
   synthesis, visible limitations, follow-ups, and an optional validated knowledge write.
4. Users can open any result directly, and valuable answers can become cited Markdown
   only through the same bounded write/confirmation boundary as other Agent changes.

Query output should feel closer to "search results plus summary" than "chat answer only."

#### 11.2.1 Note-Level Agent Workflow

When a note is open, the Note Agent uses the current note as the primary context.

Required behavior:

- Current note context is always visible to the Agent.
- User can ask about the note, selected text, backlinks, sources, or related pages.
- Read-only answers stay in the side panel.
- Proposed note edits become previews or confirmation proposals.
- The Agent should cite current-note sections and linked sources where possible.

#### 11.2.2 Selection Action Workflow

When the user selects note text, Pige may show a compact action menu.

Action categories:

- Clipboard: copy, copy as quote, copy Markdown.
- Transform: translate, polish, shorten, expand, change tone.
- Understand: explain, summarize, extract key points.
- Organize: create note from selection, add backlink, add tag, turn into claim/question.
- Ask: send selection to Note Agent as context.

Mutating actions should not silently rewrite a note unless the action is clearly local and reversible. Larger edits should use preview or confirmation.

### 11.3 Compile

Compile is the act of turning sources and conversations into durable wiki pages.

The Agent may:

- Create new concept pages.
- Update entity pages.
- Add claims with citations.
- Add questions.
- Add backlinks.
- Merge duplicates when approved.
- Flag conflicts.

### 11.4 Lint

Lint is the health-check workflow.

The Agent checks:

- Orphan pages.
- Missing source references.
- Conflicting claims.
- Stale summaries.
- Duplicate topics.
- Broken links.
- Overly broad tags.
- Important uncreated concept pages.

v0.1 may implement lint as a button that produces a report without automatically changing files.

### 11.5 Action Risk And Confirmation

Agent actions use action risk, evidence completeness, structural validation,
reversibility, and policy—not an uncalibrated model confidence number—to determine
whether work can apply automatically.

- Auto-apply: preserve source according to storage strategy, create parser artifacts, create source pages, create simple new notes, append to `log.md`, and update local database/index caches.
- Auto-apply with summary: validated, reversible, low-risk index, backlink, tag,
  relation-suggestion, or metadata work that does not substantially rewrite existing
  knowledge.
- Stage for confirmation: substantial edits to existing pages, renames, merges,
  contradiction markers, broad topic reshaping, external file conflicts, ambiguous
  memories, or any action whose evidence or validation is insufficient.
- Require explicit confirmation: deletion, destructive cleanup, editing `PIGE.md`,
  changing vault structure, installing packages or tools, enabling externally sourced
  Skills, or another always-confirmed action defined by the security contract.
- Raw secrets are never offered as Agent/extension output. Eligible credentials are used
  only through a one-action brokered capability without exposing key bytes.
- A broad Permission Broker mode, including YOLO Full Access, never replaces an
  always-confirmed destructive, settings, or data-egress decision.

This keeps capture fast while preventing the Agent from quietly reshaping the user's knowledge base in surprising ways.

The executable risk vocabulary, proposal/operation lifecycle, permission modes,
always-confirmed classes, and policy enforcement are owned by
`docs/JOB_OPERATION_AND_RECOVERY.md`, `docs/SECURITY_THREAT_MODEL.md`,
`docs/AGENT_RUNTIME_POLICY_CONTEXT.md`, and the shared schemas.

## 12. Markdown Page Requirements

Generated source and knowledge pages are portable, validatable Markdown with stable
identity, readable content, provenance, and relationships that remain useful outside
Pige. Root control files and managed blocks remain inspectable rather than becoming a
proprietary document format.

The executable frontmatter fields, page types, identifiers, timestamps, language,
provenance, body sections, control files, and managed-block rules are owned only by
`docs/MARKDOWN_SCHEMA.md` and the shared schemas. This PRD MUST NOT carry a second
frontmatter example or field catalog.

### 12.1 Provenance And Citations

Pige must preserve enough provenance to make generated knowledge inspectable:

- Source page links to the source record, source asset, URL, or pasted input artifact.
- Generated claims cite one or more source references.
- PDF references should keep page numbers when available.
- Web references should keep canonical URL and capture timestamp.
- Extracted text artifacts should support stable locators for generated text blocks.
- Generated pages should distinguish source-backed facts from Agent interpretation.

Citation syntax, locator grammar, machine-readable metadata, checksums, and rendering
are owned by `docs/MARKDOWN_SCHEMA.md`, `docs/PARSER_INGEST_SPEC.md`, and
`docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`. The Reader may render citations more
elegantly, but the stored Markdown keeps the owner-defined portable fallback.

### 12.2 Markdown Reading And Editing Experience

Markdown is not only an implementation detail. It is the main knowledge surface the user will read, search, quote, edit, and trust.

v0.1 requirements:

- Render Markdown as a polished reading surface, with a calm, artifact-like presentation rather than a raw preview pane.
- Keep generated Markdown readable both inside Pige and in external Markdown tools.
- Support common GitHub-Flavored Markdown patterns: headings, paragraphs, lists, task lists, tables, code blocks, inline code, blockquotes, links, images, and horizontal rules.
- Support Pige-specific patterns: wiki links, source citations, related-page blocks, and frontmatter-derived metadata.
- Hide YAML frontmatter by default and show it as a compact metadata header or inspectable details panel.
- Use comfortable reading width, clear heading hierarchy, generous but not wasteful spacing, accessible contrast, and stable layout.
- Code blocks should show language labels where available, copy actions, syntax highlighting if available, and safe horizontal scrolling.
- Tables should be readable, responsive, and horizontally scrollable instead of breaking the note layout.
- Images should be constrained to the reading column, support captions or source references, and never overflow the note pane.
- Selection actions must work on rendered Markdown text, not only in source-edit mode.
- Editing should preserve plain Markdown. v0.1 may start with a source editor plus rendered read/preview mode, but it must not introduce a proprietary document format.
- User edits must preserve valid frontmatter. If wiki links, source citations, or Pige-managed sections become invalid, saving should show validation errors or create a repair proposal.
- Agent-generated pages should be formatted for both human reading and future Agent maintenance.

## 13. OCR And Local Tool Requirements

OCR is a core ingest capability because real knowledge sources often contain text as
pixels. The default mode automatically chooses the best ready local capability. The
user may select a supported platform path, explicitly install an optional local
fallback, or disable OCR while preserving images and recording that OCR was skipped.

Product requirements:

- Local Capabilities shows ready, unavailable, unsupported, download-needed, disabled,
  or repair-needed state and one primary action.
- Optional downloads show size and local/cloud boundary before consent.
- Removing or changing an OCR capability never deletes source evidence or knowledge.
- OCR artifacts remain portable with the vault; binaries, runtimes, and model assets do
  not enter vault backups by default.
- Reprocessing remains explicit, provenance-linked, and non-destructive.
- Low-confidence, partial, or skipped OCR remains visible instead of becoming
  confident-looking knowledge.

Platform APIs, fallback packages, versions, language assets, presets, availability
probes, page routing, artifact metadata, rebuild behavior, and execution boundaries are
owned by `docs/PARSER_INGEST_SPEC.md`, `docs/TECH_ARCHITECTURE.md`,
`docs/I18N_DESIGN.md`, `docs/PERFORMANCE_AND_RELIABILITY.md`, and
`docs/RELEASE_ENGINEERING.md`.

## 14. Local RAG Requirements

RAG is an Agent capability, not a separate user-facing model-provider setup.

v0.1 local RAG requirements:

- Provide Pige-managed local embedding and optional reranking without requiring another
  provider account or API key.
- Download local model assets only with explicit user consent.
- Store model assets as machine-local data and indexes as rebuildable working state.
- Keep local retrieval usable without network after models are downloaded.
- Keep a lexical fallback available when no local embedding model is installed.
- Do not send the full vault to a cloud model for retrieval.
- Only send selected snippets and citations to the configured language model when synthesis is requested.
- Apply the context budget and citation rules from `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`.
- Let users disable local semantic indexing if they want the smallest local footprint.

RAG should be invisible when healthy. The UI should expose status only when a model needs download, indexing is in progress, storage is large, or retrieval quality needs troubleshooting.

The default asset identity, download verification, runtime, dimensions, index paths,
chunking, score fusion, reranking admission, thresholds, and performance budgets are
owned by `docs/TECH_ARCHITECTURE.md`, `docs/RELEASE_ENGINEERING.md`,
`docs/LOCAL_DATABASE_DESIGN.md`, `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`, and
the dependency manifests.

## 15. Agent Memory Requirements

Agent Memory is a built-in Pige capability, not a required Pi package.

v0.1 memory requirements:

- Store memory locally.
- Keep memory inspectable as text.
- Separate Agent memory from wiki pages and source pages.
- Support vault-scoped memory first.
- Store global user/device memory outside the vault unless the user explicitly exports it.
- Index memory with local lexical search and, when available, the Local RAG Pack.
- Inject only compact, relevant memory into Agent prompts.
- Never inject the full memory store into the model context.
- Keep memory provenance linked to the conversation, capture, confirmation decision, or Agent job that produced it.
- Let users approve or undo durable memory writes.
- Require confirmation for sensitive, identity-level, or broad behavioral memories.
- Scan memory candidates for secrets before persistence.
- Let users inspect, edit, disable, export, delete, and reset memory.

Recall policy:

- Use memory for intent interpretation, style, workflow choices, and avoiding repeated mistakes.
- Use wiki and source pages for factual answers by default.
- When memory affects an Agent action, expose a short reason such as "using your saved preference for concise summaries".
- If memory conflicts with the user's current instruction, the current instruction wins.

Memory layers, paths, schemas, provenance fields, consolidation, indexing, injection,
backup, deletion, and external research references are owned by
`docs/AGENT_MEMORY_DESIGN.md`, `docs/DATA_ARCHITECTURE.md`,
`docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`, and the dependency registry.

## 16. Bundled Toolchain Requirements

The bundled toolchain is part of the product experience because supported workflows
must behave predictably across v0.1 platforms without making users debug dependencies.
Linux support is deferred.

v0.1 bundled toolchain requirements:

- Required Agent, parser, document, OCR-routing, and local-retrieval capabilities are
  ready after install or show one visible repair action.
- Ordinary user jobs never ask the Agent to install a missing parser, runtime, shell,
  executable, or package.
- Work that does not inherently require network remains usable offline after install,
  except for explicit optional model downloads.
- Tool removal, repair, or update never deletes durable vault data.
- The app can explain whether a capability is local, networked, optional, unavailable,
  or waiting for repair.

Exact tools, runtimes, versions, pins, checksums, licenses, source URLs, platform
packaging, and compiler choices are owned by `docs/TECH_ARCHITECTURE.md`,
`docs/RELEASE_ENGINEERING.md`, the dependency manifests, and repository configuration.

## 17. Skill Extension Requirements

Skill support is a v0.1 extension mechanism, but it must remain knowledge-management focused.

v0.1 Skill requirements:

- Support built-in, vault-scoped, and machine-local Skills under owner-defined storage and
  backup rules.
- Accept owner-defined local, remote, and reviewed package-provided sources only when
  the user's install intent is explicit.
- Stage and inspect the source, identity, scope, files, capabilities, data boundary, and
  warnings before enablement; staging never executes content.
- Require user confirmation before enabling a new Skill.
- Support enable, disable, uninstall, export, and update when the source supports it.
- Log when a Skill materially changes Agent behavior or output.
- Keep sensitive runtime actions paused for a current permission decision unless an
  eligible action is covered by an explicit saved mode; raw-secret and always-confirmed
  actions remain ineligible.

Skill precedence:

- Current user instruction wins over Skill instructions.
- Explicit settings and `PIGE.md` win over Skill instructions.
- Privacy, package permissions, prompt-injection defenses, and confirmation gates cannot be weakened by a Skill.
- User-denied capabilities stay denied until the user changes the permission in Settings.

Exact install formats, metadata fields, scopes, files, capability vocabulary, storage,
backup, precedence, archive validation, executable escalation, and Permission Broker
mapping are owned by `docs/SKILL_EXTENSION_DESIGN.md`,
`docs/SECURITY_THREAT_MODEL.md`, and `docs/DATA_ARCHITECTURE.md`.

## 18. Pi Package Ecosystem Requirements

Pi packages are a major extension ecosystem for Agent capabilities. Pige should support them through a curated package manager rather than ad hoc installs.

v0.1 package manager requirements:

- Show curated recommendations first.
- Keep curated recommendations limited to packages with direct personal knowledge management value.
- Support owner-defined package discovery, inspection, install, disable, uninstall,
  update, repair, version pinning, and rollback where the source makes rollback safe.
- Show identity, source, version, license, trust/disposition, health, data boundary,
  capabilities, and permission changes before install or update.
- Show capability and permission requests before install.
- Require explicit user confirmation for install and update.
- Block package installation during ordinary Agent jobs.
- Route package writes into the vault through Pige-approved write APIs or confirmation proposals.
- Keep package-generated durable outputs inspectable as Markdown or source artifacts when possible.

Package safety rules:

- Packages cannot receive vault-wide read or write access by default.
- Packages cannot write durable vault knowledge or control files without Pige mediation.
- Packages cannot install additional executables during a normal Agent job.
- Packages with network access must declare it.
- Packages with model access must disclose provider and data boundary.
- Package updates should show version change and permission changes before applying.

Catalog sources, metadata fields, package types, trust and health vocabularies,
knowledge-focused categories, excluded categories, install records, storage, curation,
update/pin/rollback mechanics, and current research candidates are owned by
`docs/SKILL_EXTENSION_DESIGN.md`, `docs/TECH_ARCHITECTURE.md`,
`docs/SECURITY_THREAT_MODEL.md`, and the historical
`docs/PI_PACKAGE_RESEARCH.md` where rationale is needed.

## 19. Internationalization Requirements

Pige must be internationalized from v0.1 for the six locales listed once in section
6.15 and the P0 scope ledger.

UI requirements:

- All user-facing UI strings use the owner-defined locale catalogs and formatting rules.
- Support IME composition in the home composer, search, and Markdown editing.
- Ensure compact window layouts do not overflow in German and French.
- Support CJK line breaking in note reader and editor.
- Provide Settings language selector.
- Default to system language when supported.

Content-language requirements:

- Detect or infer source language during ingest.
- Store source language in frontmatter when confidence is sufficient.
- Store language hints in OCR artifacts.
- Preserve source language by default.
- Let user configure a default knowledge language later; v0.1 can default to source/query language.
- Home query answers in query language by default.
- Generated summaries should record output language when it differs from source language.

Retrieval requirements:

- Multilingual lexical search includes a CJK-capable fallback.
- Local semantic retrieval supports the release languages when the selected local asset
  provides that capability.

OCR and speech requirements:

- Pass language hints to the active OCR capability when supported.
- Let users choose preferred OCR languages when the selected engine supports it.
- Use the selected dictation language with the active speech capability when supported.
- Voice input language is separate from app language.

Locale tags, catalog structure, message formatting, Unicode normalization, indexing,
frontmatter fields, line breaking, layout fixtures, OCR/speech adapters, and fallback
behavior are owned by `docs/I18N_DESIGN.md`, `docs/MARKDOWN_SCHEMA.md`, and
`docs/QUALITY_AND_TEST_STRATEGY.md`.

## 20. BYOK Model Requirements

Pige must support BYOK as a product requirement, not a later extension.

v0.1 supports OpenAI, Anthropic, OpenAI-compatible, and Anthropic-compatible profiles.
Models uses a short connection flow—not a marketplace or capability table—to collect
endpoint/key data when needed, discover or accept model IDs, test, and select one default.

Connecting and selecting a Provider Profile is the user's standing choice for ordinary,
private, and larger bounded calls to that exact destination. Setup explains once that
selected context may leave the device; routine calls then proceed without per-call
confirmation and show calm non-blocking status. Users may choose a stricter policy.
Sensitive, restricted, unknown, or changed boundaries follow the Model Egress contract.

Models shows connection, safe key state, model list/default, and test result. Hide pricing,
matrices, routing, per-workflow choices, and Advanced/Fast roles until a tested runtime
makes them effective. Embedding/reranking stays in Local Capabilities. Profile/runtime
details are owned by the Pi integration, Settings, Technical Architecture, and UI owners.

## 21. Backup And Restore

v0.1 creates and restores a versioned `.pige-backup.zip`. The flow previews contents and
compatibility, detects conflicts, validates the manifest and checksums, restores into a
new folder with explicit identity handling, and rebuilds derived state.

The user-visible default is simple: include durable vault knowledge, evidence, audit,
memory, and conversation state; exclude secrets, machine-local preferences, tools,
model weights, databases, indexes, and other rebuildable state. The exact include,
exclude, identity, and compatibility matrix is owned by
[`DATA_ARCHITECTURE.md`](DATA_ARCHITECTURE.md#11-backup-policy), with execution and
checkpoint behavior owned by
[`JOB_OPERATION_AND_RECOVERY.md`](JOB_OPERATION_AND_RECOVERY.md#16-backup-restore-and-migration).

## 22. Privacy And Security

Privacy promises:

- User data is local-first.
- Pige does not require a Pige cloud account for v0.1.
- User chooses model provider.
- API keys are stored only on the local machine, presented only to the configured
  provider for authentication, and never written into Markdown pages.
- API keys are encrypted by default through OS keychain or encrypted local storage.
- Plaintext secret storage is allowed only as an explicit portable/developer mode with warning.
- Connecting and selecting a BYOK Provider Profile authorizes ordinary, private, and
  larger bounded calls to that destination. Setup discloses the boundary once; routine
  calls use non-blocking status instead of repeated prompts. Stricter policy remains
  available; sensitive content may require confirmation and restricted content is blocked.
- Agent memory is inspectable, reversible, and can be disabled or reset.
- Memory candidates are scanned for secrets before persistence.
- Skill content is untrusted until installed and still cannot weaken permissions, privacy settings, prompt-injection defenses, or confirmation gates.
- Skill install previews must not execute scripts, package hooks, or embedded code.
- External/Web Skills can run permission-scoped capabilities only after user approval for sensitive actions, unless an eligible capability is covered by an explicit broader permission mode such as YOLO Full Access. Raw-secret access and always-confirmed destructive/settings/data-egress actions are never made eligible merely by that mode.

Security product requirements:

- All ingested content remains untrusted data and cannot change user intent, tools,
  policy, models, paths, `PIGE.md`, permissions, or dependency state.
- Sensitive actions show a scoped Deny / Allow Once / Always Allow decision when the
  capability is eligible for saved grants.
- Ask Every Time, Remember Scoped Grants, and YOLO Full Access are explicit user modes.
  YOLO is off by default, visibly indicated, revocable, and logged; it never enables raw
  secrets or bypasses always-confirmed actions.
- Optional tools and model assets require explicit download consent and verified
  admission before execution.
- External/Web Skills and packages cannot receive unmediated vault, filesystem,
  network, model, settings, destructive, or credential access.
- Suspicious source instructions are ignored and may be reported without turning normal
  capture into an alarming security console.

Secret storage, SSRF, path validation, renderer isolation, egress policy, prompt
packaging, least privilege, capability scopes, permission vocabulary, tool verification,
and security tests are owned by `PRIVACY.md`, `docs/SECURITY_THREAT_MODEL.md`,
`docs/PROMPT_DESIGN.md`, `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`, and the shared schemas.

### 22.1 Performance Targets

Performance budgets are product acceptance constraints, not guarantees on every machine.
The P0 ledger owns the release workload and memory commitments; exact numeric launch,
capture, query, list, indexing, parser, OCR, reader, and scale budgets are owned once by
`docs/PERFORMANCE_AND_RELIABILITY.md`.

Product-visible behavior remains mandatory: capture preservation feels immediate;
typing and reading do not visibly lag; long work shows progress; lexical results may
appear before slower semantic work; rebuilds remain background/resumable; and exceeding
a budget degrades visibly rather than losing data.

### 22.2 External Dependency Governance

Dependencies are explicit and traceable, but their catalog does not live in this PRD.
No Agent job may install, upgrade, or replace a dependency at task time.

Product-facing dependency rule:

> If a user-visible capability depends on an external tool, model, OS API, or provider, Pige must be able to explain its local/cloud boundary, install status, update status, and fallback behavior in Settings or inline status.

Dependency identity, sources, pins, checksums, licenses, data boundaries, update policy,
replacement paths, and admission review are owned by the Technical Architecture
registry, release contract, and machine-readable dependency manifests.

## 23. Product Acceptance Scenarios

The P0 ledger owns feature completeness. This section owns the end-to-end product
outcomes that prove those features form Pige rather than a collection of components.
Current pass/fail status and evidence remain only in the acceptance manifest.

### 23.1 Activation And Safe Capture

- A new user can create or open a visible local vault and reach the real Home composer
  without completing a product tour.
- The user can skip model setup, capture supported input, see that it is saved locally,
  reopen the app, and find the same source without duplication.
- After one default model is configured, the user can explicitly resume dependent work
  and see a readable, source-backed Markdown result.

### 23.2 Mixed-Source Knowledge Compilation

- Across the public-alpha mixed-source scenario, text, URL, PDF, DOCX, PPTX, image, and
  supported voice inputs preserve evidence before downstream work.
- The same Pi Agent control loop selects bounded source-inspection, extraction, OCR,
  retrieval, and knowledge-write tools from intermediate results; a format switch or
  service chain cannot silently choose the semantic plan in its place.
- Parser/OCR limitations produce bounded partial results, visible warnings, or a safe
  paused state rather than disappearing captures or unsupported certainty.
- Repeated sources on a related topic can update existing knowledge with citations; the
  product is not accepted if it only creates isolated source summaries.

### 23.3 Retrieval And Reuse

- Natural-language questions return ranked relevant notes plus a concise grounded
  synthesis, and every supported claim can be inspected back to a note or source.
- Retrieval remains useful through lexical fallback without local model assets and gains
  semantic capability without another provider configuration when the managed asset is
  installed.
- A user can open a result, use the Note Agent or a selection action, and save a useful
  result back into portable Markdown without losing provenance.

### 23.4 Trust, Control, And Extension Boundaries

- The user can tell where knowledge lives, when selected content may go to a configured
  cloud model, what an Agent operation changed, and whether work completed, paused,
  failed, or needs confirmation.
- Risky edits and sensitive extension actions cannot cross their confirmation or
  permission boundary; raw secrets never appear in Agent, extension, diagnostic, or
  vault output.
- A Skill or curated package can complete its explicit staged lifecycle without turning
  ordinary capture into package installation or exposing a general platform console.

### 23.5 Recovery And Release Fitness

- A vault can be backed up, restored into a fresh folder, rebuilt, searched, and used
  again without losing durable knowledge, evidence, scoped memory, conversations,
  proposals, or operation history included by policy.
- Six-locale and accessibility workflows pass the release fixtures on supported
  platforms; unsupported capabilities show honest disabled or fallback states.
- A public-alpha artifact installs, reports dependency/license state, updates to the
  next compatible alpha, and preserves the vault across the update.

Quantitative thresholds, golden fixtures, unsupported-claim checks, retrieval relevance,
noise/duplicate-page evaluation, performance budgets, accessibility tests, release
scenarios, and independent review are owned by `docs/QUALITY_AND_TEST_STRATEGY.md`,
`docs/PERFORMANCE_AND_RELIABILITY.md`, `docs/MILESTONES.md`, and the acceptance
resources. Product-value research, if performed, must be opt-in and cannot introduce
default telemetry contrary to `PRIVACY.md`.

## 24. Risks

| Risk and affected promise | Detection evidence | Required mitigation and decision trigger | Primary owners |
| --- | --- | --- | --- |
| Capture, write, crash, external edit, backup, or restore loses durable evidence/knowledge or silently overwrites a newer version. | Preserve-before-work fixtures, restart/idempotency tests, external-change conflicts, source checksums, and backup/restore manifest validation. | Preserve durable input before expensive work; use recoverable writes, explicit conflicts, and validated restore. Any unexplained loss or silent overwrite blocks release. | Data Architecture, Source Storage, Job/Recovery, Sync/Migration |
| Over-created, duplicate, or weakly connected pages make the wiki noisier than the captured material. | Golden ingest/linking evaluation, duplicate/noise review, rejected or reversed proposals. | Require evidence and incremental value for durable structure; stage broad merges/reshaping. Block release when output quality gates fail. | Knowledge Model, Prompt, Quality |
| Bad extraction or OCR creates plausible but wrong knowledge. | Multilingual parser/OCR fixtures, low-confidence and unsupported-claim checks, source-locator inspection. | Preserve native and OCR evidence separately, expose partial/low-confidence results, and prevent unsupported claims from auto-applying. | Parser Ingest, Context, Quality |
| BYOK setup or cloud use surprises or blocks users. | First-run/capture-only scenarios, provider tests, cloud-status UI review. | Disclose the selected destination once, make routine bounded calls seamless, retain stricter policy, and preserve captures when unavailable or denied. | Onboarding, Pi Integration, Privacy |
| Weak retrieval, large local assets, or slow indexing makes answers worse than simple search. | Retrieval relevance fixtures, lexical-fallback tests, disk/index/performance budgets. | Keep lexical results available, make optional assets explicit/removable, and admit reranking only when it improves the owner-defined quality/performance gate. | Context, Local Database, Performance |
| Cross-platform parsers, bundled tools, optional OCR, installer size, licensing, or security updates become fragile. | Platform smoke matrix, dependency checksums/licenses, installer and update evidence. | Keep no-download ordinary workflows, visible repair/fallback, pinned release inputs, and a replacement path. Re-scope a dependency when release gates cannot be met safely. | Tech Architecture, Release Engineering |
| Hostile sources, weak provenance, or automatic edits undermine trust. | Prompt-injection fixtures, citation checks, operation/proposal audit, security negative cases. | Treat sources as data, keep provenance inspectable, mediate tools, and stage risky changes. No quality gain justifies weakening the boundary. | Security, Prompt, Job/Recovery |
| Skills or packages introduce excessive permission, maintenance, or default-UI complexity. | Capability/permission negative tests, curated review, default-navigation inspection, update-delta tests. | Curate knowledge-focused defaults, isolate community search, require explicit lifecycle decisions, and block unmediated access or task-time installs. | Skill Extension, Security, UI |
| Six-locale UI or multilingual retrieval breaks compact layouts, IME, CJK search, OCR, or speech behavior. | Six-locale screenshots/workflow fixtures, IME and CJK retrieval tests. | Keep language concepts separate, use owner-defined catalogs/fallbacks, and block release when a core locale workflow is unusable. | I18N, UI, Quality |
| Desktop-local contracts make later sync/mobile/remote execution require destructive migration. | Schema/migration review, path-independent ID and capability-adapter tests. | Keep portable IDs, explicit machine bindings, conflict metadata, and runtime capability boundaries; do not implement sync inside v0.1. | Sync/Migration, Data, Future Mobile/Cloud |

## 25. Resolved v0.1 Decisions

This PRD owns product scope and user-visible behavior, not a second decision registry. The
current durable choices are indexed in [`DECISION_LOG.md`](DECISION_LOG.md); their exact
product, data, security, runtime, and release contracts live in the specialized owner
documents routed by [`START_HERE_FOR_AI_AGENTS.md`](START_HERE_FOR_AI_AGENTS.md).

When a decision changes product scope, update the relevant PRD section and the owning
contract in the same change. Do not append another resolved-decision checklist here.

### 25.1 Post-v0.1 Exploration Items

- Evaluate optional Git-backed version history after v0.1.
- Evaluate a first-class translation workspace after core capture/retrieval stabilizes.
- Evaluate signed Skill/package registry and stronger sandboxing after v0.1.
- Define future sync boundaries for Skills, memory, provider profiles, and settings profiles before building sync.
- Evaluate Remote Agent Backend as the primary post-v0.1 route for Web/mobile clients after desktop local-first v0.1 stabilizes.

## 26. Owner Reference Index

AI Coding Agents start with `docs/START_HERE_FOR_AI_AGENTS.md` and load only the owner
sections required by the active slice.

- Product direction and release outcomes: `docs/VISION.md`, `docs/MILESTONES.md`,
  `docs/UI_PROTOTYPE.md`, `docs/ONBOARDING_AND_FIRST_RUN.md`.
- Knowledge, data, and sources: `docs/DOMAIN_MODEL.md`, `docs/DATA_ARCHITECTURE.md`,
  `docs/SOURCE_STORAGE_STRATEGY.md`, `docs/MARKDOWN_SCHEMA.md`,
  `docs/KNOWLEDGE_MODEL_AND_LINKING.md`.
- Runtime and implementation boundaries: `docs/TECH_ARCHITECTURE.md`,
  `docs/API_AND_IPC_DESIGN.md`, `docs/LOCAL_DATABASE_DESIGN.md`,
  `docs/PARSER_INGEST_SPEC.md`, `docs/JOB_OPERATION_AND_RECOVERY.md`.
- Agent, model, retrieval, and memory: `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`,
  `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`, `docs/PROMPT_DESIGN.md`,
  `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`, `docs/AGENT_MEMORY_DESIGN.md`.
- Trust and extensions: `PRIVACY.md`, `docs/SECURITY_THREAT_MODEL.md`,
  `docs/SETTINGS_AND_PREFERENCES.md`, `docs/SKILL_EXTENSION_DESIGN.md`,
  `docs/DIAGNOSTICS_AND_OBSERVABILITY.md`.
- Quality and delivery: `docs/PERFORMANCE_AND_RELIABILITY.md`,
  `docs/QUALITY_AND_TEST_STRATEGY.md`, `docs/I18N_DESIGN.md`,
  `docs/RELEASE_ENGINEERING.md`, `docs/SYNC_CONFLICT_AND_MIGRATION.md`.
- Planning and evidence: `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`,
  `docs/SPEC_TRACEABILITY.md`, `docs/DECISION_LOG.md`, and
  `resources/traceability/acceptance.manifest.json`.

External research, SDK documentation, model repositories, package catalogs, license
sources, version pins, and replacement paths belong to the appropriate owner document's
reference section and the Technical Architecture dependency registry. They MUST NOT be
duplicated here.
