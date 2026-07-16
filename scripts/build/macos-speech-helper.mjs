import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const buildScriptPath = fileURLToPath(import.meta.url);
const sourcePath = path.join(root, "apps/desktop/native/macos-speech/PigeSpeech.swift");
const infoPlistPath = path.join(root, "apps/desktop/native/macos-speech/Info.plist");
const helperVersion = "1.1.0";
const protocolVersion = 1;

if (process.platform !== "darwin") {
  console.log("macOS Speech helper build skipped on this platform.");
  process.exit(0);
}

const targetByArch = {
  arm64: "arm64-apple-macosx26.0",
  x64: "x86_64-apple-macosx26.0"
};
const target = targetByArch[process.arch];
if (!target) throw new Error("Unsupported macOS Speech helper architecture.");

const outputRoot = path.join(root, "artifacts/native/macos", process.arch);
const binaryPath = path.join(outputRoot, "pige-speech");
const manifestPath = `${binaryPath}.manifest.json`;
const buildScriptChecksum = sha256(buildScriptPath);
const sourceChecksum = sha256(sourcePath);
const infoPlistChecksum = sha256(infoPlistPath);
const swiftVersion = run("swiftc", ["--version"]).stdout.trim().split("\n", 1)[0] ?? "unknown";
const existing = readJson(manifestPath);
if (
  fs.existsSync(binaryPath) &&
  existing?.schemaVersion === 1 &&
  existing.buildScriptSha256 === buildScriptChecksum &&
  existing.sourceSha256 === sourceChecksum &&
  existing.infoPlistSha256 === infoPlistChecksum &&
  existing.swiftVersion === swiftVersion &&
  existing.target === target &&
  existing.binarySha256 === sha256(binaryPath)
) {
  console.log(`macOS Speech helper is current: ${path.relative(root, binaryPath)}`);
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
  "Speech",
  "-framework",
  "AVFAudio",
  "-framework",
  "AVFoundation",
  "-Xlinker",
  "-sectcreate",
  "-Xlinker",
  "__TEXT",
  "-Xlinker",
  "__info_plist",
  "-Xlinker",
  infoPlistPath,
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
  "com.yinsenw.pige.speech",
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
  id: "pige-speech",
  helperVersion,
  protocolVersion,
  platform: "macos",
  arch: process.arch,
  minimumOperatingSystem: "26.0",
  target,
  buildScriptSha256: buildScriptChecksum,
  sourceSha256: sourceChecksum,
  infoPlistSha256: infoPlistChecksum,
  binarySha256: sha256(binaryPath),
  binarySize: stat.size,
  swiftVersion,
  hiddenDownloads: false,
  networkAccess: true,
  networkAccessScope: "apple_speech_language_assets",
  downloadTrigger: "explicit_user_action"
});
console.log(`Built macOS Speech helper: ${path.relative(root, binaryPath)}`);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: sanitizedBuildEnvironment()
  });
  if (result.error) throw new Error(`${command} could not be launched.`);
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
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return undefined; }
}

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}
