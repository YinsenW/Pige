# Pige

## Drop it in. Get connected knowledge back.

Pige is a local-first Personal Knowledge Agent for notes, links, documents,
screenshots, and half-finished thoughts that are worth keeping.

Paste an idea, save a web page, or drop a PDF, Office document, or image. Pige is being
built to preserve the source, let its Agent choose bounded tools, turn useful material
into connected Markdown, and bring it back with citations.

**Your files remain sources. Markdown becomes your knowledge.** No folder, tag, title,
or capture mode is required before you begin—just one calm doorway into what you know.

> Pige is in **active pre-alpha development**. There is no public installer yet. Do
> not use it as the only copy of important knowledge.

## From capture to durable knowledge

**Capture → Preserve → Understand → Connect → Retrieve → Reuse**

Pige preserves local inputs before expensive work; explicit URL capture first performs
the bounded fetch needed to create its source snapshot. Embedded Pi Agent paths now
move preserved text and supported PDFs through bounded tools into cited Markdown.

## Why Pige

Note apps ask you to organize too early; document chat buries useful answers. Pige is a
**Markdown knowledge compiler** whose Agent maintains a wiki beyond one conversation.

- **Durable knowledge, not disposable chat.** Valuable synthesis returns to Markdown.
- **Inspectable and portable.** Sources and citations stay attached; Markdown is the
  long-term truth, while indexes and caches are rebuildable.
- **Calm outside, strong inside.** Complex tools and safeguards stay behind useful defaults.

## Current Status

Today, the pre-alpha can:

- Capture text, web pages, Markdown, TXT, PDF, DOCX, PPTX, and images while preserving
  files as managed copies or verified references.
- Extract structured document content and run supported macOS Vision OCR paths.
- Run preserved text and supported PDFs through embedded Pi, isolated BYOK binding,
  bounded inspect/parse/OCR tools, and validated knowledge publication.
- Generate source-backed Markdown; search locally with citations, backlinks, and related pages.
- Use persistent-job recovery and local-backup foundations.

These are foundations, not a finished release. See the [implementation playbook](docs/V0_1_IMPLEMENTATION_PLAYBOOK.md).

## Road to `v0.1 Public Alpha`

- **Extend the Agent path:** move Office, retrieval, and permissioned
  actions onto the proven embedded Pi tool-loop spine.
- **Expand the proven tool spine:** cross-platform document/OCR and stronger local retrieval.
- **Ship a trustworthy alpha:** reviewable changes, backup/restore, accessibility,
  localization, packaging, signing, and updates.

Sync, mobile, and collaboration come later. See the [roadmap](docs/MILESTONES.md) and
[product requirements](docs/PRD.md).

## Local-first, with honest boundaries

No cloud account, product analytics, background telemetry, or automatic diagnostic
upload is required. Explicit URL capture, BYOK calls, updates, optional downloads, and
permissioned extensions may use the network; model calls send selected evidence, not
the whole vault by default.

## Built and maintained by AI Agents

**Built by Agents. Directed by humans.**

AI Coding Agents author and maintain Pige's implementation code. Humans set direction,
review evidence, and authorize releases. Contracts, tests, traceability, and CI are the
project memory on the path toward safe planning-to-release automation.

## Follow the build

Watch for the first Public Alpha, explore the [vision](docs/VISION.md), or help through
[Contributing](CONTRIBUTING.md).

For AI Coding Agents: start with [repository instructions](AGENTS.md) and the
[task router](docs/START_HERE_FOR_AI_AGENTS.md).

[Security](SECURITY.md) · [Privacy](PRIVACY.md) · [Support](SUPPORT.md) ·
[Code of Conduct](CODE_OF_CONDUCT.md) · [Apache 2.0](LICENSE)
