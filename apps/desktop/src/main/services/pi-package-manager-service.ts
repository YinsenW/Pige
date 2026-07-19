import { createHash, randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import fs from "node:fs";
import net, { type LookupFunction } from "node:net";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import * as tar from "tar";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import {
  assertPermissionedExternalExecutionAuthority,
  type PermissionedExternalExecutionAuthority
} from "./permissioned-external-capability-service";
import { createPinnedLookup, isNonPublicNetworkAddress } from "./source-fetch-service";

const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,63}|[a-z0-9][a-z0-9._-]{0,127})$/u;
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,119}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAX_PACKUMENT_BYTES = 8 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 256 * 1024 * 1024;
const MAX_EXTRACTED_FILE_BYTES = 64 * 1024 * 1024;
const MAX_EXTRACTED_FILES = 20_000;
const MAX_EXTRACTED_ENTRIES = 20_000;
const MAX_ENTRY_PATH_BYTES = 1024;
const MAX_ENTRY_DEPTH = 32;
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_REGISTRY_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;
const OWNER_MARKER = ".pige-package-owner.json";
const REGISTRY_ORIGIN = "https://registry.npmjs.org";
const ACTIVE_PACKAGE_LOCKS = new Set<string>();

export interface PiPackageInstallRequest {
  readonly requestId: string;
  readonly packageName: string;
  readonly version: string;
}

export interface PiPackageInstallSummary {
  readonly status: "installed_disabled";
  readonly packageId: string;
  readonly packageName: string;
  readonly version: string;
  readonly revision: number;
  readonly packageTypes: readonly PiPackageType[];
  readonly dependencyCount: number;
  readonly requiresEnable: true;
}

type PiPackageType = "extension" | "skill" | "prompt" | "theme";

interface ResolvedPackagePlan {
  readonly packageName: string;
  readonly version: string;
  readonly tarballUrl: string;
  readonly integrity: string;
  readonly packageTypes: readonly PiPackageType[];
  readonly dependencyCount: number;
  readonly manifestHash: string;
}

interface PackageRecord extends Omit<PiPackageInstallSummary, "status" | "revision" | "requiresEnable"> {
  readonly treeHash: string;
  readonly archiveHash: string;
  readonly integrity: string;
  readonly manifestHash: string;
  readonly relativePath: string;
  readonly installedAt: string;
  readonly enabled: false;
  readonly trust: "community";
  readonly requests: readonly PackageRequestRecord[];
}

interface PackageRequestRecord {
  readonly requestId: string;
  readonly revision: number;
}

interface PackageRegistryFile {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly packages: readonly PackageRecord[];
}

interface PackageOwnerMarker {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly packageId: string;
  readonly packageName: string;
  readonly version: string;
}

interface FetchTarget {
  readonly url: string;
  readonly hostname: string;
  readonly addresses: readonly string[];
}

interface FetchResponseHandle {
  readonly response: Response;
  dispose(): Promise<void>;
}

type FetchImplementation = (url: string, init: RequestInit & { readonly dispatcher?: Dispatcher }) => Promise<Response>;

export interface PiPackageManagerOptions {
  readonly appDataRoot: string;
  readonly fetchImpl?: typeof fetch;
  readonly lookup?: (hostname: string) => Promise<readonly string[]>;
  readonly now?: () => Date;
  readonly processAlive?: (pid: number) => boolean;
  readonly testOnlyMaxExtractedEntries?: number;
}

export class PiPackageManagerService {
  readonly #root: string;
  readonly #installedRoot: string;
  readonly #stagingRoot: string;
  readonly #registryPath: string;
  readonly #lockPath: string;
  readonly #fetchImpl: FetchImplementation;
  readonly #lookup: (hostname: string) => Promise<readonly string[]>;
  readonly #pinAddresses: boolean;
  readonly #now: () => Date;
  readonly #maxExtractedEntries: number;

  constructor(options: PiPackageManagerOptions) {
    const appDataRoot = canonicalPrivateRoot(options.appDataRoot);
    this.#root = path.join(appDataRoot, "pi-packages");
    this.#installedRoot = path.join(this.#root, "installed");
    this.#stagingRoot = path.join(this.#root, "staging");
    this.#registryPath = path.join(this.#root, "registry.json");
    this.#lockPath = path.join(this.#root, ".install.lock");
    this.#fetchImpl = options.fetchImpl
      ? ((url, init) => options.fetchImpl!(url, init) as Promise<Response>)
      : (undiciFetch as unknown as FetchImplementation);
    this.#lookup = options.lookup ?? lookupHostname;
    this.#pinAddresses = !options.fetchImpl;
    this.#now = options.now ?? (() => new Date());
    this.#maxExtractedEntries = options.testOnlyMaxExtractedEntries === undefined
      ? MAX_EXTRACTED_ENTRIES
      : requireTestEntryLimit(options.testOnlyMaxExtractedEntries);
    this.#prepare();
    recoverOrphanedLock(this.#lockPath, options.processAlive ?? isProcessAlive);
    this.#recoverOwnedResidue(this.#readRegistry());
  }

  async install(
    request: PiPackageInstallRequest,
    signal: AbortSignal,
    authority?: PermissionedExternalExecutionAuthority
  ): Promise<PiPackageInstallSummary> {
    assertPermissionedExternalExecutionAuthority(authority, "install_package");
    const normalized = normalizePiPackageInstallRequest(request);
    signal.throwIfAborted();
    const lock = acquireLock(this.#lockPath);
    let stagingPath: string | undefined;
    let publishedPath: string | undefined;
    try {
      const current = this.#readRegistry();
      this.#recoverOwnedResidue(current);
      const prior = current.packages.find((record) => requestRecord(record, normalized.requestId) !== undefined);
      if (prior) {
        assertSameRequest(prior, normalized);
        this.#assertInstalledRecord(prior);
        return projectRecord(prior, requestRecord(prior, normalized.requestId)!.revision);
      }
      const existing = current.packages.find((record) =>
        record.packageName === normalized.packageName && record.version === normalized.version
      );
      if (existing) {
        this.#assertInstalledRecord(existing);
        const nextRevision = incrementRevision(current.revision);
        const adopted = {
          ...existing,
          requests: [...existing.requests, { requestId: normalized.requestId, revision: nextRevision }]
        };
        const next = replaceRecord(current, adopted, nextRevision);
        this.#writeRegistry(next);
        return projectRecord(adopted, nextRevision);
      }

      const plan = await this.#resolvePlan(normalized, signal);
      stagingPath = this.#createStaging(normalized);
      const archivePath = path.join(stagingPath, "package.tgz");
      const archiveHash = await this.#downloadArchive(plan, archivePath, signal);
      const extractedPath = path.join(stagingPath, "package");
      fs.mkdirSync(extractedPath, { mode: 0o700 });
      await extractBoundedArchive(archivePath, extractedPath, signal, this.#maxExtractedEntries);
      fs.rmSync(archivePath, { force: true });
      const inspection = inspectExtractedPackage(extractedPath, normalized, plan);
      const packageId = createPackageId(normalized.packageName);
      const owner: PackageOwnerMarker = {
        schemaVersion: 1,
        requestId: normalized.requestId,
        packageId,
        packageName: normalized.packageName,
        version: normalized.version
      };
      writePrivateJson(path.join(extractedPath, OWNER_MARKER), owner);
      fsyncDirectory(extractedPath);

      const relativePath = path.join(
        "installed",
        packageId,
        normalized.version,
        inspection.treeHash.slice("sha256:".length)
      );
      publishedPath = path.join(this.#root, relativePath);
      ensureConfined(this.#installedRoot, publishedPath);
      fs.mkdirSync(path.dirname(publishedPath), { recursive: true, mode: 0o700 });
      if (fs.existsSync(publishedPath)) throw packageError("package.install_conflict", "Package destination already exists.");
      fs.renameSync(extractedPath, publishedPath);
      fs.rmSync(stagingPath, { recursive: true });
      stagingPath = undefined;
      fsyncDirectory(path.dirname(publishedPath));

      const nextRevision = incrementRevision(current.revision);
      const record: PackageRecord = {
        packageId,
        packageName: normalized.packageName,
        version: normalized.version,
        packageTypes: plan.packageTypes,
        dependencyCount: plan.dependencyCount,
        treeHash: inspection.treeHash,
        archiveHash,
        integrity: plan.integrity,
        manifestHash: plan.manifestHash,
        relativePath,
        installedAt: this.#now().toISOString(),
        enabled: false,
        trust: "community",
        requests: [{ requestId: normalized.requestId, revision: nextRevision }]
      };
      const next: PackageRegistryFile = {
        schemaVersion: 1,
        revision: nextRevision,
        packages: [...current.packages, record].sort(compareRecords)
      };
      this.#writeRegistry(next);
      fs.rmSync(path.join(publishedPath, OWNER_MARKER), { force: true });
      fsyncDirectory(publishedPath);
      return projectRecord(record, next.revision);
    } catch (caught) {
      if (stagingPath) removeOwnedDirectory(stagingPath, normalized.requestId);
      if (publishedPath && !this.#publishedRequestMayBeCommitted(normalized, publishedPath)) {
        removeOwnedDirectory(publishedPath, normalized.requestId);
      }
      throw normalizeFailure(caught);
    } finally {
      lock.release();
    }
  }

  adopt(request: PiPackageInstallRequest): PiPackageInstallSummary {
    const normalized = normalizePiPackageInstallRequest(request);
    const current = this.#readRegistry();
    const record = current.packages.find((candidate) => requestRecord(candidate, normalized.requestId) !== undefined);
    if (!record) throw packageError("package.install_result_unavailable", "Package install result is unavailable.");
    assertSameRequest(record, normalized);
    this.#assertInstalledRecord(record);
    return projectRecord(record, requestRecord(record, normalized.requestId)!.revision);
  }

  async #resolvePlan(request: PiPackageInstallRequest, signal: AbortSignal): Promise<ResolvedPackagePlan> {
    const encodedName = request.packageName.startsWith("@")
      ? request.packageName.replace("/", "%2f")
      : request.packageName;
    const handle = await this.#fetchFollowingRedirects(`${REGISTRY_ORIGIN}/${encodedName}/${request.version}`, signal, MAX_PACKUMENT_BYTES);
    let body: Buffer;
    try {
      body = await readBoundedBody(handle.response, MAX_PACKUMENT_BYTES, signal);
    } finally {
      await handle.dispose();
    }
    let manifest: Record<string, any>;
    try {
      manifest = JSON.parse(body.toString("utf8"));
    } catch {
      throw packageError("package.metadata_invalid", "Package registry metadata is invalid.");
    }
    if (manifest.name !== request.packageName || manifest.version !== request.version) {
      throw packageError("package.identity_mismatch", "Package metadata does not match the exact request.");
    }
    const tarballUrl = requireRegistryUrl(manifest.dist?.tarball);
    const integrity = requireSha512Integrity(manifest.dist?.integrity);
    const packageTypes = parsePackageTypes(manifest.pi);
    if (packageTypes.length === 0) throw packageError("package.not_pi_package", "The npm package does not declare Pi package content.");
    assertNoInstallHooks(manifest.scripts);
    assertNoExecutablePackageMetadata(manifest);
    const dependencyCount = assertNoRuntimeDependencies(manifest);
    const manifestHash = hashCanonical(manifestIdentity(manifest));
    return { packageName: request.packageName, version: request.version, tarballUrl, integrity, packageTypes, dependencyCount, manifestHash };
  }

  async #downloadArchive(plan: ResolvedPackagePlan, destination: string, signal: AbortSignal): Promise<string> {
    const handle = await this.#fetchFollowingRedirects(plan.tarballUrl, signal, MAX_ARCHIVE_BYTES);
    const response = handle.response;
    let descriptor: number | undefined;
    const sha256 = createHash("sha256");
    const sha512 = createHash("sha512");
    let bytes = 0;
    try {
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_ARCHIVE_BYTES) {
        throw packageError("package.archive_too_large", "Package archive exceeds its size limit.");
      }
      descriptor = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
      if (!response.body) throw packageError("package.download_failed", "Package archive response has no body.");
      const reader = response.body.getReader();
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        bytes += value.byteLength;
        if (bytes > MAX_ARCHIVE_BYTES) throw packageError("package.archive_too_large", "Package archive exceeds its size limit.");
        sha256.update(value);
        sha512.update(value);
        fs.writeSync(descriptor, value);
      }
      fs.fsyncSync(descriptor);
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      await handle.dispose();
    }
    const actualIntegrity = `sha512-${sha512.digest("base64")}`;
    if (actualIntegrity !== plan.integrity) {
      throw packageError("package.integrity_mismatch", "Package archive integrity did not match registry metadata.");
    }
    return `sha256:${sha256.digest("hex")}`;
  }

  async #fetchFollowingRedirects(url: string, signal: AbortSignal, maxBytes: number): Promise<FetchResponseHandle> {
    let current = await this.#validateRegistryTarget(url);
    for (let count = 0; count <= MAX_REDIRECTS; count += 1) {
      const handle = await this.#fetchOne(current, signal);
      const response = handle.response;
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.ok) {
          await handle.dispose();
          throw packageError("package.download_failed", "Package registry request failed.");
        }
        const length = Number(response.headers.get("content-length"));
        if (Number.isFinite(length) && length > maxBytes) {
          await handle.dispose();
          throw packageError("package.download_too_large", "Package registry response exceeded its size limit.");
        }
        return handle;
      }
      const location = response.headers.get("location");
      await handle.dispose();
      if (!location || count === MAX_REDIRECTS) throw packageError("package.redirect_invalid", "Package registry redirect was invalid.");
      current = await this.#validateRegistryTarget(new URL(location, current.url).toString());
    }
    throw packageError("package.redirect_invalid", "Package registry redirected too many times.");
  }

  async #validateRegistryTarget(value: string): Promise<FetchTarget> {
    let parsed: URL;
    try { parsed = new URL(value); } catch { throw packageError("package.registry_url_invalid", "Package registry URL is invalid."); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.origin !== REGISTRY_ORIGIN) {
      throw packageError("package.registry_url_invalid", "Package registry URL left the reviewed registry origin.");
    }
    parsed.hash = "";
    let addresses: readonly string[];
    try { addresses = await this.#lookup(parsed.hostname); } catch { throw packageError("package.registry_unreachable", "Package registry could not be resolved."); }
    const normalized = [...new Set(addresses.map(stripBrackets))];
    if (normalized.length === 0 || normalized.some((address) => net.isIP(address) === 0 || isNonPublicNetworkAddress(address))) {
      throw packageError("package.registry_unreachable", "Package registry resolved to an invalid address.");
    }
    return { url: parsed.toString(), hostname: stripBrackets(parsed.hostname), addresses: normalized };
  }

  async #fetchOne(target: FetchTarget, externalSignal: AbortSignal): Promise<FetchResponseHandle> {
    externalSignal.throwIfAborted();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const abort = (): void => controller.abort();
    externalSignal.addEventListener("abort", abort, { once: true });
    const dispatcher = this.#pinAddresses ? createPinnedAgent(target) : undefined;
    try {
      const response = await this.#fetchImpl(target.url, {
        redirect: "manual",
        signal: controller.signal,
        ...(dispatcher ? { dispatcher } : {}),
        headers: { "User-Agent": "Pige/0.1 Pi Package Manager", Accept: "application/json,application/octet-stream;q=0.9" }
      });
      let disposed = false;
      return {
        response,
        dispose: async () => {
          if (disposed) return;
          disposed = true;
          clearTimeout(timeout);
          externalSignal.removeEventListener("abort", abort);
          if (response.body && !response.bodyUsed) await response.body.cancel().catch(() => undefined);
          if (dispatcher) {
            try { await dispatcher.close(); } catch { await dispatcher.destroy().catch(() => undefined); }
          }
        }
      };
    } catch {
      clearTimeout(timeout);
      externalSignal.removeEventListener("abort", abort);
      if (dispatcher) await dispatcher.destroy().catch(() => undefined);
      if (externalSignal.aborted) throw new DOMException("Package download was cancelled.", "AbortError");
      throw packageError(controller.signal.aborted ? "package.download_timeout" : "package.download_failed", "Package download failed.");
    }
  }

  #prepare(): void {
    fs.mkdirSync(this.#installedRoot, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.#stagingRoot, { recursive: true, mode: 0o700 });
    for (const candidate of [this.#root, this.#installedRoot, this.#stagingRoot]) {
      const stats = fs.lstatSync(candidate);
      if (!stats.isDirectory() || stats.isSymbolicLink()) throw packageError("package.root_invalid", "Package storage is unsafe.");
    }
  }

  #createStaging(request: PiPackageInstallRequest): string {
    const stagingPath = path.join(this.#stagingRoot, `${request.requestId}.${randomUUID()}`);
    ensureConfined(this.#stagingRoot, stagingPath);
    fs.mkdirSync(stagingPath, { mode: 0o700 });
    writePrivateJson(path.join(stagingPath, OWNER_MARKER), {
      schemaVersion: 1,
      requestId: request.requestId,
      packageId: createPackageId(request.packageName),
      packageName: request.packageName,
      version: request.version
    } satisfies PackageOwnerMarker);
    return stagingPath;
  }

  #readRegistry(): PackageRegistryFile {
    const body = readBoundedNoFollow(this.#registryPath, MAX_REGISTRY_BYTES);
    if (body === undefined) return { schemaVersion: 1, revision: 0, packages: [] };
    try { return validateRegistry(JSON.parse(body)); } catch { throw packageError("package.registry_invalid", "Package Registry is unavailable."); }
  }

  #writeRegistry(registry: PackageRegistryFile): void {
    const validated = validateRegistry(registry);
    const temporaryPath = path.join(this.#root, `.registry.${process.pid}.${randomUUID()}.tmp`);
    let descriptor: number | undefined;
    let renamed = false;
    try {
      descriptor = fs.openSync(temporaryPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
      fs.writeFileSync(descriptor, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporaryPath, this.#registryPath);
      renamed = true;
      fsyncDirectory(this.#root);
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      if (!renamed) fs.rmSync(temporaryPath, { force: true });
    }
  }

  #recoverOwnedResidue(registry: PackageRegistryFile): void {
    for (const entry of fs.readdirSync(this.#stagingRoot)) {
      const candidate = path.join(this.#stagingRoot, entry);
      const marker = readOwnerMarker(candidate);
      if (marker) removeOwnedDirectory(candidate, marker.requestId);
    }
    const registered = new Map(registry.packages.map((record) => [path.resolve(this.#root, record.relativePath), record]));
    for (const candidate of walkVersionDirectories(this.#installedRoot)) {
      const record = registered.get(path.resolve(candidate));
      if (record) {
        const markerPath = path.join(candidate, OWNER_MARKER);
        if (fs.existsSync(markerPath)) {
          const marker = readOwnerMarker(candidate);
          if (
            !marker || marker.packageId !== record.packageId || marker.packageName !== record.packageName ||
            marker.version !== record.version || !record.requests.some((request) => request.requestId === marker.requestId)
          ) throw packageError("package.install_changed", "Installed package recovery marker changed.");
          fs.rmSync(markerPath);
          fsyncDirectory(candidate);
        }
        continue;
      }
      const marker = readOwnerMarker(candidate);
      if (marker) removeOwnedDirectory(candidate, marker.requestId);
    }
  }

  #publishedRequestMayBeCommitted(request: PiPackageInstallRequest, publishedPath: string): boolean {
    try {
      const relativePath = path.relative(this.#root, publishedPath);
      return this.#readRegistry().packages.some((record) =>
        record.relativePath === relativePath && record.packageName === request.packageName &&
        record.version === request.version && requestRecord(record, request.requestId) !== undefined
      );
    } catch {
      return true;
    }
  }

  #assertInstalledRecord(record: PackageRecord): void {
    const installedPath = path.join(this.#root, record.relativePath);
    ensureConfined(this.#installedRoot, installedPath);
    const plan: ResolvedPackagePlan = {
      packageName: record.packageName,
      version: record.version,
      tarballUrl: "",
      integrity: record.integrity,
      packageTypes: record.packageTypes,
      dependencyCount: record.dependencyCount,
      manifestHash: record.manifestHash
    };
    const inspection = inspectExtractedPackage(installedPath, {
      requestId: record.requests[0]!.requestId, packageName: record.packageName, version: record.version
    }, plan);
    if (inspection.treeHash !== record.treeHash) throw packageError("package.install_changed", "Installed package content changed.");
  }
}

async function extractBoundedArchive(
  archivePath: string,
  destination: string,
  signal: AbortSignal,
  maxEntries: number
): Promise<void> {
  let fileCount = 0;
  let entryCount = 0;
  let totalBytes = 0;
  let validationError: PigeDomainError | undefined;
  const seen = new Set<string>();
  await tar.x({
    file: archivePath,
    cwd: destination,
    gzip: true,
    strip: 1,
    strict: true,
    preservePaths: false,
    filter: (entryPath, entry) => {
      if (validationError) return false;
      if (signal.aborted) {
        validationError = packageError("package.install_cancelled", "Package extraction was cancelled.");
        return false;
      }
      let normalized: string;
      try { normalized = validateArchiveEntryPath(entryPath); }
      catch (caught) {
        validationError = normalizeFilterError(caught);
        return false;
      }
      const entryType = "type" in entry
        ? entry.type
        : entry.isDirectory()
          ? "Directory"
          : entry.isFile()
            ? "File"
            : "Unsupported";
      if (!["File", "Directory"].includes(entryType)) {
        validationError = packageError("package.archive_unsafe_entry", "Package archive contains an unsafe entry.");
        return false;
      }
      entryCount += 1;
      if (entryCount > maxEntries) {
        validationError = packageError("package.archive_too_large", "Package archive contains too many entries.");
        return false;
      }
      const extractedPath = normalized.split("/").slice(1).join("/");
      if (extractedPath.length === 0) {
        if (entryType !== "Directory") {
          validationError = packageError("package.archive_path_invalid", "Package archive entry has no extracted path.");
          return false;
        }
        return true;
      }
      const collisionKey = extractedPath.normalize("NFKC").toLocaleLowerCase("en-US");
      if (seen.has(collisionKey)) {
        validationError = packageError("package.archive_collision", "Package archive contains conflicting paths.");
        return false;
      }
      seen.add(collisionKey);
      if (entryType === "File") {
        fileCount += 1;
        const fileBytes = Number(entry.size ?? 0);
        totalBytes += fileBytes;
        if (!Number.isSafeInteger(fileBytes) || fileBytes < 0 || fileBytes > MAX_EXTRACTED_FILE_BYTES) {
          validationError = packageError("package.archive_too_large", "Package archive contains an oversized file.");
          return false;
        }
        if (fileCount > MAX_EXTRACTED_FILES || totalBytes > MAX_EXTRACTED_BYTES) {
          validationError = packageError("package.archive_too_large", "Package archive expands beyond its limit.");
          return false;
        }
      }
      return true;
    }
  });
  if (validationError) throw validationError;
  signal.throwIfAborted();
  assertSafeTree(destination);
}

function requireTestEntryLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_EXTRACTED_ENTRIES) {
    throw packageError("package.limit_invalid", "Package extraction test limit is invalid.");
  }
  return value;
}

function inspectExtractedPackage(root: string, request: PiPackageInstallRequest, plan: ResolvedPackagePlan): { readonly treeHash: string } {
  const manifest = parseBoundedJson(path.join(root, "package.json"), MAX_MANIFEST_BYTES);
  if (manifest.name !== request.packageName || manifest.version !== request.version || hashCanonical(manifestIdentity(manifest)) !== plan.manifestHash) {
    throw packageError("package.identity_mismatch", "Extracted package identity changed after inspection.");
  }
  if (JSON.stringify(parsePackageTypes(manifest.pi)) !== JSON.stringify(plan.packageTypes)) {
    throw packageError("package.capability_changed", "Package declarations changed after inspection.");
  }
  assertNoInstallHooks(manifest.scripts);
  assertNoExecutablePackageMetadata(manifest);
  assertNoRuntimeDependencies(manifest);
  assertDeclaredPiEntries(root, manifest.pi);
  const digest = createHash("sha256");
  hashTree(root, root, digest);
  return { treeHash: `sha256:${digest.digest("hex")}` };
}

function assertDeclaredPiEntries(root: string, pi: unknown): void {
  if (!pi || typeof pi !== "object" || Array.isArray(pi)) throw packageError("package.manifest_invalid", "Pi package declaration is invalid.");
  for (const key of ["extensions", "skills", "prompts", "themes"]) {
    const entries = (pi as Record<string, unknown>)[key];
    if (entries === undefined) continue;
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > 64) throw packageError("package.manifest_invalid", "Pi package entries are invalid.");
    for (const entry of entries) {
      if (typeof entry !== "string") throw packageError("package.manifest_invalid", "Pi package entry is invalid.");
      const normalized = validateRelativePackagePath(entry);
      const target = path.join(root, ...normalized.split("/"));
      ensureConfined(root, target);
      const stats = fs.lstatSync(target);
      if (!stats.isFile() || stats.isSymbolicLink()) throw packageError("package.manifest_invalid", "Declared Pi package entry is unavailable.");
    }
  }
}

function assertNoInstallHooks(value: unknown): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw packageError("package.manifest_invalid", "Package scripts are invalid.");
  const scripts = value as Record<string, unknown>;
  if (Object.keys(scripts).length > 128 || Object.entries(scripts).some(([name, script]) =>
    name.length === 0 || name.length > 128 || typeof script !== "string" || script.length > 32_768
  )) throw packageError("package.manifest_invalid", "Package scripts are invalid.");
  const blocked = ["preinstall", "install", "postinstall", "prepare", "prepublish", "prepublishOnly"];
  if (blocked.some((name) => Object.prototype.hasOwnProperty.call(scripts, name))) {
    throw packageError("package.install_hooks_blocked", "Packages with install lifecycle hooks are not supported.");
  }
}

function assertNoExecutablePackageMetadata(manifest: Record<string, unknown>): void {
  if (
    Object.prototype.hasOwnProperty.call(manifest, "bin") ||
    manifest.gypfile === true ||
    Object.prototype.hasOwnProperty.call(manifest, "binary")
  ) {
    throw packageError(
      "package.executable_metadata_blocked",
      "Packages with executable or native build metadata are not supported."
    );
  }
}

function assertSafeDependencySpecs(value: unknown): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw packageError("package.dependencies_invalid", "Package dependencies are invalid.");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 256) throw packageError("package.dependencies_invalid", "Package dependency graph is too large.");
  for (const [name, spec] of entries) {
    if (!PACKAGE_NAME_PATTERN.test(name) || typeof spec !== "string" || spec.length === 0 || spec.length > 128) {
      throw packageError("package.dependencies_invalid", "Package dependency is invalid.");
    }
    if (/^(?:file:|git(?:\+|:)|https?:|workspace:|npm:|github:|gitlab:|bitbucket:|link:)/iu.test(spec)) {
      throw packageError("package.dependencies_unsupported", "Package dependency source is unsupported.");
    }
  }
}

function assertNoRuntimeDependencies(manifest: Record<string, unknown>): number {
  const objectFields = ["dependencies", "optionalDependencies", "peerDependencies"] as const;
  let dependencyCount = 0;
  for (const field of objectFields) {
    const value = manifest[field];
    assertSafeDependencySpecs(value);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      dependencyCount += Object.keys(value).length;
    }
  }
  for (const field of ["bundledDependencies", "bundleDependencies"] as const) {
    const value = manifest[field];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.length > 256 || value.some((name) => typeof name !== "string" || !PACKAGE_NAME_PATTERN.test(name))) {
      throw packageError("package.dependencies_invalid", "Bundled package dependencies are invalid.");
    }
    dependencyCount += value.length;
  }
  if (dependencyCount > 0) {
    throw packageError("package.dependencies_unsupported", "Packages with runtime dependencies are not supported by the bounded installer.");
  }
  return dependencyCount;
}

function parsePackageTypes(value: unknown): readonly PiPackageType[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const types: PiPackageType[] = [];
  if (Array.isArray(record.extensions) && record.extensions.length > 0) types.push("extension");
  if (Array.isArray(record.skills) && record.skills.length > 0) types.push("skill");
  if (Array.isArray(record.prompts) && record.prompts.length > 0) types.push("prompt");
  if (Array.isArray(record.themes) && record.themes.length > 0) types.push("theme");
  return types;
}

function validateArchiveEntryPath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/u, "");
  if (
    Buffer.byteLength(normalized, "utf8") > MAX_ENTRY_PATH_BYTES || normalized.includes("\0") ||
    normalized.startsWith("/") || /^[A-Za-z]:/u.test(normalized) || normalized.startsWith("//") ||
    normalized.length === 0 || normalized.split("/").length > MAX_ENTRY_DEPTH || normalized.split("/").some(isUnsafePathSegment)
  ) throw packageError("package.archive_path_invalid", "Package archive path is invalid.");
  return normalized;
}

function validateRelativePackagePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (normalized !== value || normalized.startsWith("/") || normalized.includes("\0") || normalized.split("/").some(isUnsafePathSegment)) {
    throw packageError("package.manifest_invalid", "Pi package entry path is invalid.");
  }
  return normalized;
}

function isUnsafePathSegment(part: string): boolean {
  if (part === "" || part === "." || part === ".." || part.endsWith(".") || part.endsWith(" ") || part.includes(":")) return true;
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(part);
}

function assertSafeTree(root: string): void {
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory)) {
      const candidate = path.join(directory, entry);
      ensureConfined(root, candidate);
      const stats = fs.lstatSync(candidate);
      if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory())) throw packageError("package.archive_unsafe_entry", "Package contains an unsafe filesystem entry.");
      if (stats.isFile() && (
        stats.size > MAX_EXTRACTED_FILE_BYTES ||
        candidate.toLocaleLowerCase("en-US").endsWith(".node") ||
        hasExecutableBinaryMagic(candidate)
      )) {
        throw packageError("package.executable_content_blocked", "Package contains unsupported executable or oversized content.");
      }
      if (stats.isDirectory()) {
        fs.chmodSync(candidate, 0o700);
        visit(candidate);
      } else {
        fs.chmodSync(candidate, 0o600);
      }
    }
  };
  visit(root);
}

function hasExecutableBinaryMagic(filePath: string): boolean {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const header = Buffer.alloc(8);
    const bytes = fs.readSync(descriptor, header, 0, header.length, 0);
    if (bytes >= 4) {
      const magic = header.subarray(0, 4).toString("hex");
      if (["7f454c46", "feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca", "0061736d"].includes(magic)) {
        return true;
      }
    }
    return bytes >= 2 && header[0] === 0x4d && header[1] === 0x5a;
  } finally {
    fs.closeSync(descriptor);
  }
}

function hashTree(root: string, directory: string, digest: ReturnType<typeof createHash>): void {
  for (const entry of fs.readdirSync(directory).sort((left, right) => left.localeCompare(right, "en"))) {
    if (entry === OWNER_MARKER && directory === root) continue;
    const candidate = path.join(directory, entry);
    const stats = fs.lstatSync(candidate);
    const relative = path.relative(root, candidate).split(path.sep).join("/");
    digest.update(stats.isDirectory() ? "d\0" : "f\0").update(relative).update("\0");
    if (stats.isDirectory()) hashTree(root, candidate, digest);
    else digest.update(fs.readFileSync(candidate)).update("\0");
  }
}

export function normalizePiPackageInstallRequest(request: PiPackageInstallRequest): PiPackageInstallRequest {
  if (!REQUEST_ID_PATTERN.test(request.requestId)) throw packageError("package.request_invalid", "Package request identity is invalid.");
  if (!PACKAGE_NAME_PATTERN.test(request.packageName)) throw packageError("package.name_invalid", "Package name is invalid.");
  if (!EXACT_VERSION_PATTERN.test(request.version)) throw packageError("package.version_invalid", "An exact package version is required.");
  return Object.freeze({ requestId: request.requestId, packageName: request.packageName, version: request.version });
}

function requireRegistryUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) throw packageError("package.metadata_invalid", "Package tarball URL is unavailable.");
  const parsed = new URL(value);
  if (parsed.origin !== REGISTRY_ORIGIN || parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw packageError("package.registry_url_invalid", "Package tarball left the reviewed registry origin.");
  }
  return parsed.toString();
}

function requireSha512Integrity(value: unknown): string {
  if (typeof value !== "string" || !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(value)) {
    throw packageError("package.integrity_missing", "Package registry did not provide SHA-512 integrity.");
  }
  return value;
}

function createPinnedAgent(target: FetchTarget): Agent {
  return new Agent({
    allowH2: false,
    connections: 1,
    pipelining: 1,
    connect: { lookup: createPinnedLookup(target.hostname, target.addresses) as LookupFunction }
  });
}

async function lookupHostname(hostname: string): Promise<readonly string[]> {
  const literal = stripBrackets(hostname);
  if (net.isIP(literal)) return [literal];
  return (await dnsLookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
}

function stripBrackets(value: string): string {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

async function readBoundedBody(response: Response, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  if (!response.body) throw packageError("package.download_failed", "Package response has no body.");
  const chunks: Buffer[] = [];
  let bytes = 0;
  const reader = response.body.getReader();
  while (true) {
    signal.throwIfAborted();
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    bytes += value.byteLength;
    if (bytes > maxBytes) throw packageError("package.download_too_large", "Package response exceeded its size limit.");
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function canonicalPrivateRoot(value: string): string {
  if (!path.isAbsolute(value)) throw packageError("package.root_invalid", "Package root must be absolute.");
  fs.mkdirSync(value, { recursive: true, mode: 0o700 });
  const canonical = fs.realpathSync.native(value);
  const stats = fs.lstatSync(canonical);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw packageError("package.root_invalid", "Package root is unsafe.");
  return canonical;
}

function validateRegistry(value: unknown): PackageRegistryFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid registry");
  const candidate = value as Partial<PackageRegistryFile>;
  if (candidate.schemaVersion !== 1 || !Number.isSafeInteger(candidate.revision) || candidate.revision! < 0 || !Array.isArray(candidate.packages)) throw new Error("invalid registry");
  const records = candidate.packages.map(validateRecord).sort(compareRecords);
  const coordinates = new Set<string>();
  const requestIds = new Set<string>();
  for (const record of records) {
    const coordinate = `${record.packageName}@${record.version}`;
    if (coordinates.has(coordinate)) throw new Error("duplicate package");
    coordinates.add(coordinate);
    for (const request of record.requests) {
      if (request.revision > candidate.revision! || requestIds.has(request.requestId)) throw new Error("invalid package request");
      requestIds.add(request.requestId);
    }
  }
  return { schemaVersion: 1, revision: candidate.revision!, packages: records };
}

function validateRecord(value: unknown): PackageRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid record");
  const record = value as Partial<PackageRecord>;
  if (
    typeof record.packageName !== "string" || !PACKAGE_NAME_PATTERN.test(record.packageName) ||
    record.packageId !== createPackageId(record.packageName) || typeof record.version !== "string" || !EXACT_VERSION_PATTERN.test(record.version) ||
    typeof record.treeHash !== "string" || !SHA256_PATTERN.test(record.treeHash) || typeof record.archiveHash !== "string" || !SHA256_PATTERN.test(record.archiveHash) ||
    typeof record.integrity !== "string" || !/^sha512-/u.test(record.integrity) || typeof record.manifestHash !== "string" || !SHA256_PATTERN.test(record.manifestHash) ||
    typeof record.relativePath !== "string" || path.isAbsolute(record.relativePath) || record.relativePath.split(/[\\/]/u).includes("..") ||
    typeof record.installedAt !== "string" || Number.isNaN(Date.parse(record.installedAt)) || record.enabled !== false || record.trust !== "community" ||
    !Array.isArray(record.packageTypes) || record.packageTypes.length === 0 || record.packageTypes.some((type) => !["extension", "skill", "prompt", "theme"].includes(type)) ||
    !Number.isSafeInteger(record.dependencyCount) || record.dependencyCount! < 0 || record.dependencyCount! > 256 ||
    !Array.isArray(record.requests) || record.requests.length === 0 || record.requests.length > 1024 ||
    record.requests.some((request) => !request || typeof request !== "object" ||
      typeof request.requestId !== "string" || !REQUEST_ID_PATTERN.test(request.requestId) ||
      !Number.isSafeInteger(request.revision) || request.revision < 1 || request.revision > Number.MAX_SAFE_INTEGER) ||
    new Set(record.requests.map((request) => request.requestId)).size !== record.requests.length
  ) throw new Error("invalid record");
  return record as PackageRecord;
}

function replaceRecord(registry: PackageRegistryFile, record: PackageRecord, revision: number): PackageRegistryFile {
  if (revision !== incrementRevision(registry.revision)) throw packageError("package.registry_invalid", "Package Registry revision is invalid.");
  return { schemaVersion: 1, revision, packages: registry.packages.map((candidate) => candidate.packageId === record.packageId && candidate.version === record.version ? record : candidate).sort(compareRecords) };
}

function compareRecords(left: PackageRecord, right: PackageRecord): number {
  return left.packageId.localeCompare(right.packageId, "en") || left.version.localeCompare(right.version, "en");
}

function projectRecord(record: PackageRecord, revision: number): PiPackageInstallSummary {
  return { status: "installed_disabled", packageId: record.packageId, packageName: record.packageName, version: record.version, revision, packageTypes: record.packageTypes, dependencyCount: record.dependencyCount, requiresEnable: true };
}

function requestRecord(record: PackageRecord, requestId: string): PackageRequestRecord | undefined {
  return record.requests.find((request) => request.requestId === requestId);
}

function assertSameRequest(record: PackageRecord, request: PiPackageInstallRequest): void {
  if (record.packageName !== request.packageName || record.version !== request.version) throw packageError("package.request_conflict", "Package request identity was reused for another package.");
}

function createPackageId(name: string): string {
  return `pkg_${createHash("sha256").update(name, "utf8").digest("hex").slice(0, 24)}`;
}

function hashCanonical(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function manifestIdentity(manifest: Record<string, any>): Record<string, unknown> {
  return {
    name: manifest.name,
    version: manifest.version,
    pi: manifest.pi ?? null,
    scripts: manifest.scripts ?? null,
    dependencies: manifest.dependencies ?? null,
    optionalDependencies: manifest.optionalDependencies ?? null,
    peerDependencies: manifest.peerDependencies ?? null,
    bundledDependencies: manifest.bundledDependencies ?? null,
    bundleDependencies: manifest.bundleDependencies ?? null
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw packageError("package.metadata_invalid", "Package metadata contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  throw packageError("package.metadata_invalid", "Package metadata is invalid.");
}

function acquireLock(lockPath: string): { readonly release: () => void } {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  let descriptor: number;
  try { descriptor = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600); }
  catch { throw packageError("package.install_busy", "Another package action is already running."); }
  const token = randomUUID();
  const body = `${process.pid}:${token}\n`;
  fs.writeFileSync(descriptor, body, "utf8");
  fs.fsyncSync(descriptor);
  fs.closeSync(descriptor);
  const identity = fs.lstatSync(lockPath);
  ACTIVE_PACKAGE_LOCKS.add(lockPath);
  return { release: () => {
    try {
      const current = fs.lstatSync(lockPath);
      if (!current.isFile() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino || fs.readFileSync(lockPath, "utf8") !== body) return;
      const released = `${lockPath}.released.${randomUUID()}`;
      fs.renameSync(lockPath, released);
      fs.rmSync(released, { force: true });
      fsyncDirectory(path.dirname(lockPath));
    } catch { /* Uncertain cleanup remains fail-closed. */ }
    finally { ACTIVE_PACKAGE_LOCKS.delete(lockPath); }
  } };
}

function recoverOrphanedLock(lockPath: string, processAlive: (pid: number) => boolean): void {
  if (ACTIVE_PACKAGE_LOCKS.has(lockPath) || !fs.existsSync(lockPath)) return;
  const stats = fs.lstatSync(lockPath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 512) {
    throw packageError("package.install_lock_invalid", "Package install lock is unsafe.");
  }
  const body = fs.readFileSync(lockPath, "utf8");
  const match = /^(\d{1,10}):([0-9a-f-]{36})\n$/iu.exec(body);
  if (!match) throw packageError("package.install_lock_invalid", "Package install lock is invalid.");
  const ownerPid = Number(match[1]);
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
    throw packageError("package.install_lock_invalid", "Package install lock is invalid.");
  }
  if (processAlive(ownerPid)) throw packageError("package.install_busy", "Another package action is already running.");
  const recovered = `${lockPath}.recovered.${randomUUID()}`;
  fs.renameSync(lockPath, recovered);
  fs.rmSync(recovered, { force: true });
  fsyncDirectory(path.dirname(lockPath));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (caught) {
    return (caught as NodeJS.ErrnoException)?.code !== "ESRCH";
  }
}

function readOwnerMarker(root: string): PackageOwnerMarker | undefined {
  try {
    const value = parseBoundedJson(path.join(root, OWNER_MARKER), 4096) as Partial<PackageOwnerMarker>;
    if (value.schemaVersion !== 1 || typeof value.requestId !== "string" || !REQUEST_ID_PATTERN.test(value.requestId) || typeof value.packageName !== "string" || !PACKAGE_NAME_PATTERN.test(value.packageName) || typeof value.version !== "string" || !EXACT_VERSION_PATTERN.test(value.version) || value.packageId !== createPackageId(value.packageName)) return undefined;
    return value as PackageOwnerMarker;
  } catch { return undefined; }
}

function removeOwnedDirectory(root: string, requestId: string): void {
  const marker = readOwnerMarker(root) ?? readOwnerMarker(path.join(root, "package"));
  if (marker?.requestId !== requestId) return;
  fs.rmSync(root, { recursive: true });
}

function walkVersionDirectories(root: string): readonly string[] {
  const output: string[] = [];
  for (const packageId of safeSubdirectories(root)) for (const version of safeSubdirectories(path.join(root, packageId))) for (const digest of safeSubdirectories(path.join(root, packageId, version))) output.push(path.join(root, packageId, version, digest));
  return output;
}

function safeSubdirectories(root: string): readonly string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((entry) => {
    const stats = fs.lstatSync(path.join(root, entry));
    return stats.isDirectory() && !stats.isSymbolicLink();
  });
}

function parseBoundedJson(filePath: string, maxBytes: number): any {
  const body = readBoundedNoFollow(filePath, maxBytes);
  if (body === undefined) throw packageError("package.metadata_invalid", "Package metadata is missing.");
  try { return JSON.parse(body); } catch { throw packageError("package.metadata_invalid", "Package metadata is invalid."); }
}

function readBoundedNoFollow(filePath: string, maxBytes: number): string | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile() || stats.size > maxBytes) throw packageError("package.metadata_invalid", "Package metadata is invalid.");
    return fs.readFileSync(descriptor, "utf8");
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
    throw caught;
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function writePrivateJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  const descriptor = fs.openSync(filePath, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function ensureConfined(root: string, candidate: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw packageError("package.path_invalid", "Package path escaped managed storage.");
}

function fsyncDirectory(directory: string): void {
  let descriptor: number | undefined;
  try { descriptor = fs.openSync(directory, fs.constants.O_RDONLY); fs.fsyncSync(descriptor); }
  catch (caught) { if (process.platform !== "win32") throw caught; }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function incrementRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) throw packageError("package.registry_revision_exhausted", "Package Registry revision is exhausted.");
  return value + 1;
}

function normalizeFailure(caught: unknown): Error {
  if (caught instanceof DOMException && caught.name === "AbortError") return caught;
  if (caught instanceof PigeDomainError) return caught;
  return packageError("package.install_failed", "Package installation failed.");
}

function normalizeFilterError(caught: unknown): PigeDomainError {
  return caught instanceof PigeDomainError
    ? caught
    : packageError("package.archive_unsafe_entry", "Package archive contains an unsafe entry.");
}

function packageError(code: string, message: string): PigeDomainError {
  return new PigeDomainError(code, message);
}
