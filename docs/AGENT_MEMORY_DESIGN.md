# Agent Memory Design

Status: Draft baseline
Date: 2026-07-09

## 1. Decision

Pige owns its Agent Memory Core, lifecycle, privacy, backup, UI and prompt authority.
Portable truth stays under `.pige/memory/`; rebuildable indexes stay under
`.pige/indexes/memory/`. External projects are references or curated packages, not the runtime.

## 2. What Memory Means In Pige

Memory differs from browsable wiki knowledge, preserved sources/artifacts and RAG retrieval.
It holds preferences, corrections, recurring workflows, vault conventions and lessons.

Memory captures stable preferences, corrections, vault conventions and workflow lessons. It is
not hidden factual evidence; sources and wiki pages remain the grounding layer for factual answers.

## 3. Options Reviewed

TencentDB Agent Memory, `pi-hermes-memory`, `pi-memctx`/`pi-memory` and Engram inform
layering, traceability, inspectability and local retrieval, but do not own Pige vault/runtime lifecycle.

## 4. Chosen Architecture

### 4.1 Memory Layers

L0 events retain attributable requests/outcomes; L1 atoms retain concise preferences/corrections;
L2 scenarios retain recurring workflows; L3 is a small explainable profile.

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
- Settings lists at most 1,000 safe atoms and keeps disable compatible. Enable/delete/reset use
  exact vault/request/revision CAS; committed mutations return safe Operation identity/current
  summary. Delete/reset move exact L0/L1 facts into private receipts/trash and record
  `trash_memory`; deterministic Activity Undo records `restore_memory`, merges only missing exact
  facts, preserves later memory, and is restart-adoptable. Disabled/deleted atoms leave recall.
- Export rechecks the exact revision after Main's save dialog and writes safe inspectable summaries
  only. Renderer sees pathless `exported | cancelled | stale | failed`, never destination/private
  provenance. Edit, autonomous/global memory, semantic recall and new permission modes remain open.

## 5. v0.1 Scope

Include vault-scoped explicit/correction/Operation memory, provenance, secret-before-write,
lifecycle/export and lexical recall. Defer persona, global/multi-user sync, task graphs,
external default runtimes and optional semantic recall until separately accepted.

## 6. References

Memory ecosystem sources and update policy are registered once in
[`TECH_ARCHITECTURE.md`](TECH_ARCHITECTURE.md#168-extension-package-and-reference-ecosystem).
