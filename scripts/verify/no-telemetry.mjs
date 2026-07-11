import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const blockedPackages = [
  "@amplitude/analytics-browser",
  "@amplitude/analytics-node",
  "@datadog/browser-logs",
  "@datadog/browser-rum",
  "@elastic/apm-node",
  "@elastic/apm-rum",
  "@grafana/faro-web-sdk",
  "@newrelic/browser-agent",
  "@opentelemetry/api",
  "@opentelemetry/sdk-node",
  "@segment/analytics-next",
  "@segment/analytics-node",
  "@sentry/browser",
  "@sentry/electron",
  "@sentry/node",
  "@sentry/react",
  "@vercel/analytics",
  "amplitude-js",
  "analytics-node",
  "appcenter",
  "appcenter-analytics",
  "appcenter-crashes",
  "dd-trace",
  "mixpanel",
  "mixpanel-browser",
  "newrelic",
  "plausible-tracker",
  "posthog-js",
  "posthog-node"
];

const blockedSourcePatterns = [
  { id: "electron crash reporter", pattern: /\bcrashReporter\b/u },
  { id: "browser beacon upload", pattern: /\.sendBeacon\s*\(/u },
  { id: "automatic crash upload", pattern: /\buploadToServer\s*:\s*true\b/u },
  {
    id: "automatic telemetry configuration",
    pattern: /["']?(?:analytics|automaticCrashUpload|automaticDiagnosticUpload|telemetry)(?:Enabled)?["']?\s*[:=]\s*true\b/iu
  },
  { id: "Sentry DSN", pattern: /\bSENTRY_DSN\b/u },
  { id: "OpenTelemetry exporter", pattern: /\bOTEL_EXPORTER_[A-Z0-9_]+\b/u },
  { id: "analytics write key", pattern: /\b(?:AMPLITUDE|MIXPANEL|POSTHOG|SEGMENT|DATADOG|NEW_RELIC)_(?:API_)?KEY\b/u },
  {
    id: "telemetry collector endpoint",
    pattern: /https?:\/\/(?:[^/]+\.)?(?:sentry\.io|amplitude\.com|mixpanel\.com|posthog\.com|segment\.io|datadoghq\.com|newrelic\.com|appcenter\.ms)(?:[/:]|$)/iu
  },
  {
    id: "custom automatic diagnostics transport",
    pattern: /\b(?:fetch|request)\s*\(\s*["'`]https?:\/\/[^"'`]*(?:analytics|collect|crash|diagnostic|events|telemetry)[^"'`]*["'`]/iu
  }
];

const sourceExtensions = new Set([".cjs", ".html", ".js", ".json", ".mjs", ".ts", ".tsx", ".yaml", ".yml"]);
const workflowExtensions = new Set([".yaml", ".yml"]);
const skippedDirectories = new Set(["build", "dist", "node_modules", "out"]);

export function auditNoTelemetry(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const failures = [];

  for (const manifestPath of findFiles(root, (filePath) => path.basename(filePath) === "package.json")) {
    inspectPackageManifest(root, manifestPath, failures);
  }

  for (const sourceRoot of [path.join(root, "apps"), path.join(root, "packages")]) {
    for (const sourcePath of findFiles(sourceRoot, (filePath) => sourceExtensions.has(path.extname(filePath)))) {
      inspectSource(root, sourcePath, failures);
    }
  }

  const workflowsRoot = path.join(root, ".github", "workflows");
  for (const workflowPath of findFiles(workflowsRoot, (filePath) => workflowExtensions.has(path.extname(filePath)))) {
    inspectSource(root, workflowPath, failures);
  }

  return failures.sort((left, right) => left.localeCompare(right));
}

function inspectPackageManifest(root, manifestPath, failures) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    failures.push(`${relative(root, manifestPath)} is not valid JSON`);
    return;
  }

  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const dependencies = manifest[field];
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue;
    for (const [packageName, packageSpec] of Object.entries(dependencies)) {
      if (isBlockedPackage(packageName)) {
        failures.push(`${relative(root, manifestPath)} declares blocked ${field} package ${packageName}`);
      }
      const aliasTarget = npmAliasTarget(packageSpec);
      if (aliasTarget && isBlockedPackage(aliasTarget)) {
        failures.push(
          `${relative(root, manifestPath)} aliases blocked ${field} package ${aliasTarget} as ${packageName}`
        );
      }
    }
  }
}

function inspectSource(root, sourcePath, failures) {
  const text = fs.readFileSync(sourcePath, "utf8");
  const relativePath = relative(root, sourcePath);
  for (const packageName of blockedPackages) {
    const packagePattern = new RegExp(`(?:from\\s*|import\\s*\\(|require\\s*\\()?["']${escapeRegExp(packageName)}(?:/[^"']*)?["']`, "u");
    if (packagePattern.test(text)) {
      failures.push(`${relativePath} imports blocked telemetry package ${packageName}`);
    }
  }
  for (const blocked of blockedSourcePatterns) {
    if (blocked.pattern.test(text)) failures.push(`${relativePath} contains ${blocked.id}`);
  }
}

function isBlockedPackage(packageName) {
  return blockedPackages.some((blocked) => packageName === blocked || packageName.startsWith(`${blocked}/`));
}

function npmAliasTarget(packageSpec) {
  if (typeof packageSpec !== "string") return undefined;
  return packageSpec.match(/^npm:((?:@[^/]+\/)?[^@]+)(?:@|$)/u)?.[1];
}

function findFiles(root, predicate) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) files.push(...findFiles(filePath, predicate));
    } else if (entry.isFile() && predicate(filePath)) {
      files.push(filePath);
    }
  }
  return files;
}

function relative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const failures = auditNoTelemetry(process.cwd());
  if (failures.length > 0) {
    console.error("No-telemetry policy violations:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("No-telemetry policy OK: direct manifests, production sources, and workflows contain no configured analytics or automatic diagnostic upload path.");
}
