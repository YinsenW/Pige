# Contributing Guide

Status: Active contribution guide
Baseline date: 2026-07-09
Last revised: 2026-07-10

## 1. Purpose

Pige is intended to be open source and heavily AI-developed. This guide defines how humans and AI agents should contribute without losing the product's local-first, AI-first shape.

## 2. Before Contributing

Start with the public entry in `CONTRIBUTING.md` and follow `CODE_OF_CONDUCT.md`. For implementation, use the task-specific pack in `docs/START_HERE_FOR_AI_AGENTS.md`; do not maintain another reading list here. Read `PRIVACY.md`, `SUPPORT.md`, or `SECURITY.md` when the change touches that public contract.

## 3. Contribution Types

Accepted contribution types:

- Product/design document improvements.
- Tests and fixtures.
- Small implementation slices tied to a requirement ID.
- Parser/OCR/RAG adapter improvements.
- Security hardening.
- I18N and accessibility improvements.
- Documentation for dependencies, licenses, and release behavior.

Avoid:

- Broad unscoped refactors.
- UI complexity that violates simplicity-first.
- Hidden dependency downloads.
- Features that turn Pige into a generic Agent console.
- Storing knowledge only in SQLite or proprietary formats.

## 4. Issue Checklist

Issues should include:

```txt
Problem:
User workflow:
Requirement ID or source doc:
Affected services:
Durable data impact:
Security/permission impact:
Backup/restore impact:
Tests needed:
```

Issues should not include private vaults, source files, API keys, raw prompts, raw model responses, or unreviewed support bundles. Use synthetic or redacted reproductions by default, and follow `SUPPORT.md`.

Public issues should use the GitHub issue templates. Design issues should name the source document and proposed contract change.

## 5. Pull Request Checklist

The `.github/pull_request_template.md` is the single owner of PR intake fields and safety attestations. Complete it with stable IDs, tests/evidence, documentation impact, known gaps, and active-development cost. A PR is not ready if it hides a migration, bypasses a safety boundary, or leaves required verification unexplained.

## 6. Design Changes

If a contribution changes product behavior, architecture, data layout, security, dependencies, or release assumptions:

- Apply the documentation-update rule in `AGENTS.md` and use `resources/documentation-quality/document-map.manifest.json` to find the owner document.
- Add a decision to `docs/DECISION_LOG.md` when the choice is durable.
- Update `docs/SPEC_TRACEABILITY.md` when a requirement area or test gate changes.
- Update `PRIVACY.md` when the change affects public data-use promises or actual data flows.
- Update `SUPPORT.md` when the change affects user support expectations, issue triage, or support-bundle sharing guidance.

## 7. Security Issues

Use the private reporting path in `SECURITY.md`. Never publish secrets, exploit details, private paths, vault/source content, prompts, model responses, or user data in an issue. If private reporting is unavailable, open only a minimal contact request with no technical details.

## 8. AI Agent Contributions

AI-generated changes follow `AGENTS.md`, use the context-pack and handoff templates owned by `docs/AI_DEVELOPMENT_GUIDE.md`, preserve unrelated work, and add verification proportional to risk.

## 9. License

Contributions are made under the Apache License 2.0 unless otherwise stated.
