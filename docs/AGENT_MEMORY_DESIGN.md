# Agent Memory Design

Status: Draft baseline
Date: 2026-07-09

## 1. Decision

Pige should implement a Pige-native Agent Memory Core.

External memory projects should be used as references or optional curated packages, not as the default runtime.

Recommended stance:

- Build native memory into Pige's Agent orchestration layer.
- Borrow TencentDB Agent Memory's layered design: events, atoms, scenarios, and compact profile.
- Borrow Pi memory packages' practical ideas: Markdown-readable memory, session search, secret scanning, auto-consolidation, and context injection.
- Reuse Pige's Local RAG Pack for semantic memory recall.
- Store vault-scoped memory as local inspectable text under `.pige/memory/`.
- Store memory indexes as rebuildable caches under `.pige/indexes/memory/`.

Why:

- Pige is a personal knowledge management product, not a general Agent runtime.
- Memory must respect Pige's vault model, confirmation gates, backup/restore rules, privacy settings, and UI.
- A third-party memory package would bring its own lifecycle, storage conventions, prompt behavior, and permissions.

## 2. What Memory Means In Pige

Memory is not the same as the wiki.

- Wiki: durable knowledge pages the user can read and browse.
- Sources: preserved evidence and extracted artifacts.
- RAG: retrieval over wiki, sources, artifacts, and selected memory records.
- Agent Memory: preferences, corrections, recurring workflows, vault conventions, and lessons that help Pige behave better over time.

Memory should help with questions like:

- How does this user prefer summaries to look?
- Which note naming and linking conventions are stable in this vault?
- What did the user correct before?
- What Agent mistake should not be repeated?
- Which workflow usually applies to article captures, PDF research, or meeting notes?

Memory should not become hidden factual evidence. If Pige answers a factual question, sources and wiki pages should remain the default grounding layer.

## 3. Options Reviewed

### 3.1 TencentDB Agent Memory

Strengths:

- Strong layered memory philosophy.
- Local-first design with SQLite and sqlite-vec.
- L0 conversation, L1 atom, L2 scenario, and L3 persona pyramid.
- Traceability from high-level memory back to source evidence.
- Symbolic short-term context offload for long Agent tasks.

Risks for Pige default:

- Built primarily as an OpenClaw/Hermes plugin.
- Uses its own gateway, environment variables, patch scripts, and runtime lifecycle.
- Its default integration surface is broader and lower-level than Pige's product needs.
- Direct integration would make Pige's confirmation, vault, backup, and UI boundaries harder to enforce.

Pige use:

- Architecture reference.
- Possible later adapter or optional advanced package after review.

### 3.2 `pi-hermes-memory`

Strengths:

- Pi-native package.
- Persistent memory plus session search.
- SQLite FTS5 search.
- Secret scanning.
- Auto-consolidation.
- Procedural skills and failure memory.

Risks for Pige default:

- Optimized for Pi coding-agent sessions, not Pige's knowledge product.
- Owns its own memory conventions and injection behavior.
- Could overlap with Pige-native review and vault rules.

Pige use:

- Strong reference for memory safety, secret scanning, session search, and consolidation.
- Candidate optional curated package, but not default memory core.

### 3.3 `pi-memctx` And `pi-memory`

Strengths:

- Markdown-first memory files.
- Local, inspectable, grep-friendly records.
- Compact relevant context injection.
- Better alignment with Pige's local Markdown philosophy.

Risks for Pige default:

- Still coding-agent-specific.
- Not enough product-level integration with Pige's review gates, backup choices, and knowledge graph.

Pige use:

- Good reference for file layout, memory packs, and simple context injection.

### 3.4 Engram

Strengths:

- Agent-agnostic local memory.
- Single Go binary.
- SQLite and FTS5.
- MCP server, HTTP API, CLI, and TUI.
- Works across many agent clients.

Risks for Pige default:

- More of a general cross-agent memory substrate than a Pige-specific product layer.
- Optional cloud path may complicate Pige's default local-first message.
- Adds another binary/runtime surface before Pige needs it.

Pige use:

- Possible optional advanced integration or reference for local memory tooling.

## 4. Chosen Architecture

### 4.1 Memory Layers

L0 Events:

- Append-only records of memory-worthy interactions.
- Examples: user correction, accepted confirmation proposal, repeated Agent failure, completed workflow, explicit remember command.

L1 Atoms:

- Small, stable memory units.
- Examples: "User prefers short source summaries", "Do not auto-merge imported book highlights", "Use company topic pages in this vault".

L2 Scenarios:

- Recurring workflows and situational patterns.
- Examples: article capture workflow, PDF research workflow, meeting note cleanup workflow, citation style workflow.

L3 Profile And Policy:

- Compact summary used by the Agent when relevant.
- Must be small, explainable, and editable.

### 4.2 Storage

```txt
.pige/memory/
  profile.md
  scenarios/
  atoms/
  events/
.pige/indexes/memory/
  fts/
  vectors/
  memory-manifest.json
```

Rules:

- Vault-scoped memory lives inside the vault and is included in backups unless the user excludes it.
- Global user/device memory lives outside the vault and is not included in vault backups by default.
- Indexes are rebuildable caches.
- Memory must remain inspectable and editable by the user.

### 4.3 Write Policy

Direct writes:

- Explicit "remember this" commands.
- User-authored memory edits in Settings.

Candidate writes:

- Accepted corrections.
- Accepted confirmation proposals.
- Repeated Agent failures.
- Stable workflow patterns.

Confirmation-required writes:

- Sensitive personal facts.
- Identity-level claims.
- Broad behavioral policies.
- Memories that affect many future actions.
- Low-confidence inferences.

Blocked writes:

- API keys, tokens, private credentials, and obvious secrets.
- Unsupported inferences about the user.
- Memories that conflict with explicit settings or vault schema.

### 4.4 Recall Policy

Before an Agent action, Pige prepares a compact MemoryContext:

- L3 profile summary.
- Relevant L2 scenarios.
- Relevant L1 atoms.
- Reasons why each memory was selected.
- Token budget.

Rules:

- Current user instruction wins over memory.
- Explicit settings and `PIGE.md` win over inferred memory.
- Memory should influence style, workflow, and behavior, not replace factual grounding.
- If memory materially affects an action, Pige should expose a short reason in activity, confirmation, or operation logs.

## 5. v0.1 Scope

Include:

- Pige-native vault-scoped memory.
- Explicit "remember this".
- Memory from accepted corrections and confirmation proposals.
- Inspect, disable, delete, export, and reset controls.
- Secret scanning before persistence.
- Lexical recall.
- Optional semantic recall through the Local RAG Pack.

Defer:

- Fully automatic persona modeling.
- Cross-vault global memory sync.
- Multi-user/team memory.
- Mermaid symbolic task graph UI.
- Direct default dependency on TencentDB Agent Memory, `pi-hermes-memory`, Engram, or other memory packages.

## 6. References

Memory ecosystem sources and update policy are registered once in
[`TECH_ARCHITECTURE.md`](TECH_ARCHITECTURE.md#168-extension-package-and-reference-ecosystem).
