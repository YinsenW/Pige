# Decision Log

Status: Active decision ledger
Last reviewed: 2026-07-11

## 1. Purpose

This log records durable product and architecture decisions that future AI agents must not rediscover or casually reverse.

Long design documents explain the full rationale. This file gives quick, stable decision anchors.

## 2. Decision Format And Lifecycle

Use this format for new decisions:

```md
### D-YYYYMMDD-Short-Name

Status: Accepted | Superseded | Deferred
Date: YYYY-MM-DD
Revised: YYYY-MM-DD
Supersedes: D-YYYYMMDD-Previous-Decision
Superseded by: D-YYYYMMDD-Replacement-Decision

Decision:

Rationale:

Consequences:

References:
```

`Revised`, `Supersedes`, and `Superseded by` are conditional metadata:

- Add `Revised` when wording, references, or consequences are clarified without reversing the decision. A revision must not silently change the durable choice.
- Add `Supersedes` to an Accepted replacement decision and add the inverse `Superseded by` to every replaced decision in the same change. Multiple IDs are comma-separated.
- A Superseded entry stays in this file as history. Do not delete or rewrite it as though the earlier decision never existed.

Status and authority rules:

- `Accepted` means the decision is a current durable constraint. It is authoritative only together with the owner contract named in References. The owner contract defines the full current behavior; this log records why the choice exists.
- `Superseded` means the entry is historical and non-normative. Follow its `Superseded by` chain until the latest non-superseded Accepted entry, then confirm that entry against the subject's owner contract.
- `Deferred` means the choice is intentionally outside current scope and non-normative except for the boundary it preserves. Deferred entries still require Decision, Rationale, Consequences, and References so future review has an explicit trigger and cost.
- Code, tests, and implementation evidence can reveal that a phase consequence is stale, but they do not silently rewrite this ledger. Add or identify the replacement decision, connect both directions, and update the owner contract when behavior changes.
- Phase-specific entries must describe the stable scope of that decision. Do not leave vague current-state claims such as `remain later`, `current Phase`, or a pending placeholder in an Accepted entry after later implementation has replaced them; supersede the entry or rewrite the sentence as an explicit scope boundary with `Revised` metadata.

When answering "what is the current decision?", do not select the last matching paragraph by search result order. Start from the subject owner contract, follow any supersession chain in this log, and use the latest Accepted leaf that agrees with the owner. A mismatch between that leaf and its owner is incomplete documentation and must be reconciled rather than resolved by preference.

Run `node scripts/verify/decision-log.mjs` whenever this ledger changes. It verifies ID/date integrity, legal status and required sections, supersession chains in both directions, Deferred completeness, and vague temporal language in Accepted entries.

### 2.1 Machine-Checked Semantic Contract Map

Critical accepted decisions below are bound to an owner statement, executable code, and an executable test. `scripts/verify/decision-log.mjs` validates every marker, confirms that each mapped decision is still Accepted and references its owner, and runs the mapped tests. This map does not replace the full References section or make code authoritative over its owner; it prevents a structurally valid decision entry from remaining green after its owner, implementation, or proof disappears.

<!-- decision-contract-map:start -->
```json
{
  "schemaVersion": 1,
  "contracts": [
    {
      "decisionId": "D-20260709-Durable-Jobs-Before-Work",
      "owner": {
        "path": "docs/JOB_OPERATION_AND_RECOVERY.md",
        "markers": ["JobRecordSchema` and `OperationRecordSchema` reject undeclared root fields"]
      },
      "code": [
        {
          "path": "packages/schemas/src/index.ts",
          "markers": ["export const JobRecordSchema", "}).strict().superRefine((operation, context) => {"]
        }
      ],
      "tests": [
        {
          "path": "tests/unit/durable-contract-schemas.test.ts",
          "markers": ["status: \"completed\"", "rawPrompt: \"PRIVATE PROMPT\""]
        }
      ]
    },
    {
      "decisionId": "D-20260709-Error-Taxonomy-Is-Shared",
      "owner": {
        "path": "docs/API_AND_IPC_DESIGN.md",
        "markers": ["Shared warning/error objects are strict"]
      },
      "code": [
        {
          "path": "packages/schemas/src/index.ts",
          "markers": ["export const PigeErrorSchema", "superRefine(requireErrorDomainMatchesCode)"]
        }
      ],
      "tests": [
        {
          "path": "tests/unit/error-contract-schemas.test.ts",
          "markers": ["rejects non-namespaced codes and non-scalar redacted metadata"]
        }
      ]
    },
    {
      "decisionId": "D-20260709-Phase-1-Provider-And-Settings-Registry",
      "owner": {
        "path": "docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md",
        "markers": ["rejects missing or non-`builtin_verified` boundary metadata"]
      },
      "code": [
        {
          "path": "packages/schemas/src/index.ts",
          "markers": ["Built-in OpenAI and Anthropic profiles require builtin_verified boundary metadata"]
        }
      ],
      "tests": [
        {
          "path": "tests/unit/security-contract-schemas.test.ts",
          "markers": ["require builtin_verified"]
        }
      ]
    },
    {
      "decisionId": "D-20260710-File-Capture-Storage-Strategy-Enforcement",
      "owner": {
        "path": "docs/SOURCE_STORAGE_STRATEGY.md",
        "markers": ["`reference_original` records are mutually exclusive with `managedCopy`"]
      },
      "code": [
        {
          "path": "apps/desktop/src/main/services/source-file-access.ts",
          "markers": ["parsed.storageStrategy === \"copy_to_source_library\"", "parsed.storageStrategy === \"reference_original\""]
        },
        {
          "path": "packages/schemas/src/index.ts",
          "markers": ["Referenced-original storage must not contain a managedCopy locator"]
        }
      ],
      "tests": [
        {
          "path": "tests/unit/durable-contract-schemas.test.ts",
          "markers": ["must not contain a managedCopy locator"]
        },
        {
          "path": "tests/unit/referenced-source-pipeline.test.ts",
          "markers": ["runs a referenced PDF through parser artifacts and Agent ingest without a managed copy"]
        }
      ]
    },
    {
      "decisionId": "D-20260710-Strict-Durable-Records-And-Egress-Identity",
      "owner": {
        "path": "docs/AGENT_RUNTIME_POLICY_CONTEXT.md",
        "markers": ["`payloadHash`", "`evidenceSummaryHash`", "`decisionHash`", "changed payload, prompt metadata, endpoint, model, or evidence identity creates a new audit"]
      },
      "code": [
        {
          "path": "apps/desktop/src/main/services/agent-ingest-service.ts",
          "markers": ["createModelEgressPayloadHash", "createModelEgressEvidenceSummaryHash", "createModelEgressDecisionHash", "modelEgressAudit: {"]
        },
        {
          "path": "packages/schemas/src/index.ts",
          "markers": ["export const ModelEgressAuditSchema", "decisionHash", "A model-egress decision operation requires a typed payload and evidence audit summary"]
        }
      ],
      "tests": [
        {
          "path": "tests/unit/agent-ingest-service.test.ts",
          "markers": ["decisionHash", "expect(classificationOperations).toHaveLength(2)"]
        },
        {
          "path": "tests/unit/durable-contract-schemas.test.ts",
          "markers": ["requires typed body-free audit identity for model-egress operations"]
        }
      ]
    }
  ]
}
```
<!-- decision-contract-map:end -->

### 2.2 Historical Implementation Slice Index

The following IDs preserve rollout history, not current normative decisions. Their stable
contracts now live in the named owners and their implementation status lives in the
Playbook plus acceptance evidence. They were compacted from the active ledger so a phase
progress narrative cannot compete with the current owner.

| Historical ID | Rollout fact retained | Current owner |
| --- | --- | --- |
| `D-20260709-Phase-1-Vault-Foundation-Slice` | Initial vault/onboarding/IPC foundation | `docs/DATA_ARCHITECTURE.md`, `docs/ONBOARDING_AND_FIRST_RUN.md` |
| `D-20260709-Phase-1-Maintenance-Policy-Foundation` | Initial reset, diagnostics, and runtime-policy foundation | `docs/LOCAL_DATABASE_DESIGN.md`, `docs/AGENT_RUNTIME_POLICY_CONTEXT.md` |
| `D-20260709-Phase-1-Support-Bundle-MVP` | First local redacted support-bundle slice | `docs/DIAGNOSTICS_AND_OBSERVABILITY.md` |
| `D-20260709-Phase-1-Agent-Runtime-Stub` | Initial non-calling runtime adapter | `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md` |
| `D-20260709-Phase-1-I18N-And-Toolchain-Health-Foundation` | Initial locale catalogs and read-only tool health | `docs/I18N_DESIGN.md`, `docs/TECH_ARCHITECTURE.md` |
| `D-20260709-Phase-2-Text-Capture-Preservation` | First preserve-before-processing text capture | `docs/PARSER_INGEST_SPEC.md`, `docs/SOURCE_STORAGE_STRATEGY.md` |
| `D-20260709-Phase-2-Markdown-Txt-File-Capture` | Initial Markdown/TXT file capture | `docs/PARSER_INGEST_SPEC.md` |
| `D-20260710-Document-And-Image-Capture-Preservation` | Initial document/image preservation handoff | `docs/PARSER_INGEST_SPEC.md` |
| `D-20260709-Phase-2-3-Minimal-Source-Pages` | Initial no-model source-page writer | `docs/MARKDOWN_SCHEMA.md`, `docs/PARSER_INGEST_SPEC.md` |
| `D-20260709-Phase-2-3-Markdown-First-Library-List` | Initial Markdown-scan Library fallback | `docs/API_AND_IPC_DESIGN.md`, `docs/LOCAL_DATABASE_DESIGN.md` |
| `D-20260709-Phase-2-3-Minimal-Page-Reader` | Initial safe Markdown reader | `docs/API_AND_IPC_DESIGN.md`, `docs/SECURITY_THREAT_MODEL.md` |
| `D-20260709-Phase-3-Basic-Agent-Ingest-Bridge` | Initial model-backed ingest bridge | `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`, `docs/JOB_OPERATION_AND_RECOVERY.md` |
| `D-20260710-Phase-3-Change-Proposal-Foundation` | Initial durable proposal staging | `docs/JOB_OPERATION_AND_RECOVERY.md` |

## 3. Accepted And Superseded Decisions

### D-20260710-Clean-Room-Visual-System

Status: Accepted
Date: 2026-07-10

Decision:

Pige uses an original semantic-token visual system that may learn from observable
interaction patterns and structural measurements in polished desktop applications, but
external application bundles are research inputs only. Pige must not copy or redistribute
third-party source code, branded assets, product copy, or exact screen compositions.

Rationale:

Pige needs a concrete high-fidelity baseline to turn its quiet interaction contract into
consistent production UI. A clean-room boundary preserves the useful lessons of mature
desktop design while keeping Pige's identity, licensing, simplicity, privacy, and product
scope independent.

Consequences:

- `docs/UI_PROTOTYPE.md` owns Pige's production spacing, type, shape, layout, color,
  motion, and component-behavior targets.
- Components consume Pige semantic roles and tokens rather than third-party palette or
  component names.
- External bundles, fonts, icons, logos, illustrations, sounds, and localized copy are
  not repository dependencies, fixtures, or redistribution sources.
- Product-specific developer-console density, model catalogs, and runtime controls are
  rejected when they conflict with the Simplicity First directive.

References:

- `docs/UI_PROTOTYPE.md`
- `AGENTS.md`
- `LICENSE`
- `NOTICE`

### D-20260709-Local-First-Markdown

Status: Accepted
Date: 2026-07-09

Decision:

Pige stores durable user-owned knowledge as local Markdown. Source records and source assets preserve evidence through references, managed copies, or future explicit links. SQLite and indexes accelerate the app but are rebuildable.

Rationale:

The product promise depends on portability, inspectability, and long-term ownership.

Consequences:

- Durable Markdown knowledge must be recoverable without SQLite.
- Original user files remain evidence/source assets, not the compiled knowledge source of truth.
- Database schema changes must not become knowledge migrations.
- Backup focuses on files, not hidden database state.

References:

- `docs/PRD.md`
- `docs/DATA_ARCHITECTURE.md`
- `docs/SOURCE_STORAGE_STRATEGY.md`
- `docs/LOCAL_DATABASE_DESIGN.md`

### D-20260709-Reference-Based-Conversation-History

Status: Accepted
Date: 2026-07-09

Decision:

Pige keeps complete chat history as reference-based conversation events under `.pige/conversations/`.

Rationale:

The user wants full history, but duplicating large source asset bodies and saved wiki page bodies would cause vault bloat.

Consequences:

- Large pasted content becomes a managed text source record and is referenced from the conversation.
- Saved assistant outputs are referenced as wiki pages or operation records.
- Conversation history is included in backup by default with an exclude option.

References:

- `docs/DATA_ARCHITECTURE.md`
- `docs/PERFORMANCE_AND_RELIABILITY.md`

### D-20260709-Vault-Location-Is-Local-Control

Status: Accepted
Date: 2026-07-09

Decision:

Pige must expose local vault location controls in Settings > Knowledge Base > Vault & Note Storage. The Chinese UI should use a direct label such as "仓库与笔记存储". Active vault path and recent vault list are machine-local settings; the Markdown knowledge contents remain portable local files.

Rationale:

Pige's product promise depends on users knowing where their notes live. Local-first note apps such as Obsidian treat a vault as a normal local folder that users can create, open, and manage. Hiding this would undermine trust.

Consequences:

- v0.1 Settings must show the current vault name, active vault path, knowledge root path, source asset root path, and default source storage strategy.
- Users can reveal the vault in Finder/File Explorer, open another vault, create a new vault, and remove recent entries without deleting files.
- The vault manifest stores identity and schema, not the current computer's absolute path.
- A source asset root inside the vault is portable; an external source asset root is a machine-local binding and must appear in backup/restore manifests as an external dependency.
- Moving an existing vault is not a silent setting change; it requires manual filesystem movement followed by open-existing-vault, or a future guarded migration wizard.
- Recent vaults are machine-local and excluded from vault backup by default.
- Backup/restore belongs on the same page as a protective action, but the page's product meaning is local vault and storage control.

References:

- `docs/PRD.md`
- `docs/UI_PROTOTYPE.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/DATA_ARCHITECTURE.md`

### D-20260709-Vault-Required-Model-Optional-Onboarding

Status: Accepted
Date: 2026-07-09

Decision:

First run requires a valid local Pige vault before entering Home. Model setup is optional; skipping it enters capture-only mode where Pige preserves sources and queues model-dependent work in a visible retryable dependency state.

Rationale:

Pige's first trust promise is preservation. Without a vault, Pige cannot safely keep Markdown, source records, source assets, jobs, proposals, memory, or operation records. Without a model, Pige can still preserve user input and run deterministic local work. Blocking capture on BYOK setup would add friction and increase the chance that users abandon capture.

Consequences:

- First run must show create/open/restore vault actions.
- Home is blocked only when no vault exists.
- Model setup can be skipped.
- Capture-only mode can create source records, source assets/references, conversation refs, and deterministic artifacts.
- Model-dependent jobs use `waiting_dependency`, not silent failure.
- Configuring a model later can requeue waiting jobs without duplicating preserved sources.
- Optional local model/OCR/RAG downloads, YOLO, Skills, packages, sync, and Obsidian import stay out of first run.

References:

- `docs/ONBOARDING_AND_FIRST_RUN.md`
- `docs/JOB_OPERATION_AND_RECOVERY.md`
- `docs/PRD.md`
- `docs/UI_PROTOTYPE.md`
- `docs/SPEC_TRACEABILITY.md`

### D-20260709-Implementation-Contracts-Are-Specialized

Status: Accepted
Date: 2026-07-09

Decision:

Keep PRD and Technical Architecture as product and service-level authorities, but move implementation contracts into specialized documents for Markdown schema, parser/ingest, prompts, API/IPC, repository structure, coding conventions, and contribution workflow.

Rationale:

Pige is expected to be maintained heavily by AI Coding Agents. Specialized contracts reduce context cost and prevent future agents from guessing details from scattered PRD paragraphs.

Consequences:

- Markdown/frontmatter changes update `docs/MARKDOWN_SCHEMA.md`.
- Parser/OCR/artifact ingest changes update `docs/PARSER_INGEST_SPEC.md`.
- Prompt/template/context changes update `docs/PROMPT_DESIGN.md`.
- Renderer-preload-main-worker API changes update `docs/API_AND_IPC_DESIGN.md`.
- Scaffold and coding style changes update `docs/REPOSITORY_STRUCTURE.md` and `docs/CODING_CONVENTIONS.md`.
- Public collaboration guidance updates `docs/CONTRIBUTING_GUIDE.md` and root `CONTRIBUTING.md`.

References:

- `docs/START_HERE_FOR_AI_AGENTS.md`
- `docs/AI_DEVELOPMENT_GUIDE.md`
- `docs/SPEC_TRACEABILITY.md`

### D-20260709-Knowledge-Graph-Is-Markdown-Derived

Status: Accepted
Date: 2026-07-09

Decision:

Pige's knowledge graph, backlinks, tag indexes, relationship edges, and Knowledge Tree aggregates are derived from durable Markdown, source citations, frontmatter, managed related sections, source records, and operation/proposal records. SQLite graph tables are rebuildable indexes, not hidden knowledge truth.

Rationale:

Pige's core promise is local Markdown ownership. A graph database that contains knowledge unavailable in Markdown would undermine portability, backup clarity, and future sync.

Consequences:

- Tags are lightweight facets, while topics, concepts, entities, claims, and questions become Markdown pages when they matter.
- Wiki Compiler owns durable link and relationship writes.
- Local Database Service owns graph indexes and rebuild.
- Risky relationship changes such as merges, contradictions, supersession, duplicate marking, and broad hierarchy edits require confirmation.
- Knowledge Tree is a visualization over the knowledge model, not a separate storage layer.

References:

- `docs/KNOWLEDGE_MODEL_AND_LINKING.md`
- `docs/MARKDOWN_SCHEMA.md`
- `docs/LOCAL_DATABASE_DESIGN.md`
- `docs/DATA_ARCHITECTURE.md`

### D-20260709-Durable-Jobs-Before-Work

Status: Accepted
Date: 2026-07-09

Decision:

Pige creates durable job records before expensive, asynchronous, permissioned, or failure-prone work starts. Confirmation proposals and operation records are durable vault data, while SQLite job indexes are rebuildable.

Rationale:

Pige is an Agent desktop app that must survive parser failures, OCR failures, model errors, permission prompts, external edits, app restarts, and crashes without losing user captures or silently duplicating work.

Consequences:

- Capture preserves source records and source assets/references before parsing or model calls.
- Retry and crash recovery must be idempotent and checkpoint-based.
- Risky changes become durable proposals before mutation.
- Approved mutations create redacted operation records.
- Home can rebuild processing status from `.pige/jobs/`, `.pige/proposals/`, `.pige/operations/`, conversations, and `log.md`.

References:

- `docs/JOB_OPERATION_AND_RECOVERY.md`
- `docs/DATA_ARCHITECTURE.md`
- `docs/PERFORMANCE_AND_RELIABILITY.md`
- `docs/API_AND_IPC_DESIGN.md`

### D-20260709-Pre-Implementation-Dependency-Choices

Status: Accepted
Date: 2026-07-09

Decision:

v0.1 default implementation choices are CodeMirror 6 for source-preserving Markdown editing, unified/remark/rehype for Markdown parsing/rendering, `@mozilla/readability` for article extraction, Mammoth for DOCX plus yauzl and fast-xml-parser for Pige-owned OpenXML inspection/PPTX extraction, yazl/yauzl for backup ZIP creation/restore, Electron `safeStorage` for encrypted local secrets, sqlite-vec behind a `VectorIndexDriver` for vector search, electron-builder/electron-updater with GitHub Releases for alpha updates, and Dependabot/CodeQL/npm audit for dependency security gates.

Rationale:

The previous design correctly identified the dependency areas but left too many "choose before coding" holes. Selecting defaults now gives future AI agents a concrete path while preserving replacement adapters where packaging or fixture tests fail.

Consequences:

- Implementation still pins exact versions and records licenses/checksums before code lands.
- sqlite-vec remains behind an adapter because upstream is pre-v1 and packaging must be proven.
- Electron `safeStorage` unavailable-encryption behavior must be tested; plaintext mode remains explicit and warned.
- Backup uses streaming ZIP libraries rather than buffering large vaults in memory.
- Release automation uses GitHub-native security and update infrastructure for v0.1 alpha.

References:

- `docs/TECH_ARCHITECTURE.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/RELEASE_ENGINEERING.md`

### D-20260709-Phase-Completion-Evidence

Status: Accepted
Date: 2026-07-09

Decision:

Phase and slice completion is determined by documented exit criteria and required verification evidence. The number of work turns is neither completion evidence nor a required minimum.

Rationale:

The implementation playbook already owns actionable phase criteria. Repeating a separate slogan across control documents created duplicate guidance and conversational boilerplate without improving verification.

Consequences:

- Each phase must define what is in scope, what is out of scope, and which checks prove the phase is ready to stop.
- Failed required checks block completion; non-blocking remainder moves to backlog or later-phase work.
- Unfinished product surfaces remain disabled and explicitly documented as deferred.
- Routine progress updates and automatic goal continuations report only new work or changed state. Handoffs report artifacts, verification, failures, risks, and deferrals without restating this decision or labeling the result with a recurring slogan.

References:

- `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`
- `docs/SPEC_TRACEABILITY.md`

### D-20260709-Phase-0-Dependency-Compatibility

Status: Accepted
Date: 2026-07-09

Decision:

Phase 0 pins Electron, React, TypeScript 7, electron-vite, Vite, Vitest, Zod, GitHub Actions, CodeQL, and Dependabot through `resources/dependency-manifest/dependencies.manifest.json`. The scaffold currently uses Vite 7 with `@vitejs/plugin-react` 5 because `electron-vite` 5 does not yet support the latest Vite major range.

Rationale:

Using latest package versions blindly caused incompatible peer dependencies during scaffold setup. Future AI agents need a documented compatibility anchor before upgrading the build chain.

Consequences:

- Dependency upgrades must update package manifests, `package-lock.json`, the dependency manifest, and any affected architecture registry rows in one change.
- Vite 8 or newer should not be adopted until electron-vite compatibility and app build/dev verification pass.
- The dependency manifest verification script checks workspace package usage and lockfile versions against the manifest.

References:

- `resources/dependency-manifest/dependencies.manifest.json`
- `scripts/verify/dependency-manifest.mjs`
- `docs/TECH_ARCHITECTURE.md`

### D-20260709-Encrypted-Default-Secrets

Status: Accepted
Date: 2026-07-09

Decision:

API keys are encrypted by default through OS keychain or encrypted local storage. Plaintext portable/developer mode is explicit and warned.

Rationale:

BYOK is required, and secrets must not leak into user-owned Markdown, logs, prompts, diagnostics, or backups.

Consequences:

- Secrets are machine-local by default.
- Backup excludes secrets by default.
- Plaintext mode requires a visible warning.

References:

- `docs/SECURITY_THREAT_MODEL.md`
- `docs/DATA_ARCHITECTURE.md`

### D-20260709-Permissioned-External-Skills

Status: Accepted
Date: 2026-07-09

Decision:

v0.1 supports external/Web Skills and package-provided Skills only when capabilities are declared and sensitive runtime actions go through Permission Broker mediation.

Rationale:

Pige needs extensibility, but it should not become a hidden general-purpose plugin runner.

Consequences:

- Install preview cannot execute scripts, package hooks, binaries, or MCP configs.
- Sensitive runtime actions pause in `waiting_permission` unless covered by an explicit default permission mode.
- Denied permissions leave the app stable.

References:

- `docs/SKILL_EXTENSION_DESIGN.md`
- `docs/SECURITY_THREAT_MODEL.md`

### D-20260709-Permission-Modes-And-YOLO

Status: Accepted
Date: 2026-07-09
Revised: 2026-07-10

Decision:

Pige supports multiple permission modes: Ask Every Time, Remember Scoped Grants, and YOLO Full Access.

Rationale:

Some users want strict prompts; others prefer a low-friction Agent experience and are comfortable granting broad local access. Pige should support both without hiding the risk. Pige intentionally avoids a chat-style "current session" permission mode because the product should not ask users to reason about sessions.

Consequences:

- Permission dialogs include Deny, Allow Once, and Always Allow.
- Always Allow is permanent until revoked, but it must be scoped to actor, capability, resource, provider profile, or vault boundary rather than treated as an unbounded grant.
- "Only this" choices are modeled as resource scopes, such as only this URL, domain, source, note, file, folder, vault, Skill/package/tool version, or provider profile.
- YOLO Full Access is off by default and can only be enabled explicitly in Settings.
- YOLO suppresses eligible Permission Broker prompts but does not bypass OS permissions, app sandboxing, signature checks, malware protections, filesystem errors, always-required destructive/settings/restore/migration confirmation, or stricter Model Egress Decisions.
- Raw secret bytes are never a grantable Agent, Skill, package, or local-tool capability. Reviewed provider adapters may use a secret ref for one declared call without disclosing the credential.
- Auto-allowed actions must still be logged with actor, capability, data boundary, and affected resources.

References:

- `docs/PRD.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/UI_PROTOTYPE.md`

### D-20260709-Home-Composer-Unified-Entry

Status: Accepted
Date: 2026-07-09

Decision:

Pige's default entry is a bottom-docked Home composer. The same composer supports capture, URL/file paste, voice input, lightweight dialogue, and knowledge-base questions. v0.1 should not expose separate default navigation entries for Capture, Ask/Search, Inbox, or Review.

Rationale:

The product promise is low-friction knowledge capture and retrieval. Splitting capture and asking into separate entry points makes the app feel more complex and forces users to classify their intent before acting. Processing status and risky changes still matter, but they should appear as Home status cards, notifications, or confirmation proposals only when relevant.

Consequences:

- The first screen keeps a mostly empty canvas with the Home composer fixed near the bottom.
- Question-like input triggers Home knowledge retrieval: local retrieval first, then a grounded summary with ranked notes.
- File/link/text input triggers capture and ingest without requiring mode selection.
- Processing, failed, and confirmation-needed work appears in Home status surfaces instead of default Inbox/Review navigation.
- Sidebar defaults to Home, Library, Knowledge Tree, and Settings.

References:

- `docs/PRD.md`
- `docs/UI_PROTOTYPE.md`
- `docs/prototypes/README.md`

### D-20260709-Simplicity-First-Default-UI

Status: Accepted
Date: 2026-07-09

Decision:

Pige's default user-facing UI must stay radically simple. Upstream catalogs, provider ecosystems, package ecosystems, model capabilities, data-boundary metadata, routing rules, and Agent internals can exist as implementation metadata, but they must not automatically become visible UI.

Rationale:

Pige's core product promise is low-friction personal knowledge capture and retrieval. Exposing technical catalogs and capability matrices makes the app feel like an admin console and forces users to reason about implementation details before they can use it.

Consequences:

- Model setup is a short connection form whose job is only to connect one model service Pi Agent can call.
- Simplicity does not mean removing required controls: model list management is required, including automatic provider ModelList discovery when available and manual model ID entry when unavailable.
- One default model must be enough to run Pige. Advanced/Fast model-slot settings must not be exposed until Pi Agent upstream or Pige's own runtime layer makes those settings effective.
- Add Provider must not show provider marketplaces, capability columns, access-method columns, data-boundary columns, pricing, context windows, routing internals, or advanced filters by default.
- Pi package, Skill, provider, and local tool catalogs should be curated or hidden behind progressive disclosure.
- Future AI agents should remove visible complexity when a workflow can be served by defaults, inference, or internal metadata.

References:

- `AGENTS.md`
- `docs/START_HERE_FOR_AI_AGENTS.md`
- `docs/PRD.md`
- `docs/UI_PROTOTYPE.md`

### D-20260709-Agent-Affecting-Settings-Use-Policy-Context

Status: Accepted
Date: 2026-07-09

Decision:

Settings that affect Agent work are compiled into typed Agent Runtime Policy Context and enforced by owning services. Prompt text may summarize the policy, but prompt text alone is never the enforcement layer.

Rationale:

Settings such as source storage strategy, cloud-send policy, default model, language behavior, confirmation thresholds, memory enablement, and permission mode change what Pige should do. If implementation only appends natural-language hints to prompts, source prompt injection, model drift, or workflow-specific prompt omissions can make the Agent behave inconsistently.

Consequences:

- Agent Orchestrator builds a policy context for each model-dependent job.
- Job and operation records store policy refs/hashes, not full settings files or secrets.
- Source Storage Service enforces copy/reference behavior before Agent ingest.
- Permission Broker, Model Provider Registry, Change Proposal Service, Agent Memory Service, Retrieval Service, and Local Tool Service enforce their own domains.
- Agent-affecting settings must be added to the policy effect registry before implementation.
- Source content, model output, Skills, packages, and web pages cannot modify policy context.

References:

- `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`
- `docs/SETTINGS_AND_PREFERENCES.md`
- `docs/PROMPT_DESIGN.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/SPEC_TRACEABILITY.md`

### D-20260709-Gated-Model-Routing

Status: Accepted
Date: 2026-07-09

Decision:

Pige v0.1 exposes one effective default Pi Agent model. Advanced Model, Fast Model, tool model, or task-class model-routing settings are deferred and hidden unless a real runtime support gate is satisfied.

Rationale:

Pi's current public model surface supports model registration, selection, scoped model lists, and thinking levels, but not a stable product-level Advanced/Fast automatic routing strategy. A visible setting that does not affect Agent behavior would be worse than no setting.

Consequences:

- Add Provider still manages provider connection, model-list discovery, manual model IDs, and one default model.
- The Settings sidebar must not show Model Assignment or Model Routing in v0.1.
- Future model routing requires either stable Pi upstream support or a Pige-owned Model Routing Service with tests proving runtime model selection changes.
- If future routing ships, the UI may expose at most Default, Advanced, and Fast slots; it must not become a per-task routing table.

References:

- `AGENTS.md`
- `docs/PRD.md`
- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/UI_PROTOTYPE.md`
- Pi Custom Models docs: https://pi.dev/docs/latest/models
- Pi dual-model proposal: https://github.com/earendil-works/pi/issues/2844

### D-20260709-Local-RAG-Default

Status: Accepted
Date: 2026-07-09

Decision:

Embeddings and retrieval indexes run locally by default. Users do not configure embedding or reranking providers in v0.1.

Rationale:

RAG is core infrastructure for the Agent, and requiring users to configure embedding APIs would increase cognitive load.

Consequences:

- Qwen3 Embedding 0.6B GGUF is the default downloadable embedding model.
- Model files are not bundled in the installer.
- Lexical search must work before model download.

References:

- `docs/PRD.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/PERFORMANCE_AND_RELIABILITY.md`

### D-20260709-Bundled-Core-Toolchain

Status: Accepted
Date: 2026-07-09

Decision:

Pige bundles core toolchain dependencies such as Git/shell, Bun, uv, PDF parser, and Office parser path resolution instead of downloading them during ordinary Agent jobs.

Rationale:

Capture and ingest must feel reliable across machines and networks.

Consequences:

- Installer size target is around 300 MB excluding model/OCR weights.
- Tool versions, checksums, and licenses must be tracked.
- Optional large models/tools are explicit downloads.

References:

- `docs/PRD.md`
- `docs/RELEASE_ENGINEERING.md`

### D-20260709-v0-1-Platform-Scope

Status: Accepted
Date: 2026-07-09

Decision:

v0.1 targets macOS 26 or later, Windows 11, and Windows 10 when tests pass. Linux is deferred.

Rationale:

The first release should be highly usable rather than superficially broad.

Consequences:

- macOS is primary quality target.
- Windows packaging and native capability detection must be tested.
- Linux-specific packaging should not block v0.1.

References:

- `docs/PRD.md`
- `docs/RELEASE_ENGINEERING.md`

### D-20260709-Auto-Update-v0-1

Status: Accepted
Date: 2026-07-09

Decision:

v0.1 should support automatic update checks through GitHub Actions-built artifacts and GitHub Releases or a GitHub-backed update feed.

Rationale:

Public alpha users need a manageable update path.

Consequences:

- Release engineering is part of v0.1, not post-launch cleanup.
- Updates must not interrupt active capture, backup, restore, parsing, OCR, indexing, or destructive permissioned operations.
- Signing/notarization state must be visible in release notes.

References:

- `docs/RELEASE_ENGINEERING.md`
- `docs/TECH_ARCHITECTURE.md`

### D-20260709-Scale-Target

Status: Accepted
Date: 2026-07-09

Decision:

v0.1 design and tests target 10,000 notes/source pages, 100 GB vault, and 100,000 retrieval chunks.

Rationale:

This is a realistic heavy-user target for a serious personal knowledge management product.

Consequences:

- Renderer must not load the full vault.
- Search, indexing, conversation history, and backup need performance budgets.
- CI should include scale fixtures where feasible.

References:

- `docs/PERFORMANCE_AND_RELIABILITY.md`
- `docs/DATA_ARCHITECTURE.md`

### D-20260709-Mobile-And-Cloud-Runtime-Reservation

Status: Accepted
Date: 2026-07-09

Decision:

v0.1 remains desktop local-first. The primary post-v0.1 route is a remote Agent backend with Web/mobile clients. Mobile local capability is a lightweight client layer for capture, offline capture queue, reading, cached/metadata search, and queued processing, not a full local Agent runtime strategy.

Rationale:

Mobile platforms cannot freely run Bun, `uv`, npm packages, shell commands, parser binaries, large local models, arbitrary downloaded tools, or long background jobs without serious power, policy, and reliability tradeoffs. A remote Agent backend is technically more realistic for feature parity and commercially stronger for hosted subscriptions, team/workspace features, and Web/mobile access. Self-hosting remains an advanced deployment option, not the default user path.

Consequences:

- Heavy capabilities must go through runtime capability adapters.
- Product logic should use capability IDs, not desktop binary paths.
- Durable job, source, permission, proposal, operation, memory, and conversation records must remain serializable.
- Agent runtime kinds are `desktop_local` and future `remote_agent_backend`.
- Client capability tiers are `desktop_full`, future `web_client`, and future `mobile_lite`.
- Mobile Lite clients may create pending records and read/search cached data, but they do not run Bun, `uv`, npm packages, shell, parser binaries, OCR models, or full Agent jobs locally.
- Remote Agent Backend can later run heavy Agent jobs, parsers, OCR, package-backed tools, RAG jobs, and external/Web Skills for Web/mobile clients.
- Remote backend deployment options are Pige Cloud first, then self-hosted or personal desktop backend when the protocol and security model are mature.

References:

- `docs/FUTURE_MOBILE_AND_CLOUD_ARCHITECTURE.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/DATA_ARCHITECTURE.md`

### D-20260709-Settings-Registry-Is-Required

Status: Accepted
Date: 2026-07-09

Decision:

Every user-visible setting in Pige must be registered with owner, scope, storage location, backup behavior, permission requirement, apply behavior, and migration/export behavior. The authoritative registry is `docs/SETTINGS_AND_PREFERENCES.md`.

Rationale:

Pige is local-first and privacy-sensitive, but also has model providers, local capabilities, permissions, Skills, packages, update state, vault preferences, and future sync/mobile constraints. Without a registry, future agents could accidentally store machine-local paths in the vault, put secrets in backups, expose internal complexity as UI, or add settings that do not actually affect runtime behavior.

Consequences:

- New settings must update `docs/SETTINGS_AND_PREFERENCES.md`.
- Machine-local preferences, permission grants, and secrets stay out of default vault backups.
- `.pige/config.json` contains portable non-secret vault preferences only.
- `.pige/manifest.json` remains identity and schema metadata, not a general settings file.
- Sensitive setting changes require explicit user action, confirmation proposal, or Permission Broker mediation.
- Source content, model output, Skills, and packages cannot directly change settings.

References:

- `docs/SETTINGS_AND_PREFERENCES.md`
- `docs/DATA_ARCHITECTURE.md`
- `docs/SECURITY_THREAT_MODEL.md`

### D-20260709-Local-Diagnostics-No-Default-Telemetry

Status: Accepted
Date: 2026-07-09

Decision:

v0.1 diagnostics are local-only by default. Pige does not perform product analytics, background telemetry upload, automatic crash upload, or automatic diagnostic upload. Support bundles are user-initiated, previewed, redacted by default, cancelable, and written to a user-selected local path.

Rationale:

Pige handles private knowledge, source files, model calls, Agent memory, and API keys. Useful diagnostics are required for a serious desktop product, but automatic telemetry would weaken the local-first trust model and complicate BYOK privacy expectations.

Consequences:

- Diagnostic records must be classified and redacted according to `docs/DIAGNOSTICS_AND_OBSERVABILITY.md`.
- Logs are bounded by retention and size limits.
- Default diagnostics never include secrets, source bodies, full notes, full memory, full conversations, or raw prompts/responses.
- Future remote/cloud observability must be separately designed and explicitly opted into.

References:

- `docs/DIAGNOSTICS_AND_OBSERVABILITY.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/PERFORMANCE_AND_RELIABILITY.md`

### D-20260709-Local-First-Bounded-Context-Assembly

Status: Accepted
Date: 2026-07-09

Decision:

Pige assembles Agent context through a local-first, bounded Agent Context Pack. The pack contains trusted policy, task state, selected snippets, citations, scoped memory, compact conversation references, warnings, and refs. It must not contain the whole vault, raw secrets, full settings files, large duplicated source bodies, or unbounded conversation history by default.

Rationale:

Pige's retrieval experience is closer to enhanced search than answer-only chat. Without a context assembly contract, implementation could over-send private data to cloud models, lose citations, let long chat history crowd out evidence, or make Agent behavior drift from settings-derived policy.

Consequences:

- Search/Retrieval Service and Agent Orchestrator must build serializable context packs before model calls.
- Local lexical/metadata retrieval must work before embedding model download.
- Cloud model calls receive selected snippets and citations, not full vault content.
- Context budgets, citation survival, memory scope, and compaction become testable quality gates.

References:

- `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`
- `docs/PROMPT_DESIGN.md`
- `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`
- `docs/PERFORMANCE_AND_RELIABILITY.md`
- `docs/SECURITY_THREAT_MODEL.md`

### D-20260709-Documentation-Context-Budget

Status: Accepted
Date: 2026-07-09

Decision:

Pige keeps the existing specialized design documents, but AI agents must not load the full design library by default. Routine work starts from `AGENTS.md`, `README.md`, `docs/START_HERE_FOR_AI_AGENTS.md`, and the smallest task-specific reading pack. Large documents are read by relevant section unless the task is broad.

Rationale:

The design baseline is intentionally comprehensive, but the repository already contains more than 100,000 words of design material. Loading too many documents wastes context, weakens model attention, and can mix unrelated constraints. The product needs both durable design contracts and disciplined context budgeting.

Consequences:

- `docs/START_HERE_FOR_AI_AGENTS.md` owns the documentation context budget and document tiers.
- `docs/START_HERE_FOR_AI_AGENTS.md` is the only canonical owner of task-specific reading packs; `docs/AI_DEVELOPMENT_GUIDE.md` must link to it instead of duplicating the full routing table.
- `docs/START_HERE_FOR_AI_AGENTS.md` also owns the large-document section map so agents can read PRD, Tech Architecture, Data Architecture, UI Prototype, the Implementation Playbook, and the Decision Log by relevant section.
- The document map in `docs/START_HERE_FOR_AI_AGENTS.md` records each mapped file's tier, owner role, and default read behavior so future agents can route context without loading every design file.
- `README.md` should stay a compact orientation page, not the full design inventory or external dependency registry.
- The compact entry order is `AGENTS.md`, `README.md`, then `docs/START_HERE_FOR_AI_AGENTS.md`, followed by the task-specific pack.
- Historical, audit, and research documents are not default implementation reading.
- Historical, audit, research, and prototype documents should clearly mark their authority level so future agents do not treat rationale snapshots as default implementation contracts.
- New design documents require a clear owner role; otherwise new guidance should be a section in the existing owner document.
- Future agents should use search and section-level reads for PRD, Tech Architecture, and Data Architecture unless the task is broad.

References:

- `docs/START_HERE_FOR_AI_AGENTS.md`
- `docs/AI_DEVELOPMENT_GUIDE.md`
- `AGENTS.md`

### D-20260709-AI-Output-Quality-Is-Evaluated

Status: Accepted
Date: 2026-07-09

Decision:

Pige treats Agent-generated knowledge quality as a testable product behavior. v0.1 must include golden fixtures and regression gates for source-to-note generation, retrieval relevance, citation coverage, unsupported claims, low-confidence behavior, insufficient-evidence answers, and multilingual policy behavior.

Rationale:

Pige's core promise is that the Agent can preserve, organize, link, and retrieve personal knowledge. If tests only verify that jobs complete and files are written, the product can still fail by producing confident but unsupported notes, weak retrieval, broken citations, or unstable linking.

Consequences:

- Quality gates must include AI output evaluation fixtures, not only schema and UI tests.
- Prompt, context assembly, retrieval, parser, OCR, and knowledge-linking changes can trigger eval updates.
- Failing evals block release when they indicate unsupported durable knowledge, citation breakage, severe retrieval regression, data loss, secret leakage, or permission bypass.
- Live model evals are useful but not deterministic release gates; deterministic fixtures, stubs, recorded redacted responses, and schema/citation checks are preferred for CI.

References:

- `docs/QUALITY_AND_TEST_STRATEGY.md`
- `docs/PROMPT_DESIGN.md`
- `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`
- `docs/SPEC_TRACEABILITY.md`

### D-20260709-Data-Lifecycle-Is-Trash-First

Status: Accepted
Date: 2026-07-09

Decision:

Pige uses a trash-first and operation-recorded lifecycle for durable vault data. Agent, Skill, package, cleanup, reset, cancellation, and compaction flows must not permanently delete durable Markdown knowledge, source evidence, memory, conversations, proposals, or operation records. Rebuildable databases, indexes, caches, temp files, local model files, and tool assets can be reset or removed through their owning services because they are not the knowledge source of truth.

Rationale:

Pige is a local-first personal knowledge system. A broad "delete" or "cleanup" implementation could accidentally erase user-owned evidence or break future sync semantics. Durable data, source evidence, and auditability must survive ordinary maintenance and Agent autonomy.

Consequences:

- Data lifecycle behavior is governed by the matrix in `docs/DATA_ARCHITECTURE.md`.
- Durable deletes create operation records and tombstone metadata when sync-relevant.
- `.pige/trash/` is included in backups by default.
- Reset Local Database, Rebuild Index, tool/model removal, job compaction, diagnostics cleanup, and cancellation must not touch durable knowledge or source evidence except through explicit confirmed flows.

References:

- `docs/DATA_ARCHITECTURE.md`
- `docs/SYNC_CONFLICT_AND_MIGRATION.md`
- `docs/JOB_OPERATION_AND_RECOVERY.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`

### D-20260709-Lightweight-Workspace-Monorepo

Status: Accepted
Date: 2026-07-09

Decision:

Pige v0.1 should scaffold as a lightweight workspace monorepo. The desktop app lives in `apps/desktop/`; reusable domain types, serializable contracts, schemas, Markdown helpers, knowledge-model helpers, and fixture helpers live in `packages/*`.

Rationale:

Pige starts as a desktop Electron app, but the architecture deliberately reserves future Web/mobile clients and remote Agent backends. Keeping all domain contracts and reusable logic inside a desktop `src/` tree would make future extraction harder and would increase the chance that renderer, main-process, and platform-specific assumptions leak into shared logic.

Consequences:

- `apps/desktop/` owns Electron main/preload/renderer code and desktop adapters.
- `packages/*` must stay runtime-neutral unless explicitly platform-specific.
- Packages must not import from `apps/desktop/`.
- Renderer code must not import main-process services, adapters, filesystem, database, shell, parser, model, or secret APIs.
- Phase 0 scaffold must include workspace config, path aliases, package manifests, and import-boundary checks.

References:

- `docs/REPOSITORY_STRUCTURE.md`
- `docs/CODING_CONVENTIONS.md`
- `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`

### D-20260709-Dependencies-Need-Machine-Readable-Manifests

Status: Accepted
Date: 2026-07-09

Decision:

Pige keeps the Technical Architecture external dependency registry as the human-readable source for dependency rationale and boundaries, and adds machine-readable dependency manifests under `resources/dependency-manifest/` during implementation. Concrete packages, binaries, optional model assets, provider SDKs, parser/OCR tools, release tools, and CI/security tools must be represented in both layers before release.

Rationale:

The registry tells human and AI maintainers why a dependency exists, but release safety needs checks that can run in CI. Without a machine-readable manifest, future AI agents could add npm packages, bundled binaries, provider SDKs, CI actions, or optional model downloads without license review, checksum policy, data-boundary review, or an exit path.

Consequences:

- `docs/TECH_ARCHITECTURE.md` remains the canonical design registry.
- `resources/dependency-manifest/` becomes the implementation manifest location once scaffolded.
- `resources/toolchain-manifest/`, model manifests, provider catalog snapshots, lockfiles, SBOM/license notices, and release scripts must reference or align with dependency manifest records.
- CI and release gates should block unregistered production/runtime/release dependencies and missing license/checksum policy metadata.

References:

- `docs/TECH_ARCHITECTURE.md`
- `docs/REPOSITORY_STRUCTURE.md`
- `docs/RELEASE_ENGINEERING.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`

### D-20260709-Error-Taxonomy-Is-Shared

Status: Accepted
Date: 2026-07-09
Revised: 2026-07-10

Decision:

Pige uses one shared error taxonomy across API/IPC responses, durable job error summaries, diagnostics records, and UI failure/status surfaces. The canonical error shape includes stable namespaced codes, domain, localized message key, retryability, severity, user action, and redacted diagnostic references.

Rationale:

Agent products fail in many places: parsers, OCR, model providers, permissions, local tools, backup, restore, updates, and file paths. If each service invents error strings independently, future AI agents will create inconsistent UI states, unlocalized messages, fragile string matching, and diagnostic records that cannot be correlated. A shared taxonomy keeps recovery behavior predictable without adding user-facing complexity.

Consequences:

- Error codes use stable `<domain>.<reason>[.<detail>]` strings and never include private identifiers or user content.
- API `PigeError`, job `PigeErrorSummary`, and `DiagnosticError` should share code, domain, message key, retryability, and user action for the same failure.
- `packages/schemas/src/index.ts` owns the executable error enums and API/Job/diagnostic schemas; `packages/contracts/src/index.ts` re-exports their inferred types so process boundaries do not copy the vocabulary.
- Durable Job `warnings` and `error` fields reject arbitrary records and validate through `PigeWarningSchema` and `PigeErrorSummarySchema`.
- Renderer status cards choose affordances from structured fields, not localized text.
- Tests must verify localization coverage, redaction, and cross-surface consistency for fixture failures.

References:

- `docs/API_AND_IPC_DESIGN.md`
- `docs/JOB_OPERATION_AND_RECOVERY.md`
- `docs/DIAGNOSTICS_AND_OBSERVABILITY.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`

### D-20260709-Security-Disclosure-Is-Private-By-Default

Status: Accepted
Date: 2026-07-09

Decision:

Pige includes a top-level `SECURITY.md` before public alpha. Vulnerability reports use private disclosure paths by default, and public issues, commits, logs, prompts, diagnostics, and handoff notes must not contain exploit details, secrets, private paths, source bodies, note bodies, model responses, or user vault data.

Rationale:

Pige handles private local files, API keys, model-provider calls, parser/OCR tools, external Skills, packages, shell execution, and updates. A standard top-level security policy is expected in a serious open-source project, and it gives both human contributors and AI agents a clear place to route sensitive findings without leaking details into public artifacts.

Consequences:

- `SECURITY.md` is the public security-reporting entry point.
- README, contributing docs, and AI agent routing docs link to the security policy.
- Release readiness includes checking that the security policy is current and private vulnerability reporting is enabled or clearly documented.
- Security fixes still need tests, affected design-doc updates, and redacted release notes or advisories when appropriate.

References:

- `SECURITY.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/RELEASE_ENGINEERING.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`
- `docs/CONTRIBUTING_GUIDE.md`

### D-20260709-Privacy-Policy-Matches-Actual-Data-Flows

Status: Accepted
Date: 2026-07-09

Decision:

Pige includes a top-level `PRIVACY.md` before public alpha. The public privacy and data-use policy must match actual v0.1 behavior for local storage, BYOK model calls, URL fetch, optional model/tool downloads, update checks, diagnostics, support bundles, Skills, packages, backups, and future cloud/mobile boundaries.

Rationale:

Pige's product promise is local-first ownership, but it is not network-free. A public privacy baseline prevents user confusion around BYOK cloud calls, update checks, model downloads, diagnostics, and permissioned Skills. It also gives future AI agents a clear contract when modifying data flows or public copy.

Consequences:

- README, contributing docs, AI routing docs, release gates, and quality gates link to `PRIVACY.md`.
- Any change that adds telemetry, cloud sends, support uploads, remote Agent behavior, update network behavior, optional downloads, or Skill/package network behavior must update the privacy policy and related tests.
- Release readiness checks that `PRIVACY.md` matches the current data-flow behavior.
- Future cloud, mobile, sync, or remote Agent features require updated privacy terms and user-visible controls before enablement.

References:

- `PRIVACY.md`
- `docs/PRD.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/DIAGNOSTICS_AND_OBSERVABILITY.md`
- `docs/SETTINGS_AND_PREFERENCES.md`
- `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`
- `docs/RELEASE_ENGINEERING.md`

### D-20260709-Support-Policy-Uses-Redacted-Reproductions

Status: Accepted
Date: 2026-07-09

Decision:

Pige includes a top-level `SUPPORT.md` before public alpha. Public support, bug reports, and issue triage must use synthetic or redacted reproductions by default, and must not ask users to upload private vaults, raw source files, API keys, raw prompts, raw model responses, full backups, databases, or unreviewed support bundles.

Rationale:

Pige is a local-first knowledge product. The support channel itself can become a privacy leak if users are encouraged to attach real notes, files, logs, screenshots, or vaults. A top-level support policy gives users, maintainers, and AI agents a safe default for issue triage and keeps diagnostics/support-bundle behavior aligned with privacy and security promises.

Consequences:

- README, contributing docs, AI routing docs, release gates, and quality gates link to `SUPPORT.md`.
- Maintainers should ask for error codes, job IDs, operation IDs, platform info, and redacted support bundle summaries before private data.
- Security-sensitive reports are routed to `SECURITY.md`.
- Privacy/data-use questions are routed to `PRIVACY.md`.
- Public alpha readiness checks that support guidance matches the app's diagnostics and support-bundle behavior.

References:

- `SUPPORT.md`
- `PRIVACY.md`
- `SECURITY.md`
- `docs/DIAGNOSTICS_AND_OBSERVABILITY.md`
- `docs/CONTRIBUTING_GUIDE.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`

### D-20260709-Public-Collaboration-Uses-Templates

Status: Accepted
Date: 2026-07-09

Decision:

Pige includes `CODE_OF_CONDUCT.md`, GitHub issue forms, and a pull request template before public alpha. Public collaboration templates must require redacted reproductions, requirement/design-source references, test evidence, documentation-update checks, privacy/security/support checks, and private routing for vulnerabilities.

Rationale:

Pige is expected to be maintained by humans and AI agents. Without structured public intake, issues and PRs will omit requirement sources, leak private knowledge-base data, bypass security reporting, or propose broad features that violate simplicity-first. Templates reduce ambiguity and improve the quality of future AI-assisted triage and implementation.

Consequences:

- Public bug reports default to synthetic or redacted data.
- Feature and design requests must name workflows and affected design contracts.
- Security contact requests must not contain exploit details.
- Pull requests must declare requirement source, tests, docs, known gaps, and privacy/security/support impact.
- Public alpha release readiness checks that collaboration files are present and aligned with contribution, support, privacy, and security policies.

References:

- `CODE_OF_CONDUCT.md`
- `.github/ISSUE_TEMPLATE/`
- `.github/pull_request_template.md`
- `CONTRIBUTING.md`
- `SUPPORT.md`
- `docs/CONTRIBUTING_GUIDE.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`

### D-20260709-P0-Is-Release-Scope-Not-Task-Scope

Status: Accepted
Date: 2026-07-09

Decision:

PRD P0 defines the `v0.1 Public Alpha` release acceptance scope. It is not the implementation scope for a single task, pull request, AI session, or milestone. Implementation follows `docs/MILESTONES.md` and `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md` as vertical slices with explicit "Do not build yet" boundaries.

Rationale:

The first public alpha should be highly usable, so the P0 list is intentionally broad. If future AI agents interpret that list as one work item, they will overbuild, mix unrelated concerns, skip foundations, or create impressive features that do not compose into a reliable local product.

Consequences:

- Every implementation task should name a milestone/phase or a smaller vertical slice inside a phase.
- Later-phase items should not be pulled forward merely because the design context is nearby.
- Small enabling contracts for future phases are allowed when they protect architecture or data safety, but full feature implementation should wait for the scheduled phase.
- Any P0/P1/P2 priority change must update PRD, Milestones, Implementation Playbook, Spec Traceability, and Decision Log together.

References:

- `docs/PRD.md`
- `docs/MILESTONES.md`
- `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`
- `docs/SPEC_TRACEABILITY.md`

### D-20260709-Public-Alpha-Requires-Usability-Scenario

Status: Accepted
Date: 2026-07-09

Decision:

v0.1 Public Alpha requires a scripted usability scenario report before release. The scenario must cover at least 25 mixed sources across multiple sessions, common degraded/failure paths, backup, restore into a fresh folder, and post-restore retrieval.

Rationale:

Pige's first release goal is "highly usable", which cannot be proven by isolated unit tests or happy-path smoke tests alone. A realistic scenario gives future AI agents and maintainers a concrete release artifact that demonstrates the product works as a daily capture and retrieval companion, not just as separate components.

Consequences:

- The scenario uses synthetic or redacted fixtures, never private user vaults.
- The report records source counts, generated pages, warnings, failed/degraded jobs, backup manifest summary, restore result, AI eval summary, platform, and app build.
- A missing or failing scenario is a release blocker unless the release is clearly marked internal-only.
- Platform gaps must be listed in release notes and tracked as known limitations or blockers.

References:

- `docs/QUALITY_AND_TEST_STRATEGY.md`
- `docs/MILESTONES.md`
- `docs/RELEASE_ENGINEERING.md`
- `docs/SPEC_TRACEABILITY.md`

### D-20260709-Fixtures-And-Release-Evidence-Are-Manifest-Backed

Status: Accepted
Date: 2026-07-09

Decision:

Test fixtures and release evidence use explicit repository paths and manifest-backed naming. Committed fixture definitions live under `tests/fixtures/manifests/`, while generated local or CI outputs live under gitignored `artifacts/` paths.

Rationale:

Pige needs many fixtures, but future AI agents should not have to load the full documentation library or invent paths to understand quality gates. A stable manifest and artifact layout keeps the repository navigable, supports release evidence, and prevents generated reports from bloating source control.

Consequences:

- Release-gate fixtures must be represented in fixture manifests.
- Public Alpha usability evidence uses the release-evidence path defined in Repository Structure and Release Engineering.
- Generated reports are redacted by default and must not include private vault content, raw source bodies, prompts, model responses, secrets, or private absolute paths.
- CI should validate fixture manifests before release-gate suites run.

References:

- `docs/REPOSITORY_STRUCTURE.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`
- `docs/RELEASE_ENGINEERING.md`
- `docs/SPEC_TRACEABILITY.md`

### D-20260709-Dependency-Manifests-Are-Schema-Governed

Status: Accepted
Date: 2026-07-09

Decision:

Pige's external dependency registry remains human-readable in Technical Architecture, but implementation dependencies must also be represented by schema-valid machine-readable records under `resources/dependency-manifest/`. Temporary dependency exceptions live in a separate waiver manifest and expire.

Rationale:

Pige depends on a broad supply chain: Electron, React, TypeScript, Pi Agent/AI, local parser/OCR tools, optional model downloads, bundled runtimes, GitHub Actions, signing/update tooling, and security scanners. Future AI agents need a strict path for adding or updating dependencies without hiding licensing, checksum, data-boundary, or packaging risk.

Consequences:

- `resources/dependency-manifest/dependency-manifest.schema.json` owns the machine-readable schema.
- `resources/dependency-manifest/dependencies.manifest.json` owns approved implementation dependency records.
- `resources/dependency-manifest/dependency-waivers.manifest.json` owns temporary exceptions with expiry, owner, risk, mitigation, and replacement plan.
- Expired waivers block release.
- Waivers cannot permit unknown executable provenance, unclear licensing, hidden task-time downloads, secret exposure, renderer trust-boundary bypass, or ignored available signature/checksum checks for bundled executables.

References:

- `docs/TECH_ARCHITECTURE.md`
- `docs/REPOSITORY_STRUCTURE.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`
- `docs/RELEASE_ENGINEERING.md`
- `docs/SPEC_TRACEABILITY.md`

### D-20260709-Phase-0-Scaffold-Uses-Full-Owner-Pack

Status: Accepted
Date: 2026-07-09

Decision:

Phase 0 scaffold work must load the repository structure, coding conventions, technical dependency registry, quality gates, release engineering, implementation playbook, and spec traceability together before changing workspace, CI, manifest, import-boundary, or generated-evidence paths.

Rationale:

The first scaffold commit sets the shape future AI agents will follow. If it misses package boundaries, dependency manifests, fixture manifests, release evidence paths, or CI gates, later implementation work will inherit a confusing baseline and require avoidable rewrites.

Consequences:

- The project setup reading pack is intentionally larger than a normal feature pack.
- Phase 0 can still use section reads for large files, but it must inspect the owner contracts before scaffolding.
- Future changes to workspace shape, dependency manifests, fixture manifests, or CI gates must update the same owner pack.

References:

- `docs/START_HERE_FOR_AI_AGENTS.md`
- `docs/AI_DEVELOPMENT_GUIDE.md`
- `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`
- `docs/REPOSITORY_STRUCTURE.md`
- `docs/CODING_CONVENTIONS.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`
- `docs/RELEASE_ENGINEERING.md`
- `docs/SPEC_TRACEABILITY.md`

### D-20260709-Requirement-IDs-Are-Traceability-Verified

Status: Accepted
Date: 2026-07-09
Revised: 2026-07-10

Decision:

Requirement IDs use `PIGE-<AREA>-<NUMBER>` and resolve to exactly one definition in `docs/SPEC_TRACEABILITY.md`. Repository verification fails on undefined references, self-reference-only definitions, duplicate definitions, unlisted area prefixes, invalid owner/evidence paths, Phase/Milestone disagreement, or incomplete Build-to-exit mapping.

Rationale:

Pige is expected to be developed through many AI-assisted sessions. Stable requirement IDs make handoffs, issues, tests, and release evidence precise, but only if IDs do not drift into orphan references or duplicate meanings.

Consequences:

- New requirement IDs require a Spec Traceability row.
- New area prefixes must be added to the allowed area list before use.
- Renaming or removing an ID requires updating affected docs, tests, issues, release notes, and Decision Log records when applicable.
- CI and local `npm run verify` run requirement ID and acceptance-closure verification.

References:

- `docs/SPEC_TRACEABILITY.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`
- `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`
- `docs/REPOSITORY_STRUCTURE.md`

### D-20260709-Pre-Phase-0-Readiness-Gate

Status: Accepted
Date: 2026-07-09

Decision:

Phase 0 repository scaffolding may start only after the Pre-Phase 0 Design Readiness Gate in `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md` is satisfied. Passing this gate authorizes repository foundation work only; it does not permit skipping phase boundaries or building later product features early.

Rationale:

The design baseline is intentionally broad. Future AI agents need a concrete transition rule that distinguishes sufficient readiness for safe scaffolding from premature feature implementation.

Consequences:

- Design work continues until product scope, architecture, data ownership, repository structure, manifests, quality gates, and traceability are stable enough for Phase 0.
- Phase 0 still follows its own context pack, build list, "Do not build yet" boundaries, and exit criteria.
- If the gate fails, agents should keep improving design rather than scaffold around known ambiguity.

References:

- `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`
- `docs/START_HERE_FOR_AI_AGENTS.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`
- `docs/SPEC_TRACEABILITY.md`
- `docs/DESIGN_BASELINE_AUDIT.md`

### D-20260709-Phase-1-Provider-And-Settings-Registry

Status: Accepted
Date: 2026-07-09
Revised: 2026-07-10

Decision:

Phase 1 stores BYOK provider metadata and model profiles as machine-local records, stores API keys through encrypted secret storage, exposes one effective default Pi Agent model through redacted `models.*` IPC, and classifies implemented user-visible settings through a Settings Registry.

Rationale:

Pige must leave capture-only mode only when there is a real default model profile contract the Agent runtime can resolve. At the same time, provider setup must stay simple and must not leak upstream provider complexity or raw keys into renderer DTOs, vault files, SQLite, diagnostics, or backups.

Consequences:

- `provider-profiles.json` stores provider metadata and `authSecretRef`, not API keys.
- `model-profiles.json` stores manual/discovered model profiles and the selected default model.
- `secrets.json` stores encrypted secret blobs in machine-local app data through Electron safeStorage; this decision does not authorize plaintext mode without its explicit warning flow.
- Renderer receives `ProviderProfileSummary` and `ModelProfileSummary`, never raw API keys.
- Onboarding state becomes `ready` only when an active vault and default model profile exist; otherwise an active vault remains `capture_only`.
- Agent Runtime Policy Context includes `defaultModelProfileId` and `modelConfigured` when a default model is selected.
- The Models UI remains a short connection form and does not expose Advanced/Fast model routing, provider marketplaces, capability matrices, pricing, context windows, or per-workflow routing.
- The Settings Registry classifies implemented settings by scope, owner, storage, backup behavior, apply behavior, and agent policy effect when relevant.

References:

- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`
- `docs/SETTINGS_AND_PREFERENCES.md`
- `docs/API_AND_IPC_DESIGN.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/UI_PROTOTYPE.md`

### D-20260709-Phase-1-Pending-Sqlite-Driver

Status: Superseded
Date: 2026-07-09
Superseded by: D-20260709-Node-Sqlite-Initial-Local-Database-Driver

Decision:

Phase 1 introduces the `LocalDatabaseDriver` abstraction and empty migration-state file with a `pending_sqlite_driver` before adding native SQLite runtime dependencies.

Rationale:

The Phase 1 exit criteria require reset/rebuild ownership and an empty migration system, while full search/indexing belongs to later phases. Adding native SQLite packaging before the vault, provider, settings, diagnostics, and maintenance contracts are stable would increase ABI and release risk early.

Consequences:

- `.pige/db/schema-state.json` is rebuildable cache metadata, not durable knowledge.
- Reset Local Database may delete and recreate the pending schema state.
- Phase 4 search/indexing must replace the pending driver with a real SQLite driver and update dependency manifests, tests, and release packaging evidence.

References:

- `docs/LOCAL_DATABASE_DESIGN.md`
- `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/RELEASE_ENGINEERING.md`

### D-20260709-Phase-1-Window-And-Backup-Entry-Points

Status: Superseded
Date: 2026-07-09
Superseded by: D-20260710-Window-Preferences-And-Backup-Service-Boundary

Decision:

Phase 1 implements a Window Mode Service for compact, expanded, full-screen, always-on-top, and sidebar-open preferences as machine-local settings. Phase 1 also exposes backup/restore entry-point status in Vault & Note Storage, but keeps actual backup creation, restore preview, and restore apply disabled until the Backup Service phase.

Rationale:

The desktop shell needs real window behavior early because compact always-on-top capture is part of the product shape. Backup and restore must be visible in the vault settings page for user trust, but a fake backup action would be worse than a disabled honest entry point before the durable backup manifest, ZIP engine, restore staging, and post-restore rebuild workflows exist.

Consequences:

- Window layout mode, remembered compact/expanded sizes, sidebar state, and always-on-top are stored in OS app data settings and excluded from vault backup.
- Renderer talks to window behavior only through typed preload IPC and receives serializable `WindowState` DTOs.
- Vault switching must preserve machine-local window preferences.
- `backup.status` may be available in Phase 1; `backup.create`, `restore.preview`, and `restore.apply` remain Phase 9 work.
- Vault & Note Storage can show Last backup, Create Backup, and Restore Backup controls in disabled entry-point state without implying data protection is already implemented.

References:

- `docs/TECH_ARCHITECTURE.md`
- `docs/UI_PROTOTYPE.md`
- `docs/API_AND_IPC_DESIGN.md`
- `docs/SETTINGS_AND_PREFERENCES.md`
- `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`

### D-20260709-Phase-2-Read-Only-Job-Status-Recovery

Status: Superseded
Date: 2026-07-09
Superseded by: D-20260709-Phase-2-Minimal-Job-Retry-Cancel

Decision:

Phase 2 adds `jobs.list` as a read-only safe-summary query over durable `.pige/jobs/` records so Home can recover queued capture status after launch.

Rationale:

Capture reliability is not only writing source records and jobs. The app must also make preserved captures visible again after restart without requiring a database rebuild, parser run, or model setup.

Consequences:

- Jobs Service scans the active vault's `.pige/jobs/` records and may read matching source records for display name and source kind.
- Renderer receives job IDs, class, state, source ID, capture ID, safe source display name, source kind, message, and timestamps.
- Renderer does not receive source record paths, managed copy paths, original absolute paths, file bodies, prompts, model responses, or secrets.
- Invalid job JSON is counted and skipped so Home remains usable.
- Retry, cancel, scheduling, parent/child batch jobs, and compaction remain later Job Queue Service work.

References:

- `docs/JOB_OPERATION_AND_RECOVERY.md`
- `docs/DATA_ARCHITECTURE.md`
- `docs/API_AND_IPC_DESIGN.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`

### D-20260709-Phase-2-Minimal-Job-Retry-Cancel

Status: Accepted
Date: 2026-07-09
Revised: 2026-07-10
Supersedes: D-20260709-Phase-2-Read-Only-Job-Status-Recovery

Decision:

Phase 2 exposes safe recovery through `jobs.list`, durable cancel/retry for eligible
persisted jobs, and process-local cooperative cancellation for active parse/OCR work.

Rationale:

Users need safe action on preserved jobs without requiring a full scheduler.

Consequences:

- `jobs.cancel` can directly cancel eligible non-running work only when
  `durableWritesApplied !== true`; active parse/OCR enters idempotent `cancel_requested`.
- `jobs.retry` can mark `failed_retryable`, `waiting_dependency`, or `cancelled` jobs as `queued`.
- Cancelling a job does not delete source records, managed source copies, conversation events, proposals, operation records, memory, or Markdown.
- A direct-to-`cancelled` state with a true action-safety guard returns `not_allowed`,
  and retry keeps the guard. Active parse/OCR may request a safe cooperative stop;
  unsupported running and final/review states reject cancellation.
- Other running classes, cross-process routing, durable checkpoint arrays, scheduling,
  parent/child batches, and compaction remain outside this decision.

References:

- `docs/JOB_OPERATION_AND_RECOVERY.md`
- `docs/DATA_ARCHITECTURE.md`
- `docs/API_AND_IPC_DESIGN.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`

### D-20260709-Phase-2-3-Home-Lexical-Retrieval

Status: Superseded
Date: 2026-07-09
Superseded by: D-20260710-Home-Context-Pack-And-Local-Evidence-Summary

Decision:

Phase 2/3 implements `retrieval.search` as a local lexical Markdown scan and routes clearly question/search-like Home composer input to ranked local results before model synthesis, SQLite FTS, vector search, or local reranking are available.

Rationale:

Pige's core product promise requires knowledge to come back out through natural questions, not only manual browsing. A local lexical fallback proves the Home retrieval loop without requiring model setup, local embedding downloads, or the later SQLite indexing phase. It also preserves the local-first context boundary: selected snippets are surfaced, not full vault contents.

Consequences:

- Home remains one composer; there is no separate Ask/Search mode.
- Ordinary non-question input remains capture.
- Retrieval responses contain safe page summaries, scores, bounded snippets, match reasons, and degraded-search state.
- CJK queries use character bigram/trigram fallback instead of whitespace-only matching.
- Internal source-storage reference lines are filtered from snippets.
- Grounded synthesis, citations over selected evidence, context-pack serialization, SQLite FTS, vector search, reranking, answer saving, and jump-to-snippet behavior remain later retrieval slices.

References:

- `docs/API_AND_IPC_DESIGN.md`
- `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`
- `docs/PERFORMANCE_AND_RELIABILITY.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/UI_PROTOTYPE.md`

### D-20260710-Home-Context-Pack-And-Local-Evidence-Summary

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-12
Supersedes: D-20260709-Phase-2-3-Home-Lexical-Retrieval

Decision:

Home question input now uses `agent.ask`. With a ready runtime it retrieves locally and
requires embedded Pi to call one bounded search tool; with no binding it returns
`retrieval.ask` before Agent work. No selected evidence returns the fixed local
insufficient result without a model call.

Rationale:

Pige needs an answer-shaped retrieval experience before optional embeddings while
keeping Pi, local-first retrieval, and model egress enforceable as one path. The bounded
Context Pack supports current Home synthesis and later Note Agent/remote clients without
duplicating bodies.

Consequences:

- Home stays one composer and does not expose a retrieval mode selector.
- Renderer responses include a short answer, ranked page summaries, bounded snippets, citation refs, and plain degraded state; they do not receive Context Pack internals, full bodies, raw prompts, context budgets, secret-bearing policy, or arbitrary filesystem paths.
- Serialized Context Packs contain refs, page IDs, safe locators, scores, estimated snippet budgets, index health, warnings, and omission counts. Selected snippet text remains ephemeral.
- The default result UI hides raw ranking scores and match internals while retaining title, snippet, page type, citation, and open-page actions.
- Model turns receive escaped untrusted evidence and strict citation refs. Current
  Markdown bytes and Source Record privacy facts are re-read per turn; each changed
  classification gets a distinct body-free audit before drift is rejected.
- Results expose only bounded retrieval output and `none|local|cloud`; model prompts,
  credentials, endpoints, private paths, and raw errors remain internal.

References:

- `docs/API_AND_IPC_DESIGN.md`
- `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/UI_PROTOTYPE.md`

### D-20260709-Provider-Setup-Tests-Before-Save

Status: Accepted
Date: 2026-07-09
Revised: 2026-07-12

Decision:

Phase 3 Provider setup tests before persistence. The current recommended path is the
reviewed OpenAI preset: API key only, fixed endpoint/Responses protocol, bounded model
discovery, reviewed default, and one global model list. Compatible/custom endpoints that
explicitly lack listing may use a manual model ID.

Rationale:

The Models page says "Test and Save", so saving invalid credentials would create a false-ready Agent runtime state. Pige also needs to support both official providers with model-list APIs and self-hosted or compatible endpoints that require manual model IDs.

Consequences:

- API keys are used only in the main process for the connection test and secret-store write.
- `models.addPresetProvider` is write-only toward main, requires validation/confirmation,
  never returns the key, and restores the known-good binding on failure.
- Authentication failures, invalid base URLs, invalid model-list payloads, and missing selected models fail before any provider/model/secret records are persisted.
- `ProviderBaseUrlSchema` is shared by persistence, connection tests, boundary classification, and model calls; it canonicalizes safe URLs and rejects non-loopback HTTP, non-HTTP(S) protocols, credentials, queries, and fragments before credentials are accessed or sent.
- Built-in OpenAI/Anthropic profiles use fixed official endpoints and cannot persist a custom `baseUrl`; compatible/custom profiles may claim `local`/`loopback_verified` only when the canonical URL is actually loopback. Schema reads reject edited metadata that could disguise a cloud call as verified local.
- OpenAI-format providers use `/v1/models` with Bearer auth; Anthropic-format providers use `/v1/models` with `x-api-key` and `anthropic-version`.
- Renderer receives only redacted provider/model summaries, never API keys, request headers, raw provider responses, or secret refs.
- Catalog/help action/custom protocol polish, durable preset identity/replacement policy,
  multi-provider lifecycle, and packaged manual BYOK acceptance remain open.
- This provider-setup decision does not itself authorize model-call execution; the implemented basic execution bridge is governed by `D-20260709-Phase-3-Basic-Agent-Ingest-Bridge`.

References:

- `docs/API_AND_IPC_DESIGN.md`
- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/SETTINGS_AND_PREFERENCES.md`
- `docs/TECH_ARCHITECTURE.md`

### D-20260709-Node-Sqlite-Initial-Local-Database-Driver

Status: Accepted
Date: 2026-07-09
Supersedes: D-20260709-Phase-1-Pending-Sqlite-Driver

Decision:

Phase 4 uses Node `node:sqlite` as Pige's initial real local database driver, behind `LocalDatabaseDriver`. `better-sqlite3` remains the reviewed fallback driver if `node:sqlite` fails release stability, packaging, or performance smoke tests.

Rationale:

The repository pins Node 24 and Electron 43, and the current runtime can create SQLite FTS5 tables through `node:sqlite`. Using the runtime-provided driver removes immediate native npm module rebuild, signing, and notarization risk while the database schema and service boundaries are still stabilizing.

Consequences:

- Local Database Service now creates `.pige/db/vault.sqlite` with page metadata tables, initial placeholder tables for source/job/graph areas, and `pages_fts`.
- Library and Retrieval use SQLite when the index is ready and fall back to Markdown scanning when the database is unavailable or unhealthy.
- CJK lexical retrieval uses Pige-generated 2/3-gram augmentation because default SQLite FTS tokenization is not sufficient for CJK recall.
- Large-vault rebuild is not considered release-ready until moved to a background job or worker with progress and cancellation.
- Release gates must include platform smoke tests for open, migration, insert, FTS search, rebuild from Markdown, and clean close.

References:

- `docs/API_AND_IPC_DESIGN.md`
- `docs/LOCAL_DATABASE_DESIGN.md`
- `docs/PERFORMANCE_AND_RELIABILITY.md`
- `docs/TECH_ARCHITECTURE.md`

### D-20260710-Index-Rebuild-Job-First-Maintenance

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-10

Decision:

Manual local database rebuilds must create a durable `index_rebuild` job before rebuilding SQLite page metadata and FTS from Markdown. An initial implementation may execute the rebuild body synchronously after job creation, but the product contract is job-first.

Rationale:

Index rebuild is a repair/maintenance action over rebuildable state. It can be slow, fail, or be retried, so it should leave durable evidence in `.pige/jobs/` and `log.md` instead of behaving like an invisible direct database call.

Consequences:

- `maintenance.rebuildLocalDatabase` returns rebuild counts plus the completed job ID when the immediate runner succeeds.
- Failed rebuilds mark the job `failed_retryable`; Markdown knowledge and source evidence remain untouched.
- Home recent jobs include `index_rebuild` summaries alongside capture and Agent ingest jobs.
- Moving rebuild execution to a worker later must preserve the same job class, result shape, and durable-state semantics.

References:

- `docs/API_AND_IPC_DESIGN.md`
- `docs/JOB_OPERATION_AND_RECOVERY.md`
- `docs/LOCAL_DATABASE_DESIGN.md`
- `docs/PERFORMANCE_AND_RELIABILITY.md`
- `docs/TECH_ARCHITECTURE.md`

### D-20260710-Markdown-Link-Backlink-Index

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-10

Decision:

Phase 4 indexes explicit Markdown links as rebuildable graph metadata. The Local Database rebuild parses wiki links, local Markdown `.md` links, and renderer-style `#wiki:` links into `links`, `backlinks`, and resolved `relation_edges` rows. `library.related` exposes resolved outgoing links and backlinks as safe page summaries.

Rationale:

Users need a natural way to move from one note to related knowledge without manually maintaining folders or categories. Markdown remains the durable truth, while SQLite provides fast related-page lookup and can be rebuilt after deletion, restore, or external edits.

Consequences:

- Repeated links from one page to the same target are shown as one related page in Library APIs.
- Unresolved targets remain rebuildable index metadata for future Knowledge Health, but they do not authorize renderer filesystem access.
- Renderer APIs continue to use stable page IDs and safe summaries rather than arbitrary paths or note bodies.
- Knowledge Tree aggregation is outside this link-index decision and may build on the same resolved graph foundation.

References:

- `docs/API_AND_IPC_DESIGN.md`
- `docs/KNOWLEDGE_MODEL_AND_LINKING.md`
- `docs/LOCAL_DATABASE_DESIGN.md`
- `docs/TECH_ARCHITECTURE.md`

### D-20260710-Reader-Related-Context-Rail

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-10

Decision:

The Note Reader can show outgoing links and backlinks through a lightweight related-context rail backed by `library.related`. The rail is a safe navigation surface over resolved page summaries, not a filesystem browser or a graph editor.

Rationale:

Retrieving knowledge should feel like enhanced search and reading, not only manual Library browsing. Showing related notes while reading makes captured knowledge easier to reuse without adding a separate mode or forcing users to understand graph internals.

Consequences:

- Library rows and Home retrieval results use the same Reader behavior.
- Wide layouts may place related context beside the Markdown body; narrow layouts stack it below the body.
- Related rows open notes by stable page ID and do not expose arbitrary local paths, source bodies, prompts, or raw note bodies.
- Note Agent, edit mode, source reveal/open-folder actions, and Knowledge Tree visualization are outside this related-context decision.

References:

- `docs/API_AND_IPC_DESIGN.md`
- `docs/UI_PROTOTYPE.md`
- `docs/TECH_ARCHITECTURE.md`

### D-20260710-Url-Capture-Uses-Untrusted-Snapshot-And-Extracted-Text

Status: Accepted
Date: 2026-07-10

Decision:

Basic URL capture fetches HTTP/HTTPS pages in the main process through Source Fetch Service, stores raw responses as untrusted managed source snapshots, and stores extracted readable text as a separate `extracted_text` artifact. Source pages and Agent ingest use the extracted text artifact by default, not raw HTML.

Rationale:

Pasted links are a core capture input, but web pages are untrusted and can contain scripts, prompt injection, tracking URLs, or sensitive query parameters. Separating raw evidence from extracted text lets Pige preserve source evidence while keeping reader, prompt, and Markdown surfaces safer.

Consequences:

- Renderer code never fetches web pages directly.
- URL fetch blocks unsupported schemes, embedded credentials, local/private/link-local/metadata-network targets, and redirect targets that fail the same checks.
- Durable URL references redact sensitive query values before writing source records, Markdown pages, prompts, operation records, conversations, diagnostics, or support bundles.
- `.pige/conversations/` stores only source references for URL captures, never raw HTML or extracted web text.
- Static-page Readability extraction, richer metadata, and redacted image references are implemented by `D-20260710-Bounded-Readability-Web-Extractor`; browser-rendered JavaScript-heavy pages remain deferred.

References:

- `docs/API_AND_IPC_DESIGN.md`
- `docs/PARSER_INGEST_SPEC.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/TECH_ARCHITECTURE.md`

### D-20260710-Bounded-Readability-Web-Extractor

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-11

Decision:

Pige uses exact `@mozilla/readability` `0.6.0` plus jsdom `29.1.1` in a separately built, serial, bounded web-extractor worker. Main-process URL transport uses the exact reviewed Undici pin owned by `D-20260711-Undici-8-7-Transport-Pin`; after DNS policy validation, each request dispatcher can resolve only to the already approved address set. The response deadline covers body consumption, and the decompressed body, redirects, worker input/elements/output/images, heap, and extraction time are bounded. Source Fetch Service persists decoded snapshots and plain extracted text; it never renders Readability HTML. Browser-rendered page execution is not a v0.1 fallback.

Rationale:

Readability's supported Node path needs a DOM implementation, while jsdom gives higher compatibility than an approximate DOM adapter. Running both outside the main event loop contains parser memory and CPU risk. Using an explicit Undici dispatcher closes the DNS validation-to-connection gap that a separate lookup plus global fetch would leave. Preserving the fetched snapshot and a reduced DOM-less fallback keeps capture useful when extraction fails without hiding lower evidence quality. The 2026-07-11 revision moves the evolving transport pin into its own decision without changing this extractor architecture.

Consequences:

- jsdom scripts and subresources are not enabled; hostile page scripts remain inert in fixtures.
- Production connections are pinned to validated DNS answers and every redirect gets a new validation and dispatcher.
- URL capture enforces five redirects, 10 seconds through body reads, and 2 MiB of decompressed response bytes.
- Web extraction enforces a 5-second worker deadline, 256 MiB old-generation cap, 2,097,152 decoded input characters, 20,000 Readability elements, 1,000,000 output characters, 64 redacted HTTP(S) image references, one active extraction, and at most eight pending extractions per adapter.
- Source Records persist extraction identity/version/mode/counts/truncation and selected bounded metadata. Conversation history remains reference-only.
- Reduced or truncated extraction enters Agent quality context and forces warning-bearing generated notes into review.
- Dependency, toolchain, hostile fixture, built-worker smoke, SSRF, charset, body-timeout, response-size, fallback, and Agent-handoff evidence must pass before release.

References:

- `docs/PARSER_INGEST_SPEC.md`
- `docs/PERFORMANCE_AND_RELIABILITY.md`
- `docs/RELEASE_ENGINEERING.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/TECH_ARCHITECTURE.md`

### D-20260711-Undici-8-7-Transport-Pin

Status: Accepted
Date: 2026-07-11

Decision:

Pige pins the direct desktop runtime to Undici `8.7.0`. Source Fetch keeps redirects manual, revalidates every hop, creates a fresh validated-address-pinned Agent per hop, sets `allowH2: false`, and does not install a global or ambient proxy dispatcher. The HTTP/1.1 boundary stays in force until HTTP/2 receives separate pinning evidence.

Rationale:

The major upgrade is compatible with Electron `43.1.0` / Node `24.18.0`, but transport defaults must not silently broaden the reviewed SSRF and connection boundary. Exact lock, license, Node-engine, focused Source Fetch, and assembled Electron-main transport evidence justify replacing the former `7.28.0` pin without changing URL-capture behavior.

Consequences:

- The direct workspace edge and nested production package must resolve to `8.7.0`; unrelated toolchain copies may retain Undici 7.
- The local synthetic Electron-main smoke proves the assembled ABI and transport invariants, not signed/packaged macOS or Windows parity.
- Signed/packaged platform proof and any future HTTP/2 enablement remain release work.

References:

- `docs/TECH_ARCHITECTURE.md`
- `docs/RELEASE_ENGINEERING.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `resources/dependency-manifest/dependencies.manifest.json`

### D-20260710-Window-Preferences-And-Backup-Service-Boundary

Status: Accepted
Date: 2026-07-10
Supersedes: D-20260709-Phase-1-Window-And-Backup-Entry-Points

Decision:

Window layout preferences remain machine-local and are owned by Window Mode Service. Backup and restore controls must reflect real Backup Service capability rather than a fixed phase placeholder; the implemented local ZIP create, preview, and safe new-folder restore path is governed by `D-20260710-Basic-Local-Zip-Backup-And-Safe-Restore`.

Rationale:

The original Phase 1 decision correctly established machine-local window behavior and honest disabled backup entry points, but its statement that backup actions belonged to Phase 9 became stale once the first Backup Service slice shipped. Separating persistent window policy from capability-driven backup availability keeps both contracts current without erasing the historical rollout.

Consequences:

- Compact, expanded, full-screen, always-on-top, and sidebar preferences stay in machine-local settings and remain outside vault backup.
- Backup and restore actions may be enabled only when their typed service commands and safety checks are implemented.
- UI copy and status must describe the available Backup Service slice, not a historical phase number.
- Additional backup options remain separately scoped and do not weaken the first slice's path, checksum, staging, and no-overwrite protections.

References:

- `docs/SETTINGS_AND_PREFERENCES.md`
- `docs/UI_PROTOTYPE.md`
- `docs/API_AND_IPC_DESIGN.md`
- `docs/DATA_ARCHITECTURE.md`
- `D-20260710-Basic-Local-Zip-Backup-And-Safe-Restore`

### D-20260710-Basic-Local-Zip-Backup-And-Safe-Restore

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-10

Decision:

Pige implements the first Backup Service slice as local `.pige-backup.zip` creation, restore preview, and safe new-folder restore. The archive contains a root `pige-backup-manifest.json` and included vault files under `vault/`. Restore preview validates manifest format, safe paths, file sizes, and SHA-256 checksums before restore apply. Restore apply extracts into staging, rejects unexpected entries, activates the restored vault, and rebuilds the local database from durable vault files.

Rationale:

Backup/restore is a v0.1 release safety requirement and should become real before broader ingest and Agent features increase user data volume. A local ZIP slice gives users portable recovery without introducing sync, cloud storage, secret export, external-original copying, or a complex backup console.

Consequences:

- Renderer exposes only typed create/preview/apply commands and never scans, compresses, extracts, validates, or writes arbitrary backup paths.
- Default backup includes durable vault data and excludes `.pige/db/`, `.pige/indexes/`, `.pige/cache/`, secrets, model files, tool binaries, machine-local settings, and external originals.
- Restore never overwrites the current vault in this slice.
- Progress events, backup options for excluding memory/conversations, encrypted provider export/import, external-original byte inclusion, fast-restore database cache, cancellation mid-compression, and large-vault performance reporting are outside this first Backup Service slice.

References:

- `docs/API_AND_IPC_DESIGN.md`
- `docs/DATA_ARCHITECTURE.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/UI_PROTOTYPE.md`

### D-20260710-Pdfjs-Worker-For-Embedded-Pdf-Text

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-11

Decision:

Pige uses exact `pdfjs-dist` `6.1.200` in a separately built bounded Node worker for v0.1 embedded PDF text, metadata, and page locators. It pins `@napi-rs/canvas` `1.0.2` explicitly because PDF.js 6's Node entry requires its `DOMMatrix`/`Path2D` runtime primitives even when Pige does not render pages. Main-process Parser Service owns deterministic artifact writes, Source Record updates, and source-page refresh. This decision does not select a PDF page-rendering adapter for OCR.

Rationale:

PDF.js is Apache-2.0, works with Pige's Node 24 baseline, avoids a hidden task-time binary download, and provides a stable local extraction API. Making the canvas runtime explicit prevents packaged builds from depending on optional-dependency luck. Keeping PDF.js outside the Electron main thread protects UI responsiveness, while the adapter boundary leaves room to replace extraction or add a reviewed renderer later.

Consequences:

- The adapter is exposed to Pi Agent as a bounded PDF inspect/extract tool when both bundled modules resolve. DOCX/PPTX parsing is governed separately by `D-20260710-Bounded-Office-Openxml-Worker`; this decision owns only the PDF adapter.
- Source preservation and durable queueing remain host responsibilities. Any current format-triggered parse/Agent continuation is a transitional bridge and does not define the target orchestration contract.
- The worker gets one preserved PDF path and byte/page limits, has no artifact-write authority, and runs with timeout/heap limits.
- Text and metadata use deterministic paths. The sidecar stores locators, counts, warnings, quality, checksums, and OCR candidates without duplicating page text.
- One deterministic `create_artifact` Operation Record preserves audit references and warnings without duplicating the extracted body; retry can repair it idempotently.
- The tool returns coverage, OCR candidates, warnings, and locators to Pi Agent; Pi Agent decides whether to inspect further, invoke OCR, continue with bounded evidence, or wait for a capability.
- Page-limit truncation and OCR-pending state are included in trusted ingest quality metadata; service-side guards force review and cap high confidence so partial extraction cannot masquerade as complete evidence.
- Source-page refresh uses durable previous/target checksums so interrupted Pige writes are recoverable and external user edits are never silently overwritten.
- Release packaging must prove the platform-specific native canvas binary and worker entry are present on every supported macOS/Windows target.

References:

- `docs/PARSER_INGEST_SPEC.md`
- `docs/PERFORMANCE_AND_RELIABILITY.md`
- `docs/RELEASE_ENGINEERING.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/TECH_ARCHITECTURE.md`

### D-20260710-Bounded-Office-Openxml-Worker

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-11

Decision:

Pige uses exact Mammoth `1.12.0` for semantic DOCX conversion and a Pige-owned PPTX/OpenXML adapter built from exact yauzl `3.4.0` plus fast-xml-parser `5.9.3`. Both formats run in one separately built bounded Office worker behind `DocumentParserService`. JSZip remains transitive through Mammoth only. Pige does not add officeparser, pptxtojson, node-pptx-parser, LibreOffice, or task-time parser downloads for this v0.1 slice.

Rationale:

Mammoth provides the required DOCX headings, lists, tables, links, and image references without native binaries. PPTX requires relationship-driven slide order, speaker notes, media references, and strict archive/XML controls that are clearer and smaller in a focused Pige adapter. Reusing yauzl avoids a second Pige-owned ZIP abstraction. The rejected high-level Office alternatives either pull in unrelated PDF/OCR/native canvas or large WASM dependencies, use whole-archive memory models, expose unstable Node APIs, or omit required notes/media/order semantics.

Consequences:

- The Office worker receives one preserved source path and hard byte, entry, expanded-size, XML, slide, text, timeout, and heap limits; only main-process Parser Service may write vault artifacts.
- DOCX conversion disables embedded style maps and external-file access, replaces images with local references, and never renders converter HTML.
- PPTX parsing rejects unsafe paths, duplicate parts/relationships, suspicious compression, DOCTYPE, invalid/deep XML, and unsafe internal relationships; external targets are counted but never opened.
- Deterministic text and text-free metadata artifacts carry checksum/size references. Source, parser version, sidecar, and text integrity are verified before reuse or Agent handoff.
- The tool returns text quality, media/OCR candidates, Artifact IDs, warnings, and bounded locators to Pi Agent; Pi Agent chooses the next tool call or a visible dependency wait.
- Interrupted idempotent tool Jobs are recoverable child work of the Agent Job; uncertain or cancellation-in-progress work becomes explicitly retryable without inventing a host-fixed next step.
- Dependency updates require real semantic DOCX, relationship-ordered PPTX, hostile archive/XML, worker packaging, artifact integrity, and restart recovery gates.

References:

- `docs/PARSER_INGEST_SPEC.md`
- `docs/PERFORMANCE_AND_RELIABILITY.md`
- `docs/RELEASE_ENGINEERING.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/TECH_ARCHITECTURE.md`

### D-20260710-MacOS-Vision-Direct-Image-OCR

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-11

Decision:

Pige uses an app-owned, schema-versioned Swift helper for direct raster-image OCR on macOS 26+. The helper tries Apple Vision `RecognizeDocumentsRequest` revision 1 and falls back to accurate `RecognizeTextRequest` revision 3. It runs as a bounded child process behind `OcrPort`; main-process services own source validation, deterministic Artifact writes, Source Page refresh, Job state, Operation Records, and the typed OCR tool-result boundary returned to Pi Agent.

Rationale:

The macOS 26 Vision API provides high-quality local recognition without a model download or cloud OCR boundary. A small app-owned helper keeps Vision and image decoding outside the renderer and Electron main event loop while preserving a stable TypeScript capability adapter and replaceable engine boundary.

Consequences:

- The helper uses a single bounded JSON request/response protocol, sanitized environment, no shell, no OCR network access, and no task-time dependency download.
- Runtime verifies an adjacent helper manifest and exact binary checksum before declaring the capability available. Release builds must compile each architecture, sign the nested helper, package its manifest, and prove packaged recognition before notarization.
- Direct `image_file` OCR is implemented. PDF pages, slide images, and embedded Office media stay dependency-waiting until reviewed render/materialization adapters produce bounded pixel Artifacts; locator strings are not image inputs.
- OCR text and metadata remain derived, checksummed, rebuildable Artifacts. The metadata sidecar contains locators, geometry, confidence, language/image metadata, warnings, and checksums without copying the recognized body.
- Preserved source integrity is checked before and after recognition. Valid artifacts are reused after restart, stale derived artifacts are regenerated, source/path integrity failures do not invoke Vision, and empty recognition returns an explicit empty tool result for Pi Agent to replan without a knowledge write.
- Low-confidence or truncated OCR is retained as evidence with warnings and forces Agent-generated knowledge into review.
- Windows AI OCR and user-consented PaddleOCR fallback remain separate future slices behind the same capability boundary.

References:

- `docs/PARSER_INGEST_SPEC.md`
- `docs/PERFORMANCE_AND_RELIABILITY.md`
- `docs/RELEASE_ENGINEERING.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/TECH_ARCHITECTURE.md`
- `resources/parser-manifests/macos-vision-ocr.helper.manifest.json`

### D-20260710-Canonical-Phase-And-Traceability-Ownership

Status: Accepted
Date: 2026-07-10

Decision:

`docs/V0_1_IMPLEMENTATION_PLAYBOOK.md` is the only owner of implementation Phase P0-P9 numbering, Build commitments, deferrals, and exit criteria. `docs/MILESTONES.md` owns release outcomes M0-M7 and the only normative Phase-to-Milestone crosswalk. `docs/SPEC_TRACEABILITY.md` owns the stable requirement register and connects each requirement to those two views without creating another roadmap.

Rationale:

Three independently numbered delivery plans made the same Phase label mean different work and let implementation notes drift away from release acceptance. One phase owner, one milestone crosswalk, and one machine-checked requirement register preserve both planning clarity and honest evidence.

Consequences:

- Architecture and specialized contracts own services and behavior but do not define alternate numbered phase plans.
- Every Playbook Build commitment maps to a stable exit criterion; every active requirement maps to one Phase, one compatible Milestone, verification, status, and evidence or planned target.
- Definition rows do not count as their own references, and historical/research material cannot be the sole current owner or implementation evidence.
- Existing in-flight work keeps its current P0-P9 and M0-M7 labels. It absorbs new requirement/evidence mapping at the next natural handoff unless a live security, privacy, durable-data, migration, or incompatible-contract risk requires immediate coordination.

References:

- `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`
- `docs/MILESTONES.md`
- `docs/SPEC_TRACEABILITY.md`
- `docs/START_HERE_FOR_AI_AGENTS.md`

### D-20260710-Executable-Documentation-Quality-Gates

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-10

Decision:

Pige evaluates documentation-system health as five independent dimensions: navigation/resource lifecycle, cross-document contract consistency, continuous traceability/acceptance closure, support for ongoing development, and documentation leanness/maintainability. Each dimension must score at least `9.5/10` through repository-reproducible weighted gates; an average cannot hide a weak dimension.

Rationale:

Link checks and large design coverage can both be green while semantic contracts, phase closure, or development handoffs remain unreliable. A transparent executable scorecard makes documentation quality repeatable and prevents subjective completion claims.

Consequences:

- `resources/documentation-quality/documentation-quality.manifest.json` owns gate IDs, weights, dimensions, and the threshold.
- `resources/documentation-quality/documentation-leanness.manifest.json` owns the audited context, inventory, projection, and physical-volume budgets.
- `scripts/verify/documentation-quality.mjs` evaluates current repository evidence and writes a generated report under `artifacts/documentation-quality/`.
- Critical security routing, durable-data ambiguity, incompatible normative contract, false-positive traceability, or unmapped v0.1 scope prevents the affected dimension from reaching the threshold.
- Normal repository verification runs document-map/link, decision lifecycle, traceability, contract-consistency, and scorecard gates.
- The scorecard measures documentation control, not product completion. Planned product requirements remain honestly planned and still block their release phase when applicable.

References:

- `docs/QUALITY_AND_TEST_STRATEGY.md`
- `docs/START_HERE_FOR_AI_AGENTS.md`
- `docs/SPEC_TRACEABILITY.md`
- `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`

### D-20260710-Executable-Traceability-Acceptance-Manifests

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-10

Decision:

Pige keeps the human-readable requirement register in `docs/SPEC_TRACEABILITY.md` and uses three committed machine-readable controls: `resources/traceability/p0-coverage.manifest.json` partitions every PRD P0 bullet; `resources/traceability/acceptance.manifest.json` binds every requirement to Build IDs, Exit IDs, exact evidence selectors or planned targets, structured open destinations, and controlled Exit/phase status; and `resources/traceability/semantic-claims.manifest.json` independently locks normalized source and mapping anchors.

Rationale:

An ID table and existing file paths can be structurally green while omitting P0 scope, mapping Builds to unrelated Exits, or overstating evidence. Bidirectional mappings, exact selectors, phase-completion constraints, independent trace checks, and mutation cases make those false positives observable without turning historical documents into implementation proof.

Consequences:

- PRD section 8.1 currently contains 151 P0 bullets; adding, removing, or moving one requires an explicit coverage-manifest update.
- Every active requirement appears in exactly one Playbook Phase gate and one Milestone gate, and maps to Builds whose declared Exits are present in the same acceptance link.
- Every Exit has `planned`, `partial`, or `verified` status. A phase cannot be `complete` while any assigned requirement or Exit is incomplete.
- Every partial Requirement and Exit names a structured open gap with controlled Build and Exit destinations.
- Test/verifier evidence names an exact selector. Recipe-backed generated or manual release reports may live under gitignored `artifacts/`; historical material cannot prove current implementation.
- Traceability scoring runs five separate checks and mutation cases. Automated self-scoring does not by itself promote `PIGE-DOC-005` or E0.11 from `partial`.
- Existing P0-P9 and M0-M7 labels remain unchanged. Active development adopts the added IDs and evidence selectors at the next natural handoff unless a safety or incompatible-contract issue requires immediate action.

References:

- `docs/PRD.md`
- `docs/SPEC_TRACEABILITY.md`
- `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`
- `docs/MILESTONES.md`
- `resources/traceability/p0-coverage.manifest.json`
- `resources/traceability/acceptance.manifest.json`
- `resources/traceability/semantic-claims.manifest.json`
- `scripts/verify/traceability.mjs`
- `scripts/verify/traceability-negative-cases.mjs`

### D-20260710-File-Capture-Storage-Strategy-Enforcement

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-10

Decision:

New local-file captures consume the active vault's `sourceStorage.defaultStrategy`. `copy_to_source_library` writes a verified managed copy; `reference_original` records the absolute original locator, checksum, size, and mtime without duplicating the file. Typed/pasted text and fetched URL snapshots remain managed copies because they have no independently owned local original. Parser, OCR, and Agent readers resolve both file strategies through the shared source-file-access boundary. External parser, renderer, and OCR adapters receive disposable inputs copied from an already-open verified descriptor rather than the live source pathname.

Rationale:

The setting was already user-visible, but a hard-coded copy path made it decorative and encouraged later services to assume that every source had `managedCopy`. Enforcing the choice once at capture and using one verified reader preserves evidence integrity without duplicating source-resolution logic. Descriptor-derived snapshots also prevent a pathname replacement between verification and an external worker's open from silently changing the processed evidence.

Consequences:

- A missing referenced original becomes a reconnectable dependency; checksum, symlink, or path-boundary violations fail closed.
- Managed-copy and referenced-original files share parser, OCR, and Agent ingest behavior after source verification.
- Temporary worker inputs are checksum-bound, private, and disposed after adapter use; verified Artifact reuse avoids creating an unnecessary copy.
- Markdown projections never expose operational original or managed-copy paths.
- Existing managed-copy Source Records remain valid and are not rewritten when the default changes.
- Planning impact is Medium and additive within the existing P5/P6 source-ingest boundaries; no Phase, Milestone, stable ID, or migration renumbering is required.

References:

- `docs/SOURCE_STORAGE_STRATEGY.md`
- `docs/PARSER_INGEST_SPEC.md`
- `docs/API_AND_IPC_DESIGN.md`
- `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`
- `packages/schemas/src/index.ts`
- `apps/desktop/src/main/services/source-file-access.ts`

### D-20260710-Strict-Durable-Records-And-Egress-Identity

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-10

Decision:

Schema-v1 Job and Operation records fail closed on undeclared root fields; source-file locator selection follows the declared storage strategy; built-in Provider profiles require their canonical boundary proof; and each model-egress audit binds typed payload, bounded prompt metadata, Provider/Model routing identity, evidence summary, and final-decision digests into its operation identity. Documentation contract gates execute the relevant tests, and critical Accepted decisions carry machine-checked owner/code/test anchors.

Rationale:

String markers and test-title checks can stay green while an executable schema accepts contradictory or sensitive fields. Likewise, an idempotent audit keyed only by Job, Source, and policy can conceal changed selected evidence. These are contract-boundary failures even when the full test suite is otherwise green.

Consequences:

- A durable Job uses `state`; an extra `status` or other undeclared root field is rejected.
- An Operation Record rejects undeclared root fields such as `rawPrompt`, and `model_egress_decision` requires its typed body-free audit object.
- A `reference_original` Source Record cannot also contain `managedCopy`, and readers never choose a locator independently of `storageStrategy`.
- Built-in OpenAI and Anthropic records without `builtin_verified` boundary metadata fail schema validation.
- Changed selected payload, prompt metadata, endpoint, model identity, evidence identity, or final classification/decision creates a distinct audit operation; a retry reuses an audit only when the complete approved identity is equivalent.
- CON-001 through CON-004 execute their mapped tests, while CON-005 validates and executes the semantic anchor map.
- The change keeps all current stable IDs, Phase labels, Milestone labels, and implementation ordering intact; active development absorbs the stricter boundary without renumbering planning controls.

References:

- `docs/JOB_OPERATION_AND_RECOVERY.md`
- `docs/SOURCE_STORAGE_STRATEGY.md`
- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`
- `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`
- `packages/schemas/src/index.ts`
- `apps/desktop/src/main/services/source-file-access.ts`
- `apps/desktop/src/main/services/agent-ingest-service.ts`
- `tests/unit/durable-contract-schemas.test.ts`
- `tests/unit/security-contract-schemas.test.ts`
- `tests/unit/agent-ingest-service.test.ts`

### D-20260710-Semantic-Traceability-Lock-And-Executable-Evidence

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-10

Decision:

The acceptance manifest uses schema version 3 with normalized `capabilities`, `requirements`, `exits`, evidence, and phase-state owners. The semantic-claims lock uses schema version 2 with one SHA-256 digest per canonical claim instead of full preimages. Together they bind PRD item text, Requirement identity/ownership, capability delivery assignments, Build/Exit/Deferred text, Phase state, evidence selectors, acceptance status, and open destinations. The lock changes only after an explicit semantic review.

Rationale:

Cross-linked mapping tables can remain structurally green when related Requirement, capability, Build, Exit, evidence, or open-gap values are exchanged together. Existing files can also be relabeled as tests without proving anything. An independently reviewed source-text/selector lock and actual execution of verified test/verifier evidence make those coordinated false positives observable while keeping ordinary implementation work on the existing roadmap.

Consequences:

- Every partial Requirement and every partial Exit has a stable open ID, a concrete description, and controlled Build/Exit destinations.
- Spec owns Requirement ID, text, owner, Phase, Milestone, and verification class; acceptance alone owns current status, exact evidence/planned targets, and open work.
- Test and verifier evidence used to claim `verified` acceptance is path-constrained and executed by the traceability gate. Recipe-backed generated/manual reports retain source-recipe hash validation.
- Missing, extra, altered, or coordinated P0, capability, Requirement, Build, Exit, Deferred, Phase-state, evidence, and open-gap claims fail against `resources/traceability/semantic-claims.manifest.json` until a reviewer explicitly accepts the semantic change.
- `PIGE-VAULT-003` stays within the v0.1 owner contract: managed-copy and verified referenced-original preservation, with cross-root reference recovery assigned to B2.07/E2.08. Advanced `link_to_original` remains explicitly deferred by D2.04 rather than expanding v0.1.
- Active development need not stop or rewrite completed work. Teams consume the stricter evidence/open format at the next natural handoff unless a live acceptance contradiction is discovered; no Build, Exit, Phase, Milestone, or requirement ID is renumbered.

References:

- `docs/SPEC_TRACEABILITY.md`
- `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`
- `docs/REPOSITORY_STRUCTURE.md`
- `resources/traceability/README.md`
- `scripts/verify/traceability.mjs`
- `scripts/verify/traceability-negative-cases.mjs`

### D-20260710-Bounded-PDF-Page-OCR-Materializer

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-11

Decision:

Pige v0.1 uses a separate, explicit `pdfjs-dist 6.1.200` plus `@napi-rs/canvas 1.0.2` worker adapter to materialize only parser-verified PDF OCR candidate pages as bounded PNG Artifacts. Automatic document OCR accepts fully inspected image-only or mixed-text PDFs whose complete ordered candidate set contains at most 20 pages. Image-only targets cover every page; mixed targets render only sparse candidates and retain native evidence as an independent Artifact.

Rationale:

PDF page locators already identify an exact rasterization target, and both runtime packages are pinned and bundled for the existing PDF parser. Making rasterization a named port, worker, manifest, and protocol closes the gap between locator metadata and real pixels without introducing a task-time binary download or pretending PDF.js is an OCR engine. The later Multi-Artifact Evidence Assembly decision removed the original single-body limitation, so sparse-page OCR can now enrich rather than replace native text.

Consequences:

- The renderer has independent file/page/pixel/PNG/aggregate/heap/time limits, no network path, strict worker-response validation, symlink rejection, and an installed-worker smoke requirement.
- Main-process `PdfOcrArtifactService` owns deterministic rendered-page, render-manifest, OCR-text, and OCR-metadata writes; source bytes remain immutable and may be a managed copy or verified referenced original. Render/OCR manifests bind parser-metadata identity and the exact candidate-page set, and persistence rereads the latest Source Record before merge.
- Rendering and recognition use separate idempotent body-free Operation Records. Complete checksummed output is reused; incomplete render/recognition returns a retryable or dependency-waiting tool result to the Agent Job.
- Pi Agent decides whether a mixed PDF needs bounded OCR enrichment before synthesis. Complete empty enrichment preserves independently verified native evidence; unavailable OCR is surfaced as a capability result so Pi Agent may wait or continue with an explicit review warning under policy.
- The native Canvas worker requires macOS arm64/x64 and Windows x64 installed-package startup and crash-soak evidence. The port can move to an Electron utility process, Poppler, PDFium, or another reviewed renderer if worker-thread/native-module evidence is insufficient.
- B5.08 and E5.05 remain partial until slide/media materialization, Windows/PaddleOCR fallback, progress/cancellation, and supported-package evidence are complete.

References:

- `docs/PARSER_INGEST_SPEC.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/PERFORMANCE_AND_RELIABILITY.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/RELEASE_ENGINEERING.md`
- `apps/desktop/src/main/services/pdf-page-renderer-service.ts`
- `apps/desktop/src/main/services/pdf-ocr-artifact-service.ts`
- `resources/parser-manifests/pdf-page-materializer.manifest.json`
- `tests/unit/pdf-page-renderer-core.test.ts`
- `tests/unit/pdf-page-renderer-service.test.ts`
- `tests/unit/pdf-ocr-artifact-service.test.ts`
- `tests/unit/jobs-service.test.ts`

### D-20260710-Multi-Artifact-Evidence-And-Claim-Citations

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-11

Decision:

Pige v0.1 assembles tool-selected evidence in a main-process, call-scoped `EvidencePack` instead of selecting one preferred Artifact or persisting a merged body. Every eligible extracted-text/OCR Artifact is verified and paired only with its own metadata sidecar by Source ID, sidecar Artifact ID, sidecar kind, and body checksum. Pi Agent receives the bounded pack through the registered evidence tool and produces summary and key-point statements as `{ text, evidenceRefs }`, where refs are ephemeral ordered `ev_NN` values supplied by Pige. Pige alone resolves valid refs into canonical Markdown citations through a validated publication tool call.

Rationale:

Choosing the first OCR/text Artifact or the first metadata sidecar loses native evidence, misattributes locators, and cannot safely support mixed PDF/Office inputs. Parallel claim and citation arrays can also drift by index. A bounded in-memory catalog keeps durable bodies independent, preserves provenance, gives each claim an explicit support set, and allows deterministic rejection and evaluation without duplicating source content.

Consequences:

- Native evidence is ordered before OCR. OCR is deduplicated only when same-parent native text already contains it; mixed packs reserve bounded capacity for supplemental OCR so native-first ordering cannot consume the entire context.
- Current ingest caps the pack at 24 fragments and 18,000 evidence characters. Citation-locator collisions across distinct Artifacts receive deterministic Artifact-qualified suffixes. Truncation, unpaired metadata, low OCR confidence, and missing refs force review-quality warnings.
- Unknown refs fail before Markdown write. Empty refs remain visible only as review-required statements. Model-authored citation tokens are stripped; Pige renders `[source:<source-id>#<locator>]` from validated refs.
- PDF parser sidecars include exact page character spans for new output. Legacy one-page/marker-based sidecars remain readable, but cannot override a checksum-matched structured span.
- Pi runtime Model Egress still occurs before prompt rendering or credential lookup. The audit binds the ordered redacted evidence selection, bounded/redacted dynamic prompt metadata, and concrete non-secret Provider/Model routing identities; same-ID endpoint or model changes fail closed before model invocation.
- The deterministic B5.12 seed covers English direct text and Simplified Chinese low-confidence OCR plus fabricated-claim, cited-body-support, missing-ref, and unavailable-ref negative controls. E5.04 remains partial until all required fixture families and thresholds are present.

References:

- `docs/PROMPT_DESIGN.md`
- `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`
- `docs/MARKDOWN_SCHEMA.md`
- `docs/PARSER_INGEST_SPEC.md`
- `apps/desktop/src/main/services/evidence-assembly-service.ts`
- `apps/desktop/src/main/services/agent-ingest-service.ts`
- `tests/unit/evidence-assembly-service.test.ts`
- `tests/evals/agent-ingest.multilingual-golden.test.ts`

### D-20260710-Single-Owner-Documentation-Projections

Status: Accepted
Date: 2026-07-10

Decision:

Each normative contract, registry, operating template, and manually maintained status has one named owner. Other documents keep only the audience-specific boundary they own plus a link; generated projections must be normalized and reproducible. The always-read pack, governed Markdown inventory, and trace manifests have executable size budgets.

Rationale:

Synchronizing equivalent prose, enums, checklists, and mappings across files increases context cost and allows several mutually consistent copies to drift together. Owner links and explicit budgets preserve specialized contracts while making maintenance cost and accidental duplication visible.

Consequences:

- Full document inventory and lifecycle metadata live outside the default entry path; task packs remain human-readable.
- Start/handoff templates, product scope, phase state, requirement mappings, evidence, IPC, and domain types are edited only at their declared owners.
- `npm run verify:documentation-leanness` rejects repeated owner structures, stale aliases, manual trace projections, unbounded growth, and loss of the audited physical reduction.

References:

- `docs/START_HERE_FOR_AI_AGENTS.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`
- `resources/documentation-quality/documentation-leanness.manifest.json`
- `scripts/verify/documentation-leanness.mjs`

### D-20260710-AI-Native-PRD-Contract

Status: Accepted
Date: 2026-07-10

Decision:

The PRD is a normative product contract optimized for AI Coding Agents, not a marketing
narrative, implementation-status report, or second technical specification. It owns the
product optimization order, default user mental model, observable and degraded behavior,
release scope, non-goals, product acceptance intent, and product risks. Specialized
owner documents own executable types, implementation boundaries, paths, dependencies,
models, and verification detail. Semantic changes propagate bidirectionally between the
PRD and affected owners in the same change.

Rationale:

AI-maintained development needs deterministic, addressable, testable rules and explicit
conflict precedence. Short prose is not inherently better, and a broad P0 release scope
is not inherently ambiguous when stable requirements, phases, exits, and evidence are
separately mapped. Repeated technical definitions, current-state prose, and unranked
principles are harmful because they create competing truths and force Agents to infer
which copy or time frame is authoritative.

Consequences:

- PRD optimization removes duplicate ownership and semantic ambiguity rather than
  targeting an arbitrary line count or silently reducing P0 scope.
- P0/P1/P2 remain product scope; Playbook phases remain implementation order; acceptance
  resources remain the only current status and evidence owner.
- The PRD states product behavior and references technical owners instead of duplicating
  schemas, internal paths, dependency/model identities, platform APIs, or compiler
  versions.
- Every change declares `none`, `editorial`, `behavior`, or `release_scope` impact and
  records affected requirements, owners, and trace/acceptance consequences.
- Executable PRD structure, leakage, mutation, and semantic-lock gates protect the
  contract after this normalization.

References:

- `docs/PRD.md`
- `AGENTS.md`
- `docs/AI_DEVELOPMENT_GUIDE.md`
- `.github/pull_request_template.md`
- `docs/SPEC_TRACEABILITY.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`
- `resources/traceability/semantic-claims.manifest.json`

### D-20260710-Agent-Authored-Role-Separation

Status: Accepted
Date: 2026-07-10

Decision:

Pige implementation is Agent-authored. Project Management owns delivery, Planning owns
contracts, UI Design owns visual guidance, and Development owns code, tests, fixtures,
and executable evidence; role crossing requires delegation.

Rationale:

Role separation limits drift while humans retain direction, review, and release authority.

Consequences:

- Handoffs name role/task, scoped delegation, and Product Planning sync status; gates remain mandatory.

References:

- `docs/AI_DEVELOPMENT_GUIDE.md`
- `.github/pull_request_template.md`

### D-20260711-Agent-Orchestrated-Tool-Constrained-Pipeline

Status: Accepted
Date: 2026-07-11

Decision:

After source preservation, Pi Agent alone selects, sequences, evaluates, and replans
semantic tool use. Tools perform one bounded capability; host services enforce policy,
permissions, limits, provenance, Jobs, validation, confirmation, and commits.

Rationale:

A fixed Capture→Parser→OCR→Agent→Write chain duplicates Agent planning. Narrow tools
reduce uncertainty without creating a second workflow.

Consequences:

- Existing parser/OCR/Artifact/Job/recovery work is retained as tool substrate.
- Capture preserves evidence first; missing Agent/model state pauses semantic work.
- Preserved sources use Pi events for inspect, parse/selected OCR, optional bounded
  retrieval, re-inspect, and cited publication; proposal tools remain.
- B3.13/E3.08 becomes the Agent Spine Gate before non-blocking format/platform breadth.
- Static and behavioral tests must reject direct provider paths, host-fixed tool order,
  and durable writes not caused by a validated tool call.
- The PDF.js, bounded Office, macOS Vision, bounded PDF OCR, and Multi-Artifact entries
  are revised in place to retain their adapter, safety, Artifact, and citation choices
  while removing stale host-fixed scheduling and direct-model handoff consequences.

References:

- `docs/VISION.md`
- `docs/PRD.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`
- `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`

### D-20260711-Pi-Compat-Containment-Exception

Status: Accepted
Date: 2026-07-11

Decision:

Pige may temporarily adopt exact official Pi core/AI `0.80.6` packages despite the
core's transitive `pi-ai/compat` load. The sole adapter uses isolated `Models` and a
receiver-bound stream; compat globals/catalog/default dispatch remain unused. Deep
imports, patches, forks, and vendoring remain banned.

Rationale:

No official compat-free entry exists; reimplementation or a fork would cost more. The
user approved this narrow exception after its side effects were audited.

Consequences:

- Exact dual pins, bundled license text, a sole-adapter import gate, scoped model/auth
  tests, import-side-effect snapshot, and assembled Electron Agent-loop smoke implement
  the bounded exception; signed packaged-platform and full-tool-path proof remain open.
- The exception ends when a reviewed official compat-free Agent entry is available.
- `@earendil-works/pi-ai` remains the official provider/model package in the same Pi
  project; Pige does not add Vercel AI SDK or another provider runtime.

References:

- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`

### D-20260712-Local-First-Without-BYOK-Friction

Status: Accepted
Date: 2026-07-12

Decision:

After one disclosure, selecting a Profile authorizes ordinary/private/bounded-large
calls to that destination. `ordinary_allowed` is default with non-blocking status;
sensitive confirms, restricted blocks, and unknown/changed destinations confirm.

Rationale:

Local ownership, no Pige cloud account, and no telemetry define local-first; repeated
BYOK prompts add only friction.

Consequences:

- Trust grants no tool, setting, permission, extension, or destructive authority.
- Send selected context directly, never the whole vault or a Pige cloud proxy.
- Default/disclosure are executable; persisted stricter settings and confirmation resume remain open.

References:

- `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`
- `docs/PRD.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `PRIVACY.md`

## 4. Deferred Decisions

### D-20260709-Sync-Implementation

Status: Deferred
Date: 2026-07-09

Decision:

Cloud sync is not part of v0.1, but IDs and conflict strategy must be sync-ready.

Rationale:

Shipping sync safely requires an explicit protocol, identity model, conflict UX, privacy boundary, migration policy, and recovery evidence. v0.1 concentrates on trustworthy local ownership while preserving the data contracts needed for a later sync adapter.

Consequences:

- v0.1 must not start background sync, create a Pige cloud dependency, or imply multi-device convergence.
- Stable IDs, schema versions, conflict metadata, tombstones, and external-edit handling remain required local contracts.
- Reconsider sync only with updated product, privacy, security, migration, backup/restore, and release contracts.

References:

- `docs/DATA_ARCHITECTURE.md`
- `docs/SYNC_CONFLICT_AND_MIGRATION.md`

### D-20260709-Linux-Support

Status: Deferred
Date: 2026-07-09

Decision:

Linux support is deferred until after v0.1.

Rationale:

The first public alpha needs concentrated packaging, signing, native-capability, parser, backup/restore, and usability evidence on macOS and Windows. Adding a third desktop release target now would dilute those quality gates.

Consequences:

- Linux packaging and support are not v0.1 release gates.
- Shared product logic should still use runtime capability adapters and avoid unnecessary platform coupling.
- Reconsider Linux after the macOS and Windows release pipelines, native dependencies, and support capacity are stable.

References:

- `docs/RELEASE_ENGINEERING.md`
- `docs/TECH_ARCHITECTURE.md`

### D-20260709-Mobile-And-Cloud-Implementation

Status: Deferred
Date: 2026-07-09

Decision:

Mobile app, Web app, Pige Cloud remote Agent backend, self-hosted remote Agent backend, personal desktop backend, and cloud sync are deferred from v0.1. Mobile Lite is reserved as a client capability tier, not as a full Agent runtime.

Rationale:

Mobile and Web clients cannot provide desktop-local tool, parser, model, filesystem, and long-running Agent capabilities with equivalent reliability. A remote Agent backend also introduces authentication, hosting, privacy, security, billing, sync, and operational contracts that are outside the local-first v0.1 release.

Consequences:

- v0.1 should not ship server or mobile functionality.
- v0.1 should still preserve runtime capability boundaries and client capability metadata so these products can be added later.

References:

- `docs/FUTURE_MOBILE_AND_CLOUD_ARCHITECTURE.md`
