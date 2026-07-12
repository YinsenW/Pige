# AI Agent Instructions

Status: Active repository instructions
Baseline date: 2026-07-09
Last reviewed: 2026-07-10

This repository is intended to be developed heavily with AI assistance. Future agents must treat the design documents as the product contract, not background reading.

## 0. Prime Product Directive: A Simple General Agent

Pige is a general-purpose personal Agent whose distinctive advantage is local personal
knowledge. Capture, parsing, and organization are flagship tools, not the product's
entire scope. Pige is not a developer-facing Agent platform console; its UI must stay
radically simple, calm, and low-learning-cost.

When implementation exposes powerful catalogs, provider ecosystems, package ecosystems, model capabilities, permissions, indexes, local tools, or Agent internals, hide that complexity behind sensible defaults, progressive disclosure, or internal metadata. Do not turn upstream complexity into visible product complexity unless a user-facing workflow truly needs it.

For model setup, connect one service Pi Agent can call. After one boundary disclosure,
`Connect` authorizes routine bounded calls to that exact Profile; show calm status, not
repeat prompts. Local-first means local ownership, no Pige cloud account, and no product
telemetry—not cloud friction. Sensitive, restricted, unknown/changed, or stricter-policy
cases keep their gates; Provider trust grants no tool, setting, permission, or destructive
authority. Support discovery/manual model IDs and one default model. Hide routing,
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

If a task touches security, permissions, external tools, package execution, model calls, web fetch, secrets, updates, backup, restore, storage, source files, or migrations, also read the matching specialized design document before editing.

If a task touches Markdown structure, parser/OCR ingest, prompt templates, IPC/API contracts, repository structure, coding conventions, or contribution workflow, read the matching specialized document listed in `docs/START_HERE_FOR_AI_AGENTS.md` before editing.

If a task touches settings or preferences that affect Agent goals, prompt context, tool policy, storage behavior, language behavior, confirmation behavior, model behavior, retrieval behavior, or local capability behavior, read `docs/AGENT_RUNTIME_POLICY_CONTEXT.md` before editing.

If a task touches context assembly, retrieval snippets, prompt context packing, token/context budgets, citations, grounded answers, memory injection, or conversation compaction, read `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md` before editing.

If a task touches tags, topics, concepts, entities, backlinks, relationship types, Knowledge Tree, graph indexes, or knowledge-linking behavior, read `docs/KNOWLEDGE_MODEL_AND_LINKING.md` before editing.

If a task touches long-running jobs, proposals, operation records, retry, cancellation, compaction, crash recovery, backup/restore job state, or future remote/mobile job contracts, read `docs/JOB_OPERATION_AND_RECOVERY.md` before editing.

If a task touches stable IDs, future sync readiness, conflict detection, tombstones, external edits, schema versions, migrations, backup compatibility, restore compatibility, Git-friendliness, or future sync adapters, read `docs/SYNC_CONFLICT_AND_MIGRATION.md` before editing.

If a task adds or changes any user-visible setting, preference, provider profile, local capability option, permission default, update preference, backup preference, vault preference, or settings storage behavior, read `docs/SETTINGS_AND_PREFERENCES.md` before editing.

If a task touches Pi Agent runtime integration, BYOK provider profiles, provider model-list discovery, manual model IDs, default model selection, future model routing, Pi tools, Pi extensions, or Pi session/config behavior, read `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md` before editing.

If a task touches diagnostics, logs, crash reports, support bundles, telemetry, local metrics, redaction, support export, or debug data retention, read `docs/DIAGNOSTICS_AND_OBSERVABILITY.md` before editing.

If a task touches security reports, vulnerability disclosure, exploit handling, security advisories, or private security triage, read `SECURITY.md` before editing or responding.

If a task touches privacy-facing behavior, cloud-send policy, telemetry, diagnostics export, support bundles, BYOK data use, update checks, optional downloads, Skill/package network use, or public privacy copy, read `PRIVACY.md` before editing.

If a task touches user support, public issue triage, bug reports, support bundles in issues, reproduction guidance, or maintainer/user support copy, read `SUPPORT.md` before editing or responding.

If a task touches first-run, onboarding, capture-only mode, setup skipping, missing model behavior, startup vault recovery, or dependency-waiting jobs, read `docs/ONBOARDING_AND_FIRST_RUN.md` before editing.

Historical/audit/research documents such as `docs/DESIGN_REVIEW.md`, `docs/DESIGN_BASELINE_AUDIT.md`, and `docs/PI_PACKAGE_RESEARCH.md` are not default reading. Use them when the task asks for rationale, package curation, or baseline audit history.

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
- Markdown knowledge files are the durable knowledge source of truth.
- Local note storage location must be visible and controllable through Settings > Knowledge Base > Vault & Note Storage.
- Every user-visible setting must declare owner, scope, storage, backup behavior, permission requirement, and apply behavior.
- Agent-affecting settings must be compiled into typed Agent Runtime Policy Context and enforced by owning services; prompt text alone is never the enforcement layer.
- When local knowledge is relevant, Agent context assembly retrieves locally and
  packages only selected cited evidence; it never sends the whole vault or large source
  bodies by default. General answers need no fabricated vault evidence.
- Original files and source assets remain user-owned evidence; Pige may reference, link, or copy them according to explicit source storage strategy, but must not force migration.
- Data lifecycle is trash-first for durable vault data: Agent, Skill, package, cleanup, reset, cancellation, and compaction flows must not permanently delete durable knowledge, source evidence, memory, conversations, proposals, or operation records.
- SQLite, indexes, thumbnails, and caches are rebuildable working layers.
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
- Risky Agent edits require confirmation; destructive actions require explicit confirmation.
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

PRD and subject owners form a bidirectional contract. The PRD owns user value, observable behavior, defaults, degradation, release scope, and acceptance intent; subject owners own implementation and boundary details. Semantic changes must propagate in both directions in the same change, including affected trace/acceptance projections and verification. Editorial or structural changes require a no-contract-impact rationale, not unrelated rewrites. Define facts once and reference them elsewhere; follow the impact classes and propagation matrix in `docs/AI_DEVELOPMENT_GUIDE.md`.

This synchronization duty is not universal edit authority. Product Planning updates
product, technical, development-management, and governance contracts; UI Design supplies
detailed visual guidance. Development and Project Management hand off facts and edit
those materials only under explicit, scoped delegation.

Product Planning synchronizes affected design documents in the same candidate when implementation alters:

- Data ownership or vault layout.
- Source storage strategy, source ownership, source references, managed source copies, or source asset root behavior.
- Markdown schema, page frontmatter, citations, managed blocks, or `PIGE.md` behavior.
- Tags, topics, concepts, entities, relationship types, backlinks, Knowledge Tree, graph indexes, or knowledge-linking behavior.
- Job classes/states, checkpoints, proposals, operation records, retry, cancellation, compaction, crash recovery, or remote/mobile job contracts.
- Stable IDs, future sync readiness, conflict detection, tombstones, external edits, schema versions, migrations, backup/restore compatibility, Git-friendliness, or sync adapter boundaries.
- Settings ownership, setting scope, setting storage location, provider profile behavior, local capability settings, backup preferences, or settings export/import behavior.
- Agent Runtime Policy Context, Agent-affecting setting effects, policy snapshots, or policy enforcement behavior.
- Context assembly, retrieval scope, snippet selection, context budgets, citation packing, memory injection, prompt context order, or conversation compaction.
- First-run, onboarding, capture-only mode, setup skipping, startup vault recovery, or dependency-waiting behavior.
- Pi Agent adapter behavior, provider/model profile behavior, model-list discovery, manual model IDs, default model selection, model routing gates, Pi tool wrapping, or Pi config/session boundaries.
- Diagnostics, logs, crash reports, local metrics, support bundles, redaction rules, telemetry policy, or debug data retention.
- Error taxonomy, localized failure messages, retry/repair actions, diagnostics correlation, or user-visible failure/status behavior.
- Security report handling, vulnerability disclosure, exploit reproduction, advisory text, or security triage behavior.
- Privacy policy, public privacy copy, cloud-send behavior, telemetry, diagnostics export, BYOK data-use behavior, update checks, optional downloads, or Skill/package network behavior.
- Support policy, issue templates, public bug triage, reproduction instructions, support bundle sharing, or support copy.
- Parser ingest contracts, prompt templates, IPC/API contracts, repository structure, coding conventions, or contribution workflow.
- Database schema or index semantics.
- External dependencies, model files, bundled tools, or package choices.
- Permission model, Skill/package capabilities, or security boundaries.
- Backup, restore, migration, update, or release behavior.
- UI workflows or user-visible product behavior.
- Performance budgets, test gates, or platform support.

Product Planning records a new durable decision in `docs/DECISION_LOG.md`.

## 5. Stop Conditions

Stop and ask the user when:

- Two design documents conflict and the conflict cannot be resolved conservatively.
- A requested change would break a non-negotiable invariant.
- A dependency choice requires accepting unclear licensing, signing, sandboxing, or security risk.
- A migration might permanently rewrite or delete user-owned Markdown, source assets, memory, or conversations.

If the issue is merely implementation detail, choose the conservative path that best matches the existing design.
