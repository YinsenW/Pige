# Skill Extension Design

Status: Draft baseline
Date: 2026-07-09

## 1. Decision

Pige should support installable Skills, but Skills must stay within Pige's personal knowledge management scope.

Recommended v0.1 stance:

- Add a Skill Manager in Settings.
- Let Settings or explicit authored chat stage a bounded Skill for review.
- Installation is explicit, reversible and non-executing. External/Web Skills install disabled;
  runtime and enablement require the separate reviewed adapter boundary.

## 2. What A Skill Is

A Pige Skill is a local, human-readable instruction pack for repeatable knowledge work such as
source-backed research, note cleanup, cited claims or preferred summaries. It is not a marketplace
plugin, background service, permission bypass, hidden installer, or hidden bridge to privileged
resources.

Skill classes:

- Pure: Markdown, metadata and small files that guide reasoning through Pige services.
- External/Web: declarative content requesting displayed capabilities; installation grants none.
- Package-provided: exposed by a reviewed Pi package and governed by Package Manager boundaries.

## 3. Install Sources

v0.1 targets URL/GitHub-raw Markdown, local `.md`/`.zip`, package-provided and declared
External/Web sources; Git repositories and a signed registry remain later.

## 4. Install And Installed Lifecycle

Settings reviews one HTTPS or Main-picked `.md`/`.zip` pure or strict `external_web` Skill.
Markdown is 256 KiB; ZIP is no-follow/parent-fenced, at most 2 MiB compressed, 4 MiB/64 files
and one root `SKILL.md`. Executables, hooks, packages, raw-secret/unknown capabilities, missing
or ambiguous boundaries, links, paths, tampering and stale review close before durable effect.
Explicit authored chat selects one Host HTTPS candidate by index; other content cannot authorize.

External review and installed summaries expose only kind, exact declared capabilities and derived
boundaries, safe source, checksums, files and warnings. Explicit install persists verified bytes
disabled with `canEnable=false`; stage/install never runs Skill content. External update, enable and
runtime remain separate work.

Only verified `user_confirmed` machine-local pure Skills expose lifecycle actions. Enable restores;
uninstall trashes; export is pathless. HTTPS update binds source/base/revision, preserves state,
trashes prior bytes and CAS-adopts once. Background, cross-source/file/ZIP update and public
restore stay out.

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

`skills/registry.json` is checksum-safe; token/revision fence disable; failures are body-free.

## 7. Safety Rules

Install staging is bounded and non-executing: ZIP traversal/file-count/size and allowed-file rules
apply; scripts, binaries, packages, hooks, native modules and MCP configs never run. Remote content
stays untrusted until exact review; safe source, checksums, files and warnings remain visible.

Runtime safety:

- Pure Skills influence Agent reasoning but cannot directly access files, network, shell,
  providers, packages, settings or secrets.
- Built-in registered first-party tools use the submitted turn's exact resource authority.
- External/Web Skills and packages declare capabilities and run through reviewed adapters
  and isolation; they never inherit first-party authority by name or prompt text.
- Pige validates scope, path, resource, credential and effect boundaries. Raw credentials
  are never promptable or returned to Skill code.
- Only closed-list high-risk effects ask once for the exact effect. Ordinary read, parse,
  OCR, retrieval, user-specified fetch and registered local-tool work does not pause for a
  permission lifecycle.
- Current user instruction, `PIGE.md`, explicit settings and Host safety invariants outrank
  Skills. Denial leaves the app stable and applies no effect.

## 8. Skill Manager UI

Settings should include a Skills section.

Required actions: staged link/file install, inspect, enable/disable, uninstall, update, export,
safe scope and conflict/trigger visibility.

Skill details should show:

- Name.
- Description.
- Source.
- Scope.
- Version.
- Author/license when known.
- Files.
- Capabilities requested.
- Declared capabilities and data boundary.
- Last used.
- Warnings.

High-risk effect dialog:

```txt
Paper Reading wants to fetch a web page

Capability: external network
Scope: https://example.com/*
Reason: Read the article linked in the current capture.
Data boundary: Network

Deny
Confirm exact effect
```

Dialog behavior:

- The Job does not enter a waiting-permission state.
- Confirmation applies only to the exact bound effect and cannot be saved.
- Deny/Escape applies no effect; destructive actions use stronger consequence copy.
- Source content, Skill code and model output cannot create or broaden authority.

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

Pi packages may include Skills or executable capabilities; pure Markdown stays in Skill Manager.

### 10.1 Package Manager Product Boundary

Package Manager owns pathless metadata/lifecycle. Reviewed/installed entries are default; community
search is Advanced. Catalog data grants no authority.

### 10.2 Inspectable Package Metadata

Install/update discloses identity, license, type, source, version/integrity, capabilities, boundary
and trust. Unknown stays unknown.

### 10.3 Trust Categories And Runtime Authority

Trust is `built_in | curated | community | blocked`, never authority. Curated pins one version;
runtime still requires reviewed isolation and Broker mediation.

### 10.4 Lifecycle And Health

State is `not_installed | staged | installed_disabled | installed_enabled`.

- Search/stage is inert; uninstall preserves evidence. Pin blocks update/rollback until unpin.
- Explicit install recipes freeze supply chain, Skills and destinations before confirmation.

Settings searches one offline reviewed `@narumitw/pi-btw@0.34.0` entry with MIT, SHA-512 and
filesystem/cloud disclosure. Selection grants no authority. Confirmed install publishes disabled
after link/dependency/hook/bin/native rejection; trash-uninstall adopts once. Exact update retains
one offline rollback tree. Restart-safe pin blocks maintenance before effects; unpin restores
receipt-derived eligibility. IPC exposes no code/path/body. Enable/runtime/public restore stay open.

The Feishu recipe binds CLI/package/native, 27-Skill/444-file identities, hashes, destinations,
overwrite/link policy and environment before confirmation; opaque `npx` or later discovery fail.

## 11. v0.1 Scope

Include Settings URL/`.md`/`.zip` and explicit-chat HTTPS review; scoped lifecycle, safe files,
mediated External/Web effects and active-Skill selection.

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
