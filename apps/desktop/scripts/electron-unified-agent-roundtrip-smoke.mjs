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
const STREAMING_API_PROMPT = "Verify the selected model binding.";
const DIRECT_PROMPT = "Reply directly with the roundtrip greeting.";
const GROUNDING_PROMPT = "What is the roundtrip launch phrase in my local knowledge?";
const HIGH_RISK_DENY_PROMPT = "Run the harmless synthetic command requested by this test.";
const DIRECT_ANSWER = "The real Pi roundtrip is ready, and this longer answer arrives through several safe visible replacements before completion.";
const GROUNDED_ANSWER = "The roundtrip launch phrase is heliotrope seven. [citation_1]";
const SOURCE_PROMPT = "Inspect this attachment and answer without creating a note.";
const SOURCE_ANSWER = "The preserved attachment is available to the unified Agent.";
const MARKDOWN_PROMPT = "Inspect this Markdown attachment and answer without creating a note.";
const MARKDOWN_ANSWER = "The preserved Markdown attachment is available to the unified Agent.";
const ACTIVITY_PROMPT = "Create a grounded knowledge note from this attachment.";
const ACTIVITY_TITLE = "Unified Agent activity note";
const DATASET_PROMPT = "Which person has the largest count in this attached Dataset?";
const DATASET_ANSWER = "Grace has the largest count in the attached Dataset. [citation_9]";
const DATASET_CITATION_REF = "citation_9";
const DROP_DRAFT = "Keep this exact draft local while the dropped file submits.";
const DROP_ATTACHMENT_NAME = "whole-window-drop.txt";
const CHILD_RESULT_PREFIX = "PIGE_ROUNDTRIP_RESULT ";
const MAX_CHILD_MS = 90_000;
const highRiskOnly = process.argv.includes("--high-risk-only");

if (process.versions.electron) {
  setTimeout(() => {
    void runElectronPhase();
  }, 0);
} else {
  await runOrchestrator();
}

async function runOrchestrator() {
  const rootPath = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-unified-roundtrip-")));
  const userDataPath = path.join(rootPath, "user-data");
  const attachmentPath = path.join(rootPath, "unified-agent-source.txt");
  const markdownAttachmentPath = path.join(rootPath, "unified-agent-source.md");
  const activityAttachmentPath = path.join(rootPath, "unified-agent-activity.txt");
  const datasetAttachmentPath = path.join(rootPath, "unified-agent-dataset.csv");
  const dropAttachmentPath = path.join(rootPath, DROP_ATTACHMENT_NAME);
  const deniedCommandSentinelPath = path.join(rootPath, "denied-command-must-not-exist.txt");
  fs.writeFileSync(attachmentPath, "Synthetic unified Agent attachment evidence.\n", "utf8");
  fs.writeFileSync(markdownAttachmentPath, "# Synthetic Markdown evidence\n\nThe Markdown source crosses the real file ingress.\n", "utf8");
  fs.writeFileSync(activityAttachmentPath, "Synthetic reversible knowledge for Activity and Undo.\n", "utf8");
  fs.writeFileSync(datasetAttachmentPath, "name,count\nAda,3\nGrace,5\n", "utf8");
  fs.writeFileSync(dropAttachmentPath, "Synthetic whole-window drop evidence.\n", "utf8");
  const syntheticToken = `synthetic-${crypto.randomBytes(24).toString("hex")}`;
  const requests = [];
  const streamTiming = {};
  const server = await startProviderServer(requests, streamTiming, deniedCommandSentinelPath);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Loopback provider did not bind safely.");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  try {
    const connect = await runChild("connect", {
      rootPath,
      userDataPath,
      baseUrl,
      syntheticToken,
      attachmentPath,
      markdownAttachmentPath,
      activityAttachmentPath,
      datasetAttachmentPath,
      dropAttachmentPath,
      deniedCommandSentinelPath,
      highRiskOnly
    });
    assert.equal(connect.bindingState, "ready");
    assert.equal(connect.sourceToolchainReady, true);
    assert.equal(connect.modelUsage, "local");
    assert.equal(connect.providerFormSubmitted, true);
    assert.equal(connect.secretFieldCleared, true);
    assert.equal(connect.defaultProviderLabel, PROVIDER_NAME);
    assert.equal(connect.defaultModelLabel, MODEL_ID);
    assert.ok(connect.draftEventCount >= 3);
    assert.equal(connect.draftFinalMatches, true);
    assert.equal(connect.draftShapeSafe, true);
    assert.ok(connect.firstDraftReceivedAt < connect.apiCompletedAt);
    assert.ok(Number.isFinite(streamTiming.firstSafeAnswerMaterialAt));
    assert.ok(connect.firstDraftReceivedAt >= streamTiming.firstSafeAnswerMaterialAt);
    assert.ok(connect.firstDraftReceivedAt - streamTiming.firstSafeAnswerMaterialAt < 1_000);
    assert.equal(connect.directVisible, true);
    assert.equal(connect.enterSubmitted, true);
    assert.equal(connect.directProvisionalVisible, true);
    assert.ok(connect.directDraftEventCount >= 1);
    assert.equal(connect.groundedVisible, true);
    assert.equal(connect.directStillVisibleAfterGrounded, true);
    assert.equal(connect.groundedRetrievalVisible, true);
    assert.equal(connect.noProvisionalAnswerDuplicates, true);
    assert.equal(connect.groundedCitationsDuringDraft, false);
    assert.equal(connect.citationVisible, true);
    assert.equal(connect.citationOpenedReader, true);
    assert.equal(connect.sourceSelectionsHadZeroDurableSideEffects, true);
    assert.equal(connect.sourceStagingWindows.length, 4);
    assert.ok(connect.sourceStagingWindows.every(({ stagedAt, submittedAt }) =>
      Number.isFinite(stagedAt) && Number.isFinite(submittedAt) && submittedAt >= stagedAt
    ));
    assert.ok(connect.sourceStagingWindows.every(({ stagedAt, submittedAt }) =>
      requests.every((request) =>
        request.method !== "POST" || request.path !== "/v1/responses" ||
        request.receivedAt < stagedAt || request.receivedAt >= submittedAt
      )
    ));
    if (highRiskOnly) {
      assert.equal(connect.highRiskDialogVisible, true);
      assert.equal(connect.highRiskDenyDefaultFocused, true);
      assert.equal(connect.highRiskLegacySurfacesAbsent, true);
      assert.equal(connect.highRiskDenied, true);
      assert.equal(fs.existsSync(deniedCommandSentinelPath), false);
      assert.ok(requests.some((request) => request.body.includes('"name":"pige_run_command"')));
      assert.equal(requests.some((request) => request.body.includes('"call_id":"call_high_risk_command"') && request.body.includes("function_call_output")), false);
      console.log("Electron canonical high-risk denial OK: dialog visible, Deny focused, legacy prompts absent, zero command execution.");
      return;
    }
    assert.equal(connect.sourceVisible, true);
    assert.equal(connect.markdownVisible, true);
    assert.equal(connect.activityVisible, true);
    assert.equal(connect.activityUndone, true);
    assert.equal(connect.datasetVisible, true);
    assert.equal(connect.datasetCitationVisible, true);
    assert.equal(connect.datasetImportJobCount, 1);
    assert.deepEqual(connect.failedRetryableJobs, []);
    assert.equal(connect.durableSnapshot.messageIdentities.length, 12);
    assert.equal(connect.durableSnapshot.relevantJobs.filter((job) => job.class === "agent_turn").length, 7);
    assert.equal(connect.durableSnapshot.relevantJobs.filter((job) => job.class === "dataset_import").length, 1);
    assert.equal(connect.durableSnapshot.sourceIds.length, 4);
    assert.equal(connect.durableSnapshot.datasetIds.length, 1);
    assertUniqueIdentities(connect.durableSnapshot.messageIdentities.map((message) => message.id), "conversation event");
    assertUniqueIdentities(connect.durableSnapshot.relevantJobs.map((job) => job.id), "Job");
    assertUniqueIdentities(connect.durableSnapshot.pageIdentities.map((page) => page.pageId), "page");
    assertUniqueIdentities(connect.durableSnapshot.sourceIds, "source");
    assertUniqueIdentities(connect.durableSnapshot.datasetIds, "Dataset");
    assertUniqueIdentities(connect.durableSnapshot.activities.map((activity) => activity.operationId), "Activity");
    assert.ok(requests.filter((request) => request.method === "GET" && request.path === "/v1/models").length >= 2);
    assert.ok(requests.filter((request) => request.method === "POST" && request.path === "/v1/responses").length >= 7);
    assert.ok(requests.every((request) => request.authorization === `Bearer ${syntheticToken}`));
    assert.ok(requests.every((request) => !request.body.includes(syntheticToken)));
    assert.ok(requests.some((request) => request.body.includes('"name":"pige_provider_probe"')));
    assert.ok(requests.some((request) => request.body.includes('"name":"pige_search_knowledge"')));
    assert.equal(requests.some((request) => request.body.includes('"name":"pige_finish_home_turn"')), false);
    assert.ok(requests.some((request) => request.body.includes('"name":"pige_inspect_source"')));
    assert.ok(requests.some((request) => request.body.includes('"name":"pige_inspect_dataset"')));
    assert.ok(requests.some((request) => request.body.includes('"name":"pige_query_dataset"')));
    assert.ok(requests.some((request) => request.body.includes('"name":"pige_create_knowledge_note"')));
    assert.ok(requests.some((request) => request.body.includes('"type":"function_call_output"')));

    const requestCountBeforeRestart = requests.length;
    const restart = await runChild("restart", {
      rootPath,
      userDataPath,
      baseUrl,
      syntheticToken,
      attachmentPath,
      markdownAttachmentPath,
      activityAttachmentPath,
      datasetAttachmentPath,
      dropAttachmentPath,
      deniedCommandSentinelPath,
      highRiskOnly: false
    });
    assert.equal(restart.directVisible, true);
    assert.equal(restart.groundedVisible, true);
    assert.equal(restart.sourceVisible, true);
    assert.equal(restart.markdownVisible, true);
    assert.equal(restart.datasetVisible, true);
    assert.equal(restart.datasetCitationVisible, true);
    assert.deepEqual(restart.durableSnapshot, connect.durableSnapshot);
    assert.equal(restart.durableSnapshot.nonterminalJobIds.length, 0);
    assert.equal(restart.durableSnapshot.failedRetryableJobIds.length, 0);
    assert.equal(requests.length, requestCountBeforeRestart);

    const requestCountBeforeDrop = requests.length;
    const drop = await runChild("drop", {
      rootPath,
      userDataPath,
      baseUrl,
      syntheticToken,
      attachmentPath,
      markdownAttachmentPath,
      activityAttachmentPath,
      datasetAttachmentPath,
      dropAttachmentPath,
      deniedCommandSentinelPath,
      highRiskOnly: false
    });
    assert.equal(drop.draftPreserved, true);
    assert.equal(drop.draftExcludedFromTurn, true);
    assert.equal(drop.noStagedChips, true);
    assert.equal(drop.dropOverlayVisible, true);
    assert.equal(drop.identityFreeConversation, true);
    assert.equal(drop.agentTurnDelta, 1);
    assert.equal(drop.sourceDelta, 1);
    assert.equal(drop.dropMessageCount, 2);
    assert.equal(drop.dropJobCompleted, true);
    assert.equal(drop.dropSourceBound, true);
    assert.equal(drop.dropCitationCount, 0);
    assert.equal(drop.dropAnswerVisible, true);
    assert.equal(drop.durableSnapshot.nonterminalJobIds.length, 0);
    assert.equal(drop.durableSnapshot.failedRetryableJobIds.length, 0);
    assert.equal(drop.durableSnapshot.relevantJobs.length, restart.durableSnapshot.relevantJobs.length + 1);
    assert.equal(drop.durableSnapshot.sourceIds.length, restart.durableSnapshot.sourceIds.length + 1);
    assert.deepEqual(drop.durableSnapshot.datasetIds, restart.durableSnapshot.datasetIds);
    assert.deepEqual(drop.durableSnapshot.activities, restart.durableSnapshot.activities);
    assertUniqueIdentities(drop.durableSnapshot.messageIdentities.map((message) => message.id), "conversation event after drop");
    assertUniqueIdentities(drop.durableSnapshot.relevantJobs.map((job) => job.id), "Job after drop");
    assertUniqueIdentities(drop.durableSnapshot.sourceIds, "source after drop");
    const dropProviderRequests = requests.slice(requestCountBeforeDrop)
      .filter((request) => request.method === "POST" && request.path === "/v1/responses");
    assert.equal(dropProviderRequests.length, 2);
    assert.ok(dropProviderRequests[0]?.body.includes('"name":"pige_inspect_source"'));
    assert.ok(dropProviderRequests[1]?.body.includes('"call_id":"call_source_inspect"'));
    assert.ok(dropProviderRequests[1]?.body.includes("function_call_output"));

    const requestCountBeforeDropRestart = requests.length;
    const dropRestart = await runChild("drop_restart", {
      rootPath,
      userDataPath,
      baseUrl,
      syntheticToken,
      attachmentPath,
      markdownAttachmentPath,
      activityAttachmentPath,
      datasetAttachmentPath,
      dropAttachmentPath,
      deniedCommandSentinelPath,
      highRiskOnly: false
    });
    assert.equal(dropRestart.dropAnswerVisible, true);
    assert.equal(dropRestart.dropMessageCount, 2);
    assert.equal(dropRestart.dropCitationCount, 0);
    assert.deepEqual(dropRestart.durableSnapshot, drop.durableSnapshot);
    assert.equal(dropRestart.durableSnapshot.nonterminalJobIds.length, 0);
    assert.equal(dropRestart.durableSnapshot.failedRetryableJobIds.length, 0);
    assert.equal(requests.length, requestCountBeforeDropRestart);

    const secretsPath = path.join(userDataPath, "secrets.json");
    const secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
    const providers = JSON.parse(fs.readFileSync(path.join(userDataPath, "provider-profiles.json"), "utf8"));
    const models = JSON.parse(fs.readFileSync(path.join(userDataPath, "model-profiles.json"), "utf8"));
    assert.equal(secrets.schemaVersion, 1);
    assert.equal(secrets.secrets.length, 1);
    assert.ok(secrets.secrets.every((secret) => /^provider_secret_[a-z0-9_]+$/u.test(secret.ref)));
    assert.ok(secrets.secrets.every((secret) => secret.encryptedValue !== syntheticToken));
    assert.equal(providers.providers.length, 1);
    assert.ok(providers.providers.every((provider) =>
      secrets.secrets.some((secret) => secret.ref === provider.authSecretRef)
    ));
    assert.equal(models.defaultModelProfileId, connect.modelProfileId);
    assert.equal(findPlaintext(rootPath, syntheticToken), undefined);

    console.log(
      `Electron unified Agent roundtrip OK: persisted ${connect.providerProfileId}/${connect.modelProfileId}, ` +
      `reopened binding, real Responses tool loop and ${connect.draftEventCount} safe draft replacements ` +
      `(${connect.firstDraftReceivedAt - streamTiming.firstSafeAnswerMaterialAt}ms from first safe material), ` +
      `${connect.directDraftEventCount} final-answer replacement(s) with no presentation-only provider turn plus Enter submission, ` +
      `visible direct/cited Home, preserved-source, ` +
      `TXT/Markdown ingress, Dataset continuation, ordinary provider sends without a second approval, zero retryable Jobs, ` +
      `reversible Activity/Undo results, one identity-free whole-window drop, and exact restart retention without another Provider call.`
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
}

async function runChild(phase, values) {
  const electronPath = resolveElectronPath();
  const child = spawn(electronPath, [scriptPath, `--phase=${phase}`, ...(values.highRiskOnly ? ["--high-risk-only"] : [])], {
    cwd: desktopRoot,
    env: safeChildEnvironment({
      PIGE_ROUNDTRIP_ROOT: values.rootPath,
      PIGE_ROUNDTRIP_USER_DATA: values.userDataPath,
      PIGE_ROUNDTRIP_BASE_URL: values.baseUrl,
      PIGE_ROUNDTRIP_SYNTHETIC_TOKEN: values.syntheticToken,
      PIGE_ROUNDTRIP_ATTACHMENT_PATH: values.attachmentPath,
      PIGE_ROUNDTRIP_MARKDOWN_ATTACHMENT_PATH: values.markdownAttachmentPath,
      PIGE_ROUNDTRIP_ACTIVITY_ATTACHMENT_PATH: values.activityAttachmentPath,
      PIGE_ROUNDTRIP_DATASET_ATTACHMENT_PATH: values.datasetAttachmentPath,
      PIGE_ROUNDTRIP_DROP_ATTACHMENT_PATH: values.dropAttachmentPath,
      PIGE_ROUNDTRIP_DENY_SENTINEL_PATH: values.deniedCommandSentinelPath,
      PIGE_ROUNDTRIP_HIGH_RISK_ONLY: values.highRiskOnly ? "1" : "0",
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
    const state = stderr.split(/\r?\n/u).find((line) => line.startsWith("PIGE_ROUNDTRIP_STATE "));
    const stagePath = path.join(values.rootPath, `stage-${phase}.txt`);
    const stage = fs.existsSync(stagePath) ? fs.readFileSync(stagePath, "utf8").trim() : "unknown";
    const jobs = readSafeJobFailureSummary(values.rootPath);
    throw new Error(`${marker ?? `Electron unified Agent ${phase} phase failed at ${stage}.`} ${state ?? ""} jobs=${JSON.stringify(jobs)}`);
  }
  const marker = stdout.split(/\r?\n/u).find((line) => line.startsWith(CHILD_RESULT_PREFIX));
  if (!marker) throw new Error(`Electron unified Agent ${phase} phase returned no result.`);
  return JSON.parse(marker.slice(CHILD_RESULT_PREFIX.length));
}

function readSafeJobFailureSummary(rootPath) {
  const jobsPath = path.join(rootPath, "vaults", "Roundtrip Vault", ".pige", "jobs");
  if (!fs.existsSync(jobsPath)) return [];
  const files = [];
  const pending = [jobsPath];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(absolute);
    }
  }
  return files.flatMap((filePath) => {
      try {
        const job = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return [{
          class: typeof job.class === "string" ? job.class : "unknown",
          state: typeof job.state === "string" ? job.state : "unknown",
          message: typeof job.message === "string" ? job.message : undefined,
          errorCode: typeof job.error?.code === "string" ? job.error.code : undefined,
          waitingDependency: typeof job.waitingDependency === "string" ? job.waitingDependency : undefined
        }];
      } catch {
        return [{ class: "invalid", state: "invalid" }];
      }
    });
}

function readRoundtripRecord(vaultPath, area, recordId) {
  return readUniqueJsonByName(path.join(vaultPath, ".pige", area), `${recordId}.json`);
}

function sha256Digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function assertUniqueIdentities(values, label) {
  assert.equal(new Set(values).size, values.length, `Unified roundtrip contains duplicate ${label} identities.`);
}

function readUniqueJsonByName(rootPath, expectedName) {
  assert.equal(fs.existsSync(rootPath), true);
  const matches = [];
  const pending = [rootPath];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && entry.name === expectedName) matches.push(absolute);
    }
  }
  assert.equal(matches.length, 1);
  return JSON.parse(fs.readFileSync(matches[0], "utf8"));
}

async function runElectronPhase() {
  const phase = process.argv.find((value) => value.startsWith("--phase="))?.slice("--phase=".length);
  const rootPath = requireEnv("PIGE_ROUNDTRIP_ROOT");
  const userDataPath = requireEnv("PIGE_ROUNDTRIP_USER_DATA");
  const baseUrl = requireEnv("PIGE_ROUNDTRIP_BASE_URL");
  const syntheticToken = requireEnv("PIGE_ROUNDTRIP_SYNTHETIC_TOKEN");
  const attachmentPath = requireEnv("PIGE_ROUNDTRIP_ATTACHMENT_PATH");
  const markdownAttachmentPath = requireEnv("PIGE_ROUNDTRIP_MARKDOWN_ATTACHMENT_PATH");
  const activityAttachmentPath = requireEnv("PIGE_ROUNDTRIP_ACTIVITY_ATTACHMENT_PATH");
  const datasetAttachmentPath = requireEnv("PIGE_ROUNDTRIP_DATASET_ATTACHMENT_PATH");
  const dropAttachmentPath = requireEnv("PIGE_ROUNDTRIP_DROP_ATTACHMENT_PATH");
  const deniedCommandSentinelPath = requireEnv("PIGE_ROUNDTRIP_DENY_SENTINEL_PATH");
  const runHighRiskOnly = requireEnv("PIGE_ROUNDTRIP_HIGH_RISK_ONLY") === "1";
  const stagePath = requireEnv("PIGE_ROUNDTRIP_STAGE_PATH");
  const { app, BrowserWindow, dialog } = await import("electron");
  if (phase !== "connect") installSyntheticOpenAiRedirect(baseUrl);
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
    } else if (phase !== "restart" && phase !== "drop" && phase !== "drop_restart") {
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
    markStage(`renderer_${phase}`);
    let result;
    if (phase === "connect") {
      result = await runConnectRenderer(browserWindow, { baseUrl, syntheticToken });
    } else if (phase === "restart") {
      markStage("renderer_restart_retention");
      result = await runRestartRenderer(browserWindow);
    } else if (phase === "drop") {
      markStage("renderer_whole_window_drop");
      const prepared = await prepareWholeWindowDropRenderer(browserWindow);
      const dropOverlayVisible = await dispatchWholeWindowFileDrop(browserWindow, dropAttachmentPath);
      result = await readWholeWindowDropRendererResult(browserWindow, prepared, dropOverlayVisible);
    } else {
      markStage("renderer_whole_window_drop_restart");
      result = await runWholeWindowDropRestartRenderer(browserWindow);
    }
    if (phase === "connect" && runHighRiskOnly) {
      markStage("renderer_high_risk_deny");
      result = { ...result, ...(await runHighRiskDenyRenderer(browserWindow)) };
    } else if (phase === "connect") {
      const sourceStagingWindows = [];
      markStage("renderer_source");
      await prepareSourceRenderer(browserWindow, SOURCE_PROMPT);
      markStage("renderer_source_staging");
      sourceStagingWindows.push(await stageAndSubmitSourceRenderer(browserWindow, attachmentPath, markStage, "renderer_source"));
      markStage("renderer_source_submitted");
      result = { ...result, ...(await readSourceRendererResult(browserWindow, SOURCE_ANSWER, "sourceVisible")) };
      markStage("renderer_markdown");
      await prepareSourceRenderer(browserWindow, MARKDOWN_PROMPT);
      sourceStagingWindows.push(await stageAndSubmitSourceRenderer(browserWindow, markdownAttachmentPath, markStage, "renderer_markdown"));
      result = { ...result, ...(await readSourceRendererResult(browserWindow, MARKDOWN_ANSWER, "markdownVisible")) };
      markStage("renderer_activity");
      await prepareSourceRenderer(browserWindow, ACTIVITY_PROMPT);
      sourceStagingWindows.push(await stageAndSubmitSourceRenderer(browserWindow, activityAttachmentPath, markStage, "renderer_activity"));
      result = { ...result, ...(await readActivityRendererResult(browserWindow)) };
      markStage("renderer_dataset");
      await prepareSourceRenderer(browserWindow, DATASET_PROMPT);
      sourceStagingWindows.push(await stageAndSubmitSourceRenderer(browserWindow, datasetAttachmentPath, markStage, "renderer_dataset"));
      result = { ...result, ...(await readDatasetRendererResult(browserWindow)) };
      result = {
        ...result,
        sourceSelectionsHadZeroDurableSideEffects: true,
        sourceStagingWindows,
        durableSnapshot: await readDurableRestartSnapshot(browserWindow)
      };
    }
    console.log(`${CHILD_RESULT_PREFIX}${JSON.stringify(result)}`);
    browserWindow.destroy();
    app.quit();
  } catch (caught) {
    let rendererStage = "";
    let rendererState = "";
    if (browserWindow && !browserWindow.isDestroyed()) {
      try {
        rendererStage = await browserWindow.webContents.executeJavaScript(
          "String(globalThis.__pigeRoundtripStage ?? '')",
          true
        );
      } catch {
        rendererStage = "";
      }
      try {
        rendererState = await browserWindow.webContents.executeJavaScript(
          "JSON.stringify(globalThis.__pigeRoundtripWaitState ?? {})",
          true
        );
      } catch {
        rendererState = "";
      }
    }
    const safeRendererStage = /^[a-z0-9_]+$/u.test(rendererStage) ? rendererStage : "unknown";
    const safeErrorName = caught && typeof caught === "object" && typeof caught.name === "string" && /^[A-Za-z]+Error$/u.test(caught.name)
      ? caught.name
      : "Error";
    if (/^\{[\x20-\x7e]{0,1000}\}$/u.test(rendererState)) {
      console.error(`PIGE_ROUNDTRIP_STATE ${rendererState}`);
    }
    console.error(`PIGE_ROUNDTRIP_ERROR phase=${phase ?? "unknown"} stage=${stage} renderer=${safeRendererStage} error=${safeErrorName}`);
    app.exit(1);
  }
}

async function prepareWholeWindowDropRenderer(browserWindow) {
  return browserWindow.webContents.executeJavaScript(`
    (async () => {
      const deadline = Date.now() + 45000;
      let composer;
      while (Date.now() < deadline) {
        composer = document.querySelector('section.home .composer textarea');
        if (window.pige && composer) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!window.pige || !composer) throw new Error('Home composer is unavailable before whole-window drop.');
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer), 'value');
      descriptor.set.call(composer, ${JSON.stringify(DROP_DRAFT)});
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      composer.dispatchEvent(new Event('change', { bubbles: true }));
      const jobs = await window.pige.jobs.list({ limit: 100 });
      const timeline = await window.pige.agent.conversation({ limit: 100 });
      if (!timeline || composer.value !== ${JSON.stringify(DROP_DRAFT)}) {
        throw new Error('Whole-window drop fixture could not establish its local draft authority.');
      }
      globalThis.__pigeRoundtripStage = 'whole_window_drop_ready';
      console.info('PIGE_ROUNDTRIP_STAGE whole_window_drop_ready');
      return {
        activeVaultId: jobs.activeVaultId,
        conversationId: timeline.conversationId,
        tailEventId: timeline.tailEventId,
        agentTurnJobIds: jobs.jobs.filter((job) => job.class === 'agent_turn').map((job) => job.id),
        sourceIds: jobs.jobs.filter((job) => job.class === 'agent_turn' && job.sourceId).map((job) => job.sourceId)
      };
    })()
  `, true);
}

async function dispatchWholeWindowFileDrop(browserWindow, attachmentPath) {
  const target = await browserWindow.webContents.executeJavaScript(`
    (() => {
      const shell = document.querySelector('.app-window');
      if (!shell) throw new Error('Application drop surface is unavailable.');
      const rect = shell.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()
  `, true);
  const debuggerApi = browserWindow.webContents.debugger;
  debuggerApi.attach("1.3");
  const data = {
    items: [{ mimeType: "text/plain", data: "" }],
    files: [attachmentPath],
    dragOperationsMask: 1
  };
  try {
    await debuggerApi.sendCommand("Input.dispatchDragEvent", { type: "dragEnter", ...target, data });
    const overlayVisible = await browserWindow.webContents.executeJavaScript(`
      (async () => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (document.querySelector('.drop-overlay')) return true;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error('Whole-window drop overlay did not become visible.');
      })()
    `, true);
    await debuggerApi.sendCommand("Input.dispatchDragEvent", { type: "dragOver", ...target, data });
    await debuggerApi.sendCommand("Input.dispatchDragEvent", { type: "drop", ...target, data });
    return overlayVisible;
  } finally {
    debuggerApi.detach();
  }
}

async function readWholeWindowDropRendererResult(browserWindow, expected, dropOverlayVisible) {
  const result = await browserWindow.webContents.executeJavaScript(`
    (async () => {
      globalThis.__pigeRoundtripStage = 'whole_window_drop_result_wait';
      console.info('PIGE_ROUNDTRIP_STAGE whole_window_drop_result_wait');
      const expected = ${JSON.stringify(expected)};
      const baselineJobIds = new Set(expected.agentTurnJobIds);
      const baselineSourceIds = new Set(expected.sourceIds);
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        const jobs = await window.pige.jobs.list({ limit: 100 });
        const timeline = await window.pige.agent.conversation({ limit: 100 });
        const composer = document.querySelector('section.home .composer textarea');
        const chips = document.querySelectorAll('.attachment-chip');
        const agentJobs = jobs.jobs.filter((job) => job.class === 'agent_turn');
        const newJobs = agentJobs.filter((job) => !baselineJobIds.has(job.id));
        const sourceIds = agentJobs.filter((job) => job.sourceId).map((job) => job.sourceId);
        const newSourceIds = [...new Set(sourceIds.filter((sourceId) => !baselineSourceIds.has(sourceId)))];
        const assistant = timeline?.messages.find((message) =>
          message.role === 'assistant' && message.text.includes(${JSON.stringify(SOURCE_ANSWER)})
        );
        const identityFreeConversation = Boolean(timeline && timeline.conversationId !== expected.conversationId);
        const draftPreserved = composer?.value === ${JSON.stringify(DROP_DRAFT)};
        const noStagedChips = chips.length === 0;
        const dropJob = newJobs.length === 1 ? newJobs[0] : undefined;
        const dropSourceBound = Boolean(dropJob?.sourceId && newSourceIds.length === 1 && dropJob.sourceId === newSourceIds[0]);
        const dropMessageCount = timeline?.messages.length ?? 0;
        const dropCitationCount = assistant?.answer?.citations.length ?? -1;
        globalThis.__pigeRoundtripWaitState = {
          activeVaultMatches: jobs.activeVaultId === expected.activeVaultId,
          identityFreeConversation,
          draftPreserved,
          noStagedChips,
          agentTurnDelta: newJobs.length,
          sourceDelta: newSourceIds.length,
          dropMessageCount,
          dropJobCompleted: dropJob?.state === 'completed',
          dropSourceBound,
          dropAnswerVisible: Boolean(assistant),
          dropCitationCount
        };
        if (jobs.activeVaultId !== expected.activeVaultId) {
          throw new Error('Active vault changed during whole-window drop.');
        }
        if (
          identityFreeConversation &&
          draftPreserved &&
          noStagedChips &&
          newJobs.length === 1 &&
          newSourceIds.length === 1 &&
          dropJob?.state === 'completed' &&
          dropSourceBound &&
          dropMessageCount === 2 &&
          assistant &&
          dropCitationCount === 0
        ) {
          const draftExcludedFromTurn = timeline.messages.every(
            (message) => !message.text.includes(${JSON.stringify(DROP_DRAFT)})
          );
          return {
            draftPreserved,
            draftExcludedFromTurn,
            noStagedChips,
            identityFreeConversation,
            agentTurnDelta: newJobs.length,
            sourceDelta: newSourceIds.length,
            dropMessageCount,
            dropJobCompleted: true,
            dropSourceBound,
            dropCitationCount,
            dropAnswerVisible: true
          };
        }
        if (newJobs.some((job) => job.state === 'failed_retryable' || job.state === 'failed_final')) {
          throw new Error('Whole-window drop reached a durable failure state.');
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Timed out waiting for whole-window drop convergence.');
    })()
  `, true);
  return {
    ...result,
    dropOverlayVisible,
    durableSnapshot: await readDurableRestartSnapshot(browserWindow)
  };
}

async function runWholeWindowDropRestartRenderer(browserWindow) {
  const result = await browserWindow.webContents.executeJavaScript(`
    (async () => {
      globalThis.__pigeRoundtripStage = 'whole_window_drop_restart_wait';
      console.info('PIGE_ROUNDTRIP_STAGE whole_window_drop_restart_wait');
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        if (!window.pige) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          continue;
        }
        const timeline = await window.pige.agent.conversation({ limit: 100 });
        const jobs = await window.pige.jobs.list({ limit: 100 });
        const assistant = timeline?.messages.find((message) =>
          message.role === 'assistant' && message.text.includes(${JSON.stringify(SOURCE_ANSWER)})
        );
        const dropCitationCount = assistant?.answer?.citations.length ?? -1;
        globalThis.__pigeRoundtripWaitState = {
          dropAnswerVisible: Boolean(assistant),
          dropMessageCount: timeline?.messages.length ?? 0,
          dropCitationCount,
          nonterminalJobCount: jobs.jobs.filter((job) =>
            ['queued', 'running', 'waiting_dependency', 'awaiting_review', 'cancel_requested'].includes(job.state)
          ).length,
          failedRetryableJobCount: jobs.jobs.filter((job) => job.state === 'failed_retryable').length
        };
        if (assistant && timeline?.messages.length === 2 && dropCitationCount === 0) {
          return { dropAnswerVisible: true, dropMessageCount: 2, dropCitationCount };
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Timed out waiting for restarted whole-window drop result.');
    })()
  `, true);
  return {
    ...result,
    durableSnapshot: await readDurableRestartSnapshot(browserWindow)
  };
}

async function runRestartRenderer(browserWindow) {
  return browserWindow.webContents.executeJavaScript(`
    (async () => {
      const mark = (stage) => {
        globalThis.__pigeRoundtripStage = stage;
        console.info("PIGE_ROUNDTRIP_STAGE " + stage);
      };
      const waitFor = async (predicate, label, timeoutMs = 45000) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const value = await predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error("Timed out waiting for " + label);
      };
      const answerVisible = (expected) => Array.from(
        document.querySelectorAll(".conversation-message.role-assistant:not(.provisional)")
      ).some((message) => message.textContent?.includes(expected));

      mark("restart_bridge");
      await waitFor(() => window.pige, "restart preload bridge");
      const timeline = await waitFor(
        () => window.pige.agent.conversation({ limit: 100 }),
        "restart durable conversation"
      );
      mark("restart_timeline_ready");
      await waitFor(
        () => answerVisible(${JSON.stringify(DIRECT_ANSWER)}) &&
          answerVisible(${JSON.stringify(GROUNDED_ANSWER)}) &&
          answerVisible(${JSON.stringify(SOURCE_ANSWER)}) &&
          answerVisible(${JSON.stringify(MARKDOWN_ANSWER)}) &&
          answerVisible(${JSON.stringify(DATASET_ANSWER)}),
        "restart visible durable answers"
      );
      mark("restart_answers_visible");
      const datasetCitationVisible = Boolean(document.querySelector(".dataset-citations"));
      if (!datasetCitationVisible) throw new Error("Restarted Dataset citation is not visible.");
      const summary = await window.pige.models.summary();
      if (summary.defaultBinding.state !== "ready") {
        throw new Error("Restarted Provider binding is not ready.");
      }
      return {
        directVisible: answerVisible(${JSON.stringify(DIRECT_ANSWER)}),
        groundedVisible: answerVisible(${JSON.stringify(GROUNDED_ANSWER)}),
        sourceVisible: answerVisible(${JSON.stringify(SOURCE_ANSWER)}),
        markdownVisible: answerVisible(${JSON.stringify(MARKDOWN_ANSWER)}),
        datasetVisible: answerVisible(${JSON.stringify(DATASET_ANSWER)}),
        datasetCitationVisible,
        conversationId: timeline.conversationId
      };
    })()
  `, true).then(async (visible) => ({
    ...visible,
    durableSnapshot: await readDurableRestartSnapshot(browserWindow)
  }));
}

async function readDurableRestartSnapshot(browserWindow) {
  return browserWindow.webContents.executeJavaScript(`
    (async () => {
      const mark = (stage) => {
        globalThis.__pigeRoundtripStage = stage;
        console.info("PIGE_ROUNDTRIP_STAGE " + stage);
      };
      mark("durable_snapshot_conversation");
      const timeline = await window.pige.agent.conversation({ limit: 100 });
      mark("durable_snapshot_jobs");
      const jobs = await window.pige.jobs.list({ limit: 100 });
      mark("durable_snapshot_library");
      const library = await window.pige.library.list({ limit: 100 });
      mark("durable_snapshot_activity");
      const activity = await window.pige.activity.list({ limit: 20 });
      mark("durable_snapshot_models");
      const models = await window.pige.models.summary();
      if (!timeline) throw new Error("Durable conversation is unavailable.");

      mark("durable_snapshot_projection");
      const relevantJobs = jobs.jobs
        .filter((job) => job.class === "agent_turn" || job.class === "dataset_import")
        .map((job) => ({
          id: job.id,
          class: job.class,
          state: job.state,
          sourceId: job.sourceId ?? "",
          conversationEventId: job.conversationEventId ?? ""
        }))
        .sort((left, right) => left.id.localeCompare(right.id));
      const messageIdentities = timeline.messages.map((message) => ({
        id: message.id,
        role: message.role,
        jobId: message.jobId ?? "",
        citationRefs: (message.answer?.citations ?? []).map((citation) => citation.refId).sort(),
        datasetIds: (message.answer?.citations ?? [])
          .filter((citation) => citation.kind === "dataset")
          .map((citation) => citation.evidence.datasetId)
          .sort()
      }));
      const pageIdentities = library.pages
        .map((page) => ({
          pageId: page.pageId,
          pageType: page.pageType,
          sourceIds: [...page.sourceIds].sort()
        }))
        .sort((left, right) => left.pageId.localeCompare(right.pageId));
      const activities = activity.activities
        .map((entry) => ({
          operationId: entry.operationId,
          kind: entry.kind,
          status: entry.status,
          pageId: entry.target?.pageId ?? ""
        }))
        .sort((left, right) => left.operationId.localeCompare(right.operationId));
      const sourceIds = [...new Set([
        ...relevantJobs.map((job) => job.sourceId).filter(Boolean),
        ...pageIdentities.flatMap((page) => page.sourceIds)
      ])].sort();
      const datasetIds = [...new Set(messageIdentities.flatMap((message) => message.datasetIds))].sort();
      const nonterminalStates = new Set([
        "queued", "running", "waiting_dependency", "awaiting_review", "cancel_requested"
      ]);

      return {
        activeVaultId: jobs.activeVaultId,
        providerProfileId: models.defaultBinding.providerProfileId ?? "",
        modelProfileId: models.defaultBinding.modelProfileId ?? "",
        conversationId: timeline.conversationId,
        snapshotTailEventId: timeline.snapshotTailEventId,
        tailEventId: timeline.tailEventId,
        latestTurnJobId: timeline.latestTurn?.jobId ?? "",
        latestTurnState: timeline.latestTurn?.state ?? "",
        messageIdentities,
        relevantJobs,
        pageIdentities,
        sourceIds,
        datasetIds,
        activities,
        nonterminalJobIds: jobs.jobs
          .filter((job) => nonterminalStates.has(job.state))
          .map((job) => job.id)
          .sort(),
        failedRetryableJobIds: jobs.jobs
          .filter((job) => job.state === "failed_retryable")
          .map((job) => job.id)
          .sort()
      };
    })()
  `, true);
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
      const openSettingsSection = async (label) => {
        let trigger = document.querySelector("button.sidebar-settings-control");
        if (!trigger) {
          const toggle = await waitFor(
            () => document.querySelector("button.sidebar-toggle-button"),
            "sidebar toggle"
          );
          toggle.click();
          trigger = await waitFor(
            () => document.querySelector("button.sidebar-settings-control"),
            "Settings trigger"
          );
        }
        trigger.click();
        const section = await waitFor(
          () => Array.from(document.querySelectorAll("button.settings-nav-item"))
            .find((item) => item.querySelector("span")?.textContent?.trim() === label),
          "Settings section " + label
        );
        section.click();
        return waitFor(
          () => Array.from(document.querySelectorAll("section.settings-page"))
            .find((item) => item.getAttribute("aria-label") === label),
          label + " Settings page"
        );
      };
      const closeSettings = async () => {
        const close = await waitFor(
          () => document.querySelector("button.settings-return"),
          "Settings close"
        );
        close.click();
        await waitFor(
          () => document.querySelector("[data-settings-overlay]") ? undefined : true,
          "closed Settings"
        );
      };
      const setValue = (element, value) => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
        descriptor.set.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const submitVisibleTurn = async (prompt, expected, options = {}) => {
        await clickNav("Home");
        const composer = await waitFor(() => document.querySelector('textarea[aria-label="Capture or ask"]'), "Home composer");
        setValue(composer, prompt);
        const draftEvents = [];
        const stopDrafts = window.pige.agent.onTurnDraft((event) => draftEvents.push({ event, receivedAt: Date.now() }));
        let enterSubmitted = false;
        try {
          if (options.sendWithEnter) {
            const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
            composer.dispatchEvent(enter);
            enterSubmitted = enter.defaultPrevented;
          } else {
            const send = await waitFor(() => document.querySelector('button[aria-label="Send"]:not(:disabled)'), "Home send");
            send.click();
          }
          if (options.stage) mark(options.stage + "_submitted");
          let provisional = null;
          if (options.expectDraft) {
            try {
              provisional = await waitFor(
                () => document.querySelector('[data-agent-draft="true"]'),
                "visible provisional Home answer"
              );
            } catch (error) {
              if (options.stage) mark(options.stage + "_draft_missing_" + Math.min(draftEvents.length, 9));
              throw error;
            }
            if (options.stage) mark(options.stage + "_draft_visible");
          }
          const citationsDuringDraft = Boolean(provisional && document.querySelector(".retrieval-citations, .dataset-citations"));
          await waitFor(
            () => document.body.textContent?.includes(expected) && !document.querySelector('[data-agent-draft="true"]')
              ? true
              : undefined,
            "authoritative visible Home result"
          );
          if (options.stage) mark(options.stage + "_authoritative_visible");
          // The authoritative bubble can render one microtask before the submit promise clears
          // its synchronous duplicate-submit guard. Yield once so the next real UI turn is not
          // mistaken for an in-flight repeat.
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (options.stage) mark(options.stage + "_final_visible");
          return {
            visible: document.body.textContent?.includes(expected) === true,
            enterSubmitted,
            provisionalVisible: Boolean(provisional),
            draftEventCount: draftEvents.length,
            citationsDuringDraft
          };
        } finally {
          stopDrafts();
        }
      };

      await waitFor(() => window.pige, "preload bridge");
      const toolchain = await window.pige.system.toolchainHealth();
      const modelsBeforeConnect = await window.pige.models.summary();
      const reviewedPresetNames = new Set(modelsBeforeConnect.presets.map((preset) => preset.displayName));
      const requiredSourceTools = [
        "pdf-parser",
        "pdf-parser-runtime",
        "office-docx-parser",
        "office-openxml-parser",
        "office-archive-runtime",
        "web-readability-parser",
        "web-dom-runtime",
        "web-fetch-runtime"
      ];
      const sourceToolchainReady = requiredSourceTools.every((toolId) =>
        toolchain.tools.some((tool) => tool.id === toolId && tool.status === "ready")
      );
      if (!sourceToolchainReady) throw new Error("Bundled source toolchain is not ready in the assembled app.");
      mark("models_nav");
      let modelsPage = await openSettingsSection("Models");
      mark("models_overview");
      const addProviderButton = await waitFor(
        () => modelsPage.querySelector(".settings-inline-actions button.settings-button.primary:not(:disabled)"),
        "Add Provider action"
      );
      addProviderButton.click();
      modelsPage = await waitFor(
        () => Array.from(document.querySelectorAll('section.settings-page[aria-label="Models"]'))
          .find((page) => page.querySelector(".model-provider-picker button.model-provider-choice")),
        "Add Provider page"
      );
      mark("models_add_provider");
      const providerChoices = Array.from(modelsPage.querySelectorAll(".model-provider-picker button.model-provider-choice"));
      const customProviderButton = providerChoices.find((choice) => {
        const choiceName = choice.querySelector("strong")?.textContent?.trim();
        return choiceName && !reviewedPresetNames.has(choiceName);
      });
      if (!customProviderButton) throw new Error("Custom provider choice missing.");
      customProviderButton.click();
      mark("models_custom_provider");
      mark("provider_form");
      const customProviderPage = await waitFor(
        () => document.querySelector('section.settings-page[aria-label="Models"] #provider-name')?.closest("section.settings-page"),
        "custom provider form"
      );
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
      mark("provider_form_filled");
      const discoverButton = await waitFor(
        () => customProviderPage.querySelector(".model-settings-footer-actions button.primary:not(:disabled)"),
        "enabled provider discovery button"
      );
      discoverButton.click();
      mark("provider_discovery_started");
      const modelInput = await waitFor(
        () => document.querySelector("#provider-model"),
        "bootstrap model selection"
      );
      mark("provider_bootstrap_visible");
      if (modelInput.value !== ${JSON.stringify(MODEL_ID)}) {
        throw new Error("Discovered bootstrap model was not selected safely.");
      }
      const beforeCommit = await window.pige.models.summary();
      if (beforeCommit.providers.length !== 0 || beforeCommit.models.length !== 0) {
        throw new Error("Provider discovery wrote durable state before the bootstrap probe.");
      }
      const connectButton = await waitFor(
        () => customProviderPage.querySelector(".model-settings-footer-actions button.primary:not(:disabled)"),
        "enabled provider connect button"
      );
      connectButton.click();
      mark("provider_commit_started");
      const summary = await waitFor(async () => {
        const value = await window.pige.models.summary();
        return value.defaultBinding.state === "ready" ? value : undefined;
      }, "ready provider binding");
      mark("provider_binding_ready");
      const connectedOverview = await waitFor(
        () => Array.from(document.querySelectorAll('section.settings-page[aria-label="Models"]'))
          .find((page) => page.querySelector("#global-default-model")),
        "connected provider overview"
      );
      const reopenAddProvider = await waitFor(
        () => connectedOverview.querySelector(".settings-inline-actions button.settings-button.primary:not(:disabled)"),
        "reopen Add Provider action"
      );
      reopenAddProvider.click();
      const reopenedPicker = await waitFor(
        () => Array.from(document.querySelectorAll('section.settings-page[aria-label="Models"]'))
          .find((page) => page.querySelector(".model-provider-picker button.model-provider-choice")),
        "reopened Add Provider page"
      );
      const reopenedCustomProvider = Array.from(
        reopenedPicker.querySelectorAll(".model-provider-picker button.model-provider-choice")
      ).find((choice) => {
        const choiceName = choice.querySelector("strong")?.textContent?.trim();
        return choiceName && !reviewedPresetNames.has(choiceName);
      });
      if (!reopenedCustomProvider) throw new Error("Reopened custom provider choice missing.");
      reopenedCustomProvider.click();
      const secretFieldCleared = await waitFor(
        () => document.querySelector("#provider-key")?.value === "" ? true : undefined,
        "cleared provider key field"
      );
      mark("provider_secret_cleared");
      await closeSettings();
      mark("provider_settings_closed");
      await clickNav("Home");
      mark("provider_home_visible");
      await openSettingsSection("Models");
      mark("provider_models_reopened");
      await waitFor(() => document.body.textContent?.includes(${JSON.stringify(PROVIDER_NAME)}), "visible default provider");
      mark("provider_visible");
      const defaultSelect = await waitFor(
        () => document.querySelector("#global-default-model"),
        "global default model selector"
      );
      mark("provider_default_visible");
      const selectedOption = defaultSelect.selectedOptions[0];
      const defaultProviderLabel = selectedOption?.parentElement?.tagName === "OPTGROUP"
        ? selectedOption.parentElement.label
        : "";
      const defaultModelLabel = selectedOption?.textContent?.trim() ?? "";
      if (defaultProviderLabel !== ${JSON.stringify(PROVIDER_NAME)} || defaultModelLabel !== ${JSON.stringify(MODEL_ID)}) {
        throw new Error("Global Default does not identify the connected provider model.");
      }
      const providerCard = Array.from(document.querySelectorAll(".model-provider-card"))
        .find((card) => card.textContent?.includes(${JSON.stringify(PROVIDER_NAME)}));
      const providerDetailButton = providerCard
        ? providerCard.querySelector(".settings-row > button.settings-button:not(:disabled)")
        : null;
      if (!providerDetailButton) throw new Error("Connected provider detail action is not available.");
      providerDetailButton.click();
      const providerGroup = await waitFor(
        () => document.querySelector(".provider-model-group"),
        "connected provider model inventory"
      );
      if (!providerGroup?.textContent?.includes(${JSON.stringify(MODEL_ID)})) {
        throw new Error("Connected provider model inventory is not visible.");
      }
      mark("provider_inventory_visible");
      await closeSettings();
      await clickNav("Home");
      mark("provider_home_ready");

      mark("api_turn");
      const draftEvents = [];
      const stopDrafts = window.pige.agent.onTurnDraft((event) => draftEvents.push({ event, receivedAt: Date.now() }));
      let apiOutcome;
      let apiCompletedAt;
      try {
        apiOutcome = await window.pige.agent.submitTurn({
          text: ${JSON.stringify(STREAMING_API_PROMPT)},
          inputKind: "typed_text",
          objective: "auto",
          locale: "en",
          clientTurnId: "turn_20260713_roundtripdraft"
        });
        apiCompletedAt = Date.now();
      } finally {
        stopDrafts();
      }
      if (apiOutcome.state !== "completed" || apiOutcome.modelUsage === "none") {
        throw new Error("Renderer API did not use the configured model.");
      }
      const finalDraft = draftEvents.at(-1)?.event;
      const draftShapeSafe = draftEvents.every(({ event }, index) => {
        const keys = Object.keys(event).sort().join(",");
        return keys === "apiVersion,clientTurnId,conversationEventId,conversationId,jobId,kind,requestId,sequence,text" &&
          event.apiVersion === 1 &&
          event.kind === "draft_replace" &&
          event.clientTurnId === "turn_20260713_roundtripdraft" &&
          event.sequence === index + 1;
      });
      if (!finalDraft || finalDraft.text !== ${JSON.stringify(DIRECT_ANSWER)} || !draftShapeSafe) {
        throw new Error("Safe Home draft replacement did not cross the real preload bridge.");
      }
      mark("direct_ui");
      const directTurn = await submitVisibleTurn(
        ${JSON.stringify(DIRECT_PROMPT)},
        ${JSON.stringify(DIRECT_ANSWER)},
        { sendWithEnter: true, expectDraft: true, stage: "direct_ui" }
      );
      mark("grounded_ui");
      const groundedTurn = await submitVisibleTurn(
        ${JSON.stringify(GROUNDING_PROMPT)},
        ${JSON.stringify(GROUNDED_ANSWER)},
        { expectDraft: true, stage: "grounded_ui" }
      );
      const durableAssistantMessages = Array.from(
        document.querySelectorAll(".conversation-message.role-assistant:not(.provisional)")
      );
      const directDurableMessages = durableAssistantMessages.filter(
        (message) => message.textContent?.includes(${JSON.stringify(DIRECT_ANSWER)})
      );
      const groundedRetrievalAnswers = Array.from(document.querySelectorAll(".retrieval-answer")).filter(
        (message) => message.textContent?.includes(${JSON.stringify(GROUNDED_ANSWER)})
      );
      const provisionalAnswerDuplicates = Array.from(
        document.querySelectorAll('[data-agent-draft="true"]')
      ).filter((message) =>
        message.textContent?.includes(${JSON.stringify(DIRECT_ANSWER)}) ||
        message.textContent?.includes(${JSON.stringify(GROUNDED_ANSWER)})
      );
      mark("grounded_ui_citation_wait");
      const citationButton = await waitFor(
        () => document.querySelector(".retrieval-citations button:not(:disabled)"),
        "visible Home citation button"
      );
      mark("grounded_ui_citation_visible");
      citationButton.click();
      await waitFor(() => document.querySelector(".note-reader"), "citation Reader");
      mark("grounded_ui_reader_visible");
      const readerBack = await waitFor(
        () => document.querySelector(".home-reader .back-button"),
        "Back to grounded results"
      );
      readerBack.click();
      await waitFor(
        () => document.querySelector(".note-reader") ? undefined : document.querySelector(".retrieval-results"),
        "grounded results after citation Reader"
      );
      const citationOpenedReader = true;
      return {
        bindingState: summary.defaultBinding.state,
        sourceToolchainReady,
        providerProfileId: summary.defaultBinding.providerProfileId,
        modelProfileId: summary.defaultBinding.modelProfileId,
        modelUsage: apiOutcome.modelUsage,
        providerFormSubmitted: true,
        secretFieldCleared: Boolean(secretFieldCleared),
        defaultProviderLabel,
        defaultModelLabel,
        draftEventCount: draftEvents.length,
        firstDraftReceivedAt: draftEvents[0]?.receivedAt,
        apiCompletedAt,
        draftFinalMatches: finalDraft.text === ${JSON.stringify(DIRECT_ANSWER)},
        draftShapeSafe,
        directVisible: directTurn.visible,
        enterSubmitted: directTurn.enterSubmitted,
        directProvisionalVisible: directTurn.provisionalVisible,
        directDraftEventCount: directTurn.draftEventCount,
        groundedVisible: groundedTurn.visible,
        directStillVisibleAfterGrounded: directDurableMessages.length === 1,
        groundedRetrievalVisible: groundedRetrievalAnswers.length === 1,
        noProvisionalAnswerDuplicates: provisionalAnswerDuplicates.length === 0,
        groundedCitationsDuringDraft: groundedTurn.citationsDuringDraft,
        citationVisible: Boolean(citationButton),
        citationOpenedReader
      };
    })()
  `, true);
}

async function runHighRiskDenyRenderer(browserWindow) {
  return browserWindow.webContents.executeJavaScript(`
    (async () => {
      const mark = (stage) => {
        globalThis.__pigeRoundtripStage = stage;
        console.info("PIGE_ROUNDTRIP_STAGE " + stage);
      };
      const waitFor = async (predicate, label, timeoutMs = 45000) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const value = await predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error("Timed out waiting for " + label);
      };
      mark("high_risk_composer");
      const composer = await waitFor(
        () => document.querySelector('textarea[aria-label="Capture or ask"]'),
        "Home composer for high-risk denial"
      );
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer), "value");
      descriptor.set.call(composer, ${JSON.stringify(HIGH_RISK_DENY_PROMPT)});
      composer.dispatchEvent(new Event("input", { bubbles: true }));
      composer.dispatchEvent(new Event("change", { bubbles: true }));
      mark("high_risk_send");
      const send = await waitFor(
        () => document.querySelector('button[aria-label="Send"]:not(:disabled)'),
        "Home send for high-risk denial"
      );
      send.click();
      mark("high_risk_dialog");
      const dialog = await waitFor(
        () => document.querySelector('.confirmation-dialog[role="dialog"][aria-modal="true"]'),
        "canonical high-risk confirmation dialog"
      );
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const denyButton = dialog.querySelector(".confirmation-actions button.ghost:not(:disabled)");
      const denyDefaultFocused = document.activeElement === denyButton;
      const legacySurfacesAbsent = !document.querySelector(".permission-prompt, .model-egress-prompt");
      if (!denyButton || !denyDefaultFocused || !legacySurfacesAbsent) {
        throw new Error("Canonical high-risk confirmation presentation is invalid.");
      }
      mark("high_risk_deny");
      denyButton.click();
      await waitFor(
        () => document.querySelector(".confirmation-dialog") ? undefined : true,
        "resolved high-risk denial"
      );
      mark("high_risk_denied");
      return {
        highRiskDialogVisible: true,
        highRiskDenyDefaultFocused: denyDefaultFocused,
        highRiskLegacySurfacesAbsent: legacySurfacesAbsent,
        highRiskDenied: true
      };
    })()
  `, true);
}

function installSyntheticOpenAiRedirect(baseUrl) {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const source = new URL(
      typeof input === "string" || input instanceof URL ? input.toString() : input.url
    );
    if (source.origin !== "https://api.openai.com") return nativeFetch(input, init);
    const target = new URL(baseUrl);
    const suffix = source.pathname.startsWith("/v1/") ? source.pathname.slice(3) : source.pathname;
    target.pathname = `${target.pathname.replace(/\/$/u, "")}${suffix}`;
    target.search = source.search;
    if (typeof Request !== "undefined" && input instanceof Request) {
      return nativeFetch(new Request(target, input), init);
    }
    return nativeFetch(target, init);
  };
}

async function prepareSourceRenderer(browserWindow, prompt) {
  return browserWindow.webContents.executeJavaScript(`
    (() => {
      const composer = document.querySelector('.composer textarea');
      if (!composer) throw new Error('Home composer is unavailable for the source turn.');
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer), 'value');
      descriptor.set.call(composer, ${JSON.stringify(prompt)});
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

async function stageAndSubmitSourceRenderer(browserWindow, attachmentPath, markStage, stagePrefix) {
  markStage(`${stagePrefix}_baseline`);
  const baseline = await readSourceSubmissionState(browserWindow);
  const stagedAt = Date.now();
  markStage(`${stagePrefix}_file_input`);
  await setRendererFileInput(browserWindow, attachmentPath);
  markStage(`${stagePrefix}_side_effect_check`);
  const staged = await browserWindow.webContents.executeJavaScript(`
    (async () => {
      globalThis.__pigeRoundtripStage = 'source_stage_send_ready';
      const expectedDisplayName = ${JSON.stringify(path.basename(attachmentPath))};
      const expected = ${JSON.stringify(baseline)};
      const deadline = Date.now() + 45000;
      let stagedChip;
      while (Date.now() < deadline) {
        const currentJobs = await window.pige.jobs.list({ limit: 100 });
        const currentTimeline = await window.pige.agent.conversation({ limit: 24 });
        const chips = Array.from(document.querySelectorAll('.attachment-chip'));
        if (!stagedChip && chips.length === 1 && chips[0]?.querySelector('strong')?.textContent === expectedDisplayName) {
          stagedChip = chips[0];
        }
        const chipMatches = Boolean(stagedChip) && chips.length === 1 &&
          chips[0] === stagedChip &&
          chips[0]?.querySelector('strong')?.textContent === expectedDisplayName;
        const send = document.querySelector('section.home .composer button.composer-send');
        const tail = currentTimeline?.messages.find((message) => message.id === currentTimeline.tailEventId);
        const latestTurnState = currentTimeline?.latestTurn?.state ?? 'none';
        const terminalTail = currentTimeline?.canFollowUp === true &&
          tail?.role === 'assistant' &&
          (latestTurnState === 'none' || latestTurnState === 'completed' || latestTurnState === 'completed_with_warnings');
        const activeVaultMatches = currentJobs.activeVaultId === expected.activeVaultId;
        const conversationMatches = currentTimeline?.conversationId === expected.conversationId;
        const tailMatches = currentTimeline?.tailEventId === expected.conversationTailEventId;
        globalThis.__pigeRoundtripWaitState = {
          chipCount: chips.length,
          chipMatches,
          sendPresent: Boolean(send),
          sendEnabled: Boolean(send && !send.disabled),
          canFollowUp: currentTimeline?.canFollowUp === true,
          tailRoleAssistant: tail?.role === 'assistant',
          latestTurnState,
          activeVaultMatches,
          conversationMatches,
          tailMatches,
          agentTurnCount: currentJobs.jobs.filter((job) => job.class === 'agent_turn').length
        };
        if (!activeVaultMatches || !conversationMatches || !tailMatches || (stagedChip && !chipMatches)) {
          throw new Error('Staged source submission identity changed before Send.');
        }
        if (chipMatches && terminalTail && send && !send.disabled) {
          const agentTurnCount = currentJobs.jobs.filter((job) => job.class === 'agent_turn').length;
          const conversationTailEventId = currentTimeline?.tailEventId ?? '';
          const conversationMessageCount = currentTimeline?.messages.length ?? 0;
          if (
            agentTurnCount !== expected.agentTurnCount ||
            conversationTailEventId !== expected.conversationTailEventId ||
            conversationMessageCount !== expected.conversationMessageCount
          ) {
            throw new Error('Picker staging created a durable Agent side effect before Send.');
          }
          const submittedAt = Date.now();
          send.click();
          return { agentTurnCount, conversationTailEventId, conversationMessageCount, submittedAt };
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Timed out waiting for exact staged Home Send authority.');
    })()
  `, true);
  if (
    staged.agentTurnCount !== baseline.agentTurnCount ||
    staged.conversationTailEventId !== baseline.conversationTailEventId ||
    staged.conversationMessageCount !== baseline.conversationMessageCount
  ) {
    throw new Error("Picker staging created a durable Agent side effect before Send.");
  }
  markStage(`${stagePrefix}_send`);
  return { stagedAt, submittedAt: staged.submittedAt };
}

async function readSourceSubmissionState(browserWindow) {
  return browserWindow.webContents.executeJavaScript(`
    (async () => {
      const jobs = await window.pige.jobs.list({ limit: 100 });
      const timeline = await window.pige.agent.conversation({ limit: 24 });
      return {
        activeVaultId: jobs.activeVaultId,
        conversationId: timeline?.conversationId ?? '',
        agentTurnCount: jobs.jobs.filter((job) => job.class === 'agent_turn').length,
        conversationTailEventId: timeline?.tailEventId ?? '',
        conversationMessageCount: timeline?.messages.length ?? 0
      };
    })()
  `, true);
}

async function readSourceRendererResult(browserWindow, expectedAnswer, resultKey) {
  return browserWindow.webContents.executeJavaScript(`
    (async () => {
      const startedAt = Date.now();
      globalThis.__pigeRoundtripStage = 'source_result_wait';
      while (Date.now() - startedAt < 45000) {
        const answer = Array.from(document.querySelectorAll('.conversation-message.role-assistant:not(.provisional)'))
          .find((message) => message.textContent?.includes(${JSON.stringify(expectedAnswer)}));
        const provisional = document.querySelector('[data-agent-draft="true"]');
        const timeline = await window.pige.agent.conversation({ limit: 24 });
        const jobs = await window.pige.jobs.list({ limit: 100 });
        const timelineAnswerVisible = timeline?.messages.some((message) =>
          message.role === 'assistant' && message.text.includes(${JSON.stringify(expectedAnswer)})
        ) === true;
        globalThis.__pigeRoundtripWaitState = {
          timelineAnswerVisible,
          domAnswerVisible: Boolean(answer),
          provisionalVisible: Boolean(provisional),
          failedVisible: Boolean(document.querySelector('.conversation-status-message.state-failed')),
          canFollowUp: timeline?.canFollowUp === true,
          latestTurnState: timeline?.latestTurn?.state ?? 'none',
          timelineMessageCount: timeline?.messages.length ?? 0,
          domAssistantCount: document.querySelectorAll('.conversation-message.role-assistant:not(.provisional)').length,
          agentTurnCount: jobs.jobs.filter((job) => job.class === 'agent_turn').length
        };
        if (answer && !provisional) {
          return { [${JSON.stringify(resultKey)}]: true };
        }
        const failed = document.querySelector('.conversation-status-message.state-failed');
        if (failed) throw new Error('Unified source turn failed visibly.');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Timed out waiting for the unified source result.');
    })()
  `, true);
}

async function readActivityRendererResult(browserWindow) {
  return browserWindow.webContents.executeJavaScript(`
    (async () => {
      const mark = (stage) => {
        globalThis.__pigeRoundtripStage = stage;
        console.info("PIGE_ROUNDTRIP_STAGE " + stage);
      };
      const waitFor = async (predicate, label, timeoutMs = 45000) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const value = await predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error("Timed out waiting for " + label);
      };
      const activity = await waitFor(async () => {
        const value = await window.pige.activity.list({ limit: 10 });
        return value.activities.find((candidate) =>
          candidate.targetLabel === ${JSON.stringify(ACTIVITY_TITLE)} &&
          candidate.status === "applied" &&
          candidate.canUndo
        );
      }, "reversible Activity");
      mark("activity_durable");
      let settingsTrigger = document.querySelector("button.sidebar-settings-control");
      if (!settingsTrigger) {
        const sidebarToggle = await waitFor(
          () => document.querySelector("button.sidebar-toggle-button"),
          "sidebar toggle for Activity"
        );
        sidebarToggle.click();
        settingsTrigger = await waitFor(
          () => document.querySelector("button.sidebar-settings-control"),
          "Settings trigger for Activity"
        );
      }
      settingsTrigger.click();
      mark("activity_settings_open");
      const settingsItems = await waitFor(() => {
        const items = Array.from(document.querySelectorAll("button.settings-nav-item"));
        return items.length > 0 ? items : undefined;
      }, "Settings navigation items for Activity");
      const activitySection = settingsItems.find((item) => item.textContent?.includes("Activity History"));
      mark("activity_nav_" + Math.min(settingsItems.length, 9) + "_" + (activitySection ? "1" : "0"));
      if (!activitySection) throw new Error("Activity History Settings section is unavailable.");
      activitySection.click();
      await waitFor(
        () => document.querySelector('section.settings-page.settings-history-page[aria-labelledby="settings-history-title"]'),
        "Activity History Settings page"
      );
      mark("activity_page_visible");
      const row = await waitFor(
        () => document.querySelector('[data-activity-row-id="' + activity.operationId + '"]'),
        "visible Activity row"
      );
      mark("activity_row_visible");
      const undo = row.querySelector('[data-activity-undo-id="' + activity.operationId + '"]:not(:disabled)');
      if (!undo) throw new Error("Visible Activity is missing its bounded Undo action.");
      undo.click();
      await waitFor(async () => {
        const value = await window.pige.activity.list({ limit: 10 });
        return value.activities.find((candidate) =>
          candidate.operationId === activity.operationId && candidate.status === "undone"
        );
      }, "durable Activity Undo");
      mark("activity_undo_durable");
      await waitFor(
        () => {
          const current = document.querySelector('[data-activity-row-id="' + activity.operationId + '"]');
          return current && !current.querySelector('[data-activity-undo-id]') ? true : undefined;
        },
        "visible undone Activity"
      );
      const closeSettings = await waitFor(
        () => document.querySelector("button.settings-return"),
        "Settings close after Activity"
      );
      closeSettings.click();
      await waitFor(
        () => document.querySelector("[data-settings-overlay]") ? undefined : true,
        "closed Settings after Activity"
      );
      return {
        activityVisible: true,
        activityUndone: true,
        activityOperationId: activity.operationId
      };
    })()
  `, true);
}

async function readDatasetRendererResult(browserWindow) {
  return browserWindow.webContents.executeJavaScript(`
    (async () => {
      let lastStage = "";
      const mark = (stage) => {
        if (stage === lastStage) return;
        lastStage = stage;
        globalThis.__pigeRoundtripStage = stage;
        console.info("PIGE_ROUNDTRIP_STAGE " + stage);
      };
      mark("dataset_wait");
      const waitFor = async (predicate, label, timeoutMs = 60000) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const value = await predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error("Timed out waiting for " + label);
      };
      const datasetVisible = await waitFor(
        async () => {
          const answer = document.querySelector(".dataset-answer");
          if (answer?.textContent?.includes(${JSON.stringify(DATASET_ANSWER)}) && answer.textContent.includes("Grace")) {
            mark("dataset_visible");
            return true;
          }
          const jobs = await window.pige.jobs.list({ limit: 100 });
          const parent = jobs.jobs.find((job) => job.class === "agent_turn" &&
            ["queued", "running", "waiting_dependency", "failed_retryable", "failed_final"].includes(job.state));
          const child = jobs.jobs.find((job) => job.class === "dataset_import");
          const parentState = parent?.state ?? "none";
          const childState = child?.state ?? "none";
          const timeline = await window.pige.agent.conversation({ limit: 24 });
          const timelineDatasetCount = timeline.messages.filter((message) => message.answer?.datasetResult).length;
          const domDatasetCount = document.querySelectorAll(".dataset-answer").length;
          mark(
            "dataset_" +
            Math.min(timelineDatasetCount, 9) + "_" +
            Math.min(domDatasetCount, 9) + "_" +
            parentState + "_" +
            childState
          );
          if (parentState === "failed_final" || parentState === "failed_retryable" || childState === "failed_final") {
            throw new Error("Dataset continuation reached a durable failure state.");
          }
          return undefined;
        },
        "visible Dataset answer"
      );
      const datasetCitationVisible = await waitFor(
        () => document.querySelector(".dataset-citations") ? true : undefined,
        "visible Dataset citation"
      );
      const jobs = await window.pige.jobs.list({ limit: 100 });
      const datasetImportJobCount = jobs.jobs.filter((job) => job.class === "dataset_import").length;
      if (datasetImportJobCount !== 1) {
        throw new Error("Dataset source turn did not preserve exactly one deterministic import child.");
      }
      const settledJobs = await waitFor(async () => {
        const current = await window.pige.jobs.list({ limit: 100 });
        return current.jobs.some((job) =>
          job.class === "index_rebuild" && (job.state === "queued" || job.state === "running")
        ) ? undefined : current.jobs;
      }, "settled background jobs");
      return {
        datasetVisible: Boolean(datasetVisible),
        datasetCitationVisible: Boolean(datasetCitationVisible),
        datasetImportJobCount,
        failedRetryableJobs: settledJobs
          .filter((job) => job.state === "failed_retryable")
          .map((job) => ({
            class: job.class,
            stage: job.stage ?? "none",
            errorCode: job.error?.code ?? "none"
          }))
          .sort((left, right) => left.class.localeCompare(right.class))
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

async function startProviderServer(requests, streamTiming, deniedCommandSentinelPath) {
  const server = http.createServer(async (request, response) => {
    const body = await readBody(request);
    requests.push({
      method: request.method ?? "",
      path: request.url ?? "",
      authorization: typeof request.headers.authorization === "string" ? request.headers.authorization : "",
      body,
      receivedAt: Date.now()
    });
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        object: "list",
        data: [
          { id: MODEL_ID, object: "model" },
          { id: "gpt-5-mini", object: "model" }
        ]
      }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/responses") {
      response.writeHead(404).end();
      return;
    }
    const parsed = JSON.parse(body);
    const currentTurnInput = readCurrentTurnInput(parsed.input);
    const serializedInput = JSON.stringify(currentTurnInput);
    const serializedTools = JSON.stringify(parsed.tools ?? "");
    const latestUserText = readLatestUserText(currentTurnInput);
    if (serializedInput.includes('"call_id":"call_provider_probe"') && serializedInput.includes("function_call_output")) {
      writeTextResponse(response, "probe ready", "provider-probe-2");
      return;
    }
    if (serializedTools.includes("pige_provider_probe")) {
      writeToolCallResponse(response, "pige_provider_probe", "call_provider_probe", "provider-probe-1");
      return;
    }
    if (latestUserText.includes(HIGH_RISK_DENY_PROMPT) && serializedTools.includes("pige_run_command")) {
      writeToolCallResponse(response, "pige_run_command", "call_high_risk_command", "high-risk-command-1", {
        executable: process.execPath,
        args: [
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(deniedCommandSentinelPath)}, "executed")`
        ]
      });
      return;
    }
    if (serializedInput.includes('"call_id":"call_dataset_query"') && serializedInput.includes("function_call_output")) {
      writeTextResponse(response, DATASET_ANSWER, "dataset-final-1");
      return;
    }
    if (serializedInput.includes('"call_id":"call_dataset_catalog"') && serializedInput.includes("function_call_output")) {
      const catalogOutput = findFunctionCallOutput(currentTurnInput, "call_dataset_catalog");
      const refs = readDatasetCatalogRefs(catalogOutput);
      writeToolCallResponse(response, "pige_query_dataset", "call_dataset_query", "dataset-query-1", {
        action: "query",
        datasetRef: refs.datasetRef,
        tableRef: refs.tableRef,
        select: refs.columnRefs,
        orderBy: [{ by: refs.columnRefs[1] ?? refs.columnRefs[0], direction: "desc" }],
        limit: 2
      });
      return;
    }
    if (serializedInput.includes('"call_id":"call_dataset_materialize"') && serializedInput.includes("function_call_output")) {
      writeToolCallResponse(response, "pige_query_dataset", "call_dataset_catalog", "dataset-catalog-1", {
        action: "catalog"
      });
      return;
    }
    if (serializedInput.includes('"call_id":"call_dataset_source_inspect"') && serializedInput.includes("function_call_output")) {
      writeToolCallResponse(response, "pige_inspect_dataset", "call_dataset_materialize", "dataset-materialize-1");
      return;
    }
    if (latestUserText.includes(DATASET_PROMPT) && serializedTools.includes("pige_inspect_source")) {
      writeToolCallResponse(response, "pige_inspect_source", "call_dataset_source_inspect", "dataset-source-inspect-1");
      return;
    }
    if (serializedInput.includes('"call_id":"call_activity_create"') && serializedInput.includes("function_call_output")) {
      writeTextResponse(response, "The reversible knowledge note was created from the selected evidence.", "activity-final-1");
      return;
    }
    if (serializedInput.includes('"call_id":"call_activity_inspect"') && serializedInput.includes("function_call_output")) {
      writeToolCallResponse(response, "pige_create_knowledge_note", "call_activity_create", "activity-create-1", {
        title: ACTIVITY_TITLE,
        summary: {
          text: "The synthetic source proves one reversible knowledge action through the real app boundary.",
          evidenceRefs: ["ev_01"]
        },
        keyPoints: [{
          text: "Activity exposes the applied Operation and Undo preserves recoverable history.",
          evidenceRefs: ["ev_01"]
        }],
        tags: ["roundtrip"],
        topics: ["Public Alpha"],
        entities: [],
        warnings: [],
        confidence: "high"
      });
      return;
    }
    if (latestUserText.includes(ACTIVITY_PROMPT) && serializedTools.includes("pige_inspect_source")) {
      writeToolCallResponse(response, "pige_inspect_source", "call_activity_inspect", "activity-inspect-1");
      return;
    }
    if (serializedInput.includes('"call_id":"call_home_search"') && serializedInput.includes("function_call_output")) {
      writeTextResponse(response, GROUNDED_ANSWER, "home-grounded-2");
      return;
    }
    if (latestUserText.includes(GROUNDING_PROMPT)) {
      writeToolCallResponse(response, "pige_search_knowledge", "call_home_search", "home-grounded-1");
      return;
    }
    if (serializedInput.includes('"call_id":"call_source_inspect"') && serializedInput.includes("function_call_output")) {
      const markdownTurn = latestUserText.includes(MARKDOWN_PROMPT);
      writeTextResponse(response, markdownTurn ? MARKDOWN_ANSWER : SOURCE_ANSWER, markdownTurn ? "markdown-final-1" : "source-final-1");
      return;
    }
    if (serializedTools.includes("pige_inspect_source")) {
      writeToolCallResponse(response, "pige_inspect_source", "call_source_inspect", "source-inspect-1");
      return;
    }
    if (latestUserText.includes(STREAMING_API_PROMPT)) {
      await writeStreamingTextResponse(response, DIRECT_ANSWER, `home-direct-${requests.length}`, streamTiming);
      return;
    }
    writeTextResponse(response, DIRECT_ANSWER, `home-direct-${requests.length}`);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

function readLatestUserText(input) {
  if (!Array.isArray(input)) return "";
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = input[index];
    if (!item || typeof item !== "object" || item.role !== "user") continue;
    if (typeof item.content === "string") return item.content;
    if (!Array.isArray(item.content)) return "";
    return item.content
      .map((part) => part && typeof part === "object" && typeof part.text === "string" ? part.text : "")
      .join("\n");
  }
  return "";
}

function readCurrentTurnInput(input) {
  if (!Array.isArray(input)) return [];
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = input[index];
    if (item && typeof item === "object" && item.role === "user") return input.slice(index);
  }
  return input;
}

function findFunctionCallOutput(input, callId) {
  const pending = [input];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (!current || typeof current !== "object") continue;
    if (current.type === "function_call_output" && current.call_id === callId && typeof current.output === "string") {
      return current.output;
    }
    pending.push(...Object.values(current));
  }
  throw new Error(`Loopback provider could not find ${callId} output.`);
}

function readDatasetCatalogRefs(output) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Dataset catalog output is not a bounded JSON envelope.");
  const catalog = JSON.parse(output.slice(start, end + 1));
  const dataset = catalog.datasets?.[0];
  const table = dataset?.tables?.[0];
  const columnRefs = Array.isArray(table?.columns)
    ? table.columns.map((column) => column?.columnRef).filter((value) => typeof value === "string").slice(0, 2)
    : [];
  if (
    typeof dataset?.datasetRef !== "string" ||
    typeof table?.tableRef !== "string" ||
    columnRefs.length < 2
  ) {
    throw new Error("Dataset catalog did not expose one queryable two-column table.");
  }
  return { datasetRef: dataset.datasetRef, tableRef: table.tableRef, columnRefs };
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

async function writeStreamingTextResponse(response, text, suffix, timing) {
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
  let offset = 0;
  let sequence = 2;
  while (offset < text.length) {
    const nextOffset = Math.min(text.length, offset + 24);
    if (timing.firstSafeAnswerMaterialAt === undefined) timing.firstSafeAnswerMaterialAt = Date.now();
    writeResponseEvent(response, {
      type: "response.output_text.delta",
      sequence_number: sequence,
      output_index: 0,
      content_index: 0,
      item_id: initialItem.id,
      delta: text.slice(offset, nextOffset),
      logprobs: []
    });
    offset = nextOffset;
    sequence += 1;
    await new Promise((resolve) => setTimeout(resolve, 110));
  }
  writeResponseEvent(response, {
    type: "response.output_item.done",
    sequence_number: sequence,
    output_index: 0,
    item: completedItem
  });
  writeResponseEvent(response, {
    type: "response.completed",
    sequence_number: sequence + 1,
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
