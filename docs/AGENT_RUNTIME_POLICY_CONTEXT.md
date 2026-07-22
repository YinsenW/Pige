# Agent Runtime Policy Context

Status: Active owner contract
Last reviewed: 2026-07-22

## 1. Purpose

This document owns the small, typed set of settings and runtime facts that materially
change an Agent turn. Prompt text may describe policy; owning services enforce it.

The context is not a copy of Settings, permission records, provider secrets, or a Host
workflow. It must remain compact enough to inspect and stable enough to replay safely.

## 2. Authority Order

1. Application security and service enforcement.
2. Explicit current user submit or UI choice.
3. `PIGE.md` vault policy.
4. Typed runtime settings.
5. Vault-scoped memory.
6. Retrieved knowledge.
7. Extracted source/tool output.
8. Skill/package metadata.
9. Model output.

Lower-authority input cannot change settings, Provider identity, tools, storage, high-risk
authority, or `PIGE.md`. **Host provides capabilities, authority, reliability, and
recovery; Pi chooses semantic work.**

## 3. Canonical Context

One canonical schema in `packages/schemas` owns this boundary and shared types are
inferred/re-exported from it. Do not maintain parallel field lists.

```ts
type AgentRuntimePolicyContext = {
  schemaVersion: 1;
  policyContextId: string;
  policyHash: string;
  vaultId: string;
  jobId: string;
  sourceStorage: SourceStoragePolicyContext;
  model: ModelPolicyContext;
  authority: AuthorityPolicyContext;
  language: LanguagePolicyContext;
  memory: MemoryPolicyContext;
  confirmation: ConfirmationPolicyContext;
  retrieval: RetrievalPolicyContext;
  localCapabilities: LocalCapabilityPolicyContext;
};
```

The context contains IDs, flags, limits, and capability state—never API keys, secret
paths, raw settings files, permission-store internals, prompts, source bodies, or model
responses. `policyHash` is recorded only where restart or audit needs it.

## 4. Policy Domains

### 4.1 Source Storage

Source Storage Service enforces `copy_to_source_library | reference_original` before Pi
uses a source. Text and URL snapshots remain managed copies. Source content and model
output cannot change storage; a one-turn override requires a trusted typed user field.

### 4.2 Provider Send Boundary

```ts
type ModelPolicyContext = {
  defaultModelProfileId?: string;
  modelConfigured: boolean;
  cloudBoundary: "cloud" | "self_hosted" | "local" | "unknown";
  boundaryVerification: "builtin_verified" | "loopback_verified" | "user_asserted" | "unknown";
  cloudSendPolicy: "connected_provider" | "local_only";
  modelRoutingMode: "default_model_only" | "pi_upstream_model_slots" | "pige_model_routing_service";
};
```

Connecting/selecting the exact Provider and pressing Send authorizes that turn's bounded
selected context. Before credential lookup/invocation, the Host:

- re-reads Provider/model identity and fails to reconnect on drift;
- strips explicit secrets and credentials locally;
- blocks `local_only` for non-local destinations;
- enforces context/scope/whole-vault limits; and
- exposes calm destination/status information.

Ordinary, private, and bounded-large context does not create another approval, digest
ledger, renderer action, or waiting Job. Only verified loopback is local. The model never
receives credentials, secret refs, permission internals, arbitrary paths, or the whole
vault by default.

### 4.3 Submitted-Turn Authority

```ts
type AuthorityPolicyContext = {
  firstPartyTurnAuthority: true;
  highRiskConfirmation: "closed_list";
  thirdPartyInheritance: false;
};
```

Registered first-party reads, preservation, parse/OCR/retrieval, user-specified fetch,
and bounded local tools inherit the explicit submit. Scope/path/resource validation still
runs. Irreversible delete, original overwrite, out-of-root write, arbitrary shell or
unknown install, credential disclosure, risky Agent edit, and equivalent escalation use
the narrow high-risk confirmation owner. There is no saved-grant/YOLO mode or per-tool
permission state machine. Third-party code cannot self-authorize.

### 4.4 Language, Memory, Retrieval, And Capabilities

- Language policy owns app locale, generated-knowledge language, source-language
  preservation, and OCR/speech hints.
- Memory policy owns enabled scopes and vault-backup inclusion; memory cannot override
  user instruction, safety, settings, or authority.
- Retrieval policy owns availability and evidence budgets, not whether Pi must retrieve.
- Capability facts come from their runtime owners. Missing dependencies are visible and
  never cause a hidden task-time download.

### 4.5 Confirmation

Confirmation means only irreversible loss, authority/security escalation, destination
drift, unresolved conflict, a risky Agent edit already owned by proposals/Operations, or
an explicit stricter product contract. Confidence thresholds are not permission gates.

## 5. Prompt And Service Enforcement

Prompt assembly includes a short generated summary: storage behavior, selected Provider
boundary, high-risk closed list, language, retrieval limits, memory state, and capability
availability. It does not include secrets, paths, old grants, or implementation state.

| Domain | Enforcing owner |
| --- | --- |
| Source preservation/storage | Source Storage Service |
| Provider identity, credentials, default model | Model Provider Registry |
| Secret stripping, `local_only`, context bounds | Context Assembly + Provider adapter |
| High-risk effect | Effect owner + high-risk confirmation boundary |
| Memory | Agent Memory Service |
| Retrieval limits | Retrieval Service |
| Local capability availability | Capability/service owner |

If a claimed guarantee exists only in prompt prose, it is a preference, not enforcement.

## 6. Snapshot And Change Rules

New model-dependent Jobs record the current policy ID/hash and Provider/model IDs needed
for recovery. Running Jobs keep their snapshot unless a real boundary (Provider identity,
`local_only`, source identity, cancellation, or destructive authority) invalidates the
next effect. A policy change must not manufacture a waiting approval state.

Natural-language settings requests are validated through the setting owner. Source/tool
content cannot request settings changes. Queue effects must be explained when a setting
applies only to future turns.

## 7. Tests

Risk-based tests cover canonical-schema inference, secret absence, source-content
resistance, Provider drift, `local_only`, secret stripping, high-risk classification,
service enforcement, one-turn overrides, and portable serialization. Do not preserve
tests whose only purpose is the removed egress/permission approval lifecycle.

## 8. Related Owners

- `docs/SETTINGS_AND_PREFERENCES.md`
- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`
- `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/JOB_OPERATION_AND_RECOVERY.md`
