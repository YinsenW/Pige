# Pige Vision

Status: Active product vision
Last reviewed: 2026-07-11

## 1. Vision

Pige is a local-first general-purpose personal Agent. Its defining advantage is a
durable, user-owned knowledge layer that can inform ordinary conversation and action.

Any digital content on the user's computer should be droppable into Pige: files, folders, images, PDFs, Office documents, web pages, emails, audio, video, screenshots, clipboard content, Git repositories, archives, cloud-drive resources, and future source types.

Pige can answer general questions directly. When the user's own context matters, it
retrieves that knowledge first; when new material arrives, it can preserve, understand,
connect, and reuse it through bounded tools.

In Pige, files are sources. Markdown is narrative knowledge; Dataset Bundles are
structured knowledge.

## 2. Core Product Statement

Pige is a general Agent enhanced by an Agent-maintained local knowledge base.
**Input once. Knowledge grows naturally.** It converses without local evidence and uses
personal knowledge without reorganizing files. Local-first is durable ownership, not
network-free or confirmation-first: one BYOK disclosure grants routine bounded calls to
that exact destination; narrow content/drift gates grant no other authority.

## 3. Non-Negotiable Principles

### 3.1 Everything Is Droppable

The capture surface should accept anything reasonable and preserve the input before expensive processing.

Droppable does not mean every format is perfectly understood on day one. It means Pige preserves the source, records what it knows, and degrades gracefully when parsers, OCR, or tools are missing.

### 3.2 Durable Knowledge Uses Open Local Formats

Markdown files are Pige's long-term narrative knowledge truth. Versioned Dataset Bundles
are the corresponding truth for typed tables, Collections, and analytical snapshots;
they use documented manifests and open SQLite or Parquet payloads rather than flattening
every row into prose.

Pige's internal SQLite, FTS/vector indexes, embeddings, caches, thumbnails, and model
outputs remain working layers. They can be rebuilt from Markdown, Dataset Bundles,
source records/assets, operation records, and memory files. A SQLite file inside a
Dataset Bundle is user knowledge; `.pige/db/vault.sqlite` is not.

Original files are evidence and source material. They remain important, preserved, and user-owned, but they are not the compiled knowledge layer.

### 3.3 Preserve User Ownership

Pige must not force migration of existing user files.

Supported source ownership patterns:

- Reference the original file in place.
- Store a managed copy in Pige-controlled source storage.
- Use a link strategy such as symlink or alias only when safe, supported, and explicit.
- Add future storage adapters without rewriting the knowledge layer.

### 3.4 Autonomous By Default, Tool-Constrained

Pige is Pi Agent's local product shell, not another semantic workflow engine. Submission
immediately creates one Pi Job; source preservation is its first checkpoint. Pi answers,
uses/revisits typed tools, authors Markdown, and repairs validation until a valid result,
grounded abstention, or real external block. Host services enforce evidence, authority,
egress, limits, Operations, commit, and recovery without choosing the semantic route.

Capability is broader than authority: Pi may request arbitrary filesystem/commit tools.
Recoverable active-vault knowledge Markdown and the exact source selected by drop/picker
are prompt-free; other scopes pause for a user decision, and always-confirmed effects
keep their stronger gate. Better models therefore increase autonomy without redesigning
the safety or interaction model.

Folder management is secondary. Pige's main artifact is an AI-readable, user-readable
local knowledge base with provenance.

### 3.5 Open By Default

Knowledge must remain inspectable and portable without Pige.

Avoid proprietary knowledge storage. Keep prose in plain Markdown and structured data in
documented Dataset Bundles with stable IDs, revisions, schemas, citations, and source
references.

### 3.6 Everything Is Extensible

Storage, parsers, importers, exporters, OCR, embeddings, LLMs, search, indexes, Skills, packages, and workflows should be replaceable through explicit contracts.

Extensibility remains permissioned and product-scoped. A general Agent product does not
make Pige a generic automation or runtime console.

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
- A proprietary database note app whose knowledge cannot be recovered from open files.
- A knowledge-only vertical assistant that cannot answer without vault evidence.
- A general-purpose Agent runtime console.

Pige is:

- A general-purpose personal Agent enhanced by local knowledge.
- A narrative and structured knowledge compiler.
- A source-preserving ingestion and retrieval system.
- A long-term personal digital brain built from user-owned materials.

## 5. Current Mission

Pige is in active pre-alpha development. The design baseline now guides implementation rather than preceding it.

The current mission is to build the `v0.1 Public Alpha` in focused, verified slices while keeping product, architecture, data, UI, security, release, testing, storage, parser, extension, prompt, and contribution contracts aligned with working code.

This vision does not own the current phase number or completion state. Use `README.md` for the public implementation snapshot and `docs/V0_1_IMPLEMENTATION_PLAYBOOK.md` for implementation order and phase evidence. Continue to favor clarity over cleverness, explicit contracts over implicit behavior, and local user ownership over short-term implementation convenience.
