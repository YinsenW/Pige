import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

if (process.platform !== "darwin") {
  console.log("macOS Speech helper smoke skipped on this platform.");
  process.exit(0);
}

const root = process.cwd();
const packagedResourcesPath = process.env.PIGE_PACKAGED_RESOURCES_PATH
  ? path.resolve(process.env.PIGE_PACKAGED_RESOURCES_PATH)
  : undefined;
const binaryPath = packagedResourcesPath
  ? path.join(packagedResourcesPath, "native/macos", process.arch, "pige-speech")
  : path.join(root, "artifacts/native/macos", process.arch, "pige-speech");
const manifest = JSON.parse(fs.readFileSync(`${binaryPath}.manifest.json`, "utf8"));
const binary = fs.readFileSync(binaryPath);
const embeddedInfo = readEmbeddedInfoPlist(binaryPath);
if (
  manifest.schemaVersion !== 1 ||
  manifest.id !== "pige-speech" ||
  manifest.helperVersion !== "1.1.0" ||
  manifest.protocolVersion !== 1 ||
  manifest.platform !== "macos" ||
  manifest.arch !== process.arch ||
  manifest.binarySize !== binary.byteLength ||
  manifest.binarySha256 !== `sha256:${createHash("sha256").update(binary).digest("hex")}` ||
  typeof manifest.infoPlistSha256 !== "string" ||
  manifest.hiddenDownloads !== false ||
  manifest.networkAccess !== true ||
  manifest.networkAccessScope !== "apple_speech_language_assets" ||
  manifest.downloadTrigger !== "explicit_user_action" ||
  !embeddedInfo.includes("com.yinsenw.pige.speech") ||
  !embeddedInfo.includes("NSMicrophoneUsageDescription") ||
  !embeddedInfo.includes("Pige uses the microphone only while you explicitly dictate text.")
) {
  throw new Error("The macOS Speech helper manifest or checksum is invalid.");
}

const probe = spawnSync(binaryPath, ["--probe", "en-US"], {
  cwd: path.parse(binaryPath).root,
  env: probeEnv(),
  encoding: "utf8",
  timeout: 5_000,
  maxBuffer: 64 * 1024
});
if (probe.error || probe.signal || probe.status !== 0 || probe.stderr.length > 64 * 1024) {
  throw new Error("The macOS Speech helper probe failed closed.");
}
const response = JSON.parse(probe.stdout.trim());
if (
  response.kind !== "probe" ||
  response.protocolVersion !== 1 ||
  !["supported", "unsupported"].includes(response.status) ||
  !["not-determined", "granted", "denied", "restricted"].includes(response.permission) ||
  (response.status === "unsupported" &&
    !["language_unavailable", "assets_unavailable", "service_unavailable"].includes(response.reason))
) {
  throw new Error("The macOS Speech helper probe returned an invalid body-free result.");
}

const selfTest = spawnSync(binaryPath, ["--self-test"], {
  cwd: path.parse(binaryPath).root,
  env: probeEnv(),
  encoding: "utf8",
  timeout: 5_000,
  maxBuffer: 64 * 1024
});
if (selfTest.error || selfTest.signal || selfTest.status !== 0 || selfTest.stderr.length > 64 * 1024) {
  throw new Error("The macOS Speech helper self-test failed closed.");
}
const selfTestResponse = JSON.parse(selfTest.stdout.trim());
if (selfTestResponse.kind !== "self_test" || selfTestResponse.protocolVersion !== 1 || selfTestResponse.status !== "passed") {
  throw new Error("The macOS Speech helper self-test returned an invalid body-free result.");
}

console.log("macOS Speech helper integrity and installed-asset probe passed.");

function readEmbeddedInfoPlist(filePath) {
  const result = spawnSync("/usr/bin/otool", ["-s", "__TEXT", "__info_plist", "-V", filePath], {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 1024 * 1024
  });
  if (result.error || result.signal || result.status !== 0) return "";
  return result.stdout;
}

function probeEnv() {
  return Object.fromEntries(Object.entries({
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? "en_US.UTF-8",
    TMPDIR: process.env.TMPDIR
  }).filter((entry) => typeof entry[1] === "string"));
}
