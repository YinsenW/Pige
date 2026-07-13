# AI Agent Instructions

Status: Active repository instructions
Baseline date: 2026-07-09
Last reviewed: 2026-07-10

This repository is intended to be developed heavily with AI assistance. Future agents must treat the design documents as the product contract, not background reading.

## 0. Prime Product Directive: A Simple General Agent

Pige is a simple general Agent strengthened by local knowledge. **Input once, knowledge
grows naturally:** Pi performs validated recoverable work; users inspect or undo, not approve each step.

When implementation exposes powerful catalogs, provider ecosystems, package ecosystems, model capabilities, permissions, indexes, local tools, or Agent internals, hide that complexity behind sensible defaults, progressive disclosure, or internal metadata. Do not turn upstream complexity into visible product complexity unless a user-facing workflow truly needs it.

For model setup, connect one service and choose one default model. One disclosure grants
routine bounded calls to that exact Profile; show quiet status, not repeat prompts.
Local-first means local ownership/truth and no Pige telemetry, not confirmation-first UX.
Sensitive/restricted content and endpoint drift keep their narrow gates. Hide routing,
matrices, marketplaces, and taxonomy until a tested runtime needs them.

### 0.1 Named Agent Roles

Per `docs/AI_DEVELOPMENT_GUIDE.md`, Project Management owns delivery; Product Planning,
contracts; UI Design, visual guidance; Development, code/evidence. Role crossing requires
delegation, and design sync precedes closure.

## 1. First Reading Order

For any non-trivial task, start small and expand only when needed:

1. `AGENTS.md` if it is not already loaded by the agent runtime.
2. `README.md`
3. `docs/START_HERE_FOR_AI_AGENTS.md`
4. The task-specific pack listed in `docs/START_HERE_FOR_AI_AGENTS.md`

Read `docs/VISION.md`, `docs/PRD.md`, `docs/TECH_ARCHITECTURE.md`, `docs/DATA_ARCHITECTURE.md`, or other large documents by relevant section for the current task. Do not load every design document by default; too much context reduces agent attention and increases the chance of mixing unrelated rules.

Use `rg` or the section map in `docs/START_HERE_FOR_AI_AGENTS.md` to find the exact sections needed. Load whole large documents only for broad architecture, product-scope, or data-ownership changes.

The task router owns all specialist reading packs, including security, privacy, support,
runtime-policy, retrieval, structured data, knowledge, recovery, settings, Pi, onboarding, and public
workflow triggers. Follow its matching row rather than maintaining another routing list
here. Historical research is never default evidence; consult it only when the router
names it for rationale or package curation.

## 2. Non-Negotiable Invariants

- Simplicity is a product invariant: default UI should minimize decisions, labels, modes, and visible technical metadata.
- Every text, follow-up, URL, or file enters one Pi Agent decision path. Host code may
  preserve attached evidence first and enforce safety, but must not use heuristics or a
  fixed format workflow to choose semantic intent. Retrieval, fetch, parsers, OCR,
  analysis, proposals, and writers are typed tools selected by Pi.
- Ordinary conversation works without local evidence. When personal knowledge is
  relevant, Pi prefers bounded local retrieval and cites what it uses; retrieval is an
  Agent-selected advantage, not a mandatory gate for every answer.
- Documentation simplicity is also an engineering invariant: add a new design document only when an existing owner document cannot hold the decision cleanly; prefer task-specific section reads over loading the full documentation library.
- PRD P0 is the `v0.1 Public Alpha` release acceptance scope, not a single task scope. Implementation work must follow Milestones and the v0.1 Implementation Playbook phase boundaries unless those owner docs are deliberately updated.
- Open local files are durable knowledge truth: Markdown owns narrative knowledge and
  versioned Dataset Bundles own structured knowledge. Hidden indexes, caches, and
  machine-local databases remain rebuildable working layers.
- Local note storage location must be visible and controllable through Settings > Knowledge Base > Vault & Note Storage.
- Every user-visible setting must declare owner, scope, storage, backup behavior, permission requirement, and apply behavior.
- Agent-affecting settings must be compiled into typed Agent Runtime Policy Context and enforced by owning services; prompt text alone is never the enforcement layer.
- When local knowledge is relevant, Agent context assembly retrieves locally and
  packages only selected cited evidence; it never sends the whole vault or large source
  bodies by default. General answers need no fabricated vault evidence.
- Original files and source assets remain user-owned evidence; Pige may reference, link, or copy them according to explicit source storage strategy, but must not force migration.
- Data lifecycle is trash-first for durable vault data: Agent, Skill, package, cleanup, reset, cancellation, and compaction flows must not permanently delete durable knowledge, source evidence, memory, conversations, proposals, or operation records.
- Pige's internal SQLite, indexes, thumbnails, and caches are rebuildable working layers;
  a documented SQLite payload inside a Dataset Bundle is structured knowledge, not an index.
- API keys and tokens must not be written to Markdown, SQLite, logs, prompts, operation records, conversation logs, diagnostics, or backups by default.
- Diagnostics and support bundles are local, user-initiated, redacted by default, and never uploaded automatically in v0.1.
- API errors, job error summaries, diagnostics, and UI failure/status surfaces must use the shared error taxonomy with stable codes, localized message keys, redacted details, and structured retry/repair actions.
- Security reports and vulnerability handling must follow `SECURITY.md`; do not publish exploit details, secrets, private paths, prompts, model responses, source bodies, or user data in public issues, commits, logs, prompts, diagnostics, or handoff notes.
- Privacy-facing behavior and public copy must stay aligned with `PRIVACY.md`; do not introduce telemetry, cloud sends, support uploads, remote Agent behavior, or networked Skills that contradict the public privacy baseline.
- Support and issue triage must follow `SUPPORT.md`; public issues and support summaries should use synthetic or redacted reproductions, not private vaults, source files, prompts, raw model responses, or unreviewed support bundles.
- Complete chat history is reference-based under `.pige/conversations/`; do not duplicate large source asset bodies or saved wiki page bodies there.
- Agent memory is local, inspectable, reversible, scoped, and included in backup by default only for vault-scoped memory.
- External/Web Skills and package-backed actions require declared capabilities and Permission Broker mediation for sensitive actions, using either an explicit prompt decision or an explicit user-selected default mode such as Remember Scoped Grants or YOLO Full Access.
- YOLO Full Access must be explicit, visible, revocable, and logged; source content, model output, Skills, packages, or tools must never enable it.
- No hidden dependency downloads during ordinary capture, ingest, search, review, backup, or restore.
- External dependencies must be represented in the Technical Architecture registry before use and in machine-readable dependency manifests once implementation pins a concrete package, binary, model, provider SDK, CI action, or release tool.
- Renderer code must not directly access arbitrary filesystem paths, secrets, raw model credentials, or local database files.
- Product/domain logic must not assume every runtime can run Bun, `uv`, npm packages, shell commands, parser binaries, large local models, or arbitrary downloaded tools; use runtime capability adapters.
- The post-v0.1 mobile/Web route is Remote Agent Backend plus Web/mobile clients; Mobile Lite is a client capability tier for capture, offline capture queue, reading, cached search, and queued processing, not a full local Agent runtime.
- Pige-owned bounded, attributable, recoverable knowledge work runs without Permission
  prompts. Intervene only for irreversible destruction, authority/security escalation,
  destination drift, unreconcilable conflict, or an explicit stricter user policy;
  uncertainty replans, warns, or abstains.
- v0.1 targets macOS 26+, Windows 11, and Windows 10 if tests pass. Linux is deferred.

## 3. Task Protocol

Before implementation:

1. Identify the product requirement and source document.
2. Identify the owning service and durable data owner.
3. Identify whether the work touches secrets, permissions, cloud model calls, web fetch, local tools, files, migrations, backup, restore, or sync-ready IDs.
4. Check whether tests, fixtures, schema changes, and documentation updates are required.
5. Keep the change scoped to the feature slice.

During implementation:

- Prefer existing local patterns once code exists.
- Keep service boundaries from `docs/TECH_ARCHITECTURE.md`.
- Use structured parsers and typed contracts instead of ad hoc string handling.
- Keep long-running work outside the renderer.
- Add or update tests with the risk of the change.
- Do not silently weaken privacy, security, backup, or review behavior to make implementation easier.

Before finishing:

- Run the relevant tests or explain why they could not run.
- Complete a phase or slice only when its documented exit criteria are satisfied and the relevant verification evidence is available. The number of work turns is not completion evidence.
- Treat completion criteria as internal work rules. Routine progress updates and automatic goal continuations must report only new work or changed state. A genuine handoff may list verification and open risks, but must not restate the completion rule or label the result with a recurring slogan.
- Verify source-of-truth and rebuild behavior.
- Verify no secret or large duplicated content is stored accidentally.
- Hand changed behavior, schema, dependency, permission, or release facts to Product Planning for same-candidate synchronization; edit design only when delegated.

## 4. Documentation Update Rule

PRD and subject owners form a bidirectional contract. The PRD owns user value,
observable behavior, defaults, degradation, release scope, and acceptance intent;
subject owners own implementation and boundary detail. Product Planning applies the
impact classes and propagation matrix in `docs/AI_DEVELOPMENT_GUIDE.md`; other roles
hand off facts unless explicitly delegated. Semantic changes update affected owners,
trace/acceptance projections, and durable decisions in the same candidate. Editorial
changes record a concrete no-contract-impact rationale. Define each fact once.

This synchronization duty is not universal edit authority. Product Planning synchronizes affected design documents; other roles edit them only under explicit, scoped delegation.

## 5. Stop Conditions

Stop and ask the user when:

- Two design documents conflict and the conflict cannot be resolved conservatively.
- A requested change would break a non-negotiable invariant.
- A dependency choice requires accepting unclear licensing, signing, sandboxing, or security risk.
- A migration might permanently rewrite or delete user-owned Markdown, source assets, memory, or conversations.

If the issue is merely implementation detail, choose the conservative path that best matches the existing design.
