import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPackageabilityHost, resolvePackageabilityPlatform } from "./packageability-platforms.mjs";
import { sanitizeElectronBuilderEnvironment } from "./packageability-security.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const options = parseOptions(process.argv.slice(2));
if (!options.platform || !options.arch) throw new Error("Electron packaging requires --platform and --arch.");

const target = resolvePackageabilityPlatform(options.platform, options.arch);
assertPackageabilityHost(target);

const desktopRoot = path.join(root, "apps/desktop");
const electronBuilderCliPath = require.resolve("electron-builder/out/cli/cli.js");
const outputPath = path.posix.join("../../artifacts/release-packageability", target.outputDirectory);
const result = spawnSync(process.execPath, [
  electronBuilderCliPath,
  "--config",
  "electron-builder.yml",
  `--config.directories.output=${outputPath}`,
  target.builderPlatformFlag,
  `--${target.arch}`
], {
  cwd: desktopRoot,
  env: sanitizeElectronBuilderEnvironment(process.env),
  encoding: "utf8",
  stdio: "inherit"
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

function parseOptions(args) {
  return Object.fromEntries(args.map((argument) => {
    const [key, value] = argument.replace(/^--/u, "").split("=", 2);
    return [key, value];
  }));
}
