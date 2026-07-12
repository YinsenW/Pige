import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const desktopRoot = path.resolve(path.dirname(scriptPath), "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const DIRECT_PROMPT = "Reply briefly that the Pige manual provider canary is available.";
const GROUNDING_PROMPT = "What is the roundtrip launch phrase in my local knowledge?";
const MAX_CHILD_MS = 120_000;

if (process.versions.electron) {
  setTimeout(() => {
    void runElectronPhase();
  }, 0);
} else {
  await runOrchestrator();
}

async function runOrchestrator() {
  const userDataPath = requireEnv("PIGE_MANUAL_ACCEPTANCE_USER_DATA");
  const resolvedUserDataPath = path.resolve(userDataPath);
  if (!resolvedUserDataPath.includes(`${path.sep}Pige Manual Acceptance${path.sep}`)) {
    throw new Error("Manual provider canary requires a dedicated Pige Manual Acceptance userData path.");
  }
  if (!fs.existsSync(resolvedUserDataPath)) {
    throw new Error("Manual provider canary userData does not exist.");
  }

  const initial = await runChild("initial", resolvedUserDataPath);
  const reopened = await runChild("reopen", resolvedUserDataPath);

  assert.equal(initial.bindingState, "ready");
  assert.equal(initial.runtimeState, "ready");
  assert.equal(initial.responseVisible, true);
  assert.equal(initial.cloudIndicatorVisible, true);
  assert.equal(reopened.bindingState, "ready");
  assert.equal(reopened.runtimeState, "ready");
  assert.equal(reopened.providerProfileId, initial.providerProfileId);
  assert.equal(reopened.modelProfileId, initial.modelProfileId);
  assert.equal(reopened.endpointProtocol, initial.endpointProtocol);
  assert.equal(reopened.responseVisible, true);
  assert.equal(reopened.cloudIndicatorVisible, true);
  assert.ok(reopened.citationCount > 0);

  console.log(JSON.stringify({
    status: "passed",
    providerProfileId: initial.providerProfileId,
    modelProfileId: initial.modelProfileId,
    modelId: initial.modelId,
    endpointProtocol: initial.endpointProtocol,
    secretBinding: "present",
    initial: {
      runtimeState: initial.runtimeState,
      resultVisible: initial.responseVisible,
      modelUsage: initial.cloudIndicatorVisible ? "cloud" : "none"
    },
    reopened: {
      runtimeState: reopened.runtimeState,
      resultVisible: reopened.responseVisible,
      modelUsage: reopened.cloudIndicatorVisible ? "cloud" : "none",
      citationCount: reopened.citationCount
    }
  }));
}

async function runChild(phase, userDataPath) {
  const resultPath = path.join(os.tmpdir(), `pige-manual-provider-canary-${process.pid}-${phase}.json`);
  const electronPath = resolveElectronPath();
  const child = spawn(electronPath, [scriptPath, `--phase=${phase}`], {
    cwd: desktopRoot,
    env: safeChildEnvironment({
      PIGE_MANUAL_ACCEPTANCE_USER_DATA: userDataPath,
      PIGE_MANUAL_ACCEPTANCE_RESULT: resultPath
    }),
    stdio: "ignore"
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), MAX_CHILD_MS);
  const exitCode = await new Promise((resolve) => child.once("exit", (code) => resolve(code ?? 1)));
  clearTimeout(timeout);
  try {
    if (exitCode !== 0 || !fs.existsSync(resultPath)) {
      throw new Error(`Persisted provider ${phase} canary failed.`);
    }
    const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    if (result.status !== "passed") throw new Error(`Persisted provider ${phase} canary failed.`);
    return result;
  } finally {
    fs.rmSync(resultPath, { force: true });
  }
}

async function runElectronPhase() {
  const phase = process.argv.find((value) => value.startsWith("--phase="))?.slice("--phase=".length);
  const userDataPath = requireEnv("PIGE_MANUAL_ACCEPTANCE_USER_DATA");
  const resultPath = requireEnv("PIGE_MANUAL_ACCEPTANCE_RESULT");
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", userDataPath);
  app.setPath("sessionData", path.join(userDataPath, "session"));
  app.commandLine.appendSwitch("disable-gpu");
  let stage = "prepare";
  let browserWindow;

  try {
    if (phase !== "initial" && phase !== "reopen") throw new Error("Unknown manual provider canary phase.");
    stage = "main_import";
    await import("../out/main/index.js");
    stage = "app_ready";
    await app.whenReady();
    browserWindow = await waitForMainWindow(BrowserWindow);
    stage = "renderer_load";
    await waitForRenderer(browserWindow);
    stage = phase === "initial" ? "direct_turn" : "grounded_turn";
    const result = await runRendererCanary(browserWindow, phase);
    fs.writeFileSync(resultPath, `${JSON.stringify({ status: "passed", ...result })}\n`, "utf8");
    browserWindow.destroy();
    app.quit();
  } catch {
    fs.writeFileSync(resultPath, `${JSON.stringify({ status: "failed", stage })}\n`, "utf8");
    app.exit(1);
  }
}

async function runRendererCanary(browserWindow, phase) {
  return browserWindow.webContents.executeJavaScript(`
    (async () => {
      const waitFor = async (predicate, label, timeoutMs = 90000) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const value = await predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error("Timed out waiting for " + label);
      };
      const openNavigation = async () => {
        if (document.querySelectorAll("button.nav-item").length >= 4) return;
        const toggle = await waitFor(() => document.querySelector("button.icon-button"), "sidebar toggle");
        toggle.click();
        await waitFor(() => document.querySelectorAll("button.nav-item").length >= 4, "sidebar navigation");
      };
      const clickNavigation = async (index) => {
        await openNavigation();
        const button = document.querySelectorAll("button.nav-item")[index];
        if (!button) throw new Error("Navigation target is unavailable.");
        button.click();
      };
      const setValue = (element, value) => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
        descriptor.set.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };

      await waitFor(() => window.pige, "preload bridge");
      const summary = await waitFor(async () => {
        const value = await window.pige.models.summary();
        return value.defaultBinding.state === "ready" ? value : undefined;
      }, "persisted provider binding");
      const runtimeStatus = await window.pige.agent.runtimeStatus();
      if (runtimeStatus.state !== "ready") throw new Error("Persisted runtime is not ready.");
      const model = summary.models.find((candidate) => candidate.id === summary.defaultBinding.modelProfileId);
      const provider = summary.providers.find((candidate) => candidate.id === summary.defaultBinding.providerProfileId);
      if (!provider || !model || !model.enabled) throw new Error("Persisted Global Default binding is incomplete.");

      await clickNavigation(3);
      const defaultSelect = await waitFor(() => document.querySelector("#global-default-model"), "Global Default selector");
      if (defaultSelect.value !== model.id) throw new Error("Visible Global Default does not match runtime binding.");
      const selectedOption = defaultSelect.selectedOptions[0];
      if (selectedOption?.parentElement?.tagName !== "OPTGROUP") {
        throw new Error("Global Default is not grouped under its provider.");
      }

      await clickNavigation(0);
      const composer = await waitFor(() => document.querySelector(".composer textarea"), "Home composer");
      setValue(composer, ${JSON.stringify(phase === "initial" ? DIRECT_PROMPT : GROUNDING_PROMPT)});
      const send = await waitFor(
        () => document.querySelector(".composer .toolbar button:last-child:not(:disabled)"),
        "Home send button"
      );
      send.click();
      await waitFor(() => document.querySelector(".agent-run-state.state-completed"), "completed Home turn");
      const answerNode = await waitFor(() => document.querySelector(".retrieval-answer"), "visible Home result");
      const responseVisible = (answerNode.textContent?.trim().length ?? 0) > 0;
      const cloudIndicatorVisible = document.querySelector(
        ".agent-cloud-boundary, .retrieval-cloud-boundary"
      ) !== null;
      const citationCount = document.querySelectorAll(".retrieval-citations button").length;
      if (!responseVisible || !cloudIndicatorVisible) throw new Error("Home result is not visibly model-backed.");
      if (${JSON.stringify(phase)} === "reopen" && citationCount === 0) {
        throw new Error("Restarted local-knowledge turn produced no visible citation.");
      }

      return {
        bindingState: summary.defaultBinding.state,
        runtimeState: runtimeStatus.state,
        providerProfileId: provider.id,
        modelProfileId: model.id,
        modelId: model.modelId,
        endpointProtocol: provider.endpointProtocol,
        responseVisible,
        cloudIndicatorVisible,
        citationCount
      };
    })()
  `, true);
}

async function waitForMainWindow(BrowserWindow) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) return window;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Pige main window did not open.");
}

async function waitForRenderer(browserWindow) {
  if (!browserWindow.webContents.isLoading()) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Pige renderer did not load.")), 30_000);
    browserWindow.webContents.once("did-finish-load", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function resolveElectronPath() {
  if (process.platform === "darwin") {
    return path.join(repoRoot, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
  }
  if (process.platform === "win32") {
    return path.join(repoRoot, "node_modules/electron/dist/electron.exe");
  }
  return path.join(repoRoot, "node_modules/electron/dist/electron");
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function safeChildEnvironment(extra) {
  const names = [
    "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE", "SHELL",
    "USER", "LOGNAME", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS",
    "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"
  ];
  return Object.fromEntries([
    ...names.flatMap((name) => process.env[name] ? [[name, process.env[name]]] : []),
    ...Object.entries(extra)
  ]);
}
