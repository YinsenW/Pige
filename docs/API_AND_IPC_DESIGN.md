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
capture.submit
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
- API errors, job error summaries, and diagnostic errors that describe the same failure should share the same `code`, `domain`, `messageKey`, and `retryable` value.

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

Current renderer/preload command:

- `onboarding.dismissFirstHome`

Internal compatibility/recovery commands (not current renderer/preload ingress):

- `vault.create`
- `vault.open`
- `onboarding.complete`
- `vault.revealKnowledgeRoot`
- `vault.revealSourceAssetRoot`
- `vault.updateSourceStoragePolicy`
- `vault.removeRecent`
- `maintenance.rebuildLocalDatabase`
- `maintenance.resetLocalDatabase`

Queries:

- `vault.current`
- `vault.recent`
- `vault.health`
- `onboarding.status`
- `maintenance.localDatabaseStatus`

Vault DTOs:

```ts
type VaultSummary = {
  vaultId: string;
  name: string;
  activeVaultPathDisplay: string;
  knowledgeRootDisplay: string;
  sourceAssetRootDisplay: string;
  sourceAssetRootKind: "inside_vault" | "external_binding";
  defaultSourceStorageStrategy: "copy_to_source_library" | "reference_original";
  schemaVersion: number;
  counts?: {
    notes: number;
    sources: number;
    managedSourceCopies: number;
    referencedOriginals: number;
  };
  lastBackupAt?: string;
};
```

`sourceAssetRootDisplay`/`sourceAssetRootKind` are schema-v1 compatibility DTO names for the managed-copy root. They do not include the artifact root, which remains `<knowledgeRoot>/artifacts` in v0.1. Future renaming must be versioned; renderer code must not infer path relationships from the display string.

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

Commands:

- `capture.submitText`
- `capture.submitFiles`
- `capture.submitUrl`
- `capture.submitVoiceTranscript`

Returns:

- Source IDs.
- Job IDs.
- User-visible status.

Phase 2 text capture DTO:

All capture requests also use the shared executable `Locale` and the common
`userIntent` vocabulary from `packages/contracts/src/index.ts`; the snippets below show
only channel-specific fields.

```ts
type SubmitTextCaptureRequest = {
  text: string;
  inputKind: "typed_text" | "pasted_text";
  userIntent: CaptureUserIntent;
  locale: Locale;
};

type CaptureSubmitResult = {
  status: "queued";
  captureId: string;
  sourceId: string;
  jobId: string;
  conversationEventId: string;
  preservedAt: string;
};
```

Phase 2 file capture DTO:

```ts
type SubmitDroppedFilesCaptureRequest = {
  inputKind: "file_drop" | "file_picker";
  userIntent: CaptureUserIntent;
  locale: Locale;
};

type SubmitFilesCaptureRequest = SubmitDroppedFilesCaptureRequest & {
  filePaths: string[];
};

type CaptureFilesSubmitResult = {
  status: "queued" | "partially_queued" | "rejected";
  captureId: string;
  sourceIds: string[];
  jobIds: string[];
  conversationEventIds: string[];
  rejectedFiles: Array<{
    displayName: string;
    reason: "empty_path" | "missing" | "not_regular_file" | "unsupported_type" | "copy_failed";
  }>;
  preservedAt: string;
};
```

Phase 5 basic URL capture DTO:

```ts
type SubmitUrlCaptureRequest = {
  url: string;
  inputKind: "pasted_url" | "typed_url";
  userIntent: CaptureUserIntent;
  locale: Locale;
};
```

Rules:

- `capture.submitText` preserves text as a managed text source before creating the source record, conversation event, and queued capture job.
- Large pasted text is stored once in the managed source file and referenced from conversation history by source ID and preview.
- `capture.submitUrl` runs only in the main process through Source Fetch Service. Renderer code never fetches web pages directly.
- URL capture supports HTTP/HTTPS only, blocks non-public network targets and embedded credentials, revalidates redirects, pins production connections to already validated DNS addresses, enforces the deadline through body reads, caps declared/decompressed streamed bytes, stores decoded HTML/text snapshots under `raw/web/YYYY/MM/`, and stores extracted readable text under `artifacts/web/YYYY/MM/`.
- URL source records store redacted original/final/canonical URLs, content type, effective charset, selected article metadata, redacted image references, extraction identity/version/mode/counts/truncation/warnings, and a checksummed `extracted_text` artifact. Query values for sensitive keys such as token, api_key, password, secret, signature, and similar are redacted before durable storage.
- HTML parsing and Readability extraction run in a bounded local worker with scripts and subresources disabled. Renderer IPC receives capture IDs/status only; it never receives raw HTML, article DOM, arbitrary response headers, dispatcher handles, or network credentials.
- URL capture conversation events store only source ID, display name, and source kind. Raw HTML and extracted web text are not duplicated in `.pige/conversations/`.
- Current preload uses `agent.submitTurn`: it extracts one selected file path with Electron
  `webUtils.getPathForFile`; main preserves it first, then links the same user draft and
  Source ref to one durable `agent_turn`. Historical capture handlers remain internal.
- `capture.submitFiles` accepts `.md`, `.markdown`, `.txt`, `.pdf`, `.docx`, `.pptx`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.tif`, `.tiff`, and `.bmp`. It consumes the active vault's `sourceStorage.defaultStrategy`: managed-copy mode writes `raw/files/YYYY/MM/`; reference-original mode records checksum/size/mtime and does not duplicate the file. Both modes create one source record, conversation event, and queued capture job per accepted file and return display-name-only rejection summaries.
- File bodies are never copied into conversation history; conversation events reference source IDs, display names, and source kinds.
- The renderer receives IDs and status, not arbitrary filesystem paths or file handles.
- After preservation, desktop main may immediately process queued text/Markdown/TXT/URL capture jobs into minimal source pages. The capture return value still reports preservation status; Home observes source-page completion through `jobs.list`.
- Preserved PDF/DOCX/PPTX/image sources create metadata-only projections and queue Agent
  work; only Pi parse/OCR events create document or image children.
- OCR execution is internal main-to-helper orchestration behind `OcrPort`; no new renderer command exposes a native path, raw OCR request, helper response, image bytes, or Artifact body. Home observes only the existing safe Job summaries.
- `agent_ingest` uses embedded Pi for text and selected document/image parse or OCR, and
  waits without semantic work when no model exists.

### 6.3 Jobs

Job DTOs and events must follow the durable lifecycle in `docs/JOB_OPERATION_AND_RECOVERY.md`.

`JobClass`, `JobState`, and the durable field name `state` come directly from `packages/schemas/src/index.ts`. IPC must not add alternate class/state vocabularies. `status` below belongs only to action results.

Commands:

- `jobs.retry`
- `jobs.cancel`

Queries:

- `jobs.list`
- `jobs.get`

Phase 3 Agent ingest bridge:

- `agent_ingest` jobs are durable job records created after source-page generation.
- Background ingest is launched from main process only; renderer APIs still return preservation status and observe progress through `jobs.list`.
- When a default model is configured later, waiting `agent_ingest` jobs may be requeued and processed without duplicating source pages.
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
- Job summaries may include source display name and source kind from the matching source record, but must not include source record paths, managed copy paths, original absolute paths, file bodies, prompts, model responses, or secrets.
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

Commands:

- `proposals.approve`
- `proposals.reject`

Queries:

- `proposals.list`
- `proposals.get`

Current proposal DTO:

```ts
type ProposalSummary = {
  id: string;
  state: ProposalState;
  trustLevel: "review_required" | "explicit_confirmation";
  jobId?: string;
  summary: string;
  reason: string;
  operationCount: number;
  warningCount: number;
  targetCount: number;
  createdAt: string;
  updatedAt: string;
};

type ProposalsListResult = {
  scannedAt: string;
  activeVaultId: string;
  total: number;
  invalidProposalCount: number;
  proposals: ProposalSummary[];
};

type ProposalDecisionResult = {
  status: "approved" | "applied" | "rejected" | "conflicted" | "not_found" | "not_allowed";
  reason?: string;
  proposal?: ConfirmationProposal;
};
```

Rules:

- Records live under `.pige/proposals/YYYY/MM/`; list omits bodies/secrets/paths, get returns full records, and invalid entries are skipped.
- Approve applies only the exact Job-scoped Pi create note under `wiki/generated/`:
  `approved` -> page/index/Operation -> `applied` -> idempotent log -> parent. Generic
  apply is `not_allowed`; generic reject remains state-only.
- Home rereads rejected calls; exact proposal writes are ordered, not transactional.
  Generic apply/replacement, CAS/TOCTOU, and platforms remain open.

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

Later commands:

- `notes.saveDraft`
- `notes.applyProposal`
- `notes.rejectProposal`

Current bridge queries:

- `library.list({ limit?, pageTypes? })` uses the Local Database Service's page index when ready.
- When database indexes are not available, it scans the active vault's `sources/` and `wiki/` Markdown frontmatter as a fallback.
- It returns safe summaries only: page ID, title, type, status, relative Markdown page path, timestamps, language, and source IDs.
- It counts invalid or incomplete frontmatter and skips those files so one malformed page does not block the Library.
- It must not return source record paths, managed copy paths, original absolute paths, source bodies, note bodies, prompts, model responses, or secrets.
- `library.tree()` returns one typed body-free semantic aggregate from the rebuildable
  Local Database index: nodes, stable refs, deterministic metrics, and safe page
  navigation. If the index is unavailable it returns a typed degraded empty result; it
  never grants renderer filesystem access or fabricates hierarchy.
- `library.related({ pageId, limit? })` returns safe outgoing-link and backlink summaries from the rebuildable Local Database graph index when ready.
- If the graph index is unavailable or the page cannot be resolved, `library.related` returns an empty degraded result instead of falling back to renderer filesystem access.
- `library.related` returns only resolved page summaries and the visible link target text; unresolved targets stay in the database for future Knowledge Health but are not exposed as arbitrary files.
- Renderer code still cannot read Markdown files directly; the main-process Library Service owns filesystem access.
- `notes.get({ pageId })` opens a page by stable Markdown page ID only. It returns frontmatter-derived summary, Markdown body without frontmatter, and byte size.
- `notes.render({ pageId })` returns the same summary plus sanitized rendered HTML for the Note Reader.
- Notes APIs do not accept arbitrary renderer-provided filesystem paths. They resolve page IDs by scanning `sources/` and `wiki/` with the same page-index rules as Library.
- Raw HTML is disabled or sanitized before reaching the renderer. Scripts, event handlers, `javascript:` links, prompts, secrets, raw frontmatter, and arbitrary filesystem handles must not be returned.

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

Retrieval DTOs and internal context-pack refs must follow `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`. Renderer-facing responses show grounded answers, ranked results, snippets, citations, and degraded-search state; they do not expose raw prompts, context budgets, full retrieved bodies, raw vector data, or secret-bearing policy details.

Current renderer uses schema-v1 `agent.submitTurn`. Optional client/conversation/tail IDs
bind follow-up; exact retry adopts its event/Job, while changed input/binding or stale tail
fails pre-Job/Pi. `agent.conversation` returns at most 100 bounded messages, tail,
follow-up eligibility, and safe latest Job state; Home requests 24. Durable results include
conversation/tail IDs. One file is preserved; no model waits/resumes without fallback.
Responses exclude bodies, paths, prompts, credentials, endpoints, and raw errors. Legacy
handlers stay readable; save-answer/multi-attachment recovery remain open.

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
- The normal path emits only the already-parsed `answer` string from the exact terminal
  Home tool after control/restricted-content filtering. If that provider exposes no
  useful incremental arguments, the Host may first validate and execute that exact tool,
  then accept one presentation-only assistant-text stream whose every snapshot is a
  prefix of the validated answer and whose end is byte-for-byte equal. Further tools,
  altered/incomplete text, and unusable long-answer streaming fail closed.
- The Host must not parse or forward partial JSON, pre-authorization/generic Pi text,
  thinking, tool arguments, citations, grounding, model/provider identifiers, raw
  payloads, errors, or credentials. The presentation turn grants no new authority and
  never changes the already validated final result.
- Main coalesces updates to a bounded rate. Renderer ignores stale, duplicated,
  out-of-order, wrong-sender, or wrong-turn events and replaces one escaped draft bubble;
  it never appends fragments into durable conversation state.
- The completed `agent.submitTurn` result and durable `agent.conversation` event remain
  authoritative. Final replaces the draft atomically; failure/cancellation clears or
  marks it through localized state, stops later events, and never persists it.
- Reconnect/restart does not replay drafts. It reads only the durable conversation/Job
  result and may resume the Job through the existing recovery contract.

### 6.7 Permissions

Commands:

- `permissions.resolve`
- `permissions.revokeGrant`
- `permissions.setDefaultMode`

Queries:

- `permissions.pending`
- `permissions.grants`

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

type ModelProviderSettingsSummary = { presets: ProviderPresetSummary[]; providers: ProviderProfileSummary[]; models: ModelProfileSummary[]; defaultModelProfileId?: string; hasDefaultModel: boolean; defaultBinding: DefaultModelBindingSummary };

type ProviderPresetSummary = { presetId: string; displayName: string; providerKind: ProviderKind; endpointProtocol: "openai_responses" | "openai_chat_completions" | "anthropic_messages"; fixedBaseUrl: string; authRequirement: "api_key" | "optional_api_key" | "none"; modelListStrategy: ModelListStrategy; cloudBoundary: CloudBoundary; apiKeyManagementUrl?: string };

type ProviderProfileSummary = { id: string; presetId?: string; displayName: string; providerKind: ProviderKind; endpointProtocol: ProviderEndpointProtocol; authRequirement: ProviderAuthRequirement; baseUrl?: string; modelListStrategy: ModelListStrategy; cloudBoundary: CloudBoundary; boundaryVerification?: BoundaryVerification; createdAt: string; updatedAt: string };

type ModelProfileSummary = { id: string; providerProfileId: string; modelId: string; displayName?: string; source: "provider_list" | "manual"; enabled: boolean; isDefault: boolean; createdAt: string; updatedAt: string };

type ProviderConnectNeedsManualModel = { status: "needs_manual_model"; reason: "select_bootstrap_model" | "discovery_unavailable" | "discovery_failed"; discoveredModels: Array<{ modelId: string; displayName?: string }>; error?: PigeErrorSummary };

type ProviderConnectResult = ModelProviderSettingsSummary | ProviderConnectNeedsManualModel;
```

Current profile/API revision persists explicit protocol/auth/preset identity and preserves
the Pi Owner's legacy map. `defaultBinding.state` carries safe selected IDs and a typed
redacted repair error. Connect runs a real Pi generation/tool probe with synthetic
non-user content before journaled all-or-restore writes. Preset protocol/Endpoint are
main-owned; Refresh failure preserves inventory and returns a typed command error. A
durable `modelSync` status summary remains open; current UI repair state is session-local.

Secrets are passed only to the Settings and Secrets Service and are never echoed back.

Rules:

- Settings APIs return redacted page DTOs, not raw storage files.
- `settings.appearance` returns the current app locale and supported locale list. `settings.setLocale` stores the user override in machine-local settings and applies it without writing to the vault.
- Secret writes use dedicated secret handling and return secret references only.
- `models.addPresetProvider({ presetId, apiKey? })` is write-only toward main; preset
  metadata decides whether a key is required, optional, or absent and whether a help URL
  exists. Validation precedes effects, no key returns, and one probe gates commit/restore.
- `models.addManualProvider` confirms/tests before persistence, discovers models when
  possible, writes keys only through the secret store, and returns redacted summaries.
  Auth/validation failure or canceled main-process confirmation leaves state unchanged.
- Successful discovery needing a bootstrap choice, or unavailable/failed discovery, returns typed
  `needs_manual_model` with zero Provider/model/secret writes. Custom then resubmits the
  same write-only request plus one transient bootstrap Model ID; main revalidates, runs
  the real Pi probe, and commits all or restores all. No key or attempt secret returns.
- `models.addManualModel` is the connected-Provider inventory fallback. One exact
  Provider+Model array preserves alias/enabled/default across Refresh. The current default
  cannot be disabled; select another enabled default first.
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
- Diagnostics APIs never return raw secrets. Default diagnostics also exclude full source bodies, full notes, full memory, and raw prompts/responses; an explicit support export may add only separately reviewed, redacted content categories.

### 6.10 Backup And Restore

Commands:

- `backup.status`
- `backup.create`
- `restore.preview`
- `restore.apply`

Current bridge and target request:

```ts
type RestoreApplyRequest = { backupPath: string; previewToken: string };
type RestoreApplyTarget = {
  previewId: string;
  mode: "replace_existing" | "clone_as_new";
};
```

Rules:

- `backup.create` uses a trusted main-process save dialog and creates a local `.pige-backup.zip`.
- Target preview is main-picker-only: validate manifest/entries, paths/sizes/checksums,
  schema ranges, legacy input and redacted dependencies; return permitted modes plus an
  archive-bound ID. Renderer never scans/extracts/writes/validates arbitrary paths.
- Target apply requires that current ID plus explicit mode: `replace_existing` preserves
  `vault_id`; `clone_as_new` mints one and records lineage. A folder is not a mode.
- Current compatibility uses `{ backupPath, previewToken }`. Main retains the archive-
  checksum token; renderer sees a random per-WebContents/generation token. One atomic
  apply lease blocks replay; cancel/retryable failure releases it, while success, archive
  invalidation, or sender destruction consumes it.
- Current apply reopens the descriptor-bound archive and validates owned 0700 staging;
  Data Architecture owns its reserved, no-replace, manifest-last publication.
- It still creates a same-ID recovery copy. Explicit modes, durable Jobs/checkpoints,
  typed serialized errors, strict CAS/TOCTOU, complete rebuild, progress, and platforms remain open.

### 6.11 Window And Layout

Commands and queries:

- `window.current`
- `window.setMode`
- `window.setAlwaysOnTop`
- `window.setSidebarOpen`

Rules:

- Main process owns native window flags, size changes, and full-screen state.
- Renderer receives only serializable `WindowState` DTOs through preload.
- Window layout mode, remembered compact/expanded sizes, sidebar preference, and always-on-top preference are machine-local settings and are excluded from vault backup.
- First-run default is compact capture.

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
- Secret redaction.
- Shared error schemas reject non-namespaced codes, unknown enum aliases, and non-scalar redacted metadata.
- Permission-required command flow.
- Job progress events.
- Large list pagination.
- Worker failure recovery.
- Future-runtime DTO serialization.
