import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZipFile } from "yazl";

const ARCHIVE_MTIME = new Date("2026-07-28T00:00:00.000Z");
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const WRAPPER_PATH = "pige/paddle_ocr_wrapper.py";
const SBOM_PATH = "sbom/paddleocr.spdx.json";

export async function packagePaddleOcrReleaseBundle(input) {
  const packageRoot = requireDirectory(input.packageRoot, "package root");
  const outputPath = requireAbsentPath(input.outputPath, "archive output");
  const artifactUrl = requireCanonicalHttpsUrl(input.artifactUrl);
  const platform = requireEnum(input.platform, ["macos-arm64", "windows-x64"], "platform");
  const engineVersion = requireString(input.engineVersion, "engineVersion", 1, 80);
  const keyId = requireKeyId(input.keyId);
  const packageLimits = parsePackageLimits(input.packageLimits);
  const privateKey = input.privateKey?.type === "private"
    ? input.privateKey
    : createPrivateKey(input.privateKey);
  if (privateKey.asymmetricKeyType !== "ed25519") fail("Release private key must be Ed25519.");

  const inspected = inspectPackage(packageRoot, platform, engineVersion, packageLimits);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeDeterministicZip(packageRoot, inspected.archiveFiles, inspected.executablePaths, temporaryPath);
    const archiveStats = requireRegularFile(temporaryPath, "release archive");
    const unsigned = {
      platform,
      state: "available",
      artifactUrl,
      sizeBytes: archiveStats.size,
      sha256: `sha256:${sha256File(temporaryPath)}`,
      signature: {
        algorithm: "Ed25519",
        keyId,
        valueBase64: ""
      },
      sbomSha256: inspected.sbomSha256,
      installedTreeSha256: inspected.packageSha256,
      installedSizeBytes: inspected.installedSizeBytes,
      wrapperSha256: inspected.wrapperSha256,
      packageLimits
    };
    const signature = sign(
      null,
      Buffer.from(canonicalPaddleOcrArtifactIdentity(unsigned, engineVersion), "utf8"),
      privateKey
    );
    if (signature.length !== 64) fail("Ed25519 signature has an invalid length.");
    fs.renameSync(temporaryPath, outputPath);
    return Object.freeze({
      bundle: Object.freeze({
        ...unsigned,
        signature: Object.freeze({
          ...unsigned.signature,
          valueBase64: signature.toString("base64")
        })
      }),
      publicKeySpkiBase64: createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64")
    });
  } catch (caught) {
    fs.rmSync(temporaryPath, { force: true });
    throw caught;
  }
}

export function canonicalPaddleOcrArtifactIdentity(bundle, engineVersion) {
  const limits = parsePackageLimits(bundle.packageLimits);
  const identity = {
    schemaVersion: 1,
    artifactType: "pige.paddleocr.release_bundle",
    toolId: "paddleocr_local",
    engineVersion: requireString(engineVersion, "engineVersion", 1, 80),
    platform: requireEnum(bundle.platform, ["macos-arm64", "windows-x64"], "platform"),
    artifactUrl: requireCanonicalHttpsUrl(bundle.artifactUrl),
    sizeBytes: requireInteger(bundle.sizeBytes, 1, 4 * 1024 * 1024 * 1024, "archive size"),
    sha256: requireSha256(bundle.sha256, "artifact digest"),
    installedTreeSha256: requireSha256(bundle.installedTreeSha256, "installed tree digest"),
    installedSizeBytes: requireInteger(bundle.installedSizeBytes, 1, 4 * 1024 * 1024 * 1024, "installed size"),
    wrapperSha256: requireSha256(bundle.wrapperSha256, "wrapper digest"),
    sbomSha256: requireSha256(bundle.sbomSha256, "SBOM digest"),
    packageLimits: {
      maxManifestBytes: limits.maxManifestBytes,
      maxFileBytes: limits.maxFileBytes,
      maxTotalBytes: limits.maxTotalBytes,
      maxFiles: limits.maxFiles
    },
    signatureAlgorithm: "Ed25519",
    signatureKeyId: requireKeyId(bundle.signature?.keyId)
  };
  return `${JSON.stringify(identity)}\n`;
}

function inspectPackage(packageRoot, platform, engineVersion, limits) {
  const actualFiles = collectRegularFiles(packageRoot);
  if (!actualFiles.includes("manifest.json")) fail("LocalTool package manifest is missing.");
  const manifestPath = path.join(packageRoot, "manifest.json");
  const manifestStats = requireRegularFile(manifestPath, "LocalTool package manifest");
  if (manifestStats.size > limits.maxManifestBytes) fail("LocalTool package manifest exceeds reviewed limits.");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    fail("LocalTool package manifest is invalid JSON.");
  }
  if (
    manifest?.schemaVersion !== 1 || manifest.toolId !== "paddleocr_local" || manifest.version !== engineVersion ||
    manifest.platform !== (platform === "macos-arm64" ? "macos" : "windows") ||
    manifest.architecture !== (platform === "macos-arm64" ? "arm64" : "x64") || !Array.isArray(manifest.files)
  ) fail("LocalTool package identity differs from the release target.");
  if (manifest.files.length === 0 || manifest.files.length > limits.maxFiles) {
    fail("LocalTool package file count exceeds reviewed limits.");
  }

  const expected = ["manifest.json"];
  let installedSizeBytes = 0;
  const seen = new Set();
  const hash = createHash("sha256");
  hash.update("pige-local-tool-package-v1\0", "utf8");
  const manifestBytes = fs.readFileSync(manifestPath);
  updateFramedHash(hash, "manifest.json", manifestBytes);
  const sortedEntries = [...manifest.files].sort((left, right) => compareText(left.path, right.path));
  for (const entry of sortedEntries) {
    const relativePath = requireSafeRelativePath(entry?.path);
    const folded = relativePath.toLocaleLowerCase("en-US");
    if (seen.has(folded)) fail("LocalTool package contains a path collision.");
    seen.add(folded);
    const sizeBytes = requireInteger(entry.sizeBytes, 0, limits.maxFileBytes, `${relativePath} size`);
    const expectedSha256 = requireSha256(entry.sha256, `${relativePath} digest`);
    if (typeof entry.executable !== "boolean") fail(`LocalTool executable flag is invalid: ${relativePath}.`);
    const absolutePath = path.join(packageRoot, ...relativePath.split("/"));
    const stats = requireRegularFile(absolutePath, relativePath);
    if (stats.size !== sizeBytes || `sha256:${sha256File(absolutePath)}` !== expectedSha256) {
      fail(`LocalTool package file differs from its manifest: ${relativePath}.`);
    }
    installedSizeBytes += sizeBytes;
    if (installedSizeBytes > limits.maxTotalBytes) fail("LocalTool package exceeds reviewed aggregate size.");
    expected.push(relativePath);
    updateFramedHash(hash, relativePath, fs.readFileSync(absolutePath));
  }
  if (JSON.stringify(actualFiles) !== JSON.stringify(expected.sort(compareText))) {
    fail("LocalTool package contains an undeclared or missing file.");
  }
  const wrapper = manifest.files.find((entry) => entry.path === WRAPPER_PATH);
  const sbom = manifest.files.find((entry) => entry.path === SBOM_PATH);
  if (!wrapper || !sbom) fail("LocalTool package lacks its fixed wrapper or SPDX SBOM.");
  return Object.freeze({
    archiveFiles: Object.freeze(actualFiles),
    executablePaths: Object.freeze(new Set(manifest.files
      .filter((entry) => entry.executable === true)
      .map((entry) => entry.path))),
    installedSizeBytes,
    packageSha256: `sha256:${hash.digest("hex")}`,
    wrapperSha256: requireSha256(wrapper.sha256, "wrapper digest"),
    sbomSha256: requireSha256(sbom.sha256, "SBOM digest")
  });
}

async function writeDeterministicZip(root, relativeFiles, executablePaths, outputPath) {
  const zip = new ZipFile();
  const output = fs.createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
  const completed = new Promise((resolve, reject) => {
    output.once("close", resolve);
    output.once("error", reject);
    zip.outputStream.once("error", reject);
  });
  zip.outputStream.pipe(output);
  for (const relativePath of relativeFiles) {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    zip.addFile(absolutePath, relativePath, {
      mtime: ARCHIVE_MTIME,
      mode: executablePaths.has(relativePath) ? 0o100700 : 0o100600,
      compress: true
    });
  }
  zip.end({ forceZip64Format: false });
  await completed;
}

function collectRegularFiles(root) {
  requireDirectory(root, "package root");
  const files = [];
  const visit = (directory, relative = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))) {
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      requireSafeRelativePath(relativePath);
      const absolutePath = path.join(directory, entry.name);
      const stats = fs.lstatSync(absolutePath);
      if (stats.isSymbolicLink()) fail(`LocalTool package contains a link: ${relativePath}.`);
      if (stats.isDirectory()) visit(absolutePath, relativePath);
      else if (stats.isFile()) files.push(relativePath);
      else fail(`LocalTool package contains a special entry: ${relativePath}.`);
    }
  };
  visit(root);
  return files.sort(compareText);
}

function updateFramedHash(hash, relativePath, bytes) {
  hash.update(`entry\0${relativePath}\0${bytes.length}\0`, "utf8");
  hash.update(bytes);
}

function parsePackageLimits(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Package limits are invalid.");
  const keys = Object.keys(value).sort(compareText);
  if (JSON.stringify(keys) !== JSON.stringify(["maxFileBytes", "maxFiles", "maxManifestBytes", "maxTotalBytes"])) {
    fail("Package limits have unexpected fields.");
  }
  const limits = {
    maxManifestBytes: requireInteger(value.maxManifestBytes, 1, 8 * 1024 * 1024, "manifest limit"),
    maxFileBytes: requireInteger(value.maxFileBytes, 1, 1024 * 1024 * 1024, "file limit"),
    maxTotalBytes: requireInteger(value.maxTotalBytes, 1, 4 * 1024 * 1024 * 1024, "total limit"),
    maxFiles: requireInteger(value.maxFiles, 1, 50_000, "file-count limit")
  };
  if (limits.maxFileBytes > limits.maxTotalBytes) fail("Package file limit exceeds aggregate limit.");
  return Object.freeze(limits);
}

function requireSafeRelativePath(value) {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 512 || value.includes("\\") ||
    value.includes("\0") || value.includes("%") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)
  ) {
    fail("LocalTool package path is invalid.");
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") || path.posix.normalize(value) !== value) {
    fail(`LocalTool package path is unsafe: ${value}.`);
  }
  return value;
}

function requireDirectory(value, label) {
  if (typeof value !== "string" || value.length === 0) fail(`${label} is invalid.`);
  const resolved = path.resolve(value);
  const stats = fs.lstatSync(resolved);
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail(`${label} must be a regular directory.`);
  return resolved;
}

function requireAbsentPath(value, label) {
  if (typeof value !== "string" || value.length === 0) fail(`${label} is invalid.`);
  const resolved = path.resolve(value);
  if (fs.existsSync(resolved)) fail(`${label} already exists.`);
  return resolved;
}

function requireRegularFile(value, label) {
  const stats = fs.lstatSync(value);
  if (!stats.isFile() || stats.isSymbolicLink()) fail(`${label} must be a regular file.`);
  return stats;
}

function requireCanonicalHttpsUrl(value) {
  const text = requireString(value, "artifactUrl", 1, 2048);
  const parsed = new URL(text);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.href !== text) {
    fail("Artifact URL must be canonical HTTPS without credentials.");
  }
  return text;
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) fail(`${label} is invalid.`);
  return value;
}

function requireKeyId(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(value)) fail("Signing key ID is invalid.");
  return value;
}

function requireString(value, label, minimum, maximum) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) fail(`${label} is invalid.`);
  return value;
}

function requireInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`${label} is invalid.`);
  return value;
}

function requireEnum(value, allowed, label) {
  if (!allowed.includes(value)) fail(`${label} is invalid.`);
  return value;
}

function sha256File(filePath) {
  const hash = createHash("sha256");
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) return hash.digest("hex");
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(message) {
  throw new Error(message);
}

async function runCli() {
  const options = Object.fromEntries(process.argv.slice(2).map((argument) => {
    const match = /^--([a-z-]+)=(.*)$/u.exec(argument);
    if (!match) fail(`Invalid argument: ${argument}.`);
    return [match[1], match[2]];
  }));
  const privateKeyPath = requireString(options["private-key"], "private-key", 1, 4096);
  const result = await packagePaddleOcrReleaseBundle({
    packageRoot: options.package,
    outputPath: options.output,
    artifactUrl: options.url,
    platform: options.platform,
    engineVersion: options.version,
    keyId: options["key-id"],
    privateKey: fs.readFileSync(privateKeyPath),
    packageLimits: JSON.parse(requireString(options.limits, "limits", 2, 2048))
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
