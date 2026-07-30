import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyMacGatekeeperAssessment,
  parseMacCodeSignatureDescription
} from "./packageability-security.mjs";
import { parseReleaseTag } from "./release-tag.mjs";
import { verifyReleaseManifest } from "./release-artifacts.mjs";

const ORDINARY_MEMORY_CEILING_BYTES = 1_073_741_824;
const NATIVE_HELPERS = ["pige-speech", "pige-vision-ocr"];

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
    runtime.runtimeIdentity?.isPackaged !== true || runtime.semanticRuntime?.embedding?.buildType !== "prebuilt" ||
    runtime.semanticRuntime?.sqliteVec !== true || runtime.pi?.adapterMode !== "embedded_pi_sdk" ||
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
  const directory = path.resolve(options.directory);
  const reportPath = path.resolve(options.report);
  const buildReportPath = path.resolve(options.buildReport);
  const manifest = verifyReleaseManifest({
    directory,
    platform: "macos-arm64",
    tag: release.tag,
    commit: options.commit
  });
  const zipPath = path.join(directory, `Pige-${release.version}-arm64.zip`);
  const buildReport = readBuildReport(buildReportPath, release.version, checksumFile(zipPath));
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-downloaded-release-"));
  try {
    const installedRoot = path.join(temporaryRoot, "fresh-install");
    fs.mkdirSync(installedRoot, { recursive: true });
    runRequired("/usr/bin/ditto", ["-x", "-k", zipPath, installedRoot], "archive extraction");
    const appPath = path.join(installedRoot, "Pige.app");
    const executablePath = path.join(appPath, "Contents/MacOS/Pige");
    if (!fs.statSync(executablePath).isFile()) {
      throw new Error("Downloaded release did not create the expected fresh application.");
    }

    verifyAdHocApplication(appPath);
    runRequired(
      "/usr/bin/xattr",
      ["-w", "com.apple.quarantine", "0081;00000000;PigeRelease;", appPath],
      "quarantine application"
    );
    runRequired(
      "/usr/bin/codesign",
      ["--verify", "--deep", "--strict", "--verbose=2", appPath],
      "quarantined signature verification"
    );
    const gatekeeper = assessExpectedUntrusted(appPath);
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
      buildReportSha256: checksumFile(buildReportPath),
      downloadedZipSha256: checksumFile(zipPath),
      downloadedZipBytes: fs.statSync(zipPath).size,
      freshInstall: true,
      signing: {
        status: "ad_hoc",
        trustedIdentity: false,
        notarized: false,
        strictDeepVerification: true,
        nestedHelperAdHoc: true,
        buildReportBound: buildReport.signing.distributionManifestMatch === true
      },
      gatekeeper,
      runtime: {
        pi: true,
        groundedHome: true,
        renderer: true,
        preload: true,
        health: true,
        requiredRuntimeModules: true
      },
      memory: runtime.memory,
      uiEvidence: {
        fileName: evidenceName,
        bytes: screenshot.byteLength,
        sha256: runtime.renderer.uiEvidence.sha256
      },
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

function readBuildReport(reportPath, expectedVersion, expectedZipSha256) {
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (
    report?.schemaVersion !== 1 || report?.platform !== "macos" || report?.arch !== "arm64" ||
    report?.packageKind !== "ad_hoc_zip" || report?.applicationIdentity?.appVersion !== expectedVersion ||
    report?.distributableSha256 !== expectedZipSha256 || report?.signing?.status !== "ad_hoc" ||
    report?.signing?.strictDeepVerification !== true || report?.signing?.noTeamIdentifier !== true ||
    report?.signing?.noDeveloperId !== true || report?.signing?.nestedHelperAdHoc !== true ||
    report?.signing?.distributionManifestMatch !== true || report?.signing?.postSealBundleWrites !== 0
  ) throw new Error("Downloaded macOS artifact does not match its bounded ad-hoc build report.");
  return report;
}

function verifyAdHocApplication(appPath) {
  runRequired(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", appPath],
    "application signature verification"
  );
  assertAdHocSignature(appPath);
  for (const helperName of NATIVE_HELPERS) {
    const helperPath = path.join(appPath, "Contents/Resources/native/macos/arm64", helperName);
    runRequired(
      "/usr/bin/codesign",
      ["--verify", "--strict", "--verbose=2", helperPath],
      "native helper signature verification"
    );
    assertAdHocSignature(helperPath);
  }
}

function assertAdHocSignature(targetPath) {
  const description = runRequired(
    "/usr/bin/codesign",
    ["--display", "--verbose=4", targetPath],
    "signature identity inspection"
  );
  const parsed = parseMacCodeSignatureDescription(description);
  if (!parsed.adHoc || parsed.teamIdentifierPresent || parsed.developerIdPresent || parsed.hardenedRuntime) {
    throw new Error("Downloaded macOS executable does not have the required ad-hoc identity.");
  }
}

function assessExpectedUntrusted(appPath) {
  const assessment = spawnSync(
    "/usr/sbin/spctl",
    ["--assess", "--type", "execute", "--verbose=4", appPath],
    commandOptions()
  );
  const output = `${assessment.stdout ?? ""}\n${assessment.stderr ?? ""}`;
  const classification = classifyMacGatekeeperAssessment(assessment, output);
  if (!classification.expectedUntrustedRejection || classification.invalidDiagnostic) {
    throw new Error("Gatekeeper did not classify the ad-hoc application as expected-untrusted and intact.");
  }
  return {
    classification: "expected_untrusted",
    invalidOrDamaged: false,
    userOverride: "system_settings_privacy_security_open_anyway"
  };
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
    const processTree = summarizeProcessTree(parseProcessTable(result.stdout), child.pid);
    peakResidentBytes = Math.max(peakResidentBytes, processTree.residentBytes);
    peakProcessCount = Math.max(peakProcessCount, processTree.processCount);
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
  if (status !== 0 || !fs.existsSync(reportPath)) {
    throw new Error("Downloaded macOS application runtime smoke failed.");
  }
  if (sampleCount === 0 || peakProcessCount === 0 || peakResidentBytes <= 0 || peakResidentBytes >= ORDINARY_MEMORY_CEILING_BYTES) {
    throw new Error("Downloaded macOS process-tree memory evidence is missing or exceeds the ordinary ceiling.");
  }
  const runtime = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  runtime.memory = { sampleCount, peakProcessCount, peakResidentBytes, ceilingBytes: ORDINARY_MEMORY_CEILING_BYTES };
  return runtime;
}

function runRequired(command, args, stage) {
  const result = spawnSync(command, args, commandOptions());
  if (result.error || result.status !== 0) throw new Error(`Downloaded macOS qualification failed at ${stage}.`);
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function commandOptions() {
  return {
    env: safeEnvironment({ LANG: "C", LC_ALL: "C" }),
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 1024 * 1024
  };
}

function checksumFile(filePath) {
  return `sha256:${createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function checksumJson(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function safeEnvironment(extra = {}) {
  return Object.fromEntries([
    ...["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SHELL", "USER", "LOGNAME"]
      .flatMap((name) => process.env[name] ? [[name, process.env[name]]] : []),
    ...Object.entries(extra)
  ]);
}

function parseOptions(args) {
  return Object.fromEntries(args.map((argument) => {
    const [key, ...value] = argument.replace(/^--/u, "").split("=");
    return [key === "build-report" ? "buildReport" : key, value.join("=")];
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await qualifyDownloadedMacos(parseOptions(process.argv.slice(2)));
  process.stdout.write("Downloaded ad-hoc macOS release qualification passed.\n");
}
