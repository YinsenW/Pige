# Pige Interface Prototype

Status: Active product interaction and visual-system contract; static screens remain low fidelity
Last reviewed: 2026-07-10

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

Pige should feel extremely simple at first touch: a quiet window with one obvious bottom composer where the user can type, ask, paste, speak, or drop files. It should feel closer to ChatGPT's calm input surface than a document manager.

The interface should make one promise:

> Put it into Pige, or ask Pige. Pige will preserve sources, retrieve your knowledge, and maintain the wiki.

The user should not need to understand tags, folders, topics, sources, or wiki structure before using Pige.

## 2. Product Shape

Default desktop window:

- Narrow vertical layout.
- Comfortable as a side-window next to browser, PDF reader, or editor.
- Can be kept always-on-top by explicit user choice.
- Almost empty by default.
- Single bottom home composer as the main interaction surface.
- The same composer supports capture, retrieval questions, lightweight conversation, URL paste, file attach, drag-and-drop, and voice input.
- Retrieval-oriented answers should be grounded in the local knowledge base by default, not generic open-ended chat.
- Sidebar hidden by default, not merely collapsed into visual noise.
- Recent activity appears only after the user has active capture, parser, OCR, Agent ingest, or index jobs. The compact Home strip uses localized status dots and at most three visible source names; it is not a second Inbox or Review destination.
- Home refreshes the strip while a job is queued or running, then stops polling for dependency-waiting or terminal jobs to keep idle work low.
- Whole window becomes a file drop hot zone while dragging files over it.

Expanded state:

- Sidebar opens to reveal Home, Library, Knowledge Tree, and Settings.
- Processing, failed jobs, and confirmation-needed changes appear as status cards, notifications, or contextual confirmation surfaces rather than default top-level destinations.
- Library contains an Agent-maintained note tree, notes, sources, topics, and tags.
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

- Fast capture and knowledge-base questions while working in other apps.
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
- The user should not choose between "capture" and "ask" before typing. Pige infers intent from input and attached context.

### Expanded Workspace

Purpose:

- Continue the home dialogue.
- Browse the Library.
- Inspect captures and sources.
- See processing status and confirmation-needed changes when they exist.
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
- Confirmation-needed changes are surfaced inline or in a right-side status panel, not as a mandatory navigation concept.

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
- Menu and settings are present but visually quiet.
- User can type a question, paste a URL, paste long text, attach a file, or drag files anywhere onto the window.
- On supported macOS versions, the microphone button starts voice dictation into the same input.
- Recent activity appears above the composer only after there is something useful to show.
- The same input supports capture and retrieval questions. User should not see separate "Capture" and "Ask" modes.
- The composer must not show mode chips such as "Deep Organize" or "Smart Search"; Agent intent routing decides whether to capture, organize, retrieve, answer, or ask for confirmation.
- If the input is a question, Pige should first retrieve from the local knowledge base and then answer with ranked notes and citations where possible.

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

- Activity is secondary to the home composer.
- Recent items summarize durable changes.
- The user can ignore the activity area and keep adding sources or asking questions.

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
- Processing and confirmation-needed items appear as Home status cards, not as separate required navigation.

## 5. Home Composer

Input states:

- Empty.
- Question draft.
- Source draft.
- Text draft.
- Voice recording.
- Voice unsupported.
- URL detected.
- Files attached.
- Processing.
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
- Live transcript appears in the input as editable text.
- Finalized transcript remains editable before submission.
- Stop recording does not automatically submit unless the user chooses that behavior later.
- On unsupported platforms, the microphone button is hidden or disabled with a short tooltip.

### 5.2 URL Detected

```txt
┌────────────────────────────────────┐
│ https://example.com/article        │
│                                    │
│ Web page detected             ↑   │
└────────────────────────────────────┘
```

On submit:

- Create job.
- Fetch page.
- Show progress in timeline.

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

- Create one job per file.
- Group them visually if dropped together.

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
2 proposed updates need confirmation.
```

## 6.1 Processing And Confirmation States

Pige should not expose "Inbox" and "Review" as default first-level destinations. They are internal operational concepts surfaced only when useful:

- Processing status appears in Home as recent activity, status cards, or compact progress rows.
- Failed jobs appear in Home with retry and preserve-source actions.
- Risky Agent changes appear as confirmation cards, inline banners, or a focused confirmation surface.
- A dedicated management view can exist behind status cards or Settings for advanced cleanup, but it should not be part of the default mental model.

Processing states:

- Queued.
- Processing.
- Failed.
- Ready to retry.
- Needs confirmation.
- Completed with warnings.

Confirmation items should show what Pige wants to change before the user approves it.

```txt
Needs Confirmation

2 proposed updates

Update Concept
Agent-maintained Wiki
Reason: new source adds a stronger definition
Changes: 2 paragraphs, 3 links

Approve   View Diff   Reject

Merge Topics
Agent Notes -> Agent Workflows
Reason: likely duplicate topic
Changes: rename and backlink updates

Approve   View Diff   Reject
```

v0.1 confirmation should show a unified text diff for updates to existing pages. New pages can use a compact summary plus Markdown preview. A richer side-by-side diff editor can wait.

## 7. Home Knowledge Retrieval

Home knowledge retrieval is the default answer behavior when the user asks a question in the home composer. It should accept natural language and return a grounded synthesis plus ranked notes, not just a generic chat answer.

Prototype:

```txt
Home

How did we decide to handle BYOK providers?

Summary
Pige treats BYOK as a first-class model configuration layer. The first version supports OpenAI, Anthropic, OpenAI-compatible, and Anthropic-compatible providers. The design also separates provider credentials from vault data and shows whether a provider is local, self-hosted, or cloud-hosted.

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
- Saving an answer creates a proposed note or appends to an existing note after confirmation.
- There is no separate default "Ask" entry in navigation; this behavior lives inside Home.

Current Home foundation:

- Without a ready model, question-like input returns the bounded local extractive answer and ranked lexical results before any Agent job, credential read, or cloud call.
- With a ready model, Pi Agent calls one Pige-owned current-vault search tool and may return only citations from the selected evidence. Empty evidence produces a visible insufficient-evidence result with no model prose or citations.
- One compact inline status may move through Accepted, Running, Waiting, Failed, and Completed. A model-required wait offers Configure Models; retryable failure offers Retry. Copy is localized and never exposes a raw provider error or creates a new dashboard.
- While work is active, the UI labels a planned cloud send only for a cloud boundary. Afterward it labels an actual cloud attempt/result only when a cloud model turn occurred; local or no-model results are never described as cloud use.
- Results retain bounded title, snippet, page type, citation, and open action. Ordinary non-question text remains capture input.
- Broader semantic/vector retrieval, follow-ups, save-answer proposals, and jump-to-snippet opening remain later slices.

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
- Pige-managed generated sections should be editable, but risky rewrites can enter confirmation.

Phase 2/3 bridge:

- Opening a Library row shows a minimal rendered reader.
- The reader hides frontmatter and shows compact metadata derived from frontmatter.
- Markdown rendering supports the initial structured pipeline with GFM, sanitized HTML, wiki-link anchors, source-citation anchors, stable code/table overflow, and constrained images.

Current Phase 4 reader context foundation:

- Opening a Library row or Home retrieval result can show resolved outgoing links and backlinks from `library.related`.
- Wide readers use a right-side related context rail; narrow readers stack the related context below the Markdown body.
- Related rows open notes through stable page IDs only. The renderer never receives arbitrary filesystem paths or note bodies from related-page APIs.
- Editing, code-copy controls, selection actions, right-side Note Agent, source references, and reveal-source/open-folder actions remain later reader slices.

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

Note Agent behavior:

- Uses current note as primary context.
- Can answer questions about the note, its sources, and related notes.
- Can suggest backlinks and related pages.
- Can propose edits, but meaningful edits should preview or require confirmation.
- Read-only answers stay in the panel and do not automatically become notes.

### 8.3 Selection Actions

Selecting text in a note should reveal a compact action menu.

Prototype:

```txt
Selected text...

Copy  Quote  Ask  Translate  Polish  Expand  Summarize  More
```

Action behavior:

- Copy and quote are local and instant.
- Translate, polish, expand, summarize, and explain can return inline output or send results to the Note Agent panel.
- Create note from selection should open a preview before writing.
- Mutating actions should preserve the original text until the user confirms.
- Large rewrites should create a confirmation proposal.

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

Phase 2/3 implementation bridge:

- The sidebar exposes a single Library entry.
- The Library panel may initially show a simple frontmatter-derived list of source and wiki pages.
- It should show page title, type, status, relative page path, language, and source count only.
- Library rows can open a minimal rendered reader for the selected page.
- Full Library tree, source tabs, related pages, edit mode, Note Agent, selection actions, reveal-source actions, and Knowledge Tree remain later UI slices.

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
- Confirmation-needed relationship suggestions.

Visual encoding:

- Trunk thickness represents the total weight of a knowledge domain.
- Branch thickness represents the weight of a topic or concept.
- Leaf count represents the number of fragmented knowledge units under that branch.
- Leaf size represents the size or importance of a leaf cluster.
- Leaf color depth represents density: deeper color means more accumulated fragments or stronger evidence.
- New or low-confidence growth can use lighter leaves until confirmed or reinforced.

Prototype:

```txt
Knowledge Tree

Main trunk: Local-first
  Branch: Local RAG
    Leaves: Embedding, lexical search, reranker, chunks, citations
  Branch: Agent Memory
    Leaves: preferences, corrections, scenarios
  Branch: OCR Pipeline
    Leaves: screenshots, scanned PDFs, slides

Right Panel
  Current trunk: Local-first
  42 notes
  108 fragments
  3 branch growth suggestions
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
- Permissions & Privacy contains permission modes, saved grants, API key storage, cloud-send policy, secret redaction, and YOLO.
- Vault & Note Storage contains vault identity, active vault path, note/knowledge root path, source asset root path, source storage policy, recent vaults, backup, restore, export, and trash.
- Index & Maintenance contains rebuild index, reset local database, knowledge health, chunk status, and repair actions.
- Agent & Memory contains `PIGE.md`, Agent behavior preferences, memory inspection, and confirmation thresholds.
- Skills and Pi Packages are both under Extensions, but remain separate pages.
- Cross-links are allowed, but cards from another domain should not be embedded in the current page.

### Vault, Note Storage, And Backup

```txt
Vault & Note Storage

Current vault
Pige Vault
/Users/name/Documents/Pige Vault

Note storage
/Users/name/Documents/Pige Vault

Source assets
/Users/name/Documents/Pige Vault/raw
Default: copy dropped files into Pige source storage

Open in Finder
Open another vault
Create new vault

Recent vaults
Work Notes
Research Archive

Backup and restore
Last backup: Never
Create Backup
Restore Backup
```

Vault & Note Storage is required in v0.1 because Pige is a local-file product. In Chinese, label it plainly as "仓库与笔记存储". The page should be boring in the best way: it tells the user where their notes live and gives them safe local control. Backup and restore are present because they protect the vault, but the page's first job is Obsidian-like vault location management.

Required controls:

- Show current vault name and active vault path at the top.
- Show note/knowledge root and source asset root separately, even when both are inside the same Pige vault folder.
- Let users choose the default source storage strategy: copy to Pige source storage or reference original. A future advanced link strategy can appear only after platform behavior is proven safe.
- Reveal current vault in Finder or File Explorer.
- Open another existing vault folder.
- Create a new vault by choosing a parent folder and vault name.
- Show recent vaults with "remove from list" behavior that does not delete files.
- Show last backup state and entry points for Create Backup and Restore Backup.
- Show schema version and basic counts when available: notes, sources, managed source copies, referenced originals, and artifacts.
- Warn against nested vaults and app/system data folders.
- Do not hide note storage controls inside backup, export, diagnostics, or index maintenance.
- Do not expose database file paths, cache folders, parser artifact internals, checksums, or symlink mechanics on the default page.
- Do not offer a one-click "move current vault" in v0.1. If Pige later moves a vault itself, it must be a guarded migration wizard with preflight checks, backup, copy verification, and rollback.

Reset Local Database should be framed as a repair action under Index & Maintenance. It deletes rebuildable SQLite/index files and recreates them from Markdown, source records, artifacts, memory text, proposals, and operation summaries. It must not delete notes or source assets.

### Model Settings

```txt
Models

Recommended
OpenAI
API key  [Connect]

▸ Custom provider

Models
gpt-5-mini     OpenAI     Global Default
gpt-4.1-mini   OpenAI     Set as Global Default
```

The default path is one reviewed OpenAI preset with fixed endpoint/protocol metadata. It asks only for an API key, discovers a bounded model list, and establishes one Global Default. Custom provider setup stays collapsed; only after expansion may it show name, protocol/service type, Base URL, API key, manual model ID, and boundary.

Models from every connected Provider Profile appear in one global list with their provider label. Exactly one model is Global Default; model selection does not live inside a provider card. Full preset catalogs, API-key help links, and polished OpenAI-compatible, Anthropic-compatible, and Responses-compatible custom setup remain open.

Do not show provider capability matrices, marketplaces, routing details, pricing, context windows, feature tags, per-workflow model choices, Advanced/Fast assignments, OCR, local embeddings, tools, Skills, backup, or memory controls here. Pi AI catalog metadata remains internal unless a later workflow needs it.

### Deferred Model Routing Settings

Do not show a Model Assignment settings entry in v0.1.

Pige should expose one effective default model until runtime support exists for real model routing. Advanced/Fast model assignment may become visible only after Pi Agent upstream provides stable model-slot routing APIs, or after Pige implements a tested Model Routing Service that maps task classes to actual Pi Agent or Pi AI calls. The UI must never present a model slot that does not change runtime behavior.

### Permissions And Privacy Settings

```txt
Permissions & Privacy

Cloud model use
Pige shows a visible indicator when content is sent to the configured provider.

API keys
Encrypted storage: On
Plaintext portable/developer mode: Off

Before sending to a model
[x] Ask for confirmation on large sources
[x] Ask for confirmation on sources marked private
[x] Redact obvious secrets before model calls
```

v0.1 must include these privacy controls as first-class settings under Permissions & Privacy, not inside Models. Provider setup, capture processing, and home knowledge retrieval must also show a visible cloud-send indicator whenever source content is sent to a cloud-hosted model. Plaintext secret storage is an advanced escape hatch only; enabling it should show a calm but explicit warning that API keys may be readable from local files.

Voice input, OCR, local RAG, parser health, and bundled toolchain status belong to Local Capabilities. Models should not contain those controls.

### Permission Mode And Grants

```txt
Permissions

Default mode
( ) Ask every time
(x) Remember scoped grants
( ) YOLO full access

Saved scoped grants
Source Research
  External network: always allowed for this Skill version
  Revoke

YOLO full access
Off
Enable...
```

Default mode behavior:

- Ask every time: prompt for each sensitive action unless a saved grant exists.
- Remember scoped grants: the normal power-user mode; prompts can be saved permanently for a scoped actor/capability/resource.
- YOLO full access: auto-allows eligible declared Agent, Skill, package, tool, network, shell, filesystem, and ordinary model-call capabilities until disabled. It never reveals raw secrets or replaces always-required destructive, settings, restore, migration, or model-egress confirmation.

Common grant scopes:

- Only this URL.
Scope choices are rendered from the Permission Broker request. Their exact resource
semantics and allowed scope vocabulary are owned by
[`SECURITY_THREAT_MODEL.md`](SECURITY_THREAT_MODEL.md#7-permission-model); UI copy may
group adjacent source/note or file/folder choices without redefining authorization.

YOLO enable dialog:

```txt
Enable YOLO full access?

Pige will stop asking for eligible Agent, Skill, package, tool, network,
shell, filesystem, and ordinary model actions. High-impact changes and
stricter cloud-send confirmations will still ask. Raw secrets are never exposed.

Actions will still be logged. You can turn this off anytime.

Cancel        Enable YOLO
```

When YOLO is enabled, Settings and permission-sensitive areas should show a compact persistent indicator such as `YOLO: On`. The indicator should be calm and visible, not a warning banner that dominates the product.

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
[x] Confirmation behavior
[x] Avoiding repeated Agent mistakes

Controls
Inspect Memory
Export Memory
Reset Memory
```

Memory should feel transparent rather than anthropomorphic. The page should show what Pige remembers, why it was remembered, where it came from, and how to disable or delete it. Sensitive or broad memories should require confirmation instead of silently becoming active.

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
- Saved permission grants and revoke controls.
- Trigger phrases.
- Last used.
- Enable, disable, uninstall, export, and update actions.

Skills should feel like small knowledge workflows, not apps. Pure Skills are Markdown instruction packs. External/Web Skills can declare sensitive capabilities, but the UI must show those capabilities before enabling and route runtime actions through the Permission Broker.

Permission dialog:

```txt
Source Research wants to fetch a web page

Capability
External network

Scope
https://example.com/*

Reason
Read the article linked in the current capture.

Data boundary
Network

Scope: Only this domain

Deny        Allow Once        Always Allow
```

The dialog should feel close to ChatGPT/Codex permission prompts: compact, calm, clear, and not visually alarming. Destructive actions should use stronger confirmation copy and never default to Allow. If YOLO full access is enabled, eligible Permission Broker actions should not show this dialog; the timeline should instead show a subtle "Auto-allowed by YOLO" event with details available on inspection. Always-required change confirmations and stricter Model Egress Decisions still show their own focused confirmation.

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

Detailed first-run, capture-only, and missing-model behavior is governed by `docs/ONBOARDING_AND_FIRST_RUN.md`.

Step 1: Welcome.

- Choose or create local vault.
- Explain local-first briefly.

Step 2: Model setup.

- Choose provider.
- Enter API key.
- Test connection.
- Allow skip into capture-only mode: Pige preserves source records/source assets and queues Agent processing until a model is configured.

Step 3: Start capture.

- Land directly in Home.

First-run should be short. The app should not become a marketing landing page.

## 15. Empty States

### 15.1 Empty Home

Message:

> Put things in, or ask directly.

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

> Add a model provider to process saved captures and new captures.

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

This section is the production visual baseline for Pige. It translates the quiet,
low-friction qualities observed in polished chat-style desktop applications into an
original Pige system. Values are implementation targets rather than permission to copy
another product's source, assets, trademarks, illustrations, or exact screen composition.
`resources/ui-visual-contract.manifest.json` projects the machine-checkable subset of
this owner contract into renderer tokens, structural declarations, and the governed
visual-capture matrix. The manifest must not invent behavior absent from this document.

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
- Reading content should normally remain between `640px` and `768px`. Expanded Home
  dialogue, retrieval, and composer surfaces use a shared `48rem` (`768px`) alignment
  grid; compact dialogue may use a narrower `480px` to `560px` measure.

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

- Primary toolbar height is `46px`; compact toolbars are `36px`; pane toolbars are
  `40px`. Icon-button hit targets should normally be at least `32px`, and never below
  `28px` in dense desktop contexts.
- Expanded navigation starts near `240px`, prefers about `272px`, and may grow to
  `320px` for localized labels or tree depth. It must leave at least `320px` for the
  active content pane and must be hidden, not squeezed into noise, in Compact Home.
- Navigation and settings rows normally occupy `32` to `36px`; settings rows containing
  descriptions may grow to `64px`. Do not force explanatory text into a compact row.
- Pane padding is `16px` in narrow windows and `20` to `24px` in expanded workspaces.
  The composer sits `12` to `16px` from the safe window edge and retains that inset
  during scrolling.
- Home answer content, results, and composer share the same center line and outer width.
  Adjacent content may overhang the text measure by `24px`; the Composer itself keeps an
  internal `12px` inset and uses `28px` circular action targets inside a larger accessible
  hit area.
- Use container- or pane-width adaptation rather than viewport typography. At narrow
  widths, hide secondary rails, move contextual actions into drawers, and preserve the
  composer before reducing readable text or hit targets.

### Color roles

- Implement colors through semantic roles, never raw palette names in components:
  `canvas`, `surface`, `surface-subtle`, `surface-elevated`, `text-primary`,
  `text-secondary`, `text-tertiary`, `border-subtle`, `border-strong`, `focus`,
  `accent`, `success`, `processing`, `warning`, and `danger`.
- The light theme starts with near-white canvas and white primary surfaces; the dark
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

The visual system above was informed by a read-only inspection on 2026-07-10 of the
macOS Electron application supplied as `ChatGPT.dmg`, bundle version `26.707.31428`.
The inspection covered packaged HTML/CSS metadata and visible structural constants such
as spacing, typography, radii, toolbar sizes, sidebar sizing, theme roles, and motion.
The second pass also compared those observations with Pige's renderer CSS and applied
the resulting Pige semantic tokens to the live desktop shell. Confirmed structural
observations included a `48rem` Electron content grid, `16px` conversation-group spacing,
`4px` grouped-item spacing, `28px` Composer actions, `30` to `36px` navigation/control
rows, layered half-pixel elevation strokes, and explicit reduced-motion/transparency
fallbacks.

The following are deliberately excluded from Pige:

- OpenAI/ChatGPT/Codex names, logos, icons, illustrations, sounds, and branded fonts.
- Copied JavaScript, React component code, CSS bundles, localized product copy, or
  proprietary assets.
- Product-specific screens, developer workflows, model marketplaces, capability
  catalogs, and provider/runtime complexity that conflict with Pige's Simplicity First
  directive.
- Any secret, credential, account data, endpoint behavior, or security-control bypass.

Implementers should reproduce the Pige tokens and behavior in this document from first
principles. The inspected application bundle remains external research material and is
not a build input, repository dependency, fixture, or redistribution source.

## 16.4 Visual Fidelity Workflow

Visual fidelity is verified as a development workflow, not accepted from visual memory.

1. Implement against the semantic tokens and component metrics in section 16.2.
2. Run `npm run verify:ui-visual` before capturing screenshots. This rejects drift in
   protected tokens and structural metrics.
3. Render the state matrix declared by `resources/ui-visual-contract.manifest.json` with
   deterministic synthetic content, fixed locale, theme, viewport, device scale factor,
   reduced-motion setting, and stable fonts.
4. Save the screenshot and sidecar metadata under the manifest's governed artifact path.
   Metadata records app build, platform, commit, viewport, scale factor, locale, theme,
   state fixture, font readiness, and capture time.
5. Compare against the approved baseline. A pixel difference above the manifest threshold
   requires inspection; a difference below it may still fail for hierarchy, legibility,
   focus, clipping, or interaction-state reasons.
6. Baselines change only with a reviewed rationale tied to the owner contract. Never
   auto-accept screenshots merely to make CI green.

The required matrix covers compact, expanded, and reading widths; light and dark themes;
Chinese, English, German, and Japanese; and empty, typing, attachment, processing,
retrieval, error, drag, navigation, library, reader, settings, confirmation, and permission
states. Release evidence must include macOS and Windows because native text rendering and
window chrome differ. Private vault content, real account data, secrets, and external
product screenshots are forbidden in committed baselines.

## 17. Interaction Rules

- Pasting a URL should prepare URL ingest automatically.
- Tapping the microphone should start local dictation on supported macOS versions.
- Dragging files over the window should turn the entire window into a drop target.
- Agent progress should be cancelable when possible.
- Completion cards distinguish created, updated, skipped, and unchanged vault outcomes.
- Errors should preserve user input and offer retry.
- Users should be able to open generated Markdown in the system file browser.
- When a generated page updates existing knowledge, the UI should show "updated" separately from "created".
- Risky Agent edits should require confirmation instead of silently changing the wiki.
- Source warnings, including possible prompt injection, should be visible but not alarming.

## 18. v0.1 Screen Checklist

Must implement:

- First-run vault selection.
- Main home timeline.
- Home composer.
- Voice input button and recording state on supported macOS versions.
- Sidebar collapsed and expanded.
- Processing and confirmation-needed status cards.
- Library with notes, sources, topics, and tags.
- Expanded Library tree in the sidebar.
- Knowledge Tree semantic tree.
- Note reader.
- Settings: grouped sidebar with Basic, Knowledge Base, AI, Security, Extensions, and System.
- Settings: Models page containing only BYOK provider connection.
- Settings: Local Capabilities page for local RAG, OCR, speech, parsers, and bundled toolchain.
- Settings: Permissions & Privacy page for default permission mode, saved grants, cloud-send policy, secrets, and YOLO.
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

## 19. UI Acceptance Criteria

- The app is useful on a narrow vertical window.
- The first screen supports capture and knowledge questions without navigating elsewhere.
- Sidebar expansion does not obscure the home composer.
- Text never overflows buttons or compact cards.
- Processing state is visible within one second after submit.
- A completed ingest clearly shows durable vault changes.
- Notes can be opened and read without knowing where files are stored.
- Home knowledge retrieval returns ranked notes plus a grounded synthesis.
- Opened notes can show a contextual Agent panel.
- Selected text exposes common actions without leaving the note.
- Settings make BYOK setup understandable without exposing unnecessary advanced options.
- The user can tell whether an Agent change was applied, needs confirmation, or failed.
- The user can tell when captured content is being sent to a cloud model provider.
- The user can dictate into the main input on supported macOS versions without learning a separate recording workflow.
