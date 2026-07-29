import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseReleaseTag } from "./release-tag.mjs";
import { verifyReleaseManifest } from "./release-artifacts.mjs";

const ORDINARY_MEMORY_CEILING_BYTES = 1_073_741_824;

export function parseProcessTable(output) {
  return output.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/u.exec(line);
    return match ? [{ pid: Number(match[1]), parentPid: Number(match[2]), residentKiB: Number(match[3]) }] : [];
  });
}

export function summarizeProcessTree(rows, rootPid) {
  const included = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (included.has(row.parentPid) && !included.has(row.pid)) {
      included.add(row.pid);
      changed = true;
    }
  }
  const tree = rows.filter((row) => included.has(row.pid));
  return {
    processCount: tree.length,
    residentBytes: tree.reduce((total, row) => total + row.residentKiB * 1024, 0)
  };
}

export function validateRuntimeQualification(runtime, expectedVersion) {
  if (
    runtime?.schemaVersion !== 1 || runtime?.status !== "passed" ||
    runtime.runtimeIdentity?.appName !== "Pige" || runtime.runtimeIdentity?.appVersion !== expectedVersion ||
    runtime.runtimeIdentity?.isPackaged !== true || runtime.pi?.adapterMode !== "embedded_pi_sdk" ||
    runtime.home?.state !== "completed" || runtime.home?.citationCount !== 1 ||
    runtime.renderer?.title !== "Pige" || runtime.renderer?.rootReady !== true ||
    runtime.renderer?.preloadReady !== true || runtime.renderer?.healthReady !== true ||
    runtime.renderer?.toolchainManifest?.requiredRuntimeModulesReady !== true ||
    runtime.renderer?.uiEvidence?.fileName !== "packaged-ui.png" ||
    !/^sha256:[a-f0-9]{64}$/u.test(runtime.renderer?.uiEvidence?.sha256 ?? "") ||
    !Number.isSafeInteger(runtime.renderer?.uiEvidence?.bytes) || runtime.renderer.uiEvidence.bytes <= 0
  ) throw new Error("Downloaded macOS runtime qualification returned an invalid bounded result.");
  return runtime;
}

export async function qualifyDownloadedMacos(options) {
  if (process.platform !== "darwin") throw new Error("Downloaded macOS qualification requires macOS.");
  const release = parseReleaseTag(options.tag);
  if (!/^[a-f0-9]{40}$/u.test(options.commit ?? "")) throw new Error("Release commit is invalid.");
  if (!/^[A-Z0-9]{10}$/u.test(options.teamId ?? "")) throw new Error("Expected macOS Team ID is invalid.");
  const directory = path.resolve(options.directory);
  const reportPath = path.resolve(options.report);
  const manifest = verifyReleaseManifest({ directory, platform: "macos-arm64", tag: release.tag, commit: options.commit });
  const signature = JSON.parse(fs.readFileSync(path.join(directory, "macos-signature-report.json"), "utf8"));
  if (signature.teamId !== options.teamId || signature.developerId !== true || signature.notarized !== true || signature.stapled !== true) {
    throw new Error("Downloaded macOS signature report is not release-qualified.");
  }
  const zipPath = path.join(directory, `Pige-${release.version}-arm64.zip`);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-downloaded-release-"));
  try {
    const installedRoot = path.join(temporaryRoot, "fresh-install");
    fs.mkdirSync(installedRoot, { recursive: true });
    run("/usr/bin/ditto", ["-x", "-k", zipPath, installedRoot]);
    const appPath = path.join(installedRoot, "Pige.app");
    const executablePath = path.join(appPath, "Contents/MacOS/Pige");
    if (!fs.statSync(executablePath).isFile()) throw new Error("Downloaded release did not create the expected fresh application.");
    const runtimeReportPath = path.join(temporaryRoot, "runtime.json");
    const runtime = await launchAndObserve(executablePath, runtimeReportPath, temporaryRoot);
    validateRuntimeQualification(runtime, release.version);
    const screenshotPath = `${runtimeReportPath}.png`;
    const screenshot = fs.readFileSync(screenshotPath);
    if (`sha256:${createHash("sha256").update(screenshot).digest("hex")}` !== runtime.renderer.uiEvidence.sha256) {
      throw new Error("Downloaded macOS UI evidence checksum does not match the runtime report.");
    }
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    const evidenceName = "packaged-ui.png";
    fs.copyFileSync(screenshotPath, path.join(path.dirname(reportPath), evidenceName));
    const report = {
      schemaVersion: 1,
      status: "passed",
      tag: release.tag,
      version: release.version,
      commit: options.commit,
      platform: "macos-arm64",
      releaseManifestSha256: checksumJson(manifest),
      downloadedZipSha256: checksumFile(zipPath),
      freshInstall: true,
      signing: { developerId: true, notarized: true, stapled: true, teamId: options.teamId },
      runtime: {
        pi: true,
        groundedHome: true,
        renderer: true,
        preload: true,
        health: true,
        requiredRuntimeModules: true
      },
      memory: runtime.memory,
      uiEvidence: { fileName: evidenceName, bytes: screenshot.byteLength, sha256: runtime.renderer.uiEvidence.sha256 },
      unresolvedIssues: []
    };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (serialized.includes(temporaryRoot) || /(?:\/Users\/|Authorization\s*:|Bearer\s+\S+)/iu.test(serialized)) {
      throw new Error("Downloaded macOS qualification report contains private data.");
    }
    fs.writeFileSync(reportPath, serialized, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return report;
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function launchAndObserve(executablePath, reportPath, temporaryRoot) {
  const child = spawn(executablePath, [
    `--pige-packaged-runtime-smoke-report=${reportPath}`,
    `--user-data-dir=${path.join(temporaryRoot, "user-data")}`,
    "--disable-gpu"
  ], { cwd: temporaryRoot, env: safeEnvironment(), stdio: "ignore" });
  let peakResidentBytes = 0;
  let peakProcessCount = 0;
  let sampleCount = 0;
  const sample = () => {
    const result = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,rss="], { encoding: "utf8", timeout: 5_000 });
    if (result.status !== 0) return;
    const sample = summarizeProcessTree(parseProcessTable(result.stdout), child.pid);
    peakResidentBytes = Math.max(peakResidentBytes, sample.residentBytes);
    peakProcessCount = Math.max(peakProcessCount, sample.processCount);
    sampleCount += 1;
  };
  sample();
  const sampler = setInterval(sample, 100);
  const timeout = setTimeout(() => child.kill("SIGKILL"), 90_000);
  const status = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).finally(() => {
    clearInterval(sampler);
    clearTimeout(timeout);
  });
  if (status !== 0 || !fs.existsSync(reportPath)) throw new Error("Downloaded macOS application runtime smoke failed.");
  if (sampleCount === 0 || peakProcessCount === 0 || peakResidentBytes <= 0 || peakResidentBytes >= ORDINARY_MEMORY_CEILING_BYTES) {
    throw new Error("Downloaded macOS process-tree memory evidence is missing or exceeds the ordinary ceiling.");
  }
  const runtime = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  runtime.memory = { sampleCount, peakProcessCount, peakResidentBytes, ceilingBytes: ORDINARY_MEMORY_CEILING_BYTES };
  return runtime;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 60_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Downloaded macOS release extraction failed.");
}

function checksumFile(filePath) {
  return `sha256:${createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function checksumJson(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function safeEnvironment() {
  return Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SHELL", "USER", "LOGNAME"]
    .flatMap((name) => process.env[name] ? [[name, process.env[name]]] : []));
}

function parseOptions(args) {
  return Object.fromEntries(args.map((argument) => {
    const [key, ...value] = argument.replace(/^--/u, "").split("=");
    return [key === "team-id" ? "teamId" : key, value.join("=")];
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await qualifyDownloadedMacos(parseOptions(process.argv.slice(2)));
  process.stdout.write("Downloaded macOS release qualification passed.\n");
}
