# Pige Vision

Status: Active product vision
Last reviewed: 2026-07-11

## 1. Vision

Pige is an AI-first Personal Knowledge Agent.

Its long-term goal is not only personal knowledge management. Pige should become the user's unified entry point and long-term memory layer for their digital world.

Any digital content on the user's computer should be droppable into Pige: files, folders, images, PDFs, Office documents, web pages, emails, audio, video, screenshots, clipboard content, Git repositories, archives, cloud-drive resources, and future source types.

Pige's job is to understand that content, extract durable knowledge, connect it to existing knowledge, and continuously build the user's personal knowledge system.

In Pige, files are sources. Markdown is the knowledge layer.

## 2. Core Product Statement

Pige turns user-owned materials into an Agent-maintained local Markdown knowledge base without reorganizing the user's files.

Local-first means durable local ownership, not network-free. After one disclosure,
selecting a BYOK Profile authorizes routine bounded calls to that exact destination with
quiet status. Higher-risk, unknown/changed, or stricter-policy gates remain; Provider
trust grants no tool, setting, or source-policy authority.

## 3. Non-Negotiable Principles

### 3.1 Everything Is Droppable

The capture surface should accept anything reasonable and preserve the input before expensive processing.

Droppable does not mean every format is perfectly understood on day one. It means Pige preserves the source, records what it knows, and degrades gracefully when parsers, OCR, or tools are missing.

### 3.2 Markdown Is The Knowledge Source Of Truth

Markdown files are Pige's only long-term knowledge source of truth.

SQLite, FTS indexes, vector indexes, embeddings, caches, thumbnails, and model outputs are working layers or derived artifacts. They can be rebuilt from Markdown, source records, source assets, operation records, and memory files.

Original files are evidence and source material. They remain important, preserved, and user-owned, but they are not the compiled knowledge layer.

### 3.3 Preserve User Ownership

Pige must not force migration of existing user files.

Supported source ownership patterns:

- Reference the original file in place.
- Store a managed copy in Pige-controlled source storage.
- Use a link strategy such as symlink or alias only when safe, supported, and explicit.
- Add future storage adapters without rewriting the knowledge layer.

### 3.4 Agent-Orchestrated, Tool-Constrained

After Pige deterministically preserves a capture, Pi Agent owns the semantic plan across
inspection, extraction, OCR, retrieval, organization, analysis, and knowledge change.
Pige exposes bounded typed tools; the Agent selects, sequences, evaluates, and replans
their use instead of following a format-driven workflow fixed by product services.

The Agent owns semantic decisions, not safety boundaries. Pige still enforces source
preservation, permissions, egress, resource limits, provenance, durable Jobs, validation,
confirmation, and atomic publication. If the Agent or model is unavailable, Pige keeps
the source and waits visibly rather than running a hidden substitute pipeline.

Folder management is secondary. Pige's main artifact is an AI-readable, user-readable
Markdown knowledge base with provenance.

### 3.5 Open By Default

Knowledge must remain inspectable and portable without Pige.

Avoid proprietary knowledge storage. Keep user-authored and Agent-maintained knowledge in plain Markdown with stable frontmatter, IDs, links, citations, and source references.

### 3.6 Everything Is Extensible

Storage, parsers, importers, exporters, OCR, embeddings, LLMs, search, indexes, Skills, packages, and workflows should be replaceable through explicit contracts.

Extensibility must remain permissioned and product-scoped. Pige is a Personal Knowledge Agent, not a generic automation console.

### 3.7 AI-Native Development

AI Coding Agents author and maintain Pige's implementation code; humans direct,
provide references, review evidence, and authorize releases. Contracts, boundaries,
tests, and decisions lower future Agent context cost. The goal is safe end-to-end
maintenance automation without weakening evidence, security, or release gates.

### 3.8 Documentation Is For AI

Design documents are durable product memory.

When behavior, data ownership, storage layout, security boundaries, dependencies, UI, or release assumptions change, update the relevant documents in the same change.

## 4. Product Boundary

Pige is not:

- A generic filesystem manager.
- A cloud-first document warehouse.
- A pure RAG chatbot over uploaded files.
- A proprietary database note app.
- A general-purpose Agent runtime console.

Pige is:

- A local-first Personal Knowledge Agent.
- A Markdown knowledge compiler.
- A source-preserving ingestion and retrieval system.
- A long-term personal digital brain built from user-owned materials.

## 5. Current Mission

Pige is in active pre-alpha development. The design baseline now guides implementation rather than preceding it.

The current mission is to build the `v0.1 Public Alpha` in focused, verified slices while keeping product, architecture, data, UI, security, release, testing, storage, parser, extension, prompt, and contribution contracts aligned with working code.

This vision does not own the current phase number or completion state. Use `README.md` for the public implementation snapshot and `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md` for implementation order and phase evidence. Continue to favor clarity over cleverness, explicit contracts over implicit behavior, and local user ownership over short-term implementation convenience.
