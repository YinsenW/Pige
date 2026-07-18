import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseReleaseTag } from "./release-tag.mjs";

const platformDefinitions = Object.freeze({
  "macos-arm64": {
    required: (version) => [
      `Pige-${version}-arm64.dmg`,
      `Pige-${version}-arm64.zip`,
      `Pige-${version}-arm64.zip.blockmap`,
      "alpha-mac.yml"
    ],
    artifactPattern: (version) => new RegExp(`^Pige-${escapeRegex(version)}-arm64\\.(?:dmg|zip(?:\\.blockmap)?)$`, "u"),
    metadataPattern: /^(?:alpha|latest)-mac\.yml$/u,
    updateArtifactPattern: (version) => new RegExp(`^Pige-${escapeRegex(version)}-arm64\\.zip$`, "u")
  },
  "windows-x64": {
    required: (version) => [
      `Pige-${version}-x64-setup.exe`,
      `Pige-${version}-x64-setup.exe.blockmap`,
      "alpha.yml"
    ],
    artifactPattern: (version) => new RegExp(`^Pige-${escapeRegex(version)}-x64-setup\\.exe(?:\\.blockmap)?$`, "u"),
    metadataPattern: /^(?:alpha|latest)\.yml$/u,
    updateArtifactPattern: (version) => new RegExp(`^Pige-${escapeRegex(version)}-x64-setup\\.exe$`, "u")
  }
});

export function createReleaseManifest({ directory, platform, tag, commit }) {
  const release = parseReleaseTag(tag);
  const definition = resolvePlatform(platform);
  assertCommit(commit);
  const names = collectPublishableNames(directory, definition, release.version);
  assertRequiredNames(names, definition.required(release.version));
  verifyUpdateMetadata(directory, names, definition, release.version);
  const files = names.map((name) => describeFile(directory, name));
  const manifest = Object.freeze({
    schemaVersion: 1,
    tag: release.tag,
    version: release.version,
    channel: release.channel,
    commit,
    platform,
    files
  });
  const manifestName = `release-manifest-${platform}.json`;
  const checksumsName = `SHA256SUMS-${platform}.txt`;
  writeExclusiveJson(path.join(directory, manifestName), manifest);
  fs.writeFileSync(
    path.join(directory, checksumsName),
    files.map((file) => `${file.sha256}  ${file.name}\n`).join(""),
    { encoding: "utf8", mode: 0o644, flag: "wx" }
  );
  return manifest;
}

export function verifyReleaseManifest({ directory, platform, tag, commit }) {
  const release = parseReleaseTag(tag);
  const definition = resolvePlatform(platform);
  assertCommit(commit);
  const manifestName = `release-manifest-${platform}.json`;
  const checksumsName = `SHA256SUMS-${platform}.txt`;
  const manifest = readJson(path.join(directory, manifestName));
  if (
    manifest.schemaVersion !== 1 || manifest.tag !== release.tag || manifest.version !== release.version ||
    manifest.channel !== release.channel || manifest.commit !== commit || manifest.platform !== platform ||
    !Array.isArray(manifest.files)
  ) throw new Error("Release manifest identity does not match the requested release.");
  const names = collectPublishableNames(directory, definition, release.version);
  assertRequiredNames(names, definition.required(release.version));
  if (JSON.stringify(manifest.files.map((file) => file.name)) !== JSON.stringify(names)) {
    throw new Error("Release manifest file set does not match downloaded artifacts.");
  }
  for (const expected of manifest.files) {
    const actual = describeFile(directory, expected.name);
    if (
      expected.bytes !== actual.bytes || expected.sha256 !== actual.sha256 || expected.sha512 !== actual.sha512
    ) throw new Error(`Release artifact checksum mismatch: ${expected.name}.`);
  }
  const expectedChecksums = manifest.files.map((file) => `${file.sha256}  ${file.name}\n`).join("");
  if (fs.readFileSync(path.join(directory, checksumsName), "utf8") !== expectedChecksums) {
    throw new Error("Release SHA256SUMS file does not match the immutable manifest.");
  }
  verifyUpdateMetadata(directory, names, definition, release.version);
  return manifest;
}

export function parseElectronBuilderUpdateMetadata(content) {
  if (typeof content !== "string" || content.length === 0 || content.length > 256 * 1024 || content.includes("\0")) {
    throw new Error("Update metadata is missing or unbounded.");
  }
  if (/[&*!][A-Za-z0-9_-]+/u.test(content) || /(?:^|\s)!!/u.test(content)) {
    throw new Error("Update metadata must not contain YAML aliases, anchors, or explicit tags.");
  }
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  const versionLine = lines.find((line) => /^version:\s*/u.test(line));
  if (!versionLine) throw new Error("Update metadata has no version.");
  const version = scalar(versionLine.replace(/^version:\s*/u, ""));
  const files = [];
  let current;
  let inFiles = false;
  for (const line of lines) {
    if (line === "files:") {
      inFiles = true;
      continue;
    }
    if (inFiles && /^\S/u.test(line)) {
      inFiles = false;
      current = undefined;
    }
    if (!inFiles) continue;
    const urlMatch = /^\s*-\s+url:\s*(.+)$/u.exec(line);
    if (urlMatch) {
      current = { url: scalar(urlMatch[1]) };
      files.push(current);
      continue;
    }
    const propertyMatch = /^\s+(sha512|size):\s*(.+)$/u.exec(line);
    if (current && propertyMatch) current[propertyMatch[1]] = scalar(propertyMatch[2]);
  }
  if (files.length === 0 || files.length > 16) throw new Error("Update metadata has no bounded file projection.");
  for (const file of files) {
    if (!file.url || !file.sha512 || !/^[1-9]\d*$/u.test(file.size ?? "")) {
      throw new Error("Update metadata file entry is incomplete.");
    }
  }
  return { version, files };
}

function verifyUpdateMetadata(directory, names, definition, version) {
  const metadataNames = names.filter((name) => definition.metadataPattern.test(name));
  if (metadataNames.length === 0) throw new Error("Release update metadata is absent.");
  let containsRequiredUpdateArtifact = false;
  for (const metadataName of metadataNames) {
    const metadata = parseElectronBuilderUpdateMetadata(fs.readFileSync(path.join(directory, metadataName), "utf8"));
    if (metadata.version !== version) throw new Error(`Update metadata version mismatch: ${metadataName}.`);
    for (const entry of metadata.files) {
      assertSafeName(entry.url);
      const decodedName = decodeURIComponent(entry.url);
      assertSafeName(decodedName);
      if (!names.includes(decodedName)) throw new Error(`Update metadata references an absent artifact: ${decodedName}.`);
      const filePath = path.join(directory, decodedName);
      if (Number(entry.size) !== fs.statSync(filePath).size) {
        throw new Error(`Update metadata size mismatch: ${decodedName}.`);
      }
      if (entry.sha512 !== checksum(filePath, "sha512", "base64")) {
        throw new Error(`Update metadata SHA-512 mismatch: ${decodedName}.`);
      }
      if (definition.updateArtifactPattern(version).test(decodedName)) containsRequiredUpdateArtifact = true;
    }
  }
  if (!containsRequiredUpdateArtifact) throw new Error("Update metadata omits the required signed update artifact.");
}

function collectPublishableNames(directory, definition, version) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && (definition.artifactPattern(version).test(entry.name) || definition.metadataPattern.test(entry.name)))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  for (const name of names) {
    assertSafeName(name);
    const stat = fs.lstatSync(path.join(directory, name));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) throw new Error(`Invalid release artifact: ${name}.`);
    if (name.includes("0.0.0")) throw new Error("Packageability version 0.0.0 cannot enter release artifacts.");
  }
  return names;
}

function assertRequiredNames(names, required) {
  for (const name of required) if (!names.includes(name)) throw new Error(`Required release artifact is absent: ${name}.`);
}

function describeFile(directory, name) {
  assertSafeName(name);
  const filePath = path.join(directory, name);
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Release artifact is not a regular file: ${name}.`);
  return {
    name,
    bytes: stat.size,
    sha256: checksum(filePath, "sha256", "hex"),
    sha512: checksum(filePath, "sha512", "base64")
  };
}

function checksum(filePath, algorithm, encoding) {
  return createHash(algorithm).update(fs.readFileSync(filePath)).digest(encoding);
}

function scalar(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function assertSafeName(name) {
  if (
    typeof name !== "string" || name.length === 0 || name.length > 240 || name !== path.basename(name) ||
    name.includes("\0") || name.includes("\\") || name === "." || name === ".."
  ) throw new Error("Release metadata contains an unsafe artifact name.");
}

function assertCommit(commit) {
  if (!/^[0-9a-f]{40}$/u.test(commit ?? "")) throw new Error("Release commit must be an exact SHA-1 identity.");
}

function resolvePlatform(platform) {
  const definition = platformDefinitions[platform];
  if (!definition) throw new Error(`Unsupported release platform: ${String(platform)}.`);
  return definition;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeExclusiveJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o644, flag: "wx" });
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function parseOptions(args) {
  return Object.fromEntries(args.map((argument) => {
    const [key, ...valueParts] = argument.replace(/^--/u, "").split("=");
    return [key, valueParts.join("=")];
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseOptions(process.argv.slice(2));
  const action = options.action;
  const parameters = {
    directory: path.resolve(options.directory || ""),
    platform: options.platform,
    tag: options.tag,
    commit: options.commit
  };
  const result = action === "create"
    ? createReleaseManifest(parameters)
    : action === "verify"
      ? verifyReleaseManifest(parameters)
      : (() => { throw new Error("Release artifact action must be create or verify."); })();
  process.stdout.write(`${JSON.stringify({ platform: result.platform, files: result.files.length })}\n`);
}
