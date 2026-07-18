# Skill Extension Design

Status: Draft baseline
Date: 2026-07-09

## 1. Decision

Pige should support installable Skills, but Skills must stay within Pige's personal knowledge management scope.

Recommended v0.1 stance:

- Add a Skill Manager in Settings.
- Allow Skill installation from chat when the user explicitly provides a Skill link, ZIP, or Markdown file.
- Stage and preview a Skill before enabling it.
- Keep Skill installation explicit, reversible, scoped, and inspectable.
- Treat pure Skills as Markdown instruction packs, not executable plugins.
- Support external/Web Skills when they declare capabilities and run through Pige's Permission Broker.
- Route executable code, npm packages, MCP servers, scripts, binaries, shell access, network access, brokered credential use, destructive writes, and external filesystem access through explicit runtime permission prompts. Raw credential access is never an extension capability.
- Do not execute anything during install preview or staging.

## 2. What A Skill Is

A Pige Skill is a local, human-readable instruction pack that teaches the Agent a repeatable knowledge-management workflow.

Examples:

- How to process academic papers.
- How to turn book highlights into evergreen notes.
- How to write source-backed company research pages.
- How to clean meeting notes.
- How to create claims with citations.
- How to review stale pages.
- How to format a user's preferred article summary.

A Skill is not:

- A general plugin marketplace item.
- A background service.
- A way to bypass Pige permissions.
- A hidden package installer.
- A hidden bridge to shell, network, secrets, model providers, or arbitrary filesystem access.

Skill classes:

- Pure Skill: Markdown instructions plus metadata and small supporting files. It can guide Agent reasoning and create proposals through Pige services.
- External/Web Skill: a Skill that can request runtime capabilities such as web fetch, package-backed tools, shell commands, or network access. It is installable in v0.1 only when those capabilities are declared, displayed, and mediated by the Permission Broker.
- Package-provided Skill: a Skill exposed by a reviewed Pi package. Its package install and runtime capabilities remain governed by the Package Manager and Permission Broker.

## 3. Install Sources

v0.1 should support:

- URL to a `SKILL.md` or Markdown file.
- GitHub raw Markdown URL.
- ZIP archive containing a Skill directory.
- Local `.md` file dropped into the chat or selected from disk.
- Local `.zip` file dropped into the chat or selected from disk.
- Reviewed package-provided Skill.
- External/Web Skill source that declares capabilities and can be mediated by Pige.

Later:

- Git repository install.
- Signed Skill registry.

## 4. Chat-Based Install Flow

The chat input can initiate Skill installation when the user's intent is explicit.

Examples:

- "Install this Skill: https://example.com/SKILL.md"
- "把这个 zip 作为 Skill 安装"
- Drop `paper-reading-skill.zip` into Pige and say "安装成论文阅读 Skill".

Flow:

1. Capture the link or file.
2. Detect explicit Skill install intent.
3. Fetch or read the Skill source.
4. Stage it in a temporary review area.
5. Parse metadata and validate contents.
6. Show an install proposal with name, description, source, scope, capabilities, files, data boundary, and warnings.
7. User confirms install.
8. Pige copies the Skill into the selected scope and records install metadata.
9. Skill is enabled or left disabled depending on user choice.
10. If the Skill requests sensitive capabilities at runtime, Pige pauses the job and asks for permission before the action happens.

If the user only drops a Markdown file without saying it is a Skill, Pige should treat it as ordinary knowledge capture.

## 5. Skill Format

Preferred layout:

```txt
my-skill/
  SKILL.md
  references/
    style.md
  examples/
    example-input.md
    example-output.md
```

Minimal single-file Skill:

```md
---
id: paper-reading
name: Paper Reading
version: 1
description: Extract source-backed research notes from papers.
scope: vault
triggers:
  - academic paper
  - research PDF
capabilities:
  - read_current_source
  - suggest_note
  - create_review_proposal
---

## When To Use

Use when the user captures an academic paper or asks to read a paper.

## Procedure

1. Preserve source metadata.
2. Extract the thesis, methods, evidence, limitations, and useful claims.
3. Create a source-backed note with citations.

## Output Rules

- Do not invent claims.
- Keep citations attached to source pages.
```

Required metadata:

- `id`.
- `name`.
- `version`.
- `description`.
- `scope`.
- `capabilities`.

Recommended metadata:

- `kind`: `pure`, `external_web`, or `package_provided`.
- `triggers`.
- `author`.
- `sourceUrl`.
- `license`.
- `updatedAt`.
- `dataBoundary`.
- `permissionSummary`.

## 6. Storage

Skill scopes:

### 6.1 Built-In Skills

Location:

```txt
App bundle/
  skills/
```

Rules:

- Shipped with Pige.
- Cannot be edited in place.
- Can be disabled if appropriate.

### 6.2 Vault Skills

Location:

```txt
Pige Vault/
  .pige/
    skills/
      paper-reading/
        SKILL.md
        references/
```

Rules:

- Travel with the vault.
- Included in backups by default.
- Pure vault Skills must be plain Markdown, JSON metadata, and small supporting files.
- External/Web vault Skills may declare capabilities, but executable/package-backed behavior is not portable unless the target machine has the required package/tool and the user grants permission there.
- Good for vault-specific workflows and note conventions.

### 6.3 Machine-Local Skills

Location:

```txt
OS app data/
  Pige/
    skills/
```

Rules:

- Stay on the current machine.
- Device-installed Skills under this directory do not enter vault backup sets.
- Useful for personal workflows that should not travel with a vault.

`skills/registry.json` projects checksum-confirmed machine-local non-package
identity. CAS disable is the sole mutation.

## 7. Safety Rules

Skill install safety:

- ZIP extraction must block path traversal.
- Enforce maximum archive size and file count.
- Only allow Markdown, JSON metadata, and small supporting assets by default.
- Scripts, binaries, packages, MCP configs, native modules, package hooks, and executable files cannot run during staging or preview.
- Executable/package-backed contents must be identified, shown as warnings, and routed through a reviewed runtime adapter, Package Manager, or Local Tools flow before runtime use.
- Do not execute anything during Skill install.
- Remote Skill content is untrusted until the user confirms install.
- Show source URL, checksum, file list, and warnings before install.

Runtime safety:

- Pure Skills can influence Agent reasoning, but cannot directly access files, network, shell, model providers, packages, settings, or secrets.
- External/Web Skills can request sensitive capabilities, but Pige services must pause execution and ask the user before granting them.
- Skills request capabilities; Pige services enforce permissions.
- Permission-scoped Skill mutations flow through Pige services and Operations; after a valid
  grant, eligible reversible changes auto-apply, while only autonomy exceptions propose.
- Current user instruction, `PIGE.md`, and explicit settings outrank Skills.
- Skills cannot override prompt-injection defenses, package permissions, local tool
  policies, permission gates, or exceptional intervention.
- A denied capability leaves the Skill installed but unable to perform that action.

Sensitive capabilities that require a permission prompt:

- Read or write vault data outside the current job scope.
- Delete, archive, merge, or rename durable vault files.
- Read external filesystem paths.
- Use external network access.
- Run shell commands or package-backed tools.
- Install or update packages or local tools.
- Send large/private sources to a cloud model.
- Ask a reviewed adapter to use a brokered credential for one declared provider action. The Skill/package never receives or returns raw API keys, tokens, secret refs, or secret-store contents; a raw-secret request is rejected rather than prompted.
- Change app settings, provider settings, or `PIGE.md`.
- Spawn another Agent or long-running background process.

Permission prompts must include actor, capability, resource scope, reason, data-boundary badges, and choices for Deny, Allow Once, and Always Allow. Destructive actions must not default to allow. Always Allow must be scoped, such as only this URL, only this domain, only this file/folder, only this vault, or only this Skill/package/tool version. If the user enables YOLO Full Access in Settings, covered actions skip prompts but still create visible permission and operation logs.

## 8. Skill Manager UI

Settings should include a Skills section.

Required actions:

- Install from link.
- Install from file.
- Inspect staged Skill before install.
- Enable.
- Disable.
- Uninstall.
- Update from source when source metadata exists.
- Export.
- Change scope when safe.
- Show conflicts and trigger overlaps.

Skill details should show:

- Name.
- Description.
- Source.
- Scope.
- Version.
- Author/license when known.
- Files.
- Capabilities requested.
- Data boundary.
- Permission history and saved grants.
- Last used.
- Warnings.

Runtime authorization dialog:

```txt
Paper Reading wants to fetch a web page

Capability: external network
Scope: https://example.com/*
Reason: Read the article linked in the current capture.
Data boundary: Network

Deny
Allow Once
Always Allow
```

Dialog behavior:

- The job enters `waiting_permission` while the dialog is open.
- `Allow Once` applies only to the current action.
- `Always Allow` is scoped to actor ID, actor version, capability, and resource scope.
- Permission history can be reviewed and revoked in Settings.
- Destructive actions use stronger copy and require deliberate confirmation.
- YOLO Full Access can be enabled only in Settings, never from a Skill install flow or source content.

## 9. Agent Use

At runtime, Pige selects Skills by:

- Explicit user request.
- Current capture type.
- Note/source type.
- Trigger phrases.
- Vault conventions.
- User selection in the UI.

The Agent receives only relevant active Skill instructions, not the entire installed Skill library.

Skill use should be logged when it materially affects output:

- "Used Skill: Paper Reading"
- "Used Skill: Meeting Note Cleanup"

## 10. Relationship To Pi Packages

Pi packages may include skills, extensions, prompts, themes, and executable capabilities.
Pure Markdown uses Skill Manager; declared External/Web capabilities remain mediated.
Packages and executables use Package Manager, Local Tools, or a reviewed adapter, and any
included Skill remains under package permission authority.

### 10.1 Package Manager Product Boundary

Package Manager owns metadata, trust disclosure and lifecycle. Default UI shows reviewed
and installed packages; Advanced owns community search. Catalog data cannot grant trust,
enablement or permission.

### 10.2 Inspectable Package Metadata

Before install/update, disclose available identity, author, license, type, source, exact
version/integrity, capabilities, permissions, runtime/boundary, trust and lifecycle facts.
Popularity is informational; unknown stays unknown.

### 10.3 Trust Categories And Runtime Authority

Trust is `built_in | curated | community | blocked`, never authority. Curated binds only
the reviewed version; install does not promote trust, and every enabled package remains
adapter- and Permission-Broker-scoped.

### 10.4 Lifecycle And Health

Install state is `not_installed | staged | installed_disabled | installed_enabled`; health
flags `update_available | deprecated | repair_needed` are independent from trust.

- Search/inspect/stage never run package code, hooks, shell, or package callbacks.
- Install/update need explicit disclosed intent; enable exposes only reviewed adapters;
  disable stops new use without deleting durable output.
- Manual update discloses version/capability/permission/boundary/trust/dependency drift;
  pinning, rollback records and failed-change restoration remain required.
- Uninstall explicitly removes machine-local files/grants, never user Markdown/evidence.
- Ordinary work never infers or hides install/update. Explicit chat install must name an
  exact package/version; Pi cannot choose dependencies or turn another task into install.

Current foundation permits that exact public npm request only after current-action
`install_package`; SHA-512 and bounded path-safe extraction are required, while hooks,
executable/native metadata/content, and runtime dependencies fail closed. Success is an
immutable machine-local `installed_disabled` record only. It adds no trust, catalog, UI,
enable/runtime tool, update, rollback, or uninstall authority.

## 11. v0.1 Scope

Include:

- Skills settings page.
- Install from URL, `.md`, and `.zip`.
- Chat-initiated install when user intent is explicit.
- Staging preview and confirmation.
- Vault-scoped and machine-local Skills.
- Enable, disable, uninstall, export.
- Metadata parsing.
- Basic capability declaration.
- Safety checks for ZIP and file types.
- Permission Broker integration for external/Web Skill actions.
- Saved grants and permission revocation UI.
- Agent runtime selection of active relevant Skills.

Defer:

- Public Skill marketplace.
- Automatic remote updates.
- Skill signing.
- Git repository install.
- Skills that define new UI panels.
- Stronger sandboxing and signed Skill/package registry beyond v0.1 permission prompts.

## 12. References

Extension/package sources and review triggers are registered once in
[`TECH_ARCHITECTURE.md`](TECH_ARCHITECTURE.md#168-extension-package-and-reference-ecosystem).
