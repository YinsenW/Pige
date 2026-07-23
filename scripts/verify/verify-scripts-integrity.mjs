import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MANIFEST_PATH = "resources/governance/verify-scripts.manifest.json";
const VERIFY_SCRIPT_PATTERN = /^scripts\/verify\/.+\.mjs$/u;
const GENERATED_DIRECTORY_PATTERN = /\/(?:artifacts|build|coverage|dist|node_modules|out|vendor)\//u;

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function listTrackedVerifyScripts(root) {
  const output = execFileSync("git", ["ls-files", "--cached", "--", "scripts/verify"], {
    cwd: root,
    encoding: "utf8"
  });
  return output.split("\n").filter((relativePath) => VERIFY_SCRIPT_PATTERN.test(relativePath)).sort();
}

export function verifyManifest({ manifest, trackedPaths, readFile }) {
  const failures = [];
  if (manifest?.schemaVersion !== 1) failures.push("manifest must use schemaVersion 1");
  if (manifest?.algorithm !== "sha256") failures.push("manifest algorithm must be sha256");
  if (!Array.isArray(manifest?.files)) return [...failures, "manifest files must be an array"];

  const manifestPaths = manifest.files.map((entry) => entry?.path);
  const sortedManifestPaths = [...manifestPaths].sort();
  if (manifestPaths.some((relativePath) => typeof relativePath !== "string" || !VERIFY_SCRIPT_PATTERN.test(relativePath))) {
    failures.push("manifest contains an invalid verifier path");
  }
  if (manifestPaths.some((relativePath) => GENERATED_DIRECTORY_PATTERN.test(`/${relativePath}`))) {
    failures.push("manifest must not cover generated directories");
  }
  if (new Set(manifestPaths).size !== manifestPaths.length) failures.push("manifest contains duplicate verifier paths");
  if (manifestPaths.join("\n") !== sortedManifestPaths.join("\n")) failures.push("manifest verifier paths must be sorted");

  const manifestPathSet = new Set(manifestPaths);
  const trackedPathSet = new Set(trackedPaths);
  for (const relativePath of trackedPaths) {
    if (!manifestPathSet.has(relativePath)) failures.push(`manifest is missing tracked verifier ${relativePath}`);
  }
  for (const relativePath of manifestPaths) {
    if (!trackedPathSet.has(relativePath)) failures.push(`manifest contains untracked verifier ${relativePath}`);
  }

  for (const entry of manifest.files) {
    if (typeof entry?.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(entry.sha256)) {
      failures.push(`manifest has an invalid sha256 for ${entry?.path ?? "unknown"}`);
      continue;
    }
    if (!trackedPathSet.has(entry.path)) continue;
    const actual = sha256(readFile(entry.path));
    if (actual !== entry.sha256) failures.push(`sha256 mismatch for ${entry.path}`);
  }
  return failures;
}

export function runMutationSelfTests() {
  const bytes = new Map([
    ["scripts/verify/a.mjs", Buffer.from("a\n", "utf8")],
    ["scripts/verify/b.mjs", Buffer.from("b\n", "utf8")]
  ]);
  const trackedPaths = [...bytes.keys()];
  const baseline = {
    schemaVersion: 1,
    algorithm: "sha256",
    files: trackedPaths.map((relativePath) => ({ path: relativePath, sha256: sha256(bytes.get(relativePath)) }))
  };
  const readFile = (relativePath) => bytes.get(relativePath);
  if (verifyManifest({ manifest: baseline, trackedPaths, readFile }).length > 0) {
    throw new Error("verify-scripts integrity self-test baseline failed");
  }

  const generatedPath = "scripts/verify/dist/generated.mjs";
  const generatedBytes = new Map([...bytes, [generatedPath, Buffer.from("generated\n", "utf8")]]);
  const mutations = [
    ["missing", { ...baseline, files: baseline.files.slice(0, 1) }],
    ["extra", { ...baseline, files: [...baseline.files, { path: "scripts/verify/extra.mjs", sha256: "0".repeat(64) }] }],
    ["mismatch", { ...baseline, files: [{ ...baseline.files[0], sha256: "0".repeat(64) }, baseline.files[1]] }],
    ["unsorted", { ...baseline, files: [...baseline.files].reverse() }],
    ["generated", {
      ...baseline,
      files: [...baseline.files, { path: generatedPath, sha256: sha256(generatedBytes.get(generatedPath)) }]
    }, [...trackedPaths, generatedPath], (relativePath) => generatedBytes.get(relativePath)]
  ];
  for (const [label, manifest, candidateTrackedPaths = trackedPaths, candidateReadFile = readFile] of mutations) {
    if (verifyManifest({ manifest, trackedPaths: candidateTrackedPaths, readFile: candidateReadFile }).length === 0) {
      throw new Error(`verify-scripts integrity mutation was accepted: ${label}`);
    }
  }
  return mutations.length;
}

function main() {
  const root = process.cwd();
  const manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST_PATH), "utf8"));
  const trackedPaths = listTrackedVerifyScripts(root);
  const failures = verifyManifest({
    manifest,
    trackedPaths,
    readFile: (relativePath) => fs.readFileSync(path.join(root, relativePath))
  });
  const mutationCount = runMutationSelfTests();
  if (failures.length > 0) {
    console.error("Verify-script integrity failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
    process.exit(1);
  }
  console.log(`Verify-script integrity OK: ${trackedPaths.length} tracked scripts, SHA-256 coverage exact, ${mutationCount} mutations rejected.`);
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(import.meta.filename)) main();
