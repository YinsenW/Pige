import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  assertGeneratedReportEnvelope,
  generatedReportPath,
  writeGeneratedReport
} from "./generated-report-contract.mjs";

export const FOUNDATION_RECIPE = "scripts/verify/repository-foundation-smoke.mjs";
export const FOUNDATION_CHECKS = Object.freeze([
  Object.freeze({ id: "format_check", args: ["run", "format:check"] }),
  Object.freeze({ id: "typecheck", args: ["run", "typecheck"] }),
  Object.freeze({ id: "unit_tests", args: ["test"] }),
  Object.freeze({ id: "production_build", args: ["run", "build"] }),
  Object.freeze({ id: "development_electron_launch", args: ["run", "smoke:development-launch"] })
]);

const CHECK_STATES = new Set(["passed", "failed", "not_run"]);

export function assertRepositoryFoundationReport(report) {
  assertGeneratedReportEnvelope(report, FOUNDATION_RECIPE);
  const exactKeys = [
    "schemaVersion",
    "status",
    "generatedAt",
    "recipe",
    "recipeSha256",
    "platform",
    "buildId",
    "checks"
  ];
  if (JSON.stringify(Object.keys(report)) !== JSON.stringify(exactKeys)) {
    throw new Error("Repository foundation report fields are not canonical.");
  }
  if (!Array.isArray(report.checks) || report.checks.length !== FOUNDATION_CHECKS.length) {
    throw new Error("Repository foundation report has the wrong check count.");
  }
  for (const [index, expected] of FOUNDATION_CHECKS.entries()) {
    const check = report.checks[index];
    if (
      !check ||
      typeof check !== "object" ||
      Array.isArray(check) ||
      JSON.stringify(Object.keys(check)) !== JSON.stringify(["id", "status"]) ||
      check.id !== expected.id ||
      !CHECK_STATES.has(check.status)
    ) {
      throw new Error(`Repository foundation report check ${expected.id} is invalid.`);
    }
  }
  const passed = report.checks.every((check) => check.status === "passed");
  if ((report.status === "passed") !== passed) {
    throw new Error("Repository foundation report status does not match its checks.");
  }
}

export function runRepositoryFoundationSmoke(options = {}) {
  const root = options.root ?? process.cwd();
  const platform = options.platform ?? `${process.platform}-${process.arch}`;
  const buildId = options.buildId ?? resolveBuildId(root);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const runCheck = options.runCheck ?? ((check) => runNpmCheck(root, check));
  const recipePath = path.join(root, FOUNDATION_RECIPE);
  const recipeSha256 = crypto.createHash("sha256").update(fs.readFileSync(recipePath)).digest("hex");
  const checks = FOUNDATION_CHECKS.map(({ id }) => ({ id, status: "not_run" }));

  for (const [index, check] of FOUNDATION_CHECKS.entries()) {
    let result = false;
    try {
      result = runCheck(check) === true;
    } catch {
      result = false;
    }
    checks[index] = { id: check.id, status: result ? "passed" : "failed" };
    if (!result) break;
  }

  const report = {
    schemaVersion: 1,
    status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
    generatedAt,
    recipe: FOUNDATION_RECIPE,
    recipeSha256,
    platform,
    buildId,
    checks
  };
  assertRepositoryFoundationReport(report);
  const reportPath = generatedReportPath(root, "repository-foundation", platform, buildId);
  writeGeneratedReport(root, reportPath, report);
  return { report, reportPath };
}

function runNpmCheck(root, check) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(command, check.args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    timeout: 20 * 60_000,
    windowsHide: true
  });
  return !result.error && result.signal === null && result.status === 0;
}

function resolveBuildId(root) {
  const explicit = process.env.PIGE_REPORT_BUILD_ID;
  if (explicit) return explicit;
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true
  });
  const buildId = result.status === 0 ? result.stdout.trim() : "";
  if (!/^[a-f0-9]{40}$/u.test(buildId)) {
    throw new Error("Repository foundation smoke could not resolve a safe build ID.");
  }
  return buildId;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const { report, reportPath } = runRepositoryFoundationSmoke();
  const relativeReport = path.relative(process.cwd(), reportPath).split(path.sep).join("/");
  console.log(`Repository foundation smoke ${report.status}: ${relativeReport}.`);
  if (report.status !== "passed") process.exitCode = 1;
}
