# Pige

Pige is a local-first, AI-first Personal Knowledge Agent.

It combines a chat-style capture flow, the speed of lightweight memo tools, and an Obsidian-like local Markdown vault. Users can currently drop text, individual files, or web links into Pige; folder ingest remains part of the longer-term source vision. The agent preserves or references the original source according to storage policy, extracts useful structure, and maintains a persistent interlinked Markdown knowledge base over time.

## Product Idea

Pige is not a chatbot over notes. It is a knowledge base maintainer.

- Home dialogue is the unified capture, retrieval, and note-question entry.
- The agent is the maintainer.
- The portable Markdown vault is what the user owns; local working stores only accelerate it.
- A local SQLite database can accelerate search, indexes, jobs, and graph queries, but it is rebuildable and not the knowledge source of truth.
- Markdown should feel polished inside Pige while remaining clean, portable source on disk.
- Original files remain user-owned. Pige can reference them in place, store managed copies, or later support additional storage strategies.
- Complete chat history is retained as reference-based activity records, without duplicating large sources or saved note bodies.
- Capture can be text, files, links, images, or voice dictation on supported macOS versions.
- I18N is built in from v0.1 for Simplified Chinese, English, Japanese, Korean, French, and German.
- Local OCR helps recover text from screenshots, scanned pages, and image-heavy PDFs or presentations.
- Local RAG is built in: embeddings, retrieval indexes, and reranking should run on the user's machine by default.
- A bundled local toolchain should cover Git, script runtimes, and document parsers so normal Agent work does not depend on task-time downloads.
- Skills and packages can extend Pige, but sensitive actions require explicit permission.
- The compiled wiki keeps getting richer with every source and question.
- Home questions retrieve knowledge as grounded summaries plus ranked notes, not answer-only chat.

## Design Baseline

Do not load every design document by default. The design library is intentionally broad, but the daily entry path should stay small.

Primary entry docs:

- [AI Agent Instructions](AGENTS.md)
- [Start Here For AI Agents](docs/START_HERE_FOR_AI_AGENTS.md)

Then read only the task-specific pack listed in [Start Here For AI Agents](docs/START_HERE_FOR_AI_AGENTS.md). Use [AI Development Guide](docs/AI_DEVELOPMENT_GUIDE.md) for implementation sessions, handoffs, storage/permission checklists, and contribution workflow details.

Canonical maps:

- Product and scope: [Product Requirements](docs/PRD.md), [Vision](docs/VISION.md), [Milestones](docs/MILESTONES.md)
- Architecture and data: [Technical Architecture](docs/TECH_ARCHITECTURE.md), [Data Architecture](docs/DATA_ARCHITECTURE.md), [Domain Model](docs/DOMAIN_MODEL.md), [Markdown Schema](docs/MARKDOWN_SCHEMA.md)
- UI and runtime behavior: [Interface Prototype](docs/UI_PROTOTYPE.md), [Prompt Design](docs/PROMPT_DESIGN.md), [Context Assembly and Retrieval Policy](docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md)
- Quality and governance: [Quality and Test Strategy](docs/QUALITY_AND_TEST_STRATEGY.md), [Security Threat Model](docs/SECURITY_THREAT_MODEL.md), [Decision Log](docs/DECISION_LOG.md), [Spec Traceability](docs/SPEC_TRACEABILITY.md)

[Start Here For AI Agents](docs/START_HERE_FOR_AI_AGENTS.md) owns human task packs and points to the complete [machine-readable document inventory](resources/documentation-quality/document-map.manifest.json); the full map is not part of default reading. External dependency references and update sources are canonical in [Technical Architecture](docs/TECH_ARCHITECTURE.md) and, where product-facing, [Product Requirements](docs/PRD.md).

## Current Status

Pige is in active pre-alpha development. The design baseline and repository foundation are in place, and current implementation includes:

- Desktop and local data foundations: Electron isolation, vault creation/opening, note-storage settings, provider/model setup, encrypted API-key storage, six-locale shell catalogs, diagnostics, and toolchain health.
- Capture and ingest: reference-based text/file conversations, whole-window file drop, bounded PDF/DOCX/PPTX workers, SSRF-resistant static URL fetch with local Readability extraction, checksummed artifacts, and local macOS 26 Apple Vision OCR for preserved raster images, bounded image-only PDFs, and parser-selected sparse pages in mixed PDFs, with explicit dependency-waiting fallback elsewhere.
- Knowledge use: Markdown source pages, multi-Artifact Agent evidence assembly with per-claim source citations and review guards, durable jobs/operations/proposals, Library and Reader surfaces, SQLite/FTS lexical retrieval, cited Home answers, backlinks, and related-note context.
- Recovery: local ZIP backup, validated new-folder restore, rebuildable database/index state, source-page conflict protection, and interrupted idempotent job reconciliation.

The first target release is `v0.1 Public Alpha`: a highly usable local-first app, not a throwaway MVP.

This section is the public high-level implementation snapshot. For task routing, current versus historical document rules, and phase-planning coordination, use [Start Here For AI Agents](docs/START_HERE_FOR_AI_AGENTS.md).

## Security

Please report security issues privately. See [Security Policy](SECURITY.md).

## Privacy

Pige is local-first, but BYOK model calls, explicit URL capture, optional downloads, updates, and permissioned Skills can use the network. Static URL capture uses bounded SSRF-resistant fetch plus local Readability extraction; page scripts are not executed. See [Privacy And Data Use Policy](PRIVACY.md).

## Support

For questions, bugs, and public alpha feedback, see [Support Policy](SUPPORT.md). Do not upload private vaults, source files, API keys, prompts, or raw model responses to public issues.

## Community

Participation is governed by the [Code Of Conduct](CODE_OF_CONDUCT.md). Public issues and pull requests should use the GitHub templates.

## License

Pige is licensed under the [Apache License 2.0](LICENSE).
