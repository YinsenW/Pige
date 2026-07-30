import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LOCAL_SCALE_REPORT_NAME,
  PUBLIC_ALPHA_REPORT_NAME,
  stageReleaseEvidenceBundle,
  validateReleaseEvidenceBundle,
  verifyStagedReleaseEvidenceBundle
} from "../../scripts/release/release-evidence-bundle.mjs";

const roots: string[] = [];
const commit = "a".repeat(40);
const tag = "v0.1.0-alpha.8";

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("release evidence bundle", () => {
  it("stages and reverifies passed reports bound to one exact release candidate", () => {
    const root = temporaryRoot();
    const directory = path.join(root, "release");
    fs.mkdirSync(directory);
    const publicAlphaReportPath = writeReport(root, "public-alpha.json", publicAlphaReport());
    const localScaleReportPath = writeReport(root, "local-scale.json", localScaleReport());
    const options = { tag, commit, buildId: commit, directory, publicAlphaReportPath, localScaleReportPath };

    stageReleaseEvidenceBundle(options);
    expect(fs.existsSync(path.join(directory, PUBLIC_ALPHA_REPORT_NAME))).toBe(true);
    expect(fs.existsSync(path.join(directory, LOCAL_SCALE_REPORT_NAME))).toBe(true);
    expect(verifyStagedReleaseEvidenceBundle(options).localScaleReport.status).toBe("passed");
  });

  it("rejects failed, stale, or undersized evidence before staging", () => {
    const failed = publicAlphaReport();
    failed.status = "failed";
    failed.checks[0].status = "failed";
    failed.unresolvedIssues = ["capture"];
    expect(() => validateReleaseEvidenceBundle({
      tag, commit, buildId: commit, publicAlphaReport: failed, localScaleReport: localScaleReport()
    })).toThrow(/failed, stale/u);

    const stale = localScaleReport();
    stale.release.commit = "b".repeat(40);
    expect(() => validateReleaseEvidenceBundle({
      tag, commit, buildId: commit, publicAlphaReport: publicAlphaReport(), localScaleReport: stale
    })).toThrow(/failed, stale/u);

    const undersized = localScaleReport();
    undersized.index.chunkRowCount = 99_999;
    expect(() => validateReleaseEvidenceBundle({
      tag, commit, buildId: commit, publicAlphaReport: publicAlphaReport(), localScaleReport: undersized
    })).toThrow(/frozen Public Alpha/u);
  });
});

function publicAlphaReport(): any {
  return {
    schemaVersion: 1,
    status: "passed",
    generatedAt: "2026-07-30T00:00:00.000Z",
    recipe: "tests/fixtures/public-alpha/public-alpha-scenario.v1.json",
    recipeSha256: "b".repeat(64),
    platform: "macos-arm64",
    buildId: commit,
    release: { tag, commit, buildId: commit },
    checks: [
      "capture", "parse", "ocr", "home_retrieval", "note_agent", "selection_action",
      "autonomous_write_undo", "exceptional_proposal", "memory", "restart_recovery",
      "backup_restore", "post_restore_search"
    ].map((id) => ({ id, status: "passed" })),
    sourceCounts: { total: 25 },
    unresolvedIssues: []
  };
}

function localScaleReport(): any {
  return {
    schemaVersion: 1,
    status: "passed",
    generatedAt: "2026-07-30T00:00:00.000Z",
    recipe: "pige-local-database-scale-v1",
    recipeSha256: "c".repeat(64),
    platform: "macos-arm64",
    buildId: commit,
    release: { tag, commit, buildId: commit },
    fixture: { pageCount: 10_000, expectedChunkCount: 100_000 },
    index: { pageRowCount: 10_000, chunkRowCount: 100_000 }
  };
}

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-release-evidence-"));
  roots.push(root);
  return root;
}

function writeReport(root: string, name: string, report: unknown): string {
  const reportPath = path.join(root, name);
  fs.writeFileSync(reportPath, JSON.stringify(report));
  return reportPath;
}
