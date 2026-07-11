# Pi Agent And Model Provider Integration

Status: Draft baseline
Date: 2026-07-09
Last reviewed: 2026-07-11

## 1. Purpose

This document defines how Pige integrates Pi Agent, Pi model/provider configuration, and BYOK language model providers.

Pige's product goal is simple:

> The user connects one model service that Pi Agent can call. Pige handles the rest.

Pi Agent is the mandatory v0.1 execution core. The direct provider bridge is
transitional; Phase 3 exits only after an embedded Pi flow returns through
Pige-owned policy, tool, validation, storage, and recovery boundaries.

Adopt, do not imitate: where Pi exposes a supported generic runtime surface,
Pige integrates it through a thin adapter instead of copying, forking, or
maintaining a parallel Agent runtime. Pige still owns product policy and data.

## 2. Upstream Facts Verified

Reviewed upstream snapshot: `v0.80.6`
(`2b3fda9921b5590f285165287bd442a25817f17b`) on 2026-07-10.

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

Checkpoint A: `v0.80.6` remains review-only because no official Agent entry satisfies
the side-effect boundary above. Default action is to request and adopt an official
compat-free entry; absence of that entry is not permission to recreate Pi. A temporary
containment exception requires an explicit user-approved architecture decision and
proof that the transitive compat registry is inert.

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

- Raw API keys live only in the secret store.
- Provider profiles store `authSecretRef`, not keys.
- `ProviderProfileSchema` in `packages/schemas/src/index.ts` is the executable profile contract. Other documents link to this section and that schema instead of defining a second profile shape.
- Provider adapters construct authentication and required protocol headers at call time from `authSecretRef`. v0.1 provider metadata cannot persist arbitrary `defaultHeaders`; future custom headers must use an explicit non-secret allowlist plus separate secret references.
- Provider profiles are excluded from default vault backup.
- Provider IDs may appear in operation/diagnostic records only as redacted references.
- Cloud/local boundary is shown inline when content may leave the machine, but not as a provider capability matrix.
- Official OpenAI and Anthropic provider kinds use their fixed built-in endpoints, do not persist `baseUrl`, and are `cloud` with required `builtin_verified` boundary metadata. `ProviderProfileSchema` rejects missing or non-`builtin_verified` boundary metadata for these built-in kinds. A proxy, compatible endpoint, or custom base URL must use a compatible/custom provider kind. Only a canonical loopback URL on such a profile can be `local` with `loopback_verified`; the executable profile schema rejects both directions of a mismatch. A non-loopback compatible/custom endpoint is `unknown` until the user explicitly classifies it; a user assertion is recorded as `user_asserted`, not treated as network proof.
- `ProviderBaseUrlSchema` is the single persisted and runtime-call URL contract. It permits HTTPS endpoints and HTTP only for canonical loopback hosts (`localhost`, `127.0.0.1`, or `::1`), rejects every other protocol, URL userinfo, query, and fragment, and canonicalizes whitespace/trailing slashes before persistence. Connection tests, profile reads/writes, boundary classification, and model calls must use that same schema; a manually edited profile cannot enter a weaker runtime path. `unknown` is handled conservatively by the Model Egress Decision contract in `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`.

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
- Compatible/custom endpoints may use manual model ID entry only when their model-list route explicitly reports unsupported behavior. Authentication, network, timeout, invalid payload, and official-provider list failures remain failures and do not fall back to an unverified model ID.
- The Add Provider flow performs a low-cost connection check before saving a provider profile. OpenAI-format providers use `GET /v1/models` with Bearer auth; Anthropic-format providers use `GET /v1/models` with `x-api-key` and `anthropic-version`.
- Official OpenAI and Anthropic providers should reject missing selected model IDs when their model list succeeds. Compatible/custom providers may fall back to manual model IDs when the endpoint explicitly does not support model listing.
- Pi Agent calls must resolve through a selected `ModelProfile`, not a free-text runtime string.
- Ignore upstream-only thinking levels until schema, migration, and compatibility tests
  change together; `max` adds no visible setting.
- Embedding and reranking models are not user BYOK provider roles in v0.1; they belong to Local Capabilities and local RAG.

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
- Every sensitive tool call goes through Permission Broker.
- `beforeToolCall` is defense in depth: freeze its validated input, then revalidate and
  authorize the same canonical input in the service handler before effects.
- Side-effecting tools run sequentially; parallel tools require an explicit
  read-only/idempotent contract plus ordering, cancellation, and audit tests.
- Shell, filesystem, network, package, brokered credential use, provider, settings, delete, and external source actions require declared capabilities and permission policy. Raw key bytes are never a capability and are never exposed to Pi extensions or tools.
- Pi extensions or tools cannot directly read/write vault files.
- Pi extensions or tools cannot access raw API keys. A reviewed Pige adapter may request brokered credential use for a specific provider call; it receives the call result, never the credential bytes.
- Pi tool output is treated as untrusted tool output and sanitized before display, logging, or model reuse.

Recommended Pige tool pattern:

```ts
type PigeAgentTool = {
  name: string;
  capability: string;
  inputSchema: unknown;
  permissionScope: PermissionScope;
  handler: (input: unknown, context: PigeToolContext) => Promise<PigeToolResult>;
};
```

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
- Adapter tests reject global/direct calls and ambient routing; one deterministic
  `agent_ingest` case runs selected-model Pi streaming plus a non-sensitive typed
  Pige tool to validated durable output, with drift, injection, cancellation,
  retry/restart, and packaged-runtime negatives. Sensitive tools remain Phase 8.

## 16. Implementation Checklist

Phase 1 implementation note:

- `agent.runtimeStatus` and the Agent Runtime Service may report `phase_1_stub` readiness using the active vault, default model profile, local database status, and a non-secret Agent Runtime Policy snapshot.
- `phase_1_stub` proves that default model selection affects runtime readiness and policy context, but it does not run Pi Agent jobs or model calls.
- Replacing the stub uses the embedded adapter, keeps the non-secret status boundary,
  and proves selected profiles affect real calls.

Phase 3 implementation note:

- Current `agent_ingest` uses selected `ModelProfile` calls to OpenAI/Anthropic-format
  JSON endpoints. It is transitional evidence, not the Pi runtime.
- Egress binds and rechecks non-secret Provider/Model identities; delimited source is
  redacted and raw prompts, keys, and responses are not persisted by default.
- Success writes the wiki/index/log/operation projection; invalid output retries. With
  no model, the useful Source Page remains and ingest waits for dependency recovery.

Before implementing Pi or provider integration:

1. Pin exact Pi packages/integrity and use the embedded adapter.
2. Build an isolated `Models` set with Pige credentials/auth context and explicit `streamFn`.
3. Prove selected profiles affect calls without ambient/global provider resolution.
4. Wrap tools; keep side effects sequential and Permission Broker-authorized in handlers.
5. Run the deterministic Pi vertical acceptance plus cloud-send, redaction, tool, secret, injection, recovery, direct-call, and packaged-runtime tests.
6. Re-review this contract whenever upstream Pi APIs change.

## 17. References

Provider/Agent SDK sources, pins, and update triggers are registered once in
[`TECH_ARCHITECTURE.md`](TECH_ARCHITECTURE.md#163-model-provider-and-agent-sdk-layer).
