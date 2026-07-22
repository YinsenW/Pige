# Decision Log

Status: Active decision ledger
Last reviewed: 2026-07-22

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
      "decisionId": "D-20260717-Reader-Inline-Reference-Resolution",
      "owner": {
        "path": "docs/API_AND_IPC_DESIGN.md",
        "markers": ["Reader inline-reference query contract:", "`ambiguous`, `not_found`, and `failed`", "add nothing; `stale` adds only"]
      },
      "code": [
        {
          "path": "packages/schemas/src/index.ts",
          "markers": ["export const NoteResolveInlineReferenceRequestSchema", "export const NoteResolveInlineReferenceResultSchema"]
        }
      ],
      "tests": [
        {
          "path": "tests/unit/security-contract-schemas.test.ts",
          "markers": ["keeps inline note reference requests bounded and results pathless"]
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
| `D-20260712-Deterministic-Create-Note-Proposal-Apply` | Exact create-note proposal apply | `docs/JOB_OPERATION_AND_RECOVERY.md`, `docs/API_AND_IPC_DESIGN.md` |

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

Status: Superseded
Date: 2026-07-09
Superseded by: D-20260713-Open-Local-Narrative-And-Structured-Truth

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

### D-20260713-Open-Local-Narrative-And-Structured-Truth

Status: Accepted
Date: 2026-07-13
Supersedes: D-20260709-Local-First-Markdown

Decision:

Pige uses two first-class open local durable forms: Markdown for narrative knowledge and
versioned Dataset Bundles for structured knowledge. Dataset Bundles use one documented
envelope with managed-collection SQLite or analytical-snapshot Parquet payloads;
original CSV/XLSX/database files remain source evidence. Pige's internal SQLite and
indexes remain rebuildable.

Rationale:

Flattening typed rows, schemas, formulas, and large tables into Markdown loses structure,
queryability, and scale. A portable bundle preserves local ownership without turning a
hidden application database into the only truth or creating separate product modes.

Consequences:

- Pi remains the semantic orchestrator and uses typed bounded Dataset tools/query plans,
  never unrestricted SQL or direct file/database authority.
- v0.1 first proves preserve-first CSV/XLSX/SQLite import, read-only local query/table
  view, and exact Dataset citations; editable managed Collections are P1.
- Reversible local Collection/view changes use Operations/Activity/Undo. Original or
  external database writes, destruction, new authority, and unresolved conflicts pause.
- Arrow is runtime-only and DuckDB/Parquet implementations remain candidates until
  dependency, security, package, and platform gates select exact pins.

References:

- `docs/DATA_ARCHITECTURE.md`
- `docs/DOMAIN_MODEL.md`
- `docs/PARSER_INGEST_SPEC.md`
- `docs/LOCAL_DATABASE_DESIGN.md`
- `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`

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
Revised: 2026-07-12

Decision:

Markdown, citations, source records, managed sections, and Operations own knowledge
relationships; SQLite graphs and Knowledge Tree aggregates are rebuildable views.

Rationale:

Hidden graph truth would break local ownership, backup, portability, and sync readiness.

Consequences:

- Wiki Compiler owns durable links/pages; Local Database owns rebuildable indexes/views.
- Evidence-bound recoverable relationships auto-apply with Operations; destructive loss
  or unreconcilable identity/conflict intervenes.
- Tags stay facets; meaningful topics/concepts/entities/claims/questions are Markdown.

References:

- `docs/KNOWLEDGE_MODEL_AND_LINKING.md`
- `docs/MARKDOWN_SCHEMA.md`
- `docs/LOCAL_DATABASE_DESIGN.md`
- `docs/DATA_ARCHITECTURE.md`

### D-20260709-Durable-Jobs-Before-Work

Status: Accepted
Date: 2026-07-09
Revised: 2026-07-12

Decision:

Pige persists Jobs before expensive/failure-prone work. Proposals and Operations are
durable vault data; SQLite job indexes rebuild.

Rationale:

Failures, restarts, and conflicts must not lose captures or duplicate effects.

Consequences:

- Preserve source before work; retry/recovery is checkpointed and idempotent.
- Eligible mutations write redacted Operations; exceptional boundaries stage proposals.
- Home rebuilds status from durable Jobs, proposals, Operations, conversations, and log.

References:

- `docs/JOB_OPERATION_AND_RECOVERY.md`
- `docs/DATA_ARCHITECTURE.md`
- `docs/PERFORMANCE_AND_RELIABILITY.md`
- `docs/API_AND_IPC_DESIGN.md`

### D-20260709-Pre-Implementation-Dependency-Choices

Status: Accepted
Date: 2026-07-09

Decision:

Pre-implementation dependency defaults are selected in the Technical Architecture
registry before feature code lands, with adapters where packaging or compatibility may
force replacement.

Rationale:

Explicit reviewed defaults prevent each implementation Agent from reopening supply-chain
choices while retaining tested exit paths.

Consequences:

- Exact versions, licenses, integrity, distribution, data boundary, update policy, and
  replacement path enter the registry/manifests before adoption.
- Storage, vector, archive, parser, editor, release, and security choices remain behind
  their owner-defined adapters and gates.

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

The Playbook owns actionable phase criteria; repeated completion slogans add no proof.

Consequences:

- Scope, exclusions, and required checks determine completion; failed checks block while
  non-blocking work moves to its controlled destination.
- Unfinished surfaces stay honest. Routine updates report deltas; handoffs report evidence,
  failures, risks, and deferrals without ceremonial repetition.

References:

- `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`
- `docs/SPEC_TRACEABILITY.md`

### D-20260712-Deterministic-Create-Note-Proposal-Apply

Status: Accepted
Date: 2026-07-12
Revised: 2026-07-13

Decision:

The current proposal handler applies only its exact Pi-staged Job-scoped generated note.
Approval recovers; rejection writes nothing; conflict closes the parent. It is exception
infrastructure, not the target default.

Rationale:

It proves bounded review/recovery without a generic mutation engine.

Consequences:

- Startup reconciles supported decisions without model/credentials; writes are not atomic.
- Home review stays transitional; exact-create Activity/Undo works. Broader eligibility,
  generic Operations, CAS/TOCTOU, and platforms remain open.

References:

- `docs/JOB_OPERATION_AND_RECOVERY.md`
- `docs/API_AND_IPC_DESIGN.md`

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

Status: Superseded
Date: 2026-07-09
Superseded by: D-20260722-Personal-Agent-Architecture-Reset

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

Status: Superseded
Date: 2026-07-09
Revised: 2026-07-12
Superseded by: D-20260722-Personal-Agent-Architecture-Reset

Decision:

External Skills/packages/extensions use Ask Every Time, Remember Scoped Grants, or YOLO
Full Access. Pige-owned bounded knowledge tools do not need YOLO or routine prompts.

Rationale:

External-capability users need both strict and scoped low-friction modes without a session concept.

Consequences:

- Dialogs offer Deny, Allow Once, and revocable scoped Always Allow; YOLO is explicit/off by default.
- Grants bind actor, version, capability, resource, and destination; auto-allows are logged.
- YOLO cannot bypass OS/security, exceptional intervention, or stricter egress.
- Raw secret bytes are never grantable; reviewed adapters use secret refs without disclosure.

References:

- `docs/PRD.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/UI_PROTOTYPE.md`

### D-20260714-Pi-Capability-And-Authority

Status: Superseded
Date: 2026-07-14
Revised: 2026-07-18
Superseded by: D-20260722-Personal-Agent-Architecture-Reset

Decision:

Pi may request path, filesystem, command and commit actions, but capability is not
authority. Active-vault recoverable Markdown and exact selected-source admission have
standing authority; other effects use Permission Broker. Destructive, policy,
source-original, model-egress and raw-secret boundaries remain stronger.

Rationale:

Pi plans useful actions without model output becoming authority over user-owned paths.

Consequences:

- Tool ownership never bypasses the gate for its exact action.
- Allow once binds exact action/Job/policy/resource identity and is consumed once.
- UI receives bounded system-authored summaries only; main executes the exact action.
- Permission defaults cover eligible scopes only; stronger gates and raw-secret blocks remain.
- Machine-local revision fences explicit YOLO and grant revocation. Main ships bounded
  read-only folder/text/network tools; their untrusted output faces egress again.

References:

- `docs/PRD.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`

### D-20260709-Home-Composer-Unified-Entry

Status: Superseded
Date: 2026-07-09
Superseded by: D-20260712-General-Purpose-Agent-Unified-Ingress

Decision:

Home uses one composer without Capture/Ask/Search mode selection.

Rationale:

Users should not classify intent before acting.

Consequences:

- The calm single-entry UI survives; its old question/capture routing is superseded.

References:

- `docs/UI_PROTOTYPE.md`

### D-20260709-Simplicity-First-Default-UI

Status: Accepted
Date: 2026-07-09

Decision:

Default UI hides implementation catalogs, boundaries, routing, and Agent internals unless
a user task needs them.

Rationale:

Minimize learning cost.

Consequences:

- Curated defaults and disclosure expose required discovery/manual fallback and one
  Global Default, not marketplaces, matrices, routing, boundary columns, or untested slots.

References:

- `AGENTS.md`
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

v0.1 exposes one Global Default; other routing needs stable Pi or a tested Pige service.

Rationale:

Visible settings that do not change Pi behavior are false controls.

Consequences:

- Future UI never becomes a per-task routing grid.

References:

- `AGENTS.md`
- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`

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

### D-20260718-Protected-Signed-Alpha-Publication

Status: Accepted
Date: 2026-07-18

Decision:

Public alpha publication requires an exact protected alpha tag push in the canonical
repository, `production-release` approval, signed/notarized/stapled macOS arm64,
Authenticode Windows x64, and independent verification of final artifacts and metadata.
Unsigned/ad-hoc builds remain internal-only.

Rationale:

Alpha installers carry the same update-supply-chain authority as later releases. Exact
identity and signed-byte verification keep publication fail closed and credentials external.

Consequences:

- Manual/unprotected/wrong-repository invocation, identity drift, missing authority or failed
  verification blocks publication; release setup actions are commit-pinned before secrets.
- The workflow alone proves no release. Credentials, execution, signed artifacts, notes,
  installed updates, platform breadth and acceptance evidence remain open with no status promotion.

References:

- `docs/RELEASE_ENGINEERING.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `.github/workflows/release.yml`
- `tests/unit/release-publication.test.ts`

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

Pige keeps distinct owner contracts, but Agents load only the three-file entry pack plus
the smallest routed task pack and relevant large-document sections.

Rationale:

Durable contracts need breadth; individual tasks need attention. Loading the full library
wastes context and mixes unrelated constraints.

Consequences:

- START_HERE alone owns task packs; the machine document map owns inventory/lifecycle;
  README stays a compact public orientation.
- AGENTS → README → START_HERE is the bounded entry order. Search and section reads are
  default; historical/research material is non-current.
- A new document needs a distinct owner that cannot fit an existing contract, plus map,
  routing, lifecycle, and capacity evidence.

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
Revised: 2026-07-12

Decision:

Pige uses a trash-first and operation-recorded lifecycle for durable vault data. Agent,
Skill, package, cleanup, reset, cancellation, and compaction flows must not permanently
delete durable Markdown/Dataset knowledge, source evidence, memory, conversations,
proposals, or operations. Internal indexes/caches, temp files, local models, and tool
assets can be reset through owners because they are not durable knowledge truth.

Rationale:

Pige is a local-first personal knowledge system. A broad "delete" or "cleanup" implementation could accidentally erase user-owned evidence or break future sync semantics. Durable data, source evidence, and auditability must survive ordinary maintenance and Agent autonomy.

Consequences:

- Data lifecycle behavior is governed by the matrix in `docs/DATA_ARCHITECTURE.md`.
- Durable deletes create operation records and tombstone metadata when sync-relevant.
- `.pige/trash/` is included in backups by default.
- Reset Local Database, Rebuild Index, tool/model removal, job compaction, diagnostics cleanup,
  and cancellation do not touch durable knowledge or source evidence. Recoverable trash uses
  Operations/Undo; permanent loss is an explicit exception.

References:

- `docs/DATA_ARCHITECTURE.md`
- `docs/SYNC_CONFLICT_AND_MIGRATION.md`
- `docs/JOB_OPERATION_AND_RECOVERY.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`

### D-20260709-Lightweight-Workspace-Monorepo

Status: Accepted
Date: 2026-07-09

Decision:

Pige uses a lightweight workspace monorepo: desktop runtime in `apps/desktop/`, reusable
runtime-neutral contracts/helpers in `packages/*`.

Rationale:

Shared contracts must not inherit Electron/renderer assumptions and block future clients.

Consequences:

- Desktop owns Electron/adapters; packages stay runtime-neutral and never import the app.
- Renderer cannot import privileged main/filesystem/database/shell/parser/model/secret code;
  workspace aliases and executable import boundaries enforce this split.

References:

- `docs/REPOSITORY_STRUCTURE.md`
- `docs/CODING_CONVENTIONS.md`
- `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`

### D-20260709-Dependencies-Need-Machine-Readable-Manifests

Status: Superseded
Date: 2026-07-09
Superseded by: D-20260709-Dependency-Manifests-Are-Schema-Governed

Decision:

Dependencies need both the human Technical Architecture registry and machine records.

Rationale:

This initial decision established dual ownership; the schema-governed replacement below
defines the complete current contract.

Consequences:

- Follow `D-20260709-Dependency-Manifests-Are-Schema-Governed`.

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

Independent error strings create inconsistent recovery, localization, redaction, and
diagnostic correlation. One typed taxonomy keeps failure UX predictable.

Consequences:

- Stable namespaced codes contain no private content. Shared schemas own code/domain,
  message key, retryability, severity, action, warnings, and redacted diagnostics.
- Renderer derives localized affordances from structure; tests enforce redaction and
  cross-surface consistency.

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

- Release fixtures are manifest-backed; generated reports use the owner-defined
  `artifacts/` layout, remain redacted, and are validated before release suites.

References:

- `docs/REPOSITORY_STRUCTURE.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`
- `docs/RELEASE_ENGINEERING.md`
- `docs/SPEC_TRACEABILITY.md`

### D-20260709-Dependency-Manifests-Are-Schema-Governed

Status: Accepted
Date: 2026-07-09
Supersedes: D-20260709-Dependencies-Need-Machine-Readable-Manifests

Decision:

Pige's external dependency registry remains human-readable in Technical Architecture, but implementation dependencies must also be represented by schema-valid machine-readable records under `resources/dependency-manifest/`. Temporary dependency exceptions live in a separate waiver manifest and expire.

Rationale:

Pige depends on a broad supply chain: Electron, React, TypeScript, Pi Agent/AI, local parser/OCR tools, optional model downloads, bundled runtimes, GitHub Actions, signing/update tooling, and security scanners. Future AI agents need a strict path for adding or updating dependencies without hiding licensing, checksum, data-boundary, or packaging risk.

Consequences:

- Schema, approved records, and expiring waivers have separate machine owners. Expired or
  unsafe-provenance/license/download/secret/renderer/integrity exceptions block release.

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

- The setup pack is intentionally broader than feature packs but still uses section reads;
  workspace, manifest, fixture, evidence, and CI changes revisit the same owners.

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

### D-20260709-Phase-1-Provider-And-Settings-Registry

Status: Accepted
Date: 2026-07-09
Revised: 2026-07-10

Decision:

Provider/model metadata is local, keys encrypted, IPC redacted, one default drives Pi,
and Settings Registry classifies visible state.

Rationale:

Readiness needs a resolvable binding without leaking keys or upstream complexity.

Consequences:

- Files hold metadata, conditional secret refs, inventory, and default; secret blobs never
  enter renderer, vault, SQLite, logs, or backups.
- `ready` needs active vault plus usable default; policy and Registry metadata stay redacted.

References:

- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`
- `docs/SETTINGS_AND_PREFERENCES.md`

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
Superseded by: D-20260712-General-Purpose-Agent-Unified-Ingress

Decision:

The first Home bridge routes question-like text to local lexical retrieval.

Rationale:

It proved local evidence retrieval before unified Pi ingress existed.

Consequences:

- Bounded lexical/CJK evidence remains valid; its Host intent split is superseded.

References:

- `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`

### D-20260710-Home-Context-Pack-And-Local-Evidence-Summary

Status: Superseded
Date: 2026-07-10
Revised: 2026-07-12
Superseded by: D-20260712-General-Purpose-Agent-Unified-Ingress

Decision:

The first Home foundation routes question-like text through one bounded search and fixed
no-evidence result.

Rationale:

It proved bounded local evidence and egress before unified Agent ingress existed.

Consequences:

- Its evidence/privacy boundaries remain; mandatory retrieval and fixed insufficiency do not.

References:

- `docs/API_AND_IPC_DESIGN.md`
- `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/UI_PROTOTYPE.md`

### D-20260709-Provider-Setup-Tests-Before-Save

Status: Superseded
Date: 2026-07-09
Superseded by: D-20260712-Preset-First-Provider-And-Unified-Model-Inventory

Decision:

Provider setup tests credentials and model listing before persistence.

Rationale:

Invalid credentials must not create a false-ready runtime.

Consequences:

- Its fail-before-save and redacted-secret boundary survives in the replacement.

References:

- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`

### D-20260712-Preset-First-Provider-And-Unified-Model-Inventory

Status: Accepted
Date: 2026-07-12
Revised: 2026-07-17
Supersedes: D-20260709-Provider-Setup-Tests-Before-Save

Decision:

Provider setup is preset-first with one inventory/default. Credential replacement/deletion
are confirmed, revision/reference-fenced, secret-safe, and recoverable; discovery and
generation status stay distinct.

Rationale:

Users choose services/models, not overlapping protocol fields, duplicate lists, or raw defaults.

Consequences:

- Connect discovers and probes before all-or-restore commit; exact Provider + Model ID
  merges records while Refresh/failure preserves choices and exposes typed repair.
- Manual ID is fallback; boundary taxonomy stays internal; DeepSeek real BYOK—not
  synthetic-only evidence—is the first acceptance.

References:

- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`
- `docs/SETTINGS_AND_PREFERENCES.md`
- `docs/API_AND_IPC_DESIGN.md`

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

Local Database derives links/backlinks/relations from explicit Markdown wiki, local `.md`,
and `#wiki:` links; `library.related` exposes resolved body-free page summaries.

Rationale:

Markdown stays durable truth while rebuildable SQLite makes related navigation fast.

Consequences:

- Library deduplicates repeated targets; unresolved targets grant no file access.
- Renderer uses stable IDs/summaries only; Knowledge Tree may reuse the graph foundation.

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

Reader shows `library.related` outgoing/backlinks as a safe context rail over resolved
summaries, never a filesystem browser or graph editor.

Rationale:

Related reading should reuse knowledge without adding a graph-management mode.

Consequences:

- Library/Home share Reader; wide layout places context beside prose and narrow stacks it.
- Rows open stable page IDs without paths/bodies/prompts. Agent, edit/reveal, and Tree
  visualization are separate contracts.

References:

- `docs/API_AND_IPC_DESIGN.md`
- `docs/UI_PROTOTYPE.md`
- `docs/TECH_ARCHITECTURE.md`

### D-20260710-Url-Capture-Uses-Untrusted-Snapshot-And-Extracted-Text

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-19

Decision:

Source Fetch stores bounded HTTP(S) snapshots as untrusted evidence and separate readable
text used by pages/Pi. `text/markdown` is inert.

Rationale:

Evidence/text separation contains active content. System DNS proxies may map public hosts to
benchmark Fake-IP, requiring narrow compatibility without trusting benchmark space.

Consequences:

- Renderer never fetches; security/parser own transport, bounds, redaction, and inert content.
- Under `public_only`, canonicalized blocked hostnames/redirects and fresh `example.com`
  probes each require `198.18/15` IPv4 and only strict Fake-IP forms; connect only to target
  IPv4. Literal, mixed, IPv6-only, unconfirmed, localhost, and private targets block.
- Readability stays bounded; browser execution and all statuses remain unchanged.

References:

- `docs/API_AND_IPC_DESIGN.md`
- `docs/PARSER_INGEST_SPEC.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/TECH_ARCHITECTURE.md`

### D-20260710-Bounded-Readability-Web-Extractor

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-12

Decision:

Pige uses exact `@mozilla/readability` `0.6.0` plus jsdom `29.1.1` in a separately built, serial, bounded web-extractor worker. Main-process URL transport uses the exact reviewed Undici pin owned by `D-20260711-Undici-8-7-Transport-Pin`; after DNS policy validation, each request dispatcher can resolve only to the already approved address set. The response deadline covers body consumption, and the decompressed body, redirects, worker input/elements/output/images, heap, and extraction time are bounded. Source Fetch Service persists decoded snapshots and plain extracted text; it never renders Readability HTML. Browser-rendered page execution is not a v0.1 fallback.

Rationale:

Readability's supported Node path needs a DOM implementation, while jsdom gives higher compatibility than an approximate DOM adapter. Running both outside the main event loop contains parser memory and CPU risk. Using an explicit Undici dispatcher closes the DNS validation-to-connection gap that a separate lookup plus global fetch would leave. Preserving the fetched snapshot and a reduced DOM-less fallback keeps capture useful when extraction fails without hiding lower evidence quality. The 2026-07-11 revision moves the evolving transport pin into its own decision without changing this extractor architecture.

Consequences:

- Scripts/subresources stay disabled; every production connection and redirect uses a
  newly validated address-pinned dispatcher.
- Parser, body, redirect, queue, heap, time, element, output, and image limits are owned
  by the Parser, Security, and Performance contracts rather than repeated here.
- Source Records keep bounded extraction identity/quality metadata; conversations stay
  reference-only, and reduced evidence causes Agent warning/replan/abstention.

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
Revised: 2026-07-14
Supersedes: D-20260709-Phase-1-Window-And-Backup-Entry-Points

Decision:

Window layout preferences remain machine-local and are owned by Window Mode Service. Backup and restore controls must reflect real Backup Service capability rather than a fixed phase placeholder; the current local ZIP, explicit restore identity, and durable recovery path is governed by `D-20260714-Explicit-Restore-Identity-And-Durable-Recovery`.

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
- `D-20260714-Explicit-Restore-Identity-And-Durable-Recovery`

### D-20260710-Basic-Local-Zip-Backup-And-Safe-Restore

Status: Superseded
Date: 2026-07-10
Revised: 2026-07-10
Superseded by: D-20260714-Explicit-Restore-Identity-And-Durable-Recovery

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

### D-20260714-Explicit-Restore-Identity-And-Durable-Recovery

Status: Accepted
Date: 2026-07-14
Supersedes: D-20260710-Basic-Local-Zip-Backup-And-Safe-Restore

Decision:

Pige keeps local `.pige-backup.zip` as the portable backup form and makes restore identity
explicit. `clone_as_new` mints a vault identity and lineage. `replace_existing` preserves
the logical vault identity but never overwrites the old folder in place: after explicit
confirmation it pauses mutable work, creates and validates a rollback backup, restores to
a fresh destination, then CAS-switches the machine-local binding. Restore coordination is
a machine-local durable Job linked bidirectionally to one vault-scoped
`restore_applied` Operation.

Rationale:

A restore may start before any vault exists, so assigning its coordinator Job to staging
or a destination vault would create false ownership and break crash recovery. Explicit
identity modes prevent two registered paths from sharing one vault identity. Fresh-folder
publication plus a verified rollback backup preserves user bytes while still allowing
same-vault recovery. A deterministic `derived_legacy` lineage ID keeps readable format-v1
archives idempotent without rewriting history.

Consequences:

- Preview and apply bind exact archive bytes, sender generation, explicit mode, owned
  destination, and one apply lease; renderer never receives raw archive paths or entries.
- The machine-local Restore Job exists before extraction, survives restart, and is never
  copied into staging or the restored vault. Its stable IDs link to `restore_applied`.
- `replace_existing` retains the old physical folder unregistered; a failed binding CAS
  leaves the old binding authoritative and the new destination unregistered.
- Missing legacy `backupId` derives only a marked lineage identity from the canonical
  archive digest and exact `createdAt`; new backups always publish a real ID.
- General cross-file transactions, final filesystem-syscall TOCTOU, permanent cleanup of
  old source folders, versioned dependency/domain migration matrices, and signed
  installed-platform proof remain outside this decision's delivered evidence.

References:

- `docs/DATA_ARCHITECTURE.md`
- `docs/JOB_OPERATION_AND_RECOVERY.md`
- `docs/API_AND_IPC_DESIGN.md`
- `docs/SETTINGS_AND_PREFERENCES.md`
- `docs/SYNC_CONFLICT_AND_MIGRATION.md`
- `docs/PERFORMANCE_AND_RELIABILITY.md`
- `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`

### D-20260710-Pdfjs-Worker-For-Embedded-Pdf-Text

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-12

Decision:

Pige uses exact `pdfjs-dist` `6.1.200` in a separately built bounded Node worker for v0.1 embedded PDF text, metadata, and page locators. It pins `@napi-rs/canvas` `1.0.2` explicitly because PDF.js 6's Node entry requires its `DOMMatrix`/`Path2D` runtime primitives even when Pige does not render pages. Main-process Parser Service owns deterministic artifact writes, Source Record updates, and source-page refresh. This decision does not select a PDF page-rendering adapter for OCR.

Rationale:

PDF.js is Apache-2.0, works with Pige's Node 24 baseline, avoids a hidden task-time binary download, and provides a stable local extraction API. Making the canvas runtime explicit prevents packaged builds from depending on optional-dependency luck. Keeping PDF.js outside the Electron main thread protects UI responsiveness, while the adapter boundary leaves room to replace extraction or add a reviewed renderer later.

Consequences:

- Pi receives a bounded PDF inspect/extract tool; Host owns preservation, deterministic
  Artifacts/Operations, sidecars, source-page conflict fencing, and recovery.
- The worker receives one verified disposable input, has no vault-write authority, and
  obeys the Parser/Performance limits.
- Quality, locators, warnings, and OCR candidates guide Pi; truncation or dependency wait
  cannot silently become high-confidence publication.
- Release evidence must prove the worker and native canvas runtime on supported packages.

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

Pige uses exact Mammoth `1.12.0` for semantic DOCX conversion and a Pige-owned PPTX/OpenXML adapter built from exact yauzl `3.4.0` plus fast-xml-parser `5.10.1`. Both formats run in one separately built bounded Office worker behind `DocumentParserService`. JSZip remains transitive through Mammoth only. Pige does not add officeparser, pptxtojson, node-pptx-parser, LibreOffice, or task-time parser downloads for this v0.1 slice.

Rationale:

Mammoth provides the required DOCX headings, lists, tables, links, and image references without native binaries. PPTX requires relationship-driven slide order, speaker notes, media references, and strict archive/XML controls that are clearer and smaller in a focused Pige adapter. Reusing yauzl avoids a second Pige-owned ZIP abstraction. The rejected high-level Office alternatives either pull in unrelated PDF/OCR/native canvas or large WASM dependencies, use whole-archive memory models, expose unstable Node APIs, or omit required notes/media/order semantics.

Consequences:

- The bounded Office worker receives one verified disposable input and no vault-write
  authority; main-process Parser Service owns deterministic Artifacts and recovery.
- DOCX external/style execution stays disabled. PPTX archive, relationship, compression,
  XML, path, and external-target rules fail closed under the Parser/Security limits.
- Pi receives quality, media/OCR candidates, refs, warnings, and locators and chooses the
  next tool or dependency wait; Jobs never invent a fixed continuation.
- Updates repeat semantic-format, hostile-input, packaging, integrity, and recovery gates.

References:

- `docs/PARSER_INGEST_SPEC.md`
- `docs/PERFORMANCE_AND_RELIABILITY.md`
- `docs/RELEASE_ENGINEERING.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/TECH_ARCHITECTURE.md`

### D-20260710-MacOS-Vision-Direct-Image-OCR

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-12

Decision:

Pige uses an app-owned, schema-versioned Swift helper for direct raster-image OCR on macOS 26+. The helper tries Apple Vision `RecognizeDocumentsRequest` revision 1 and falls back to accurate `RecognizeTextRequest` revision 3. It runs as a bounded child process behind `OcrPort`; main-process services own source validation, deterministic Artifact writes, Source Page refresh, Job state, Operation Records, and the typed OCR tool-result boundary returned to Pi Agent.

Rationale:

The macOS 26 Vision API provides high-quality local recognition without a model download or cloud OCR boundary. A small app-owned helper keeps Vision and image decoding outside the renderer and Electron main event loop while preserving a stable TypeScript capability adapter and replaceable engine boundary.

Consequences:

- The helper uses a bounded typed protocol, sanitized environment, no shell/network, and
  no task-time download; runtime verifies its manifest and checksum.
- Only reviewed pixel Artifacts enter OCR. Derived text/metadata remain checksummed and
  rebuildable, with source integrity checked around recognition.
- Empty, low-confidence, truncated, stale, or invalid results replan/warn/abstain rather
  than manufacture knowledge.
- Release proves compiled, signed, packaged helper recognition per supported target;
  Windows/Paddle remain separate adapters behind the same boundary.

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

- Owners cannot define alternate numbered plans. Builds map to Exits; Requirements map
  once to Phase/Milestone, verification, acceptance, and evidence/planned target.
- Historical/research material cannot own current implementation evidence; stable P/M
  labels change only through the canonical owners.

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

- Quality/leanness manifests own dimensions, weights, thresholds, inventories, projections,
  and budgets; verification writes only generated reports under `artifacts/`.
- Critical routing/data/contract/trace gaps cap the affected score. Documentation health
  never promotes planned product acceptance.

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

- Coverage updates with PRD P0; each Requirement maps once to Phase/Milestone and
  controlled Builds/Exits. Incomplete acceptance prevents phase completion.
- Partial rows own structured destinations; verified executable evidence names and runs
  exact selectors. Recipe-backed reports stay under `artifacts/`; history proves no code.
- Five independent trace gates and mutations prevent aggregate/self-scoring promotion.

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

- Both strategies share verified parser/OCR/Agent behavior; missing/drifted/escaping inputs
  fail closed and operational paths never enter Markdown/renderer output.
- External adapters receive private checksum-bound disposable inputs; existing records
  remain valid when defaults change.

References:

- `docs/SOURCE_STORAGE_STRATEGY.md`
- `docs/PARSER_INGEST_SPEC.md`
- `docs/API_AND_IPC_DESIGN.md`
- `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`
- `packages/schemas/src/index.ts`
- `apps/desktop/src/main/services/source-file-access.ts`

### D-20260710-Strict-Durable-Records-And-Egress-Identity

Status: Superseded
Date: 2026-07-10
Revised: 2026-07-10
Superseded by: D-20260722-Personal-Agent-Architecture-Reset

Decision:

Schema-v1 Job and Operation records fail closed on undeclared root fields; source-file locator selection follows the declared storage strategy; built-in Provider profiles require their canonical boundary proof; and each model-egress audit binds typed payload, bounded prompt metadata, Provider/Model routing identity, evidence summary, and final-decision digests into its operation identity. Documentation contract gates execute the relevant tests, and critical Accepted decisions carry machine-checked owner/code/test anchors.

Rationale:

String markers and test-title checks can stay green while an executable schema accepts contradictory or sensitive fields. Likewise, an idempotent audit keyed only by Job, Source, and policy can conceal changed selected evidence. These are contract-boundary failures even when the full test suite is otherwise green.

Consequences:

- Strict schemas reject undeclared durable fields, contradictory source locators, and
  unverified built-in provider boundaries.
- Body-free egress audits bind payload, prompt metadata, destination/model, evidence,
  classification, and decision identity; only an equivalent retry reuses one.
- Contract gates execute shared schema/service tests and semantic anchors without changing
  stable planning IDs or phase ownership.

References:

- `docs/JOB_OPERATION_AND_RECOVERY.md`
- `docs/SOURCE_STORAGE_STRATEGY.md`
- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`
- `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`
- `packages/schemas/src/index.ts`

### D-20260710-Semantic-Traceability-Lock-And-Executable-Evidence

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-10

Decision:

The acceptance manifest uses schema version 3 with normalized `capabilities`,
`requirements`, `exits`, evidence, and phase-state owners. The semantic-claims lock uses schema version 3
with one compact base64url SHA-256 digest per canonical claim instead of
full preimages. Together they bind PRD text, Requirement/capability delivery, Build/Exit/
Deferred text, Phase state, evidence, acceptance, and open destinations. The lock changes
only after explicit semantic review.

Rationale:

Cross-linked mapping tables can remain structurally green when related Requirement, capability, Build, Exit, evidence, or open-gap values are exchanged together. Existing files can also be relabeled as tests without proving anything. An independently reviewed source-text/selector lock and actual execution of verified test/verifier evidence make those coordinated false positives observable while keeping ordinary implementation work on the existing roadmap.

Consequences:

- Spec owns Requirement identity and assignment; acceptance alone owns current status,
  exact evidence/planned targets, structured open work, and controlled destinations.
- Verified executable evidence is path-constrained and run; recipe-backed reports retain
  recipe-hash validation.
- Missing, extra, altered, or coordinated semantic claims fail per Claim ID until an
  explicit reviewed lock update; format migration cannot silently change claim meaning.

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
Revised: 2026-07-12

Decision:

Pige v0.1 uses a separate, explicit `pdfjs-dist 6.1.200` plus `@napi-rs/canvas 1.0.2` worker adapter to materialize only parser-verified PDF OCR candidate pages as bounded PNG Artifacts. Automatic document OCR accepts fully inspected image-only or mixed-text PDFs whose complete ordered candidate set contains at most 20 pages. Image-only targets cover every page; mixed targets render only sparse candidates and retain native evidence as an independent Artifact.

Rationale:

PDF page locators already identify an exact rasterization target, and both runtime packages are pinned and bundled for the existing PDF parser. Making rasterization a named port, worker, manifest, and protocol closes the gap between locator metadata and real pixels without introducing a task-time binary download or pretending PDF.js is an OCR engine. The later Multi-Artifact Evidence Assembly decision removed the original single-body limitation, so sparse-page OCR can now enrich rather than replace native text.

Consequences:

- The worker has no network/vault authority and obeys independent source, page, pixel,
  encoded-output, aggregate, heap, time, response, and symlink limits.
- Main owns deterministic render/OCR Artifacts, manifests, Source Record rereads, and
  separate idempotent Operations; complete output reuses, incomplete output stays typed.
- Pi chooses bounded enrichment; empty/unavailable OCR preserves native evidence and
  triggers policy-aware wait, warning, replan, or abstention.
- Packaging and replacement evidence remain owned by Release/Performance and acceptance.

References:

- `docs/PARSER_INGEST_SPEC.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/PERFORMANCE_AND_RELIABILITY.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/RELEASE_ENGINEERING.md`
- `resources/parser-manifests/pdf-page-materializer.manifest.json`

### D-20260710-Multi-Artifact-Evidence-And-Claim-Citations

Status: Accepted
Date: 2026-07-10
Revised: 2026-07-12

Decision:

Pige v0.1 assembles tool-selected evidence in a main-process, call-scoped `EvidencePack` instead of selecting one preferred Artifact or persisting a merged body. Every eligible extracted-text/OCR Artifact is verified and paired only with its own metadata sidecar by Source ID, sidecar Artifact ID, sidecar kind, and body checksum. Pi Agent receives the bounded pack through the registered evidence tool and produces summary and key-point statements as `{ text, evidenceRefs }`, where refs are ephemeral ordered `ev_NN` values supplied by Pige. Pige alone resolves valid refs into canonical Markdown citations through a validated publication tool call.

Rationale:

Choosing the first OCR/text Artifact or the first metadata sidecar loses native evidence, misattributes locators, and cannot safely support mixed PDF/Office inputs. Parallel claim and citation arrays can also drift by index. A bounded in-memory catalog keeps durable bodies independent, preserves provenance, gives each claim an explicit support set, and allows deterministic rejection and evaluation without duplicating source content.

Consequences:

- Native-first packs reserve bounded supplemental OCR capacity; sidecar/body identity,
  locators, collisions, truncation, and quality warnings remain deterministic.
- Unknown/empty refs cannot authorize publication. Pige strips model citation syntax and
  renders canonical citations only from validated ephemeral refs.
- Model Egress binds the ordered redacted selection, prompt metadata, and non-secret
  destination/model identities before prompt rendering or credential lookup.
- Exact pack limits, multilingual/evidence fixtures, and remaining acceptance gaps live
  in the Context, Prompt, Quality, and acceptance owners.

References:

- `docs/PROMPT_DESIGN.md`
- `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`
- `docs/MARKDOWN_SCHEMA.md`
- `docs/PARSER_INGEST_SPEC.md`

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
Revised: 2026-07-16

Decision:

Host provides capability, authority and reliability; Pi decides semantic work; Host
shadow loops and fixed semantic chains are forbidden.

Rationale:

Duplicated planning narrows the Agent and splits recovery ownership.

Consequences:

- H1-H4 align Pi, converge Host orchestrators, and require responsibility deltas without
  compression targets or status promotion.

References:

- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`

### D-20260712-General-Purpose-Agent-Unified-Ingress

Status: Accepted
Date: 2026-07-12
Revised: 2026-07-12
Supersedes: D-20260709-Home-Composer-Unified-Entry, D-20260709-Phase-2-3-Home-Lexical-Retrieval, D-20260710-Home-Context-Pack-And-Local-Evidence-Summary

Decision:

Pige is a general-purpose personal Agent enhanced by local knowledge. Every semantic
Home turn enters Pi after any required evidence preservation. Pi may answer directly or
select retrieval/source/action tools; Host heuristics and fixed workflows cannot choose
intent. Local evidence is preferred when relevant, not required for every answer.

Rationale:

Knowledge capture is Pige's differentiator, not its product limit. Separate query,
capture, and format routes duplicate Pi planning and block ordinary conversation.

Consequences:

- Host owns preservation, policy, permission, egress, bounds, durability, validation,
  exceptional intervention, and commits; it never substitutes a semantic step.
- The versioned target uses one `agent.submitTurn` and durable `agent_turn`; no model
  waits/resumes the same turn instead of silent capture, retrieval, or local fallback.
- Provider profiles gain explicit protocol, pre-save Pi probe, tri-state binding, and
  safe staged commit; legacy kinds map without silent Responses reinterpretation.
- Exact-tail binding makes one client turn own one event/`agent_turn`; retry/restart
  adopts it. Signed packaged direct/retrieved/file/URL/follow-up proof still gates E3.09.

References:

- `docs/PRD.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`
- `docs/JOB_OPERATION_AND_RECOVERY.md`
- `docs/UI_PROTOTYPE.md`

### D-20260711-Pi-Compat-Containment-Exception

Status: Accepted
Date: 2026-07-11

Decision:

Pige may temporarily adopt exact official Pi core/AI packages despite the
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
Revised: 2026-07-17

Decision:

Settings Connect/Save authorizes routine selected context for that exact Profile/endpoint
without another native dialog. Sensitive confirms, restricted blocks, and drift reconnects.

Rationale:

Local ownership and no telemetry define local-first; repeated BYOK prompts add friction.

Consequences:

- Trust grants no other authority or whole-vault/proxy send; `ordinary_allowed` stays
  quiet. Credential replacement and Provider deletion remain native-confirmed.

References:

- `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`
- `PRIVACY.md`

### D-20260712-Autonomous-By-Default

Status: Accepted
Date: 2026-07-12

Decision:

**Input once. Knowledge grows naturally.** Validated, attributable, recoverable Pige-owned
knowledge work auto-applies with Operation/Undo. Intervene only for irreversible loss,
authority/security escalation, destination drift, unreconcilable conflict, or an explicit
stricter user policy. Uncertainty
replans, preserves alternatives, warns, or abstains.

Rationale:

Local-first owns data, not friction; prompt-first UX makes users supervise delegated work.

Consequences:

- Pi decides semantics; Host validates provenance, policy, concurrency, recovery, and commit.
- Standing-authority active-vault knowledge Markdown needs no Permission prompt; Pi core,
  extension, package, or local-tool actions outside that scope stay brokered. Exact BYOK
  destinations retain their separate standing egress authority.
- Exact create, cited append, bounded tags, and one directed link have Activity/Undo; proposals stay transitional, other mutations open.
- Home uses quiet Activity/details/Undo, not routine confirmation cards.

References:

- `docs/PRD.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/JOB_OPERATION_AND_RECOVERY.md`
- `docs/KNOWLEDGE_MODEL_AND_LINKING.md`
- `docs/UI_PROTOTYPE.md`

### D-20260713-Safe-Home-Draft-Replacement

Status: Superseded
Date: 2026-07-13
Superseded by: D-20260722-Pi-Agent-Pass-Through

Decision:

Home streams model-backed progress as bounded `draft_replace` snapshots from the exact
terminal Pige answer boundary. It prefers parsed incremental `answer` arguments; when a
provider supplies them too late, successful terminal validation may authorize one
tool-blocked presentation turn that can emit only prefixes of that exact answer and must
finish equal. Drafts are temporary and sender/turn/Job-bound; the fully validated durable
assistant result remains authoritative.

Rationale:

Waiting for the complete tool result makes normal conversation feel stalled, but raw Pi
text/tool deltas expose unvalidated JSON, provider behavior, citations, or control data.
Replacement snapshots support provider repair/backtracking without persisting untrusted
partial output. The exact post-validation presentation phase keeps completion-only tool
protocols responsive without granting ambient assistant text or another semantic answer.

Consequences:

- No thinking, generic Pi prose, raw provider event, tool JSON, citation, grounding,
  identifier, credential, or restricted/control content reaches renderer as a draft.
- The fallback blocks further tools, rejects altered/incomplete reproduction, may use one
  additional provider turn, and fails closed when a long answer cannot produce multiple
  usable replacements.
- Sequence/binding/bounds, escaping, coalescing, cancellation, and wrong-sender rejection
  are typed and tested; replacement may shorten earlier text.
- Final schema/evidence/source/citation validation and durable conversation/Job commit are
  unchanged. Final replaces the draft; failure/cancel clears it; restart replays none.

References:

- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`
- `docs/API_AND_IPC_DESIGN.md`
- `docs/UI_PROTOTYPE.md`
- `docs/PERFORMANCE_AND_RELIABILITY.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`

### D-20260714-Pi-Autonomous-Completion

Status: Superseded
Date: 2026-07-14
Revised: 2026-07-17
Superseded by: D-20260722-Pi-Agent-Pass-Through

Decision:

One user submission owns one durable Pi Agent Job and an outcome, not one model-output or
terminal-tool attempt. Recoverable schema, citation, grounding, evidence, and tool-input
rejection returns bounded typed feedback to upstream Pi. Pi remains free to correct,
retrieve, inspect, revisit authorized tools, narrow, or abstain until one result is
accepted. Host services enforce authority, security, egress, evidence truth, resource
bounds, idempotent effects, and durable commit; they do not impose a one-correction
semantic script or surface the first rejected candidate as a user retry.

Home drafts come from a reviewed Pi-owned answer channel and remain temporary. Pige does
not make a second provider call solely to force exact answer reproduction for streaming.
Only an accepted final becomes durable; cancellation or a real external boundary may stop
the Job.

Rationale:

Pi Agent already owns tool selection, continuation, and replanning. Treating validation as
a terminal exception turns it into a fragile one-shot structured-output API and makes the
user supervise model compliance. Typed feedback preserves Host truth and safety while
letting stronger present and future models improve completion without redesigning the
interaction.

Consequences:

- Pige is the local product shell and capability/commit layer around Pi. Submission
  creates one Agent Job immediately; source preservation is its first checkpoint, not a
  separate semantic pipeline. Pi authors Markdown through scoped write tools, while the
  Host only validates authority/schema/conflict and performs atomic commit/recovery.
- After any tool, terminal tools remain validation boundaries. A no-current-note Home
  `auto` turn may accept one native assistant final only when Pi invoked zero tools.
- The relevant Pige core tool catalog follows capability and authority, not Host intent.
  Read-only/idempotent tools may be revisited; side effects remain sequential,
  deterministic, revalidated, and idempotent.
- Progress-aware wall-time/work/byte/non-progress limits protect cost and reliability but
  do not encode an arbitrary semantic route. Internal correction remains `running` and
  creates no durable assistant result, proposal, Job output, or Operation.
- Denied authority, restricted egress, cancellation, unavailable required capability,
  and irreconcilable conflict/drift remain hard boundaries. They cannot be converted into
  repair permission.
- Persistent provider/tool-protocol incompatibility uses a distinct typed repair/change-
  model outcome; the generic first-attempt output-invalid retry is not normal UX.
- Thinking, raw provider events, prompts, tool JSON, secrets, paths, and source bodies do
  not enter drafts or repair feedback.

References:

- `docs/VISION.md`
- `docs/PRD.md`
- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`
- `docs/PROMPT_DESIGN.md`
- `docs/API_AND_IPC_DESIGN.md`
- `docs/JOB_OPERATION_AND_RECOVERY.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`

### D-20260716-H2-Unified-Agent-Ingress-And-Proposal-Containment

Status: Accepted
Date: 2026-07-16

Decision:

New semantics use `agent_turn`; current sources require `agent_turn | capture_only`, while
absent legacy fields normalize to `legacy_agent_ingest`. Pi chooses tools; Host validates.
New turns omit proposal staging and raw renderer review fails closed.

Rationale:

This preserves recovery without reviving Host orchestration or unsafe renderer authority.

Consequences:

- Pi owns evidence order; H3/H4 and statuses remain unchanged.

References:

- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`
- `docs/JOB_OPERATION_AND_RECOVERY.md`

### D-20260717-H3-Job-Execution-Coordinator-Core

Status: Accepted
Date: 2026-07-17

Decision:

One proof-checked coordinator owns migrated Jobs/Home lifecycle; raw proposals stay
Main-only.

Rationale:

One owner prevents conflicting durable transitions.

Consequences:

- H3b/H3c still migrate remaining loops and dispatch; statuses stay unchanged.

References:

- `docs/JOB_OPERATION_AND_RECOVERY.md`

### D-20260717-Main-Owned-Resident-Window-Layout

Status: Accepted
Date: 2026-07-17

Decision:

Renderer sends disclosure intent only; Main owns bounds, revision, expansion, and
presentation at `720/840/960/1240px`.

Rationale:

Native resizing needs one authority.

Consequences:

- Main preserves base, never remembers expansion, restores in either order, and overlays
  Agent first. Renderer consumes validated layout state; requests contain no geometry.

References:

- `docs/API_AND_IPC_DESIGN.md`

### D-20260717-Reader-Inline-Reference-Resolution

Status: Accepted
Date: 2026-07-17

Decision:

Reader links use one Main-owned contextual query. It returns one stable target or a body-free
failure; renderer uses only `target.pageId`.

Rationale:

Stable IDs enable links without renderer file access or target guessing.

Consequences:

- Main/Notes fence context; Local Database owns rebuildable keys and freshness. Source targets
  require durable page ownership; uncertainty fails closed. Statuses remain unchanged.

References:

- `docs/API_AND_IPC_DESIGN.md`

### D-20260717-Recent-Vault-Open-By-Stable-ID

Status: Accepted
Date: 2026-07-17

Decision:

Recent-vault actions submit only `vaultId`; main resolves and revalidates the binding. Display
paths are never authority and invalid bindings fail body-free.

Rationale:

Resume without renderer filesystem authority.

Consequences:

- Remove never deletes vault files; statuses remain unchanged.

References:

- `docs/API_AND_IPC_DESIGN.md`

### D-20260718-External-Mutation-Foundation

Status: Accepted
Date: 2026-07-18

Decision:

Freeze create-only authority without registering external mutation or shell.

Rationale:

Permission is not isolation.

Consequences:

- Paths stay local, Operations path-free, and production awaits helpers.

References:

- `docs/SECURITY_THREAT_MODEL.md`

### D-20260719-Permissioned-Private-Network-Targets

Status: Accepted
Date: 2026-07-19

Decision:

Exact `external_network` authority includes private targets; they otherwise block.

Rationale:

Network permission is destination authority, so a second veto is misleading.

Consequences:

- Fetch controls remain; invalid authority blocks; statuses do not change.

References:

- `docs/SECURITY_THREAT_MODEL.md`
- `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`

### D-20260719-Exact-Pi-Package-Install-Foundation

Status: Accepted
Date: 2026-07-19

Decision:

Current-turn permission may install one exact public npm Pi package/version as immutable
machine-local `installed_disabled` bytes.

Rationale:

Acquisition cannot imply execution or dependency selection.

Consequences:

- Require SHA-512, bounded link-free extraction, hook/dependency/native rejection, locking
  and stable adoption. Remaining lifecycle, Exit and Phase status stay open.

References:

- `docs/SKILL_EXTENSION_DESIGN.md`
- `docs/SECURITY_THREAT_MODEL.md`

### D-20260719-Machine-Local-Skill-Registry-Foundation

Status: Accepted
Date: 2026-07-19

Decision:

Use checksum-safe summaries and owner-token CAS. Invalid records lack authority; failures are
body-free. Only the Electron singleton recovers valid orphan locks.

Rationale:

Inventory can precede lifecycle.

Consequences:

- Backup excludes state; disable removes no files/grants; lifecycle stays open.

References:

- `docs/API_AND_IPC_DESIGN.md`
- `docs/SKILL_EXTENSION_DESIGN.md`
- `docs/TECH_ARCHITECTURE.md`

### D-20260719-OS-Agent-Capability-Is-Present-By-Default

Status: Superseded
Date: 2026-07-19
Superseded by: D-20260722-Personal-Agent-Architecture-Reset

Decision:

Pige is an OS-level Agent product. First-party filesystem, network, command, and package
capabilities are present in the Agent catalog rather than hidden behind capability-absence
messages. A submitted user task is one-use authority for ordinary desktop-local effects;
the Host performs one exact binding/audit and does not ask the user to confirm the same
intent again. Explicit YOLO remains useful for broader third-party grants, not as a
prerequisite for basic Pige capability. Destructive loss, credential disclosure, changed
trust boundaries, and source/model attempts to self-authorize remain distinct controls.

Rationale:

Permission should govern effects, not make basic Agent tools disappear or repeatedly ask
the user to restate an intent already expressed by submitting the task.

Consequences:

- Pige exposes one general first-party OS command tool with bounded execution mechanics.
- Ordinary first-party calls are audited without a duplicate prompt.
- Third-party, destructive, credential, and changed-boundary effects keep separate gates.

References:

- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/API_AND_IPC_DESIGN.md`

### D-20260722-Personal-Agent-Architecture-Reset

Status: Accepted
Date: 2026-07-22
Revised: 2026-07-22
Supersedes: D-20260709-Permissioned-External-Skills, D-20260709-Permission-Modes-And-YOLO, D-20260710-Strict-Durable-Records-And-Egress-Identity, D-20260714-Pi-Capability-And-Authority, D-20260719-OS-Agent-Capability-Is-Present-By-Default

Decision:

Pige is a personal local Agent with a minimal Host. Pi exclusively chooses semantic work;
Host supplies typed capabilities, closed high-risk authority, data reliability, and
recovery. One user submit authorizes ordinary registered first-party tools. Connected
Provider/model identity plus Send authorizes exact user-authored and selected bounded
context without Host content classification or rewriting. Per-tool Permission lifecycles,
saved grants/YOLO, model-egress policy/approval/audit state, and waiting approval Job
states are deleted rather than extended.

Governance and validation are risk-tiered. Ordinary development uses affected tests,
typecheck, and build; full trace/independent review/package belongs to architecture,
security, durable-data, migration, release, merge-candidate, and main nodes. macOS is the
foreground early platform; other platforms are explicitly qualified later.

Rationale:

The pre-alpha accumulated SaaS-style state, duplicate schemas, approval choreography,
Host semantic routing, brittle internal tests, and repeated documentation projections.
Those mechanisms slow a personal project, obscure Pi ownership, and introduce more
failure modes than the current v0.1 risks justify.

Consequences:

- AR1 removes approval/mode state; AR2 removes Host semantic pipelines; AR3 converges
  Job/schema/recovery ownership; AR4 removes legacy UI/tests and splits mixed owners.
- Existing unpublished approval data may be cleared or rejected; no long migration is
  promised for internal development state.
- Renderer/main isolation, secret storage, path confinement, source preservation,
  citation validation, CAS/idempotency/cancel/recovery, and Backup/Restore remain.
- Services above roughly 800-1000 lines trigger owner review. Deterministic single-owner
  cores may be justified; mixed coordinators must split/delete orchestration.
- Requirement, Exit, and Phase status is not promoted by this contract reset.

References:

- `AGENTS.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/QUALITY_AND_TEST_STRATEGY.md`
- `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`
- `resources/architecture-reset.manifest.json`

### D-20260722-Pi-Agent-Pass-Through

Status: Accepted
Date: 2026-07-22
Supersedes: D-20260713-Safe-Home-Draft-Replacement, D-20260714-Pi-Autonomous-Completion

Decision:

Every production Pi entry uses one pass-through turn contract. Attachment plus query is
one turn; attachment without text supplies only the minimal user intent to organize the
files. Pi owns tool choice/order, semantic route, response body, and completion. Its final
assistant message is authoritative without a Pige terminal tool, grounding/citation
shape, answer schema, content classifier, or Host semantic repair follow-up.

Explicit Send to an exact connected Provider/model transmits the exact user-authored and
explicitly selected bounded context unchanged. Pige does not regex-classify, redact,
rewrite, or block the payload. Stored Provider credentials remain isolated in the secret
store/authentication layer and are never injected into content.

Host owns only atomic turn submission, Provider/model/credential transport, registered
tool schemas and resource limits, narrow high-risk effects, durable identity/recovery,
typed capability execution, mutation commit, and safe renderer projection. Tool/effect
owners still validate inputs, authority, revisions and commits. Unknown/stale citation
refs are omitted or marked unavailable without rejecting answer text.

Rationale:

Mandatory finish tools, output schemas, grounding/citation verdicts, content policy and
repair follow-ups make the Host a shadow Agent and discard valid model answers. They also
duplicate upstream Pi's lifecycle and make ordinary personal use brittle.

Consequences:

- PT1-PT4 remove completion policy, all Host terminal tools, semantic output errors,
  objective/mode dispatch, fixed ingest/source pipelines, egress content policy, legacy
  capture/retrieval routes, and dead UI copy in small reviewable PRs.
- Jobs may recover the same Pi turn and effects but cannot choose semantic work.
- Transport/protocol failures remain typed; tool and durable mutation boundaries remain
  strict. Safe DOM projection limits structure and size without judging answer semantics.
- Requirement, Exit, and Phase status is not promoted by this decision.

References:

- `AGENTS.md`
- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`
- `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`
- `docs/JOB_OPERATION_AND_RECOVERY.md`
- `resources/architecture-reset.manifest.json`

### D-20260723-Large-Paste-Agent-Turn-Boundary

Status: Accepted
Date: 2026-07-23

Decision:

Ordinary composer text is bounded at 8,000 Unicode code points. A paste that would exceed
that boundary is staged whole, without normalization or trim, in the same ordered list as
files. Staging is side-effect free. Explicit Send binds exact authored text and staged
items to one client turn and one parent Job; each accepted paste is preserved exactly once
as a managed source and conversation history stores references only. The canonical
limits and safe pending projection are owned by
`resources/large-paste-boundary.manifest.json`.

Rationale:

Textarea-only handling rejects valid large inputs at the IPC limit, while preserving at
picker time creates durable work before the user's intent is complete. One staged-item
contract preserves exact user input without reviving a Host capture pipeline.

Consequences:

- Files and large pastes share an eight-item ordered submission boundary; large pastes are
  bounded at 4 MiB each and 8 MiB aggregate UTF-8 per turn.
- Validation or preservation failure retains exact text, items, order and client-turn ID;
  retry adopts without duplicating source bytes, events or Jobs.
- Whole-window file drop remains an immediate separate turn and never consumes composer
  state. Pi decides all semantic work after preservation.
- `PIGE-CAP-002`, `E2.02`, and every Requirement/Exit/Phase status remain unchanged until
  executable integration evidence exists.

References:

- `docs/API_AND_IPC_DESIGN.md`
- `docs/DATA_ARCHITECTURE.md`
- `docs/UI_PROTOTYPE.md`
- `resources/large-paste-boundary.manifest.json`

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
