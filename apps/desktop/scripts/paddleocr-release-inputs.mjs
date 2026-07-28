import { createHash, createPublicKey, verify } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import yauzl from "yauzl";
import {
  parseReviewedPaddleOcrManifest,
  parseSelectedWheelLock
} from "./build-paddleocr-release-bundle.mjs";
import { canonicalPaddleOcrArtifactIdentity } from "./package-paddleocr-release-bundle.mjs";

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const SHA256_VALUE = /^sha256:[a-f0-9]{64}$/u;
const PLATFORM_VALUES = Object.freeze(["macos-arm64", "windows-x64"]);
const MAX_REDIRECTS = 5;

export async function preparePaddleOcrReleaseInputs(input) {
  const parserManifestPath = requireRegularFilePath(input.parserManifestPath, "parser manifest");
  const wheelLockPath = requireRegularFilePath(input.wheelLockPath, "selected-wheel lock");
  const legalRoot = requireDirectoryPath(input.legalRoot, "legal root");
  const platform = requirePlatform(input.platform);
  const releaseTag = requireReleaseTag(input.releaseTag);
  const artifactRoot = requireAbsentPath(input.artifactRoot, "artifact root");
  const builderLockPath = requireAbsentPath(input.builderLockPath, "builder lock");
  const recordPath = requireAbsentPath(input.recordPath, "input record");
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") fail("A fetch implementation is required.");

  const rawManifest = parseJsonFile(parserManifestPath, "parser manifest", 2 * 1024 * 1024);
  const reviewedManifest = parseReviewedPaddleOcrManifest(rawManifest);
  const publication = parsePublicationContext(rawManifest, platform, releaseTag);
  const rawLock = parseJsonFile(wheelLockPath, "selected-wheel lock", 8 * 1024 * 1024);
  const builderLock = normalizePublicationWheelLock(rawLock);
  const selectedLock = parseSelectedWheelLock(builderLock, reviewedManifest);
  if (selectedLock.platform !== platform) fail("Selected-wheel lock platform does not match the requested platform.");
  verifyCommittedLegalRoot(legalRoot, selectedLock);

  const reviewedInputs = collectReviewedInputs(rawManifest, rawLock, platform, publication.allowedOrigins);
  const temporaryRoot = `${artifactRoot}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(artifactRoot), { recursive: true, mode: 0o700 });
  fs.mkdirSync(temporaryRoot, { mode: 0o700 });
  try {
    const downloads = [];
    for (const item of reviewedInputs) {
      const outputPath = path.join(temporaryRoot, item.filename);
      const result = await downloadExactArtifact({
        ...item,
        outputPath,
        allowedOrigins: publication.allowedOrigins,
        fetchImpl
      });
      downloads.push(result);
    }
    fs.renameSync(temporaryRoot, artifactRoot);
    writeExclusiveJson(builderLockPath, builderLock);
    const record = Object.freeze({
      schemaVersion: 1,
      artifactType: "pige.paddleocr.release_inputs",
      toolId: "paddleocr_local",
      catalogVersion: reviewedManifest.catalogVersion,
      engineVersion: reviewedManifest.engineVersion,
      platform,
      releaseTag,
      artifactUrl: publication.bundle.artifactUrl,
      inputs: downloads.map(({ url, finalOrigin, redirectCount, filename, sizeBytes, sha256 }) => ({
        url,
        finalOrigin,
        redirectCount,
        filename,
        sizeBytes,
        sha256
      }))
    });
    writeExclusiveJson(recordPath, record);
    if (input.githubOutputPath) {
      appendGithubOutput(requireExistingRegularOutput(input.githubOutputPath), {
        artifact_url: publication.bundle.artifactUrl,
        artifact_filename: publication.artifactFilename,
        engine_version: reviewedManifest.engineVersion,
        key_id: publication.bundle.signature.keyId,
        package_limits: JSON.stringify(publication.bundle.packageLimits)
      });
    }
    return record;
  } catch (caught) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw caught;
  }
}

export async function verifyPaddleOcrReleasePublication(input) {
  const parserManifestPath = requireRegularFilePath(input.parserManifestPath, "parser manifest");
  const archivePath = requireRegularFilePath(input.archivePath, "release archive");
  const releaseRecordPath = requireRegularFilePath(input.releaseRecordPath, "release record");
  const verificationRecordPath = requireAbsentPath(input.verificationRecordPath, "verification record");
  const platform = requirePlatform(input.platform);
  const releaseTag = requireReleaseTag(input.releaseTag);
  const rawManifest = parseJsonFile(parserManifestPath, "parser manifest", 2 * 1024 * 1024);
  const reviewedManifest = parseReviewedPaddleOcrManifest(rawManifest);
  const publication = parsePublicationContext(rawManifest, platform, releaseTag);
  const releaseResult = parseReleaseResult(parseJsonFile(releaseRecordPath, "release record", 1024 * 1024));
  const { signature: releaseSignature, ...releaseUnsigned } = releaseResult.bundle;
  const { signature: reviewedSignature, ...reviewedUnsigned } = publication.bundle;
  if (
    stableJson(releaseUnsigned) !== stableJson(reviewedUnsigned) ||
    releaseSignature?.algorithm !== reviewedSignature.algorithm ||
    releaseSignature?.keyId !== reviewedSignature.keyId
  ) {
    fail("Signed release record differs from the reviewed available bundle.");
  }
  if (
    releaseResult.publicKeySpkiBase64 !== null &&
    releaseResult.publicKeySpkiBase64 !== publication.signingKey.publicKeySpkiBase64
  ) {
    fail("Release signer differs from the reviewed public key.");
  }
  if (releaseSignature.valueBase64 !== reviewedSignature.valueBase64) {
    fail("Release signature differs from the reviewed available bundle.");
  }
  const archiveStats = fs.statSync(archivePath);
  if (archiveStats.size !== publication.bundle.sizeBytes) fail("Release archive size differs from the reviewed bundle.");
  const archiveSha256 = `sha256:${await sha256File(archivePath)}`;
  if (archiveSha256 !== publication.bundle.sha256) fail("Release archive digest differs from the reviewed bundle.");
  if (path.basename(archivePath) !== publication.artifactFilename) fail("Release archive filename differs from its immutable URL.");

  const publicKey = createPublicKey({
    key: Buffer.from(publication.signingKey.publicKeySpkiBase64, "base64"),
    format: "der",
    type: "spki"
  });
  if (publicKey.asymmetricKeyType !== "ed25519") fail("Reviewed release key is not Ed25519.");
  const signature = Buffer.from(publication.bundle.signature.valueBase64, "base64");
  if (signature.length !== 64 || !verify(
    null,
    Buffer.from(canonicalPaddleOcrArtifactIdentity(publication.bundle, reviewedManifest.engineVersion), "utf8"),
    publicKey,
    signature
  )) fail("Release signature verification failed.");

  const extractedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-paddleocr-release-verify-"));
  let inspected;
  try {
    await extractVerifiedZip(archivePath, extractedRoot, publication.bundle.packageLimits);
    inspected = inspectExtractedPackage(extractedRoot, publication.bundle, platform, reviewedManifest.engineVersion);
  } finally {
    fs.rmSync(extractedRoot, { recursive: true, force: true });
  }
  const record = Object.freeze({
    schemaVersion: 1,
    artifactType: "pige.paddleocr.release_verification",
    toolId: "paddleocr_local",
    releaseTag,
    platform,
    engineVersion: reviewedManifest.engineVersion,
    artifactUrl: publication.bundle.artifactUrl,
    archiveSha256,
    archiveSizeBytes: archiveStats.size,
    installedTreeSha256: inspected.installedTreeSha256,
    installedSizeBytes: inspected.installedSizeBytes,
    wrapperSha256: inspected.wrapperSha256,
    sbomSha256: inspected.sbomSha256,
    fileCount: inspected.fileCount,
    signatureKeyId: publication.bundle.signature.keyId,
    signatureVerified: true
  });
  writeExclusiveJson(verificationRecordPath, record);
  return record;
}

function parsePublicationContext(manifest, platform, releaseTag) {
  const origins = manifest?.trustedOrigins?.releaseInputs;
  if (!Array.isArray(origins) || origins.length === 0) fail("Reviewed release-input origins are unavailable.");
  const allowedOrigins = Object.freeze([...new Set(origins.map((value) => requireHttpsOrigin(value)))].sort(compareText));
  const bundles = manifest?.releaseBundles;
  if (!Array.isArray(bundles)) fail("Reviewed release bundles are unavailable.");
  if (bundles.filter((entry) => entry?.platform === platform).length !== 1) {
    fail("Reviewed release bundles contain a missing or duplicate platform.");
  }
  const bundle = bundles.find((entry) => entry?.platform === platform);
  if (!bundle || bundle.state === "awaiting_release_artifact") {
    fail(`Reviewed ${platform} bundle is still awaiting a release artifact.`);
  }
  requireExactKeys(bundle, [
    "platform", "state", "artifactUrl", "sizeBytes", "sha256", "signature", "sbomSha256",
    "installedTreeSha256", "installedSizeBytes", "wrapperSha256", "packageLimits"
  ], "reviewed release bundle");
  if (bundle.state !== "available") fail("Reviewed release bundle is not available.");
  const artifactUrl = requireCanonicalHttpsUrl(bundle.artifactUrl, "artifact URL");
  const parsedUrl = new URL(artifactUrl);
  if (parsedUrl.origin !== "https://github.com" || parsedUrl.search || parsedUrl.hash) {
    fail("Release bundle must use the query-free reviewed GitHub release origin.");
  }
  const segments = parsedUrl.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  if (
    segments.length !== 6 || segments[0] !== "YinsenW" || segments[1] !== "Pige" || segments[2] !== "releases" ||
    segments[3] !== "download" || segments[4] !== releaseTag ||
    segments.at(-1).length === 0 || !segments.at(-1).endsWith(".zip")
  ) fail("Release bundle URL is not bound to the exact immutable release tag.");
  const signature = requireObject(bundle.signature, "release signature");
  requireExactKeys(signature, ["algorithm", "keyId", "valueBase64"], "release signature");
  if (signature.algorithm !== "Ed25519") fail("Release signature algorithm is invalid.");
  requireKeyId(signature.keyId);
  requireBase64(signature.valueBase64, "release signature");
  requireSha256Value(bundle.sha256, "archive digest");
  requireSha256Value(bundle.sbomSha256, "SBOM digest");
  requireSha256Value(bundle.installedTreeSha256, "installed-tree digest");
  requireSha256Value(bundle.wrapperSha256, "wrapper digest");
  requirePositiveInteger(bundle.sizeBytes, 4 * 1024 * 1024 * 1024, "archive size");
  requirePositiveInteger(bundle.installedSizeBytes, 4 * 1024 * 1024 * 1024, "installed size");
  parsePackageLimits(bundle.packageLimits);
  const signingKeys = manifest.releaseSigningKeys;
  if (!Array.isArray(signingKeys)) fail("Reviewed PaddleOCR release signing keys are unavailable.");
  if (signingKeys.filter((entry) => entry?.keyId === signature.keyId).length !== 1) {
    fail("Reviewed PaddleOCR release key is missing or duplicated.");
  }
  const signingKey = signingKeys.find((entry) => entry?.keyId === signature.keyId);
  if (!signingKey || signingKey.algorithm !== "Ed25519") fail("Reviewed PaddleOCR release key is unavailable.");
  requireExactKeys(signingKey, ["algorithm", "keyId", "publicKeySpkiBase64"], "release signing key");
  requireBase64(signingKey.publicKeySpkiBase64, "release public key");
  return Object.freeze({
    allowedOrigins,
    artifactFilename: segments.at(-1),
    bundle,
    signingKey
  });
}

function normalizePublicationWheelLock(rawLock) {
  const record = requireObject(rawLock, "selected-wheel lock");
  if (!Array.isArray(record.wheels) || record.wheels.length === 0) fail("Selected-wheel lock has no wheels.");
  return {
    ...record,
    wheels: record.wheels.map((entry, index) => {
      const wheel = requireObject(entry, `wheels[${index}]`);
      requireCanonicalHttpsUrl(wheel.url, `wheels[${index}].url`);
      const { url: _url, ...builderWheel } = wheel;
      return builderWheel;
    })
  };
}

function collectReviewedInputs(manifest, publicationLock, platform, allowedOrigins) {
  const inputs = [];
  const add = (value, label) => {
    const item = requireObject(value, label);
    const url = requireCanonicalHttpsUrl(item.url, `${label}.url`);
    requireAllowedOrigin(url, allowedOrigins, `${label}.url`);
    const filename = requireSafeFilename(item.filename ?? urlFilename(url), `${label}.filename`);
    if (filename !== urlFilename(url)) fail(`${label} filename differs from its exact URL.`);
    inputs.push(Object.freeze({
      url,
      filename,
      sizeBytes: requirePositiveInteger(item.sizeBytes, 4 * 1024 * 1024 * 1024, `${label}.sizeBytes`),
      sha256: requireSha256Hex(item.sha256, `${label}.sha256`)
    }));
  };
  const runtime = manifest?.pythonRuntime?.assets?.find((entry) => entry?.platform === platform);
  if (!runtime) fail("Reviewed platform runtime input is missing.");
  add(runtime, "python runtime");
  for (const [index, model] of requireArray(manifest.models, "models").entries()) add(model, `models[${index}]`);
  for (const [index, wheel] of requireArray(publicationLock.wheels, "wheels").entries()) add(wheel, `wheels[${index}]`);

  const wheelByName = new Map(publicationLock.wheels.map((wheel) => [normalizePythonName(wheel.name), wheel]));
  for (const rootPackage of requireArray(manifest.pythonPackages, "pythonPackages")) {
    assertReviewedWheelMatches(rootPackage, wheelByName.get(normalizePythonName(rootPackage.name)));
  }
  const paddleAsset = manifest?.paddlePaddle?.assets?.find((entry) => entry?.platform === platform);
  assertReviewedWheelMatches(paddleAsset, wheelByName.get("paddlepaddle"));

  inputs.sort((left, right) => compareText(left.filename, right.filename));
  const folded = new Set();
  for (const item of inputs) {
    const key = item.filename.toLocaleLowerCase("en-US");
    if (folded.has(key)) fail(`Release inputs contain a colliding filename: ${item.filename}.`);
    folded.add(key);
  }
  return inputs;
}

function assertReviewedWheelMatches(reviewed, selected) {
  if (!reviewed || !selected) fail("Reviewed root wheel is absent from the selected-wheel lock.");
  for (const key of ["filename", "url", "sizeBytes", "sha256"]) {
    if (reviewed[key] !== selected[key]) fail("Selected root wheel differs from the reviewed parser manifest.");
  }
}

async function downloadExactArtifact(input) {
  let currentUrl = input.url;
  let redirectCount = 0;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    requireAllowedOrigin(currentUrl, input.allowedOrigins, "release input URL");
    const response = await input.fetchImpl(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: { "accept-encoding": "identity", "user-agent": "Pige-PaddleOCR-Release/1" },
      signal: AbortSignal.timeout(10 * 60 * 1000)
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === MAX_REDIRECTS) fail("Release input exceeded the redirect limit.");
      const location = response.headers.get("location");
      if (!location) fail("Release input redirect omitted its destination.");
      currentUrl = new URL(location, currentUrl).href;
      requireAllowedOrigin(currentUrl, input.allowedOrigins, "release input redirect");
      redirectCount += 1;
      continue;
    }
    if (response.status !== 200 || !response.body) fail(`Release input download failed with HTTP ${response.status}.`);
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && Number(contentLength) !== input.sizeBytes) {
      fail("Release input Content-Length differs from its reviewed size.");
    }
    const hash = createHash("sha256");
    let sizeBytes = 0;
    const output = fs.createWriteStream(input.outputPath, { flags: "wx", mode: 0o600 });
    const meter = async function* (source) {
      for await (const chunkValue of source) {
        const chunk = Buffer.from(chunkValue);
        sizeBytes += chunk.length;
        if (sizeBytes > input.sizeBytes) fail("Release input exceeded its reviewed size.");
        hash.update(chunk);
        yield chunk;
      }
    };
    try {
      await pipeline(response.body, meter, output);
    } catch (caught) {
      fs.rmSync(input.outputPath, { force: true });
      throw caught;
    }
    const digest = hash.digest("hex");
    if (sizeBytes !== input.sizeBytes || digest !== input.sha256) {
      fs.rmSync(input.outputPath, { force: true });
      fail("Release input differs from its reviewed size or SHA-256.");
    }
    return Object.freeze({
      url: input.url,
      finalOrigin: new URL(currentUrl).origin,
      redirectCount,
      filename: input.filename,
      sizeBytes,
      sha256: digest
    });
  }
  fail("Release input redirect handling failed closed.");
}

function verifyCommittedLegalRoot(legalRoot, selectedLock) {
  const actual = collectRegularFiles(legalRoot);
  if (actual.length === 0) fail("Committed legal root is empty.");
  const expected = selectedLock.legal.flatMap((entry) => entry.files.map((file) => file.path)).sort(compareText);
  if (stableJson(actual) !== stableJson(expected)) fail("Committed legal root differs from the selected-wheel legal inventory.");
  for (const legal of selectedLock.legal) {
    for (const file of legal.files) {
      const filePath = resolveWithin(legalRoot, file.path);
      const stats = fs.statSync(filePath);
      if (stats.size !== file.sizeBytes || sha256FileSync(filePath) !== file.sha256) {
        fail(`Committed legal file differs from its lock: ${file.path}.`);
      }
    }
  }
}

async function extractVerifiedZip(archivePath, outputRoot, limitsValue) {
  const limits = parsePackageLimits(limitsValue);
  const zip = await openZip(archivePath);
  let count = 0;
  let totalBytes = 0;
  const folded = new Set();
  try {
    for await (const entry of zipEntries(zip)) {
      if (entry.fileName.endsWith("/")) fail("Release archive contains a directory entry.");
      const relativePath = requireSafeRelativePath(entry.fileName);
      const foldedPath = relativePath.toLocaleLowerCase("en-US");
      if (folded.has(foldedPath)) fail("Release archive contains a path collision.");
      folded.add(foldedPath);
      count += 1;
      if (count > limits.maxFiles + 1) fail("Release archive exceeds its reviewed file-count limit.");
      if (entry.uncompressedSize > limits.maxFileBytes && relativePath !== "manifest.json") {
        fail("Release archive entry exceeds its reviewed file limit.");
      }
      totalBytes += entry.uncompressedSize;
      if (totalBytes > limits.maxTotalBytes + limits.maxManifestBytes) fail("Release archive exceeds its reviewed total limit.");
      const unixType = ((entry.externalFileAttributes >>> 16) & 0o170000);
      if (unixType !== 0 && unixType !== 0o100000) fail("Release archive contains a link or special entry.");
      const outputPath = resolveWithin(outputRoot, relativePath);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
      const source = await openZipEntry(zip, entry);
      await pipeline(source, fs.createWriteStream(outputPath, { flags: "wx", mode: 0o600 }));
      zip.readEntry();
    }
  } finally {
    zip.close();
  }
}

function inspectExtractedPackage(root, bundle, platform, engineVersion) {
  const manifestPath = requireRegularFilePath(path.join(root, "manifest.json"), "LocalTool manifest");
  const manifestBytes = fs.readFileSync(manifestPath);
  if (manifestBytes.length > bundle.packageLimits.maxManifestBytes) fail("LocalTool manifest exceeds its reviewed limit.");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (
    manifest?.schemaVersion !== 1 || manifest.toolId !== "paddleocr_local" || manifest.version !== engineVersion ||
    manifest.platform !== (platform === "macos-arm64" ? "macos" : "windows") ||
    manifest.architecture !== (platform === "macos-arm64" ? "arm64" : "x64") || !Array.isArray(manifest.files)
  ) fail("Extracted LocalTool identity is invalid.");
  if (manifest.files.length === 0 || manifest.files.length > bundle.packageLimits.maxFiles) fail("Extracted file count is invalid.");
  const expectedPaths = ["manifest.json"];
  const seen = new Set();
  let installedSizeBytes = 0;
  const treeHash = createHash("sha256");
  treeHash.update("pige-local-tool-package-v1\0", "utf8");
  updateFramedHash(treeHash, "manifest.json", manifestBytes);
  const sortedFiles = [...manifest.files].sort((left, right) => compareText(left.path, right.path));
  for (const entry of sortedFiles) {
    const relativePath = requireSafeRelativePath(entry?.path);
    requireExactKeys(entry, ["path", "sizeBytes", "sha256", "executable"], `manifest file ${relativePath}`);
    const folded = relativePath.toLocaleLowerCase("en-US");
    if (seen.has(folded)) fail("Extracted LocalTool manifest contains a path collision.");
    seen.add(folded);
    const filePath = requireRegularFilePath(resolveWithin(root, relativePath), relativePath);
    const bytes = fs.readFileSync(filePath);
    if (
      bytes.length !== entry.sizeBytes || bytes.length > bundle.packageLimits.maxFileBytes ||
      `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== entry.sha256 || typeof entry.executable !== "boolean"
    ) fail(`Extracted LocalTool file differs from its manifest: ${relativePath}.`);
    installedSizeBytes += bytes.length;
    if (installedSizeBytes > bundle.packageLimits.maxTotalBytes) fail("Extracted LocalTool exceeds its total limit.");
    expectedPaths.push(relativePath);
    updateFramedHash(treeHash, relativePath, bytes);
  }
  if (stableJson(collectRegularFiles(root)) !== stableJson(expectedPaths.sort(compareText))) {
    fail("Release archive contains an undeclared or missing LocalTool file.");
  }
  const wrapper = manifest.files.find((entry) => entry.path === "pige/paddle_ocr_wrapper.py");
  const sbom = manifest.files.find((entry) => entry.path === "sbom/paddleocr.spdx.json");
  const installedTreeSha256 = `sha256:${treeHash.digest("hex")}`;
  if (
    installedSizeBytes !== bundle.installedSizeBytes || installedTreeSha256 !== bundle.installedTreeSha256 ||
    wrapper?.sha256 !== bundle.wrapperSha256 || sbom?.sha256 !== bundle.sbomSha256
  ) fail("Extracted LocalTool tree metadata differs from the reviewed bundle.");
  return Object.freeze({
    installedTreeSha256,
    installedSizeBytes,
    wrapperSha256: wrapper.sha256,
    sbomSha256: sbom.sha256,
    fileCount: manifest.files.length
  });
}

function parseReleaseResult(value) {
  const record = requireObject(value, "release record");
  if (Object.hasOwn(record, "bundle")) {
    requireExactKeys(record, ["bundle", "publicKeySpkiBase64"], "release record");
    requireObject(record.bundle, "release bundle");
    requireBase64(record.publicKeySpkiBase64, "release public key");
    return record;
  }
  return Object.freeze({ bundle: record, publicKeySpkiBase64: null });
}

function parsePackageLimits(value) {
  const record = requireObject(value, "package limits");
  requireExactKeys(record, ["maxManifestBytes", "maxFileBytes", "maxTotalBytes", "maxFiles"], "package limits");
  const limits = {
    maxManifestBytes: requirePositiveInteger(record.maxManifestBytes, 8 * 1024 * 1024, "manifest limit"),
    maxFileBytes: requirePositiveInteger(record.maxFileBytes, 1024 * 1024 * 1024, "file limit"),
    maxTotalBytes: requirePositiveInteger(record.maxTotalBytes, 4 * 1024 * 1024 * 1024, "total limit"),
    maxFiles: requirePositiveInteger(record.maxFiles, 50_000, "file-count limit")
  };
  if (limits.maxFileBytes > limits.maxTotalBytes) fail("Package file limit exceeds total limit.");
  return limits;
}

function collectRegularFiles(root) {
  const files = [];
  const visit = (directory, relative = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => compareText(a.name, b.name))) {
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      requireSafeRelativePath(relativePath);
      const absolutePath = path.join(directory, entry.name);
      const stats = fs.lstatSync(absolutePath);
      if (stats.isSymbolicLink()) fail(`Release tree contains a link: ${relativePath}.`);
      if (stats.isDirectory()) visit(absolutePath, relativePath);
      else if (stats.isFile()) files.push(relativePath);
      else fail(`Release tree contains a special entry: ${relativePath}.`);
    }
  };
  visit(root);
  return files.sort(compareText);
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function sha256FileSync(filePath) {
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

function updateFramedHash(hash, relativePath, bytes) {
  hash.update(`entry\0${relativePath}\0${bytes.length}\0`, "utf8");
  hash.update(bytes);
}

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error("Unable to open release archive."));
      else resolve(zip);
    });
  });
}

async function* zipEntries(zip) {
  let resolveNext;
  let rejectNext;
  const queue = [];
  let ended = false;
  zip.on("entry", (entry) => {
    if (resolveNext) {
      const resolve = resolveNext;
      resolveNext = undefined;
      rejectNext = undefined;
      resolve({ value: entry, done: false });
    } else queue.push(entry);
  });
  zip.on("end", () => {
    ended = true;
    resolveNext?.({ value: undefined, done: true });
  });
  zip.on("error", (error) => rejectNext?.(error));
  zip.readEntry();
  for (;;) {
    if (queue.length > 0) yield queue.shift();
    else if (ended) return;
    else {
      const next = await new Promise((resolve, reject) => {
        resolveNext = resolve;
        rejectNext = reject;
      });
      if (next.done) return;
      yield next.value;
    }
  }
}

function openZipEntry(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new Error("Unable to read release archive entry."));
      else resolve(stream);
    });
  });
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is invalid.`);
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} is invalid.`);
  return value;
}

function requireExactKeys(value, keys, label) {
  if (stableJson(Object.keys(value).sort(compareText)) !== stableJson([...keys].sort(compareText))) {
    fail(`${label} has unexpected fields.`);
  }
}

function requirePlatform(value) {
  if (!PLATFORM_VALUES.includes(value)) fail("Platform is invalid.");
  return value;
}

function requireReleaseTag(value) {
  if (typeof value !== "string" || !/^paddleocr-local-v[0-9][0-9A-Za-z._-]*$/u.test(value)) {
    fail("PaddleOCR release tag is invalid.");
  }
  return value;
}

function requireCanonicalHttpsUrl(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) fail(`${label} is invalid.`);
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.href !== value) fail(`${label} is not canonical HTTPS.`);
  return value;
}

function requireHttpsOrigin(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) fail("Trusted release-input origin is invalid.");
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" || parsed.username || parsed.password ||
    (value !== parsed.origin && value !== `${parsed.origin}/`)
  ) fail("Trusted release-input entry must be an HTTPS origin.");
  return parsed.origin;
}

function requireAllowedOrigin(url, origins, label) {
  const parsed = new URL(requireCanonicalHttpsUrl(url, label));
  if (!origins.includes(parsed.origin)) fail(`${label} uses an unreviewed origin.`);
}

function requireSafeFilename(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._+%-]{0,254}$/u.test(value) || value.includes("..")) {
    fail(`${label} is unsafe.`);
  }
  return value;
}

function requireSafeRelativePath(value) {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 512 || value.includes("\\") || value.includes("\0") ||
    value.includes("%") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)
  ) fail("Release path is unsafe.");
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..") || path.posix.normalize(value) !== value) {
    fail("Release path is unsafe.");
  }
  return value;
}

function requireSha256Hex(value, label) {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) fail(`${label} is invalid.`);
  return value;
}

function requireSha256Value(value, label) {
  if (typeof value !== "string" || !SHA256_VALUE.test(value)) fail(`${label} is invalid.`);
  return value;
}

function requirePositiveInteger(value, maximum, label) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) fail(`${label} is invalid.`);
  return value;
}

function requireKeyId(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(value)) fail("Signing key ID is invalid.");
  return value;
}

function requireBase64(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || Buffer.from(value, "base64").toString("base64") !== value) {
    fail(`${label} is invalid.`);
  }
  return value;
}

function requireRegularFilePath(value, label) {
  if (typeof value !== "string" || value.length === 0) fail(`${label} path is invalid.`);
  const resolved = path.resolve(value);
  const stats = fs.lstatSync(resolved);
  if (!stats.isFile() || stats.isSymbolicLink()) fail(`${label} must be a regular file.`);
  return resolved;
}

function requireDirectoryPath(value, label) {
  if (typeof value !== "string" || value.length === 0) fail(`${label} path is invalid.`);
  const resolved = path.resolve(value);
  const stats = fs.lstatSync(resolved);
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail(`${label} must be a regular directory.`);
  return resolved;
}

function requireAbsentPath(value, label) {
  if (typeof value !== "string" || value.length === 0) fail(`${label} path is invalid.`);
  const resolved = path.resolve(value);
  if (fs.existsSync(resolved)) fail(`${label} must not already exist.`);
  return resolved;
}

function requireExistingRegularOutput(value) {
  if (typeof value !== "string" || value.length === 0) fail("GitHub output path is invalid.");
  const resolved = path.resolve(value);
  const stats = fs.lstatSync(resolved);
  if (!stats.isFile() || stats.isSymbolicLink()) fail("GitHub output must be a regular file.");
  return resolved;
}

function resolveWithin(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...requireSafeRelativePath(relativePath).split("/"));
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) fail("Release path escapes its root.");
  return resolved;
}

function parseJsonFile(filePath, label, maximumBytes) {
  const stats = fs.statSync(filePath);
  if (!Number.isSafeInteger(maximumBytes) || stats.size <= 0 || stats.size > maximumBytes) fail(`${label} exceeds its size limit.`);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    fail(`${label} is invalid JSON.`);
  }
}

function writeExclusiveJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

function appendGithubOutput(filePath, values) {
  const lines = Object.entries(values).map(([key, value]) => {
    if (!/^[a-z_]+$/u.test(key) || typeof value !== "string" || value.includes("\n") || value.includes("\r")) {
      fail("GitHub output value is invalid.");
    }
    return `${key}=${value}`;
  });
  fs.appendFileSync(filePath, `${lines.join("\n")}\n`, { encoding: "utf8" });
}

function urlFilename(url) {
  const segments = new URL(url).pathname.split("/").filter(Boolean);
  return decodeURIComponent(segments.at(-1) ?? "");
}

function normalizePythonName(value) {
  if (typeof value !== "string") fail("Python package name is invalid.");
  return value.trim().toLocaleLowerCase("en-US").replace(/[-_.]+/gu, "-");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort(compareText).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(message) {
  throw new Error(message);
}

function parseCliOptions(args) {
  const options = {};
  for (const argument of args) {
    const match = /^--([a-z-]+)=(.*)$/u.exec(argument);
    if (!match || Object.hasOwn(options, match[1])) fail(`Invalid or duplicate option: ${argument}.`);
    options[match[1]] = match[2];
  }
  return options;
}

async function runCli() {
  const options = parseCliOptions(process.argv.slice(2));
  if (options.action === "prepare") {
    await preparePaddleOcrReleaseInputs({
      platform: options.platform,
      releaseTag: options["release-tag"],
      parserManifestPath: options["parser-manifest"],
      wheelLockPath: options["wheel-lock"],
      legalRoot: options.legal,
      artifactRoot: options.artifacts,
      builderLockPath: options["builder-lock"],
      recordPath: options.record,
      githubOutputPath: options["github-output"]
    });
    return;
  }
  if (options.action === "verify") {
    await verifyPaddleOcrReleasePublication({
      platform: options.platform,
      releaseTag: options["release-tag"],
      parserManifestPath: options["parser-manifest"],
      archivePath: options.archive,
      releaseRecordPath: options["release-record"],
      verificationRecordPath: options["verification-record"]
    });
    return;
  }
  fail("PaddleOCR release input action must be prepare or verify.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
