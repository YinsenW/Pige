import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractAll, listPackage } from "@electron/asar";
import {
  assertPackageabilityHost,
  canonicalizeAsarEntryPath,
  findDistributableNames,
  packageabilityPaths,
  resolvePackageabilityPlatform
} from "./packageability-platforms.mjs";

const root = process.cwd();
const options = parseOptions(process.argv.slice(2));
const target = resolvePackageabilityPlatform(options.platform, options.arch);
assertPackageabilityHost(target);
const buildId = resolveBuildId(process.env.PIGE_REPORT_BUILD_ID ?? "local");
const { outputRoot, appPath, executablePath, resourcesPath, asarPath, reportPath } = packageabilityPaths(
  root,
  target,
  buildId
);
const distributablePaths = fs.existsSync(outputRoot)
  ? findDistributableNames(fs.readdirSync(outputRoot), target).map((name) => path.join(outputRoot, name))
  : [];
if (distributablePaths.length !== 1) {
  throw new Error(`Expected exactly one ${target.platform}-${target.arch} packageability artifact.`);
}
const distributablePath = distributablePaths[0];
const distributableBytes = fs.statSync(distributablePath).size;
if (distributableBytes > 330_000_000) {
  throw new Error(`Packaged artifact exceeds the 330000000-byte ceiling: ${distributableBytes}.`);
}
const requiredEntries = [
  "/out/main/index.js",
  "/out/main/pi-agent-runtime-smoke.js",
  "/out/main/workers/local-database-rebuild-worker.js",
  "/out/main/workers/office-parser-worker.js",
  "/out/main/workers/pdf-page-renderer-worker.js",
  "/out/main/workers/pdf-parser-worker.js",
  "/out/main/workers/web-extractor-worker.js",
  "/out/preload/index.cjs",
  "/out/renderer/index.html",
  "/node_modules/@earendil-works/pi-agent-core/package.json",
  "/node_modules/@earendil-works/pi-ai/package.json",
  "/package.json"
];

for (const requiredPath of [
  executablePath,
  asarPath,
  path.join(resourcesPath, "LICENSE"),
  path.join(resourcesPath, "NOTICE"),
  path.join(resourcesPath, "licenses/pi-MIT.txt"),
  path.join(resourcesPath, "toolchain-manifest/toolchain.manifest.json"),
  path.join(resourcesPath, "release/package-resource-manifest.json"),
  path.join(resourcesPath, "release/legal/third-party-attribution.json"),
  path.join(resourcesPath, "release/sbom/pige.cdx.json"),
  ...target.requiredResourceFiles.map((relativePath) => path.join(resourcesPath, relativePath))
]) {
  if (!fs.statSync(requiredPath).isFile()) throw new Error(`Missing packaged file: ${path.basename(requiredPath)}`);
}

const entries = new Set(listPackage(asarPath).map(canonicalizeAsarEntryPath));
for (const entry of requiredEntries) {
  if (!entries.has(entry)) throw new Error(`Missing packaged ASAR entry: ${entry}`);
}

const packageResources = verifyPackageResources(path.join(resourcesPath, "release"), target);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-packaged-smoke-"));
try {
  const extractedRoot = path.join(tempRoot, "app");
  extractAll(asarPath, extractedRoot);
  const unpackedRoot = `${asarPath}.unpacked`;
  if (fs.existsSync(unpackedRoot)) fs.cpSync(unpackedRoot, extractedRoot, { recursive: true, force: true });

  const packagedRuntimeResult = runPackagedPiSmoke({ executablePath, tempRoot, target });
  const applicationIdentity = readApplicationIdentity({
    target,
    appPath,
    runtimeIdentity: packagedRuntimeResult.runtimeIdentity
  });
  runNodeSmoke("scripts/verify/parser-worker-smoke.mjs", {
    PIGE_BUILT_APP_ROOT: extractedRoot
  });
  runNodeSmoke("scripts/verify/local-database-rebuild-worker-smoke.mjs", {
    PIGE_BUILT_APP_ROOT: extractedRoot
  });
  if (target.nativeSmokeScript) {
    runNodeSmoke(target.nativeSmokeScript, {
      PIGE_PACKAGED_RESOURCES_PATH: resourcesPath,
      PIGE_SMOKE_ARTIFACT_ROOT: path.join(tempRoot, "ocr-artifacts")
    });
  }
  const { toolchainManifest, ...mainPreloadRenderer } = packagedRuntimeResult.renderer;

  const report = {
    schemaVersion: 1,
    buildId,
    platform: target.platform,
    arch: target.arch,
    packageKind: target.packageKind,
    applicationIdentity,
    appRelativePath: path.relative(root, appPath).replaceAll(path.sep, "/"),
    distributableRelativePath: path.relative(root, distributablePath).replaceAll(path.sep, "/"),
    distributableBytes,
    distributableSha256: checksumFile(distributablePath),
    distributableCeilingBytes: 330_000_000,
    appBytes: directorySize(appPath),
    asarBytes: fs.statSync(asarPath).size,
    asarSha256: checksumFile(asarPath),
    requiredAsarEntries: requiredEntries,
    checks: {
      mainPreloadRenderer,
      embeddedPi: packagedRuntimeResult.pi,
      parserWorkers: true,
      indexWorker: true,
      platformNativeOcr: target.platform === "macos",
      licenseNoticeResources: true,
      packageResources,
      toolchainManifest
    },
    signing: target.platform === "macos"
      ? { status: "unsigned", notarized: false }
      : { status: "unsigned", codeSigned: false }
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const serializedReport = `${JSON.stringify(report, null, 2)}\n`;
  if (serializedReport.includes(root) || /(?:\/Users\/|[A-Za-z]:\\Users\\|Authorization\s*:|Bearer\s+\S+)/iu.test(serializedReport)) {
    throw new Error("Packaged smoke report contains a private path or credential-shaped value.");
  }
  fs.writeFileSync(reportPath, serializedReport, "utf8");
  console.log(
    `Packaged Electron smoke OK: ${target.platform}-${target.arch} artifact ${report.distributableBytes} bytes, ` +
    "renderer/preload IPC ready, Pi and worker loops loaded."
  );
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function runPackagedPiSmoke({ executablePath, tempRoot, target }) {
  const reportPath = path.join(tempRoot, "pi-smoke.json");
  const result = spawnSync(executablePath, [
    `--pige-packaged-runtime-smoke-report=${reportPath}`,
    `--user-data-dir=${path.join(tempRoot, "pi-user-data")}`,
    "--disable-gpu"
  ], {
    cwd: tempRoot,
    env: safeEnvironment(),
    encoding: "utf8",
    timeout: target.packagedRuntimeSmokeTimeoutMs,
    maxBuffer: 1024 * 1024
  });
  const report = readPackagedRuntimeSmokeReport(reportPath);
  if (result.status !== 0 || report?.status !== "passed") {
    const stage = isPackagedRuntimeSmokeFailure(report?.failure) ? report.failure.stage : "report_unavailable";
    const checks = isPackagedRuntimeSmokeFailure(report?.failure) ? report.failure.checks : undefined;
    throw new Error(
      `Packaged Pi smoke failed with status ${String(result.status)} at ${stage}` +
      `${checks ? ` (${JSON.stringify(checks)})` : ""}.`
    );
  }
  if (
    report.schemaVersion !== 1 ||
    report.runtimeIdentity?.appName !== "Pige" ||
    report.runtimeIdentity?.appVersion !== "0.0.0" ||
    report.runtimeIdentity?.isPackaged !== true ||
    report.pi?.adapterMode !== "embedded_pi_sdk" ||
    report.pi?.modelId !== "pi-smoke-model" ||
    report.pi?.publicationCount !== 1 ||
    JSON.stringify(report.pi?.invokedTools) !== JSON.stringify(["pige_inspect_source", "pige_create_knowledge_note"]) ||
    report.home?.state !== "completed" ||
    report.home?.answerMode !== "model_grounded" ||
    report.home?.citationCount !== 1 ||
    report.renderer?.title !== "Pige" ||
    report.renderer?.rootReady !== true ||
    report.renderer?.preloadReady !== true ||
    report.renderer?.healthReady !== true ||
    report.renderer?.toolchainManifest?.requiredRuntimeModulesReady !== true ||
    !Array.isArray(report.renderer?.toolchainManifest?.missingBundledToolIds) ||
    !report.renderer.toolchainManifest.missingBundledToolIds.every((id) => typeof id === "string")
  ) {
    throw new Error("Packaged Pi smoke returned an invalid bounded result.");
  }
  return {
    runtimeIdentity: report.runtimeIdentity,
    pi: {
      adapterMode: report.pi.adapterMode,
      modelId: report.pi.modelId,
      invokedTools: report.pi.invokedTools,
      homeAnswerMode: report.home.answerMode,
      homeCitationCount: report.home.citationCount
    },
    renderer: report.renderer
  };
}

function readPackagedRuntimeSmokeReport(reportPath) {
  if (!fs.existsSync(reportPath)) return undefined;
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    return report && typeof report === "object" ? report : undefined;
  } catch {
    return undefined;
  }
}

function isPackagedRuntimeSmokeFailure(failure) {
  const allowedStages = new Set([
    "runtime_import", "pi_runtime", "home_runtime", "renderer_window",
    "renderer_load", "renderer_probe", "report_write"
  ]);
  if (!failure || typeof failure !== "object" || !allowedStages.has(failure.stage)) return false;
  if (failure.checks === undefined) return true;
  const checks = failure.checks;
  const booleanKeys = [
    "titleReady", "rootReady", "preloadReady", "healthReady", "requiredRuntimeModulesReady"
  ];
  return booleanKeys.every((key) => typeof checks[key] === "boolean") &&
    Array.isArray(checks.missingRequiredRuntimeModuleIds) &&
    checks.missingRequiredRuntimeModuleIds.every((id) => typeof id === "string" && id.length <= 80);
}

function runNodeSmoke(scriptPath, extraEnvironment) {
  const result = spawnSync(process.execPath, [path.join(root, scriptPath)], {
    cwd: root,
    env: safeEnvironment(extraEnvironment),
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(`${path.basename(scriptPath)} failed with status ${String(result.status)}.`);
}

function readApplicationIdentity({ target, appPath, runtimeIdentity }) {
  if (target.platform === "macos") {
    const infoPlistPath = path.join(appPath, "Contents/Info.plist");
    const appName = readPlistValue(infoPlistPath, "CFBundleName");
    const appId = readPlistValue(infoPlistPath, "CFBundleIdentifier");
    if (appName !== "Pige" || appId !== "com.yinsenw.pige") {
      throw new Error("Packaged macOS application identity does not match the reviewed preflight identity.");
    }
    return { appName, appId };
  }
  if (
    runtimeIdentity?.appName !== "Pige" ||
    runtimeIdentity?.appVersion !== "0.0.0" ||
    runtimeIdentity?.isPackaged !== true
  ) {
    throw new Error("Packaged Windows runtime identity does not match the reviewed preflight identity.");
  }
  return {
    appName: runtimeIdentity.appName,
    appVersion: runtimeIdentity.appVersion,
    isPackaged: true
  };
}

function readPlistValue(plistPath, key) {
  const result = spawnSync("/usr/bin/plutil", ["-extract", key, "raw", plistPath], {
    encoding: "utf8",
    timeout: 10_000
  });
  if (result.status !== 0) throw new Error(`Unable to read packaged Info.plist key ${key}.`);
  return result.stdout.trim();
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

function directorySize(directoryPath) {
  let total = 0;
  const pending = [directoryPath];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile()) total += fs.statSync(absolute).size;
    }
  }
  return total;
}

function checksumFile(filePath) {
  return `sha256:${createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function verifyPackageResources(releaseResourcesPath, target) {
  const manifest = JSON.parse(fs.readFileSync(path.join(releaseResourcesPath, "package-resource-manifest.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.platform !== target.platform || manifest.arch !== target.arch) {
    throw new Error("Packaged resource manifest has the wrong platform binding.");
  }
  for (const file of manifest.files ?? []) {
    const filePath = path.resolve(releaseResourcesPath, file.path);
    const relativePath = path.relative(releaseResourcesPath, filePath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) throw new Error("Packaged resource manifest escapes its root.");
    if (fs.statSync(filePath).size !== file.bytes || checksumFile(filePath) !== file.sha256) {
      throw new Error(`Packaged release resource failed integrity verification: ${file.path}`);
    }
  }
  const sbom = JSON.parse(fs.readFileSync(path.join(releaseResourcesPath, "sbom/pige.cdx.json"), "utf8"));
  const componentNames = new Set((sbom.components ?? []).map((component) =>
    component.group ? `${component.group}/${component.name}` : component.name
  ));
  for (const name of [
    "electron", "@earendil-works/pi-agent-core", "@earendil-works/pi-ai", "pdfjs-dist",
    "@napi-rs/canvas", "mammoth", "fast-xml-parser", "@mozilla/readability", "jsdom", "undici",
    ...target.requiredSbomComponents
  ]) {
    if (!componentNames.has(name)) throw new Error(`Packaged SBOM is missing ${name}.`);
  }
  return {
    packageCount: manifest.packageCount,
    attributedFileCount: manifest.files.length,
    sbomComponentCount: sbom.components.length
  };
}

function parseOptions(args) {
  const options = Object.fromEntries(args.map((argument) => {
    const [key, value] = argument.replace(/^--/u, "").split("=", 2);
    return [key, value];
  }));
  return { platform: options.platform, arch: options.arch };
}

function resolveBuildId(value) {
  if (!/^[A-Za-z0-9._-]{1,80}$/u.test(value)) throw new Error("PIGE_REPORT_BUILD_ID is invalid.");
  return value;
}
