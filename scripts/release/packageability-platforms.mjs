import path from "node:path";

const definitions = {
  "macos-arm64": {
    platform: "macos",
    platformAliases: ["mac", "macos"],
    arch: "arm64",
    hostPlatform: "darwin",
    outputDirectory: "macos-arm64",
    appRelativePath: "mac-arm64/Pige.app",
    executableRelativePath: "Contents/MacOS/Pige",
    resourcesRelativePath: "Contents/Resources",
    distributablePattern: /^Pige-0\.0\.0-arm64\.zip$/u,
    packageKind: "unsigned_zip_preflight",
    builderPlatformFlag: "--mac",
    requiredResourceFiles: [
      "native/macos/arm64/pige-vision-ocr",
      "native/macos/arm64/pige-vision-ocr.manifest.json"
    ],
    requiredSbomComponents: ["pige-vision-ocr"],
    nativeSmokeScript: "scripts/verify/macos-vision-ocr-helper-smoke.mjs"
  },
  "windows-x64": {
    platform: "windows",
    platformAliases: ["win", "windows"],
    arch: "x64",
    hostPlatform: "win32",
    outputDirectory: "windows-x64",
    appRelativePath: "win-unpacked",
    executableRelativePath: "Pige.exe",
    resourcesRelativePath: "resources",
    distributablePattern: /^Pige-0\.0\.0-x64-setup\.exe$/u,
    packageKind: "unsigned_nsis_preflight",
    builderPlatformFlag: "--win",
    requiredResourceFiles: [],
    requiredSbomComponents: []
  }
};

export function resolvePackageabilityPlatform(platform, arch) {
  const definition = Object.values(definitions).find((candidate) =>
    candidate.arch === arch && candidate.platformAliases.includes(platform)
  );
  if (!definition) throw new Error(`Unsupported packageability target: ${String(platform)}-${String(arch)}.`);
  return Object.freeze({ ...definition });
}

export function assertPackageabilityHost(definition, hostPlatform = process.platform) {
  if (hostPlatform !== definition.hostPlatform) {
    throw new Error(
      `${definition.platform}-${definition.arch} packageability requires host ${definition.hostPlatform}, received ${hostPlatform}.`
    );
  }
}

export function packageabilityPaths(root, definition, buildId) {
  const outputRoot = path.join(root, "artifacts/release-packageability", definition.outputDirectory);
  const appPath = path.join(outputRoot, definition.appRelativePath);
  const resourcesPath = path.join(appPath, definition.resourcesRelativePath);
  return {
    outputRoot,
    appPath,
    executablePath: path.join(appPath, definition.executableRelativePath),
    resourcesPath,
    asarPath: path.join(resourcesPath, "app.asar"),
    reportPath: path.join(
      root,
      "artifacts/test-reports/packageability",
      definition.outputDirectory,
      buildId,
      "report.json"
    )
  };
}

export function findDistributableNames(fileNames, definition) {
  return fileNames.filter((fileName) => definition.distributablePattern.test(fileName));
}
