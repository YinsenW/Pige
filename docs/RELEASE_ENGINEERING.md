# Release Engineering

Status: Draft baseline
Date: 2026-07-09
Last reviewed: 2026-07-18

## 1. Purpose

Pige is intended to become a serious open-source desktop Agent product. Release engineering must make builds reproducible, updates safe, installer size controlled, and platform behavior predictable.

This document defines:

- Supported platforms.
- Installer and artifact strategy.
- GitHub Actions release pipeline.
- Auto-update strategy.
- Ad-hoc bundle sealing and downloaded-artifact integrity qualification.
- Model/tool distribution.
- Dependency update workflow.
- Release gates.

## 2. v0.1 Platform Scope

Phase 1 `v0.1 Public Alpha` supported platform:

- macOS 26 or later.

Deferred:

- Windows 11/10 public signing, installed-runtime, visual-equivalence and downloaded-distribution qualification; existing code, CI and packageability hooks remain.
- Linux packaging.
- Mobile.
- Browser extension.

Rules:

- macOS is the primary v0.1 quality target.
- Windows remains a maintained next-platform target and must not be represented as verified.
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

- Public alpha publication is triggered only by a protected tag push in the canonical
  repository. The accepted tag form is `vMAJOR.MINOR.PATCH-alpha[.N]`; manual workflow
  dispatch is not a publication authority.
- Alpha builds may show a subtle "Public Alpha" label in About.
- Update channel is recorded in app settings.
- Channel switching is explicit.
- Updates never cross from stable to alpha unless the user opts in.

## 5. GitHub Actions Pipeline

Required workflows cover PR/main checks, dependency/license policy, tagged builds, artifact
publication, and public security/privacy/support/contribution readiness. PRs run root
format/schema/docs/dependency checks; the constrained xvfb foundation may run Electron only
under its fixed Linux CI guard and emits a body-free report.

Public alpha publication accepts only a protected canonical-repository
`vMAJOR.MINOR.PATCH-alpha[.N]` push. Commit-pinned checkout/setup actions precede pinned
install, tests and the versioned macOS 26+ arm64 ZIP. Pige is a personal project and v0.1
has no Apple Developer Program, Developer ID or notarization credentials. The release job
therefore removes signing authority, seals nested executables and the final app ad hoc,
requires `codesign --verify --deep --strict`, independently downloads and checksum-verifies
the ZIP, and publishes one GitHub prerelease with generated notes. The downloaded app must
be intact while Gatekeeper classifies it as expected-untrusted; damaged, invalid, modified
or malformed diagnostics block publication. Windows hooks remain nonblocking and later.

macOS native OCR build order:

- Compile `PigeVisionOCR.swift` per architecture with macOS 26; generate/embed its exact
  source/compiler/target/size/SHA-256 manifest at the adapter-owned resource path.
- Seal the helper before the final app seal; packaged probe, valid/invalid recognition and
  app OCR Job/Artifact smoke are required beyond source-tree smoke.

macOS native speech build order:

- Compile `PigeSpeech.swift` with macOS 26; embed architecture/version/size/SHA-256 and
  `NSMicrophoneUsageDescription` (not Speech Recognition usage without a new API).
- Seal helpers inside-out; verify bounded session/install protocol, deep seal, staging/ZIP
  equality and fresh distribution. Availability/start never download; success still needs Start.

v0.1 uses no Apple or Windows signing credentials. Future trusted-signing jobs, if added,
must keep credentials in GitHub secrets or a maintainer signing environment and must never
expose them to the repository or fork PRs.

## 6. Packaging And Update Dependencies

v0.1 default choices:

- `electron-builder@26.15.3` for deterministic packaging and ad-hoc macOS sealing.
- `@electron/asar@4.2.0` only for bounded build-time ASAR inspection/extraction in
  packageability verification; it is not a packaged runtime dependency.
- GitHub Releases for protected-tag v0.1 prerelease ZIP publication and manual download.
- `electron-updater@6.8.9` remains unavailable in packaged v0.1; trusted automatic update
  is deferred until a compatible Apple signing identity exists.

Implementation must pin exact versions and update the Technical Architecture external dependency registry before release.

## 7. Manual Update Strategy

Phase 1 has no automatic update authority. Users obtain a newer protected-tag ZIP from the
canonical GitHub prerelease, verify its published checksum, replace the application manually,
and keep the Vault unchanged. Main composes `NoNetworkUpdateCheckAdapter`; renderer update
download/apply controls remain unavailable and cannot select a feed or artifact. Automatic
check/download/apply and alpha-to-alpha evidence are deferred until trusted signing exists.

## 8. Code Signing And Notarization

macOS:

- v0.1 arm64 seals every nested executable and the final app inside-out with ad-hoc identity
  `-` after all bundle writes, then requires strict deep verification and exact Bundle hashes.
- Independent download qualification applies quarantine and requires Gatekeeper's expected
  untrusted/unknown-developer rejection with no damaged, invalid, modified or malformed
  diagnostic. Users may choose System Settings > Privacy & Security > Open Anyway.
- This proves integrity and loadability, not Apple identity, notarization, staple or trust.

Windows:

- Windows hooks remain, but signing/install/update qualification is next-phase and nonblocking.

Rules:

- Release notes state that the app is ad-hoc signed, Gatekeeper-untrusted, manually installed
  and manually updated. They must not claim Developer ID, notarization or automatic update.

## 9. Update Security

Tampered binaries/metadata and dependency compromise are bounded by protected tag/environment
authority, exact identity/file-set manifests, SHA-256 checksums, strict deep ad-hoc seal
verification, independent downloaded-byte verification and manual review of release-sensitive
upgrades. v0.1 makes no automatic-update channel, downgrade or signed-feed claim.

## 10. Versioning

Version scheme:

- Semantic versioning.
- Pre-release labels for alpha/beta, such as `0.1.0-alpha.1`.

Exact v0.1 alpha names:

```txt
Pige-0.1.0-alpha.1-arm64.dmg
Pige-0.1.0-alpha.1-arm64.zip
Pige-0.1.0-alpha.1-arm64.zip.blockmap
alpha-mac.yml
Pige-0.1.0-alpha.1-x64-setup.exe
Pige-0.1.0-alpha.1-x64-setup.exe.blockmap
alpha.yml
```

App, vault/database schema, dependency and model manifest versions remain separate. Upgrades
must not silently destructively migrate vaults; sync/migration rules own compatibility.

## 11. Dependency And Tool Updates

Required automated checks:

- Dependabot security alerts and version-update pull requests.
- CodeQL JavaScript/TypeScript code scanning.
- npm audit or package-manager-equivalent vulnerability scanning.

Human review is still required for dependencies that affect native modules, signing, update, parser binaries, package execution, or secret storage.

Before updating a dependency:

1. Find it in the Technical Architecture registry; Pi core/AI update together.
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

- Future trusted automatic update requires app startup, renderer isolation, native module,
  packaging, signing and alpha-to-alpha tests; it is not a v0.1 gate.
- better-sqlite3 update requires Electron ABI packaging tests.
- B6.06 native updates require lock/notices, no-build/download, prebuilt ABI/backend,
  extension/vector/100k fallback and package checks.
- Parser tool updates require ingest regression tests.
- `pdfjs-dist` or `@napi-rs/canvas` updates require malformed/encrypted/multilingual/image-only PDF fixtures, worker timeout/heap checks, source-page crash recovery, and packaged native-module startup on each supported macOS/Windows architecture.
- `mammoth`, `fast-xml-parser`, or `yauzl` updates require real semantic DOCX fixtures; relationship-ordered PPTX/notes/media fixtures; malformed ZIP/XML, DOCTYPE, duplicate/traversal, expansion-ratio, external-target, output-bound, timeout/heap, artifact-integrity, restart-recovery, and packaged Office-worker startup checks on supported macOS/Windows targets.
- `@mozilla/readability`, `jsdom`, or `undici` updates require representative and malformed article fixtures; inert script/subresource evidence; private/non-public/mapped-IP and redirect SSRF tests; validated-address pinning; charset, declared/streamed/decompressed size, body-deadline, element/output/image bounds; fallback quality propagation; and packaged web-worker startup checks on supported macOS/Windows targets.
- Apple Vision/ImageIO or Swift/Xcode updates require rebuilding each macOS architecture,
  protocol and helper-manifest checks, valid/invalid/oversized/multi-frame image fixtures,
  geometry/output bounds, source and Artifact integrity/recovery tests, packaged helper
  discovery, nested ad-hoc sealing and downloaded-app startup smoke.
- PaddleOCR/Qwen model updates require model manifest and index rebuild tests.
- Pi Agent/AI provider update requires BYOK and Agent compatibility tests.

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
- Packaged macOS speech: session/permission/teardown, unsupported language, explicit Apple
  asset boundary and no egress; record real non-cancelable install versus truthful UI only.
- SQLite migration and FTS.
- Local RAG model manifest without model installed.
- Backup/restore.
- No automatic-update metadata in v0.1.
- Ad-hoc nested/final seal, quarantine, expected-untrusted Gatekeeper and intact-app validation.
- Public Alpha usability scenario report with at least 25 mixed sources and post-restore retrieval.

Release evidence layout:

- CI and local release checks write generated evidence under `artifacts/`, which is gitignored by default.
- General test reports use `artifacts/test-reports/<suite>/<platform>/<build-id>/`.
- The Public Alpha scenario report uses `artifacts/release-evidence/v0.1/public-alpha-usability/<platform>/<build-id>/scenario-report.json`.
- The same directory should include a human-readable `summary.md`, optional screenshots, and redacted logs when useful.
- Release evidence must reference fixture manifest versions, app build ID, platform, installer artifact IDs, backup manifest summary, restore result, and unresolved blockers.
- Release evidence must not include private vault content, source bodies, raw prompts, raw model responses, secrets, tokens, or unredacted private paths.

Current evidence: source tests freeze protected-tag publication, versioned ad-hoc macOS arm64
ZIP identity, strict seal checks, expected-untrusted quarantine classification, downloaded
runtime/UI/process-tree qualification and release legal/SBOM digest publication. No release or
status completion is claimed until the generated downloaded-distribution reports pass; Windows
qualification follows later.

## 17. v0.1 Release Gates

Phase 1 Public Alpha requires: exact protected-tag authority; independently downloaded,
checksum-matched, strictly ad-hoc-sealed macOS arm64 ZIP whose quarantined app is expected-
untrusted and never damaged/invalid/modified/malformed; exact final metadata/manifests;
distributables at or below 330,000,000 bytes (300,000,000 target); packaged memory/scale/
recovery budgets with no hidden waiver; notices, current dependency registry, smokes,
backup/fresh restore, downloaded runtime/UI evidence, and the 25-source scenario on macOS.
Manual GitHub ZIP download is the only v0.1 update path. Windows retains its qualification
gates in the next platform phase and is not claimed here.

### macOS release-freeze qualification

Active-development PRs and `main` do not repeat packaging. Explicit release-freeze
dispatch owns macOS package, downloaded-distribution, ad-hoc integrity/quarantine,
runtime/UI/RSS and backup/restore evidence. Windows/Linux qualification is batched later.
Portable contracts and platform adapters remain required, and no Windows/Linux support
claim is made until that explicit qualification succeeds.
No critical security issue may remain; current security/private-reporting, privacy,
support/redaction, conduct and issue/PR policies must match the released behavior.

## 18. Implementation Checklist

Before shipping, confirm: pinned/schema-valid dependencies and current architecture registry;
valid waivers, notices/checksums and no bundled optional models; exact protected tag/environment;
inside-out/final ad-hoc seals and expected-untrusted intact quarantine report; independent
manifest/SHA-256/SHA-512/metadata identity;
documented app/vault schemas and tested migrations/recovery; complete notes and Public Alpha
scenario report; and current security/private-reporting, privacy, support and collaboration copy.

## 19. Upstream References

Release-tool sources, pins, security policy, and update triggers are registered once in
[`TECH_ARCHITECTURE.md`](TECH_ARCHITECTURE.md#1610-release-packaging-and-update).
