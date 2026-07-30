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
- Local model/OCR files and Apple-managed speech resources after explicit user action;
  Pige stores no speech asset bytes, URL, path or installation record.

## Secrets

- API keys and tokens are secrets. Pige stores them in its machine-local app-data
  credential file and presents them only to the configured provider for authentication.
  It does not use the OS keychain, so startup never asks for a keychain password.
- Never inject Pige-owned stored credentials into user content, prompts, Markdown,
  SQLite, logs, operations, conversations, diagnostics, or default backups. This is
  credential isolation and storage hygiene, not rewriting the user's submitted text.
- The app-data credential file is restricted to the local OS user where the platform
  supports file modes; it is not portable and is never included in default backups.
- Default backups exclude secrets.

## Data That May Leave The Device

Pige is local-first, not network-free: local durable knowledge is trusted truth, not a
reason to reapprove normal Agent work or connected model calls.

- BYOK: one disclosure grants routine bounded calls to the exact Profile/endpoint with
  selected context and quiet status. Pressing Send transmits the exact user-authored and
  explicitly selected bounded context without content classification or another prompt;
  Provider identity drift requires a new explicit action.
- URL capture fetches a pasted link and stores the result locally as a source.
- Model/tool/Apple speech assets download only through explicit flows. Apple speech
  install may contact Apple; Pige receives only bounded progress/completion, never assets.
- Public alpha may check GitHub Releases or configured update metadata.
- Brokered Skill/package `external_network` grants may reach public or private targets;
  private classes otherwise block, and transport/redaction/content boundaries remain.

Providers process received data under their own terms. Pige does not proxy calls through
a Pige cloud service; other network features still disclose their boundary.

## Diagnostics And Support Bundles

- Diagnostics are local by default.
- Support bundle export is user-initiated, previewed, redacted by default, cancelable, and written only to a user-selected local path.
- Default diagnostics and support bundles exclude API keys, source bodies, full notes, full memory, full conversations, raw prompts, and raw model responses.
- Content excerpts, prompt/response snippets, or paths require explicit user review before export.
- No diagnostics are uploaded automatically in v0.1.

## Skills, Packages, And Authority

- One explicit user submit authorizes registered first-party reads, preservation,
  parsing, OCR, retrieval, user-specified fetch, and bounded local tools for that turn.
- Connecting/selecting a cloud Provider and pressing Send authorizes that turn's exact user-authored and explicitly selected bounded context. Pige does not classify, redact, or rewrite user-authored content for
  send authorization and never sends the whole vault by default. Stored Provider
  credentials remain confined to the secret store and authentication header.
- Skills and packages are untrusted until reviewed and cannot acquire first-party turn
  authority through prompt text, naming, source content, or model output.
- Pige avoids prompts for ordinary bounded work. Ask Every Time, scoped grants, or YOLO
  may authorize sensitive work; YOLO suppresses eligible Shell/write/network/install prompts.
- Every effect remains validated and logged. Raw secrets, permanent loss, original overwrite,
  risky edits, protected authority, OS/SSRF/signature/path safety remain confirmed or blocked.
  One-shot pending requests, decisions, grants, and mode are machine-local policy evidence
  excluded from Vault backup and sync.

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
