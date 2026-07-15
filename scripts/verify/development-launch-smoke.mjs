import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const STARTUP_TIMEOUT_MS = 60_000;
const PROBE_INTERVAL_MS = 150;
const DEVTOOLS_TIMEOUT_MS = 1_000;
const SECRET_ENVIRONMENT_KEY =
  /(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|CREDENTIAL|OPENAI|ANTHROPIC|DEEPSEEK|GEMINI|GOOGLE_API|CSC|APPLE_ID|APPLE_APP_SPECIFIC_PASSWORD|WIN_CSC)(?:_|$)/iu;
const ELECTRON_INSTALL_OVERRIDE_KEY =
  /^(?:ELECTRON_|electron_|npm_config_electron_|NPM_CONFIG_ELECTRON_|npm_package_config_electron_)/u;
const ELECTRON_INSTALL_PLATFORM_OVERRIDE_KEYS = new Set(["force_no_cache", "npm_config_arch", "npm_config_platform"]);
const CI_NO_SANDBOX_CONTROL = "PIGE_DEVELOPMENT_SMOKE_NO_SANDBOX";

export function createDevelopmentLaunchEnvironment(environment, port, userDataPath, options = {}) {
  const sanitized = {};
  for (const [key, value] of Object.entries(environment)) {
    const authorityKey = key.toUpperCase();
    if (
      value !== undefined &&
      authorityKey !== "NO_SANDBOX" &&
      authorityKey !== CI_NO_SANDBOX_CONTROL &&
      !SECRET_ENVIRONMENT_KEY.test(key) &&
      !ELECTRON_INSTALL_OVERRIDE_KEY.test(key) &&
      !ELECTRON_INSTALL_PLATFORM_OVERRIDE_KEYS.has(key)
    ) {
      sanitized[key] = value;
    }
  }
  sanitized.REMOTE_DEBUGGING_PORT = String(port);
  sanitized.ELECTRON_CLI_ARGS = JSON.stringify([`--user-data-dir=${userDataPath}`]);
  if (options.allowNoSandbox === true) sanitized.NO_SANDBOX = "1";
  return sanitized;
}

export function shouldAllowDevelopmentSmokeNoSandbox(platform, environment) {
  return platform === "linux" &&
    environment.CI === "true" &&
    environment.GITHUB_ACTIONS === "true" &&
    environment[CI_NO_SANDBOX_CONTROL] === "1";
}

export function isDevelopmentRendererTarget(target) {
  return Boolean(
    target &&
      target.type === "page" &&
      typeof target.url === "string" &&
      /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//u.test(target.url) &&
      typeof target.webSocketDebuggerUrl === "string" &&
      /^ws:\/\/127\.0\.0\.1:\d+\//u.test(target.webSocketDebuggerUrl)
  );
}

export async function runDevelopmentLaunchSmoke(options = {}) {
  let child;
  let temporaryRoot;
  let ready = false;
  let failureStage = "launcher_error";
  let launchFailed = false;

  try {
    const root = options.root ?? process.cwd();
    const port = options.port ?? await (options.reservePort ?? reserveLoopbackPort)();
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-development-launch-"));
    const userDataPath = path.join(temporaryRoot, "user-data");
    fs.mkdirSync(userDataPath, { mode: 0o700 });
    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const allowNoSandbox = shouldAllowDevelopmentSmokeNoSandbox(process.platform, process.env);
    child = spawn(command, ["run", "dev"], {
      cwd: root,
      env: createDevelopmentLaunchEnvironment(process.env, port, userDataPath, { allowNoSandbox }),
      detached: process.platform !== "win32",
      stdio: "ignore",
      windowsHide: true
    });
    child.once("error", () => {
      launchFailed = true;
      failureStage = "launcher_error";
    });

    failureStage = "startup_timeout";
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (launchFailed) break;
      if (child.exitCode !== null || child.signalCode !== null) {
        failureStage = "launcher_exited";
        break;
      }
      const targets = await readDevToolsTargets(port);
      for (const target of targets.filter(isDevelopmentRendererTarget)) {
        failureStage = "renderer_not_ready";
        if (await rendererAndPreloadAreReady(target.webSocketDebuggerUrl)) {
          ready = true;
          break;
        }
      }
      if (ready) break;
      await delay(PROBE_INTERVAL_MS);
    }
  } catch {
    ready = false;
  }

  try {
    if (child) await terminateProcessTree(child);
    if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
  } catch {
    ready = false;
    failureStage = "launcher_error";
  }

  if (!ready) options.onFailureStage?.(failureStage);
  return ready;
}

async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === "string") throw new Error("Development launch port unavailable.");
  return address.port;
}

async function readDevToolsTargets(port) {
  return new Promise((resolve) => {
    const request = http.get(
      { hostname: "127.0.0.1", port, path: "/json/list", timeout: DEVTOOLS_TIMEOUT_MS },
      (response) => {
        let serialized = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          if (serialized.length <= 64_000) serialized += chunk;
        });
        response.on("end", () => {
          try {
            const parsed = JSON.parse(serialized);
            resolve(Array.isArray(parsed) ? parsed : []);
          } catch {
            resolve([]);
          }
        });
      }
    );
    request.once("timeout", () => request.destroy());
    request.once("error", () => resolve([]));
  });
}

async function rendererAndPreloadAreReady(webSocketUrl) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = new WebSocket(webSocketUrl);
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      resolve(ready);
    };
    const timeout = setTimeout(() => finish(false), DEVTOOLS_TIMEOUT_MS);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression:
            '(async()=>{const root=document.querySelector("#root");const api=globalThis.pige;if(!root||root.childElementCount<1||!api||typeof api.getHealth!=="function")return false;const health=await api.getHealth();return health?.status==="ok"})()',
          awaitPromise: true,
          returnByValue: true
        }
      }));
    });
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.id === 1) finish(message.result?.result?.value === true);
      } catch {
        finish(false);
      }
    });
    socket.addEventListener("error", () => finish(false));
  });
}

export async function terminateProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // The launcher may already be gone while descendants still share its process group.
  }
  if (await waitForProcessGroupExit(child.pid, 1_000)) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // The process group exited after SIGTERM.
  }
  await waitForProcessGroupExit(child.pid, 1_000);
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(-pid, 0);
    } catch {
      return true;
    }
    await delay(25);
  }
  return false;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  let failureStage = "launcher_error";
  try {
    const ready = await runDevelopmentLaunchSmoke({
      onFailureStage(stage) {
        failureStage = stage;
      }
    });
    if (!ready) throw new Error("not ready");
    console.log("Development Electron launch OK.");
  } catch {
    console.error(`Development Electron launch smoke failed: ${failureStage}.`);
    process.exitCode = 1;
  }
}
