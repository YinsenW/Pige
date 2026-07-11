# Pi Agent And Model Provider Integration

Status: Draft baseline
Date: 2026-07-09
Last reviewed: 2026-07-11

## 1. Purpose

This document defines how Pige integrates Pi Agent, Pi model/provider configuration, and BYOK language model providers.

Pige's product goal is simple:

> The user connects one model service that Pi Agent can call. Pige handles the rest.

Pi Agent is the mandatory v0.1 core. Text, document parse, selected OCR, bounded
retrieval, and one terminal proposal stage run through embedded Pi tools. Phase 3 remains
partial for review/apply, broader routing, recovery, permissions, and packaged paths.

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

After source preservation, Pi Agent alone selects and replans semantic tool use; host
services gate calls and each tool executes one bounded capability.

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

Pige-owned provider profiles are machine-local records.

```ts
type ProviderProfile = {
  id: string;
  displayName: string;
  providerKind: ProviderKind;
  baseUrl?: string;
  authSecretRef: string;
  modelListStrategy: ModelListStrategy;
  cloudBoundary: CloudBoundary;
  boundaryVerification?: BoundaryVerification;
  createdAt: string;
  updatedAt: string;
};
```

`ProviderKind`, `ModelListStrategy`, `CloudBoundary`, and `BoundaryVerification` are
inferred from the single executable schemas in `packages/schemas/src/index.ts`; this
profile does not own parallel enum lists.

Rules:

- Keys live only in the secret store; profiles hold `authSecretRef`. Reviewed adapters
  construct auth at call time; metadata cannot persist arbitrary `defaultHeaders`.
- `ProviderProfileSchema` in `packages/schemas/src/index.ts` is the executable profile contract. Profiles are excluded from default vault
  backup; records use redacted IDs, and UI shows cloud/local only when relevant.
- Built-in OpenAI/Anthropic use their fixed built-in endpoints, do not persist `baseUrl`,
  and require `cloud` + `builtin_verified`; schema rejects missing or non-`builtin_verified` boundary metadata. Compatible/custom profiles use their URL. Only canonical loopback can be `local` +
  `loopback_verified`; schema rejects both directions of a mismatch.
- `ProviderBaseUrlSchema` is the single persisted and runtime-call URL contract: HTTPS,
  or HTTP only for canonical loopback; no userinfo, query, fragment, or weaker edited path.
- The final disclosed `Connect` authorizes routine egress only to that exact Profile and
  canonical endpoint. Unknown or changed boundary/endpoint confirms again. This grants
  no tool, setting, permission, extension, filesystem, or secret authority; the typed
  matrix remains owned by `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`.

## 7. Model Profile Model

Pige-owned model profiles are machine-local records associated with a provider profile.

```ts
type ModelProfile = {
  id: string;
  providerProfileId: string;
  modelId: string;
  displayName?: string;
  source: "provider_list" | "manual";
  supportsTools?: boolean;
  supportsVision?: boolean;
  contextWindowTokens?: number;
  defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
```

Rules:

- v0.1 requires one effective default model.
- If provider model listing succeeds, Pige stores discovered model profiles.
- Where a Pi provider catalog is static, Pige supplies only the bounded model-list
  callback and registers its results into the Job's isolated Pi `Models`; it does not
  introduce another provider SDK or copy Pi's protocol/catalog runtime.
- Add Provider tests before save: OpenAI-format uses Bearer `/v1/models`; Anthropic-format
  uses `x-api-key`, `anthropic-version`, and `/v1/models`. Authentication, network, timeout, invalid payload, and official-provider list failures remain failures; only an explicitly unsupported compatible
  list route permits manual ID, and successful lists require a selected returned ID.
- Pi Agent calls must resolve through a selected `ModelProfile`, not a free-text runtime string.
- Ignore upstream-only thinking levels until schema, migration, and compatibility tests
  change together; `max` adds no visible setting.
- Embedding and reranking models are not user BYOK provider roles in v0.1; they belong to Local Capabilities and local RAG.

Current preset foundation:

- `openai` fixes the official endpoint, Pi Responses protocol, bounded discovery, and
  reviewed `gpt-5-mini`; its default UI asks only for the key. Confirmation precedes
  mutation and failure restores the prior binding.
- Models share one global list/default. Full catalog/help action/custom protocol polish,
  durable preset identity/replacement policy, multi-provider lifecycle, and packaged
  manual BYOK proof remain open.

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
- Sensitive tools use Permission Broker. The first create-only note tool uses a bounded
  current-job authorization port; it is not persisted Broker evidence.
- `beforeToolCall` freezes and authorizes scoped input; handlers revalidate canonical
  input and effect guards. Brokered tools reauthorize scope before effects.
- Side-effecting tools run sequentially; parallel tools require an explicit
  read-only/idempotent contract plus ordering, cancellation, and audit tests.
- Shell, filesystem, network, package, brokered credential use, provider, settings, delete, and external source actions require declared capabilities and permission policy. Raw key bytes are never a capability and are never exposed to Pi extensions or tools.
- Pi extensions or tools cannot directly read/write vault files.
- Pi extensions or tools cannot access raw API keys. A reviewed Pige adapter may request brokered credential use for a specific provider call; it receives the call result, never the credential bytes.
- Pi tool output is treated as untrusted tool output and sanitized before display, logging, or model reuse.
- A tool implements one bounded deterministic capability. It cannot call a model,
  another tool, or hide a composite semantic workflow.
- Final assistant text never causes a durable knowledge write. A write occurs only from
  a validated registered tool call, except deterministic source preservation and
  mechanical projections owned by the same approved commit.

The Pige Tool Registry is the only product-capability surface visible to Pi Agent.
Each registry entry MUST declare at least:

```ts
type PigeAgentTool = {
  id: string;
  version: string;
  description: string;
  capability: string;
  inputSchema: RuntimeSchema;
  outputSchema: RuntimeSchema;
  effect: "read_only" | "compute" | "proposal" | "idempotent_write" | "destructive";
  inputTrust: TrustClass;
  outputTrust: TrustClass;
  requiredCapabilities: string[];
  resolveResourceScope: (input: unknown, context: PigeToolContext) => ResourceScope;
  permission: "none_current_job" | "broker" | "always_confirm";
  dataBoundary: DataBoundary;
  execution: "sequential" | "parallel_read_only";
  idempotency: IdempotencyContract;
  limits: ToolExecutionLimits;
  ownerService: string;
  handler: (input: unknown, context: PigeToolContext) => Promise<PigeToolResult>;
};
```

The model sees only bounded descriptors. Calls bind run/call, catalog/policy/source,
tool-version, and input hashes; results carry typed refs, warnings, and provenance while
large bodies remain Artifacts. Host validation precedes every result or effect.

The current slice exposes inspect, parse/selected OCR, optional local search, and one
terminal cited publication or `pige_stage_knowledge_note_proposal@1`. The strict proposal
input cannot choose target, trust, refs, policy, permissions, or operation shape; Host
derives one create operation and stages it before body-free parent review linkage. Search
rules follow `CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`; all calls bind catalog/policy/
source/input and capped call hashes. Full risk routing, review/apply, catalog, Broker,
generic/cross-process recovery, and packaged paths remain open.

Source inspection, extraction, OCR, retrieval, and knowledge publication remain
separate tools. Recommendations cannot invoke another tool. Runtime may keep only a
bounded objective/evidence-gap/next-intent/stop-condition `PlanSummary`, never private
chain of thought; it is ephemeral and restart requires replanning. Stale, denied,
partial, or unavailable results require revision before another side effect.

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

## 14. API And IPC

The [Settings, Providers, and Tools API domain](API_AND_IPC_DESIGN.md#68-settings-providers-tools) owns model/provider channel names and redacted DTOs. The [Jobs API domain](API_AND_IPC_DESIGN.md#63-jobs) owns Agent-job retry and cancellation transport. This integration contract defines provider and Pi behavior, not a second IPC vocabulary.

Any future connection test, model-list refresh, or Agent-run entry point must first be added to the API owner and executable contracts. It must not be introduced here as a speculative alias.

Rules:

- Renderer receives redacted provider/model DTOs.
- Renderer never receives API keys.
- Agent jobs refer to provider/model profiles by ID.
- Model provider calls emit job events and diagnostics metadata without storing raw prompts/responses by default.

## 15. Tests

Required tests:

- Provider setup stores API key only in secret store.
- Provider list-model discovery creates model profiles.
- Manual model ID entry works when a compatible/custom endpoint explicitly reports that model listing is unsupported; it does not mask authentication, network, timeout, malformed-payload, or official-provider failures.
- Default model selection affects new Pi Agent calls.
- No Advanced/Fast model settings exist in v0.1 UI.
- If a future model routing service is enabled, changing slots changes actual runtime model selection.
- Pi built-in tools cannot bypass Permission Broker.
- Pige tools require declared capabilities and scoped permissions.
- Source prompt injection cannot change provider, model, tools, permissions, or `PIGE.md`.
- Provider diagnostics contain redacted profile/model references only.
- No global `~/.pi/agent/models.json` mutation occurs during normal Pige provider setup.
- Cloud-send indicator appears when content is sent to a cloud-hosted provider.
- Official, loopback, asserted, and unknown endpoints fail safe; confirmation resumes the same Job once without duplicate effects.
- Provider profile persistence rejects arbitrary secret-bearing headers and base URLs containing userinfo or credential-bearing query parameters.
- The Agent Spine test matrix is owned by `docs/QUALITY_AND_TEST_STRATEGY.md` section
  6.1; it must prove containment, distinct Agent-chosen traces, replanning, tool-caused
  idempotent writes, no-model preservation, and bypass mutations. Sensitive-tool
  acceptance remains Phase 8.

## 16. Implementation Checklist

Runtime implementation note:

- Production `agent.runtimeStatus` reports `embedded_pi_sdk`. Status, onboarding, and
  Job readiness require an enabled default model, matching provider, and presence-only
  secret-binding metadata; they never resolve or decrypt provider credentials.
- Each Agent run resolves the selected Pige provider/model profile into one isolated Pi
  model collection; local protocol tests prove scoped model and credential binding.
- The shared DTO retains legacy adapter-mode values for compatibility, but production
  emits only `embedded_pi_sdk`; no alternate RPC/CLI runtime is enabled.

Phase 3 implementation note:

- Normal `agent_ingest` now uses the embedded Pi Agent; the former direct
  `ProviderModelJsonClient` path is deleted rather than retained as a fallback.
- Text calls inspect→publish; documents may call inspect→parse→optional OCR→inspect→
  publish. Unknown, stale, unavailable, malformed, or unauthorized calls replan or fail
  before effects.
- Egress is decided before credentials and rechecked before every model turn. Provider,
  model, source revision, evidence refs, cancellation, and publication fences are
  revalidated by Pige; raw prompts, responses, sessions, and keys are not persisted.
- With no model, preservation stays useful and Agent work waits. Sparse/image-only PDF,
  parser-selected PPTX media, and direct images use bounded Agent-selected OCR;
  unavailable or empty evidence waits without a note.
- Home uses one Pi search tool with per-turn Markdown/source-privacy/egress revalidation
  and strict citations. No binding falls back locally before Agent work; no evidence
  returns the fixed result without a model call.

Remaining work: finish catalog/risk routing/review/apply, remove fixed semantic routes,
add Broker/generic recovery and packaged/manual BYOK proof, and re-review both exact Pi
pins together whenever either changes.

## 17. References

Provider/Agent SDK sources, pins, and update triggers are registered once in
[`TECH_ARCHITECTURE.md`](TECH_ARCHITECTURE.md#163-model-provider-and-agent-sdk-layer).
