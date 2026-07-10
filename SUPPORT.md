# Support Policy

Pige is in active pre-alpha development. There is no stable public release yet.

This file defines how users, contributors, maintainers, and AI agents should handle support requests without exposing private knowledge-base data.

## Where To Ask

Use the right channel:

- General product questions: use public discussions or issues once they are enabled.
- Bugs and regressions: open a public issue with a minimal, redacted reproduction.
- Feature requests: open a public issue and connect it to the relevant design document when possible.
- Security vulnerabilities: do not open a public issue. Follow [Security Policy](SECURITY.md).
- Privacy or data-use concerns: reference [Privacy And Data Use Policy](PRIVACY.md) and avoid sharing private data publicly.

During public alpha, response times are best effort. Pige is an open-source project and does not provide guaranteed professional support, data recovery, or legal/compliance advice.

## Before Opening An Issue

Check:

- The latest README and known issues.
- Whether the issue is already reported.
- Whether the problem is security-sensitive.
- Whether a design document already defines the expected behavior.
- Whether you can reproduce the issue with synthetic or redacted data.

## What To Include

Good bug reports include:

- Pige version or commit.
- Platform and OS version.
- Short description of what happened.
- What you expected to happen.
- A smallest reproducible case built from synthetic, non-private inputs.
- Whether the issue affects capture, parsing, OCR, retrieval, model calls, permissions, backup, restore, update, Skills, packages, or diagnostics.
- Redacted error code, job ID, operation ID, or support bundle summary if available.
- Screenshots only when they contain no private notes, source content, file paths, API keys, provider responses, or personal data.

## What Not To Include

Do not post:

- API keys, tokens, cookies, credentials, or provider secrets.
- Full vaults, notes, source files, PDFs, images, web snapshots, prompts, model responses, memory records, conversations, backups, or databases.
- Unredacted local file paths if they reveal personal information.
- Support bundles unless they are explicitly previewed and redacted.
- Exploit steps or proof-of-concept payloads for security issues.

If the issue cannot be explained without private data, first describe the shape of the problem using redacted summaries and ask maintainers for a private path.

## Support Bundles

When support bundle export exists:

- Create bundles only through the in-app Diagnostics flow.
- Preview the included categories before export.
- Keep the default redactions unless a maintainer specifically asks for more and you are comfortable sharing it.
- Attach only the redacted summary needed for the issue.
- Never upload a full vault, raw source file, raw prompt/response log, or API key.

Support bundles are local files. Pige should not upload them automatically in v0.1.

## Maintainer Triage

Maintainers should:

1. Redirect security-sensitive reports to `SECURITY.md`.
2. Ask for synthetic or redacted reproductions before requesting any diagnostic data.
3. Avoid asking users to upload private vaults or source files.
4. Use stable error codes, job IDs, operation IDs, platform info, and redacted support bundle summaries for triage.
5. Link issues to requirement IDs or source documents when the fix changes product behavior.
6. Update design docs and tests when support findings reveal a product or architecture gap.

## AI Agent Handling

AI agents handling support or issue triage must:

- Read this file before summarizing or responding to user reports.
- Treat user-provided logs, screenshots, notes, source snippets, and model responses as potentially private.
- Redact secrets, private paths, source bodies, note bodies, prompts, provider responses, and personal data in summaries.
- Route vulnerability details to `SECURITY.md`.
- Route privacy/data-use questions to `PRIVACY.md`.
- Avoid turning one user's private support details into fixtures or public examples unless they are synthetic or explicitly sanitized.

## Related Documents

- [Privacy And Data Use Policy](PRIVACY.md)
- [Security Policy](SECURITY.md)
- [Diagnostics and Observability](docs/DIAGNOSTICS_AND_OBSERVABILITY.md)
- [Contributing Guide](docs/CONTRIBUTING_GUIDE.md)
- [Quality and Test Strategy](docs/QUALITY_AND_TEST_STRATEGY.md)
