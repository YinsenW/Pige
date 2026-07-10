# Design Baseline Audit

Status: Draft baseline audit
Date: 2026-07-09
Authority: Historical audit evidence. Do not load by default for implementation unless auditing readiness or tracing why a baseline decision was made. Normative requirements from this file must live in the owning design document or `docs/DECISION_LOG.md`.

## 1. Purpose

This document records the final design audit before implementation starts.

Goal:

- Remove ambiguity from v0.1.
- Make product, technical, UI, and extension boundaries consistent.
- Identify risks that must be handled during implementation.
- Keep Pige focused as a personal knowledge management Agent.

## 2. Non-Negotiable Product Invariants

1. Markdown knowledge files are the durable knowledge product; source records and source assets preserve evidence and traceability.
2. SQLite is a rebuildable working layer, not the knowledge source of truth.
3. Managed source copies are immutable unless the user explicitly deletes them; externally referenced originals remain user-owned and are never modified by Pige.
4. The default UI is compact, capture-first, and nearly empty.
5. Expanded and full-screen modes exist for retrieval, review, and reading.
6. Agent writes are logged, attributable, and reversible enough for trust.
7. Risky edits require confirmation.
8. Retrieval is enhanced search, not answer-only chat.
9. Local RAG is built in and invisible when healthy.
10. BYOK is required for generation, but embedding/reranking provider setup is not.
11. Agent memory is local, inspectable, scoped, and reversible.
12. Pure Skills are Markdown instruction packs; external/Web Skills and package-backed actions require declared capabilities and Permission Broker mediation, respecting explicit user-selected modes such as scoped grants or YOLO.
13. Pi packages are curated capability extensions, not a general marketplace.
14. Core parser/runtime tools ship pinned with the app.
15. Optional large models/tools are explicit downloads.
16. I18N exists from v0.1 for `zh-Hans`, `en`, `ja`, `ko`, `fr`, and `de`.
17. Accessibility is part of v0.1, not polish for later.
18. No telemetry or diagnostics upload happens by default.
19. Complete chat history is retained as reference-based conversation events without duplicating large source asset bodies.
20. v0.1 is designed and tested for 10,000 notes/source pages, a 100 GB vault, and 100,000 retrieval chunks.
21. API keys are encrypted by default and excluded from backups unless the user explicitly chooses otherwise.
22. YOLO Full Access is allowed as an explicit, visible, revocable, and logged power-user mode, never as a hidden default.

## 3. Audit Findings And Fixes

### 3.1 Runtime Recovery Was Underspecified

Issue:

- The documents described recoverable jobs and rebuildable indexes, but not external file edits, atomic writes, or deletion behavior.

Fix:

- Added vault runtime semantics to PRD.
- Added Vault Runtime And File Watcher Service to architecture.
- Added `.pige/trash/`.
- Added external edit conflict behavior.
- Added release checklist coverage.

### 3.2 v0.1 Decisions Needed Closure

Issue:

- Several questions were blocking implementation: default vault path, review thresholds, citation syntax, OCR fallback, Qwen quantization, reranker behavior, tool choices, Git, and CJK indexing.

Fix:

- Converted unresolved PRD items into Resolved v0.1 Decisions.
- Moved non-blocking future work into post-v0.1 exploration items.

### 3.3 Accessibility Was Missing

Issue:

- The UI emphasized minimalism but did not define keyboard, focus, labels, contrast, screen-reader, or reduced-motion behavior.

Fix:

- Added accessibility principle to PRD.
- Added UI Accessibility Baseline.
- Added milestone and release checklist requirements.

### 3.4 I18N Needed To Affect Retrieval And Metadata

Issue:

- I18N could have been interpreted as UI strings only.

Fix:

- Added I18N design document.
- Added Localization Service.
- Added language metadata to frontmatter and indexing rules.
- Added CJK lexical fallback requirement.

### 3.5 Extension Boundaries Needed Sharpening

Issue:

- Skill, Pi package, Local Tool, Permission Broker, and bundled toolchain responsibilities could blur.

Fix:

- Defined pure Skills as Markdown instruction packs.
- Defined external/Web Skills as permission-scoped runtime extensions.
- Routed executable/package-backed content to Package Manager, Local Tools, reviewed adapters, and Permission Broker approval.
- Kept Pi packages curated and vertical.
- Kept core tools pinned and non-agent-installed.

### 3.6 Local Database Needed A Clear Role

Issue:

- The app needs a database, but that could undermine the Markdown ownership promise.

Fix:

- Added Local Database Design.
- Chose SQLite with `better-sqlite3` behind an adapter.
- Defined `.pige/db/vault.sqlite` as rebuildable.
- Added Reset Local Database UI.

### 3.7 Memory Needed Product-Specific Boundaries

Issue:

- External memory projects are useful but could own storage, prompts, or lifecycle.

Fix:

- Added Pige-native Agent Memory design.
- Defined events, atoms, scenarios, profile.
- Required secret scanning and confirmation for sensitive memories.

### 3.8 Diagnostics Needed Privacy Defaults

Issue:

- Diagnostics and crash reporting needed explicit privacy defaults.

Fix:

- Added no-telemetry-by-default architecture rule.
- Diagnostics export is user-initiated and redacted by default.

### 3.9 Performance Budgets Were Missing

Issue:

- Local OCR, RAG indexing, database rebuilds, and large Markdown rendering can make a desktop app feel slow if they are not budgeted.

Fix:

- Added v0.1 performance targets to PRD.
- Added architecture performance strategy.
- Added performance smoke fixtures to M7.

### 3.10 External Dependencies Needed Traceability

Issue:

- Platform APIs, model files, local binaries, npm packages, parser tools, and package catalogs were referenced across documents, but there was no single place to update them later.

Fix:

- Added PRD-level external dependency governance rules.
- Added a Technical Architecture external dependency registry with upstream links, status, pin/update policy, data boundaries, replacement paths, and pre-implementation pinning gates.
- Closed the highest-risk "choose before coding" gaps by selecting default v0.1 stacks for Markdown editing/rendering, article extraction, PPTX parsing, ZIP backup/restore, secret storage, vector indexing, packaging/update, and dependency scanning.

### 3.11 Data Ownership Needed A Full Map

Issue:

- The product promise depends on local Markdown ownership, but the design also needs conversation history, Agent memory, settings, secrets, databases, indexes, model files, job records, and future sync metadata.

Fix:

- Added Data Architecture.
- Defined durable user-owned truth, durable regenerable artifacts, machine-local durable state, secrets, caches, and temporary runtime state.
- Defined source-of-truth rules, backup defaults, restore behavior, stable IDs, and sync-ready conflict classes.

### 3.12 Performance And Reliability Needed Product Budgets

Issue:

- A serious desktop app must remain responsive with large vaults, long histories, OCR, RAG indexing, and background Agent jobs.

Fix:

- Added Performance and Reliability design.
- Set target workload at 10,000 notes/source pages, 100 GB vault, and 100,000 chunks.
- Added memory budgets, worker boundaries, job-state semantics, degradation rules, and smoke-test gates.

### 3.13 Security Needed A Threat Model

Issue:

- BYOK, external/Web Skills, local shell/tool execution, web fetch, file parsing, OCR, and auto-update all create real trust boundaries.

Fix:

- Added Security Threat Model.
- Required encrypted-by-default API key storage, permission-scoped external/Web Skill execution, prompt-injection defenses, safe web fetch, parser sandboxing, and update supply-chain checks.

### 3.14 Release Engineering Needed To Be A First-Class Design

Issue:

- v0.1 is intended to be highly usable, so packaging, signing, update, rollback, dependency notices, installer size, and CI gates cannot be left to the end.

Fix:

- Added Release Engineering design.
- Defined macOS 26+, Windows 11, Windows 10-if-tested, Linux-deferred scope.
- Added GitHub Actions, GitHub Releases/update feed, automatic update, installer size, model-download, and release-gate requirements.

### 3.15 AI-Driven Development Needed Its Own Guardrails

Issue:

- The product and architecture documents were strong, but future AI coding sessions still needed concise task protocols, a shared domain vocabulary, phase-by-phase implementation order, traceability, tests, and decision anchors.

Fix:

- Added root `AGENTS.md` for future coding agents.
- Added `docs/START_HERE_FOR_AI_AGENTS.md` as the documentation index and mandatory first-read map.
- Added AI Development Guide with reading protocol, context-pack template, storage/permission/dependency checklists, and handoff rules. Task-specific reading packs are now owned only by Start Here For AI Agents.
- Added Domain Model to define core nouns, IDs, service ownership, and anti-confusion rules.
- Added v0.1 Implementation Playbook to sequence work into safe vertical slices.
- Added Quality and Test Strategy plus Spec Traceability to connect requirements to services, data, and tests.
- Added Decision Log so durable choices are easy for future agents to preserve or supersede deliberately.

### 3.16 Mobile And Cloud Futures Needed Architecture Reservations

Issue:

- Future mobile apps and optional cloud/self-hosted Agent backends will not be able to rely on desktop-only freedoms such as Bun, `uv`, npm package execution, arbitrary shell commands, parser binaries, large local models, or unrestricted local filesystem access.

Fix:

- Added Future Mobile and Cloud Architecture.
- Added runtime capability adapter and manifest requirements to Technical Architecture.
- Extended Data Architecture with mobile/cloud-ready source, job, permission, and operation record requirements.
- Added a Decision Log entry requiring portable Agent/tool contracts while keeping v0.1 desktop local-first.

### 3.17 Implementation Contracts Needed To Be Specialized

Issue:

- PRD and Technical Architecture contained enough direction, but future AI agents still needed focused implementation contracts for Markdown schema, parser/ingest, prompt construction, IPC/API boundaries, repository layout, coding conventions, and contribution workflow.

Fix:

- Added `docs/MARKDOWN_SCHEMA.md`.
- Added `docs/PARSER_INGEST_SPEC.md`.
- Added `docs/PROMPT_DESIGN.md`.
- Added `docs/API_AND_IPC_DESIGN.md`.
- Added `docs/REPOSITORY_STRUCTURE.md`.
- Added `docs/CODING_CONVENTIONS.md`.
- Added `docs/CONTRIBUTING_GUIDE.md` and root `CONTRIBUTING.md`.
- Updated README, Start Here, AI Development Guide, Spec Traceability, Milestones, PRD, Technical Architecture, Quality Strategy, and Decision Log to point to these contracts.

### 3.18 Security Choices Needed To Be Concrete Enough For Scaffold

Issue:

- Security design listed several "before coding" choices: secret storage, Skill/package sandbox boundary, shell policy, update verification, vulnerability scanning, and package permission manifest format.

Fix:

- Chose Electron `safeStorage` as the v0.1 encrypted local secret store.
- Defined executable/package-backed Skill execution as reviewed adapters running in scoped worker/utility/child processes.
- Defined shell execution as default-deny, fixed-argv for Pige-owned tools, and permissioned/previewed/logged for Skill/package/user-requested commands.
- Chose electron-builder/electron-updater with GitHub Releases, protected tags, checksums, channel/version checks, and signed/notarized artifacts when public.
- Required Dependabot, CodeQL, and npm audit or package-manager-equivalent vulnerability scanning.
- Defined Skill frontmatter plus JSON capability manifest as the v0.1 package permission manifest approach.

### 3.19 Knowledge Linking Needed A Single Contract

Issue:

- Tags, topics, concepts, backlinks, Knowledge Tree, graph indexes, and relationship suggestions were described across PRD, UI, architecture, database, prompt, and Markdown schema documents, but there was no single authority for their semantics.

Fix:

- Added `docs/KNOWLEDGE_MODEL_AND_LINKING.md`.
- Defined tag/topic/concept/entity/claim boundaries.
- Defined required relationship types and review gates.
- Defined Knowledge Tree as a derived semantic visualization over Markdown and graph indexes.
- Updated traceability, schema, database, prompt, and AI-agent reading paths.

### 3.20 Jobs And Operations Needed A Durable Runtime Contract

Issue:

- Jobs, proposals, operation records, retries, cancellation, and crash recovery were described across multiple documents but did not have one schema-level authority.

Fix:

- Added `docs/JOB_OPERATION_AND_RECOVERY.md`.
- Defined job classes, canonical states, stages, checkpoints, retry, cancellation, permission pauses, proposal lifecycle, operation records, compaction, and startup recovery.
- Added future remote Agent backend and Mobile Lite job-contract requirements.
- Updated PRD, architecture, data, API, performance, quality, traceability, milestones, implementation playbook, and Decision Log.

### 3.21 Settings Needed Ownership And Persistence Rules

Issue:

- Settings were described in product, UI, data, and architecture documents, but there was no single registry declaring which settings are vault-portable, machine-local, secret, permission grants, derived status, or transient state.
- Without a registry, future implementation could accidentally write machine-local paths into the vault, include secrets in backup/export, expose internal capability complexity, or add settings that do not affect runtime behavior.

Fix:

- Added `docs/SETTINGS_AND_PREFERENCES.md`.
- Defined setting scopes, storage locations, settings information architecture, v0.1 setting registry, change semantics, Agent/Skill boundaries, backup/export behavior, future sync/mobile rules, API requirements, and tests.
- Updated AGENTS, README, Start Here, AI Development Guide, Architecture, Data Architecture, UI Prototype, API, Quality, Traceability, Milestones, Implementation Playbook, and Decision Log.

### 3.22 Diagnostics Needed A Local-Only Contract

Issue:

- Diagnostics, logs, crash recovery, telemetry, and support bundles were mentioned across security, performance, architecture, and traceability documents, but there was no single authority for data classification, redaction, retention, support bundle preview, and no-upload behavior.
- Without that contract, implementation could accidentally log private notes, source bodies, prompts, model responses, memory, local paths, or API keys while trying to improve supportability.

Fix:

- Added `docs/DIAGNOSTICS_AND_OBSERVABILITY.md`.
- Defined local-only diagnostics, diagnostic data classes, local stores, event types, error shape, crash recovery summaries, support bundle UX, redaction rules, retention budgets, UI surfaces, IPC/API requirements, future cloud/mobile boundaries, and tests.
- Updated AGENTS, README, Start Here, AI Development Guide, PRD, Architecture, Data Architecture, Domain Model, API, Security, Performance, Quality, Traceability, Milestones, Implementation Playbook, and Decision Log.

### 3.23 Pi Agent And Model Provider Integration Needed A Product Contract

Issue:

- Models, providers, Pi Agent runtime, Pi custom models, and Pi tools were discussed across PRD, architecture, UI, security, and settings, but the exact boundary was spread out.
- Without a single contract, future implementation could expose provider catalogs as UI complexity, add Advanced/Fast model settings that do not affect runtime, mutate the user's global Pi config, or let Pi tools bypass Pige permissions.

Fix:

- Added `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`.
- Defined Pi adapter modes, provider/model profile ownership, model-list discovery, manual model IDs, one default model for v0.1, future model routing gates, Pi custom model config boundaries, Pi tool wrapping, session/memory ownership, prompt/context boundaries, IPC contracts, tests, and upstream references.
- Updated AGENTS, README, Start Here, AI Development Guide, PRD, Architecture, Prompt Design, Settings, Security, Quality, Traceability, Milestones, Implementation Playbook, and Decision Log.

### 3.24 Agent-Affecting Settings Needed Runtime Policy Semantics

Issue:

- Settings such as source storage strategy, cloud-send policy, model choice, language behavior, memory enablement, confirmation thresholds, local capability state, and permission mode affect what the Agent should do.
- Without a typed policy contract, implementation could append settings as loose prompt text, letting prompts drift, source content interfere, or services behave differently from the Agent's stated goal.

Fix:

- Added `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`.
- Defined Agent Runtime Policy Context, authority order, policy domains, source storage enforcement, model/cloud boundary, permission policy, language, memory, confirmation, retrieval, local capability context, prompt assembly, service enforcement, job snapshots, natural-language setting changes, and tests.
- Updated AGENTS, README, Start Here, AI Development Guide, PRD, Architecture, Prompt Design, Settings, API, Jobs, Quality, Traceability, and Decision Log.

### 3.25 First Run Needed Capture-Only And Dependency Semantics

Issue:

- First-run behavior was mentioned in PRD, UI prototype, milestones, and implementation playbook, but there was no single contract for vault-required setup, optional model setup, capture-only mode, restore during first run, or missing-model job behavior.
- Without this contract, implementation could either block all usage until BYOK setup is complete, or allow capture without a vault and violate source preservation.

Fix:

- Added `docs/ONBOARDING_AND_FIRST_RUN.md`.
- Defined setup states, mandatory vault choice, optional model setup, capture-only mode, `waiting_dependency` jobs, returning-user launch checks, restore during first run, out-of-scope first-run items, UI copy, IPC/API requirements, data ownership, and tests.
- Updated AGENTS, README, Start Here, AI Development Guide, PRD, UI Prototype, API, Jobs, Quality, Traceability, Milestones, Implementation Playbook, and Decision Log.

### 3.26 Context Assembly Needed A First-Class Contract

Issue:

- Home questions, Note Agent, selection actions, Agent ingest, memory recall, retrieval snippets, citations, runtime policy, and conversation history all compete for prompt context.
- Without a central contract, implementation could concatenate arbitrary history, over-send private vault content to cloud models, lose citation provenance, or let long conversation history crowd out current evidence.

Fix:

- Added `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`.
- Defined context source authority, local-first retrieval pipeline, retrieval scopes, budget classes, Agent Context Pack contracts, prompt packaging order, citation rules, cloud boundary, compaction rules, settings/policy interaction, UI contract, and required tests.
- Updated AGENTS, README, Start Here, AI Development Guide, Architecture, Prompt Design, Agent Runtime Policy Context, API, Performance, Quality, Traceability, Milestones, Implementation Playbook, and Decision Log.

### 3.27 Documentation Volume Needed Context Budgeting

Issue:

- The design library had become broad enough that entry documents implied reading too many large files before routine work.
- This risked wasting context window, reducing model attention, and causing future AI agents to blend unrelated requirements.

Fix:

- Kept specialized design documents as contracts, but changed the default reading model from full-library reading to tiered, task-specific context packs.
- Updated AGENTS, README, Start Here, AI Development Guide, and Decision Log to require minimal entry reading, section-level reads for large documents, and non-default treatment for historical/audit/research materials.
- Added a documentation context budget and document tiers to `docs/START_HERE_FOR_AI_AGENTS.md`.

### 3.28 AI Output Quality Needed Evaluation Gates

Issue:

- Existing tests covered data safety, prompts, retrieval, citations, and schemas, but did not fully define how to catch bad Agent-generated knowledge.
- Without golden fixtures and regression metrics, future implementation could pass workflow tests while producing unsupported claims, weak retrieval, noisy tags, broken links, or overconfident answers when evidence is missing.

Fix:

- Extended `docs/QUALITY_AND_TEST_STRATEGY.md` with AI evaluation fixtures, Agent output quality gates, recommended metrics, and release-blocking conditions.
- Updated Spec Traceability, Start Here, AI Development Guide, Prompt Design, Milestones, Implementation Playbook, and Decision Log.
- Added stable requirements for AI quality evaluation and low-confidence proposal routing.

### 3.29 Data Lifecycle Needed A Unified Delete/Cleanup Matrix

Issue:

- Delete, archive, trash, reset, cleanup, compaction, and tombstone behavior existed across multiple documents, but there was not one clear matrix for what each action may touch.
- Without this, future implementation could accidentally let Agent, Skill, package, cleanup, reset, or compaction flows permanently delete user-owned knowledge or source evidence.

Fix:

- Extended `docs/DATA_ARCHITECTURE.md` with a Data Lifecycle and Deletion Matrix.
- Defined trash-first durable deletes, permanent deletion boundaries, compaction boundaries, rebuildable reset targets, tombstone requirements, and backup behavior for `.pige/trash/`.
- Updated Sync, Job, Settings, Quality, Traceability, and Decision Log.

### 3.30 Repository Structure Needed Workspace Boundaries

Issue:

- The initial repository structure described a single `src/` tree, which was simple but risked locking reusable domain contracts into the Electron app.
- Future Web/mobile clients and remote Agent backends need serializable contracts, schemas, Markdown helpers, and knowledge-model logic that do not depend on Electron or desktop-only APIs.

Fix:

- Updated `docs/REPOSITORY_STRUCTURE.md` to a lightweight workspace layout with `apps/desktop/` and focused `packages/*`.
- Updated `docs/CODING_CONVENTIONS.md` with package naming, schema locations, adapter boundaries, and import-boundary rules.
- Updated Implementation Playbook, Quality gates, Traceability, and Decision Log.

### 3.31 Design Documents Needed A Necessity Audit

Issue:

- The design library had grown to dozens of Markdown files. Keeping every topic in one file would make the baseline impossible to search precisely, but treating the full library as default context would waste model attention.
- Historical, audit, research, and prototype documents could be mistaken for current normative contracts if their role was not explicit enough.

Fix:

- Verified that every Markdown design file is referenced from the AI agent entry map.
- Kept the specialized owner documents because each owns a distinct product, service, data, permission, dependency, UI, quality, or release boundary.
- Added prune and merge rules to `docs/START_HERE_FOR_AI_AGENTS.md`: the full library is an inventory, new documents require a unique owner role, duplicated guidance should move back to the owner contract, and historical/research documents stay non-normative.
- Updated README and Spec Traceability so future agents understand the full design library is not a default reading list.

### 3.32 Dependency Governance Needed Machine Checks

Issue:

- The Technical Architecture dependency registry captured upstream sources and policies, but a text registry alone is easy for future implementation agents to forget when adding packages, binaries, CI actions, provider SDKs, or model assets.
- Release safety needs CI-verifiable evidence for version pins, license status, checksum/signature policy, distribution mode, data boundary, and replacement path.

Fix:

- Defined `resources/dependency-manifest/` as the machine-readable implementation manifest location.
- Required dependency manifest records to reference Technical Architecture registry rows.
- Updated Release Engineering and Quality gates so unregistered production/runtime/release dependencies, missing license status, and missing checksum/signature policies block release.
- Updated Phase 0 scaffold expectations so dependency manifest verification exists before substantive feature work begins.

### 3.33 Failure UX Needed A Shared Error Taxonomy

Issue:

- API responses, durable jobs, diagnostics, UI status cards, and support bundles all need to describe the same failures.
- Without a shared error taxonomy, implementation could drift into service-local strings, unlocalized messages, inconsistent retry affordances, and diagnostic records that cannot be correlated.

Fix:

- Extended `docs/API_AND_IPC_DESIGN.md` with shared error domains, user actions, and stable namespaced error-code rules.
- Updated diagnostics and job contracts to reuse the same code, domain, message key, retryability, severity, and user action for the same failure.
- Added quality gates for error-code privacy, localization coverage, and API/job/diagnostic/UI consistency.
- Added traceability and decision-log coverage so future agents treat this as a product trust contract, not a UI detail.

### 3.34 Public Open Source Needed A Security Disclosure Entry

Issue:

- Pige is planned as a public open-source desktop Agent that handles local files, API keys, cloud model calls, parser/OCR tools, Skills, packages, shell execution, and auto-updates.
- The contribution guide warned users not to publish secrets or exploit payloads, but there was no standard top-level `SECURITY.md` for GitHub users, maintainers, or AI agents to find.

Fix:

- Added `SECURITY.md` with supported-version policy, private vulnerability reporting path, in-scope/out-of-scope security areas, maintainer handling rules, and AI agent handling rules.
- Linked the policy from README, CONTRIBUTING, Contributing Guide, Start Here, AI Development Guide, Repository Structure, AGENTS, Release Engineering, Security Threat Model, Quality gates, and Spec Traceability.
- Added a decision log entry so the top-level security policy is treated as an open-source governance requirement, not optional prose.

### 3.35 Public Alpha Needed A Privacy And Data-Use Entry

Issue:

- Pige is local-first but not network-free: BYOK model calls, URL fetch, optional model/tool downloads, update checks, support bundles, and permissioned Skills can all touch external services.
- Privacy rules existed across PRD, Security, Diagnostics, Data Architecture, and Settings, but there was no public top-level privacy/data-use policy for users, contributors, or AI agents.

Fix:

- Added `PRIVACY.md` with the v0.1 local-first privacy promise, local storage map, secret handling, data-leaving-device cases, diagnostics/support behavior, Skill/package permissions, backup behavior, and future cloud/mobile caveat.
- Linked the policy from README, CONTRIBUTING, SECURITY, Contributing Guide, Start Here, AI Development Guide, Repository Structure, AGENTS, Release Engineering, Quality gates, Spec Traceability, and Decision Log.
- Added release and quality gates requiring the public policy to match actual data flows before public alpha.

### 3.36 Public Support Needed Redacted Issue Triage

Issue:

- Diagnostics and support bundle behavior were designed, but there was no top-level support policy for public alpha users.
- For a local knowledge product, support requests can accidentally leak vaults, source files, screenshots, prompts, model responses, backups, or logs.

Fix:

- Added `SUPPORT.md` with public issue guidance, redacted reproduction rules, support bundle sharing rules, maintainer triage rules, and AI agent handling rules.
- Linked the support policy from README, CONTRIBUTING, PRIVACY, SECURITY, Contributing Guide, Start Here, AI Development Guide, Repository Structure, AGENTS, Release Engineering, Quality gates, Spec Traceability, and Decision Log.
- Added release and quality gates requiring support guidance to match diagnostics and support-bundle behavior.

### 3.37 Public Collaboration Needed Structured Intake

Issue:

- The repository had contribution, security, privacy, and support policies, but no code of conduct or GitHub issue/PR templates.
- Without structured intake, public issues and PRs could omit requirement sources, leak private user material, bypass security reporting, or create broad unscoped work that AI agents would later treat as implementation-ready.

Fix:

- Added `CODE_OF_CONDUCT.md`.
- Added GitHub issue templates for bug reports, feature requests, design reviews, and security contact requests.
- Added a PR template with requirement source, scope, safety, tests, docs, and known-gaps sections.
- Linked the governance files from README, CONTRIBUTING, Repository Structure, Contributing Guide, Start Here, AI Development Guide, Release Engineering, Quality gates, Spec Traceability, and Decision Log.

### 3.38 Entry Documents Needed Context Dieting

Issue:

- `README.md` is part of the default entry path, but it still carried a long full-library inventory and an external reference list.
- That duplicated the owner role of `docs/START_HERE_FOR_AI_AGENTS.md` and increased the baseline context cost for every future AI session.
- `README.md` also described Home as an "inbox", which could revive a product concept that should not be a default first-level user destination.

Fix:

- Shortened `README.md` so it points to the two primary entry documents first, then only small grouped canonical maps.
- Kept the complete document map in `docs/START_HERE_FOR_AI_AGENTS.md`, where task-specific routing belongs.
- Unified the entry reading order across `AGENTS.md`, `README.md`, `docs/START_HERE_FOR_AI_AGENTS.md`, and `docs/AI_DEVELOPMENT_GUIDE.md`.
- Moved dependency-reference authority back to `docs/TECH_ARCHITECTURE.md` and product-facing references in `docs/PRD.md`.
- Reworded Home as the unified capture, retrieval, and note-question entry.
- Removed the unused inbox icon symbol from the key-screen prototype to avoid preserving a rejected default navigation concept.

### 3.39 UI Settings Prototype Needed Domain Cleanup

Issue:

- The Settings rules correctly said Models, Local Capabilities, Permissions & Privacy, Skills, and Pi Packages must remain separate conceptual domains.
- The UI prototype still showed privacy, voice, OCR, and local RAG controls in a privacy/model-adjacent sample, which could lead implementation to rebuild a cluttered Models page.
- The Pi Packages prototype also showed `pi-local-rag` as a recommended package even though PRD and Architecture define local RAG as a Pige-native v0.1 capability and keep that package as reference/experimental.

Fix:

- Updated `docs/UI_PROTOTYPE.md` so Permissions & Privacy owns cloud-send policy, API key storage mode, model-send confirmations, permission modes, scoped grants, and YOLO.
- Reaffirmed that voice input, OCR, local RAG, parsers, and bundled toolchain health belong to Local Capabilities, not Models.
- Updated the Packages prototype so curated recommendations show knowledge-management helpers, while `pi-local-rag` and `pi-hermes-memory` stay Advanced/Experimental references because Pige has native RAG and memory.

### 3.40 v0.1 Scope Needed Release-Versus-Task Semantics

Issue:

- The PRD P0 list is intentionally large because the user wants a highly usable first public alpha, not a throwaway MVP.
- Without an explicit interpretation rule, future AI agents could treat P0 as the scope of one development session or one PR, causing overbuilding, skipped foundations, and poor sequencing.
- Milestones and the implementation playbook already stage the work, but PRD did not state that P0 is a release acceptance list rather than a task list.

Fix:

- Added scope interpretation rules to PRD, Milestones, and the v0.1 Implementation Playbook.
- Added traceability requirement `PIGE-REL-002`.
- Added decision `D-20260709-P0-Is-Release-Scope-Not-Task-Scope`.
- Confirmed the M0 deliverable list has only one `Milestone plan` entry.

### 3.41 Public Alpha Usability Needed Scenario Evidence

Issue:

- Milestones said a real user should be able to capture at least 25 mixed sources over several days, recover from failures, back up, restore, and continue working.
- Quality and release docs had strong unit, integration, smoke, AI-eval, and performance gates, but did not make this realistic usability scenario a concrete release artifact.
- Without that scenario, "highly usable" could remain a subjective claim instead of evidence future AI agents can reproduce.

Fix:

- Added a Public Alpha usability scenario fixture to `docs/QUALITY_AND_TEST_STRATEGY.md`.
- Added release-gate coverage to Milestones and Release Engineering.
- Added traceability requirement `PIGE-REL-003`.
- Added decision `D-20260709-Public-Alpha-Requires-Usability-Scenario`.

### 3.42 Fixture And Release Evidence Paths Were Too Implicit

Issue:

- Quality and release docs required fixtures and Public Alpha scenario evidence, but the repository-level paths and manifest names were still only partly defined.
- Without concrete paths, future AI agents would need to load several documents or invent ad hoc fixture/report locations during implementation.
- Generated release evidence could accidentally be committed, duplicated, or contain unredacted private data if the artifact boundary was not explicit.

Fix:

- Added fixture manifest locations and required metadata fields to `docs/REPOSITORY_STRUCTURE.md`.
- Added gitignored `artifacts/` conventions for test reports and release evidence.
- Connected fixture manifest validation and release evidence redaction to Quality, Release Engineering, Playbook, and Spec Traceability.
- Added traceability requirement `PIGE-REPO-003`.

### 3.43 Dependency Manifest Rules Needed File-Level Shape

Issue:

- The Technical Architecture registry already centralized upstream dependency references, but `resources/dependency-manifest/` did not yet name the concrete schema, primary manifest, or waiver manifest files.
- Without a file-level contract, scaffold agents could invent incompatible manifest formats or use waivers as a vague escape hatch.
- Dependency governance is especially important because Pige bundles runtimes, parser tools, optional model downloads, provider SDKs, CI actions, and release tooling.

Fix:

- Added dependency manifest file layout and record fields to `docs/TECH_ARCHITECTURE.md` and `docs/REPOSITORY_STRUCTURE.md`.
- Added strict waiver rules for temporary exceptions.
- Connected schema validation, waiver validation, and release checks to Quality, Release Engineering, Playbook, and Spec Traceability.
- Added traceability requirement `PIGE-DEP-001`.

### 3.44 Phase 0 Reading Pack Was Too Narrow

Issue:

- Phase 0 scaffold work creates the workspace, app shell, manifests, CI skeleton, import-boundary checks, fixture manifests, and release evidence paths.
- The previous project-setup reading pack pointed mostly to the Implementation Playbook and Release Engineering, but did not force agents to load Repository Structure, Coding Conventions, Technical Architecture dependency registry, Quality gates, and Spec Traceability together.
- A future scaffold agent could start writing package and CI files while missing dependency manifest, fixture manifest, import-boundary, or release-gate requirements.

Fix:

- Expanded the Project setup/scaffold/CI reading pack in `docs/START_HERE_FOR_AI_AGENTS.md`.
- Added a matching Project setup/scaffold/CI row in `docs/AI_DEVELOPMENT_GUIDE.md`.
- Expanded Phase 0 context in `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`.
- Added traceability requirement `PIGE-REPO-004`.

### 3.45 Requirement ID Traceability Needed Verification

Issue:

- Requirement IDs are intended to anchor issues, tests, commits, CI gates, and AI handoffs.
- The current docs had no undefined ID references, but the ID prefix list had drifted and did not list every area now used by the requirement table.
- Without a verifier, future agents could introduce orphan IDs or duplicate definitions that silently weaken traceability.

Fix:

- Updated `docs/SPEC_TRACEABILITY.md` area prefixes and validation rules.
- Added requirement `PIGE-DOC-003`.
- Added requirement ID verification to Quality gates, Repository scripts, and Phase 0 exit criteria.
- Added decision `D-20260709-Requirement-IDs-Are-Traceability-Verified`.

### 3.46 Design-To-Phase-0 Gate Needed A Single Owner

Issue:

- Ready-for-development criteria were implied across the goal, Design Baseline Audit, Quality gates, and Implementation Playbook.
- Without a single gate, future agents could treat "design looks comprehensive" as permission to start building arbitrary features, or could keep designing forever without a concrete Phase 0 entry condition.
- The project needs a clear distinction between design readiness for repository foundation and release readiness for public alpha.

Fix:

- Added a Pre-Phase 0 Design Readiness Gate to `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`.
- Linked the gate from `docs/START_HERE_FOR_AI_AGENTS.md`.
- Added documentation gate coverage in `docs/QUALITY_AND_TEST_STRATEGY.md`.
- Added traceability requirement `PIGE-DOC-004`.
- Added decision `D-20260709-Pre-Phase-0-Readiness-Gate`.

## 4. Pre-Phase 0 Readiness Assessment

Assessment date: 2026-07-09

Result: Passed for Phase 0 repository foundation.

This assessment means Pige's design baseline is ready to start Phase 0 scaffolding as defined in `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`. It does not mean v0.1 is release-ready, and it does not authorize building later product features before their scheduled phases.

Evidence checked:

- Required owner docs exist: 30/30.
- Requirement ID traceability passes: 57 definitions, 57 referenced IDs, 28 allowed prefixes.
- Project setup/scaffold/CI reading pack includes the implementation playbook, repository structure, coding conventions, technical dependency registry, quality gates, release engineering, and spec traceability.
- Pre-Phase 0 Design Readiness Gate is defined in the implementation playbook and linked from `docs/START_HERE_FOR_AI_AGENTS.md`.
- Dependency manifest layout, fixture manifest layout, generated artifact layout, import-boundary rules, and verification script ownership are defined.
- Remaining post-v0.1 exploration items are explicitly non-blocking for v0.1.

Required checks before the first scaffold commit:

- Re-run Markdown local-link validation.
- Re-run trailing whitespace validation.
- Re-run GitHub issue template YAML parsing.
- Re-run requirement ID traceability validation.
- Re-run `git diff --check`.

Phase 0 must still follow its own context pack, build list, "Do not build yet" boundaries, and exit criteria. If a future agent finds a contradiction in the readiness gate, owner docs, or Phase 0 requirements, it should update the design baseline before scaffolding.

## 5. Implementation Readiness Checklist

Before coding a feature, confirm:

- Which durable file is the source of truth?
- Which requirement ID or requirement area does this task satisfy?
- Which database/index rows are rebuildable?
- Is this state durable truth, regenerable artifact, machine-local preference, secret, cache, or temporary runtime state?
- Which service owns the write?
- Does the operation need confirmation?
- Does the operation need Permission Broker approval?
- What happens if the app crashes mid-operation?
- What happens if the target file changed externally?
- What user-visible status is shown?
- Does the flow work in the compact window?
- Does it work in full-screen reading mode if note-related?
- Does it work in all six locales?
- Is it keyboard reachable?
- Does it preserve source language and citation provenance?
- Does it avoid hidden downloads?
- Does it avoid hidden telemetry?
- Does backup/restore preserve the durable artifact?
- Does backup avoid duplicating source asset bodies, page bodies, or large chat content?
- Are all external dependencies recorded in the registry before implementation?
- Does the handoff note list requirement source, files changed, tests run, known gaps, and next task?

## 6. Remaining Post-v0.1 Exploration

These are intentionally not blockers for v0.1:

- Optional Git-backed history.
- Full visual diff editor.
- Advanced graph analytics and dense network visualization.
- Sync.
- Browser extension.
- Mobile capture.
- Team vaults.
- Advanced developer mode for arbitrary packages.
- First-class translation workspace.
- Signed Skill/package registry.

## 7. Files Updated By This Audit

- `README.md`
- `AGENTS.md`
- `.gitignore`
- `docs/START_HERE_FOR_AI_AGENTS.md`
- `docs/AI_DEVELOPMENT_GUIDE.md`
- `docs/DOMAIN_MODEL.md`
- `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`
- `docs/SPEC_TRACEABILITY.md`
- `docs/DECISION_LOG.md`
- `docs/PRD.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/DATA_ARCHITECTURE.md`
- `docs/MARKDOWN_SCHEMA.md`
- `docs/SOURCE_STORAGE_STRATEGY.md`
- `docs/PARSER_INGEST_SPEC.md`
- `docs/ONBOARDING_AND_FIRST_RUN.md`
- `docs/PROMPT_DESIGN.md`
- `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`
- `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`
- `docs/API_AND_IPC_DESIGN.md`
- `docs/REPOSITORY_STRUCTURE.md`
- `docs/CODING_CONVENTIONS.md`
- `docs/CONTRIBUTING_GUIDE.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `PRIVACY.md`
- `SUPPORT.md`
- `CODE_OF_CONDUCT.md`
- `.github/ISSUE_TEMPLATE/config.yml`
- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/ISSUE_TEMPLATE/design_review.yml`
- `.github/ISSUE_TEMPLATE/security_contact_request.yml`
- `.github/pull_request_template.md`
- `docs/FUTURE_MOBILE_AND_CLOUD_ARCHITECTURE.md`
- `docs/PERFORMANCE_AND_RELIABILITY.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/SETTINGS_AND_PREFERENCES.md`
- `docs/DIAGNOSTICS_AND_OBSERVABILITY.md`
- `docs/RELEASE_ENGINEERING.md`
- `docs/UI_PROTOTYPE.md`
- `docs/MILESTONES.md`
- `docs/DESIGN_REVIEW.md`
- `docs/I18N_DESIGN.md`
- `docs/LOCAL_DATABASE_DESIGN.md`
- `docs/SKILL_EXTENSION_DESIGN.md`
- `docs/AGENT_MEMORY_DESIGN.md`
- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`
- `docs/PI_PACKAGE_RESEARCH.md`
