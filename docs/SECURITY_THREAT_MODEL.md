# Security Threat Model

Status: Draft baseline
Date: 2026-07-09

## 1. Purpose

Pige is a local-first Agent desktop app that ingests untrusted content, calls cloud models selected by the user, runs local tools, and supports external Skills/packages.

This document defines:

- Assets to protect.
- Trust boundaries.
- Threats.
- Required mitigations.
- Permission and authorization model.
- Security acceptance gates.

## 2. Security Principles

1. Local-first does not mean risk-free.
2. User knowledge is more important than Agent autonomy.
3. Source content is untrusted data.
4. Skills and packages are untrusted until installed, and still permission-scoped after install.
5. Sensitive actions require clear user authorization.
6. Secrets must not leak into Markdown, logs, prompts, diagnostics, or backups.
7. Cloud model calls are allowed for ordinary BYOK processing, but must be visible and controllable.
8. Recovery beats silent failure.
9. Open extension capability must be matched by strong capability boundaries.

## 3. Assets

High-value assets:

- Source records and source assets, including managed copies and referenced originals.
- Markdown wiki/source pages.
- Conversation history.
- Agent memory.
- API keys and provider tokens.
- Vault config and `PIGE.md`.
- Settings profiles, permission defaults, provider profiles, and local capability settings.
- Confirmation proposals and operation records.
- Local model files.
- Installed Skills/packages.
- User filesystem outside the vault.
- Private network resources.

## 4. Trust Boundaries

Boundaries:

- Renderer UI to preload IPC.
- Preload IPC to main process.
- Main process to filesystem.
- Main process to database worker.
- Main process to parser/OCR/model workers.
- Main process to cloud model providers.
- Main process to external URLs.
- Main process to Skill/package runtime.
- Vault files to Agent prompts.
- Source text to tool planning.
- User approval dialog to sensitive operation execution.

Rules:

- Renderer never receives raw credentials.
- Renderer never gets unrestricted filesystem access.
- Renderer-displayed Markdown HTML must be produced by the trusted Markdown renderer and sanitized before display.
- Source content never becomes system instruction.
- Skill/package code never bypasses Pige services.
- Model responses never directly mutate durable files without Pige validation.
- Settings scopes, storage, and sensitive-change rules follow `docs/SETTINGS_AND_PREFERENCES.md`.

## 5. Threat Actors

Threat actors:

- Malicious web pages.
- Malicious PDFs, Office files, images, or archives.
- Prompt injection hidden inside source content.
- Malicious or careless Skills.
- Malicious or vulnerable Pi packages.
- Compromised cloud model endpoint.
- Network attacker during dependency/model download.
- Local malware or another local user account.
- Accidental user misconfiguration.
- Future sync conflict or replay issue.

## 6. Threats And Mitigations

### 6.1 Prompt Injection From Sources

Threat:

- A web page, PDF, pasted text, or image OCR result tells the Agent to reveal secrets, install tools, change settings, delete notes, or ignore instructions.

Mitigations:

- Wrap source content as untrusted evidence.
- Use strict tool policies outside the model.
- Source content cannot change model provider, filesystem paths, permissions, `PIGE.md`, package settings, or privacy rules.
- Source content cannot change Agent Runtime Policy Context; policy context is compiled from trusted settings and service state.
- Suspicious instructions inside sources may be surfaced as warnings.
- Agent plans are validated by services before execution.

Acceptance:

- A malicious source asking for API keys cannot access or print API keys.
- A malicious source asking to delete notes creates no delete action.

### 6.2 Secret Leakage

Threat:

- API keys enter Markdown, logs, prompts, screenshots, diagnostics, backups, or operation records.

Mitigations:

- Store secrets in OS keychain or encrypted local secret store by default.
- Plaintext portable mode is explicit, warned, and not default.
- Secret scanning before memory persistence, diagnostics export, and support bundles.
- Redact obvious secrets before model calls where feasible.
- Exclude secrets from backups by default.

Acceptance:

- API keys do not appear in SQLite, Markdown, conversation logs, operation records, default backups, or normal diagnostics exports.

### 6.3 Cloud Model Data Boundary Surprise

Threat:

- User assumes BYOK means local-only and is surprised when ordinary content is sent to a cloud provider.

Product decision:

- After the user configures BYOK, ordinary content may be sent to the configured provider for Agent processing.

Mitigations:

- Provider setup explains local/self-hosted/cloud boundary.
- Home composer, Home knowledge retrieval, and Note Agent show a visible cloud-send indicator.
- Large or private sources can require confirmation depending on provider settings.
- User can configure stricter confirmation behavior.
- Do not send full vault for retrieval.
- Context assembly and cloud-send boundaries follow `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`: selected snippets, citations, scoped memory, and compact refs only by default.

Acceptance:

- The user can tell when content is being sent to a cloud-hosted provider.

### 6.4 Web Fetch And SSRF

Threat:

- A pasted URL or Skill fetch tries to access local/private network resources, cloud metadata endpoints, router admin pages, or file URLs.

Mitigations:

- Block `file://`, local/private IP ranges, loopback, link-local, and cloud metadata IPs by default.
- Follow redirects only after revalidating final URL.
- Resolve and validate each target before connecting, then pin the production transport lookup to that approved address set so DNS cannot change between policy validation and socket connection.
- Limit redirects, declared body size, decompressed streamed body size, and the deadline across both response headers and body reads.
- Store fetched HTML as untrusted source.
- Do not execute scripts from fetched HTML.
- Parse HTML in a bounded worker with jsdom script execution and subresource loading disabled; do not render or persist Readability HTML as trusted UI.
- Bound worker input, element count, output text, image references, heap, timeout, and concurrency. A worker failure may use a reduced plain-text fallback but must remain visible in durable quality metadata.
- Reject embedded URL credentials.
- Redact sensitive query values before writing URLs to source records, Markdown pages, prompts, operation records, job summaries, diagnostics, conversations, or support bundles.
- Use extracted text artifacts, not raw HTML, as the default source-page and Agent-ingest input for URL captures.

Acceptance:

- Fetching `http://127.0.0.1`, private LAN IPs, and metadata endpoints is blocked unless a future advanced setting explicitly allows it.

### 6.5 Malicious Files

Threat:

- PDF, DOCX, PPTX, image, or ZIP exploits parser bugs or path traversal.

Mitigations:

- Treat documents as untrusted input.
- Prefer isolated parser workers/utility processes.
- Keep parser filesystem access scoped to input and artifact paths.
- The current PDF.js worker receives one preserved PDF path and byte/page limits, reads bytes locally, has PDF.js network/resource fetching disabled, and cannot write vault artifacts; validated results return to the main-process Parser Service for atomic writes.
- The separate PDF page-materializer worker receives only a verified source path, sorted candidate pages, and hard limits. It rejects symlinks; disables network fetch, range/stream/autofetch, XFA, annotations, system fonts, and WASM; caps source/page/pixel/PNG/aggregate output, heap, and time; and returns PNG bytes only. Main-process OCR services own all durable writes and reverify the source before final persistence.
- Because page rendering uses the native `@napi-rs/canvas` package in a Node worker thread, every supported installed package requires native-module startup, timeout/RSS recovery, malformed-PDF, and crash-soak evidence. The adapter boundary remains replaceable by a stronger utility-process/renderer implementation if release evidence shows worker-thread isolation is insufficient.
- PDF parser startup depends only on exact bundled `pdfjs-dist` and `@napi-rs/canvas` packages recorded in the dependency/toolchain manifests. Ordinary ingest never installs or repairs packages.
- The current Office worker receives one preserved DOCX/PPTX path and explicit byte/archive/XML/slide/text limits, cannot write vault artifacts, and depends only on exact bundled Mammoth, yauzl, and fast-xml-parser packages recorded in the manifests.
- OpenXML preflight rejects unsafe or overlong entry names, duplicate parts, encrypted/unsupported entries, invalid sizes, excessive counts, oversized expansion, suspicious compression ratios, oversized selected XML, missing required parts, and DOCTYPE declarations before semantic conversion. DOCX preflight covers every XML/relationship part Mammoth could reach, not only the main document.
- DOCX conversion disables embedded style maps and external file access. Mammoth HTML is treated as untrusted intermediate data, normalized to plain text/locators, and never rendered in the product UI.
- PPTX parsing disables entity processing and value coercion, validates XML with a nesting cap, resolves internal relationships relative to their owning package part, rejects traversal and duplicate IDs, and records but never opens external targets.
- Parser-owned provenance fields cannot be overwritten by adapter metadata. Checksummed source, sidecar, and text artifacts are verified before reuse and before Agent cloud handoff.
- Direct macOS image OCR runs in an app-owned native helper process, not the renderer or a shell. The helper receives one bounded schema-versioned stdin request, emits one bounded stdout response, has a reduced environment, performs no network access or downloads, and exposes no source path in argv or user-visible errors.
- Runtime verifies the helper as a regular executable against an adjacent architecture/version/size/SHA-256 manifest before declaring OCR ready. Public packaging must also sign the nested helper and verify it inside the signed application.
- ImageIO/UTType preflight validates true format, frame count, dimensions, pixel count, and bounded thumbnail decode before Vision. Direct-image OCR rejects path escape, symlink/non-file sources, changed checksums, multi-frame inputs, malformed images, unsafe dimensions, oversized files, protocol mismatch, timeout, and oversized/invalid output.
- Source integrity is checked before and after Vision execution. OCR text and geometry are validated at the TypeScript boundary; Operation Records and metadata sidecars do not duplicate the OCR body.
- Enforce size, file count, and path traversal checks for archives.
- Preserve the source record and available source asset even when parsing fails.
- Keep bundled parser tools updated through release process.

Acceptance:

- ZIP extraction cannot write outside staging.
- Parser failure cannot corrupt vault pages.
- A malformed image or helper failure cannot invoke shell/network behavior, overwrite the preserved source, escape the vault, or create Agent ingest from unvalidated text.

### 6.6 External Skill And Package Execution

Product decision:

- v0.1 supports external/Web Skills and permission-scoped execution, including Skills installed from URLs, Markdown files, ZIPs, and reviewed package sources.
- Pige should not pretend all extension execution is safe; it must make sensitive capability requests explicit and elegant.

Threat:

- Skill/package reads too much, writes outside scope, calls network, runs shell, changes settings, exfiltrates notes, or stores secrets.

Mitigations:

- All external Skills/packages are staged before enabling.
- Install-time code is not executed during staging.
- Runtime capabilities are declared and enforced by Pige services.
- Sensitive capabilities require a first-class authorization dialog.
- Permissions can be remembered narrowly, revoked, and inspected later.
- Package writes must go through Pige-approved write APIs or confirmation proposals.
- Skills/packages cannot directly access API keys. A reviewed adapter can request brokered credential use for one declared provider action, but never receives or returns raw credential bytes.
- Executable/package-backed Skills run only through reviewed runtime adapters in a dedicated worker, utility process, or child process with scoped source handles and Permission Broker decisions.
- Install preview/staging never executes Skill/package code, package hooks, shell commands, or network callbacks.

Sensitive capabilities:

- Read entire vault.
- Write vault files.
- Delete or move files.
- Access filesystem outside vault.
- Network access beyond current source fetch.
- Run shell commands.
- Install/update packages or local tools.
- Call cloud model with large/private content.
- Use a brokered credential for a declared provider action; raw-secret read is never an extension capability.
- Change `PIGE.md`, provider settings, privacy settings, or update settings.
- Spawn sub-agents or long-running background tasks.

Shell policy:

- Shell execution is denied by default.
- Pige-owned bundled tool commands may run only through the Local Tool Service with fixed argv construction, path validation, timeout, and output limits.
- Skill/package/user-requested shell commands require declared capability, human permission unless covered by explicit default mode, command preview, working-directory scope, and operation logging.
- Source content, model output, or package metadata cannot grant shell access.

Authorization dialog requirements:

- Clear title: action and actor.
- Short plain-language reason.
- Capability list with scope.
- Data boundary label: local, network, cloud, filesystem, secret, destructive.
- Buttons: Deny, Allow Once, Always Allow.
- Always Allow must be scoped and displayed clearly, such as only this URL, only this domain, only this file, only this folder, only this vault, only this Skill/package/tool version, or only this provider profile.
- Destructive actions use stronger copy and do not default to Allow.
- Dialog style should be calm, compact, and polished, similar in spirit to modern ChatGPT/Codex permission prompts.
- If the user enables YOLO Full Access in Settings, eligible Permission Broker prompts can be auto-allowed but must remain logged and visible; always-required change confirmation and stricter model-egress decisions still apply.

Acceptance:

- A Skill requesting shell, network, brokered credential use, delete, or settings permissions cannot proceed without Permission Broker authorization. Actions listed below as always-confirmed still require the separate current-action confirmation even when a broad default permission mode is enabled.
- Denying a permission leaves the app stable and records the denial in operation history.

### 6.7 Arbitrary Shell Execution

Threat:

- Tool or Skill runs dangerous shell commands.

Mitigations:

- Shell execution is disabled unless requested through a permissioned capability.
- Show command, working directory, environment boundary, and target files.
- Block known destructive patterns unless user explicitly escalates.
- Run with vault-scoped working directory where possible.
- Never pass secrets through environment unless explicitly required and approved.

Acceptance:

- The user sees a permission dialog before external Skill/package shell execution.

### 6.8 Destructive Writes

Threat:

- Agent or extension deletes or overwrites user files.

Mitigations:

- Archive/trash-first deletion.
- Explicit confirmation for managed source copy deletion, source record deletion, schema changes, destructive cleanup, and bulk edits.
- Atomic writes.
- External edit conflict detection.
- Confirmation proposals for risky edits.

Acceptance:

- External edits are not overwritten silently.

### 6.9 Local Database Exposure

Threat:

- SQLite contains duplicated snippets and metadata that expose sensitive content.

Mitigations:

- Treat DB as user data.
- Keep secrets out of DB.
- Exclude DB from backups by default.
- Allow Reset Local Database.
- Do not load arbitrary SQLite extensions.

Acceptance:

- Deleting DB does not delete knowledge.
- DB cannot load extension code from packages or source content.

### 6.10 Update Supply Chain

Threat:

- Malicious update, compromised release artifact, tampered binary, or vulnerable bundled tool.

Mitigations:

- Signed macOS and Windows release artifacts for public distribution.
- GitHub Actions release workflow with protected tags.
- Checksums for release artifacts.
- Notarization on macOS.
- Windows signing when available for v0.1 distribution.
- Dependency registry updates before dependency upgrades.
- License and security review for bundled binaries.

Acceptance:

- App verifies update metadata and does not install unsigned or unexpected-channel updates.

## 7. Permission Model

Permission scopes:

- `once`.
- `actor_version`.
- `resource_scope`.
- `profile_default`.
- `never`.

`provider_profile` is a resource scope, not a decision-duration scope. The executable decision-record matrix is owned by `PermissionDecisionRecordSchema` and summarized in `docs/TECH_ARCHITECTURE.md`: denials use `never`; one-action authorization uses `once`; reusable human grants use `actor_version`, `resource_scope`, or `profile_default`; saved-grant/YOLO auto-allows are system-authored one-action records and cannot mint another persistent grant.

Default permission modes:

- Ask Every Time: prompt for every sensitive action unless an explicit saved grant exists.
- Remember Scoped Grants: prompt once and allow the user to save scoped permanent grants for a Skill, package, tool, Agent, resource, or provider profile.
- YOLO Full Access: auto-allow eligible declared Agent, Skill, package, local-tool, network, shell, filesystem, and ordinary model-call capabilities until disabled. It never exposes raw secrets and does not replace always-required change or data-egress confirmation.

Authorization and confirmation are separate gates:

- Permission Broker answers whether an actor may exercise a declared capability on a scoped resource. Ask Every Time, remembered grants, and eligible YOLO auto-allows operate at this layer.
- Change Proposal or explicit action confirmation answers whether the human intended a particular high-impact state change. It is required for durable destructive deletion, trash bypass, restore apply, migration apply, vault/root relocation, enabling or disabling YOLO, secret export, provider/privacy/cloud-boundary changes, and other settings marked always-confirmed.
- Model Egress Decision answers whether the exact selected payload may cross the configured provider boundary. A `confirm` or `block` result is not weakened by YOLO or a broader capability grant.
- An action proceeds only when every applicable gate passes. A Permission Broker allow is not evidence of destructive intent, and a confirmation is not a reusable capability grant.

Useful "only this" scopes:

- Only this action.
- Only this URL.
- Only this domain.
- Only this source.
- Only this note.
- Only this file.
- Only this folder.
- Only this vault.
- Only this Skill/package/tool version.
- Only this provider profile.

YOLO Full Access rules:

- Must be off by default.
- Must require an explicit Settings action and a strong warning.
- Must show a persistent visible status indicator while enabled.
- Must be revocable immediately.
- Must still record permission decisions, operation records, command previews where available, affected paths, and data boundaries.
- Must not bypass OS-level privacy prompts, app sandbox restrictions, update signature checks, malware protections, or filesystem errors.
- Cannot be enabled by source content, prompt injection, a Skill, package, local tool, or model output.
- Must not satisfy an always-required change confirmation or a stricter Model Egress Decision.
- Must never reveal raw secret bytes to an Agent, Skill, package, local tool, renderer, log, diagnostic, operation record, or model prompt.
- Desktop-local YOLO or saved grants do not automatically grant future Pige Cloud, self-hosted backend, personal desktop backend, Web client, or mobile client capabilities; those execution locations require separate explicit user choices.

Permission dimensions:

- Actor: Agent, Skill, package, local tool, model provider.
- Capability.
- Resource scope.
- Data boundary.
- Duration.
- Reason.
- User decision.

Permission records:

- Stored machine-local by default.
- Exportable only through settings.
- Do not contain secrets.
- Include version and checksum of Skill/package when applicable.
- Distinguish `permission_broker`, `change_confirmation`, and `model_egress` decisions so audit records cannot imply that one layer approved another.

## 8. Secret Storage Policy

Default:

- Use OS keychain or encrypted local storage.

Optional:

- Plaintext local storage only in explicit portable/developer mode.
- Requires warning at enable time.
- Excluded from backups unless explicitly exported.
- UI must show that plaintext mode weakens local security.

Rationale:

- A serious desktop app should default to encrypted secrets.
- Some users may still prefer portability or local-only simplicity, so plaintext can exist as an explicit advanced choice.

## 9. BYOK Security Policy

Rules:

- Provider profiles store non-secret metadata in app settings.
- API keys live in secret store.
- Provider profiles cannot persist arbitrary authentication/default header maps. Reviewed provider adapters construct authentication headers from secret refs at call time; future custom non-secret headers require an explicit allowlist and separate secret references.
- Provider connection tests must use API keys only in the main process and must not echo keys, raw provider responses, or request headers to renderer, logs, diagnostics, prompts, operation records, or backups.
- Failed provider authentication or selected-model validation must not persist provider profiles, model profiles, or secret records.
- Ordinary content can be sent to configured BYOK provider after setup.
- Phase 3 basic Agent ingest sends only bounded, redacted managed-source previews to the configured provider, wraps the source as untrusted data, and persists only validated Markdown/operation summaries rather than raw prompts or raw provider responses.
- Large/private source confirmation is configurable and recommended.
- Model call logs store metadata and summaries, not full prompts/responses by default.
- Pi Agent, Pi tools, and Pi extensions must be mediated through Pige-owned adapters and Permission Broker rules from `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`.
- Local-only processing mode can be added later.

## 10. Diagnostics And Support

Detailed diagnostics, support bundle, redaction, and telemetry rules are defined in `docs/DIAGNOSTICS_AND_OBSERVABILITY.md`.

Default diagnostics exclude:

- API keys.
- Source asset content.
- Full note content.
- Full memory content.
- Full conversation content.
- Full prompts/responses.

Support bundle:

- User-initiated only.
- Redacted by default.
- Shows preview before export.

## 11. Security Acceptance Gates

Before v0.1 public alpha:

- Secret storage works on supported macOS and Windows versions.
- Prompt injection fixtures cannot change tools/settings or reveal secrets.
- SSRF/private-network URL tests are blocked.
- ZIP path traversal is blocked.
- External Skill permission prompts work for shell, network, write, delete, model, and brokered-credential capabilities; raw-secret access is rejected rather than prompted.
- Pi built-in tools and extensions cannot bypass Permission Broker or access raw vault files/secrets directly.
- Permission prompts support Deny, Allow Once, and Always Allow.
- Default permission modes are enforced consistently.
- YOLO Full Access suppresses covered prompts only after explicit user opt-in, remains visible, and records auto-allowed actions.
- Denied permissions are respected.
- Source record or managed source asset delete requires confirmation.
- Update artifacts are signed or clearly marked as unsigned alpha artifacts.
- Default diagnostics export contains no source text or secrets.

## 12. Security Implementation Choices

These v0.1 design choices are accepted. Implementation still must pin concrete versions, add tests, and record platform-specific behavior.

- Secret storage: Electron `safeStorage` encrypts API keys/tokens into machine-local app data. If encryption is unavailable, normal mode refuses to save secrets and offers explicit plaintext portable/developer mode with warning.
- Skill/package runtime boundary: pure Skills are Markdown-only. Executable/package-backed Skills run only through reviewed adapters in worker/utility/child processes with scoped handles and Permission Broker mediation.
- Shell policy: default deny. Pige-owned bundled tools use fixed argv and scoped working directories. Skill/package shell use requires declared capability, command preview, permission, timeout, output limits, and logging.
- Update security: electron-builder/electron-updater with GitHub Releases alpha feed, protected tags, channel checks, version monotonicity checks, checksums, and signed/notarized artifacts when public.
- Dependency vulnerability scanning: Dependabot, CodeQL, and npm audit are required CI/release gates.
- Package permission manifest: v0.1 uses Skill frontmatter for pure Skills and a JSON capability manifest for package-backed capabilities. Both map to the same Permission Broker capability vocabulary.

Additional release/security gates:

- `SECURITY.md` exists and is linked from README and contribution docs before public alpha.
- Private vulnerability reporting is enabled or the fallback private-contact path is clearly documented.
- Public issues, commits, logs, prompts, diagnostics, and handoff notes must not contain exploit details, secrets, private paths, prompt text, source bodies, note bodies, model responses, or user vault data.
