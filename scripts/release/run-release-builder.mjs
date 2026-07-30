import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeElectronBuilderEnvironment } from "./packageability-security.mjs";
import { parseReleaseTag } from "./release-tag.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const options = parseOptions(process.argv.slice(2));
const release = parseReleaseTag(process.env.PIGE_RELEASE_TAG);
if (!options.platform || !options.arch) throw new Error("Release packaging requires --platform and --arch.");

const target = resolveTarget(options.platform, options.arch);
assertHost(target.hostPlatform);
if (target.platform === "windows") assertWindowsSigningEnvironment();
if (options["preflight-only"] === "true") {
  process.stdout.write(`Release packaging preflight passed for ${target.platform}-${target.arch}.\n`);
  process.exit(0);
}
const desktopRoot = path.join(root, "apps/desktop");
const electronBuilderCliPath = require.resolve("electron-builder/out/cli/cli.js");
const macosAdHoc = target.platform === "macos";
const result = spawnSync(process.execPath, [
  electronBuilderCliPath,
  "--config",
  macosAdHoc ? "electron-builder.yml" : "electron-builder.release.yml",
  `--config.directories.output=${path.posix.join("../../artifacts/release-packageability", target.outputDirectory)}`,
  `--config.extraMetadata.version=${release.version}`,
  target.builderFlag,
  `--${target.arch}`,
  "--publish",
  "never"
], {
  cwd: desktopRoot,
  env: macosAdHoc
    ? { ...sanitizeElectronBuilderEnvironment(process.env), PIGE_RELEASE_VERSION: release.version }
    : { ...process.env, PIGE_RELEASE_VERSION: release.version },
  encoding: "utf8",
  stdio: "inherit"
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

function resolveTarget(platform, arch) {
  if ((platform === "mac" || platform === "macos") && arch === "arm64") {
    return { platform: "macos", arch, hostPlatform: "darwin", outputDirectory: "macos-arm64", builderFlag: "--mac" };
  }
  if ((platform === "win" || platform === "windows") && arch === "x64") {
    return { platform: "windows", arch, hostPlatform: "win32", outputDirectory: "windows-x64", builderFlag: "--win" };
  }
  throw new Error(`Unsupported release target: ${String(platform)}-${String(arch)}.`);
}

function assertHost(expected) {
  if (process.platform !== expected) throw new Error(`Release packaging requires host ${expected}.`);
}

function assertWindowsSigningEnvironment() {
  const required = [
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "PIGE_WINDOWS_CERTIFICATE_SUBJECT",
    "PIGE_WINDOWS_CERTIFICATE_THUMBPRINT"
  ];
  for (const name of required) {
    const value = process.env[name];
    if (!value || value.length > 64 * 1024 || value.includes("\0")) throw new Error(`Required release signing input is absent: ${name}.`);
  }
  if (!/^[0-9A-F]{40}$/iu.test(process.env.PIGE_WINDOWS_CERTIFICATE_THUMBPRINT)) {
    throw new Error("Windows release certificate thumbprint is invalid.");
  }
  if (process.env.PIGE_WINDOWS_CERTIFICATE_SUBJECT.length > 512) {
    throw new Error("Windows release certificate subject is unbounded.");
  }
}

function parseOptions(args) {
  return Object.fromEntries(args.map((argument) => {
    const [key, value] = argument.replace(/^--/u, "").split("=", 2);
    return [key, value];
  }));
}
