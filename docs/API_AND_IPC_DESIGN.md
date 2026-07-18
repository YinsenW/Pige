# API And IPC Design

Status: Draft baseline
Date: 2026-07-09

## 1. Purpose

This document defines Pige's internal API and IPC contracts.

v0.1 is a desktop app, not a public web API product. The important API surface is the typed boundary between renderer, preload, main process, workers, services, and future runtime adapters.

## 2. Principles

- Renderer is presentation only.
- Preload exposes a narrow typed API.
- Main process owns filesystem, secrets, settings, model calls, and orchestration.
- Workers own expensive parsing, OCR, embedding, backup, and rebuild work.
- IPC payloads are serializable DTOs, not service objects.
- IPC never carries raw API keys.
- Renderer never receives arbitrary filesystem capability.
- Long-running work is represented by jobs and progress events.

## 3. API Categories

Use command/query/event naming.

- Command: changes state or starts work.
- Query: reads state.
- Event: pushes state changes.

Example names:

```txt
vault.open
vault.create
jobs.cancel
library.query
agent.submitTurn
agent.turnDraft
notes.open
notes.saveDraft
permissions.resolve
settings.update
settings.setLocale
system.toolchainHealth
agent.runtimeStatus
window.setMode
window.setAlwaysOnTop
backup.status
backup.create
```

## 4. Common Envelope

```ts
type ApiRequest<T> = {
  requestId: string;
  apiVersion: 1;
  payload: T;
};

type ApiResult<T> =
  | { ok: true; requestId: string; value: T }
  | { ok: false; requestId: string; error: PigeError };
```

```ts
type PigeErrorDomain =
  | "vault"
  | "capture"
  | "source_storage"
  | "parser"
  | "ocr"
  | "rag"
  | "model_provider"
  | "agent_runtime"
  | "permission"
  | "skill"
  | "package"
  | "backup"
  | "restore"
  | "database"
  | "settings"
  | "speech"
  | "update"
  | "diagnostics"
  | "renderer"
  | "release"
  | "unknown";

type PigeErrorAction =
  | "none"
  | "retry"
  | "choose_path"
  | "repair_tool"
  | "download_model"
  | "configure_model"
  | "confirm_model_egress"
  | "grant_permission"
  | "review_proposal"
  | "rebuild_index"
  | "restore_backup"
  | "open_settings"
  | "contact_support";

type PigeError = {
  code: string;
  domain: PigeErrorDomain;
  messageKey: string;
  messageParams?: Record<string, string | number | boolean>;
  retryable: boolean;
  severity: "info" | "warning" | "error" | "fatal";
  userAction: PigeErrorAction;
  jobId?: string;
  permissionRequestId?: string;
  modelEgressApprovalRequestId?: string;
  diagnosticErrorId?: string;
  redactedDetails?: Record<string, string | number | boolean>;
};
```

`PigeErrorDomainSchema`, `PigeErrorActionSchema`, `PigeErrorSeveritySchema`, `PigeErrorSchema`, and the related Job/diagnostic error schemas in `packages/schemas/src/index.ts` are the executable authority. `packages/contracts/src/index.ts` re-exports their inferred types for API, preload, service, and renderer consumers; another process or document must not create a second enum vocabulary.

Errors should be localizable and safe to show in diagnostics.

Error code rules:

- `code` uses stable lower-case namespaces: `<domain>.<reason>` or `<domain>.<reason>.<detail>`, for example `parser.tool_missing` or `model_provider.auth_failed`.
- Error codes must not include vault IDs, source IDs, paths, provider keys, user text, model output, or other private data.
- `messageKey` should normally be `errors.<code>` and must exist in every v0.1 locale.
- `messageParams` may contain safe counts, durations, display names, or redacted labels only.
- Shared warning/error objects are strict: unknown fields such as raw prompts, response/source bodies, or private paths are rejected instead of being preserved beside `redactedDetails`.
- Renderer UI chooses affordances from `severity`, `retryable`, and `userAction`; it must not parse localized text to decide behavior.
- Home classifies only exact `model_provider.call_failed` as provider-call failure;
  `model_provider.binding_changed` becomes binding repair. Other typed Host errors keep
  their safe code with body-free Agent repair; only unknown non-domain exceptions fall back.
- Recoverable Agent-output/tool validation is internal Pi progress, not an API/UI error.
  It keeps the same Job active; first invalid/omitted candidates alone do not emit
  `model_provider.output_invalid` or `agent_runtime.knowledge_action_missing`. Terminal
  external/incompatibility failures remain body-free.

Internal Agent repair result; this never crosses renderer IPC directly:

```ts
type AgentRepairFeedback = {
  apiVersion: 1;
  kind: "repair_required";
  category:
    | "schema_invalid"
    | "tool_input_invalid"
    | "grounding_invalid"
    | "citation_invalid"
    | "evidence_stale"
    | "result_incomplete";
  fieldRefs: string[];
  allowedOpaqueRefs: string[];
  repairHintKey: string;
  failureFingerprint: string;
};
```

`fieldRefs`, opaque refs, and fixed `repairHintKey` values are bounded and Host-authored.
They contain no model/source body, prompt, raw tool arguments, path, endpoint, credential,
policy secret, or private diagnostic detail. Authority/safety denial is a distinct blocked
tool result and cannot be converted into `repair_required`.

## 5. Event Model

```ts
type PigeEvent =
  | { type: "job.updated"; job: JobSummary }
  | { type: "capture.received"; sourceId: string; jobId: string }
  | { type: "permission.requested"; request: PermissionRequestSummary }
  | { type: "vault.changed"; vault: VaultSummary }
  | { type: "index.progress"; progress: IndexProgress }
  | { type: "backup.progress"; progress: BackupProgress };
```

Rules:

- Events are incremental.
- Renderer subscribes by domain.
- Event payloads are paged or summarized for large data.
- Event logs must not include secrets or large source asset bodies.

## 6. Required API Domains

### 6.1 Vault

Current renderer/preload commands: `onboarding.dismissFirstHome`, `vault.revealKnowledgeRoot`, and `vault.revealSourceAssetRoot`.

Internal compatibility/recovery commands: `vault.create`, `vault.open`, `onboarding.complete`, `vault.updateSourceStoragePolicy`, `vault.removeRecent`, `maintenance.rebuildLocalDatabase`, and `maintenance.resetLocalDatabase`.

Queries: `vault.current`, `vault.recent`, `vault.health`, `onboarding.status`, and `maintenance.localDatabaseStatus`.

Vault DTOs:

```ts
type VaultSummary = {
  vaultId: string; name: string;
  activeVaultPathDisplay: string; knowledgeRootDisplay: string; sourceAssetRootDisplay: string;
  sourceAssetRootKind: "inside_vault" | "external_binding";
  defaultSourceStorageStrategy: "copy_to_source_library" | "reference_original";
  schemaVersion: number; counts?: { notes: number; sources: number; managedSourceCopies: number; referencedOriginals: number };
  lastBackupAt?: string;
};

type VaultRevealResult =
  | { status: "revealed"; target: "knowledge_root" | "source_asset_root" }
  | { status: "failed"; target: "knowledge_root" | "source_asset_root"; error: PigeErrorSummary };
```

`sourceAssetRootDisplay`/`sourceAssetRootKind` are schema-v1 compatibility names for the managed-copy root, not the `<knowledgeRoot>/artifacts` root. Renaming must be versioned; renderer code cannot infer path relationships from display text.

Storage reveal is main-owned and pathless: main resolves the root from the active-vault lease and bounded no-follow config; preload admits exact target/result keys. Unavailable external bindings never fall back to the vault. Identity checks fail to `vault.reveal_failed`; final check-to-shell TOCTOU remains.

Onboarding DTO:

```ts
type OnboardingStatus = {
  state: "blocked_no_vault" | "capture_only" | "ready";
  activeVault?: VaultSummary;
  hasDefaultModel: boolean;
  showFirstHomeGuide: boolean;
  waitingDependencyCounts?: {
    modelProvider: number;
    localTool: number;
    localModel: number;
    runtimeCapability: number;
    vaultBinding: number;
    externalSource: number;
  };
};
```

`vault.openRecent` takes `{ vaultId }` and returns `VaultActionResult`; main revalidates the binding.
`pathDisplay` is never authority and failures return no path.

Local database status DTO:

```ts
type LocalDatabaseRebuildResult = {
  rebuiltAt: string;
  pageCount: number;
  invalidPageCount: number;
  jobId?: string;
  state?: JobState;
};

type LocalDatabaseStatus = {
  driver: "pending_sqlite_driver" | "better_sqlite3" | "node_sqlite";
  appSchemaVersion: number;
  appliedMigrationCount: number;
  status: "not_initialized" | "ready" | "needs_rebuild" | "error";
  updatedAt: string;
};
```

Rules:

- The renderer may display these paths, but it never receives direct filesystem capability.
- First-run, capture-only mode, and onboarding state follow `docs/ONBOARDING_AND_FIRST_RUN.md`.
- `onboarding.dismissFirstHome` takes no renderer-supplied vault ID. Main resolves the
  active vault, records only its stable ID in bounded machine-local settings, and returns
  refreshed `OnboardingStatus`; the preference is idempotent, non-secret, and excluded
  from vault files and backup.
- `vault.create` takes a parent folder and vault name selected through a trusted OS file dialog.
- `vault.open` takes a folder selected through a trusted OS file dialog and validates Pige compatibility.
- Active vault path and recent vault list are machine-local settings; they are not written into `.pige/manifest.json`.
- Updating an external managed-copy root creates/selects a machine-local binding keyed by `vaultId` plus stable `rootId`; in-vault managed-copy roots use relative vault preferences. Existing source records retain their recorded root ID.
- `maintenance.rebuildLocalDatabase` creates an `index_rebuild` job before rebuilding the active vault's SQLite page metadata and FTS index from durable Markdown. It returns rebuild counts plus the completed job ID when the immediate foundation runner succeeds.
- The current runner may execute the rebuild body synchronously after job creation; large-vault release readiness requires moving that body to worker/job execution with progress and cancellation.
- `maintenance.resetLocalDatabase` deletes and recreates only `.pige/db`, `.pige/indexes`, and `.pige/cache`; it must not delete Markdown knowledge, raw source assets, source records, conversations, jobs, proposals, operations, memory, skills, or trash.

### 6.2 Capture

Production semantic command:

- `agent.submitTurn`

Main does not register `capture.submitText`, `capture.submitFiles`, or
`capture.submitUrl`. Capture request/result types remain internal preservation and
historical-test contracts, not renderer IPC capability.

Rules:

- Text is preserved once before its Source/event/Job; large bodies remain source refs.
- URL capture is main-only HTTP(S): validated/pinned public addresses, bounded redirects/
  deadlines/decoded bytes, inert worker extraction, redacted metadata/query secrets and
  checksummed raw/extracted artifacts. Conversation/renderer receive only safe refs,
  IDs and status, never HTML/DOM/headers/dispatcher/credentials.
- Preload resolves one selected file via `webUtils`; main preserves before linking the
  draft/ref to one `agent_turn`. Capture services and legacy request types remain
  internal; the removed renderer/Main handlers do not.
- `CurrentSourceRecordSchema` requires top-level `semanticOrchestration` as
  `agent_turn | capture_only` for all new text/file/URL writes. `SourceRecordSchema`
  normalizes a pre-field record to `legacy_agent_ingest`; unknown values reject.
- Files allow Markdown/TXT/PDF/DOCX/PPTX/common images and obey the active copy/reference
  policy. Each accepted file has one Source/event/Job; rejections use display names only,
  and renderer/history receive no body, arbitrary path, or handle.
- Preserved text/Markdown/TXT/URL may produce minimal pages; documents/images remain
  metadata-only until Pi selects parse/OCR. Home observes safe Job summaries.
- OCR stays behind main-owned `OcrPort`. New parser/OCR/Dataset children execute only an
  exact Pi-selected capability effect or recover that effect; they do not wake a Host-
  selected successor. Jobs admits legacy auto-chain only for exact
  `legacy_agent_ingest`.

#### 6.2.1 Native Speech Session

Channels: `speech.availability`, `speech.installLanguageAsset`, `speech.start`,
`speech.stop`, `speech.cancel`, `speech.openSystemSettings`; strict event channels:
`speech.sessionEvent`, `speech.assetInstallEvent`.

Rules:

- One sender session fails stale identity/sequence/teardown closed; Stop yields editable
  text without submit/Job/source/model. Audio/handles never cross preload or enter storage,
  diagnostics, backup or models; explicit start alone requests microphone permission.
- Availability/start never download. Explicit exact-language Apple install emits API v1
  monotonic `progress | installed | failed` without asset/audio/path/URL/raw error; success
  re-probes and still needs Start. No reliable cancel exists: UI locks focus/route/locale,
  while teardown only detaches events. Persisted dictation language remains open.

### 6.3 Jobs

Job DTOs/events follow `docs/JOB_OPERATION_AND_RECOVERY.md`; `JobClass`, `JobState` and
durable `state` come from schemas. IPC adds no aliases; `status` is action-result-only.

Commands:

- `jobs.retry`
- `jobs.cancel`

Queries:

- `jobs.list`
- `jobs.get`

Historical Agent ingest compatibility:

- `agent_ingest` remains only for typed `legacy_agent_ingest` records and exact recovery
  during one migration window; current records cannot create one.
- Background recovery is main-owned. Renderer observes safe progress through `jobs.list`.
- When a default model is configured later, a waiting historical `agent_ingest` Job may
  requeue with its exact source/checkpoint/proposal/Operation identity and without
  duplicating source pages.
- Low-confidence/warning output uses non-blocking `needs_review` quality metadata and
  `completed_with_warnings`; that marker is not permission or mandatory approval.
- Job summaries never expose prompts, raw model responses, provider request headers, API keys, managed source paths, or source bodies.

Phase 2 job list DTO:

```ts
type JobsListRequest = {
  limit?: number;
  states?: JobState[];
  classes?: JobClass[];
};

type JobSummary = {
  id: string;
  class: JobClass;
  state: JobState;
  sourceId?: string;
  captureId?: string;
  conversationEventId?: string;
  sourceDisplayName?: string;
  sourceKind?: SourceKind;
  backupKind?: "user_backup" | "restore_rollback";
  error?: PigeErrorSummary;
  stage?: JobStage;
  progress?: JobProgress;
  message: string;
  createdAt: string;
  updatedAt: string;
};

type JobsListResult = {
  scannedAt: string;
  activeVaultId: string;
  total: number;
  invalidJobCount: number;
  jobs: JobSummary[];
};

type JobActionRequest = {
  jobId: string;
};

type JobActionResult = {
  status: "cancel_requested" | "cancelled" | "requeued" | "not_found" | "not_allowed";
  reason?: string;
  job?: JobSummary;
};
```

Rules:

- `jobs.list` scans the active vault's durable `.pige/jobs/` records and returns safe summaries for Home status.
- Summaries may include source display name/kind and Backup ownership/error types, never
  record/copy/original/destination paths, bodies, prompts, responses, secrets, raw error
  detail or archive internals. Settings filters rollback children.
- Invalid job JSON is counted and skipped so Home can still open.
- `jobs.cancel` directly cancels eligible queued/waiting/retryable work only with a
  false/absent action-safety guard; active process-local parse/OCR/`agent_turn`/Agent
  ingest/`index_rebuild` becomes idempotent `cancel_requested`. Running capture remains non-cooperative.
- `jobs.retry` updates eligible `failed_retryable`, `waiting_dependency`, or `cancelled` jobs back to `queued` for later processing.
- Before a queued/waiting/retryable Job is written as `cancelled`,
  `durableWritesApplied: true` returns `not_allowed` unchanged; retry retains this guard.
  Active parse/OCR/`agent_turn`/Agent ingest/`index_rebuild` may still become
  `cancel_requested`. Capture/parse/OCR/Agent-ingest writers persist a real pre-publication checkpoint before their first
  domain effect; the Job write must succeed before publication. Abandon/archive is separate.
- `jobs.list` exposes persisted stage/progress by polling; numeric Home rendering and pushed progress events remain open.
- Source-page projection is internal, not renderer-exposed. Document/image parse or OCR
  children require Pi tool events.
- Direct-image OCR uses the same durable Job actions: no-capability parents wait without a child, recovery requeues them, retry reuses one child, cancellation reaches active OCR, and safe summaries never return private paths.

### 6.4 Exceptional Change Proposals

All legacy renderer proposal channels currently fail closed with a body-free error:

- `proposals.list`
- `proposals.get`
- `proposals.approve`
- `proposals.reject`

Legacy list/get/decision DTOs stay Main-internal. A future renderer projection must use
localized keys and bounded diff lines, excluding model-generated summary/reason, paths,
full content, base hashes, source bodies, and Operation internals.

Rules:

- Records live under `.pige/proposals/YYYY/MM/`. Durable service list/get/decision stays
  Main-internal for recovery/tests; invalid records are skipped.
- Approve applies only the exact Job-scoped Pi create note under `wiki/generated/`:
  `approved` -> page/index/Operation -> `applied` -> idempotent log -> parent. Generic
  apply is `not_allowed`; generic reject remains state-only.
- Main-owned recovery rereads rejected calls; exact proposal writes are ordered, not transactional.
  Generic apply/replacement, CAS/TOCTOU, and platforms remain open.
- Main-owned historical approval/rejection/reconciliation remains available to recovery
  services even while renderer decision channels fail closed.
- New `agent_turn` exposes no legacy proposal-stage tool until a bounded renderer preview
  and decision owner exists; historical `agent_ingest` may still stage/recover old records.

#### 6.4.1 Knowledge Activity And Undo

`activity.list` (default 5, max 20) returns safe `create_page | update_page` summaries,
never paths/hashes/bodies/source/Provider data. `activity.undo` rechecks live checksum:
create uses private trash + `trash_page`; update restores exact before bytes + inverse
`update_page`; both schedule rebuild. Hashless/changed/missing/malformed/other Operations
stay ineligible; restore/redo and broad routing/history remain open.

### 6.5 Library And Notes

Queries:

- `library.list`
- `library.tree`
- `library.related`
- `notes.get`
- `notes.render`
- `notes.resolveInlineReference`

Later commands:

- `notes.saveDraft`
- `notes.applyProposal`
- `notes.rejectProposal`

Current bridge queries:

- `library.list({ limit?, pageTypes? })` reads the Local Database index or scans active-vault
  `sources/`/`wiki/` frontmatter when unavailable. It skips/counts invalid files and returns
  only page ID, title, type, status, relative page path, timestamps, language, and source IDs.
- `library.tree()` returns one body-free rebuildable aggregate with stable refs and metrics,
  or a typed degraded empty result. `library.related({ pageId, limit? })` returns resolved
  outgoing/backlink summaries plus visible target text, or an empty degraded result; neither
  query fabricates hierarchy, exposes unresolved files, or falls back to renderer file access.
- `notes.get({ pageId })` returns a stable-ID-resolved summary, frontmatter-free Markdown
  body, and byte size. `notes.render({ pageId })` substitutes sanitized HTML and may add an
  opaque sender-owned `renderContextId` when href extraction is bounded. The token authorizes
  only hrefs in that render and is neither durable state nor filesystem authority.
- Library/Notes never accept arbitrary paths or return source-record/managed-copy/original
  paths, bodies, prompts, model responses, secrets, raw frontmatter, handles, executable raw
  HTML, scripts, event handlers, or unsafe links. Main owns all Markdown/filesystem access.

Reader inline-reference query contract:

- Request is strict `apiVersion: 1`, `requestId`, `activeVaultId`, `currentPageId`,
  `renderContextId`, and a 1,024-byte internal `#wiki:`/`#source:` `href`.
- Result echoes version/request ID. `resolved` adds either `{ kind: "page", pageId }` or
  `{ kind: "source", sourceId, pageId, locator? }`; `ambiguous`, `not_found`, and `failed`
  add nothing; `stale` adds only `scope: "vault" | "page" | "render_context"`. Paths,
  bodies, candidates, prompts, secrets, and raw errors are forbidden.
- This query emits no event. Renderer correlates `requestId` and consumes only
  `target.pageId`; `sourceId`/`locator` grant no separate action. Technical Architecture
  owns sender, context, page, index/watcher, and post-lookup fences; uncertainty fails closed.

Current Home Dataset read boundary:

- Existing `agent.submitTurn` may return one bounded Dataset result preview and exact
  Dataset citation after Pi selects the typed local query tool; `agent.conversation`
  restores that checksum-bound result after restart. Renderer receives display columns,
  bounded typed rows, counts, truncation, and citations—not paths, database handles, SQL,
  query-engine metadata, payload bytes, or whole tables.
- The main process binds the active vault, manifest/revision/schema/payload and Source
  Record privacy revision. Stale evidence writes the current body-free replacement audit
  and fails before another model turn; corrupt or unsafe evidence fails closed.
- No standalone Dataset IPC channel exists in this slice. Library paging, citation-open
  highlighting, independent Dataset browsing, and public query-builder APIs remain open.
- Managed Collection mutations later use separate commands that bind expected revision
  and produce Operation/Activity/Undo.

### 6.6 Retrieval

Commands:

- `agent.submitTurn`
- `agent.ask`
- `retrieval.ask`
- `retrieval.saveAnswer`

Queries:

- `agent.conversation`
- `retrieval.search`

Events:

- `agent.turnDraft`

Library `retrieval.search` accepts active-vault scope, at most 320 Unicode code points and
optional limit/page types. Preload/main validate and fence active vault before/after work
and on result. Responses bound IDs, relative Markdown paths, snippets and match reasons;
body-free errors exclude bodies, absolute paths, vector/policy details and uncalibrated
scores. Other DTOs follow
`docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`.

Schema-v1 `agent.submitTurn` binds optional client/conversation/tail IDs and strict
`current_note` page ID; preload projects no path. Exact retry adopts its event/Job;
changed binding/scope or stale tail fails before Job/Pi. `agent.conversation` requires
matching scope and returns at most 100 bounded messages, tail, follow-up eligibility and
safe latest Job; Home asks for 24. Results exclude bodies, paths, prompts, credentials,
endpoints and raw errors. Legacy handlers remain readable; save-answer/multi-attachment
recovery stays open.

`agent.turnDraft` is a sender-scoped presentation event for an active
`agent.submitTurn`, not a durable result or raw runtime stream:

```ts
type AgentTurnDraftEvent = {
  apiVersion: 1;
  kind: "draft_replace";
  requestId: string;
  clientTurnId: string;
  jobId: string;
  conversationId: string;
  conversationEventId: string;
  sequence: number;
  text: string;
};
```

Rules:

- Main sends only to the WebContents that initiated the exact turn. All IDs must match
  the active request/Job/user event, and `sequence` increases monotonically from one.
- `text` is the complete replacement snapshot, not an append delta. It is non-empty,
  escaped by renderer, bounded by the final 8,000-character answer limit, and may shrink
  when the provider repairs an in-progress tool argument.
- Main emits only bounded answer snapshots from a reviewed Pi-owned answer/parsed terminal
  channel after control/restricted-content filtering. It never starts a second provider
  turn solely to reproduce an already generated final for presentation. A repair may
  replace or shrink the provisional answer; incomplete or changed draft text is not a Job
  failure and never bypasses final validation.
- The Host must not parse or forward partial JSON, pre-authorization/generic Pi text,
  thinking, tool arguments, citations, grounding, model/provider identifiers, raw
  payloads, errors, or credentials. Draft delivery grants no new authority and never
  changes the accepted final result.
- Main coalesces updates to a bounded rate. Renderer ignores stale, duplicated,
  out-of-order, wrong-sender, or wrong-turn events and replaces one escaped draft bubble;
  it never appends fragments into durable conversation state.
- The completed `agent.submitTurn` result and durable `agent.conversation` event remain
  authoritative. An accepted final replaces the latest repaired draft atomically;
  cancellation or a true external block clears/marks it through localized state, stops
  later events, and never persists provisional text. Intermediate validation rejection
  stays inside Pi and does not produce a renderer retry action.
- Reconnect/restart does not replay drafts. It reads only the durable conversation/Job
  result and may resume the Job through the existing recovery contract.

### 6.7 Permissions

#### 6.7.1 Current-Action Model Egress

Commands:

- `modelEgress.resolve`

Queries:

- `modelEgress.pending`

`modelEgress.pending({ requestId })` returns only the exact pending request's Job,
Provider/Model profile IDs, reason, bounded content classes, and request time. It never
returns the endpoint, prompt, selected evidence, response, credential, citation body, or
Permission Broker record. `modelEgress.resolve({ requestId, jobId, decision })` accepts
only `allow_once` or `deny`, commits the machine-local decision, then reconciles the
exact `waiting_model_egress` Job. Renderer uncertainty is resolved by re-reading
`modelEgress.pending`; unreadable or changed identity fails closed.

This namespace authorizes only the bound current provider invocation. It cannot create
or consume a saved Permission Broker grant, and YOLO cannot satisfy it. The active Home
confirmation owns the single status/action surface; its matching Job is omitted from
Recent Work until resolution, then ordinary Job status ownership returns.

#### 6.7.2 Permission Broker

Commands:

- `permissions.resolve`
- `permissions.settings.setDefaultMode`
- `permissions.settings.prepareYoloEnable`
- `permissions.settings.enableYolo`
- `permissions.settings.disableYolo`
- `permissions.settings.revokeGrant`
- `permissions.settings.revokeAllGrants`

Queries:

- `permissions.pending`
- `permissions.settings.current`

The current-action prompt accepts only `deny` or `allow_once`; creating a reusable scoped
grant remains deferred. `permissions.pending({ requestId })` returns one bounded typed
summary: request/Job IDs, reviewed actor display/type/version, capability/data boundary,
action label, resource scope/kind/count, reason code and creation time. It never returns
raw action input, paths, commands, hashes, credentials, bodies, store records, or model
reasoning. The prompt solely owns its matching Job status/actions.

The body-free lifecycle binds exact vault, Job, actor/version/digest, action/version/input
hash, capability, resource identity/scope, policy/runtime context and binding hash.
`permissions.resolve({ requestId, jobId, decision })` commits the exact decision; allow
resumes the same Job and consumes authority once only after current binding revalidation,
while deny executes nothing. IPC uncertainty rereads durable truth; unreadable, stale,
consumed-without-completion, or conflicting state fails closed without Retry authority.
Renderer receives no filesystem or capability handle.

Permission Settings is a separate renderer-safe owner over machine-local state.
`current()` projects only revision, effective default mode, YOLO status, and bounded saved
grant summaries; actor IDs/digests, resource identity hashes, paths, bodies, and secrets do
not cross IPC. All mutations compare `expectedRevision`. YOLO enablement is two-phase:
`prepareYoloEnable` owns the native strong warning, then returns a short-lived, one-use
token bound to the exact WebContents and revision; `enableYolo` consumes it. Sender loss,
expiry, replay, or revision drift fails closed. Disable and grant revocation take effect
immediately; the Permission Broker rechecks a YOLO-bound revision at consume and directly
before adapter execution.

### 6.8 Settings, Providers, Tools

Settings scopes and patch rules must follow `docs/SETTINGS_AND_PREFERENCES.md`.

Commands:

- `settings.update`
- `settings.getPage`
- `settings.setLocale`
- `agentPolicy.preview`
- `agent.runtimeStatus`
- `models.addPresetProvider`
- `models.addManualProvider`
- `models.refreshProviderModels`
- `models.updateProviderCredential`
- `models.deleteProvider`
- `models.addManualModel`
- `models.updateModel`
- `models.setDefaultModel`
- `tools.install`
- `tools.remove`

Queries:

- `settings.registry`
- `settings.appearance`
- `models.summary`
- `system.toolchainHealth`

Provider/model DTOs:

```ts
type DefaultModelBindingSummary =
  | { state: "not_configured" }
  | { state: "ready"; providerProfileId: string; modelProfileId: string }
  | { state: "configured_unusable"; providerProfileId?: string; modelProfileId?: string; error: PigeErrorSummary };

type ModelProviderSettingsSummary = { revision?: string; presets: ProviderPresetSummary[]; providers: ProviderProfileSummary[]; models: ModelProfileSummary[]; defaultModelProfileId?: string; hasDefaultModel: boolean; defaultBinding: DefaultModelBindingSummary };

type ProviderPresetSummary = { presetId: string; displayName: string; providerKind: ProviderKind; endpointProtocol: "openai_responses" | "openai_chat_completions" | "anthropic_messages"; fixedBaseUrl: string; authRequirement: "api_key" | "optional_api_key" | "none"; modelListStrategy: ModelListStrategy; cloudBoundary: CloudBoundary; apiKeyManagementUrl?: string };

type ProviderProfileSummary = { id: string; presetId?: string; displayName: string; providerKind: ProviderKind; endpointProtocol: ProviderEndpointProtocol; authRequirement: ProviderAuthRequirement; baseUrl?: string; modelListStrategy: ModelListStrategy; cloudBoundary: CloudBoundary; boundaryVerification?: BoundaryVerification; runtimeStatus?: { discovery: "not_checked" | "verified"; generation: "not_checked" | "verified" | "failed"; updatedAt?: string }; createdAt: string; updatedAt: string };

type ModelProfileSummary = { id: string; providerProfileId: string; modelId: string; displayName?: string; source: "provider_list" | "manual"; enabled: boolean; isDefault: boolean; createdAt: string; updatedAt: string };

type ProviderConnectNeedsManualModel = { status: "needs_manual_model"; reason: "select_bootstrap_model" | "discovery_unavailable" | "discovery_failed"; discoveredModels: Array<{ modelId: string; displayName?: string }>; error?: PigeErrorSummary };

type ProviderConnectResult = ModelProviderSettingsSummary | ProviderConnectNeedsManualModel;

type UpdateProviderCredentialRequest = { providerProfileId: string; expectedRevision: string; apiKey: string };

type DeleteProviderRequest = { providerProfileId: string; expectedRevision: string };
```

Profiles persist protocol/auth/preset identity; `defaultBinding` carries safe IDs/repair.
Opaque `sha256:` `revision` fences credential replacement/deletion. Connect probes before
all-or-restore commit; Refresh preserves inventory. Body-free session status separates
configured, discovery verified, generation verified/failed; discovery is not chat proof.

Secrets are passed only to the Settings and Secrets Service and are never echoed back.

Rules:

- Settings APIs return redacted page DTOs, not raw storage files.
- `settings.appearance` returns the current app locale and supported locale list. `settings.setLocale` stores the user override in machine-local settings and applies it without writing to the vault.
- Secret writes use dedicated secret handling and return secret references only.
- Provider create is write-only, authorized by the disclosed Settings Connect/Save
  gesture, probed before commit, secret-store-only, and returns redacted summaries.
  Failure changes nothing; main adds no second native trust dialog.
- Discovery needing a bootstrap ID returns `needs_manual_model` with zero writes; Custom
  may resubmit one transient ID. Manual IDs share the same inventory, which preserves
  alias/enabled/default on Refresh; replace default before disabling it.
- Credential update is write-only, native-confirmed, active-reference-guarded, and probes
  before atomic same-ref replacement; failure preserves the old key and neither key returns.
- Provider deletion is renderer/native-confirmed and active-reference-guarded; it removes
  owned models/credential, rebinds or clears default, and journal-recovers orphan-free.
- Setup never groups cloud/self-hosted/local; main retains boundary/egress enforcement.
- `agent.runtimeStatus` reports embedded Pi readiness and non-secret policy IDs. It uses profile summaries and presence-only binding metadata, never credential resolution/decryption; production emits only `embedded_pi_sdk`.
- v0.1 exposes one effective default Pi Agent model; Advanced/Fast model slots must not appear unless runtime routing support is real and tested.
- External/new-capability settings use Permission Broker; irreversible/security/
  destination/conflict settings use exceptional proposals. Ordinary reversible settings do not re-prompt.
- Settings updates include expected versions where concurrent edits or external vault changes are possible.
- Agent policy preview returns redacted, typed policy summaries for debugging/settings UI; it never returns raw secrets, full settings files, or permission-store internals.
- `system.toolchainHealth` reports bundled toolchain readiness or repair-needed status from `resources/toolchain-manifest/toolchain.manifest.json`; it does not trigger downloads.

Agent policy DTOs must follow `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`.

### 6.9 Diagnostics

Diagnostics APIs must follow `docs/DIAGNOSTICS_AND_OBSERVABILITY.md`.

Commands:

- `diagnostics.exportSupportBundle`
- `diagnostics.cancelSupportBundleExport`
- `diagnostics.clearLocalDiagnostics`
- `diagnostics.openSupportBundleFolder`

Queries:

- `diagnostics.health`
- `diagnostics.recentErrors`
- `diagnostics.previewSupportBundle`

Health DTO:

```ts
type DiagnosticsHealth = {
  status: "ok" | "degraded";
  checkedAt: string;
  localOnly: true;
  recentErrorCount: number;
  checks: Array<{
    id: string;
    status: "ok" | "warning" | "error";
    message: string;
  }>;
};
```

Support bundle DTOs:

```ts
type SupportBundleCategory = {
  id: string;
  label: string;
  included: boolean;
  reason: string;
};

type SupportBundlePreview = {
  previewId: string;
  generatedAt: string;
  localOnly: true;
  estimatedBytes: number;
  includedCategories: SupportBundleCategory[];
  excludedCategories: SupportBundleCategory[];
  privacyWarnings: string[];
};

type ExportSupportBundleRequest = { previewId: string; exportRequestId: string };
type CancelSupportBundleExportRequest = { exportRequestId: string };
type CancelSupportBundleExportResult = { status: "cancel_requested" | "not_found" };

type SupportBundleExportResult = {
  status: "exported" | "canceled";
  exportedAt?: string;
  outputPath?: string;
  bytesWritten?: number;
};
```

Rules:

- Diagnostics DTOs are redacted by default.
- Support bundle export is user-initiated, previewed, cancelable, and local-only in v0.1.
- `diagnostics.exportSupportBundle` requires a current `previewId` from `diagnostics.previewSupportBundle`.
- Export uses a trusted OS save dialog; canceling the dialog returns `status: "canceled"` without creating a file.
- A renderer owns at most one bounded `exportRequestId`; only that sender may cancel it,
  and sender destruction aborts it. Completion/cancel races adopt only an exact
  verified committed output and otherwise fail closed.
- Diagnostics APIs never return raw secrets. Default diagnostics also exclude full source bodies, full notes, full memory, and raw prompts/responses; an explicit support export may add only separately reviewed, redacted content categories.

### 6.10 Backup And Restore

Commands:

- `backup.status`
- `backup.create`
- `restore.preview`
- `restore.apply`

Current typed bridge:

```ts
type RestoreApplyRequest = {
  previewId: string;
  mode: "replace_existing" | "clone_as_new";
};
type RestoreApplyResult =
  | { status: "restored"; jobId: string }
  | { status: "canceled" };
```

Rules:

- `backup.create` uses a trusted main-process save dialog, persists one durable Backup Job
  before scan, and returns only after cancellation or exact terminal completion.
- Missing/rebound roots return body-free `backup.dependency_waiting`; no path is exposed.
- `backup.status` derives `lastBackupAt` from the newest completed user Backup Job, never
  from rollback children or ephemeral renderer state.
- Main-picker preview validates manifest/entries, paths/sizes/checksums, schema ranges,
  legacy input and redacted dependencies, then returns modes, archive-bound ID,
  app/schema versions and typed warning counts—never raw warning/entry/name/path detail.
- Apply requires that current ID plus explicit mode: `replace_existing` preserves
  `vault_id`; `clone_as_new` mints one and records lineage. A folder is not a mode.
- Main retains archive checksum; renderer sees a random sender/generation token. One apply
  lease blocks replay: cancel/retryable failure releases, success/invalidation/destruction consumes.
- Apply reopens the descriptor-bound archive and validates owned 0700 staging;
  Data Architecture owns its reserved, no-replace, manifest-last publication.
- `restore.apply` returns only cancel or machine-local Restore Job ID, never vault,
  manifest, rebuild or path DTO; renderer refreshes normal vault state.
- Main owns six-locale picker and irreversible replace confirmation; Cancel is default and
  copy states rollback backup, fresh destination, binding switch and no Undo.
- The machine-local Restore Job and vault-scoped `restore_applied` Operation link by ID.
  Versioned dependency/schema migration matrices, generic cross-file transactionality,
  final syscall TOCTOU, complete platform proof, and broader progress remain open.

### 6.11 Window And Layout

- Bridge: `window.current`, `window.currentLayout`, `window.setMode`, `window.setLayout`,
  `window.setAlwaysOnTop`, `window.setSidebarOpen`; event `window.layoutChanged`.
- `WindowLayoutRequest` allows only `apiVersion: 1`, `surface: "home" | "reader"`,
  `sidebarOpen`, `noteAgentOpen`; Home cannot request Agent. Renderer sends no geometry or
  presentation and renders validated `WindowState`/`WindowLayoutState` DTOs only.
- Main owns work area, frame delta, bounds, revision, expansion, native flags, and
  `closed | resident | overlay`. Budgets are Home + Library `720px`, Reader + Library
  `840px`, Reader + Agent `960px`, all `1240px`; Agent overlays first. Main preserves base,
  never remembers expansion, restores in either close order, and reconciles display/frame
  changes before revision.
- Mode/sizes/sidebar/always-on-top are machine-local and backup-excluded; first run is
  compact capture.

## 7. Worker Contracts

Workers communicate through typed requests:

- `parse.run`
- `ocr.run`
- `rag.embed`
- `index.rebuild`
- `backup.compress`

Worker rules:

- Receive scoped handles, not arbitrary root access.
- Return artifacts and metadata, not direct UI mutations.
- Report progress and warnings.
- Fail without losing durable source records/assets.

## 8. Validation

Every IPC entrypoint must:

- Validate payload shape.
- Check active vault context when required.
- Route to the owning service.
- Enforce permission requirements.
- Return safe, localized errors.
- Avoid logging secrets or full source bodies.

## 9. Versioning

`apiVersion` starts at `1`.

Breaking changes require:

- Type update.
- Renderer/preload/main update in the same change.
- Tests for old invalid payloads.
- Migration or explicit incompatibility note if persisted job requests are affected.

## 10. Future Remote Backend

API DTOs should be serializable enough that a future Remote Agent Backend can reuse job and service contracts.

Job/proposal/operation DTOs must avoid desktop-only assumptions and preserve runtime, execution location, client tier, data boundary, and stable IDs as described in `docs/JOB_OPERATION_AND_RECOVERY.md`.

Do not hardcode:

- Desktop-only absolute paths in product-level DTOs.
- Bun, `uv`, npm, shell, or parser binary assumptions.
- Renderer assumptions into domain service interfaces.

## 11. Required Tests

- IPC payload validation.
- Renderer cannot call undeclared channels.
- Legacy capture submission handlers are absent from Main; `agent.submitTurn` is the only
  renderer semantic ingress.
- Renderer proposal list/get/approve/reject all fail closed pending a bounded safe DTO.
- Secret redaction.
- Shared error schemas reject non-namespaced codes, unknown enum aliases, and non-scalar redacted metadata.
- Permission-required command flow.
- Job progress events.
- Large list pagination.
- Worker failure recovery.
- Future-runtime DTO serialization.
