# Source Storage Strategy

Status: Draft baseline
Date: 2026-07-09

## 1. Purpose

This document defines how Pige handles original user files and other source assets.

Markdown is narrative truth and Dataset Bundles are structured truth. Original files are
evidence and input material; Pige must not force or silently rewrite them.

## 2. Core Distinction

Pige has two separate storage concerns:

1. Knowledge storage.
   Agent-maintained Markdown, Dataset Bundles, source pages, logs, memory, operation
   records, and portable vault metadata.

2. Source asset storage.
   Original files, downloaded snapshots, copied documents, screenshots, images, archives, and other evidence used to create or update Markdown knowledge.

These locations must be independently configurable.

Default v0.1 can place both under the same Pige vault folder for simplicity, but the architecture must not assume they are always the same root.

## 3. Storage Roots

The canonical model has three roots, not one overloaded source-asset directory:

- `knowledgeRoot`: the vault and all portable durable metadata/Markdown.
- `managedCopyRoot`: Pige-owned source copies. Default: `<knowledgeRoot>/raw`; it may be an external machine-vault binding.
- `artifactRoot`: durable derived artifacts. v0.1: `<knowledgeRoot>/artifacts`; it remains portable and does not follow an external managed-copy root.

`sourceAssetRoot` is a compatibility/UI name in the v1 config and IPC DTO. In v1 it means `managedCopyRoot`; it must never be interpreted as the parent of both `raw/` and `artifacts/`.

`docs/DATA_ARCHITECTURE.md#4-vault-layout` owns the complete folder tree. This document
adds only source-root semantics: managed text/web/file copies resolve below
`managedCopyRoot`; extracted text, web extraction, rendered-page, and OCR derivatives
resolve below the portable `artifactRoot`; all other durable/rebuildable vault paths
follow the Data owner’s layout.

Services refer to `knowledgeRoot`, `managedCopyRoot`, and `artifactRoot`. Existing `sourceAssetRoot` DTO/config fields are read as a compatibility alias for `managedCopyRoot` until a versioned config migration renames them.

### 3.1 Root Identity And Resolution

An absolute external path is a machine binding, not durable identity.
`VaultBindingsFileSchema`, `ExternalManagedCopyRootBindingSchema`, and
`DefaultManagedCopyRootSelectionSchema` own its machine-local root/vault/purpose/path/
availability/time fields and optional per-vault default. Root IDs are unique within the registry;
the default must reference that vault. No selection means no usable external default.

New records use `managedCopy.rootId/pathBasis/path`: `root_vault_managed` pairs only
with `vault_relative`, while external roots pair only with `root_relative`; an external root cannot claim `vault_relative`.
Changing a default never retargets records. A missing
binding waits with `external_source`/`reconnect_path`, never a guessed display path.

### 3.2 Exact External-Root Reconnect

Main's chooser passes its private result to `BackupRestoreService`, sole validator and
atomic `vault-bindings.json` writer; renderer never supplies a path. `vault_binding`
means `dependencyId=rootId` and derives current records for that vault/root;
`external_source` means `dependencyId=sourceId` and rereads that record to derive current
root, revision, `root_relative` locator, checksum and size. IDs are not interchangeable.
The service accepts only a canonical real non-symlink directory, revalidates ancestry,
confinement and no-follow file identity, then atomically persists and rereads the same
machine-local `vaultId`/`rootId` binding and evidence. Empty/wrong/changed selections do
nothing. No private field crosses preload or enters durable/exported projections;
referenced-original repair is excluded.

Compatibility rule: existing schema-v1 records without `rootId` contain vault-relative managed-copy paths. They continue to resolve under `knowledgeRoot` and must not be reinterpreted against a newly selected external root. A later additive migration may attach `root_vault_managed` after verifying the checksum.

## 4. Storage Strategies

```ts
type SourceStorageStrategy =
  | "copy_to_source_library"
  | "reference_original";
```

The user-selectable default applies when a capture has a durable original file path. Typed/pasted text and fetched URL snapshots have no independently owned local original to reference, so Capture Service necessarily records those inputs as `copy_to_source_library`. This is an input-kind rule, not an ignored preference.

A submitted `large_paste` preserves the accepted clipboard payload as exact UTF-8 bytes,
without trim or normalization, under `copy_to_source_library`. The per-item and per-turn
preservation bounds come only from `resources/large-paste-boundary.manifest.json`; they do
not authorize duplicating the body into conversation, Job, index or Provider records.

### 4.1 Copy To Source Library

Pige copies the source into the configured managed-copy root.

Recommended default for:

- Pasted text.
- Web captures.
- Screenshots created inside Pige.
- Files dropped into Pige when the original location is temporary or unclear.
- Small-to-medium documents where backup completeness matters.

Benefits:

- Backup and restore are self-contained.
- Parser and OCR jobs can rely on stable paths.
- Future sync can transfer source assets explicitly.

Tradeoffs:

- Uses more disk space.
- Large files can make backups heavy.

### 4.2 Reference Original

Pige records the original file path, metadata, checksum when possible, and access state without copying the file.

Recommended for:

- Large video/audio files.
- Existing organized folders the user wants to keep in place.
- Cloud-drive folders managed outside Pige.
- Git repositories and large project directories.

Benefits:

- Preserves the user's filesystem organization.
- Avoids duplicate large files.

Tradeoffs:

- Backup may not include the original file.
- The file may move, be renamed, become unavailable, or change outside Pige.
- Pige needs clear missing-file and changed-file behavior.

### 4.3 Link To Original

Pige may later create a filesystem link, alias, or symlink from a managed location to the original file when platform support and permissions are acceptable.

v0.1 stance:

- `link_to_original` is not a valid `SourceStorageStrategySchema` value in v0.1.
- Treat as advanced/optional.
- Do not rely on symlinks for core correctness.
- Do not use links silently.
- Validate behavior on macOS and Windows before exposing broadly.

Benefits:

- Can provide a stable Pige-visible path without copying data.

Tradeoffs:

- Cross-platform behavior differs.
- Backup tools may follow links unexpectedly or omit linked content.
- Security and path traversal behavior needs careful testing.

## 5. Source Record Contract

Every captured source receives a stable source ID and a source record.

```ts
type SourceRecord = {
  schemaVersion: 1;
  id: string;
  kind:
    | "text"
    | "url"
    | "markdown_file"
    | "plain_text_file"
    | "pdf_file"
    | "docx_file"
    | "pptx_file"
    | "image_file"
    | "audio_file"
    | "video_file"
    | "folder"
    | "git_repository"
    | "archive"
    | "unknown_file";
  storageStrategy: SourceStorageStrategy;
  knowledgePageId?: string;
  knowledgePagePath?: string;
  original?: {
    uri: string;
    path?: string;
    displayName?: string;
    lastKnownMtime?: string;
    lastKnownSize?: number;
    checksum?: string;
  };
  managedCopy?: {
    rootId?: string;
    pathBasis?: "vault_relative" | "root_relative";
    path: string;
    checksum: string;
    size: number;
  };
  artifacts: Array<{
    id: string;
    kind: "extracted_text" | "ocr" | "rendered_page" | "thumbnail" | "metadata";
    path: string;
    checksum?: string;
    size?: number;
  }>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
```

Planned structured import adds `csv_file`, `xlsx_file`, and `sqlite_file` only through a
versioned shared-schema change; this document does not make those values executable.

Rules:

- `packages/schemas/src/index.ts` is the executable field/enum authority. New IDs use `src_`, `page_`, and `art_`; `artifact_` is not emitted.
- The sidecar under `.pige/source-records/` is the sole operational source-record authority.
- A Markdown source page is user-editable bounded sidecar projection, not owner of paths, copy resolution, checksums, or artifact locators. After accepted Agent-turn preservation, `SourcePageService` ensures one current page per accepted record before inspect citation; rejected items get none, and parent retry/restart adopts rather than duplicates it.
- Source records must be enough to locate, verify, repair, or explain a source.
- Agent/model/tools use Pige-owned handles, never raw paths. `reference_original` records are mutually exclusive with `managedCopy`; original identity stays private. `copy_to_source_library` requires `managedCopy`; readers branch on strategy. Always-staging is future defense-in-depth; if adopted, Job/recovery owns crash-safe cleanup, never immediate deletion.
- Missing referenced originals should not break Markdown knowledge.
- If an original referenced file changes, Pige records the change and may re-ingest through a normal job.
- A source mutation writes the sidecar atomically first, then refreshes the Markdown projection using a recorded before/target hash. A crash between the writes is recovered from the sidecar and job checkpoint.
- Derived output binds its sidecar revision. Parsing/direct-image OCR pass the pre-Artifact record as `SourcePageService`'s baseline; PDF/PPTX OCR replaces against the reread checksum, then refreshes that revision. Drift fails rather than mixing revisions.
- Source pages use exclusive local temp files, flush/recheck revision before rename, and retain a recovery checksum. Generated notes likewise publish create-only; preserve concurrent targets or recover the same source. These pathname fences are not cross-process CAS; parent swaps/cross-file transactions remain open.
- `SourcePageService` accepts a Source Record path only below the active vault's `.pige/source-records/` root and writes only its normalized vault-relative form into Markdown. Text previews are limited to the first 16 KiB of a current-vault regular file, use no-follow opens where supported, and recheck path/descriptor identity; an escaping or symlinked target is rejected without exposing its body.
- If sidecar and Markdown disagree, operational services use the sidecar, preserve user-authored Markdown, mark the projection stale/conflicted, and create a repair operation/proposal. They never copy a Markdown path back into the sidecar silently.
- Deleting the sidecar is data loss, not an index reset. Markdown can help identify the source ID, but cannot reconstruct missing root bindings, checksums, original locators, or artifact provenance without an explicit repair flow.

Current format support and executable evidence live in the Playbook and acceptance
manifest. Existing Phase 2 sidecars may omit `schemaVersion`, `rootId`, and `pathBasis`;
shared-schema reads supply schema v1 and keep their vault-relative paths valid under
section 3.1. This compatibility rule never changes the selected storage strategy or
weakens descriptor, checksum, containment, adapter-input, or durable-write validation.

## 6. Knowledge Projection Contract

Narrative sources create or update Markdown. Structured sources create a Dataset Bundle
when typed rows/columns are the useful knowledge; a bounded Markdown source page or
summary may describe the Dataset but must not duplicate every row.

At minimum:

- A source record and inspectable source page under `sources/`.
- Either referenced Markdown knowledge or a Dataset manifest/revision with source binding.
- Citations that point to the source locator or exact Dataset evidence reference.

The Markdown source page should survive even if the original file becomes unavailable. It should state whether the original is copied, referenced, linked, missing, or changed.

## 7. Backup Behavior

The complete backup include/exclude matrix and visible options are owned by
`docs/DATA_ARCHITECTURE.md#11-backup-policy`. This section adds only the source-root
consequences below.

External managed-copy roots hold Pige-owned evidence. Backup includes every reachable
record-selected copy only after stable ID, checksum/size, archive mapping, binding,
ancestry/file identity and streamed checksum fences; missing/rebound roots keep the same
Job in `waiting_dependency`/`reconnect_path`. An explicitly incomplete backup remains
unimplemented. Safe projections omit bindings; referenced originals stay excluded.

Restore keeps Markdown usable without originals, restores in-vault and included external
copies as validated binding-free `root_vault_managed` records under `raw/`, and reports
referenced originals available/missing/changed. Reconnect/migration preserves IDs and
never infers authority from labels or paths.

## 8. Settings Requirements

Settings > Knowledge Base > Vault & Note Storage (“仓库与笔记存储”) is a location page,
not an implementation dashboard. It exposes vault identity/path, knowledge and managed-copy
locations (v1 may say “Source asset root”), default strategy, backup inclusion, safe reveal,
open/create, and Backup/Restore entry points only.

Avoid showing low-level path internals, symlink mechanics, checksum details, database paths, cache folders, or parser artifact folders by default.

Storage ownership rules:

- Active vault path and recent vaults are machine-local preferences.
- Vault identity, schema version, and portable non-secret vault settings live inside the vault.
- An in-vault managed-copy root can be stored as a relative portable setting.
- An external managed-copy root is a machine-local `root_` binding keyed by `vault_id`; source records keep the root ID, and backup/restore manifests disclose it as an external dependency.

## 9. Safety Rules

- Never delete or move an original referenced file unless the user explicitly requests it outside normal ingest.
- Do not follow symlinks during archive extraction or backup without explicit policy.
- Do not treat paths from source content as trusted.
- Do not let renderer code access arbitrary original paths.
- Reading a user-selected source is covered by the submitted turn. Writing outside an
  explicitly selected directory uses the closed high-risk confirmation boundary.
- Destructive cleanup of managed copies requires confirmation.

## 10. Future Extensions

Future storage adapters may include:

- Cloud-drive references.
- Read-only removable drive references.
- Content-addressed local source library.
- Git-backed source snapshots.
- Remote Agent backend blob storage.
- Team/shared source libraries.

These must preserve the same Markdown knowledge contract and source record contract.
