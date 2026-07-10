# Pi Package Catalog Research

Status: Draft baseline
Date: 2026-07-09
Authority: Dated research snapshot and curation rationale. Do not load by default unless Pi package curation is in scope. Normative package behavior must live in `docs/SKILL_EXTENSION_DESIGN.md`, `docs/TECH_ARCHITECTURE.md`, or `docs/DECISION_LOG.md`.

## 1. Crawl Summary

Source:

- https://pi.dev/packages

The Pi package catalog describes packages as extensions, skills, prompt templates, and themes published to npm, installable with `pi install npm:<package>`.

Crawl snapshot:

- Total catalog count shown by Pi: 5,007 packages.
- Pages crawled: 101.
- Packages parsed: 5,007.
- Unique package names: 5,007.
- Snapshot rechecked on 2026-07-09: the catalog page still shows `1-50 / 5007` and page `101`, while the recently published list changes continuously.
- Package names and recommendation candidates should be treated as a dated review snapshot, not a pinned dependency list.

Parsed fields:

- Package name.
- Description.
- Author.
- Package type badges.
- Monthly downloads.
- npm URL.
- Repository URL when present.
- Catalog page.

Automatic category counts from name and description scoring:

- UI / interaction / review: 1,181.
- Workflow / orchestration: 910.
- Context management: 795.
- Retrieval / RAG / search: 587.
- Web / source ingest: 572.
- Local inference / model provider: 441.
- Safety / security / permissions: 419.
- Memory / knowledge: 401.
- Document parsing: 264.

## 2. Product Interpretation

The catalog is too large and uneven to blindly bundle. Pige should treat it as an extension ecosystem with a curated default layer.

Pige must remain a vertical personal knowledge management Agent. The Pi ecosystem is useful because it can strengthen capture, parsing, memory, retrieval, local inference, context control, and safety. It should not turn Pige into a broad Agent launcher, coding-agent distribution, automation suite, or general plugin marketplace.

Recommended policy:

- Do not auto-install community packages during Agent jobs.
- Do not ship 5,000 packages inside Pige.
- Add a Pi Package Manager surface for explicit install, uninstall, update, disable, and inspect actions.
- Start with a small curated allowlist for personal knowledge management.
- Run package review before a package can become built-in or recommended.
- Keep installed packages machine-local, outside the vault.
- Store package metadata, version pins, permissions, and install records in machine-local settings.
- Let package-generated durable artifacts go into the vault only through Pige-approved write paths.

## 3. Selection Criteria

Packages are promising for Pige when they help with at least one of these jobs:

- Capture sources from the web or structured services.
- Convert sources into clean Markdown.
- Search, retrieve, or index local knowledge.
- Maintain memory and context across Agent sessions.
- Reduce context-window noise.
- Improve local RAG or local model routing.
- Add safe Agent workflows such as plans, todos, review, or user clarification.
- Add permission, sandbox, or secret-scanning boundaries.
- Bridge existing note systems such as Obsidian, Notion, or Confluence.

Packages should be deprioritized when they are:

- Purely coding-agent-specific with no knowledge-management value.
- UI decoration only.
- Cloud-only without clear data-boundary disclosure.
- Too broad, opaque, or unmaintained.
- Duplicative of a safer Pige-native core feature.
- General autonomous task frameworks whose main value is outside capture, organization, retrieval, review, or knowledge reuse.
- Social, entertainment, marketing, or unrelated business automation packages.

The default package recommendation screen should feel sparse. A user should see a few clearly useful knowledge packages, not a marketplace wall.

## 4. Highest-Value Packages To Review

These are not automatic dependencies. They are candidates for review, adaptation, or managed install.

### 4.1 Local RAG, Search, And Retrieval

- `pi-local-rag`
  - Why: Local hybrid RAG using SQLite FTS5, sqlite-vec, ONNX embeddings, PDF/DOCX/HTML extraction, and OCR fallback.
  - Pige use: Study architecture and possibly adapt concepts into Pige's native Local RAG Engine.

- `context-mode`
  - Why: Context saving, sandboxed execution, FTS5 knowledge base, and intent-driven search.
  - Pige use: Study context compression and FTS-backed knowledge retrieval.

- `pi-lcm-memory`
  - Why: Persistent semantic memory with hybrid FTS5 and vector recall.
  - Pige use: Candidate pattern for local memory recall.

- `pi-cbm`
  - Why: Codebase memory MCP integration, auto-indexing, workflow/token optimizations.
  - Pige use: Evaluate indexing and memory-management patterns.

- `opencode-codebase-index`
  - Why: Local codebase indexing.
  - Pige use: Lower priority unless Pige later adds code-vault workflows.

### 4.2 Persistent Memory And Knowledge

Memory decision for Pige:

- Pige should implement a native Agent Memory Core by default.
- External memory packages should be treated as references or optional curated packages.
- The default memory layer must obey Pige's vault schema, confirmation gates, Local RAG stack, privacy controls, backup policy, and UI.

- `TencentCloud/TencentDB-Agent-Memory`
  - Why: Strong external reference for layered memory, traceable compression, local SQLite/sqlite-vec storage, persona/scenario/atom/event layering, and symbolic short-term context offload.
  - Pige use: Study architecture. Do not make it the default memory runtime in v0.1 because it is built primarily as an OpenClaw/Hermes plugin with its own gateway, patch scripts, storage conventions, and lifecycle.

- `pi-hermes-memory`
  - Why: Persistent memory, session search, secret scanning, SQLite FTS5, auto-consolidation, procedural skills.
  - Pige use: Strong reference for memory-policy design, secret scanning, session search, auto-consolidation, and procedural memory. Candidate optional package after review, not default core.

- `gentle-engram`
  - Why: Persistent memory shared across sessions, compactions, and MCP agents.
  - Pige use: Candidate for long-lived personal memory design and optional advanced integration. Not default core because Pige needs product-specific vault/review behavior.

- `pi-memctx`
  - Why: Loads, searches, and persists knowledge across sessions using Markdown packs.
  - Pige use: Very aligned with Pige's Markdown-native vault. Study file layout and context injection patterns.

- `pi-memory`
  - Why: Plain Markdown durable facts, decisions, daily logs, scratchpad, and optional semantic/hybrid search.
  - Pige use: Study as a simple Markdown-first memory baseline.

- `@remnic/plugin-pi`
  - Why: Remnic memory extension for Pi agents.
  - Pige use: Evaluate for agent memory workflows.

- `@firstpick/pi-package-learnings`
  - Why: File-based LEARNINGS archive with retrieval workflow, summary prompts, and sync scripts.
  - Pige use: Strong fit for troubleshooting notes and durable learning pages.

### 4.3 Web And Source Capture

- `pi-lynx`
  - Why: Context-safe plain-text web, GitHub, Wikipedia, Reddit search and page fetch with no API keys.
  - Pige use: Candidate for web/source capture patterns.

- `pi-web-access`
  - Why: Web search, URL fetch, GitHub clone, PDF extraction, YouTube understanding, local video analysis.
  - Pige use: Broad source ingestion candidate, requires careful permission review.

- `pi-smart-fetch`
  - Why: Smart web fetch with desktop-browser TLS impersonation and Defuddle extraction.
  - Pige use: Strong candidate for web article capture quality.

- `@mrclrchtr/supi-web`
  - Why: Fetch web pages as clean Markdown and library docs through Context7.
  - Pige use: Useful reference for Markdown capture UX.

- `pi-quiver`
  - Why: Context-safe fetch plus PDF/DOCX/PPTX-to-Markdown conversion.
  - Pige use: Strong document-ingest reference.

- `@curio-data/pi-intelli-search`
  - Why: Search, extract, collate, and cache grounded web context.
  - Pige use: Research workflow candidate.

### 4.4 Existing Knowledge System Bridges

- `pi-obsidian-vault`
  - Why: Agent-safe Obsidian vault access, retrieve, validate, plan, write, edit, manage, and explicitly destroy Markdown with approval.
  - Pige use: Very relevant to vault governance and migration.

- `pi-notion`
  - Why: Search, fetch, create, and update Notion pages as Markdown.
  - Pige use: Candidate for future import/export bridge.

- `pi-confluence`
  - Why: Search, fetch, and save Confluence pages as Markdown.
  - Pige use: Future workplace knowledge-source connector.

### 4.5 Context Compression And Tool Output Management

- `@hypabolic/pi-hypa`
  - Why: Keeps noisy tool output out of context; deterministic compression and recoverable evidence.
  - Pige use: Strong fit for Agent trace compression and evidence retention.

- `pi-lean-ctx`
  - Why: Routes shell/read/grep/find/ls through lean context tools with persistent session cache.
  - Pige use: Candidate pattern for keeping Agent operations context-efficient.

- `@pi-unipi/compactor`
  - Why: Zero-LLM compaction, session continuity, sandbox execution, tool-display optimization.
  - Pige use: Candidate for local compaction and continuity.

### 4.6 Local Models And Inference

- `pi-llama-cpp`
  - Why: llama.cpp integration with routing and multi-server support.
  - Pige use: Reference for local inference integration; Pige should still keep its own Local RAG Engine stable and simple.

- `tmlpd-pi`
  - Why: Multi-LLM router with local LLM support, caching, token compression, speculative decoding, and routing ideas.
  - Pige use: Future advanced model-routing inspiration.

- `@cltec/pi-ollama-web-search`
  - Why: Local-first Ollama web search/fetch.
  - Pige use: Useful if Pige later adds local-only model profiles.

### 4.7 Agent Workflow, Planning, And Confirmation

- `pi-subagents`
  - Why: Delegating tasks to subagents with chains, parallel execution, and TUI clarification.
  - Pige use: Future multi-agent ingest and maintenance workflow.

- `@quintinshaw/pi-dynamic-workflows`
  - Why: Dynamic workflows, subagents, model routing, token/cost accounting, resume, and research.
  - Pige use: Inspiration for long-running knowledge maintenance jobs.

- `@mjasnikovs/pi-task`
  - Why: Deterministic task planning and spec orchestration with verify/enforce gates.
  - Pige use: Candidate for safe Agent job planning.

- `@juicesharp/rpiv-todo`
  - Why: Persistent todo list for the model that survives reload and compaction.
  - Pige use: Agent job tracking and visible maintenance plans.

- `@juicesharp/rpiv-ask-user-question`
  - Why: Structured questionnaire for model clarification.
  - Pige use: Could improve review and ambiguous capture workflows.

### 4.8 Safety, Permissions, And Trust

- `@gotgenes/pi-permission-system`
  - Why: Permission enforcement for Pi coding agent.
  - Pige use: Strong candidate for extension permission model ideas.

- `pi-landstrip`
  - Why: Landlock-based sandboxing with interactive permission prompts.
  - Pige use: Linux sandboxing reference.

- `pi-hermes-memory`
  - Why: Includes secret scanning in addition to memory.
  - Pige use: Security pattern for memory and retrieval.

## 5. Recommended Pige Extension Policy

Pige should support four package tiers:

1. Built-in core
   - Pige-native features such as Local RAG, vault compiler, parser service, backup/restore, OCR routing, and bundled toolchain.
   - These are not installed as community packages.

2. Curated built-in inspiration
   - Packages whose patterns Pige studies or adapts into core, but does not ship directly.
   - Examples: `pi-local-rag`, `context-mode`, `pi-hermes-memory`, `pi-obsidian-vault`.

3. Curated installable packages
   - Reviewed packages that users can install, disable, update, or remove.
   - Pige shows permissions, data boundaries, source links, version, license, and last update.

4. Community catalog
   - Searchable package directory with warnings.
   - Installing from here requires explicit user confirmation and a higher-trust review path.

## 6. Package Manager Requirements

Settings should include a Packages or Extensions section.

Required actions:

- Search Pi packages.
- Filter by curated, installed, updates available, package type, capability, and data boundary.
- Inspect package metadata, npm URL, repository URL, description, version, license, downloads, and last publish time.
- Install a package by pinned version.
- Disable a package without uninstalling it.
- Uninstall a package and remove its machine-local files.
- Update a package after showing changelog or version delta where possible.
- Roll back to the previous installed version when cached.
- Show package permissions before install.
- Show whether the package can read vault files, write vault files, access network, run shell commands, call models, or store secrets.
- Block task-time package installation unless the user is already in the package manager flow.

Install records should be machine-local by default. Durable outputs from packages should enter the vault only through Pige-approved write APIs or confirmation proposals.

## 7. Initial Curated Allowlist

Recommended first review set:

This is a review list, not an install list. v0.1 should ship with a smaller visible recommendation set after manual review, permission mapping, and product-fit checks.

- `pi-local-rag`.
- `context-mode`.
- `pi-hermes-memory`.
- `gentle-engram`.
- `pi-memctx`.
- `@firstpick/pi-package-learnings`.
- `pi-obsidian-vault`.
- `pi-lynx`.
- `pi-smart-fetch`.
- `pi-quiver`.
- `@mrclrchtr/supi-web`.
- `pi-web-access`.
- `@hypabolic/pi-hypa`.
- `pi-lean-ctx`.
- `@pi-unipi/compactor`.
- `pi-llama-cpp`.
- `@gotgenes/pi-permission-system`.
- `pi-landstrip`.
- `@juicesharp/rpiv-todo`.
- `@juicesharp/rpiv-ask-user-question`.
- `@mjasnikovs/pi-task`.

These should be reviewed for license, install footprint, maintenance, permissions, security posture, and overlap with Pige-native features before becoming recommended installable packages.
