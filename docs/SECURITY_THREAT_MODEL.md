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
2. Agent autonomy grows user knowledge through recoverable, inspectable operations.
3. Source content is untrusted data.
4. Skills and packages are untrusted until installed, and still permission-scoped after install.
5. Capability availability is not authority. New scope, irreversible effects, and narrow sensitive boundaries require authorization.
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
- Keep Pige-owned stored credentials out of prompt content and construct authentication
  only in the reviewed Provider adapter. Do not rewrite user-authored submitted content.
- Exclude secrets from backups by default.

Acceptance:

- API keys do not appear in SQLite, Markdown, conversation logs, operation records, default backups, or normal diagnostics exports.

### 6.3 Cloud Model Data Boundary Surprise

Threat:

- User assumes BYOK means local-only and is surprised when ordinary content is sent to a cloud provider.

Product decision:

- Connecting and selecting a Provider Profile is the standing authorization for
  ordinary, private, and larger bounded Agent calls to that exact destination.

Mitigations:

- Explain the boundary once; routine Home and Agent calls show non-blocking cloud status.
- Exact endpoint/Profile drift requires a new explicit user action. A
  cloud/local label alone never causes per-call prompts.
- Provider trust grants no tool, setting, extension, filesystem, or destructive authority.
- Do not send full vault for retrieval.
- Context assembly and cloud-send boundaries follow `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`: selected snippets, citations, scoped memory, and compact refs only by default.

Acceptance:

- The user can tell when content is being sent to a cloud-hosted provider.

### 6.4 Web Fetch And SSRF

Threat:

- An untrusted URL attempts private-network or file access.

Mitigations:

- Allow credential-free HTTP(S); exact `external_network` authority admits private targets,
  otherwise localhost, private/LAN, link-local, metadata, and reserved space block.
- Canonicalize hostnames for policy (lowercase, no trailing root dots). `public_only` Fake-IP
  requires target and fresh `example.com` probe to each have `198.18/15` IPv4 and only that
  class/mapped forms. Recheck every blocked target/redirect; pin target IPv4 only. Literal,
  mixed, IPv6-only, unconfirmed, and private targets block.
- Resolve/pin every hop; bound redirects, sizes and deadline; redact sensitive queries.
- Keep HTML and `text/markdown` inert; disable scripts/subresources and pass text to Pi.

Acceptance:

- Private authority and strict Fake-IP compatibility retain all other fetch controls.

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
- The current Office worker receives one preserved DOCX/PPTX path and explicit byte/archive/XML/slide/text/media limits, cannot write vault artifacts, and depends only on exact bundled Mammoth, yauzl, and fast-xml-parser packages recorded in the manifests.
- OpenXML preflight rejects unsafe or overlong entry names, duplicate parts, encrypted/unsupported entries, invalid sizes, excessive counts, oversized expansion, suspicious compression ratios, oversized selected XML, missing required parts, and DOCTYPE declarations before semantic conversion. DOCX preflight covers every XML/relationship part Mammoth could reach, not only the main document.
- DOCX conversion disables embedded style maps and external file access. Mammoth HTML is treated as untrusted intermediate data, normalized to plain text/locators, and never rendered in the product UI.
- PPTX parsing disables entity processing and value coercion, validates XML with a nesting cap, resolves internal relationships relative to their owning package part, rejects traversal and duplicate IDs, and records but never opens external targets.
- CSV/XLSX/database adapters treat names, cells, formulas, comments, schemas, and metadata
  as untrusted data. They never execute workbook macros/formulas, external links, database
  extensions, triggers, user code, or model-authored SQL. Database snapshots open
  read-only through descriptor-bound copies; Dataset queries use typed bounded plans.
- Dataset payloads and manifests are confined below the active vault, revision/hash-bound,
  and inaccessible to renderer/model code as file handles. Analytical engines run with
  networking and extension loading disabled and cannot attach arbitrary paths.
- Parser-owned provenance fields cannot be overwritten by adapter metadata. Checksummed source, sidecar, and text artifacts are verified before reuse and before Agent cloud handoff.
- macOS OCR uses a verified app-owned, reduced/no-network helper with bounded protocol,
  no renderer/shell/path exposure, adjacent binary manifest and nested package signing.
- `pige-speech` is sender-bound bounded NDJSON; malformed framing/UTF-8/size/sequence/
  identity fails body-free. Audio never crosses preload or enters storage/diagnostics/
  models; explicit start alone requests permission and fixed Settings is the recovery.
  Probes never install; explicit exact-language `AssetInventory` emits only monotonic safe
  events, and teardown detaches without claiming cancellation of Apple-owned work.
- ImageIO/UTType and source revalidation fence format/frame/dimension/pixel/decode/path/
  symlink/checksum/protocol/time/output limits around Vision. TypeScript validates text/
  geometry; Operations and metadata never duplicate the OCR body.
- Enforce size, file count, and path traversal checks for archives.
- Preserve the source record and available source asset even when parsing fails.
- Keep bundled parser tools updated through release process.

Acceptance:

- ZIP extraction cannot write outside staging.
- Parser failure cannot corrupt vault pages.
- A malformed image or helper failure cannot invoke shell/network behavior, overwrite the preserved source, escape the vault, or create Agent ingest from unvalidated text.
- A hostile CSV/workbook/database cannot execute code, load an extension or external
  resource, mutate the original, escape its Dataset Bundle, or bypass query/result limits.

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
- Authorization is allow or deny for the exact current third-party action. It is not a
  saved grant, does not persist across actions, and cannot become a global mode.
- Package writes use brokered Pige APIs; core tools are separate.
- Skills/packages cannot directly access API keys. A reviewed adapter can request brokered credential use for one declared provider action, but never receives or returns raw credential bytes.
- Executable/package-backed Skills run only through reviewed runtime adapters in a
  dedicated worker, utility process, or child process with scoped handles; they do not
  inherit first-party submitted-turn authority.
- Install preview/staging never executes Skill/package code, package hooks, shell commands, or network callbacks.
- Exact public npm package install requires current-action `install_package`, SHA-512,
  pinned same-origin redirects, bounded link-free extraction, and rejects unsafe paths,
  hooks, dependencies and executable/native input. PID-aware locking and immutable
  `installed_disabled` publication grant no runtime authority.

Sensitive capabilities:

- Any Pi Agent filesystem/path/commit action outside standing active-vault knowledge
  Markdown authority or the exact source selected by the user for the current Job.
- Read entire vault.
- Write vault files.
- Delete or move files.
- Access filesystem outside vault.
- Network access beyond current source fetch.
- Run shell commands.
- Install/update packages or local tools.
- Skill/package model use or egress requiring a sensitive, unknown-boundary, or stricter-policy decision.
- Use a brokered credential for a declared provider action; raw-secret read is never an extension capability.
- Change `PIGE.md`, provider settings, privacy settings, or update settings.
- Spawn sub-agents or long-running background tasks.

Shell policy:

- Shell execution is denied by default.
- Pige-owned bundled tool commands may run only through the Local Tool Service with fixed argv construction, path validation, timeout, and output limits.
- Pige's first-party command capability is standing product capability. A submitted user
  task authorizes its ordinary desktop-local command, network, filesystem, and package
  effects once and records one audit without another prompt. Third-party actors and
  destructive, credential, or changed-boundary effects still require their own authority.
- Source content, model output, or package metadata cannot grant shell access.

Authorization dialog requirements:

- Clear title: action and actor.
- Short plain-language reason.
- Capability list with scope.
- Data boundary label: local, network, cloud, filesystem, secret, destructive.
- Buttons: Deny and Allow This Action.
- The authorization binds the exact Skill/package identity, version, capability, and
  current scope only; another action or changed identity requires a new decision.
- Destructive actions use stronger copy and do not default to Allow.
- Dialog style should be calm, compact, and polished, similar in spirit to modern ChatGPT/Codex permission prompts.
- No global mode can let third-party code inherit first-party turn authority or bypass a
  closed-list high-risk confirmation.

Acceptance:

- An Agent, Skill, or package requesting non-default shell, filesystem, network,
  brokered credential use, delete, commit, or settings authority cannot proceed without
  their reviewed third-party capability boundary. Closed-list high-risk effects retain
  their stronger exact confirmation.
- Package-install tests prove deny-before-network and fail-closed identity, integrity,
  archive, cancellation, locking, recovery and disabled-only behavior.
- Denying a permission leaves the app stable and records the denial in operation history.

### 6.6.1 Pi Capability And Filesystem Authority

Pi may be offered arbitrary path, filesystem, command, and commit capabilities, but the
catalog is not blanket authority. The governing matrix is:

| Requested action | Default authority | Gate |
| --- | --- | --- |
| Schema-valid recoverable knowledge Markdown inside the active vault | Standing Pige authority; no prompt | Confined writer, schema/evidence/base hash, Operation/Undo |
| Read/preserve the exact drop/file-picker source for this Job | Current user gesture; no duplicate prompt | Source/path validation |
| First-party path/file/folder/repository/command/package action requested by the current user task | Current task authority; no duplicate prompt | Exact executable/resource binding, bounded execution, one-use audit |
| Third-party path/file/folder/repository/command/commit action | Available, not pre-authorized | Reviewed adapter/capability boundary plus exact high-risk confirmation where the effect qualifies |
| Permanent deletion, source-original overwrite, protected policy/settings, other always-confirmed effect | Never covered by ordinary standing/grant authority | Strong current-action confirmation |
| Raw secret bytes | Not grantable | Block; reviewed adapters may use secret refs only |

Standing Markdown authority is defined by managed root and semantic owner, not `.md`
suffix; external Markdown and user-owned originals remain outside it. Main executes only
the bound approved action and returns a bounded result to the same Job. Source/model/tool
text cannot approve itself.

Current-action authority is exact and one-use. Production ships only bounded no-follow
folder/text reads and SSRF-safe fetch. The create-only foundation remains unregistered:
it binds parent/leaf/resource/tool/content, rechecks authority, and records receipts/completion.
Unknown effects remain uncertain; no-follow parent handles remain required.

### 6.7 Arbitrary Shell Execution

Threat: tool or Skill runs dangerous commands.

Pige exposes a first-party OS command adapter with exact executable identity, argv/cwd,
`shell:false` spawning, a reduced environment, bounded output/time, cancellation, and
process-tree termination. Shell syntax remains available by explicitly choosing a shell
executable; it is not silently interpolated by the Host. The current user task is the
single ordinary-action authority. Third-party code cannot inherit that identity, source
or model text cannot self-authorize, and destructive or credential effects remain
separate boundaries.

### 6.8 Destructive Writes

Threat:

- Agent or extension deletes or overwrites user files.

Mitigations:

- Active-vault validated recoverable knowledge-Markdown writes run autonomously with Operations.
- Confirm permanent/trash-bypass/source-original loss and non-recoverable bulk,
  schema, restore, or migration effects.
- Atomic writes.
- External edit conflict detection.
- Proposals only when recovery/merge cannot avoid an exceptional boundary.

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
- Exact protected alpha tag plus `production-release`; no manual authority.
- Commit-pinned setup before secrets; Developer ID/hardened/notarized/stapled macOS arm64
  and Authenticode Windows x64.
- Exact alpha metadata and identity-bound SHA-256/SHA-512 manifests, independently verified
  from downloaded bytes before publisher revalidation.
- Dependency registry updates before dependency upgrades.
- License and security review for bundled binaries.

Acceptance:

- Missing authority, identity, credentials, expected metadata/file set, checksums, platform
  trust or independent proof blocks publication; the app rejects unsigned/wrong-channel updates.

## 7. Submitted-Turn Authority And High-Risk Confirmation

Pige has one simple authority model:

- An explicit user submit authorizes that Pi turn to use registered first-party bounded
  reads, preservation, parsing, OCR, retrieval, user-specified fetch, and local tools.
- Each tool still enforces typed input, scope, path confinement, byte/time/resource
  limits, cancellation, idempotency, and safe projection. Those checks are not user
  approvals and do not create request/decision/consume/completion records.
- Unreviewed third-party Skills/packages cannot inherit first-party authority through
  prompt text, source content, model output, naming, or a global mode.

User confirmation is reserved for a closed high-risk boundary:

- irreversible deletion or bypass of trash/recovery;
- overwrite of a user-owned original;
- write outside an already authorized directory;
- arbitrary shell execution or installation of an unknown/unreviewed package;
- credential or secret export/display;
- risky Agent edits already covered by the proposal/Operation contract; or
- a changed destination or equivalent authority/security escalation.

The decision is allow or deny for that concrete effect. The effect's owning Job/Operation
handles CAS, idempotency, cancellation, commit, and recovery; a second durable permission
state machine does not. Pige has no Ask-Every-Time, saved-grant, or YOLO mode for ordinary
Agent work, and new Jobs cannot enter `waiting_permission`.

Cloud Provider calls are a separate simple boundary. Connecting/selecting the exact
Provider and pressing Send authorizes that turn's exact user-authored and explicitly
selected bounded context. Host code does not classify, redact, rewrite, or block that
payload. Provider identity drift requires a new explicit user action; the whole vault is
never sent by default, and stored Provider credentials remain isolated in the secret
store/authentication layer. There is no model-egress approval, audit decision, renderer
action, content-class indicator, or `waiting_model_egress` Job.

OS privacy prompts, sandboxing, update signatures, malware protection, filesystem errors,
secret-store isolation, renderer/main isolation, and source prompt-injection defenses
remain independent hard boundaries.

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
- Private/large confirmation is an optional stricter user policy, not the default.
- Model call logs store metadata and summaries, not full prompts/responses by default.
- Pige-owned Pi tools use service enforcement and Broker mediation when their exact
  action is outside standing/gesture authority; extensions do the same.
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
- SSRF tests cover default denial, exact-authorized private access, and retained fetch controls.
- ZIP path traversal is blocked.
- Agent/external Skill permission prompts work for non-default shell, filesystem, commit,
  network, write, delete, model, and brokered-credential capabilities; raw-secret access
  is rejected rather than prompted.
- Core Pi tools cannot bypass validation; extensions cannot bypass Broker or access raw files/secrets.
- Third-party permission prompts support Deny and Allow This Action only; no persistent
  grant or global YOLO authority exists.
- Ordinary first-party work produces no per-tool prompt or permission record.
- High-risk classification cannot be bypassed by source, model, Skill, package, or UI drift.
- Denied permissions are respected.
- Source record or managed source asset delete requires confirmation.
- Public alpha requires Developer ID/hardened/notarized/stapled macOS and Authenticode
  Windows; unsigned/ad-hoc artifacts are internal-only.
- Default diagnostics export contains no source text or secrets.

## 12. Security Implementation Choices

These v0.1 design choices are accepted. Implementation still must pin concrete versions, add tests, and record platform-specific behavior.

- Secret storage: Electron `safeStorage` encrypts API keys/tokens into machine-local app data. If encryption is unavailable, normal mode refuses to save secrets and offers explicit plaintext portable/developer mode with warning.
- Skill/package runtime boundary: pure Skills are Markdown-only. Executable/package-backed Skills run only through reviewed adapters in worker/utility/child processes with scoped handles and cannot inherit first-party submitted-turn authority.
- Shell policy: default deny. Pige-owned bundled tools use fixed argv and scoped working directories. Skill/package shell use requires declared capability, command preview, permission, timeout, output limits, and logging.
- Update security: electron-builder/electron-updater with GitHub alpha feed, protected exact
  identity/environment, channel/monotonicity, signed platforms, immutable metadata/checksums,
  and independent downloaded-byte verification before publication.
- Dependency vulnerability scanning: Dependabot, CodeQL, and npm audit are required CI/release gates.
- Package capability manifest: v0.1 uses Skill frontmatter for pure Skills and a JSON
  capability manifest for package-backed capabilities. High-risk effects map to the
  closed confirmation vocabulary; ordinary first-party authority is not grantable.

Additional release/security gates:

- `SECURITY.md` exists and is linked from README and contribution docs before public alpha.
- Private vulnerability reporting is enabled or the fallback private-contact path is clearly documented.
- Public issues, commits, logs, prompts, diagnostics, and handoff notes must not contain exploit details, secrets, private paths, prompt text, source bodies, note bodies, model responses, or user vault data.
