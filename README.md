# Pige

## Your general Agent, grounded in what you know.

Pige is a local-first general-purpose Agent with personal knowledge as its strongest
advantage. Ask ordinary questions, continue a conversation, paste a link, or drop a
document. When your own knowledge matters, Pige retrieves and cites it first.

The same Agent decides whether to answer directly, retrieve, inspect, parse, OCR,
analyze, or propose durable knowledge. Pige preserves attached sources and constrains
tools, but does not replace that decision with format rules or a fixed workflow.

**Your files remain sources. Markdown becomes your knowledge.** No folder, tag, title,
or capture mode is required before you begin—just one calm doorway into what you know.

> Pige is in **active pre-alpha development**. There is no public installer yet. Do
> not use it as the only copy of important knowledge.

## From conversation to durable knowledge

**Ask or drop → Agent decides → Use tools → Answer or preserve knowledge**

Pige can answer normally when no local evidence is relevant. Files and other source
material are preserved before expensive work, then embedded Pi selects bounded Pige
tools and may turn useful results into cited Markdown.

## Why Pige

Most assistants forget your working context; note apps ask you to organize too early.
Pige combines a **general Agent** with a Markdown knowledge compiler that can remember
useful work beyond one conversation.

- **Conversation when you need it, durable knowledge when it matters.**
- **Inspectable and portable.** Sources and citations stay attached; Markdown is the
  long-term truth, while indexes and caches are rebuildable.
- **Calm outside, strong inside.** Complex tools and safeguards stay behind useful defaults.

## Current Status

Today, the pre-alpha can:

- Capture text, web pages, Markdown, TXT, PDF, DOCX, PPTX, and images while preserving
  files as managed copies or verified references.
- Extract structured document content and run supported macOS Vision OCR paths.
- Run preserved text and supported PDF/DOCX/PPTX/images through embedded Pi, isolated BYOK binding,
  bounded inspect/parse/OCR tools, and validated knowledge publication.
- Generate source-backed Markdown and run a bounded cited Home knowledge-answer path.
- Review an exact staged create-note proposal from Home.
- Use persistent-job recovery and local-backup foundations.

The unified general-conversation ingress and complete Provider-to-Home round trip remain
pre-alpha work. See the [implementation playbook](docs/V0_1_IMPLEMENTATION_PLAYBOOK.md).

## Road to `v0.1 Public Alpha`

- **Complete the Agent path:** one real Provider-to-Home loop for ordinary conversation,
  local-knowledge-enhanced answers, and Agent-selected source tools.
- **Expand the proven tool spine:** cross-platform document/OCR and stronger local retrieval.
- **Ship a trustworthy alpha:** reviewable changes, backup/restore, accessibility,
  localization, packaging, signing, and updates.

Sync, mobile, and collaboration come later. See the [roadmap](docs/MILESTONES.md) and
[product requirements](docs/PRD.md).

## Local-first, with honest boundaries

Your vault and durable knowledge remain local; Pige requires no cloud account, product
analytics, background telemetry, or automatic diagnostic upload. Once you connect a
BYOK provider, ordinary Agent calls use it seamlessly with quiet status and selected
evidence—not the whole vault by default.

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
