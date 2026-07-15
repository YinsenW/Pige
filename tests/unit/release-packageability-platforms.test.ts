import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertPackageabilityHost,
  canonicalizeAsarEntryPath,
  findDistributableNames,
  packageabilityPaths,
  resolvePackageabilityPlatform
} from "../../scripts/release/packageability-platforms.mjs";
import {
  classifyMacGatekeeperAssessment,
  collectBundleManifest,
  compareBundleManifests,
  parseMacCodeSignatureDescription,
  sanitizeElectronBuilderEnvironment
} from "../../scripts/release/packageability-security.mjs";
import { isUnsupportedDirectoryFsync } from "../../apps/desktop/src/main/services/local-settings";

const root = process.cwd();
const iconRoot = path.join(root, "resources/brand/pige-icon");

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

  it("treats Windows directory fsync limitations as unsupported without hiding permission failures elsewhere", () => {
    for (const code of ["EPERM", "EBADF"]) {
      const error = Object.assign(new Error("bounded Windows directory fsync failure"), { code });
      expect(isUnsupportedDirectoryFsync(error, "win32")).toBe(true);
      expect(isUnsupportedDirectoryFsync(error, "darwin")).toBe(false);
    }
    for (const code of ["EINVAL", "EISDIR", "ENOSYS", "ENOTSUP", "EOPNOTSUPP"]) {
      expect(isUnsupportedDirectoryFsync(Object.assign(new Error("unsupported directory fsync"), { code }), "linux"))
        .toBe(true);
    }
    expect(isUnsupportedDirectoryFsync(Object.assign(new Error("missing directory"), { code: "ENOENT" }), "win32"))
      .toBe(false);
  });

  it("keeps the release scripts, builder config, and CI matrix aligned", () => {
    const rootPackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const desktopPackage = JSON.parse(fs.readFileSync(path.join(root, "apps/desktop/package.json"), "utf8"));
    const builderConfig = fs.readFileSync(path.join(root, "apps/desktop/electron-builder.yml"), "utf8");
    const builderRunner = fs.readFileSync(path.join(root, "scripts/release/run-electron-builder.mjs"), "utf8");
    const packagedSmoke = fs.readFileSync(path.join(root, "scripts/release/packaged-electron-smoke.mjs"), "utf8");
    const macosHelperBuild = fs.readFileSync(path.join(root, "scripts/build/macos-vision-ocr-helper.mjs"), "utf8");
    const macosAdHocSigner = fs.readFileSync(path.join(root, "scripts/release/sign-macos-ad-hoc.mjs"), "utf8");
    const installedMacPackager = fs.readFileSync(
      path.join(root, "node_modules/app-builder-lib/out/macPackager.js"),
      "utf8"
    );
    const installedPlatformPackager = fs.readFileSync(
      path.join(root, "node_modules/app-builder-lib/out/platformPackager.js"),
      "utf8"
    );
    const desktopMain = fs.readFileSync(path.join(root, "apps/desktop/src/main/index.ts"), "utf8");
    const workflow = fs.readFileSync(path.join(root, ".github/workflows/packageability.yml"), "utf8");

    expect(rootPackage.scripts["package:dir:win:x64"]).toContain("prepare:package:win:x64");
    expect(rootPackage.scripts["smoke:distributed:mac:arm64"]).toContain("--distribution-only=true");
    expect(rootPackage.scripts["smoke:packaged:win:x64"]).toContain("--platform=win --arch=x64");
    expect(desktopPackage.scripts["package:dir:win:x64"]).toContain("--platform=windows --arch=x64");
    expect(builderRunner).toContain("require.resolve(\"electron-builder/out/cli/cli.js\")");
    expect(builderRunner).toContain("spawnSync(process.execPath");
    expect(builderRunner).not.toContain("electron-builder.cmd");
    expect(builderRunner).toContain("sanitizeElectronBuilderEnvironment(process.env)");
    expect(builderConfig).toContain("forceCodeSigning: false");
    expect(builderConfig).toContain('identity: "-"');
    expect(builderConfig).toContain("sign: ../../scripts/release/sign-macos-ad-hoc.mjs");
    expect(builderConfig).toContain("hardenedRuntime: false");
    expect(builderConfig).toContain("notarize: false");
    expect(builderConfig).toContain("entitlements: null");
    expect(builderConfig).toContain("entitlementsInherit: null");
    expect(builderConfig).toContain("preAutoEntitlements: false");
    expect(packagedSmoke).toContain("runtimeIdentity?.isPackaged !== true");
    expect(packagedSmoke).toContain('["-x", "-k", distributablePath, distributionRoot]');
    expect(packagedSmoke).toContain('["--verify", "--deep", "--strict", "--verbose=2"');
    expect(packagedSmoke).toContain('"com.apple.quarantine"');
    expect(packagedSmoke).toContain("nested_helper_codesign_verify");
    expect(packagedSmoke).toContain("quarantineGatekeeperExpectedUntrustedRejection");
    expect(macosHelperBuild).toContain("stable-identifier ad-hoc build output");
    expect(macosHelperBuild).toContain("only public distribution requires a Developer ID signature and notarization");
    expect(macosHelperBuild).not.toContain("release pipeline must apply a Developer ID signature");
    expect(macosHelperBuild).toContain('"com.yinsenw.pige.vision-ocr"');
    expect(macosAdHocSigner).toContain("const helperContent = fs.readFileSync(helperPath)");
    expect(macosAdHocSigner).toContain("fs.writeFileSync(helperPath, helperContent");
    expect(macosAdHocSigner).toContain('["--force", "--deep", "--sign", "-", "--timestamp=none", options.app]');
    expect(macosAdHocSigner).toContain('["--force", "--sign", "-", "--timestamp=none", options.app]');
    expect(macosAdHocSigner).not.toMatch(/(?:Developer ID|notary|staple|entitlements)/u);
    const deepSeal = macosAdHocSigner.indexOf('["--force", "--deep", "--sign", "-", "--timestamp=none", options.app]');
    const restoreHelper = macosAdHocSigner.indexOf("fs.writeFileSync(helperPath, helperContent");
    const finalOuterSeal = macosAdHocSigner.indexOf('["--force", "--sign", "-", "--timestamp=none", options.app]');
    const finalDeepVerify = macosAdHocSigner.lastIndexOf('["--verify", "--deep", "--strict", "--verbose=2", options.app]');
    expect(deepSeal).toBeGreaterThan(-1);
    expect(restoreHelper).toBeGreaterThan(deepSeal);
    expect(finalOuterSeal).toBeGreaterThan(restoreHelper);
    expect(finalDeepVerify).toBeGreaterThan(finalOuterSeal);
    expect(macosAdHocSigner.slice(finalOuterSeal, finalDeepVerify)).not.toContain("writeFileSync");
    expect(installedMacPackager).toContain("customSign ? Promise.resolve(customSign(opts, this))");
    const packMacTargets = installedMacPackager.slice(
      installedMacPackager.indexOf("async packMacTargets"),
      installedMacPackager.indexOf("async signMas")
    );
    expect(packMacTargets.indexOf("await this.doPack")).toBeLessThan(
      packMacTargets.indexOf("this.packageInDistributableFormat(appPath, arch, targets, taskManager)")
    );
    expect(installedPlatformPackager).toContain("const didSign = await this.signApp(packContext, isAsar)");
    expect(packagedSmoke).toContain("renderer?.preloadReady !== true");
    expect(packagedSmoke).toContain('report?.status !== "passed"');
    expect(packagedSmoke).toContain('"renderer_load", "renderer_probe", "report_write"');
    expect(packagedSmoke).not.toContain("powershell.exe");
    expect(packagedSmoke).not.toContain("remote-debugging-port");
    expect(desktopMain).toContain("runPackagedRendererSmoke");
    expect(desktopMain).toContain('await browserWindow.loadFile(join(__dirname, "../renderer/index.html"))');
    expect(desktopMain).toContain('status: "failed"');
    expect(desktopMain).toContain('stage: "renderer_probe"');
    expect(desktopMain).toContain('typeof window.pige?.getHealth === "function"');
    expect(builderConfig).toContain("win:\n");
    expect(builderConfig).toContain("- nsis");
    expect(builderConfig).toContain("perMachine: false");
    expect(builderConfig).toContain("allowElevation: false");
    expect(workflow).toContain("windows-x64:");
    expect(workflow).toContain("runs-on: windows-2025");
    expect(workflow).toContain("npm run smoke:packaged:win:x64");
    expect(workflow).toContain("macos-arm64-distribution:");
    expect(workflow).toContain("needs: macos-arm64");
    expect(workflow).toContain("actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131");
    expect(workflow).toContain("npm run smoke:distributed:mac:arm64");
    expect(workflow).toContain("PIGE_EXPECTED_PACKAGEABILITY_REPORT:");
    expect(workflow).not.toMatch(/(?:notary|notarize|staple|APPLE_|CSC_)/u);
  });

  it("removes signing and notarization authority from the electron-builder environment", () => {
    const environment = sanitizeElectronBuilderEnvironment({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      CSC_LINK: "secret-certificate",
      CSC_KEY_PASSWORD: "secret-password",
      CSC_FOR_PULL_REQUEST: "false",
      CSC_IDENTITY_AUTO_DISCOVERY: "true",
      WIN_CSC_LINK: "secret-windows-certificate",
      APPLE_ID: "private-account",
      APPLE_APP_SPECIFIC_PASSWORD: "private-password",
      APPLE_API_KEY: "private-key"
    });
    expect(environment).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
      CSC_FOR_PULL_REQUEST: "true"
    });
  });

  it("compares exact bounded Bundle manifests including modes, checksums, and symlinks", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-packageability-manifest-test-"));
    try {
      const first = path.join(tempRoot, "first");
      const second = path.join(tempRoot, "second");
      fs.mkdirSync(path.join(first, "Contents"), { recursive: true });
      fs.writeFileSync(path.join(first, "Contents", "payload"), "bounded\n", { mode: 0o640 });
      fs.symlinkSync("payload", path.join(first, "Contents", "current"));
      fs.cpSync(first, second, { recursive: true, verbatimSymlinks: true });
      const expected = collectBundleManifest(first);
      expect(compareBundleManifests(expected, collectBundleManifest(second))).toBe(true);
      fs.chmodSync(path.join(second, "Contents", "payload"), 0o600);
      expect(compareBundleManifests(expected, collectBundleManifest(second))).toBe(false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("accepts only ad-hoc non-runtime signatures and expected untrusted Gatekeeper rejection", () => {
    expect(parseMacCodeSignatureDescription([
      "Executable=/tmp/Pige",
      "Identifier=com.yinsenw.pige",
      "CodeDirectory v=20400 size=100 flags=0x2(adhoc) hashes=1+0 location=embedded",
      "Signature=adhoc",
      "TeamIdentifier=not set"
    ].join("\n"))).toEqual({
      adHoc: true,
      teamIdentifierPresent: false,
      developerIdPresent: false,
      hardenedRuntime: false
    });
    expect(parseMacCodeSignatureDescription([
      "CodeDirectory v=20500 flags=0x10000(runtime)",
      "Signature=size=100",
      "Authority=Developer ID Application: Example",
      "TeamIdentifier=EXAMPLETEAM"
    ].join("\n"))).toMatchObject({
      adHoc: false,
      teamIdentifierPresent: true,
      developerIdPresent: true,
      hardenedRuntime: true
    });
    const rejectedAssessment = { status: 3, signal: null, error: undefined };
    expect(classifyMacGatekeeperAssessment(rejectedAssessment, "Pige.app: rejected\nsource=no usable signature")).toEqual({
      expectedUntrustedRejection: true,
      invalidDiagnostic: false
    });
    expect(classifyMacGatekeeperAssessment(rejectedAssessment, "Pige.app: rejected")).toEqual({
      expectedUntrustedRejection: true,
      invalidDiagnostic: false
    });
    expect(classifyMacGatekeeperAssessment(
      rejectedAssessment,
      "Pige.app: rejected\ncode has no resources but signature indicates they must be present"
    )).toEqual({
      expectedUntrustedRejection: false,
      invalidDiagnostic: true
    });
    expect(classifyMacGatekeeperAssessment(
      { status: 0, signal: null, error: undefined },
      "Pige.app: accepted"
    ).expectedUntrustedRejection).toBe(false);
    for (const incompleteAssessment of [
      { status: null, signal: null, error: undefined },
      { status: null, signal: null, error: new Error("launch failed") },
      { status: null, signal: null, error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }) },
      { status: null, signal: "SIGTERM", error: undefined }
    ]) {
      expect(classifyMacGatekeeperAssessment(
        incompleteAssessment,
        "Pige.app: rejected"
      ).expectedUntrustedRejection).toBe(false);
    }
  });

  it("wires the approved Pige icon exports into macOS and Windows packages", () => {
    const builderConfig = fs.readFileSync(path.join(root, "apps/desktop/electron-builder.yml"), "utf8");
    expect(builderConfig).toContain("icon: ../../resources/brand/pige-icon/macos/Pige.icns");
    expect(builderConfig).toContain("icon: ../../resources/brand/pige-icon/windows/Pige.ico");

    const master = readPngHeader(path.join(iconRoot, "master/pige-icon-1024.png"));
    expect(master).toEqual({ width: 1024, height: 1024, bitDepth: 8, colorType: 2 });

    const icns = fs.readFileSync(path.join(iconRoot, "macos/Pige.icns"));
    expect(icns.subarray(0, 4).toString("ascii")).toBe("icns");
    expect(icns.readUInt32BE(4)).toBe(icns.length);

    const ico = fs.readFileSync(path.join(iconRoot, "windows/Pige.ico"));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const frameCount = ico.readUInt16LE(4);
    const frames = Array.from({ length: frameCount }, (_, index) => {
      const offset = 6 + index * 16;
      return {
        width: ico[offset] || 256,
        height: ico[offset + 1] || 256,
        bitDepth: ico.readUInt16LE(offset + 6),
        bytes: ico.readUInt32LE(offset + 8),
        offset: ico.readUInt32LE(offset + 12)
      };
    });
    expect(frames.map(({ width, height, bitDepth }) => ({ width, height, bitDepth }))).toEqual(
      [16, 24, 32, 48, 64, 128, 256].map((size) => ({ width: size, height: size, bitDepth: 32 }))
    );
    for (const frame of frames) {
      expect(frame.bytes).toBeGreaterThan(0);
      expect(frame.offset + frame.bytes).toBeLessThanOrEqual(ico.length);
    }

    for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
      expect(readPngHeader(path.join(iconRoot, `windows/pige-${size}.png`))).toMatchObject({
        width: size,
        height: size
      });
    }
  });
});

function readPngHeader(filePath: string): {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
} {
  const content = fs.readFileSync(filePath);
  expect(content.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(content.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return {
    width: content.readUInt32BE(16),
    height: content.readUInt32BE(20),
    bitDepth: content.readUInt8(24),
    colorType: content.readUInt8(25)
  };
}
