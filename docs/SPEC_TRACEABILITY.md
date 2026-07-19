# Spec Traceability

Status: Active implementation control
Baseline date: 2026-07-09
Last revised: 2026-07-10

## 1. Purpose And Authority

This document is the human-readable v0.1 requirement register. Machine-readable P0 coverage and Requirement-to-Build-to-Exit-to-evidence links live in `resources/traceability/p0-coverage.manifest.json` and `resources/traceability/acceptance.manifest.json`. The acceptance manifest is the sole owner of current Requirement/Exit status, exact evidence selectors, open gaps, and planned targets. `resources/traceability/semantic-claims.manifest.json` independently locks normalized source text and semantic assignments; all four views must agree.

`docs/V0_1_IMPLEMENTATION_PLAYBOOK.md` is the sole owner of Phase 0-9 sequencing and exit criteria. `docs/MILESTONES.md` owns M0-M7 release outcomes and the only normative Phase-to-Milestone crosswalk. This register connects those two views; it does not create a third roadmap.

Acceptance status is descriptive, not aspirational:

- `verified`: the selected current evidence exists and directly exercises or enforces the requirement at its present scope.
- `partial`: useful implementation or contract evidence exists, but the complete v0.1 acceptance obligation is not yet proven.
- `planned`: the requirement is assigned and has a verification class, but no implementation evidence is claimed.

No status is promoted merely because a design exists, a neighboring feature works, or an implementation note says a slice is complete. Phase completion still requires every mapped exit criterion and its evidence.

## 2. Machine-Checked Rules

- Every `PIGE-*` ID is defined exactly once in section 4.
- Allowed area prefixes are exactly the values in section 3.
- Every definition names an existing owner file, Phase 0-9, M0-M7, and an allowed verification class; the acceptance manifest supplies status and evidence state.
- Every ID must be referenced outside this file by its assigned phase in `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`.
- Historical/research documents, generated artifacts, and this definition table never count as the sole external reference or sole implementation evidence.
- Every Build commitment in the playbook maps to a declared exit criterion; later or out-of-scope work is listed under `Deferred from this phase` instead of being left implicit.
- Every PRD P0 bullet is covered exactly once by the P0 coverage manifest. Its declared controlled semantic capabilities must exactly match its requirements, and each requirement's Build/Exit mapping must exactly match the independently locked capability assignment.
- Canonical claim IDs and per-claim digests bind PRD item text, Requirement text and ownership, capability-to-requirement and delivery assignments, Build/Exit text, Deferred IDs/text and phase blocks, Phase state/interpretation rows, evidence selectors, status, and open-gap destinations. Coordinated swaps across mapping tables are rejected unless an explicit semantic review updates the independent lock.
- Evidence selectors in the acceptance manifest identify an exact test, verifier marker, implementation marker, or generated/manual report recipe. `test` and `verifier` evidence used for verified acceptance is executed by the traceability gate; file existence alone is not evidence.
- Every Exit has a controlled status and evidence target. A phase may be `complete` only when every assigned requirement and Exit is `verified`.
- The assigned Phase/Milestone pair must exist in the sole crosswalk in `docs/MILESTONES.md`.
- `planned` acceptance entries must say what evidence is expected. `partial` and `verified` entries must select at least one exact, non-historical repository evidence anchor. Every partial Requirement and Exit must have a stable structured `open` gap with explicit Build and Exit destinations.
- Scope promotion or demotion updates PRD, Milestones, Playbook, this register, and Decision Log together.
- CI runs `scripts/verify/traceability.mjs`; a green result proves structural closure, locked semantic consistency, and honest executable evidence wiring. It does not prove that planned work has been implemented or replace human review of an intentional semantic change.

## 3. Controlled Values

Allowed areas (machine checked):

- `API`
- `BACKUP`
- `CAP`
- `CONTEXT`
- `DATA`
- `DB`
- `DEP`
- `DIAG`
- `DOC`
- `EVAL`
- `GOV`
- `I18N`
- `INGEST`
- `JOB`
- `KNOW`
- `MEM`
- `PI`
- `PRIV`
- `PROMPT`
- `REL`
- `REPO`
- `RUNTIME`
- `SCHEMA`
- `SEARCH`
- `SEC`
- `SETTINGS`
- `SKILL`
- `SUPPORT`
- `UI`
- `VAULT`

Allowed verification classes are `contract`, `unit`, `integration`, `smoke`, `eval`, `release`, and `manual`. A row names the strongest primary class; supporting tests may use additional levels.

## 4. v0.1 Requirement Register

| ID | Requirement | Primary owner source | Phase | Milestone | Verification |
| --- | --- | --- | --- | --- | --- |
| PIGE-CAP-001 | Create a source record and preserve the source according to storage strategy before parsing or model calls. | `docs/PARSER_INGEST_SPEC.md` | P2 | M2 | integration |
| PIGE-CAP-002 | Large pasted content is stored once as a managed text source and referenced from conversation history. | `docs/DATA_ARCHITECTURE.md` | P2 | M2 | unit |
| PIGE-CAP-003 | Supported macOS versions provide local voice dictation in the Home composer; unsupported platforms show a clear unavailable state and never send dictation audio to a model provider. | `docs/PRD.md` | P2 | M2 | integration |
| PIGE-CAP-004 | Home provides a whole-window file-drop hot zone that validates accepted files, preserves them before processing, and reports rejected display names without exposing private paths. | `docs/UI_PROTOTYPE.md` | P2 | M2 | integration |
| PIGE-VAULT-001 | Open local files are durable knowledge truth: Markdown owns narrative knowledge and versioned Dataset Bundles own structured knowledge; internal databases/indexes remain rebuildable. | `docs/DATA_ARCHITECTURE.md` | P1 | M1 | integration |
| PIGE-VAULT-002 | Stable IDs are independent from slugs and file paths. | `docs/SYNC_CONFLICT_AND_MIGRATION.md` | P1 | M1 | unit |
| PIGE-VAULT-003 | Original files remain user-owned; v0.1 file capture preserves them through `copy_to_source_library` or verified `reference_original` storage without forced migration. | `docs/SOURCE_STORAGE_STRATEGY.md` | P2 | M2 | integration |
| PIGE-VAULT-004 | No actor permanently deletes durable knowledge/evidence automatically. Recoverable archive/trash is operation-recorded and undoable; permanent deletion confirms. | `docs/DATA_ARCHITECTURE.md` | P9 | M6 | integration |
| PIGE-VAULT-005 | Users can configure the knowledge root and an independently configurable managed source-copy location exposed through the v1 Source asset root compatibility/UI name; derived artifacts remain portable under the knowledge root, and Vault & Note Storage controls remain explicit and recoverable. | `docs/DATA_ARCHITECTURE.md` | P1 | M1 | integration |
| PIGE-VAULT-006 | Pige-managed Markdown writes are atomic and checksum-aware; external changes create a visible conflict instead of being overwritten silently. | `docs/SYNC_CONFLICT_AND_MIGRATION.md` | P1 | M1 | integration |
| PIGE-VAULT-007 | Durable records use sync-ready IDs plus explicit revision, checksum, conflict, and tombstone metadata required for future conflict detection without depending on paths. | `docs/SYNC_CONFLICT_AND_MIGRATION.md` | P1 | M1 | contract |
| PIGE-SCHEMA-001 | Every Pige-managed Markdown page has validated YAML frontmatter and stable IDs; new source pages expose only the bounded sidecar projection rather than operational asset locators. | `docs/MARKDOWN_SCHEMA.md` | P3 | M3 | unit |
| PIGE-KNOW-001 | Tags are lightweight facets; topics, concepts, entities, claims, and questions are durable Markdown pages when they matter. | `docs/KNOWLEDGE_MODEL_AND_LINKING.md` | P4 | M5 | integration |
| PIGE-KNOW-002 | Knowledge graph indexes and Knowledge Tree aggregates are rebuildable from durable vault truth. | `docs/KNOWLEDGE_MODEL_AND_LINKING.md` | P6 | M5 | integration |
| PIGE-KNOW-003 | Evidence-bound reversible relationship/merge/hierarchy work auto-applies with Operations; destructive loss or unresolved conflict needs intervention. | `docs/KNOWLEDGE_MODEL_AND_LINKING.md` | P7 | M5 | integration |
| PIGE-KNOW-004 | v0.1 provides a simple, explainable Knowledge Tree distinct from the Library tree; advanced force-directed graph analytics remain deferred. | `docs/UI_PROTOTYPE.md` | P6 | M5 | integration |
| PIGE-KNOW-005 | Knowledge Health reports broken links, orphans, duplicate topics, and unsourced claims without silently rewriting durable pages. | `docs/UI_PROTOTYPE.md` | P9 | M6 | integration |
| PIGE-KNOW-006 | Agent ingest autonomously creates/evolves schema-valid cited knowledge and emits deterministic created/updated/linked/skipped/failed/needs-attention outcomes. | `docs/PRD.md` | P3 | M3 | integration |
| PIGE-JOB-001 | Expensive, asynchronous, permissioned, or failure-prone work creates a durable job record before it starts. | `docs/JOB_OPERATION_AND_RECOVERY.md` | P2 | M2 | integration |
| PIGE-JOB-002 | Job retry and crash recovery are idempotent and do not duplicate source assets, pages, or operation records. | `docs/JOB_OPERATION_AND_RECOVERY.md` | P2 | M2 | integration |
| PIGE-JOB-003 | Proposals durably hold irreversible/security/destination/unresolved-conflict/stricter-policy exceptions, not routine recoverable Agent writes. | `docs/JOB_OPERATION_AND_RECOVERY.md` | P7 | M5 | integration |
| PIGE-JOB-004 | Missing model, tool, path, or runtime dependencies use visible retryable `waiting_dependency` state rather than silent failure or data loss. | `docs/JOB_OPERATION_AND_RECOVERY.md` | P2 | M2 | integration |
| PIGE-JOB-005 | Every autonomous or approved Agent write creates a redacted attributable Operation and recovery reference. | `docs/JOB_OPERATION_AND_RECOVERY.md` | P7 | M5 | integration |
| PIGE-JOB-006 | Complete reference-based conversation history remains restart-safe and compactable without duplicating large source assets or saved note bodies, while preserving source, job, decision, and operation references. | `docs/JOB_OPERATION_AND_RECOVERY.md` | P7 | M5 | integration |
| PIGE-JOB-007 | Home exposes durable progress/failure/dependency, autonomous Activity/Undo, and exceptional needs-attention state without premature completion. | `docs/JOB_OPERATION_AND_RECOVERY.md` | P2 | M2 | integration |
| PIGE-JOB-008 | Conversation-event types and operation kinds have one executable vocabulary whose documented lifecycle mapping and traceability gate must change together. | `docs/JOB_OPERATION_AND_RECOVERY.md` | P1 | M1 | contract |
| PIGE-API-001 | Renderer communicates only through typed preload IPC and never accesses filesystem, secrets, database, model, parser, shell, or worker APIs directly. | `docs/API_AND_IPC_DESIGN.md` | P1 | M1 | contract |
| PIGE-API-002 | API failures, durable Job warnings/errors, diagnostics, and UI actions use one namespaced, localized, redacted error taxonomy with stable retry and repair semantics. | `docs/API_AND_IPC_DESIGN.md` | P1 | M1 | integration |
| PIGE-DB-001 | SQLite is rebuildable and never the sole knowledge source of truth. | `docs/LOCAL_DATABASE_DESIGN.md` | P4 | M5 | integration |
| PIGE-DB-002 | The initial local database uses Node `node:sqlite` behind a replaceable driver abstraction and indexes the declared Library, search, graph, job, chunk, memory, and rebuild-status domains. | `docs/LOCAL_DATABASE_DESIGN.md` | P4 | M5 | integration |
| PIGE-DATA-001 | CSV, XLSX, and supported SQLite sources preserve original evidence and materialize a lossless typed versioned Dataset Bundle without executing source code or mutating originals. | `docs/DATA_ARCHITECTURE.md` | P5 | M4 | integration |
| PIGE-DATA-002 | Dataset inspection and natural-language analysis use bounded typed local query plans and exact revision/schema/row/range/aggregate evidence refs; whole payloads and unrestricted SQL never reach the model or renderer. | `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md` | P6 | M5 | integration |
| PIGE-DATA-003 | Managed Collections support stable typed fields, views, relations/formulas, and reversible Agent row/schema/view changes through Activity/Undo; destructive, external-write, authority, and conflict boundaries remain exceptional. | `docs/DATA_ARCHITECTURE.md` | P7 | M5 | integration |
| PIGE-SEC-001 | API keys are encrypted by default and excluded from backups by default. | `docs/SECURITY_THREAT_MODEL.md` | P3 | M3 | integration |
| PIGE-SEC-002 | Pi may request arbitrary filesystem/path/commit capability, but prompt-free authority is limited to active-vault recoverable knowledge Markdown and exact selected-source admission; every other Agent/Skill/package/local-tool effect requires exact Permission Broker mediation. | `docs/SECURITY_THREAT_MODEL.md` | P8 | M5 | integration |
| PIGE-SEC-003 | Permission modes include Ask Every Time, Remember Scoped Grants, and YOLO Full Access, with explicit revocation and operation records. | `docs/SECURITY_THREAT_MODEL.md` | P8 | M5 | integration |
| PIGE-SEC-004 | Vulnerabilities use private disclosure paths; public surfaces and handoffs must not contain exploit details, secrets, or user data. | `SECURITY.md` | P9 | M7 | manual |
| PIGE-SEC-005 | Every external model call obtains a typed pre-prompt/pre-credential egress decision; connected known destinations default to uninterrupted ordinary/private/bounded-large use with visible status, while sensitive, restricted, unknown, changed, and stricter-policy cases enforce their gates. | `docs/AGENT_RUNTIME_POLICY_CONTEXT.md` | P3 | M3 | integration |
| PIGE-SEC-006 | A machine-local secret-storage adapter can protect values without writing secrets into the vault; provider API-key integration and portable-mode warning are completed in P3. | `docs/SECURITY_THREAT_MODEL.md` | P1 | M1 | integration |
| PIGE-PRIV-001 | Public privacy copy matches actual v0.1 data flows: no default telemetry, local diagnostics, BYOK cloud-send visibility, explicit optional downloads, update checks, and permissioned extension network use. | `PRIVACY.md` | P9 | M7 | manual |
| PIGE-PI-001 | After preservation, upstream Pi is sole semantic orchestrator through one adapter and typed tools; eligible Pige-owned reversible work is autonomous, with no parallel/fixed Host pipeline or Pige-authored model loop. | `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md` | P3 | M3 | integration |
| PIGE-PI-002 | v0.1 selects one Global Default from enabled models grouped by Provider; free-form default IDs and Advanced/Fast routing stay hidden. | `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md` | P3 | M3 | integration |
| PIGE-PI-003 | Registered Pi tools pass owning-service validation and exact standing/gesture/Broker checks; exact `external_network` authority includes private targets without relaxing transport/content controls. | `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md` | P8 | M5 | integration |
| PIGE-PI-004 | BYOK is preset-first: templates bind protocol/Endpoint, Custom Provider exposes compatible protocol, Connect probes before commit, and synced/manual models merge in one refreshable Provider inventory. | `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md` | P3 | M3 | integration |
| PIGE-PI-005 | Every Home/source submission creates one durable Pi Job; source preservation is its first checkpoint, after which Pi may answer directly, iteratively use authorized tools, author Markdown through scoped writers, and repair typed validation rejection until an accepted result or true external block. Safe non-durable drafts replace in place before the authoritative final, and no-model work waits without Host intent heuristics or silent fallback. | `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md` | P3 | M3 | integration |
| PIGE-SETTINGS-001 | Every user-visible setting declares owner, scope, storage, backup behavior, permission requirement, and apply behavior. | `docs/SETTINGS_AND_PREFERENCES.md` | P1 | M1 | unit |
| PIGE-SETTINGS-002 | Machine-local settings and permission grants are excluded from default vault backups and are not required to understand restored Markdown knowledge. | `docs/SETTINGS_AND_PREFERENCES.md` | P1 | M1 | integration |
| PIGE-SETTINGS-003 | Sensitive settings change only through explicit user action, confirmation, or Permission Broker decision; untrusted inputs cannot directly change them. | `docs/SETTINGS_AND_PREFERENCES.md` | P1 | M1 | integration |
| PIGE-INGEST-001 | Parser tools must not download core dependencies at task time. | `docs/PARSER_INGEST_SPEC.md` | P5 | M4 | smoke |
| PIGE-INGEST-002 | Optional PaddleOCR and language packs use an explicit local-tool lifecycle with install, verify, test, update, disable, remove, repair, and visible unavailable states; ordinary ingest never installs them implicitly. | `docs/PARSER_INGEST_SPEC.md` | P5 | M4 | integration |
| PIGE-INGEST-003 | v0.1 locally ingests bounded web snapshots, PDF text with page locators, semantic DOCX content, and best-effort PPTX content into checksummed artifacts without losing the preserved source. | `docs/PARSER_INGEST_SPEC.md` | P5 | M4 | integration |
| PIGE-INGEST-004 | OCR routing prefers supported Apple Vision or Windows AI adapters and uses explicit PaddleOCR fallback for unsupported platforms and rendered image-only pages, with visible retryable unavailability. | `docs/PARSER_INGEST_SPEC.md` | P5 | M4 | integration |
| PIGE-DEP-001 | Runtime, bundled, model, provider, parser, release, and CI dependencies require registry rows, schema-valid manifests, and valid waivers before release. | `docs/TECH_ARCHITECTURE.md` | P0 | M0 | contract |
| PIGE-DEP-002 | Bundled Git/shell, Bun, `uv`, PDF, and Office tools are version-pinned, report ready/missing/damaged state, and expose a visible repair path without task-time improvisation. | `docs/TECH_ARCHITECTURE.md` | P1 | M1 | integration |
| PIGE-PROMPT-001 | Source content is wrapped as untrusted data and cannot override tools, permissions, settings, providers, or `PIGE.md`. | `docs/PROMPT_DESIGN.md` | P5 | M4 | eval |
| PIGE-PROMPT-002 | Agent-affecting settings are compiled into typed Runtime Policy Context and enforced by owning services, not prompt text alone. | `docs/AGENT_RUNTIME_POLICY_CONTEXT.md` | P1 | M1 | integration |
| PIGE-CONTEXT-001 | Agent context assembly retrieves locally first, packages selected evidence with citations, and never sends the whole vault or large source bodies by default. | `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md` | P6 | M5 | integration |
| PIGE-CONTEXT-002 | Context packs store refs, policy hashes, budgets, warnings, and citation refs rather than raw prompts, secrets, full settings, or duplicated source bodies. | `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md` | P6 | M5 | unit |
| PIGE-EVAL-001 | AI ingest quality is protected by multilingual golden fixtures, citation checks, unsupported-claim checks, low-confidence routing, and regression metrics. | `docs/QUALITY_AND_TEST_STRATEGY.md` | P5 | M4 | eval |
| PIGE-EVAL-002 | Missing evidence, contradiction, or uncertainty replans, narrows, warns, preserves alternatives, abstains, or routes a true exception—never an unsupported write or routine micro-decision. | `docs/QUALITY_AND_TEST_STRATEGY.md` | P3 | M3 | eval |
| PIGE-EVAL-003 | Evidence-backed schema-valid recoverable note/link/relationship changes auto-apply; irreversible/security/destination/unresolved-conflict/stricter-policy actions block or use exceptional review. | `docs/QUALITY_AND_TEST_STRATEGY.md` | P3 | M3 | eval |
| PIGE-EVAL-004 | Retrieval, linking, and summarization quality use executable ranking, grounding, citation, related-page, and insufficient-evidence regression fixtures. | `docs/QUALITY_AND_TEST_STRATEGY.md` | P6 | M5 | eval |
| PIGE-SEARCH-001 | When Pi selects Home retrieval, used local evidence stays ranked and cited; ordinary turns need no vault evidence, while vault-only requests report insufficiency honestly. | `docs/PRD.md` | P6 | M5 | integration |
| PIGE-SEARCH-002 | Lexical search works before local embedding model download. | `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md` | P4 | M5 | integration |
| PIGE-SEARCH-003 | Local RAG provides a verified Pige-managed default embedding asset, rebuildable vector/chunk indexes, disable/remove fallback to lexical search, and optional local reranking without requiring embedding-provider setup. | `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md` | P6 | M5 | integration |
| PIGE-MEM-001 | Pige-native layered Agent memory is inspectable, provenance-linked, reversible, scoped, secret-scanned, and backed up by default only when vault-scoped. | `docs/AGENT_MEMORY_DESIGN.md` | P7 | M5 | integration |
| PIGE-BACKUP-001 | Backup includes vault-scoped memory and reference-based conversation history by default. | `docs/DATA_ARCHITECTURE.md` | P9 | M6 | integration |
| PIGE-BACKUP-002 | Backup excludes secrets, model files, tool binaries, database, indexes, and caches by default. | `docs/DATA_ARCHITECTURE.md` | P9 | M6 | integration |
| PIGE-BACKUP-003 | Backup creation writes a validated versioned `.pige-backup.zip` plus a checksummed manifest that records include/exclude decisions and external dependencies. | `docs/DATA_ARCHITECTURE.md` | P9 | M6 | integration |
| PIGE-BACKUP-004 | Restore previews and validates a `.pige-backup.zip`, detects path/schema/checksum conflicts, restores into a validated fresh folder with explicit identity handling, and rebuilds only derived state. | `docs/DATA_ARCHITECTURE.md` | P9 | M6 | integration |
| PIGE-REL-001 | v0.1 publishes GitHub Actions-built alpha artifacts only from an exact protected alpha tag through the protected release environment, independently verifies immutable artifact/update metadata before publication, and supports automatic update checks. | `docs/RELEASE_ENGINEERING.md` | P9 | M7 | release |
| PIGE-REL-002 | PRD P0 is the v0.1 release acceptance scope, not one implementation task; development follows the canonical Playbook phases. | `docs/MILESTONES.md` | P0 | M0 | contract |
| PIGE-REL-003 | Public Alpha requires a scripted scenario report covering at least 25 mixed sources, recovery, backup, restore, and post-restore retrieval. | `docs/QUALITY_AND_TEST_STRATEGY.md` | P9 | M7 | release |
| PIGE-REL-004 | Release evidence proves the 10,000-page/100,000-chunk scale target, a core distributable at or below the 330,000,000-byte hard ceiling excluding optional weights, and the packaged idle/ordinary-use memory scenarios and post-heavy-Job recovery ceilings owned by Performance and Reliability. | `docs/PERFORMANCE_AND_RELIABILITY.md` | P9 | M7 | release |
| PIGE-REL-005 | Public alpha macOS artifacts are Developer ID signed, hardened, notarized, and stapled; Windows artifacts are Authenticode signed; both carry release notes and dependency/license attribution, while unsigned artifacts remain internal-only and Linux remains deferred. | `docs/RELEASE_ENGINEERING.md` | P9 | M7 | release |
| PIGE-I18N-001 | v0.1 supports `zh-Hans`, `en`, `ja`, `ko`, `fr`, and `de` across release-critical workflows. | `docs/I18N_DESIGN.md` | P9 | M7 | smoke |
| PIGE-I18N-002 | Sources, generated pages, OCR artifacts, chunks, and memory retain useful language metadata; source language is preserved by default, and Home retrieval accepts and answers in the query language with CJK lexical and multilingual semantic coverage. | `docs/I18N_DESIGN.md` | P9 | M7 | integration |
| PIGE-I18N-003 | The repository scaffold loads complete key-compatible catalog skeletons for `zh-Hans`, `en`, `ja`, `ko`, `fr`, and `de`. | `docs/I18N_DESIGN.md` | P0 | M0 | contract |
| PIGE-RUNTIME-001 | Agent, tool, parser, OCR, and RAG execution stays behind runtime capability adapters for the future remote backend and mobile-lite client. | `docs/FUTURE_MOBILE_AND_CLOUD_ARCHITECTURE.md` | P1 | M1 | contract |
| PIGE-REPO-001 | The scaffold uses `apps/desktop` for Electron and `packages/*` for reusable contracts, schemas, Markdown, knowledge, and fixtures. | `docs/REPOSITORY_STRUCTURE.md` | P0 | M0 | contract |
| PIGE-REPO-002 | Import boundaries prevent packages from depending on the desktop app and renderer code from importing privileged main-process capabilities. | `docs/REPOSITORY_STRUCTURE.md` | P0 | M0 | contract |
| PIGE-REPO-003 | Fixtures and release evidence use manifest-backed paths under `tests/fixtures/manifests/` and generated `artifacts/` output. | `docs/QUALITY_AND_TEST_STRATEGY.md` | P0 | M0 | contract |
| PIGE-REPO-004 | Phase 0 work loads repository structure, coding conventions, dependency registry, quality, release, and traceability contracts before workspace or CI changes. | `docs/START_HERE_FOR_AI_AGENTS.md` | P0 | M0 | contract |
| PIGE-DIAG-001 | v0.1 performs no product analytics, background telemetry, automatic crash upload, or automatic diagnostic upload. | `docs/DIAGNOSTICS_AND_OBSERVABILITY.md` | P1 | M1 | integration |
| PIGE-DIAG-002 | Support bundles are user-initiated, previewed, redacted by default, cancelable, and written only to a selected local path. | `docs/DIAGNOSTICS_AND_OBSERVABILITY.md` | P1 | M1 | integration |
| PIGE-DIAG-003 | Diagnostic logs are bounded and never store secrets, full source bodies, full notes, full memory, or raw prompts and responses by default. | `docs/DIAGNOSTICS_AND_OBSERVABILITY.md` | P1 | M1 | unit |
| PIGE-SUPPORT-001 | Public support uses synthetic or redacted reproductions and never requests private vaults, sources, secrets, prompts, raw responses, or unreviewed bundles. | `SUPPORT.md` | P9 | M7 | manual |
| PIGE-GOV-001 | Public collaboration uses conduct and issue/PR templates that require redaction, requirement sources, tests, docs updates, and private security routing. | `CONTRIBUTING.md` | P0 | M0 | contract |
| PIGE-GOV-002 | App metadata declares Apache-2.0 and repository license/notice files remain present and package-readable. | `LICENSE` | P0 | M0 | contract |
| PIGE-DOC-001 | AI agents use minimal entry docs plus task-specific reading packs instead of loading the full design library for routine work. | `docs/START_HERE_FOR_AI_AGENTS.md` | P0 | M0 | contract |
| PIGE-DOC-002 | Every design document has an owner role, tier, and prune or merge path, without duplicating the canonical task-pack table. | `docs/START_HERE_FOR_AI_AGENTS.md` | P0 | M0 | contract |
| PIGE-DOC-003 | Requirement IDs are uniquely defined here and every external reference resolves to one definition and assigned phase. | `docs/SPEC_TRACEABILITY.md` | P0 | M0 | contract |
| PIGE-DOC-004 | Phase 0 scaffolding starts only after its readiness gate; that gate does not authorize later product phases. | `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md` | P0 | M0 | contract |
| PIGE-DOC-005 | Navigation and resource recovery, cross-document contract consistency, traceability and acceptance closure, development support, and documentation leanness and maintainability each score at least 9.5 through reproducible gates and an independent review. | `docs/QUALITY_AND_TEST_STRATEGY.md` | P0 | M0 | contract |
| PIGE-UI-001 | The note reader renders polished safe Markdown and editing preserves valid frontmatter, clean source files, links, citations, and IME behavior. | `docs/UI_PROTOTYPE.md` | P6 | M5 | integration |
| PIGE-UI-002 | Release-critical workflows meet the v0.1 keyboard, focus, accessible-name, contrast, reduced-motion, and narrow-layout baseline. | `docs/UI_PROTOTYPE.md` | P9 | M7 | smoke |
| PIGE-UI-003 | Home is one calm Agent-first, mode-free entry; layout changes preserve context and the collapsible sidebar exposes a browsable three-level Library tree. | `docs/UI_PROTOTYPE.md` | P1 | M1 | integration |
| PIGE-UI-004 | Knowledge Tree visual encoding makes domain/topic weight and fragment quantity/density explainable and accessible while remaining source-backed and distinct from advanced graph analytics. | `docs/UI_PROTOTYPE.md` | P6 | M5 | integration |
| PIGE-UI-005 | Note Agent/selection actions keep copy local and auto-apply reversible mutations with Activity/Undo; exceptional boundaries review. | `docs/UI_PROTOTYPE.md` | P6 | M5 | integration |
| PIGE-UI-006 | The note reader exposes bounded source metadata and related pages without leaking source bodies or operational paths, and degrades safely when graph metadata is unavailable. | `docs/UI_PROTOTYPE.md` | P6 | M5 | integration |
| PIGE-SKILL-001 | Skills can be staged from Settings or explicit chat intent, inspected, installed, enabled, disabled, updated from source, uninstalled, and exported; sensitive capabilities remain permission mediated. | `docs/SKILL_EXTENSION_DESIGN.md` | P8 | M5 | integration |
| PIGE-SKILL-002 | Curated Pi packages support metadata inspection, explicit install, enable or disable, update, version pinning, rollback, uninstall, and capability disclosure without task-time hidden installation. | `docs/SKILL_EXTENSION_DESIGN.md` | P8 | M5 | integration |

## 5. Update And Handoff Checklist

When behavior or scope changes:

1. Update the primary owner contract first.
2. Keep the stable ID when semantics are compatible; add a new ID when acceptance meaning changes materially.
3. Update the assigned Playbook Build/Exit; Phase and Milestone ownership is derived from this register and the Milestone crosswalk, not copied into hand-maintained gate lists.
4. Update `resources/traceability/p0-coverage.manifest.json` for any PRD P0 bullet change, and update `resources/traceability/acceptance.manifest.json` for requirement, controlled semantic capability, Build, Exit, status, phase-state, structured open-gap, or evidence changes.
5. Update the Phase-to-Milestone crosswalk only when release outcome ownership changes.
6. In the acceptance manifest, point evidence to an exact controlled test/verifier selector or a recipe-backed generated/manual report under `artifacts/`; never use a historical audit or an existing-but-unrelated file.
7. Keep incomplete requirements and Exits `partial` or `planned`, even when a narrower implementation slice is working. Every partial Requirement and Exit must have a stable `open` ID, a concrete gap description, and controlled Build/Exit destinations; a phase cannot be complete until all mapped requirements and Exits are verified.
8. After reviewing the complete semantic diff, run `node scripts/verify/update-semantic-claims.mjs --accept-semantic-change`. Do not regenerate the lock merely to silence a failed mapping.
9. Run `npm run verify:traceability`, including its mutation cases, and the mapped verification class before handoff.
