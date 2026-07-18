import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseReleaseTag } from "./release-tag.mjs";

const options = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...parts] = argument.replace(/^--/u, "").split("=");
  return [key, parts.join("=")];
}));
if (process.platform !== "darwin") throw new Error("macOS release verification requires macOS.");
const { version } = parseReleaseTag(options.tag);
const teamId = options["team-id"];
if (!/^[A-Z0-9]{10}$/u.test(teamId ?? "")) throw new Error("Expected macOS Team ID is absent or invalid.");
const directory = path.resolve(options.directory || "");
const zipPath = path.join(directory, `Pige-${version}-arm64.zip`);
const dmgPath = path.join(directory, `Pige-${version}-arm64.dmg`);
for (const filePath of [zipPath, dmgPath]) if (!fs.statSync(filePath).isFile()) throw new Error("Signed macOS release artifact is absent.");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-release-verify-"));
try {
  run("ditto", ["-x", "-k", zipPath, temporaryRoot]);
  const appPath = path.join(temporaryRoot, "Pige.app");
  if (!fs.statSync(appPath).isDirectory()) throw new Error("macOS update ZIP does not contain Pige.app.");
  verifyCodeIdentity(appPath, teamId, true);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", appPath]);
  for (const helperName of ["pige-vision-ocr", "pige-speech"]) {
    verifyCodeIdentity(path.join(appPath, "Contents/Resources/native/macos/arm64", helperName), teamId, true);
  }
  assertNotarizedAssessment(run("spctl", ["--assess", "--type", "execute", "--verbose=4", appPath]));
  run("xcrun", ["stapler", "validate", appPath]);
  verifyCodeIdentity(dmgPath, teamId, false);
  run("codesign", ["--verify", "--strict", "--verbose=4", dmgPath]);
  assertNotarizedAssessment(run("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=4", dmgPath]));
  run("xcrun", ["stapler", "validate", dmgPath]);
  const report = { schemaVersion: 1, platform: "macos-arm64", teamId, developerId: true, hardenedRuntime: true, notarized: true, stapled: true };
  fs.writeFileSync(path.join(directory, "macos-signature-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write("Signed and notarized macOS release artifacts verified.\n");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

function verifyCodeIdentity(targetPath, expectedTeamId, requireRuntime) {
  const result = run("codesign", ["--display", "--verbose=4", targetPath]);
  const output = `${result.stdout}\n${result.stderr}`;
  if (!output.includes(`TeamIdentifier=${expectedTeamId}`) || !/Authority=Developer ID Application:/u.test(output)) {
    throw new Error("macOS artifact is not signed by the expected Developer ID identity.");
  }
  if (requireRuntime && !/flags=.*runtime/u.test(output)) throw new Error("macOS executable is missing hardened-runtime signing.");
}

function assertNotarizedAssessment(result) {
  const output = `${result.stdout}\n${result.stderr}`;
  if (!/accepted/u.test(output) || !/source=Notarized Developer ID/u.test(output)) {
    throw new Error("Gatekeeper did not accept a notarized Developer ID artifact.");
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} verification failed.`);
  return result;
}
