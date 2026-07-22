# Pi Agent And Model Provider Integration

Status: Draft baseline
Date: 2026-07-09
Last reviewed: 2026-07-16

## 1. Purpose

This document defines how Pige integrates Pi Agent, Pi model/provider configuration, and BYOK language model providers.

Pige's product goal is simple:

> The user connects one model service that Pi Agent can call. Pige handles the rest.

Pi Agent is the mandatory v0.1 core and decision center. Ordinary conversation, local
knowledge use, source tools, publication, and review must share its spine. Current paths
remain partial and do not yet prove unified ingress or complete Provider-to-Home use.

Adopt, do not imitate: where Pi exposes a supported generic runtime surface,
Pige integrates it through a thin adapter instead of copying, forking, or
maintaining a parallel Agent runtime. Pige still owns product policy and data.

## 2. Upstream Facts Verified

Reviewed upstream snapshot: `v0.80.7`
(`818d67457cdd6b60bce6b121d16b23141c252dd8`) on 2026-07-16. The reviewed
`v0.80.6`→`v0.80.7` source diff is
`e8442dda88e28e116b1d6fdd18973c5c7f787929a90f1f6cabb7de56fa6fba77`.

`@earendil-works/pi-ai` is the official provider/model package inside the same Pi
monorepo, not a second Agent framework. Pige does not add Vercel AI SDK or another
parallel provider runtime.

- `pi-agent-core` owns Agent mechanics; the side-effect-free `pi-ai` root provides
  isolated `Models`, provider factories, injected auth, and streaming.
- In `v0.80.7`, both official `pi-agent-core` entries still load `pi-ai/compat`;
  that import registers APIs and constructs the broad catalog. No official
  compat-free Agent subpath exists.
- Supplying an explicit receiver-bound `streamFn` avoids using the compat dispatcher,
  but does not remove its import-time global registry/catalog side effects.
- Pi is not a sandbox and does not enforce Pige permissions.

References are listed in section 17.

## 3. Product Boundary

Pige is not a Pi terminal UI wrapper.

Pi owns the generic machinery: Agent state and turn loop, lifecycle/event ordering,
tool argument validation and execution lifecycle, abort/continue, steering and
follow-up queues, compatible context/compaction helpers, and provider streaming,
usage, retry, overflow, and normalized errors. Pige must not rebuild these in
parallel when a reviewed public Pi surface covers them.

Pige owns UI; profiles/secrets; evidence, prompts, citations and validation; typed tools,
high-risk authority boundaries; and durable product records. It does not own a second
semantic loop or a second approval workflow for ordinary turn activity.

Every Home or note submission immediately creates one durable Pi-owned Agent Job through
the same embedded entry. Source preservation is the first checkpoint of a source-bearing
Job, not a Host semantic pipeline; pure questions enter Pi directly. Pi may answer
without tools or select, repeat, and replan scoped tools. Pige owns evidence integrity,
policy, provider/secret boundary, provenance, validation, and commits—not the semantic route
or the number of corrective model turns needed to reach a valid result.

“Complete Pi integration” means the relevant generic `pi-agent-core` and `pi-ai`
SDK surfaces. It does not mean packaging Pi's coding-agent product, TUI, CLI/RPC,
experimental orchestrator, global configuration, or unrestricted coding tools.

The default UI does not expose Pi's model picker, session tree, global extension
directories/config, full provider catalog, CLI flags, or unrestricted coding tools.

## 4. Integration Modes

Pige uses only the embedded SDK. Pi RPC/CLI/binaries and
`@earendil-works/pi-orchestrator` are manual references, never Pige runtime,
dependencies, packages, or acceptance evidence.

Rules:

- Renderer never talks to Pi directly.
- One main-process or worker-owned anti-corruption adapter is the only Pige module
  allowed to import Pi; Agent Orchestrator owns its lifecycle.
- Pi receives no ambient Node, filesystem, shell, or credential handle. Registered
  first-party ordinary tools inherit the submitted turn; exceptional high-risk effects
  use the narrow confirmation boundary.
- Every Agent receives an explicit receiver-safe wrapper around its isolated
  `Models.streamSimple`; Pige code never calls `/compat`, `providers/all`, global
  registries/config, or the default compat dispatcher.
- Pige stores its own job, conversation, proposal, operation, memory, and diagnostics records.
- Pi session files are not Pige's durable source of truth.
- Do not deep-import, alias, patch, vendor, or fork Pi, and do not preserve the
  transitional direct provider bridge as a silent fallback after Pi adoption.

Checkpoint A adopts exact `v0.80.7`: one isolated, scoped, receiver-bound adapter; no
ambient auth, compat dispatch, deep import/fork, or copied loop. H1 reduces it
1,398→250 LOC (480 custom-control LOC), preserves native results and Pi follow-up/read
concurrency, and makes responsibility/import/Electron gates reject shadow ownership.

## 5. Package Boundary

Expected package roles:

| Package | Pige use | Product boundary |
| --- | --- | --- |
| `@earendil-works/pi-agent-core` | Upstream Agent loop, events, queues, and tool lifecycle. | Thin adapter; no Pige parallel loop. |
| `@earendil-works/pi-ai` | Isolated model/provider invocation and streaming. | Selected binding only; Pige owns auth and egress. |
| `@earendil-works/pi-coding-agent` | Source reference only. | Never packaged or user-facing. |
| Pi extension APIs | Future reference for Pige Skills/packages. | Not trusted by default; must pass Pige capability review. |

Each Job receives isolated `Models` and Agent instances containing only its reviewed
binding and Pige auth adapters. Ambient credentials, endpoints, and routing are forbidden.

Adoption pins both generic packages to the same exact version and integrity in one
lock graph. Every Pi `0.x` update is a compatibility change: review release/API and
import-graph diffs, then rerun faux-provider, selected-binding, event/tool order,
validation, abort/continue, queue/context/compaction, ambient-authority, and packaged
Electron macOS/Windows tests. Updates are repository changes, never runtime auto-updates;
both pins advance or roll back together. The bundle supplies the root MIT license text,
SBOM, and notices when npm tarballs omit them.

## 6. Provider Profile Model

Pige-owned provider profiles are machine-local. The executable schema owns current
fields; this owner defines protocol, boundary, migration, and secret-reference meaning.

```ts
type ProviderProfile = {
  id: string; presetId?: string; displayName: string; providerKind: ProviderKind;
  endpointProtocol: "openai_responses" | "openai_chat_completions" | "anthropic_messages";
  baseUrl?: string; authRequirement: "api_key" | "optional_api_key" | "none";
  authSecretRef?: string; modelListStrategy: ModelListStrategy;
  cloudBoundary: CloudBoundary; boundaryVerification?: BoundaryVerification;
};
```

Rules:

- Presets own reviewed kind/protocol/Endpoint/auth/discovery/bootstrap metadata; only
  Custom asks protocol, Base URL, and credentials. `endpointProtocol` dispatches calls.
- Keys are secret-store-only; required/optional/none auth controls references. `none` uses
  an in-memory sentinel stripped before headers. Profiles stay out of backup.
- Schema rejects missing or non-`builtin_verified` boundary metadata and requires canonical
  HTTPS or loopback HTTP without userinfo/query/fragment. Taxonomy stays internal.
- Connect authorizes one Profile/Endpoint; every failure returns typed repair, not success.
- Credential replacement and Provider deletion are revision-fenced, confirmed, and block
  active Agent/egress references. Replacement probes before atomic same-ref commit and
  preserves the old key on failure; deletion removes owned models/secret, rebinds or
  clears default, and journal-recovers without orphan state. Secrets never return.

`ProviderProfileSchema` in `packages/schemas/src/index.ts` is the executable profile contract. Built-ins use their fixed built-in endpoints, do not persist `baseUrl`; `ProviderBaseUrlSchema` is the single persisted and runtime-call URL contract and rejects both directions of a mismatch. Profiles cannot persist arbitrary `defaultHeaders`. Authentication, network, timeout, invalid payload, and official-provider list failures remain failures and return typed repair.

## 7. Model Profile Model

Pige-owned model profiles are machine-local and associated with one provider. Their
executable fields live in `ModelProfileSchema`; this owner defines runtime meaning.

```ts
type ModelProfile = {
  id: string; providerProfileId: string; modelId: string;
  displayName?: string; source: "provider_list" | "manual"; enabled: boolean;
  supportsTools?: boolean; supportsVision?: boolean;
};
```

Rules:

- One `(providerProfileId, modelId)` inventory merges discovery/manual records and preserves
  alias/enabled/default. Refresh retains missing IDs disabled; failure preserves inventory.
- First Connect enables its validated bootstrap model and sets it as Global Default only
  when none exists. Default selects an enabled model across Providers; disabling it needs
  an atomic replacement, and unusable bindings stay visible without auto-switch/free text.
- Connect discovers non-durably, probes a bootstrap ID, then readback-commits or restores.
  Sequencing drops stale outcomes; post-commit refresh cannot repeat provider effects.
- Pi AI remains the provider runtime; Pige neither copies its catalog nor adds a parallel SDK.
- An exact reviewed preset/model may overlay Pi's matching public model metadata when
  protocol mechanics require it, while retaining the Pige Profile ID, endpoint, model ID,
  and scoped credential adapter. Unknown and Custom models keep the conservative explicit
  protocol fallback; an upstream catalog match never changes Pige-owned authority.
- Redacted summaries distinguish `not_configured`, `ready`, `configured_unusable` with
  repair. Session status separates discovery/generation; only exact call failure marks failed.
- Ignore upstream-only thinking levels until schema, migration, and compatibility tests
  change together; `max` adds no visible setting.
- Embedding and reranking models are not user BYOK provider roles in v0.1; they belong to Local Capabilities and local RAG.

The Playbook and acceptance manifest own the current preset inventory, executable proof,
and remaining provider/platform delivery gaps; the rules above remain the stable model
profile contract.

## 8. Pi Custom Models Boundary

Pi supports custom providers/models via `~/.pi/agent/models.json`, but Pige should not mutate the user's global Pi configuration by default.

Pige passes provider/model information through its embedded adapter; it does not create
or depend on Pi global/process configuration.

Rules:

- Do not write API keys to `~/.pi/agent/models.json`.
- Do not require users to know Pi config file syntax.
- Do not let Pige provider setup alter unrelated Pi CLI usage.
- Do not execute shell-based secret resolution from Pi config for Pige provider calls.
- If a future advanced import reads existing Pi config, it must preview, redact, and import into Pige-owned provider profiles.

## 9. Model Routing Policy

v0.1 visible UI:

- One default model that Pi Agent can call.

Deferred visible UI:

- Advanced Model.
- Fast Model.
- Task-class model routing.
- Per-workflow model tables.

Gate for exposing model routing:

Model routing may become visible only when at least one is true:

1. Pi upstream exposes a stable model-slot or task-routing API that Pige can call directly.
2. Pige implements a tested Model Routing Service that maps task classes to actual Pi Agent or Pi AI calls.

If the gate is met later, the maximum product UI is:

- Default model.
- Advanced model.
- Fast model.

It must not become:

- A per-workflow routing grid.
- A provider capability matrix.
- A pricing/context-window comparison table.
- A model marketplace.

Runtime rule:

- A setting must not exist unless changing it changes actual runtime behavior.

## 10. Internal Routing Extension Point

Pige may internally choose models for a job only if it owns and tests the routing policy.

Candidate internal task classes:

```ts
type ModelTaskClass =
  | "agent_planning"
  | "tool_calling"
  | "long_context_reading"
  | "summarization"
  | "style_rewrite"
  | "context_compression"
  | "note_agent_answer";
```

Rules:

- Internal routing must be observable in operation records as redacted model profile references.
- Internal routing must preserve the exact selected Provider/model binding and may not
  introduce a Host content-policy branch.
- Internal routing must fall back to the default model.
- User-visible model slots stay hidden until the gate in section 9 is satisfied.

## 11. Tool And Authority Boundary

Pi does not enforce Pige's trust boundaries. Pige must, without turning every tool call
into an approval protocol.

Rules:

- Disable or avoid Pi built-in tools unless Pige wraps them with scoped adapters.
- Register Pige-owned tools only through Agent Orchestrator.
- One user submit authorizes registered first-party reads, parsing, OCR, retrieval,
  user-specified fetch, and bounded local tools for that turn. `beforeToolCall` freezes
  scoped input; handlers revalidate canonical input, path, resource, byte/time, and effect
  guards without writing a parallel permission lifecycle.
- Side-effecting tools run sequentially; parallel tools require an explicit
  read-only/idempotent contract plus ordering, cancellation, and audit tests.
- Irreversible delete, original-file overwrite, out-of-root write, arbitrary shell,
  unknown-package install, credential export/display, and equivalent escalation require
  explicit confirmation. Raw key bytes are never a capability. Renderer and extensions
  receive no ambient file handle.
- Pi extensions or tools cannot access raw API keys. A reviewed Pige adapter may request brokered credential use for a specific provider call; it receives the call result, never the credential bytes.
- Pi tool output is treated as untrusted tool output and sanitized before display, logging, or model reuse.
- A tool implements one bounded deterministic capability. It cannot call a model,
  another tool, or hide a composite semantic workflow.
- The registered Pige core catalog is capability- and authority-scoped, not selected by a
  Host intent classifier. Pi may revisit read-only/idempotent tools and may retry a
  rejected side-effecting call with corrected typed input; deterministic effect identity,
  sequential execution, revalidation, and idempotency prevent duplicate writes.
- Tool-specific byte/time/resource bounds protect the Host. They must not encode a fixed
  semantic route such as exactly one correction, one retrieval, or one query when Pi can
  make useful progress safely.
- Home local search and Dataset query are independent read-only capabilities. Pi may
  select either or both in either order; the Host requires exact result visibility before
  dependent use or citation and keeps their citation identities disjoint, but does not
  enforce modality exclusivity or a model-turn ordering epoch.
- Final assistant text never causes a durable knowledge write. A write occurs only from
  a validated registered tool call in which Pi authors the intended Markdown. The Host
  may add/validate stable IDs, timestamps, provenance and commit metadata, but cannot
  replace Pi with a hidden content/organization workflow. Deterministic source
  preservation and mechanical projections remain Host-owned parts of the same Job.
- A tool returns a typed blocked/high-risk result when its effect crosses the closed
  confirmation boundary. New Jobs do not enter `waiting_permission`; Pi may choose
  another available capability after the user decision or denial.

The Pige Tool Registry is Pi's only product-capability surface. Each entry declares
stable ID/version/description/capability; strict input/output schemas and trust; effect,
required capabilities, resource scope, authority class, data boundary, execution order,
idempotency, limits, owner service, and handler.

Production exposes read-only folder/text/fetch, `pige_install_pi_package` for managed Pi
packages, and the first-party `pige_run_command` OS capability. The command tool accepts
an executable plus argv/cwd/timeout rather than an interpolated command string; an Agent
may explicitly invoke a shell, npm, npx, a CLI, or another system utility when the user
task needs it. Ordinary first-party desktop calls inherit the submitted user task as
one-use authority and emit one audit record without a duplicate prompt. Third-party
actors cannot inherit first-party authority; credentials, destructive effects, and
boundary changes retain their own gates.

Pi-selected Dataset tools bind the exact source or Dataset revision. A deterministic
`dataset_import` child may materialize one validated Bundle/Operation; read-only Home
queries return bounded opaque results and citations. Pi receives no SQL, path, handle,
extension, payload, or destination authority. These results return to Pi rather than
terminating or prescribing its next semantic action; editing, joins, and arbitrary SQL
remain outside the current tools.

Calls bind run/call, catalog/policy/source, tool/input hashes and typed provenance; large
bodies remain Artifacts. Host validates before each effect, cancellation preserves no
partial response, and accepted create/append/tag/link writes emit Activity/Undo.

Inspect/parse/OCR/retrieval/write remain separate tools. Registration says what Pi may
call, never what it must call; zero-tool answers and typed empty-result replanning remain
valid. Ephemeral `PlanSummary` excludes chain of thought, and stale/denied/unavailable
results require revision before another effect.

### 11.1 Pi Final Authority And Tool Validation

One user submission owns one durable Pige Agent Job and may contain multiple upstream Pi
model turns and tool calls. Upstream Pi's final assistant message is authoritative for
ordinary Agent completion, whether or not tools ran.

- No `pige_finish_home_turn`, `HomeAgentOutput`, grounding label, evidence-quote count, or
  citation shape is mandatory for an ordinary/current-note/Dataset/source answer. Host
  code must not discard or repair-follow-up a successful assistant final for omitting one.
- Registered tool input/result, evidence identity, authority, and resource bounds validate
  at each tool boundary. Durable mutations still require their owner service's schema,
  revision, conflict, permission, idempotency, and commit checks.
- Citations are optional answer metadata. The Host may project only known current evidence
  refs; invalid or stale refs are removed or marked unavailable without rejecting the
  remaining assistant answer.
- Denied high-risk authority, Provider/source identity drift, cancellation, unavailable required runtime, and
  irreconcilable conflict or evidence drift remain hard Host boundaries. Pi may choose a
  different already-authorized route, but it cannot reinterpret or override the denial.
- Resource controls cap time/work/bytes/repeated failure; safe limits checkpoint/resume.
  Malformed provider transport remains `call_failed` or `protocol_incompatible`, not a
  semantic output verdict.
- Only exact `model_provider.call_failed` projects as provider-call failure.
  `model_provider.binding_changed` requests binding repair; other typed Host errors keep
  their safe code. `knowledge_action_missing`, semantic `output_invalid` and
  `completion_invalid` are retired from new ordinary Agent turns.

Upstream Pi continuation includes post-effect model/inspect/search/parse/OCR without Host
`already_*`/terminal substitution. Exact owners reject conflicting mutations; AR3 owns
aggregation. Pige supplies typed feedback/Job checkpoints; Pi retains semantic control.

## 12. Sessions, Memory, And Durable State

Pi has session persistence concepts. Pige has its own durable state model.

Rules:

- Pige conversation history lives under `.pige/conversations/`.
- Pige jobs live under `.pige/jobs/`.
- Pige proposals live under `.pige/proposals/`.
- Pige operations live under `.pige/operations/`.
- Pige memory lives under `.pige/memory/`.
- Pi session files are not included in vault backup by default.
- If Pi needs transient runtime state, store it in machine-local app data or job-scoped temp state, not as the knowledge source of truth.

Home follow-up creates fresh isolated Pi from at most 16 checked prior user/assistant
messages/64 KiB; history cannot become the current result. Pige events/Jobs, not Pi
sessions, are authoritative. Compaction/indexing and steer queues remain open.

Home draft streaming is a Pi-owned answer presentation boundary, not raw provider output.
Pige accepts bounded assistant replacement snapshots from reviewed upstream Pi events
after transport framing and envelope validation. Draft validity never determines Job success.
Pige must not make a second provider call solely to force the model to reproduce an answer
it already generated for UI streaming.

Both paths emit sender/turn/Job-bound, monotonically sequenced `draft_replace` snapshots.
Pige never emits thinking, raw JSON/tool arguments, provider events, or model refs.
Replacement snapshots may shrink or revise prior text and grant no tool,
data, destination, or durable-write authority.

Pi event retention and provider-stream safety are separate bounds. Every raw update is
still inspected by the safe draft controller and counts toward an independent hard cap;
consecutive body-free `message_update` records may coalesce in the structural turn-event
history so token cadence cannot exhaust the smaller tool/lifecycle event budget.

The draft is escaped, non-durable, and non-authoritative. The upstream Pi final becomes
the durable assistant event after typed envelope, sender/turn identity, length/resource,
and cancellation checks. Optional citation refs are projected only when Host-known and
current. Cancellation or a true external block clears/marks the draft, and restart
restores only durable conversation state. Ambient provider payloads and Pi thinking are
never Home answer events; the sole adapter identifies a reviewed Pi-owned answer channel.

Agent memory:

- Pige-native memory remains the default.
- Pi memory/session features can be used only as runtime helpers and must not bypass Pige memory inspection, deletion, backup, and secret scanning rules.

## 13. Prompt And Context Boundary

Pige owns prompt construction.

Rules:

- Prompt templates follow `docs/PROMPT_DESIGN.md`.
- Source content is wrapped as untrusted data.
- `PIGE.md`, user instruction, authority policy, and security rules outrank source text and Skills.
- Pi system prompt customization must not remove Pige's safety, citation, storage, or authority instructions.
- Context compaction must not discard unresolved jobs, citations, source IDs, or high-risk decisions.
- Initial context may contain only the user instruction, policy, and scoped tool
  descriptors. Parsed or retrieved evidence enters only after its Pi-selected result.
- Connected/selected Provider identity plus user Send authorizes the bounded selected
  context for that turn. Host rechecks Provider/source identity and bounds but preserves
  the exact user-authored and selected payload without classifying, redacting, rewriting,
  or blocking its content. Stored Provider credentials stay isolated in authentication;
  no separate egress approval or waiting Job state exists.
- Trimming may classify only semantic emptiness. Accepted user and assistant strings keep
  their exact whitespace and line breaks through durable history, input identity,
  retry/restart, safe projection and Provider transport. Structural size bounds reject
  before Send or bound explicitly selected context; they never silently mutate accepted
  text.

## 14. API And IPC

The [Settings, Providers, and Tools API domain](API_AND_IPC_DESIGN.md#68-settings-providers-tools)
owns model DTOs; the [Jobs API domain](API_AND_IPC_DESIGN.md#63-jobs) owns retry/cancel;
[Retrieval](API_AND_IPC_DESIGN.md#66-retrieval) owns `agent.submitTurn`/`agent.conversation`.
This integration contract defines behavior, not a second IPC vocabulary.

`agent.submitTurn` is the sole production semantic ingress. Main no longer registers
`capture.submitText`, `capture.submitFiles`, or `capture.submitUrl`; preservation invoked
inside an Agent turn is checkpoint work. At this contract freeze, legacy code still
accepts `capture_only` and normalizes missing-field records to `legacy_agent_ingest`
solely for the bounded AR2 deletion window; neither may be created for new work. AR2
removes current `capture_only` creation/acceptance so `agent_turn` is the only current
record mode. Unknown values fail validation throughout.

Durable proposal list/get/decision remains Main-internal for recovery/tests. Renderer
list/get/approve/reject all fail closed pending a projection that excludes model-generated
summary/reason and raw record fields. Historical reconciliation/staging remains; new
`agent_turn` registers no legacy staging tool until that bounded owner exists.

Any future connection test, model-list refresh, or Agent-run entry point must first be added to the API owner and executable contracts. It must not be introduced here as a speculative alias.

Rules:

- Renderer receives redacted provider/model DTOs.
- Renderer never receives API keys.
- Agent jobs refer to provider/model profiles by ID.
- Model provider calls emit job events and diagnostics metadata without storing raw prompts/responses by default.

## 15. Tests

Required tests:

- Setup proves secret-only storage, discovery/manual-ID failure distinctions, explicit
  protocol, real Pi probe-before-save, safe commit/restore, tri-state binding, and default use.
- Runtime proves no Advanced/Fast fiction, global Pi config mutation, ambient authority,
  built-in permission bypass, unscoped tools, unsafe endpoints/headers, or raw diagnostics.
- Home proves direct zero-tool/no-citation answers, Pi-selected retrieval, empty-result
  replan, vault-only insufficiency, source-tool events, cloud status, and no Host calls.
- The Agent Spine test matrix is owned by `docs/QUALITY_AND_TEST_STRATEGY.md` section
  6.1; it must prove containment, distinct Agent-chosen traces, replanning, tool-caused
  idempotent writes, no-model preservation, and bypass mutations. Sensitive-tool
  acceptance remains Phase 8.

## 16. Implementation Checklist

Runtime reports only `embedded_pi_sdk`; non-secret readiness checks an enabled default
model/provider and required-auth satisfaction, and each run creates one isolated Pi model
collection. Legacy DTO values remain readable; no alternate runtime is enabled.

Current Pi tool/turn coverage and open work live in the Playbook and acceptance manifest.
The adapter, revalidation, no-model preservation, typed repair, and legacy-read rules in
this owner remain normative.

Re-review both Pi pins together whenever either changes.

## 17. References

Provider/Agent SDK sources, pins, and update triggers are registered once in
[`TECH_ARCHITECTURE.md`](TECH_ARCHITECTURE.md#163-model-provider-and-agent-sdk-layer).
