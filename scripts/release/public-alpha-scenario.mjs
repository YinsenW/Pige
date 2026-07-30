import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  assertGeneratedReportEnvelope,
  assertSafeReportSegment,
  writeGeneratedReport
} from "../verify/generated-report-contract.mjs";

export const PUBLIC_ALPHA_SCENARIO_RECIPE = "tests/fixtures/public-alpha/public-alpha-scenario.v1.json";
export const PUBLIC_ALPHA_OBSERVATION_SCHEMA_VERSION = 1;
const HARNESS_COMMAND = "smoke:unified-agent-roundtrip";
const REQUIRED_KINDS = new Set([
  "text", "url", "markdown_file", "plain_text_file", "pdf_file", "docx_file", "pptx_file",
  "image_file", "csv_file", "xlsx_file", "sqlite_file"
]);
const CHECK_IDS = [
  "capture", "parse", "ocr", "home_retrieval", "note_agent", "selection_action",
  "autonomous_write_undo", "exceptional_proposal", "memory", "restart_recovery",
  "backup_restore", "post_restore_search"
];

export function publicAlphaScenarioReportPath(root, platform, buildId) {
  assertSafeReportSegment(platform, "platform");
  assertSafeReportSegment(buildId, "build ID");
  return path.join(root, "artifacts", "release-evidence", "v0.1", "public-alpha-usability", platform, buildId, "scenario-report.json");
}

export function assertPublicAlphaObservation(observation) {
  if (!observation || observation.schemaVersion !== PUBLIC_ALPHA_OBSERVATION_SCHEMA_VERSION ||
      observation.scenarioId !== "public-alpha.mixed-25.v1" || !Array.isArray(observation.sourceRecords) ||
      !/^rel003_[a-z0-9]{16,64}$/u.test(observation.runId ?? "") ||
      !Array.isArray(observation.sourcePages) || !Array.isArray(observation.inputAdoptions) ||
      !Array.isArray(observation.knowledgePageIds) || !Array.isArray(observation.jobs) ||
      !Array.isArray(observation.parse?.sourceIds) || !Array.isArray(observation.ocr?.sourceIds) ||
      !Array.isArray(observation.restart?.sourceIds) || !Array.isArray(observation.restore?.sourceIds) ||
      !Array.isArray(observation.restore?.pageIds) || !Array.isArray(observation.search?.pageIds)) {
    throw new Error("Public Alpha scenario observation shape is invalid.");
  }
  assertOpaqueIds(observation.sourceRecords.map((item) => item.id), /^src_\d{8}_[a-z0-9]{8,}$/u, "source");
  assertOpaqueIds(observation.sourcePages.map((item) => item.id), /^page_\d{8}_[a-z0-9]{8,}$/u, "page");
  assertOpaqueIds(observation.knowledgePageIds, /^page_\d{8}_[a-z0-9]{8,}$/u, "knowledge page");
  assertOpaqueIds(observation.jobs.map((item) => item.id), /^job_\d{8}_[a-z0-9]{8,}$/u, "job");
  for (const adoption of observation.inputAdoptions) {
    if (!/^[a-z][a-z0-9_-]{2,63}$/u.test(adoption?.caseId ?? "") ||
        !/^[a-z][a-z0-9_-]{2,63}$/u.test(adoption?.inputKind ?? "") ||
        !observation.sourceRecords.some((item) => item.id === adoption.sourceId) ||
        !observation.sourcePages.some((item) => item.id === adoption.pageId) ||
        !observation.jobs.some((item) => item.id === adoption.jobId) ||
        !Array.isArray(adoption.artifactKinds)) {
      throw new Error("Public Alpha scenario contains an invalid observed input adoption.");
    }
  }
  if (JSON.stringify(observation).match(/(?:\/Users\/|file:\/\/|api[_-]?key|prompt|provider|sourceBody|absolutePath)/iu)) {
    throw new Error("Public Alpha scenario observation contains a private or body-bearing field.");
  }
}

export function derivePublicAlphaReport(observation, metadata) {
  assertPublicAlphaObservation(observation);
  const sourceIds = observation.sourceRecords.map((item) => item.id);
  const pageIds = observation.sourcePages.map((item) => item.id);
  const jobIds = observation.jobs.map((item) => item.id);
  const sourceKinds = new Map();
  for (const item of observation.sourceRecords) sourceKinds.set(item.kind, (sourceKinds.get(item.kind) ?? 0) + 1);
  const adoptionKinds = new Set(observation.inputAdoptions.map((item) => item.inputKind));
  const distinctAdoptions = new Set(observation.inputAdoptions.map((item) => item.caseId));
  const adoptedSourceIds = observation.inputAdoptions.map((item) => item.sourceId);
  const adoptedPageIds = observation.inputAdoptions.map((item) => item.pageId);
  const checks = [
    check("capture", sourceIds.length >= 25 && new Set(sourceIds).size === sourceIds.length &&
      pageIds.length >= 25 && new Set(pageIds).size === pageIds.length &&
      observation.inputAdoptions.length >= 25 && distinctAdoptions.size === observation.inputAdoptions.length &&
      new Set(adoptedSourceIds).size === adoptedSourceIds.length && sameSet(adoptedSourceIds, sourceIds) &&
      new Set(adoptedPageIds).size === adoptedPageIds.length && sameSet(adoptedPageIds, pageIds) &&
      [...REQUIRED_KINDS].every((kind) => sourceKinds.has(kind)) &&
      ["typed_text", "large_paste", "text_pdf", "image_pdf"].every((kind) => adoptionKinds.has(kind))),
    check("parse", observation.parse.sourceIds.length >= 2 && observation.parse.artifactCount >= 4 &&
      observation.parse.childJobIds.every((id) => jobIds.includes(id))),
    check("ocr", observation.ocr.sourceIds.length >= 2 && observation.ocr.artifactCount >= 4 &&
      observation.ocr.childJobIds.every((id) => jobIds.includes(id))),
    check("home_retrieval", observedWorkflow(observation.homeRetrieval, jobIds) &&
      observation.homeRetrieval.citationPageIds.length > 0 &&
      observation.homeRetrieval.citationPageIds.every((id) => observation.knowledgePageIds.includes(id))),
    check("note_agent", observedWorkflow(observation.noteAgent, jobIds)),
    check("selection_action", observedWorkflow(observation.selectionAction, jobIds) &&
      typeof observation.selectionAction.action === "string"),
    check("autonomous_write_undo", observation.autonomousWriteUndo?.writeStatus === "applied" &&
      observation.autonomousWriteUndo?.undoStatus === "undone" &&
      /^op_\d{8}_[a-z0-9]{8,}$/u.test(observation.autonomousWriteUndo?.operationId ?? "")),
    check("exceptional_proposal", observedWorkflow(observation.exceptionalProposal, jobIds) &&
      /^proposal_\d{8}_[a-z0-9]{8,}$/u.test(observation.exceptionalProposal?.proposalId ?? "") &&
      ["applied", "rejected"].includes(observation.exceptionalProposal?.decisionStatus)),
    check("memory", observedWorkflow(observation.memory, jobIds) &&
      /^memory_\d{8}_[a-z0-9]{8,}$/u.test(observation.memory?.memoryId ?? "")),
    check("restart_recovery", observation.degradedRecovery.events?.length >= 2 &&
      observation.degradedRecovery.events[0]?.status === "rejected" &&
      observation.degradedRecovery.events.at(-1)?.status === "completed" &&
      observation.degradedRecovery.events.every((event) => event.jobId === observation.degradedRecovery.jobId) &&
      observation.degradedRecovery.events.every((event, index, events) =>
        index === 0 || Date.parse(events[index - 1].observedAt) < Date.parse(event.observedAt)) &&
      observation.restart.sourceIds.length === sourceIds.length &&
      sameSet(observation.restart.sourceIds, sourceIds) && observation.restart.duplicateSourceIds.length === 0 &&
      observation.restart.duplicateJobIds.length === 0 && observation.restart.replayedEffectIds.length === 0 &&
      observation.restart.adoptedEffectIds.length > 0),
    check("backup_restore", observation.backup.status === "created" &&
      observation.backup.sourceCount === sourceIds.length && observation.restore.status === "restored" &&
      observation.restore.destinationPreviouslyExisted === false &&
      observation.restore.sourceVaultId !== observation.restore.resultVaultId &&
      sameSet(observation.restore.sourceIds, sourceIds) && sameSet(observation.restore.pageIds, pageIds) &&
      observation.restore.resolvedPageIds.length > 0 &&
      observation.restore.resolvedPageIds.every((id) => observation.restore.pageIds.includes(id))),
    check("post_restore_search", observation.search.status === "completed" &&
      observation.search.mode === "lexical_sqlite_fts" && observation.search.pageIds.length > 0 &&
      sameSet(observation.search.pageIds, observation.restore.resolvedPageIds) &&
      observation.search.pageIds.every((id) => observation.restore.pageIds.includes(id)))
  ];
  const allTerminal = observation.jobs.every((item) => ["completed", "completed_with_warnings"].includes(item.state));
  const passed = checks.every((item) => item.status === "passed") && allTerminal;
  return {
    schemaVersion: 1,
    status: passed ? "passed" : "failed",
    generatedAt: metadata.generatedAt,
    recipe: PUBLIC_ALPHA_SCENARIO_RECIPE,
    recipeSha256: metadata.recipeSha256,
    platform: metadata.platform,
    buildId: metadata.buildId,
    ...(metadata.release ? { release: metadata.release } : {}),
    runId: observation.runId,
    observationSha256: metadata.observationSha256,
    scenarioId: observation.scenarioId,
    sourceCounts: {
      total: sourceIds.length,
      byKind: [...sourceKinds].sort(([left], [right]) => left.localeCompare(right))
        .map(([kind, count]) => ({ kind, count }))
    },
    generatedPageCount: pageIds.length,
    checks,
    degradedJobs: [{ id: observation.degradedRecovery.jobId, status: "recovered" }],
    warnings: observation.warnings,
    backupManifestSummary: {
      status: observation.backup.status === "created" ? "verified" : "failed",
      sourceCount: observation.backup.sourceCount,
      fileCount: observation.backup.fileCount
    },
    restoreResult: {
      status: observation.restore.status === "restored" ? "verified" : "failed",
      sourceCount: observation.restore.sourceIds.length
    },
    aiEvalSummary: {
      status: checks.at(-1).status === "passed" ? "verified" : "failed",
      groundedRetrievalChecks: observation.homeRetrieval.citationPageIds.length + observation.search.pageIds.length
    },
    unresolvedIssues: passed ? [] : checks.filter((item) => item.status !== "passed").map((item) => item.id)
  };
}

export function assertPublicAlphaScenarioReport(report) {
  assertGeneratedReportEnvelope(report, PUBLIC_ALPHA_SCENARIO_RECIPE);
  if (!CHECK_IDS.every((id, index) => report.checks?.[index]?.id === id) ||
      (report.status === "passed") !== (report.checks.every((item) => item.status === "passed") &&
        report.unresolvedIssues.length === 0)) {
    throw new Error("Public Alpha scenario report status is inconsistent.");
  }
}

export function runPublicAlphaScenario(options = {}) {
  const root = options.root ?? process.cwd();
  const platform = options.platform ?? process.env.PIGE_REPORT_PLATFORM ?? `${process.platform}-${process.arch}`;
  const buildId = options.buildId ?? resolveBuildId(root);
  const release = resolveReleaseIdentity(buildId);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-public-alpha-observation-"));
  const observationPath = path.join(temporaryRoot, "observation.json");
  try {
    const runHarness = options.runHarness ?? runScenarioHarness;
    runHarness(root, observationPath);
    const observation = JSON.parse(fs.readFileSync(observationPath, "utf8"));
    const observationSha256 = crypto.createHash("sha256").update(fs.readFileSync(observationPath)).digest("hex");
    const report = derivePublicAlphaReport(observation, {
      platform,
      buildId,
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      observationSha256,
      release,
      recipeSha256: crypto.createHash("sha256")
        .update(fs.readFileSync(path.join(root, PUBLIC_ALPHA_SCENARIO_RECIPE))).digest("hex")
    });
    assertPublicAlphaScenarioReport(report);
    const reportPath = publicAlphaScenarioReportPath(root, platform, buildId);
    writeGeneratedReport(root, reportPath, report);
    return { report, reportPath };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function resolveReleaseIdentity(buildId) {
  const tag = process.env.PIGE_RELEASE_TAG;
  const commit = process.env.PIGE_RELEASE_COMMIT;
  if (tag === undefined && commit === undefined) return undefined;
  if (!/^v0\.[1-9]\d*\.\d+-alpha\.[1-9]\d*$/u.test(tag ?? "") ||
      !/^[a-f0-9]{40}$/u.test(commit ?? "") || commit !== buildId) {
    throw new Error("Public Alpha release identity is incomplete or does not match the build.");
  }
  return { tag, commit, buildId };
}

function runScenarioHarness(root, observationPath) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const harnessNonce = `rel003h_${crypto.randomBytes(16).toString("hex")}`;
  const result = spawnSync(command, ["run", HARNESS_COMMAND], {
    cwd: root,
    env: {
      ...process.env,
      PIGE_PUBLIC_ALPHA_OBSERVATION_PATH: observationPath,
      PIGE_PUBLIC_ALPHA_HARNESS_NONCE: harnessNonce
    },
    stdio: "inherit",
    timeout: 30 * 60_000,
    windowsHide: true
  });
  if (result.error || result.signal !== null || result.status !== 0 || !fs.existsSync(observationPath)) {
    throw new Error("Public Alpha real scenario harness did not produce a valid observation artifact.");
  }
  const observation = JSON.parse(fs.readFileSync(observationPath, "utf8"));
  if (observation.harness !== "electron_roundtrip" || observation.harnessNonce !== harnessNonce) {
    throw new Error("Public Alpha observation was not emitted by the invoked Electron scenario.");
  }
}

function assertOpaqueIds(ids, pattern, kind) {
  if (ids.some((id) => typeof id !== "string" || !pattern.test(id)) ||
      new Set(ids).size !== ids.length) {
    throw new Error(`Public Alpha observation contains invalid ${kind} identities.`);
  }
}

function check(id, passed) { return { id, status: passed ? "passed" : "failed" }; }
function sameSet(left, right) { return left.length === right.length && left.every((value) => right.includes(value)); }
function observedWorkflow(value, jobIds) {
  return value?.status === "completed" && typeof value.conversationId === "string" &&
    typeof value.eventId === "string" && jobIds.includes(value.jobId);
}

function resolveBuildId(root) {
  if (process.env.PIGE_REPORT_BUILD_ID) return process.env.PIGE_REPORT_BUILD_ID;
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 10_000 });
  const buildId = result.status === 0 ? result.stdout.trim() : "";
  if (!/^[a-f0-9]{40}$/u.test(buildId)) throw new Error("Public Alpha scenario could not resolve a safe build ID.");
  return buildId;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const { report, reportPath } = runPublicAlphaScenario();
  console.log(`Public Alpha scenario ${report.status}: ${path.relative(process.cwd(), reportPath).split(path.sep).join("/")}.`);
  if (report.status !== "passed") process.exitCode = 1;
}
