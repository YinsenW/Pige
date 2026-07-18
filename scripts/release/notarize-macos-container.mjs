import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseReleaseTag } from "./release-tag.mjs";

if (process.platform !== "darwin") throw new Error("macOS container notarization requires macOS.");
const options = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...parts] = argument.replace(/^--/u, "").split("=");
  return [key, parts.join("=")];
}));
const { version } = parseReleaseTag(options.tag);
const directory = path.resolve(options.directory || "");
const dmgPath = path.join(directory, `Pige-${version}-arm64.dmg`);
if (!fs.statSync(dmgPath).isFile()) throw new Error("macOS release DMG is absent.");
for (const name of ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]) {
  if (!process.env[name] || process.env[name].includes("\0")) throw new Error(`Required notarization input is absent: ${name}.`);
}
const submission = run("xcrun", [
  "notarytool", "submit", dmgPath,
  "--key", process.env.APPLE_API_KEY,
  "--key-id", process.env.APPLE_API_KEY_ID,
  "--issuer", process.env.APPLE_API_ISSUER,
  "--wait", "--output-format", "json"
]);
let result;
try {
  result = JSON.parse(submission.stdout);
} catch {
  throw new Error("Apple notary service returned malformed status.");
}
if (result.status !== "Accepted" || typeof result.id !== "string" || result.id.length > 128) {
  throw new Error("Apple notary service did not accept the release DMG.");
}
run("xcrun", ["stapler", "staple", dmgPath]);
run("xcrun", ["stapler", "validate", dmgPath]);
process.stdout.write("macOS release DMG notarized and stapled.\n");

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} notarization command failed.`);
  return result;
}
