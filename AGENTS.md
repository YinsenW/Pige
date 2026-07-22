# AI Agent Instructions

Status: Active repository instructions
Baseline date: 2026-07-09
Last reviewed: 2026-07-22

This repository is intended to be developed heavily with AI assistance. Future agents must treat the design documents as the product contract, not background reading.

## 0. Prime Product Directive: A Simple General Agent

Pige is a simple general Agent strengthened by local knowledge. **Input once, knowledge
grows naturally:** Pi performs validated recoverable work; users inspect or undo, not approve each step.

Pige is a personal local application, not a SaaS control plane. Prefer the shortest
mechanism that preserves user data and a real security boundary. Add durable workflow
state only for an observed v0.1 risk; hypothetical scale, tenancy, or policy flexibility
does not justify another state machine.

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
- **Host provides capability, authority, reliability, and recovery; Pi decides semantic
  work.** Host code must not choose the next semantic action through a format switch,
  boolean workflow, fixed child-Job chain, correction prompt, terminal repair loop, or
  hidden fallback pipeline. Deterministic dispatch inside an already selected tool is
  allowed.
- One explicit user submit authorizes that Agent turn to use registered first-party
  read, parse, OCR, retrieval, user-directed fetch, and bounded local-tool capabilities.
  These ordinary actions do not create per-tool permission records or prompts.
- Permission confirmation is exceptional: irreversible deletion, overwriting user-owned
  files, writes outside authorized roots, arbitrary shell or unknown-package install,
  credential export/display, risky Agent edits already requiring confirmation, or an
  equivalent authority escalation. There are no YOLO or saved-grant modes for ordinary
  Agent work.
- Connecting and selecting a cloud Provider, then submitting a turn, authorizes the
  bounded selected context for that destination. Secrets/credentials are stripped,
  `local_only` is blocked, and provider identity drift requires a new explicit user
  action; ordinary/private/bounded-large context does not pause for a second approval.
- Ordinary conversation works without local evidence. When personal knowledge is
  relevant, Pi prefers bounded local retrieval and cites what it uses; retrieval is an
  Agent-selected advantage, not a mandatory gate for every answer.
- Add a design document only when no existing Owner can hold the decision; read only the
  routed sections. PRD P0 is release scope, not task scope.
- Open local files are durable knowledge truth: Markdown owns narrative knowledge and
  versioned Dataset Bundles own structured knowledge. Hidden indexes, caches, and
  machine-local databases remain rebuildable working layers.
- Settings exposes note storage. Every visible setting declares owner, scope, storage,
  backup and apply behavior; Agent-affecting settings compile into typed runtime policy,
  never prompt-only enforcement.
- When local knowledge is relevant, Agent context assembly retrieves locally and
  packages only selected cited evidence; it never sends the whole vault or large source
  bodies by default. General answers need no fabricated vault evidence.
- Original files and source assets remain user-owned evidence; Pige may reference, link, or copy them according to explicit source storage strategy, but must not force migration.
- Data lifecycle is trash-first for durable vault data: Agent, Skill, package, cleanup, reset, cancellation, and compaction flows must not permanently delete durable knowledge, source evidence, memory, conversations, proposals, or operation records.
- Pige's internal SQLite, indexes, thumbnails, and caches are rebuildable working layers;
  a documented SQLite payload inside a Dataset Bundle is structured knowledge, not an index.
- API keys and tokens must not be written to Markdown, SQLite, logs, prompts, operation records, conversation logs, diagnostics, or backups by default.
- Diagnostics and support bundles are local, user-initiated, redacted by default, and never uploaded automatically in v0.1.
- Errors use stable codes, localized keys, redacted details and typed repair actions.
- Follow `SECURITY.md`, `PRIVACY.md` and `SUPPORT.md`: never expose secrets, private
  paths/data, prompts, model/source bodies or unreviewed bundles; never add telemetry,
  uploads or network behavior contrary to public policy.
- Complete chat history is reference-based under `.pige/conversations/`; do not duplicate large source asset bodies or saved wiki page bodies there.
- Agent memory is local, inspectable, reversible, scoped, and included in backup by default only for vault-scoped memory.
- External/Web Skills and package-backed actions declare capabilities. Ordinary
  first-party turn authority is never inherited by unreviewed third-party code; only
  exceptional high-risk effects use the minimal confirmation boundary.
- No hidden dependency downloads during ordinary capture, ingest, search, review, backup, or restore.
- External dependencies must be represented in the Technical Architecture registry before use and in machine-readable dependency manifests once implementation pins a concrete package, binary, model, provider SDK, CI action, or release tool.
- Renderer code must not directly access arbitrary filesystem paths, secrets, raw model credentials, or local database files.
- IPC stays strict at renderer/preload/main, filesystem, secret, provider, and durable
  write trust boundaries. One canonical schema derives shared types; do not maintain
  parallel handwritten type/schema/projection vocabularies for the same field set.
- Product/domain logic must not assume every runtime can run Bun, `uv`, npm packages, shell commands, parser binaries, large local models, or arbitrary downloaded tools; use runtime capability adapters.
- Pige-owned bounded, attributable, recoverable knowledge work runs without Permission
  prompts. Intervene only for irreversible destruction, authority/security escalation,
  destination drift, unreconcilable conflict, or an explicit stricter user policy;
  uncertainty replans, warns, or abstains.
- macOS 26+ is the foreground v0.1 implementation and acceptance platform. Windows and
  Linux qualification is deferred to explicit platform batches and cannot block early
  personal use or create an unsupported-platform claim.

## 3. Task Protocol

Before implementation:

1. Identify the product requirement and source document.
2. Identify the owning service and durable data owner.
3. Identify whether the work touches secrets, permissions, cloud model calls, web fetch, local tools, files, migrations, backup, restore, or sync-ready IDs.
4. Choose the validation tier from `docs/QUALITY_AND_TEST_STRATEGY.md`; check whether
   tests, fixtures, schema changes, or the single semantic Owner must change.
5. Keep the change scoped to the feature slice.
6. For Agent work, answer: “Does this Host code validate/provide a capability, or does
   it decide Pi's next semantic step?” Stop and redesign the latter.

During implementation:

- Prefer existing local patterns once code exists.
- Keep service boundaries from `docs/TECH_ARCHITECTURE.md`.
- Use structured parsers and typed contracts instead of ad hoc string handling.
- Keep long-running work outside the renderer.
- Add or update tests with the risk of the change.
- Treat an approximately 800-1000 line service as an ownership review trigger. A mixed
  coordinator must split or delete orchestration; a deterministic single-purpose core
  may exceed it only with an explicit rationale. Keep the Pi adapter below its upstream
  kernel and split `App.tsx` by page/state owner instead of moving large blocks intact.
- Do not silently weaken privacy, security, backup, or review behavior to make implementation easier.

Before finishing:

- Run the relevant tests or explain why they could not run.
- Complete a phase or slice only when its documented exit criteria are satisfied and the relevant verification evidence is available. The number of work turns is not completion evidence.
- Treat completion criteria as internal work rules. Routine progress updates and automatic goal continuations must report only new work or changed state. A genuine handoff may list verification and open risks, but must not restate the completion rule or label the result with a recurring slogan.
- Verify source-of-truth and rebuild behavior.
- Verify no secret or large duplicated content is stored accidentally.
- Hand semantic behavior, schema, dependency, permission, or release facts to Product
  Planning; edit design only when delegated. An internal refactor or test repair with no
  contract delta does not require a snapshot or documentation bind.

## 4. Documentation Update Rule

PRD and subject owners form a bidirectional contract. The PRD owns user value,
observable behavior, defaults, degradation, release scope, and acceptance intent;
subject owners own implementation and boundary detail. Product Planning applies the
impact classes in `docs/AI_DEVELOPMENT_GUIDE.md`; other roles hand off semantic facts
unless explicitly delegated. Update the one authoritative Owner when meaning changes.
Only P0 scope, architecture, security, durable-data, migration, or release-boundary
changes require full trace/acceptance/decision synchronization. Editorial, evidence-only,
test-only, and semantics-preserving refactors record why the contract is unchanged and
must not churn unrelated Owners, semantic locks, or independent snapshots. Define each
fact once and reference it elsewhere.

This synchronization duty is not universal edit authority. Product Planning synchronizes affected design documents; other roles edit them only under explicit, scoped delegation.

## 5. Stop Conditions

Stop and ask the user when:

- Two design documents conflict and the conflict cannot be resolved conservatively.
- A requested change would break a non-negotiable invariant.
- A dependency choice requires accepting unclear licensing, signing, sandboxing, or security risk.
- A migration might permanently rewrite or delete user-owned Markdown, source assets, memory, or conversations.

If the issue is merely implementation detail, choose the conservative path that best matches the existing design.
