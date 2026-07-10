# Coding Conventions

Status: Active implementation convention
Baseline date: 2026-07-09
Last revised: 2026-07-10

## 1. Purpose

This document defines implementation conventions for current and future Pige code.

The goal is predictable, AI-maintainable code: simple boundaries, stable names, typed contracts, and tests close to the behavior they protect.

## 2. Language And Runtime

- Use TypeScript for app code.
- Target TypeScript 7 when the ecosystem supports it.
- Keep TypeScript 6 compatibility only for tools that still require the older compiler API.
- Use strict type checking.
- Prefer explicit domain types over loose `Record<string, unknown>` except at external boundaries.
- Runtime-specific code belongs behind adapters.

## 3. Repository Shape

`docs/REPOSITORY_STRUCTURE.md` is the single owner of the current/target directory tree, package roles, import direction, fixture paths, and phase-gated growth rules. Follow it when placing files; do not reproduce a second tree here or create empty future placeholders.

## 4. Service Boundaries

- Renderer code must not import main-process services.
- Preload owns typed IPC exposure.
- No service should write another service's durable files directly.
- Runtime-specific side effects belong behind adapters; shared code stays pure and cross-runtime safe.
- Import direction and package placement follow `docs/REPOSITORY_STRUCTURE.md`; service/process ownership follows `docs/TECH_ARCHITECTURE.md`.

## 5. Naming

- Services: `CaptureService`, `SourceStorageService`, `PermissionBroker`.
- DTOs: `CaptureRequest`, `ParseResult`, `PermissionDecision`.
- IDs: use exported shared ID schemas and the human vocabulary in `docs/DOMAIN_MODEL.md`; current executable examples include `page_`, `src_`, `art_`, `evt_`, `job_`, and `op_`. Do not use a generic `mem_` prefix or invent a future ID family; memory-specific IDs require their dedicated shared schemas before implementation.
- Workspace packages: use clear nouns such as `@pige/domain`, `@pige/contracts`, `@pige/markdown`, `@pige/knowledge`.
- Files: use kebab-case for React components only if the chosen app scaffold already does; otherwise prefer consistent PascalCase component files and kebab-case non-component modules.
- Tests: mirror the module name and behavior.

Follow the established module naming style and record any deliberate repository-wide adjustment here.

## 6. Schemas And Validation

- Validate external input at boundaries.
- Validate IPC payloads.
- Validate Markdown frontmatter before writes.
- Validate Agent structured output before applying changes.
- Validate persisted JSONL records on read and migration.
- Shared schema definitions live in `packages/schemas/`.
- IPC, job, permission, context-pack, and diagnostic DTO schemas should live in `packages/contracts/`.

## 7. Error Handling

- Use typed domain errors with stable codes.
- Errors shown to users must use I18N message keys.
- Logs may include redacted technical detail, never secrets.
- Failed jobs must be visible, retryable when possible, and recoverable after restart.
- Do not swallow parse, backup, restore, migration, permission, or model errors silently.

## 8. File Writes

- Write through the owning service.
- Use atomic write patterns for durable files.
- Check existing file checksum before overwrite when user edits may exist.
- Use recoverable trash for deletion/archive where required.
- Never rewrite source assets or externally referenced originals during normal ingest.
- Reset, cleanup, cancellation, and compaction must follow the data lifecycle matrix in `docs/DATA_ARCHITECTURE.md`.

## 9. UI Code

- Keep default UI minimal and calm.
- All visible strings go through I18N.
- Icon-only controls need labels/tooltips.
- Renderer requests data through typed APIs and paged queries.
- Long-running tasks show progress.
- No direct filesystem, database, secret, parser, model, or shell access from renderer.

## 10. Dependencies

Before adding a dependency:

- Check `docs/TECH_ARCHITECTURE.md` external dependency registry.
- Add or update the matching `resources/dependency-manifest/` record once a concrete package, binary, model file, provider SDK, CI action, or release tool is selected.
- Keep temporary waivers scoped, expiring, and release-blocking when expired.
- Check license compatibility with Apache 2.0 distribution.
- Decide bundled vs explicit download vs system API.
- Add checksum/signature/update behavior when relevant.
- Avoid hidden downloads during ordinary capture, ingest, search, review, backup, or restore.

## 11. Tests

`docs/QUALITY_AND_TEST_STRATEGY.md` owns test layers, fixtures, and release gates. Add tests proportional to risk, keep pure unit tests near the behavior or in the canonical unit directory, and place cross-service, renderer, smoke, and eval coverage in the paths owned by `docs/REPOSITORY_STRUCTURE.md`. Test names should describe module, behavior, and expected result.

## 12. Documentation

Code changes that alter behavior must update documentation in the same change. `AGENTS.md` owns the mandatory update triggers; `resources/documentation-quality/document-map.manifest.json` identifies the owner document. Record durable decisions in `docs/DECISION_LOG.md` and requirement/evidence mapping changes in `docs/SPEC_TRACEABILITY.md`.

## 13. AI-Maintainability Rules

- Prefer boring explicit code over clever implicit code.
- Keep modules small enough to read in one AI context window when possible.
- Avoid hidden global state.
- Avoid broad utility folders that mix unrelated concepts.
- Make side effects obvious.
- Keep fixtures close to behavior.
- Use stable names that match the docs.
- Use import boundaries and package ownership to make context packs small for future AI agents.
