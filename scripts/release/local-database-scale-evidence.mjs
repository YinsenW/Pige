import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
run(npm, ["run", "build"]);
const baselineRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"]
}).trim();
run(process.execPath, [
  path.join(root, "node_modules/vitest/vitest.mjs"),
  "run",
  "tests/unit/local-database-scale.test.ts"
], {
  PIGE_RUN_SCALE_EVIDENCE: "1",
  PIGE_SCALE_BUILD_ID: process.env.PIGE_SCALE_BUILD_ID ?? "local-scale",
  PIGE_BASELINE_REVISION: baselineRevision
});

function run(command, args, extraEnvironment = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...extraEnvironment },
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.signal || result.status !== 0) {
    throw new Error(`Local database scale evidence command failed at ${args[0] ?? "unknown"}.`);
  }
}
