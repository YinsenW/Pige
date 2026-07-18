import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const prereleaseTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-alpha(?:\.(0|[1-9]\d*|[A-Za-z][0-9A-Za-z-]*))*$/u;

export function parseReleaseTag(tag) {
  if (typeof tag !== "string" || tag.length > 128 || tag.includes("\0")) {
    throw new Error("Release tag is missing or invalid.");
  }
  const match = prereleaseTagPattern.exec(tag);
  if (!match) {
    throw new Error("Release tag must be an alpha prerelease in the form vMAJOR.MINOR.PATCH-alpha[.N].");
  }
  const version = tag.slice(1);
  if (version === "0.0.0" || version.startsWith("0.0.0-")) {
    throw new Error("Release version 0.0.0 is reserved for packageability and cannot be published.");
  }
  return Object.freeze({ tag, version, channel: "alpha" });
}

export function assertReleaseInvocation({ eventName, repository, protectedRef }) {
  if (repository !== "YinsenW/Pige") {
    throw new Error("Release publication is confined to the canonical YinsenW/Pige repository.");
  }
  if (eventName !== "push" || protectedRef !== "true") {
    throw new Error("Release publication requires a protected tag push.");
  }
}

export function resolveExactTagCommit(root, tag) {
  const tagResult = spawnSync("git", ["rev-parse", `refs/tags/${tag}^{commit}`], {
    cwd: root,
    encoding: "utf8"
  });
  if (tagResult.status !== 0) throw new Error("Release tag does not exist in the checked-out repository.");
  const headResult = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  if (headResult.status !== 0) throw new Error("Release checkout has no readable HEAD commit.");
  const tagCommit = tagResult.stdout.trim();
  const headCommit = headResult.stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(tagCommit) || tagCommit !== headCommit) {
    throw new Error("Release tag and checked-out commit do not match exactly.");
  }
  return tagCommit;
}

function parseOptions(args) {
  return Object.fromEntries(args.map((argument) => {
    const [key, ...valueParts] = argument.replace(/^--/u, "").split("=");
    return [key, valueParts.join("=")];
  }));
}

function appendGithubOutput(outputPath, values) {
  if (!outputPath) return;
  const resolved = path.resolve(outputPath);
  fs.appendFileSync(resolved, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""), {
    encoding: "utf8",
    mode: 0o600
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseOptions(process.argv.slice(2));
  assertReleaseInvocation({
    eventName: options.event,
    repository: options.repository,
    protectedRef: options["protected-ref"]
  });
  const release = parseReleaseTag(options.tag);
  const root = path.resolve(options.root || process.cwd());
  const commit = resolveExactTagCommit(root, release.tag);
  appendGithubOutput(options["github-output"], { ...release, commit });
  process.stdout.write(`${JSON.stringify({ ...release, commit })}\n`);
}
