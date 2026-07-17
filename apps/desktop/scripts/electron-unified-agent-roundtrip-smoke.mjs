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
const DIRECT_ANSWER = "The real Pi roundtrip is ready, and this longer answer arrives through several safe visible replacements before completion.";
const GROUNDED_ANSWER = "The roundtrip launch phrase is heliotrope seven. [1]";
const SOURCE_PROMPT = "Inspect this attachment and answer without creating a note.";
const SOURCE_ANSWER = "The preserved attachment is available to the unified Agent.";
const MARKDOWN_PROMPT = "Inspect this Markdown attachment and answer without creating a note.";
const MARKDOWN_ANSWER = "The preserved Markdown attachment is available to the unified Agent.";
const ACTIVITY_PROMPT = "Create a grounded knowledge note from this attachment.";
const ACTIVITY_TITLE = "Unified Agent activity note";
const DATASET_PROMPT = "Which person has the largest count in this attached Dataset?";
const DATASET_ANSWER = "Grace has the largest count in the attached Dataset. [D1]";
const DATASET_CITATION_REF = "citation_9";
const CONFIRM_ALLOW_PROMPT = "Complete the synthetic one-use approval check for [redacted-secret].";
const CONFIRM_ALLOW_ANSWER = "The synthetic one-use model send was approved and completed.";
const CONFIRM_LIVE_PROMPT = "Complete the synthetic same-process approval check for [redacted-secret].";
const CONFIRM_LIVE_ANSWER = "The synthetic same-process model send was approved and completed.";
const CONFIRM_DENY_PROMPT = "Complete the synthetic denial check for [redacted-secret].";
const PERMISSION_TOOL_NAME = "synthetic_external_status";
const PERMISSION_ALLOW_PROMPT = "Use the synthetic external status Skill once and report its fixed result.";
const PERMISSION_ALLOW_ANSWER = "The synthetic permissioned external action completed exactly once.";
const PERMISSION_DENY_PROMPT = "Use the synthetic external status Skill for the denial check.";
const PERMISSION_CORE_PROMPT = "Complete the synthetic core-tool-only check without external actions.";
const PERMISSION_CORE_ANSWER = "The core Pige Home tool completed without a Permission Broker prompt.";
const PERMISSION_PRIVATE_MARKER = "SYNTHETIC_PERMISSION_INPUT_MUST_NOT_PERSIST";
const PERMISSION_TOOL_RESULT = Object.freeze({
  modelText: "Synthetic external status ready.",
  details: Object.freeze({ status: "ok", receipt: "permission-smoke-v1" })
});
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
  const rootPath = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-unified-roundtrip-")));
  const userDataPath = path.join(rootPath, "user-data");
  const attachmentPath = path.join(rootPath, "unified-agent-source.txt");
  const markdownAttachmentPath = path.join(rootPath, "unified-agent-source.md");
  const activityAttachmentPath = path.join(rootPath, "unified-agent-activity.txt");
  const datasetAttachmentPath = path.join(rootPath, "unified-agent-dataset.csv");
  fs.writeFileSync(attachmentPath, "Synthetic unified Agent attachment evidence.\n", "utf8");
  fs.writeFileSync(markdownAttachmentPath, "# Synthetic Markdown evidence\n\nThe Markdown source crosses the real file ingress.\n", "utf8");
  fs.writeFileSync(activityAttachmentPath, "Synthetic reversible knowledge for Activity and Undo.\n", "utf8");
  fs.writeFileSync(datasetAttachmentPath, "name,count\nAda,3\nGrace,5\n", "utf8");
  const syntheticToken = `synthetic-${crypto.randomBytes(24).toString("hex")}`;
  const requests = [];
  const streamTiming = {};
  const server = await startProviderServer(requests, streamTiming);
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
      datasetAttachmentPath
    });
    const pending = await runChild("pending", {
      rootPath,
      userDataPath,
      baseUrl,
      syntheticToken,
      attachmentPath,
      markdownAttachmentPath,
      activityAttachmentPath,
      datasetAttachmentPath
    });
    assert.equal(requests.some((request) => request.body.includes(CONFIRM_ALLOW_PROMPT)), false);
    const reopen = await runChild("reopen", {
      rootPath,
      userDataPath,
      baseUrl,
      syntheticToken,
      attachmentPath,
      markdownAttachmentPath,
      activityAttachmentPath,
      datasetAttachmentPath
    });
    const permissionPending = await runChild("permission_pending", {
      rootPath,
      userDataPath,
      baseUrl,
      syntheticToken,
      attachmentPath,
      markdownAttachmentPath,
      activityAttachmentPath,
      datasetAttachmentPath
    });
    assert.equal(readPermissionExecutionCount(rootPath), 0);
    const permissionResolved = await runChild("permission_resolve", {
      rootPath,
      userDataPath,
      baseUrl,
      syntheticToken,
      attachmentPath,
      markdownAttachmentPath,
      activityAttachmentPath,
      datasetAttachmentPath
    });
    assert.equal(readPermissionExecutionCount(rootPath), 1);
    const permissionReopen = await runChild("permission_reopen", {
      rootPath,
      userDataPath,
      baseUrl,
      syntheticToken,
      attachmentPath,
      markdownAttachmentPath,
      activityAttachmentPath,
      datasetAttachmentPath,
      permissionAllowJobId: permissionResolved.allowJobId,
      permissionAllowRequestId: permissionResolved.allowRequestId,
      permissionDenyJobId: permissionResolved.denyJobId,
      permissionDenyRequestId: permissionResolved.denyRequestId
    });
    assert.equal(readPermissionExecutionCount(rootPath), 1);

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
    assert.equal(connect.groundedCitationsDuringDraft, false);
    assert.equal(connect.citationVisible, true);
    assert.equal(connect.sourceVisible, true);
    assert.equal(connect.markdownVisible, true);
    assert.equal(connect.activityVisible, true);
    assert.equal(connect.activityUndone, true);
    assert.equal(connect.datasetVisible, true);
    assert.equal(connect.datasetCitationVisible, true);
    assert.equal(connect.datasetImportJobCount, 1);
    assert.deepEqual(connect.failedRetryableJobClasses, []);
    assert.equal(pending.confirmationVisible, true);
    assert.equal(pending.allowOnceVisible, true);
    assert.equal(pending.denyVisible, true);
    assert.match(pending.requestId, /^egressreq_\d{8}_[a-z0-9]{16,}$/u);
    assert.match(pending.jobId, /^job_\d{8}_[a-z0-9]{8,}$/u);
    assert.equal(reopen.bindingState, "ready");
    assert.equal(reopen.runtimeState, "ready");
    assert.equal(reopen.providerProfileId, pending.providerProfileId);
    assert.equal(reopen.modelProfileId, pending.modelProfileId);
    assert.equal(reopen.providerVisible, true);
    assert.equal(reopen.directVisible, true);
    assert.equal(reopen.datasetVisible, true);
    assert.equal(reopen.datasetCitationVisible, true);
    assert.equal(reopen.activityUndoneVisible, true);
    assert.equal(reopen.confirmationRecovered, true);
    assert.equal(reopen.confirmationRequestId, pending.requestId);
    assert.equal(reopen.confirmationJobId, pending.jobId);
    assert.equal(reopen.confirmationAnswerVisible, true);
    assert.equal(reopen.confirmationJobState, "completed");
    assert.equal(reopen.liveConfirmationVisible, true);
    assert.equal(reopen.liveConfirmationAnswerVisible, true);
    assert.equal(reopen.liveConfirmationJobState, "completed");
    assert.notEqual(reopen.liveConfirmationRequestId, pending.requestId);
    assert.equal(reopen.denialVisible, true);
    assert.equal(reopen.denialJobState, "failed_final");
    assert.equal(reopen.denialErrorCode, "model_provider.egress_denied");
    assert.notEqual(reopen.denialRequestId, pending.requestId);
    assert.notEqual(reopen.denialRequestId, reopen.liveConfirmationRequestId);
    const restartedApprovalRequest = requests.find((request) =>
      request.method === "POST" && request.body.includes(CONFIRM_ALLOW_PROMPT)
    );
    const liveApprovalRequest = requests.find((request) =>
      request.method === "POST" && request.body.includes(CONFIRM_LIVE_PROMPT)
    );
    assert.ok(restartedApprovalRequest);
    assert.ok(liveApprovalRequest);
    assert.ok(restartedApprovalRequest.receivedAt >= reopen.confirmationAllowClickedAt);
    assert.ok(liveApprovalRequest.receivedAt >= reopen.liveConfirmationAllowClickedAt);
    assert.ok(requests.every((request) => !request.body.includes(CONFIRM_DENY_PROMPT)));

    assert.equal(permissionPending.confirmationVisible, true);
    assert.equal(permissionPending.allowOnceVisible, true);
    assert.equal(permissionPending.denyVisible, true);
    assert.equal(permissionPending.dtoShapeSafe, true);
    assert.equal(permissionPending.uiShapeSafe, true);
    assert.equal(permissionPending.matchingJobHidden, true);
    assert.match(permissionPending.requestId, /^permreq_\d{8}_[a-z0-9]{8,}$/u);
    assert.match(permissionPending.jobId, /^job_\d{8}_[a-z0-9]{8,}$/u);
    assert.equal(permissionResolved.recoveredRequestId, permissionPending.requestId);
    assert.equal(permissionResolved.recoveredJobId, permissionPending.jobId);
    assert.equal(permissionResolved.allowRequestId, permissionPending.requestId);
    assert.equal(permissionResolved.allowJobId, permissionPending.jobId);
    assert.equal(permissionResolved.allowAnswerVisible, true);
    assert.equal(permissionResolved.allowJobState, "completed");
    assert.equal(permissionResolved.allowPendingCleared, true);
    assert.equal(permissionResolved.allowMatchingJobHidden, true);
    assert.equal(permissionResolved.denyVisible, true);
    assert.equal(permissionResolved.denyJobState, "failed_final");
    assert.equal(permissionResolved.denyErrorCode, "permission.denied");
    assert.equal(permissionResolved.denyPendingCleared, true);
    assert.equal(permissionResolved.coreAnswerVisible, true);
    assert.equal(permissionResolved.corePermissionPromptSeen, false);
    assert.equal(permissionResolved.coreJobState, "completed");
    assert.notEqual(permissionResolved.denyRequestId, permissionPending.requestId);
    assert.notEqual(permissionResolved.denyJobId, permissionPending.jobId);
    assert.equal(permissionReopen.allowJobState, "completed");
    assert.equal(permissionReopen.denyJobState, "failed_final");
    assert.equal(permissionReopen.pendingRequestsCleared, true);
    assert.equal(permissionReopen.permissionPromptVisible, false);
    assert.equal(permissionReopen.coreAnswerVisible, true);

    const vaultPath = path.join(rootPath, "vaults", "Roundtrip Vault");
    const restartedApprovalJob = readRoundtripRecord(vaultPath, "jobs", pending.jobId);
    const liveApprovalJob = readRoundtripRecord(vaultPath, "jobs", reopen.liveConfirmationJobId);
    const denialJob = readRoundtripRecord(vaultPath, "jobs", reopen.denialJobId);
    const permissionDenialJob = readRoundtripRecord(vaultPath, "jobs", permissionResolved.denyJobId);
    assert.equal(restartedApprovalJob.state, "completed");
    assert.equal(liveApprovalJob.state, "completed");
    assert.equal(denialJob.state, "failed_final");
    assert.equal(denialJob.error?.code, "model_provider.egress_denied");
    assert.equal(permissionDenialJob.state, "failed_final");
    assert.equal(permissionDenialJob.error?.code, "permission.denied");
    const restartedApproval = readApprovalRecord(userDataPath, pending.requestId);
    const liveApproval = readApprovalRecord(userDataPath, reopen.liveConfirmationRequestId);
    const denialApproval = readApprovalRecord(userDataPath, reopen.denialRequestId);
    assert.equal(restartedApproval.state, "consumed");
    assert.equal(typeof restartedApproval.reconciledAt, "string");
    assert.equal(liveApproval.state, "consumed");
    assert.equal(typeof liveApproval.reconciledAt, "string");
    assert.equal(denialApproval.state, "denied");
    assert.equal(typeof denialApproval.reconciledAt, "string");

    const vaultManifest = JSON.parse(fs.readFileSync(path.join(vaultPath, ".pige", "manifest.json"), "utf8"));
    const allowPermissionJob = readRoundtripRecord(vaultPath, "jobs", permissionResolved.allowJobId);
    const denyPermissionJob = readRoundtripRecord(vaultPath, "jobs", permissionResolved.denyJobId);
    assert.equal(allowPermissionJob.state, "completed");
    assert.equal(denyPermissionJob.state, "failed_final");
    assert.equal(denyPermissionJob.error?.code, "permission.denied");
    const allowPermission = readPermissionBrokerRecord(
      userDataPath,
      vaultManifest.vault_id,
      "requests",
      permissionResolved.allowRequestId
    );
    const denyPermission = readPermissionBrokerRecord(
      userDataPath,
      vaultManifest.vault_id,
      "requests",
      permissionResolved.denyRequestId
    );
    const allowDecision = readPermissionBrokerRecord(
      userDataPath,
      vaultManifest.vault_id,
      "decisions",
      allowPermission.decisionId
    );
    const denyDecision = readPermissionBrokerRecord(
      userDataPath,
      vaultManifest.vault_id,
      "decisions",
      denyPermission.decisionId
    );
    assert.equal(allowPermission.state, "consumed");
    assert.equal(allowPermission.decision, "allow_once");
    assert.match(allowPermission.completionMarkerHash, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(typeof allowPermission.completedAt, "string");
    assert.equal(allowDecision.decision, "allow_once");
    assert.equal(allowDecision.scope, "once");
    assert.equal(denyPermission.state, "denied");
    assert.equal(denyPermission.decision, "deny");
    assert.equal(denyPermission.completionMarkerHash, undefined);
    assert.equal(denyDecision.decision, "deny");
    assert.equal(denyDecision.scope, "never");
    for (const record of [allowPermission, denyPermission, allowDecision, denyDecision]) {
      assertPermissionRecordBodyFree(record, {
        rootPath,
        syntheticToken,
        forbiddenMarker: PERMISSION_PRIVATE_MARKER
      });
    }

    assert.ok(requests.filter((request) => request.method === "GET" && request.path === "/v1/models").length >= 3);
    assert.ok(requests.filter((request) => request.method === "POST" && request.path === "/v1/responses").length >= 7);
    assert.ok(requests.every((request) => request.authorization === `Bearer ${syntheticToken}`));
    assert.ok(requests.every((request) => !request.body.includes(syntheticToken)));
    assert.ok(requests.some((request) => request.body.includes('"name":"pige_provider_probe"')));
    assert.ok(requests.some((request) => request.body.includes('"name":"pige_search_knowledge"')));
    assert.ok(requests.some((request) => request.body.includes('"name":"pige_finish_home_turn"')));
    assert.ok(requests.some((request) => request.body.includes('"name":"pige_inspect_source"')));
    assert.ok(requests.some((request) => request.body.includes('"name":"pige_inspect_dataset"')));
    assert.ok(requests.some((request) => request.body.includes('"name":"pige_query_dataset"')));
    assert.ok(requests.some((request) => request.body.includes('"name":"pige_create_knowledge_note"')));
    assert.ok(requests.some((request) => request.body.includes('"name":"pige_respond_to_user"')));
    assert.ok(requests.some((request) => request.body.includes(`"name":"${PERMISSION_TOOL_NAME}"`)));
    assert.ok(requests.some((request) => request.body.includes('"type":"function_call_output"')));
    assert.ok(requests.some((request) => request.body.includes(PERMISSION_ALLOW_PROMPT)));
    assert.ok(requests.some((request) => request.body.includes(PERMISSION_DENY_PROMPT)));
    assert.ok(requests.some((request) => request.body.includes(PERMISSION_CORE_PROMPT)));

    const secretsPath = path.join(userDataPath, "secrets.json");
    const secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
    const providers = JSON.parse(fs.readFileSync(path.join(userDataPath, "provider-profiles.json"), "utf8"));
    const models = JSON.parse(fs.readFileSync(path.join(userDataPath, "model-profiles.json"), "utf8"));
    assert.equal(secrets.schemaVersion, 1);
    assert.equal(secrets.secrets.length, 2);
    assert.ok(secrets.secrets.every((secret) => /^provider_secret_[a-z0-9_]+$/u.test(secret.ref)));
    assert.ok(secrets.secrets.every((secret) => secret.encryptedValue !== syntheticToken));
    assert.equal(providers.providers.length, 2);
    assert.ok(providers.providers.every((provider) =>
      secrets.secrets.some((secret) => secret.ref === provider.authSecretRef)
    ));
    assert.equal(models.defaultModelProfileId, pending.modelProfileId);
    assert.equal(findPlaintext(rootPath, syntheticToken), undefined);
    assert.equal(findPlaintext(rootPath, PERMISSION_PRIVATE_MARKER), undefined);

    console.log(
      `Electron unified Agent roundtrip OK: persisted ${connect.providerProfileId}/${connect.modelProfileId}, ` +
      `reopened binding, real Responses tool loop and ${connect.draftEventCount} safe draft replacements ` +
      `(${connect.firstDraftReceivedAt - streamTiming.firstSafeAnswerMaterialAt}ms from first safe material), ` +
      `${connect.directDraftEventCount} parsed terminal-answer replacement(s) with no presentation-only provider turn plus Enter submission, ` +
      `visible direct/cited Home, preserved-source, ` +
      `TXT/Markdown ingress, Dataset continuation, restart-adopted and live one-use model egress approvals, ` +
      `durable denial without a provider request, a restart-recovered Permission Broker allow-once action ` +
      `executed once with durable completion plus a zero-execution denial, core-tool isolation, zero retryable Jobs, ` +
      `and reversible Activity/Undo results.`
    );
    console.log(
      "Electron model-egress confirmation loopback OK: restart and live approvals were consumed and reconciled, " +
      "the denial was reconciled without a provider request, and all exact Jobs reached their expected terminal states."
    );
    console.log(
      "Electron Permission Broker loopback OK: the safe pending card survived restart, Allow once resumed the same Job " +
      "and executed one synthetic adapter action, denial executed none, a further restart replayed nothing, core Pige " +
      "tools showed no permission UI, and machine-local Broker records remained body-free."
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
      PIGE_ROUNDTRIP_MARKDOWN_ATTACHMENT_PATH: values.markdownAttachmentPath,
      PIGE_ROUNDTRIP_ACTIVITY_ATTACHMENT_PATH: values.activityAttachmentPath,
      PIGE_ROUNDTRIP_DATASET_ATTACHMENT_PATH: values.datasetAttachmentPath,
      PIGE_ROUNDTRIP_PERMISSION_ALLOW_JOB_ID: values.permissionAllowJobId ?? "none",
      PIGE_ROUNDTRIP_PERMISSION_ALLOW_REQUEST_ID: values.permissionAllowRequestId ?? "none",
      PIGE_ROUNDTRIP_PERMISSION_DENY_JOB_ID: values.permissionDenyJobId ?? "none",
      PIGE_ROUNDTRIP_PERMISSION_DENY_REQUEST_ID: values.permissionDenyRequestId ?? "none",
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
    const jobs = readSafeJobFailureSummary(values.rootPath);
    throw new Error(`${marker ?? `Electron unified Agent ${phase} phase failed at ${stage}.`} jobs=${JSON.stringify(jobs)}`);
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

function readApprovalRecord(userDataPath, requestId) {
  return readUniqueJsonByName(
    path.join(userDataPath, "model-egress", "model-egress-approvals"),
    `${requestId}.json`
  );
}

function readPermissionBrokerRecord(userDataPath, vaultId, area, recordId) {
  assert.match(vaultId, /^vault_\d{8}_[a-z0-9]{8,}$/u);
  assert.ok(area === "requests" || area === "decisions");
  return readUniqueJsonByName(
    path.join(userDataPath, "permission-broker", vaultId, area),
    `${recordId}.json`
  );
}

function assertPermissionRecordBodyFree(record, input) {
  const serialized = JSON.stringify(record);
  assert.equal(serialized.includes(input.rootPath), false);
  assert.equal(serialized.includes(input.syntheticToken), false);
  assert.equal(serialized.includes(input.forbiddenMarker), false);
  assert.equal(serialized.includes(PERMISSION_ALLOW_PROMPT), false);
  assert.equal(serialized.includes(PERMISSION_DENY_PROMPT), false);
  assert.equal(serialized.includes(PERMISSION_ALLOW_ANSWER), false);
  assert.equal(serialized.includes(PERMISSION_CORE_ANSWER), false);
  assert.equal(serialized.includes("Authorization"), false);
}

function permissionCounterPath(rootPath) {
  return path.join(rootPath, "permission-adapter-counter.json");
}

function readPermissionExecutionCount(rootPath) {
  const counterPath = permissionCounterPath(rootPath);
  if (!fs.existsSync(counterPath)) return 0;
  const record = JSON.parse(fs.readFileSync(counterPath, "utf8"));
  assert.deepEqual(Object.keys(record).sort(), ["executeCount", "schemaVersion"]);
  assert.equal(record.schemaVersion, 1);
  assert.ok(Number.isSafeInteger(record.executeCount));
  assert.ok(record.executeCount >= 0 && record.executeCount <= 8);
  return record.executeCount;
}

function incrementPermissionExecutionCount(rootPath) {
  const nextCount = readPermissionExecutionCount(rootPath) + 1;
  if (nextCount > 8) throw new Error("Synthetic permission adapter execution count exceeded its bound.");
  const counterPath = permissionCounterPath(rootPath);
  const temporaryPath = `${counterPath}.tmp-${process.pid}`;
  fs.writeFileSync(
    temporaryPath,
    `${JSON.stringify({ schemaVersion: 1, executeCount: nextCount })}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" }
  );
  fs.renameSync(temporaryPath, counterPath);
}

async function registerSyntheticPermissionAdapter(rootPath) {
  const { registerPermissionedExternalCapabilityAdapter } = await import(
    "../out/main/services/permissioned-external-capability-service.js"
  );
  registerPermissionedExternalCapabilityAdapter({
    tool: {
      name: PERMISSION_TOOL_NAME,
      label: "Synthetic external status",
      description: "Reads one fixed synthetic external status for the assembled Permission Broker smoke.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["read_status"] },
          opaqueInput: { type: "string", enum: [PERMISSION_PRIVATE_MARKER] }
        },
        required: ["action", "opaqueInput"],
        additionalProperties: false
      },
      outputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["ok"] },
          receipt: { type: "string", enum: ["permission-smoke-v1"] }
        },
        required: ["status", "receipt"],
        additionalProperties: false
      },
      effect: "read_only",
      inputTrust: "model_generated",
      outputTrust: "untrusted_source",
      dataBoundary: {
        resourceScope: "current_vault",
        pathAuthority: "host_only",
        sourceIdAuthority: "host_only",
        modelAuthority: "none"
      },
      execution: "sequential",
      idempotency: { mode: "idempotent", scope: "tool_call" },
      limits: { maxInputBytes: 1_024, maxOutputBytes: 1_024, timeoutMs: 5_000 },
      ownerService: "SyntheticPermissionSmokeService"
    },
    actor: {
      type: "skill",
      id: "skill.synthetic.permission-smoke",
      displayName: "Synthetic Permission Skill",
      version: "1.0.0",
      digest: sha256Digest("pige.synthetic.permission_skill.v1")
    },
    action: {
      id: "network.read-synthetic-status",
      version: "1",
      labelKey: "permissions.action.fetch_release_notes"
    },
    permission: {
      capability: "external_network",
      dataBoundary: "network",
      resourceScope: "current_action",
      resourceKind: "network",
      reasonCode: "external.network"
    },
    normalizeInput(args) {
      if (
        !args ||
        typeof args !== "object" ||
        Array.isArray(args) ||
        Object.keys(args).sort().join(",") !== "action,opaqueInput" ||
        args.action !== "read_status" ||
        args.opaqueInput !== PERMISSION_PRIVATE_MARKER
      ) {
        throw new Error("Synthetic permission adapter input is invalid.");
      }
      return { action: "read_status", opaqueInput: PERMISSION_PRIVATE_MARKER };
    },
    resourceIdentity() {
      return { resource: "synthetic.permission.current_action" };
    },
    resourceCount() {
      return 1;
    },
    async execute(_input, signal) {
      if (signal.aborted) throw new Error("Synthetic permission adapter was cancelled.");
      incrementPermissionExecutionCount(rootPath);
      return PERMISSION_TOOL_RESULT;
    },
    async adoptCompleted(_completionMarkerHash, _input, signal) {
      if (signal.aborted) throw new Error("Synthetic permission adapter adoption was cancelled.");
      return PERMISSION_TOOL_RESULT;
    }
  });
}

function sha256Digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value, "utf8").digest("hex")}`;
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
    markStage("permission_adapter_register");
    await registerSyntheticPermissionAdapter(rootPath);
    if (phase === "connect") {
      const helper = await import("../out/main/unified-agent-roundtrip-smoke.js");
      helper.prepareUnifiedAgentRoundtripSmoke({ rootPath, userDataPath });
    } else if (!["pending", "reopen", "permission_pending", "permission_resolve", "permission_reopen"].includes(phase)) {
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
    } else if (phase === "pending") {
      result = await runPendingConfirmationRenderer(browserWindow, { syntheticToken });
    } else if (phase === "reopen") {
      result = await runReopenRenderer(browserWindow);
    } else if (phase === "permission_pending") {
      result = await runPermissionPendingRenderer(browserWindow, { syntheticToken });
    } else if (phase === "permission_resolve") {
      result = await runPermissionResolveRenderer(browserWindow);
    } else {
      result = await runPermissionReopenRenderer(browserWindow, {
        allowJobId: requireEnv("PIGE_ROUNDTRIP_PERMISSION_ALLOW_JOB_ID"),
        allowRequestId: requireEnv("PIGE_ROUNDTRIP_PERMISSION_ALLOW_REQUEST_ID"),
        denyJobId: requireEnv("PIGE_ROUNDTRIP_PERMISSION_DENY_JOB_ID"),
        denyRequestId: requireEnv("PIGE_ROUNDTRIP_PERMISSION_DENY_REQUEST_ID")
      });
    }
    if (phase === "connect") {
      markStage("renderer_source");
      await prepareSourceRenderer(browserWindow, SOURCE_PROMPT);
      await setRendererFileInput(browserWindow, attachmentPath);
      result = { ...result, ...(await readSourceRendererResult(browserWindow, SOURCE_ANSWER, "sourceVisible")) };
      markStage("renderer_markdown");
      await prepareSourceRenderer(browserWindow, MARKDOWN_PROMPT);
      await setRendererFileInput(browserWindow, markdownAttachmentPath);
      result = { ...result, ...(await readSourceRendererResult(browserWindow, MARKDOWN_ANSWER, "markdownVisible")) };
      markStage("renderer_activity");
      await prepareSourceRenderer(browserWindow, ACTIVITY_PROMPT);
      await setRendererFileInput(browserWindow, activityAttachmentPath);
      result = { ...result, ...(await readActivityRendererResult(browserWindow)) };
      markStage("renderer_dataset");
      await prepareSourceRenderer(browserWindow, DATASET_PROMPT);
      await setRendererFileInput(browserWindow, datasetAttachmentPath);
      result = { ...result, ...(await readDatasetRendererResult(browserWindow)) };
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
      const citationVisible = await waitFor(
        () => document.querySelector(".retrieval-citations") ? true : undefined,
        "visible Home citations"
      );
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
        groundedCitationsDuringDraft: groundedTurn.citationsDuringDraft,
        citationVisible
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

async function runPendingConfirmationRenderer(browserWindow, input) {
  return browserWindow.webContents.executeJavaScript(`
    (async () => {
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
            () => Array.from(document.querySelectorAll("button.nav-item"))
              .find((item) => item.textContent?.trim() === label),
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
      const connected = await window.pige.models.addPresetProvider({
        presetId: "openai",
        apiKey: ${JSON.stringify(input.syntheticToken)}
      });
      if (connected.status === "needs_manual_model") {
        throw new Error("Synthetic OpenAI preset unexpectedly requires a manual bootstrap model.");
      }
      const cloudProvider = connected.providers.find((provider) => provider.presetId === "openai");
      const cloudModel = connected.models.find((model) =>
        model.providerProfileId === cloudProvider?.id && model.modelId === "gpt-5-mini" && model.enabled
      );
      if (!cloudProvider || !cloudModel) throw new Error("Synthetic cloud provider binding is unavailable.");
      const cloudSummary = await window.pige.models.setDefaultModel({ modelProfileId: cloudModel.id });
      if (
        cloudSummary.defaultBinding.state !== "ready" ||
        cloudSummary.defaultBinding.providerProfileId !== cloudProvider.id ||
        cloudSummary.defaultBinding.modelProfileId !== cloudModel.id
      ) {
        throw new Error("Synthetic cloud provider did not become the exact Global Default.");
      }
      await clickNav("Home");
      const composer = await waitFor(
        () => document.querySelector('textarea[aria-label="Capture or ask"]'),
        "Home composer"
      );
      setValue(composer, ${JSON.stringify(CONFIRM_ALLOW_PROMPT)});
      const send = await waitFor(
        () => document.querySelector('button[aria-label="Send"]:not(:disabled)'),
        "Home send"
      );
      send.click();
      const readyAction = await waitFor(() => {
        const button = Array.from(document.querySelectorAll(
          '.model-egress-prompt[role="group"] .model-egress-actions button:not(:disabled)'
        )).find((candidate) => candidate.textContent?.trim() === "Allow once");
        return button ? { button, prompt: button.closest(".model-egress-prompt") } : undefined;
      }, "ready model egress prompt");
      const prompt = readyAction.prompt;
      if (!prompt) throw new Error("Ready model egress prompt is unavailable.");
      const buttons = Array.from(prompt.querySelectorAll("button"));
      const jobs = await waitFor(async () => {
        const value = await window.pige.jobs.list({ states: ["waiting_model_egress"], limit: 20 });
        return value.jobs.find((job) => job.modelEgressApprovalRequestId) ?? undefined;
      }, "waiting model egress Job");
      return {
        confirmationVisible: Boolean(prompt),
        allowOnceVisible: buttons.some((button) => button.textContent?.trim() === "Allow once"),
        denyVisible: buttons.some((button) => button.textContent?.trim() === "Don't send"),
        requestId: jobs.modelEgressApprovalRequestId,
        jobId: jobs.id,
        providerProfileId: cloudProvider.id,
        modelProfileId: cloudModel.id
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

      await waitFor(() => window.pige, "preload bridge");
      mark("binding_reopen");
      const summary = await waitFor(async () => {
        const value = await window.pige.models.summary();
        return value.defaultBinding.state === "ready" ? value : undefined;
      }, "reopened provider binding");
      const runtimeStatus = await window.pige.agent.runtimeStatus();
      mark("models_reopen");
      await openSettingsSection("Models");
      const providerVisible = await waitFor(
        () => document.body.textContent?.includes(${JSON.stringify(PROVIDER_NAME)}),
        "reopened default provider"
      );
      await closeSettings();
      mark("home_reopen");
      await clickNav("Home");
      mark("model_egress_recovery_wait");
      const recoveredAction = await waitFor(() => {
        const button = Array.from(document.querySelectorAll(
          '.model-egress-prompt[role="group"] .model-egress-actions button:not(:disabled)'
        )).find((candidate) => candidate.textContent?.trim() === "Allow once");
        return button ? { button, prompt: button.closest(".model-egress-prompt") } : undefined;
      }, "ready restarted model egress prompt");
      const recoveredPrompt = recoveredAction.prompt;
      if (!recoveredPrompt) throw new Error("Restarted model egress prompt is unavailable.");
      const recoveredJob = await waitFor(async () => {
        const value = await window.pige.jobs.list({ states: ["waiting_model_egress"], limit: 20 });
        return value.jobs.find((job) => job.modelEgressApprovalRequestId) ?? undefined;
      }, "restarted waiting model egress Job");
      const confirmationAllowClickedAt = Date.now();
      recoveredAction.button.click();
      const confirmationAnswerVisible = await waitFor(
        () => document.body.textContent?.includes(${JSON.stringify(CONFIRM_ALLOW_ANSWER)}) &&
          !document.querySelector(".model-egress-prompt") ? true : undefined,
        "approved model egress answer"
      );
      const confirmationCompletedJob = await waitFor(async () => {
        const value = await window.pige.jobs.list({ limit: 100 });
        const job = value.jobs.find((candidate) => candidate.id === recoveredJob.id);
        return job?.state === "completed" ? job : undefined;
      }, "completed restarted model egress Job");
      mark("model_egress_recovery_complete");
      const composer = await waitFor(() => document.querySelector('textarea[aria-label="Capture or ask"]'), "Home composer");
      setValue(composer, ${JSON.stringify(CONFIRM_LIVE_PROMPT)});
      const liveSend = await waitFor(
        () => document.querySelector('button[aria-label="Send"]:not(:disabled)'),
        "Home live approval send"
      );
      liveSend.click();
      const liveAction = await waitFor(() => {
        const button = Array.from(document.querySelectorAll(
          '.model-egress-prompt[role="group"] .model-egress-actions button:not(:disabled)'
        )).find((candidate) => candidate.textContent?.trim() === "Allow once");
        return button ? { button, prompt: button.closest(".model-egress-prompt") } : undefined;
      }, "ready live model egress prompt");
      const liveJob = await waitFor(async () => {
        const value = await window.pige.jobs.list({ states: ["waiting_model_egress"], limit: 20 });
        return value.jobs.find((job) =>
          job.modelEgressApprovalRequestId &&
          job.modelEgressApprovalRequestId !== recoveredJob.modelEgressApprovalRequestId
        ) ?? undefined;
      }, "waiting live model egress Job");
      const liveConfirmationAllowClickedAt = Date.now();
      liveAction.button.click();
      const liveConfirmationAnswerVisible = await waitFor(
        () => document.body.textContent?.includes(${JSON.stringify(CONFIRM_LIVE_ANSWER)}) &&
          !document.querySelector(".model-egress-prompt") ? true : undefined,
        "live approved model egress answer"
      );
      const liveCompletedJob = await waitFor(async () => {
        const value = await window.pige.jobs.list({ limit: 100 });
        const job = value.jobs.find((candidate) => candidate.id === liveJob.id);
        return job?.state === "completed" ? job : undefined;
      }, "completed live model egress Job");
      setValue(composer, ${JSON.stringify(CONFIRM_DENY_PROMPT)});
      const denialSend = await waitFor(
        () => document.querySelector('button[aria-label="Send"]:not(:disabled)'),
        "Home denial send"
      );
      denialSend.click();
      const denialAction = await waitFor(() => {
        const button = Array.from(document.querySelectorAll(
          '.model-egress-prompt[role="group"] .model-egress-actions button:not(:disabled)'
        )).find((candidate) => candidate.textContent?.trim() === "Don't send");
        return button ? { button, prompt: button.closest(".model-egress-prompt") } : undefined;
      }, "ready model egress denial prompt");
      const denialPrompt = denialAction.prompt;
      if (!denialPrompt) throw new Error("Model egress denial prompt is unavailable.");
      const denialJob = await waitFor(async () => {
        const value = await window.pige.jobs.list({ states: ["waiting_model_egress"], limit: 20 });
        return value.jobs.find((job) =>
          job.modelEgressApprovalRequestId &&
          job.modelEgressApprovalRequestId !== recoveredJob.modelEgressApprovalRequestId &&
          job.modelEgressApprovalRequestId !== liveJob.modelEgressApprovalRequestId
        ) ?? undefined;
      }, "waiting model egress denial Job");
      denialAction.button.click();
      const denialVisible = await waitFor(
        () => document.body.textContent?.includes("This model send was not allowed. Your input and sources remain saved.") &&
          !document.querySelector(".model-egress-prompt") ? true : undefined,
        "durable model egress denial"
      );
      const denialTerminal = await waitFor(async () => {
        const jobs = await window.pige.jobs.list({ limit: 100 });
        const job = jobs.jobs.find((candidate) => candidate.id === denialJob.id);
        if (job?.state !== "failed_final") return undefined;
        const timeline = await window.pige.agent.conversation({ limit: 100 });
        return timeline?.latestTurn?.jobId === denialJob.id &&
          timeline.latestTurn.state === "failed_final" &&
          timeline.latestTurn.error?.code === "model_provider.egress_denied"
          ? { job, errorCode: timeline.latestTurn.error.code }
          : undefined;
      }, "failed-final denied model egress Job");
      mark("dataset_reopen_wait");
      const datasetVisible = await waitFor(
        () => {
          const answer = document.querySelector(".dataset-answer");
          return answer?.textContent?.includes(${JSON.stringify(DATASET_ANSWER)}) &&
            answer.textContent.includes("Grace") ? true : undefined;
        },
        "restarted Dataset answer"
      );
      mark("dataset_reopen_visible");
      const datasetCitationVisible = await waitFor(
        () => document.querySelector(".dataset-citations") ? true : undefined,
        "restarted Dataset citation"
      );
      mark("activity_reopen_wait");
      const activityUndone = await waitFor(async () => {
        const value = await window.pige.activity.list({ limit: 10 });
        return value.activities.find((activity) =>
          activity.targetLabel === ${JSON.stringify(ACTIVITY_TITLE)} && activity.status === "undone"
        );
      }, "restarted undone Activity");
      mark("activity_reopen_visible_wait");
      const activityUndoneVisible = await waitFor(
        () => document.querySelector('[data-activity-row-id="' + activityUndone.operationId + '"]') ? true : undefined,
        "restarted visible undone Activity"
      );
      mark("direct_reopen_wait");
      setValue(composer, ${JSON.stringify(DIRECT_PROMPT)});
      const send = await waitFor(() => document.querySelector('button[aria-label="Send"]:not(:disabled)'), "Home send");
      send.click();
      const directVisible = await waitFor(
        () => document.body.textContent?.includes(${JSON.stringify(DIRECT_ANSWER)}),
        "restarted visible Home result"
      );
      mark("direct_reopen_visible");
      return {
        bindingState: summary.defaultBinding.state,
        runtimeState: runtimeStatus.state,
        providerProfileId: summary.defaultBinding.providerProfileId,
        modelProfileId: summary.defaultBinding.modelProfileId,
        providerVisible: Boolean(providerVisible),
        directVisible: Boolean(directVisible),
        datasetVisible: Boolean(datasetVisible),
        datasetCitationVisible: Boolean(datasetCitationVisible),
        activityUndoneVisible: Boolean(activityUndoneVisible),
        confirmationRecovered: Boolean(recoveredPrompt),
        confirmationRequestId: recoveredJob.modelEgressApprovalRequestId,
        confirmationJobId: recoveredJob.id,
        confirmationAnswerVisible: Boolean(confirmationAnswerVisible),
        confirmationAllowClickedAt,
        confirmationJobState: confirmationCompletedJob.state,
        liveConfirmationVisible: Boolean(liveAction.prompt),
        liveConfirmationRequestId: liveJob.modelEgressApprovalRequestId,
        liveConfirmationJobId: liveJob.id,
        liveConfirmationAnswerVisible: Boolean(liveConfirmationAnswerVisible),
        liveConfirmationAllowClickedAt,
        liveConfirmationJobState: liveCompletedJob.state,
        denialVisible: Boolean(denialVisible),
        denialRequestId: denialJob.modelEgressApprovalRequestId,
        denialJobId: denialJob.id,
        denialJobState: denialTerminal.job.state,
        denialErrorCode: denialTerminal.errorCode
      };
    })()
  `, true);
}

async function runPermissionPendingRenderer(browserWindow, input) {
  return browserWindow.webContents.executeJavaScript(`
    (async () => {
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
            () => Array.from(document.querySelectorAll("button.nav-item"))
              .find((item) => item.textContent?.trim() === label),
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
      await clickNav("Home");
      const composer = await waitFor(
        () => document.querySelector('textarea[aria-label="Capture or ask"]'),
        "Home composer"
      );
      setValue(composer, ${JSON.stringify(PERMISSION_ALLOW_PROMPT)});
      const send = await waitFor(
        () => document.querySelector('button[aria-label="Send"]:not(:disabled)'),
        "Home permission send"
      );
      send.click();
      const prompt = await waitFor(
        () => document.querySelector('.permission-prompt[role="group"]'),
        "Permission Broker prompt"
      );
      const job = await waitFor(async () => {
        const value = await window.pige.jobs.list({ states: ["waiting_permission"], limit: 100 });
        return value.jobs.find((candidate) => candidate.permissionRequestId) ?? undefined;
      }, "waiting permission Job");
      const request = await waitFor(
        () => window.pige.permissions.pending({ requestId: job.permissionRequestId }),
        "safe pending permission DTO"
      );
      if (!request || request.requestId !== job.permissionRequestId || request.jobId !== job.id) {
        throw new Error("Pending permission DTO does not match the exact Job.");
      }
      const dtoKeys = Object.keys(request).sort().join(",");
      const expectedDtoKeys = [
        "actionLabelKey",
        "actorDisplayName",
        "actorType",
        "actorVersion",
        "capability",
        "createdAt",
        "dataBoundary",
        "jobId",
        "reasonCode",
        "requestId",
        "resourceCount",
        "resourceKind",
        "resourceScope"
      ].sort().join(",");
      const promptText = prompt.textContent ?? "";
      const buttons = Array.from(prompt.querySelectorAll("button"));
      const matchingJobHidden = !Array.from(document.querySelectorAll(".job-pill"))
        .some((pill) => pill.textContent?.includes(job.id));
      return {
        confirmationVisible: true,
        allowOnceVisible: buttons.some((button) => button.textContent?.trim() === "Allow once"),
        denyVisible: buttons.some((button) => button.textContent?.trim() === "Deny"),
        requestId: request.requestId,
        jobId: request.jobId,
        dtoShapeSafe: dtoKeys === expectedDtoKeys &&
          request.actorType === "skill" &&
          request.capability === "external_network" &&
          request.dataBoundary === "network" &&
          request.resourceScope === "current_action" &&
          request.resourceCount === 1,
        uiShapeSafe: promptText.includes("Synthetic Permission Skill") &&
          !promptText.includes(${JSON.stringify(PERMISSION_PRIVATE_MARKER)}) &&
          !promptText.includes(${JSON.stringify(input.syntheticToken)}) &&
          !promptText.includes("sha256:") &&
          !promptText.includes("Authorization"),
        matchingJobHidden
      };
    })()
  `, true);
}

async function runPermissionResolveRenderer(browserWindow) {
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
      const clickNav = async (label) => {
        let button = Array.from(document.querySelectorAll("button.nav-item"))
          .find((item) => item.textContent?.trim() === label);
        if (!button) {
          const toggle = await waitFor(() => document.querySelector("button.icon-button"), "sidebar toggle");
          toggle.click();
          button = await waitFor(
            () => Array.from(document.querySelectorAll("button.nav-item"))
              .find((item) => item.textContent?.trim() === label),
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
      const submit = async (composer, prompt) => {
        setValue(composer, prompt);
        const send = await waitFor(
          () => document.querySelector('button[aria-label="Send"]:not(:disabled)'),
          "enabled Home send"
        );
        send.click();
      };
      const pendingPermissionAction = async (excludeRequestIds = []) => {
        const prompt = await waitFor(
          () => document.querySelector('.permission-prompt[role="group"]'),
          "Permission Broker prompt"
        );
        const job = await waitFor(async () => {
          const value = await window.pige.jobs.list({ states: ["waiting_permission"], limit: 100 });
          return value.jobs.find((candidate) =>
            candidate.permissionRequestId && !excludeRequestIds.includes(candidate.permissionRequestId)
          ) ?? undefined;
        }, "waiting permission Job");
        const request = await window.pige.permissions.pending({ requestId: job.permissionRequestId });
        if (!request || request.jobId !== job.id) throw new Error("Permission request identity changed.");
        return { prompt, job, request };
      };

      mark("permission_resolve_bridge");
      await waitFor(() => window.pige, "preload bridge");
      await clickNav("Home");
      const composer = await waitFor(
        () => document.querySelector('textarea[aria-label="Capture or ask"]'),
        "Home composer"
      );
      mark("permission_resolve_recovered");
      const recovered = await pendingPermissionAction();
      const allowMatchingJobHidden = !Array.from(document.querySelectorAll(".job-pill"))
        .some((pill) => pill.textContent?.includes(recovered.job.id));
      const allow = Array.from(recovered.prompt.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Allow once" && !button.disabled);
      if (!allow) throw new Error("Recovered Permission Broker prompt has no Allow once action.");
      mark("permission_resolve_allow_click");
      allow.click();
      const allowAnswerVisible = await waitFor(
        () => document.body.textContent?.includes(${JSON.stringify(PERMISSION_ALLOW_ANSWER)}) &&
          !document.querySelector(".permission-prompt") ? true : undefined,
        "permissioned external action answer"
      );
      const allowCompletedJob = await waitFor(async () => {
        const value = await window.pige.jobs.list({ limit: 100 });
        const job = value.jobs.find((candidate) => candidate.id === recovered.job.id);
        return job?.state === "completed" ? job : undefined;
      }, "completed allowed permission Job");
      const allowPendingCleared = (await window.pige.permissions.pending({
        requestId: recovered.request.requestId
      })) === undefined;

      mark("permission_resolve_deny_submit");
      await submit(composer, ${JSON.stringify(PERMISSION_DENY_PROMPT)});
      const denied = await pendingPermissionAction([recovered.request.requestId]);
      const deny = Array.from(denied.prompt.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Deny" && !button.disabled);
      if (!deny) throw new Error("Permission Broker prompt has no Deny action.");
      mark("permission_resolve_deny_click");
      deny.click();
      mark("permission_resolve_deny_visible_wait");
      const denyVisible = await waitFor(
        () => document.body.textContent?.includes("This external action was denied. Your existing work remains saved.") &&
          !document.querySelector(".permission-prompt") ? true : undefined,
        "safe denied permission result"
      );
      mark("permission_resolve_deny_terminal_wait");
      const denyTerminal = await waitFor(async () => {
        const value = await window.pige.jobs.list({ limit: 100 });
        const job = value.jobs.find((candidate) => candidate.id === denied.job.id);
        return job?.state === "failed_final" ? job : undefined;
      }, "failed-final denied permission Job");
      const denyConversation = await waitFor(async () => {
        const timeline = await window.pige.agent.conversation({ limit: 100 });
        return timeline?.latestTurn?.jobId === denied.job.id &&
          timeline.latestTurn.state === "failed_final" &&
          timeline.latestTurn.error?.code === "permission.denied" ? timeline : undefined;
      }, "safe denied permission conversation result");
      mark("permission_resolve_deny_pending_read");
      const denyPendingCleared = (await window.pige.permissions.pending({
        requestId: denied.request.requestId
      })) === undefined;

      mark("permission_resolve_core_submit");
      let corePermissionPromptSeen = false;
      const permissionObserver = new MutationObserver(() => {
        if (document.querySelector(".permission-prompt")) corePermissionPromptSeen = true;
      });
      permissionObserver.observe(document.body, { childList: true, subtree: true });
      await submit(composer, ${JSON.stringify(PERMISSION_CORE_PROMPT)});
      const coreAnswerVisible = await waitFor(
        () => document.body.textContent?.includes(${JSON.stringify(PERMISSION_CORE_ANSWER)}) ? true : undefined,
        "core Pige tool answer"
      );
      permissionObserver.disconnect();
      if (document.querySelector(".permission-prompt")) corePermissionPromptSeen = true;
      const coreTimeline = await waitFor(async () => {
        const timeline = await window.pige.agent.conversation({ limit: 100 });
        return timeline?.latestTurn?.state === "completed" ? timeline : undefined;
      }, "completed core-tool conversation turn");
      const jobs = await window.pige.jobs.list({ limit: 100 });
      const coreJob = jobs.jobs.find((candidate) => candidate.id === coreTimeline.latestTurn.jobId);
      if (coreJob?.state !== "completed") throw new Error("Core-tool Job did not complete.");
      mark("permission_resolve_complete");
      return {
        recoveredRequestId: recovered.request.requestId,
        recoveredJobId: recovered.job.id,
        allowRequestId: recovered.request.requestId,
        allowJobId: recovered.job.id,
        allowAnswerVisible: Boolean(allowAnswerVisible),
        allowJobState: allowCompletedJob.state,
        allowPendingCleared,
        allowMatchingJobHidden,
        denyVisible: Boolean(denyVisible),
        denyRequestId: denied.request.requestId,
        denyJobId: denied.job.id,
        denyJobState: denyTerminal.state,
        denyErrorCode: denyConversation.latestTurn.error.code,
        denyPendingCleared,
        coreAnswerVisible: Boolean(coreAnswerVisible),
        corePermissionPromptSeen,
        coreJobState: coreJob.state
      };
    })()
  `, true);
}

async function runPermissionReopenRenderer(browserWindow, input) {
  return browserWindow.webContents.executeJavaScript(`
    (async () => {
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
            () => Array.from(document.querySelectorAll("button.nav-item"))
              .find((item) => item.textContent?.trim() === label),
            "navigation " + label
          );
        }
        button.click();
      };
      await waitFor(() => window.pige, "preload bridge");
      await clickNav("Home");
      const jobs = await waitFor(async () => {
        const value = await window.pige.jobs.list({ limit: 100 });
        const allow = value.jobs.find((candidate) => candidate.id === ${JSON.stringify(input.allowJobId)});
        const deny = value.jobs.find((candidate) => candidate.id === ${JSON.stringify(input.denyJobId)});
        return allow && deny ? { allow, deny } : undefined;
      }, "reopened permission Jobs");
      const pendingAllow = await window.pige.permissions.pending({
        requestId: ${JSON.stringify(input.allowRequestId)}
      });
      const pendingDeny = await window.pige.permissions.pending({
        requestId: ${JSON.stringify(input.denyRequestId)}
      });
      const coreAnswerVisible = await waitFor(
        () => document.body.textContent?.includes(${JSON.stringify(PERMISSION_CORE_ANSWER)}) ? true : undefined,
        "reopened core-tool answer"
      );
      return {
        allowJobState: jobs.allow.state,
        denyJobState: jobs.deny.state,
        pendingRequestsCleared: pendingAllow === undefined && pendingDeny === undefined,
        permissionPromptVisible: Boolean(document.querySelector(".permission-prompt")),
        coreAnswerVisible: Boolean(coreAnswerVisible)
      };
    })()
  `, true);
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

async function readSourceRendererResult(browserWindow, expectedAnswer, resultKey) {
  return browserWindow.webContents.executeJavaScript(`
    (async () => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < 45000) {
        const answer = document.querySelector('.retrieval-answer');
        const completed = document.querySelector('.agent-run-state.state-completed');
        if (answer?.textContent?.includes(${JSON.stringify(expectedAnswer)}) && completed) {
          return { [${JSON.stringify(resultKey)}]: true };
        }
        const failed = document.querySelector('.agent-run-state.state-failed');
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
      const row = await waitFor(
        () => document.querySelector('[data-activity-row-id="' + activity.operationId + '"]'),
        "visible Activity row"
      );
      const undo = row.querySelector('[data-activity-undo-id="' + activity.operationId + '"]:not(:disabled)');
      if (!undo) throw new Error("Visible Activity is missing its bounded Undo action.");
      undo.click();
      await waitFor(async () => {
        const value = await window.pige.activity.list({ limit: 10 });
        return value.activities.find((candidate) =>
          candidate.operationId === activity.operationId && candidate.status === "undone"
        );
      }, "durable Activity Undo");
      await waitFor(
        () => {
          const current = document.querySelector('[data-activity-row-id="' + activity.operationId + '"]');
          return current && !current.querySelector('[data-activity-undo-id]') ? true : undefined;
        },
        "visible undone Activity"
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
          mark("dataset_" + parentState + "_" + childState);
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
        failedRetryableJobClasses: settledJobs
          .filter((job) => job.state === "failed_retryable")
          .map((job) => job.class)
          .sort()
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

async function startProviderServer(requests, streamTiming) {
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
    const serializedInput = JSON.stringify(parsed.input ?? "");
    const serializedTools = JSON.stringify(parsed.tools ?? "");
    const latestUserText = readLatestUserText(parsed.input);
    if (serializedInput.includes('"call_id":"call_provider_probe"') && serializedInput.includes("function_call_output")) {
      writeTextResponse(response, "probe ready", "provider-probe-2");
      return;
    }
    if (serializedTools.includes("pige_provider_probe")) {
      writeToolCallResponse(response, "pige_provider_probe", "call_provider_probe", "provider-probe-1");
      return;
    }
    if (
      serializedInput.includes('"call_id":"call_permission_allow"') &&
      serializedInput.includes("function_call_output")
    ) {
      writeToolCallResponse(response, "pige_finish_home_turn", "call_permission_allow_finish", "permission-allow-finish", {
        answer: PERMISSION_ALLOW_ANSWER,
        citationRefs: [],
        grounding: "general"
      });
      return;
    }
    if (
      latestUserText.includes(PERMISSION_ALLOW_PROMPT) &&
      serializedTools.includes(PERMISSION_TOOL_NAME)
    ) {
      writeToolCallResponse(response, PERMISSION_TOOL_NAME, "call_permission_allow", "permission-allow", {
        action: "read_status",
        opaqueInput: PERMISSION_PRIVATE_MARKER
      });
      return;
    }
    if (
      latestUserText.includes(PERMISSION_DENY_PROMPT) &&
      serializedTools.includes(PERMISSION_TOOL_NAME)
    ) {
      writeToolCallResponse(response, PERMISSION_TOOL_NAME, "call_permission_deny", "permission-deny", {
        action: "read_status",
        opaqueInput: PERMISSION_PRIVATE_MARKER
      });
      return;
    }
    if (serializedInput.includes('"call_id":"call_dataset_query"') && serializedInput.includes("function_call_output")) {
      writeToolCallResponse(response, "pige_finish_home_turn", "call_dataset_finish", "dataset-finish-1", {
        answer: DATASET_ANSWER,
        citationRefs: [DATASET_CITATION_REF],
        grounding: "local_knowledge"
      });
      return;
    }
    if (serializedInput.includes('"call_id":"call_dataset_catalog"') && serializedInput.includes("function_call_output")) {
      const catalogOutput = findFunctionCallOutput(parsed.input, "call_dataset_catalog");
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
    if (latestUserText.includes(DATASET_PROMPT) && serializedTools.includes("pige_query_dataset")) {
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
      writeToolCallResponse(response, "pige_finish_home_turn", "call_home_finish_grounded", "home-grounded-2", {
        answer: GROUNDED_ANSWER,
        citationRefs: ["citation_1"],
        grounding: "local_knowledge"
      });
      return;
    }
    if (latestUserText.includes(GROUNDING_PROMPT)) {
      writeToolCallResponse(response, "pige_search_knowledge", "call_home_search", "home-grounded-1");
      return;
    }
    if (serializedInput.includes('"call_id":"call_source_inspect"') && serializedInput.includes("function_call_output")) {
      const markdownTurn = latestUserText.includes(MARKDOWN_PROMPT);
      writeToolCallResponse(response, "pige_respond_to_user", "call_source_respond", markdownTurn ? "markdown-respond-1" : "source-respond-1", {
        answer: markdownTurn ? MARKDOWN_ANSWER : SOURCE_ANSWER,
        evidenceRefs: ["ev_01"]
      });
      return;
    }
    if (serializedTools.includes("pige_inspect_source")) {
      writeToolCallResponse(response, "pige_inspect_source", "call_source_inspect", "source-inspect-1");
      return;
    }
    const directArgs = {
      answer: latestUserText.includes(CONFIRM_ALLOW_PROMPT)
        ? CONFIRM_ALLOW_ANSWER
        : latestUserText.includes(CONFIRM_LIVE_PROMPT)
          ? CONFIRM_LIVE_ANSWER
          : latestUserText.includes(PERMISSION_CORE_PROMPT)
            ? PERMISSION_CORE_ANSWER
            : DIRECT_ANSWER,
      citationRefs: [],
      grounding: "general"
    };
    if (latestUserText.includes(STREAMING_API_PROMPT)) {
      await writeStreamingToolCallResponse(
        response,
        "pige_finish_home_turn",
        `call_home_finish_${requests.length}`,
        `home-direct-${requests.length}`,
        directArgs,
        streamTiming
      );
      return;
    }
    writeToolCallResponse(
      response,
      "pige_finish_home_turn",
      `call_home_finish_${requests.length}`,
      `home-direct-${requests.length}`,
      directArgs
    );
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

async function writeStreamingToolCallResponse(response, name, callId, suffix, args, timing) {
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
  let offset = 0;
  let sequence = 2;
  while (offset < argumentsJson.length) {
    const nextOffset = Math.min(argumentsJson.length, offset + 28);
    const delta = argumentsJson.slice(offset, nextOffset);
    if (
      timing.firstSafeAnswerMaterialAt === undefined &&
      nextOffset > '{"answer":"'.length
    ) {
      timing.firstSafeAnswerMaterialAt = Date.now();
    }
    writeResponseEvent(response, {
      type: "response.function_call_arguments.delta",
      sequence_number: sequence,
      output_index: 0,
      item_id: item.id,
      delta
    });
    offset = nextOffset;
    sequence += 1;
    await new Promise((resolve) => setTimeout(resolve, 110));
  }
  writeResponseEvent(response, {
    type: "response.function_call_arguments.done",
    sequence_number: sequence,
    output_index: 0,
    item_id: item.id,
    name,
    arguments: argumentsJson
  });
  writeResponseEvent(response, {
    type: "response.output_item.done",
    sequence_number: sequence + 1,
    output_index: 0,
    item
  });
  writeResponseEvent(response, {
    type: "response.completed",
    sequence_number: sequence + 2,
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

async function writeStreamingTextResponse(response, text, suffix) {
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
