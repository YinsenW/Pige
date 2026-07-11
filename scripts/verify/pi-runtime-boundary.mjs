import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ADAPTER_PATH = "apps/desktop/src/main/services/pi-agent-runtime-adapter.ts";
const PI_PACKAGE_PATTERN = /["'](@earendil-works\/pi-(?:agent-core|ai)(?:\/[^"']*)?)["']/gu;
const FORBIDDEN_PI_SPECIFIER = /(?:\/compat$|\/providers\/all$|pi-coding-agent|pi-orchestrator)/u;
const PI_DEPENDENCIES = new Map([
  ["@earendil-works/pi-agent-core", "sha512-Lvn89ko42h5ETUb6Z0Ku6ldskEqXaTdQBYvSa0+7bdG9V6rUEpXptv5e0OVZ1HDcvi8s6/2lGCQWsxKX+DFHNw=="],
  ["@earendil-works/pi-ai", "sha512-7xfLk8sANBp+bpPEbjoOZTbPxsa+++b1JXAoSJsNa3vbs9AHHEclmvg54XLQcxH+fuwaeti/g2jeIfJ+mVYLpA=="]
]);

export function auditPiRuntimeBoundary(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const failures = [];
  const mainRoot = path.join(root, "apps", "desktop", "src", "main");
  for (const sourcePath of findSourceFiles(mainRoot)) {
    const relativePath = relative(root, sourcePath);
    const text = fs.readFileSync(sourcePath, "utf8");
    for (const match of text.matchAll(PI_PACKAGE_PATTERN)) {
      const specifier = match[1];
      if (!specifier) continue;
      if (relativePath !== ADAPTER_PATH) {
        failures.push(`${relativePath} imports Pi outside the sole Pige runtime adapter`);
      }
      if (FORBIDDEN_PI_SPECIFIER.test(specifier)) {
        failures.push(`${relativePath} imports forbidden Pi surface ${specifier}`);
      }
    }
  }

  const adapterPath = path.join(root, ADAPTER_PATH);
  if (!fs.existsSync(adapterPath)) {
    failures.push(`${ADAPTER_PATH} is missing`);
  } else {
    const adapter = fs.readFileSync(adapterPath, "utf8");
    for (const required of [
      "createModels({ credentials, authContext: denyAmbientAuthContext })",
      "streamFn:",
      "toolExecution: \"sequential\"",
      "beforeToolCall:",
      "fileExists: async () => false",
      "env: async () => undefined"
    ]) {
      if (!adapter.includes(required)) failures.push(`${ADAPTER_PATH} is missing ${required}`);
    }
    for (const forbidden of ["process.env", "providers/all", "/compat", "getApiKey:", "new ProviderModelJsonClient"] ) {
      if (adapter.includes(forbidden)) failures.push(`${ADAPTER_PATH} contains forbidden ${forbidden}`);
    }
  }

  const directBridgePath = path.join(root, "apps", "desktop", "src", "main", "services", "model-json-client.ts");
  if (fs.existsSync(directBridgePath)) failures.push("transitional direct JSON provider bridge still exists in the production service tree");
  inspectPiDependencies(root, failures);
  const notice = fs.existsSync(path.join(root, "NOTICE")) ? fs.readFileSync(path.join(root, "NOTICE"), "utf8") : "";
  if (!notice.includes("@earendil-works/pi-agent-core") || !notice.includes("@earendil-works/pi-ai")) {
    failures.push("NOTICE is missing Pi Agent Core or Pi AI attribution");
  }
  const licensePath = path.join(root, "resources", "licenses", "pi-MIT.txt");
  if (!fs.existsSync(licensePath) || !fs.readFileSync(licensePath, "utf8").includes("Copyright (c) 2025 Mario Zechner")) {
    failures.push("reviewed Pi MIT license text is missing");
  }
  return Array.from(new Set(failures)).sort((left, right) => left.localeCompare(right));
}

function inspectPiDependencies(root, failures) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "apps", "desktop", "package.json"), "utf8"));
  const lockfile = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const workspace = lockfile.packages?.["apps/desktop"];
  for (const [packageName, integrity] of PI_DEPENDENCIES) {
    if (manifest.dependencies?.[packageName] !== "0.80.6") {
      failures.push(`apps/desktop/package.json must pin ${packageName} exactly to 0.80.6`);
    }
    if (workspace?.dependencies?.[packageName] !== "0.80.6") {
      failures.push(`package-lock workspace edge must pin ${packageName} exactly to 0.80.6`);
    }
    const installed = lockfile.packages?.[`apps/desktop/node_modules/${packageName}`] ??
      lockfile.packages?.[`node_modules/${packageName}`];
    if (installed?.version !== "0.80.6" || installed?.integrity !== integrity) {
      failures.push(`package-lock installed entry for ${packageName} does not match reviewed 0.80.6 integrity`);
    }
  }
}

function findSourceFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...findSourceFiles(entryPath));
    else if (entry.isFile() && /\.(?:cjs|js|mjs|ts|tsx)$/u.test(entry.name)) files.push(entryPath);
  }
  return files;
}

function relative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const failures = auditPiRuntimeBoundary(process.cwd());
  if (failures.length > 0) {
    console.error("Pi runtime boundary violations:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Pi runtime boundary OK: one contained adapter owns official Pi imports, isolated auth/models, and sequential Pige tools.");
}
