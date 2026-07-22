# Security Policy

Pige is a local-first desktop Agent that handles private files, local Markdown vaults, API keys, model-provider calls, parser/OCR tools, Skills, packages, and automatic updates. Security reports should be handled privately and calmly.

## Supported Versions

Pige is in active pre-alpha development. There is no stable release yet.

Once public alpha releases begin:

- Security fixes target `main` and the latest supported alpha release.
- Older prerelease builds may be unsupported when a security fix requires schema, dependency, signing, or installer changes.
- Release notes should identify security-relevant fixes without publishing exploit details before users have a reasonable update window.

## Reporting A Vulnerability

Do not open a public issue with exploit steps, secrets, private files, or user data.

Preferred reporting path:

1. Use GitHub private vulnerability reporting for this repository once maintainers enable it.
2. If private vulnerability reporting is not available yet, open a minimal public issue that says only "security contact request" and includes no technical details.
3. Wait for a maintainer-provided private channel before sharing reproduction details.

When reporting, include:

- Affected Pige version, commit, or design document section.
- Platform and OS version.
- Vulnerability class, such as secret leak, permission bypass, parser sandbox escape, SSRF, unsafe update, path traversal, prompt-injection boundary failure, Skill/package capability bypass, or data-loss issue.
- Minimal reproduction steps using synthetic data.
- Expected impact.
- Whether the issue is already public anywhere else.

Do not include:

- Real API keys, tokens, cookies, or credentials.
- Private vaults, notes, source files, screenshots, or model responses.
- Long exploit payloads in public channels.
- Instructions that enable broad abuse before maintainers can triage.

## In Scope

Security-sensitive areas include:

- API key and token storage.
- Secret redaction in logs, prompts, diagnostics, memory, conversations, backups, and support bundles.
- High-risk confirmation bypass for destructive writes, out-of-root writes, arbitrary
  shell/unknown-package install, or credential disclosure.
- A third-party Skill/package acquiring first-party submitted-turn authority.
- Web fetch SSRF, local-network access, metadata endpoint access, redirects, and `file://` access.
- Parser/OCR/archive path traversal, sandbox escape, or unsafe file writes.
- External/Web Skill and package capability escalation.
- Shell execution, local tool execution, and command construction.
- BYOK model call boundary and unintended cloud sends.
- Auto-update, signing, checksums, release metadata, dependency compromise, and bundled binary integrity.
- Backup/restore path traversal, secret inclusion, or durable data loss.
- Renderer access to filesystem, database, secrets, raw model credentials, or privileged IPC.

## Out Of Scope

These are usually not handled as private security reports unless they create a concrete security boundary failure:

- General bugs with no privacy, integrity, permission, or availability impact.
- Model hallucinations that do not bypass confirmation, permissions, citations, or durable-write gates.
- User-approved actions performed within the approved scope.
- Local attacks that require full control of the user's OS account and do not bypass Pige's documented boundaries.
- Unsupported platforms or manually modified builds.

## Maintainer Handling

Maintainers should:

1. Acknowledge a valid private report as soon as practical.
2. Triage severity, affected versions, exploitability, and user-data impact.
3. Create a private fix plan that names owner, affected services, tests, release path, and disclosure timing.
4. Add or update regression tests before release.
5. Update affected design documents when the fix changes security boundaries, dependencies, permissions, release behavior, diagnostics, backup, restore, or data ownership.
6. Publish a security advisory or release note when appropriate.

Security fixes must not weaken local-first privacy, the closed high-risk confirmation
boundary, secret storage, source preservation, backup safety, or update integrity to make
a patch easier. Ordinary registered first-party Agent work is not a bypass merely because
it runs without a per-tool prompt.

## AI Agent Handling

AI agents working on Pige must:

- Read this file before handling security reports or security-sensitive issues.
- Avoid copying exploit payloads, secrets, private paths, prompts, model responses, source bodies, or user vault content into public issues, commits, logs, prompts, diagnostics, or handoff notes.
- Summarize security issues using redacted facts, stable error codes, affected services, and required tests.
- Stop and ask a maintainer if a fix requires accepting unclear licensing, signing, sandboxing, disclosure, or user-data risk.

## Related Documents

- [Support Policy](SUPPORT.md)
- [Security Threat Model](docs/SECURITY_THREAT_MODEL.md)
- [Privacy And Data Use Policy](PRIVACY.md)
- [Release Engineering](docs/RELEASE_ENGINEERING.md)
- [Diagnostics and Observability](docs/DIAGNOSTICS_AND_OBSERVABILITY.md)
- [Skill Extension Design](docs/SKILL_EXTENSION_DESIGN.md)
- [API and IPC Design](docs/API_AND_IPC_DESIGN.md)
- [Contributing Guide](docs/CONTRIBUTING_GUIDE.md)
