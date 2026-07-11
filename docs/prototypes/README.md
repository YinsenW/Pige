# Pige Key Screens Prototype

Status: Product interaction prototype for review; not final UI effect mockup
Baseline date: 2026-07-09
Last reviewed: 2026-07-10
Review trigger: Any UI interaction-contract change, prototype asset change, or quarterly documentation inventory.
Authority: Prototype artifact index. Do not load by default unless UI review or interaction validation is in scope. Normative UI behavior must live in `docs/UI_PROTOTYPE.md` or accepted decisions.

This folder contains static UI prototypes for validating Pige's core interaction model before implementation.

Prototype boundary:

- These screens define product flow, layout priority, information architecture, and interaction intent.
- They are not high-fidelity visual design targets and should not be implemented pixel-for-pixel.
- A separate high-fidelity UI pass is required before production implementation, with visual craft benchmarked against calm, precise desktop products such as ChatGPT and Codex.

Open:

- `pige-key-screens.html`: full prototype board.
- `pige-key-screens-board.png`: full board screenshot.

Individual screens:

- `screens/01-compact-capture.png`: default minimal Home window.
- `screens/02-drag-drop.png`: whole-window drag-and-drop hot zone.
- `screens/03-activity.png`: Home window with recent activity.
- `screens/04-expanded-workspace.png`: expanded sidebar workspace.
- `screens/05-home-knowledge-retrieval.png`: Home dialogue answer grounded in knowledge retrieval.
- `screens/06-reader-agent.png`: full-screen reader with Note Agent.
- `screens/07-selection-actions.png`: text selection action menu.
- `screens/08-permission-dialog.png`: sensitive action permission dialog.
- `screens/09-vault-settings.png`: local vault and note storage settings with recent vaults, backup, and restore.
- `screens/10-model-settings.png`: grouped Settings sidebar with the Model Provider page limited to BYOK provider connection.
- `screens/11-add-provider.png`: simple Add Provider dialog for connecting a model service and managing its model list.
- `screens/12-knowledge-tree.png`: tree-style knowledge visualization with trunk, branches, leaves, and growth suggestions.

Design intent:

- Default experience should feel almost empty: one place to type, paste, speak, or drop.
- Exploration and retrieval can become richer after the user opens the sidebar or a note.
- Expanded sidebars show the Library tree directly, so notes can be browsed by Agent-maintained categories without opening another screen.
- Knowledge Tree is a semantic tree view, distinct from the Library's folder/category tree.
- Home dialogue answers knowledge questions with ranked notes plus a grounded summary, not answer-only chat.
- The reader uses wide screens for navigation, content, and a scoped Note Agent.
- Permission prompts use clear one-time and permanent scoped choices; no session-based permission mode.
- Vault & Note Storage is a first-class Knowledge Base settings page because Pige stores notes as local files and lets users see the active vault path, note/knowledge root, source asset root, and default source storage strategy.
- The Models settings page and Add Provider flow stay minimal; the Pi AI provider/model catalog and Pige Provider Profiles are internal reference data, not a reason to expose a model marketplace.
- Advanced/Fast model assignment is not shown in v0.1. It is gated until Pi Agent upstream or Pige runtime code makes model routing real.
