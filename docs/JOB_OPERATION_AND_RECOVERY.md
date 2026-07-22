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
   Source-bearing evidence is preserved before parsing, OCR, model calls, or compilation;
   pure conversation creates no artificial Source Record.

2. Durable work before expensive work.
   Any expensive, asynchronous, permissioned, or failure-prone action must create a durable job record before it starts.

3. Recoverability enables autonomy.
   Validated reversible work writes Operations; only exceptional boundaries use proposals.

4. Jobs are operational history, not knowledge truth.
   Jobs explain work. Durable knowledge lives in Markdown, source records, artifacts, memory files, proposals, operations, and logs.

5. Recovery must be boring.
   After restart, Pige scans durable job/proposal/operation records, reconciles files, and resumes or explains without drama.

6. Jobs execute decisions; they do not make semantic decisions.
   Pi Agent chooses tool order; Jobs persist, dispatch, cancel, retry, and recover those
   calls without inferring another semantic step.

## 3. Durable Locations

Pige has two job scopes:

- Vault-scoped jobs: work owned by an existing vault, source record, source asset,
  Markdown page, proposal, operation, memory, Skill, backup, or index.
- Machine-local jobs: work that belongs to the app installation or device, such as local
  model download, bundled tool repair, app update checks, machine-local package
  installation, and restore coordination before a destination vault exists.

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
- A successful machine-local Restore Job may link to a vault-scoped `restore_applied`
  Operation: `Operation.jobId` points to the Job and Job `operationIds`/`outputRefs` point
  back. The cross-scope link does not migrate or duplicate the Job into the vault.

Current implementation evidence, class-specific recovery coverage, and structured open
work live only in the Playbook and acceptance manifest. The sections below own the
stable lifecycle, ordering, cancellation, action-safety, and compatibility rules.

## 4. Job Classes

Required v0.1 job classes:

| Class | Example | Durable outputs | Can cancel? | Can retry? |
| --- | --- | --- | --- | --- |
| `capture_batch` | parent for a multi-file drop/import | child job IDs and aggregate result only | Yes before all children finalize | Yes for safe failed children |
| `capture` | text, file, URL, image drop | source record, source asset/reference, conversation event | Before source finalization only | Yes |
| `parse` | PDF/DOCX/PPTX/text extraction | extracted artifact, parser metadata | Yes where tool supports | Yes |
| `ocr` | screenshot or rendered PDF page OCR | OCR artifact, confidence metadata | Yes where tool supports | Yes |
| `dataset_import` | Pi-selected CSV/XLSX/SQLite materialization | Dataset manifest/schema/revision/payload and operation | Yes before bundle commit | Yes |
| `agent_ingest` | typed `legacy_agent_ingest` compatibility/recovery only | source page, wiki pages, proposal/operation | During model/tool stages | Yes |
| `agent_turn` | unified Home text and bounded preserved attachments | conversation events, answer/source/proposal refs | During model/tool stages | Yes |
| `retrieval_query` | legacy Home grounded-answer record | conversation event, optional saved page | Yes | Usually yes |
| `index_rebuild` | FTS/vector/graph rebuild | SQLite/index files | Yes | Yes |
| `backup` | create backup zip | backup archive and manifest | Yes before finalization | Yes |
| `restore` | preview/apply backup | restored vault, restore report | Preview yes, apply guarded | Only through new preview |
| `permissioned_skill` | external/Web Skill action | operation/proposal/tool output | Depends on action | Depends on action |
| `tool_install` | model/tool/package download | app-data install manifest | Yes | Yes |
| `migration` | schema/frontmatter migration | migrated files, operation records | Usually no after apply starts | Only through new plan |
| `maintenance` | compaction, cleanup, health check | compacted job refs, repair proposals | Yes | Yes |

`packages/schemas/src/index.ts` owns executable `JobClassSchema`; this table explains its
exact values. Aliases such as `capture_preserve`, `parse_source`, `backup_create`, or
`restore_validate` are forbidden.

`agent_turn` atomically binds the exact authored user event, one parent Job and ordered
source/current-note refs. Picker staging is not Job state. Main acknowledges durable
acceptance before renderer clearing; rejection leaves the composer unchanged. Exact
client-turn retry adopts the parent/event/source refs and cannot duplicate preservation.
Short chat creates no Source Record. Multi-attachment preservation checkpoints or child
executors are reliability ownership only and never a Host-selected semantic ingest chain.

Reader selection resolves render endpoints to checksummed page/UTF-8-span/content/action refs;
body is reread, never copied into Job/instruction. Recovery rejects drift and adopts existing
Operation/proposal. Input hash binds Host instruction plus strict presentation enum; UI
localizes the enum instead of prompt matching.

An in-progress Home `draft_replace` is sender/turn/Job-bound temporary UI state, never a
conversation event, checkpoint, recovery input or assistant truth. Only validated
tool/effect results and the durable upstream Pi final survive restart; cancellation/failure stops delivery and
cannot promote the last draft.

A durable upstream Pi Dataset final stores one bounded preview and exact citation in its
checksum-bound assistant event. `agent_turn` refs bind source, Dataset, revision, table
and assistant checksum; restart adopts it without another query/model turn. Preview or
citation tampering fails recovery. Whole payloads, SQL, paths, handles and raw provider
output never enter Job/conversation records.

Jobs may have parent-child structure:

- A multi-file drop creates one parent `capture_batch` job and one child job per source.
- New sources require top-level `agent_turn | capture_only`. Missing-field old records
  normalize to `legacy_agent_ingest`, the sole compatibility parent; unknown values fail.
- Pi-selected parse/OCR/Dataset children bind parent plus Pi run/call provenance and
  return one deterministic outcome; they never choose a successor tool.
- Recovery may resume that child, not invent another call. Its mechanical index/log
  projection may finish inside the approved write recovery boundary.
- Backup/restore may create child jobs for scan, manifest, compression, extraction, and rebuild.

The acceptance manifest records whether `capture_batch`, multi-source recovery, and
Agent-selected continuations have executable delivery evidence; this table does not
maintain a second status projection.

`dataset_import` is the executable child class for Pi-selected materialization of a
preserved CSV, XLSX, or supported SQLite source. The deterministic child binds its Agent
parent, tool/catalog/policy/source revision, and canonical input before work; the Bundle
materializes only after manifest/schema plan, payload hashes, and target revision are
checkpointed. Retry/restart adopts the same verified child, Bundle, and Operation, while
cancellation before bundle commit preserves only source evidence. For a Home attachment,
successful materialization records the Dataset/revision refs and requeues the same
`agent_turn` at `planning`; Pi then answers the original request through the bounded
Dataset query tool. That continuation catalog is limited to the exact current source,
Dataset, and revision refs; unrelated historical Datasets cannot block or enter the
answer context. Restart adopts that continuation without another source loop or Dataset
revision. Dataset query remains read-only and revision-bound; Collection/view/
derived-Dataset changes still require deterministic operation identity, revision fences,
Activity/Undo, and restart recovery.

## 5. Job State Machine

Required canonical states:

```txt
queued
running
waiting_dependency
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
importing
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
- `waiting_dependency` pauses for a missing model, tool, capability, binding, or source;
  Backup resumes the same Job after root repair.
- `awaiting_review` holds an irreversible/security/destination/conflict or stricter-policy
  proposal only.
- `cancel_requested` is transitional; duplicate requests are idempotent and the active worker exits at a safe checkpoint.
- `completed_with_warnings` is success with recoverable or explainable issues.
- `failed_retryable` keeps enough checkpoint data to retry safely.
- `failed_final` means retry requires changed input, missing dependency repair, or user decision.
- `compacted` means detailed job payload was reduced after retention, but durable effects remain in operations, conversations, pages, and logs.

Invalid shortcuts:

- Do not move from `queued` directly to `completed` unless the job is a no-op with an operation summary.
- Migrated Jobs/Home waits resume only through exact typed proof.
- Do not move from `awaiting_review` to `completed` without an approved proposal or explicit rejection result.
- `JobExecutionCoordinator` projects late cancellation from durable-effect proof;
  H3b/H3c still own remaining loops and dispatch. Abandon/archive is separate.
- Backup transitions remain specialized pending coordinator migration.

## 6. Job Record Contract

`JobRecordSchema` in `packages/schemas/src/index.ts` is the executable authority. Durable records use `state`; `status` is not a JobRecord field. `status` remains valid only for action/result DTOs such as `{ status: "requeued" }`.

`JobRecordSchema` and `OperationRecordSchema` reject undeclared root fields. Readers do not preserve or silently strip a legacy `status`, raw prompt, secret, provider response, source body, or other unversioned extension into an accepted schema-v1 record. A genuinely new durable field requires an explicit schema/version and migration decision.

Schema-v1 accepts the already-implemented core fields and the optional reliability fields
below. New long-running, backup, restore, and migration writers populate only what their
recovery owner needs. Existing minimal records remain readable and gain `schemaVersion:
1` on their next safe write; no bulk rewrite is required.

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

Before publication, capture/parse/OCR/Agent-ingest rereads Job; cancellation wins. An
exclusive no-follow temp write + file/directory flush and atomic replace persists `true`
plus a checkpoint before another cancellation check; failure leaves `true`. The current
shared Job store additionally requires the active per-vault writer lease, an ephemeral
per-Job claim, and the exact prior record revision `{ sha256, size, dev, ino }`; it
rereads and revalidates these immediately before replace and verifies committed bytes.
Claim/revision contention preserves the winner and cannot rewrite the loser as failed.
Each Job has a distinct upstream lock key. A private sentinel record binds the opaque
owner token to an independent random 256-bit generation. Exact identity includes its
name, device/inode, bounded byte length and SHA-256; active, stale and release checks use
bounded no-follow descriptor readback plus named-path mode/size/mtime/ctime comparison.
Initialization either cleans its exact opened identity on failure or leaves a bounded
malformed sentinel that only stale, directory/freshness/entry-identity-revalidated
cleanup may recover; unknown, multiple, symlinked, freshened, content-changed or
successor identities fail closed. Normal, stale, and process-exit cleanup all use the
same successor-safe ownership fence.
This proves fenced single-writer ordering for the adopted capture, Agent, Dataset,
retry/cancel, proposal/publication, and startup-recovery paths. Other Job classes,
cross-file atomicity, user-visible conflict resolution, and parent-swap-resistant
domain publication remain open.

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
- Retryable Agent-parent failures persist one stable shared error summary even when the
  runtime/provider exception is transient; the summary remains body-free and redacted.
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
- If a model call completed but the write did not apply, retry may call the model again only when no durable proposal or operation exists. A committed compatible Operation is
  reconciled before model-readiness checks; recovery must not require credentials or a
  replacement model turn merely to adopt an already durable effect.
- If a wiki note already exists for the deterministic source-derived page ID, retry treats the note as existing rather than creating a duplicate.
- If a backup zip finalization failed, retry creates a new archive path or replaces only a verified incomplete temp file.

## 8. Retry Policy

Retry can be automatic only for safe, bounded failures.

### 8.1 Pi Turn Recovery Is Reliability, Not Semantic Dispatch

A durable `agent_turn` or historical `agent_ingest` may contain multiple Pi turns/tools.
Jobs recover the same Pi turn, tool/effect identities, checkpoints and cancellation; they
do not choose a semantic next step, require a terminal tool, or repair assistant prose.

- Pi may gather more evidence, revisit a read-only/idempotent tool, correct a rejected
  tool input, or finish naturally. The Job coordinator observes events and owns durable
  reliability only.
- Tool/effect validation failures may return typed boundary feedback. Missing grounding,
  citation shape, answer schema or Pige terminal call is not a Job failure or retry cause.
- Service-owned wall-time, model/tool-work, byte, and non-progress bounds prevent runaway
  cost or loops without prescribing a fixed semantic route or one-correction limit.
- Reaching one internal execution slice checkpoints a body-free PlanSummary/failure
  fingerprint and autonomously resumes or replans the same Job when doing so cannot repeat
  an uncommitted destructive effect. It does not ask the user to resubmit the prompt.
- A persistent provider/tool-protocol incompatibility, unavailable capability, authority
  denial, cancellation, or irreconcilable conflict transitions to its distinct typed
  blocked/failed state. Recoverable validation alone never owns a user-visible failure.
- No intermediate candidate becomes a conversation event, Job output, proposal, or
  Operation. Deterministic call/effect identity and existing claim/CAS rules still guard
  every accepted durable effect.

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
- Any step that may repeat a destructive effect or an unbounded/unknown paid action.
  Bounded corrective model turns inside the same exact connected-BYOK Agent Job are
  Agent-internal completion work, not a user-triggered retry.

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
- Job coordination never selects Pi's next semantic action.

## 9. Cancellation

Cancellation is best effort, not data erasure.

Rules:

- Canceling capture before execution keeps its source; once capture is running, its source-page guard prevents a false clean-cancel claim, but cooperative running cancellation remains open.
- Canceling parse/OCR/`index_rebuild` preserves completed artifacts and marks incomplete artifacts stale or temporary.
- Canceling `agent_turn` or Agent ingest durably requests cancellation before aborting Pi/provider and active tools; clean pre-publication cancellation writes no assistant/partial response and remains distinct from timeout.
- Canceling backup removes incomplete temp archives when safe.
- Canceling restore before apply leaves the original vault untouched. Canceling during apply must finish a safe checkpoint or stop with a recovery report.
- Canceling a job with applied operations does not roll back automatically; Undo/repair is a separate operation flow.
- Cleanup, cancellation, and compaction must follow the data lifecycle matrix in `docs/DATA_ARCHITECTURE.md`; they cannot become hidden deletion paths for durable knowledge or source evidence.

UI copy should say "Stop" or "Cancel processing" for ongoing work and avoid implying already-preserved files will be deleted.

## 10. High-Risk Decisions Are Not Job States

New Jobs never enter `waiting_permission` or `waiting_model_egress`. Ordinary registered
first-party tools inherit the submitted turn; connected Provider identity plus Send owns
ordinary cloud authorization. A high-risk effect returns a typed decision requirement to
the current turn or Operation, and denial executes nothing.

Jobs may record Pi-selected work and recover the same turn, but must never become a Host
semantic state machine or dispatch pipeline.

The effect owner—not a parallel approval store—owns deterministic effect identity,
checkpoint, CAS/idempotency, cancellation, commit, and recovery. If the app cannot prove
whether an irreversible effect committed, it fails closed and exposes repair; it does
not mint new authority or replay the effect. Unpublished legacy waiting records may be
cleared or rejected in AR1 rather than receiving a long-lived migration protocol.

## 11. Confirmation Proposal Lifecycle

Validated same-vault work commits with an Operation when evidence-bound, checksum-current,
and recoverable. Only irreversible loss, authority/security escalation, destination drift,
unreconcilable conflict, or an explicit stricter user policy waits as a proposal.

Proposal states are `draft | ready | approved | rejected | superseded | conflicted |
expired | applied`.

Executable `ConfirmationProposalSchema` owns the durable record: identity/state/trust,
Job/source/target/diff refs, operations, warnings and base hashes.

Proposals persist before display. Full records/decisions stay Main-only; apply rechecks base
hash, changed targets conflict, rejection records recurrence context, and approval creates an
Operation before `applied`. Historical ingest can recover; new turns use only a bounded owner.

Reader transforms auto-apply through the reversible writer or stage a private exceptional
proposal. Renderer gets only bounded preview; Main-owned revision-fenced approve/reject and
interrupted resolving/applied/rejected recovery reconcile the same Job/identity/writer.

Current supported operations, recovery evidence, and open mutation families live in
acceptance. High-risk decisions are exact current effects outside proposal and Job state.

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
- `create_dataset_revision`.
- `create_page`, `update_page`, `rename_page`, `archive_page`, `trash_page`, `restore_page`.
- `update_index`.
- `create_memory`, `update_memory`, `trash_memory`, `restore_memory`.
- `install_skill`, `disable_skill`, `uninstall_skill`.
- `install_package`, `disable_package`, `uninstall_package`.
- `change_setting`.
- `compact_job`, `repair_record`.
- `create_external_file` (reserved for the unregistered external create-only foundation).
- `backup_created`, `restore_applied`, `migration_applied`.

Lifecycle coverage:

| Lifecycle area | Required operation kinds |
| --- | --- |
| Source record/evidence | create/update/relink source record; copy/move/trash/restore source asset |
| Durable artifact | create/trash/restore artifact |
| Dataset revision | create dataset revision with manifest/schema/payload/source hashes |
| Markdown page | create/update/rename/archive/trash/restore page |
| Memory | create/update/trash/restore memory through the memory lifecycle |
| Skills/packages | install/disable/uninstall Skill or package |
| Settings/policy | change a sensitive setting with exact effect evidence |
| Index/job maintenance | update index, compact job, repair record |
| Backup/restore/migration | backup created, restore applied, migration applied |

Rules:

- Store patches, hashes, paths, and summaries rather than full duplicated page/source bodies.
- Operation records must be understandable without the database.
- Operation records are included in backup by default.
- Operation records must not contain API keys, raw prompts, full provider responses, or large source bodies.
- `create_external_file` uses one opaque checksummed `external_resource`; paths stay in
  a machine-local journal binding parent/leaf and rejecting v1. Receipts prove no effect;
  other effects are `failed_uncertain`; completion prevents replay.
- An operation affected by Agent Runtime Policy Context records `policyAudit` with the context ID/hash and enforcing service names. Permissioned operations also retain permission decision IDs. Neither field contains full settings, grant bodies, paths, prompts, or secrets.
- Provider sends do not create a content-class, allow/block, payload-digest, or approval
  Operation. Durable Agent work may retain Provider/model and
  selected-evidence identity needed for recovery, but never stored credentials or raw
  payload bodies.
- Source relink/root change, settings change, trash/restore, backup/restore, migration, Skill/package lifecycle, and memory trash/restore must not fall through to a generic page-update record.
- `create_page.after` binds result hash/path; `trash_page` binds unchanged live `before`
  and private-trash `after`; later edits are never signed retroactively.
- Rollback is best effort and must check current file hashes before applying.

## 13. Crash Recovery

Startup recovery flow:

1. Load active vault manifest and app-local active vault path.
2. Acquire the fenced per-vault writer lease under `.pige/runtime/` or fail closed when
   another owner is active; stale recovery must revalidate canonical vault/root and lock
   directory identity, current mtime/freshness, and the sentinel generation, bounded
   content hash and named-path metadata twice around the cleanup commit boundary before
   mutable services start. Same-name inode reuse is not accepted as identity.
3. Scan `.pige/jobs/`, `.pige/proposals/`, `.pige/operations/`, `.pige/source-records/`, conversations, and `log.md`.
4. Rebuild SQLite job/proposal/operation indexes if missing or dirty.
5. Detect jobs in `running`, `cancel_requested`, `waiting_dependency`,
   legacy waiting or partial stage states; AR1 may reject/clear unpublished approval
   states rather than migrate them into the new vocabulary.
6. Reconcile checkpoint output refs with actual files and hashes.
7. Mark safe jobs resumable, retryable, or completed with warnings.
8. Mark uncertain jobs `failed_retryable` with a recovery explanation or create a repair proposal.
9. Resume queued high-priority work only after Home is usable.

The lease and Job claims are temporary coordination state, not recovery evidence. They
are excluded from backup/restore/sync and recreated empty; durable Job bytes,
checkpoints, output refs, Operations, and domain hashes remain the recovery authority.
The final `lstat`-to-`unlink`/`rmdir` syscall interval remains a platform primitive
TOCTOU boundary; Windows and installed-package multi-process proof remain open.

Recovery decisions:

| Situation | Recovery behavior |
| --- | --- |
| Source preserved, no selected child | Wake the Agent parent; never infer parse/OCR/retrieval from source shape. |
| `agent_turn` has a valid assistant event | Adopt its checksum-bound output refs and finish without another model call. |
| Generated-page create/update Undo is interrupted | Adopt page/private-image/trash/index/quarantine/Operation only when IDs/hashes agree; else preserve/fail closed, then rebuild. |
| Source copied, source record missing | Create repair proposal or source record if checksum/path proves source. |
| Parse artifact exists, source page missing | Resume source page creation. |
| Proposal ready, app crashed before display | Reconcile in Main; renderer review stays unavailable pending a bounded projection. |
| Operation record says page updated, index missing | Rebuild index. |
| Action-safety guard is true after restart | Keep it monotonic; use provenance/checksums to retry, adopt same-job output, or repair a missing derived index. Missing output never proves clean cancellation. |
| Temp file exists without operation | Validate and delete or quarantine temp file. |
| Target page changed after proposal | Mark proposal conflicted. |
| Dataset revision or schema changed after query/write plan | Reject stale evidence or preserve a new revision; never replay against a different base. |
| Dataset payload exists but manifest/revision/Operation is incomplete | Adopt only when every planned ID/hash matches; otherwise quarantine/preserve and fail closed. |
| High-risk confirmation owner disappears | Withdraw the exact confirmation by owner/revision; never convert it into a Job waiting state or replay the effect. |

## 14. Compaction And Retention

Successful job details can grow quickly. Pige should retain trust while controlling disk growth.

Default v0.1 policy:

- Unresolved, failed, waiting-dependency, and awaiting-review jobs are retained until resolved or explicitly cleared.
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

- Shows active, failed, waiting-dependency, and awaiting-review jobs as compact status rows/cards.
- Does not expose "Inbox" or "Review" as mandatory top-level concepts.
- Shows compact Activity/Undo; users retry, cancel, inspect, or resolve exceptions.

Reader:

- Shows exact selection read/transform turns; exceptional Reader transforms expose only
  bounded preview and Main-owned decisions, never legacy raw proposal records.
- Shows recent safe operation summaries when relevant.
- Note Agent can explain what changed using operation records.

Settings:

- Index & Maintenance shows rebuild/repair jobs.
- Vault & Note Storage alone owns restarted user Backup state, valid Cancel/Retry and
  typed redacted failure; rollback children stay hidden.
- Diagnostics can export redacted job/operation summaries.

Rules:

- Completed jobs should say what changed in the vault.
- Failed jobs should say what was preserved and what can be retried.
- Durable proposal and Job states survive window close and app restart. A high-risk confirmation is owned by one exact live effect and is withdrawn when that owner expires.

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
- Restore coordination is machine-local from creation through terminal state because it
  must work with no active vault. Staging is temporary state, never a vault or Job owner.

Durable execution gates:

- Backup creates a durable `backup` job before preflight; stable Job/Backup/destination
  identity owns `preflight`, `manifest_written`, `files_hashed`, `archive_staged`,
  `archive_finalized`.
- Restore apply creates a durable machine-local `restore` Job before extraction and
  checkpoints `manifest_validated`, `destination_reserved`, `archive_extracted`,
  `durable_domains_migrated`, `external_dependencies_reconciled`,
  `vault_identity_finalized`, `destination_committed`, and `indexes_rebuilt`.
- Staging is temporary; restart adopts exact checkpoint-bound bytes and cancellation
  removes only owned incomplete data.
- A successful backup Job links `backup_created`. A successful machine-local Restore Job
  and the restored vault's `restore_applied` Operation link each other by stable IDs.
  Failure/cancellation never registers staging as a vault or overwrites a valid
  archive/vault silently.
- `replace_existing` uses a verified rollback Backup Job/Operation, a fresh destination,
  and an exact machine-binding CAS; it retains the old physical folder unregistered.
  Its stable child resumes checkpoint digests, never a ZIP alone. `clone_as_new` mints
  identity and lineage.

Legacy format-v1 stays readable per `docs/SYNC_CONFLICT_AND_MIGRATION.md`. Current
backup/restore checkpoint delivery and residual transport/restart/platform work live in
the Playbook and acceptance manifest.

Migration rules:

- Migration tooling preserves records from a newer or unknown schema version as opaque bytes until a compatible migrator is available; it must not parse them through schema v1 and silently discard fields. Within schema v1, Job and Operation records are strict, so adding a durable field requires a versioned migration rather than an undeclared passthrough field.
- Destructive migration creates a pre-migration backup and intervention; safe reversible migration records an Operation.
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
- App restart with `running`, `waiting_dependency`, and `awaiting_review` jobs.
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
