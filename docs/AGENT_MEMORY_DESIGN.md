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

### 4.3 Vault-Scoped Authored Memory

- Only `memory.vaultMemoryEnabled` plus durable `explicit_user_task` exposes
  `pige_remember_authored_memory`; neutral/legacy/current-note and source/model/tool content do not.
  It may persist one exact substring from the current authored turn as a stable preference,
  correction or reusable workflow lesson. Source facts, model/tool content and one-off tasks are ineligible.
- Secret scan precedes one L0 `explicit_remember` or `authored_statement` plus one active L1 atom. A durable user
  event owns one stable effect ID independent of model text/date; retry adopts it and may
  repair its projection. Loader rejects duplicate, unbound or mismatched L0/L1 provenance.
- Host validation rejects credential-like or authority-changing authored quotes before effect.
  Those cases require explicit Settings intervention and Memory never changes runtime policy,
  permissions or confirmation rules. Autonomous creation records one `create_memory` Operation;
  Activity Undo removes the exact atom and restart adopts a prepared or committed receipt once.
- Registry replacement uses a unique same-directory temp, file sync, rename and directory
  sync; stale temp files cannot wedge later writes. Private conversation/user-event/Job IDs
  stay in Main. Renderer gets at most 1,000 bounded safe summaries.
- Enabled Home recall adds at most eight recently updated active atoms as lower-authority
  user context, never system policy. Current instruction, `PIGE.md`, settings and safety win.
- Settings lists <=1,000 safe atoms. Edit secret-scans then CAS-changes only L1 title/body; status,
  L0 and private provenance remain. Receipt/`update_memory` and matching Activity Undo/Redo are
  replay/restart-adoptable across repeated cycles; tampering closes and UI retains stale drafts.
- Enable/delete/reset use revision CAS. Delete/reset retain exact L0/L1 privately, record
  `trash_memory`, and Undo/Redo writes deterministic forward Operations without losing later facts;
  removed atoms leave recall. Settings can directly list eligible single-delete trash as body/path-free
  title/kind/time summaries and reset receipts as count/time groups; restore binds the exact current
  delete or reset Operation and reuses the same `restore_memory` restart owner.
- Export rechecks revision after Main's dialog and writes safe summaries; results are pathless.
- Backup binds the exact registry revision/checksum, lifecycle receipts, restore intents and
  linked Operations; restore revalidates those bindings before publication. Active records
  remain recallable, disabled/trashed records stay excluded, and the bound is 1,000 records.
  A visible vault-portable preference includes memory by default and applies to the next
  Backup only. Disabling it removes registry/projections, memory trash, lifecycle receipts,
  restore intents, and memory Operations from the archive while keeping the manifest truthful.
  Preference mutation is revision-fenced, blocked during active Backup work, and recorded as
  one pathless `change_setting` Operation; it never enters Agent prompt policy.
  Global and semantic memory remain deferred; v0.1 vault-scoped authored memory is implemented.

## 5. v0.1 Scope

Include vault-scoped explicit/authored correction/Operation memory, provenance, secret-before-write,
lifecycle/export and lexical recall. Defer persona, global/multi-user sync, task graphs,
external default runtimes and optional semantic recall until separately accepted.

## 6. References

Memory ecosystem sources and update policy are registered once in
[`TECH_ARCHITECTURE.md`](TECH_ARCHITECTURE.md#168-extension-package-and-reference-ecosystem).
