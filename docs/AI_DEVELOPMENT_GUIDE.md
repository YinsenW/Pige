# AI Development Guide

Status: Active implementation guide
Baseline date: 2026-07-09
Last revised: 2026-07-22

## 1. Purpose

AI Agent tasks author Pige's implementation. This guide keeps those tasks aligned with
the product baseline as context changes.

The goal is not to make every task slow. The goal is to give each task the smallest complete context pack that prevents common AI failures:

- Implementing a feature without its data ownership rules.
- Adding UI without matching the interaction model.
- Adding a parser or tool without recording dependency, license, update, and backup behavior.
- Treating a cache as user-owned truth.
- Sending private data to a cloud model without the configured boundary.
- Giving an unreviewed third-party capability first-party turn authority.
- Writing a local feature that blocks future sync.

## 2. Agent Operating Loop

### 2.1 Role Separation And Authorship

Project Management owns delivery, risk, Git/CI, and releases; Product Planning owns
contracts; UI Design owns visual/interaction guidance; Development owns executable
code and evidence. Crossing roles requires delegation. Humans direct, review, and
authorize Agent-authored implementation; full automation remains a goal.

Role ownership governs every “update” instruction below. Development and Project
Management record impact and hand off facts; only the owning role, or a task with explicit
scoped delegation, edits another role's materials.

Every non-trivial implementation task should follow this loop:

1. Clarify the target slice.
2. Build a context pack from `docs/START_HERE_FOR_AI_AGENTS.md`.
3. Identify the owning service, durable data owner, and user-visible workflow.
4. Define or reuse one typed capability contract and canonical schema.
5. Let UI and service implementation proceed in parallel against that contract; Pi owns
   semantic tool choice and Host owns enforcement/reliability.
6. Add risk-proportional tests and hand Product Planning only actual semantic deltas.
7. Report what changed, what was verified, and what remains risky.

Architecture reset work may deliberately remove a cross-cutting obsolete mechanism. It
still freezes one contract, deletes in bounded phases, and preserves data/safety evidence;
ordinary feature work stays paused while an incompatible reset phase is active.

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
Agent role: Project Management | Product Planning | UI Design | Development
Cross-role delegation: None | Delegated by role/task for exact scope
Product Planning contract impact: None with reason | Owner update pending | Owner updated
Product Planning design sync: Not required with reason | Pending task | Acknowledged task/snapshot
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
Single owner to update, if semantic:
Out of scope:
Exit condition:
```

If any field is unclear, inspect the design docs first. Ask the user only when the documents conflict or the choice changes product behavior.

## 6. Service Boundary Rules

`docs/TECH_ARCHITECTURE.md` owns service/process boundaries; `docs/REPOSITORY_STRUCTURE.md` owns package paths and import direction. Before implementation, confirm that the change:

- uses the named owning service for durable state and side effects;
- leaves semantic work to Pi;
- keeps renderer, preload, main, worker, and adapter responsibilities separated;
- places cross-runtime DTOs and schemas in their shared package owner; and
- uses the minimal exceptional-confirmation boundary only for a listed high-risk effect;
- does not reproduce Pi's turn/tool lifecycle, correction, repair, or dispatch; and
- keeps one canonical schema at each real trust boundary.

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

## 8. Authority And High-Risk Confirmation Checklist

One user submit is the authority envelope for registered first-party capabilities in that
turn: bounded reads, preservation, parsing, OCR, retrieval, user-specified URL fetch, and
reviewed local tools. Do not create request/decision/consume/completion records for each
ordinary tool call, and do not add a mode whose purpose is bypassing those prompts.

Require a narrow confirmation only for an observed high-risk boundary:

- irreversible deletion or bypass of trash/recovery;
- overwrite of a user-owned original or write outside an already authorized root;
- arbitrary shell execution or installation of an unknown/unreviewed package;
- credential/secret export or display;
- a risky Agent edit already covered by the proposal/Operation contract; or
- a changed destination or equivalent authority/security escalation.

Connected Provider identity plus Send authorizes that turn's bounded selected context.
Strip explicit secrets, block `local_only`, and require a new Connect/Send gesture after
provider identity drift; ordinary/private/bounded-large context does not pause. Denial or
block leaves preserved input stable and explainable. Third-party code cannot acquire
first-party authority through prompt text, naming, or a saved global mode.

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

If the dependency is not in the registry, Development pauses and hands the evidence to
Product Planning; Planning registers an accepted choice before implementation.

External research defaults to rejection. Planning reviews fixed code, tests, philosophy,
license, security, supply chain, and replacement cost; accepted insights are registered
once and change product/acceptance only when promises or proof change.

## 9.1 UI Visual Fidelity Checklist

UI-centered acceptance is global. Planning defines visible workflows/screens/actions/
states/outcomes; Planning/Development establish one typed contract for identity,
permission, errors, availability and durable ownership. Exact fixtures are not real state;
`resources/ui-visual-contract.manifest.json` protects machine visual truth.

## 10. UI Implementation Rules

The approved prototype/contract/element map is the sole baseline. UI Design builds full
production UI against fixtures while Development simultaneously builds services, IPC,
jobs, storage and safety; neither waits. Unfinished UI uses localized
`development/unavailable` without fake IPC, Job, data, progress, success or persistence;
backend may prove the typed contract headlessly.

When compatible bytes freeze, Development binds the real adapter without redrawing.
Contract changes are explicit shared events. UI Design reviews exact visuals/interactions;
Development proves function/safety/data/recovery; real Electron runs through the UI.
Visual differences require capability, responsive, accessibility, locale or platform need.

## 11. Testing Expectations

`docs/QUALITY_AND_TEST_STRATEGY.md` owns test depth and gates; coding conventions own
naming/placement. Early delivery is macOS-first: proportional shared checks plus real and
packaged macOS evidence close ordinary slices. Keep portable contracts and record other
platform gaps; qualify them later before support claims unless the task targets them.

Inner loops run affected tests plus typecheck and a build when output changes. Full
tests, trace, independent review, package, and distribution belong to high-risk
architecture/security/data work, explicit merge candidates, and main—not every local
iteration or ordinary PR. Tests protect observable behavior and irreversible boundaries;
delete tests whose only value is preserving an obsolete internal state-machine step.

## 12. Documentation Drift Control

When code diverges from a semantic contract, Development fixes the code or hands the
delta to Product Planning. `AGENTS.md` owns the triggers and the document map identifies
the editing role. No-contract refactors, test repairs, evidence refreshes, and ordinary
implementation details do not trigger broad Owner, trace, semantic-lock, or snapshot
rewrites.

### 12.1 PRD Impact Classification

Classify every change using the highest applicable PRD impact before editing. Record it
in the pull request or handoff; Product Planning applies the required owner/PRD/trace
updates unless it explicitly delegates that scope.

| PRD impact | Use when | Required treatment |
| --- | --- | --- |
| `none` | Neither the PRD nor a product-facing promise changes. Typical examples are an internal refactor, dependency patch, or owner-detail correction with identical observable behavior. | Leave the PRD unchanged and state the concrete no-contract-impact reason. Update only the affected technical owners and verification. |
| `editorial` | PRD wording, ordering, links, or structure changes without changing normative meaning, scope, defaults, degraded behavior, or acceptance. | Preserve stable IDs and semantic claims. Update a public summary only if it repeats the edited statement; do not churn technical owners or trace projections. State why semantics are unchanged. |
| `behavior` | User workflow, visible state, default, failure/degraded path, forbidden behavior, trust boundary, or acceptance intent changes. | Update the PRD when its promise changes and the single specialized Owner that defines the detail. Update trace only when mapping, status, or evidence meaning changes. |
| `release_scope` | P0/P1/P2 assignment, supported platform, release gate, non-goal, or deferred capability changes. | Update the PRD, phase owner, minimal trace/acceptance projection, and one durable decision; reconcile active work. |

`none` and `editorial` are not shortcuts around semantic review. If a user can observe the difference, a default or failure path changes, or release acceptance changes, classify it as `behavior` or `release_scope` even when the code patch is small.

### 12.2 Bidirectional Ownership Matrix

The PRD owns the product promise; the exact subject owner owns the detailed contract. Follow both directions: a PRD semantic change propagates to affected owners, and an owner change propagates back to the PRD whenever it changes the product promise.

| Changed semantic area | Authoritative detail Owner | Update the PRD when |
| --- | --- | --- |
| User workflow, visible states, defaults, degraded paths, confirmation, accessibility | UI/onboarding/settings owner selected by the router | When observable behavior or acceptance intent changes. |
| Release scope, platform gate, non-goal, deferral | Implementation Playbook | Always; use `release_scope` and minimal trace. |
| Durable data, storage, IDs, migration, backup, restore, conflict | Exact data/source/job/sync owner | When ownership, portability, preservation, or recovery promise changes. |
| Model/provider, cloud send, retrieval, memory, authority, secrets | Pi, context, or security owner named by the router | When setup, disclosure, consent, grounding, or failure behavior changes. |
| Capture, parser, OCR, Artifact | Parser/ingest or source-storage owner | When accepted inputs, preservation, degraded behavior, or output changes. |
| Security, privacy, diagnostics, support | Exact specialist owner plus public policy only when public behavior changes | When trust, disclosure, or user control changes. |
| Dependency, runtime, repository, internal DTO | Technical owner | Only when observable behavior, product constraint, or release scope changes. |

This matrix selects one detail Owner; it is not a checklist for copying the same fact.

### 12.3 Propagation Procedure

1. State the semantic delta and choose the highest PRD impact class.
2. Identify the product requirement IDs and the single owner for every affected fact.
3. Select one detail Owner; other documents reference it instead of repeating it.
4. Update the PRD only if its user-facing promise changes.
5. Update trace/acceptance/semantic projections only for P0, architecture, security,
   durable-data, migration, release-scope, mapping, status, or evidence-meaning change.
6. For `none` or `editorial`, record one no-contract-impact rationale and stop.
7. Run the risk-tiered gates from Quality Strategy.

## 13. Handoff Note Template

This section is the single owner of the internal development handoff fields. Every substantial AI coding session should end with:

```txt
Implemented:
Files changed:
Agent task/provenance:
Agent role: Project Management | Product Planning | UI Design | Development
Cross-role delegation: None | Delegated by role/task for exact scope
Active phase or slice:
Build IDs:
Exit IDs:
Requirement IDs:
Requirement owner sources:
Tests/evidence:
Visual baseline impact/evidence: Not affected | Captured <matrix subset> | Open <matrix subset and reason>
Known gaps:
Docs updated:
Product Planning contract impact: None with reason | Owner update pending | Owner updated
Product Planning design sync: Not required with reason | Pending task | Acknowledged task/snapshot
Planning impact: None | Owner-only | Full-contract
Planning cost: None | Low | Medium | High
Compatibility or migration impact:
Coordination action: No action | Active-phase follow-up | Future-phase follow-up
Coordination target/status: Not required | Notified <task/channel>, acknowledgement pending | Notified <task/channel>, acknowledged
Blocking reason, if any:
Next recommended task:
```

Follow `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md` section 3.2 for cost notification and interruption policy. Send one concise delta notice only when planning cost is Medium/High or an active-phase follow-up is required; otherwise let an unrelated slice finish and reconcile at its next natural handoff.
