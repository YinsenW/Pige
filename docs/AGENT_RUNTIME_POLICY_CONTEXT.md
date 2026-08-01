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
  modelRoutingMode: "default_model_only" | "pi_upstream_model_slots" | "pige_model_routing_service";
};
```

Connecting/selecting the exact Provider and pressing Send authorizes that turn's bounded
selected context. Before credential lookup/invocation, the Host:

- re-reads Provider/model identity and fails to reconnect on drift;
- enforces context/scope/whole-vault limits; and
- preserves the exact user-authored and explicitly selected payload without content
  classification, redaction, or rewriting;
- uses trimming only to classify an authored text field as empty; once non-empty, its
  original string (including leading/trailing whitespace and line breaks) owns durable
  conversation input, input identity/hash, history, retry/restart and Provider payload;
- leaves selected bounded-context text unchanged after selection and bounding;
- constructs authentication from the secret store without exposing or injecting the
  stored credential into payload content; and
- exposes calm destination/status information.

Ordinary, private, and bounded-large context does not create another approval, digest
ledger, renderer action, or waiting Job. Only verified loopback is local. The model never
receives credentials, secret refs, permission internals, arbitrary paths, or the whole
vault by default.

Text-only whitespace creates no turn. Attachment-only preserves exact identities and uses
the six-locale “Use only the attached file(s) as source material.” Its exact-source catalog
excludes parent/sibling/cwd and ambient tools; confirmation cannot add them. Text-only
tasks retain high-risk confirmation. Only nonempty durable authored text may expose exact
HTTPS Skill staging; Host candidate and turn/Job/vault fences stage review, never install.

### 4.3 Submitted-Turn Authority

```ts
type AuthorityPolicyContext = {
  firstPartyTurnAuthority: true;
  highRiskConfirmation: "closed_list";
  permissionMode: "ask_every_time" | "remember_scoped_grants" | "yolo_full_access";
  permissionPolicyRevision: number;
  thirdPartyInheritance: false;
};
```

Registered first-party work inherits Submit; validation still runs. Policy Context carries
mode/revision, never grant matchers. Permission Policy enforces Ask, scoped grants, or YOLO
before sensitive effects. YOLO removes eligible prompts, not validation; permanent loss,
original overwrite, raw credentials, risky edits, protected authority, OS/SSRF/signature/path
safety stay non-reusable. Third-party content cannot authorize or select a mode.

### 4.4 Language, Memory, Retrieval, And Capabilities

- Language policy owns app locale, generated-knowledge language, source-language
  preservation and OCR/speech hints. `generatedKnowledgeLanguage` is `preserve_source |
  follow_query | app_locale` (legacy: preserve); Appearance binds it and locale into new Job
  hashes; Home/ingest instruct generation without translating source bodies.
- Memory policy owns enabled scopes and vault-backup inclusion; memory cannot override
  user instruction, safety, settings, or authority.
- Retrieval policy owns availability and evidence budgets, not whether Pi must retrieve.
- Capability facts come from their runtime owners. Missing dependencies are visible and
  never cause a hidden task-time download.
- `localCapabilities.excludeLowConfidenceOcrFromSummaries` snapshots the machine-local
  default-on OCR summary setting into each new Job. The ingest owner removes OCR fragments
  below confidence `0.65` from model evidence without deleting the source image or OCR Artifact.

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
| Generated knowledge language | Appearance Service + Agent Orchestrator |
| Exact selected payload and context bounds | Context Assembly + Provider adapter |
| High-risk effect | Effect owner + high-risk confirmation boundary |
| Memory | Agent Memory Service |
| Retrieval limits | Retrieval Service |
| Local capability availability | Capability/service owner |

If a claimed guarantee exists only in prompt prose, it is a preference, not enforcement.

## 6. Snapshot And Change Rules

New model-dependent Jobs record the current policy ID/hash and Provider/model IDs needed
for recovery. Running Jobs keep their snapshot unless a real boundary (Provider identity,
source identity, cancellation, or destructive authority) invalidates the next effect. A
policy change must not manufacture a waiting approval state.

Natural-language settings requests are validated through the setting owner. Source/tool
content cannot request settings changes. Queue effects must be explained when a setting
applies only to future turns.

## 7. Tests

Risk-based tests cover canonical-schema inference, stored-credential non-injection,
exact-payload preservation, source-content resistance, Provider drift, bounded context,
high-risk classification, service enforcement, and portable serialization. Do not
preserve tests whose only purpose is removed egress/content-policy/permission lifecycles.

## 8. Related Owners

- `docs/SETTINGS_AND_PREFERENCES.md`
- `docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md`
- `docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/JOB_OPERATION_AND_RECOVERY.md`
