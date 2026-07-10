# Privacy And Data Use Policy

Pige is designed as a local-first Personal Knowledge Agent. This file describes the v0.1 privacy baseline during active public-alpha development. It is a product and engineering contract for how Pige should handle user data.

## Core Promise

- Your Markdown knowledge base is stored locally in a folder you control.
- Original files remain yours. Pige can reference them in place or store managed local copies according to your source storage settings.
- Pige does not require a Pige cloud account in v0.1.
- Pige does not run product analytics, background telemetry, automatic crash upload, or automatic diagnostic upload in v0.1.
- SQLite databases, indexes, embeddings, thumbnails, and caches are rebuildable working layers, not the durable knowledge source of truth.

## Data Stored Locally

Pige may store these on your machine:

- Markdown knowledge files, source pages, and source records in the vault.
- Managed source copies or source references, depending on your storage strategy.
- Reference-based conversation history that avoids duplicating large source bodies or saved note bodies.
- Vault-scoped Agent memory when enabled.
- Jobs, proposals, operation records, and recovery summaries.
- Rebuildable local databases, search indexes, graph indexes, chunks, embeddings, thumbnails, and caches.
- Machine-local settings, recent vaults, permission grants, local tool status, provider metadata, and diagnostics.
- Downloaded local model files or OCR model files after explicit user action.

## Secrets

- API keys and provider tokens are secrets.
- Secrets must not be written to Markdown, SQLite, logs, prompts, operation records, conversation logs, diagnostics, or backups by default.
- v0.1 stores secrets in OS keychain or encrypted local storage by default.
- Plaintext portable/developer mode is allowed only as an explicit advanced choice with a warning.
- Default backups exclude secrets.

## Data That May Leave The Device

Pige is local-first, not network-free. These actions may contact external services:

- BYOK model calls: after you configure a model provider, ordinary content may be sent to that provider for Agent processing. Pige should send selected context, snippets, citations, and compact references rather than the whole vault by default.
- URL capture: when you paste a web link, Pige fetches that URL and stores the result locally as a source.
- Optional model/tool downloads: local embedding models, OCR models, package assets, or repair assets may be downloaded only through explicit flows.
- Update checks and downloads: public alpha builds may check GitHub Releases or configured update metadata.
- Explicit Skill/package actions: installed Skills or packages may use network access only through declared capabilities and Permission Broker decisions.

Pige should show or explain the local, network, self-hosted, or cloud boundary for user-visible capabilities that depend on model providers, external tools, OS APIs, package downloads, or network access.

## Diagnostics And Support Bundles

- Diagnostics are local by default.
- Support bundle export is user-initiated, previewed, redacted by default, cancelable, and written only to a user-selected local path.
- Default diagnostics and support bundles exclude API keys, source bodies, full notes, full memory, full conversations, raw prompts, and raw model responses.
- Content excerpts, prompt/response snippets, or paths require explicit user review before export.
- No diagnostics are uploaded automatically in v0.1.

## Skills, Packages, And Permissions

- Skills and packages are untrusted until installed, and remain permission-scoped after install.
- Sensitive actions such as shell, network, write, delete, model, secret, settings, package, or external filesystem access require Permission Broker mediation unless covered by an explicit user-selected default mode.
- YOLO Full Access is off by default, must be explicit, visible, revocable, and logged, and does not disable OS-level permissions or security checks.
- Source content, model output, Skills, packages, and tools cannot grant themselves permissions or change privacy settings.

## Backups And Restore

- Backups include durable vault data needed to preserve the user's knowledge and recover work.
- Backups exclude secrets, model files, bundled tools, databases, indexes, thumbnails, and caches by default.
- Backups avoid duplicating large source asset bodies, saved page bodies, or long conversation bodies unless the backup policy explicitly includes them.
- Restore should preserve Markdown knowledge and rebuild derived state locally.

## Future Cloud, Mobile, And Sync

v0.1 does not include Pige Cloud, mobile apps, cloud sync, remote telemetry, or a hosted Agent backend.

Future cloud, mobile, sync, or remote Agent features require updated privacy terms, settings, runtime capability boundaries, and user-visible controls before they are enabled.

## Related Documents

- [Support Policy](SUPPORT.md)
- [Security Policy](SECURITY.md)
- [Security Threat Model](docs/SECURITY_THREAT_MODEL.md)
- [Data Architecture](docs/DATA_ARCHITECTURE.md)
- [Diagnostics and Observability](docs/DIAGNOSTICS_AND_OBSERVABILITY.md)
- [Settings and Preferences](docs/SETTINGS_AND_PREFERENCES.md)
- [Context Assembly and Retrieval Policy](docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md)
- [Release Engineering](docs/RELEASE_ENGINEERING.md)
