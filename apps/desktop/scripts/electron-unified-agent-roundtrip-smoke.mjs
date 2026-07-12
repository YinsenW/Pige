import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const desktopRoot = path.resolve(path.dirname(scriptPath), "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const MODEL_ID = "pige-roundtrip-model";
const PROVIDER_NAME = "Roundtrip Responses";
const DIRECT_PROMPT = "Reply directly with the roundtrip greeting.";
const GROUNDING_PROMPT = "What is the roundtrip launch phrase in my local knowledge?";
const DIRECT_ANSWER = "The real Pi roundtrip is ready.";
const GROUNDED_ANSWER = "The roundtrip launch phrase is heliotrope seven. [1]";
const SOURCE_PROMPT = "Inspect this attachment and answer without creating a note.";
const SOURCE_ANSWER = "The preserved attachment is available to the unified Agent.";
const CHILD_RESULT_PREFIX = "PIGE_ROUNDTRIP_RESULT ";
const MAX_CHILD_MS = 90_000;

if (process.versions.electron) {
  setTimeout(() => {
    void runElectronPhase();
  }, 0);
} else {
  await runOrchestrator();
}

async function runOrchestrator() {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-unified-roundtrip-"));
  const userDataPath = path.join(rootPath, "user-data");
  const attachmentPath = path.join(rootPath, "unified-agent-source.txt");
  fs.writeFileSync(attachmentPath, "Synthetic unified Agent attachment evidence.\n", "utf8");
  const syntheticToken = `synthetic-${crypto.randomBytes(24).toString("hex")}`;
  const requests = [];
  const server = await startProviderServer(requests);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Loopback provider did not bind safely.");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  try {
    const connect = await runChild("connect", { rootPath, userDataPath, baseUrl, syntheticToken, attachmentPath });
    const reopen = await runChild("reopen", { rootPath, userDataPath, baseUrl, syntheticToken, attachmentPath });

    assert.equal(connect.bindingState, "ready");
    assert.equal(connect.modelUsage, "local");
    assert.equal(connect.providerFormSubmitted, true);
    assert.equal(connect.secretFieldCleared, true);
    assert.equal(connect.defaultProviderLabel, PROVIDER_NAME);
    assert.equal(connect.defaultModelLabel, MODEL_ID);
    assert.equal(connect.directVisible, true);
    assert.equal(connect.groundedVisible, true);
    assert.equal(connect.citationVisible, true);
    assert.equal(connect.sourceVisible, true);
    assert.equal(reopen.bindingState, "ready");
    assert.equal(reopen.runtimeState, "ready");
    assert.equal(reopen.providerProfileId, connect.providerProfileId);
    assert.equal(reopen.modelProfileId, connect.modelProfileId);
    assert.equal(reopen.providerVisible, true);
    assert.equal(reopen.directVisible, true);

    assert.equal(requests.filter((request) => request.method === "GET" && request.path === "/v1/models").length, 2);
    assert.ok(requests.filter((request) => request.method === "POST" && request.path === "/v1/responses").length >= 7);
    assert.ok(requests.every((request) => request.authorization === `Bearer ${syntheticToken}`));
    assert.ok(requests.every((request) => !request.body.includes(syntheticToken)));
    assert.ok(requests.some((request) => request.body.includes('"name":"pige_provider_probe"')));
    assert.ok(requests.some((request) => request.body.includes('"name":"pige_search_knowledge"')));
    assert.ok(requests.some((request) => request.body.includes('"name":"pige_finish_home_turn"')));
    assert.ok(requests.some((request) => request.body.includes('"name":"pige_inspect_source"')));
    assert.ok(requests.some((request) => request.body.includes('"name":"pige_respond_to_user"')));
    assert.ok(requests.some((request) => request.body.includes('"type":"function_call_output"')));

    const secretsPath = path.join(userDataPath, "secrets.json");
    const secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
    const providers = JSON.parse(fs.readFileSync(path.join(userDataPath, "provider-profiles.json"), "utf8"));
    const models = JSON.parse(fs.readFileSync(path.join(userDataPath, "model-profiles.json"), "utf8"));
    assert.equal(secrets.schemaVersion, 1);
    assert.equal(secrets.secrets.length, 1);
    assert.match(secrets.secrets[0].ref, /^provider_secret_[a-z0-9_]+$/u);
    assert.notEqual(secrets.secrets[0].encryptedValue, syntheticToken);
    assert.equal(providers.providers.length, 1);
    assert.equal(providers.providers[0].authSecretRef, secrets.secrets[0].ref);
    assert.equal(models.defaultModelProfileId, connect.modelProfileId);
    assert.equal(findPlaintext(rootPath, syntheticToken), undefined);

    console.log(
      `Electron unified Agent roundtrip OK: persisted ${connect.providerProfileId}/${connect.modelProfileId}, ` +
      `reopened binding, real Responses tool loop, visible direct/cited Home and preserved-source results.`
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
}

async function runChild(phase, values) {
  const electronPath = resolveElectronPath();
  const child = spawn(electronPath, [scriptPath, `--phase=${phase}`], {
    cwd: desktopRoot,
    env: safeChildEnvironment({
      PIGE_ROUNDTRIP_ROOT: values.rootPath,
      PIGE_ROUNDTRIP_USER_DATA: values.userDataPath,
      PIGE_ROUNDTRIP_BASE_URL: values.baseUrl,
      PIGE_ROUNDTRIP_SYNTHETIC_TOKEN: values.syntheticToken,
      PIGE_ROUNDTRIP_ATTACHMENT_PATH: values.attachmentPath,
      PIGE_ROUNDTRIP_STAGE_PATH: path.join(values.rootPath, `stage-${phase}.txt`)
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const timeout = setTimeout(() => child.kill("SIGKILL"), MAX_CHILD_MS);
  const exitCode = await new Promise((resolve) => child.once("exit", (code) => resolve(code ?? 1)));
  clearTimeout(timeout);
  assert.equal(stdout.includes(values.syntheticToken), false);
  assert.equal(stderr.includes(values.syntheticToken), false);
  if (exitCode !== 0) {
    const marker = stderr.split(/\r?\n/u).find((line) => line.startsWith("PIGE_ROUNDTRIP_ERROR "));
    const stagePath = path.join(values.rootPath, `stage-${phase}.txt`);
    const stage = fs.existsSync(stagePath) ? fs.readFileSync(stagePath, "utf8").trim() : "unknown";
    throw new Error(marker ?? `Electron unified Agent ${phase} phase failed at ${stage}.`);
  }
  const marker = stdout.split(/\r?\n/u).find((line) => line.startsWith(CHILD_RESULT_PREFIX));
  if (!marker) throw new Error(`Electron unified Agent ${phase} phase returned no result.`);
  return JSON.parse(marker.slice(CHILD_RESULT_PREFIX.length));
}

async function runElectronPhase() {
  const phase = process.argv.find((value) => value.startsWith("--phase="))?.slice("--phase=".length);
  const rootPath = requireEnv("PIGE_ROUNDTRIP_ROOT");
  const userDataPath = requireEnv("PIGE_ROUNDTRIP_USER_DATA");
  const baseUrl = requireEnv("PIGE_ROUNDTRIP_BASE_URL");
  const syntheticToken = requireEnv("PIGE_ROUNDTRIP_SYNTHETIC_TOKEN");
  const attachmentPath = requireEnv("PIGE_ROUNDTRIP_ATTACHMENT_PATH");
  const stagePath = requireEnv("PIGE_ROUNDTRIP_STAGE_PATH");
  const { app, BrowserWindow, dialog } = await import("electron");
  fs.mkdirSync(userDataPath, { recursive: true });
  app.setPath("userData", userDataPath);
  app.setPath("sessionData", path.join(userDataPath, "session"));
  app.commandLine.appendSwitch("disable-gpu");
  dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  let stage = "prepare";
  let browserWindow;
  const markStage = (nextStage) => {
    stage = nextStage;
    fs.writeFileSync(stagePath, `${nextStage}\n`, "utf8");
  };
  markStage(stage);

  try {
    if (phase === "connect") {
      const helper = await import("../out/main/unified-agent-roundtrip-smoke.js");
      helper.prepareUnifiedAgentRoundtripSmoke({ rootPath, userDataPath });
    } else if (phase !== "reopen") {
      throw new Error("Unknown unified Agent roundtrip phase.");
    }

    markStage("main_import");
    await import("../out/main/index.js");
    markStage("app_ready_wait");
    await app.whenReady();
    markStage("app_ready");
    markStage("window_open");
    browserWindow = await waitForMainWindow(BrowserWindow);
    browserWindow.webContents.on("console-message", (_event, ...args) => {
      const message = args
        .map((value) => typeof value === "string" ? value : value && typeof value.message === "string" ? value.message : "")
        .find((value) => value.startsWith("PIGE_ROUNDTRIP_STAGE "));
      if (!message) return;
      const rendererStage = message.slice("PIGE_ROUNDTRIP_STAGE ".length);
      if (/^[a-z0-9_]+$/u.test(rendererStage)) fs.writeFileSync(stagePath, `${rendererStage}\n`, "utf8");
    });
    markStage("renderer_load");
    await waitForRenderer(browserWindow);
    markStage(phase === "connect" ? "renderer_connect" : "renderer_reopen");
    let result = phase === "connect"
      ? await runConnectRenderer(browserWindow, { baseUrl, syntheticToken })
      : await runReopenRenderer(browserWindow);
    if (phase === "connect") {
      markStage("renderer_source");
      await prepareSourceRenderer(browserWindow);
      await setRendererFileInput(browserWindow, attachmentPath);
      result = { ...result, ...(await readSourceRendererResult(browserWindow)) };
    }
    console.log(`${CHILD_RESULT_PREFIX}${JSON.stringify(result)}`);
    browserWindow.destroy();
    app.quit();
  } catch {
    let rendererStage = "";
    if (browserWindow && !browserWindow.isDestroyed()) {
      try {
        rendererStage = await browserWindow.webContents.executeJavaScript(
          "String(globalThis.__pigeRoundtripStage ?? '')",
          true
        );
      } catch {
        rendererStage = "";
      }
    }
    const safeRendererStage = /^[a-z0-9_]+$/u.test(rendererStage) ? rendererStage : "unknown";
    console.error(`PIGE_ROUNDTRIP_ERROR phase=${phase ?? "unknown"} stage=${stage} renderer=${safeRendererStage}`);
    app.exit(1);
  }
}

async function runConnectRenderer(browserWindow, input) {
  return browserWindow.webContents.executeJavaScript(`
    (async () => {
      const mark = (stage) => {
        globalThis.__pigeRoundtripStage = stage;
        console.info("PIGE_ROUNDTRIP_STAGE " + stage);
      };
      mark("bridge");
      const waitFor = async (predicate, label, timeoutMs = 45000) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const value = await predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error("Timed out waiting for " + label);
      };
      const clickNav = async (label) => {
        let button = Array.from(document.querySelectorAll("button.nav-item"))
          .find((item) => item.textContent?.trim() === label);
        if (!button) {
          const toggle = await waitFor(() => document.querySelector("button.icon-button"), "sidebar toggle");
          toggle.click();
          button = await waitFor(
            () => Array.from(document.querySelectorAll("button.nav-item")).find((item) => item.textContent?.trim() === label),
            "navigation " + label
          );
        }
        button.click();
      };
      const setValue = (element, value) => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
        descriptor.set.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const submitVisibleTurn = async (prompt, expected) => {
        await clickNav("Home");
        const composer = await waitFor(() => document.querySelector('textarea[aria-label="Capture or ask"]'), "Home composer");
        setValue(composer, prompt);
        const send = await waitFor(() => document.querySelector('button[aria-label="Send"]:not(:disabled)'), "Home send");
        send.click();
        await waitFor(() => document.body.textContent?.includes(expected), "visible Home result");
        return document.body.textContent?.includes(expected) === true;
      };

      await waitFor(() => window.pige, "preload bridge");
      mark("models_nav");
      await clickNav("Models");
      mark("provider_form");
      const details = await waitFor(() => document.querySelector("details.custom-provider"), "custom provider form");
      details.open = true;
      const protocolSelect = document.querySelector("#provider-protocol");
      const keyInput = document.querySelector("#provider-key");
      if (!protocolSelect || !Array.from(protocolSelect.options).some((option) => option.value === "openai_responses")) {
        throw new Error("Responses protocol control missing.");
      }
      if (!keyInput || keyInput.type !== "password") throw new Error("Write-only provider key control missing.");
      mark("provider_connect");
      setValue(document.querySelector("#provider-name"), ${JSON.stringify(PROVIDER_NAME)});
      setValue(protocolSelect, "openai_responses");
      setValue(document.querySelector("#provider-base-url"), ${JSON.stringify(input.baseUrl)});
      setValue(keyInput, ${JSON.stringify(input.syntheticToken)});
      const discoverButton = await waitFor(
        () => details.querySelector("button:not(:disabled)"),
        "enabled provider discovery button"
      );
      discoverButton.click();
      const modelInput = await waitFor(
        () => document.querySelector("#provider-model"),
        "bootstrap model selection"
      );
      if (modelInput.value !== ${JSON.stringify(MODEL_ID)}) {
        throw new Error("Discovered bootstrap model was not selected safely.");
      }
      const beforeCommit = await window.pige.models.summary();
      if (beforeCommit.providers.length !== 0 || beforeCommit.models.length !== 0) {
        throw new Error("Provider discovery wrote durable state before the bootstrap probe.");
      }
      const connectButton = await waitFor(
        () => details.querySelector("button:not(:disabled)"),
        "enabled provider connect button"
      );
      connectButton.click();
      const summary = await waitFor(async () => {
        const value = await window.pige.models.summary();
        return value.defaultBinding.state === "ready" ? value : undefined;
      }, "ready provider binding");
      const secretFieldCleared = await waitFor(
        () => document.querySelector("#provider-key")?.value === "" ? true : undefined,
        "cleared provider key field"
      );
      await clickNav("Home");
      await clickNav("Models");
      await waitFor(() => document.body.textContent?.includes(${JSON.stringify(PROVIDER_NAME)}), "visible default provider");
      const defaultSelect = await waitFor(
        () => document.querySelector("#global-default-model"),
        "global default model selector"
      );
      const selectedOption = defaultSelect.selectedOptions[0];
      const defaultProviderLabel = selectedOption?.parentElement?.tagName === "OPTGROUP"
        ? selectedOption.parentElement.label
        : "";
      const defaultModelLabel = selectedOption?.textContent?.trim() ?? "";
      if (defaultProviderLabel !== ${JSON.stringify(PROVIDER_NAME)} || defaultModelLabel !== ${JSON.stringify(MODEL_ID)}) {
        throw new Error("Global Default does not identify the connected provider model.");
      }
      const providerGroup = document.querySelector(".provider-model-group");
      if (!providerGroup?.textContent?.includes(${JSON.stringify(MODEL_ID)})) {
        throw new Error("Connected provider model inventory is not visible.");
      }

      mark("api_turn");
      const apiOutcome = await window.pige.agent.submitTurn({
        text: "Verify the selected model binding.",
        inputKind: "typed_text",
        objective: "auto",
        locale: "en"
      });
      if (apiOutcome.state !== "completed" || apiOutcome.modelUsage === "none") {
        throw new Error("Renderer API did not use the configured model.");
      }
      mark("direct_ui");
      const directVisible = await submitVisibleTurn(${JSON.stringify(DIRECT_PROMPT)}, ${JSON.stringify(DIRECT_ANSWER)});
      mark("grounded_ui");
      const groundedVisible = await submitVisibleTurn(${JSON.stringify(GROUNDING_PROMPT)}, ${JSON.stringify(GROUNDED_ANSWER)});
      const citationVisible = document.querySelector(".retrieval-citations") !== null;
      return {
        bindingState: summary.defaultBinding.state,
        providerProfileId: summary.defaultBinding.providerProfileId,
        modelProfileId: summary.defaultBinding.modelProfileId,
        modelUsage: apiOutcome.modelUsage,
        providerFormSubmitted: true,
        secretFieldCleared: Boolean(secretFieldCleared),
        defaultProviderLabel,
        defaultModelLabel,
        directVisible,
        groundedVisible,
        citationVisible
      };
    })()
  `, true);
}

async function runReopenRenderer(browserWindow) {
  return browserWindow.webContents.executeJavaScript(`
    (async () => {
      const mark = (stage) => {
        globalThis.__pigeRoundtripStage = stage;
        console.info("PIGE_ROUNDTRIP_STAGE " + stage);
      };
      mark("bridge");
      const waitFor = async (predicate, label, timeoutMs = 45000) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const value = await predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error("Timed out waiting for " + label);
      };
      const clickNav = async (label) => {
        let button = Array.from(document.querySelectorAll("button.nav-item"))
          .find((item) => item.textContent?.trim() === label);
        if (!button) {
          const toggle = await waitFor(() => document.querySelector("button.icon-button"), "sidebar toggle");
          toggle.click();
          button = await waitFor(
            () => Array.from(document.querySelectorAll("button.nav-item")).find((item) => item.textContent?.trim() === label),
            "navigation " + label
          );
        }
        button.click();
      };
      const setValue = (element, value) => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
        descriptor.set.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };

      await waitFor(() => window.pige, "preload bridge");
      mark("binding_reopen");
      const summary = await waitFor(async () => {
        const value = await window.pige.models.summary();
        return value.defaultBinding.state === "ready" ? value : undefined;
      }, "reopened provider binding");
      const runtimeStatus = await window.pige.agent.runtimeStatus();
      mark("models_reopen");
      await clickNav("Models");
      const providerVisible = await waitFor(
        () => document.body.textContent?.includes(${JSON.stringify(PROVIDER_NAME)}),
        "reopened default provider"
      );
      mark("home_reopen");
      await clickNav("Home");
      const composer = await waitFor(() => document.querySelector('textarea[aria-label="Capture or ask"]'), "Home composer");
      setValue(composer, ${JSON.stringify(DIRECT_PROMPT)});
      const send = await waitFor(() => document.querySelector('button[aria-label="Send"]:not(:disabled)'), "Home send");
      send.click();
      const directVisible = await waitFor(
        () => document.body.textContent?.includes(${JSON.stringify(DIRECT_ANSWER)}),
        "restarted visible Home result"
      );
      return {
        bindingState: summary.defaultBinding.state,
        runtimeState: runtimeStatus.state,
        providerProfileId: summary.defaultBinding.providerProfileId,
        modelProfileId: summary.defaultBinding.modelProfileId,
        providerVisible: Boolean(providerVisible),
        directVisible: Boolean(directVisible)
      };
    })()
  `, true);
}

async function prepareSourceRenderer(browserWindow) {
  return browserWindow.webContents.executeJavaScript(`
    (() => {
      const composer = document.querySelector('.composer textarea');
      if (!composer) throw new Error('Home composer is unavailable for the source turn.');
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer), 'value');
      descriptor.set.call(composer, ${JSON.stringify(SOURCE_PROMPT)});
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      composer.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `, true);
}

async function setRendererFileInput(browserWindow, attachmentPath) {
  const debuggerApi = browserWindow.webContents.debugger;
  debuggerApi.attach("1.3");
  try {
    const document = await debuggerApi.sendCommand("DOM.getDocument", { depth: -1, pierce: true });
    const input = await debuggerApi.sendCommand("DOM.querySelector", {
      nodeId: document.root.nodeId,
      selector: '.composer input[type="file"]'
    });
    if (!input.nodeId) throw new Error("Home file input is unavailable.");
    await debuggerApi.sendCommand("DOM.setFileInputFiles", {
      files: [attachmentPath],
      nodeId: input.nodeId
    });
  } finally {
    debuggerApi.detach();
  }
}

async function readSourceRendererResult(browserWindow) {
  return browserWindow.webContents.executeJavaScript(`
    (async () => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < 45000) {
        const answer = document.querySelector('.retrieval-answer');
        const completed = document.querySelector('.agent-run-state.state-completed');
        if (answer?.textContent?.includes(${JSON.stringify(SOURCE_ANSWER)}) && completed) {
          return { sourceVisible: true };
        }
        const failed = document.querySelector('.agent-run-state.state-failed');
        if (failed) throw new Error('Unified source turn failed visibly.');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Timed out waiting for the unified source result.');
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

async function startProviderServer(requests) {
  const server = http.createServer(async (request, response) => {
    const body = await readBody(request);
    requests.push({
      method: request.method ?? "",
      path: request.url ?? "",
      authorization: typeof request.headers.authorization === "string" ? request.headers.authorization : "",
      body
    });
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: [{ id: MODEL_ID, object: "model" }] }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/responses") {
      response.writeHead(404).end();
      return;
    }
    const parsed = JSON.parse(body);
    const serializedInput = JSON.stringify(parsed.input ?? "");
    const serializedTools = JSON.stringify(parsed.tools ?? "");
    if (serializedInput.includes('"call_id":"call_provider_probe"') && serializedInput.includes("function_call_output")) {
      writeTextResponse(response, "probe ready", "provider-probe-2");
      return;
    }
    if (serializedTools.includes("pige_provider_probe")) {
      writeToolCallResponse(response, "pige_provider_probe", "call_provider_probe", "provider-probe-1");
      return;
    }
    if (serializedInput.includes('"call_id":"call_home_search"') && serializedInput.includes("function_call_output")) {
      writeToolCallResponse(response, "pige_finish_home_turn", "call_home_finish_grounded", "home-grounded-2", {
        answer: GROUNDED_ANSWER,
        citationRefs: ["citation_1"],
        grounding: "local_knowledge"
      });
      return;
    }
    if (serializedInput.includes(GROUNDING_PROMPT)) {
      writeToolCallResponse(response, "pige_search_knowledge", "call_home_search", "home-grounded-1");
      return;
    }
    if (serializedInput.includes('"call_id":"call_source_inspect"') && serializedInput.includes("function_call_output")) {
      writeToolCallResponse(response, "pige_respond_to_user", "call_source_respond", "source-respond-1", {
        answer: SOURCE_ANSWER,
        evidenceRefs: ["ev_01"]
      });
      return;
    }
    if (serializedTools.includes("pige_inspect_source")) {
      writeToolCallResponse(response, "pige_inspect_source", "call_source_inspect", "source-inspect-1");
      return;
    }
    writeToolCallResponse(response, "pige_finish_home_turn", `call_home_finish_${requests.length}`, `home-direct-${requests.length}`, {
      answer: DIRECT_ANSWER,
      citationRefs: [],
      grounding: "general"
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

function writeToolCallResponse(response, name, callId, suffix, args = {}) {
  const argumentsJson = JSON.stringify(args);
  const item = {
    id: `fc_${suffix}`,
    type: "function_call",
    status: "completed",
    arguments: argumentsJson,
    call_id: callId,
    name
  };
  beginEventStream(response);
  writeResponseEvent(response, {
    type: "response.created",
    sequence_number: 0,
    response: openAiResponse(`resp_${suffix}`, "in_progress", [])
  });
  writeResponseEvent(response, {
    type: "response.output_item.added",
    sequence_number: 1,
    output_index: 0,
    item: { ...item, status: "in_progress", arguments: "" }
  });
  writeResponseEvent(response, {
    type: "response.function_call_arguments.done",
    sequence_number: 2,
    output_index: 0,
    item_id: item.id,
    name,
    arguments: argumentsJson
  });
  writeResponseEvent(response, {
    type: "response.output_item.done",
    sequence_number: 3,
    output_index: 0,
    item
  });
  writeResponseEvent(response, {
    type: "response.completed",
    sequence_number: 4,
    response: openAiResponse(`resp_${suffix}`, "completed", [item])
  });
  response.end("data: [DONE]\n\n");
}

function writeTextResponse(response, text, suffix) {
  const initialItem = {
    id: `msg_${suffix}`,
    type: "message",
    status: "in_progress",
    role: "assistant",
    content: [{ type: "output_text", text: "", annotations: [], logprobs: [] }]
  };
  const completedItem = {
    ...initialItem,
    status: "completed",
    content: [{ type: "output_text", text, annotations: [], logprobs: [] }]
  };
  beginEventStream(response);
  writeResponseEvent(response, {
    type: "response.created",
    sequence_number: 0,
    response: openAiResponse(`resp_${suffix}`, "in_progress", [])
  });
  writeResponseEvent(response, {
    type: "response.output_item.added",
    sequence_number: 1,
    output_index: 0,
    item: initialItem
  });
  writeResponseEvent(response, {
    type: "response.output_text.delta",
    sequence_number: 2,
    output_index: 0,
    content_index: 0,
    item_id: initialItem.id,
    delta: text,
    logprobs: []
  });
  writeResponseEvent(response, {
    type: "response.output_item.done",
    sequence_number: 3,
    output_index: 0,
    item: completedItem
  });
  writeResponseEvent(response, {
    type: "response.completed",
    sequence_number: 4,
    response: openAiResponse(`resp_${suffix}`, "completed", [completedItem])
  });
  response.end("data: [DONE]\n\n");
}

function openAiResponse(id, status, output) {
  return {
    id,
    object: "response",
    created_at: 1,
    status,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: 4096,
    model: MODEL_ID,
    output,
    parallel_tool_calls: false,
    previous_response_id: null,
    reasoning: null,
    store: false,
    temperature: 0,
    text: { format: { type: "text" } },
    tool_choice: "auto",
    tools: [],
    top_p: 1,
    truncation: "disabled",
    usage: status === "completed"
      ? {
          input_tokens: 1,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 1,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 2
        }
      : null,
    metadata: {}
  };
}

function beginEventStream(response) {
  response.writeHead(200, { "content-type": "text/event-stream" });
}

function writeResponseEvent(response, event) {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
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

function findPlaintext(rootPath, needle) {
  const pending = [rootPath];
  const needleBuffer = Buffer.from(needle, "utf8");
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
      } else if (entry.isFile() && fs.statSync(absolute).size <= 32 * 1024 * 1024) {
        if (fs.readFileSync(absolute).includes(needleBuffer)) return absolute;
      }
    }
  }
  return undefined;
}
