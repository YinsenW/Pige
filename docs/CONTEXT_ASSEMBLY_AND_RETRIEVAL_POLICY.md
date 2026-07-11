# Context Assembly And Retrieval Policy

Status: Draft baseline
Date: 2026-07-09

## 1. Purpose

This document defines how Pige selects, budgets, orders, cites, and packages context for Agent workflows.

Pige is not a generic chatbot that can stuff arbitrary history into a model prompt. It is a local-first knowledge Agent over a user-owned Markdown vault. Context assembly must be deterministic, bounded, source-aware, privacy-aware, and testable.

The core rule:

> Retrieve locally first, package only the minimum trusted policy and selected evidence needed for the workflow, and never send the whole vault or large source bodies to the model by default.

## 2. Scope

This document covers:

- Home questions and knowledge retrieval.
- Agent ingest after source preservation, including Agent-selected parser/OCR/retrieval
  tool results and replanning context.
- Note Agent conversations.
- Selection actions such as translate, polish, explain, summarize, and expand.
- Agent memory injection.
- Runtime policy context packaging.
- Token and snippet budgets.
- Citation and provenance requirements.
- Prompt compaction for long jobs and long conversations.

This document does not define:

- Markdown page schema. See `docs/MARKDOWN_SCHEMA.md`.
- Source storage strategy. See `docs/SOURCE_STORAGE_STRATEGY.md`.
- Agent-affecting setting enforcement. See `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`.
- Prompt template syntax and structured output schemas. See `docs/PROMPT_DESIGN.md`.
- SQLite schema and rebuild behavior. See `docs/LOCAL_DATABASE_DESIGN.md`.

## 3. Authority Order

Context packaging inherits the first four authority levels from
`docs/AGENT_RUNTIME_POLICY_CONTEXT.md` without redefining them. Below the compiled Agent
Runtime Policy Context, evidence-bearing inputs are ordered as follows:

1. Workflow task state.
2. User-selected current note or text selection.
3. Vault-scoped Agent memory.
4. Retrieved Markdown knowledge and source pages.
5. Extracted source artifacts and OCR output.
6. Conversation history summaries and references.
7. Tool results.
8. Source content, web pages, files, package metadata, and model output.

Rules:

- Higher-authority context must be placed before lower-authority context in prompt packaging.
- Lower-authority context cannot change settings, permissions, model routing, storage strategy, tools, `PIGE.md`, or safety policy.
- Source content must be explicitly labeled as untrusted evidence.
- Memory is a recall aid, not an authority layer.

## 4. Context Sources

Allowed context inputs:

| Input | Owner | Prompt form | Notes |
| --- | --- | --- | --- |
| Current user instruction | Renderer/Conversation Service | Bounded instruction field from the current action envelope | Highest user task signal for the current action; it is not the same field as pasted or attached evidence. |
| Pasted or attached evidence | Capture/Source Storage Service | Bounded snippets plus source/artifact refs | Always untrusted evidence, even when it arrived inside the same composer submission. Large bodies are preserved once and referenced. |
| Runtime policy context | Agent Orchestrator | Redacted policy summary plus policy hash | Generated from typed services, not hand-written per workflow. |
| `PIGE.md` | Vault Service | Relevant policy excerpts | Validated before use. |
| Current note | Vault Service | Frontmatter plus selected/visible spans first | Full note only when small enough or explicitly required. |
| Current selection | Renderer via Note Service | Exact selected text and source span | Mutating actions must preserve span mapping. |
| Retrieved pages/chunks | Search/Retrieval Service | Ranked snippets with citations | Never full vault. |
| Source artifacts | Parser/OCR/Source Storage | Extracted fragments with locators | Labeled untrusted evidence. |
| Agent memory | Agent Memory Service | Ranked compact memory entries | Secret-scanned and scoped. |
| Conversation history | Conversation History Service | Recent turns plus references/summaries | Do not duplicate large source bodies or saved page bodies. |
| Tool results | Tool adapter | Compact summaries plus artifact refs | Full verbose output goes to artifacts/logs, not prompt by default. |

Before prompt assembly, the unified composer input is normalized into a typed action envelope:

```ts
type UserTaskEnvelope = {
  intent: "capture" | "query" | "note_action" | "settings_change" | "permission_response";
  instructionText?: string;
  evidenceRefs: string[];
  currentSelectionRef?: string;
  trustedUserOverrideRefs: string[];
};
```

For capture intent, the captured body is evidence and is not promoted to `instructionText`. For query or note-action intent, the bounded user request is the instruction while pasted blocks, files, URLs, selections, and retrieved material remain evidence. Mixed submissions preserve the full source first, then keep only the minimal action wording as the instruction. Intent classification cannot authorize settings, permissions, provider changes, destructive writes, or secret use; those require typed tools and their owning confirmation or permission services.

Forbidden context inputs:

- Raw API keys, tokens, or secret store paths.
- Full settings files.
- Raw permission-store internals.
- Full vault contents.
- Full conversation history when summaries and references are enough.
- Large source bodies duplicated from source storage.
- Arbitrary renderer filesystem paths or database handles.

## 5. Retrieval Tool Internal Pipeline

This deterministic pipeline executes inside a scoped retrieval tool after Pi Agent asks
for retrieval, or directly for the explicit no-model search fallback. It ranks and
packages evidence; it does not decide the wider Agent workflow or automatically trigger
a knowledge write.

Home retrieval and Agent retrieval should follow this local-first pipeline:

1. Normalize the query and detect language.
2. Search titles, aliases, frontmatter, tags, topics, entities, citations, backlinks, and `index.md`.
3. Search SQLite FTS when available.
4. Search local vector indexes when the embedding model is installed and the index is ready.
5. Merge lexical, metadata, vector, recency, relationship, citation, and page-type signals.
6. Apply local reranking only when the reranker is installed, healthy, and fast enough.
7. Enforce diversity by page, source, topic, and time where useful.
8. Select snippets with locators and citation references.
9. Build a grounded answer context pack.
10. Return the bounded evidence/context pack to Pi Agent; the retrieval tool never calls
    a model or another tool.

Rules:

- Lexical and metadata retrieval must work before embedding model download.
- Vector retrieval improves ranking but is not the only retrieval path.
- The answer must not imply full-vault certainty unless the retrieval scope and index health support that claim.
- Search degraded states must be visible when relevant.
- CJK lexical fallback must not depend only on whitespace tokenization.

## 6. Retrieval Scope

Every retrieval request must declare scope:

```ts
type RetrievalScope =
  | { kind: "vault"; vaultId: string }
  | { kind: "current_note"; pageId: string }
  | { kind: "selection"; pageId: string; spanId: string }
  | { kind: "source"; sourceId: string }
  | { kind: "topic"; topicId: string }
  | { kind: "recent_activity"; since?: string };
```

Rules:

- Home questions default to vault scope.
- Note Agent questions default to current-note scope plus related-note expansion.
- Selection actions default to selection scope and may retrieve local neighbors only when useful.
- Ingest starts with the current preserved source. Related summaries enter only after
  the Agent selects a retrieval tool; parser/OCR evidence enters only from its selected
  tool result.
- Permissions and cloud-send policy can further narrow what may be sent to a cloud model.

## 7. Context Budget Classes

Context assembly should use budget classes, not ad hoc prompt lengths.

```ts
type ContextBudgetClass =
  | "capture_ingest"
  | "home_query"
  | "note_agent"
  | "selection_action"
  | "lint_or_repair"
  | "settings_policy_preview";
```

Budget rules:

- Reserve budget first for authority/safety, task, runtime policy context, output schema, and final answer.
- Allocate the remaining budget to current user input, current note/selection, retrieved snippets, memory, and tool summaries.
- Prefer snippets, summaries, and locators over full documents.
- Include full text only when the item is small enough and the workflow requires it.
- Hard-limit snippets per page and pages per source to avoid one long document crowding out all other evidence.
- Do not let conversation history consume the budget needed for source evidence.
- If budget is insufficient, reduce lower-authority context before removing citations, policy, task state, or schema.

Recommended v0.1 starting defaults:

| Budget class | Primary context | Default cap guidance |
| --- | --- | --- |
| `capture_ingest` | Current source fragments plus related summaries | Source fragments first, related notes second. |
| `home_query` | Ranked snippets across vault | 8-12 results, 1-3 snippets per result. |
| `note_agent` | Current note, backlinks, sources, related pages | Current note/selection first, vault expansion second. |
| `selection_action` | Selected span and local neighbors | Usually no vault-wide retrieval. |
| `lint_or_repair` | Metadata, links, citations, affected pages | Prefer reports and references over full bodies. |
| `settings_policy_preview` | Redacted policy summary | No source content. |

Exact token numbers should be configured per model profile and tested with realistic fixtures. The architecture requirement is the budgeting contract, not a single global number.

## 8. Context Pack Contract

The Agent Orchestrator should build a serializable context pack before prompt rendering.

```ts
type AgentContextPack = {
  schemaVersion: number;
  contextPackId: string;
  workflow: "ingest" | "query" | "note_agent" | "selection_action" | "lint" | "repair";
  budgetClass: ContextBudgetClass;
  retrievalScope: RetrievalScope;
  policyContextId: string;
  policyHash: string;
  indexHealth: ContextIndexHealth;
  authorityRefs: ContextItemRef[];
  taskStateRefs: ContextItemRef[];
  memoryRefs: ContextItemRef[];
  evidenceRefs: EvidenceContextRef[];
  conversationRefs: ContextItemRef[];
  toolResultRefs: ContextItemRef[];
  omitted: OmittedContextSummary[];
  warnings: ContextAssemblyWarning[];
};
```

```ts
type EvidenceContextRef = {
  refId: string;
  kind: "markdown_page" | "source_page" | "source_artifact" | "ocr_artifact" | "memory";
  pageId?: string;
  sourceId?: string;
  chunkId?: string;
  locator?: string;
  citationRefs: CitationRef[];
  score?: number;
  budgetTokens: number;
  trust: "trusted_policy" | "vault_knowledge" | "untrusted_source" | "memory" | "tool_result";
};
```

Rules:

- The context pack stores refs, scores, warnings, and budgets; it does not store full prompts by default.
- Job and operation records may store `contextPackId`, `policyHash`, and evidence refs for debugging and replay.
- Context pack IDs must be stable enough for diagnostics but do not need to be durable knowledge IDs.
- If a model call fails or is retried, retry should reuse or explicitly rebuild the context pack and record which happened.

Current `capture_ingest` bridge:

- `EvidenceAssemblyService` builds an in-memory `EvidencePack` from all eligible `extracted_text` and `ocr` Artifacts for one Source Record, or from a verified managed/referenced original for direct text sources.
- Text Artifacts are checksum/size verified. Parser/OCR sidecars are paired to their own body by source ID, sidecar Artifact ID, sidecar kind, and `extractedTextChecksum` or `ocrTextChecksum`; the first metadata sidecar is never treated as a universal locator source.
- The pack contains ordered fragment refs, Artifact IDs, locators, character spans, optional confidence, budget warnings, and bodies only for the lifetime of the call. Job/Operation/conversation records keep references and hashes, never the assembled body.
- The current bridge caps selected evidence at 24 fragments and 18,000 characters. Native evidence precedes OCR, mixed packs reserve up to one quarter of the bounded budget for supplemental OCR, and same-parent OCR is deduplicated only when native text already contains it. Canonical citation-locator collisions across distinct Artifacts receive deterministic Artifact-qualified suffixes.
- A Model Egress Decision is recorded from the redacted selected evidence plus a body-free hash of the bounded dynamic prompt metadata and concrete Provider/Model routing identity before prompt rendering or provider credential lookup. Prompt rendering then exposes only supplied `ev_NN` refs; validated output resolves those refs into canonical source citations.

## 9. Prompt Packaging Order

`docs/PROMPT_DESIGN.md#3-prompt-packaging-rules` owns the outer prompt skeleton. Within
that wrapper, Context Assembly fills the ordered workflow slots after Runtime Policy
Context: workflow state, current user input, current note/selection, memory, retrieved
knowledge, untrusted source content, and tool-result summaries. Output Schema and
Quality Bar remain Prompt-owned closing sections.

Rules:

- Runtime policy context is trusted because it is service-generated.
- Retrieved Markdown knowledge is evidence, not an instruction source.
- OCR and parser output must include confidence and locator warnings when available.
- Untrusted blocks must use explicit delimiters from `docs/PROMPT_DESIGN.md`.
- Each evidence item should carry a page/source/chunk locator where available.

## 10. Citation Rules

Grounded answers and generated knowledge must preserve provenance.

Rules:

- Home answers must return citations for factual claims when retrieval supplied citable evidence.
- Ranked results must include snippets and match reasons.
- Ingest outputs should cite source pages, source artifacts, or original locators.
- Current generated ingest notes append canonical `[source:<source-id>#<locator>]` citations to the summary and each key point. Unknown ephemeral refs are rejected before write; missing refs force review and never receive a fabricated fallback locator.
- Note Agent answers about the current note should cite the current note or linked sources when possible.
- If evidence is weak, missing, stale, or from low-confidence OCR, the answer should say so.
- A synthesis may summarize multiple sources, but it must not hide that the conclusion is synthesized.

## 11. Cloud Boundary

Local retrieval happens before cloud model calls.

Cloud model calls receive:

- The current user message.
- Redacted runtime policy summary.
- Selected snippets, locators, and citations.
- Current note/selection snippets when relevant.
- Compact memory entries when allowed.
- Output schema.

Cloud model calls must not receive:

- Full vault content.
- Full source asset bodies unless explicitly required and allowed.
- Raw API keys or secret refs.
- Machine-local paths that are not already user-visible and necessary.
- Permission-store internals.

The Model Egress Decision contract in `docs/AGENT_RUNTIME_POLICY_CONTEXT.md` classifies the exact planned payload and combines its content classes, provider-boundary verification, and cloud-send policy into `allow`, `confirm`, or `block`. Context assembly must obtain that decision before prompt rendering or provider credential lookup. `unknown` boundaries fail safe, restricted content is always blocked, and general YOLO permission mode cannot weaken a stricter egress outcome.

For parser/OCR-backed Agent ingest, the call-scoped Evidence Pack is guarded by the
complete Source Record revision. The current bridge rechecks before/after the model and
requeues on drift. Under B3.13, a stale tool result is returned to Pi Agent for replan or
stop; the host cannot choose replacement evidence or the next semantic call. Revision
data stays outside the model payload, and the write tool rechecks at commit.

## 12. Context Compaction

Long conversations and long jobs must compact context by reference.

Rules:

- Conversation compaction keeps source/page/job/proposal/operation refs, not duplicated bodies.
- Compaction must not drop unresolved proposals, source IDs, page IDs, citation refs, permission state, policy hash, or user-visible decisions.
- Summaries should say what was omitted when omission affects answer confidence.
- Job checkpoints should keep enough context refs to resume or explain work after restart.
- Raw prompt and provider response storage remains off by default.

## 13. Settings And Policy Interaction

Settings that affect Agent behavior are compiled into `AgentRuntimePolicyContext`; context assembly consumes that context.

Examples:

- Source storage strategy affects source record creation before ingest. Context assembly sees the resulting source refs and storage strategy; it does not choose where to put files.
- Cloud-send policy affects whether selected snippets can be sent to a provider or require confirmation.
- Default model affects model calls through Model Provider Registry and Agent Orchestrator.
- Permission mode affects tool call mediation, not just prompt prose.
- Language settings affect generated answer language and OCR/speech hints when services support them.
- Retrieval availability affects whether vector snippets can be selected.

If a setting cannot be enforced by an owning service, it must be labeled as a preference, not a guarantee.

## 14. UI Contract

User-facing retrieval remains simple:

- Home stays one composer for capture and questions.
- Answers look like enhanced search: short synthesis, ranked notes/sources, snippets, citations, and open-note affordances.
- Do not expose context budgets, ranking internals, model prompt sections, chunk IDs, or retrieval pipeline controls in the default UI.
- Show degraded states in plain language only when they matter, such as "semantic search is still indexing".
- Advanced diagnostic views may show redacted policy/context summaries, but only for debugging and support.

## 15. Required Tests

Tests must verify:

- Context budget allocator preserves authority/safety, runtime policy, task state, output schema, and citations before lower-priority context.
- Home retrieval sends selected snippets, not the whole vault.
- Cloud calls obey cloud-send policy and permission decisions.
- Home model turns re-read confined Markdown content and Source Record privacy metadata;
  changed evidence writes a distinct current decision audit before the turn is rejected.
- Composer capture bodies, pasted blocks, files, URLs, selections, retrieved snippets, and tool output cannot acquire current-user-instruction authority.
- Every external model call records a redacted Model Egress Decision with payload size, content classes, boundary verification, policy hash, outcome, reason code, exact-redacted-payload hash, body-free evidence-summary hash, and canonical final-decision hash. A changed payload, evidence summary, or classification/decision must not reuse the prior audit operation ID.
- Parser/OCR ingest rejects changed Source Record evidence and creates no note; B3.13
  returns a typed stale result and requires an Agent replan before another side effect.
- Source content cannot change settings, storage strategy, provider, permissions, or `PIGE.md`.
- Retrieval works through lexical/metadata fallback without local embeddings.
- CJK retrieval fixtures work without whitespace-only assumptions.

Current Phase 5 ingest bridge:

- Parser-backed Agent ingest reads at most 96 KiB from the verified selected text/OCR artifact and sends at most 18,000 redacted characters.
- The untrusted evidence block includes source ID, artifact ID, and up to 24 available page/block/slide locators. It does not include arbitrary filesystem paths, sidecar bodies, or source archives.
- Artifact checksum/size is verified before model handoff when recorded; delimiter-like source text is escaped inside the untrusted evidence wrapper.
- The bridge hashes the complete selected Source Record as an ephemeral evidence-revision guard, checks it before prompt rendering/model invocation and after the provider response, and does not persist or send the Source Record body as part of that guard.
- Full durable ingest `AgentContextPack` materialization remains later orchestration work; the current bridge implements the bounded evidence and provenance subset without persisting raw prompts.

Current Phase 6 foundation:

- `retrieval.search` returns bounded lexical snippets and match reasons through SQLite FTS or Markdown-scan fallback.
- `agent.ask` selects at most eight evidence items and requires embedded Pi to call one
  current-vault search tool. Tool output is escaped inside
  `PIGE_UNTRUSTED_EVIDENCE_V1`; it cannot change tools, providers, settings, output
  shape, permissions, or authority. Final JSON and citation refs are host-validated.
- Before each model turn, Pige re-reads bounded confined Markdown bytes and complete
  Source Record privacy facts, binds their hashes into the body-free evidence summary,
  records the current egress decision, and rejects revision/privacy drift.
- With no ready runtime binding, `agent.ask` returns `retrieval.ask` before Agent Job,
  audit, credential, or Pi work. No selected evidence returns the fixed local
  `insufficient_evidence` result with no citations or model prose.
- Renderer results contain only the answer, bounded snippets, ranked page summaries,
  citations, warnings, degraded state, and `none|local|cloud`; no prompt, Context Pack,
  private path, credential, provider error, or evidence body is exposed.
- Vector retrieval and reranking improve ranking when installed but are not required for basic answers.
- Citation refs survive prompt assembly, model output validation, conversation compaction, and job retry.
- Memory injection is scoped, ranked, secret-scanned, and lower authority than explicit user instruction.
- Long conversation history is summarized by references and does not duplicate source or note bodies.
- Prompt snapshots redact secrets and include expected policy/context sections.
- Context pack serialization works for future remote Agent backend and Mobile Lite clients without desktop-only objects.

## 16. Traceability

Related documents:

- `docs/PRD.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/PROMPT_DESIGN.md`
- `docs/AGENT_RUNTIME_POLICY_CONTEXT.md`
- `docs/SETTINGS_AND_PREFERENCES.md`
- `docs/PERFORMANCE_AND_RELIABILITY.md`
- `docs/API_AND_IPC_DESIGN.md`
- `docs/LOCAL_DATABASE_DESIGN.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/SPEC_TRACEABILITY.md`
