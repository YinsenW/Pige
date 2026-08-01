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

- Store secrets only in the machine-local Pige app-data credential file with local-user
  file permissions where supported; never use the OS keychain.
- Re-prove the credential root and bounded `secrets.json` as one owner-only, regular,
  single-link file before read, revision hashing, replacement, Provider use, or deletion;
  links, oversized files, identity drift, and malformed records fail closed.
- Treat the credential file as non-portable machine state, exclude it from backup/export,
  and disclose that another process running as the same OS user may read it.
- Secret scanning before memory persistence, diagnostics export, and support bundles.
- Keep Pige-owned stored credentials out of prompt content and construct authentication
  only in the reviewed Provider adapter. Do not rewrite user-authored submitted content.
- Exclude secrets from backups by default.

Acceptance:

- API keys do not appear in SQLite, Markdown, conversation logs, operation records, default backups, or normal diagnostics exports.
- A Settings-written synthetic key survives restart, reaches only the reviewed Provider
  authentication adapter, and becomes unusable after its Provider is deleted.

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

- v0.1 stages external/Web Skills from URL, Markdown, ZIP, or reviewed package source;
  enabling exposes only declared, service-enforced capabilities.

Threat: extension code exceeds scope, executes effects, or exfiltrates data/secrets.

Mitigations:

- Staging executes nothing. External code uses reviewed adapters/scoped handles, brokered
  writes, and one-action authorization; it inherits no first-party authority or raw secret.
- The first URL slice admits clean HTTPS into one bounded private
  expiring stage; redirect/content/digest/registry-CAS drift fails closed. Renderer receives
  safe metadata/digests/warnings, never staged bytes or paths.
- Public npm install binds SHA-512/same-origin redirects, rejects hooks, dependencies,
  links and executable/native input, and atomically publishes `installed_disabled` only.

Sensitive capabilities include out-of-scope filesystem/destruction, ambient network/shell,
install, protected policy, brokered credentials, sub-agents, and background work.
raw-secret read is never an extension capability. Shell defaults denied; bundled commands
use fixed argv/path/limits. Authorization shows safe actor/action/boundary and exact
Allow/Deny; identity drift re-prompts. Tests cover pre-network denial, package identity/
archive, cancellation, locking, recovery, and disabled-only publication.

### 6.6.1 Pi Capability And Filesystem Authority

Pi receives capability only through its turn catalog. Recoverable active-vault Markdown uses
confined writer/schema/evidence/base-hash/Operation authority. Attachments grant exact files
only. Explicit authored ambient tasks use exact confirmation or one immutable reviewed
plan; raw effects remain one-confirmation. Third-party actions require their adapter plus
closed high-risk gate. Permanent loss/protected policy never inherits standing authority,
and raw secret bytes are not grantable (reviewed adapters use refs only).

Standing Markdown authority comes from managed ownership, not `.md`. Attachments grant
only exact SourceRecords whose body tools resolve exact ingress/managed bytes, never live
original paths; fallback/model/source text cannot widen them. A separate explicit
user-authored task may request ambient scope under its precise confirmation/reviewed plan.
Main persists `authoredTaskIntent = neutral_attachment | explicit_user_task` from request
text presence before fallback; recovery reads it, and missing/legacy fails neutral. Main
executes only that same-Job bound effect; stale/invented calls fail pre-effect.

### 6.7 Arbitrary Shell Execution

Threat: tool or Skill runs dangerous commands.

For an explicit user-authored ambient task, `pige_run_command` remains `arbitrary_shell`, binds
executable/argv/cwd, uses `shell:false`, limits and process-tree cancellation, and is
confirmed per effect. Attachment presence alone and neutral fallback cannot register it.

### 6.7.1 Reviewed Task Execution Plans

Only registered recipes/adapters create immutable `TaskExecutionPlanSchema`. It binds
vault/Job/turn/policy/catalog/recipe/actor and each
ordinal's executable, argv, cwd, canonical sanitized environment/config hash, origins,
destinations, interaction, timeout, input, and recovery probe. Controlled HOME/config,
resolved descendant PATH identities, TMPDIR/locale, npm registry/prefix/cache/provenance,
agent roots, and secret-handle versions are explicit; drift fails before effect. Secret
bytes never enter hashes/projections.

One confirmation discloses tool/version/source/integrities, steps, OAuth, Skill count/
agents and destination roots. Allow yields an unforgeable same-Job
next-ordinal authority. Direct `shell:false` steps exclude shells, arbitrary stdin,
destruction, credential export, and unknown sources. Opaque `npx skills add` is forbidden:
the Feishu fixture freezes 27 Skill IDs/file digests, agents/destinations/link/conflicts,
and disables telemetry before Allow. Discovery drift fails pre-effect.

Registered read-only probes inherit explicit authored-task authority by metadata, never
command text. Attachments neither authorize nor forbid a plan: exact user intent does.
Main bounds streams/OAuth; IPC exposes safe origin/identity only. Feishu config streams;
login uses no-wait Device Flow with private `device_code` and exact brand accounts origin.
Restart adopts or fails without replacement; cancel kills the tree.

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
- DB cannot load extension code from source content or any unregistered package/path.

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

One explicit submit authorizes that turn's registered bounded first-party reads,
preservation, parse/OCR/retrieval, user-specified fetch, and local tools. Typed scope,
confinement, limits, cancellation, idempotency and projection are enforcement, not approval.
Third-party code never inherits this authority from text, source, model, naming, or mode.

Main classifies before policy; content cannot lower risk. Ordinary work does not prompt.
Ask, exact scoped grants, or YOLO authorize eligible sensitive effects and record one-action
Job/Operation decisions. Permanent loss, original overwrite, raw credentials, risky edits,
protected authority, OS/SSRF/signature/path safety stay confirmed or blocked. Durable
`waiting_permission` receipts recover decisions; effect owners retain CAS/recovery.

Connecting the exact Provider and pressing Send authorizes exact authored and selected
bounded context unchanged. Identity drift needs another action; credentials stay isolated
and whole-vault default, content policy, model-egress approval/UI/audit, and
`waiting_model_egress` remain absent. OS privacy, sandbox, signing, secret-store,
renderer/main, filesystem and prompt-injection controls remain independent.

## 8. Secret Storage Policy

- Provider credentials use Pige's non-portable machine-local app-data store; Pige never
  invokes an OS keychain.
- The file is restricted to the local OS user where supported and excluded from Vaults,
  logs, diagnostics, settings export, and default backups.
- Settings discloses that another process running as the same OS user may read it.
- Legacy keychain ciphertext remains inert and requires Provider reconnect.

## 9. BYOK Security Policy

Rules:

- Provider profiles store non-secret metadata in app settings.
- API keys live in secret store.
- Provider profiles cannot persist arbitrary authentication/default header maps. Reviewed provider adapters construct authentication headers from secret refs at call time; future custom non-secret headers require an explicit allowlist and separate secret references.
- Provider connection tests must use API keys only in the main process and must not echo keys, raw provider responses, or request headers to renderer, logs, diagnostics, prompts, operation records, or backups.
- Failed provider authentication or selected-model validation must not persist provider profiles, model profiles, or secret records.
- Ordinary content can be sent to configured BYOK provider after setup.
- Phase 3 basic Agent ingest sends bounded exact selected managed-source evidence to the
  configured Provider. It remains untrusted-wrapped; Host path, sidecar and credential
  metadata is structurally excluded. Pige persists only validated Markdown/operation
  summaries rather than raw prompts or raw Provider responses.
- Material selected Provider/model/endpoint identity drift requires a new explicit user
  action; payload size is governed only by structural bounds. No content-based modal,
  toggle, or confirmation is inserted.
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
- Prompt injection cannot alter tools/settings/reveal secrets; SSRF and ZIP traversal tests pass.
- Core/extension tools cannot bypass validation/Broker or access raw files/secrets.
  Ask/grants/YOLO preserve hard exclusions; content cannot create authority or enable YOLO.
  Only trusted Settings plus confirmation enables visible, revocable, audited Full Access.
- Ordinary work creates no prompt/grant; sensitive actions record one-action decisions.
- Source record or managed source asset delete requires confirmation.
- Public alpha requires Developer ID/hardened/notarized/stapled macOS and Authenticode
  Windows; unsigned/ad-hoc artifacts are internal-only.
- Default diagnostics export contains no source text or secrets.

## 12. Security Implementation Choices

These v0.1 design choices are accepted. Implementation still must pin concrete versions, add tests, and record platform-specific behavior.

- Secret storage: Pige writes API keys/tokens to schema-v2 machine-local app data with
  owner-only POSIX file mode where supported. Legacy schema-v1 keychain ciphertext stays
  inert and requires Provider reconnect; Pige never decrypts it or prompts for keychain access.
- Skill/package boundary: pure Skills are Markdown; executable packages use reviewed
  scoped adapters and inherit no first-party authority. Shell defaults denied; fixed bundled
  commands or declared exact high-risk effects retain preview, limits, cancellation and log.
- Update security: electron-updater `6.8.9` is Main-only, packaged-macOS-only and fixed to
  the GitHub alpha feed; metadata/checksum/Developer ID identity, monotonic version and
  notarized publication must agree before ready/apply. Renderer cannot provide a feed/path.
- Dependency vulnerability scanning: Dependabot, CodeQL, and npm audit are required CI/release gates.
- Capability manifests map package high risk to the closed vocabulary; ordinary
  first-party authority is not grantable.

Additional release/security gates:

- `SECURITY.md` exists and is linked from README and contribution docs before public alpha.
- Private vulnerability reporting is enabled or the fallback private-contact path is clearly documented.
- Public issues, commits, logs, prompts, diagnostics, and handoff notes must not contain exploit details, secrets, private paths, prompt text, source bodies, note bodies, model responses, or user vault data.
