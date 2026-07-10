# Pi Agent And Model Provider Integration

Status: Draft baseline
Date: 2026-07-09
Last reviewed: 2026-07-10

## 1. Purpose

This document defines how Pige integrates Pi Agent, Pi model/provider configuration, and BYOK language model providers.

Pige's product goal is simple:

> The user connects one model service that Pi Agent can call. Pige handles the rest.

This document prevents three common implementation failures:

- Exposing Pi's full model/provider/extension complexity as Pige's UI.
- Adding Advanced/Fast model settings that do not change runtime behavior.
- Letting Pi tools, extensions, global config, or shell access bypass Pige's Permission Broker and storage rules.

## 2. Upstream Facts Verified

Reviewed upstream snapshot: `v0.80.6`
(`2b3fda9921b5590f285165287bd442a25817f17b`) on 2026-07-10.

- `pi-agent-core` owns the loop; `pi-ai` owns streaming; the CLI is separate.
- Pi 0.80 introduced explicit `Models` collections, provider factories, and injectable
  credentials/auth context; its temporary `/compat` global API will be removed.
- `Agent` still defaults to `/compat` streaming unless the caller supplies `streamFn`.
- New `max` thinking/pricing metadata creates no Pige setting or requirement.
- Pi project trust is not a sandbox and Pi does not enforce Pige permissions.

References are listed in section 17.

## 3. Product Boundary

Pige is not a Pi terminal UI wrapper.

Pige should use Pi as:

- Agent loop/runtime.
- Tool-calling orchestration layer.
- Model/provider execution layer through `pi-ai` or a Pige adapter.
- Optional extension inspiration for future advanced integrations.

Pige should not expose by default:

- Pi's model picker.
- Pi's session tree.
- Pi's global extension directories.
- Pi's full provider catalog.
- Pi's CLI flags.
- Pi's built-in coding tools as unrestricted tools.
- Pi's global `~/.pi/agent/models.json` as the primary user-facing configuration.

## 4. Integration Modes

Pige uses only the embedded SDK. Pi RPC/CLI/binaries and
`@earendil-works/pi-orchestrator` are manual references, never Pige runtime,
dependencies, packages, or acceptance evidence.

Rules:

- Renderer never talks to Pi directly.
- Main process or worker-owned Agent Orchestrator owns Pi lifecycle.
- Pi runtime receives scoped Pige tools, not arbitrary filesystem/shell access.
- A receiver-safe wrapper around isolated `Models.streamSimple` supplies `streamFn`;
  imports exclude `/compat`, `providers/all`, global registry/config.
- Pige stores its own job, conversation, proposal, operation, memory, and diagnostics records.
- Pi session files are not Pige's durable source of truth.

## 5. Package Boundary

Expected package roles:

| Package | Pige use | Product boundary |
| --- | --- | --- |
| `@earendil-works/pi-agent-core` | Agent turn loop and tool-calling runtime. | Wrapped by Agent Orchestrator. |
| `@earendil-works/pi-ai` | Isolated provider/model invocation and streaming. | Called through Model Provider Registry and cloud-send policy. |
| `@earendil-works/pi-coding-agent` | Source reference only. | Never packaged or user-facing. |
| Pi extension APIs | Future reference for Pige Skills/packages. | Not trusted by default; must pass Pige capability review. |

Each job receives an isolated `Models` set containing only its reviewed binding and Pige
auth adapters. Ambient credentials, endpoints, and routing are forbidden; audit other
adapter environment reads and isolate any remainder in a sanitized process.

`v0.80.6` is review-only. Adoption requires exact dual-package manifest, integrity and
provenance; root MIT notice/SBOM; hermetic catalogs; import gates; selected-binding
fixtures; and pinned Electron/Node macOS/Windows smokes.

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
- Local/self-hosted endpoint configuration still displays an explicit boundary state.
- Official, verified-loopback, user-asserted, and unknown endpoint boundaries produce the expected fail-safe egress decision.
- Provider profile persistence rejects arbitrary secret-bearing headers and base URLs containing userinfo or credential-bearing query parameters.
- Adapter tests reject global imports/ambient routing, prove receiver-safe selected
  streaming, revalidate mutated hook input, and serialize side effects.

## 16. Implementation Checklist

Phase 1 implementation note:

- `agent.runtimeStatus` and the Agent Runtime Service may report `phase_1_stub` readiness using the active vault, default model profile, local database status, and a non-secret Agent Runtime Policy snapshot.
- `phase_1_stub` proves that default model selection affects runtime readiness and policy context, but it does not run Pi Agent jobs or model calls.
- Replacing the stub uses the embedded adapter, keeps the non-secret status boundary,
  and proves selected profiles affect real calls.

Phase 3 implementation note:

- Basic Agent ingest uses the selected default `ModelProfile` through a Pige-owned provider adapter before full Pi Agent orchestration is enabled.
- The bridge calls OpenAI-format `/v1/chat/completions` or Anthropic-format `/v1/messages` for structured JSON ingest output.
- Each egress approval is bound to the non-secret Provider routing identity (kind, canonical endpoint, boundary, profile revision) and Model routing identity (profile/provider IDs, provider model ID, enabled state, revision). Pige rechecks profile summaries before prompt rendering and the credential-bearing runtime config before invocation, so reusing an ID for a changed endpoint or model cannot reuse the prior approval.
- Source text is wrapped as untrusted data and obvious secret-like strings are redacted before the model call.
- Raw prompts, API keys, and raw provider responses are not written to Markdown, job records, operation records, diagnostics, or backups by default.
- Successful Agent ingest writes a simple wiki note, an operation record, `index.md`, and `log.md`; failed structured output leaves the `agent_ingest` job retryable.
- Capture-only source pages remain useful when no model exists; the follow-up `agent_ingest` job waits in `waiting_dependency` and is requeued after a default model becomes ready.

Before implementing Pi or provider integration:

1. Pin exact Pi packages/integrity and use the embedded adapter.
2. Build an isolated `Models` set with Pige credentials/auth context and explicit `streamFn`.
3. Prove selected profiles affect calls without ambient/global provider resolution.
4. Wrap tools; keep side effects sequential and Permission Broker-authorized in handlers.
5. Add cloud-send, redacted diagnostics, model, tool, secret, and injection tests.
6. Re-review this contract whenever upstream Pi APIs change.

## 17. References

Provider/Agent SDK sources, pins, and update triggers are registered once in
[`TECH_ARCHITECTURE.md`](TECH_ARCHITECTURE.md#163-model-provider-and-agent-sdk-layer).
