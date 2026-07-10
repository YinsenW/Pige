# Contributing to Pige

Pige is in active pre-alpha development. Changes should preserve compatibility with work already implemented unless the owning contract explicitly requires a migration.

Before opening issues or pull requests, read:

- [AI Agent Instructions](AGENTS.md)
- [Start Here For AI Agents](docs/START_HERE_FOR_AI_AGENTS.md)
- [Contributing Guide](docs/CONTRIBUTING_GUIDE.md)
- [Coding Conventions](docs/CODING_CONVENTIONS.md)
- [Code Of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [Privacy And Data Use Policy](PRIVACY.md)
- [Support Policy](SUPPORT.md)

The short version:

- Keep Pige local-first, AI-first, and simple by default.
- Submit implementation code through an AI Coding Agent and name its task; humans direct, review, and authorize.
- Route product, technical, governance, and development-management design changes to Product Planning; route detailed visual guidance to UI Design.
- Follow the Code of Conduct.
- Treat Markdown knowledge files as the durable knowledge source of truth.
- Do not store secrets in Markdown, SQLite, logs, prompts, diagnostics, or backups.
- Route sensitive Agent, Skill, package, shell, network, filesystem, secret, settings, and destructive actions through Permission Broker.
- Report vulnerabilities privately through the security process; do not publish exploit details, secrets, or user data in issues.
- Keep privacy-facing behavior aligned with `PRIVACY.md`.
- Keep support and issue triage aligned with `SUPPORT.md`; use synthetic or redacted reproductions.
- Use the GitHub issue and pull request templates for public collaboration.
- Record design impact in the PR; the owning Agent role synchronizes affected docs in the same candidate.
- Add tests and fixtures for risky behavior.

Pige is licensed under Apache 2.0.
