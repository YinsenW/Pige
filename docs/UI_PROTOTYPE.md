# Pige Interface Prototype

Status: Active product interaction and visual-system contract; static screens remain low fidelity
Last reviewed: 2026-07-17

Rendered prototype board:

- `docs/prototypes/pige-key-screens.html`
- `docs/prototypes/pige-key-screens-board.png`
- `docs/prototypes/screens/`

Prototype fidelity boundary:

- This document defines product flows, layout structure, navigation, interaction rules,
  and the production visual-system baseline in section 16.2.
- The static screens are not high-fidelity UI effect mockups and must not be treated as
  pixel-perfect implementation targets.
- Production implementation should apply section 16.2 to typography, spacing,
  iconography, motion, density, color, empty states, and platform polish.
- The visual craft target should be closer to ChatGPT and Codex: quiet, precise, low-friction, and refined, while preserving Pige's own identity.

## 1. Experience Goal

Pige should feel like a general-purpose personal Agent with one calm Home composer. The
user can talk, request work, paste, speak, or add files; local knowledge strengthens Pi
when useful but is not required to begin.

The interface should make one promise:

> Ask anything, or put something in. Pige answers directly, uses your knowledge when it
> helps, and can keep valuable results as durable local knowledge.

The user should not need to understand tags, folders, topics, sources, wiki structure,
schemas, Datasets, storage profiles, or query engines before using Pige.

## 2. Product Shape

Default desktop window:

- Narrow vertical layout.
- Comfortable as a side-window next to browser, PDF reader, or editor.
- Can be kept always-on-top by explicit user choice.
- Almost empty by default.
- Single bottom home composer as the main interaction surface.
- The same composer supports capture, retrieval questions, lightweight conversation, URL paste, file attach, drag-and-drop, and voice input.
- Ordinary conversation needs no vault match. When Pi uses local knowledge, show the
  evidence and citations without turning Home into a search dashboard.
- Sidebar hidden by default, not merely collapsed into visual noise.
- Recent activity appears only after the user has active capture, parser, OCR, Agent ingest, or index jobs. The compact Home strip uses localized status dots and at most three visible source names; it is not a second Inbox or Review destination.
- Home refreshes the strip while a job is queued or running, then stops polling for dependency-waiting or terminal jobs to keep idle work low.
- Whole window becomes a file drop hot zone while dragging files over it.

Expanded state:

- Sidebar opens to reveal Home, Library, Knowledge Tree, and Settings.
- Progress, failures, Activity/Undo, and exceptional attention stay contextual, never top-level.
- Library contains an Agent-maintained note tree, Dataset items, notes, sources, topics,
  and tags. Dataset is a content kind, not another primary navigation item or Home mode.
- The expanded sidebar reveals the Library tree directly, including at least three visible hierarchy levels when available.
- Knowledge Tree is a separate semantic tree view for concepts, topics, evidence, and backlinks.
- The app can become a three-pane knowledge workspace when needed.

Full-screen reading state:

- Optimized for reading and working with notes, not for capture-first minimalism.
- Uses the available width for navigation, a centered reading column, source/related context, and the Note Agent.
- Side rails can be hidden independently for distraction-free reading.

## 2.1 Window Modes And Layout Philosophy

Pige should feel like a small capture companion most of the day and a spacious knowledge workspace only when the user asks for it.

### Compact Home Window

Purpose:

- Fast general conversation and source work beside other apps.
- Low screen footprint.
- Suitable for always-on-top usage.

Layout:

```txt
┌────────────────────────────────────┐
│ Pige                         pin ☰ │
│                                    │
│                                    │
│                                    │
│   Put things in, or ask directly   │
│                                    │
│                                    │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ Message, paste, or drop      │  │
│  │                  + mic send  │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
```

Behavior:

- The compact window is the default first-run shape.
- The home composer is visually docked to the bottom.
- The pin button toggles always-on-top and should show a quiet active state when enabled.
- The user can drag files anywhere onto the window.
- Sidebar and Library are hidden unless explicitly opened.
- Resizing wider should not immediately clutter the capture experience; exploration chrome appears only after the user opens it.
- The user should not choose between capture and ask. The same Pi turn decides whether
  to answer, retrieve, preserve, use a tool, or clarify.

### Expanded Workspace

Purpose:

- Continue the home dialogue.
- Browse the Library.
- Inspect captures and sources.
- See Activity, progress, failures, and exceptional attention.
- Open knowledge retrieval results with visible ranked notes.

Layout:

```txt
┌───────────────┬────────────────────────────────────┐
│ Pige          │ Home dialogue / Library content    │
│ Home          │                                    │
│ Library       │                                    │
│ Knowledge     │                                    │
│ Settings      │                                    │
└───────────────┴────────────────────────────────────┘
```

Behavior:

- Sidebar width is stable and should not crowd the content column.
- The home composer remains easy to access.
- The window can return to compact mode without losing the current task.
- Exceptional needs-attention items are inline or contextual, not mandatory navigation.

### Full-Screen Reading Workspace

Purpose:

- Read Markdown comfortably.
- Work deeply with one note.
- Compare note, sources, related pages, and Agent output.

Layout:

```txt
┌───────────────┬──────────────────────────────┬─────────────────────┐
│ Library       │ Note Reader                  │ Note Agent / Context │
│               │                              │                     │
│ Notes         │ # Title                      │ Ask current note     │
│ Sources       │                              │ Related              │
│ Topics        │ Comfortable reading column   │ Sources              │
│ Tags          │ with citations and media     │ Backlinks            │
│               │                              │                     │
└───────────────┴──────────────────────────────┴─────────────────────┘
```

Behavior:

- The note body should never stretch into an unreadably wide line length.
- On wide screens, the reading column can be centered with side rails for navigation and context.
- The Note Agent should sit on the right in wide/full-screen mode.
- Related notes, backlinks, and sources can share the right rail or appear below the note when the Agent panel is closed.
- The user can hide the left sidebar, right context rail, or both.
- Selection actions should appear near selected text without covering the paragraph being read.

## 3. Navigation Model

Primary areas:

- Home.
- Library.
- Knowledge Tree.
- Settings.

Expanded sidebar:

- Shows the Library tree directly below primary navigation.
- Supports at least three visible hierarchy levels for Agent-maintained categories, folders, topics, or note groups.
- Keeps Knowledge Tree as a separate semantic tree view, not as another folder inside Library.

Primary actions:

- Use the home composer to capture text, files, links, images, voice, or questions.
- Dictate voice input on supported macOS versions.
- Paste URL.
- Attach files.
- Open note.
- Ask current note.
- Run selection action.
- Backup.
- Restore.
- Configure models.

## 4. Main Window Prototype

### 4.1 Default Empty State

The empty state uses the canonical Compact Home wireframe in section 2.1. Its only
state-specific visual difference is the absence of recent-activity rows above the
composer; it is not a second shell definition.

Behavior:

- No required sidebar, no required category picker, no upfront mode selection.
- The bottom composer is the only dominant control.
- `Enter` sends one non-empty Home turn. `Shift+Enter` inserts a newline; Enter during
  IME composition or its immediate completion race never submits. Repeat or in-flight
  input cannot create a duplicate turn, and the visible Send button remains available.
- Menu and settings are present but visually quiet.
- User can type a question, paste a URL, paste long text, attach a file, or drag files anywhere onto the window.
- On supported macOS versions, the microphone button starts voice dictation into the same input.
- Recent activity appears above the composer only after there is something useful to show.
- The same input supports capture and retrieval questions. User should not see separate "Capture" and "Ask" modes.
- No mode chips: Pi decides semantics; Host handles exceptional boundaries.
- Host UI does not classify by punctuation, URL, attachment, or file type. Pi may answer
  directly or retrieve; citations appear only when local evidence is used.
- The first idle model-unavailable Home shows one compact inline choice above the composer:
  `Connect Model` or quiet `Continue without model`. Either explicit choice dismisses it
  for that vault on this machine; it is not a modal, destination, or recurring banner.
- A no-source model wait replaces that guide and matching Recent Work row: one localized
  status plus `Open Models`, never Retry, Job ID, or local-capability copy. Source waits
  keep their row. Load 100 Jobs, filter, then show six. Returning Home rereads durable
  Vault/Job/onboarding/runtime truth and ignores stale outcomes. Picker/drop retain one
  owner through intermediate and settled states.

The timeline is not the permanent knowledge store. Important outputs should be written to Markdown pages, source pages, `index.md`, and `log.md`.

### 4.2 Whole-Window Drag Hot Zone

```txt
┌────────────────────────────────────┐
│                                    │
│                                    │
│        Drop into Pige              │
│                                    │
│     report.pdf  notes.md           │
│                                    │
│        Release to capture          │
│                                    │
└────────────────────────────────────┘
```

Behavior:

- Dragging files over any part of the window turns the entire window into a drop target.
- The target should be visually obvious but calm.
- Dropping files should not require aiming for a small attachment button.
- Multi-file drops are grouped as one capture batch.
- Unsupported files are preserved when possible and reported with clear warnings.

### 4.3 Activity State

```txt
┌────────────────────────────────────┐
│                                    │
│  Recent                            │
│  Fetched article                   │
│  Created 1 source page             │
│  Updated 2 concept pages           │
│  View details · Undo               │
│                                    │
│  Saved as "Agent-maintained Wiki"  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ Continue, ask, or add source │  │
│  │                  + mic send  │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
```

Behavior:

- Activity History is in Settings; Home keeps active attention.
- Eligible pages offer Undo; reread restores truth/focus/retry or fails closed.
- Applied rows open only an active-vault `{ kind: "page", pageId }` through Reader;
  Settings closes after success. Missing/stale/failed targets fail closed; labels/paths
  grant no authority, and Open never invokes Undo.

### 4.4 Sidebar Expanded

```txt
┌───────────────┬────────────────────────────────────┐
│ Pige          │ Home                               │
├───────────────┼────────────────────────────────────┤
│ Home          │ Today                              │
│ Library       │                                    │
│ Knowledge     │ You                                │
│ Settings      │ notes about BYOK models...         │
│               │                                    │
│ Status        │ Pige created 1 note                │
│               │ Linked to [[BYOK]]                 │
│ Recent        │                                    │
│ Agent Wiki    │                                    │
│ BYOK          │                                    │
├───────────────┼────────────────────────────────────┤
│ Vault: Local  │ Message, paste, or drop      ↑    │
└───────────────┴────────────────────────────────────┘
```

Behavior:

- Sidebar width is stable.
- Home stays at top.
- Navigation list is icon plus label.
- Recent pages appear below primary navigation.
- Vault status appears at bottom.
- Opening the sidebar is an exploration action, not required for capture.
- Processing and exceptional needs-attention items appear in Home, not separate navigation.

## 5. Home Composer

Input states:

- Empty.
- Composing.
- Voice recording.
- Voice unsupported.
- Attachments present.
- Submitted/running.
- Error.

### 5.1 Empty

```txt
┌────────────────────────────────────┐
│ Message, paste, or drop            │
│                         ＋  mic  ↑  │
└────────────────────────────────────┘
```

The toolbar contains actions, not modes: attach, voice, and send. It should not ask the user to classify intent before submitting.

### 5.1.1 Voice Recording

```txt
┌────────────────────────────────────┐
│ Listening...                       │
│ I want to capture an idea about... │
│                             stop ↑ │
└────────────────────────────────────┘
```

Behavior:

- The microphone button lives in the input toolbar.
- Recording starts only after explicit user action.
- Recording shows Attach, neutral-or-metered waveform, timer, Stop and Done. Session
  replacement text becomes editable without overwriting existing composer text.
- Stop/Done never submit or create Job/source/model work. Localized body-free denial may
  open fixed Microphone Settings. Missing Apple language resources expose explicit install;
  its focus-owned UI locks dismissal/route/locale. Success re-probes and still needs Start.
- On unsupported platforms, the microphone button is hidden or disabled with a short tooltip.

### 5.2 URL Present

```txt
┌────────────────────────────────────┐
│ https://example.com/article        │
│                                    │
│ Link included                 ↑   │
└────────────────────────────────────┘
```

URL styling is a lightweight affordance, not a route. The URL enters the same Pi turn;
fetching begins only if Pi selects the bounded web tool.

### 5.3 Files Attached

```txt
┌────────────────────────────────────┐
│ 3 files                            │
│ report.pdf                         │
│ notes.md                           │
│ deck.pptx                          │
│                               ↑   │
└────────────────────────────────────┘
```

On submit:

- Validate and preserve accepted files, attach their refs to one Pi turn, and group
  preservation status. File type does not select the semantic workflow.
- CSV, XLSX, and supported SQLite follow this same flow. Do not show an
  Import/Table/Database mode; after preservation, Pi decides whether to inspect or query.

Home's accessible model listbox changes the Global Default for new calls, never
per-turn routing. Unavailable or switching blocks Agent Send while source submission remains available; there is no separate capture-only mode.

## 6. Processing Timeline

The timeline should show Agent work as durable changes.

```txt
Pige
Reading source...

Pige
Extracted 4,280 words and 3 images.

Pige
Created:
  Source: Web Article - LLM Wiki
  Concept: Agent-maintained Wiki

Updated:
  Topic: Local-first Knowledge Tools
  Entity: Andrej Karpathy

Flagged:
  Possible overlap with "AI Notes Architecture"
```

v0.1 can show a simplified version:

```txt
Pige
Processed successfully.
Created 1 source page and 1 note.
Updated 2 relationships.  View details · Undo
```

## 6.1 Processing, Activity, And Exceptional Intervention

No default Inbox/Review destination: Home shows compact progress and retry, eligible
changes as Activity/details/Undo, and only exceptional boundaries as focused decisions.

Processing states:

- Queued.
- Processing.
- Failed.
- Ready to retry.
- Needs attention.
- Completed with warnings.

Current Home Activity distinguishes created from updated. Checksum-current exact create/
cited append offers non-confirming Undo; changed/hashless/missing fails closed. Proposals
stay transitional; general update, restore/redo, broad history, and packaged proof remain open.

## 7. Home Conversation And Optional Local Knowledge

Home behaves like ordinary Agent conversation. Pi retrieves local knowledge when a
request benefits from it; retrieved evidence remains visible and cited. With irrelevant
or empty evidence, Pi may answer normally without local citations. An explicit
vault-only request instead reports insufficient evidence.

While a model-backed turn runs, Home first shows its compact working state, then replaces
one escaped assistant draft in place as safe answer snapshots arrive. The draft is
visually part of the pending turn, carries no citations or grounding badge, and may
shrink or revise; it is not a saved message. Do not announce every replacement through a
live region—keep the turn `aria-busy`, expose a bounded status, and announce the final or
failure once.

The durable upstream Pi final replaces the draft without duplicating a bubble. On
failure/cancellation, remove the provisional text or mark the pending bubble with the
existing localized recovery state; never leave it looking like a completed answer.
Reopen/restart shows only durable messages. Verified citations and evidence rows appear
only with the final result. Raw provider/Pi deltas, thinking, tool JSON, IDs, and errors
never enter this surface.

Prototype:

```txt
Home

How did we decide to handle BYOK providers?

Summary
Pige treats BYOK as a first-class model configuration layer. Credentials stay separate from vault data, and Home shows quiet destination/provider status when relevant.

Top Results

1. BYOK Model Requirements
   PRD · 92% match
   "...Provider design follows the Pi AI provider/model catalog and Pige Provider Profiles..."

2. Model Provider Architecture
   Architecture · 86% match
   "...ProviderProfile includes dataBoundary and model capabilities..."

3. Permissions & Privacy Settings
   UI Prototype · 72% match
   "...Pige shows a visible indicator when content is sent to the configured provider..."

Follow-ups
  Compare OpenAI-compatible and Anthropic-compatible setup
  Show privacy risks for BYOK
  Save this answer as a note
```

Behavior:

- Results remain visible after a summary is generated.
- Retrieval should run locally first through lexical, metadata, vector, and optional local reranking.
- Each result opens the Markdown page at the matching snippet when possible.
- The synthesis should cite the result cards it used.
- The user can refine the query without starting a new chat thread.
- Saving useful knowledge auto-applies through a validated recoverable tool; exceptional boundaries pause.
- There is no separate default "Ask" entry in navigation; this behavior lives inside Home.
- When a final answer uses Dataset evidence, a quiet citation such as
  `Budget.xlsx · Plan · rows 12–18` or `… · aggregate` opens the same Dataset revision and
  highlighted evidence in Library. Drafts carry none. Never expose SQL, engine names,
  query hashes, schema IDs, or internal paths.

Current Home can render one Agent-selected Dataset result as an escaped accessible table
with exact citations inside the conversation. Independent Dataset browsing/paging,
citation-open highlighting, formula/warning detail, large-table polish, and packaged
platform proof remain open; the Playbook and acceptance manifest own delivery evidence.

## 8. Note Reader

```txt
┌───────────────┬────────────────────────────────────┐
│ Notes         │ Agent-maintained Wiki              │
│               │ #agent #local-first #markdown      │
│ Agent Wiki    ├────────────────────────────────────┤
│ BYOK          │ Summary                            │
│ Web Capture   │ Pige compiles source records into...│
│               │                                    │
│               │ Key Points                         │
│               │ - Original files stay user-owned   │
│               │ - The wiki is maintained by Agent  │
│               │ - index.md and log.md guide usage  │
│               │                                    │
│               │ Related                            │
│               │ [[BYOK]] [[Local-first]]           │
│               │                                    │
│               │ Sources                            │
│               │ Web Article - LLM Wiki             │
└───────────────┴────────────────────────────────────┘
```

Reader requirements:

- Render Markdown as a primary product surface, not a secondary preview.
- Show frontmatter-derived metadata in a compact header.
- Show backlinks and related pages.
- Show source references.
- Show source-backed citations distinctly from Agent interpretation.
- Provide open-in-folder and reveal-raw-source actions.
- Support a right-side Note Agent panel on wider windows.
- Show the Note Agent as a drawer or modal on narrow windows.
- Provide a full-screen reading mode that uses extra width for navigation and context, while keeping the prose column comfortable.
- Let the user hide left navigation and right-side context independently.

### 8.1 Markdown Rendering And Editing Surface

The note surface should borrow the calm, high-legibility feel of excellent Markdown readers and artifact-style renderers while staying unmistakably simple.

Reading mode:

- Default to rendered reading, not source text.
- Keep the note body unframed; avoid placing the whole document inside a card.
- Use a comfortable text column, clear heading scale, balanced spacing, and quiet link styling.
- In full-screen mode, keep prose at a readable measure and use surplus width for side context rather than stretching paragraphs.
- Render headings, paragraphs, lists, task lists, blockquotes, tables, code blocks, inline code, links, images, wiki links, and source citations.
- Make wiki links and source citations visually distinct but not loud.
- Keep frontmatter hidden by default and represented through compact metadata.
- Keep code blocks and tables inside stable scroll containers so they do not stretch or break the layout.
- Add copy controls to code blocks and selection actions to normal text.
- Constrain images to the reading column and show captions or source references when present.

Editing mode:

- A simple edit action can switch the note into Markdown source editing.
- v0.1 does not need a full block editor, but it must preserve clean Markdown.
- Preview/read mode and edit mode should keep roughly the same scroll position when possible.
- Saving should validate frontmatter, wiki links, and citations before applying changes.
- Pige-managed sections remain editable; Agent rewrites use base hashes/history/Undo and pause only at exceptions.

Phase 2/3 bridge:

- Opening a Library row shows a minimal rendered reader.
- The reader hides frontmatter and shows compact metadata derived from frontmatter.
- Markdown rendering supports GFM, sanitized HTML, Pige links, code/table overflow, and confined relative raster images; remote/protocol/traversal resources and Electron navigation are denied.

Current Phase 4 reader context foundation:

- Library/Home results expose outgoing links and backlinks through `library.related`.
- Related pages open by stable ID; the renderer gets neither arbitrary paths nor note bodies.
- The context rail is right-side when wide and below Markdown when narrow.
- The metadata title is the sole primary H1; hide only an equal normalized leading body H1.
- Internal wiki/source links stay focusable and activate one typed Main-owned resolver
  request bound to the active vault, current page, current render context, href, and a new
  request ID. A resolved page or source opens the existing Reader only through
  `target.pageId`; the renderer does not infer identity from href text or consume paths,
  bodies, candidates, `sourceId`, `locator`, or raw errors.
- `ambiguous`, `not_found`, `stale`, `failed`, missing-context, delayed, or mismatched
  results leave the current Reader in place and expose one body-free localized status at
  the fixed top surface for the activated link. Vault, route, page, and render-context changes invalidate pending
  activation; no inline-reference event or parallel navigation owner exists.
- Current-note Agent and Reader copy are real; edit/selection/reveal remain unavailable.

### 8.2 Note Agent Panel

When a note is open, the right side can host a contextual Agent panel.

Prototype:

```txt
┌───────────────┬────────────────────────────┬─────────────────────┐
│ Library       │ Agent-maintained Wiki      │ Note Agent          │
│               │ #agent #markdown           │                     │
│ Notes         │                            │ Ask about this note │
│ Sources       │ Summary                    │                     │
│ Topics        │ ...                        │ Related             │
│ Tags          │                            │ BYOK                │
│               │ Key Points                 │ Local-first         │
│               │ ...                        │                     │
│               │                            │ Suggested actions   │
│               │ Sources                    │ Summarize           │
│               │ ...                        │ Find contradictions │
└───────────────┴────────────────────────────┴─────────────────────┘
```

Current production boundary:

- Exact current-note owns timeline/citations/wait/egress; stale ownership and drafts fail closed.
- Selection uses exact identity/action presentation; writes gain Operation/Undo or bounded review.
- Attachments, related/backlinks, memory and other mutations remain unavailable; reads do not write.

### 8.3 Selection Actions

Selecting text in a note should reveal a compact action menu.

Prototype:

```txt
Selected text...

Copy  Quote  Ask  Translate  Polish  Expand  Summarize  More
```

Action behavior:

- Copy and quote are local and instant.
- Read/transform submits only identity; writes refresh after Operation or show <=8 safe lines.
- Drift/failure is body-free; renderer owns no body, path, hash/span or apply authority.

### 8.4 Structured Knowledge Surface

Datasets open from Home citations, Activity, Library, or the preserved Source inside the
existing content pane; this is not a new navigation destination.

v0.1 shows a read-only CSV/XLSX/SQLite Dataset with a compact title, source, revision and
warning header; stable keyboard/screen-reader table semantics; bounded paging/scrolling;
and exact cited rows, ranges, columns, or aggregates highlighted. Formula cells show the
cached value plus a quiet formula/stale-cache indicator. Warnings are localized and
never raw adapter errors. The original remains separately revealable. Do not flatten
rows into Markdown or expose storage/query-engine terminology.

Editable managed Collections, fields, views, relations, and formulas are P1. When
delivered, validated reversible changes auto-apply and appear in Activity with Undo;
destructive/external/conflicted boundaries remain exceptional. Do not render those
controls in the v0.1 read-only surface.

## 9. Sources View

Purpose:

- Let users inspect the evidence layer.
- Make raw preservation visible and trustworthy.

Prototype:

```txt
┌───────────────┬────────────────────────────────────┐
│ Sources       │ Sources                            │
│               │                                    │
│ Web           │ 2026-07-09                         │
│ Files         │ ┌────────────────────────────────┐ │
│ Text          │ │ Web Article - LLM Wiki         │ │
│ PDFs          │ │ gist.github.com                │ │
│               │ │ 11,985 chars · 4 wiki pages    │ │
│               │ └────────────────────────────────┘ │
│               │ ┌────────────────────────────────┐ │
│               │ │ Pige Product Brainstorm        │ │
│               │ │ pasted text                    │ │
│               │ │ 1,204 chars · 2 wiki pages     │ │
│               │ └────────────────────────────────┘ │
└───────────────┴────────────────────────────────────┘
```

Sources is a tab inside Library in v0.1. The sidebar can still expose it as a shortcut later if usage proves it deserves top-level placement.

Current Library bridge:

- Lists body-free page summaries and opens Reader through stable page IDs.
- Local active-vault search accepts at most 320 Unicode code points. All, Notes, Sources,
  and Topics select declared page types; Tags is localized development/unavailable and
  invokes no IPC or Job.
- No active vault means no request. Stale requests/vaults fail closed; results show bounded
  snippets and localized match reasons, never score percentages, raw errors, IDs, or paths.
  Retry restores focus.
- Source evidence and Dataset knowledge remain distinct. Editing, source reveal, Note
  Agent, selection actions, and Tags search remain open.

## 10. Topics And Tags

Tags should feel like a derived navigation aid, not a manual burden.

Topics:

- Higher-level curated or Agent-generated areas.
- Can contain concepts, notes, sources, and questions.

Tags:

- Lightweight labels.
- Auto-generated by default.
- User can rename or merge later.

Prototype:

```txt
Library

Notes  Sources  Topics  Tags

Tree

Knowledge Base
  Technology
    Local RAG Design
    Agent Memory
    OCR Pipeline
  Creation
    Sci-fi Novel
    Video Scripts
  Work
  Index

Topics

Local-first Knowledge Tools
  12 notes · 8 sources · 4 concepts

Agent Workflows
  9 notes · 5 sources · 6 concepts

Model Providers
  6 notes · 2 sources · 3 concepts
```

## 11. Knowledge Tree

Knowledge Tree is the semantic exploration surface. It should answer "how is my knowledge growing?" and "how are my ideas connected?" rather than "where is this file stored?"

The data contract for topics, concepts, entities, relationship types, review gates, and graph rebuild behavior lives in `docs/KNOWLEDGE_MODEL_AND_LINKING.md`.

It should show:

- Trunk, branch, and leaf structure.
- Main trunk for broad knowledge domains.
- Branches for topics, concepts, projects, or recurring questions.
- Leaves for fragmented knowledge units such as notes, chunks, source fragments, claims, examples, or accepted insights.
- Related notes and source evidence.
- Backlinks and suggested links.
- Relationship confidence or status when useful.
- Autonomous relationship Activity and exceptional unresolved conflicts.

Visual encoding:

- Trunk thickness represents the total weight of a knowledge domain.
- Branch thickness represents the weight of a topic or concept.
- Leaf count represents the number of fragmented knowledge units under that branch.
- Leaf size represents the size or importance of a leaf cluster.
- Leaf color depth represents density: deeper color means more accumulated fragments or stronger evidence.
- New or low-confidence growth can use lighter leaves until evidence reinforces it.

Current bounded slice:

- Knowledge Tree is a separate sidebar destination, not a folder browser or graph editor.
- A compact heading, Refresh action, totals, and Tree/Network/List views expose the same
  body-free aggregate; views, search, focus, and camera are renderer-local and create no
  data owner.
- Native meters and adjacent text state exact weight, fragment, source, and leaf counts;
  color or thickness is never the only explanation.
- Navigable nodes open the existing confined Note Reader. Back restores focus to the
  invoking tree button when it is still rendered, otherwise to the Knowledge Tree heading.
  Opaque source IDs without a navigable Source Page display only a localized
  `Source evidence` label.
- Loading, ready, empty, degraded, and error states are localized. Force graphs, manual
  taxonomy, editing, health workflows, and advanced graph analytics remain open.

Illustrative hierarchy:

```txt
Knowledge Tree

Main trunk: Local-first
  Branch: Local RAG
    Leaves: Embedding, lexical search, reranker, chunks, citations
  Branch: Agent Memory
    Leaves: preferences, corrections, scenarios
  Branch: OCR Pipeline
    Leaves: screenshots, scanned PDFs, slides
```

## 12. Knowledge Health

v0.1 can be a report page. Later it can become an interactive maintenance workflow.

Prototype:

```txt
Knowledge Health

Run Check

Last check: Never

Checks
✓ Broken links
✓ Orphan pages
✓ Duplicate topics
✓ Claims without sources
✓ Possible contradictions
✓ Missing concept pages
```

After running:

```txt
Knowledge Health

4 suggestions

Orphan pages
  "AI Notes Architecture" has no inbound links.

Duplicate topics
  "Agent Notes" may overlap with "Agent Workflows".

Unsourced claims
  "Local models are enough for most capture" needs evidence.

Missing concept
  "Provider Registry" is mentioned 8 times but has no concept page.
```

## 13. Settings

The settings information architecture, setting scopes, persistence rules, exact group/
page taxonomy, and default registry are governed by
[`SETTINGS_AND_PREFERENCES.md`](SETTINGS_AND_PREFERENCES.md#5-settings-information-architecture).
This section owns only how that taxonomy is presented and interacted with.

Settings rules:

- A settings page owns one conceptual domain. Do not mix models, permissions, local tools, extensions, and backup in one screen.
- Models contains cloud language model provider connection only.
- Local Capabilities contains local RAG, embedding/reranking downloads, OCR, speech input, parsers, and bundled toolchain health.
- Permissions & Privacy explains submitted-turn authority, the closed high-risk boundary,
  exact Provider-send behavior, and stored-credential isolation.
- Vault & Note Storage contains vault identity, active vault path, note/knowledge root path, source asset root path, source storage policy, recent vaults, backup, restore, export, and trash.
- Index & Maintenance contains rebuild index, reset local database, knowledge health, chunk status, and repair actions.
- Agent & Memory contains `PIGE.md`, Agent behavior preferences, memory inspection, and autonomous activity/history controls.
- Skills and Pi Packages are both under Extensions, but remain separate pages.
- Cross-links are allowed, but cards from another domain should not be embedded in the current page.

Current shell: Home + Knowledge Tree are primary; Library sits below; Settings opens via
vault/profile; Models is only a Settings/Home repair target. Vault owns storage/Backup/
Restore; Index & Maintenance owns index/diagnostics/support. Real surfaces include Home,
Library/Reader, Knowledge Tree, Models, Vault, Backup/Restore, maintenance, current-note
Agent, Reader copy, composer processing, compact Activity/Undo, locale/window pin and
current-action prompts. Settings framing and Reader related context remain partial.
Compact Settings owns focus/inert state; Escape closes its navigator before the dialog
and restores trigger focus.
Appearance, local capabilities, Agent/memory, reusable permission policy, Skills, Pi
Packages, updates/voice, Reader mutations and unbound Knowledge evidence/backlink/
relationship actions remain localized unavailable without IPC, Job, persistence, fake
result/progress or status credit. Until a
separate `BrowserWindow` owner exists, Settings remains an in-app focus-trapped dialog
with Escape/exact-invoker restoration and no outer-window resize.

### Vault, Note Storage, And Backup

Vault & Note Storage ("仓库与笔记存储") is calm local-file control: location first;
backup/restore protect the vault without displacing storage ownership.

Required controls:

- Show current vault name/path first, then note and source roots separately even when colocated.
- Let users choose copy-to-Pige or reference-original for new sources; defer advanced link strategies until proven safe.
- Offer separate platform-neutral Show note storage and Show source storage actions; unavailable external source storage reads “not connected” and has no fallback reveal.
- One local busy/status surface owns reveal; disable conflicting storage controls in flight, show only localized pathless results, and restore focus to the invoking action.
- Open or create vaults; recent-vault removal never deletes files.
- Own restarted user Backup here with localized valid actions and no raw Job/path/error or rollback child; latest completion derives Last backup.
- Show schema and note/source/copy/reference/artifact counts when available.
- Warn against nested/system locations; never hide storage controls inside backup, export, diagnostics, or maintenance.
- Do not expose database file paths, cache folders, parser artifact internals, checksums, or symlink mechanics on the default page.
- No one-click vault move in v0.1; any future move requires preflight, backup, verified copy, and rollback.

Reset Local Search Database is a repair action under Index & Maintenance. It deletes only
rebuildable `.pige` indexes/caches and recreates them from Markdown, Dataset Bundles,
source records/artifacts, memory, proposals, and operations. It never deletes Dataset
payloads/revisions/views/change logs, notes, or sources.

### Model Settings

```txt
Models overview

Global Default
[ OpenAI — gpt-5-mini                    ▾ ]

Providers
OpenAI             Connected · 2 enabled · 3 models     Manage
Personal endpoint  Needs attention · discovery failed   Manage

Connect Provider → preset list | Custom Provider
```

Global Default is first; connected Providers stay compact. Add Provider opens a reviewed
preset list or Custom. Presets ask only exposed credentials; Custom alone reveals protocol
and Base URL. Failed connection remains on its form; only explicit success navigates.
Cloud/self-hosted/local is internal metadata. Global Default groups enabled models by
Provider, never raw ID or per-row action. Each Provider opens one inline inventory:

```txt
OpenAI                                      Connected
Models                                      Refresh
[x] gpt-5-mini       Display name: Fast     Synced
[x] gpt-4.1-mini                              Synced
[ ] gpt-4.1                                   Synced
Add custom model
```

Connect discovers; Refresh repeats. Exact IDs merge while preserving alias/enabled/default;
manual ID is fallback. One Provider-level Pi probe gates commit. Models alone owns initial,
preset, Custom, discovery, manual, and post-commit-refresh failures. Body-free copy names
only exposed fields; discovery offers `Retry` + `Add custom model`, and manual input stays.
Sequences ignore stale outcomes. After commit, Retry rereads Models only and runtime
best-effort—never repeats effects or refreshes Vault/Backup. Errors clear on success or
navigation and never appear in Vault settings.

Above Connect disclose the exact destination once; sensitive asks, restricted never
sends, unknown/changed reconfirms. Hide marketplaces, matrices, routing, Advanced/Fast,
local tools, Skills, backup, and memory.

The Playbook and acceptance manifest own capability status. The complete-UI HTML,
design contract and element map own frozen visual/interaction detail; they do not make an
unavailable capability executable.

### Deferred Model Routing Settings

Show one effective default model. Do not show Model Assignment or Advanced/Fast roles
until Pi or a tested Pige routing service makes them change real calls.

### Permissions And Privacy Settings

```txt
Permissions & Privacy

Model service
Sending a message sends exactly what you wrote and the selected context to the connected
model service. Pige does not classify, redact, or block message content.
Uses your connected provider
```

Provider setup discloses the destination once. Send requires an exact connected Provider
and selected model; there is no content-policy modal, toggle, confirmation control, or
content-class indicator or action affordance; this row is informational only. UI Design
translates the three strings mechanically across all six locales and deletes unused
`errors.model_provider.egress_confirmation_required` keys/tests. Plaintext secret storage
remains an advanced warned escape hatch.

Remove the entire `privacy.redactionTitle`/`privacy.redactionDescription` row and
`privacy.partialNote`, including all dead six-locale keys/tests. Do not replace either
with a control, static status, warning, note, or development affordance. The existing API
key secure-store row remains. Diagnostics/support-export redaction applies only to exported
artifacts under its separate owner and is not Provider-message mutation.

Also delete all reachable references, tests and six-locale keys for
`errors.model_provider.output_invalid` and `errors.agent_runtime.completion_invalid`.
Do not replace them with another generic “validated answer” or “completion invalid” copy;
transport/tool/effect failures keep their exact existing owner codes.

Voice input, OCR, local RAG, parser health, and bundled toolchain status belong to Local Capabilities. Models should not contain those controls.

### Submitted-turn Authority And High-risk Effects

The user pressing Send authorizes ordinary registered first-party tools for that exact
turn. Do not show permission modes, saved grants, per-tool approval cards, or YOLO.
Only a concrete closed-list high-risk effect opens a focused modal: irreversible delete,
overwrite of a user file, write outside an explicitly selected directory, arbitrary
shell/unknown-package install, or credential display/export. Deny is safe and executes
no effect. Connected Provider plus Send authorizes the selected bounded context; secrets
stored by Pige remain outside payload content, while user-authored/selected content is
sent unchanged.

### Agent And Memory Settings

```txt
Memory

Status
Agent Memory: On
Vault-scoped memory: 12 active memories

Recent
Prefers concise source summaries
  Learned from accepted correction
  Disable  Delete

Use memory for
[x] Capture and summarization style
[x] Note naming and linking conventions
[x] Autonomous organization style
[x] Avoiding repeated Agent mistakes

Controls
Inspect Memory
Export Memory
Reset Memory
```

Show what Pige remembers, why/from where, and disable/delete/Undo. Secret-scanned scoped
memory grows autonomously; sensitive/authority changes intervene.

### Skills Settings

```txt
Skills

Built in
Paper Reading
  Enabled

Vault Skills
Meeting Note Cleanup
  Enabled
  Last used: yesterday
  Disable

External / Web Skills
Source Research
  Enabled
  Permissions: network allowed for this version
  Inspect

Install Skill
Paste Skill Link
Choose Markdown
Choose ZIP

Staged
No staged Skills
```

Skill install from chat should land in this same staged confirmation flow. The user can paste a link or drop a `.md`/`.zip` into the main input and say "install this Skill"; Pige stages the Skill, shows metadata and warnings, and asks for confirmation before enabling it.

Skill details should show:

- Name, description, version, author, license, and source.
- Scope: built-in, vault, or machine.
- Files included.
- Requested capabilities.
- Data boundary.
- Declared capabilities and whether they are first-party or third-party.
- Trigger phrases.
- Last used.
- Enable, disable, uninstall, export, and update actions.

Skills should feel like small knowledge workflows, not apps. Pure Skills are Markdown instruction packs. External/Web Skills declare capabilities before enabling and run in their reviewed isolation boundary; they do not inherit first-party turn authority.

Focused high-risk dialog target:

```txt
Pi Agent wants to commit an external file change

Action
Write one file outside this vault

Target
Selected project · docs/meeting-notes.md

Command
Create or replace this file for the current task

Deny        Confirm write
```

The high-risk request opens one compact, calm modal owned by the effect surface, not a
waiting Job state or second workflow. It uses `role="dialog"`, moves
and traps focus inside while open, and restores focus to the invoking task/composer
control after resolution. Action, target, and command summary are bounded, localized,
and authored from the typed Host request—not copied from model prose, a tool description,
raw `reason`, `commandPreview`, `affectedPaths`, shell text, or an unredacted absolute
path. A Pige-owned tool name cannot bypass this dialog when its requested effect is
outside standing authority.

`Deny` is default/cancel-safe; Escape denies that exact effect. Confirmation authorizes
only the bound effect and is never reusable. Disable actions while resolving, restore
focus afterward, and keep raw secrets blocked rather than promptable. Ordinary parsing,
OCR, retrieval, user-specified fetches and registered local tools never open this modal.

### Local Capabilities Settings

```txt
Local Tools

Core toolchain
Status: Ready
Git / Shell: Bundled
Bun: Bundled
uv / Python: Bundled
PDF tools: Bundled
Office tools: Bundled
Repair

Local RAG
Status: Index ready
Inference engine: Built in

Embedding model
Qwen3 Embedding 0.6B GGUF
  Status: Installed
  Rebuild Index
  Test Retrieval

Reranker model
Qwen3 Reranker 0.6B
  Status: Not installed
  Install

OCR engine
Auto

Available engines
Apple Vision Document OCR
  Status: Available on this Mac

Windows AI Text Recognition
  Status: Not available on this device

PaddleOCR
  Status: Not installed
  Download size: shown before install
  Install

OCR behavior
[x] Use OCR for image files
[x] Use OCR for image-only PDF pages
[x] Use OCR for image-heavy presentation slides
[ ] Keep low-confidence OCR text out of summaries

Test OCR
Choose Image
```

Local Tools should feel like Settings, not a plugin marketplace. The user should only see tools that explain a concrete capability, current status, privacy boundary, and install/remove action. Bundled tools should mostly read as "Ready"; repair details appear only when something is missing or blocked. RAG should feel automatic unless a model needs download, indexing is running, or retrieval quality needs troubleshooting.

### Pi Packages Settings

```txt
Packages

Recommended For Pige
pi-obsidian-vault
  Agent-safe Obsidian vault access
  Not installed
  Install

pi-smart-fetch
  Web capture helper
  Not installed
  Install

Advanced / Experimental
pi-local-rag
  External RAG reference; Pige has built-in local RAG
  Not installed
  Inspect

pi-hermes-memory
  External Pi memory reference; Pige has built-in memory
  Not installed
  Inspect

Installed
No packages installed

Advanced: Search Pi Catalog
memory, rag, web fetch, document parsing...
```

The default Packages screen should not look like a marketplace. It should show a short set of reviewed knowledge-management capabilities. Full catalog search belongs behind an Advanced affordance for power users.

Package details should show:

- Description.
- npm and repository links.
- Version and last update.
- Downloads and package type.
- Trust tier: built-in, curated, community, or blocked.
- Permissions: read vault, write vault, network, shell, model access, secrets, spawn agents.
- Data boundary.
- Install, disable, uninstall, update, and rollback actions where available.

### Backup And Restore

```txt
Backup and Restore

Create Backup
Last backup: Never

Restore Backup

Options
[x] Include Agent memory
[x] Include conversation history
[x] Include confirmation proposals and operation summaries
[ ] Include fast-restore database cache
[ ] Include encrypted model settings
```

Restore preview:

```txt
Restore Pige Backup

Created: 2026-07-09 12:00
Notes: 42
Sources: 18
Conversations: 9
Memories: 12
Includes secrets: No

Restore into:
/Users/name/Documents/Pige Vault Restored

Restore
```

### Appearance And Language

```txt
Appearance

Language
System
简体中文
English
日本語
한국어
Français
Deutsch

Theme
System
Light
Dark

Knowledge language
Preserve source language
```

Language settings:

- App language changes UI strings.
- Knowledge language controls generated wiki language only when the user chooses a preference.
- The source-language preservation control starts enabled; translating captured material
  remains an explicit user choice.
- Voice input language and OCR language hints may be configured separately when supported.

## 14. First-Run Flow

`ONBOARDING_AND_FIRST_RUN.md` owns the short sequence: Welcome language truth, skippable
Models, mandatory Vault, then Home.

## 15. Empty States

### 15.1 Empty Home

Message:

> Talk to Pige, or add something to work with.

Actions:

- Choose files.
- Paste from clipboard.
- Configure model if missing.

### 15.2 Empty Notes

Message:

> Notes will appear as Pige compiles your sources.

Action:

- Go to Home.

### 15.3 Model Missing

Message:

> Connect a model for Agent conversation. Saved sources remain safe meanwhile.

Action:

- Open Models.

## 16. Visual Direction

Tone:

- Minimal.
- Fresh.
- Quiet.
- Focused.
- Trustworthy.
- Lightweight.
- More empty canvas than dashboard.

Layout:

- Dense but breathable.
- No large marketing hero.
- No decorative cards inside cards.
- Stable panes.
- Narrow-window friendly.
- Default screen should not look like a knowledge management cockpit.
- Reveal structure only when the user asks to explore, search, confirm a change, or open a note.

Color:

- Avoid a one-note purple, beige, dark-blue, or brown palette.
- Use a neutral base with restrained accents.
- State colors should communicate status: processing, success, warning, error.
- Prefer a clean light theme by default.
- Use borders, spacing, and subtle contrast rather than heavy panels.

Typography:

- Clear UI font.
- Comfortable Markdown reading width.
- Markdown pages should feel refined enough for long reading sessions, with artifact-like rhythm and spacing.
- No viewport-scaled font sizes.
- No negative letter spacing.

Components:

- Icon buttons for sidebar, attach, send, settings, search, backup, restore.
- Tooltips for icon-only controls.
- Segmented controls for views.
- Toggles for binary options.
- Menus for provider and model choices.
- Cards only for repeated source/note rows or modal content.

Interaction complexity:

- The home composer requires no mode selection between capture, organizing, retrieval, and question answering.
- Do not add visible composer chips or toggles for "deep organize", "smart search", capture mode, ask mode, or retrieval mode.
- Voice input is a toolbar action inside the same composer, not a separate mode.
- Drag and drop requires no target precision.
- Navigation is progressive disclosure.
- Advanced Agent actions appear only in context: Home retrieval results, opened note, selected text, or confirmation cards.
- Empty states should invite action with one short phrase, not instructions.

## 16.1 Accessibility Baseline

v0.1 accessibility requirements:

- Primary flows are keyboard reachable: home composer, attach, voice, send, sidebar, knowledge retrieval results, note reader, confirmation cards, and Settings.
- Focus states are visible and not color-only.
- Every glyph-only control exposes an accessible name plus hover/focus help.
- Status states use text plus visual treatment, not color alone.
- Error messages are announced in a way screen readers can understand.
- The compact capture window remains usable with larger system text.
- The note reader keeps readable contrast in light and dark modes.
- Motion respects OS reduced-motion settings.
- Selection action menus should be reachable by keyboard after text selection when possible.
- Language switching should not trap focus or require restart unless technically necessary.

## 16.2 Pige Visual System

The sole baseline is `docs/prototypes/pige-complete-ui/index.html` plus its adjacent
design contract and element map. React/TSX preserves layout, IA, color, spacing, icons
and interaction; only reconciled capability, responsive or accessibility needs may
differ. `resources/ui-visual-contract.manifest.json` projects the machine subset.

### Brand and application icon

- The approved Pige application mark is the white pigeon cutout over a deep teal
  circle on a pure-white canvas. `resources/brand/pige-icon/master/pige-icon-1024.png`
  is the raster color and composition source of truth.
- Keep the mark quiet, singular, and recognizable. Do not add a letter, wordmark,
  badge, second metaphor, decorative container, tinted background, or artificial
  shadow. Do not recolor the approved artwork without a new UI Design review.
- Platform exports must preserve the full pigeon silhouette and current optical
  padding. The operating system, not the source artwork, owns final masks and corner
  treatment.
- macOS and iOS use an opaque square source and must not be pre-rounded. Windows must
  ship native small-size frames rather than relying only on a scaled 1024px image.
  Android uses adaptive foreground/background layers plus a monochrome layer, with the
  visible mark inside the centered `66/108` safe zone.
- At 16 to 32px, the eye, beak, teal circle, and white pigeon silhouette are the
  recognition-critical features. If a future vector redraw is required, simplify
  translucent tail detail before changing these four features.
- Platform export inventory and acceptance checks are maintained in
  `resources/brand/pige-icon/README.md`. Build configuration and store integration are
  Development/release responsibilities and must be verified in packaged output.

### Foundation

- Use a `4px` base spacing unit. Normal component spacing should use `4`, `8`, `12`,
  `16`, `20`, `24`, and `32px`; use `40` or `48px` only to separate major page regions.
- Default desktop UI text is `14px / 21px`. Compact metadata is `12px / 16px`; labels
  that must remain legible at the smallest supported density are `11px / 16px`.
- Use `16px / 24px` for emphasized body text, `18px / 24px` for small page headings,
  `20px / 28px` for section headings, and `24px / 32px` for the largest in-product
  heading. Marketing-sized type does not belong in the default shell.
- Use system UI fonts first: `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, then a
  locale-appropriate sans-serif fallback. Use the system monospace stack for code.
- Body and navigation text use weight `400`; interactive labels and compact headings
  may use `500`; page headings may use `600`. Avoid relying on weight `700` for routine
  hierarchy. Keep letter spacing at `0`; Pige does not use negative tracking.
- Reading prose is capped at `720px`. Governed pane min/default/max widths are Home
  `360/420/420px`, Library `240/280/320px`, Reader `560/720/960px`, and Note Agent
  `360/400/440px`.

### Shape, elevation, and boundaries

- Radius scale: `4px` for tiny indicators, `6px` for compact controls, `8px` for normal
  controls and rows, `10px` for navigation selections, `12px` for cards and menus,
  `16px` for dialogs, and `20` to `24px` for the composer. Pills use a full radius only
  when their shape communicates a compact action or status.
- Where the Chromium version supports `corner-shape`, large Pige surfaces may use a
  restrained superellipse. The fallback is the same documented circular radius; shape
  support must not change component measurements or hit targets.
- Prefer spacing, background contrast, and a hairline border over shadows. A normal
  border is one physical pixel or a half-pixel optical hairline where the platform
  renders it cleanly.
- Elevation is reserved for menus, dialogs, floating composer states, and drag targets.
  Suggested shadows are subtle: `0 1px 2px rgba(0,0,0,.08)`,
  `0 2px 4px rgba(0,0,0,.08)`, and at most `0 8px 16px rgba(0,0,0,.12)` for ordinary
  overlays. Do not place a shadow around every panel or row.
- Stable panes meet directly. Do not wrap panes in decorative outer cards or nest cards
  merely to create hierarchy.

### Layout metrics

- Toolbars are `46px` primary/`36px` compact/`40px` pane; icon targets are normally
  `32px`, minimum `28px`. The single native-control titlebar is `58px`; macOS uses traffic
  lights at `17px,17px`, `84px` inset, and `-5px` offset.
- Navigation is `240/280/320px`, leaves `320px` content, and hides in Compact Home;
  descriptive rows may grow from `32–36px` to `64px`. Frame-compensated resident budgets:
  Home + Library `720px`, Reader + Library `840px`, Reader + Agent `960px`, all `1240px`.
  Agent overlays before Library, both below `840px`; only Reader grows from `1440px`.
- Main may expand to the smallest work-area-eligible width, preserves the user base, never
  persists expansion, and restores after either close order. Padding is `16px` narrow/
  `20–24px` expanded; composer insets are `12–16px` edge/`12px` internal, with `28px`
  actions in larger targets.
- Home content/results/composer share center/width; adjacent content may overhang `24px`.
  Adapt by pane width; hide rails/move actions before shrinking text, targets, or composer.

### Color roles

- Implement colors through semantic roles, never raw palette names in components:
  `canvas`, `surface`, `surface-subtle`, `surface-elevated`, `text-primary`,
  `text-secondary`, `text-tertiary`, `border-subtle`, `border-strong`, `focus`,
  `accent`, `success`, `processing`, `warning`, and `danger`.
- The approved light baseline uses `#ffffff` canvas and `#202322` primary text; the dark
  theme uses a stepped neutral range rather than pure black for every layer. Adjacent
  panes should differ only enough to clarify structure.
- Primary text must meet WCAG AA contrast. Secondary and tertiary text may be quieter
  but must remain readable; disabled appearance must not be reused for ordinary
  metadata.
- Accent color appears on focus, links, selected semantic elements, and the primary
  send/confirm action. It is not a decorative wash across the application.
- Status colors always pair with text, an icon, or both. Warning and danger surfaces use
  a lightly tinted background and border; do not use saturated full-card fills for
  routine recoverable states.
- Focus rings use a dedicated, high-contrast role and remain visible in both themes.
  Hover, active, selection, and focus are separate states.

### Motion and feedback

- Default state transitions use `150ms`; pane or disclosure transitions may use
  `240` to `300ms`. Entering content may use an ease-out curve; direct manipulation
  should feel immediate.
- Animate opacity and transform when possible. Avoid layout motion that causes text or
  the composer to jump.
- Loading indicators should preserve layout. Use a calm pulse or shimmer only for
  content that is genuinely pending, and never use perpetual decorative motion.
- Respect `prefers-reduced-motion`: remove shimmer and transform travel, retain a clear
  static progress state, and do not make completion dependent on animation.
- Respect `prefers-reduced-transparency`: replace translucent elevated surfaces and
  backdrop blur with at least `95%` opaque semantic surfaces.

### Component behavior

- The composer is a surface, not a toolbar dashboard. Its empty state shows the text
  field plus attach, voice, and send actions; optional actions appear only when relevant.
- Icon-only actions have an accessible name, tooltip, visible hover/focus state, and a
  stable hit target. Prefer one consistent outline icon family with approximately
  `1.5px` to `2px` optical stroke weight.
- Selected navigation rows use a subtle neutral background before using an accent fill.
  Selection must remain distinguishable from hover and keyboard focus.
- Menus and dialogs use concise titles and one dominant action. Destructive confirmation
  is explicit and never the default-focused action.
- Empty states use one short invitation and, only when needed, one secondary sentence.
  They should not become onboarding brochures.
- Retrieval evidence, citations, and source rows are visually inspectable but secondary
  to the answer. Pige must not copy the developer-tool density of Codex surfaces into
  the default knowledge workflow.

## 16.3 Clean-Room Reference Record

A 2026-07-10 read-only inspection of supplied macOS Electron bundle `26.707.31428`
informed generic visual observations. It implements original tokens from first
principles. External names, marks, assets, source, copy, screens, secrets and control
bypasses are excluded. The bundle is research, not build authority.

## 16.4 Visual Fidelity Workflow

Visual acceptance follows the manifest, not memory: implement section 16.2; run
`verify:ui-visual`; render deterministic synthetic states at governed locale/theme/
viewport/scale/motion/font inputs; save screenshot plus build/platform/commit/state
metadata; inspect pixel and semantic differences; change baselines only with reviewed
rationale. Low pixel delta never excuses hierarchy, legibility, focus or clipping.
The matrix covers compact/expanded/reader widths, light/dark, governed locales and all
listed workflow states on macOS and Windows. Baselines never contain private vault/account
data, secrets, or external-product screenshots.

## 17. Interaction Rules

- Pasting a URL should prepare URL ingest automatically.
- Tapping the microphone should start local dictation on supported macOS versions.
- Dragging files over the window should turn the entire window into a drop target.
- Agent progress should be cancelable when possible.
- Completion cards distinguish created, updated, skipped, and unchanged vault outcomes.
- Errors should preserve user input and offer retry.
- Users should be able to reveal generated durable note or Dataset results.
- When a generated page updates existing knowledge, the UI should show "updated" separately from "created".
- Eligible Agent edits apply visibly with provenance and Undo; exceptional boundaries pause.
- Source warnings, including possible prompt injection, should be visible but not alarming.

## 18. v0.1 Screen Checklist

Must implement:

- First-run vault selection.
- Main home timeline.
- Home composer.
- Voice input button and recording state on supported macOS versions.
- Sidebar collapsed and expanded.
- Processing, autonomous Activity/Undo, and exceptional needs-attention cards.
- Library with notes, sources, topics, and tags.
- Read-only Dataset table in the existing Library/Home result surface.
- Expanded Library tree in the sidebar.
- Knowledge Tree semantic tree.
- Note reader.
- Settings: grouped sidebar with Basic, Knowledge Base, AI, Security, Extensions, and System.
- Settings: Models page for Provider connection, inventory, and Global Default.
- Settings: Local Capabilities page for local RAG, OCR, speech, parsers, and bundled toolchain.
- Settings: Permissions & Privacy page for submitted-turn authority, closed high-risk
  effects, exact Provider-send disclosure, and stored-credential isolation.
- Settings: Agent & Memory page.
- Settings: Skills and Pi Packages under Extensions.
- Settings: Vault & Note Storage plus Index & Maintenance under Knowledge Base.
- Settings: language, appearance, updates, and diagnostics.
- Accessibility: keyboard navigation, visible focus, accessible icon labels, and readable contrast.
- Home knowledge retrieval.
- Note Agent panel.
- Selection action menu.
- Dropping a supported item anywhere in the app window routes it to Home capture and
  shows a clear in-window drop affordance during the drag.

Can wait:

- Graph view.
- Rich full diff confirmation UI.
- Rich knowledge health workflows.
- Non-desktop capture surfaces already classified as post-v0.1 in the PRD.
- Editable Collections, relations, formulas, and custom views.

## 19. UI Acceptance Criteria

- The app is useful on a narrow vertical window.
- The first screen supports ordinary conversation, source work, and knowledge-enhanced
  answers without navigation or a mode choice.
- Sidebar expansion does not obscure the home composer.
- Text never overflows buttons or compact cards.
- Processing state is visible within one second after submit.
- A completed ingest clearly shows durable vault changes.
- Notes can be opened and read without knowing where files are stored.
- Home answers without local evidence when appropriate; when retrieval is used, ranked
  notes and grounded citations remain visible.
- CSV/XLSX/SQLite use the same preserve-first Home ingress; a calm read-only table opens
  exact cited revision/range evidence without an import mode or engine taxonomy.
- Opened notes can show a contextual Agent panel.
- Selected text exposes common actions without leaving the note.
- Settings offers preset connection, unified sync/manual inventory, and grouped Global Default without protocol/raw-ID work.
- The production shell exposes unfinished destinations only as one localized
  development/unavailable status; those entries never imply completed capability.
- Autonomous exact-page Undo is non-confirming, announced, focus-safe, and distinct from exceptional/failure states.
- The user can tell when captured content is being sent to a cloud model provider.
- The user can dictate into the main input on supported macOS versions without learning a separate recording workflow.
