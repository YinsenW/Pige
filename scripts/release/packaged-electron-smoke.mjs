import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { extractAll, listPackage } from "@electron/asar";
import {
  assertPackageabilityHost,
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

const entries = new Set(listPackage(asarPath));
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

  const piResult = runPackagedPiSmoke({ executablePath, tempRoot });
  const applicationIdentity = readApplicationIdentity({
    target,
    appPath,
    runtimeIdentity: piResult.runtimeIdentity
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
  const rendererResult = await runRendererPreloadSmoke({ executablePath, tempRoot });
  const { toolchainManifest, ...mainPreloadRenderer } = rendererResult;

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
      embeddedPi: piResult,
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

function runPackagedPiSmoke({ executablePath, tempRoot }) {
  const reportPath = path.join(tempRoot, "pi-smoke.json");
  const result = spawnSync(executablePath, [
    `--pige-packaged-runtime-smoke-report=${reportPath}`,
    `--user-data-dir=${path.join(tempRoot, "pi-user-data")}`,
    "--disable-gpu"
  ], {
    cwd: tempRoot,
    env: safeEnvironment(),
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 1024 * 1024
  });
  if (result.status !== 0 || !fs.existsSync(reportPath)) {
    throw new Error(`Packaged Pi smoke failed with status ${String(result.status)}.`);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (
    report.runtimeIdentity?.appName !== "Pige" ||
    report.runtimeIdentity?.appVersion !== "0.0.0" ||
    report.runtimeIdentity?.isPackaged !== true ||
    report.pi?.adapterMode !== "embedded_pi_sdk" ||
    report.pi?.modelId !== "pi-smoke-model" ||
    report.pi?.publicationCount !== 1 ||
    JSON.stringify(report.pi?.invokedTools) !== JSON.stringify(["pige_inspect_source", "pige_create_knowledge_note"]) ||
    report.home?.state !== "completed" ||
    report.home?.answerMode !== "model_grounded" ||
    report.home?.citationCount !== 1
  ) {
    throw new Error("Packaged Pi smoke returned an invalid bounded result.");
  }
  return {
    runtimeIdentity: report.runtimeIdentity,
    adapterMode: report.pi.adapterMode,
    modelId: report.pi.modelId,
    invokedTools: report.pi.invokedTools,
    homeAnswerMode: report.home.answerMode,
    homeCitationCount: report.home.citationCount
  };
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

async function runRendererPreloadSmoke({ executablePath, tempRoot }) {
  const port = await reservePort();
  const child = spawn(executablePath, [
    `--user-data-dir=${path.join(tempRoot, "user-data")}`,
    `--remote-debugging-port=${port}`,
    "--disable-gpu"
  ], {
    cwd: tempRoot,
    env: safeEnvironment(),
    stdio: "ignore"
  });
  try {
    const target = await waitForRendererTarget(port, child);
    const value = await waitForRendererState(target.webSocketDebuggerUrl);
    if (
      value?.title !== "Pige" ||
      value?.rootReady !== true ||
      value?.preloadReady !== true ||
      !value?.health ||
      typeof value.health !== "object" ||
      value?.toolchain?.requiredRuntimeModulesReady !== true
    ) {
      const safeState = {
        title: typeof value?.title === "string" ? value.title : null,
        rootReady: value?.rootReady === true,
        preloadReady: value?.preloadReady === true,
        healthType: value?.health === null ? "null" : typeof value?.health,
        healthStatus: value?.health?.status === "ok" ? "ok" : "not_ok",
        requiredRuntimeModulesReady: value?.toolchain?.requiredRuntimeModulesReady === true,
        runtimeModuleStatuses: value?.toolchain?.runtimeModuleStatuses ?? null
      };
      throw new Error(`Packaged renderer or preload IPC did not reach its bounded ready state: ${JSON.stringify(safeState)}`);
    }
    return {
      title: value.title,
      rootReady: true,
      preloadReady: true,
      healthReady: true,
      toolchainManifest: {
        requiredRuntimeModulesReady: true,
        missingBundledToolIds: value.toolchain.missingBundledToolIds
      }
    };
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child, 5_000);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

async function waitForRendererState(webSocketUrl) {
  const expression = `
      (async () => {
        const toolchain = await window.pige?.system?.toolchainHealth?.();
        const requiredRuntimeModuleIds = [
          "pdf-parser", "pdf-parser-runtime", "office-docx-parser", "office-openxml-parser",
          "office-archive-runtime", "web-readability-parser", "web-dom-runtime", "web-fetch-runtime"
        ];
        const statuses = new Map((toolchain?.tools ?? []).map((tool) => [tool.id, tool.status]));
        return {
          title: document.title,
          rootReady: Boolean(document.querySelector("#root")),
          preloadReady: typeof window.pige?.getHealth === "function",
          health: await window.pige?.getHealth?.(),
          toolchain: {
            requiredRuntimeModulesReady: requiredRuntimeModuleIds.every((id) => statuses.get(id) === "ready"),
            runtimeModuleStatuses: Object.fromEntries(requiredRuntimeModuleIds.map((id) => [id, statuses.get(id) ?? "absent"])),
            missingBundledToolIds: ["git", "bun", "uv"].filter((id) => statuses.get(id) === "missing")
          }
        };
      })()
  `;
  const deadline = Date.now() + 15_000;
  let value;
  while (Date.now() < deadline) {
    value = await evaluateTarget(webSocketUrl, expression);
    if (
      value?.title === "Pige" &&
      value?.rootReady === true &&
      value?.preloadReady === true &&
      value?.health?.status === "ok" &&
      value?.toolchain?.requiredRuntimeModulesReady === true
    ) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return value;
}

async function waitForRendererTarget(port, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Packaged app exited before its renderer became available.");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
        if (target) return target;
      }
    } catch {
      // The local DevTools endpoint is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the packaged renderer target.");
}

function evaluateTarget(webSocketUrl, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Packaged renderer evaluation timed out."));
    }, 15_000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true }
      }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error || message.result?.exceptionDetails) {
        reject(new Error("Packaged renderer evaluation failed."));
        return;
      }
      resolve(message.result?.result?.value);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Packaged renderer DevTools connection failed."));
    });
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
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
