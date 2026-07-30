import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPublicAlphaScenarioReport } from "./public-alpha-scenario.mjs";
import { assertGeneratedReportEnvelope } from "../verify/generated-report-contract.mjs";

export const PUBLIC_ALPHA_REPORT_NAME = "public-alpha-scenario-report.json";
export const LOCAL_SCALE_REPORT_NAME = "local-database-scale-report.json";

export function validateReleaseEvidenceBundle({ tag, commit, buildId, publicAlphaReport, localScaleReport }) {
  assertReleaseIdentity(tag, commit, buildId);
  assertPublicAlphaScenarioReport(publicAlphaReport);
  assertGeneratedReportEnvelope(localScaleReport, "pige-local-database-scale-v1");
  for (const [label, report] of [["Public Alpha", publicAlphaReport], ["local scale", localScaleReport]]) {
    if (report.status !== "passed" || report.platform !== "macos-arm64" || report.buildId !== buildId ||
        report.release?.tag !== tag || report.release?.commit !== commit || report.release?.buildId !== buildId) {
      throw new Error(`${label} release evidence is failed, stale, or bound to another candidate.`);
    }
  }
  if (publicAlphaReport.sourceCounts?.total < 25 || publicAlphaReport.unresolvedIssues?.length !== 0 ||
      localScaleReport.fixture?.pageCount !== 10_000 ||
      localScaleReport.fixture?.expectedChunkCount !== 100_000 ||
      localScaleReport.index?.pageRowCount !== 10_000 || localScaleReport.index?.chunkRowCount !== 100_000) {
    throw new Error("Release evidence does not satisfy the frozen Public Alpha and local-scale bounds.");
  }
  return { publicAlphaReport, localScaleReport };
}

export function stageReleaseEvidenceBundle(options) {
  const directory = bindDirectory(options.directory);
  const publicAlphaReport = readReport(options.publicAlphaReportPath);
  const localScaleReport = readReport(options.localScaleReportPath);
  validateReleaseEvidenceBundle({ ...options, publicAlphaReport, localScaleReport });
  writeExclusive(path.join(directory, PUBLIC_ALPHA_REPORT_NAME), options.publicAlphaReportPath);
  writeExclusive(path.join(directory, LOCAL_SCALE_REPORT_NAME), options.localScaleReportPath);
}

export function verifyStagedReleaseEvidenceBundle(options) {
  const directory = bindDirectory(options.directory);
  return validateReleaseEvidenceBundle({
    ...options,
    publicAlphaReport: readReport(path.join(directory, PUBLIC_ALPHA_REPORT_NAME)),
    localScaleReport: readReport(path.join(directory, LOCAL_SCALE_REPORT_NAME))
  });
}

function assertReleaseIdentity(tag, commit, buildId) {
  if (!/^v0\.[1-9]\d*\.\d+-alpha\.[1-9]\d*$/u.test(tag ?? "") ||
      !/^[a-f0-9]{40}$/u.test(commit ?? "") || buildId !== commit) {
    throw new Error("Release evidence requires one exact protected tag, commit, and build identity.");
  }
}

function bindDirectory(directory) {
  const resolved = path.resolve(directory);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Release evidence directory must be a real directory.");
  }
  return fs.realpathSync.native(resolved);
}

function readReport(reportPath) {
  const resolved = path.resolve(reportPath);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Release evidence report must be a real file.");
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function writeExclusive(destination, source) {
  if (fs.existsSync(destination)) throw new Error("Release evidence staging destination already exists.");
  const bytes = fs.readFileSync(path.resolve(source));
  fs.writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const options = {
    tag: argument("tag"),
    commit: argument("commit"),
    buildId: argument("build-id"),
    directory: argument("directory"),
    publicAlphaReportPath: argument("public-alpha-report"),
    localScaleReportPath: argument("local-scale-report")
  };
  if (process.argv.includes("--action=stage")) stageReleaseEvidenceBundle(options);
  else if (process.argv.includes("--action=verify")) verifyStagedReleaseEvidenceBundle(options);
  else throw new Error("Release evidence action must be stage or verify.");
  process.stdout.write("Release acceptance evidence is passed and bound to the exact candidate.\n");
}
