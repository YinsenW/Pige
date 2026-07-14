import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertPackageabilityHost,
  canonicalizeAsarEntryPath,
  findDistributableNames,
  packageabilityPaths,
  resolvePackageabilityPlatform
} from "../../scripts/release/packageability-platforms.mjs";

const root = process.cwd();

describe("release packageability platforms", () => {
  it("binds macOS arm64 package resources and artifact identity", () => {
    const target = resolvePackageabilityPlatform("mac", "arm64");
    expect(target).toMatchObject({
      platform: "macos",
      arch: "arm64",
      hostPlatform: "darwin",
      outputDirectory: "macos-arm64",
      packageKind: "unsigned_zip_preflight",
      packagedRuntimeSmokeTimeoutMs: 60_000
    });
    expect(target.requiredSbomComponents).toEqual(["pige-vision-ocr"]);
    expect(findDistributableNames(["Pige-0.0.0-arm64.zip", "latest-mac.yml"], target)).toEqual([
      "Pige-0.0.0-arm64.zip"
    ]);
    expect(() => assertPackageabilityHost(target, "linux")).toThrow(/requires host darwin/u);
  });

  it("binds Windows x64 NSIS and unpacked application paths without macOS resources", () => {
    const target = resolvePackageabilityPlatform("windows", "x64");
    expect(target).toMatchObject({
      platform: "windows",
      arch: "x64",
      hostPlatform: "win32",
      outputDirectory: "windows-x64",
      appRelativePath: "win-unpacked",
      executableRelativePath: "Pige.exe",
      packageKind: "unsigned_nsis_preflight",
      packagedRuntimeSmokeTimeoutMs: 120_000
    });
    expect(target.requiredResourceFiles).toEqual([]);
    expect(target.requiredSbomComponents).toEqual([]);
    expect(findDistributableNames([
      "Pige-0.0.0-x64-setup.exe",
      "Pige-0.0.0-x64-setup.exe.blockmap",
      "latest.yml"
    ], target)).toEqual(["Pige-0.0.0-x64-setup.exe"]);

    const paths = packageabilityPaths("/repo", target, "build-1");
    expect(paths.executablePath).toBe(path.join("/repo", "artifacts/release-packageability/windows-x64/win-unpacked/Pige.exe"));
    expect(paths.reportPath).toBe(path.join("/repo", "artifacts/test-reports/packageability/windows-x64/build-1/report.json"));
    expect(() => assertPackageabilityHost(target, "darwin")).toThrow(/requires host win32/u);
  });

  it("rejects unsupported platform and architecture combinations", () => {
    expect(() => resolvePackageabilityPlatform("windows", "arm64")).toThrow(/Unsupported packageability target/u);
    expect(() => resolvePackageabilityPlatform("linux", "x64")).toThrow(/Unsupported packageability target/u);
  });

  it("canonicalizes platform-specific ASAR entry separators before exact matching", () => {
    expect(canonicalizeAsarEntryPath("/out/main/index.js")).toBe("/out/main/index.js");
    expect(canonicalizeAsarEntryPath("out/main/index.js")).toBe("/out/main/index.js");
    expect(canonicalizeAsarEntryPath("\\out\\main\\index.js")).toBe("/out/main/index.js");
    expect(canonicalizeAsarEntryPath("out\\main\\index.js")).toBe("/out/main/index.js");
    expect(() => canonicalizeAsarEntryPath("")).toThrow(/Invalid packaged ASAR entry path/u);
  });

  it("keeps the release scripts, builder config, and CI matrix aligned", () => {
    const rootPackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const desktopPackage = JSON.parse(fs.readFileSync(path.join(root, "apps/desktop/package.json"), "utf8"));
    const builderConfig = fs.readFileSync(path.join(root, "apps/desktop/electron-builder.yml"), "utf8");
    const builderRunner = fs.readFileSync(path.join(root, "scripts/release/run-electron-builder.mjs"), "utf8");
    const packagedSmoke = fs.readFileSync(path.join(root, "scripts/release/packaged-electron-smoke.mjs"), "utf8");
    const desktopMain = fs.readFileSync(path.join(root, "apps/desktop/src/main/index.ts"), "utf8");
    const workflow = fs.readFileSync(path.join(root, ".github/workflows/packageability.yml"), "utf8");

    expect(rootPackage.scripts["package:dir:win:x64"]).toContain("prepare:package:win:x64");
    expect(rootPackage.scripts["smoke:packaged:win:x64"]).toContain("--platform=win --arch=x64");
    expect(desktopPackage.scripts["package:dir:win:x64"]).toContain("--platform=windows --arch=x64");
    expect(builderRunner).toContain("require.resolve(\"electron-builder/out/cli/cli.js\")");
    expect(builderRunner).toContain("spawnSync(process.execPath");
    expect(builderRunner).not.toContain("electron-builder.cmd");
    expect(packagedSmoke).toContain("runtimeIdentity?.isPackaged !== true");
    expect(packagedSmoke).toContain("renderer?.preloadReady !== true");
    expect(packagedSmoke).not.toContain("powershell.exe");
    expect(packagedSmoke).not.toContain("remote-debugging-port");
    expect(desktopMain).toContain("runPackagedRendererSmoke");
    expect(desktopMain).toContain('webContents.once("did-finish-load"');
    expect(desktopMain).toContain('typeof window.pige?.getHealth === "function"');
    expect(builderConfig).toContain("win:\n");
    expect(builderConfig).toContain("- nsis");
    expect(builderConfig).toContain("perMachine: false");
    expect(builderConfig).toContain("allowElevation: false");
    expect(workflow).toContain("windows-x64:");
    expect(workflow).toContain("runs-on: windows-2025");
    expect(workflow).toContain("npm run smoke:packaged:win:x64");
  });
});
