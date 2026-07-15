import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertPackageabilityHost,
  findDistributableNames,
  packageabilityPaths,
  resolvePackageabilityPlatform
} from "./packageability-platforms.mjs";
import {
  evaluatePackagedMemoryEvidence,
  PACKAGED_MEMORY_RECIPE,
  PACKAGED_MEMORY_SCENARIO_FAILURE_CODES
} from "./packaged-memory-contract.mjs";
import {
  assertGeneratedReportEnvelope,
  generatedReportPath,
  writeGeneratedReport
} from "../verify/generated-report-contract.mjs";

const root = process.cwd();
const options = parseOptions(process.argv.slice(2));
const target = resolvePackageabilityPlatform(options.platform, options.arch);
assertPackageabilityHost(target);
const buildId = resolveSafeSegment(process.env.PIGE_REPORT_BUILD_ID ?? "local-memory", "build ID");
const platform = `${target.platform}-${target.arch}`;
const baselineRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"]
}).trim();
const paths = packageabilityPaths(root, target, buildId);
const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pige-packaged-memory-")));

try {
  const executablePath = target.platform === "macos"
    ? extractMacDistribution(paths.outputRoot, tempRoot, target)
    : paths.executablePath;
  const appReportPath = path.join(tempRoot, "app-memory-report.json");
  const result = spawnSync(executablePath, [
    `--pige-packaged-memory-evidence-report=${appReportPath}`,
    `--user-data-dir=${path.join(tempRoot, "user-data")}`
  ], {
    cwd: tempRoot,
    env: safeEnvironment(),
    encoding: "utf8",
    timeout: 25 * 60_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });
  const appReport = readAppReport(appReportPath);
  if (result.error || result.signal || result.status !== 0 || appReport?.status !== "passed") {
    const stage = isSafeFailureStage(appReport?.stage) ? appReport.stage : "report_unavailable";
    const failureCode = isSafeFailureCode(appReport?.failureCode)
      ? `:${appReport.failureCode}`
      : "";
    throw new Error(`Packaged memory evidence failed at ${stage}${failureCode}.`);
  }
  assertAppReport(appReport);
  const memory = evaluatePackagedMemoryEvidence(appReport.evidence);
  const report = {
    schemaVersion: 1,
    status: memory.status,
    generatedAt: new Date().toISOString(),
    recipe: PACKAGED_MEMORY_RECIPE.id,
    recipeSha256: createHash("sha256").update(JSON.stringify(PACKAGED_MEMORY_RECIPE)).digest("hex"),
    platform,
    buildId,
    baselineRevision,
    runtime: {
      appName: "Pige",
      appVersion: "0.0.0",
      packaged: true,
      rendererRootReady: true,
      preloadReady: true,
      healthReady: true
    },
    fixture: appReport.fixture,
    memory
  };
  assertGeneratedReportEnvelope(report, PACKAGED_MEMORY_RECIPE.id);
  const reportPath = generatedReportPath(root, "packaged-memory", platform, buildId);
  writeGeneratedReport(root, reportPath, report);
  if (report.status !== "passed") throw new Error("Packaged memory evidence exceeded a reviewed limit.");
  console.log(`Packaged memory evidence OK: ${platform}, ${memory.ordinary.sampleCount} active samples.`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function assertAppReport(report) {
  if (
    Object.keys(report).sort().join(",") !==
      "evidence,fixture,renderer,runtimeIdentity,schemaVersion,status" ||
    report.schemaVersion !== 1 ||
    report.status !== "passed" ||
    report.runtimeIdentity?.appName !== "Pige" ||
    report.runtimeIdentity?.appVersion !== "0.0.0" ||
    report.runtimeIdentity?.isPackaged !== true ||
    report.renderer?.titleReady !== true ||
    report.renderer?.rootReady !== true ||
    report.renderer?.preloadReady !== true ||
    report.renderer?.healthReady !== true ||
    report.fixture?.pageCount !== 10_000 ||
    report.fixture?.chunkCount !== 100_000 ||
    !/^[a-f0-9]{64}$/u.test(report.fixture?.fixtureSha256 ?? "") ||
    !Number.isSafeInteger(report.fixture?.initialProgressEventCount) ||
    report.fixture.initialProgressEventCount <= 0
  ) {
    throw new Error("Packaged memory app report is invalid.");
  }
}

function readAppReport(reportPath) {
  if (!fs.existsSync(reportPath)) return undefined;
  const stat = fs.lstatSync(reportPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 2 * 1024 * 1024) {
    return undefined;
  }
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    return report && typeof report === "object" && !Array.isArray(report) ? report : undefined;
  } catch {
    return undefined;
  }
}

function extractMacDistribution(outputRoot, tempRoot, target) {
  const names = findDistributableNames(fs.readdirSync(outputRoot), target);
  if (names.length !== 1 || !names[0]) throw new Error("Packaged memory requires one macOS ZIP.");
  const distributionRoot = path.join(tempRoot, "distribution");
  fs.mkdirSync(distributionRoot, { mode: 0o700 });
  const extracted = spawnSync("/usr/bin/ditto", [
    "-x", "-k", path.join(outputRoot, names[0]), distributionRoot
  ], {
    env: safeEnvironment({ LANG: "C", LC_ALL: "C" }),
    encoding: "utf8",
    timeout: 2 * 60_000,
    maxBuffer: 1024 * 1024
  });
  if (extracted.error || extracted.signal || extracted.status !== 0) {
    throw new Error("Packaged memory could not extract the macOS distribution.");
  }
  return path.join(distributionRoot, "Pige.app", "Contents", "MacOS", "Pige");
}

function parseOptions(args) {
  const options = Object.fromEntries(args.map((argument) => {
    const [key, value] = argument.replace(/^--/u, "").split("=", 2);
    return [key, value];
  }));
  return { platform: options.platform, arch: options.arch };
}

function resolveSafeSegment(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u.test(value)) {
    throw new Error(`Packaged memory ${label} is invalid.`);
  }
  return value;
}

function isSafeFailureStage(value) {
  return new Set([
    "fixture_create", "vault_bind", "initial_rebuild", "renderer_window",
    "renderer_load", "memory_scenario", "report_write"
  ]).has(value);
}

function isSafeFailureCode(value) {
  return typeof value === "string" && PACKAGED_MEMORY_SCENARIO_FAILURE_CODES.includes(value);
}

function safeEnvironment(extra = {}) {
  const names = [
    "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE", "SHELL",
    "USER", "LOGNAME", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS",
    "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
    "APPDATA", "LOCALAPPDATA"
  ];
  return Object.fromEntries([
    ...names.flatMap((name) => process.env[name] ? [[name, process.env[name]]] : []),
    ...Object.entries(extra)
  ]);
}
