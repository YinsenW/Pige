# Repository Structure

Status: Active implementation contract
Baseline date: 2026-07-09
Last revised: 2026-07-10

## 1. Purpose

This document defines the current repository ownership boundaries and the phase-gated target structure for an already scaffolded application. A path shown as a future target is not evidence that the directory or its implementation exists.

Pige should be easy for AI Coding Agents to navigate. Directory names should map to product and architecture concepts, not incidental implementation details.

## 2. Root Layout

Pige uses a lightweight workspace-style monorepo. v0.1 ships one desktop app, but shared domain contracts are not trapped inside the Electron app because future Web/mobile clients and remote Agent backends need the same schemas.

```txt
Pige/
  AGENTS.md
  README.md
  CONTRIBUTING.md
  CODE_OF_CONDUCT.md
  SECURITY.md
  PRIVACY.md
  SUPPORT.md
  LICENSE
  NOTICE
  .github/
  package.json
  pnpm-workspace.yaml or equivalent workspace config
  docs/
  apps/
    desktop/
  packages/
  tests/
  scripts/
  resources/
  artifacts/
```

Rules:

- `apps/desktop/` owns the Electron app shell, packaging entrypoints, and desktop-only integration.
- `packages/` owns reusable domain contracts, pure logic, and adapter interfaces.
- `tests/` owns cross-package fixtures, smoke tests, and release/eval fixtures.
- `resources/` owns non-code templates/catalogs/manifests that ship with or support the app.
- `artifacts/` owns generated local and CI evidence such as reports, screenshots, and redacted logs. It should be gitignored by default.
- `.github/` owns public collaboration templates, issue forms, PR template, and workflow definitions.
- Avoid adding a package until it has a stable owner role and more than one consumer or a strong isolation need.

Public collaboration files:

```txt
.github/
  ISSUE_TEMPLATE/
    bug_report.yml
    feature_request.yml
    design_review.yml
    security_contact_request.yml
    config.yml
  pull_request_template.md
```

Rules:

- Issue templates must remind users not to share private vaults, source files, secrets, raw prompts, raw model responses, or unreviewed support bundles.
- Security issue templates must route details to private vulnerability reporting and never request exploit details in public.
- PR templates must ask for requirement source, tests, documentation updates, and privacy/security/support checks.
- Template changes that affect user support, security reporting, or privacy promises must update `SUPPORT.md`, `SECURITY.md`, or `PRIVACY.md` as needed.

## 3. Workspace Packages

Recommended v0.1 package layout:

```txt
packages/
  domain/
    src/
      ids/
      types/
      errors/
      constants/
  contracts/
    src/
      ipc/
      jobs/
      permissions/
      settings/
      context/
      diagnostics/
  schemas/
    src/
      markdown/
      source-records/
      frontmatter/
      operations/
      backup/
  markdown/
    src/
      frontmatter/
      citations/
      links/
      managed-blocks/
  knowledge/
    src/
      tags/
      topics/
      entities/
      relationships/
      knowledge-tree/
  test-fixtures/
    src/
      builders/
      validators/
```

Package rules:

- `domain` contains pure domain types, ID helpers, stable constants, and domain error codes.
- `contracts` contains serializable DTOs and cross-runtime contracts for IPC, Jobs,
  high-risk effects, Agent context packs, and diagnostics; types derive from canonical
  schemas at real trust boundaries.
- `schemas` contains schema validators for persisted JSON/YAML/frontmatter records.
- `markdown` contains pure Markdown/frontmatter/citation/link helpers, not renderer UI.
- `knowledge` contains pure knowledge model helpers and graph aggregation logic.
- `test-fixtures` contains reusable fixture builders and validation helpers; real fixture files still live under `tests/fixtures/`.
- Packages must not import from `apps/desktop/`.
- Packages must not depend on Electron, Node filesystem APIs, OS keychains, native modules, or renderer-only UI libraries unless the package name explicitly marks it as platform-specific and the dependency is approved.
- If a package needs runtime access, define an interface in the package and implement it in an app/service adapter.

## 4. Desktop App Source

```txt
apps/desktop/
  package.json
  electron.vite.config.ts
  src/
    main/
      index.ts
      ipc/
      services/
      workers/
      adapters/
    preload/
      index.ts
    renderer/
      app/
      components/
      screens/
      styles/
      locales/
      routes/
      state/
    shared/
      desktop-dtos/
```

Rules:

- `main/services/` contains desktop service orchestration and durable state coordination.
- `main/ipc/` contains IPC handlers and validation only.
- `main/workers/` contains worker entrypoints.
- `main/adapters/` contains runtime integrations such as OCR, parser tools, model providers, keychain, filesystem dialogs, and updater APIs.
- `preload/` exposes the typed renderer API.
- `renderer/` contains UI only.
- `renderer/state/` may contain UI state only; domain state belongs to services and typed DTOs.
- `shared/desktop-dtos/` is allowed only for desktop-private DTOs that are not useful outside Electron. Cross-runtime contracts belong in `packages/contracts/`.
- Dependency direction is `apps/desktop` to `packages/*`; the reverse edge is forbidden
  by the package rule in section 3.

## 5. Services

Suggested service modules:

```txt
apps/desktop/src/main/services/
  capture/
  source-storage/
  jobs/
  conversations/
  vault-runtime/
  parser/
  ocr/
  agent/
  wiki-compiler/
  retrieval/
  rag/
  memory/
  settings-secrets/
  permissions/
  skills/
  packages/
  localization/
  backup/
  diagnostics/
```

Each service should have:

- A small public interface.
- Domain tests.
- Clear ownership of durable files or state.
- No renderer imports.
- No direct writes to another service's durable state.
- A `README.md` or package-level comment only when the service boundary is not obvious from the design docs.

Service file pattern:

```txt
service-name/
  ServiceName.ts
  ServiceName.types.ts
  ServiceName.errors.ts
  ServiceName.test.ts
  adapters/
  internal/
```

Rules:

- Public service interfaces live at the service root.
- Internal helpers live under `internal/`.
- External integrations live under `adapters/`.
- Tests that need real filesystem/app behavior live under `tests/integration/`; pure unit tests can sit near modules or in `tests/unit/` according to the chosen test runner.

## 6. Runtime Adapters

Runtime-specific behavior should be behind explicit adapters.

```txt
apps/desktop/src/main/adapters/
  filesystem/
  keychain/
  sqlite/
  model-providers/
  pi-agent/
  parsers/
  ocr/
  local-models/
  updater/
  shell/
```

Rules:

- Adapter interfaces should use DTOs from `packages/contracts/` or domain types from `packages/domain/`.
- Adapters are the only place that can call Electron APIs, OS APIs, native modules, external binaries, or network SDKs directly.
- Renderer code never imports adapters.
- Tests should be able to replace adapters with fakes or fixtures.

## 7. Prompts, Parsers, And Skills

Prompt templates, parser manifests, and Skill/package metadata are product contracts and should have stable locations.

```txt
resources/
  prompts/
    ingest/
    retrieval/
    note-agent/
    selection/
  parser-manifests/
  toolchain-manifest/
  dependency-manifest/
    dependency-manifest.schema.json
    dependencies.manifest.json
    dependency-waivers.manifest.json
  documentation-quality/
    documentation-quality.manifest.json
    independent-review.recipe.json
  traceability/
    p0-coverage.manifest.json
    acceptance.manifest.json
    semantic-claims.manifest.json
  ui-visual-contract.manifest.json
  provider-catalog/  # phase-gated; create only with populated metadata, an owner README, and a consumer
  skill-templates/
  curated-packages/
```

Rules:

- Prompt templates must follow `docs/PROMPT_DESIGN.md`.
- Prompt template IDs and versions must be testable.
- Parser manifests must include supported file types, tool/runtime requirements, output artifact contracts, and failure modes.
- Toolchain manifests must include source, version, license, checksum/signature policy, and update path.
- Dependency manifests must tie implementation dependencies back to the Technical Architecture registry, including package/binary/model ID, version pin, license, distribution mode, checksum or signature policy, data boundary, and replacement path.
- `dependency-manifest.schema.json` defines the machine-readable schema used by CI and release checks.
- `dependencies.manifest.json` contains approved implementation dependencies and exact pins once selected.
- `dependency-waivers.manifest.json` contains temporary exceptions with owner, reason, expiry, and replacement plan; it must not be used to bypass unknown licenses, secrets, signing risk, or unreviewed executable code.
- Traceability manifests partition PRD P0 scope and bind each requirement to Build, Exit, status, exact current/planned evidence, and structured open destinations. The semantic-claims manifest independently locks normalized source and mapping anchors; it is updated only after an explicit semantic review. These files are implementation controls, not generated reports.
- Documentation-quality controls define automated dimensions plus the hash-bound independent review of the current governed snapshot; generated acceptance reports remain under `artifacts/`.
- `ui-visual-contract.manifest.json` projects the UI owner's protected tokens, structural
  metrics, screenshot matrix, artifact paths, and review policy into a machine-checkable
  development gate; generated screenshots remain under `artifacts/ui-visual-baselines/`.
- Curated package metadata must include source URL, version, license when known, trust tier, capabilities, and permission requirements.
- User-installed Skills and packages do not live in `resources/`; runtime install locations follow `docs/SKILL_EXTENSION_DESIGN.md` and `docs/PI_PACKAGE_RESEARCH.md`.

## 8. Tests

```txt
tests/
  unit/
  integration/
  renderer/
  fixtures/
  smoke/
  evals/
```

Current state: `tests/unit/`, `tests/fixtures/`, and `tests/smoke/` exist. Create `tests/integration/`, `tests/renderer/`, or `tests/evals/` only when a phase adds owned content; the target tree above does not claim they already exist.

Fixture organization:

```txt
tests/fixtures/
  manifests/
    fixtures.manifest.json
    public-alpha-scenario.manifest.json
  markdown/
  web/
  pdf/
  office/
  images/
  ocr/
  security/
  vaults/
  i18n/
  evals/
  public-alpha/
```

Fixtures should include licensing notes when sourced externally.

Fixture manifests:

- `tests/fixtures/manifests/fixtures.manifest.json` is the registry for committed fixture families and generated fixture recipes.
- `tests/fixtures/manifests/public-alpha-scenario.manifest.json` defines the scripted Public Alpha usability scenario and the exact fixture IDs it uses.
- Every fixture entry should include `fixtureId`, `category`, `sourceFiles`, `expectedOutputs`, `redaction`, `license`, `sizeClass`, `requiredPlatformCapabilities`, `owner`, and `updatePolicy`.
- Fixture IDs should use stable dotted names: `<area>.<case>.<variant>.v<major>`, for example `text.large-paste.reference.v1`, `web.prompt-injection.settings.v1`, or `public-alpha.mixed-25.v1`.
- Large generated fixtures should store the generator and manifest entry in git, not necessarily the generated binary output.

Test ownership:

```txt
tests/unit/           pure package and service logic
tests/integration/    service workflows with filesystem/database fixtures
tests/renderer/       UI components, accessibility, i18n layouts
tests/smoke/          packaged app and platform smoke tests
tests/evals/          AI output quality and retrieval relevance fixtures
```

Generated test and release evidence:

```txt
artifacts/
  test-reports/
    <suite>/<platform>/<build-id>/
  release-evidence/
    v0.1/
      public-alpha-usability/
        <platform>/<build-id>/
          scenario-report.json
          summary.md
          screenshots/
          logs-redacted/
```

`artifacts/` is gitignored output, not a requirement source. Reports bind a recipe SHA, schema,
time, safe IDs and exact checks; private content, model traffic, credentials and absolute paths
are forbidden. Publication holds random no-follow temp and POSIX parent fds, rechecks bytes and
destination generation, and rejects unsafe/symlink/successor state without deleting successors.

Foundation prepares/runs root checks, then `npm run dev` with temp `userData`/loopback DevTools.
Strips secret/Electron plus case-folded no-sandbox env; restore requires
linux+CI=true+GITHUB_ACTIONS=true+fixed=1. `#root`/preload/health must pass; it kills tree and emits
launcher_error/launcher_exited/renderer_not_ready/startup_timeout
(default launcher_error), and writes
`artifacts/test-reports/repository-foundation/<platform>/<build-id>/report.json`.

Rules:

- Test names should follow `docs/QUALITY_AND_TEST_STRATEGY.md`.
- Evals must not require live cloud credentials in CI.
- Fixtures that represent user vaults must not contain real private data.
- Large binary fixtures should be minimized, generated where possible, or documented with source/license.

## 9. Scripts

```txt
scripts/
  dev/
  release/
  verify/
  fixtures/
  evals/
  docs/
```

Current state: `scripts/build/` and `scripts/verify/` exist. The other target directories are phase-gated and must not be created as empty placeholders.

Scripts must be documented and safe to run from a clean checkout. Destructive scripts require explicit confirmation flags.

Script rules:

- `scripts/verify/` owns local checks such as markdown links, requirement ID traceability, dependency manifests, and fixture validation.
- `scripts/fixtures/` owns fixture generation or normalization.
- `scripts/evals/` owns deterministic eval runners and report formatting.
- `scripts/release/` owns signing, packaging, SBOM/license notice, and update metadata helpers.
- Scripts should call app/package APIs rather than duplicate business logic.

## 10. Import Boundaries

Allowed dependency direction:

```txt
apps/desktop -> packages/contracts -> packages/domain
apps/desktop -> packages/schemas -> packages/domain
apps/desktop -> packages/markdown -> packages/schemas -> packages/domain
apps/desktop -> packages/knowledge -> packages/domain
tests -> apps/desktop and packages
scripts -> packages and explicit app CLIs
```

Rules:

- `packages/domain` imports no Pige package.
- `packages/contracts` may import `domain`.
- `packages/schemas` may import `domain`.
- `packages/markdown` may import `domain` and `schemas`.
- `packages/knowledge` may import `domain`, `schemas`, and `markdown` only when needed.
- App code can import packages, never the other way around.
- No circular imports across packages.
- No renderer import may reach `apps/desktop/src/main`, `adapters`, Node filesystem APIs, SQLite, keychain, shell, parser tools, model providers, or secrets.

## 11. Anti-Patterns

Avoid:

- `common/`, `utils/`, or `shared/` folders full of unrelated helpers.
- Renderer imports from `main/`.
- Services writing files owned by other services.
- Product logic embedded in React components.
- Parser/OCR/model logic hidden behind UI callbacks.
- Runtime-specific assumptions in shared domain contracts.
- Test fixtures stored only in comments or external links.
- Putting all schemas, DTOs, and domain logic inside `apps/desktop`.
- Adding a package that is only a name wrapper around one file.
- Letting package boundaries hide unclear ownership.

## 12. Scaffold And Growth Gate

The initial scaffold exists. Before adding a new top-level directory, workspace package, runtime adapter family, or test/script class:

- Identify its owner, active Phase/Build/Exit, and requirement IDs.
- Confirm that the path has real content and is not an empty future placeholder.
- Register any concrete dependency, binary, model, provider SDK, or CI action.
- Preserve workspace aliases, import-boundary checks, typecheck, tests, and build coverage.
- Update this current/target distinction and the document/resource map in the same change.
