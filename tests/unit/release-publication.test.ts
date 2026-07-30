import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createReleaseManifest,
  parseElectronBuilderUpdateMetadata,
  verifyReleaseManifest
} from "../../scripts/release/release-artifacts.mjs";
import {
  assertReleaseInvocation,
  parseReleaseTag,
  resolveExactTagCommit
} from "../../scripts/release/release-tag.mjs";
import {
  parseProcessTable,
  summarizeProcessTree,
  validateRuntimeQualification
} from "../../scripts/release/macos-downloaded-qualification.mjs";

const temporaryRoots: string[] = [];
const commit = "a".repeat(40);

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("release publication", () => {
  it("accepts only nonzero alpha prerelease tags", () => {
    expect(parseReleaseTag("v0.1.0-alpha.1")).toEqual({
      tag: "v0.1.0-alpha.1",
      version: "0.1.0-alpha.1",
      channel: "alpha"
    });
    for (const invalid of [
      "0.1.0-alpha.1", "v0.0.0-alpha.1", "v0.1.0", "v01.1.0-alpha", "v0.1.0-beta.1",
      "v0.1.0-alpha.01", "v0.1.0-alpha.1+build", "v0.1.0-alpha/../escape"
    ]) expect(() => parseReleaseTag(invalid)).toThrow();
  });

  it("requires canonical repository invocation and protected tag pushes", () => {
    expect(() => assertReleaseInvocation({
      eventName: "push", repository: "YinsenW/Pige", protectedRef: "true"
    })).not.toThrow();
    expect(() => assertReleaseInvocation({
      eventName: "workflow_dispatch", repository: "YinsenW/Pige", protectedRef: "true"
    })).toThrow(/protected tag push/u);
    expect(() => assertReleaseInvocation({
      eventName: "push", repository: "YinsenW/Pige", protectedRef: "false"
    })).toThrow(/protected tag push/u);
    expect(() => assertReleaseInvocation({
      eventName: "pull_request", repository: "YinsenW/Pige", protectedRef: "true"
    })).toThrow();
    expect(() => assertReleaseInvocation({
      eventName: "push", repository: "attacker/Pige", protectedRef: "true"
    })).toThrow();
  });

  it("requires the exact checked-out commit to match the existing release tag", () => {
    const root = tempRoot();
    git(root, ["init"]);
    git(root, ["config", "user.email", "release-test@example.invalid"]);
    git(root, ["config", "user.name", "Release Test"]);
    fs.writeFileSync(path.join(root, "fixture.txt"), "first\n");
    git(root, ["add", "fixture.txt"]);
    git(root, ["commit", "-m", "first"]);
    git(root, ["tag", "v0.1.0-alpha.1"]);
    expect(resolveExactTagCommit(root, "v0.1.0-alpha.1")).toMatch(/^[0-9a-f]{40}$/u);
    fs.writeFileSync(path.join(root, "fixture.txt"), "second\n");
    git(root, ["commit", "-am", "second"]);
    expect(() => resolveExactTagCommit(root, "v0.1.0-alpha.1")).toThrow(/do not match/u);
    expect(() => resolveExactTagCommit(root, "v0.1.0-alpha.2")).toThrow(/does not exist/u);
  });

  it.each([
    ["macos-arm64", "0.1.0-alpha.1", [
      "Pige-0.1.0-alpha.1-arm64.zip"
    ], undefined, "Pige-0.1.0-alpha.1-arm64.zip"],
    ["windows-x64", "0.1.0-alpha.1", [
      "Pige-0.1.0-alpha.1-x64-setup.exe",
      "Pige-0.1.0-alpha.1-x64-setup.exe.blockmap"
    ], "alpha.yml", "Pige-0.1.0-alpha.1-x64-setup.exe"]
    ] as const)("creates and independently verifies %s manifests", (platform, version, artifactNames, metadataName, updateName) => {
    const root = tempRoot();
    for (const [index, name] of artifactNames.entries()) fs.writeFileSync(path.join(root, name), `artifact-${index}`);
    if (metadataName) writeMetadata(root, metadataName, version, updateName);
    const manifest = createReleaseManifest({ directory: root, platform, tag: `v${version}`, commit });
    expect(manifest.files.map((file) => file.name)).toContain(updateName);
    expect(verifyReleaseManifest({ directory: root, platform, tag: `v${version}`, commit })).toEqual(manifest);
    fs.appendFileSync(path.join(root, updateName), "tamper");
    expect(() => verifyReleaseManifest({ directory: root, platform, tag: `v${version}`, commit })).toThrow(/checksum mismatch/u);
  });

  it("rejects absent, malformed, stale, or unsafe update metadata", () => {
    expect(() => parseElectronBuilderUpdateMetadata("version: 0.1.0-alpha.1\nfiles: []\n")).toThrow();
    expect(() => parseElectronBuilderUpdateMetadata(
      "version: 0.1.0-alpha.1\nfiles:\n  - url: ../escape.zip\n    sha512: abc\n    size: 1\n"
    )).not.toThrow();
    const root = tempRoot();
    for (const name of [
      "Pige-0.1.0-alpha.1-x64-setup.exe",
      "Pige-0.1.0-alpha.1-x64-setup.exe.blockmap"
    ]) fs.writeFileSync(path.join(root, name), "artifact");
    writeMetadata(root, "alpha.yml", "0.1.0-alpha.2", "Pige-0.1.0-alpha.1-x64-setup.exe");
    expect(() => createReleaseManifest({
      directory: root, platform: "windows-x64", tag: "v0.1.0-alpha.1", commit
    })).toThrow(/version mismatch/u);
  });

  it("publishes only a qualified versioned ad-hoc macOS ZIP without trusted signing authority", () => {
    const root = process.cwd();
    const packageability = fs.readFileSync(path.join(root, ".github/workflows/packageability.yml"), "utf8");
    const workflow = fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8");
    const packageabilityConfig = fs.readFileSync(path.join(root, "apps/desktop/electron-builder.yml"), "utf8");
    const releaseBuilder = fs.readFileSync(path.join(root, "scripts/release/run-release-builder.mjs"), "utf8");
    const downloadedQualification = fs.readFileSync(
      path.join(root, "scripts/release/macos-downloaded-qualification.mjs"),
      "utf8"
    );
    const rootPackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const packageResourcePreparation = fs.readFileSync(
      path.join(root, "scripts/release/prepare-package-resources.mjs"),
      "utf8"
    );

    expect(packageability).toContain("Build ad-hoc sealed macOS arm64 artifact");
    expect(packageability).toContain("Build unsigned Windows x64 artifact");
    expect(packageability).not.toContain("production-release");
    expect(packageabilityConfig).toContain("forceCodeSigning: false");
    expect(packageabilityConfig).toContain('identity: "-"');
    expect(packageabilityConfig).toContain("notarize: false");

    expect(workflow).toContain('tags:\n      - "v*"');
    expect(workflow).not.toContain("actions/checkout@v7");
    expect(workflow).not.toContain("actions/setup-node@v6");
    expect(workflow).toContain("actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7");
    expect(workflow).toContain("actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6");
    expect(workflow).toContain("github.ref_protected");
    expect(workflow).toContain("PIGE_RELEASE_VERSION: ${{ needs.validate.outputs.version }}");
    expect(workflow).toContain("needs: [validate, verify-macos-arm64]");
    expect(workflow).toContain("pige-verified-macos-arm64-");
    expect(workflow).toContain("macos-downloaded-qualification.mjs");
    expect(workflow).toContain("pige-qualified-macos-arm64-");
    expect(workflow).not.toContain("verify-windows-x64");
    expect(workflow).not.toContain("pige-verified-windows-x64-");
    expect(workflow).toContain("Build versioned ad-hoc ZIP");
    expect(downloadedQualification).toContain("expected-untrusted and intact");
    expect(workflow).toContain("Privacy & Security > Open Anyway");
    expect(workflow).toContain("Automatic updates are unavailable");
    expect(workflow).toContain('gh release create "$PIGE_RELEASE_TAG"');
    expect(workflow).toContain("--verify-tag");
    expect(workflow).toContain("--prerelease");
    expect(workflow).toContain("Pige-${{ needs.validate.outputs.version }}-arm64.zip");
    expect(workflow).toContain("pige.cdx.json");
    expect(workflow).toContain("third-party-attribution.json");
    expect(workflow).toContain("macos-downloaded-qualification.json");
    expect(workflow).toContain("npm run release:public-alpha-scenario");
    expect(workflow).toContain("npm run evidence:local-scale");
    expect(workflow).toContain("PIGE_SCALE_SKIP_BUILD: \"1\"");
    expect(workflow.match(/release-evidence-bundle\.mjs/gu)).toHaveLength(3);
    expect(workflow).toContain("public-alpha-scenario-report.json");
    expect(workflow).toContain("local-database-scale-report.json");
    expect(workflow).toContain("RELEASE-EVIDENCE-SHA256SUMS.txt");
    expect(workflow).toContain("downloaded-packaged-ui.png");
    expect(packageability).toContain("windows-x64:");
    expect(workflow).not.toContain(".dmg");
    expect(workflow).not.toContain(".blockmap");
    expect(workflow).not.toContain("alpha-mac.yml");
    expect(workflow).not.toMatch(/(?:production-release|Developer ID|notari|staple|APPLE_|CSC_)/u);
    expect(workflow).not.toContain("softprops/action-gh-release");

    expect(releaseBuilder).toContain('macosAdHoc ? "electron-builder.yml"');
    expect(releaseBuilder).toContain("sanitizeElectronBuilderEnvironment(process.env)");
    expect(releaseBuilder).not.toMatch(/(?:PIGE_MACOS_|APPLE_API|Developer ID)/u);
    expect(rootPackage.scripts["release:package:mac:arm64"]).toContain("run-release-builder.mjs");
    expect(rootPackage.scripts["release:package:mac:arm64"]).toContain("--preflight-only=true");
    expect(rootPackage.scripts["release:package:win:x64"]).toContain("run-release-builder.mjs");
    expect(packageResourcePreparation).toContain("process.env.PIGE_RELEASE_VERSION");
    expect(packageResourcePreparation).toContain("process.env.PIGE_RELEASE_TAG");
    expect(packageResourcePreparation).toContain("version does not match the release tag");

  });

  it("aggregates a bounded downloaded-app process tree and renderer-safe UI evidence", () => {
    const rows = parseProcessTable(" 100 1 120000\n 101 100 20000\n 102 101 30000\n 999 1 999999\n");
    expect(summarizeProcessTree(rows, 100)).toEqual({ processCount: 3, residentBytes: 174_080_000 });
    expect(validateRuntimeQualification({
      schemaVersion: 1,
      status: "passed",
      runtimeIdentity: { appName: "Pige", appVersion: "0.1.0-alpha.2", isPackaged: true },
      semanticRuntime: { embedding: { buildType: "prebuilt" }, sqliteVec: true },
      pi: { adapterMode: "embedded_pi_sdk" },
      home: { state: "completed", citationCount: 1 },
      renderer: {
        title: "Pige", rootReady: true, preloadReady: true, healthReady: true,
        toolchainManifest: { requiredRuntimeModulesReady: true },
        uiEvidence: { fileName: "packaged-ui.png", bytes: 42, sha256: `sha256:${"a".repeat(64)}` }
      }
    }, "0.1.0-alpha.2").status).toBe("passed");
    expect(() => validateRuntimeQualification({ status: "passed" }, "0.1.0-alpha.2")).toThrow();
  });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-release-publication-test-"));
  temporaryRoots.push(root);
  return root;
}

function writeMetadata(root: string, metadataName: string, version: string, artifactName: string): void {
  const content = fs.readFileSync(path.join(root, artifactName));
  const sha512 = createHash("sha512").update(content).digest("base64");
  fs.writeFileSync(path.join(root, metadataName), [
    `version: ${version}`,
    "files:",
    `  - url: ${artifactName}`,
    `    sha512: ${sha512}`,
    `    size: ${content.length}`,
    `path: ${artifactName}`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-07-18T00:00:00.000Z'",
    ""
  ].join("\n"));
}

function git(root: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
}
