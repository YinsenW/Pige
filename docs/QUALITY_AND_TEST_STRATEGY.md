# Quality And Test Strategy

Status: Draft baseline
Date: 2026-07-09

## 1. Purpose

Pige cannot rely on manual clicking and optimistic AI output. The app stores personal knowledge, runs Agent workflows, handles untrusted files, and must recover from failure.

This document defines the test strategy future AI agents should follow while implementing v0.1.

## 2. Quality Principles

1. User-owned data loss is the highest-severity failure.
2. Secret leakage is a release blocker.
3. Permission bypass is a release blocker.
4. A capture must be preserved before expensive processing.
5. SQLite/index corruption must be recoverable from durable files.
6. Failed jobs must be visible, explainable, retryable when possible, and never silently disappear.
7. Renderer responsiveness is part of correctness.
8. Tests should protect service boundaries, not only UI snapshots.
9. Fixtures should cover multilingual and malformed real-world inputs.
10. Release gates should be automated where possible.
11. AI output quality is a product behavior, not a subjective afterthought; ingest, retrieval, linking, and summarization need regression fixtures and measurable gates.

## 3. Test Pyramid

Unit tests:

- ID generation.
- IPC/API payload validation.
- Path validation and path traversal blocking.
- Frontmatter parsing and schema validation.
- Citation parsing and managed block validation.
- Tag canonicalization and topic/entity boundary rules.
- Owner-defined link resolution across title, alias, slug, and stable identity.
- Relationship type validation from `docs/KNOWLEDGE_MODEL_AND_LINKING.md`.
- Source checksum and deduplication logic.
- Permission decision matching.
- Backup manifest include/exclude logic.
- Migration planning.
- Language detection wrappers and normalization helpers.
- Prompt input sanitization and untrusted content delimiters.
- Prompt assembly and structured output schema validation.
- Job state transition validation from `docs/JOB_OPERATION_AND_RECOVERY.md`.

Integration tests:

- Capture to source record/source asset to source page.
- Text ingest to wiki note and log entry.
- BYOK provider connection, model-list discovery, manual model ID fallback, and default model use in Pi Agent calls.
- URL fetch security rules.
- Parser artifact creation.
- OCR routing decision.
- IPC command/query/event flow through preload and main.
- Database rebuild from vault.
- Backlink and relationship graph rebuild from Markdown.
- Knowledge Tree aggregation against the governed fixture vaults.
- Search indexing and results.
- Autonomous knowledge apply/Undo plus exceptional proposal approve/reject.
- Job retry/recovery, monotonic progress, cooperative cancellation, durable-output races, and worker termination.
- Conversation history reference storage.
- Agent memory creation/deletion.
- Backup and restore into a new folder.

Renderer/component tests:

- Compact Home composer.
- Whole-window drag state.
- Home job/status cards.
- Home knowledge retrieval result list.
- Note reader rendering.
- Autonomous Activity/Undo and exceptional diff/preview.
- Permission dialog.
- Settings pages.
- I18N string rendering in long-label locales.

Smoke/end-to-end tests:

- First-run vault creation.
- First-run skip model enters capture-only mode and preserves captures.
- Vault & Note Storage page shows active vault path, note storage path, source asset root, recent vaults, and safe backup/restore entry points.
- App restart with pending job.
- Capture text, URL, PDF, image fixture.
- BYOK provider connection mock.
- Home knowledge retrieval over generated fixtures.
- Backup/restore.
- Update check in alpha channel.
- Public Alpha usability scenario with at least 25 mixed sources, recovery events, backup, restore, and continued retrieval.

## 4. Required Fixtures

Text fixtures:

- Short plain note.
- Large pasted text that must become a managed text source reference.
- Markdown with frontmatter-like content from untrusted source.
- Malformed Markdown.
- Markdown with duplicate topics, aliases, backlinks, and source citations.
- CJK text: Simplified Chinese, Japanese, Korean.
- French and German long labels/content.
- Text containing fake prompt-injection instructions.

Web fixtures:

- Simple static article HTML.
- Article with scripts and navigation clutter.
- Redirect chain.
- Oversized response.
- Blocked localhost/private network URL.
- Page containing prompt-injection text.

Document fixtures:

- Small text PDF.
- Image-only PDF.
- PDF with sparse embedded text and visible text in images.
- DOCX with headings, lists, links, and tables.
- PPTX with text boxes and selected embedded-raster OCR.
- Corrupt or unsupported file.

Image/OCR fixtures:

- Clean screenshot.
- Low-contrast image.
- Multilingual image.
- Image with table-like content.

Vault fixtures:

- Empty vault.
- Small normal vault.
- 10,000-page metadata vault.
- 100,000-chunk index fixture.
- Long conversation history with referenced sources.
- Vault with external edits.
- Vault with missing/corrupt `.pige/db/`.

Security fixtures:

- Malicious ZIP path traversal.
- Skill with scripts in staging.
- Skill requesting shell/network/secret/delete capabilities.
- Fake API key in source content.
- Operation record that must not store full source asset content.

AI evaluation fixtures:

- Source-to-note golden fixtures for text, URL, PDF, PPTX, image OCR, and mixed-language inputs.
- Retrieval query fixtures with expected relevant page/source IDs, acceptable citations, and known distractors.
- Linking fixtures with expected tags, topics, entities, backlinks, and relationship suggestions.
- Hallucination fixtures where the correct output is "not enough evidence".
- Low-confidence fixtures that replan, narrow, warn, preserve alternatives, abstain, or route a true exception instead of unsupported writes.
- Prompt-injection fixtures where source text asks the Agent to change settings, ignore citations, reveal secrets, or create unsupported claims.

Current deterministic suite:

- `multilingual-golden.v3`: seven synthetic multi-format cases across six locales, with mixed/contradictory evidence; schema/citation/support/recall/language/review/locator and negative gates in `npm test`/`test:eval` complete B5.12/E5.04.
- Retrieval v1 B6.15/E6.10: real SQLite FTS, extractive ask, related/backlinks, six metric/adversarial gates, and a canonical body-free CI report under 16 KiB via `npm run test:eval:report`.

Current adversarial boundary seed:

- `tests/evals/agent-ingest-untrusted-source.test.ts` exercises URL Readability, DOCX, PDF, PPTX, and image-OCR handoff through the public Agent ingest boundary. It verifies one escaped untrusted wrapper, unchanged settings/Provider/permission/tool/`PIGE.md` sentinels, deterministic note-path ownership, and strict rejection of model-authored control fields before note creation.
- This is evidence toward B5.11/E5.03; full Pi tool/Permission Broker runtime proof remains open.

Public Alpha usability scenario fixture:

- At least 25 mixed sources captured across a scripted multi-session run.
- Must include typed text, large pasted text, URL, Markdown, TXT, text PDF, image-only PDF, DOCX, PPTX, screenshot/image OCR, and at least two multilingual CJK/Latin sources.
- Must include at least one failed or degraded path: denied permission, missing optional OCR/RAG model, failed parser/OCR warning, network fetch failure, app restart with queued job, or external Markdown edit.
- Must include one Home retrieval question, Note Agent, selection action, autonomous
  write/Undo, exceptional proposal, memory path, backup, fresh-folder restore, and search.
- Must produce a release evidence report with fixture version, platform, app build, source counts, generated page counts, failed/degraded jobs, warnings, backup manifest summary, restore result, AI eval summary, and unresolved issues.

Fixture manifest and evidence rules:

- Fixture locations and report paths follow `docs/REPOSITORY_STRUCTURE.md`.
- Every fixture used by CI or release gates must be represented in `tests/fixtures/manifests/fixtures.manifest.json`.
- The Public Alpha scenario must be represented in `tests/fixtures/manifests/public-alpha-scenario.manifest.json`.
- The Public Alpha scenario report should be written to `artifacts/release-evidence/v0.1/public-alpha-usability/<platform>/<build-id>/scenario-report.json`.
- Scenario reports should also include `summary.md` for human review, optional screenshots, and redacted logs under the same evidence directory.
- Fixture manifest records should include source/license status, expected output refs, redaction status, size class, required platform capabilities, owner, and update policy.

Rules:

- Golden fixtures should prefer small, inspectable sources whose expected outputs can be reviewed by humans.
- Live cloud model evaluations are useful but not deterministic release gates. Release gates should use schema validation, deterministic retrieval fixtures, stubbed model outputs, recorded redacted model responses, or local test doubles where possible.
- Evaluation records must not store raw API keys, private user vault content, or full prompts/responses by default.
- Public Alpha usability scenario reports must use synthetic or redacted fixtures only. They should be checked into release artifacts or CI outputs, not public issues with private content.

## 5. Data Safety Gates

Every feature that writes files must test:

- Writes happen through Vault Service or the owning service.
- Path stays inside allowed scope.
- Active vault path and recent vaults stay in machine-local settings, not `.pige/manifest.json`.
- Temporary files are cleaned up or recoverable.
- Existing file checksum is checked before overwrite.
- Crash between temp write and rename does not corrupt durable files.
- Delete/archive moves to recoverable trash when required.
- Data lifecycle follows `docs/DATA_ARCHITECTURE.md`: eligible knowledge changes are
  operation-recorded/recoverable, durable deletion is trash-first, and indexes/caches rebuild.
- Agent, Skill, package, cleanup, reset, and compaction flows cannot permanently delete source records, managed source copies, Markdown pages, memory, conversations, proposals, or operations.
- Trash entries preserve object IDs, previous paths, operation IDs, and checksums when available.
- Source record creation and source asset preservation happen before parsing/model calls.
- Backup includes or excludes the new file type correctly.

## 6. Secret Safety Gates

Tests must verify:

- API keys are stored only through the secret store.
- API keys do not appear in Markdown, SQLite, logs, conversation events, operation records, diagnostics, or default backups.
- Provider profile DTOs return secret references or redacted status only, never raw keys.
- Plaintext portable/developer mode is off by default.
- Enabling plaintext mode requires explicit settings action and warning.
- Diagnostics export redacts provider/profile identifiers and excludes raw secrets.

## 6.1 Model Provider And Pi Agent Gates

Tests must verify:

- Provider gates prove five presets, Custom-only protocols, API-key/no-auth execution plus
  optional-auth schema/adapter, real pre-write Pi probe, unified inventory/Refresh/manual
  merge, grouped default, transaction-journal recovery, redacted binding, and readback.
- Assembled loopback proves renderer→preload→main→Registry→Pi direct/cited/source turns
  and restart. A real legacy Custom DeepSeek Chat canary proves normal secret resolution,
  direct/restart-cited Home, and 14 clean diagnostics; it does not prove fresh DeepSeek
  preset Connect. Live preset/Anthropic and signed packaged matrices remain open.
- Pi compatibility tests bind exact same-version packages; reject deep/compat/global or
  out-of-adapter imports; and cover event/tool order, validation, abort/continue,
  queues/context, selected auth, no ambient authority, and packaged runtime on update.
- `v0.80.6` tests keep transitive compat globals/catalog/default dispatch inert and use
  only isolated `Models` through the sole adapter.
- Renderer→preload→main proves direct, Pi-selected retrieve, preserve-first source,
  wait/resume, and removal of capture/retrieval semantic bypass from the Home renderer.
- Draft-stream tests use the exact terminal Home tool and prove parsed `answer`-only
  replacement snapshots, sender/request/turn/Job binding, monotonic sequence, bounds,
  coalescing, escaping, and repair that can shrink prior text. They reject raw Pi text,
  partial JSON, thinking, other tool arguments, citations/grounding, IDs, provider
  payloads, restricted/control content, wrong sender, stale sequence, and post-cancel events.
- Final validation replaces the draft exactly once and alone creates durable assistant/
  Job output. Schema/citation/source drift, provider failure, and cancellation leave no
  durable draft; restart/conversation recovery never replays one.
- Initial context has instruction/policy/tools; evidence follows selected calls. Without
  a model, one durable turn waits and performs no semantic work.
- Only registered tool calls write; retry/restart reuses call/Operation identity.
- Static plus mutation gates reject direct feature/provider loops, host-fixed tool
  order, unregistered or incomplete tools, nested tool/model execution, final-text
  writes, policy/catalog/source drift, and renderer bypass.
- No Advanced/Fast model assignment UI exists in v0.1 unless a real routing service is implemented and tested.
- Pige-owned Pi tools cannot bypass service validation; external extensions cannot bypass Permission Broker.
- Pige does not mutate the user's global `~/.pi/agent/models.json` during normal provider setup.
- Cloud-send indicators appear when content is sent to a cloud-hosted provider.

## 6.2 Agent Runtime Policy Context Gates

Tests must verify:

- The Runtime Policy owner’s matrix has executable fixtures for setting-effect
  registration, prompt rendering, service enforcement, one-off user overrides,
  untrusted-source resistance, new-capture application, redacted policy references, and
  portable serialization. Quality owns the fixture matrix and evidence coverage; it
  does not repeat each Owner test sentence.

## 6.2.1 Context Assembly And Retrieval Gates

Tests must verify:

- Context budget allocation preserves authority/safety, Runtime Policy Context, task state, output schema, and citations before lower-authority context.
- Home retrieval sends selected snippets and citation refs to model calls, not the whole vault or large source bodies.
- Home tests cover ordinary empty-vault answer, Pi-selected retrieval, zero-result
  replan, vault-only insufficiency, no Host heuristic, evidence/privacy drift,
  confinement/secret blocking, and untrusted tool output.
- Retrieval works through lexical/metadata fallback before local embeddings are installed.
- CJK retrieval fixtures do not depend on whitespace-only tokenization.
- Citation refs survive prompt assembly, structured output validation, conversation compaction, and retry.
- Memory injection is scoped, ranked, secret-scanned, and lower authority than explicit user instruction and policy context.
- Context-pack serialization works for future remote Agent backend and Mobile Lite clients without desktop-only objects.

## 6.2.2 Agent Output Quality Gates

Tests and evaluation fixtures must verify:

- Ingest creates useful source pages and wiki notes that preserve the source's main claims without inventing unsupported facts.
- Generated titles are concise, human-readable, and stable enough that small prompt wording changes do not churn filenames unnecessarily.
- Tags, topics, entities, claims, and relationship suggestions match the knowledge model and avoid broad speculative hierarchy edits.
- Factual claims in generated notes are cited when source evidence exists.
- Low-confidence parsing/OCR/classification/linking replans, narrows, warns, preserves
  alternatives, abstains, or routes a true exception instead of a confident unsafe write.
- Home retrieval meets fixture-level relevance targets such as expected relevant pages in top results and no known distractor outranking the primary evidence.
- Grounded summaries answer only from selected snippets and cite the evidence used.
- Grounded/vault-only answers expose missing or contradictory evidence; general answers
  use no fabricated vault citations.
- Note Agent and selection actions preserve selected spans and do not rewrite unrelated frontmatter or managed blocks.
- Multilingual fixtures preserve source language metadata and answer Home queries in the query language where required.

Recommended v0.1 eval metrics:

- `citation_coverage`: factual generated claims with valid citation refs when evidence exists.
- `unsupported_claim_count`: generated factual claims not grounded in supplied context.
- `retrieval_recall_at_5`: expected relevant pages/sources present in top five results.
- `primary_result_rank`: rank of the expected primary page/source.
- `schema_valid_rate`: structured Agent outputs passing validation.
- `autonomous_safe_write_rate`: eligible evidence-bound recoverable writes auto-apply with Operations.
- `exception_routing_precision`: only irreversible/security/destination/unresolved-conflict writes become proposals.
- `language_policy_match`: generated language follows source/query/app policy as configured.

Rules:

- These metrics are gates for regression detection, not a promise that AI quality is perfect.
- Failing evals block release when they indicate data loss, secret leakage, unsupported durable knowledge, citation breakage, permission bypass, or severe retrieval regression.
- Non-blocking quality regressions should create issues with fixture name, expected behavior, actual behavior, model/profile ID or stub ID, prompt template version, and context pack refs.

## 6.3 Settings And Preferences Gates

Tests must verify:

- Every user-visible setting is classified in the registry from `docs/SETTINGS_AND_PREFERENCES.md`.
- Portable-settings fixtures reject machine-local or secret fields from vault config.
- Machine-local settings are excluded from default vault backups.
- Settings export excludes secrets by default.
- Irreversible/security/destination setting changes require intervention; external/new
  capability scopes use Permission Broker, while ordinary reversible preferences do not re-prompt.
- Setting updates that affect running jobs either apply to new jobs only or pause/flush/restart jobs according to the declared apply behavior.

## 6.4 Onboarding And Capture-Only Gates

Tests must verify:

- Fresh install with no vault shows create/open/restore options.
- Creating a vault writes required files and stores active path only in machine-local settings.
- Opening a compatible vault sets active binding without rewriting vault identity.
- Skipping model setup enters `capture_only`.
- Capture-only mode preserves text/file/url sources and conversation references.
- Model-dependent jobs enter `waiting_dependency` when no default model exists.
- Configuring a model can requeue waiting model jobs without duplicating source records or managed source assets.
- First-run restore writes into a new folder and does not import provider secrets by default.
- Locale-catalog completeness is checked once across Settings and first-run surfaces for
  every v0.1 locale.

## 6.5 Diagnostics And Observability Gates

Tests must verify:

- Diagnostics fixtures execute the Owner’s default exclusion matrix, explicit local
  preview/export/cancel flow, secret/path redaction, shared error taxonomy, six-locale
  message coverage, bounded retention, vault-safe clearing, forced-quit recovery, and
  renderer DTO boundary. Exact excluded fields and retention semantics remain in
  `docs/DIAGNOSTICS_AND_OBSERVABILITY.md`.

## 7. Permission Gates

Tests must verify:

- External/new sensitive capability actions create Permission Broker requests.
- Only those jobs enter `waiting_permission`; Pige-owned core knowledge tools do not.
- Grant-matching fixtures distinguish a non-reusable one-action decision from a
  revocable saved grant bound to actor/version/capability/resource scope.
- Deny blocks the action and leaves the app stable.
- Permission decisions are recorded without secrets.
- Saved grants can be revoked.
- Destructive actions do not default to Allow.
- Default permission modes are enforced: Ask Every Time, Remember Scoped Grants, and YOLO Full Access.
- YOLO Full Access is off by default, requires explicit opt-in, remains visibly indicated, can be revoked immediately, and logs every covered auto-allowed action.

## 8. Parser And OCR Gates

Tests must verify:

- Parser jobs create source records and preserve source assets before parsing.
- Missing parser tool reports repair-needed state.
- Parser jobs do not download core dependencies at task time.
- OCR output is stored as an extracted artifact, not as a replacement for the source asset.
- OCR confidence and engine metadata are preserved when available.
- Native text and OCR text remain traceable before merge.
- Malicious document text is treated as untrusted content.
- Static reference registration does not authorize installing or executing an external
  converter. Output from a separately approved, pinned, and isolated comparison
  experiment may serve only as a non-authoritative differential oracle over Pige-owned
  synthetic fixtures; it does not prove acceptance or bypass Pige locator, provenance,
  safety, resource-bound, and recovery assertions.

## 9. RAG And Search Gates

Tests must verify:

- Lexical search works before embedding model download.
- CJK lexical fallback indexes and retrieves Chinese/Japanese/Korean content.
- Vector indexes are rebuildable.
- Search does not load full vault into renderer memory.
- Home knowledge retrieval returns ranked notes and grounded summary with citations.
- Cloud model receives selected snippets, not the entire vault.
- Query answers are stored in conversation history without duplicating source bodies.

## 10. UI And Accessibility Gates

Tests must verify:

- `resources/ui-visual-contract.manifest.json` agrees with the visual owner and the live
  renderer CSS for protected tokens and structural metrics.
- Deterministic real-render screenshots cover the governed viewport, locale, theme, and
  state matrix for changed surfaces; synthetic data is mandatory.
- Pixel comparison uses the manifest threshold as a review trigger, not automatic proof
  of usability or approval.
- Baseline changes have human review and a contract-linked rationale; bulk auto-update is
  not an acceptable way to clear a failure.
- Screenshot sidecars record build, platform, viewport, device scale factor, locale,
  theme, fixture state, and font readiness so differences remain reproducible.
- Release evidence includes macOS and Windows captures for critical workflows and records
  platform text/window-chrome differences separately.

- Compact capture layout works at narrow width.
- Expanded workspace and full-screen reader preserve context.
- Whole-window file drop works in compact and expanded modes.
- Main workflows are keyboard reachable.
- Focus states are visible.
- Icon-only buttons have labels/tooltips.
- Permission dialogs are keyboard usable.
- Reduced motion is respected.
- Long French/German labels do not overflow critical controls.
- CJK text renders cleanly.

Visual regressions are classified separately from component correctness. Renderer tests
prove behavior and accessibility semantics; screenshot baselines prove rendered geometry
and styling; focused human review proves that a changed composition remains calm, legible,
and faithful to the Simplicity First contract. None of these layers substitutes for the
others.

## 11. Performance Gates

Use `docs/PERFORMANCE_AND_RELIABILITY.md` as the source of performance budgets.

Required gates:

- Warm Library render for 10,000 pages under target.
- Lexical search over target metadata under target.
- Renderer remains responsive during OCR, indexing, backup, and restore.
- Idle memory stays below target where Electron overhead allows.
- Ordinary active memory stays below target outside heavy jobs.
- Heavy workers release memory after completion.
- Safe Home draft propagation meets the p95 overhead target without typing/timeline
  regression, unbounded event growth, or draft replay after restart.
- Backup and restore show progress and can be cancelled safely where feasible.

## 12. Documentation Control Gates

Documentation checks must verify:

- `docs/START_HERE_FOR_AI_AGENTS.md` remains the compact task router; the full governed inventory and lifecycle metadata live in the machine-readable document-map manifest.
- `docs/AI_DEVELOPMENT_GUIDE.md` is the only full internal start/handoff template owner. Other surfaces link to it or collect only the fields required by their own workflow.
- Routine implementation loads one task pack and relevant control sections, not the full design library; historical and research artifacts remain non-default.
- Local Markdown links, the document inventory, resource indexes, parser/OCR manifest alignment, placeholder reclamation, and review freshness pass their focused verifiers.
- The traceability verifier proves unique Requirement definitions, complete P0 coverage, normalized Requirement/Build/Exit mappings, exact evidence, structured open work, phase completion, and all mutation cases. This document does not repeat those registries or mutation catalogs.
- The PRD contract verifier proves one AI-native authority statement, ordered product
  priorities, a default user model, observable/degraded states, exact 151/9/10
  P0/P1/P2 scope, registered owner references, and absence of current-status or
  technical-owner leakage; its mutation suite must reject structural, scope, evidence,
  dependency/model, type/schema, path, and owner-reference regressions.
- Decision Log verification passes for unique/date-aligned IDs, required rationale/consequences/references, legal lifecycle state, bidirectional supersession, and stale temporal wording.
- Cross-document contract verification passes for stable IDs, Markdown/source authority, Job lifecycle, asset roots, backup/restore, provider, permissions, secret use, and model egress.
- Documentation leanness verification enforces an always-read attention budget, single-owner projections, normalized trace manifests, a bounded inventory, and material reduction from the audited baseline. Its copy/paste gate rejects every unapproved repeated short normative line, consecutive list or table-data window, mixed multiline block, external URL, same-name typed declaration, and exact or high-coverage long prose/fenced block; each run also executes mutation and false-positive controls.
- The manifest-backed documentation scorecard reports at least `9.5/10` independently for all five dimensions.
- Fixture and release-evidence paths remain centralized in `docs/REPOSITORY_STRUCTURE.md`, not duplicated as conflicting ad hoc paths.

### 12.1 Documentation System Scorecard

Documentation-system quality is measured as five independent scores on a 0-10 scale. The executable gate definitions live in `resources/documentation-quality/documentation-quality.manifest.json`; physical/context budgets are separately declared in `resources/documentation-quality/documentation-leanness.manifest.json`. The current independent review, reviewer scopes, coordination acknowledgement, and reviewed snapshot hash live in `resources/documentation-quality/independent-review.recipe.json`. `npm run verify:documentation-quality` validates both layers and writes generated reports under `artifacts/documentation-quality/`.

Each dimension must score at least `9.5`. The accepted score is the lower of its automated weighted-gate score and its current independent-review score. Passing lightweight formatting checks cannot compensate for an unresolved critical gate: any open security-report routing error, durable-data ambiguity, incompatible normative contract, false-positive traceability check, or unmapped v0.1 release requirement caps the affected dimension below `9.5`.

| Dimension | What must be demonstrably true |
| --- | --- |
| Navigation and resource lifecycle | Every repository Markdown file has exactly one document-map row with tier, owner role, default-read behavior, lifecycle disposition, and review trigger; all local links and anchors resolve; current, historical, generated, and deferred material are distinguishable; orphaned or duplicate guidance has an explicit merge, archive, or removal path. |
| Cross-document contract consistency | Each durable or security-sensitive contract has one named owner and, where implemented, one shared executable schema; summaries link to that owner instead of redefining incompatible enums; stable IDs, source records, jobs, permissions, providers, operations, backup/restore, and cloud egress pass contract checks and migration compatibility is explicit. |
| Continuous traceability and acceptance closure | Every PRD P0 bullet maps to an active requirement; every requirement maps to an owner source, Milestone gate, implementation Phase gate, Build, Exit, verification class, status, and exact evidence selector or planned target; every Exit has its own status/evidence record; phase completion fails while any mapped requirement or Exit is incomplete; historical material cannot prove implementation, while recipe-backed generated release reports under `artifacts/` can. |
| Support for ongoing development | One phase plan and one milestone-to-phase crosswalk exist; current implementation status is honest and centralized; task packs identify requirement, service, durable owner, risk boundaries, tests, and docs; verification runs in normal CI; handoffs and concurrent sessions can discover contract changes without pausing unrelated implementation. |
| Documentation leanness and maintainability | The always-read pack has a measured attention budget; each normative fact, template, enum, and registry has one manual owner; other surfaces use bounded summaries or links; projections are normalized; document count and physical volume cannot grow invisibly. |

Scoring rules:

- The manifest must assign exactly `10.0` total weight to each dimension and a stable ID to each gate.
- Automated gates must be reproducible from repository contents; manual gates must name concrete file/section evidence and an owner for re-review.
- A manual gate cannot be marked passed by an unsupported assertion. Its evidence must identify the resolved contract or verification artifact.
- Independent scores must name a reviewer who did not implement that dimension, contain zero blockers, bind to the reviewed repository snapshot, and expire when that governed snapshot changes.
- The independent snapshot covers public/documentation surfaces, control manifests, verifier code, and shared executable schemas. Broad active implementation/test trees stay outside that manual hash; focused automated gates execute their current code and evidence on every verification run, so normal feature work does not require an unrelated manual documentation re-review.
- Total line/word/byte budgets retain at least a five-percent reduction from the audited baseline while leaving room for normal owner-contract evolution. The document-count cap is a reviewed ratchet: it may rise only with a distinct owner role, complete map/lifecycle metadata, router links, and evidence that an existing owner cannot hold the contract cleanly.
- Copy/paste exclusions come only from Historical, Prototype evidence, or dedicated decision-ledger classifications in the document map. Necessary retained copies require a normalized content fingerprint, canonical owner, exact occurrence set, rationale, and review trigger; path-wide exclusions and nonzero unapproved baselines are invalid.
- Historical audits are evidence of past review, not proof of current implementation or current contract consistency.
- The five traceability score gates run separate checks: ID/owner integrity, PRD P0 coverage, Requirement-Build-Exit mapping, Phase/Milestone ownership, and status/evidence/phase-completion integrity. Reusing one aggregate boolean for all five is prohibited.
- The semantic lock covers the P0 ledger plus domain-scoped PRD claims for contract
  authority, product definition and optimization, the complete default-user/concept
  model, observable states, scope interpretation, P1/P2, non-goals, input/workflows,
  knowledge outputs, extensions/localization, model/backup/trust, acceptance scenarios,
  and risks. PRD restructuring may update only reviewed scoped digests; it cannot
  silently change delivery, status, or evidence claims.
- The four executable contract score gates also run separate verifiers: stable vocabulary, Job/recovery/error lifecycle, source/root/backup lifecycle, and provider/permission/settings/model-egress safety. CON-003 and CON-004 execute their focused integration tests; repeating the aggregate contract verifier for multiple points is prohibited.
- Generated release evidence is valid only under `artifacts/`, with an existing committed recipe or fixture manifest, exact report selector, passing status, generation timestamp, and matching recipe SHA-256. It is not historical material and cannot replace or silently drift from its recipe.
- `PIGE-DOC-005` and E0.11 can be `verified` only while a recipe-hash-bound independent report covers the exact current governed snapshot and all five accepted scores meet the threshold; automated self-scoring alone cannot promote them.
- Any behavior or contract change that invalidates a gate must update its evidence in the same change.
- Release verification reports all five scores separately. An average above `9.5` does not compensate for a dimension below `9.5`.

### 12.2 Repository Structure Gates

Scaffold and CI checks must verify:

- Workspace packages exist according to `docs/REPOSITORY_STRUCTURE.md`.
- `packages/*` do not import from `apps/desktop`.
- Renderer code does not import main-process services, adapters, Node filesystem APIs, SQLite, keychain, shell, parser tools, model providers, or secret APIs.
- Shared package code does not depend on Electron or renderer-only UI libraries.
- Type-check, lint, and tests run across all workspace members.
- Path aliases resolve consistently in app code, packages, tests, and scripts.
- Fixture manifest validation passes for committed fixtures and generated fixture recipes.
- Release evidence reports follow the generated artifact layout and redaction rules from `docs/REPOSITORY_STRUCTURE.md`.

## 13. Release Gates

Before alpha release:

- CI type-check passes.
- Unit tests pass.
- Integration tests pass.
- Smoke tests pass on supported platforms.
- License notice generation passes.
- Dependency registry is current.
- Dependency manifest schema, registry coverage, lockfile coverage, license status, and checksum/signature policy checks pass.
- Security policy exists, is linked from README/CONTRIBUTING, and private vulnerability reporting readiness is checked before public alpha.
- Privacy policy exists, is linked from README/CONTRIBUTING, and matches release data-flow tests for BYOK, telemetry, diagnostics, update checks, optional downloads, and Skill/package network use.
- Support policy exists, is linked from README/CONTRIBUTING, and public issue/support guidance forbids private vaults, raw source files, secrets, raw prompts/responses, and unreviewed support bundles.
- Code of conduct exists; issue and PR templates exist and require redacted reproductions, requirement sources, tests, docs updates, and privacy/security/support checks.
- Installer size report is generated.
- Auto-update metadata is generated and tested in alpha channel.
- The upgrade scenario creates a backup before update and validates restoration after it.
- Public Alpha usability scenario report passes on macOS and at least one supported Windows target, or any platform gap is explicitly listed as a release blocker/known limitation.
- No critical security or data-loss issue remains open.

Supply-chain test gates:

- No production/runtime dependency, bundled binary, optional downloadable model, provider SDK, parser/OCR tool, release action, or CI security tool may exist without a `resources/dependency-manifest/` record.
- Every dependency manifest record must reference an existing Technical Architecture registry entry.
- Dependency manifest files must validate against `resources/dependency-manifest/dependency-manifest.schema.json`.
- `package.json`, lockfiles, bundled tool manifests, model manifests, provider catalog snapshots, GitHub Actions workflows, release scripts, and parser/OCR manifests must be covered by `dependencies.manifest.json` or a non-expired waiver.
- Manifest records for bundled binaries and model downloads must include checksum or signature policy, even when the policy is "upstream unavailable, warn user before install".
- License notice tests must use the manifest as input so missing notices block release.
- Expired waivers block release, and waivers cannot cover unknown executable provenance, unclear licensing, hidden task-time downloads, secret exposure, or renderer trust-boundary bypass.

## 14. Test Naming Convention

Recommended test names:

```txt
service.behavior.expected-result.test.ts
```

Examples:

- `vault.path-blocks-traversal.test.ts`
- `vault.location-settings-do-not-write-active-path-to-manifest.test.ts`
- `vault.open-create-switch-preserves-existing-files.test.ts`
- `capture.large-paste-stores-raw-reference.test.ts`
- `permissions.deny-shell-leaves-job-stable.test.ts`
- `backup.default-excludes-secrets.test.ts`
- `search.cjk-lexical-fallback.test.ts`

## 15. AI Implementation Checklist

Before an AI agent marks a task complete:

- Which tests prove the main behavior?
- Which tests prove the failure path?
- Which tests prove no data loss?
- Which tests prove no secret leakage?
- Which tests prove no permission bypass?
- Which tests prove backup/restore or rebuild behavior?
- Which tests prove I18N/accessibility if UI changed?
- Which governed screenshots prove visual fidelity if UI changed, or which exact matrix
  entries remain open because a real packaged desktop session was unavailable?
- Which performance gate applies?
- Which release gate is affected?

If tests cannot run, the final handoff must say exactly why.
