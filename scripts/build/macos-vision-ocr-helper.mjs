import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const buildScriptPath = fileURLToPath(import.meta.url);
const sourcePath = path.join(root, "apps/desktop/native/macos-vision-ocr/PigeVisionOCR.swift");
const helperVersion = "1.0.0";
const protocolVersion = 1;

if (process.platform !== "darwin") {
  console.log("macOS Vision OCR helper build skipped on this platform.");
  process.exit(0);
}

const targetByArch = {
  arm64: "arm64-apple-macosx26.0",
  x64: "x86_64-apple-macosx26.0"
};
const target = targetByArch[process.arch];
if (!target) {
  console.error(`Unsupported macOS helper architecture: ${process.arch}`);
  process.exit(1);
}

const outputRoot = path.join(root, "artifacts/native/macos", process.arch);
const binaryPath = path.join(outputRoot, "pige-vision-ocr");
const manifestPath = `${binaryPath}.manifest.json`;
const buildScriptChecksum = sha256(buildScriptPath);
const sourceChecksum = sha256(sourcePath);
const swiftVersion = run("swiftc", ["--version"]).stdout.trim().split("\n", 1)[0] ?? "unknown";
const existingManifest = readJson(manifestPath);
if (
  fs.existsSync(binaryPath) &&
  existingManifest?.schemaVersion === 1 &&
  existingManifest.buildScriptSha256 === buildScriptChecksum &&
  existingManifest.sourceSha256 === sourceChecksum &&
  existingManifest.swiftVersion === swiftVersion &&
  existingManifest.target === target &&
  existingManifest.binarySha256 === sha256(binaryPath)
) {
  console.log(`macOS Vision OCR helper is current: ${path.relative(root, binaryPath)}`);
  process.exit(0);
}

fs.mkdirSync(outputRoot, { recursive: true });
const temporaryBinary = `${binaryPath}.${process.pid}.tmp`;
const build = run("swiftc", [
  "-O",
  "-whole-module-optimization",
  "-parse-as-library",
  "-target",
  target,
  "-framework",
  "Vision",
  "-framework",
  "ImageIO",
  "-framework",
  "CoreGraphics",
  "-framework",
  "UniformTypeIdentifiers",
  sourcePath,
  "-o",
  temporaryBinary
]);
if (build.status !== 0) {
  fs.rmSync(temporaryBinary, { force: true });
  process.stderr.write(build.stderr);
  process.exit(build.status ?? 1);
}
fs.chmodSync(temporaryBinary, 0o755);
fs.renameSync(temporaryBinary, binaryPath);
const signing = run("/usr/bin/codesign", [
  "--force",
  "--sign",
  "-",
  "--identifier",
  "com.yinsenw.pige.vision-ocr",
  "--timestamp=none",
  binaryPath
]);
if (signing.status !== 0) {
  process.stderr.write(signing.stderr);
  process.exit(signing.status ?? 1);
}
const stat = fs.statSync(binaryPath);
writeJsonAtomic(manifestPath, {
  schemaVersion: 1,
  id: "pige-vision-ocr",
  helperVersion,
  protocolVersion,
  platform: "macos",
  arch: process.arch,
  target,
  buildScriptPath: "scripts/build/macos-vision-ocr-helper.mjs",
  buildScriptSha256: buildScriptChecksum,
  sourcePath: "apps/desktop/native/macos-vision-ocr/PigeVisionOCR.swift",
  sourceSha256: sourceChecksum,
  binarySha256: sha256(binaryPath),
  binarySize: stat.size,
  swiftVersion,
  builtAt: new Date().toISOString(),
  signing: "stable-identifier ad-hoc build output preserved by the internal packageability Bundle seal; only public distribution requires a Developer ID signature and notarization"
});
console.log(`Built macOS Vision OCR helper: ${path.relative(root, binaryPath)}`);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: sanitizedBuildEnvironment()
  });
  if (result.error) {
    console.error(`${command} could not be launched: ${result.error.message}`);
    process.exit(1);
  }
  return result;
}

function sanitizedBuildEnvironment() {
  return Object.fromEntries(Object.entries({
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? "en_US.UTF-8",
    PATH: process.env.PATH,
    SDKROOT: process.env.SDKROOT,
    TMPDIR: process.env.TMPDIR
  }).filter((entry) => typeof entry[1] === "string"));
}

function sha256(filePath) {
  return `sha256:${createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}
