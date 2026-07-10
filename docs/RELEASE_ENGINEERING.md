# Release Engineering

Status: Draft baseline
Date: 2026-07-09

## 1. Purpose

Pige is intended to become a serious open-source desktop Agent product. Release engineering must make builds reproducible, updates safe, installer size controlled, and platform behavior predictable.

This document defines:

- Supported platforms.
- Installer and artifact strategy.
- GitHub Actions release pipeline.
- Auto-update strategy.
- Code signing and notarization.
- Model/tool distribution.
- Dependency update workflow.
- Release gates.

## 2. v0.1 Platform Scope

v0.1 supported platforms:

- macOS 26 or later.
- Windows 11.
- Windows 10 if Electron, bundled tools, local database, and update pipeline remain reliable in testing.

Deferred:

- Linux packaging.
- Mobile.
- Browser extension.

Rules:

- macOS is the primary v0.1 quality target.
- Windows 10/11 are v0.1 targets, but Windows native OCR availability is runtime-detected.
- Linux-specific packaging and support should not block v0.1.

## 3. Installer Size Budget

Target:

- Core distributable target at most 300,000,000 bytes and public-alpha hard ceiling
  330,000,000 bytes, excluding optional model and OCR weights.

Included:

- Electron app runtime.
- Renderer assets.
- Bundled parser/runtime tools needed for common ingest.
- Git/Git Bash for Windows package.
- Bun.
- `uv`.
- Managed Python runtime if required by Pige-owned tools.
- PDF and Office parsing tools chosen for v0.1.
- Local RAG inference runtime.
- License notices and dependency manifests.

Excluded:

- Qwen embedding model files.
- Qwen reranker model files.
- PaddleOCR model files.
- Large optional OCR language packs.
- User vault data.
- Local indexes/caches.

Rules:

- Large models are explicit downloads.
- Manual local model import is not supported in v0.1.
- The app must show download size before model/tool download.

## 4. Release Channels

Recommended channels:

- `alpha`: early public alpha builds.
- `stable`: later production-ready builds.

v0.1 uses `alpha`.

Rules:

- Alpha builds may show a subtle "Public Alpha" label in About.
- Update channel is recorded in app settings.
- Channel switching is explicit.
- Updates never cross from stable to alpha unless the user opts in.

## 5. GitHub Actions Pipeline

Required workflows:

- Pull request checks.
- Main branch checks.
- Tagged release build.
- Dependency audit.
- License notice generation.
- Release artifact publishing.
- Security policy and private vulnerability reporting readiness check before public alpha.
- Privacy policy and public data-use copy readiness check before public alpha.
- Support policy and public issue-triage readiness check before public alpha.
- Code of conduct and GitHub issue/PR template readiness check before public alpha.

Pull request checks:

- Type-check.
- Lint.
- Unit tests.
- Schema validation tests.
- Markdown/documentation checks.
- Dependency registry consistency check.

Release build:

1. Verify tag format.
2. Install pinned dependencies.
3. Build renderer/main/preload bundles.
4. Run unit and integration tests.
5. Build macOS artifacts.
6. Build Windows artifacts.
7. Sign artifacts where credentials are available.
8. Notarize macOS artifacts.
9. Generate checksums.
10. Generate update metadata.
11. Generate SBOM/license notices.
12. Upload artifacts to GitHub Releases.
13. Publish release notes.

macOS native OCR build order:

- Compile `apps/desktop/native/macos-vision-ocr/PigeVisionOCR.swift` for each release architecture with the macOS 26 SDK before packaging the Electron application.
- Generate and verify the adjacent helper manifest containing source/compiler/target metadata plus exact binary size and SHA-256.
- Embed the helper and manifest under application resources at the path resolved by `MacOSVisionOcrAdapter`.
- Sign the nested helper before signing the enclosing application, then notarize/staple the final artifact.
- Run capability probe, visible-text recognition, invalid-image rejection, and app-level OCR Job/Artifact smoke from the packaged application. A source-tree helper smoke is necessary but not sufficient release evidence.

Secrets:

- Apple signing certificates.
- Apple notarization credentials.
- Windows signing certificate.
- GitHub release token.
- Optional update signing keys.

Rules:

- Release secrets live only in GitHub Actions secrets or local maintainer signing environment.
- Release secrets never enter the repository.
- Public fork pull requests must not receive signing secrets.

## 6. Packaging And Update Dependencies

v0.1 default choices:

- `electron-builder` for packaging, signing integration, and update metadata.
- `electron-updater` for GitHub Releases based updates.
- GitHub Releases as v0.1 update host.
- Native Electron `autoUpdater` remains a fallback only if the packaging stack changes.

Implementation must pin exact versions and update the Technical Architecture external dependency registry before release.

## 7. Auto-Update Strategy

v0.1 should support automatic updates.

Update flow:

1. App periodically checks update metadata from the configured channel.
2. If update exists, show non-intrusive update availability.
3. Download update in background after user consent or according to setting.
4. Verify update metadata/signature/checksum.
5. Prompt to restart and install.
6. Preserve open work before restart.

Rules:

- Never interrupt active capture, review, backup, restore, parsing, OCR, or index rebuild without user action.
- Do not update while a destructive or long-running permissioned operation is active.
- Store update state machine in machine-local app data.
- Failed update should leave current app usable.
- User can disable automatic download, but update checks remain visible in About/Settings.

## 8. Code Signing And Notarization

macOS:

- Developer ID signing required for public distribution.
- Notarization required before release.
- Hardened runtime enabled.
- Entitlements kept minimal.
- Every nested native OCR helper is signed with the release identity before the enclosing app is signed; helper checksum verification complements but does not replace code signing/notarization.

Windows:

- Code signing strongly recommended for v0.1.
- Unsigned alpha builds are allowed only if clearly marked and not presented as production-ready.
- Windows installer must not require admin privileges unless a selected installer format makes it unavoidable.

Rules:

- Signed artifacts should be the default download.
- Release notes must disclose if a build is unsigned.
- Auto-update should prefer signed artifacts only.

## 9. Update Security

Threats:

- Tampered binary.
- Wrong update channel.
- Compromised release metadata.
- Downgrade attack.
- Dependency compromise.

Mitigations:

- Signed release artifacts.
- Checksums in release metadata.
- Protected GitHub release tags.
- Version monotonicity checks.
- Channel checks.
- Dependency lockfiles.
- Release provenance from GitHub Actions.
- Manual maintainer review for dependency upgrades that affect bundled binaries or update pipeline.

## 10. Versioning

Version scheme:

- Semantic versioning.
- Pre-release labels for alpha/beta, such as `0.1.0-alpha.1`.

Artifact naming:

```txt
Pige-0.1.0-alpha.1-mac-arm64.dmg
Pige-0.1.0-alpha.1-mac-x64.dmg
Pige-0.1.0-alpha.1-win-x64.exe
Pige-0.1.0-alpha.1-win-arm64.exe
```

Rules:

- App version, vault schema version, database schema version, dependency manifest version, and model manifest version are separate.
- App upgrade must not silently migrate vault schema in a destructive way.
- Stable ID, conflict, tombstone, schema-version, backup-compatibility, and migration-plan rules are governed by `docs/SYNC_CONFLICT_AND_MIGRATION.md`.

## 11. Dependency And Tool Updates

Required automated checks:

- Dependabot security alerts and version-update pull requests.
- CodeQL JavaScript/TypeScript code scanning.
- npm audit or package-manager-equivalent vulnerability scanning.

Human review is still required for dependencies that affect native modules, signing, update, parser binaries, package execution, or secret storage.

Before updating a dependency:

1. Find it in the Technical Architecture external dependency registry.
2. Review upstream release notes.
3. Check license changes.
4. Check security advisories.
5. Check package size changes.
6. Run platform smoke tests.
7. Update registry if source, role, status, or update policy changed.
8. Update `resources/dependency-manifest/` records, including version pins, license/notice status, distribution mode, data boundary, and replacement path.
9. Update bundled tool, model, provider catalog, lockfile, SBOM, and checksum manifests where applicable.
10. Remove expired waivers or replace them with a reviewed manifest record before release.

CI/release checks should fail if:

- A production, runtime, bundled, model, provider, parser, OCR, release, or CI dependency is not represented in the dependency manifest.
- A manifest record references a missing Technical Architecture registry row.
- A manifest record fails the schema in `resources/dependency-manifest/dependency-manifest.schema.json`.
- A required or recommended dependency reaches release without a version pin, license status, or checksum/signature policy where applicable.
- A dependency update changes a permission, data boundary, package size class, bundled binary, model asset, or update behavior without release notes and a smoke-test plan.
- A waiver is expired or attempts to waive unknown executable provenance, unclear licensing, hidden task-time downloads, secret exposure, renderer trust-boundary bypass, or available signature/checksum checks for bundled executables.

Special cases:

- Electron update requires app startup, renderer isolation, native module, packaging, and auto-update tests.
- better-sqlite3 update requires Electron ABI packaging tests.
- Parser tool updates require ingest regression tests.
- `pdfjs-dist` or `@napi-rs/canvas` updates require malformed/encrypted/multilingual/image-only PDF fixtures, worker timeout/heap checks, source-page crash recovery, and packaged native-module startup on each supported macOS/Windows architecture.
- `mammoth`, `fast-xml-parser`, or `yauzl` updates require real semantic DOCX fixtures; relationship-ordered PPTX/notes/media fixtures; malformed ZIP/XML, DOCTYPE, duplicate/traversal, expansion-ratio, external-target, output-bound, timeout/heap, artifact-integrity, restart-recovery, and packaged Office-worker startup checks on supported macOS/Windows targets.
- `@mozilla/readability`, `jsdom`, or `undici` updates require representative and malformed article fixtures; inert script/subresource evidence; private/non-public/mapped-IP and redirect SSRF tests; validated-address pinning; charset, declared/streamed/decompressed size, body-deadline, element/output/image bounds; fallback quality propagation; and packaged web-worker startup checks on supported macOS/Windows targets.
- Apple Vision/ImageIO or Swift/Xcode updates require rebuilding each macOS architecture, protocol and helper-manifest checks, valid/invalid/oversized/multi-frame image fixtures, geometry/output bounds, source and Artifact integrity/recovery tests, packaged helper discovery, nested signing, and notarized-app startup smoke.
- PaddleOCR/Qwen model updates require model manifest and index rebuild tests.
- AI SDK provider update requires BYOK provider compatibility tests.

## 12. Model And Tool Downloads

v0.1 policy:

- Models are downloaded from configured upstream sources.
- Manual local model import is not supported.
- Downloads require explicit user consent.
- Download UI shows size, purpose, source, and local/cloud boundary.
- Downloads are resumable where feasible.
- Checksums/signatures are verified when upstream metadata is available.
- Model files live outside the vault in machine-local app data.

Removal:

- User can remove downloaded model files.
- Removing model files does not delete notes, source records, source assets, artifacts, memory, conversations, or indexes.
- Semantic search degrades to lexical search until model is re-downloaded and indexes are rebuilt.

## 13. License And Notices

Requirements:

- Generate bundled dependency notice file for each release.
- Include licenses for bundled binaries.
- Include model license metadata before download.
- Include dependency license summary in repository.
- Block release if required notices are missing.

Apache 2.0 project license does not automatically make bundled dependencies Apache-compatible. Each bundled tool requires review.

## 14. Release Notes

Release notes should include:

- New features.
- Breaking changes.
- Vault schema migrations.
- Database migrations.
- Dependency updates.
- Security fixes.
- Known issues.
- Platform support.
- Model/tool manifest changes.
- Backup recommendation before risky upgrades.

## 15. Rollback And Recovery

Rules:

- App update failure must leave the previous version usable.
- Vault migrations should create a pre-migration backup or explicit restore point when risky.
- Database migrations are rebuildable.
- User can reinstall previous app version if vault schema did not migrate beyond that version.
- Unsupported newer vault schemas should open read-only or block safely with a clear explanation.
- Release notes must mention if a release changes vault schema compatibility.

## 16. CI Test Matrix

Required:

- macOS 26 arm64.
- macOS 26 x64 if feasible.
- Windows 11 x64.
- Windows 10 x64 if v0.1 support is retained.

Recommended later:

- Windows arm64.
- Linux smoke build.

Test categories:

- App launch.
- Vault create/open.
- Text capture.
- URL capture.
- PDF/DOCX/PPTX ingest fixture.
- Packaged PDF worker startup with the platform-specific `@napi-rs/canvas` binary present; a source-tree-only success is insufficient release evidence.
- Packaged PDF page-renderer worker startup must rasterize a real no-text page to a validated PNG, then a supported macOS package must pass the rendered-page-to-Vision OCR flow. Source-tree worker and helper smokes remain necessary but are not installed-app evidence.
- Packaged Office worker startup with Mammoth, fast-xml-parser, and yauzl resolvable from the installed application; a source-tree-only success is insufficient release evidence.
- Packaged web-extractor worker startup with Mozilla Readability, jsdom, and Undici resolvable from the installed application; a source-tree-only success is insufficient release evidence.
- OCR capability detection.
- Packaged macOS Vision OCR helper integrity/probe plus direct-image recognition and invalid-image rejection on arm64 and x64.
- SQLite migration and FTS.
- Local RAG model manifest without model installed.
- Backup/restore.
- Auto-update metadata generation.
- Signing/notarization validation where credentials exist.
- Public Alpha usability scenario report with at least 25 mixed sources and post-restore retrieval.

Release evidence layout:

- CI and local release checks write generated evidence under `artifacts/`, which is gitignored by default.
- General test reports use `artifacts/test-reports/<suite>/<platform>/<build-id>/`.
- The Public Alpha scenario report uses `artifacts/release-evidence/v0.1/public-alpha-usability/<platform>/<build-id>/scenario-report.json`.
- The same directory should include a human-readable `summary.md`, optional screenshots, and redacted logs when useful.
- Release evidence must reference fixture manifest versions, app build ID, platform, installer artifact IDs, backup manifest summary, restore result, and unresolved blockers.
- Release evidence must not include private vault content, source bodies, raw prompts, raw model responses, secrets, tokens, or unredacted private paths.

Current local evidence is limited to a macOS 26 arm64 source build and native smoke. It does not prove x64 compilation, application-resource embedding, nested release signing, hardened-runtime behavior, notarization, or installed-app discovery; those remain release blockers until CI/package artifacts provide the evidence above.

## 17. v0.1 Release Gates

Pige can publish v0.1 alpha when:

- Supported platform installers build from GitHub Actions.
- macOS artifact is signed and notarized, or clearly marked unsigned if still internal-only.
- Windows artifact is signed or clearly marked unsigned alpha.
- Auto-update check works against GitHub Releases.
- App can update from one alpha build to the next in a test channel.
- Each platform distributable is at most 330,000,000 bytes without optional model/OCR
  weights, with 300,000,000 bytes retained as the optimization target.
- Packaged idle and ordinary-use memory pass the exact reference scenarios in
  `docs/PERFORMANCE_AND_RELIABILITY.md`; there is no unrecorded runtime-overhead waiver.
- Release contains license notices.
- Dependency registry is current.
- Smoke tests pass.
- Public Alpha usability scenario passes on macOS and at least one supported Windows target, or release notes clearly mark the platform gap as blocking/internal-only.
- Backup/restore works before and after update.
- No critical security issue remains open.
- `SECURITY.md` is current and the private vulnerability reporting path is enabled or clearly documented.
- `PRIVACY.md` is current and matches BYOK, telemetry, diagnostics, update, optional download, and Skill/package network behavior.
- `SUPPORT.md` is current and explains public issue triage, redacted reproductions, and safe support bundle sharing.
- `CODE_OF_CONDUCT.md`, issue templates, and PR template are present and aligned with support, privacy, security, and contribution policies.

## 18. Implementation Checklist

Before shipping any release:

- Are all dependencies pinned?
- Do dependency manifests validate against schema?
- Are dependency waivers unexpired and allowed?
- Are bundled binary checksums recorded?
- Are model downloads excluded from installer?
- Are update artifacts signed or labeled?
- Are app and vault schema versions documented?
- Are migration paths tested?
- Are release notes complete?
- Is the Public Alpha usability scenario report attached to the release evidence?
- Are dependency changes reflected in Technical Architecture?
- Are external users able to recover if update fails?
- Is `SECURITY.md` current, and is the private vulnerability reporting path enabled or clearly documented for this release?
- Is `PRIVACY.md` current, and does it match the release's actual data flows and network behavior?
- Is `SUPPORT.md` current, and does it match the release's diagnostics/support-bundle behavior?
- Are `CODE_OF_CONDUCT.md`, issue templates, and PR template current for this release?

## 19. Upstream References

Release-tool sources, pins, security policy, and update triggers are registered once in
[`TECH_ARCHITECTURE.md`](TECH_ARCHITECTURE.md#1610-release-packaging-and-update).
