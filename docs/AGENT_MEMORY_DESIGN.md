# Agent Memory Design

Status: Draft baseline
Date: 2026-07-09

## 1. Decision

Pige should implement a Pige-native Agent Memory Core.

External memory projects should be used as references or optional curated packages, not as the default runtime.

Pige owns vault lifecycle, privacy, backup, UI and prompt authority. It borrows layered,
Markdown-readable, secret-scanned recall ideas from external projects, stores portable
truth under `.pige/memory/`, and keeps indexes rebuildable under `.pige/indexes/memory/`.

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

| Reference | Useful idea | Why not the default |
| --- | --- | --- |
| TencentDB Agent Memory | L0-L3 layering and traceability | Own gateway/runtime lifecycle exceeds Pige's product boundary. |
| `pi-hermes-memory` | Pi-native FTS, secret scan and consolidation | Coding-session conventions overlap Pige vault/review ownership. |
| `pi-memctx` / `pi-memory` | Inspectable Markdown and compact injection | Lacks Pige backup, review and knowledge integration. |
| Engram | Agent-neutral local FTS substrate | Adds binary/API/cloud surface before Pige needs it. |

They remain references or later reviewed optional packages, never the default core.

## 4. Chosen Architecture

### 4.1 Memory Layers

- L0 events: attributable explicit requests, accepted corrections/Operations, failures and outcomes.
- L1 atoms: concise preferences, corrections and lessons.
- L2 scenarios: recurring contextual workflows.
- L3 profile: a small explainable summary.

### 4.2 Storage

```txt
.pige/memory/
  registry.json
  profile.md
  scenarios/
  atoms/
.pige/indexes/memory/
  fts/
  vectors/
  memory-manifest.json
```

`registry.json` atomically owns revisioned L0/L1 truth; `atoms/*.md` is an inspectable
projection only. Vault memory is portable and backed up unless excluded; indexes rebuild.

### 4.3 Explicit Preference Foundation

- Only `memory.vaultMemoryEnabled` plus durable `explicit_user_task` exposes
  `pige_remember_preference`; neutral/legacy/current-note and source/model/tool content do not.
- Secret scan precedes one L0 `explicit_remember` plus one active L1 atom. A durable user
  event owns one stable effect ID independent of model text/date; retry adopts it and may
  repair its projection. Loader rejects duplicate, unbound or mismatched L0/L1 provenance.
- Registry replacement uses a unique same-directory temp, file sync, rename and directory
  sync; stale temp files cannot wedge later writes. Private conversation/user-event/Job IDs
  stay in Main. Renderer gets at most 1,000 bounded safe summaries.
- Enabled Home recall adds at most eight recently updated active atoms as lower-authority
  user context, never system policy. Current instruction, `PIGE.md`, settings and safety win.
- Settings CAS-disable returns `committed | stale | not_found` plus current summary;
  disabled atoms leave subsequent recall.

No autonomous/global memory, edit, re-enable, delete, export, reset, semantic recall or
new permission mode ships here.

## 5. v0.1 Scope

Include vault-scoped explicit/correction/Operation memory; provenance; secret-before-write;
inspect/disable/delete/export/reset; lexical recall; and optional Local RAG semantic recall.
Defer full persona modeling, global sync, multi-user memory, task-graph UI, and any external
default memory runtime.

## 6. References

Memory ecosystem sources and update policy are registered once in
[`TECH_ARCHITECTURE.md`](TECH_ARCHITECTURE.md#168-extension-package-and-reference-ecosystem).
