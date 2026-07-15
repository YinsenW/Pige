# Settings And Preferences Architecture

Status: Draft baseline
Date: 2026-07-09

## 1. Purpose

This document defines how Pige models user-visible settings, internal preferences, provider configuration, local capability state, and vault policy.

Settings are not just UI controls. They are data ownership decisions. A setting can affect privacy, backup, restore, portability, future sync, Agent behavior, local tools, or user trust.

The rule:

> Every setting must declare owner, scope, storage location, backup behavior, permission requirement, apply behavior, and migration behavior before implementation.

If a setting affects Agent goals, prompt context, tool policy, storage behavior, language behavior, confirmation behavior, model behavior, retrieval behavior, or local capability behavior, it must also declare its Agent Runtime Policy Context effect. The detailed contract is `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`.

## 2. Product Principle

Pige should feel simple even when its internals are powerful.

Settings should:

- Help users control the product.
- Reveal only necessary local ownership, privacy, model, permission, extension, and maintenance state.
- Hide implementation catalogs, capability matrices, caches, internal indexes, parser details, and package complexity by default.
- Use progressive disclosure only when a real user task requires it.

Settings should not become:

- An Agent platform console.
- A model marketplace.
- A database/index dashboard.
- A filesystem explorer.
- A package-manager control panel for arbitrary automation.

## 3. Setting Scopes

Every setting belongs to exactly one primary scope.

| Scope | Meaning | Default storage | Backup default |
| --- | --- | --- | --- |
| `vault_portable` | Travels with a Pige vault and affects how that vault behaves. | `.pige/config.json`, `PIGE.md`, or vault files | Included |
| `vault_identity` | Stable vault identity and compatibility metadata. | `.pige/manifest.json` | Included |
| `machine_local` | Belongs to this app installation or device. | OS app data | Excluded |
| `machine_vault_binding` | Machine-local preference keyed to a specific `vault_id`. | OS app data | Excluded, listed when relevant |
| `secret` | API keys, tokens, future sync credentials. | OS keychain or encrypted secret store | Excluded |
| `permission_grant` | Runtime authorization decisions. | Machine-local permission store | Excluded |
| `derived_status` | Computed health, index, model, package, or tool status. | SQLite/cache/app data | Excluded or rebuildable |
| `runtime_transient` | Temporary UI/runtime state. | Memory or temp files | Excluded |

Rules:

- Active vault path and recent vault list are `machine_local`.
- Vault ID and schema version are `vault_identity`.
- Active absolute paths must not be written into `.pige/manifest.json`.
- An in-vault managed-copy root is `vault_portable`.
- An external managed-copy root is a `machine_vault_binding` with a stable `root_` ID and must appear in backup/restore manifests as an external dependency. The absolute path remains machine-local.
- API keys are always `secret`, even when associated with a provider profile.
- Permission mode and saved grants are machine-local unless future sync explicitly designs a portable permission profile.

## 4. Storage Locations

Recommended v0.1 storage:

```txt
OS app data/
  settings.json                  machine-local non-secret settings
  provider-profiles.json          provider metadata without secrets
  model-profiles.json             model IDs and selected default model
  permissions.json                saved scoped grants and YOLO status
  local-capabilities.json         local tool/model/package status
  vault-bindings.json             vault_id -> machine-specific paths
  jobs/                           machine-local job records

OS keychain or encrypted store/
  provider_secret_*               API keys and tokens

Pige Vault/
  PIGE.md                         vault-level Agent policy
  .pige/
    manifest.json                 vault identity and schema
    config.json                   portable non-secret vault preferences
    skills/                       vault-scoped pure Skills
    memory/                       vault-scoped Agent memory
```

Storage rules:

- `settings.json` must not contain secrets.
- Keyed Provider records store only secret references; no-auth Providers store neither.
- `.pige/config.json` must not contain active absolute paths outside the vault, API keys, provider tokens, permission grants, or machine-only update state.
- `.pige/manifest.json` is not a general settings file.
- Derived health/status can be recomputed and should not be treated as user preference.
- `sourceAssetRoot*` is the schema-v1 compatibility name for managed-copy placement; `artifactRoot` remains vault-portable at `artifacts/`. Root identity/resolution is owned by `docs/SOURCE_STORAGE_STRATEGY.md`.

## 5. Settings Information Architecture

v0.1 settings groups:

```txt
Basic
  General
  Appearance & Language

Knowledge Base
  Vault & Note Storage
  Index & Maintenance

AI
  Models
  Local Capabilities
  Agent & Memory

Security
  Permissions & Privacy

Extensions
  Skills
  Pi Packages

System
  Updates & Diagnostics
```

Rules:

- Each page owns one conceptual domain.
- Cross-links can guide the user to related pages, but a page should not embed another domain's controls.
- Models connects preset/custom Providers, manages one inventory per Provider, and picks
  Global Default; only Custom exposes protocol/Base URL.
- Model/provider behavior must follow `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`; do not add Advanced/Fast model settings unless runtime routing support is real and tested.
- Local embeddings, OCR, speech, parsers, and bundled tool health belong to Local Capabilities.
- Non-default Agent/extension permission mode, cloud-send policy, API key storage mode,
  and YOLO belong to Permissions & Privacy; standing active-vault knowledge-Markdown
  autonomy is not YOLO.
- Vault & Note Storage separately shows note and source locations; each available root has one platform-neutral reveal action, while an unavailable external source binding is shown as not connected and cannot fall back to the vault root.
- Trash/archive policy follows `docs/DATA_ARCHITECTURE.md`; no setting lets any actor permanently delete durable knowledge/source evidence automatically.

## 6. Setting Registry

This table is the v0.1 baseline. Implementation can split storage files differently, but it must preserve every declared field. Permission values use the executable `SettingPermissionRequirementSchema`: `none`, `os_permission`, `permission_broker`, `explicit_confirmation`, `permission_and_confirmation`, or `explicit_warning`.

| Setting or state | Page | Scope | Owner | Storage | Backup | Permission requirement | Apply behavior |
| --- | --- | --- | --- | --- | --- | --- | --- |
| App language | Appearance & Language | `machine_local` | Settings Service, I18N Service | OS app data | No | `none` | Apply immediately when practical |
| Theme | Appearance & Language | `machine_local` | Settings Service, Renderer | OS app data | No | `none` | Immediate |
| Window sizes and layout mode | General | `machine_local` | Window Service | OS app data | No | `none` | Next/open window or immediate resize |
| Always-on-top preference | General/Home | `machine_local` | Window Service | OS app data | No | `none` | Immediate |
| Sidebar visibility | General/Home | `machine_local` | Window Service | OS app data | No | `none` | Immediate |
| Startup behavior | General | `machine_local` | Window Service, Vault Runtime Service | OS app data | No | `none` | Next launch |
| Active vault path | Vault & Note Storage | `machine_local` | Vault Runtime Service | OS app data | No | `permission_and_confirmation` | Safe user switch or restore-owned exact binding CAS after destination commit |
| Recent vault list | Vault & Note Storage | `machine_local` | Vault Runtime Service | OS app data | No | `none` | Immediate |
| First-Home guide dismissal | Home | `machine_vault_binding` | Vault Runtime Service | OS app data keyed by `vault_id` | No | `none` | Immediate after explicit Connect/continue choice; older settings default to showing it |
| Vault ID | Vault & Note Storage | `vault_identity` | Vault Runtime Service | `.pige/manifest.json` | Yes | `explicit_confirmation` | Immutable after creation unless migration |
| Vault schema version | Vault & Note Storage | `vault_identity` | Migration Service | `.pige/manifest.json` | Yes | `explicit_confirmation` | Migration controlled |
| Default source storage strategy | Vault & Note Storage | `vault_portable` | Source Storage Service | `.pige/config.json` | Yes | `none` | New file captures only; text and URL snapshots are necessarily managed copies |
| In-vault managed-copy root (`inVaultSourceAssetRoot` compatibility field) | Vault & Note Storage | `vault_portable` | Source Storage Service | `.pige/config.json` relative path | Yes | `os_permission` | New managed sources; existing sources unchanged |
| External managed-copy root binding | Vault & Note Storage | `machine_vault_binding` | Source Storage Service | OS app data keyed by `vault_id` and `rootId` | Binding no; backup manifest lists dependency and managed copies are included by default when reachable | `permission_and_confirmation` | Requires path validation; existing sources retain prior root ID |
| Backup include/exclude defaults | Vault & Note Storage/Backup flow | mixed | Backup Service | `.pige/config.json` for vault defaults, OS app data for machine choices | Vault defaults yes | `none` | Next backup |
| User Backup status/actions | Vault & Note Storage | `derived_status` + vault Job | Backup Coordinator, Jobs Service | `.pige/jobs/`; latest completed user Backup derives `lastBackupAt` | Backup Job no; archive/Operation yes | `none` | Durable create; eligible Cancel/Retry; restart adopts |
| Trash/archive policy | Vault & Note Storage | `vault_portable` | Vault Runtime Service | `.pige/config.json` | Yes | `explicit_confirmation` | Immediate for future deletes |
| Index rebuild requested | Index & Maintenance | `runtime_transient` job | Local Database Service | job record | Job backup policy | `none` | Starts a rebuildable `index_rebuild` job; unlike Reset Local Database, this does not delete derived state first |
| Index/chunk health status | Index & Maintenance | `derived_status` | Local Database Service | SQLite/app data | No | `none` | Recomputed |
| Provider template/profile metadata, preset identity, protocol, and Endpoint binding | Models | `machine_local` | Model Provider Registry | OS app data | No by default | `explicit_confirmation` | Journaled Connect/reconnect; startup rollback |
| Provider credential when required | Models | `secret` | Settings and Secrets Service | OS keychain/encrypted store | No | `explicit_warning` | After validated Connect |
| Provider model inventory: exact ID, source, enabled state, optional alias/capabilities | Models | `machine_local` | Model Provider Registry | OS app data | No by default | `none` | Journaled Refresh; atomic manual/alias/enabled updates |
| Provider model-sync health | Models | `runtime_transient` | Model Provider Registry, Renderer | None | No | `none` | Session-local; failure preserves last inventory |
| Global Default Pi Agent model | Models | `machine_local` | Model Provider Registry, Agent Orchestrator | OS app data | No by default | `none` | New calls; must reference an enabled model |
| Cloud-send policy (`ordinary_allowed` default) | Permissions & Privacy | `machine_local` | Settings Service, Model Egress Policy | OS app data | No | `explicit_confirmation` | New model calls |
| Local embedding model status | Local Capabilities | `derived_status` plus machine asset | Local RAG Engine, Local Tool Service | OS app data | No | `permission_and_confirmation` | After download/remove job |
| OCR engine preference | Local Capabilities | `machine_local` | OCR Service | OS app data | No | `none` | New OCR jobs |
| OCR language hints | Local Capabilities | `machine_local` | OCR Service, I18N Service | OS app data | No | `none` | New OCR jobs |
| Speech input enabled | Local Capabilities | `machine_local` | Speech Service | OS app data | No | `os_permission` | Immediate |
| Parser/toolchain health | Local Capabilities/System | `derived_status` | Runtime Capability Service, Local Tool Service | `resources/toolchain-manifest/` plus resolved bundled paths | No | `none` | Recomputed/repair job |
| `PIGE.md` policy | Agent & Memory | `vault_portable` | Vault Service, Agent Orchestrator | `PIGE.md` | Yes | `explicit_confirmation` | Requires validation and proposal |
| Agent behavior preferences | Agent & Memory | `vault_portable` or `machine_local` by item | Agent Orchestrator | `.pige/config.json` or OS app data | Depends | `none` | Usually new jobs; exceptional boundary changes use their own guarded setting |
| Memory enabled state | Agent & Memory | `vault_portable` for vault memory | Agent Memory Service | `.pige/config.json` | Yes | `none` | New memory reads/writes |
| Memory backup inclusion | Agent & Memory/Backup flow | `vault_portable` | Backup Service | `.pige/config.json` | Yes | `none` | Next backup |
| Exceptional intervention policy (`confirmation.*` compatibility) | Agent & Memory | `vault_portable` | Agent Orchestrator, Change Proposal Service | `.pige/config.json` | Yes | `explicit_confirmation` | New jobs; cannot turn uncertainty into routine prompts |
| Default permission mode | Permissions & Privacy | `machine_local` | Permission Broker | OS app data | No | `explicit_confirmation` | Immediate |
| Saved scoped grants | Permissions & Privacy | `permission_grant` | Permission Broker | Machine-local permission store | No | `explicit_confirmation` | Immediate |
| YOLO Full Access | Permissions & Privacy | `permission_grant` | Permission Broker | Machine-local permission store | No | `explicit_confirmation` | Immediate, visible indicator |
| Secret storage mode | Permissions & Privacy | `machine_local` plus `secret` | Settings and Secrets Service | OS app data + secret store | No | `explicit_warning` | Requires explicit warning |
| Secret redaction policy | Permissions & Privacy | `machine_local` | Diagnostics Service | OS app data | No | `explicit_confirmation` | Immediate |
| Vault-scoped Skill enablement | Skills | `vault_portable` | Skill Registry Service | `.pige/skills/` metadata or `.pige/config.json` | Yes | `permission_broker` | New Agent runs |
| Machine-local Skill enablement | Skills | `machine_local` | Skill Registry Service | OS app data | No | `permission_broker` | New Agent runs |
| Pi package install records | Pi Packages | `machine_local` | Pi Package Registry Service | OS app data | No | `permission_and_confirmation` | After install/remove job |
| Package permission grants | Pi Packages/Permissions | `permission_grant` | Permission Broker | Machine-local permission store | No | `explicit_confirmation` | Immediate |
| Update channel/status | Updates & Diagnostics | `machine_local` | Update Service | OS app data | No | `none` | Next update check |
| Diagnostics export preferences | Updates & Diagnostics | `machine_local` | Diagnostics Service | OS app data | No | `explicit_confirmation` | Next export |

If a new setting does not fit this table, update this document before implementation.

### 6.0.1 Implemented Enforcement Index

This compact index mirrors every entry currently returned by `settings.registry`. The registry value is consumed by main-process workflow guards; it is not renderer-only display metadata.

| Executable key | Permission requirement | Current enforcement path |
| --- | --- | --- |
| `app.locale` | `none` | Validated locale IPC |
| `window.layoutMode` | `none` | Validated window-mode IPC |
| `window.alwaysOnTop` | `none` | Validated window preference IPC |
| `window.sidebarOpen` | `none` | Validated window preference IPC |
| `vault.activePath` | `permission_and_confirmation` | Main-process native folder selection plus safe vault switch |
| `vault.recentVaults` | `none` | Main-process recent-vault store |
| `vault.id` | `explicit_confirmation` | Main-process create/open vault workflow; immutable after creation |
| `sourceStorage.defaultStrategy` | `none` | Capture Service reads the active vault value for every new file capture |
| `backup.entryPoints` | `none` | Derived read-only status |
| `models.providerProfiles` | `explicit_confirmation` | `guardSettingAction` before provider network validation |
| `models.providerApiKeys` | `explicit_warning` | Same native guard before secret-store or network access |
| `models.manualModelIds` | `none` | Validated as part of the confirmed provider workflow |
| `models.defaultPiAgentModel` | `none` | Validated enabled-model selection |
| `maintenance.localDatabaseReset` | `explicit_confirmation` | `guardSettingAction` before rebuildable-state deletion |
| `diagnostics.health` | `none` | Derived read-only status |
| `diagnostics.supportBundleExport` | `explicit_confirmation` | Preview plus main-process native save dialog |
| `toolchain.health` | `none` | Derived read-only status |

Changing a permission requirement without changing its enforcement path and tests is a contract error. `permission_broker` is fail-closed in `guardSettingAction` until the real broker path supplies an authorization decision.

`maintenance.rebuildLocalDatabase` is a non-destructive maintenance command, not a persisted registry setting. It creates an auditable `index_rebuild` job from durable Markdown and therefore requires no confirmation. `maintenance.localDatabaseReset` is the distinct destructive-to-derived-state action and remains guarded by `explicit_confirmation`.

## 6.1 Agent Policy Effect Registry

Agent-affecting settings are not free-form prompt snippets. They compile into typed Agent Runtime Policy Context and are enforced by owning services.

| Setting or state | Agent policy effect | Prompt-visible? | Enforced by | Applies to |
| --- | --- | --- | --- | --- |
| Default source storage strategy | `sourceStorage.defaultStrategy` | Yes | Source Storage Service | New file captures only; text and URL inputs remain managed snapshots |
| In-vault managed-copy root | `sourceStorage.sourceAssetRootKind` compatibility field | Sometimes | Source Storage Service | New managed sources; existing sources unchanged |
| External managed-copy root binding | `sourceStorage.sourceAssetRootKind` plus stable root binding availability | Sometimes | Source Storage Service, Permission Broker | New managed sources and source availability checks; existing sources resolve their recorded root ID |
| Default Pi Agent model | `model.defaultModelProfileId` | Yes | Model Provider Registry, Agent Orchestrator | New model calls |
| Provider profile metadata | protocol-bound availability and internal `model.cloudBoundary` | Yes, redacted | Model Provider Registry | New model calls |
| Cloud-send policy (`ordinary_allowed` default) | `model.cloudSendPolicy` | Yes | Model Egress Policy, Model Provider Registry | New model calls and queued model jobs |
| Default permission mode | `permissions.defaultMode` | Yes | Permission Broker | Next sensitive action |
| Saved scoped grants | `permissions.savedGrantSummaryRefs` | No raw details | Permission Broker | Next sensitive action |
| YOLO Full Access | `permissions.yoloEnabled` | Yes, as status only | Permission Broker | Next covered sensitive action |
| App language | `language.appLocale` | Yes | I18N Service, Renderer | UI immediately; generated text only when policy says so |
| OCR language hints | `language.ocrLanguageHints` | Maybe | OCR Service | New OCR jobs |
| Agent behavior preferences | Workflow-specific policy fields | Yes | Agent Orchestrator | New Agent jobs |
| Memory enabled state | `memory.vaultMemoryEnabled` | Yes | Agent Memory Service | New memory reads/writes |
| Memory backup inclusion | `memory.includeMemoryInBackup` | No | Backup Service | Next backup |
| Exceptional intervention compatibility | `confirmation.*` | Yes | Agent Orchestrator, Change Proposal Service | New jobs |
| Local embedding model status | `retrieval.vectorSearchAvailable` | Maybe | Local RAG Engine | New retrieval/index jobs |
| Parser/toolchain health | `localCapabilities.parserToolchainReady` | Maybe | Local Tool Service, Parser Service | New parser jobs |
| Speech input enabled | `localCapabilities.speechInputAvailable` | No for Agent | Speech Service | New dictation sessions |
| Vault-scoped Skill enablement | Tool availability and capability scope | Yes, scoped | Skill Registry Service, Permission Broker | New Agent runs |
| Pi package install records | Tool availability and capability scope | Yes, scoped | Pi Package Registry Service, Permission Broker | New Agent runs |

Rules:

- If a setting appears in this table, prompt assembly tests must cover it when it changes model-visible policy.
- If a setting is enforced entirely outside the model, it can be hidden from prompt context.
- Job and operation records should store `policyContextId` or `policyHash`, not full settings files.
- Source content, model output, Skills, packages, and web pages cannot modify Agent policy context.

## 7. Change Semantics

Setting changes are one of these types:

| Type | Examples | Behavior |
| --- | --- | --- |
| Immediate | theme, language when possible, permission grant revoke | Apply now and emit event |
| Next operation | default model, OCR preference, source storage strategy | Applies to new jobs only |
| Requires job coordination | active vault switch, managed-copy root validation | Pause/flush/cancel/recover jobs safely |
| Requires exceptional intervention | `PIGE.md`, destructive vault migration/cleanup | Validate, preview, confirm, recover |
| Requires restart | update channel in some cases, low-level native runtime setting | Tell user clearly |

Rules:

- A setting update must be atomic from the user's perspective.
- Failed updates leave the previous setting active.
- Settings that affect running jobs must define whether jobs continue with old settings, pause, or restart.
- Settings changes that affect privacy, permissions, secrets, source paths, provider profiles, package execution, or vault structure must create operation records or permission records.
- Their operation records use `change_setting` and retain redacted `policyAudit` context ID/hash plus enforcing owners and applicable permission decision IDs; they never embed the setting file, old/new secret, or raw external path.

## 8. Agent And Skill Boundaries

Source content, model output, Skills, packages, and web pages must not directly change settings.

Allowed paths:

- The human user changes settings in Settings UI.
- A direct user request for an ordinary reversible setting is validated and applied without
  a second prompt; sensitive changes use the applicable exceptional gate.
- Built-in maintenance auto-applies non-destructive repair; destructive change is previewed.

Sensitive settings that always require explicit confirmation:

- API key storage mode.
- Cloud-send policy that sends more data to cloud providers.
- YOLO Full Access.
- Default permission mode.
- Provider profile changes.
- Vault path, external managed-copy root, or source storage policy changes.
- `PIGE.md` edits.
- Skill/package enablement with external capabilities.
- Diagnostics export options that include additional data.

Denied setting changes must leave jobs and UI stable.

## 9. Backup, Restore, And Export

Default vault backup includes:

- `.pige/config.json`.
- `PIGE.md`.
- Vault-scoped Skills and memory according to backup policy.
- Non-secret vault preferences.

Default vault backup excludes:

- OS app data settings.
- Provider profiles by default.
- API keys and tokens.
- Permission grants.
- Local model/tool/package files.
- Active vault path and recent vault list.
- Raw external root bindings and externally referenced originals. Reachable Pige-managed copies are included by default even when their managed-copy root is external; incomplete omission requires an explicit backup decision.
- User/rollback Backup Job records containing machine-local destination references.

Restore rules:

- Preview shows vault/app/schema, note/source counts, date and localized typed
  warning/dependency counts without raw path/entry detail.
- Restoring a vault into a new folder creates a new machine-local active vault binding.
- Restored vault config must not assume old absolute paths are still valid.
- External roots reconnect or restore in-vault; unresolved root IDs stay visible.
- Provider profiles and secrets can be imported only through an explicit, redacted settings import/export flow.
- `replace_existing` preserves vault ID, confirms irreversibility, verifies rollback,
  publishes fresh, then CAS-swaps the active binding; old folder remains unregistered.
- `clone_as_new` mints vault/binding and omits grants, YOLO, secrets and external paths.
- Restore Jobs/claims remain backup-excluded OS app-data, never staging/restored-vault state.

Settings export:

- Default export excludes secrets.
- Secret export is out of scope for v0.1 unless explicitly designed later.
- Diagnostics export must redact secrets and avoid full source bodies by default.

## 10. Future Sync And Mobile

v0.1 does not implement sync, but settings must be sync-ready.

Future sync rules:

- `vault_portable` settings can sync with the vault.
- `machine_local`, `permission_grant`, and `secret` settings do not sync by default.
- Future cloud/mobile clients may support a settings profile, but that profile must not silently import desktop YOLO, shell, filesystem, or package permissions.
- Mobile clients should read vault settings that affect rendering, language, memory visibility, and source metadata, but may ignore desktop-only local capability settings.
- Remote Agent Backend must receive an explicit runtime capability profile, not infer desktop settings.

## 11. API Contract Requirements

Settings APIs must be typed and scoped.

Required concepts:

```ts
type SettingScope =
  | "vault_portable"
  | "vault_identity"
  | "machine_local"
  | "machine_vault_binding"
  | "secret"
  | "permission_grant"
  | "derived_status"
  | "runtime_transient";

type SettingPatch = {
  key: string;
  scope: SettingScope;
  vaultId?: string;
  expectedVersion?: string;
  value: unknown;
  reason?: string;
};
```

Rules:

- Renderer receives display DTOs, not raw secret values or arbitrary filesystem capability.
- Secret writes go through dedicated secret APIs.
- Agent/extension actions outside standing authority route through Permission Broker; irreversible/security/
  destination/conflict patches use exceptional intervention.
- Settings reads should be grouped by page and redacted by default.
- Settings changes should emit domain events so UI, jobs, and services can refresh safely.

## 12. Tests

Required tests:

- Setting registry has no unclassified user-visible setting.
- No secret setting is stored in Markdown, SQLite, logs, prompts, diagnostics, operation records, or default backups.
- Active vault path and recent vault list never appear in `.pige/manifest.json`.
- `.pige/config.json` contains only portable non-secret vault preferences.
- External managed-copy root binding is machine-local, has a stable `root_` ID, appears as an external dependency in backup/restore preview, and never retargets existing sidecars when the default root changes.
- Agent-affecting settings appear in the Agent Policy Effect Registry and compile into Agent Runtime Policy Context.
- Provider refresh preserves list/alias/enabled/default on failure and never exposes keys
  or duplicates manual/discovered IDs.
- Provider Connect performs the exact-protocol Pi generation/tool probe before writes;
  failure persists nothing, and staged rollback/readback cannot delete a still-referenced secret.
- Provider setup uses one inventory; typed Retry/manual ID covers incomplete discovery.
- The next profile revision stores an explicit Responses, Chat Completions, or Anthropic
  Messages protocol. New custom setup requires a choice; legacy compatible/custom
  records migrate by the Pi Owner mapping and are never inferred from URL.
- Default binding reports not-configured/ready/configured-unusable without secret reads;
  changing it affects new Pi calls.
- Changing source storage strategy affects new file captures only; typed/pasted text and fetched URL snapshots remain managed copies.
- Revoking permission grants takes effect immediately.
- YOLO can only be enabled through explicit Settings action and remains visible/revocable.
- Restore works without machine-local settings.
- Settings page strings exist in all v0.1 locales.

## 13. Implementation Checklist

Before adding a setting:

1. Define user need.
2. Choose Settings page.
3. Choose primary scope.
4. Choose owning service.
5. Choose storage location.
6. Define backup/restore behavior.
7. Define permission/confirmation requirement.
8. Define apply behavior for running jobs.
9. Define redaction and diagnostics behavior.
10. Add tests.
11. Update this registry and traceability when user-visible.

If a setting is only useful for debugging internal state, keep it out of the default UI.
