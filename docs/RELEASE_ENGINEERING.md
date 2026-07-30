# Release Engineering

Status: Draft baseline
Date: 2026-07-09
Last reviewed: 2026-07-30

## 1. Purpose

This document owns Pige platform scope, packaging, protected publication, ad-hoc macOS
integrity, manual update, dependency distribution and release gates.

## 2. v0.1 Platform Scope

Phase 1 qualifies macOS 26+ arm64. Windows 11/10 code, CI and packageability hooks remain,
but signing, installed-runtime, visual and downloaded-distribution qualification are outside
Phase 1. Linux, mobile and browser-extension packaging are deferred. No unqualified platform
may be represented as supported.

## 3. Distributable Budget

The public-alpha ZIP must not exceed 330,000,000 bytes; 300,000,000 bytes remains the target.
It includes Electron/renderer, common parser/runtime tools, notices and manifests. Optional
embedding/reranking models, PaddleOCR weights/language packs, Vault data and rebuildable
indexes/caches are excluded. Optional downloads require explicit consent and displayed size;
v0.1 has no manual local-model import.

## 4. Channel And Version Authority

v0.1 uses semantic-version alpha tags `vMAJOR.MINOR.PATCH-alpha[.N]`. Only a protected tag
push in the canonical repository may publish; manual dispatch is not publication authority.
The exact tag, checked-out commit, app version and release manifest must agree. `stable` is a
future channel, and renderer code cannot select a feed or cross channels.

## 5. GitHub Actions Pipeline

PR/main workflows run their source-level quality, schema, dependency and changed-owner gates.
The release workflow uses commit-pinned actions, pinned install, tests and one versioned macOS
26+ arm64 ZIP. Pige is a personal project with no Apple Developer Program, Developer ID or
notarization credentials, so the workflow removes signing authority and creates no DMG or
automatic-update metadata.

After every bundle write, it seals native helpers and the final app inside-out using ad-hoc
identity `-`, requires `codesign --verify --deep --strict`, creates immutable SHA-256/SHA-512
and file-set manifests, then independently downloads and verifies the ZIP. Qualification must
prove the quarantined app is expected-untrusted yet intact; damaged, invalid, modified or
malformed diagnostics block the GitHub prerelease. Generated notes disclose Open Anyway.
Windows hooks are nonblocking and cannot add assets to this Phase 1 release.

Native owners compile `PigeVisionOCR.swift` and `PigeSpeech.swift` for arm64 with the macOS 26
SDK, embed exact source/compiler/target/size/SHA-256 manifests and required microphone copy,
seal helpers before the app, and prove packaged probe/recognition or bounded speech session
behavior. Availability and ordinary task execution never download native capabilities.

Future credentialed signing jobs must keep secrets outside the repository and fork PRs.

## 6. Packaging And Update Dependencies

- `electron-builder@26.15.3`: deterministic package and ad-hoc seal integration.
- `@electron/asar@4.2.0`: bounded build-time ASAR inspection only, not packaged runtime.
- GitHub Releases: protected-tag prerelease ZIP and manual download host.
- `electron-updater@6.8.9`: retained but unavailable in packaged v0.1; trusted automatic
  update is deferred until a compatible Apple signing identity exists.

Pins and roles stay in the Technical Architecture/dependency manifests.

## 7. Manual Update

Packaged v0.1 composes `NoNetworkUpdateCheckAdapter`: update check/download/apply has no
network or artifact authority and returns unavailable. Users download a newer canonical
GitHub prerelease ZIP, verify its published checksum, replace the app manually and retain the
Vault. No alpha-to-alpha, signed-feed, background update or relaunch claim is made.

## 8. macOS Integrity And Gatekeeper

The ad-hoc seal is applied only after all writes and covers nested executables plus the final
app. Strict deep codesign and exact Bundle hashes prove integrity/loadability, not Apple
identity, notarization, staple, hardened-runtime trust or origin.

Independent qualification checksum-verifies the downloaded ZIP, applies/preserves quarantine,
re-verifies the seal and requires Gatekeeper's untrusted/unknown-developer rejection with no
damaged, invalid, modified or malformed diagnostic. Users may choose System Settings > Privacy
& Security > Open Anyway. Release notes must state ad-hoc signing, Gatekeeper status, manual
install and manual update; they must not claim Developer ID, notarization or automatic update.

## 9. Supply-Chain Security

Protected tag/repository authority, pinned actions and dependencies, exact manifests, SHA-256/
SHA-512, strict seals, independent downloaded-byte verification, SBOM/legal checks and manual
review bound v0.1. Renderer code receives no release credentials, paths or feed authority.
Trusted signing/update requires a new reviewed decision and qualification lane.

## 10. Versioned Artifacts

The Phase 1 asset is `Pige-<version>-arm64.zip` plus checksum, release, SBOM/legal and
qualification manifests. No DMG, blockmap or update YAML is published. App, Vault/database,
dependency and model schema versions remain separate; migration owners prevent silent
destructive upgrades.

## 11. Dependency And Tool Changes

Dependabot, CodeQL and npm audit support review, but updates affecting native modules,
packaging, permissions, data boundaries, parsers/OCR, models, package execution, secret
storage or release infrastructure require owner-specific tests and release notes.

Before merging, review upstream notes, advisory/license/size changes, run affected platform
smokes, and update lockfiles plus Technical Architecture, dependency, tool, model, provider,
SBOM, notice and checksum records. Release fails for missing/unpinned registry entries,
invalid or expired waivers, unclear executable provenance/licensing, hidden task downloads,
secret or renderer-boundary bypass, or ignored available checksum/signature evidence.

Risk-specific coverage remains exact: Electron/native changes need packaged ABI/startup;
PDF/Office/web tools need representative and hostile fixtures plus worker recovery/resource
limits; Apple helpers need protocol, manifest, malformed/input-bound, integrity/recovery,
packaged discovery and downloaded-app smoke; model changes need manifest/index rebuild; Pi
updates need BYOK/Agent compatibility. Future automatic update additionally needs trusted
signing and alpha-to-alpha tests, but is not a v0.1 gate.

## 12. Optional Models And Tools

Optional assets use registered upstream sources, explicit consent, size/purpose/boundary copy,
resumable download where feasible and checksum/signature verification when available. They
live in machine-local app data. Removal never deletes durable user data; semantic retrieval
falls back to lexical until assets and indexes return.

## 13. Licenses And Notices

Every release includes project LICENSE/NOTICE, generated bundled-dependency notices, binary
licenses, model license metadata and current dependency manifests. Missing required
attribution blocks release; the project Apache license does not replace dependency review.

## 14. Release Notes

Notes cover features, known issues, macOS-only Phase 1 scope, ad-hoc/Open Anyway/manual update,
schema compatibility, migrations, security/dependency changes, optional assets and backup
advice. They link the exact protected tag and immutable artifact/qualification digests.

## 15. Rollback And Recovery

Failed install or replacement leaves the prior app and Vault usable. Risky Vault migration
creates a backup/restore point; rebuildable databases may rebuild. Users may reinstall an
older app only while Vault compatibility permits it. Newer unsupported Vaults open read-only
or fail closed, and release notes disclose compatibility changes.

## 16. Release Qualification Evidence

Required macOS evidence includes app launch; Vault create/open; typed, URL and mixed-file
capture; packaged PDF/Office/web workers; PDF render-to-Vision, direct image OCR and native
helper integrity; speech permission/session/asset behavior; SQLite migration/FTS; lexical
fallback; backup/fresh restore; six locales; accessibility/UI capture; and the observed
25-source Public Alpha scenario with post-restore grounded retrieval.

The downloaded candidate additionally reports exact artifact/app/ASAR hashes and sizes,
strict nested/final seal, quarantine/Gatekeeper classification, renderer-safe UI evidence,
process-tree ownership, idle/ordinary/post-heavy RSS, worker cleanup, SBOM/notices/license
digests and unresolved blockers. It must not contain private paths, Vault/source bodies,
prompts/model responses, secrets or tokens.

Generated evidence stays under `artifacts/test-reports/` or
`artifacts/release-evidence/v0.1/public-alpha-usability/<platform>/<build-id>/`; release
reports reference fixture/recipe versions, build/tag/commit, artifact IDs, backup/restore
facts and exact report digests. The release lane generates the real 25-source and
10,000-page/100,000-chunk reports once, rejects failed/stale/mismatched evidence, reverifies
downloaded copies and publishes both reports with their digests. Source coverage does not
complete acceptance until a protected release publishes passed assets.

## 17. v0.1 Release Gates

Phase 1 requires the exact protected tag; independently downloaded checksum-matched ad-hoc
arm64 ZIP; intact expected-untrusted quarantine result; <=330,000,000 bytes; packaged RSS/
scale/recovery; workers/OCR/speech; six-locale UI/accessibility; notices/SBOM/dependency
registry; backup/fresh restore; security/privacy/support readiness; and the 25-source macOS
scenario. Manual GitHub ZIP download is the only update path. Windows/Linux qualification and
trusted automatic update are outside Phase 1. No critical security or data-loss issue may
remain.

Active-development PRs do not repeat packaging. One release-freeze dispatch owns the macOS
package, independent download, quarantine, runtime/UI/RSS and backup/restore evidence.

## 18. Final Checklist

Confirm pins and registry coverage; no invalid waivers or hidden optional assets; exact tag,
commit, version and manifests; inside-out/final ad-hoc seal; expected-untrusted intact report;
artifact/SBOM/legal/qualification digests; migration/recovery compatibility; notes; Public
Alpha scenario; and current security, privacy, support and collaboration copy.

## 19. Upstream References

Release dependencies, pins and update triggers are registered in
[`TECH_ARCHITECTURE.md`](TECH_ARCHITECTURE.md#1610-release-packaging-and-update).
