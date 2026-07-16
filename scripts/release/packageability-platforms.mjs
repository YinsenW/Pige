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
    packagedRuntimeSmokeTimeoutMs: 60_000,
    requiredResourceFiles: [
      "native/macos/arm64/pige-vision-ocr",
      "native/macos/arm64/pige-vision-ocr.manifest.json",
      "native/macos/arm64/pige-speech",
      "native/macos/arm64/pige-speech.manifest.json"
    ],
    requiredSbomComponents: ["pige-speech", "pige-vision-ocr"],
    nativeSmokeScripts: [
      "scripts/verify/macos-vision-ocr-helper-smoke.mjs",
      "scripts/verify/macos-speech-helper-smoke.mjs"
    ]
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
    packagedRuntimeSmokeTimeoutMs: 120_000,
    requiredResourceFiles: [],
    requiredSbomComponents: [],
    nativeSmokeScripts: []
  }
};

const parserWorkerSmokeStages = new Set([
  "worker_inventory",
  "pdf_missing_source",
  "pdf_page_renderer",
  "office_missing_source",
  "office_media",
  "web_extractor",
  "dataset_ingest",
  "dataset_query",
  "completed"
]);

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

export function canonicalizeAsarEntryPath(entry) {
  if (typeof entry !== "string" || entry.length === 0 || entry.length > 4_096 || entry.includes("\0")) {
    throw new Error("Invalid packaged ASAR entry path.");
  }
  return `/${entry.replaceAll("\\", "/").replace(/^\/+/u, "")}`;
}

export function readLastParserWorkerSmokeStage(output) {
  if (typeof output !== "string" || output.length > 4 * 1024 * 1024) return undefined;
  const matches = output.matchAll(/(?:^|\n)PIGE_PARSER_WORKER_SMOKE_STAGE=([a-z_]+)(?=\r?$)/gmu);
  let lastStage;
  for (const match of matches) {
    if (parserWorkerSmokeStages.has(match[1])) lastStage = match[1];
  }
  return lastStage;
}
