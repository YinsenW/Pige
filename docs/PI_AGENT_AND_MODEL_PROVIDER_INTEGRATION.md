# Pi Agent And Model Provider Integration

Status: Draft baseline
Date: 2026-07-09
Last reviewed: 2026-07-11

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

Reviewed upstream snapshot: `v0.80.6`
(`2b3fda9921b5590f285165287bd442a25817f17b`) on 2026-07-10.

`@earendil-works/pi-ai` is the official provider/model package inside the same Pi
monorepo, not a second Agent framework. Pige does not add Vercel AI SDK or another
parallel provider runtime.

- `pi-agent-core` owns Agent mechanics; the side-effect-free `pi-ai` root provides
  isolated `Models`, provider factories, injected auth, and streaming.
- In `v0.80.6`, both official `pi-agent-core` entries still load `pi-ai/compat`;
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

Pige owns UI; profiles/secrets; evidence, prompts, citations and validation; egress,
permissions and tools; and all durable product records.

Every semantic Home or note submission uses the same embedded Pi entry. Source-bearing
turns begin after Host preservation; pure questions enter directly. Pi may answer
without tools or select and replan scoped tools. Pige owns evidence integrity, policy,
permissions, egress, provenance, validation, and commits—not the semantic route.

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
- Pi runtime receives scoped Pige tools, not arbitrary filesystem/shell access.
- Every Agent receives an explicit receiver-safe wrapper around its isolated
  `Models.streamSimple`; Pige code never calls `/compat`, `providers/all`, global
  registries/config, or the default compat dispatcher.
- Pige stores its own job, conversation, proposal, operation, memory, and diagnostics records.
- Pi session files are not Pige's durable source of truth.
- Do not deep-import, alias, patch, vendor, or fork Pi, and do not preserve the
  transitional direct provider bridge as a silent fallback after Pi adoption.

Checkpoint A implementation: the user approved and Pige adopted exact `v0.80.6`.
The sole adapter uses isolated `Models`, a receiver-bound stream, scoped credentials,
and no ambient auth; compat globals/catalog/default dispatch remain unused. Mutations,
an import snapshot, protocol tests, and an Electron smoke prove containment. Deep
imports, patches, forks, and copied loops remain forbidden. Replace the exception when
an official compat-free entry passes review; other Agent tool paths remain separate work.

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

- Presets are reviewed Pige metadata over Pi AI: stable ID, kind, protocol, Endpoint,
  auth, discovery, help URL, and bootstrap model. UI asks service plus credentials only;
  Custom alone asks one of the three protocols, Base URL, and credentials.
- `endpointProtocol`, never URL/kind, dispatches calls. Migration maps `openai` to
  Responses, `anthropic` kinds to Messages, and compatible/legacy `custom` to Chat
  Completions without reinterpretation.
- Keys live only in the secret store. Required auth needs a reference, optional auth
  stores one only when supplied, and `none` forbids one. Pi AI 0.80.6 gets an in-memory
  non-secret token sentinel for `none`; adapters strip auth headers.
- `ProviderProfileSchema` rejects missing or non-`builtin_verified` boundary metadata;
  custom URLs are canonical HTTPS or loopback HTTP without userinfo/query/fragment. Profiles stay out of backup;
  cloud/self-hosted/local is internal egress metadata, not setup taxonomy.
- `Connect` authorizes only the disclosed Profile/Endpoint. Changed/unknown boundaries
  reconfirm; auth/network/timeout/payload/list failures return typed repair, never empty success.

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

- One inventory keys exact `(providerProfileId, modelId)`; discovery/manual records merge
  while preserving alias, enabled state, and Global Default. Missing/new refresh IDs are
  retained/disabled respectively; failed discovery preserves inventory and offers typed
  Retry/manual fallback rather than empty success.
- First Connect enables its validated bootstrap model and sets it as Global Default only
  when none exists. Default selects an enabled model across Providers; disabling it needs
  an atomic replacement, and unusable bindings stay visible without auto-switch/free text.
- Connect discovers non-durably, selects or requests a bootstrap ID, runs a real synthetic
  Pi generation/tool probe, then readback-commits all or restores all.
- Pi AI remains the provider runtime; Pige neither copies its catalog nor adds a parallel SDK.
- Redacted summaries distinguish `not_configured`, `ready`, and
  `configured_unusable`; the last carries a typed repair action rather than looking
  unconfigured or exposing endpoint, secret ref, or raw failure.
- Ignore upstream-only thinking levels until schema, migration, and compatibility tests
  change together; `max` adds no visible setting.
- Embedding and reranking models are not user BYOK provider roles in v0.1; they belong to Local Capabilities and local RAG.

Current preset foundation:

- Presets cover OpenAI/Responses, Anthropic/Messages, Gemini, DeepSeek/Chat and no-auth
  Ollama; Custom exposes three protocols. Optional-key UI proof is open.
- `presetId` reconnect preserves identity/choices and never replaces same-Endpoint Custom.
  Connect/Refresh journals restore incomplete writes; old secrets follow journal removal.
- Loopback proves renderer-to-Pi connect/restart. A legacy Custom DeepSeek proves secret
  resolution, Chat direct/restart-cited Home and clean diagnostics, not preset Connect.
- Open: catalog/delete/sync, live DeepSeek preset/Anthropic, multi-source recovery, and packaged platforms.

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
- Internal routing must respect cloud-send policy.
- Internal routing must fall back to the default model.
- User-visible model slots stay hidden until the gate in section 9 is satisfied.

## 11. Tool And Permission Boundary

Pi does not enforce Pige's product permissions. Pige must.

Rules:

- Disable or avoid Pi built-in tools unless Pige wraps them with scoped adapters.
- Register Pige-owned tools only through Agent Orchestrator.
- Pige-owned bounded tools use service authorization and eligible reversible knowledge
  effects need no user Permission. External extensions/new authority use Permission Broker.
- `beforeToolCall` freezes and authorizes scoped input; handlers revalidate canonical
  input and effect guards. Brokered tools reauthorize scope before effects.
- Side-effecting tools run sequentially; parallel tools require an explicit
  read-only/idempotent contract plus ordering, cancellation, and audit tests.
- External shell/filesystem/network/package/credential/settings/delete scopes require
  declared capabilities and permission policy. Exact connected model calls use standing
  BYOK authority. Raw key bytes are never a capability or exposed to extensions/tools.
- Pi extensions or tools cannot directly read/write vault files.
- Pi extensions or tools cannot access raw API keys. A reviewed Pige adapter may request brokered credential use for a specific provider call; it receives the call result, never the credential bytes.
- Pi tool output is treated as untrusted tool output and sanitized before display, logging, or model reuse.
- A tool implements one bounded deterministic capability. It cannot call a model,
  another tool, or hide a composite semantic workflow.
- Final assistant text never causes a durable knowledge write. A write occurs only from
  a validated registered tool call, except deterministic source preservation and
  mechanical projections owned by the same validated commit.

The Pige Tool Registry is Pi's only product-capability surface. Each entry declares
stable ID/version/description/capability; strict input/output schemas and trust; effect,
required capabilities, resource scope, permission, data boundary, execution order,
idempotency, limits, owner service, and handler.

The model sees only bounded descriptors. Calls bind run/call, catalog/policy/source,
tool-version, and input hashes; results carry typed refs, warnings, and provenance while
large bodies remain Artifacts. Host validation precedes every result or effect.
Job cancellation aborts Pi/active tools without persisting partial response.

Direct/proposal-applied and checkpoint-proven same-Job recovered exact creates emit
checksum-bound Operations for Activity/Undo; legacy unbound recovery stays non-undoable.
Non-create eligibility/tools, generic exceptions, catalog, Broker, cross-process recovery, restore/redo, and packaged paths remain open.

Source inspection, extraction, OCR, retrieval, and knowledge publication remain
separate tools. Recommendations cannot invoke another tool. Runtime may keep only a
bounded objective/evidence-gap/next-intent/stop-condition `PlanSummary`, never private
chain of thought; it is ephemeral and restart requires replanning. Stale, denied,
partial, or unavailable results require revision before another side effect.

Registration controls what Pi may call, not what it must call. A general answer may use
zero tools and no local citations. Empty retrieval returns a typed result for replanning;
only explicit vault/source-only grounding turns missing evidence into insufficiency.

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

Agent memory:

- Pige-native memory remains the default.
- Pi memory/session features can be used only as runtime helpers and must not bypass Pige memory inspection, deletion, backup, and secret scanning rules.

## 13. Prompt And Context Boundary

Pige owns prompt construction.

Rules:

- Prompt templates follow `docs/PROMPT_DESIGN.md`.
- Source content is wrapped as untrusted data.
- `PIGE.md`, user instruction, permission policy, and security rules outrank source text and Skills.
- Pi system prompt customization must not remove Pige's safety, citation, storage, or permission instructions.
- Context compaction must not discard unresolved jobs, citations, source IDs, or permission-relevant state.
- Initial context may contain only the user instruction, policy, and scoped tool
  descriptors. Parsed or retrieved evidence enters only after its Pi-selected result.
- Host rechecks current event/history/tail and bindings before model/tool boundaries;
  source/privacy/egress drift stops the next call/effect.

## 14. API And IPC

The [Settings, Providers, and Tools API domain](API_AND_IPC_DESIGN.md#68-settings-providers-tools)
owns model DTOs; the [Jobs API domain](API_AND_IPC_DESIGN.md#63-jobs) owns retry/cancel;
[Retrieval](API_AND_IPC_DESIGN.md#66-retrieval) owns `agent.submitTurn`/`agent.conversation`.
This integration contract defines behavior, not a second IPC vocabulary.

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

Phase 3 implementation note:

- Embedded Pi owns current text/document/image ingest; its selected inspect/parse/OCR/
  retrieval/write tools replan or fail before effects. Egress, binding, evidence,
  cancellation, and commit are rechecked; raw prompts/responses/keys do not persist.
- No model preserves sources and waits; unavailable/empty document evidence writes no note.
- Home `agent.submitTurn` supports direct, cited retrieval, URL, and one-file turns;
  missing/broken bindings wait with typed repair and legacy handlers stay readable.

Re-review both Pi pins together whenever either changes.

## 17. References

Provider/Agent SDK sources, pins, and update triggers are registered once in
[`TECH_ARCHITECTURE.md`](TECH_ARCHITECTURE.md#163-model-provider-and-agent-sdk-layer).
