# Start Here For AI Agents

Status: Active documentation router
Last reviewed: 2026-07-10

## 1. Purpose

This is Pige's AI documentation router. Treat owner documents as the product contract; use the standard entry order `AGENTS.md`, `README.md`, then this file before opening task-specific sections.

## 2. Golden Rule

Simplicity first: Pige should feel like a quiet personal Agent, not an Agent console. Before changing code, identify the requirement, owning service, durable truth, safety boundary, verification, and affected owner documents; otherwise load more context.

## 3. Minimal First Read

Always read `AGENTS.md`, `README.md`, and this file. Then read only the matching row in section 7 and the owner/boundary sections it names. Before implementation use [AI Development Guide section 5](AI_DEVELOPMENT_GUIDE.md#5-context-pack-template); at handoff use [section 13](AI_DEVELOPMENT_GUIDE.md#13-handoff-note-template).

Every implementation slice also reads the relevant Phase section in `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md` and the matching `PIGE-*` rows in `docs/SPEC_TRACEABILITY.md`; search for the Phase, Build/Exit IDs, or requirement IDs instead of loading both control documents in full. For large owner documents such as `docs/PRD.md`, `docs/TECH_ARCHITECTURE.md`, and `docs/DATA_ARCHITECTURE.md`, prefer relevant sections found with `rg` over loading the entire file.

For broad product, architecture, data-ownership, or milestone planning, also read the relevant sections of Vision, PRD, Tech Architecture, Domain Model, Data Architecture, Decision Log, Spec Traceability, and the Playbook.

## 4. Document Authority And Conflict Rules

Authority follows subject:

- `AGENTS.md` owns repository rules and invariants.
- Owner contracts, including files labeled `Draft baseline`, define current intended behavior; `Draft` marks an evolving pre-alpha contract, not an inactive or historical file. The machine inventory names each owner role.
- The Playbook owns phase order/status/exit gates; Spec Traceability and its manifests map requirements and evidence without creating scope.
- The latest non-superseded Accepted decision records durable rationale, but its owner contract must agree.
- Code, schemas, fixtures, and tests prove implementation; historical/research artifacts prove only past rationale or review.

Prefer the exact subject owner over summaries. If active owners still conflict on user behavior, durable data, security, privacy, permissions, migration, or recovery, stop and ask; otherwise choose the conservative compatible detail and record it when durable.

## 5. Documentation Context Budget

- Search first; read one owner plus immediate safety/data boundaries. Historical/research material is optional.
- This file alone owns task packs; the machine inventory alone owns the complete file list and lifecycle metadata.
- Merge duplicated normative guidance into its owner. The inventory enforces the full-entry word budget.

### 5.1 Current State, History, And Active Development

[README Current Status](../README.md#current-status) is the public snapshot; the Playbook owns phase state; code/tests prove current behavior; owner contracts define intended behavior; latest non-superseded Accepted decisions explain durable choices; historical/research material stays non-current. Before changing a plan, check the active phase and use the [handoff template](AI_DEVELOPMENT_GUIDE.md#13-handoff-note-template) plus Playbook section 3.2. Interrupt unrelated work only for security, privacy, durable-data, migration, or incompatible-contract risk.

### 5.2 Lifecycle Disposition And Resource Reclamation

`resources/documentation-quality/document-map.manifest.json` owns tier, owner, read behavior, lifecycle disposition, review trigger, frequency, and reclamation action for every governed file. Run map/link checks on every change; quarterly and public-release reviews follow it.

## 6. Large Document Section Map

Use `rg -n "^## .*keyword" docs/<file>.md` and read only the matching owner section. Load an entire large document only for broad changes to its owned subject.

## 7. Task-Specific Reading Packs

Use the smallest complete pack for the work. The table lists task-specific owner and boundary documents; for implementation, add only the relevant Playbook Phase section and matching Spec Traceability rows required by section 3, not both control files in full.

| Task | Read these documents |
| --- | --- |
| Project setup, scaffold, CI | `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`, `docs/REPOSITORY_STRUCTURE.md`, `docs/CODING_CONVENTIONS.md`, `docs/TECH_ARCHITECTURE.md`, `docs/QUALITY_AND_TEST_STRATEGY.md`, `docs/RELEASE_ENGINEERING.md`, `docs/SPEC_TRACEABILITY.md` |
| First-run, onboarding, capture-only mode | `docs/ONBOARDING_AND_FIRST_RUN.md`, `docs/UI_PROTOTYPE.md`, `docs/DATA_ARCHITECTURE.md`, `docs/SETTINGS_AND_PREFERENCES.md`, `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md` |
| Desktop shell, windows, preload, IPC | `docs/TECH_ARCHITECTURE.md`, `docs/UI_PROTOTYPE.md`, `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md` |
| IPC/API contracts and renderer-preload-main boundaries | `docs/API_AND_IPC_DESIGN.md`, `docs/TECH_ARCHITECTURE.md`, `docs/SECURITY_THREAT_MODEL.md` |
| Settings, preferences, provider profiles, settings storage | `docs/SETTINGS_AND_PREFERENCES.md`, `docs/UI_PROTOTYPE.md`, `docs/DATA_ARCHITECTURE.md`, `docs/TECH_ARCHITECTURE.md`, `docs/SECURITY_THREAT_MODEL.md` |
| Vault layout, note storage settings, file writes, IDs | `docs/DATA_ARCHITECTURE.md`, `docs/SOURCE_STORAGE_STRATEGY.md`, `docs/MARKDOWN_SCHEMA.md`, `docs/DOMAIN_MODEL.md`, `docs/LOCAL_DATABASE_DESIGN.md`, `docs/UI_PROTOTYPE.md` |
| Markdown schema, frontmatter, citations, `PIGE.md` | `docs/MARKDOWN_SCHEMA.md`, `docs/DATA_ARCHITECTURE.md`, `docs/TECH_ARCHITECTURE.md`, `docs/SECURITY_THREAT_MODEL.md` |
| Tags, topics, entities, backlinks, Knowledge Tree, graph links | `docs/KNOWLEDGE_MODEL_AND_LINKING.md`, `docs/MARKDOWN_SCHEMA.md`, `docs/LOCAL_DATABASE_DESIGN.md`, `docs/UI_PROTOTYPE.md` |
| Source storage, original file references, managed copies | `docs/SOURCE_STORAGE_STRATEGY.md`, `docs/DATA_ARCHITECTURE.md`, `docs/SECURITY_THREAT_MODEL.md`, `docs/PERFORMANCE_AND_RELIABILITY.md` |
| Data lifecycle, trash, deletion, cleanup, compaction | `docs/DATA_ARCHITECTURE.md`, `docs/SYNC_CONFLICT_AND_MIGRATION.md`, `docs/JOB_OPERATION_AND_RECOVERY.md`, `docs/QUALITY_AND_TEST_STRATEGY.md` |
| Capture and ingest | `docs/PRD.md`, `docs/PARSER_INGEST_SPEC.md`, `docs/SOURCE_STORAGE_STRATEGY.md`, `docs/DATA_ARCHITECTURE.md`, `docs/PERFORMANCE_AND_RELIABILITY.md`, `docs/SPEC_TRACEABILITY.md` |
| Jobs, proposals, operations, retry, cancellation, crash recovery | `docs/JOB_OPERATION_AND_RECOVERY.md`, `docs/DATA_ARCHITECTURE.md`, `docs/PERFORMANCE_AND_RELIABILITY.md`, `docs/API_AND_IPC_DESIGN.md` |
| Error taxonomy, failure UX, retry/repair status | `docs/API_AND_IPC_DESIGN.md`, `docs/JOB_OPERATION_AND_RECOVERY.md`, `docs/DIAGNOSTICS_AND_OBSERVABILITY.md`, `docs/UI_PROTOTYPE.md`, `docs/I18N_DESIGN.md`, `docs/QUALITY_AND_TEST_STRATEGY.md` |
| Sync readiness, conflicts, external edits, schema versions, migrations | `docs/SYNC_CONFLICT_AND_MIGRATION.md`, `docs/DATA_ARCHITECTURE.md`, `docs/MARKDOWN_SCHEMA.md`, `docs/RELEASE_ENGINEERING.md` |
| URL fetch, web capture, SSRF | `docs/PRD.md`, `docs/PARSER_INGEST_SPEC.md`, `docs/TECH_ARCHITECTURE.md`, `docs/SECURITY_THREAT_MODEL.md` |
| PDF/DOCX/PPTX/image/OCR | `docs/PRD.md`, `docs/PARSER_INGEST_SPEC.md`, `docs/TECH_ARCHITECTURE.md`, `docs/PERFORMANCE_AND_RELIABILITY.md`, `docs/RELEASE_ENGINEERING.md`; for current implementation, read only the P5 section of `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md` and the matching P5 rows of `docs/SPEC_TRACEABILITY.md` |
| BYOK, providers, cloud model calls | `docs/PRD.md`, `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`, `docs/TECH_ARCHITECTURE.md`, `docs/SECURITY_THREAT_MODEL.md`, `docs/SETTINGS_AND_PREFERENCES.md` |
| Pi Agent runtime, provider/model profiles, model routing gates | `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`, `docs/TECH_ARCHITECTURE.md`, `docs/SECURITY_THREAT_MODEL.md`, `docs/PROMPT_DESIGN.md`, `docs/API_AND_IPC_DESIGN.md` |
| Local RAG, embeddings, chunks | `docs/PRD.md`, `docs/TECH_ARCHITECTURE.md`, `docs/PERFORMANCE_AND_RELIABILITY.md`, `docs/LOCAL_DATABASE_DESIGN.md` |
| Home query and retrieval UX | `docs/PRD.md`, `docs/UI_PROTOTYPE.md`, `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`, `docs/PERFORMANCE_AND_RELIABILITY.md`, `docs/SPEC_TRACEABILITY.md` |
| Note reader, Markdown rendering/editing | `docs/UI_PROTOTYPE.md`, `docs/I18N_DESIGN.md`, `docs/SECURITY_THREAT_MODEL.md` |
| Agent prompts and structured model outputs | `docs/PROMPT_DESIGN.md`, `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`, `docs/PRD.md`, `docs/TECH_ARCHITECTURE.md`, `docs/SECURITY_THREAT_MODEL.md`, `docs/MARKDOWN_SCHEMA.md` |
| Agent-affecting settings and runtime policy context | `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`, `docs/SETTINGS_AND_PREFERENCES.md`, `docs/PROMPT_DESIGN.md`, `docs/TECH_ARCHITECTURE.md`, `docs/SECURITY_THREAT_MODEL.md` |
| Context assembly, token budgets, citations, prompt context packing | `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`, `docs/PROMPT_DESIGN.md`, `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`, `docs/TECH_ARCHITECTURE.md`, `docs/PERFORMANCE_AND_RELIABILITY.md`, `docs/SECURITY_THREAT_MODEL.md` |
| Confirmation proposals and operations | `docs/PRD.md`, `docs/DOMAIN_MODEL.md`, `docs/DATA_ARCHITECTURE.md`, `docs/SECURITY_THREAT_MODEL.md` |
| Agent memory | `docs/AGENT_MEMORY_DESIGN.md`, `docs/DATA_ARCHITECTURE.md`, `docs/SECURITY_THREAT_MODEL.md` |
| Skills and Pi packages | `docs/SKILL_EXTENSION_DESIGN.md`, `docs/PI_PACKAGE_RESEARCH.md`, `docs/SECURITY_THREAT_MODEL.md`, `docs/DOMAIN_MODEL.md` |
| Permissions and YOLO mode | `docs/SECURITY_THREAT_MODEL.md`, `docs/TECH_ARCHITECTURE.md`, `docs/UI_PROTOTYPE.md`, `docs/DECISION_LOG.md` |
| Security report, vulnerability handling, private disclosure | `SECURITY.md`, `docs/SECURITY_THREAT_MODEL.md`, `docs/RELEASE_ENGINEERING.md`, `docs/DIAGNOSTICS_AND_OBSERVABILITY.md`, `docs/QUALITY_AND_TEST_STRATEGY.md` |
| Privacy, data use, telemetry, cloud-send policy | `PRIVACY.md`, `docs/PRD.md`, `docs/SECURITY_THREAT_MODEL.md`, `docs/DIAGNOSTICS_AND_OBSERVABILITY.md`, `docs/SETTINGS_AND_PREFERENCES.md`, `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md` |
| Support, public issue triage, redacted reproductions | `SUPPORT.md`, `docs/CONTRIBUTING_GUIDE.md`, `docs/DIAGNOSTICS_AND_OBSERVABILITY.md`, `docs/QUALITY_AND_TEST_STRATEGY.md`, `SECURITY.md`, `PRIVACY.md` |
| Public collaboration, code of conduct, issue/PR templates | `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SUPPORT.md`, `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/config.yml`, `docs/CONTRIBUTING_GUIDE.md` |
| Diagnostics, logs, support bundles, telemetry policy | `docs/DIAGNOSTICS_AND_OBSERVABILITY.md`, `docs/SECURITY_THREAT_MODEL.md`, `docs/PERFORMANCE_AND_RELIABILITY.md`, `docs/API_AND_IPC_DESIGN.md` |
| Future mobile/cloud runtime boundary | `docs/FUTURE_MOBILE_AND_CLOUD_ARCHITECTURE.md`, `docs/TECH_ARCHITECTURE.md`, `docs/DATA_ARCHITECTURE.md`, `docs/DECISION_LOG.md` |
| Backup, restore, migration | `docs/DATA_ARCHITECTURE.md`, `docs/RELEASE_ENGINEERING.md`, `docs/PERFORMANCE_AND_RELIABILITY.md` |
| Packaging, signing, update, dependency upgrades | `docs/RELEASE_ENGINEERING.md`, `docs/TECH_ARCHITECTURE.md`, `docs/REPOSITORY_STRUCTURE.md`, `docs/QUALITY_AND_TEST_STRATEGY.md`, `docs/SECURITY_THREAT_MODEL.md` |
| I18N and accessibility | `docs/I18N_DESIGN.md`, `docs/UI_PROTOTYPE.md`, `docs/QUALITY_AND_TEST_STRATEGY.md` |
| Tests, fixtures, requirement evidence, and release acceptance | `docs/QUALITY_AND_TEST_STRATEGY.md`, `docs/SPEC_TRACEABILITY.md`, the matching phase in `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`, `resources/traceability/p0-coverage.manifest.json`, `resources/traceability/acceptance.manifest.json`, `resources/traceability/semantic-claims.manifest.json`, `docs/PERFORMANCE_AND_RELIABILITY.md` |
| AI output quality evaluation, golden fixtures, retrieval relevance | `docs/QUALITY_AND_TEST_STRATEGY.md`, `docs/PROMPT_DESIGN.md`, `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`, `docs/SPEC_TRACEABILITY.md` |
| Repository structure and coding conventions | `docs/REPOSITORY_STRUCTURE.md`, `docs/CODING_CONVENTIONS.md`, `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md` |
| Contributions and public collaboration | `CONTRIBUTING.md`, `docs/CONTRIBUTING_GUIDE.md`, `docs/CODING_CONVENTIONS.md` |

## 8. Machine-Readable Document Inventory

The complete document map is `resources/documentation-quality/document-map.manifest.json`. It is not default reading. `scripts/verify/document-map.mjs` verifies exact coverage, controlled tiers and lifecycle policies, owner/read metadata, and the default-entry word budget.

This file must not copy the context-pack or handoff field lists. `docs/AI_DEVELOPMENT_GUIDE.md` is their single owner. Repository-level red lines and stop conditions remain in `AGENTS.md`; phase completion and in-flight coordination remain in `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`.

Historical/research routing remains non-default: `docs/PI_PACKAGE_RESEARCH.md` preserves
dated package-curation rationale and `docs/prototypes/README.md` indexes visual evidence;
neither can prove current implementation.
