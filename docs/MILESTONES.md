# Pige Milestones

Status: Active release plan
Baseline date: 2026-07-09
Last revised: 2026-07-11

## 1. Release Philosophy

Pige's first public version is a usable local-first general personal Agent, not a thin proof.

`v0.1 Public Alpha` must converse through a real Provider/Pi path, use personal knowledge
when relevant, preserve real sources for several days, recover, and expose owned Markdown.

Quality bar:

- No data loss in normal use.
- No hidden cloud account requirement.
- No silent destructive Agent edits.
- No capture that disappears because parsing or model calls fail.
- No demo-only storage layer.
- No dev-server-only experience for normal users.
- No hidden dependency download during ordinary capture, ingest, search, or review.
- No permissionless external Skill/package action that reads outside scope, writes, deletes, calls network, runs shell, changes settings, or touches secrets.

Scope discipline:

- The v0.1 scope below is the public-alpha release target, not a single implementation slice.
- Milestones are ordered so each phase leaves behind a usable, inspectable product surface rather than a disconnected demo.
- Future AI agents should use milestone acceptance criteria to choose the current task boundary. They should not attempt the whole PRD P0 list in one pass.
- If a scope item changes priority, update PRD, this file, the implementation playbook, spec traceability, and the decision log together.

## 2. v0.1 Public Alpha Scope

`docs/PRD.md` owns the complete P0 feature scope, and `docs/SPEC_TRACEABILITY.md` plus the acceptance manifest own its stable requirement, delivery, status, and evidence mapping. This release plan does not copy those lists.

For milestone planning, v0.1 is a local-first desktop Agent: BYOK/Pi conversation and
optional local knowledge must work; sources survive failure; Markdown stays portable;
risky actions remain reviewable; release hardening closes the product.

Platform scope remains macOS 26+, Windows 11, and Windows 10 when release tests pass; Linux and the items in section 5 remain deferred.

## 3. Canonical Phase-To-Milestone Crosswalk

Milestones describe release outcomes; they are not an alternative implementation sequence. Phase numbers and phase exit criteria are owned only by `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`. The table below is the sole normative crosswalk. Do not infer another mapping from similarly named sections in architecture or historical documents.

The relationship is intentionally not one-to-one: M5 requires four implementation phases, while Phase 9 closes both the safety outcome in M6 and the release outcome in M7.

| Playbook phase | Milestone gate | Relationship |
| --- | --- | --- |
| P0 | M0 | Repository and verification foundation |
| P1 | M1 | Desktop shell, vault, settings, and runtime foundations |
| P2 | M2 | Capture preservation, local dictation, jobs, retry, and progress |
| P3 | M3 | BYOK, unified Home ingress, and the Pi Agent tool-loop spine |
| P4 | M5 | Rebuildable database, lexical search, Library, and graph foundations |
| P5 | M4 | URL, document, image, parser, artifact, and OCR tool breadth |
| P6 | M5 | Retrieval, local RAG, reader/editing, backlinks, and Knowledge Tree |
| P7 | M5 | Confirmation, operations, memory, and conversation lifecycle |
| P8 | M5 | Skills, complete curated Pi package lifecycle, and permissions |
| P9 | M6, M7 | Backup/restore, Knowledge Health, migration, accessibility, localization, packaging, update, and release evidence |

An in-flight implementation task keeps its current Playbook phase. This crosswalk does not renumber work, invalidate completed evidence, or require a running development thread to restart. New tasks and handoffs use this table; old milestone wording may be translated once at the next natural task boundary.

## 4. Milestone Plan

Each milestone owns a release outcome and its human acceptance boundary. Detailed deliverables are derived from the stable Requirement-to-Build-to-Exit mapping in `docs/SPEC_TRACEABILITY.md`, `resources/traceability/acceptance.manifest.json`, and `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`; they are not copied here.

### M0: Project Foundation

Outcome:

- Repository is ready for open-source development.

### M1: Desktop Shell And Vault Foundation

Outcome:

- Pige opens as a real desktop app and can create a local vault.

Acceptance:

- A user can install/run the app, create a vault, see minimal Home, and inspect vault files.
- A user can find the local note storage location from Settings and reveal it in Finder/File Explorer.
- The app can create, migrate, reset, and rebuild the local vault database without deleting Markdown knowledge files, source records, or source assets.
- The app can report that the bundled core toolchain is ready or needs repair.
- The app language can be switched among the six v0.1 locales without hard-coded UI text appearing in core screens.
- The secret-storage adapter can protect a synthetic value through OS keychain or encrypted local storage without writing it to the vault; M3 proves provider API keys and the explicit portable/developer warning flow end to end.
- Machine-local settings are not written into `.pige/manifest.json` or default vault backups.
- Default diagnostics export contains no secrets or source/note bodies and requires explicit user action.
- API, Job, diagnostic, and UI failure records use the same stable namespaced code, localized message key, retryability, and user action; malformed or unstructured error records are rejected.
- Development type-checking works with TypeScript 7, with TypeScript 6 compatibility retained only for tools that require the older compiler API.

### M2: Capture Reliability

Outcome:

- User captures never disappear.

Acceptance:

- Killing and reopening the app does not lose queued or partially processed captures.

### M3: BYOK And General Agent Spine

Outcome:

- One configured Provider/Global Default powers ordinary Home conversation,
  knowledge-enhanced answers, and preserved-source tools through embedded Pi.

Acceptance:

- A deterministic vertical fixture proves Pi Agent chooses an inspection/extraction
  tool, evaluates its typed result, and triggers a validated cited Markdown write.
- Empty-vault chat can answer without tools; a relevant prompt triggers cited local
  retrieval; text/URL/file input uses the same Pi ingress without Host heuristics.
- Without a model, the user turn and sources wait durably; no substitute workflow runs.

### M4: Web And Document Ingest

Outcome:

- Pige expands the proven Agent tool spine to the common real-world inputs users throw
  at it; format breadth does not create another semantic orchestration layer.

Acceptance:

- A user can paste an article URL and drop a PDF/DOCX/PPTX/image, then find useful generated notes and source pages.
- An image-only PDF page or screenshot becomes searchable when OCR is available.
- Common document ingest does not trigger a runtime dependency download.

### M5: Knowledge Navigation And Confirmation

Outcome:

- The generated wiki is browsable and controllable.
- Knowledge can be retrieved through natural language search, ranked notes, and grounded summaries.

Acceptance:

- User can ask a natural language question, see relevant notes, read a grounded summary, open source notes, use the Note Agent on an opened note, and approve or reject risky changes.
- User can get semantic results without configuring an embedding or reranking provider.
- User can explicitly ask Pige in chat to install a Skill link or file, inspect the staged Skill, enable it, and approve or deny sensitive runtime capabilities.
- User can inspect and manage curated Pi packages without the Agent installing packages during ordinary jobs.
- User can navigate the simple Knowledge Tree and return to source-backed notes without exposing advanced graph analytics.
- Markdown edits preserve valid frontmatter, wiki links, citations, and clean portable source files.
- User can remember a scoped preference, inspect its provenance, disable or delete it, and reopen compacted conversation history without losing source/job/operation references.

### M6: Backup, Restore, And Knowledge Health

Outcome:

- Pige is safe enough for early real use.

Acceptance:

- A vault can be backed up, restored into a fresh folder, and searched again after index rebuild without losing notes, sources, artifacts, vault-scoped memory, conversation history, proposals, or applied operation summaries.
- Knowledge Health deterministically reports broken links, orphan pages, duplicate-topic candidates, and unsourced claims; suggested repairs remain reviewable and do not silently rewrite durable pages.

### M7: Public Alpha Hardening

Outcome:

- v0.1 is usable by early adopters without hand-holding.

Acceptance:

- The Public Alpha usability scenario proves that a real user can capture at least 25 mixed sources over several sessions, recover from common failures, back up the vault, restore it, search again, and continue working.
- Release evidence includes six-locale workflow smoke results and the v0.1 accessibility baseline.
- Release evidence records the installer-size, 10,000-page/100,000-chunk scale, idle/active-memory thresholds, release notes, dependency/license attribution, and signing/notarization result when credentials are available.

## 5. Deferred From v0.1

These should not block the first highly usable version:

- Cloud sync.
- Browser extension.
- Mobile app.
- Team collaboration.
- Advanced graph visualization.
- Saved query dashboards.
- Advanced compare mode across many notes.
- Unreviewed open plugin marketplace beyond curated Pi package management.
- Full visual diff editor.
- Perfect extraction for every file type.
- Advanced local model marketplace and tuning UI beyond the required Local Tools controls.

## 6. Release Closure

Pige can ship `v0.1 Public Alpha` only when all mapped P0 Requirements and Exits are `verified`, the M7 acceptance outcomes above have current evidence, and the scripted release scenario passes. Exact status, open work, evidence selectors, and phase-state closure are owned and machine-checked by `resources/traceability/acceptance.manifest.json`; this document does not maintain a parallel checklist.
