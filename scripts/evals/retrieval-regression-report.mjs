import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturePath = path.join(root, "tests/fixtures/evals/retrieval/retrieval-golden.v1.json");
const testPath = "tests/evals/retrieval.regression-golden.test.ts";
const platform = safeSegment(process.env.PIGE_REPORT_PLATFORM ?? `${process.platform}-${process.arch}`, "platform");
const buildId = safeSegment(process.env.PIGE_REPORT_BUILD_ID ?? "local", "build ID");
const reportPath = path.join(
  root,
  "artifacts/test-reports/retrieval-regression",
  platform,
  buildId,
  "report.json"
);

fs.mkdirSync(path.dirname(reportPath), { recursive: true, mode: 0o700 });
fs.rmSync(reportPath, { force: true });

const vitestPath = path.join(root, "node_modules/vitest/vitest.mjs");
if (!fs.existsSync(vitestPath)) {
  throw new Error("Vitest is unavailable. Run npm ci before generating the retrieval report.");
}

const testRun = spawnSync(process.execPath, [vitestPath, "run", testPath], {
  cwd: root,
  env: {
    ...process.env,
    PIGE_RETRIEVAL_REPORT_PATH: reportPath
  },
  stdio: "inherit"
});
if (testRun.status !== 0) {
  process.exit(testRun.status ?? 1);
}
if (!fs.existsSync(reportPath)) {
  throw new Error("Retrieval regression test passed without producing its report.");
}

const reportBytes = fs.readFileSync(reportPath);
if (reportBytes.byteLength >= 16 * 1024) {
  throw new Error(`Retrieval report exceeds the 16 KiB limit: ${reportBytes.byteLength} bytes.`);
}

const reportText = reportBytes.toString("utf8");
const report = JSON.parse(reportText);
assertCanonicalReport(report, reportText);
assertBodyFree(report);

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
for (const sentinel of fixture.privateSentinels ?? []) {
  if (reportText.includes(sentinel)) throw new Error("Retrieval report contains a private fixture sentinel.");
}

const relativeReportPath = path.relative(root, reportPath).split(path.sep).join("/");
const digest = crypto.createHash("sha256").update(reportBytes).digest("hex");
console.log(`Retrieval regression report OK: ${relativeReportPath} (${reportBytes.byteLength} bytes, sha256:${digest})`);

function safeSegment(value, label) {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(value) || value === "." || value === "..") {
    throw new Error(`Retrieval report ${label} must be a safe path segment.`);
  }
  return value;
}

function assertCanonicalReport(report, reportText) {
  const expectedMetrics = {
    topResultAccuracy: 1,
    citationCoverage: 1,
    unsupportedCitationCount: 0,
    knownDistractorTop1Count: 0,
    relatedPageRecall: 1,
    insufficientEvidenceAccuracy: 1
  };
  assertExactKeys(
    report,
    ["schemaVersion", "fixtureId", "fixtureVersion", "metrics", "queryCases", "relatedCases"],
    "report"
  );
  if (report?.schemaVersion !== 1 || report.fixtureId !== "retrieval-regression-golden-v1" || report.fixtureVersion !== "1.0.0") {
    throw new Error("Retrieval report identity does not match the governed v1 fixture.");
  }
  assertExactKeys(report.metrics, Object.keys(expectedMetrics), "metrics");
  if (JSON.stringify(report.metrics) !== JSON.stringify(expectedMetrics)) {
    throw new Error("Retrieval report metrics do not meet the governed deterministic thresholds.");
  }
  if (!Array.isArray(report.queryCases) || !Array.isArray(report.relatedCases)) {
    throw new Error("Retrieval report is missing deterministic case summaries.");
  }
  for (const [index, queryCase] of report.queryCases.entries()) {
    assertExactKeys(
      queryCase,
      ["id", "topPageId", "resultPageIds", "citationPageIds", "confidence", "warnings"],
      `queryCases[${index}]`,
      ["topPageId"]
    );
    assertToken(queryCase.id, `queryCases[${index}].id`);
    if (queryCase.topPageId !== undefined) assertToken(queryCase.topPageId, `queryCases[${index}].topPageId`);
    assertTokenArray(queryCase.resultPageIds, `queryCases[${index}].resultPageIds`);
    assertTokenArray(queryCase.citationPageIds, `queryCases[${index}].citationPageIds`);
    if (!["grounded", "limited", "insufficient"].includes(queryCase.confidence)) {
      throw new Error(`Retrieval report contains invalid confidence in queryCases[${index}].`);
    }
    assertTokenArray(queryCase.warnings, `queryCases[${index}].warnings`);
  }
  for (const [index, relatedCase] of report.relatedCases.entries()) {
    assertExactKeys(
      relatedCase,
      ["id", "outgoingPageIds", "backlinkPageIds"],
      `relatedCases[${index}]`
    );
    assertToken(relatedCase.id, `relatedCases[${index}].id`);
    assertTokenArray(relatedCase.outgoingPageIds, `relatedCases[${index}].outgoingPageIds`);
    assertTokenArray(relatedCase.backlinkPageIds, `relatedCases[${index}].backlinkPageIds`);
  }
  if (reportText !== `${JSON.stringify(report, null, 2)}\n`) {
    throw new Error("Retrieval report is not canonically formatted.");
  }
}

function assertExactKeys(value, allowedKeys, label, optionalKeys = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Retrieval report ${label} must be an object.`);
  }
  const keys = Object.keys(value);
  const allowed = new Set(allowedKeys);
  const optional = new Set(optionalKeys);
  for (const key of keys) {
    if (!allowed.has(key)) throw new Error(`Retrieval report ${label} contains undeclared field: ${key}.`);
  }
  for (const key of allowed) {
    if (!optional.has(key) && !Object.hasOwn(value, key)) {
      throw new Error(`Retrieval report ${label} is missing field: ${key}.`);
    }
  }
}

function assertTokenArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`Retrieval report ${label} must be an array.`);
  for (const [index, item] of value.entries()) assertToken(item, `${label}[${index}]`);
}

function assertToken(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw new Error(`Retrieval report ${label} must be a bounded identifier token.`);
  }
}

function assertBodyFree(value, key = "report") {
  const forbiddenKeys = new Set([
    "body",
    "pagePath",
    "title",
    "query",
    "snippets",
    "prompt",
    "response",
    "rawPrompt",
    "rawModelResponse"
  ]);
  if (Array.isArray(value)) {
    for (const item of value) assertBodyFree(item, key);
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      if (forbiddenKeys.has(childKey)) throw new Error(`Retrieval report contains forbidden field: ${childKey}.`);
      assertBodyFree(childValue, childKey);
    }
    return;
  }
  if (typeof value === "string" && (path.posix.isAbsolute(value) || path.win32.isAbsolute(value))) {
    throw new Error(`Retrieval report contains an absolute path in ${key}.`);
  }
}
