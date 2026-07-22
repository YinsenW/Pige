import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ADAPTER_PATH = "apps/desktop/src/main/services/pi-agent-runtime-adapter.ts";
const PROVIDER_BINDING_PATH = "apps/desktop/src/main/services/pi-agent-provider-binding.ts";
const TOOL_BOUNDARY_PATH = "apps/desktop/src/main/services/pi-agent-tool-boundary.ts";
const SAFE_PROJECTION_PATH = "apps/desktop/src/main/services/pi-agent-safe-projection.ts";
const MODEL_CAPABILITY_PATH = "apps/desktop/src/main/services/model-capability-registry.ts";
const PI_RUNTIME_PATHS = new Set([
  ADAPTER_PATH,
  PROVIDER_BINDING_PATH,
  TOOL_BOUNDARY_PATH,
  SAFE_PROJECTION_PATH,
  MODEL_CAPABILITY_PATH
]);
const PI_PACKAGE_PATTERN = /["'](@earendil-works\/pi-(?:agent-core|ai)(?:\/[^"']*)?)["']/gu;
const FORBIDDEN_PI_SPECIFIER = /(?:\/compat$|\/providers\/all$|pi-coding-agent|pi-orchestrator)/u;
const PI_DEPENDENCIES = new Map([
  ["@earendil-works/pi-agent-core", "sha512-EFjyAuoz2kn24sR9Q5A86sZCG6mD+nz58DCsA2I2wxgmS50cF1tSLCBOZaHKI5U9Y3pJs4BefeK3LRkB5TdJag=="],
  ["@earendil-works/pi-ai", "sha512-8RLKLwe5TFM9kKFMNu/lTzveduq4GxZbnlG6ba8FAhLeb5wJP4zbj1eBumKBRvggpFQnW5R/Vo2a8zTlHsV9SQ=="]
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
      if (!PI_RUNTIME_PATHS.has(relativePath)) {
        failures.push(`${relativePath} imports Pi outside the reviewed Pige runtime boundary modules`);
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
      "new Agent({",
      "beforeToolCall:",
      "prepareNextTurnWithContext:",
      "createPiBinding(",
      "toPiTool("
    ]) {
      if (!adapter.includes(required)) failures.push(`${ADAPTER_PATH} is missing ${required}`);
    }
    for (const forbidden of [
      "process.env",
      "agent.followUp(",
      "toolExecution: \"sequential\"",
      "event.type === \"turn_end\"",
      "agent.clearAllQueues()"
    ]) {
      if (adapter.includes(forbidden)) failures.push(`${ADAPTER_PATH} contains forbidden ${forbidden}`);
    }
  }

  inspectBoundaryModule(root, PROVIDER_BINDING_PATH, failures, {
    required: [
      "createModels({ credentials, authContext: denyAmbientAuthContext })",
      "streamSimple:",
      "fileExists: async () => false",
      "env: async () => undefined"
    ],
    forbidden: ["process.env", "getApiKey:", "new ProviderModelJsonClient"]
  });
  inspectBoundaryModule(root, TOOL_BOUNDARY_PATH, failures, {
    required: [
      "executionMode: tool.execution === \"parallel_read_only\" ? \"parallel\" : \"sequential\"",
      "assertAddedToolNames(partialResult, catalog)",
      "onUpdate?.(partialResult)"
    ],
    forbidden: ["toolExecution:"]
  });
  inspectBoundaryModule(root, SAFE_PROJECTION_PATH, failures, {
    required: ["MAX_HISTORY_UTF8_BYTES"],
    forbidden: ["containsRestrictedModelContent", "new Agent(", "agent.followUp(", "streamFn:"]
  });
  inspectBoundaryModule(root, MODEL_CAPABILITY_PATH, failures, {
    required: ["conservative_unknown", "findReviewedPiModel"],
    forbidden: ["process.env", "CredentialStore"]
  });

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
    if (manifest.dependencies?.[packageName] !== "0.80.7") {
      failures.push(`apps/desktop/package.json must pin ${packageName} exactly to 0.80.7`);
    }
    if (workspace?.dependencies?.[packageName] !== "0.80.7") {
      failures.push(`package-lock workspace edge must pin ${packageName} exactly to 0.80.7`);
    }
    const installed = lockfile.packages?.[`apps/desktop/node_modules/${packageName}`] ??
      lockfile.packages?.[`node_modules/${packageName}`];
    if (installed?.version !== "0.80.7" || installed?.integrity !== integrity) {
      failures.push(`package-lock installed entry for ${packageName} does not match reviewed 0.80.7 integrity`);
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
  console.log("Pi runtime boundary OK: thin Agent assembly, isolated provider binding, per-tool policy, safe projection, and model capability registry are contained.");
}

function inspectBoundaryModule(root, relativePath, failures, expectations) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    failures.push(`${relativePath} is missing`);
    return;
  }
  const text = fs.readFileSync(filePath, "utf8");
  for (const required of expectations.required) {
    if (!text.includes(required)) failures.push(`${relativePath} is missing ${required}`);
  }
  for (const forbidden of expectations.forbidden) {
    if (text.includes(forbidden)) failures.push(`${relativePath} contains forbidden ${forbidden}`);
  }
}
