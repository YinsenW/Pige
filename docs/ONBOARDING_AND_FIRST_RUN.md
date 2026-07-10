# Onboarding And First-Run Design

Status: Draft baseline
Date: 2026-07-09

## 1. Purpose

This document defines Pige's first-run flow, setup states, and capture-only behavior.

First run is a trust moment. It must prove three things quickly:

- Pige is local-first.
- The user knows where notes live.
- The user can start capturing without understanding Pige internals.

This document prevents three implementation mistakes:

- Turning first run into a marketing landing page.
- Blocking all usage until a model provider is configured.
- Allowing capture before a vault exists, which would break Pige's preservation guarantee.

## 2. Product Principle

First run should be short, useful, and reversible.

The ideal path:

```txt
Choose or create local vault -> optionally connect model -> Home
```

Rules:

- A local vault is required before entering Home.
- A model provider is optional before entering Home.
- Optional local model/OCR/RAG downloads are not part of first run.
- Permission mode configuration is not part of first run.
- The first screen is not a product tour.
- The final screen is the real Home composer, not a dashboard.

## 3. Required Setup States

After first run, Pige must be in exactly one of these states.

| State | Meaning | User can enter Home? |
| --- | --- | --- |
| `ready` | Vault exists and at least one default Pi Agent model is configured. | Yes |
| `capture_only` | Vault exists, but no usable generation model is configured. | Yes |
| `blocked_no_vault` | No valid local vault exists or is selected. | No |

Rules:

- `blocked_no_vault` must show create/open vault and restore actions.
- `capture_only` must be honest but not alarming.
- `ready` should not show setup noise after landing in Home.

## 4. Step 1: Vault Choice

The vault step is mandatory.

User choices:

- Create a new Pige vault at the suggested default location.
- Create a new Pige vault in another selected folder.
- Open an existing Pige-compatible vault.
- Restore a backup into a new folder through the restore flow.

Default paths:

- macOS: `~/Documents/Pige Vault`.
- Windows: `%USERPROFILE%\Documents\Pige Vault`.

Creation behavior:

- `vault.create` uses a trusted OS folder picker for the parent folder and a user-visible vault name.
- Pige creates `PIGE.md`, `index.md`, `log.md`, `.pige/manifest.json`, `.pige/config.json`, and default folders.
- If the suggested default folder already contains a compatible Pige vault, offer to open it.
- If the suggested default folder exists but is not a Pige vault, offer to choose a different folder or create a named subfolder.

Opening behavior:

- `vault.open` accepts a folder selected through a trusted OS folder picker.
- v0.1 opens Pige-compatible vaults only.
- Importing an existing Obsidian or generic Markdown folder is a separate post-v0.1/import workflow, not hidden inside first run.

Path validation:

- Reject nested Pige vaults.
- Reject app data folders, system folders, temp folders, and trash folders.
- Reject folders without required read/write permissions.
- Warn when the path appears to be a cloud-drive folder, but allow it if ordinary filesystem access is valid.
- Do not write the active absolute path into `.pige/manifest.json`.

## 5. Step 2: Optional Model Setup

The model step is optional.

Default path:

- Show a compact Add Provider form.
- Let the user connect OpenAI, Anthropic, OpenAI-compatible, or Anthropic-compatible service.
- Test credentials.
- Discover models when the provider supports model listing.
- Let the user manually add model IDs when listing is unsupported or fails.
- Select one default Pi Agent model.

Skip path:

- The user can choose `Skip for now`.
- Pige enters `capture_only`.
- Pige must clearly state that captures are saved locally and Agent organization will resume after a model is configured.

Rules:

- API keys go only to the secret store.
- Provider and model behavior follows `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`.
- No Advanced/Fast model routing appears in first run.
- No provider marketplace or capability table appears in first run.
- No cloud-send policy wizard appears in first run; use the default privacy policy and expose settings later.

## 6. Step 3: Home

After vault creation/opening and optional model setup, Pige lands directly in Home.

Home behavior:

- Compact vertical window.
- Bottom composer visible.
- Sidebar hidden by default.
- Whole-window drag hot zone enabled.
- If model is missing, show a quiet status affordance near recent activity or the composer, not a blocking modal.

No-model status copy:

```txt
Saved locally. Connect a model when you want Pige to organize and answer from it.
```

## 7. Capture-Only Mode

Capture-only mode exists so the user can start trusting Pige before finishing model setup.

Allowed in `capture_only`:

- Text capture.
- File capture.
- URL capture, subject to web-fetch security.
- Voice transcript capture when supported.
- Source record creation.
- Managed source copy or external reference creation.
- Parser extraction when bundled tools are available.
- OCR when a local engine is available.
- Source page creation when deterministic extraction is enough.
- Conversation event creation with references, not duplicated source bodies.
- Library browsing of created source pages.
- Backup and restore.
- Settings access.
- Model setup.

Queued or waiting in `capture_only`:

- Agent ingest that requires a generation model.
- Title/summarization/tagging/linking that requires a generation model.
- Home knowledge answers that require synthesis.
- Note Agent answers.
- Selection actions such as translate, polish, expand, summarize, or explain.

Available without model:

- Lexical search over saved Markdown and metadata.
- Opening notes and sources.
- Revealing the vault.
- Local database rebuild.
- Export/backup.

Rules:

- Capture-only mode must still preserve sources before any parsing or model-dependent work.
- Model-dependent jobs use `waiting_dependency` with `dependencyKind: "model_provider"`.
- Configuring a valid default model should resume waiting jobs after user-visible confirmation or a clear "process saved captures" action.
- Resuming jobs must not duplicate source records, managed source copies, conversation events, or source pages.

## 8. Waiting Dependency Jobs

Some jobs are neither failed nor waiting for permission. They are waiting for a missing dependency.

Examples:

- No default model provider exists.
- Provider credentials are invalid.
- Required local tool is damaged or missing.
- Optional OCR or embedding model has not been downloaded.
- An external source path or external source asset root is disconnected.

Canonical job status:

```txt
waiting_dependency
```

The durable `waitingDependency` record and its executable enums are owned by
[`JOB_OPERATION_AND_RECOVERY.md`](JOB_OPERATION_AND_RECOVERY.md#6-job-record-contract). First-run
only selects the appropriate dependency/action and presents the resulting repair path;
it does not define a second record type.

Rules:

- `waiting_dependency` is visible and retryable.
- It must not be presented as data loss.
- It must not be compacted while unresolved.
- A dependency repair/configuration action can move the job back to `queued`.
- If the user cancels the job, durable source records and source assets remain.

## 9. Returning Users

On launch, Pige checks:

1. Machine-local active vault binding.
2. Vault manifest compatibility.
3. Vault read/write availability.
4. Pending job recovery.
5. Provider/default model availability.

Rules:

- If the active vault opens cleanly, skip first run.
- If the active vault path is missing, show recent vaults and open/create/restore actions.
- If the vault schema is too new, show read-only/blocking compatibility UI according to `docs/SYNC_CONFLICT_AND_MIGRATION.md`.
- If model credentials fail, enter Home with a quiet model status and mark model-dependent jobs `waiting_dependency`.

## 10. Restore During First Run

Restore is allowed from first run, but it is a restore flow, not a normal vault picker.

Rules:

- Restore previews backup metadata before writing.
- Restore writes into a new folder by default.
- Restore creates a new machine-local active vault binding.
- Restore never imports secrets by default.
- Provider secrets must be re-entered or imported only through an explicit future settings import flow.
- External source roots are shown as dependencies and may need reconnecting.

## 11. Not In First Run

Do not include these in v0.1 first run:

- Product tour carousel.
- Provider marketplace.
- Advanced model routing.
- Permission mode chooser.
- YOLO prompt.
- Local RAG model download prompt.
- PaddleOCR model download prompt.
- Skill/package installation.
- Obsidian vault import.
- Sync setup.
- Git setup.
- Telemetry opt-in prompt.

These can appear later in Settings, inline status, or dedicated workflows.

## 12. UI Requirements

First-run UI should be calm and sparse.

Required screens:

- Vault choice.
- Optional model setup.
- Home landing.

Required controls:

- Create vault.
- Open existing Pige vault.
- Restore backup.
- Add provider.
- Test and save provider.
- Skip model for now.

Phase 1 implementation note:

- The first-run Restore Backup control may be present as a disabled entry point until `restore.preview` and `restore.apply` are implemented by the Backup Service.
- The disabled entry point must not imply that data is already protected by Pige backups.

Required copy:

- Local vault path is visible.
- Capture-only mode says captures are saved locally.
- Model setup says ordinary content may be sent to the configured provider after setup.

Accessibility:

- All controls keyboard reachable.
- OS folder picker entry points have clear labels.
- Skip action is visible but visually secondary.
- Error copy is localizable.

## 13. IPC/API Requirements

The API owner defines the canonical onboarding transport and DTOs:

- [Vault and onboarding](API_AND_IPC_DESIGN.md#61-vault) owns vault creation/opening, onboarding state, and `OnboardingStatus`.
- [Settings, Providers, and Tools](API_AND_IPC_DESIGN.md#68-settings-providers-tools) owns provider setup and default-model selection.
- [Backup and Restore](API_AND_IPC_DESIGN.md#610-backup-and-restore) owns restore preview and apply.

This document owns the first-run workflow that composes those domains. It does not define channel aliases or a second `OnboardingStatus` shape.

Rules:

- Renderer receives only redacted status DTOs.
- Renderer never receives arbitrary filesystem access.
- Folder choices go through trusted OS dialogs mediated by main/preload.
- Provider secrets are never echoed back.

## 14. Data Ownership

First-run data writes:

| Data | Owner | Location | Backup |
| --- | --- | --- | --- |
| Active vault path | Vault Runtime Service | OS app data | No |
| Recent vault list | Vault Runtime Service | OS app data | No |
| Vault identity | Vault Runtime Service | `.pige/manifest.json` | Yes |
| Vault preferences | Settings Service | `.pige/config.json` | Yes |
| Default `PIGE.md` | Vault Service | `PIGE.md` | Yes |
| Provider profile | Model Provider Registry | OS app data | No by default |
| Provider secret | Settings and Secrets Service | OS keychain/encrypted store | No |
| Default model profile | Model Provider Registry | OS app data | No by default |

Rules:

- First run must not write API keys into the vault.
- First run must not write active absolute paths into `.pige/manifest.json`.
- First run must not create hidden cloud accounts or telemetry records.

## 15. Tests

Required tests:

- Fresh install with no vault shows vault choice.
- Create default vault creates required files and folders.
- Open existing compatible vault sets machine-local active binding.
- Opening missing/incompatible folder shows a safe error.
- Active vault path is not written into `.pige/manifest.json`.
- Model setup stores API key only in the secret store.
- Model setup with list-model support creates model profiles.
- Model setup without list-model support allows manual model ID.
- Skip model enters `capture_only`.
- Capture-only text/file capture creates source record and durable conversation reference.
- Model-dependent jobs become `waiting_dependency`, not silent failures.
- Configuring a model resumes waiting jobs without duplicating source records.
- Restore from first run restores into a new folder and does not import secrets.
- First-run strings exist in all v0.1 locales.

## 16. Traceability

Related documents:

- `docs/PRD.md`
- `docs/UI_PROTOTYPE.md`
- `docs/DATA_ARCHITECTURE.md`
- `docs/SOURCE_STORAGE_STRATEGY.md`
- `docs/SETTINGS_AND_PREFERENCES.md`
- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`
- `docs/JOB_OPERATION_AND_RECOVERY.md`
- `docs/API_AND_IPC_DESIGN.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/SPEC_TRACEABILITY.md`
