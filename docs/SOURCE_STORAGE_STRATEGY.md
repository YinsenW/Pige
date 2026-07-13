# Source Storage Strategy

Status: Draft baseline
Date: 2026-07-09

## 1. Purpose

This document defines how Pige handles original user files and other source assets.

Pige's knowledge source of truth is Markdown. Original files are evidence and input material. The user owns them, and Pige must not force them into one storage location.

## 2. Core Distinction

Pige has two separate storage concerns:

1. Knowledge storage.
   Agent-maintained Markdown pages, source pages, indexes, logs, memory, operation records, and portable vault metadata.

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

An absolute external path is a machine binding, not durable source identity. Machine-local `vault-bindings.json` assigns every external managed-copy root a stable `root_` ID:

```ts
type ExternalRootBinding = {
  rootId: string;
  vaultId: string;
  purpose: "managed_copy";
  absolutePath: string;
  availability: "available" | "missing" | "permission_needed";
  createdAt: string;
  updatedAt: string;
};

type DefaultManagedCopyRootSelection = {
  vaultId: string;
  rootId: string;
};
```

`VaultBindingsFileSchema`, `ExternalManagedCopyRootBindingSchema`, and `DefaultManagedCopyRootSelectionSchema` in `packages/schemas/src/index.ts` are the executable registry contract. Root IDs are unique within the registry. Its `defaults` list selects at most one external managed-copy root per vault, and that `rootId` must belong to the same vault. No selection means no usable external default; callers must not silently choose the newest binding.

New source records locate managed copies with `managedCopy.rootId`, `managedCopy.pathBasis`, and `managedCopy.path`:

- `root_vault_managed` plus `vault_relative` resolves a validated path such as `raw/files/...` under the current vault.
- An external `root_...` binding plus `root_relative` resolves a validated relative path under the bound absolute root.
- The executable Source Record schema rejects the inverse pairings: an external root cannot claim `vault_relative`, and `root_vault_managed` cannot claim `root_relative`.
- Switching the default external root creates/selects another root ID. It never retargets existing source records implicitly.
- A missing binding moves dependent jobs to `waiting_dependency` with `external_source`/`reconnect_path`; it does not guess from a display path.

Compatibility rule: existing schema-v1 records without `rootId` contain vault-relative managed-copy paths. They continue to resolve under `knowledgeRoot` and must not be reinterpreted against a newly selected external root. A later additive migration may attach `root_vault_managed` after verifying the checksum.

## 4. Storage Strategies

```ts
type SourceStorageStrategy =
  | "copy_to_source_library"
  | "reference_original";
```

The user-selectable default applies when a capture has a durable original file path. Typed/pasted text and fetched URL snapshots have no independently owned local original to reference, so Capture Service necessarily records those inputs as `copy_to_source_library`. This is an input-kind rule, not an ignored preference.

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

Rules:

- `packages/schemas/src/index.ts` is the executable field/enum authority. New IDs use `src_`, `page_`, and `art_`; `artifact_` is not emitted.
- The sidecar under `.pige/source-records/` is the sole operational source-record authority.
- A Markdown source page is user-editable knowledge and a bounded projection of the sidecar. It does not own original paths, managed-copy resolution, checksums, or artifact locators.
- Source records must be enough to locate, verify, repair, or explain a source.
- `reference_original` records are mutually exclusive with `managedCopy`: they require verified `original` metadata and must not contain a managed-copy locator. `copy_to_source_library` records require `managedCopy`; they may retain `original` metadata only as provenance. Source readers branch on `storageStrategy` before resolving a locator and never prefer a field from the other strategy.
- Missing referenced originals should not break Markdown knowledge.
- If an original referenced file changes, Pige records the change and may re-ingest through a normal job.
- A source mutation writes the sidecar atomically first, then refreshes the Markdown projection using a recorded before/target hash. A crash between the writes is recovered from the sidecar and job checkpoint.
- A caller that derives output from a Source Record must bind the sidecar revision used for the operation before projection. Current document-parser and direct-image OCR persistence pass the complete pre-Artifact record as `SourcePageService`'s expected baseline. PDF/PPTX OCR instead compares and replaces its merged Source Record against the reread whole-file checksum, then refreshes from that just-committed revision. Detected drift fails with the owning Source Record conflict code instead of projecting mixed revisions.
- Source-page commits use a same-directory exclusive temporary file, flush bytes, recheck the expected Source Record or Markdown revision before rename, and retain a pending checksum for recovery. Generated notes likewise flush an exclusive temporary file, recheck the Source Record, and publish create-only; concurrent targets are preserved or same-source recovered. These are pathname-bound drift fences, not strict cross-process CAS: check-to-commit parent swaps and Source Record/Source Page/Artifact/note cross-file transactions remain open.
- `SourcePageService` accepts a Source Record path only below the active vault's `.pige/source-records/` root and writes only its normalized vault-relative form into Markdown. Text previews are limited to the first 16 KiB of a current-vault regular file, use no-follow opens where supported, and recheck path/descriptor identity; an escaping or symlinked target is rejected without exposing its body.
- If sidecar and Markdown disagree, operational services use the sidecar, preserve user-authored Markdown, mark the projection stale/conflicted, and create a repair operation/proposal. They never copy a Markdown path back into the sidecar silently.
- Deleting the sidecar is data loss, not an index reset. Markdown can help identify the source ID, but cannot reconstruct missing root bindings, checksums, original locators, or artifact provenance without an explicit repair flow.

Current format support and executable evidence live in the Playbook and acceptance
manifest. Existing Phase 2 sidecars may omit `schemaVersion`, `rootId`, and `pathBasis`;
shared-schema reads supply schema v1 and keep their vault-relative paths valid under
section 3.1. This compatibility rule never changes the selected storage strategy or
weakens descriptor, checksum, containment, adapter-input, or durable-write validation.

## 6. Markdown Knowledge Contract

Every source that contributes knowledge should create or update Markdown.

At minimum:

- A source page under `sources/`.
- Source references in generated wiki pages.
- Citations or provenance blocks that point back to the source record and locator.

The Markdown source page should survive even if the original file becomes unavailable. It should state whether the original is copied, referenced, linked, missing, or changed.

## 7. Backup Behavior

The complete backup include/exclude matrix and visible options are owned by
`docs/DATA_ARCHITECTURE.md#11-backup-policy`. This section adds only the source-root
consequences below.

External managed-copy rule:

- An external managed-copy root contains Pige-owned evidence, not merely a reference to user-owned originals. Backup preflight therefore attempts to include every reachable managed copy selected by the source records.
- If a required external root is missing or permission-blocked, backup must not claim to be complete. It pauses for repair or asks the user to continue with an explicitly incomplete backup; the manifest records the `rootId`, dependency kind, inclusion result, and whether complete restore requires it.
- Backup manifests do not store the machine's raw absolute binding by default. They store stable root/source IDs and a redacted display label.
- Externally referenced originals remain excluded by default and are listed separately from external managed-copy roots.

Restore behavior:

- Restored Markdown knowledge works without external originals.
- Managed source copies restore into the selected managed-copy root.
- Restored external managed copies may be placed under the restored vault's `raw/` root or rebound to a user-selected external root; source records are rewritten only through a checkpointed restore/migration operation.
- Referenced originals are marked available, missing, or changed after restore scan.
- The user can relink missing originals later.

## 8. Settings Requirements

Settings > Knowledge Base > Vault & Note Storage should expose only necessary controls in v0.1. In Chinese UI, label it plainly as "仓库与笔记存储". The page should feel like an Obsidian-style vault location page, not an implementation dashboard:

- Current vault name and active vault path.
- Note/knowledge root path.
- Managed source-copy location (the v1 UI/DTO may label this “Source asset root”).
- Default source storage strategy.
- Managed source copy inclusion in backups.
- Reveal knowledge root.
- Reveal managed-copy root.
- Open/create vault.
- Backup and restore entry points.

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
- Access to files outside the knowledge root/managed-copy root goes through Permission Broker unless it is the user-selected source for the current capture.
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
