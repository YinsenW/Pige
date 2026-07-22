# Diagnostics And Observability Design

Status: Draft baseline
Date: 2026-07-09

## 1. Purpose

This document defines how Pige records local operational evidence, diagnoses failures, exports support bundles, and protects user privacy.

Pige is a local-first knowledge app. Diagnostics must help the user and developers understand failures without turning the product into a telemetry system.

The rule:

> v0.1 has local diagnostics only. No product analytics, background telemetry, automatic crash upload, or diagnostic upload happens by default.

## 2. Goals

- Help users recover from failed captures, parser crashes, OCR failures, database rebuild issues, permission denials, provider failures, and update problems.
- Give future AI coding agents enough evidence to debug issues without reading private notes or source files.
- Keep logs bounded so long-running use does not bloat the machine.
- Make support bundle export explicit, previewable, redacted by default, and revocable before writing.
- Preserve privacy and BYOK trust.
- Avoid duplicating durable vault content into logs.

## 3. Non-Goals For v0.1

- Product analytics.
- Usage tracking dashboards.
- Automatic crash report upload.
- Remote log ingestion.
- Third-party observability integrations such as Langfuse, LangSmith, Helicone, Braintrust, Arize, Axiom, or similar.
- Full prompt/response archival.
- Full source or note export inside diagnostics by default.
- Remote debugging sessions.

Future integrations may exist only as explicit opt-in features with separate privacy review.

## 4. Data Classification

Every diagnostic record belongs to one class.

| Class | Examples | Stored by default | Exported by default |
| --- | --- | --- | --- |
| `safe_metadata` | app version, OS, architecture, locale, feature flags, vault schema version | Yes | Yes |
| `operational_summary` | job type, state, duration, retry count, error code, tool health | Yes | Yes |
| `redacted_identifier` | hashed vault ID, redacted provider/profile ID, job ID, operation ID | Yes | Yes |
| `local_path_display` | active vault path, source asset root, failing file path | Limited | Redacted or user-reviewed |
| `content_excerpt` | short note/source/model excerpts | No | No by default |
| `prompt_or_response` | model prompts, raw provider responses, tool stdout containing content | No | No by default |
| `secret` | API keys, tokens, cookies, credentials | Never | Never |
| `source_body` | PDFs, images, original documents, full notes, full web snapshots | Never | Never by default |
| `memory_body` | full Agent memory atoms/events/scenarios | No | No by default |

Rules:

- Secrets are never diagnostic data.
- Full source bodies and full note bodies are never stored in normal diagnostics.
- Content excerpts require explicit user choice in support bundle preview.
- Diagnostic records should prefer IDs, hashes, counts, timings, error codes, and short explanations.

## 5. Local Diagnostic Stores

Recommended v0.1 layout:

```txt
OS app data/
  diagnostics/
    app-events.jsonl
    errors.jsonl
    performance.jsonl
    tool-health.jsonl
    provider-health.jsonl
    crash-recovery.jsonl
    support-bundles/
      bundle_YYYYMMDD_HHMMSS/
```

Vault-scoped durable evidence remains in the vault:

```txt
Pige Vault/
  log.md
  .pige/
    jobs/
    proposals/
    operations/
```

Rules:

- Machine-local diagnostic logs are excluded from vault backups by default.
- Vault operation records are durable user-visible history, not debug logs.
- `log.md` is human-readable activity history, not a verbose trace sink.
- SQLite indexes can cache diagnostic summaries, but JSONL files or OS logs remain the local evidence layer when needed.

## 6. Event Types

Pige should record compact local events for:

- App startup and shutdown.
- Active vault open, close, switch, and validation result.
- Job created, state changed, retried, cancelled, completed, failed, compacted.
- Parser/OCR/tool invocation started and ended, without full input or output.
- Model provider call metadata: provider profile reference, model ID, token counts when available, duration, error class, cloud/local boundary.
- Closed-list high-risk effect requested, denied, or confirmed. Ordinary submitted-turn
  tool use and Provider sends create no permission/approval event.
- Backup preview, backup created, restore preview, restore applied, restore failed.
- Database migration, rebuild, reset, repair.
- Model/tool/package download, install, repair, remove.
- Crash recovery scan and result.
- Update check, download, install, failure.
- Settings change summary for sensitive settings.

Event rules:

- Use stable error codes and localized UI message keys.
- Do not log raw API keys, prompts, responses, source text, note text, file bodies, or memory bodies.
- File paths should be redacted in exported bundles unless the user chooses to include them.
- Tool stdout/stderr is truncated and scanned for secrets before storage.
- Binary artifacts are never copied into diagnostics.

## 7. Error Model

Diagnostic errors extend the shared API error core rather than copying its enums:

```ts
type DiagnosticError = Pick<
  PigeError,
  | "code"
  | "domain"
  | "messageKey"
  | "messageParams"
  | "retryable"
  | "severity"
  | "userAction"
  | "redactedDetails"
> & {
  errorId: string;
  jobId?: string;
  operationId?: string;
  sourceId?: string;
  vaultIdHash?: string;
  createdAt: string;
};
```

The [common API error envelope](API_AND_IPC_DESIGN.md#4-common-envelope) is the human-readable owner of `PigeError` core fields and enum meanings. `DiagnosticErrorSchema` in `packages/schemas/src/index.ts` is the executable durable/transport contract and extends the same core used by `PigeErrorSchema` and `PigeErrorSummarySchema`; `packages/contracts/src/index.ts` re-exports the inferred types. The existing lightweight diagnostic-event bridge remains a partial implementation until it emits this complete structure.

Rules:

- Error codes follow the shared API contract in `docs/API_AND_IPC_DESIGN.md`: stable `<domain>.<reason>[.<detail>]` strings with no private identifiers.
- `DiagnosticError`, API `PigeError`, and job `PigeErrorSummary` should reuse the same `code`, `domain`, `messageKey`, `retryable`, and `userAction` for the same failure.
- UI errors use localized `messageKey`.
- Logs may include redacted technical details.
- Fatal errors should create a crash recovery hint when possible.
- Retryable errors should identify the owning service and next action.
- `redactedDetails` may contain tool names, safe display labels, counts, durations, and hashes, but never secrets, full paths in exported bundles, prompt text, source bodies, note bodies, or raw provider responses.

## 8. Crash Recovery Diagnostics

On startup after abnormal exit, Pige should:

1. Record a local `crash_recovery.started` event.
2. Load active vault binding from machine-local settings.
3. Validate vault manifest and lock state.
4. Scan durable job, proposal, operation, source record, conversation, and `log.md` state.
5. Detect incomplete temp writes or orphan artifacts.
6. Rebuild or validate SQLite/index state when needed.
7. Produce a user-visible recovery summary.
8. Record a local `crash_recovery.completed` event.

The recovery summary should say:

- Whether any captures were preserved.
- Whether any jobs need retry.
- Whether any proposals await review.
- Whether database/index rebuild is running.
- Whether any source assets need repair or relinking.

The summary must not expose secrets or raw source contents.

## 9. Support Bundle

Support bundle export is user-initiated only.

Defaults include app/platform/locale, vault schema and hashed ID, non-secret settings,
tool/model health, recent redacted errors/jobs/permissions/lifecycle, database status, and
crash recovery. Credentials; full notes, sources, conversations, memory, model traffic;
unsafe output; binaries; and unredacted grants stay excluded. Selected redacted excerpts,
paths, or Provider metadata require preview review.

UX shows categories, estimated size, privacy warning, preview, cancel, and a trusted local
destination; it never uploads. Current B1.14 evidence binds the preview and one
`exportRequestId` to its sender, then writes at most 2 MiB in a worker limited to 64 MiB
old-generation and 30 seconds. Main holds the temp descriptor. Existing output binds a
POSIX held descriptor or closed Windows 2 MiB-bounded stable size+SHA-256 readback;
recheck precedes rename. Changed bytes fail; equal Windows content may replace; owned
fds close.
Unsafe bodies, symlink/root drift, redaction failure, cancel, sender loss, or timeout fail
closed; post-publication cancel adopts the exact output. Export is process-local,
not a durable Job. Final check-to-rename/release-to-unlink syscall windows, optional content,
progress, restart, and broader platform/path evidence remain open.

## 10. Redaction Rules

Redaction runs before storage when possible and always before export.

Must redact:

- API keys and provider tokens.
- Bearer tokens and common credential patterns.
- Email addresses in technical logs unless user chooses to include identity fields.
- Absolute paths in exported bundles by default.
- Private network URLs and credentials in URLs.
- Environment variable values.
- Headers such as `Authorization`, `Cookie`, and provider-specific secret headers.

Path redaction examples:

```txt
/Users/cherry/Documents/Pige Vault/wiki/rag.md
=> <home>/Documents/Pige Vault/wiki/rag.md

C:\Users\Cherry\Documents\Pige Vault\wiki\rag.md
=> <home>\Documents\Pige Vault\wiki\rag.md
```

Rules:

- Redaction failure blocks support bundle export.
- Redaction should be tested with fixtures containing realistic fake secrets.
- Redaction should not mutate durable vault files.

## 11. Retention And Size Budgets

Default retention:

- App event logs: 14 days or 25 MB, whichever comes first.
- Error logs: 30 days or 25 MB.
- Performance summaries: 14 days or 10 MB.
- Tool/provider health summaries: latest snapshot plus 30 days of changes.
- Crash recovery records: 10 most recent recoveries.
- Support bundles: user-created files only; Pige may track recent export metadata but does not delete user-selected files.

Rules:

- Rotate logs in bounded files.
- Never let diagnostics consume unbounded disk space.
- Do not compact unresolved failure evidence until a newer successful recovery or user clears diagnostics.
- Clearing diagnostics never deletes vault knowledge, source assets, jobs, proposals, operations, memory, conversations, or backups.

## 12. UI Surfaces

Diagnostics should be visible only where useful:

- Inline failure cards for failed captures, parser errors, OCR failures, provider failures, and permission denials.
- Settings > Updates & Diagnostics for health overview, repair actions, clear diagnostics, and export support bundle.
- Vault & Note Storage may show storage/path health only.
- Local Capabilities may show tool/model health and repair state.
- Jobs/proposals can expose IDs for troubleshooting without making the default UI technical.

Default UI should not show:

- Raw logs.
- Stack traces.
- Full tool output.
- Internal event streams.
- Provider debugging payloads.

Advanced diagnostics can show technical detail behind explicit disclosure.

## 13. API And IPC Requirements

The [Diagnostics API domain](API_AND_IPC_DESIGN.md#69-diagnostics) is the sole owner of diagnostics channel names
and renderer DTOs; this document owns behavior and redaction.

Rules:

- Renderer DTOs are redacted; progress has no raw content.
- Export is bounded/cancelable; only a local event, never contents, is recorded.

## 14. Future Cloud And Mobile

Future Pige Cloud or self-hosted remote Agent backends may need operational telemetry, but this is not v0.1.

Future rules:

- Cloud/mobile telemetry must be opt-in or explicitly covered by service terms and product settings.
- Submitted-turn authority or a high-risk effect confirmation never implies telemetry consent.
- Remote Agent Backend logs must follow the same classification and redaction model.
- Mobile Lite clients can export local client diagnostics separately from remote backend diagnostics.
- Support bundles should clearly distinguish desktop, web, mobile, and remote backend evidence.

## 15. Tests

Required tests:

- Default diagnostics export contains no API keys, source bodies, full notes, full memory, full conversations, or raw prompts/responses.
- Fake secrets in logs are redacted.
- Path redaction works on macOS and Windows examples.
- Support bundle preview lists included and excluded categories.
- Support bundle export is user-initiated and cancelable.
- Raw tool stdout/stderr is truncated and scanned before storage/export.
- Crash recovery summary is created after forced quit with pending job fixtures.
- Diagnostics log rotation enforces size and retention limits.
- Clearing diagnostics does not delete vault data.
- Renderer diagnostics APIs never return raw secret values or arbitrary filesystem paths with capability.
- No network upload occurs during diagnostics export in v0.1.

## 16. Implementation Checklist

Before adding a diagnostic event:

1. Choose data class.
2. Define owner service.
3. Define local store.
4. Define retention.
5. Define whether it can appear in support bundle.
6. Define redaction behavior.
7. Define whether it references a job, operation, source, note, provider, tool, or permission.
8. Add tests for secret/content/path redaction.
9. Ensure no unbounded content is logged.
10. Update this document if the event class is new.
