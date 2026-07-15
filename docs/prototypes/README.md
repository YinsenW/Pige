# Pige Key Screens Prototype

Status: Prototype index; key-screen board is exploratory and complete UI is the current high-fidelity UI Design handoff
Baseline date: 2026-07-09
Last reviewed: 2026-07-15
Review trigger: Any UI interaction-contract change, prototype asset change, or quarterly documentation inventory.
Authority: Prototype artifact index. Do not load by default unless UI review or interaction validation is in scope. Normative UI behavior must live in `docs/UI_PROTOTYPE.md` or accepted decisions.

This folder contains two deliberately separate prototype layers:

- `pige-key-screens.html` is the compact interaction board used to validate product flow and information architecture.
- `pige-complete-ui/index.html` is the high-fidelity, interactive UI Design handoff used for semantic control mapping, state coverage, responsive checks, and clean-room visual regression.
- Its independent Settings surface opens and closes without reloading or replacing the
  underlying workspace, preserves pane disclosure, and restores the invoking control;
  direct Settings links use expanded Home only as a no-invoker fallback.

Prototype boundary:

- These screens define product flow, layout priority, information architecture, and interaction intent.
- The key-screen board is not a high-fidelity visual target and should not be implemented pixel-for-pixel.
- The complete UI folder is a mechanically reusable design handoff, not proof that production behavior exists. Development still owns renderer integration, typed services, native boundaries, and assembled-app evidence.
- Visual benchmarking uses only observable geometry, spacing, gray hierarchy, typography, icon geometry, motion, and state behavior. It does not copy third-party code, fonts, brand assets, or private implementation.

Open:

- `pige-key-screens.html`: full prototype board.
- `pige-key-screens-board.png`: full board screenshot.
- `pige-complete-ui/index.html`: 57 addressable routes: 52 baseline routes plus five Knowledge Tree data distributions; dark Appearance is addressable.
- `pige-complete-ui/pige-ui-design-contract.json`: tokens, fixed rail geometry, interaction rules, and browser regression facts.
- `pige-complete-ui/pige-ui-element-map.json`: semantic/function mapping for all 211 controls.
- `pige-complete-ui/pige-ui-coverage-matrix.json`: requirement-to-prototype-to-production coverage and remaining gaps.
- `pige-complete-ui/pige-ui-visual-review-ledger.json`: clean-room reference boundary, measured evidence, accessibility checks, and open pixel-difference work.
- `pige-complete-ui/pige-ui-reference-metrics.json`: clean-room settings geometry/color measurements; references are not committed.
- `pige-complete-ui/visual-review-harness.html`: explicit-width visual review harness.
- `pige-complete-ui/baselines/`: seven hashed Pige-only JPEG baselines; references excluded; JPEG is not lossless evidence.

Individual screens:

- `screens/01-compact-capture.png`: default minimal Home window.
- `screens/02-drag-drop.png`: whole-window drag-and-drop hot zone.
- `screens/03-activity.png`: Home activity with autonomous updates and Undo.
- `screens/04-expanded-workspace.png`: expanded sidebar workspace.
- `screens/05-home-knowledge-retrieval.png`: Home conversation when Pi selects grounded local retrieval.
- `screens/06-reader-agent.png`: full-screen reader with Note Agent.
- `screens/07-selection-actions.png`: text selection action menu.
- `screens/08-permission-dialog.png`: external extension requesting a new network scope.
- `screens/09-vault-settings.png`: local vault and note storage settings with recent vaults, backup, and restore.
- `screens/10-model-settings.png`: target Models overview with grouped Global Default and Provider summaries.
- `screens/11-add-provider.png`: target Provider detail with hidden preset protocol, Custom protocols, probe, sync, Refresh, enablement, and manual fallback.
- `screens/12-knowledge-tree.png`: tree visualization with autonomous growth and inspectable activity.

Design intent:

- Default experience should feel almost empty: one place to type, paste, speak, or drop.
- Exploration and retrieval can become richer after the user opens the sidebar or a note.
- Expanded sidebars show the Library tree directly, so notes can be browsed by Agent-maintained categories without opening another screen.
- Knowledge Tree is a semantic tree view, distinct from the Library's folder/category tree.
- Home answers normally; when Pi selects local knowledge, it adds ranked notes and a cited summary.
- The reader uses wide screens for navigation, content, and a scoped Note Agent.
- External-extension permission prompts use clear one-time and permanent scoped choices;
  Pige-owned knowledge tools instead show Activity and Undo.
- Vault & Note Storage is a first-class Knowledge Base settings page because Pige stores notes as local files and lets users see the active vault path, note/knowledge root, source asset root, and default source storage strategy.
- The Models settings page and Add Provider flow stay minimal; the Pi AI provider/model catalog and Pige Provider Profiles are internal reference data, not a reason to expose a model marketplace.
- Advanced/Fast model assignment is not shown in v0.1. It is gated until Pi Agent upstream or Pige runtime code makes model routing real.
