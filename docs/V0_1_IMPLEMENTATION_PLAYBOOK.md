# v0.1 Implementation Playbook

Status: Active implementation sequence
Baseline date: 2026-07-09
Last revised: 2026-07-26

## 1. Purpose

This document is the sole owner of P0-P9 phase numbers, stable Build commitments, phase-local deferrals, and Exit criteria. `docs/MILESTONES.md` owns M0-M7 release outcomes and the sole Phase-to-Milestone crosswalk; owner architecture documents define the contracts each slice must satisfy.

## 2. Product North Star For v0.1

The PRD owns scope. Phases must compose into one usable journey: install, open a vault,
connect BYOK, converse through Pi, preserve sources, use local knowledge when relevant,
grow portable Markdown and Dataset knowledge with Activity/Undo, resolve rare exceptions,
and back up/restore safely.

## 3. Implementation Strategy

### 3.0 Foreground Architecture Reset

Only AR1-AR3 may pause features: Day 10 runs proof; Day 14 returns unfinished work to P0-P9
and ends the pause. Dates/statuses do not backfill or rise. AR4 is historical, and no new
AR phase follows AR3.

The manifest owns AR1 proof: `node scripts/verify/architecture-reset.mjs --phase-proof=AR1`
rejects duplicate approval/egress pipelines and Host semantic routing. The canonical
Permission Policy Store, `waiting_permission`, saved-grant, and YOLO schemas are intentional
authority owners, not AR1 debt; verifier allowlists must stay exact to those reviewed owners.

| Phase | Development outcome | Required proof |
| --- | --- | --- |
| AR1 authority | Remove routine prompts and duplicate permission/egress pipelines; retain one low-interruption policy and high-risk/Provider boundaries | Exact reviewed owners only; denied risk and hard exclusions execute nothing |
| AR2 Pi ownership | Replace Host pipelines with Pi-selected tools | Pi traces; no Host synthesis; sources preserved |
| AR3 reliability | Unify Job reliability and trust-boundary schemas | Crash/cancel/idempotency/data/IPC proof |

Planning defines Phase 0 efficacy evidence; Project Management records body-free Git/CI/task
timing and blocked-feature facts. No new document/tier, pause extension or status claim.

Build one coherent vertical slice inside existing phase assignments; select by user value:

- Core journeys outrank rare-edge completeness. After external-root reconnect, next is
  the production file-ingestion loop on sole main: handoff/drop/attachment → one Agent
  turn → Pi-selected preserve/parse/OCR/retrieve/organize → final/citations → restart
  recovery. Close with real Electron evidence, not document status.
- Core paths target the best implementation; common support reliable use; rare edges may
  fail closed and stay planned. Settings/Backup/reconnect/recovery breadth is normal unless
  it blocks that loop or presents P0 data-loss/security risk.
- Each slice names its phase and requirements, preserves deferrals, and adds only the
  smallest safety/test dependency. Only scope or assignment changes update PRD,
  Milestones, this Playbook, Spec Traceability and Decision Log.

Phase completion rule:

- A phase is complete only when its documented exit criteria pass and required verification evidence is available at the appropriate risk level.
- Failed required checks or unresolved ambiguity in source-of-truth ownership, durable data, permissions, security, recovery, or user-visible behavior block completion.
- Completion must not leave half-enabled product surfaces, partially exposed contracts, or documentation that implies unavailable behavior is ready.
- Non-blocking improvements belong to later-phase work; the number of work rounds neither proves completion nor requires a phase to continue.

Current implementation state, last reconciled 2026-07-13:

| Phase | State | Interpretation |
| --- | --- | --- |
| P0 | in progress | Repository/trace foundations have evidence; completion remains open. |
| P1 | in progress | Desktop, vault, settings, diagnostics, and runtime foundations have evidence; completion remains open. |
| P2 | in progress | Capture plus bounded process-local Job/recovery foundations have evidence; completion remains open. |
| P3 | in progress | BYOK and embedded Pi tool/turn foundations have evidence; completion remains open. |
| P4 | in progress | SQLite, lexical search, Library, and rebuild foundations have evidence; completion remains open. |
| P5 | in progress | Web/document/OCR Artifact and recovery slices have evidence; completion remains open. |
| P6 | in progress | Retrieval, cited Home, Reader, and relationship foundations have evidence; completion remains open. |
| P7 | in progress | Autonomous knowledge, memory, and conversation acceptance remains below. |
| P8 | in progress | Skill, package, third-party isolation, and high-risk confirmation acceptance remains below. |
| P9 | in progress | Backup, restore, health, localization, accessibility, and release acceptance remains below. |

Acceptance owns per-Requirement/Exit evidence and open work; no row above claims phase
completion.

## 3.1 Pre-Phase 0 Design Readiness Gate

Do not start Phase 0 scaffolding until the design baseline is ready enough that the first workspace commit will not immediately encode known product, data, security, or repository mistakes.

Ready for Phase 0 means:

- Product positioning, v0.1 scope, milestone sequence, and PRD P0 interpretation agree across PRD, Milestones, this playbook, Spec Traceability, and Decision Log.
- Non-negotiable invariants in `AGENTS.md`, `README.md`, and owner docs agree on open
  durable truth, source ownership, rebuildable indexes, secrets, permissions, privacy,
  no hidden downloads, and simplicity-first UI.
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
- Agent slices follow the architecture's H1-H4 responsibility/no-growth sequence without status promotion.

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
- [B1.03 -> E1.02] Optional model setup with truthful model-unavailable Agent outcomes when skipped or unavailable; no separate capture-only mode.
- [B1.04 -> E1.04] Settings > Knowledge Base > Vault & Note Storage with vault identity, active paths, storage strategy, reveal, open/create, recent vaults, and backup/restore entry points.
- [B1.05 -> E1.03] Default vault layout.
- [B1.06 -> E1.03] `PIGE.md`, `index.md`, `log.md`, and manifest creation.
- [B1.07 -> E1.11] Compact capture window.
- [B1.08 -> E1.11] Expandable sidebar shell.
- [B1.09 -> E1.11] Window mode service.
- [B1.10 -> E1.05] Local settings without secrets.
- [B1.11 -> E1.05] Settings registry and typed scopes for vault-portable, machine-local, machine-vault binding, secret, permission, and derived values.
- [B1.12 -> E1.06] Agent Runtime Policy Context builder for storage, model, cloud-send, confirmation, permission, language, memory, retrieval, and capability status.
- [B1.13 -> E1.12] Agent runtime-status foundation, provider/model profile storage, and one effective default-model contract without Advanced/Fast routing UI.
- [B1.14 -> E1.07] Bounded local diagnostics, redaction, health summary, user-initiated support-bundle preview/export, and explicitly reviewed aggregate Provider metadata without Provider/model identity or credentials.
- [B1.15 -> E1.08] Local SQLite abstraction and empty migration system.
- [B1.16 -> E1.09] Reset Local Database repair action.
- [B1.17 -> E1.13] Agent-first Home/navigation contract: essential empty state, no modes, collapsible sidebar, layout continuity, and a browsable three-level Library tree.
- [B1.18 -> E1.14] Version-pinned bundled core toolchain manifest, readiness check, and visible repair path for missing or damaged tools.
- [B1.19 -> E1.15] Machine-local secret-storage adapter with bounded no-follow file identity, restart-safe Provider references, reviewed Pi authentication use, and deletion invalidation without writing values to the vault.
- [B1.20 -> E1.16] Shared namespaced error schemas for API/IPC, durable Job warnings/errors, diagnostics, localization, and retry/repair actions.
- [B1.21 -> E1.17] Stable path-independent ID and sync-conflict metadata foundation for durable records.
- [B1.22 -> E1.18] Runtime capability contracts for Agent, tool, parser, OCR, and RAG adapters with explicit unavailable/degraded states.
- [B1.23 -> E1.19] No-telemetry/no-auto-upload baseline plus bounded local diagnostic log rotation, retention, content redaction, and fixed-fact Main/renderer/child runtime-fault observation.
- [B1.24 -> E1.20] Main-process closed-list high-risk setting/effect guard; ordinary reversible settings do not re-prompt.
- [B1.25 -> E1.21] Atomic checksum-aware Markdown write and external-change conflict foundation.
- [B1.26 -> E1.22] Executable conversation-event and operation-kind vocabulary parity with the job/operation owner document.

Deferred from this phase:

- [D1.01] Full ingest; assigned to P3 and P5.
- [D1.02] OCR; assigned to P5.
- [D1.03] Local RAG; assigned to P6.
- [D1.04] Skill execution; assigned to P8.

Exit criteria:

- [E1.01] User can create and open a vault through validated paths.
- [E1.02] User can skip model setup without losing submitted sources; unavailable Agent work remains explicit without a second product mode.
- [E1.03] Default vault files are visible, human-readable, schema-valid, and free of machine-local active paths.
- [E1.04] User can find and reveal note/source storage, switch or create vaults, configure the future managed-copy location, reconnect the same unavailable external root after exact evidence proof, and reach backup/restore without entering diagnostics or maintenance surfaces.
- [E1.05] Every exposed setting is registered; machine-local values and secrets are absent from the vault manifest and default backup inputs.
- [E1.06] Agent-affecting settings have typed policy effects and owning-service enforcement rather than prompt-only behavior.
- [E1.07] Diagnostics export is redacted, previewed, cancelable, local-only, bounded, and free of raw secrets or source/note bodies by default.
- [E1.08] Deleting `.pige/db/` does not delete user-owned files, and the empty migration/rebuild path succeeds through a completed durable `index_rebuild` Job.
- [E1.09] Reset Local Database re-proves the confirmed active Vault binding, removes only `.pige/db`, `.pige/indexes`, and `.pige/cache`, preserves Markdown knowledge, source records/assets, memory, conversations, Jobs, proposals, operations, skills, and trash, and returns the completed rebuild result.
- [E1.10] Renderer reaches privileged capabilities only through typed preload IPC.
- [E1.11] Compact and expanded shell modes retain current context and remain usable in the six catalog locales.
- [E1.12] One default model profile can be stored and resolved through the adapter contract without exposing ineffective Advanced/Fast controls.
- [E1.13] Home opens Agent-first with an essential mode-free empty state; layout changes preserve context and the sidebar exposes three Library levels when available.
- [E1.14] Packaged core tools are version-pinned, report ready/missing/damaged state, and expose a user-visible repair path without an ordinary job improvising a download.
- [E1.15] A Settings-written synthetic Provider key remains only in the owner-restricted machine credential store, survives restart, authenticates one reviewed Pi Provider call, becomes unusable after Provider deletion, and never enters vault files, SQLite, logs, diagnostics, operations, or backups.
- [E1.16] API errors, durable Job warnings/errors, diagnostics, and UI failure actions validate against one shared taxonomy; malformed codes or unstructured private details are rejected, and every locale covers release-visible message keys.
- [E1.17] Stable IDs remain valid across rename/path changes and durable contracts expose explicit sync-conflict metadata without using a path as identity.
- [E1.18] Agent, tool, parser, OCR, and RAG work resolves through typed runtime-capability adapters; unavailable capabilities fail visibly without renderer or domain-layer runtime assumptions.
- [E1.19] No product analytics or automatic diagnostic/crash upload is configured; local logs rotate within bounded retention while rejecting secrets and large private bodies, and runtime faults record only fixed bounded facts without exception/process identity.
- [E1.20] Closed-list high-risk settings/effects fail closed unless the exact explicit confirmation reaches the main-process owner.
- [E1.21] Interrupted Markdown writes recover atomically, and a changed target checksum produces a visible conflict instead of silent overwrite.
- [E1.22] Every executable conversation-event type and operation kind is documented by the owner contract; adding or removing a value breaks traceability until parity is restored.

## 7. Phase 2: Capture Reliability

Context pack: `docs/PRD.md` input requirements; `docs/PARSER_INGEST_SPEC.md`; `docs/DATA_ARCHITECTURE.md`; `docs/SOURCE_STORAGE_STRATEGY.md`; `docs/PERFORMANCE_AND_RELIABILITY.md`; `docs/DOMAIN_MODEL.md`; `docs/QUALITY_AND_TEST_STRATEGY.md`; `docs/UI_PROTOTYPE.md` voice and capture sections; `docs/I18N_DESIGN.md` speech-language behavior; `docs/SECURITY_THREAT_MODEL.md` microphone and source-preservation boundaries.

Build:

- [B2.01 -> E2.02] Text capture plus the manifest-owned large-paste staging and
  exact-once managed-source boundary.
- [B2.02 -> E2.04] Local macOS voice dictation when supported, with explicit unavailable states elsewhere.
- [B2.03 -> E2.05] Markdown and TXT file capture.
- [B2.04 -> E2.06] PDF, DOCX, PPTX, and common-image preservation with metadata-only
  source projections and one visible Agent dependency job; parser/OCR child Jobs begin
  only from later Agent tool calls.
- [B2.05 -> E2.07] Immediate whole-window drop plus staged composer attachments.
- [B2.06 -> E2.08] Stable source ID generation.
- [B2.07 -> E2.08] Source-record creation and policy-driven source-asset preservation.
- [B2.08 -> E2.01] Persistent job queue.
- [B2.09 -> E2.03] Reference-based conversation events for file, large-paste, and explicit
  authored-text captures, with deterministic replay and safe restart projection.
- [B2.10 -> E2.09] Home queued, running, failed, completed, waiting-dependency, and awaiting-review status presentation.
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
- [E2.02] `resources/large-paste-boundary.manifest.json` is implemented end to end:
  ordinary text stays within its Unicode code-point bound; larger exact pastes share one
  ordered staged list with files, remain side-effect free until Send, and are stored once
  as managed sources with reference-only conversation history and duplicate-free retry.
- [E2.03] Capture events are durable, body/path-free, and reference exact Source, Capture,
  parent conversation event, and Job identities; restart projects the safe references and
  page-backed captures reopen through Reader while only bounded short chat text remains inline.
- [E2.04] Supported macOS dictation inserts local transcript text after on-demand microphone permission; unsupported platforms show a clear state and no dictation audio is sent to model providers.
- [E2.05] Markdown and TXT capture preserves the original source, creates one source record, and does not duplicate large bodies into conversation events.
- [E2.06] PDF, DOCX, PPTX, and image capture preserves evidence before processing and
  creates a visible retryable Agent dependency job without starting parser/OCR work.
- [E2.07] Drop release immediately submits one bounded Agent turn; composer picker stays
  side-effect-free until Send atomically creates one parent Job, and failed submit keeps
  exact text/chips without exposing paths or duplicating retry.
- [E2.08] Source IDs remain stable across retry, and the selected copy/reference strategy affects new captures through the Source Storage Service.
- [E2.09] Home and timeline show durable, localized, redacted job state and progress without claiming completion early.
- [E2.10] Retry is idempotent; cancellation preserves sources and leaves no half-enabled UI or ambiguous durable state.
- [E2.11] Missing model, tool, path, or runtime dependencies enter visible retryable `waiting_dependency` with a structured repair/retry action and no source loss.

B2.08/B2.11 cover fenced cancellation/recovery/CAS; other classes, atomicity, final-syscall
TOCTOU and Windows remain open. B2.02 covers macOS 26 session/UI/helper, permission,
editable text, no audio, teardown and arm64 package/distribution. Apple asset install is
explicit/non-durable; UI evidence did not run it. E2.04 stays planned pending publication,
macOS x64, other platforms and public signing.

## 8. Phase 3: BYOK And Basic Agent Ingest

Context pack: `docs/PRD.md` BYOK and Agent workflow sections; `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`; `docs/TECH_ARCHITECTURE.md`; `docs/PROMPT_DESIGN.md`; `docs/MARKDOWN_SCHEMA.md`; `docs/KNOWLEDGE_MODEL_AND_LINKING.md`; `docs/JOB_OPERATION_AND_RECOVERY.md`; `docs/SECURITY_THREAT_MODEL.md`; `docs/DATA_ARCHITECTURE.md`.

Build:

- [B3.01 -> E3.01] Preset-first Provider profiles whose reviewed templates bind protocol/Endpoint; Custom Provider alone selects a compatible protocol.
- [B3.02 -> E3.02] Encrypted-by-default API-key storage.
- [B3.03 -> E3.01] Non-durable discovery plus one real Pi bootstrap generation/tool probe and all-or-restore readback before persistence.
- [B3.04 -> E3.01] Unified Provider model inventory with auto-sync/Refresh, merged manual fallback, enable/alias controls, revision-fenced manual removal, and provider-grouped Global Default.
- [B3.05 -> E3.03] Simple Provider send boundary: Connect/select plus Send authorizes
  exact user-authored and selected bounded context unchanged; keep stored credentials
  out of the payload and fail on Provider/model identity drift.
- [B3.06 -> E3.04] Basic ingest prompt path with untrusted-source boundaries.
- [B3.07 -> E3.05] Structured validation feedback plus autonomous correction,
  replan/narrow/abstain/exception routing inside the same Agent Job.
- [B3.08 -> E3.04] Source-page generation.
- [B3.09 -> E3.04] Simple wiki-page generation.
- [B3.10 -> E3.04] Append-only `log.md` update.
- [B3.11 -> E3.06] Transitional deterministic create-note proposal/recovery foundation for exceptional review.
- [B3.12 -> E3.07] Agent output/change summary for knowledge fields, citations, writes,
  Operations/Undo, and created/updated/linked/skipped/failed/needs-attention results.
- [B3.13 -> E3.08] Embedded Pi plus a schema-complete Pige Tool Registry; submission
  creates the Agent Job, source preservation is its first checkpoint, and Pi alone
  selects, revisits, and replans semantic tools, Pi-authored Markdown writes, and rejected
  output, with no host-fixed/parallel path, effect-as-terminal shortcut, or one-correction script.
- [B3.14 -> E3.09] Versioned unified `agent_turn` ingress: probed explicit-protocol Provider binding,
  ordinary/no-evidence conversation, optional local retrieval, source tools, durable
  waiting/resume, Agent-owned completion/repair, safe replacement-draft streaming, and no
  renderer/Host intent heuristic.

Agent Spine Gate: Pi handles preserved input, selected parse/OCR/retrieval, cited create/
append, bounded tags/link, and transitional review. B3.13/E3.08 remains partial: broader
tools/routes, legacy ingest repair, real production Broker callers, and broader exceptions
remain; no deep/forked loop. A compatible cited existing-note append plus bounded tag
additions is one recovered `update_page` Operation, not a second partial write.

H2 makes `agent.submitTurn` the sole new semantic ingress, marks new sources
`agent_turn`/`capture_only`, and normalizes old missing fields to `legacy_agent_ingest`.
Pi-selected children stay deterministic; fixed ingest repair/order and Home modality/order
constraints are removed. New turns omit legacy proposal staging; raw review IPC fails
closed for list/get/approve/reject pending a bounded DTO. No status change; H3/H4 remain unchanged.

B3.14/E3.09 evidence covers direct/retrieved/file/URL turns, waiting/resume, exact-tail
follow-up/history/adoption/cancellation, safe draft replacement, IME send, same-Job
validation repair/read revisit/non-progress bounds, and typed protocol incompatibility.
Migration-window ingest recovery, durable mid-repair adoption, source-ingest drafts, live
provider timing, multi-window/source recovery, and signed packaged macOS/Windows BYOK
remain open; E3.09 stays incomplete.

B3.05 has the default, exact-destination disclosure, matrix/profile-switch tests,
exact-payload and credential-isolation tests, binding revalidation, and ordinary
selected-provider sends without content-policy or approval/audit state. Durable
no-duplicate continuation of an in-flight Pi transcript, remaining provider adoption,
and signed cross-platform proof keep E3.03 incomplete.

Deferred from this phase:

- [D3.01] Pi's full provider catalog or a provider marketplace in default UI; not required for v0.1.
- [D3.02] Advanced/Fast model routing UI; deferred until effective runtime routing exists.
- [D3.03] User-configured embedding providers; local RAG is assigned to P6.
- [D3.04] External Skill execution; assigned to P8.

Exit criteria:

- [E3.01] A reviewed preset and compatible/custom path hide ordinary protocol choices,
  auto-sync one deduplicated inventory, preserve it on refresh failure, accept manual
  fallback, and resolve one enabled Global Default through the real Pi probe.
- [E3.02] API keys do not appear in vault files, SQLite, logs, persisted prompts, diagnostics, operations, or backups.
- [E3.03] Explicit Send to an exact connected Provider/model transmits the exact
  user-authored and selected bounded context unchanged. Stored credentials stay outside
  payload content; no content classification, rewriting, blocking, or egress audit occurs.
- [E3.04] Pasted text autonomously becomes a cited source page, schema-valid wiki note,
  index update, append-only log, and Operation when eligibility passes. Publication
  re-proves the exact active Vault, running Job, Source and durable capture event; retry
  adopts the same Operation-bound log entry without another model turn or duplicate write.
- [E3.05] Upstream Pi's final assistant message is not rejected for missing a Host semantic
  schema, terminal tool, grounding label, or citation shape. Invalid tool input or durable
  mutation still fails at its owner boundary without applying an effect; true technical,
  authority, conflict, cancellation, or resource boundaries remain typed.
- [E3.06] Irreversible/security/destination/conflict/stricter-policy exceptions stage
  durably; current exact create-note review is transitional recovery evidence.
- [E3.07] Agent ingest emits required knowledge/citation/write fields and a deterministic created/updated/linked/skipped/failed/needs-attention summary with recovery refs.
- [E3.08] One source submission enters one Pi Job whose first preservation checkpoint and
  subsequent selected model/registered tools produce Pi-authored cited Markdown. One
  Host/catalog proves distinct Agent-chosen traces and replan;
  parser/OCR stays idle before its event, no-model preserves only, writes are tool-caused
  and retry-safe, typed validation rejection remains inside Pi until accepted/abstained,
  effects do not block model/inspect/search/parse/OCR continuation; exact owners reject
  conflicting mutations, while one same-page cited update plus bounded tags shares one durable
  checkpoint/Operation/Undo recovery; cross-page or mixed-target recovery remains AR3. Active-vault eligible knowledge-
  Markdown writes need no Permission prompt; Pi-requested Pige-owned or extension scopes
  outside standing authority remain Phase 8 Broker acceptance.
- [E3.09] One real DeepSeek-first app path persists the user turn and `agent_turn`, keeps
  Global Default across restart, uses the selected probed binding with truthful status,
  waits/resumes without a model, answers ordinary empty-vault chat, retrieves cited
  knowledge when Pi chooses, replans after rejected tool inputs without a manual
  retry, safely replaces a provisional draft with the durable final, and uses file/URL
  tools without heuristic, fixed correction count, presentation-only provider call, or
  silent fallback.

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
- [B4.08 -> E4.06] Implemented grounded Home Agent creation and restart adoption for schema-valid topic, concept, entity, claim, and question pages with stable IDs and one `create_page` Operation; tags remain lightweight facets.

Managed knowledge-page lifecycle is now complete for notes, claims, questions, concepts, entities
and topics: exact-current archive/restore, trash/list/restore, bounded revision history, immutable
preview, reversible restore and restart adoption share the same Main-owned boundary. Source pages
remain deliberately read-only. This closes PIGE-KNOW-001; E4.01/E4.05 remain partial for their
independent packaged metadata/relationship and migration breadth.

Library browsing now exposes each durable Topic, Concept, Entity, Claim and Question family as an
exact type filter for both empty-query browse and bounded local search. It reuses the existing
pathless Library/Search authority; a stale result from another selected family cannot replace the
current view. PIGE-UI-003 remains partial for its independent shell/platform acceptance breadth.

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

Context pack: `docs/PRD.md` input handling; `docs/PARSER_INGEST_SPEC.md`;
`docs/DATA_ARCHITECTURE.md`; `docs/LOCAL_DATABASE_DESIGN.md`;
`docs/TECH_ARCHITECTURE.md` parser/OCR/Dataset sections;
`docs/SECURITY_THREAT_MODEL.md`; `docs/PERFORMANCE_AND_RELIABILITY.md`;
`docs/RELEASE_ENGINEERING.md`.

Build:

- [B5.01 -> E5.01] URL detection beyond the single-URL Home composer route.
- [B5.02 -> E5.01] Address-pinned fetch with private authority and strict fresh Fake-IP IPv4 compatibility.
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
- [B5.13 -> E5.06] Preserve CSV/XLSX/SQLite sources and materialize a lossless typed,
  versioned Dataset Bundle without executing source code or mutating originals.

Transitional implementation evidence/tool substrate snapshot; P5 remains in progress.
The arrows below describe tested bridge behavior, not target semantic orchestration:

Current B5.10 evidence covers only Technical Architecture section 5.8's fake/local
foundation: explicit-user gates, non-networked staged and record commits, independent packs,
recovery, and vault invariance. Production transport/wiring, OCR/UI, supply-chain,
platform, cross-process, and full recovery proof remain open.

B5.13 foundation evidence covers preserve-first CSV/XLSX/SQLite capture, Pi-selected
`pige_inspect_dataset@1`, one deterministic `dataset_import` child, bounded worker plans,
independent Dataset Service validation, versioned `managed_collection` Bundle publication,
`create_dataset_revision`, capability wait/requeue, cancellation before commit, and
byte-idempotent retry/restart. A preserved Home CSV now continues through the same parent
turn from materialization to a cited Dataset answer and restart adoption without a second
source loop or Dataset revision. CSV lexical states, XLSX formula/cache metadata, and
read-only defensive SQLite tables are covered without evaluation or source mutation.
E5.06 remains planned pending complete backup/restore and migration evidence, broader
cross-process recovery/CAS, large-scale and signed macOS/Windows proof, and the remaining
governed structured-source matrix.

Evidence exists for preserved PDF -> recoverable local worker -> deterministic text/metadata artifacts -> page locators -> checksum-safe source-page refresh -> OCR handoff -> Agent ingest when text coverage is useful.

Agent-led Office evidence proves preserve→inspect→parse→inspect→publish for useful
DOCX/PPTX text and preserve→inspect→parse(`needs_ocr`)→selected DOCX/PPTX raster media OCR→inspect→
publish when required. Deterministic children survive wait/retry, parent cancellation
reaches parsing, optional unavailable OCR keeps useful native evidence with warnings,
and no-readable evidence waits without a note. Already-persisted schema-compatible
Office route Jobs remain processable.

PDF and Office parser adapters now create their worker input only after verified Artifact
reuse misses, using private descriptor-derived snapshots for both managed and referenced
sources. Focused tests replace the recorded source pathname during extraction, verify the
Office worker still reads the bound bytes, and verify its temporary input disposal on
both success and failure. Referenced-PDF integration proves that the parser receives a
separate disposable path, while the shared snapshot fixture proves copied bytes survive
later source-path replacement. The remaining packaged-platform matrix stays open.

B5.09 source-page evidence covers stale baselines, concurrent Source Record/Markdown
changes, pending recovery, confined projections/previews, and a capture Job guard that
must persist before new, recovered, adopted, or conflicted projection writes. Edited-page
refresh conflicts now survive restart with four explicit exits; Apply and Save publish exact
Activity/Undo Operations, while stale Source/page revision closes without mutation. Strict
cross-process revision CAS, parent-swap, and cross-file source-page transactions remain
open under Source Storage.

Generated-note evidence covers first-wins cancellation, two Source Record fences,
durable pre-link guard, create-only publication, conflict
preservation, bounded same-job provenance, guarded missing-index repair, and recovery.
The shared Markdown boundary now strictly parses and round-trips all seven managed page
types, preserves unknown fields and exact user body bytes, accepts only the bounded Source
sidecar projection, and excludes malformed pages from Library/index rebuild truth.
The eligible pasted-text path now converges its cited note, index, Operation and append-only
log across restart after exact Vault/Job/Source/capture-event revalidation. Strict
cross-process SourceRecord-to-note CAS, parent-swap, broader multi-effect transactions,
and packaged-platform proof remain open outside E3.04.

Evidence exists for validated-address-pinned static URL fetch -> bounded response -> charset-aware snapshot -> serial Readability/jsdom worker -> checksummed article text and redacted metadata -> quality-aware Agent handoff.

Raster images now run Pi inspect→OCR→inspect→publish over the verified macOS helper, with no-model/capability and empty-output wait, deterministic child/Operation reuse, cancellation, wrong-tool rejection, and managed/reference source proof. Existing tests retain protocol, path, tamper, and reuse coverage.

PDF OCR evidence covers real Pi inspect→parse(`needs_ocr`)→OCR→inspect→publish, parser-selected pages, deterministic reuse, wait/resume, parent cancellation, empty-output stop, and separate native/OCR provenance. Existing renderer/OCR fixtures retain tamper, drift, incomplete-render, referenced-source, and recovery coverage; built-worker smoke rasterizes a real no-text page.

Evidence exists for page-aware multi-Artifact Agent handoff -> independently checksummed native/OCR bodies -> sidecar pairing by Source ID, sidecar Artifact ID, kind, and body checksum -> bounded ordered Evidence Pack with supplemental-OCR reserve -> same-parent duplicate suppression -> collision-safe canonical locators -> statement-level `ev_NN` refs -> canonical Markdown citations. PDF parser sidecars provide exact page spans; unknown/missing refs block publication and force replan/abstention without a fabricated locator.

B5.11 adversarial evidence now covers URL Readability, DOCX, PDF, PPTX, and image-OCR handoff through the public ingest boundary. It verifies delimiter escaping, unchanged control-plane sentinels, deterministic note-path ownership, and strict rejection of model-authored control fields. Full Pi tool/Permission Broker runtime proof remains open, so E5.03 stays partial.

B5.12/E5.04 evidence covers seven text, URL, PDF, PPTX, and image-OCR cases across six v0.1 locales, including mixed-language, contradictory-page, and low-confidence inputs. Executable gates enforce schema, citation coverage, support, recall, language, uncertainty routing, rendered locators, source-family retention, and negative controls; E5.04 is verified.

Evidence exists for startup reconciliation of interrupted idempotent document/OCR/Agent jobs.

Still open before P5 completion: signed packaged proof, Windows/Paddle,
full-slide/vector/chart OCR, unsupported/oversized PPTX targets,
progress/cancel UI, other Job classes, and strict cross-process CAS.

Deferred from this phase:

- [D5.01] Browser-rendered JavaScript-heavy page capture unless later evidence justifies its security and complexity cost.
- [D5.02] Perfect Office layout fidelity; not required for v0.1.
- [D5.03] Cloud OCR; not part of the local-first v0.1 path.

Exit criteria:

- [E5.01] URL, PDF, DOCX, and PPTX inputs produce a source record, preserved asset/reference, checksummed artifact, source page, and useful note or typed exception with available locators.
- [E5.02] Core parser tools are registered and available without task-time downloads; optional OCR install/repair is explicit, checksummed, and user initiated.
- [E5.03] Suspicious source instructions are delimited as untrusted content and cannot change settings, permissions, providers, tools, or `PIGE.md`.
- [E5.04] Multilingual source-to-note golden fixtures pass schema, citation, unsupported-claim, and low-confidence routing checks.
- [E5.05] Images, screenshots, image-only PDF pages, and image-heavy slides become searchable when a supported local OCR capability is available, otherwise jobs remain visibly retryable.
- [E5.06] CSV, XLSX, and supported SQLite inputs preserve original bytes and produce a
  validated Dataset manifest/schema/revision/payload or typed safe exception; formulas,
  macros, external links, extensions, triggers, and arbitrary SQL never execute.

## 11. Phase 6: Home Conversation, Local Knowledge, RAG, And Reader

Context pack: `docs/PRD.md` retrieval/reader; `docs/PROMPT_DESIGN.md`; `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`; `docs/DATA_ARCHITECTURE.md`; `docs/MARKDOWN_SCHEMA.md`; `docs/KNOWLEDGE_MODEL_AND_LINKING.md`; `docs/UI_PROTOTYPE.md`; `docs/PERFORMANCE_AND_RELIABILITY.md`; `docs/I18N_DESIGN.md`.

Build:

- [B6.01 -> E6.01] Home chat, safe drafts, optional retrieval.
- [B6.02 -> E6.01] Lexical/metadata rank.
- [B6.03 -> E6.04] Evidence-only citations.
- [B6.04 -> E6.03] Bounded Home/Note/selection Context Pack.
- [B6.05 -> E6.02] Explicit Qwen3 download lifecycle.
- [B6.06 -> E6.02] Local RAG.
- [B6.07 -> E6.02] Chunk index/rebuild.
- [B6.08 -> E6.05] Safe Reader/copy/focus; edit/reveal/keyboard/long-page proof open.
- [B6.09 -> E6.07] Backlinks/related pages.
- [B6.10 -> E6.06] Note Agent.
- [B6.11 -> E6.06] Scoped actions, autonomous Activity/Undo, exceptional review.
- [B6.12 -> E6.07] Rebuildable explainable tree/navigation.
- [B6.13 -> E6.08] Source-preserving Markdown/IME edit.
- [B6.14 -> E6.09] Accessible source-backed weight/density.
- [B6.15 -> E6.10] Retrieval/linking/summary regressions.
- [B6.16 -> E6.11] Bounded local Dataset query/table and exact refs.

Current Home proves durable cited chat/control/IME/final projection, optional empty-vault
answers, and an explicit Pi-selected `vault_only` search whose empty or uncited result
fails honestly without a Host semantic classifier. Deterministic retrieval regression,
10k/100k warm lexical scale, and the packaged Electron cited-Home roundtrip close
PIGE-SEARCH-001; broader mixed-source/query breadth keeps E6.01 partial. B6.05/B6.06/B6.07
prove one Qwen3 lifecycle, body-free rebuild, local vector/hybrid retrieval and bounded
reranking; package/recovery gaps keep E6.02 partial. B6.10/B6.11 prove cited current-note
and Reader action/recovery: append, replace, and selection-transform conflicts all expose the four
explicit exact-revision outcomes with Activity/Undo and restart adoption; broader
mutation/platform proof keeps E6.06/PIGE-UI-005 partial. B6.15 proves unknown citation
refs and exact Source/current-note/Dataset answers without a required Host ref fail closed
to localized insufficiency while general answers remain pass-through; broader model-quality
metrics, linking/ranking breadth, scale and platform/package proof keep E6.10/PIGE-EVAL-004
partial. B6.16 proves fenced bounded queries/citations/paging/Open plus an opaque
same-Dataset relation path of at most three hops through the real Home tool and restart;
analytical snapshots, longer relation paths/aggregate joins, scale/platform and complete
authority proof keep E6.11/PIGE-DATA-002 partial. B6.12/B6.14 prove main-owned rebuildable
tree, exact weight/fragment/source/leaf/density text, fixed bands, review outline, branch
collapse/expand with hidden-match reveal, keyboard and Reader navigation; aggregate/10k/incremental/package/a11y/signed-visual gaps keep
E6.07/E6.09 partial. The same body-free tree now supports bounded title/type result lists,
ancestor-path reveal, keyboard selection and stable-ID Reader open without changing durable state.
PIGE-CONTEXT-001 and PIGE-CONTEXT-002 are verified for the v0.1 local desktop runtime:
Home/current-note, selection/retrieval, mixed attachments, lower-authority memory and
compacted conversation state use bounded cited reference packs; exact pack identity and
safe refs survive restart while policy/evidence/job drift fails closed before the next
model call. Deferred remote-client packs do not gate this local-desktop exit.
PIGE-UI-006 is verified: Reader source metadata stays bounded, related/backlink results expose only
stable safe summaries and closed localized relation labels, and an unavailable graph degrades
without leaking page paths, raw link targets or source bodies. E6.05/E6.07 remain partial for
their independent long-page, aggregate-scale, accessibility and packaged-platform breadth.

Deferred from this phase:

- [D6.01] Advanced dashboards.
- [D6.02] Force/dense graph analytics; B6.12 stays simple.
- [D6.03] User embedding providers; v0.1 stays local.

Exit criteria:

- [E6.01] Home with/without retrieval keeps evidence ranked/cited, provisional text non-authoritative, Pi repair internal, and no-model search distinct.
- [E6.02] Verified local-model retrieval; disable/remove preserves lexical fallback.
- [E6.03] Calls get selected cited snippets plus policy/budget, never whole vault/unbounded chat.
- [E6.04] Retrieval ranking/grounding/citation/insufficiency fixtures pass.
- [E6.05] Reader is sanitized, source-safe, keyboard/long-page safe.
- [E6.06] Scoped actions auto-apply eligible Operations/Undo; exceptions preview; copy local; translation explicit.
- [E6.07] Durable backlinks/related/tree rebuild and navigate; no advanced graph.
- [E6.08] Editing preserves frontmatter/source/links/citations/IME/external-conflict safety.
- [E6.09] Tree weight/density is deterministic, keyboard/a11y-readable, source-backed, non-advanced.
- [E6.10] Retrieval/linking/summary thresholds exceed ingest-only proof.
- [E6.11] Bounded local Dataset plans return deterministic hashes/citations; stale/oversized/unsupported/untrusted narrows/fails visibly.

## 12. Phase 7: Autonomous Knowledge, Memory, And Conversation Polish

Context pack: `docs/AGENT_MEMORY_DESIGN.md`; `docs/DATA_ARCHITECTURE.md`; `docs/UI_PROTOTYPE.md`; `docs/SECURITY_THREAT_MODEL.md`.

Build:

- [B7.01 -> E7.01] Exact create/append/tags/link Activity/Undo, restart-safe exact Agent create/update and note-edit Redo, stable page Open, and transitional review.
- [B7.02 -> E7.01] Bounded escaped exceptional preview plus current-note unified conflict diff,
  exact keep-current/apply-proposed resolution and manual-edit escape; save-new conflict action remains open.
- [B7.03 -> E7.01] Exact create-note review/apply/conflict recovery foundation; exceptional proposal review remains transitional.
- [B7.04 -> E7.01] Hash-bound create/update/tag/link recovery plus exact matching-Undo Redo for Agent-created and Agent-updated pages; current autonomous and approved Agent writes publish attributable recovery-bound Operations.
- [B7.05 -> E7.02] Explicit and exact authored preference/correction/workflow memory with private provenance.
- [B7.06 -> E7.02] Memory inspection, edit, disable, delete, export, reset, and matching
  restart-safe Activity Undo/Redo across repeated lifecycle cycles.
- [B7.07 -> E7.05] Secret and authority-change guards before autonomous vault-memory persistence;
  durable `create_memory` Activity/Undo and restart adoption close the reversible effect.
- [B7.08 -> E7.03] Bounded vault history searches complete durable user/assistant messages,
  projects one safe match excerpt, and reopens the exact matched event without replay; packaged proof remains.
- [B7.09 -> E7.04] Implemented deterministic 90-day compaction for settled successful
  Job detail with exact reference retention, `compact_job` attribution, CAS drift
  rejection, and Operation-first restart adoption; conversation events remain intact.
- [B7.10 -> E7.06] Managed Collections: stable-ID CAS cell/row/field/table/view, formula create/update,
  bounded acyclic same-table nested formula dependencies with stable downstream recomputation,
  one same-Dataset row relation with an editable target/display definition, editable read-only scalar lookup, and editable count/numeric-sum
  rollup definitions use distinct Activity/Undo. Numeric lookup/rollup values feed formulas and propagate
  through relation retarget, target scalar edit, descriptor update, exact Undo, and restart. Target-table
  changes clear old row links; dependent lookup/rollup definitions block relation-definition edits.
  Pige-owned tables start with a nullable Name field; saved-view definitions and stable table display names
  are editable through exact CAS/Activity/Undo.
  Bounded immutable revision history supports read-only preview and explicit forward-only restore with
  restart-safe Undo. Relation/lookup breadth, complete backup/restore, concurrency, broader schema,
  scale/platform and exceptions stay open.

Deferred from this phase:

- [D7.01] Outsourced third-party memory runtime as the core; Pige-native memory remains required.
- [D7.02] Full visual diff editor; unified text diff and compact new-page preview are sufficient for v0.1.

Exit criteria:

- [E7.01] Evidence-bound reversible edits auto-apply with Operation/Undo; irreversible/security/destination/conflict/stricter-policy exceptions use durable stale-checked decisions. Evidence covers exact create, cited append, bounded tags, one directed link, exact user note-edit, saved Collection view lifecycle Redo, complete current Collection cell/row/column/formula/relation/lookup/rollup Redo, and stable page Open; broad history, non-Collection mutations, broader restore, exceptions, CAS, and packaged platforms remain open.
`PIGE-KNOW-003` is verified within that still-broader Exit: exact relation, merge, contradiction,
  Concept/Topic hierarchy and conflict paths now auto-apply only when current and reversible, with
  pathless closed outcomes plus restart-safe Activity Undo/Redo; E7.01 remains partial for unrelated
  mutation families and packaged breadth.
- [E7.02] Memory is inspectable, provenance-linked, scoped, reversible, exportable, and independent from note/source deletion.
- [E7.03] Conversation history remains readable and restart-safe without duplicating large source assets or saved note bodies.
- [E7.04] Compaction preserves event identity, source/job/operation references, decisions, and user-visible summaries while discarding only rebuildable detail.
- [E7.05] Secret scanning precedes memory; scoped reversible memory may grow autonomously, while sensitive/authority-changing memory uses exceptional intervention.
- [E7.06] Validated Collection changes preserve stable Dataset/table/column/row/view IDs,
  revisions, and operation history; eligible local changes auto-apply with Undo, while
  destructive loss, external database writes, new authority, or unresolved conflict pause.

## 13. Phase 8: Skills, Packages, And High-Risk Authority

Context pack: `docs/SKILL_EXTENSION_DESIGN.md`; `docs/PI_PACKAGE_RESEARCH.md`; `docs/SECURITY_THREAT_MODEL.md`; `docs/DOMAIN_MODEL.md`.

Build:

- [B8.01 -> E8.02] Closed-list high-risk confirmation service.
- [B8.02 -> E8.02] Permission-dialog UI with safe summaries.
- [B8.03 -> E8.03] Durable Ask/scoped-grant/YOLO modes; ordinary work stays prompt-free
  and hard boundaries remain confirmed or blocked.
- [B8.04 -> E8.03] Third-party authority isolation and concrete effect decisions.
- [B8.05 -> E8.01] Skill Registry Service (inventory/disable foundation only).
- [B8.06 -> E8.01] Pure Skill staging/install from URL, Markdown, and ZIP plus explicit chat-initiated staging, enable, disable, uninstall, export, and source-aware update.
- [B8.07 -> E8.01] External/Web staging/disclosure, disabled-only install, inert export,
  trash-uninstall and disabled restore; runtime/enable stay B8.08.
- [B8.08 -> E8.02] Raw Shell confirms per effect; a registered immutable install/config/
  auth plan confirms exact supply chain/destinations once and runs current-Job ordinals.
  One Pige-owned External/Web adapter confirms each public-origin read; identity or redirect
  drift closes before network.
- [B8.09 -> E8.04] Curated Pi package catalog and manager with reviewed recommendations, explicit
  search, and installed-package inspection that revalidates private tree/manifest identity before
  projecting exact reviewed disclosure or `unknown`.
- [B8.10 -> E8.04] Pi package install, disabled trash/restore, update, uninstall, version pinning, rollback, rollback-safe records, and trust/capability/data-boundary disclosure; runtime enable stays isolated.

Deferred from this phase:

- [D8.01] Open unreviewed marketplace as the default experience; deferred beyond v0.1.
- [D8.02] Hidden/inferred task-time installation or arbitrary command plans; prohibited.
- [D8.03] Skill-defined custom UI panels; deferred beyond v0.1.

Exit criteria:

- [E8.01] User can explicitly initiate Skill staging from Settings or chat, then inspect, install, enable, disable, update, uninstall, and export each supported Skill class with ZIP/path safety and declared capabilities.
- [E8.02] Ordinary registered first-party actions proceed under submitted-turn authority;
  third-party authority and high-risk effects fail closed without a waiting Job state;
  standing-authority knowledge Markdown and exact selected-source admission do not.
  A concrete high-risk decision is redacted and revalidated by the effect owner; denial
  executes nothing. A reviewed plan confirms once, runs fixed ordinals/probes/OAuth and
  adopts without duplicates. Raw Shell remains per-effect; attachments grant no ambient
  authority, while explicit authored intent remains eligible.
- [E8.03] No source/model/package input can expand authority; the concrete high-risk
  effect is denied or confirmed, and no global mode can bypass it.
- [E8.04] Curated Pi packages can be searched, inspected, explicitly installed, enabled/disabled, updated, version-pinned, rolled back, and uninstalled; ordinary Agent jobs never install them implicitly.

Current legacy evidence has Broker/restart, permission settings, and approval stores;
AR1 deletes those internal mechanisms before new Phase 8 acceptance is claimed. Existing
read-only adapters and public-package acquisition are re-evaluated under submitted-turn
and high-risk authority rather than preserved for compatibility.
Catalog/UI, dependencies, runtime and remaining lifecycle/recovery/platform proof stay
open; Exit and Phase statuses do not change.

## 14. Phase 9: Backup, Restore, Knowledge Health, Migration, And Release Hardening

Context pack: `docs/DATA_ARCHITECTURE.md`; `docs/RELEASE_ENGINEERING.md`; `docs/PERFORMANCE_AND_RELIABILITY.md`; `docs/SECURITY_THREAT_MODEL.md`; `docs/KNOWLEDGE_MODEL_AND_LINKING.md`; `docs/I18N_DESIGN.md`; `docs/UI_PROTOTYPE.md` accessibility and empty-state sections; `docs/QUALITY_AND_TEST_STRATEGY.md`.

Build:

- [B9.01 -> E9.01] `.pige-backup.zip` creation.
- [B9.02 -> E9.01] Versioned backup manifest with counts, include/exclude decisions, checksums, and external dependencies.
- [B9.03 -> E9.02] Archive/sender-bound restore preview plus one apply lease.
- [B9.04 -> E9.02] Ownership-reserved, manifest-last fresh-folder restore with explicit vault identity handling.
- [B9.05 -> E9.02] Conflict and incompatible-schema detection.
- [B9.06 -> E9.02] Database, lexical, graph, chunk, and vector-index rebuild after restore according to available capabilities.
- [B9.07 -> E9.03] Versioned migration framework with rollback/repair evidence and no silent durable-data loss.
- [B9.08 -> E9.04] Trash-first cleanup, compaction, repair, and reset lifecycle verification across every durable data class.
- [B9.09 -> E9.05] Deterministic Knowledge Health report for broken links, orphans, duplicate-topic candidates, and unsourced claims.
- [B9.10 -> E9.06] Six-locale coverage for release-critical workflows, including unavailable, error, permission, restore, and long-label states.
- [B9.11 -> E9.07] Keyboard, focus, accessible-name, contrast, reduced-motion, and narrow-window accessibility baseline.
- [B9.12 -> E9.08] Protected-tag exact-identity publication of an independently verified,
  ad-hoc-signed macOS arm64 ZIP whose quarantined app is expected-untrusted but intact.
  Windows qualification follows.
- [B9.13 -> E9.09] Manual canonical GitHub prerelease download and replacement; packaged
  v0.1 has no network update authority, and trusted automatic A→B update is deferred.
- [B9.14 -> E9.08] Installer-size, 10,000-page/100,000-chunk scale, and idle/active-memory threshold reporting.
- [B9.15 -> E9.08] Notices, notes, attribution, immutable metadata and platform-trust evidence.
- [B9.16 -> E9.10] Public Alpha scenario with at least 25 mixed sources, degraded paths, restarts, backup, fresh-folder restore, and post-restore retrieval.
- [B9.17 -> E9.11] Error-state, empty-state, privacy-copy, known-limitations, and basic-shortcut release polish.
- [B9.18 -> E9.12] Language metadata for sources/pages/OCR/chunks/memory, source-language preservation, and query-language response behavior.

Current foundations cover protected ad-hoc publication and downloaded qualification,
Job-owned backup/restore, and backup-backed manifest-last v1→v2 language/domain migration
with one adopted Operation. The release lane now generates, candidate-binds, independently
reverifies and publishes the real 25-source and 10,000-page/100,000-chunk reports; B9.16/E9.10
remain partial until the next protected release publishes a passed report. E9.01–03/E9.12
retain their residual gates.

B9.01/B9.02 versioned export is verified: publication validates the archive and manifest,
links one durable Backup Job/Operation, and reports renderer-safe external-dependency
completeness without exposing identity or path. E9.01 remains partial only through the
separate default-inclusion and default-exclusion requirements.

B9.09/E9.05 are verified: Knowledge Health deterministically reports all four required
issue classes, and exact eligible broken-link, orphan-parent, duplicate-topic and
unsourced-claim repairs commit through reversible Operations/Undo while drift and broader
rewrites fail closed.

B9.08 now includes direct recovery paths for trashed managed Datasets plus individual-delete and
reset-wide Agent memory: safe inventories survive restart and exact restore reuses each domain's existing
Operation/Undo receipt without exposing paths, bodies, provenance or private tree facts. Exact knowledge-page
permanent deletion additionally requires a second confirmation and persists its tombstone and irreversible
Operation before deleting checksum-bound trash bytes. Other durable classes, compaction and cross-platform
lifecycle breadth remain open, so E9.04 is not promoted.

Deferred from this phase:

- [D9.01] Cloud sync; post-v0.1.
- [D9.02] Mobile app; post-v0.1 Mobile Lite remains a future client boundary.
- [D9.03] Linux packaging; deferred until a later platform decision.

Exit criteria:

- [E9.01] Backup includes required durable vault data, trash/tombstones, vault Skills, memory, conversations, proposals, operations, and non-secret settings; it excludes secrets, models, tools, database, indexes, and caches by default and reports external dependencies.
- [E9.02] Previewed fresh-folder restore validates archive paths and schemas, preserves stable IDs and durable records, resolves vault-copy identity explicitly, and rebuilds only derived state.
- [E9.03] Versioned migration preserves durable data and stable IDs; failure has a documented rollback or repair path.
- [E9.04] Trash-first lifecycle checks prove Agent, Skill, package, cleanup, compaction, repair, and reset cannot permanently delete durable knowledge or source evidence.
- [E9.05] Knowledge Health deterministically finds the required issue classes; eligible
  repairs auto-apply with Operations/Undo, while exact exceptions intervene and broad
  rewrites never happen silently.
- [E9.06] Core workflows pass smoke tests in `zh-Hans`, `en`, `ja`, `ko`, `fr`, and `de`, including CJK search and narrow long-label layouts.
- [E9.07] Keyboard-only navigation, visible focus, accessible names/tooltips, readable contrast, reduced-motion behavior, and unavailable/error states pass the v0.1 accessibility baseline.
- [E9.08] One protected alpha tag produces an attributable ad-hoc-signed macOS arm64 ZIP whose
  downloaded bytes, strict seal and expected-untrusted intact status are independently verified before publication; the core
  distributable is at or below 330,000,000 bytes excluding optional weights, packaged memory/
  recovery and 10,000-page/100,000-chunk scale pass, and notices/trust/notes are evidenced.
  Windows retains the equivalent exit in the next platform phase.
- [E9.09] Packaged v0.1 exposes no network update authority; users verify and manually replace
  the app from the canonical protected-tag GitHub prerelease without changing the Vault.
- [E9.10] The scripted Public Alpha scenario report proves at least 25 mixed sources, a degraded path, restart recovery, backup, fresh-folder restore, and continued grounded retrieval.
- [E9.11] Public privacy/support/security copy matches actual data flows; error and empty states are localized, actionable, and do not expose secrets or private paths.
- [E9.12] Captured sources, generated pages, OCR artifacts, chunks, and memory retain useful language metadata; source language is preserved by default, and Home retrieval can accept and answer in the query language with CJK lexical and multilingual semantic coverage.

## 15. Execution Controls

`AGENTS.md` owns the current task protocol and stop conditions; `docs/QUALITY_AND_TEST_STRATEGY.md` owns test depth and release gates. A handoff is complete only when its stable Requirement, Build, and Exit mapping is current in the acceptance manifest, relevant checks pass, and any remaining work has an explicit structured destination. Historical scaffold order is intentionally omitted because the repository has already progressed beyond it.
