# Agent Memory Design

Status: Draft baseline
Date: 2026-07-09

## 1. Decision

Pige owns its Agent Memory Core, lifecycle, privacy, backup, UI and prompt authority.
Portable truth stays under `.pige/memory/`; rebuildable indexes stay under
`.pige/indexes/memory/`. External projects are references or curated packages, not the runtime.

## 2. What Memory Means In Pige

Memory differs from wiki knowledge, sources/artifacts and RAG. It holds preferences, corrections,
workflows, conventions and lessons, never hidden factual evidence; sources/wiki ground facts.

## 3. Options Reviewed

External memory projects inform layering, traceability and retrieval but never own Pige lifecycle.

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
- Settings lists <=1,000 safe atoms. Edit secret-scans then CAS-changes only L1 title/body; status,
  L0 and private provenance remain. Receipt/`update_memory`/Undo is replay/restart-adoptable;
  tampering closes and UI retains stale drafts.
- Enable/delete/reset use revision CAS. Delete/reset retain exact L0/L1 privately, record
  `trash_memory`, and Undo writes `restore_memory` without losing later facts; removed atoms leave recall.
- Export rechecks revision after Main's dialog and writes safe summaries; results are pathless.
  Autonomous/global and semantic memory remain open.

## 5. v0.1 Scope

Include vault-scoped explicit/correction/Operation memory, provenance, secret-before-write,
lifecycle/export and lexical recall. Defer persona, global/multi-user sync, task graphs,
external default runtimes and optional semantic recall until separately accepted.

## 6. References

Memory ecosystem sources and update policy are registered once in
[`TECH_ARCHITECTURE.md`](TECH_ARCHITECTURE.md#168-extension-package-and-reference-ecosystem).
