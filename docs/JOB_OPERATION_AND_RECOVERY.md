# Job, Operation, And Recovery Design

Status: Draft baseline
Date: 2026-07-09

## 1. Purpose

This document defines how Pige represents long-running work, confirmation proposals, applied operations, retries, cancellation, compaction, and crash recovery.

It is the authority for:

- Job classes, states, steps, checkpoints, retries, cancellation, and priority.
- Confirmation proposal lifecycle.
- Operation record lifecycle.
- Idempotency and safe resume behavior.
- How Home, Settings, diagnostics, backup, restore, future sync, and future remote Agent backends observe jobs.

The core rule:

> Pige must preserve the user's input and explain what happened even when parsing, OCR, model calls, permission prompts, app restarts, crashes, or file conflicts interrupt the workflow.

## 2. Product Principles

1. Preservation before intelligence.
   Capture must preserve the source record and source asset or source reference before parsing, OCR, model calls, or Agent compilation.

2. Durable work before expensive work.
   Any expensive, asynchronous, permissioned, or failure-prone action must create a durable job record before it starts.

3. User trust beats automation.
   Safe actions can auto-apply. Risky or destructive actions become confirmation proposals. Uncertain recovery becomes visible status, not silent cleanup.

4. Jobs are operational history, not knowledge truth.
   Jobs explain work. Durable knowledge lives in Markdown, source records, artifacts, memory files, proposals, operations, and logs.

5. Recovery must be boring.
   After restart, Pige scans durable job/proposal/operation records, reconciles files, and resumes or explains without drama.

6. Jobs execute decisions; they do not make semantic decisions.
   Pi Agent chooses tool order; Jobs persist, dispatch, cancel, retry, and recover those
   calls without inferring another semantic step.

## 3. Durable Locations

Pige has two job scopes:

- Vault-scoped jobs: work that reads or writes a vault, source record, source asset, Markdown page, proposal, operation, memory, Skill, backup, restore, or index.
- Machine-local jobs: work that belongs to the app installation or device, such as local model download, bundled tool repair, app update checks, and machine-local package installation.

Vault-scoped jobs:

```txt
Pige Vault/
  .pige/
    jobs/
      2026/
        07/
          job_20260709_abcd1234.json
    proposals/
      proposal_20260709_bcde2345.json
    operations/
      2026/
        07/
          op_20260709_cdef3456.json
    trash/
```

Machine-local jobs:

```txt
OS app data/
  Pige/
    jobs/
    operations/
```

Rules:

- Job records are durable until completed and past the retention window.
- Pending proposals are durable until approved, rejected, superseded, or expired by explicit policy.
- Vault-scoped operation records are durable audit data and included in vault backup by default.
- Machine-local operation records are excluded from vault backup by default.
- SQLite job indexes are rebuildable from `.pige/jobs/`, `.pige/proposals/`, `.pige/operations/`, conversations, and `log.md`.
- Job records must not store large source bodies, full wiki page bodies after operation application, raw prompts, raw model responses, or secrets by default.
- Vault-scoped job records are included in vault backup by default according to backup policy.
- Machine-local job records are excluded from vault backup by default and exportable only through explicit diagnostics/settings export.

Phase 2 implementation note:

- Capture jobs are written as JSON records under `.pige/jobs/YYYY/MM/`.
- `jobs.list` provides a read-only Home status summary by scanning those durable records after launch.
- Job summaries expose safe identity/state plus optional stage/progress; they never expose paths, bodies, prompts, responses, or secrets.
- Invalid job JSON is counted and skipped rather than blocking Home.
- `jobs.cancel` directly cancels eligible non-running work only when its action-safety
  guard is false/absent; active in-process parse/OCR/Agent ingest/index rebuild becomes `cancel_requested`.
- `jobs.retry` can mark eligible failed/waiting/cancelled jobs back to `queued` for later processing.
- Capture enters `running/capturing_source`; source preservation does not set the guard.
  A once-only checkpoint precedes its first Source Record/Page projection; running capture cancellation remains open.
- Queued DOCX/PPTX captures create metadata-only pages then parse Jobs. Preserved PDFs create metadata-only pages and Agent-ingest Jobs; Pi may persist deterministic parse/OCR children. Images queue OCR when the verified helper is ready and otherwise wait for that dependency.
- Parse/OCR routing and evidence gates are owned by `PARSER_INGEST_SPEC.md`; Artifact,
  sidecar, and revision boundaries by `TECH_ARCHITECTURE.md` and
  `SOURCE_STORAGE_STRATEGY.md`. Jobs wait on insufficient evidence, keep incomplete work
  retryable, reuse verified output, and never start Agent ingest from unreadable evidence.
- Capture, parse, and OCR runners persist and link each deterministic parse, OCR, or Agent-ingest child before parent terminalization. Interrupted `running` parents auto-requeue; handled finalization failures remain `failed_retryable` for explicit retry. Both reuse the linked child. This guarantee is separate from the deferred `capture_batch` hierarchy.
- Startup and vault activation first reconcile interrupted jobs. Proven-idempotent capture/parse/OCR/Agent-ingest/index jobs are requeued; cancellation-in-progress and unproven classes become `failed_retryable`. Capture/parse/OCR/Agent ingest drain in batches of 20; index rebuild uses a coalesced limit-1 drainer. Waiting Agent ingest still honors current model/OCR readiness.
- Home's contextual processing strip includes active capture, parse, OCR, Agent ingest, and index jobs. It remains hidden when no work needs attention and uses compact localized status indicators rather than a new queue destination.
- Source-page writes use pending/previous/target checksums so a crash can be reconciled without confusing Pige's partial write with a user edit.
- Phase 3 text/PDF pages create deterministic `agent_ingest`. Missing models wait. PDF parse/OCR children key parent/tool/version/source revision/input, reuse across Pi call IDs, and store only capped call hashes; OCR capability recovery resumes the linked child.
- Phase 3 `agent_ingest` is process-locally cancellable through provider access and generated-note commit. It distinguishes user abort from provider timeout, fences the Source Record on both sides of a durable note-publication checkpoint, and uses create-only publication. Current-job note adoption requires bounded `last_job_id` provenance; otherwise only a new durable `index.md` entry starts a guard. Egress audit alone does not. Drift requeues or waits, user/nonmatching pages remain untouched, and same-job notes recover idempotently. Strict cross-process SourceRecord-to-note CAS, parent-swap resistance, note/index/operation transactions, and packaged-platform proof remain open.
- Phase 4 `index_rebuild` runs in a bundled worker, enters `running/indexing`, persists monotonic `index_item` progress, serializes process-local writers, and cooperatively cancels. Failure rolls back to the prior committed index; clean cancellation preserves Markdown. Cross-process writer/CAS, kill/crash/stale-worker recovery, packaged paths, and implicit first-query workerization remain open.
- Process-local parse/OCR/index rebuild persist monotonic progress; parse/OCR/Agent ingest/index
  rebuild share cancellation. Capture/parse/OCR/Agent ingest implement the Section 6 publication guard; retry
  retains it. Guard-first cancellation cannot end `cancelled`, and only a verified output
  race becomes `completed_with_warnings`. Other writers, running capture/other-class
  cancellation, strict cross-process routing/CAS, checkpoint arrays, pushed events, numeric
  Home UI, and compaction remain open.

## 4. Job Classes

Required v0.1 job classes:

| Class | Example | Durable outputs | Can cancel? | Can retry? |
| --- | --- | --- | --- | --- |
| `capture_batch` | parent for a multi-file drop/import | child job IDs and aggregate result only | Yes before all children finalize | Yes for safe failed children |
| `capture` | text, file, URL, image drop | source record, source asset/reference, conversation event | Before source finalization only | Yes |
| `parse` | PDF/DOCX/PPTX/text extraction | extracted artifact, parser metadata | Yes where tool supports | Yes |
| `ocr` | screenshot or rendered PDF page OCR | OCR artifact, confidence metadata | Yes where tool supports | Yes |
| `agent_ingest` | summarize, tag, link, compile pages | source page, wiki pages, proposal/operation | During model/tool stages | Yes |
| `retrieval_query` | Home question with grounded answer | conversation event, optional saved page | Yes | Usually yes |
| `index_rebuild` | FTS/vector/graph rebuild | SQLite/index files | Yes | Yes |
| `backup` | create backup zip | backup archive and manifest | Yes before finalization | Yes |
| `restore` | preview/apply backup | restored vault, restore report | Preview yes, apply guarded | Only through new preview |
| `permissioned_skill` | external/Web Skill action | operation/proposal/tool output | Depends on action | Depends on action |
| `tool_install` | model/tool/package download | app-data install manifest | Yes | Yes |
| `migration` | schema/frontmatter migration | migrated files, operation records | Usually no after apply starts | Only through new plan |
| `maintenance` | compaction, cleanup, health check | compacted job refs, repair proposals | Yes | Yes |

`packages/schemas/src/index.ts` owns the executable `JobClassSchema`. This table explains those exact values; no document or DTO may introduce aliases such as `capture_preserve`, `parse_source`, `backup_create`, or `restore_validate`.

Jobs may have parent-child structure:

- A multi-file drop creates one parent `capture_batch` job and one child job per source.
- Capture preserves the source and wakes one `agent_ingest` parent; Agent tool calls may
  create child Jobs with `parentJobId` and Pi run/call provenance.
- Recovery may resume that child, not invent another call. Its mechanical index/log
  projection may finish inside the approved write recovery boundary.
- Backup/restore may create child jobs for scan, manifest, compression, extraction, and rebuild.

Current implementation boundary: multi-file capture currently groups child `capture` jobs with one `captureId` but does not yet persist the `capture_batch` parent. That bridge stays readable; the parent record and aggregate recovery semantics are required before the batch contract is claimed complete.

Current format/quality continuations are transitional; B3.13 replaces their branching
with Pi tool-call children while retaining durability.

## 5. Job State Machine

Required canonical states:

```txt
queued
running
waiting_dependency
waiting_permission
awaiting_review
cancel_requested
completed
completed_with_warnings
failed_retryable
failed_final
cancelled
compacted
```

Stage names may describe the active phase:

```txt
capturing_source
fetching
parsing
ocr
embedding
retrieving
planning
compiling
waiting_for_model
waiting_for_tool
waiting_for_path
writing
indexing
backing_up
restoring
repairing
```

Rules:

- `queued` means no execution is active. A fresh Job has only its durable record; a
  retried Job may retain verified outputs and a true action-safety guard.
- `running` means a worker, model call, tool, or write step is active.
- `waiting_permission` pauses execution until the Permission Broker resolves the request.
- `waiting_dependency` pauses execution until a missing model provider, local tool, local model, runtime capability, vault binding, or external source path is configured or repaired.
- `awaiting_review` means a confirmation proposal is ready and no risky mutation should continue automatically.
- `cancel_requested` is transitional; duplicate requests are idempotent and the active worker exits at a safe checkpoint.
- `completed_with_warnings` is success with recoverable or explainable issues.
- `failed_retryable` keeps enough checkpoint data to retry safely.
- `failed_final` means retry requires changed input, missing dependency repair, or user decision.
- `compacted` means detailed job payload was reduced after retention, but durable effects remain in operations, conversations, pages, and logs.

Invalid shortcuts:

- Do not move from `queued` directly to `completed` unless the job is a no-op with an operation summary.
- Do not move from `waiting_permission` to `running` without recording the permission decision.
- Do not move from `waiting_dependency` to `running` without recording the dependency repair/configuration event or requeue reason.
- Do not move from `awaiting_review` to `completed` without an approved proposal or explicit rejection result.
- Direct transition to `cancelled` requires `durableWritesApplied !== true`; active
  parse/OCR/Agent ingest may still accept `cancel_requested` and stop in a non-`cancelled` state.
  Abandon/archive is separate.

## 6. Job Record Contract

`JobRecordSchema` in `packages/schemas/src/index.ts` is the executable authority. Durable records use `state`; `status` is not a JobRecord field. `status` remains valid only for action/result DTOs such as `{ status: "requeued" }`.

`JobRecordSchema` and `OperationRecordSchema` reject undeclared root fields. Readers do not preserve or silently strip a legacy `status`, raw prompt, secret, provider response, source body, or other unversioned extension into an accepted schema-v1 record. A genuinely new durable field requires an explicit schema/version and migration decision.

Schema-v1 accepts the already-implemented core fields and the optional orchestration fields below. New long-running, permissioned, backup, restore, and migration writers populate the orchestration fields they need. Existing minimal records remain readable and gain `schemaVersion: 1` on their next safe write; no bulk rewrite is required.

Within `CancellationState`, paired `requestedAt`/`requestedBy` prove a cancel request;
either both exist or neither does. `cancel_requested` requires the pair; legacy
`cancelled` records may omit it.
`durableWritesApplied` is a monotonic, fail-closed action-safety fact, not proof of a
specific write: `true` means a retained durability boundary prevents proving a clean
cancel; omission means `false`. It survives retry, and checkpoint names never derive it.
The Job record, append-only audit/Operation entries, preserved input, and independently
actionable follow-up Jobs do not set it by themselves; Artifact, Page, note, or other
domain-output publication does.
The schema rejects a half request pair and rejects `cancelled` with a true guard.

Before first publication, current capture/parse/OCR/Agent-ingest writers reread the Job.
An earlier cancellation wins; otherwise a unique no-follow temporary write, file flush,
directory flush where supported, and atomic replacement persist `true` plus a real
`*_publication_started` checkpoint before a second cancellation check. Failure blocks
publication; a later first-write failure retains `true`. This closes only the
single-active-writer ordering window; cross-process revision CAS, parent-directory swap,
guard-to-domain atomicity, guard-without-output recovery, and packaged filesystem proof stay open.

```ts
type JobRecord = {
  id: string;
  schemaVersion: 1;
  class: JobClass;
  parentJobId?: string;
  childJobIds?: string[];
  state: JobState;
  stage?: JobStage;
  priority?: JobPriority;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  scope?: "vault" | "machine_local";
  activeVaultId?: string;
  actor?: JobActor;
  policyContextId?: string;
  policyHash?: string;
  inputRefs?: JobRef[];
  outputRefs?: JobRef[];
  permissionRequestIds?: string[];
  proposalIds?: string[];
  operationIds?: string[];
  checkpoints?: JobCheckpoint[];
  progress?: JobProgress;
  warnings?: PigeWarning[];
  error?: PigeErrorSummary;
  waitingDependency?: WaitingDependencySummary;
  retry?: RetryPolicyState;
  cancellation?: CancellationState;
  privacy?: JobPrivacySummary;
  sourceId?: string;
  captureId?: string;
  conversationEventId?: string;
  message: string;
};
```

```ts
type JobRef = {
  kind:
    | "source"
    | "source_asset"
    | "artifact"
    | "page"
    | "conversation"
    | "proposal"
    | "operation"
    | "memory"
    | "skill"
    | "package"
    | "tool"
    | "backup"
    | "external_uri";
  id?: string;
  path?: string;
  uri?: string;
  checksum?: string;
  locator?: string;
  role?: string;
};
```

```ts
type JobCheckpoint = {
  id: string;
  step: string;
  state: "not_started" | "running" | "done" | "skipped" | "failed";
  startedAt?: string;
  finishedAt?: string;
  inputRefs: JobRef[];
  outputRefs: JobRef[];
  operationId?: string;
  checksumBefore?: string;
  checksumAfter?: string;
  resumeHint?: string;
};
```

Job warnings and errors use the same error code contract as API and diagnostics. `PigeWarningSchema` and `PigeErrorSummarySchema` in `packages/schemas/src/index.ts` are the executable durable-record authority; their inferred `PigeErrorDomain` and `PigeErrorAction` types are re-exported by the API/IPC contract package, not copied as job-local enums. Job records must not accept arbitrary warning/error objects outside these schemas.

The Job record embeds only the shared `PigeWarningSchema` and
`PigeErrorSummarySchema` projections named above. Field additions or enum changes occur
once in the shared schema/API owner and must not be copied into this document.

Rules:

- Job warnings and errors must not store raw source bodies, prompts, model responses, secrets, or full unredacted external paths.
- A retryable job error must say whether retry resumes from a checkpoint or restarts the failed stage.
- `code`, `domain`, `messageKey`, `retryable`, and `userAction` must match the API/diagnostic error for the same failure.
- UI status cards should use `userAction` to choose the primary action, such as retry, repair tool, configure model, grant permission, or choose path.

```ts
type WaitingDependencySummary = {
  dependencyKind:
    | "model_provider"
    | "local_tool"
    | "local_model"
    | "runtime_capability"
    | "vault_binding"
    | "external_source";
  dependencyId?: string;
  requiredAction:
    | "configure_model"
    | "repair_tool"
    | "download_model"
    | "enable_capability"
    | "reconnect_path";
  messageKey: string;
};
```

Rules:

- `inputRefs` and `outputRefs` are references, not duplicated content.
- `actor.runtimeKind` and `actor.clientCapabilityTier` keep the record portable enough for a future remote Agent backend without storing desktop paths or credentials.
- `policyContextId` and `policyHash` record which Agent Runtime Policy Context shaped model-dependent work; they must not store full settings files or secrets.
- Full orchestration writers include `waitingDependency` when `state` is `waiting_dependency`. Existing bridge records without it remain compatible and must be augmented before an automated resume decision.
- `privacy` records whether cloud model calls, network, shell, external files, or sensitive permissions were involved.
- Unknown fields must be preserved during migrations.

## 7. Idempotency Rules

Jobs must be idempotent or detect already-applied side effects.

Required techniques:

- Stable IDs assigned before writes.
- Source checksums for managed copies.
- Before/after hashes for Markdown updates.
- Operation records for applied changes.
- Temporary write paths and atomic rename.
- Checkpoints after each durable side effect.
- Deduplication by source checksum, canonical URL, target page ID, and operation ID.

Examples:

- If a file drop copied the source and the app crashed before parsing, retry should reuse the existing source record and managed copy.
- If an operation created a source page but indexing failed, retry should not create a duplicate source page.
- If a model call completed but the write did not apply, retry may call the model again only when no durable proposal or operation exists.
- If a wiki note already exists for the deterministic source-derived page ID, retry treats the note as existing rather than creating a duplicate.
- If a backup zip finalization failed, retry creates a new archive path or replaces only a verified incomplete temp file.

## 8. Retry Policy

Retry can be automatic only for safe, bounded failures.

Automatic retry allowed:

- Transient parser worker crash before durable write.
- Timeout from local index rebuild step.
- Network timeout during user-initiated URL capture before source snapshot is finalized.
- Model provider rate limit when no partial durable write exists and backoff is bounded.

User-triggered retry required:

- Permission denied.
- Missing parser/OCR/tool/model dependency.
- Cloud model auth failure.
- External file moved or missing.
- Conflict with externally edited Markdown.
- Risky proposal rejected or expired.
- Any step that may repeat a destructive or paid action.

Retry record:

```ts
type RetryPolicyState = {
  retryCount: number;
  maxAutomaticRetries: number;
  nextRetryAt?: string;
  lastRetryReason?: string;
  requiresUserAction?: boolean;
};
```

Rules:

- Retry must not duplicate large source bodies.
- Retry must not re-run a cloud model call unnecessarily if a durable proposal/output already exists.
- Retry must explain whether it continues from a checkpoint or restarts a phase.

## 9. Cancellation

Cancellation is best effort, not data erasure.

Rules:

- Canceling capture before execution keeps its source; once capture is running, its source-page guard prevents a false clean-cancel claim, but cooperative running cancellation remains open.
- Canceling parse/OCR/`index_rebuild` jobs preserves completed artifacts and marks incomplete artifacts stale or temporary.
- Canceling Agent ingest aborts the provider call when possible and remains distinct from provider timeout; no raw partial response is persisted.
- Canceling backup removes incomplete temp archives when safe.
- Canceling restore before apply leaves the original vault untouched. Canceling during apply must finish a safe checkpoint or stop with a recovery report.
- Canceling a job with applied operations does not roll back automatically; rollback is a separate proposal or repair flow.
- Cleanup, cancellation, and compaction must follow the data lifecycle matrix in `docs/DATA_ARCHITECTURE.md`; they cannot become hidden deletion paths for durable knowledge or source evidence.

UI copy should say "Stop" or "Cancel processing" for ongoing work and avoid implying already-preserved files will be deleted.

## 10. Permission Pause

Sensitive actions route through Permission Broker.

When permission is required:

1. Job writes a checkpoint.
2. Job `state` becomes `waiting_permission`.
3. Permission request records actor, capability, resource scope, duration, reason, data boundary, and job ID.
4. UI shows a compact permission prompt unless covered by an explicit saved grant or YOLO Full Access.
5. Decision is written to permission records and conversation/job timeline.
6. Job resumes, fails, or stages a proposal depending on the decision.

Rules:

- A permission prompt must not hold important state only in renderer memory.
- Denial leaves source preservation and prior safe outputs intact.
- YOLO suppresses prompts only for covered actions and still logs decisions.

## 11. Confirmation Proposal Lifecycle

Proposal states:

```txt
draft
ready
approved
rejected
superseded
conflicted
expired
applied
```

Proposal record:

```ts
type ConfirmationProposal = {
  id: string;
  schemaVersion: number;
  jobId: string;
  createdAt: string;
  updatedAt: string;
  state: ProposalState;
  trustLevel: "review_required" | "explicit_confirmation";
  summary: string;
  reason: string;
  sourceRefs: JobRef[];
  targetRefs: JobRef[];
  proposedOperations: ChangeOperation[];
  diffRefs: JobRef[];
  warnings: string[];
  baseHashes: Record<string, string>;
  requiredPermissionIds: string[];
};
```

Rules:

- Proposals are durable before the UI displays them.
- Applying a proposal rechecks base hashes immediately before write.
- If a target changed, mark proposal `conflicted` and create a conflict proposal.
- Rejection should record enough reason to avoid repeated suggestions when possible.
- Approval creates operation records; the proposal then becomes `applied`.

Current Phase 3 foundation implementation:

- `requiredPermissionIds` is a compatibility field for permission prerequisites and may contain canonical `permreq_` request IDs or `permdec_` decision IDs. New orchestration writers should keep request and completed-decision references distinct in Job/Operation fields; a future versioned Proposal schema may split this compatibility union rather than reinterpreting existing values.
- Pige can persist `ready` proposals, list safe summaries, fetch a proposal by ID, and record `approved` or `rejected` decisions.
- `proposals.list` omits full proposed content so Home and future review queues do not accidentally duplicate large Markdown bodies or source evidence.
- `approved` means the user has allowed the proposal to proceed; it does not yet mean the proposed operations were applied to Markdown files.
- The later apply slice must recheck `baseHashes`, write operation records, then move successfully applied proposals to `applied`.

## 12. Operation Record Lifecycle

Operation records explain durable changes.

Operation record:

```ts
type OperationRecord = {
  id: string;
  schemaVersion: 1;
  jobId?: string;
  proposalId?: string;
  createdAt: string;
  actor: JobActor;
  modelProfileId?: string;
  skillId?: string;
  packageId?: string;
  permissionDecisionIds: string[];
  policyAudit?: {
    policyContextId: string;
    policyHash: string;
    enforcementOwners: string[];
  };
  modelEgressAudit?: {
    payloadHash: string;
    evidenceSummaryHash: string;
    decisionHash: string;
    payloadCharacters: number;
    estimatedPayloadTokens: number;
    normalPayloadCharacterLimit: number;
    contentClasses: ModelEgressContentClass[];
    outcome: ModelEgressDecision["outcome"];
    reasonCode: ModelEgressReasonCode;
  };
  kind: OperationKind;
  targetRefs: OperationRef[];
  sourceRefs: OperationRef[];
  before?: OperationRef;
  after?: OperationRef;
  patchRef?: OperationRef;
  summary: string;
  reversible: "yes" | "best_effort" | "no";
  rollbackHint?: string;
  warnings: string[];
};
```

`OperationRecordSchema` is the executable authority for `OperationKind`. Its lifecycle coverage is:

Executable operation-kind vocabulary (machine checked):

- `create_source_record`, `update_source_record`, `relink_source`.
- `copy_source_asset`, `move_source_asset`, `trash_source_asset`, `restore_source_asset`.
- `create_artifact`, `trash_artifact`, `restore_artifact`.
- `create_page`, `update_page`, `rename_page`, `archive_page`, `trash_page`, `restore_page`.
- `update_index`.
- `create_memory`, `update_memory`, `trash_memory`, `restore_memory`.
- `install_skill`, `disable_skill`, `uninstall_skill`.
- `install_package`, `disable_package`, `uninstall_package`.
- `change_setting`, `model_egress_decision`.
- `compact_job`, `repair_record`.
- `backup_created`, `restore_applied`, `migration_applied`.

Lifecycle coverage:

| Lifecycle area | Required operation kinds |
| --- | --- |
| Source record/evidence | create/update/relink source record; copy/move/trash/restore source asset |
| Durable artifact | create/trash/restore artifact |
| Markdown page | create/update/rename/archive/trash/restore page |
| Memory | create/update/trash/restore memory through the memory lifecycle |
| Skills/packages | install/disable/uninstall Skill or package |
| Settings/policy/model egress | change a sensitive setting with policy/permission evidence; record a pre-call model-egress decision |
| Index/job maintenance | update index, compact job, repair record |
| Backup/restore/migration | backup created, restore applied, migration applied |

Rules:

- Store patches, hashes, paths, and summaries rather than full duplicated page/source bodies.
- Operation records must be understandable without the database.
- Operation records are included in backup by default.
- Operation records must not contain API keys, raw prompts, full provider responses, or large source bodies.
- An operation affected by Agent Runtime Policy Context records `policyAudit` with the context ID/hash and enforcing service names. Permissioned operations also retain permission decision IDs. Neither field contains full settings, grant bodies, paths, prompts, or secrets.
- Before any provider credential lookup, a model-dependent Job writes an idempotent `model_egress_decision` operation containing only outcome, reason, content classes, bounded payload counts, model/source/job references, `policyAudit`, and a typed `modelEgressAudit`. Its `payloadHash` identifies the exact redacted bounded payload, `evidenceSummaryHash` identifies the source/artifact/locator summary without storing that summary body, and `decisionHash` fingerprints the complete typed decision including content classification, provider boundary, cloud policy, counts, policy hash, and permission decision. All three hashes participate in the operation identity. Reuse is allowed only when payload, evidence identity, and final decision are equivalent; changing private/privacy/sensitive metadata cannot reuse an ordinary-content audit. Confirmed or blocked attempts remain auditable even when no model call or page write occurs.
- Source relink/root change, settings change, trash/restore, backup/restore, migration, Skill/package lifecycle, and memory trash/restore must not fall through to a generic page-update record.
- Rollback is best effort and must check current file hashes before applying.

## 13. Crash Recovery

Startup recovery flow:

1. Load active vault manifest and app-local active vault path.
2. Acquire vault lock or detect another active Pige instance.
3. Scan `.pige/jobs/`, `.pige/proposals/`, `.pige/operations/`, `.pige/source-records/`, conversations, and `log.md`.
4. Rebuild SQLite job/proposal/operation indexes if missing or dirty.
5. Detect jobs in `running`, `cancel_requested`, `waiting_dependency`, `waiting_permission`, or partial stage states.
6. Reconcile checkpoint output refs with actual files and hashes.
7. Mark safe jobs resumable, retryable, or completed with warnings.
8. Mark uncertain jobs `failed_retryable` with a recovery explanation or create a repair proposal.
9. Resume queued high-priority work only after Home is usable.

Recovery decisions:

| Situation | Recovery behavior |
| --- | --- |
| Source preserved, parse not started | Resume parse. |
| Source copied, source record missing | Create repair proposal or source record if checksum/path proves source. |
| Parse artifact exists, source page missing | Resume source page creation. |
| Proposal ready, app crashed before display | Show proposal in Home status. |
| Operation record says page updated, index missing | Rebuild index. |
| Action-safety guard is true after restart | Keep it monotonic; use provenance/checksums to retry, adopt same-job output, or repair a missing derived index. Missing output never proves clean cancellation. |
| Temp file exists without operation | Validate and delete or quarantine temp file. |
| Target page changed after proposal | Mark proposal conflicted. |
| Permission prompt was open | Recreate pending permission UI or fail clearly if context expired. |

## 14. Compaction And Retention

Successful job details can grow quickly. Pige should retain trust while controlling disk growth.

Default v0.1 policy:

- Unresolved, failed, waiting-dependency, waiting-permission, and awaiting-review jobs are retained until resolved or explicitly cleared.
- Successful jobs remain detailed for 90 days.
- After 90 days, successful job records may compact to references, summaries, timings, warnings, and operation IDs.
- Conversation events, operation records, source records, proposals, `log.md`, and generated Markdown are not removed by job compaction.

Compacted job record keeps:

- Job ID, class, state, created/finished timestamps.
- Source/proposal/operation refs.
- User-visible summary.
- Warning/error summary.
- Performance metrics summary.
- Link to related conversation event.

## 15. UI Surfaces

Home:

- Shows active, failed, waiting-dependency, waiting-permission, and awaiting-review jobs as compact status rows/cards.
- Does not expose "Inbox" or "Review" as mandatory top-level concepts.
- Lets user retry, cancel, open source, open proposal, or dismiss completed summaries.

Reader:

- Shows current-note proposals and recent operations when relevant.
- Note Agent can explain what changed using operation records.

Settings:

- Index & Maintenance shows rebuild/repair jobs.
- Vault & Note Storage can show last backup and restore state.
- Diagnostics can export redacted job/operation summaries.

Rules:

- Completed jobs should say what changed in the vault.
- Failed jobs should say what was preserved and what can be retried.
- Permission and proposal states should survive window close and app restart.

## 16. Backup, Restore, And Migration

Stable ID, schema-version, tombstone, migration-plan, and backup compatibility rules are defined in `docs/SYNC_CONFLICT_AND_MIGRATION.md`.

`docs/DATA_ARCHITECTURE.md` owns the exact backup include/exclude matrix. Every durable
job, proposal, operation, and conversation reference still present after governed
compaction enters the vault backup; rebuildable indexes, worker temporary data, and raw
model payloads do not become durable merely because a Job used them.

Restore rules:

- Restore preview reads job/proposal/operation records and reports unresolved work.
- Restore identity follows the explicit modes in `docs/DATA_ARCHITECTURE.md`: `replace_existing` preserves the vault ID; `clone_as_new` mints a vault ID and records lineage. A destination folder alone does not choose the mode.
- After restore, job indexes are rebuilt.
- Jobs that cannot safely resume on the new machine become `failed_retryable` or `failed_final` with repair guidance.

Durable execution gates:

- Backup creates a durable `backup` job before preflight and checkpoints `preflight`, manifest emission, hashing, staged archive creation, staged validation, and atomic finalization.
- Restore apply creates a durable `restore` job before extraction and checkpoints manifest compatibility, destination reservation, staging extraction, durable-domain migration, external dependency reconciliation, mode-specific vault identity, destination commit, and index rebuild.
- Staging paths are job-local temporary references, not durable output truth. A restart reconciles them using checkpoint hashes; cancellation removes only proven incomplete staging data.
- A successful backup/restore job links the `backup_created`/`restore_applied` operation. Failure/cancellation never registers a staging directory as a vault or overwrites a valid archive/vault silently.

Current implementation boundary: the foundation backup/restore service validates and stages archives but does not yet emit the full durable jobs/checkpoints or explicit restore mode. Those gates are required before claiming the full recovery contract; legacy format-v1 backups remain readable through the compatibility rules in `docs/SYNC_CONFLICT_AND_MIGRATION.md`.

Migration rules:

- Migration tooling preserves records from a newer or unknown schema version as opaque bytes until a compatible migrator is available; it must not parse them through schema v1 and silently discard fields. Within schema v1, Job and Operation records are strict, so adding a durable field requires a versioned migration rather than an undeclared passthrough field.
- Risky migration creates pre-migration backup or confirmation proposal.
- Migration itself writes an operation record.

## 17. Future Remote Agent Backend And Mobile

Job contracts must not assume desktop-only execution.

Schema-v1 portability fields:

- `actor.runtimeKind`: `desktop_local` or `remote_agent_backend`.
- `actor.clientCapabilityTier`: `desktop_full`, `web_client`, or `mobile_lite`.
- `privacy`: redacted evidence of cloud-model, network, shell, external-file, and permission involvement.

`executionLocation`, backend deployment identity, and richer data-boundary metadata require an additive shared-schema change before a future remote runtime emits them; they are not free-form job-local aliases.

Rules:

- Mobile Lite can create capture jobs, offline queued jobs, and retrieval requests, but does not run arbitrary local tools.
- Remote Agent Backend can execute Agent jobs, but durable writes still need client/vault reconciliation and permission records.
- Job/proposal/operation IDs must be sync-ready and independent from filesystem paths.

## 18. Tests And Fixtures

Required tests:

- Job state transition validation.
- Durable Job warnings/errors reject arbitrary records and use the shared API/diagnostic error taxonomy.
- Durable job creation before parser/model work.
- Capture crash after source preservation.
- Parser crash after artifact creation.
- Retry without duplicate source/page creation.
- Cancellation after partial artifacts.
- Permission denial leaves job stable.
- Pending permission survives restart.
- Proposal apply with matching hash.
- Proposal conflict when target file changed.
- Operation record excludes secrets and large source bodies.
- Policy-sensitive operation retains policy context ID/hash, enforcing owners, and permission decision IDs without settings or secret values.
- Source/page/artifact/memory/Skill/package/settings/trash/restore lifecycle actions map to a specific `OperationKind` rather than a generic update.
- Database deletion rebuilds job/proposal/operation indexes.
- Job compaction keeps operation and conversation references.
- Backup/restore preserves unresolved jobs and proposals.
- Backup crash/retry reconciles staged archive checkpoints without overwriting a valid archive.
- Restore crash/retry never registers staging as a vault and enforces replace-vs-clone identity semantics.
- Restore on another machine marks non-resumable desktop-local jobs clearly.

Fixture scenarios:

- Multi-file drop with one failed file.
- URL capture timeout before and after snapshot preservation.
- OCR job canceled mid-document.
- Model call succeeds but Markdown write fails.
- App restart with `running`, `waiting_permission`, and `awaiting_review` jobs.
- External edit between proposal creation and approval.

## 19. Implementation Checklist

Before implementing a workflow, answer:

- What job class owns it?
- Is a durable job record created before expensive or failure-prone work?
- What are the checkpoints?
- What side effects are idempotent?
- What happens on retry?
- What happens on cancellation?
- What happens if the app restarts after each checkpoint?
- Which outputs become source records, artifacts, pages, proposals, operations, conversations, or indexes?
- Which actions need permission?
- Which actions need confirmation?
- What is shown in Home while it runs, fails, waits, or completes?
- Does backup/restore preserve enough state?
- Does the contract work for future remote Agent backend or Mobile Lite?
