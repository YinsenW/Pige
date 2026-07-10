# Sync, Conflict, And Migration Readiness

Status: Draft baseline
Date: 2026-07-09

## 1. Purpose

v0.1 does not implement cloud sync, device-to-device sync, Git sync, or mobile sync.

Even so, Pige must make sync-ready choices now so future sync, remote Agent backends, Web clients, and mobile clients do not require a major rewrite.

This document is the authority for:

- Stable IDs and object identity.
- Device/client/runtime metadata reserved for future sync.
- Conflict detection and conflict proposals.
- Delete/tombstone behavior.
- Schema versioning and durable file migrations.
- App/vault/database/model/tool version boundaries.
- Sync-adapter boundaries that must not leak into v0.1 product scope.

## 2. Non-Goals For v0.1

Do not build in v0.1:

- Cloud sync.
- Git-backed automatic version history.
- CRDT collaboration.
- Multi-user shared editing.
- Mobile app sync.
- Remote Agent backend sync.
- Background server reconciliation.

Do build in v0.1:

- Stable IDs for durable objects.
- Operation records with enough metadata for future reconciliation.
- Conflict detection for local external edits.
- Conflict proposals instead of silent overwrite.
- Schema versions on durable records.
- Migration rules that preserve unknown fields.
- Backup/restore manifests that preserve IDs.

## 3. Durable Identity

Object identity must not depend on paths, titles, slugs, source filenames, URLs, or display language.

Durable sync-ready objects:

- Vault.
- Source record.
- Source asset reference or managed source copy.
- Extracted artifact.
- Markdown page.
- Conversation.
- Conversation event.
- Job.
- Confirmation proposal.
- Operation record.
- Agent memory event/atom/scenario.
- Skill.
- Package install record.
- Backup manifest.

Required ID rules:

- IDs are opaque.
- IDs are stable across rename, move, backup, restore, and future sync.
- IDs appear in frontmatter or sidecar JSON for durable objects.
- Slugs and filenames are display/location hints, not identity.
- Duplicate detection must compare IDs first, then checksums, canonical URLs, aliases, and semantic similarity.

Canonical emitted ID vocabulary is defined by the shared schemas in `packages/schemas/src/index.ts`. Representative shapes:

```txt
page_20260709_7f3a5b6c
src_20260709_ab12cd34
art_20260709_ab12cd34_text
evt_20260709_f9e23456
op_20260709_3456abcd
```

The date helps debugging, but code treats the whole ID as opaque. New writers never emit retired `pg_`, `artifact_`, or `event_` aliases. A documented legacy reader may retain an old ID for compatibility, but migration must not silently rename that durable object; acceptance is not permission for new output.

## 4. Version Stamps

Every durable object that can be updated should carry a version stamp.

Recommended version fields:

```ts
type VersionStamp = {
  objectId: string;
  schemaVersion: number;
  updatedAt: string;
  updatedBy: ActorRef;
  operationId?: string;
  baseOperationId?: string;
  contentSha256?: string;
  metadataSha256?: string;
  deletedAt?: string;
  tombstone?: boolean;
};
```

Rules:

- `updatedAt` is useful for humans and sorting, but conflict detection must not rely on timestamp alone.
- `contentSha256` detects file body changes.
- `metadataSha256` detects frontmatter/sidecar changes when body is unchanged.
- `baseOperationId` links an edit to the last known operation used as its base.
- External edits may not have operation IDs; Pige should create an operation summary when it accepts or stages them.
- Unknown version fields must be preserved.
- Canonical source-record sidecars carry `schemaVersion` and `updatedAt`; their file SHA-256 can be projected into a source page to detect drift. Source-page frontmatter never replaces the sidecar's version/locator authority.

## 5. Actor And Device Metadata

Future sync needs to know where a change came from without exposing secrets.

```ts
type ActorRef = {
  actorKind:
    | "user"
    | "pige_agent"
    | "system"
    | "skill"
    | "package"
    | "migration"
    | "remote_backend";
  actorId?: string;
  actorVersion?: string;
  deviceId?: string;
  clientId?: string;
  runtimeKind?: "desktop_local" | "remote_agent_backend";
  clientTier?: "desktop_full" | "web_client" | "mobile_lite";
};
```

Rules:

- Device/client IDs are stable machine-local identifiers, not secrets.
- Device/client IDs are stored in app data and referenced in operation records when useful.
- Vault-scoped operation records may include device/client IDs, but not OS usernames, hostnames, API keys, or raw provider credentials.
- Desktop YOLO grants do not imply future remote/mobile YOLO grants.

## 6. Change Records

Future sync should reconcile durable operation records, not infer all history from database rows.

Operation records should include:

- Operation ID.
- Affected object IDs.
- Object type.
- Paths before and after when applicable.
- Base hash and resulting hash.
- Actor metadata.
- Permission decision IDs when relevant.
- Proposal ID when relevant.
- Summary and warnings.
- Patch reference when useful and not too large.
- Agent Runtime Policy Context ID/hash and enforcing owners for policy-sensitive work, plus permission decision IDs when applicable.

Operation records should not include:

- Full source asset bodies.
- Full page bodies when a patch/hash is enough.
- API keys or tokens.
- Raw prompts or full provider responses by default.
- Rebuildable index rows.

## 7. Conflict Detection

Conflict detection uses layered evidence:

1. Stable object ID.
2. Expected path and current path.
3. Base content hash.
4. Current content hash.
5. Base operation ID.
6. Updated timestamp.
7. Source checksum or canonical URL when source-related.
8. User-visible title/slug only as a weak signal.

Conflict cases:

| Case | Example | v0.1 behavior |
| --- | --- | --- |
| Same ID, same path, different content | User edited Markdown while proposal was pending. | Stage conflict proposal. |
| Same ID, moved path | User moved note outside Pige. | Update manifest/index if safe; otherwise stage proposal. |
| Different IDs, same slug/title | Imported duplicate topic. | Keep both, suggest merge. |
| Delete vs update | Page archived while another operation updates it. | Stage proposal, never silently resurrect or delete. |
| Source changed externally | Referenced original file modified. | Mark source state `changed`, offer re-ingest. |
| Missing referenced original | External file moved/deleted. | Mark `missing_source`, offer relink. |
| Source page projection differs from sidecar | User edited or stale generated source metadata. | Preserve Markdown; sidecar remains operational authority; stage repair/conflict rather than copying paths in either direction. |
| External managed-copy root missing | A source record's `rootId` has no available machine binding. | Set dependent jobs `waiting_dependency`, request reconnect/restore, never retarget to the current default root. |
| Schema version too new | Vault edited by newer Pige. | Open read-only or block with clear message. |

Rules:

- Pige never silently overwrites user-edited Markdown when base hash changed.
- Pige never silently deletes durable Markdown, source assets, memory, conversations, proposals, or operations.
- When uncertain, create a confirmation proposal.
- Conflict proposals should show current content, proposed change, base metadata, affected paths, and possible actions.
- `docs/SOURCE_STORAGE_STRATEGY.md` section 5 owns the Source Record/Source Page projection commit protocol and its residual concurrency windows; this document owns only the general conflict outcome and does not restate that mechanism.

## 8. Conflict Proposal Actions

Required v0.1 actions:

- Keep current version.
- Apply proposed version.
- Save proposed version as a new page.
- Open manual edit.
- Retry after reloading current file.

Future sync actions:

- Accept local.
- Accept remote.
- Keep both.
- Merge manually.
- Merge with Agent assistance.

Rules:

- Agent-assisted merge is a proposal, not an automatic write.
- Merge proposals must cite both base and changed versions.
- Merges that affect many links or relationships require explicit confirmation.

## 9. Deletes, Archives, And Tombstones

Future sync needs to distinguish "deleted intentionally" from "missing locally".

The data lifecycle and deletion authority matrix is defined in `docs/DATA_ARCHITECTURE.md`. This section adds sync-ready tombstone semantics.

v0.1 behavior:

- All v0.1 delete/archive authority, confirmation, trash placement, referenced-original
  protection, and operation recording follows the lifecycle matrix in
  `docs/DATA_ARCHITECTURE.md`. Sync contributes tombstone/conflict consequences only;
  it does not maintain a second deletion policy.

Sync-ready tombstone metadata:

```ts
type TombstoneRecord = {
  objectId: string;
  objectType: string;
  deletedAt: string;
  deletedBy: ActorRef;
  operationId: string;
  previousPath?: string;
  previousSha256?: string;
  reason?: string;
};
```

Rules:

- v0.1 can store tombstone records in `.pige/operations/` or `.pige/trash/manifest.json`.
- Tombstones are durable enough for backup/restore.
- Tombstones must not contain full source bodies.
- Tombstone retention can be revisited when real sync is implemented.

## 10. Schema Versioning

Version domains are separate:

| Domain | Example | Migration behavior |
| --- | --- | --- |
| App version | `0.1.0` | App update and release notes. |
| Vault schema version | `.pige/manifest.json` | Durable vault compatibility. |
| Markdown schema version | page frontmatter `schema_version` | Page/frontmatter migration. |
| Source record schema version | `.pige/source-records/*.json` | Source metadata and root-locator migration. |
| Conversation event schema version | `.pige/conversations/*.jsonl` event | Conversation migration. |
| Job schema version | `.pige/jobs/*.json` | Workflow/checkpoint migration. |
| Proposal schema version | `.pige/proposals/*.json` | Proposal migration. |
| Operation schema version | `.pige/operations/*.json` | Audit/lifecycle migration. |
| Memory schema version | `.pige/memory/` | Memory migration. |
| Skill schema version | `.pige/skills/` | Skill metadata migration. |
| Backup format/domain versions | `pige-backup-manifest.json` | Preview-time compatibility and restore migration plan. |
| SQLite schema version | `.pige/db/` | Rebuildable DB migration or reset. |
| Index schema version | `.pige/indexes/` | Rebuild. |
| Tool/model manifest version | app data | Repair or redownload. |

Rules:

- A new app version must check vault compatibility before write access.
- Newer unsupported vault schema should open read-only or block with a clear explanation.
- Older supported vault schema may migrate after preview and backup policy.
- Rebuildable schemas can reset and rebuild.
- Durable file schemas require migration records.

## 11. Migration Classes

Migration classes:

| Class | Examples | Required protection |
| --- | --- | --- |
| Rebuildable cache migration | SQLite, FTS, vector index | Rebuild/reset allowed. |
| Additive durable migration | Add optional frontmatter field | Preserve unknown fields; operation summary. |
| Transform durable migration | Rename field, normalize structure | Preview, backup or restore point, operation record. |
| Risky durable migration | Rewrite Markdown bodies, move many files | Explicit confirmation and backup. |
| External reference/root migration | Source path strategy, managed-copy root ID/path basis | Preflight every source checksum/binding, preserve old locator until commit, and provide repair plan. |

Migration rules:

- Preserve unknown JSON/YAML fields.
- Preserve comments and readable Markdown body where possible.
- Do not reserialize user-edited Markdown unnecessarily.
- Record old and new schema versions.
- Record affected object IDs and paths.
- Leave original files intact if migration fails.
- Write migration logs to `.pige/operations/`.

## 12. Migration Plan Contract

Risky migrations require a plan before apply.

```ts
type MigrationPlan = {
  id: string;
  fromSchema: string;
  toSchema: string;
  createdAt: string;
  appVersion: string;
  affectedObjects: Array<{
    objectId: string;
    objectType: string;
    path?: string;
    action: "rebuild" | "add_field" | "rewrite" | "move" | "archive" | "manual";
    risk: "low" | "medium" | "high";
  }>;
  requiresBackup: boolean;
  requiresConfirmation: boolean;
  estimatedDuration?: string;
  warnings: string[];
};
```

Apply rules:

- Validate plan against current files before apply.
- Stop if base hashes changed.
- Write operation records as each checkpoint completes.
- On partial failure, show recovery state and do not hide affected files.

## 13. Backup And Restore Compatibility

`BackupManifestSchema` in `packages/schemas/src/index.ts` is the executable manifest authority. New writers record:

- Backup ID.
- App version.
- Vault schema version.
- Minimum/maximum schema version present for Markdown pages, source records, conversation events, jobs, proposals, operations, memory, and Skills.
- Backup format version.
- Created timestamp.
- Included/excluded data classes.
- Structured external dependencies: external managed-copy root or referenced original, stable root/source ID where applicable, inclusion result, and whether complete restore requires it. Raw absolute bindings are excluded.
- File path, size, and SHA-256 for every included entry.

Compatibility rules:

- Format-v1 manifests created by the current foundation may omit `backupId` and `domainSchemaVersions` and may use legacy string external dependencies. They remain parseable as legacy input.
- Preview derives missing domain ranges only by bounded inspection of included durable files. If a domain cannot be identified safely, preview blocks apply or requires a supported migration; it never assumes version 1 merely because the archive format is 1.
- Every durable domain has its own supported read and migration range. A newer unsupported domain blocks write/apply even when the vault schema itself is supported.
- Unknown additive manifest fields are preserved/ignored safely according to format compatibility; unknown archive entries not listed in the manifest remain an error.

Restore rules:

- Restore preview checks schema compatibility before apply.
- Restore uses an explicit identity mode; destination path alone has no identity meaning.
- `replace_existing` preserves `vault_id` and durable IDs, requires the old vault to be closed, creates a rollback point/confirmation, and swaps its machine binding only after staged validation.
- `clone_as_new` mints a new `vault_id`, preserves object IDs within the new vault namespace, records `origin_vault_id`/`restored_from_backup_id`, and never inherits permission grants, YOLO state, provider secrets, or raw external bindings.
- Two registered vault paths must not share one `vault_id`.
- Derived DB/indexes rebuild after restore.
- If the current app cannot read the backup schema, show a clear unsupported message.
- Restore apply is a durable `restore` job with staging/checkpoints and a `restore_applied` operation; backup creation is a durable `backup` job ending in `backup_created`. The checkpoint contract is owned by `docs/JOB_OPERATION_AND_RECOVERY.md`.

## 14. Sync Adapter Boundary

Future sync adapters may include:

- Pige Cloud sync.
- Self-hosted sync.
- Personal desktop backend sync.
- Git remote.
- Local network device sync.
- Cloud drive folder coordination.

v0.1 must not depend on any specific sync adapter.

Required boundary:

- Sync adapters operate on durable object IDs, operation records, source records, manifests, and file hashes.
- Sync adapters do not treat SQLite as authoritative.
- Sync adapters must not require changing Markdown page identity.
- Sync adapters must preserve user-editable Markdown.
- Sync adapters must route conflicts into the same proposal model.

## 15. Git-Friendliness

Pige should remain Git-friendly without making Git a v0.1 feature.

Rules:

- Keep Markdown files readable and stable.
- Avoid rewriting entire files for metadata-only changes when possible.
- Keep generated managed blocks bounded and predictable.
- Prefer one durable object per file where practical.
- Do not add automatic internal Git commits in v0.1.
- Future Git integration should use operation records and stable IDs, not filenames alone.

## 16. Tests And Fixtures

Required tests:

- Stable ID remains after rename.
- Same title with different IDs does not merge silently.
- Base hash conflict creates proposal.
- External edit while proposal pending creates conflict proposal.
- Delete/archive creates tombstone or operation record.
- Newer unsupported vault schema opens read-only or blocks safely.
- Additive migration preserves unknown fields.
- Risky migration requires backup or confirmation.
- Failed migration leaves original files intact.
- Backup/restore preserves durable object IDs and schema versions; vault ID follows the explicit replace/clone mode.
- Legacy format-v1 backup without domain ranges is scanned conservatively and never receives an invented compatibility pass.
- Backup domain range outside the app's supported reader/migration range blocks restore apply.
- `replace_existing` preserves one vault ID/path binding; `clone_as_new` mints a vault ID and records lineage.
- External managed-copy root switch does not retarget existing source-record `rootId` values.
- Missing external root moves dependent jobs to `waiting_dependency` and never falls back to another absolute path.
- Database/index reset does not change durable IDs.
- Future remote/mobile job records can reference objects without desktop-only paths.

Fixture vaults:

- Older schema vault.
- Newer unsupported schema vault.
- Vault with moved pages.
- Vault with duplicate titles.
- Vault with pending conflict proposal.
- Vault restored on a different machine path.
- Vault with externally referenced originals missing or changed.

## 17. Implementation Checklist

Before changing durable data shape, answer:

- Which version domain changes?
- Is the data durable truth, source evidence, durable artifact, machine-local state, secret, cache, or temp state?
- Does the object have a stable ID?
- Is identity independent from path/title/slug/language?
- What is the base hash?
- What operation record proves the change?
- What happens if a user edited the file externally?
- Is a tombstone needed for delete/archive?
- Does backup/restore preserve this object?
- Can SQLite/index state be rebuilt?
- Is the migration additive, transform, or risky?
- Does the change preserve unknown fields?
- Does it keep future sync and mobile/remote Agent contracts possible?
