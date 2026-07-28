import { createHash, verify, type KeyLike } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fetch as undiciFetch } from "undici";
import { openPromise, type Entry } from "yauzl";
import { PADDLE_OCR_ENGINE_ID } from "@pige/schemas";
import {
  computeLocalToolPackageSha256,
  parseLocalToolPackageManifest,
  resolveLocalToolPackageLimits,
  type LocalToolPackageLimits,
  type LocalToolPackageManifest
} from "./local-tool-package";
import type {
  PaddleOcrBundleCandidate,
  PaddleOcrBundleMaterializerPort
} from "./paddle-ocr-lifecycle-service";

const MAX_REDIRECTS = 3;
const REQUEST_DIRECTORY_PREFIX = "paddleocr-bundle-";
const ARCHIVE_FILE_NAME = "bundle.zip";
const CANDIDATE_DIRECTORY_NAME = "candidate";
const MANIFEST_FILE_NAME = "manifest.json";
const WRAPPER_PATH = "pige/paddle_ocr_wrapper.py";
const SBOM_PATH = "sbom/paddleocr.spdx.json";
const SHA256_PATTERN = /^(?:sha256:)?([a-f0-9]{64})$/u;
const SAFE_REQUEST_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{7,127}$/u;

export interface ReviewedPaddleOcrAvailableBundle {
  readonly platform: "macos-arm64" | "windows-x64";
  readonly state: "available";
  readonly artifactUrl: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly signature: {
    readonly algorithm: "Ed25519";
    readonly keyId: string;
    readonly valueBase64: string;
  };
  readonly sbomSha256: string;
  readonly installedTreeSha256: string;
  readonly installedSizeBytes: number;
  readonly wrapperSha256: string;
  readonly packageLimits: LocalToolPackageLimits;
}

export interface PaddleOcrBundleFetchResponse {
  readonly status: number;
  readonly url?: string;
  readonly headers: { get(name: string): string | null };
  readonly body: AsyncIterable<Uint8Array> | null;
}

export type PaddleOcrBundleFetch = (
  url: string,
  init: { readonly redirect: "manual"; readonly signal: AbortSignal }
) => Promise<PaddleOcrBundleFetchResponse>;

export interface PaddleOcrBundleFileSystem {
  readonly constants: typeof fs.constants;
  mkdirSync: typeof fs.mkdirSync;
  mkdtempSync: typeof fs.mkdtempSync;
  lstatSync: typeof fs.lstatSync;
  readdirSync: typeof fs.readdirSync;
  openSync: typeof fs.openSync;
  writeSync: typeof fs.writeSync;
  fsyncSync: typeof fs.fsyncSync;
  closeSync: typeof fs.closeSync;
  readFileSync: typeof fs.readFileSync;
  chmodSync: typeof fs.chmodSync;
  rmSync: typeof fs.rmSync;
}

export interface PaddleOcrBundleMaterializerOptions {
  readonly bundle: ReviewedPaddleOcrAvailableBundle;
  readonly engineVersion: string;
  readonly stagingRoot: string;
  readonly redirectOrigins: readonly string[];
  readonly publicKeys: ReadonlyMap<string, KeyLike>;
  readonly fetch?: PaddleOcrBundleFetch;
  readonly fs?: PaddleOcrBundleFileSystem;
  readonly timeoutMs?: number;
}

interface ValidatedBundle {
  readonly bundle: ReviewedPaddleOcrAvailableBundle;
  readonly artifactUrl: string;
  readonly artifactSha256: `sha256:${string}`;
  readonly sbomSha256: `sha256:${string}`;
  readonly installedTreeSha256: `sha256:${string}`;
  readonly wrapperSha256: `sha256:${string}`;
  readonly signature: Buffer;
}

export class PaddleOcrBundleMaterializer implements PaddleOcrBundleMaterializerPort {
  readonly #bundle: ValidatedBundle;
  readonly #engineVersion: string;
  readonly #stagingRoot: string;
  readonly #origins: ReadonlySet<string>;
  readonly #publicKey: KeyLike;
  readonly #limits: LocalToolPackageLimits;
  readonly #fetch: PaddleOcrBundleFetch;
  readonly #fs: PaddleOcrBundleFileSystem;
  readonly #timeoutMs: number;
  readonly #owned = new Map<string, string>();
  readonly #active = new Set<string>();

  constructor(options: PaddleOcrBundleMaterializerOptions) {
    this.#bundle = validateBundle(options.bundle);
    this.#engineVersion = requireEngineVersion(options.engineVersion);
    this.#stagingRoot = path.resolve(options.stagingRoot);
    this.#origins = validateOrigins(options.redirectOrigins, this.#bundle.artifactUrl);
    const publicKey = options.publicKeys.get(this.#bundle.bundle.signature.keyId);
    if (!publicKey) throw bundleError("signature_key_missing");
    this.#publicKey = publicKey;
    this.#limits = resolveLocalToolPackageLimits(this.#bundle.bundle.packageLimits);
    this.#fetch = options.fetch ?? defaultFetch;
    this.#fs = options.fs ?? fs;
    this.#timeoutMs = requireBoundedInteger(options.timeoutMs ?? 120_000, 1_000, 600_000, "timeout");
    assertCanonicalIdentitySignature(this.#bundle, this.#engineVersion, this.#publicKey);
  }

  async materialize(requestId: string): Promise<PaddleOcrBundleCandidate> {
    requireRequestId(requestId);
    if (this.#active.has(requestId)) throw bundleError("request_in_progress");
    this.#active.add(requestId);
    try {
      await this.discard(requestId);
      const requestPath = this.#createRequestDirectory(requestId);
      this.#owned.set(requestId, requestPath);
      const archivePath = path.join(requestPath, ARCHIVE_FILE_NAME);
      const candidatePath = path.join(requestPath, CANDIDATE_DIRECTORY_NAME);
      try {
        await this.#download(archivePath);
        this.#fs.mkdirSync(candidatePath, { mode: 0o700 });
        await extractSafeZip(archivePath, candidatePath, this.#bundle.bundle.installedSizeBytes, this.#limits, this.#fs);
        const manifest = validateExtractedPackage(
          candidatePath,
          this.#bundle,
          this.#engineVersion,
          this.#limits,
          this.#fs
        );
        applyDeclaredModes(candidatePath, manifest, this.#fs);
        const treeSha256 = computeLocalToolPackageSha256(candidatePath, this.#limits);
        if (treeSha256 !== this.#bundle.installedTreeSha256) throw bundleError("tree_digest_mismatch");
        return {
          version: this.#engineVersion,
          candidatePath,
          expectedSha256: treeSha256
        };
      } catch (caught) {
        await this.discard(requestId);
        throw caught;
      }
    } catch (caught) {
      throw caught;
    } finally {
      this.#active.delete(requestId);
    }
  }

  discard(requestId: string): void {
    requireRequestId(requestId);
    const ownedPath = this.#owned.get(requestId);
    if (!ownedPath) return;
    this.#owned.delete(requestId);
    removeOwnedPath(this.#stagingRoot, ownedPath, this.#fs);
  }

  reap(): void {
    if (this.#active.size > 0) throw bundleError("reap_in_progress");
    ensurePrivateRoot(this.#stagingRoot, this.#fs);
    const entries = this.#fs.readdirSync(this.#stagingRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.name.startsWith(REQUEST_DIRECTORY_PREFIX)) continue;
      removeOwnedPath(this.#stagingRoot, path.join(this.#stagingRoot, entry.name), this.#fs);
    }
    this.#owned.clear();
  }

  #createRequestDirectory(requestId: string): string {
    ensurePrivateRoot(this.#stagingRoot, this.#fs);
    const prefix = path.join(this.#stagingRoot, `${REQUEST_DIRECTORY_PREFIX}${requestId}-`);
    const requestPath = this.#fs.mkdtempSync(prefix);
    const stats = this.#fs.lstatSync(requestPath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      removeOwnedPath(this.#stagingRoot, requestPath, this.#fs);
      throw bundleError("staging_invalid");
    }
    return requestPath;
  }

  async #download(archivePath: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    let descriptor: number | undefined;
    try {
      descriptor = this.#fs.openSync(
        archivePath,
        this.#fs.constants.O_WRONLY | this.#fs.constants.O_CREAT | this.#fs.constants.O_EXCL |
          (this.#fs.constants.O_NOFOLLOW ?? 0),
        0o600
      );
      const hash = createHash("sha256");
      let total = 0;
      const response = await fetchReviewedArtifact(
        this.#bundle.artifactUrl,
        this.#origins,
        this.#fetch,
        controller.signal
      );
      const contentLength = response.headers.get("content-length");
      if (contentLength !== null && Number(contentLength) !== this.#bundle.bundle.sizeBytes) {
        throw bundleError("download_size_mismatch");
      }
      if (!response.body) throw bundleError("download_body_missing");
      for await (const value of response.body) {
        const chunk = Buffer.from(value);
        total += chunk.length;
        if (total > this.#bundle.bundle.sizeBytes) throw bundleError("download_size_exceeded");
        writeAll(descriptor, chunk, this.#fs);
        hash.update(chunk);
      }
      if (total !== this.#bundle.bundle.sizeBytes) throw bundleError("download_size_mismatch");
      if (`sha256:${hash.digest("hex")}` !== this.#bundle.artifactSha256) {
        throw bundleError("download_digest_mismatch");
      }
      this.#fs.fsyncSync(descriptor);
    } catch (caught) {
      if (controller.signal.aborted) throw bundleError("download_timeout");
      throw caught;
    } finally {
      clearTimeout(timeout);
      if (descriptor !== undefined) this.#fs.closeSync(descriptor);
    }
  }
}

export function canonicalPaddleOcrArtifactIdentity(
  bundle: ReviewedPaddleOcrAvailableBundle,
  engineVersion: string
): string {
  const validated = validateBundle(bundle);
  const identity = {
    schemaVersion: 1,
    artifactType: "pige.paddleocr.release_bundle",
    toolId: PADDLE_OCR_ENGINE_ID,
    engineVersion: requireEngineVersion(engineVersion),
    platform: validated.bundle.platform,
    artifactUrl: validated.artifactUrl,
    sizeBytes: validated.bundle.sizeBytes,
    sha256: validated.artifactSha256,
    installedTreeSha256: validated.installedTreeSha256,
    installedSizeBytes: validated.bundle.installedSizeBytes,
    wrapperSha256: validated.wrapperSha256,
    sbomSha256: validated.sbomSha256,
    packageLimits: {
      maxManifestBytes: validated.bundle.packageLimits.maxManifestBytes,
      maxFileBytes: validated.bundle.packageLimits.maxFileBytes,
      maxTotalBytes: validated.bundle.packageLimits.maxTotalBytes,
      maxFiles: validated.bundle.packageLimits.maxFiles
    },
    signatureAlgorithm: validated.bundle.signature.algorithm,
    signatureKeyId: validated.bundle.signature.keyId
  };
  return `${JSON.stringify(identity)}\n`;
}

async function fetchReviewedArtifact(
  initialUrl: string,
  origins: ReadonlySet<string>,
  fetcher: PaddleOcrBundleFetch,
  signal: AbortSignal
): Promise<PaddleOcrBundleFetchResponse> {
  let current = initialUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    assertAllowedUrl(current, origins);
    const response = await fetcher(current, { redirect: "manual", signal });
    if (response.url) {
      assertAllowedUrl(response.url, origins);
      if (response.url !== current) throw bundleError("redirect_unreviewed");
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === MAX_REDIRECTS) throw bundleError("redirect_limit_exceeded");
      const location = response.headers.get("location");
      if (!location) throw bundleError("redirect_invalid");
      current = new URL(location, current).href;
      assertAllowedUrl(current, origins);
      continue;
    }
    if (response.status !== 200) throw bundleError("download_failed");
    return response;
  }
  throw bundleError("redirect_limit_exceeded");
}

async function extractSafeZip(
  archivePath: string,
  candidatePath: string,
  expectedExpandedBytes: number,
  limits: LocalToolPackageLimits,
  fileSystem: PaddleOcrBundleFileSystem
): Promise<void> {
  const archive = await openPromise(archivePath, {
    lazyEntries: false,
    validateEntrySizes: true,
    strictFileNames: true
  });
  const seen = new Map<string, "file" | "directory">();
  let entryCount = 0;
  let expandedBytes = 0;
  try {
    for await (const entry of archive.eachEntry()) {
      entryCount += 1;
      if (entryCount > limits.maxFiles + 1_024) throw bundleError("archive_entry_limit_exceeded");
      const parsed = parseArchiveEntry(entry);
      assertNoArchiveCollision(parsed.path, parsed.kind, seen);
      if (parsed.kind === "directory") {
        createPrivateParents(candidatePath, parsed.path, fileSystem);
        continue;
      }
      if (entry.uncompressedSize > limits.maxFileBytes) throw bundleError("archive_entry_size_exceeded");
      expandedBytes += entry.uncompressedSize;
      if (
        expandedBytes > expectedExpandedBytes + limits.maxManifestBytes ||
        expandedBytes > limits.maxTotalBytes + limits.maxManifestBytes
      ) {
        throw bundleError("archive_expanded_size_exceeded");
      }
      const targetPath = resolveCandidatePath(candidatePath, parsed.path);
      createPrivateParents(candidatePath, path.posix.dirname(parsed.path), fileSystem);
      const descriptor = fileSystem.openSync(
        targetPath,
        fileSystem.constants.O_WRONLY | fileSystem.constants.O_CREAT | fileSystem.constants.O_EXCL |
          (fileSystem.constants.O_NOFOLLOW ?? 0),
        0o600
      );
      let actualBytes = 0;
      try {
        const stream = await archive.openReadStreamPromise(entry);
        for await (const value of stream) {
          const chunk = Buffer.from(value);
          actualBytes += chunk.length;
          if (actualBytes > entry.uncompressedSize || actualBytes > limits.maxFileBytes) {
            throw bundleError("archive_entry_size_exceeded");
          }
          writeAll(descriptor, chunk, fileSystem);
        }
        if (actualBytes !== entry.uncompressedSize) throw bundleError("archive_entry_size_mismatch");
        fileSystem.fsyncSync(descriptor);
      } finally {
        fileSystem.closeSync(descriptor);
      }
    }
  } finally {
    archive.close();
  }
}

function validateExtractedPackage(
  candidatePath: string,
  bundle: ValidatedBundle,
  engineVersion: string,
  limits: LocalToolPackageLimits,
  fileSystem: PaddleOcrBundleFileSystem
): LocalToolPackageManifest {
  const manifestPath = path.join(candidatePath, MANIFEST_FILE_NAME);
  let value: unknown;
  try {
    const stats = fileSystem.lstatSync(manifestPath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > limits.maxManifestBytes) {
      throw bundleError("package_manifest_invalid");
    }
    value = JSON.parse(fileSystem.readFileSync(manifestPath, "utf8"));
  } catch {
    throw bundleError("package_manifest_invalid");
  }
  const manifest = parseLocalToolPackageManifest(value, limits);
  const expectedPlatform = bundle.bundle.platform === "macos-arm64" ? "macos" : "windows";
  const expectedArchitecture = bundle.bundle.platform === "macos-arm64" ? "arm64" : "x64";
  if (
    manifest.toolId !== PADDLE_OCR_ENGINE_ID ||
    manifest.assetId !== undefined ||
    manifest.version !== engineVersion ||
    manifest.platform !== expectedPlatform ||
    manifest.architecture !== expectedArchitecture ||
    manifest.capabilities.length !== 1 ||
    manifest.capabilities[0] !== "ocr.image"
  ) {
    throw bundleError("package_identity_mismatch");
  }
  const declaredSize = manifest.files.reduce((total, file) => total + file.sizeBytes, 0);
  if (declaredSize !== bundle.bundle.installedSizeBytes) throw bundleError("package_size_mismatch");
  const wrapper = manifest.files.find((entry) => entry.path === WRAPPER_PATH);
  const sbom = manifest.files.find((entry) => entry.path === SBOM_PATH);
  if (!wrapper || wrapper.sha256 !== bundle.wrapperSha256) throw bundleError("wrapper_digest_mismatch");
  if (!sbom || sbom.sha256 !== bundle.sbomSha256) throw bundleError("sbom_digest_mismatch");
  return manifest;
}

function applyDeclaredModes(
  candidatePath: string,
  manifest: LocalToolPackageManifest,
  fileSystem: PaddleOcrBundleFileSystem
): void {
  if (process.platform === "win32") return;
  for (const file of manifest.files) {
    fileSystem.chmodSync(resolveCandidatePath(candidatePath, file.path), file.executable ? 0o700 : 0o600);
  }
}

function parseArchiveEntry(entry: Entry): { readonly path: string; readonly kind: "file" | "directory" } {
  const entryPath = entry.fileName.endsWith("/") ? entry.fileName.slice(0, -1) : entry.fileName;
  if (!entryPath || entryPath.length > 512 || entry.fileName.includes("\\") || entry.fileName.includes("\0") ||
    entry.fileName.includes("%") || path.posix.isAbsolute(entry.fileName) || path.win32.isAbsolute(entry.fileName)) {
    throw bundleError("archive_path_invalid");
  }
  const segments = entryPath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..") ||
    path.posix.normalize(entryPath) !== entryPath) {
    throw bundleError("archive_path_invalid");
  }
  const directory = entry.fileName.endsWith("/");
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const fileType = unixMode & 0o170000;
  const allowedExtraFields = new Set([0x0001, 0x000a, 0x5455, 0x7075]);
  if (entry.extraFields.some((field) => !allowedExtraFields.has(field.id))) {
    // Link extensions are intentionally not interpreted; extraction only creates new regular files.
    throw bundleError("archive_link_or_special_rejected");
  }
  if (fileType === 0o120000 || (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000)) {
    throw bundleError("archive_link_or_special_rejected");
  }
  if ((directory && fileType === 0o100000) || (!directory && fileType === 0o040000)) {
    throw bundleError("archive_entry_type_mismatch");
  }
  return { path: entryPath, kind: directory ? "directory" : "file" };
}

function assertNoArchiveCollision(
  entryPath: string,
  kind: "file" | "directory",
  seen: Map<string, "file" | "directory">
): void {
  const folded = entryPath.toLocaleLowerCase("en-US");
  if (seen.has(folded)) throw bundleError("archive_duplicate_or_collision");
  const segments = folded.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    if (seen.get(segments.slice(0, index).join("/")) === "file") {
      throw bundleError("archive_duplicate_or_collision");
    }
  }
  if (kind === "file") {
    for (const existing of seen.keys()) {
      if (existing.startsWith(`${folded}/`)) throw bundleError("archive_duplicate_or_collision");
    }
  }
  seen.set(folded, kind);
}

function createPrivateParents(
  rootPath: string,
  relativePath: string,
  fileSystem: PaddleOcrBundleFileSystem
): void {
  if (relativePath === "." || relativePath === "") return;
  let current = rootPath;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    try {
      fileSystem.mkdirSync(current, { mode: 0o700 });
    } catch (caught) {
      if (!isErrno(caught, "EEXIST")) throw caught;
    }
    const stats = fileSystem.lstatSync(current);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw bundleError("archive_parent_invalid");
  }
}

function resolveCandidatePath(rootPath: string, relativePath: string): string {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(root, ...relativePath.split("/"));
  if (!candidate.startsWith(`${root}${path.sep}`)) throw bundleError("archive_path_invalid");
  return candidate;
}

function validateBundle(bundle: ReviewedPaddleOcrAvailableBundle): ValidatedBundle {
  if (!bundle || typeof bundle !== "object" || bundle.state !== "available" ||
    !["macos-arm64", "windows-x64"].includes(bundle.platform)) throw bundleError("catalog_invalid");
  assertExactKeys(bundle as unknown as Record<string, unknown>, [
    "platform",
    "state",
    "artifactUrl",
    "sizeBytes",
    "sha256",
    "signature",
    "sbomSha256",
    "installedTreeSha256",
    "installedSizeBytes",
    "wrapperSha256",
    "packageLimits"
  ]);
  assertExactKeys(bundle.signature as unknown as Record<string, unknown>, ["algorithm", "keyId", "valueBase64"]);
  const artifactUrl = requireCanonicalHttpsUrl(bundle.artifactUrl);
  const artifactSha256 = requireSha256(bundle.sha256, "artifact");
  const sbomSha256 = requireSha256(bundle.sbomSha256, "sbom");
  const installedTreeSha256 = requireSha256(bundle.installedTreeSha256, "tree");
  const wrapperSha256 = requireSha256(bundle.wrapperSha256, "wrapper");
  requireBoundedInteger(bundle.sizeBytes, 1, 4 * 1024 * 1024 * 1024, "archive size");
  requireBoundedInteger(bundle.installedSizeBytes, 1, 4 * 1024 * 1024 * 1024, "installed size");
  resolveLocalToolPackageLimits(bundle.packageLimits);
  if (bundle.signature?.algorithm !== "Ed25519" || !/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(bundle.signature.keyId)) {
    throw bundleError("signature_invalid");
  }
  const signature = decodeCanonicalBase64(bundle.signature.valueBase64);
  if (signature.length !== 64) throw bundleError("signature_invalid");
  return { bundle, artifactUrl, artifactSha256, sbomSha256, installedTreeSha256, wrapperSha256, signature };
}

function assertCanonicalIdentitySignature(bundle: ValidatedBundle, engineVersion: string, publicKey: KeyLike): void {
  const identity = canonicalPaddleOcrArtifactIdentity(bundle.bundle, engineVersion);
  let valid = false;
  try {
    valid = verify(null, Buffer.from(identity, "utf8"), publicKey, bundle.signature);
  } catch {
    valid = false;
  }
  if (!valid) throw bundleError("signature_invalid");
}

function validateOrigins(origins: readonly string[], artifactUrl: string): ReadonlySet<string> {
  if (origins.length < 1 || origins.length > 8) throw bundleError("origin_allowlist_invalid");
  const validated = new Set(origins.map((origin) => {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" || parsed.origin !== origin || parsed.username || parsed.password) {
      throw bundleError("origin_allowlist_invalid");
    }
    return origin;
  }));
  if (validated.size !== origins.length || !validated.has(new URL(artifactUrl).origin)) {
    throw bundleError("origin_allowlist_invalid");
  }
  return validated;
}

function assertAllowedUrl(value: string, origins: ReadonlySet<string>): void {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !origins.has(parsed.origin)) {
    throw bundleError("download_url_forbidden");
  }
}

function requireCanonicalHttpsUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_048) throw bundleError("catalog_invalid");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.href !== value) {
    throw bundleError("catalog_invalid");
  }
  return value;
}

function requireSha256(value: unknown, _label: string): `sha256:${string}` {
  if (typeof value !== "string") throw bundleError("catalog_invalid");
  const match = SHA256_PATTERN.exec(value);
  if (!match) throw bundleError("catalog_invalid");
  return `sha256:${match[1]}`;
}

function requireEngineVersion(value: string): string {
  if (!/^[0-9][a-z0-9.+_-]{0,63}$/u.test(value)) throw bundleError("catalog_invalid");
  return value;
}

function requireRequestId(value: string): void {
  if (!SAFE_REQUEST_ID_PATTERN.test(value)) throw bundleError("request_invalid");
}

function requireBoundedInteger(value: unknown, minimum: number, maximum: number, _label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw bundleError("catalog_invalid");
  }
  return value as number;
}

function decodeCanonicalBase64(value: unknown): Buffer {
  if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw bundleError("signature_invalid");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw bundleError("signature_invalid");
  return decoded;
}

function ensurePrivateRoot(rootPath: string, fileSystem: PaddleOcrBundleFileSystem): void {
  try {
    fileSystem.mkdirSync(rootPath, { recursive: true, mode: 0o700 });
  } catch (caught) {
    if (!isErrno(caught, "EEXIST")) throw caught;
  }
  const stats = fileSystem.lstatSync(rootPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw bundleError("staging_invalid");
}

function removeOwnedPath(rootPath: string, ownedPath: string, fileSystem: PaddleOcrBundleFileSystem): void {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(ownedPath);
  if (path.dirname(candidate) !== root || !path.basename(candidate).startsWith(REQUEST_DIRECTORY_PREFIX)) {
    throw bundleError("staging_ownership_invalid");
  }
  fileSystem.rmSync(candidate, { recursive: true, force: true });
}

function writeAll(descriptor: number, bytes: Buffer, fileSystem: PaddleOcrBundleFileSystem): void {
  let offset = 0;
  while (offset < bytes.length) {
    const written = fileSystem.writeSync(descriptor, bytes, offset, bytes.length - offset);
    if (written <= 0) throw bundleError("staging_write_failed");
    offset += written;
  }
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw bundleError("catalog_invalid");
  }
}

function isErrno(caught: unknown, code: string): boolean {
  return typeof caught === "object" && caught !== null && "code" in caught && String(caught.code) === code;
}

function bundleError(code: string): Error {
  const error = new Error("The reviewed PaddleOCR release bundle could not be materialized.");
  error.name = `PaddleOcrBundleError:${code}`;
  return error;
}

const defaultFetch: PaddleOcrBundleFetch = async (url, init) =>
  await undiciFetch(url, init) as unknown as PaddleOcrBundleFetchResponse;
