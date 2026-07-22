import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, "resources/architecture-reset.manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const failures = [];

if (manifest.schemaVersion !== 1) failures.push("architecture reset manifest must use schemaVersion 1");
if (manifest.status !== "contract_frozen_implementation_pending") failures.push("architecture reset status changed without a reviewed contract transition");
if (!Array.isArray(manifest.phases) || manifest.phases.map((phase) => phase.id).join(",") !== "AR1,AR2,AR3,AR4") {
  failures.push("architecture reset must retain the reviewed AR1-AR4 sequence");
}
if (!Array.isArray(manifest.passThroughSequence) || manifest.passThroughSequence.map((phase) => phase.id).join(",") !== "PT1,PT2,PT3,PT4") {
  failures.push("Pi pass-through remediation must retain the reviewed PT1-PT4 sequence");
}

const sourceRoots = ["apps/desktop/src", "packages"];
const ignoredSourceDirectories = new Set([
  ".git", "artifacts", "build", "coverage", "dist", "node_modules", "out", "vendor"
]);
const sourceFiles = collectAuthoritativeSourceFiles(root);
failures.push(...auditLegacyMarkers(root, sourceFiles, manifest.legacyMarkers));
failures.push(...auditNoGrowthMarkers(root, sourceFiles, manifest.passThroughNoGrowth));
failures.push(...verifySourceScopeGuard());

if (!Array.isArray(manifest.agentPassThroughInventory) || manifest.agentPassThroughInventory.length < 30) {
  failures.push("agent pass-through production inventory is incomplete");
}
for (const [relativePath, disposition, batch, rationale] of manifest.agentPassThroughInventory ?? []) {
  if (!relativePath || !["DELETE", "REWRITE", "KEEP"].includes(disposition) || !/^PT[1-4]$/u.test(batch) || !rationale) {
    failures.push(`invalid agent pass-through inventory entry for ${relativePath ?? "unknown"}`);
  }
  if (!fs.existsSync(path.join(root, relativePath)) && disposition !== "DELETE") {
    failures.push(`${disposition} pass-through inventory path is missing: ${relativePath}`);
  }
}

for (const disposition of ["DELETE", "REWRITE", "KEEP"]) {
  const entries = manifest.implementationInventory?.[disposition];
  if (!Array.isArray(entries) || entries.length === 0) failures.push(`implementation inventory ${disposition} is empty`);
  for (const [relativePath, phase, owner, rationale] of entries ?? []) {
    if (!relativePath || !phase || !owner || !rationale) failures.push(`invalid ${disposition} inventory entry for ${relativePath ?? "unknown"}`);
    if (!/^(?:AR[1-4])(?:\/AR[1-4])?$/u.test(phase)) failures.push(`${relativePath} has invalid phase ${phase}`);
    if (!fs.existsSync(path.join(root, relativePath)) && disposition !== "DELETE") failures.push(`${disposition} inventory path is missing: ${relativePath}`);
  }
}

const oversized = new Map(manifest.oversizedOwners.map(([file, baselineLines, disposition, rationale, phase]) => [file, {
  baselineLines, disposition, rationale, phase
}]));
const ownerFiles = [
  ...walk(path.join(root, "apps/desktop/src/main/services")).filter((file) => file.endsWith(".ts")),
  ...walk(path.join(root, "apps/desktop/src/renderer/src")).filter((file) => file.endsWith(".tsx"))
];
for (const absolutePath of ownerFiles) {
  const relativePath = relative(root, absolutePath);
  const lines = countLines(fs.readFileSync(absolutePath, "utf8"));
  const threshold = relativePath.includes("/renderer/")
    ? manifest.hardLimits.newRendererOwnerLines
    : manifest.hardLimits.newServiceLines;
  const entry = oversized.get(relativePath);
  if (lines > threshold && !entry) failures.push(`${relativePath} exceeds ${threshold} lines without KEEP/REWRITE ownership`);
  if (entry) {
    if (lines > entry.baselineLines) failures.push(`${relativePath} grew above frozen ${entry.baselineLines}-line reset baseline`);
    if (!["KEEP", "REWRITE"].includes(entry.disposition) || !entry.rationale || !/^AR[1-4]$/u.test(entry.phase)) {
      failures.push(`${relativePath} has an invalid reset disposition`);
    }
  }
}
for (const relativePath of oversized.keys()) {
  if (!fs.existsSync(path.join(root, relativePath))) continue;
  if (!ownerFiles.map((file) => relative(root, file)).includes(relativePath)) failures.push(`${relativePath} is not a scanned owner file`);
}

const adapterPath = path.join(root, "apps/desktop/src/main/services/pi-agent-runtime-adapter.ts");
if (countLines(fs.readFileSync(adapterPath, "utf8")) > manifest.hardLimits.piAdapterLines) {
  failures.push("Pi adapter exceeds the 400-line thin-assembly ceiling");
}

const acceptance = JSON.parse(fs.readFileSync(path.join(root, "resources/traceability/acceptance.manifest.json"), "utf8"));
for (const requirementId of ["PIGE-SEC-002", "PIGE-SEC-003", "PIGE-SEC-005", "PIGE-PI-003"]) {
  if (acceptance.requirements?.[requirementId]?.status !== "planned") {
    failures.push(`${requirementId} must remain planned until reset implementation evidence exists`);
  }
}
for (const exitId of ["E3.03", "E8.02", "E8.03"]) {
  if (acceptance.exits?.[exitId]?.status !== "planned") {
    failures.push(`${exitId} must remain planned until reset implementation evidence exists`);
  }
}

if (failures.length > 0) {
  console.error("Architecture reset contract failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

const inventoryCount = Object.values(manifest.implementationInventory).reduce((total, entries) => total + entries.length, 0);
console.log(`Architecture reset contract OK: ${manifest.legacyMarkers.length} legacy guards, ${manifest.passThroughNoGrowth.length} pass-through no-growth guards, ${manifest.agentPassThroughInventory.length} production call sites, ${inventoryCount} DELETE/REWRITE/KEEP entries, ${oversized.size} oversized owners, authoritative-source scope regression passed, AR1-AR4/PT1-PT4 frozen without status promotion.`);

function collectAuthoritativeSourceFiles(baseRoot) {
  return sourceRoots.flatMap((relativeRoot) => walk(path.join(baseRoot, relativeRoot)))
    .filter((file) => /\.(?:ts|tsx|json)$/u.test(file))
    .map((file) => relative(baseRoot, file));
}

function auditLegacyMarkers(baseRoot, relativePaths, markers) {
  const diagnostics = [];
  for (const marker of markers) {
    const allowed = new Set(marker.allowedPaths);
    let matches = 0;
    for (const relativePath of relativePaths) {
      const source = fs.readFileSync(path.join(baseRoot, relativePath), "utf8");
      const count = source.split(marker.token).length - 1;
      if (count === 0) continue;
      matches += count;
      if (!allowed.has(relativePath)) diagnostics.push(`${marker.id} appeared in new path ${relativePath}`);
    }
    if (matches > marker.maximumMatches) diagnostics.push(`${marker.id} grew from ${marker.maximumMatches} to ${matches} matches`);
    if (!["DELETE", "REWRITE"].includes(marker.disposition)) diagnostics.push(`${marker.id} must be DELETE or REWRITE during reset`);
  }
  return diagnostics;
}

function auditNoGrowthMarkers(baseRoot, relativePaths, markers) {
  const diagnostics = [];
  if (!Array.isArray(markers) || markers.length === 0) return ["pass-through no-growth markers are missing"];
  for (const marker of markers) {
    const allowed = new Set(marker.allowedPaths);
    let matches = 0;
    for (const relativePath of relativePaths) {
      const source = fs.readFileSync(path.join(baseRoot, relativePath), "utf8");
      const count = source.split(marker.token).length - 1;
      if (count === 0) continue;
      matches += count;
      if (!allowed.has(relativePath)) diagnostics.push(`${marker.id} appeared in new path ${relativePath}`);
    }
    if (matches > marker.maximumMatches) diagnostics.push(`${marker.id} grew from ${marker.maximumMatches} to ${matches} matches`);
  }
  return diagnostics;
}

function verifySourceScopeGuard() {
  const diagnostics = [];
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-architecture-reset-scope-"));
  const generatedTokenBody = [...manifest.legacyMarkers, ...manifest.passThroughNoGrowth]
    .map((marker) => marker.token).join("\n");
  const generatedPaths = [
    "packages/contracts/dist/index.d.ts",
    "packages/contracts/build/index.ts",
    "packages/contracts/out/index.ts",
    "packages/contracts/artifacts/index.ts",
    "packages/contracts/node_modules/example/index.ts",
    "packages/contracts/coverage/index.ts",
    "packages/contracts/vendor/index.ts"
  ];
  const sourceMutationPath = "apps/desktop/src/main/services/architecture-reset-source-mutation.ts";

  try {
    writeFixture(fixtureRoot, "packages/contracts/src/index.ts", "export const clean = true;\n");
    for (const generatedPath of generatedPaths) writeFixture(fixtureRoot, generatedPath, generatedTokenBody);
    writeFixture(fixtureRoot, sourceMutationPath, "export const forbidden = 'capture_only';\n");

    const fixtureSources = collectAuthoritativeSourceFiles(fixtureRoot);
    for (const generatedPath of generatedPaths) {
      if (fixtureSources.includes(generatedPath)) diagnostics.push(`generated directory was scanned as source: ${generatedPath}`);
    }
    if (!fixtureSources.includes(sourceMutationPath)) diagnostics.push("authoritative source mutation was not scanned");

    const captureOnly = manifest.legacyMarkers.find((marker) => marker.id === "onboarding.capture_only");
    const mutationDiagnostics = captureOnly
      ? auditLegacyMarkers(fixtureRoot, fixtureSources, [captureOnly])
      : ["capture_only legacy marker is missing"];
    if (!mutationDiagnostics.some((failure) => failure.includes(`appeared in new path ${sourceMutationPath}`))) {
      diagnostics.push("authoritative source mutation was not rejected");
    }
    const finishTool = manifest.passThroughNoGrowth.find((marker) => marker.id === "terminal.finish_tool");
    writeFixture(fixtureRoot, sourceMutationPath, "export const forbidden = 'pige_finish_home_turn';\n");
    const passThroughMutationDiagnostics = finishTool
      ? auditNoGrowthMarkers(fixtureRoot, collectAuthoritativeSourceFiles(fixtureRoot), [finishTool])
      : ["terminal finish-tool no-growth marker is missing"];
    if (!passThroughMutationDiagnostics.some((failure) => failure.includes(`appeared in new path ${sourceMutationPath}`))) {
      diagnostics.push("pass-through authoritative source mutation was not rejected");
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
  return diagnostics;
}

function writeFixture(baseRoot, relativePath, body) {
  const target = path.join(baseRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, "utf8");
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && ignoredSourceDirectories.has(entry.name)) return [];
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function relative(baseRoot, target) {
  return path.relative(baseRoot, target).split(path.sep).join("/");
}

function countLines(source) {
  return source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
}
