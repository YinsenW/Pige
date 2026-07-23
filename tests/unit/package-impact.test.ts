import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyPackageImpactPath,
  decidePackageImpact,
  parseChangedPaths,
  runSelfTests
} from "../../scripts/verify/package-impact.mjs";

const root = process.cwd();

describe("package-impact classifier", () => {
  it("covers the direct package-impact matrix", () => {
    expect(runSelfTests()).toBe(17);
    expect(decidePackageImpact({
      paths: ["docs/PRD.md", "resources/traceability/semantic-claims.manifest.json"]
    })).toMatchObject({ required: false, reason: "proven_non_package" });
    expect(decidePackageImpact({
      paths: ["apps/desktop/src/renderer/src/locales/ja/messages.json", "tests/fixtures/web/hostile.html"]
    })).toMatchObject({ required: false, reason: "proven_non_package" });
    for (const changedPath of [
      "apps/desktop/src/main/index.ts",
      "apps/desktop/src/preload/index.ts",
      "scripts/build/macos-speech-helper.mjs",
      "resources/licenses/pi-MIT.txt",
      "resources/dependency-manifest/dependencies.manifest.json",
      "package-lock.json",
      "apps/desktop/electron-builder.yml",
      "scripts/release/sign-macos-ad-hoc.mjs",
      "scripts/release/packaged-electron-smoke.mjs"
    ]) {
      expect(classifyPackageImpactPath(changedPath), changedPath).toMatchObject({ packageImpact: true });
    }
  });

  it("fails closed for overrides, unknown paths, empty input, and diff failure", () => {
    expect(decidePackageImpact({ paths: ["docs/PRD.md"], override: true })).toMatchObject({
      required: true,
      reason: "explicit_override"
    });
    expect(decidePackageImpact({ paths: ["unknown-owner/new.file"] })).toMatchObject({
      required: true,
      reason: "package_impact"
    });
    expect(decidePackageImpact({ paths: [] })).toMatchObject({ required: true, reason: "empty_or_invalid_diff" });
    expect(decidePackageImpact({ paths: ["docs/PRD.md"], diffFailed: true })).toMatchObject({
      required: true,
      reason: "diff_failure"
    });
    expect(classifyPackageImpactPath("../outside")).toMatchObject({ packageImpact: true, reason: "unknown_path" });
  });

  it("parses exact NUL-delimited git output without treating path whitespace as syntax", () => {
    expect(parseChangedPaths(Buffer.from("docs/one file.md\0tests/fixtures/two.json\0", "utf8"))).toEqual([
      "docs/one file.md",
      "tests/fixtures/two.json"
    ]);
  });

  it("keeps packageability independent from full-gates and executes the trusted base classifier", () => {
    const workflow = fs.readFileSync(path.join(root, ".github/workflows/packageability.yml"), "utf8");
    expect(workflow).toContain("package-impact:");
    expect(workflow).toContain("git show \"${BASE_SHA}:scripts/verify/package-impact.mjs\"");
    expect(workflow).toContain("git diff --name-only -z \"$BASE_SHA\" \"$HEAD_SHA\"");
    expect(workflow).toContain("package-gates");
    expect(workflow).toContain("needs.package-impact.outputs.required == 'true'");
    expect(workflow).not.toContain("full-gates");
  });
});
