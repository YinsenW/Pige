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
- At each real trust boundary, define one canonical schema and infer/re-export its type;
  do not maintain parallel handwritten type, schema, and projection vocabularies.
- Validate at renderer/preload/main, filesystem, secret, provider, and durable-write
  boundaries according to risk. Internal same-process plumbing does not need duplicate
  field-by-field parsing merely because it crosses a function.
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
  | "confirm_high_risk_effect"
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
  confirmationId?: string;
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
- Successful upstream Pi assistant finals are not subject to Host semantic output
  validation and do not emit `model_provider.output_invalid`,
  `agent_runtime.knowledge_action_missing`, or `agent_runtime.completion_invalid`.
  Registered tool
  inputs and durable mutation effects retain their owner validation. Malformed provider
  transport/incompatibility remains a body-free technical failure.

Internal tool/effect repair result; this never judges assistant prose or crosses renderer
IPC directly:

```ts
type AgentRepairFeedback = {
  apiVersion: 1;
  kind: "repair_required";
  category:
    | "schema_invalid"
    | "tool_input_invalid"
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
  | { type: "confirmation.required"; confirmation: HighRiskConfirmationSummary }
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

Current renderer/preload commands include `onboarding.dismissFirstHome`,
`vault.revealKnowledgeRoot`, `vault.revealSourceAssetRoot`,
`vault.storageRelocationStatus`, and `vault.relocateStorage`.

Commands: `vault.create`, `vault.open`, `vault.applyMigration`, `onboarding.complete`,
`vault.renameDisplayName`, `vault.updateSourceStoragePolicy`, `vault.forgetRecent`,
`vault.reconnectRecent`,
`maintenance.rebuildLocalDatabase`,
`maintenance.resetLocalDatabase`, `maintenance.runKnowledgeHealth`, and
`maintenance.repairKnowledgeHealthDuplicateTopic`.

Queries: `vault.current`, `vault.recent`, `vault.health`, `onboarding.status`, and `maintenance.localDatabaseStatus`.

Vault DTOs:

```ts
type VaultSummary = {
  vaultId: string; name: string;
  metadataRevision?: string;
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

Vault display-name rename is Main-owned and pathless. The strict request binds request ID,
active Vault ID, expected manifest metadata revision, and a bounded label; results echo that
identity and return only `renamed`, `stale`, `not_found`, or `failed` plus bounded current
metadata where applicable. Main atomically changes manifest `display_name`/`updated_at`,
preserves unknown fields, and never changes or returns the Vault path or stable Vault ID.

Storage reveal is main-owned and pathless: main resolves the root from the active-vault lease and bounded no-follow config; preload admits exact target/result keys. Unavailable external bindings never fall back to the vault. Identity checks fail to `vault.reveal_failed`; final check-to-shell TOCTOU remains.

Storage relocation is also Main-owned and pathless. Status returns only active Vault ID and
an opaque binding revision; relocate submits that exact identity, while Main owns picker and
explicit confirmation. Active Jobs/writes, binding drift, existing destinations, copy or
checksum/identity failure close without switching. Success follows verified full copy then
one atomic machine-local binding switch, retains the original Vault, and restart reconciles
the machine-local receipt without copying again.

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
`vault.recent` projects a path display plus an opaque revision for each machine-local entry.
`vault.forgetRecent` and `vault.reconnectRecent` bind request ID, stable Vault ID, and that exact
revision; neither accepts a renderer path. Forget is limited to a non-active entry and deletes no
Vault bytes. Reconnect opens one Main-owned directory picker, rechecks the entry after selection,
requires one compatible manifest with the same Vault ID and unchanged snapshot, rejects duplicate
bindings, and atomically updates only the machine-local entry. Results are identity-echoed and
body/path-free; cancel, stale, active, mismatch, not-found, or failure preserves current state.
`pathDisplay` is never authority and failures return no path.

Open distinguishes current/migration/future/invalid; `vault.applyMigration` binds request,
vault and preview, returning only authoritative vault/Job/Operation or safe stale/repair truth.

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

`maintenance.runKnowledgeHealth` returns a body-free report. Complete coverage may bind one
broken link for unlink/retarget, or one orphan plus an explicitly selected current parent for
`connect_orphan_to_parent`, or one exact two-topic candidate plus the explicitly selected survivor
for `maintenance.repairKnowledgeHealthDuplicateTopic`. Repair/search requests bind vault,
report/index and opaque page proofs; Main re-proves every affected page immediately before reversible
`update_page`. A duplicate-topic commit preserves the survivor identity, moves the absorbed topic to
recoverable private trash, and binds both exact pages to one Operation. Only committed results add
safe revision/Operation IDs; other states stay body-free.

Rules:

- The renderer may display these paths, but it never receives direct filesystem capability.
- First-run, unavailable-model behavior, and onboarding state follow `docs/ONBOARDING_AND_FIRST_RUN.md`; there is no separate capture-only product mode.
- `onboarding.dismissFirstHome` takes no renderer-supplied vault ID. Main resolves the
  active vault, records only its stable ID in bounded machine-local settings, and returns
  refreshed `OnboardingStatus`; the preference is idempotent, non-secret, and excluded
  from vault files and backup.
- `vault.create` takes a parent folder and vault name selected through a trusted OS file dialog.
- `vault.open` takes a folder selected through a trusted OS file dialog and validates Pige compatibility.
- Active vault path and recent vault list are machine-local settings; they are not written into `.pige/manifest.json`.
- Updating an external managed-copy root creates/selects a machine-local binding keyed by `vaultId` plus stable `rootId`; in-vault managed-copy roots use relative vault preferences. Existing source records retain their recorded root ID.
- `maintenance.rebuildLocalDatabase` creates an `index_rebuild` Job, rebuilds SQLite
  metadata/FTS from Markdown, and returns counts plus the completed Job ID. The current
  body may run synchronously; release scale still requires worker progress/cancellation.
- `maintenance.resetLocalDatabase` recreates only `.pige/db`, `.pige/indexes`, and
  `.pige/cache`; durable vault data is untouched.

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
  while teardown only detaches events. Machine-local dictation language uses strict CAS
  channels `localCapabilities.dictationLanguagePreference` and
  `localCapabilities.setDictationLanguagePreference`; it affects new sessions only and
  never authorizes a language-resource download.

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
  canReconnectDependency: boolean;
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
- Required `canReconnectDependency` is true only for parsed durable
  `backup + waiting_dependency + reconnect_path + (vault_binding | external_source)`;
  otherwise false/skipped, exposing no private wait field.
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

Legacy `proposals.list`, `proposals.get`, `proposals.approve`, `proposals.reject` stay
body-free fail-closed and Main-internal. Their `.pige/proposals/YYYY/MM/` records support
historical Job-scoped generated-note recovery only; generic apply, CAS/platform coverage and
new-`agent_turn` legacy staging remain unavailable. Reader selection review instead uses the
separate bounded channels in 6.5; it never exposes raw proposal summary/reason, path, body,
base hash or Operation internals.

#### 6.4.1 Knowledge Activity And Undo

`activity.list` returns bounded pages in deterministic `createdAt` descending then `operationId` ascending order. Its opaque cursor is process-local and bound to the active Vault, canonical Vault path, full snapshot hash, page offset, and prior-page boundary; invented, restarted, cross-Vault, or changed-snapshot cursors fail stale without exposing paths or Operation bodies.

`activity.list` may project `{kind:"collection",datasetId,tableId,revisionId}` for cell/row/column updates. `activity.undo` binds its exact revision and writes forward or returns stale; page Undo and the body/path/hash ban remain.

`activity.redo` supports an exact user-authored Markdown `update_page`, active-note title/filename or Library Topic-title `rename_page`, exact user Library tag rename/merge/removal, exact two-note merge, and exact Knowledge Health duplicate-topic merge that already has one matching Undo. It accepts the original or later forward Operation ID and optional expected before revision, re-proves every affected live/trash page and destination, and writes one deterministic forward Operation of the same mutation kind. It returns only `redone`, `already_redone`, `stale`, or `not_found` without exposing page paths, Markdown, hashes, or private recovery images.

### 6.5 Library And Notes

Queries: `library.list/tree/related`, `notes.get/render/openEditor`, `notes.listRevisionHistory`,
`notes.openRevisionHistory`, `notes.resolveInlineReference/openSourceReference`. Commands:
`notes.saveEditor/merge/revealSource`, `notes.trashCurrent/listTrash/restoreTrash`,
`notes.restoreRevisionHistory`, `notes.addTag`, `notes.editTaxonomy`, `notes.rename`,
`notes.changeAlias`, `notes.removeTag`, `notes.setQuestionState`.

Library returns bounded stable IDs; Notes resolves safe Markdown/HTML. `renderContextId` authorizes
only rendering; Main retains paths, private data, prompts, secrets and unsafe content.

Reader edits are revision-fenced. `openEditor` returns bounded Markdown; `saveEditor` CAS-writes
`update_page`, preserving stale drafts. Trash lists safe receipts; restore revalidates private bytes
and returns authoritative render without duplicate `restore_page`. Merge binds both notes and keeps
current. History binds render/revision, lists <=100 safe summaries and opens sanitized read-only
previews; restore CAS-writes one `restore_page`. Source/rich-text stays read-only and closed results
expose no body/path.

`notes.editTaxonomy` replaces the complete tags/topics projection only for one active `note`. Its
strict request binds active Vault, page, render context and immutable revision, with at most 12
canonical tags and 8 canonical topic references. Main re-proves the same note, preserves body and
unrelated frontmatter through the existing atomic Markdown editor, returns the authoritative render
only after commit, and refreshes derived indexes afterward. Stale/ineligible/failure is body-free and
preserves both renderer drafts; Activity/restart/Undo remain the editor-owned `update_page` lifecycle.

`notes.removeTag` is the narrow confirmed shortcut for one existing tag. Its strict pathless request
binds the same active Vault/page/render/revision plus one canonical tag. Main re-proves the note and
tag, changes only `tags` and `updated_at` through the atomic editor, and returns a render only when
the requested tag is absent and the remaining tags/topics match the committed Markdown. Stale,
missing, ineligible or failed outcomes expose no body/path and retain the Reader/tag; retry,
Activity, restart and Undo reuse the deterministic `update_page` lifecycle.

`notes.rename` binds one active `note` to exact vault/page/render/revision and one canonical title. Main owns the path/filename, atomically preserves the old title as an alias, returns only closed path-free outcomes or the authoritative render, rebuilds indexes after commit, and records recoverable `rename_page`; conflict/stale/ineligible/failure retains the UI draft.

`notes.changeAlias` binds one active `note` to exact vault/page/render/revision, `add | remove`, and
one canonical alias. Main proves governed whole-Vault reference uniqueness, writes only the inline
`aliases` and `updated_at` fields through the existing atomic editor, refreshes derived indexes only
after commit, and returns a path/body-free closed outcome or authoritative render. The renderer
never receives Markdown, paths, hashes, or uniqueness internals; closed outcomes retain the draft.

`notes.setQuestionState` binds one active `question` to exact Vault/page/render/revision and one
canonical state from `open | partially_answered | answered | stale`. Main re-proves the same page,
changes only `question.state` and `updated_at` through the atomic Markdown editor, and returns an
authoritative render only after the new state is durable. Stale, missing, ineligible, and failed
outcomes are body/path-free; Activity, Undo, Redo, and restart reuse the existing `update_page`
lifecycle.

Reader reference query contract:

- `notes.openSourceReference` accepts exact request/vault/page/render/source identity and returns
  body-free `unresolved | not_found | stale | resolved`; only `resolved` adds target page ID. Other
  states retain Reader. `revealSource` revalidates and reveals only that asset, path/body-free.
- `source.refresh.preview` checks a referenced or managed Markdown/TXT/PDF/DOCX/PPTX source and
  returns only safe change metadata plus an opaque candidate. `source.refresh.confirm` binds that
  candidate and expected source revision, rechecks currentness, and returns only closed status,
  Job/Operation identity, and Source-Page-conflict state; Main retains every path and file body.
- Reader original reconnect binds request/vault/page/render/source to one Main-projected unavailable `reference_original`; Settings lists only bounded safe candidates. Both renderer requests carry an opaque currentness proof and no path/body.
  Main owns the picker and exact checksum/size/format revalidation; success returns a path-free Operation identity and, for Reader, only an authoritative refreshed render. Cancel, stale, ineligible, and mismatch are closed with no durable change.

Reader selection uses queries `readerSelection.resolve`, `readerSelection.currentProposal`
and commands `readerSelection.submitAction`, `readerSelection.submitTransform`,
`readerSelection.submitLink`, `readerSelection.submitCreateNote`, `readerSelection.decideProposal`:

- `resolve` binds vault/page/render/offsets and returns <=64 KiB plus hashes. Actions bind it and
  locale/client turn; Main owns instructions/CAS/apply.
- Link has no renderer target: Pi chooses an opaque ref; Main publishes reversible `update_page`.
- `create_note | create_claim | create_question | create_concept | create_entity | create_topic`
  share review; navigation requires the matching authoritative page type.
- Preview exposes opaque identity/state/revision and <=8 lines of <=160 characters; decisions bind
  revision, private details stay Main-only, and Activity owns Undo.

Current-note append/replace stay under `agent.submitTurn`, accept <=16 KiB and cite `citation_1`.
Replace needs authored intent plus same-turn read and always enters review.
`agent.currentNoteReplaceProposal`/`agent.decideCurrentNoteReplaceProposal` expose only
vault/Job/proposal/revision and <=8 redacted lines; Main owns CAS, one reversible `update_page`
and restart convergence. Append/replace conflicts additionally expose only an opaque current-note
revision and bounded base/current/proposed lines. Exact `keep_current` records a durable no-write
resolution. Exact `apply_proposed` rechecks that same reviewed current revision, records the current
bytes as the reversible before-image, and then applies the immutable proposal; revision drift returns
the refreshed conflict, while manual edit remains renderer-local.

Dataset boundary:

- Checksum-bound previews use <=50 rows/64 KiB; cursors bind vault/catalog/revision/view/boundary.
  Drift is stale; citation keys yield only Main-derived read-only highlights.
- Formula/relation/lookup/rollup writes bind revision, IDs and eligibility; relations store same-Dataset row
  IDs/labels. `collections.updateRelationColumn` preserves targets for a display-field change, clears them
  for a target-table change, and rejects definitions with dependent lookup/rollup columns. Lookup definition updates accept one current
  relation and scalar target; rollup updates accept count or numeric-sum. Existing formula add/update
  accepts current numeric scalar, numeric lookup/rollup or acyclic Pige-formula operands. Main rejects
  direct/indirect cycles and recomputes downstream formulas in stable topological order after base-cell edit,
  relation retarget or derived-definition update. CAS/Undo exposes no path/query.
- `collections.updateView`/`collections.renameView`/`collections.trashView` bind Dataset, stable
  view and view revision; definition updates accept only the bounded typed filter/sort shape.
  Committed/stale returns the safe authoritative snapshot and update conflicts retain the renderer draft.

### 6.6 Retrieval

Commands:

- `agent.submitTurn`
- `agent.trashConversation`
- `agent.restoreConversation`
- `agent.exportConversation`
- `agent.setConversationTitle`
- `agent.ask`
- `retrieval.ask`
- `retrieval.saveAnswer`

Queries: `agent.conversation`, `agent.conversationHistory`, `agent.conversationTrash`,
`retrieval.search`, `retrieval.localSemanticStatus`.
Asset commands: `retrieval.installLocalSemanticAsset`,
`retrieval.enableLocalSemanticAsset`, `retrieval.disableLocalSemanticAsset`,
`retrieval.removeLocalSemanticAsset`.

Events:

- `agent.turnDraft`

`retrieval.search` accepts active vault, <=320 Unicode code points and optional limit/page
types. Preload/Main fence the vault; results contain bound IDs, relative Markdown paths,
snippets/reasons, never bodies, absolute paths, vector/policy internals or uncalibrated
scores. Closed modes add `semantic_hybrid` only after private runtime/index/span
revalidation; async failure returns the unchanged lexical result. No new runtime/UI DTO.
Other DTOs follow `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`.

`notes.openSearchMatch` accepts only the active Vault ID, result page ID and the bounded
submitted search query. Main rerenders the current page, derives an optional exact Reader
segment focus from that render context, and returns no page body, path, index internals or
renderer-authored segment authority. Vault/page drift returns a closed stale/not-found result.

`LocalSemanticRetrieval*Schema` owns one literal asset. Status is `{apiVersion:1}`;
mutations add request ID/revision and accept no URL/checksum/path/provider/model. It
returns asset state/fixed bytes, lexical availability and only an install/verify Job.
Install is `accepted|already_installed|stale|failed`; Enable adds
`already_enabled|not_found`; Disable/Remove use `committed|stale|not_found|failed`.
`ready` remains asset-only; B6.06 consumes only a private reverified lease.

Schema-v1 `agent.submitTurn` pairs optional conversation/tail IDs and strict
`current_note` scope; `follow_up` requires the pair, `file_picker` may carry it and other
kinds reject it. Home snapshots `canFollowUp`; stale/mixed identity fails before work and
never falls back. `agent.conversation` returns <=100 bounded messages, exact tail,
`canFollowUp` and safe latest Job without paths, Provider data or raw errors.

A current-note `file_picker` turn may also carry the ordinary bounded staged-file set. Main
binds the exact current page and preserved Source Records into one Agent Job; the renderer
does not supply citation, source or storage authority. Pi must read the current note first,
then may inspect only those exact Host-bound attachments. The page and each attachment keep
separate evidence refs; this combination grants no ambient search, Dataset, URL or external
capability. `file_drop` remains unscoped.

`agent.conversationHistory` returns <=50 safe summaries; its optional <=120-code-point query
matches only title/`safePreview`. Open reuses `agent.conversation`, the sole follow-up authority.
Cursors bind vault/query/snapshot/boundary; drift fails before append. Trash/restore revision-bind
exact JSONL; restart never replays. `agent.setConversationTitle` tail/title-revision-binds atomic
manifest-only metadata; stale returns authority. Export rechecks the tail into one Main-selected
JSON; closed results change no history.

Picker selection/removal remains renderer-local, pathless and side-effect-free. Send
submits exact text, ordered staged identities, active vault and one client-turn identity;
Main accepts one parent `agent_turn`/Job before clear, and exact retry adopts it. Global
`file_drop` submits only its ordered drop with a separate client-turn identity and no
conversation pair; it never consumes the draft. Failure or IPC rejection retains that
order/turn identity for explicit retry or removal, never automatic resubmit. Attachment-
only intent appears only on accepted submit.

`resources/large-paste-boundary.manifest.json` is the machine-readable cross-layer owner
for staged paste constants. `AgentSubmitTurnRequest` retains an ordinary authored-text
maximum of 8,000 Unicode code points. The implementation extends the submitted staged
collection to an ordered strict union whose item kind is `file` or `large_paste`; both
kinds share the maximum of eight items. A large-paste item carries the exact clipboard
UTF-8 body only across the strict renderer/preload/main submit boundary, never in a safe
pending projection. Each item is at most 4 MiB UTF-8 and all paste bodies in one request
are at most 8 MiB UTF-8. These preservation limits are not Provider-context budgets.
`@pige/schemas` must export the manifest-named constants and strict staged-item types;
renderer, preload and service consumers import them and may not hardcode parallel limits.
`AgentStagedItemRejectionReason` is exactly `item_limit | item_too_large |
aggregate_too_large`. A rejected paste remains a safe local item with its reason and no
body preview; it is excluded from submission and blocks atomic Send until removed or
adjusted. Structural partial acceptance never clears rejected items or composer text.

The renderer measures exact code points without normalization or trim. If exact insertion
would exceed the ordinary boundary, it stages the whole payload and leaves current text
unchanged. Send binds exact query, ordered mixed items, active vault and one client-turn
identity. Main either accepts the complete immutable snapshot under one parent Job or
returns safe per-item/structural errors; failure preserves text, items, order and identity.
Retry adopts preserved source refs and cannot duplicate bodies, events or Jobs. The
whole-window `file_drop` route remains a separate immediate turn and cannot consume this
composer snapshot.

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
- Main emits bounded snapshots from Pi's assistant-text event channel after structural
  event/size checks. It neither trims nor semantically validates accepted assistant text,
  and never starts a second Provider turn solely to reproduce or repair an existing final.
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

### 6.7 High-Risk Confirmation

`confirmations.pending`/`confirmations.resolve` remain the effect gate; eligible Allow may
carry opaque `allow_scoped`. `permissions.summary`, `permissions.setDefaultMode`,
`permissions.revokeGrant`, and `permissions.changed` expose pathless local policy. YOLO
enablement reuses confirmation. Main durably records the exact pending request and one-action
decision, links optional Job/Operation identities, and restores the same `waiting_permission`
boundary after restart; raw path/command/body/credential/error stays in Main and the effect
owner revalidates before execution.
Attachments grant exact-source tools only; explicit authored intent may separately request
a precise ambient effect even with attachments. Fallback/model/source cannot. Typed URL is
separate. Provider/model plus Send authorizes exact authored/selected bounded context
unchanged; stored credentials stay outside it and identity drift rejects.

Whitespace inspection is permitted only to decide whether an authored field is empty.
Non-empty original text—including outer whitespace, line breaks, punctuation and secret/
path-like text—owns durable input and the input identity/hash used by history, retry/restart and Provider payload.
Text-only whitespace creates no turn; attachments plus whitespace-only text use the minimal
“Use only the attached file(s) as source material.” intent in six locales. Context bounding
precedes assembly and never rewrites selected text.

`skills.pendingStagedReviews` returns bounded safe HTTPS previews for one vault. Only
nonempty authored text registers `pige_stage_submitted_skill_url`; `{candidateIndex}`
stages one Host candidate, never install/enable/authority. Turn/Job/vault drift closes.

### 6.7.1 Reviewed Task Plan And Browser Interaction

`TaskExecutionPlanSchema`/`TaskExecutionPlanStepSchema` are Main-private.
`TaskExecutionPlanSummarySchema`, the existing confirmation's `reviewed_execution_plan`
subject, exposes only plan ID; tool/version/source/integrities; step/Skill counts; target
agents; bounded destination roots; and OAuth need.

`taskExecution.interaction` returns `TaskInteractionPendingResultSchema` (`none` or
`browser_oauth`: interaction/plan/Job/ordinal/safe origin/revision).
`taskExecution.openInteraction` accepts `TaskInteractionOpenRequestSchema` with the same
identity/revision and returns `opened | stale | not_found | failed` without URL/reason.
`taskExecution.interactionChanged` emits `TaskInteractionChangedEventSchema`, equal to the
pending schema. Main revalidates and opens its private URL/process; `jobs.cancel` kills it.

### 6.8 Settings, Providers, Tools

Settings scopes and patch rules must follow `docs/SETTINGS_AND_PREFERENCES.md`.

Commands:

- `settings.update`
- `settings.getPage`
- `settings.setLocale`
- `settings.setTheme`
- `settings.setKnowledgeLanguage`
- `settings.setStartupDestination`
- `settings.updatePigePolicy`
- `localCapabilities.setOcrEnginePreference`
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
- `memory.disable`
- `memory.edit`
- `memory.enable`
- `memory.delete`
- `memory.export`
- `memory.reset`
- `piPackages.install`
- `piPackages.restore`
- `piPackages.uninstall`
- `skills.stageFromUrl`
- `skills.stageFromMarkdown`
- `skills.stageFromZip`
- `skills.stageUpdate`
- `skills.installStaged`
- `skills.discardStaged`
- `skills.disable`
- `skills.enable`
- `skills.uninstall`
- `skills.restore`
- `skills.export`
- `tools.install`
- `tools.remove`

Queries:

- `settings.registry`
- `settings.appearance`
- `settings.startupDestination`
- `settings.pigePolicy`
- `localCapabilities.ocrEnginePreference`
- `models.summary`
- `memory.list`
- `piPackages.summary`
- `skills.summary`
- `system.toolchainHealth`

`settings.pigePolicy` returns the active vault's bounded `PIGE.md` text, required-section
names, and an opaque content revision without a filesystem path. `settings.updatePigePolicy`
binds that vault and revision, validates the canonical heading structure and rejects secret-like
content before confirmation, then re-proves the same bytes and authority before an atomic write.
Settled updates publish a `change_setting` Operation for Activity/Undo and restart recovery;
invalid, denied, stale, or failed attempts preserve the renderer draft and do not mutate policy.

`localCapabilities.ocrEnginePreference` returns strict machine-local
`automatic | platform_native | paddleocr_local` preference plus an integer revision.
`setOcrEnginePreference` is permission-free CAS: `committed | stale` includes the authoritative
summary while `failed` is identity-only. The renderer receives no executable path, tool lease or
artifact identity. The choice applies to new OCR jobs; explicit Paddle preference reverses the
adapter order, and an unavailable preferred adapter still falls back to the available local one.

Events:

- `settings.appearanceChanged`
- `memory.changed`

Skill IPC is body/path-free. Main owns `.md`/`.zip` pickers; ZIP adds `invalid` and one inert bundle.
`skills.stageUpdate` binds installed/base/registry identity: HTTPS reuses its origin; local pure Skills
use a matching Main-picked file. Safe review precedes CAS trash/adoption. Pure updates preserve
enablement; External/Web revalidates origin/manifest/capabilities and commits disabled. Restore
returns disabled from verified trash.

Pi Package IPC is path/body-free and `summary` authoritative. `catalogQuery` returns reviewed
identity/disclosure. Install/uninstall/update/rollback confirm; pin/unpin and receipt-owned restore
do not. Restore binds registry/package/version/SRI/pin/rollback/context, revalidates private trash
and commits disabled without network or code. Readable outcomes include registry; `failed` is
identity-only. Main adopts verified trees once.

Memory list returns vault/revision and <=1,000 safe records; private provenance stays in Main. Edit
binds record/revision/title/body, secret-scans, and changes L1 only. Lifecycle `committed | stale |
not_found` returns authoritative summary; committed adds Operation ID. Delete/reset retain private
trash; Activity owns Undo/restart. Export is revision-bound, Main-picked and pathless. Renderer
cannot create memory, submit provenance/path, or permanently erase it.

Home's internal `pige_remember_authored_memory` tool is not renderer IPC. Host binds one exact
substring of the current authored turn, a vault/Job/conversation event and the executing model;
only preference, correction and workflow-lesson kinds are accepted. Secret-like or authority-changing
quotes fail before effect. One receipt owns `create_memory`, Activity Undo and restart adoption.

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
- Appearance IPC has one canonical schema owner. `settings.appearance` returns strict
  `{apiVersion:1,locale,availableLocales,themePreference,effectiveTheme,generatedKnowledgeLanguage,revision}`;
  `setLocale` returns it, while `setTheme({themePreference,expectedRevision})` and
  `setKnowledgeLanguage({generatedKnowledgeLanguage,expectedRevision})` return
  `committed | stale | failed` with authoritative settings. Theme is `system | light | dark`;
  knowledge language is `preserve_source | follow_query | app_locale`, permission-free,
  unbacked and new-Job-only. Appearance never enters the vault. `appearanceChanged` emits
  the same validated summary; preload drops malformed payloads.
- Startup IPC is path/vault-free CAS (`committed | stale | failed`) and applies after next-launch vault restoration.
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
- Irreversible/security/destination/conflict settings use their explicit high-risk or
  exceptional proposal owner. Ordinary reversible settings and registered first-party
  Agent tools do not create permission records or repeat prompts.
- Settings updates include expected versions where concurrent edits or external vault changes are possible.
- Agent policy preview returns redacted, typed policy summaries for debugging/settings UI; it never returns raw secrets, full settings files, or permission-store internals.
- `system.toolchainHealth` reports bundled toolchain readiness or repair-needed status from `resources/toolchain-manifest/toolchain.manifest.json`; it does not trigger downloads.
- Skill Settings cannot infer absent lifecycle actions from inventory.

Agent policy DTOs must follow `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`.

#### 6.8.1 Deferred Trusted Update Lifecycle

`updates.summary`, `updates.check`, `updates.download`, `updates.apply`, and
`updates.onStatusChanged` are body-free.
Their strict contract remains reserved for a future trusted signing identity. Packaged v0.1
composes `NoNetworkUpdateCheckAdapter`, returns unavailable state, performs no network check,
download or apply, and exposes no feed, artifact path, credential or signing authority.
Users update manually from the canonical protected-tag GitHub prerelease ZIP.

### 6.9 Diagnostics

Diagnostics APIs must follow `docs/DIAGNOSTICS_AND_OBSERVABILITY.md`.

Commands:

- `diagnostics.exportSupportBundle`
- `diagnostics.cancelSupportBundleExport`
- `diagnostics.retrySupportBundleExport`
- `diagnostics.clearLocalDiagnostics`

Queries:

- `diagnostics.health`
- `diagnostics.workflowSummary`
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
  crashRecovery?: CrashRecoverySummary;
  crashRecoveryHistory?: Array<CrashRecoverySummary & {
    status: "recovered" | "needs_attention";
    completedAt: string;
  }>; // max 10, newest boundary is machine-local
};
```

Canonical strict schemas are `DiagnosticsWorkflowSummary`, preview/export, shared
cancel/retry mutation, and clear-local request/results in `@pige/schemas`. They bind
request, machine/vault scope context, workflow revision and exact Job; readable outcomes
return the authoritative workflow, while `failed` remains identity-only.

Rules:

- Diagnostics DTOs are redacted by default.
- Startup recovery summaries carry one opaque `recoveryId`; the same value correlates the
  local started/completed events. History is bounded to ten completed pathless summaries.
- Support bundle export is user-initiated, previewed, cancelable, and local-only in v0.1.
- `diagnostics.exportSupportBundle` requires a current `previewId` from `diagnostics.previewSupportBundle`.
- Export uses a trusted OS save dialog; canceling the dialog returns `status: "canceled"` without creating a file.
- Main owns the destination and durable machine-local Job. Start, retry and cancel recheck
  scope/revision/Job identity; restart adopts exact prepared or published state once. Clear is
  trash-first, refuses an active export and never touches Vault data or user-created bundles.
- Diagnostics APIs never return raw secrets. Default diagnostics also exclude full source bodies, full notes, full memory, and raw prompts/responses; an explicit support export may add only separately reviewed, redacted content categories.

### 6.10 Backup And Restore

Commands:

- `backup.status`
- `backup.memoryPreferenceStatus`
- `backup.setMemoryPreference`
- `backup.create`
- `backup.reconnectDependency`
- `restore.preview`
- `restore.apply`
- `restore.cancel`

`RestoreApplyRequest` binds preview plus `replace_existing | clone_as_new`; its result is
`restored` with Job ID or `canceled`. `BackupReconnectDependencyRequestSchema` binds
API/request/vault/waiting Job; its result is `resolved | cancelled | stale | not_found |
failed`. `@pige/schemas` owns strict runtime shapes and contracts export inferred types.

Rules:

- Memory preference status returns only active Vault ID, revision, inclusion and update
  availability. Mutation binds API/request/Vault/revision, carries no path, blocks during
  active Backup work, and returns `updated | stale | blocked` with authoritative status.
- `backup.create` uses a trusted main-process save dialog, persists one durable Backup Job
  before scan, and returns only after cancellation or exact terminal completion.
- Missing/rebound roots return body-free `backup.dependency_waiting`; no path is exposed.
- Reconnect accepts four fields and fences the exact active-vault eligible Job before the
  chooser. Private `dependencyId` is `rootId` for `vault_binding`, or `sourceId` for
  `external_source` (derive current record/root); it is never exposed. Cancel writes nothing.
- `BackupRestoreService` repairs/rereads exact binding/evidence; Main and
  `BackupCoordinatorService` reread/re-prove the same Job/dependency before resuming it.
  No duplicate is created; the five-field result has no Job summary, and UI only polls.
- Echo identity; changed/absent/other failure is body-free `stale`/`not_found`/`failed`
  and keeps the wait. Chooser owns the action—no Permission Broker; generic/Backup retry
  is `not_allowed` without private proof.
- `backup.status` derives last completion from user Backup Jobs, never rollback/renderer state.
- `BackupManifest.memoryIntegrity` privately binds the vault-scoped memory registry checksum,
  revision and lifecycle/restore/Operation counts. Create rechecks it after preflight; restore
  rederives it before publication. DTO summaries expose only the existing bounded `memoryCount`.
- Restore picker/preview binds and validates archive, entries, bounds, checksums, schemas,
  legacy input and dependency counts without raw detail. Apply requires that ID plus
  `replace_existing` (preserve vault ID) or `clone_as_new` (mint ID/lineage), one replay-safe
  lease, descriptor reread and owned staging; a folder is not a mode.
- Main owns picker/replace confirmation. Apply returns cancel or machine-local Restore Job ID;
  its `restore_applied` Operation links by ID. Cancel binds preview/mode/in-flight owner and
  returns `cancel_requested | cancelled | too_late | stale | not_found | failed`; committed
  output wins. Results expose no path, body, Job internals or raw error. Data Architecture owns
  no-replace/manifest-last/rollback rules;
  migration breadth, cross-file atomicity, final syscall TOCTOU and platform proof remain open.
- The coherent six-channel block moves from `main/index.ts` to
  `apps/desktop/src/main/register-backup-restore-ipc.ts`; Main remains composition root,
  protected contract scanning includes the registrar, and behavior otherwise stays fixed.

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
