# AI Development Guide

Status: Active implementation guide
Baseline date: 2026-07-09
Last revised: 2026-07-10

## 1. Purpose

Pige is expected to be built with repeated AI-assisted development sessions. This guide tells future agents how to use the design baseline without losing the product shape as context changes.

The goal is not to make every task slow. The goal is to give each task the smallest complete context pack that prevents common AI failures:

- Implementing a feature without its data ownership rules.
- Adding UI without matching the interaction model.
- Adding a parser or tool without recording dependency, license, update, and backup behavior.
- Treating a cache as user-owned truth.
- Sending private data to a cloud model without the configured boundary.
- Adding external Skill capability without Permission Broker enforcement.
- Writing a local feature that blocks future sync.

## 2. Agent Operating Loop

Every non-trivial implementation task should follow this loop:

1. Clarify the target slice.
2. Build a context pack from `docs/START_HERE_FOR_AI_AGENTS.md`.
3. Identify the owning service, durable data owner, and user-visible workflow.
4. Implement the smallest vertical slice that can be tested.
5. Add or update tests and fixtures.
6. Update relevant design docs if behavior, dependencies, schemas, permissions, or release assumptions changed.
7. Report what changed, what was verified, and what remains risky.

Do not start with broad refactors. Pige should grow by vertical slices that preserve capture, data safety, and user trust.

## 3. Bounded Design Iterations

Each design iteration should state:

- The question or risk being examined.
- The owner documents that may change.
- The expected artifact, such as a decision, a doc patch, a checklist update, or a backlog item.
- The exit condition for the round.
- What is explicitly out of scope.

End the iteration when its stated exit condition is satisfied. Continue only for failed verification, an unresolved blocking risk, a document conflict, a new product decision, or a new user request. Move non-blocking ideas to the relevant owner document, decision log, milestone backlog, or implementation notes.

Implementation phases and slices use the exit criteria and Definition of Done in `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md`. Progress updates should report new work or changed state rather than restating this operating rule.

## 4. Reading Protocol

`docs/START_HERE_FOR_AI_AGENTS.md` is the single owner of entry order and task-specific reading packs. Start there, choose one matching pack, and use section-level reads for large owner documents. Do not copy its routing table here or elsewhere.

The complete per-file inventory and lifecycle metadata live in `resources/documentation-quality/document-map.manifest.json`; implementation work does not load that inventory by default.

## 5. Context Pack Template

This section is the single owner of the implementation context-pack fields. Before coding, write a short internal context pack:

```txt
Task:
Active phase or slice:
Build IDs:
Exit IDs:
Requirement source:
Requirement IDs:
Task-specific docs read:
User workflow:
Owning service:
Durable source of truth:
Rebuildable state:
Secrets involved:
Permissions involved:
Backup/restore impact:
Future sync impact:
Future mobile/cloud runtime impact:
Tests/fixtures:
Docs to update:
Out of scope:
Exit condition:
```

If any field is unclear, inspect the design docs first. Ask the user only when the documents conflict or the choice changes product behavior.

## 6. Service Boundary Rules

`docs/TECH_ARCHITECTURE.md` owns service/process boundaries; `docs/REPOSITORY_STRUCTURE.md` owns package paths and import direction. Before implementation, confirm that the change:

- uses the named owning service for durable state and side effects;
- keeps renderer, preload, main, worker, and adapter responsibilities separated;
- places cross-runtime DTOs and schemas in their shared package owner; and
- does not bypass Permission Broker or a runtime adapter.

## 7. Storage Decision Checklist

Before storing anything, answer:

- Is it durable Markdown knowledge truth?
- Is it source evidence or an original file reference?
- Is it a durable but regenerable artifact?
- Is it machine-local durable state?
- Is it a secret?
- Is it a cache/index?
- Is it temporary runtime state?
- Is it included in backup?
- Can it be rebuilt after restore?
- Does it need a stable sync-ready ID?
- Could it duplicate source asset bodies, saved wiki page bodies, or long conversation content?
- For a v0.1 local-file source, is it a managed copy or a verified original reference? A filesystem link is future scope, not a current strategy.

If the answer is uncertain, use `docs/DATA_ARCHITECTURE.md` and `docs/DOMAIN_MODEL.md` before writing code.

## 8. Permission Decision Checklist

Route through Permission Broker when an action does any of these:

- Reads or writes vault data outside the current job scope.
- Deletes, archives, merges, renames, or rewrites durable vault data.
- Reads external filesystem paths.
- Uses external network access beyond ordinary user-initiated URL capture.
- Runs shell commands, package-backed tools, or external/Web Skill code.
- Installs or updates packages, local tools, models, or runtime assets.
- Sends large/private content to a cloud model.
- Accesses API keys, tokens, or secret storage.
- Changes provider profiles, privacy settings, update settings, or `PIGE.md`.
- Spawns another Agent or long-running background process.

Denied permission must leave the app stable and the job explainable.

Permission defaults:

- Ask Every Time and Remember Scoped Grants should both be supported.
- Pige should not expose a chat-style "current session" permission mode; it is a sessionless product.
- "Only this" grants should be modeled as resource scopes such as current URL, domain, source, note, file, folder, vault, Skill/package/tool version, or provider profile.
- YOLO Full Access can suppress prompts only after explicit Settings opt-in.
- YOLO Full Access must not remove logging, operation records, or source/prompt-injection defenses.

## 9. Dependency Decision Checklist

Before introducing a dependency:

- Is it already listed in `docs/TECH_ARCHITECTURE.md` external dependency registry?
- Is it represented in `resources/dependency-manifest/` once implementation chooses a concrete package, binary, model, provider SDK, CI action, or release tool?
- Does its manifest record validate against `resources/dependency-manifest/dependency-manifest.schema.json`?
- If it needs a temporary exception, is the waiver allowed, owner-assigned, risk-scoped, and unexpired?
- Is it required, recommended, optional, candidate, reference, future, or not-default?
- Is the license compatible with Apache 2.0 distribution?
- Is it bundled, downloaded, system-provided, or user-installed?
- Is it inside the Performance owner’s current distributable hard ceiling?
- Does it affect auto-update, signing, notarization, native modules, or Windows packaging?
- Does it store or transmit user data?
- Does it need checksum/signature verification?
- What is the replacement path?

If the dependency is not in the registry, update the registry before implementation.

## 9.1 UI Visual Fidelity Checklist

For every renderer change that affects layout, type, color, motion, density, responsive
behavior, or a visible state:

- Read `docs/UI_PROTOTYPE.md` section 16 and identify the affected state and viewport.
- Keep values behind Pige semantic tokens; do not paste third-party component CSS or
  branded assets into the renderer.
- Update `resources/ui-visual-contract.manifest.json` only when the owner contract changes,
  not to accommodate accidental implementation drift.
- Run `npm run verify:ui-visual`, renderer/component tests, I18N checks, and accessibility
  checks before visual capture.
- Capture every affected combination in the governed matrix using deterministic synthetic
  fixtures. Include German for expansion pressure and CJK for line breaking and IME-facing
  surfaces.
- Inspect pixel difference, text clipping, hierarchy, focus, hover/active/disabled state,
  contrast, reduced motion, and narrow-window behavior. A low pixel difference alone is
  not approval.
- Record a rationale for every accepted baseline update and identify whether the change is
  intentional, platform text-rendering noise, or an unresolved defect.
- Never generate or approve a baseline from private vault data, real credentials, account
  content, or a third-party application's copyrighted screenshot.

If the environment cannot launch the real packaged app, do not claim visual acceptance.
Run the structural verifier and tests, then hand off the exact uncaptured matrix entries as
an open manual/release evidence gap.

## 10. UI Implementation Rules

Pige's UI should stay minimal, calm, and capture-first.

Implementation rules:

- The first screen should be the usable capture experience, not a landing page.
- Whole-window drag-and-drop remains active in compact and expanded modes.
- Compact capture mode should feel small enough for always-on-top use.
- Full-screen reader should use width for side rails and context, not stretch prose endlessly.
- Settings are for control, not product education.
- Permission dialogs should be compact and elegant, not alarming system walls.
- All user-visible strings must go through I18N catalogs.
- Controls must remain usable in Chinese, English, Japanese, Korean, French, and German.

## 11. Testing Expectations

`docs/QUALITY_AND_TEST_STRATEGY.md` is the single owner of test layers, fixtures, and release gates. Select verification proportional to risk, prove the main and failure paths, and record why any applicable gate could not run. `docs/CODING_CONVENTIONS.md` owns only test naming and placement conventions.

## 12. Documentation Drift Control

When code diverges from docs, fix the code or owning contract in the same change. `AGENTS.md` owns the mandatory update triggers; the owner roles in `resources/documentation-quality/document-map.manifest.json` identify where each change belongs. Update `docs/DECISION_LOG.md` only for a durable decision, and update `docs/SPEC_TRACEABILITY.md` when requirement or evidence mapping changes.

### 12.1 PRD Impact Classification

Classify every change using the highest applicable PRD impact before editing. Record the classification in the pull request or handoff:

| PRD impact | Use when | Required treatment |
| --- | --- | --- |
| `none` | Neither the PRD nor a product-facing promise changes. Typical examples are an internal refactor, dependency patch, or owner-detail correction with identical observable behavior. | Leave the PRD unchanged and state the concrete no-contract-impact reason. Update only the affected technical owners and verification. |
| `editorial` | PRD wording, ordering, links, or structure changes without changing normative meaning, scope, defaults, degraded behavior, or acceptance. | Preserve stable IDs and semantic claims. Update a public summary only if it repeats the edited statement; do not churn technical owners or trace projections. State why semantics are unchanged. |
| `behavior` | User workflow, visible state, default, failure/degraded path, forbidden behavior, trust boundary, or acceptance intent changes. This also applies when a specialized owner changes such a product-facing promise. | Update the PRD and all affected specialized owners, tests/fixtures, and trace/acceptance projections in the same change. Record a durable decision when applicable. |
| `release_scope` | P0/P1/P2 assignment, supported platform, release gate, non-goal, or deferred capability changes. | Update the PRD, milestones, playbook, trace/acceptance projections, semantic lock, and decision record together; reconcile active development before implementation continues. |

`none` and `editorial` are not shortcuts around semantic review. If a user can observe the difference, a default or failure path changes, or release acceptance changes, classify it as `behavior` or `release_scope` even when the code patch is small.

### 12.2 Bidirectional Propagation Matrix

The PRD owns the product promise; the exact subject owner owns the detailed contract. Follow both directions: a PRD semantic change propagates to affected owners, and an owner change propagates back to the PRD whenever it changes the product promise.

| Changed semantic area | Update in the same change | Update the PRD when |
| --- | --- | --- |
| User workflow, visible states, defaults, degraded paths, confirmation, or accessibility | UI, onboarding, settings, I18N, job/recovery, and relevant test owners | Always when observable behavior or acceptance intent changes. |
| Release scope, platform support, phase gate, non-goal, or deferral | Milestones, implementation playbook, Spec Traceability, P0 coverage, acceptance and semantic-claim manifests, and Decision Log | Always. Use `release_scope`. |
| Durable data, source storage, Markdown, IDs, migration, backup, restore, or conflict behavior | Data, source-storage, Markdown, domain, job/recovery, sync/migration, schema, fixture, and test owners as applicable | When ownership, portability, preservation, recovery, or another user-facing guarantee changes. |
| Model/provider setup, cloud send, prompt/context, retrieval, memory, permission, or secret handling | Pi integration, runtime policy, context, prompt, settings, security/privacy, data, and test owners as applicable | When setup, disclosure, consent, output grounding, failure behavior, or another product promise changes. |
| Capture, parser, OCR, Artifact, or source-processing behavior | Parser/ingest, source storage, job/recovery, performance/reliability, release, schema, fixture, and test owners as applicable | When accepted inputs, visible progress, degraded behavior, preservation, or output expectations change. |
| Security, privacy, diagnostics, support, or public data-use behavior | Relevant specialist owner plus `SECURITY.md`, `PRIVACY.md`, or `SUPPORT.md` when its public contract changes | When the trust promise, user control, disclosure, or visible recovery/support behavior changes. |
| Dependency, runtime, repository structure, internal DTO, or implementation choice | Technical Architecture, Repository Structure, Release Engineering, shared schema, dependency manifest, and tests as applicable | Only if the choice changes observable behavior, a product constraint, or release scope; otherwise use `none`. |

This matrix names likely owners, not a license to update all of them mechanically. Use the document inventory and task router to select only owners whose semantics actually change.

### 12.3 Propagation Procedure

1. State the semantic delta and choose the highest PRD impact class.
2. Identify the product requirement IDs and the single owner for every affected fact.
3. Use the matrix to select affected owners; keep full definitions in those owners and use references elsewhere.
4. Apply PRD-to-owner and owner-to-PRD updates in the same change. Do not leave a temporary contract split across sessions.
5. Update trace/acceptance projections and verification only when requirement meaning, mapping, scope, or evidence changes. Preserve stable IDs and status for editorial restructuring.
6. Record the affected owners and trace/acceptance impact. For `none` or `editorial`, record a specific no-contract-impact rationale instead of rewriting unrelated documents.
7. Run the applicable documentation, traceability, contract, fixture, and behavioral gates before handoff.

## 13. Handoff Note Template

This section is the single owner of the internal development handoff fields. Every substantial AI coding session should end with:

```txt
Implemented:
Files changed:
Active phase or slice:
Build IDs:
Exit IDs:
Requirement IDs:
Requirement owner sources:
Tests/evidence:
Visual baseline impact/evidence: Not affected | Captured <matrix subset> | Open <matrix subset and reason>
Known gaps:
Docs updated:
Planning cost: None | Low | Medium | High
Compatibility or migration impact:
Coordination action: No action | Active-phase follow-up | Future-phase follow-up
Coordination target/status: Not required | Notified <task/channel>, acknowledgement pending | Notified <task/channel>, acknowledged
Blocking reason, if any:
Next recommended task:
```

Follow `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md` section 3.2 for cost notification and interruption policy. Send one concise delta notice only when planning cost is Medium/High or an active-phase follow-up is required; otherwise let an unrelated slice finish and reconcile at its next natural handoff.
