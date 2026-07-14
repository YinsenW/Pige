import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const HELPER_RELATIVE_PATH = "Contents/Resources/native/macos/arm64/pige-vision-ocr";

export default async function signMacosAdHoc(options) {
  if (process.platform !== "darwin" || typeof options?.app !== "string" || !options.app.endsWith(".app")) {
    throw new Error("The macOS ad-hoc signing stage received an invalid application Bundle.");
  }
  const helperPath = path.join(options.app, HELPER_RELATIVE_PATH);
  const helperContent = fs.readFileSync(helperPath);
  const helperMode = fs.statSync(helperPath).mode;
  runCodeSign(["--verify", "--strict", "--verbose=2", helperPath]);

  runCodeSign(["--force", "--deep", "--sign", "-", "--timestamp=none", options.app]);

  fs.writeFileSync(helperPath, helperContent, { mode: helperMode });
  runCodeSign(["--force", "--sign", "-", "--timestamp=none", options.app]);

  runCodeSign(["--verify", "--strict", "--verbose=2", helperPath]);
  runCodeSign(["--verify", "--deep", "--strict", "--verbose=2", options.app]);
}

function runCodeSign(args) {
  const result = spawnSync("/usr/bin/codesign", args, {
    env: sanitizedEnvironment(),
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error("The electron-builder macOS ad-hoc signing stage failed closed.");
  }
}

function sanitizedEnvironment() {
  return Object.fromEntries(Object.entries({
    HOME: process.env.HOME,
    LANG: "C",
    LC_ALL: "C",
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR
  }).filter((entry) => typeof entry[1] === "string"));
}
