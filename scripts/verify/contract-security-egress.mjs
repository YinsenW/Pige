import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const failures = [];
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const requireAll = (relativePath, values) => {
  const text = read(relativePath);
  for (const value of values) if (!text.includes(value)) failures.push(`${relativePath} is missing ${value}`);
};

requireAll("AGENTS.md", [
  "One explicit user submit authorizes that Agent turn",
  "Permission confirmation is exceptional",
  "Connecting and selecting a cloud Provider, then submitting a turn, authorizes"
]);
requireAll("docs/TECH_ARCHITECTURE.md", [
  "Pi decides semantic work",
  "Own only exceptional high-risk confirmation",
  "One submitted turn authorizes registered first-party"
]);
requireAll("docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md", [
  "One user submit authorizes registered first-party reads",
  "effect crosses the closed",
  "Connected/selected Provider identity plus user Send authorizes"
]);
requireAll("docs/JOB_OPERATION_AND_RECOVERY.md", [
  "High-Risk Decisions Are Not Job States",
  "New Jobs never enter `waiting_permission` or `waiting_model_egress`"
]);
requireAll("PRIVACY.md", ["pressing Send", "`local_only`", "strips explicit secrets/credentials"]);
requireAll("SECURITY.md", ["High-risk confirmation bypass", "third-party Skill/package acquiring first-party submitted-turn authority"]);

const acceptance = JSON.parse(read("resources/traceability/acceptance.manifest.json"));
for (const id of ["PIGE-SEC-002", "PIGE-SEC-003", "PIGE-SEC-005", "PIGE-PI-003"]) {
  if (acceptance.requirements[id]?.status !== "planned") failures.push(`${id} must remain planned during AR1 implementation.`);
}
for (const id of ["E3.03", "E8.02", "E8.03"]) {
  if (acceptance.exits[id]?.status !== "planned") failures.push(`${id} must remain planned during AR1 implementation.`);
}

const main = read("apps/desktop/src/main/index.ts");
for (const [startMarker, endMarker, mutationMarker] of [
  ['ipcMain.handle("models.addPresetProvider"', 'ipcMain.handle("models.addManualProvider"', "getModelProviderRegistry().addPresetProvider(validatedRequest)"],
  ['ipcMain.handle("models.addManualProvider"', 'ipcMain.handle("models.refreshProviderModels"', "getModelProviderRegistry().addManualProvider(validatedRequest)"]
]) {
  const block = main.slice(main.indexOf(startMarker), main.indexOf(endMarker));
  if (block.indexOf(mutationMarker) < 0 || block.includes("confirmSettingAction")) {
    failures.push(`${startMarker} must keep Connect as the explicit Provider confirmation without a duplicate native prompt.`);
  }
}

const architecture = spawnSync(process.execPath, ["scripts/verify/architecture-reset.mjs"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 2 * 1024 * 1024
});
if (architecture.status !== 0) failures.push(`architecture reset contract failed: ${(architecture.stderr || architecture.stdout).trim()}`);

const focused = spawnSync("npx", ["vitest", "run",
  "tests/unit/model-provider-connection.test.ts",
  "tests/unit/model-provider-registry.test.ts",
  "tests/unit/setting-action-guard.test.ts"
], { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
if (focused.status !== 0) failures.push(`provider/high-risk focused tests failed: ${(focused.stderr || focused.stdout).trim()}`);

if (failures.length) {
  console.error("Authority/provider-send contract errors:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("CON-004 OK: submitted-turn authority, direct provider sends, and canonical high-risk confirmations are frozen without legacy approval state machines.");
