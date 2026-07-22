import fs from "node:fs";
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

const sourceRoots = ["apps/desktop/src", "packages"];
const sourceFiles = sourceRoots.flatMap((relativeRoot) => walk(path.join(root, relativeRoot)))
  .filter((file) => /\.(?:ts|tsx|json)$/u.test(file))
  .map((file) => path.relative(root, file));

for (const marker of manifest.legacyMarkers) {
  const allowed = new Set(marker.allowedPaths);
  let matches = 0;
  for (const relativePath of sourceFiles) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    const count = source.split(marker.token).length - 1;
    if (count === 0) continue;
    matches += count;
    if (!allowed.has(relativePath)) failures.push(`${marker.id} appeared in new path ${relativePath}`);
  }
  if (matches > marker.maximumMatches) failures.push(`${marker.id} grew from ${marker.maximumMatches} to ${matches} matches`);
  if (!["DELETE", "REWRITE"].includes(marker.disposition)) failures.push(`${marker.id} must be DELETE or REWRITE during reset`);
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
  const relativePath = path.relative(root, absolutePath);
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
  if (!ownerFiles.map((file) => path.relative(root, file)).includes(relativePath)) failures.push(`${relativePath} is not a scanned owner file`);
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
console.log(`Architecture reset contract OK: ${manifest.legacyMarkers.length} legacy guards, ${inventoryCount} DELETE/REWRITE/KEEP entries, ${oversized.size} oversized owners, AR1-AR4 frozen without status promotion.`);

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function countLines(source) {
  return source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
}
