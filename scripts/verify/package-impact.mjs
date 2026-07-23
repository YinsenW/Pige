import fs from "node:fs";
import path from "node:path";

const PACKAGE_OVERRIDE_LABEL = "package-gates";
const REPOSITORY_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._+@()\[\]{} -]+(?:\/[A-Za-z0-9._+@()\[\]{} -]+)*$/u;

const NON_PACKAGE_PREFIXES = [
  "apps/desktop/src/renderer/src/locales/",
  "docs/",
  "resources/documentation-quality/",
  "resources/governance/",
  "resources/traceability/",
  "tests/fixtures/"
];

const NON_PACKAGE_EXACT_PATHS = new Set([
  ".github/CODEOWNERS",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "resources/architecture-reset.manifest.json",
  "resources/large-paste-boundary.manifest.json",
  "resources/ui-visual-contract.manifest.json"
]);

const PACKAGE_VERIFY_PATHS = new Set([
  ".github/workflows/packageability.yml",
  "scripts/verify/macos-speech-helper-smoke.mjs",
  "scripts/verify/macos-vision-ocr-helper-smoke.mjs",
  "scripts/verify/package-impact.mjs",
  "tests/unit/package-impact.test.ts"
]);

function isPureDocumentationPath(relativePath) {
  return !relativePath.includes("/") && relativePath.endsWith(".md");
}

function isPureGovernancePath(relativePath) {
  return relativePath.startsWith(".github/ISSUE_TEMPLATE/") ||
    (relativePath.startsWith("scripts/verify/") && !PACKAGE_VERIFY_PATHS.has(relativePath));
}

export function classifyPackageImpactPath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0 ||
      relativePath.includes("\\") || !REPOSITORY_PATH_PATTERN.test(relativePath)) {
    return { packageImpact: true, reason: "unknown_path" };
  }
  if (PACKAGE_VERIFY_PATHS.has(relativePath)) {
    return { packageImpact: true, reason: "package_verification" };
  }
  if (NON_PACKAGE_EXACT_PATHS.has(relativePath) || isPureDocumentationPath(relativePath) ||
      isPureGovernancePath(relativePath) ||
      NON_PACKAGE_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) {
    return { packageImpact: false, reason: "proven_non_package" };
  }
  return { packageImpact: true, reason: "package_or_unknown" };
}

export function decidePackageImpact({ paths = [], override = false, diffFailed = false } = {}) {
  if (override) return { required: true, reason: "explicit_override", impactedPaths: [] };
  if (diffFailed) return { required: true, reason: "diff_failure", impactedPaths: [] };
  if (!Array.isArray(paths) || paths.length === 0) {
    return { required: true, reason: "empty_or_invalid_diff", impactedPaths: [] };
  }
  const impactedPaths = paths.filter((relativePath) => classifyPackageImpactPath(relativePath).packageImpact);
  return impactedPaths.length > 0
    ? { required: true, reason: "package_impact", impactedPaths }
    : { required: false, reason: "proven_non_package", impactedPaths: [] };
}

export function parseChangedPaths(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError("changed paths input must be a Buffer");
  if (bytes.includes(0)) {
    return bytes.toString("utf8").split("\0").filter((entry) => entry.length > 0);
  }
  return bytes.toString("utf8").split(/\r?\n/u).filter((entry) => entry.length > 0);
}

export function runSelfTests() {
  const cases = [
    ["docs-only", ["docs/QUALITY_AND_TEST_STRATEGY.md"], false],
    ["trace-governance", ["resources/traceability/acceptance.manifest.json", "scripts/verify/decision-log.mjs"], false],
    ["locale-fixture", ["apps/desktop/src/renderer/src/locales/de/messages.json", "tests/fixtures/web/article.html"], false],
    ["main", ["apps/desktop/src/main/index.ts"], true],
    ["preload", ["apps/desktop/src/preload/index.ts"], true],
    ["native-helper", ["scripts/build/macos-vision-ocr-helper.mjs"], true],
    ["packaged-resource", ["resources/brand/pige-icon/macos/Pige.icns"], true],
    ["dependency", ["package.json"], true],
    ["lockfile", ["package-lock.json"], true],
    ["build", ["apps/desktop/electron-builder.yml"], true],
    ["release-signing", ["scripts/release/sign-macos-ad-hoc.mjs"], true],
    ["package-smoke", ["scripts/release/packaged-electron-smoke.mjs"], true],
    ["package-verifier", ["scripts/verify/package-impact.mjs"], true],
    ["unknown", ["future/owner/new-contract.bin"], true]
  ];
  for (const [label, paths, required] of cases) {
    const actual = decidePackageImpact({ paths }).required;
    if (actual !== required) throw new Error(`package-impact self-test failed: ${label}`);
  }
  if (!decidePackageImpact({ paths: ["docs/README.md"], override: true }).required) {
    throw new Error("package-impact self-test failed: explicit override");
  }
  if (!decidePackageImpact({ paths: ["docs/README.md"], diffFailed: true }).required) {
    throw new Error("package-impact self-test failed: diff failure");
  }
  if (!decidePackageImpact({ paths: [] }).required) {
    throw new Error("package-impact self-test failed: empty diff");
  }
  return cases.length + 3;
}

function readArgument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function main() {
  if (process.argv.includes("--self-test")) {
    const count = runSelfTests();
    console.log(`Package-impact classifier OK: ${count} direct and fail-closed cases passed.`);
    return;
  }

  const pathsFile = readArgument("paths-file");
  if (!pathsFile) throw new Error("--paths-file is required");
  const result = decidePackageImpact({
    paths: parseChangedPaths(fs.readFileSync(path.resolve(pathsFile))),
    override: process.argv.includes("--force-package")
  });
  if (readArgument("format") === "github-output") {
    console.log(`required=${result.required}`);
    console.log(`reason=${result.reason}`);
    return;
  }
  console.log(JSON.stringify(result));
}

export { PACKAGE_OVERRIDE_LABEL };

if (path.resolve(process.argv[1] ?? "") === path.resolve(import.meta.filename)) main();
