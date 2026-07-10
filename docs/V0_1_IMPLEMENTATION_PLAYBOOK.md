# v0.1 Implementation Playbook

Status: Active implementation sequence
Baseline date: 2026-07-09
Last revised: 2026-07-10

## 1. Purpose

This document is the sole owner of P0-P9 phase numbers, stable Build commitments, phase-local deferrals, and Exit criteria. `docs/MILESTONES.md` owns M0-M7 release outcomes and the sole Phase-to-Milestone crosswalk; owner architecture documents define the contracts each slice must satisfy.

## 2. Product North Star For v0.1

The complete product scope remains in `docs/PRD.md`. The phase sequence below must compose into one usable local-first journey: install, create a vault, capture preserved sources, optionally configure BYOK, produce portable Markdown, retrieve and read grounded knowledge, review risky changes, and complete backup/restore without weakening secret or permission boundaries.

## 3. Implementation Strategy

Build the numbered phases below as vertical slices. Do not pull isolated advanced features ahead of the capture-to-Markdown path merely because their design is nearby.

Scope discipline for AI agents:

- Treat PRD P0 as the v0.1 release acceptance list, not as the task scope for any single phase.
- Each implementation session should choose one phase or one vertical slice inside a phase, name its requirement source, and preserve the phase's `Deferred from this phase` boundaries.
- Do not pull later-phase items forward merely because their design is nearby in the docs.
- If a later-phase item is required to make the current phase safe or testable, document the dependency and implement the smallest enabling contract rather than the full feature.
- Any scope promotion or demotion must update PRD, Milestones, this playbook, Spec Traceability, and Decision Log together.

Phase completion rule:

- A phase is complete only when its documented exit criteria pass and required verification evidence is available at the appropriate risk level.
- Failed required checks or unresolved ambiguity in source-of-truth ownership, durable data, permissions, security, recovery, or user-visible behavior block completion.
- Completion must not leave half-enabled product surfaces, partially exposed contracts, or documentation that implies unavailable behavior is ready.
- Non-blocking improvements belong to later-phase work; the number of work rounds neither proves completion nor requires a phase to continue.

Current implementation state, last reconciled 2026-07-10:

| Phase | State | Interpretation |
| --- | --- | --- |
| P0 | in progress | Repository and traceability foundations have current evidence; the full P0 exit set has not been re-run as a phase-completion claim. |
| P1 | in progress | Desktop, vault, settings, diagnostics, and runtime foundations have evidence; the full mapped exit set remains open. |
| P2 | in progress | Capture, durable-job, retry, and source-preservation slices have evidence; voice and the full mapped exit set remain open. |
| P3 | in progress | BYOK and Agent-ingest foundations have evidence; complete provider, egress, output-summary, and exit evidence remain open. |
| P4 | in progress | SQLite, lexical search, Library, and rebuild foundations have evidence; the full scale and relationship exit set remains open. |
| P5 | in progress | PDF, Office, static-web, direct-image macOS Vision OCR, Artifact, and recovery slices have evidence; cross-platform/document OCR and remaining P5 exits are still open. |
| P6 | in progress | Lexical retrieval, cited Home answers, Reader, backlinks, and related-context foundations exist; local RAG, editing, Knowledge Tree, and full exits remain open. |
| P7 | planned | Foundations may exist, but confirmation, memory, and conversation-lifecycle acceptance remains assigned below. |
| P8 | planned | Skill, package, and permission-broker acceptance remains assigned below. |
| P9 | planned | Backup/release foundations may exist, but full recovery, health, localization, accessibility, and release evidence remains open. |

This table prevents a working sub-slice from being mistaken for phase completion. The per-Requirement and Exit status, exact evidence selectors, and open work in `resources/traceability/acceptance.manifest.json` are the detailed source for handoff decisions.

## 3.1 Pre-Phase 0 Design Readiness Gate

Do not start Phase 0 scaffolding until the design baseline is ready enough that the first workspace commit will not immediately encode known product, data, security, or repository mistakes.

Ready for Phase 0 means:

- Product positioning, v0.1 scope, milestone sequence, and PRD P0 interpretation agree across PRD, Milestones, this playbook, Spec Traceability, and Decision Log.
- Non-negotiable invariants in `AGENTS.md`, `README.md`, and owner docs agree on Markdown source of truth, source ownership, rebuildable indexes, secrets, permissions, privacy, no hidden downloads, and simplicity-first UI.
- Core owner docs exist for product, architecture, data, Markdown schema, source storage, ingest, jobs, settings, Agent policy context, retrieval context, security, performance, quality, release, UI, I18N, memory, Skills, repository structure, coding conventions, and contribution workflow.
- Task-specific reading packs route future agents to owner docs without requiring the full design library by default.
- Durable data ownership, backup/restore inclusion, sync-ready IDs, trash-first lifecycle, and rebuildable-cache boundaries are stable enough to scaffold packages and schemas.
- Phase 0 file layout, dependency manifest layout, fixture manifest layout, generated artifact layout, import-boundary rules, and verification script ownership are defined.
- Requirement IDs validate: no undefined references, duplicate definitions, or unlisted area prefixes.
- Documentation health checks pass for local Markdown links, trailing whitespace, GitHub template YAML, and diff whitespace.
- Remaining open work is either explicitly deferred, post-v0.1, or assigned to a later implementation phase with owner docs and tests.

If any item fails, continue design work before scaffolding. If all items pass, begin Phase 0 only; do not treat design readiness as permission to skip phase boundaries or build later features early.

## 3.2 In-Flight Coordination And Adoption Cost

Documentation-control improvements must not force active implementation threads to restart or re-plan completed work.

- Send one concise coordination notice that states: Playbook phase numbers and Milestone names are unchanged; requirement ownership is derived from the Spec and acceptance manifest for new tasks and future handoffs; no code rewrite is implied.
- Let an active task finish its current bounded slice against the owner contracts it already loaded. Reconcile its requirement IDs, exact evidence selectors, and exit mappings at the next natural handoff or before claiming phase completion.
- Do not interrupt an active task solely to rename a milestone, add a trace ID, or reformat an exit criterion. Interrupt only when the correction reveals a security, privacy, durable-data, migration, or incompatible-contract risk.
- Preserve existing test and artifact paths when they are still valid. Add aliases or mapping notes rather than renumbering active phase work.
- A planning thread should record only the delta it must absorb: newly assigned P0 work, changed owner contract, changed exit evidence, or a real blocker. It should not replay the full documentation audit.
- If concurrent edits touch this playbook or the requirement register, merge by stable Build, Exit, and `PIGE-*` IDs; never resolve by silently dropping another thread's evidence or open work.

Recommended coordination notice:

> Documentation control has been tightened without changing P0-P9 phase numbers or M0-M7 milestone names. Continue the current bounded slice. At the next handoff, attach its `PIGE-*` IDs and evidence to the mapped exit criteria; newly surfaced P0 items stay in their assigned later phases unless they block current safety or compatibility.

## 4. Repository Boundary

`docs/REPOSITORY_STRUCTURE.md` is the sole owner of repository shape and import boundaries. Phase 0 Builds below create and verify that structure; this playbook does not copy the directory tree or package-placement rules.

## 5. Phase 0: Repository Foundation

Context pack: `README.md`; `AGENTS.md`; `docs/MILESTONES.md`; `docs/TECH_ARCHITECTURE.md`, especially the external dependency registry; `docs/AI_DEVELOPMENT_GUIDE.md`; `docs/REPOSITORY_STRUCTURE.md`; `docs/CODING_CONVENTIONS.md`; `docs/QUALITY_AND_TEST_STRATEGY.md`; `docs/RELEASE_ENGINEERING.md`; `docs/SPEC_TRACEABILITY.md`.

Build:

- [B0.01 -> E0.02] Repository package-manager setup.
- [B0.02 -> E0.03] Workspace setup with `apps/desktop/` and the initial `packages/domain`, `packages/contracts`, `packages/schemas`, `packages/markdown`, `packages/knowledge`, and `packages/test-fixtures` packages.
- [B0.03 -> E0.01] Electron + React + TypeScript 7 + Vite scaffold under `apps/desktop/`.
- [B0.04 -> E0.02] Lint, format, type-check, and unit-test runner.
- [B0.05 -> E0.03] Workspace path aliases and import-boundary checks.
- [B0.06 -> E0.04] CI skeleton.
- [B0.07 -> E0.08] Basic app metadata and Apache 2.0 notices.
- [B0.08 -> E0.09] Locale file skeletons.
- [B0.09 -> E0.05] Dependency manifest schema and verification tying package manifests, lockfiles, bundled tools, models, provider catalogs, CI actions, and release tooling to `docs/TECH_ARCHITECTURE.md`.
- [B0.10 -> E0.05] Initial dependency and waiver manifests under `resources/dependency-manifest/`.
- [B0.11 -> E0.06] Fixture manifests for general fixtures and the Public Alpha scenario.
- [B0.12 -> E0.07] Independent semantic-lock traceability verification for definitions, P0 mappings, phase references, exact executable evidence, structured open destinations, milestone mapping, and Build-to-Exit coverage.
- [B0.13 -> E0.10] Generated evidence convention under `artifacts/test-reports/` and `artifacts/release-evidence/`.
- [B0.14 -> E0.11] Manifest-backed documentation-quality scoring for navigation/resource recovery, contract consistency, traceability/acceptance closure, and development support.
- [B0.15 -> E0.12] Public collaboration policy and conduct/issue/PR templates with redaction, requirement/evidence, documentation, and private-security-routing controls.
- [B0.16 -> E0.13] Phase-scope and readiness preflight contract proving the Phase 0 reading pack, the pre-Phase 0 gate, and the rule that PRD P0 is release scope rather than one task.

Deferred from this phase:

- [D0.01] Agent workflows; assigned to P3 and later.
- [D0.02] Real parsers; assigned to P5.
- [D0.03] Auto-update production behavior; alpha update work is assigned to P9.
- [D0.04] Product-facing Skill and Pi Package Manager; assigned to P8.

Exit criteria:

- [E0.01] App launches in development.
- [E0.02] Type-check, formatting/lint checks, and basic unit tests run from the workspace root.
- [E0.03] Workspace boundaries prevent `packages/*` from importing `apps/desktop`, and renderer code from importing main-process services or adapters.
- [E0.04] CI runs type-check, unit tests, and repository verification.
- [E0.05] Dependency verification rejects unregistered runtime/release dependencies and invalid or expired waivers while passing the registered baseline.
- [E0.06] Fixture validation rejects unregistered release-gate fixtures.
- [E0.07] Traceability rejects undefined/duplicate IDs, coordinated semantic exchanges, invalid Phase/Milestone assignments, forged or non-exact evidence, missing partial-open delivery targets, historical-only evidence, and uncovered Build commitments.
- [E0.08] App metadata and Apache license/notice files are present and package-readable.
- [E0.09] All six locale catalog skeletons load through the localization boundary.
- [E0.10] Generated test and release reports use gitignored `artifacts/` paths and are never treated as committed requirement definitions.
- [E0.11] An independent reproducible documentation-quality gate scores all five governed dimensions at least 9.5/10 and rejects missing evidence or subjective self-attestation.
- [E0.12] Conduct, bug/design/security issue routes, and the PR template collectively require public redaction, stable requirement/evidence references, tests/docs updates, and private vulnerability handling.
- [E0.13] The Phase 0 preflight names every required reading source, blocks scaffolding before readiness, authorizes Phase 0 only, and keeps later PRD P0 work in its assigned phase.

## 6. Phase 1: Desktop Shell And Vault Foundation

Context pack: `docs/TECH_ARCHITECTURE.md`; `docs/DATA_ARCHITECTURE.md`; `docs/MARKDOWN_SCHEMA.md`; `docs/KNOWLEDGE_MODEL_AND_LINKING.md`; `docs/JOB_OPERATION_AND_RECOVERY.md`; `docs/SOURCE_STORAGE_STRATEGY.md`; `docs/DOMAIN_MODEL.md`; `docs/ONBOARDING_AND_FIRST_RUN.md`; `docs/API_AND_IPC_DESIGN.md`; `docs/SETTINGS_AND_PREFERENCES.md`; `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`; `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`; `docs/DIAGNOSTICS_AND_OBSERVABILITY.md`; `docs/UI_PROTOTYPE.md`; `docs/LOCAL_DATABASE_DESIGN.md`.

Build:

- [B1.01 -> E1.10] Main, preload, and renderer split.
- [B1.02 -> E1.01] First-run vault creation.
- [B1.03 -> E1.02] Optional model setup with capture-only mode when skipped or unavailable.
- [B1.04 -> E1.04] Settings > Knowledge Base > Vault & Note Storage with vault identity, active paths, storage strategy, reveal, open/create, recent vaults, and backup/restore entry points.
- [B1.05 -> E1.03] Default vault layout.
- [B1.06 -> E1.03] `PIGE.md`, `index.md`, `log.md`, and manifest creation.
- [B1.07 -> E1.11] Compact capture window.
- [B1.08 -> E1.11] Expandable sidebar shell.
- [B1.09 -> E1.11] Window mode service.
- [B1.10 -> E1.05] Local settings without secrets.
- [B1.11 -> E1.05] Settings registry and typed scopes for vault-portable, machine-local, machine-vault binding, secret, permission, and derived values.
- [B1.12 -> E1.06] Agent Runtime Policy Context builder for storage, model, cloud-send, confirmation, permission, language, memory, retrieval, and capability status.
- [B1.13 -> E1.12] Pi Agent adapter stub, provider/model profile storage, and one effective default-model contract without Advanced/Fast routing UI.
- [B1.14 -> E1.07] Bounded local diagnostics, redaction, health summary, and user-initiated support-bundle preview/export.
- [B1.15 -> E1.08] Local SQLite abstraction and empty migration system.
- [B1.16 -> E1.09] Reset Local Database repair action.
- [B1.17 -> E1.13] Capture-first Home and navigation contract: essential empty state, no mode chips, collapsible sidebar, compact/expanded/full-screen context continuity, and a directly browsable three-level Library tree when data permits.
- [B1.18 -> E1.14] Version-pinned bundled core toolchain manifest, readiness check, and visible repair path for missing or damaged tools.
- [B1.19 -> E1.15] Machine-local secret-storage adapter foundation that can protect values without writing them to the vault; provider API-key use remains a P3 concern.
- [B1.20 -> E1.16] Shared namespaced error schemas for API/IPC, durable Job warnings/errors, diagnostics, localization, and retry/repair actions.
- [B1.21 -> E1.17] Stable path-independent ID and sync-conflict metadata foundation for durable records.
- [B1.22 -> E1.18] Runtime capability contracts for Agent, tool, parser, OCR, and RAG adapters with explicit unavailable/degraded states.
- [B1.23 -> E1.19] No-telemetry/no-auto-upload baseline plus bounded local diagnostic log rotation, retention, and content redaction.
- [B1.24 -> E1.20] Main-process sensitive-setting mutation guard with explicit confirmation or Permission Broker authorization.
- [B1.25 -> E1.21] Atomic checksum-aware Markdown write and external-change conflict foundation.
- [B1.26 -> E1.22] Executable conversation-event and operation-kind vocabulary parity with the job/operation owner document.

Deferred from this phase:

- [D1.01] Full ingest; assigned to P3 and P5.
- [D1.02] OCR; assigned to P5.
- [D1.03] Local RAG; assigned to P6.
- [D1.04] Skill execution; assigned to P8.

Exit criteria:

- [E1.01] User can create and open a vault through validated paths.
- [E1.02] User can skip model setup and enter capture-only mode without losing captures.
- [E1.03] Default vault files are visible, human-readable, schema-valid, and free of machine-local active paths.
- [E1.04] User can find and reveal note/source storage, switch or create vaults, and reach backup/restore without entering diagnostics or maintenance surfaces.
- [E1.05] Every exposed setting is registered; machine-local values and secrets are absent from the vault manifest and default backup inputs.
- [E1.06] Agent-affecting settings have typed policy effects and owning-service enforcement rather than prompt-only behavior.
- [E1.07] Diagnostics export is redacted, previewed, cancelable, local-only, bounded, and free of raw secrets or source/note bodies by default.
- [E1.08] Deleting `.pige/db/` does not delete user-owned files, and the empty migration/rebuild path succeeds.
- [E1.09] Reset Local Database cannot delete Markdown knowledge, source records/assets, memory, conversations, proposals, operations, or trash.
- [E1.10] Renderer reaches privileged capabilities only through typed preload IPC.
- [E1.11] Compact and expanded shell modes retain current context and remain usable in the six catalog locales.
- [E1.12] One default model profile can be stored and resolved through the adapter contract without exposing ineffective Advanced/Fast controls.
- [E1.13] Home opens capture-first with the essential empty state and no mode chips; compact, expanded, and full-screen reading preserve context, and the sidebar exposes the Library tree directly to at least three levels when available.
- [E1.14] Packaged core tools are version-pinned, report ready/missing/damaged state, and expose a user-visible repair path without an ordinary job improvising a download.
- [E1.15] The secret-storage adapter protects a synthetic value outside vault files, SQLite, logs, diagnostics, and backups; P3 proves provider-key integration.
- [E1.16] API errors, durable Job warnings/errors, diagnostics, and UI failure actions validate against one shared taxonomy; malformed codes or unstructured private details are rejected, and every locale covers release-visible message keys.
- [E1.17] Stable IDs remain valid across rename/path changes and durable contracts expose explicit sync-conflict metadata without using a path as identity.
- [E1.18] Agent, tool, parser, OCR, and RAG work resolves through typed runtime-capability adapters; unavailable capabilities fail visibly without renderer or domain-layer runtime assumptions.
- [E1.19] No product analytics or automatic diagnostic/crash upload is configured, and local logs rotate within bounded retention while rejecting secrets and large private bodies.
- [E1.20] Sensitive setting mutations fail closed unless an explicit user confirmation or valid Permission Broker decision reaches the main-process owner.
- [E1.21] Interrupted Markdown writes recover atomically, and a changed target checksum produces a visible conflict instead of silent overwrite.
- [E1.22] Every executable conversation-event type and operation kind is documented by the owner contract; adding or removing a value breaks traceability until parity is restored.

## 7. Phase 2: Capture Reliability

Context pack: `docs/PRD.md` input requirements; `docs/PARSER_INGEST_SPEC.md`; `docs/DATA_ARCHITECTURE.md`; `docs/SOURCE_STORAGE_STRATEGY.md`; `docs/PERFORMANCE_AND_RELIABILITY.md`; `docs/DOMAIN_MODEL.md`; `docs/QUALITY_AND_TEST_STRATEGY.md`; `docs/UI_PROTOTYPE.md` voice and capture sections; `docs/I18N_DESIGN.md` speech-language behavior; `docs/SECURITY_THREAT_MODEL.md` microphone and source-preservation boundaries.

Build:

- [B2.01 -> E2.02] Text capture.
- [B2.02 -> E2.04] Local macOS voice dictation when supported, with explicit unavailable states elsewhere.
- [B2.03 -> E2.05] Markdown and TXT file capture.
- [B2.04 -> E2.06] PDF, DOCX, PPTX, and common-image preservation with metadata-only source pages and parser/OCR waiting jobs.
- [B2.05 -> E2.07] Whole-window drop hot zone.
- [B2.06 -> E2.08] Stable source ID generation.
- [B2.07 -> E2.08] Source-record creation and policy-driven source-asset preservation.
- [B2.08 -> E2.01] Persistent job queue.
- [B2.09 -> E2.03] Reference-based conversation events for captures.
- [B2.10 -> E2.09] Home queued, running, failed, completed, waiting-dependency, and waiting-permission status presentation.
- [B2.11 -> E2.10] Retry and cooperative cancellation contracts.
- [B2.12 -> E2.09] Timeline progress events with safe summaries.
- [B2.13 -> E2.11] Dependency-state enforcement for missing model, tool, path, and runtime capabilities with retryable repair metadata.

Deferred from this phase:

- [D2.01] Cloud model calls; assigned to P3.
- [D2.02] Rich source parsing beyond text and Markdown; assigned to P5.
- [D2.03] Semantic search; assigned to P6.
- [D2.04] Advanced `link_to_original` explicit-link storage and link-specific cross-root recovery; deferred beyond v0.1 pending a separate schema, migration, permission, and recovery contract.

Exit criteria:

- [E2.01] Killing and reopening the app does not lose queued or partially processed captures; durable jobs reconcile to retryable states.
- [E2.02] Large pasted content is stored once as a managed source and referenced from conversation history without duplicated large bodies.
- [E2.03] Capture events are durable and reference sources/jobs; only bounded short chat text may remain inline.
- [E2.04] Supported macOS dictation inserts local transcript text after on-demand microphone permission; unsupported platforms show a clear state and no dictation audio is sent to model providers.
- [E2.05] Markdown and TXT capture preserves the original source, creates one source record, and does not duplicate large bodies into conversation events.
- [E2.06] PDF, DOCX, PPTX, and image capture preserves evidence before processing and creates visible retryable parser/OCR dependency jobs.
- [E2.07] Whole-window drop validates files, preserves accepted items, and reports rejected display names without exposing private paths.
- [E2.08] Source IDs remain stable across retry, and the selected copy/reference strategy affects new captures through the Source Storage Service.
- [E2.09] Home and timeline show durable, localized, redacted job state and progress without claiming completion early.
- [E2.10] Retry is idempotent; cancellation preserves sources and leaves no half-enabled UI or ambiguous durable state.
- [E2.11] Missing model, tool, path, or runtime dependencies enter visible retryable `waiting_dependency` with a structured repair/retry action and no source loss.

## 8. Phase 3: BYOK And Basic Agent Ingest

Context pack: `docs/PRD.md` BYOK and Agent workflow sections; `docs/TECH_ARCHITECTURE.md` model provider and Agent contracts; `docs/PROMPT_DESIGN.md`; `docs/MARKDOWN_SCHEMA.md`; `docs/KNOWLEDGE_MODEL_AND_LINKING.md`; `docs/JOB_OPERATION_AND_RECOVERY.md`; `docs/SECURITY_THREAT_MODEL.md`; `docs/DATA_ARCHITECTURE.md`.

Build:

- [B3.01 -> E3.01] Provider profiles for OpenAI, Anthropic, OpenAI-compatible, and Anthropic-compatible services.
- [B3.02 -> E3.02] Encrypted-by-default API-key storage.
- [B3.03 -> E3.01] Provider connection test before persistence.
- [B3.04 -> E3.01] Model-list discovery, manual model IDs, and one effective default model.
- [B3.05 -> E3.03] Typed pre-prompt/pre-credential model-egress decision with cloud-send indicator and configured confirmation behavior.
- [B3.06 -> E3.04] Basic ingest prompt path with untrusted-source boundaries.
- [B3.07 -> E3.05] Structured output validation and low-confidence routing.
- [B3.08 -> E3.04] Source-page generation.
- [B3.09 -> E3.04] Simple wiki-page generation.
- [B3.10 -> E3.04] Append-only `log.md` update.
- [B3.11 -> E3.06] Change Proposal Service foundation.
- [B3.12 -> E3.07] Complete Agent output and change-summary contract for title, summary, tags, topic, entities, related notes, Markdown/source pages, citations, index/log updates, and created/updated/skipped/failed/confirmation-needed results.
- [B3.13 -> E3.08] Pige-owned Pi Agent service boundary preventing renderer or unmediated product code from calling Pi directly.

Implementation evidence exists for B3.05's Agent-ingest path: selected evidence and bounded dynamic prompt metadata are redacted before a typed egress decision, the body-free audit binds the concrete non-secret Provider endpoint/boundary and Model ID, non-secret summaries are rechecked before prompt rendering, and the credential-bearing runtime config is rechecked before model invocation. Same-ID endpoint/model drift fails closed. User-confirmation resume and complete provider-path adoption remain open, so E3.03 is not complete.

Deferred from this phase:

- [D3.01] Every AI SDK provider in the default UI; not required for v0.1.
- [D3.02] Advanced/Fast model routing UI; deferred until effective runtime routing exists.
- [D3.03] User-configured embedding providers; local RAG is assigned to P6.
- [D3.04] External Skill execution; assigned to P8.

Exit criteria:

- [E3.01] Each supported provider profile can be connection-tested, can discover or accept model IDs, and resolves one effective default model used by Agent ingest.
- [E3.02] API keys do not appear in vault files, SQLite, logs, persisted prompts, diagnostics, operations, or backups.
- [E3.03] Every external model attempt obtains a typed allow/confirm/block decision before prompt assembly or credential lookup; unknown policy fails safe, and indicators/settings change actual runtime behavior.
- [E3.04] Pasted text can become a source page, schema-valid wiki note, index update, and append-only log entry with source citations.
- [E3.05] Invalid, unsupported, low-confidence, or hostile structured output is rejected or routed to warning/proposal without an unsafe durable write.
- [E3.06] A risky generated change can be staged durably as a redacted proposal without being silently applied.
- [E3.07] Agent ingest emits the required structured knowledge fields, traceable citations, source/wiki/index/log writes, and a deterministic action summary separating created, updated, skipped, failed, and confirmation-needed outcomes.
- [E3.08] Renderer and product features reach Pi Agent only through typed Pige services and cannot bypass Pige-owned storage, policy, egress, or secret boundaries.

## 9. Phase 4: Local Database And Search Foundation

Context pack: `docs/LOCAL_DATABASE_DESIGN.md`; `docs/DATA_ARCHITECTURE.md`; `docs/MARKDOWN_SCHEMA.md`; `docs/KNOWLEDGE_MODEL_AND_LINKING.md`; `docs/JOB_OPERATION_AND_RECOVERY.md`; `docs/PERFORMANCE_AND_RELIABILITY.md`; `docs/SPEC_TRACEABILITY.md`.

Build:

- [B4.01 -> E4.05] SQLite schema and migrations for pages, sources, jobs, operations, tags, and links.
- [B4.02 -> E4.01] FTS5 lexical search.
- [B4.03 -> E4.01] CJK n-gram/trigram fallback.
- [B4.04 -> E4.02] Database rebuild from durable vault files.
- [B4.05 -> E4.03] Incremental index update and external-edit reconciliation.
- [B4.06 -> E4.01] Library list from rebuildable database metadata.
- [B4.07 -> E4.04] Graph and backlink foundations rebuildable from durable truth.
- [B4.08 -> E4.06] Durable Markdown lifecycle for meaningful topic, concept, entity, claim, and question pages while tags remain lightweight facets.

Deferred from this phase:

- [D4.01] Vector search before the local model is ready; assigned to P6.
- [D4.02] Advanced force-directed graph visualization and analytics; deferred beyond v0.1. A simple Knowledge Tree remains assigned to P6.

Exit criteria:

- [E4.01] A 10,000-page metadata fixture can list and lexically search within budget, including deterministic CJK fallback.
- [E4.02] Database deletion and rebuild preserves durable knowledge and reconstructs supported indexes from owner sources.
- [E4.03] External Markdown edits are detected and incrementally indexed or safely reconciled without silent overwrite.
- [E4.04] Backlinks and basic relationship edges rebuild from Markdown, citations, source records, and managed sections.
- [E4.05] Schema migration and reset cover pages, sources, jobs, operations, tags, and links without turning SQLite into durable truth.
- [E4.06] Meaningful topics, concepts, entities, claims, and questions persist as schema-valid Markdown pages with stable IDs; tags remain rebuildable lightweight facets.

## 10. Phase 5: Web, Document, And OCR Ingest

Context pack: `docs/PRD.md` input handling; `docs/PARSER_INGEST_SPEC.md`; `docs/TECH_ARCHITECTURE.md` parser and OCR sections; `docs/SECURITY_THREAT_MODEL.md`; `docs/PERFORMANCE_AND_RELIABILITY.md`; `docs/RELEASE_ENGINEERING.md`.

Build:

- [B5.01 -> E5.01] URL detection beyond the single-URL Home composer route.
- [B5.02 -> E5.01] Bounded SSRF-resistant fetch rules beyond the current foundation.
- [B5.03 -> E5.01] Local Readability extraction.
- [B5.04 -> E5.01] PDF text extraction with page locators.
- [B5.05 -> E5.01] Semantic DOCX extraction.
- [B5.06 -> E5.01] Relationship-ordered PPTX best-effort extraction.
- [B5.07 -> E5.05] Image and screenshot OCR routing.
- [B5.08 -> E5.05] OCR fallback for image-only PDF pages and presentation slides.
- [B5.09 -> E5.01] Checksummed parser-artifact storage and safe refresh.
- [B5.10 -> E5.02] Toolchain manifests, health checks, and explicit install, test, update, disable, remove, and repair lifecycle for optional PaddleOCR dependencies and language packs.
- [B5.11 -> E5.03] Untrusted-source boundary enforcement across URL, document, image, OCR, and extracted-artifact Agent handoff.
- [B5.12 -> E5.04] Multilingual source-to-note golden fixtures and executable citation, unsupported-claim, and low-confidence assertions.

Implementation evidence snapshot; P5 remains in progress:

Evidence exists for preserved PDF -> recoverable local worker -> deterministic text/metadata artifacts -> page locators -> checksum-safe source-page refresh -> OCR handoff -> Agent ingest when text coverage is useful.

Evidence exists for preserved DOCX/PPTX -> bounded Office worker -> semantic blocks or ordered slide/notes extraction -> selected PPTX raster materialization -> local OCR -> locator-bearing Agent context -> crash-safe reuse.

PDF and Office parser adapters now create their worker input only after verified Artifact
reuse misses, using private descriptor-derived snapshots for both managed and referenced
sources. Focused tests replace the recorded source pathname during extraction, verify the
Office worker still reads the bound bytes, and verify its temporary input disposal on
both success and failure. Referenced-PDF integration proves that the parser receives a
separate disposable path, while the shared snapshot fixture proves copied bytes survive
later source-path replacement. The remaining packaged-platform matrix stays open.

B5.09 source-page evidence now covers a stale pre-Artifact Source Record baseline,
detected concurrent Source Record and Markdown changes, recovery from an interrupted
pending refresh, vault-relative Source Record projection, and non-disclosing rejection
of an escaping preview. These tests do not close the residual cross-process,
parent-swap, or cross-file source-page transaction windows owned by the Source Storage
contract.

Generated-note commit evidence now covers a final Source Record recheck after the
exclusive temporary note is flushed, atomic create-only publication, preservation of a
concurrent user page, and idempotent recovery when another worker publishes the same
source-owned Pige note. Strict cross-process SourceRecord-to-note CAS, parent-swap
resistance, note/index/operation transactions, and packaged-platform proof remain open.

Evidence exists for validated-address-pinned static URL fetch -> bounded response -> charset-aware snapshot -> serial Readability/jsdom worker -> checksummed article text and redacted metadata -> quality-aware Agent handoff.

Evidence exists for preserved raster image -> verified architecture-specific macOS 26 Swift helper -> bounded Apple Vision document/text recognition -> deterministic OCR text and text-free locator sidecar -> checksum-safe Source Page refresh -> quality-aware Agent handoff. Native smoke covers helper manifest integrity, capability probe, visible-text recognition, and invalid-image rejection; unit/integration tests cover protocol bounds, timeout, path escape, source/Artifact tampering, empty output, and crash-safe reuse/regeneration.

Evidence exists for fully inspected image-only or mixed-text PDF (up to 20 verified parser-selected pages) -> separately built bounded PDF.js/native-Canvas page worker -> deterministic rendered-page/render-manifest Artifacts -> macOS Vision page OCR -> independent native/OCR bodies plus text-free page/block provenance -> checksum-safe Source Page and Agent handoff. Sidecars bind parser metadata and exact page targets; tests cover sparse-page-only routing, native-plus-OCR citations, parser/source/rendered-Artifact tampering, empty enrichment fallback, stale Source Record merge, incomplete-render retry, referenced originals, and crash-safe reuse. Built-worker smoke rasterizes a real no-text PDF page.

Evidence exists for page-aware multi-Artifact Agent handoff -> independently checksummed native/OCR bodies -> sidecar pairing by Source ID, sidecar Artifact ID, kind, and body checksum -> bounded ordered Evidence Pack with supplemental-OCR reserve -> same-parent duplicate suppression -> collision-safe canonical locators -> statement-level `ev_NN` refs -> canonical Markdown citations. PDF parser sidecars now provide exact page character spans; unknown refs fail before write and missing refs force review without a fabricated locator.

B5.11 adversarial evidence now covers URL Readability, DOCX, PDF, PPTX, and image-OCR handoff through the public ingest boundary. It verifies delimiter escaping, unchanged control-plane sentinels, deterministic note-path ownership, and strict rejection of model-authored control fields. Full Pi tool/Permission Broker runtime proof remains open, so E5.03 stays partial.

B5.12/E5.04 evidence covers seven text, URL, PDF, PPTX, and image-OCR cases across six v0.1 locales, including mixed-language, contradictory-page, and low-confidence inputs. Executable gates enforce schema, citation coverage, support, recall, language, review routing, rendered locators, source-family retention, and negative controls; E5.04 is verified.

Evidence exists for startup reconciliation of interrupted idempotent document/OCR/Agent jobs.

Still open before P5 completion: signed macOS helper and packaged PDF-renderer acceptance, Windows/Paddle OCR, full-slide/vector/chart/DOCX-media OCR, unsupported or oversized PPTX targets, full Pi-runtime injection coverage, visible progress, cooperative cancellation, and the remaining exits below.

Deferred from this phase:

- [D5.01] Browser-rendered JavaScript-heavy page capture unless later evidence justifies its security and complexity cost.
- [D5.02] Perfect Office layout fidelity; not required for v0.1.
- [D5.03] Cloud OCR; not part of the local-first v0.1 path.

Exit criteria:

- [E5.01] URL, PDF, DOCX, and PPTX inputs produce a source record, preserved asset/reference, checksummed artifact, source page, and useful note or proposal with available locators.
- [E5.02] Core parser tools are registered and available without task-time downloads; optional OCR install/repair is explicit, checksummed, and user initiated.
- [E5.03] Suspicious source instructions are delimited as untrusted content and cannot change settings, permissions, providers, tools, or `PIGE.md`.
- [E5.04] Multilingual source-to-note golden fixtures pass schema, citation, unsupported-claim, and low-confidence routing checks.
- [E5.05] Images, screenshots, image-only PDF pages, and image-heavy slides become searchable when a supported local OCR capability is available, otherwise jobs remain visibly retryable.

## 11. Phase 6: Home Knowledge Retrieval, Local RAG, And Reader

Context pack: `docs/PRD.md` retrieval and reader sections; `docs/PROMPT_DESIGN.md`; `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`; `docs/MARKDOWN_SCHEMA.md`; `docs/KNOWLEDGE_MODEL_AND_LINKING.md`; `docs/UI_PROTOTYPE.md`; `docs/PERFORMANCE_AND_RELIABILITY.md`; `docs/I18N_DESIGN.md`.

Build:

- [B6.01 -> E6.01] Home knowledge-retrieval UI.
- [B6.02 -> E6.01] Ranked lexical and metadata results.
- [B6.03 -> E6.04] Grounded summary with numbered citations and insufficient-evidence behavior.
- [B6.04 -> E6.03] Bounded Agent Context Pack builder for Home query, Note Agent, and selection actions.
- [B6.05 -> E6.02] Explicit Qwen3 embedding-model download, verification, disable/remove, and status flow.
- [B6.06 -> E6.02] Local RAG engine integration.
- [B6.07 -> E6.02] Chunk indexing and rebuild status.
- [B6.08 -> E6.05] Safe polished note-reader Markdown rendering.
- [B6.09 -> E6.07] Backlinks and related pages beyond the current basic Reader rail.
- [B6.10 -> E6.06] Note Agent side panel with note-scoped context.
- [B6.11 -> E6.06] Note Agent plus selection actions for copy, quote, ask, translate, polish, expand, summarize, and create-note, with proposal-gated mutations.
- [B6.12 -> E6.07] Simple explainable Knowledge Tree with rebuildable domain/topic/concept/source aggregates and source-backed navigation.
- [B6.13 -> E6.08] Source-preserving Markdown editing with valid frontmatter, links, citations, and IME-safe input.
- [B6.14 -> E6.09] Knowledge Tree visual semantics: domain/topic branch weight and fragment leaf quantity/density remain explainable, accessible, and source-backed.
- [B6.15 -> E6.10] Executable retrieval, linking, and summarization regression fixtures for ranking, grounding, citations, related pages, and insufficient evidence.

Deferred from this phase:

- [D6.01] Advanced dashboards; deferred beyond v0.1.
- [D6.02] Force-directed graph visualization and dense graph analytics; deferred beyond v0.1. The simple Knowledge Tree is B6.12.
- [D6.03] User-configured embedding providers; v0.1 owns a local retrieval pack.

Exit criteria:

- [E6.01] Home retrieval works before model download through lexical/metadata search and returns ranked notes rather than answer-only chat.
- [E6.02] Semantic retrieval works after an explicit verified local-model download and index rebuild; disable/remove leaves lexical fallback intact.
- [E6.03] Model calls receive selected snippets, policy/budget metadata, and citation refs, not the full vault or unbounded conversation history.
- [E6.04] Retrieval fixtures pass expected top-result, grounded-summary, citation-coverage, and insufficient-evidence checks.
- [E6.05] Note reader is sanitized, source-safe, keyboard reachable, and within the long-page rendering budget.
- [E6.06] Note Agent and the full v0.1 selection-action set remain context-scoped; mutations create previewable proposals, local copy stays local, and translation remains an action rather than a separate workspace.
- [E6.07] Backlinks, related pages, and Knowledge Tree aggregates rebuild from durable truth and navigate to supporting pages; no advanced graph analytics are exposed.
- [E6.08] Markdown editing preserves valid frontmatter, clean portable source, wiki links, citations, IME composition, and external-edit conflict safety.
- [E6.09] Knowledge Tree visual weight and density encodings are deterministic, keyboard/screen-reader interpretable, and traceable to rebuildable source-backed aggregates without exposing advanced graph analytics.
- [E6.10] Retrieval, linking, and summarization fixtures enforce ranking, grounding, citation coverage, related-page, and insufficient-evidence thresholds without accepting a narrower ingest-only report.

## 12. Phase 7: Confirmation, Memory, And Conversation Polish

Context pack: `docs/AGENT_MEMORY_DESIGN.md`; `docs/DATA_ARCHITECTURE.md`; `docs/UI_PROTOTYPE.md`; `docs/SECURITY_THREAT_MODEL.md`.

Build:

- [B7.01 -> E7.01] Confirmation-proposal UI.
- [B7.02 -> E7.01] Unified text diff and new-page preview.
- [B7.03 -> E7.01] Approve/reject proposal flow with conflict detection.
- [B7.04 -> E7.01] Redacted operation records for every applied Agent write, including job ID, model profile, source IDs, and changed paths.
- [B7.05 -> E7.02] Explicit "remember this" flow with provenance.
- [B7.06 -> E7.02] Memory inspection, disable, delete, export, and reset.
- [B7.07 -> E7.05] Secret scanning before memory persistence.
- [B7.08 -> E7.03] Conversation-history browsing and job references.
- [B7.09 -> E7.04] Conversation-retention compaction for successful job detail.

Deferred from this phase:

- [D7.01] Outsourced third-party memory runtime as the core; Pige-native memory remains required.
- [D7.02] Full visual diff editor; unified text diff and compact new-page preview are sufficient for v0.1.

Exit criteria:

- [E7.01] Risky edits are never silently applied; approve/reject decisions are durable, checksum conflicts block stale application, and every applied Agent write creates a redacted operation with job ID, model profile, source IDs, and changed paths.
- [E7.02] Memory is inspectable, provenance-linked, scoped, reversible, exportable, and independent from note/source deletion.
- [E7.03] Conversation history remains readable and restart-safe without duplicating large source assets or saved note bodies.
- [E7.04] Compaction preserves event identity, source/job/operation references, decisions, and user-visible summaries while discarding only rebuildable detail.
- [E7.05] Secret scanning and broad-behavior confirmation prevent sensitive or unsafe memory persistence.

## 13. Phase 8: Skills, Packages, And Permission Broker

Context pack: `docs/SKILL_EXTENSION_DESIGN.md`; `docs/PI_PACKAGE_RESEARCH.md`; `docs/SECURITY_THREAT_MODEL.md`; `docs/DOMAIN_MODEL.md`.

Build:

- [B8.01 -> E8.02] Permission Broker service.
- [B8.02 -> E8.02] Permission-dialog UI with safe summaries.
- [B8.03 -> E8.03] Ask Every Time, Remember Scoped Grants, and YOLO Full Access defaults.
- [B8.04 -> E8.03] Machine-local, scoped, revocable permission records with provenance.
- [B8.05 -> E8.01] Skill Registry Service.
- [B8.06 -> E8.01] Pure Skill staging/install from URL, Markdown, and ZIP plus explicit chat-initiated staging, enable, disable, uninstall, export, and source-aware update.
- [B8.07 -> E8.01] External/Web Skill staging with capability disclosure.
- [B8.08 -> E8.02] Runtime permission prompts for sensitive Skill and package capabilities.
- [B8.09 -> E8.04] Curated Pi package catalog and manager with reviewed recommendations and explicit search/inspection.
- [B8.10 -> E8.04] Pi package install, enable/disable, update, uninstall, version pinning, rollback, rollback-safe records, and trust/capability/data-boundary disclosure.

Deferred from this phase:

- [D8.01] Open unreviewed marketplace as the default experience; deferred beyond v0.1.
- [D8.02] Hidden arbitrary or task-time package installation; prohibited.
- [D8.03] Skill-defined custom UI panels; deferred beyond v0.1.

Exit criteria:

- [E8.01] User can explicitly initiate Skill staging from Settings or chat, then inspect, install, enable, disable, update, uninstall, and export each supported Skill class with ZIP/path safety and declared capabilities.
- [E8.02] Sensitive Skill/package actions pause in `waiting_permission`; deny and allow-once are explicit, redacted, restart-safe, and leave the app stable.
- [E8.03] Scoped grants and YOLO auto-allow honor scope, provenance, visibility, revocation, and operation logging; no source/model/package input can enable them.
- [E8.04] Curated Pi packages can be searched, inspected, explicitly installed, enabled/disabled, updated, version-pinned, rolled back, and uninstalled; ordinary Agent jobs never install them implicitly.

## 14. Phase 9: Backup, Restore, Knowledge Health, Migration, And Release Hardening

Context pack: `docs/DATA_ARCHITECTURE.md`; `docs/RELEASE_ENGINEERING.md`; `docs/PERFORMANCE_AND_RELIABILITY.md`; `docs/SECURITY_THREAT_MODEL.md`; `docs/KNOWLEDGE_MODEL_AND_LINKING.md`; `docs/I18N_DESIGN.md`; `docs/UI_PROTOTYPE.md` accessibility and empty-state sections; `docs/QUALITY_AND_TEST_STRATEGY.md`.

Build:

- [B9.01 -> E9.01] `.pige-backup.zip` creation.
- [B9.02 -> E9.01] Versioned backup manifest with counts, include/exclude decisions, checksums, and external dependencies.
- [B9.03 -> E9.02] Restore preview.
- [B9.04 -> E9.02] Restore into a validated new folder with explicit vault identity handling.
- [B9.05 -> E9.02] Conflict and incompatible-schema detection.
- [B9.06 -> E9.02] Database, lexical, graph, chunk, and vector-index rebuild after restore according to available capabilities.
- [B9.07 -> E9.03] Versioned migration framework with rollback/repair evidence and no silent durable-data loss.
- [B9.08 -> E9.04] Trash-first cleanup, compaction, repair, and reset lifecycle verification across every durable data class.
- [B9.09 -> E9.05] Deterministic Knowledge Health report for broken links, orphans, duplicate-topic candidates, and unsourced claims.
- [B9.10 -> E9.06] Six-locale coverage for release-critical workflows, including unavailable, error, permission, restore, and long-label states.
- [B9.11 -> E9.07] Keyboard, focus, accessible-name, contrast, reduced-motion, and narrow-window accessibility baseline.
- [B9.12 -> E9.08] GitHub Actions release artifacts for macOS and supported Windows versions.
- [B9.13 -> E9.09] Auto-update alpha channel with risky-job safeguards.
- [B9.14 -> E9.08] Installer-size, 10,000-page/100,000-chunk scale, and idle/active-memory threshold reporting.
- [B9.15 -> E9.08] License notices, release notes, dependency attribution, and signing/notarization evidence when credentials are available.
- [B9.16 -> E9.10] Public Alpha scenario with at least 25 mixed sources, degraded paths, restarts, backup, fresh-folder restore, and post-restore retrieval.
- [B9.17 -> E9.11] Error-state, empty-state, privacy-copy, known-limitations, and basic-shortcut release polish.
- [B9.18 -> E9.12] Language metadata for sources/pages/OCR/chunks/memory, source-language preservation, and query-language response behavior.

Deferred from this phase:

- [D9.01] Cloud sync; post-v0.1.
- [D9.02] Mobile app; post-v0.1 Mobile Lite remains a future client boundary.
- [D9.03] Linux packaging; deferred until a later platform decision.

Exit criteria:

- [E9.01] Backup includes required durable vault data, trash/tombstones, vault Skills, memory, conversations, proposals, operations, and non-secret settings; it excludes secrets, models, tools, database, indexes, and caches by default and reports external dependencies.
- [E9.02] Previewed fresh-folder restore validates archive paths and schemas, preserves stable IDs and durable records, resolves vault-copy identity explicitly, and rebuilds only derived state.
- [E9.03] Versioned migration preserves durable data and stable IDs; failure has a documented rollback or repair path.
- [E9.04] Trash-first lifecycle checks prove Agent, Skill, package, cleanup, compaction, repair, and reset cannot permanently delete durable knowledge or source evidence.
- [E9.05] Knowledge Health deterministically finds the required issue classes and routes proposed repairs through safe auto-apply or confirmation without silent broad rewrites.
- [E9.06] Core workflows pass smoke tests in `zh-Hans`, `en`, `ja`, `ko`, `fr`, and `de`, including CJK search and narrow long-label layouts.
- [E9.07] Keyboard-only navigation, visible focus, accessible names/tooltips, readable contrast, reduced-motion behavior, and unavailable/error states pass the v0.1 accessibility baseline.
- [E9.08] CI produces attributable macOS and supported Windows alpha artifacts; each core distributable is at or below 330,000,000 bytes excluding optional weights, packaged idle/ordinary-use memory and post-heavy-Job recovery pass the exact Performance and Reliability reference scenarios, the 10,000-page/100,000-chunk scale smoke passes, and license/signing/release-note evidence is recorded.
- [E9.09] App updates from one alpha to another without breaking vault data and does not update during an active risky job.
- [E9.10] The scripted Public Alpha scenario report proves at least 25 mixed sources, a degraded path, restart recovery, backup, fresh-folder restore, and continued grounded retrieval.
- [E9.11] Public privacy/support/security copy matches actual data flows; error and empty states are localized, actionable, and do not expose secrets or private paths.
- [E9.12] Captured sources, generated pages, OCR artifacts, chunks, and memory retain useful language metadata; source language is preserved by default, and Home retrieval can accept and answer in the query language with CJK lexical and multilingual semantic coverage.

## 15. Execution Controls

`AGENTS.md` owns the current task protocol and stop conditions; `docs/QUALITY_AND_TEST_STRATEGY.md` owns test depth and release gates. A handoff is complete only when its stable Requirement, Build, and Exit mapping is current in the acceptance manifest, relevant checks pass, and any remaining work has an explicit structured destination. Historical scaffold order is intentionally omitted because the repository has already progressed beyond it.
