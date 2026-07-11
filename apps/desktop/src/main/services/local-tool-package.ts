import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const MANIFEST_FILE_NAME = "manifest.json";
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;

export interface LocalToolLicenseIdentity {
  readonly spdxId: string;
  readonly name?: string;
}

export interface LocalToolPackageFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly executable: boolean;
}

export interface LocalToolPackageManifest {
  readonly schemaVersion: 1;
  readonly toolId: string;
  readonly assetId?: string;
  readonly version: string;
  readonly platform: "macos" | "windows" | "linux";
  readonly architecture: "arm64" | "x64";
  readonly capabilities: readonly string[];
  readonly license: LocalToolLicenseIdentity;
  readonly files: readonly LocalToolPackageFile[];
}

export interface LocalToolPackageIdentity {
  readonly toolId: string;
  readonly assetId?: string;
  readonly version: string;
  readonly platform: "macos" | "windows" | "linux";
  readonly architecture: "arm64" | "x64";
  readonly capabilities: readonly string[];
  readonly license: LocalToolLicenseIdentity;
  readonly expectedSha256: string;
  readonly expectedSizeBytes: number;
}

export interface LocalToolPackageLimits {
  readonly maxManifestBytes: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly maxFiles: number;
}

export interface StagedLocalToolPackage {
  readonly stagingPath: string;
  readonly manifest: LocalToolPackageManifest;
  readonly packageSha256: string;
  readonly sizeBytes: number;
}

export const DEFAULT_LOCAL_TOOL_PACKAGE_LIMITS: LocalToolPackageLimits = {
  maxManifestBytes: 256 * 1024,
  maxFileBytes: 32 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxFiles: 256
};

export class LocalToolPackageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LocalToolPackageError";
    this.code = code;
  }
}

export function stageLocalToolPackage(input: {
  readonly candidatePath: string;
  readonly stagingPath: string;
  readonly expected: LocalToolPackageIdentity;
  readonly limits?: LocalToolPackageLimits;
}): StagedLocalToolPackage {
  const limits = input.limits ?? DEFAULT_LOCAL_TOOL_PACKAGE_LIMITS;
  const candidate = inspectPackageDirectory(input.candidatePath, limits);
  assertPackageIdentity(candidate, input.expected);
  createPrivateDirectory(input.stagingPath);

  try {
    copyPackageDirectory(input.candidatePath, input.stagingPath, candidate.manifest, limits);
    const staged = inspectPackageDirectory(input.stagingPath, limits);
    assertPackageIdentity(staged, input.expected);
    fsyncDirectoryTree(input.stagingPath);
    return {
      stagingPath: input.stagingPath,
      manifest: staged.manifest,
      packageSha256: staged.packageSha256,
      sizeBytes: staged.sizeBytes
    };
  } catch (caught) {
    fs.rmSync(input.stagingPath, { recursive: true, force: true });
    throw caught;
  }
}

export function verifyLocalToolPackageDirectory(
  packagePath: string,
  expected: LocalToolPackageIdentity,
  limits: LocalToolPackageLimits = DEFAULT_LOCAL_TOOL_PACKAGE_LIMITS
): StagedLocalToolPackage {
  const inspected = inspectPackageDirectory(packagePath, limits);
  assertPackageIdentity(inspected, expected);
  return {
    stagingPath: packagePath,
    manifest: inspected.manifest,
    packageSha256: inspected.packageSha256,
    sizeBytes: inspected.sizeBytes
  };
}

export function computeLocalToolPackageSha256(
  packagePath: string,
  limits: LocalToolPackageLimits = DEFAULT_LOCAL_TOOL_PACKAGE_LIMITS
): string {
  return inspectPackageDirectory(packagePath, limits).packageSha256;
}

export function parseLocalToolPackageManifest(
  value: unknown,
  limits: LocalToolPackageLimits = DEFAULT_LOCAL_TOOL_PACKAGE_LIMITS
): LocalToolPackageManifest {
  const record = requireObject(value, "manifest");
  assertExactKeys(record, [
    "schemaVersion",
    "toolId",
    "assetId",
    "version",
    "platform",
    "architecture",
    "capabilities",
    "license",
    "files"
  ], "manifest");
  if (record.schemaVersion !== 1) fail("settings.local_tool_manifest_invalid", "Unsupported local-tool manifest schema.");

  const toolId = requireSafeId(record.toolId, "toolId");
  const assetId = record.assetId === undefined ? undefined : requireSafeId(record.assetId, "assetId");
  const version = requireSafeVersion(record.version);
  const platform = requireEnum(record.platform, ["macos", "windows", "linux"] as const, "platform");
  const architecture = requireEnum(record.architecture, ["arm64", "x64"] as const, "architecture");
  const capabilities = requireUniqueStrings(record.capabilities, "capabilities", 64);
  const license = parseLicense(record.license);
  if (!Array.isArray(record.files) || record.files.length === 0 || record.files.length > limits.maxFiles) {
    fail("settings.local_tool_manifest_invalid", "Local-tool manifest files are outside the supported bounds.");
  }

  const seenPaths = new Set<string>();
  const seenFoldedPaths = new Set<string>();
  let aggregateSize = 0;
  const files = record.files.map((entry, index) => {
    const file = requireObject(entry, `files[${index}]`);
    assertExactKeys(file, ["path", "sizeBytes", "sha256", "executable"], `files[${index}]`);
    const relativePath = requireSafeRelativePath(file.path);
    const foldedPath = relativePath.toLocaleLowerCase("en-US");
    if (seenPaths.has(relativePath) || seenFoldedPaths.has(foldedPath)) {
      fail("settings.local_tool_path_collision", "Local-tool manifest paths must be unique without case collisions.");
    }
    seenPaths.add(relativePath);
    seenFoldedPaths.add(foldedPath);
    const sizeBytes = requireBoundedSize(file.sizeBytes, limits.maxFileBytes, `files[${index}].sizeBytes`);
    aggregateSize += sizeBytes;
    if (aggregateSize > limits.maxTotalBytes) {
      fail("settings.local_tool_size_exceeded", "Local-tool package exceeds the aggregate size limit.");
    }
    const sha256 = requireSha256(file.sha256, `files[${index}].sha256`);
    if (typeof file.executable !== "boolean") {
      fail("settings.local_tool_manifest_invalid", `files[${index}].executable is invalid.`);
    }
    return { path: relativePath, sizeBytes, sha256, executable: file.executable };
  });

  return {
    schemaVersion: 1,
    toolId,
    ...(assetId ? { assetId } : {}),
    version,
    platform,
    architecture,
    capabilities,
    license,
    files
  };
}

function inspectPackageDirectory(
  packagePath: string,
  limits: LocalToolPackageLimits
): {
  readonly manifest: LocalToolPackageManifest;
  readonly manifestBytes: Buffer;
  readonly packageSha256: string;
  readonly sizeBytes: number;
} {
  assertDirectoryWithoutSymlink(packagePath);
  const actualFiles = collectRegularFiles(packagePath);
  if (!actualFiles.includes(MANIFEST_FILE_NAME)) {
    fail("settings.local_tool_manifest_missing", "Local-tool package manifest is missing.");
  }
  if (actualFiles.length - 1 > limits.maxFiles) {
    fail("settings.local_tool_size_exceeded", "Local-tool package contains too many files.");
  }

  const manifestPath = path.join(packagePath, MANIFEST_FILE_NAME);
  const manifestStats = readRegularFileStats(manifestPath);
  if (manifestStats.size > limits.maxManifestBytes) {
    fail("settings.local_tool_size_exceeded", "Local-tool package manifest is too large.");
  }
  const manifestBytes = readFileNoFollow(manifestPath, limits.maxManifestBytes);
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    fail("settings.local_tool_manifest_invalid", "Local-tool package manifest is invalid JSON.");
  }
  const manifest = parseLocalToolPackageManifest(manifestValue, limits);
  const declaredPaths = new Set(manifest.files.map((file) => file.path));
  const actualPayloadPaths = actualFiles.filter((file) => file !== MANIFEST_FILE_NAME);
  for (const actualPath of actualPayloadPaths) {
    if (!declaredPaths.has(actualPath)) {
      fail("settings.local_tool_undeclared_file", "Local-tool package contains an undeclared file.");
    }
  }
  for (const declaredPath of declaredPaths) {
    if (!actualPayloadPaths.includes(declaredPath)) {
      fail("settings.local_tool_file_missing", "Local-tool package is missing a declared file.");
    }
  }

  let aggregateSize = 0;
  for (const file of manifest.files) {
    assertPathSegmentsWithoutSymlink(packagePath, file.path);
    const absolutePath = resolveConfinedRelativePath(packagePath, file.path);
    const stats = readRegularFileStats(absolutePath);
    if (stats.size !== file.sizeBytes) {
      fail("settings.local_tool_size_mismatch", "Local-tool package file size does not match its manifest.");
    }
    aggregateSize += stats.size;
    if (aggregateSize > limits.maxTotalBytes) {
      fail("settings.local_tool_size_exceeded", "Local-tool package exceeds the aggregate size limit.");
    }
    if (sha256File(absolutePath, limits.maxFileBytes) !== file.sha256) {
      fail("settings.local_tool_checksum_mismatch", "Local-tool package file checksum does not match its manifest.");
    }
    if (process.platform !== "win32" && ((stats.mode & 0o111) !== 0) !== file.executable) {
      fail("settings.local_tool_mode_mismatch", "Local-tool package file mode does not match its manifest.");
    }
  }

  return {
    manifest,
    manifestBytes,
    packageSha256: hashPackage(packagePath, manifestBytes, manifest.files, limits),
    sizeBytes: aggregateSize
  };
}

function assertPackageIdentity(
  inspected: {
    readonly manifest: LocalToolPackageManifest;
    readonly packageSha256: string;
    readonly sizeBytes: number;
  },
  expected: LocalToolPackageIdentity
): void {
  const manifest = inspected.manifest;
  if (manifest.toolId !== expected.toolId || manifest.assetId !== expected.assetId || manifest.version !== expected.version) {
    fail("settings.local_tool_identity_mismatch", "Local-tool package identity does not match the approved definition.");
  }
  if (manifest.platform !== expected.platform || manifest.architecture !== expected.architecture) {
    fail("settings.local_tool_platform_mismatch", "Local-tool package platform does not match the approved definition.");
  }
  if (!equalStringSets(manifest.capabilities, expected.capabilities)) {
    fail("settings.local_tool_capability_mismatch", "Local-tool package capabilities do not match the approved definition.");
  }
  if (!equalLicense(manifest.license, expected.license)) {
    fail("settings.local_tool_license_mismatch", "Local-tool package license does not match the approved definition.");
  }
  if (inspected.sizeBytes !== expected.expectedSizeBytes) {
    fail("settings.local_tool_size_mismatch", "Local-tool package size does not match the approved definition.");
  }
  if (inspected.packageSha256 !== expected.expectedSha256) {
    fail("settings.local_tool_checksum_mismatch", "Local-tool package checksum does not match the approved definition.");
  }
}

function copyPackageDirectory(
  sourceRoot: string,
  destinationRoot: string,
  manifest: LocalToolPackageManifest,
  limits: LocalToolPackageLimits
): void {
  copyFileExclusive(
    path.join(sourceRoot, MANIFEST_FILE_NAME),
    path.join(destinationRoot, MANIFEST_FILE_NAME),
    limits.maxManifestBytes
  );
  for (const file of manifest.files) {
    assertPathSegmentsWithoutSymlink(sourceRoot, file.path);
    const sourcePath = resolveConfinedRelativePath(sourceRoot, file.path);
    const destinationPath = resolveConfinedRelativePath(destinationRoot, file.path);
    createPrivateParents(destinationRoot, path.dirname(destinationPath));
    copyFileExclusive(sourcePath, destinationPath, limits.maxFileBytes, file.executable ? 0o700 : 0o600);
  }
}

function copyFileExclusive(sourcePath: string, destinationPath: string, maxBytes: number, mode = 0o600): void {
  const readFlags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const writeFlags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0);
  let sourceDescriptor: number | undefined;
  let destinationDescriptor: number | undefined;
  try {
    sourceDescriptor = fs.openSync(sourcePath, readFlags);
    const sourceStats = fs.fstatSync(sourceDescriptor);
    if (!sourceStats.isFile() || sourceStats.size > maxBytes) {
      fail("settings.local_tool_file_invalid", "Local-tool package entry is not a supported regular file.");
    }
    destinationDescriptor = fs.openSync(destinationPath, writeFlags, mode);
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let total = 0;
    for (;;) {
      const bytesRead = fs.readSync(sourceDescriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) fail("settings.local_tool_size_exceeded", "Local-tool package file exceeds its limit.");
      let written = 0;
      while (written < bytesRead) {
        written += fs.writeSync(destinationDescriptor, buffer, written, bytesRead - written);
      }
    }
    fs.fsyncSync(destinationDescriptor);
  } finally {
    if (destinationDescriptor !== undefined) fs.closeSync(destinationDescriptor);
    if (sourceDescriptor !== undefined) fs.closeSync(sourceDescriptor);
  }
}

function hashPackage(
  packagePath: string,
  manifestBytes: Buffer,
  files: readonly LocalToolPackageFile[],
  limits: LocalToolPackageLimits
): string {
  const hash = createHash("sha256");
  hash.update("pige-local-tool-package-v1\0", "utf8");
  updateFramedBuffer(hash, "manifest.json", manifestBytes);
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    const absolutePath = resolveConfinedRelativePath(packagePath, file.path);
    updateFramedFile(hash, file.path, absolutePath, limits.maxFileBytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

function updateFramedBuffer(hash: ReturnType<typeof createHash>, relativePath: string, value: Buffer): void {
  hash.update(`entry\0${relativePath}\0${value.length}\0`, "utf8");
  hash.update(value);
}

function updateFramedFile(
  hash: ReturnType<typeof createHash>,
  relativePath: string,
  absolutePath: string,
  maxBytes: number
): void {
  const stats = readRegularFileStats(absolutePath);
  if (stats.size > maxBytes) fail("settings.local_tool_size_exceeded", "Local-tool package file exceeds its limit.");
  hash.update(`entry\0${relativePath}\0${stats.size}\0`, "utf8");
  const descriptor = fs.openSync(absolutePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function sha256File(filePath: string, maxBytes: number): string {
  const hash = createHash("sha256");
  const stats = readRegularFileStats(filePath);
  if (stats.size > maxBytes) fail("settings.local_tool_size_exceeded", "Local-tool package file exceeds its limit.");
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return `sha256:${hash.digest("hex")}`;
}

function collectRegularFiles(rootPath: string, relativeDirectory = ""): string[] {
  const absoluteDirectory = relativeDirectory
    ? resolveConfinedRelativePath(rootPath, relativeDirectory)
    : rootPath;
  const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true });
  const files: string[] = [];
  const foldedNames = new Set<string>();
  for (const entry of entries) {
    const folded = entry.name.toLocaleLowerCase("en-US");
    if (foldedNames.has(folded)) {
      fail("settings.local_tool_path_collision", "Local-tool package entries collide by case.");
    }
    foldedNames.add(folded);
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    requireSafeRelativePath(relativePath);
    const absolutePath = resolveConfinedRelativePath(rootPath, relativePath);
    const stats = fs.lstatSync(absolutePath);
    if (stats.isSymbolicLink()) {
      fail("settings.local_tool_symlink_rejected", "Local-tool packages cannot contain symbolic links.");
    }
    if (stats.isDirectory()) {
      files.push(...collectRegularFiles(rootPath, relativePath));
    } else if (stats.isFile()) {
      files.push(relativePath);
    } else {
      fail("settings.local_tool_file_invalid", "Local-tool package entries must be regular files or directories.");
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function assertDirectoryWithoutSymlink(directoryPath: string): void {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(directoryPath);
  } catch {
    fail("settings.local_tool_candidate_missing", "Local-tool package directory is unavailable.");
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    fail("settings.local_tool_candidate_invalid", "Local-tool candidate must be a non-symlink directory.");
  }
}

function assertPathSegmentsWithoutSymlink(rootPath: string, relativePath: string): void {
  let currentPath = rootPath;
  for (const segment of relativePath.split("/")) {
    currentPath = path.join(currentPath, segment);
    const stats = fs.lstatSync(currentPath);
    if (stats.isSymbolicLink()) {
      fail("settings.local_tool_symlink_rejected", "Local-tool package paths cannot traverse symbolic links.");
    }
  }
}

function resolveConfinedRelativePath(rootPath: string, relativePath: string): string {
  const safeRelativePath = requireSafeRelativePath(relativePath);
  const resolvedRoot = path.resolve(rootPath);
  const resolvedPath = path.resolve(resolvedRoot, ...safeRelativePath.split("/"));
  if (resolvedPath === resolvedRoot || !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    fail("settings.local_tool_path_escape", "Local-tool package path escapes its root.");
  }
  return resolvedPath;
}

function requireSafeRelativePath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    fail("settings.local_tool_path_invalid", "Local-tool package path is invalid.");
  }
  if (
    value.includes("\\") ||
    value.includes("\0") ||
    value.includes("%") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  ) {
    fail("settings.local_tool_path_invalid", "Local-tool package path must be a plain relative path.");
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    fail("settings.local_tool_path_escape", "Local-tool package path contains an unsafe segment.");
  }
  if (path.posix.normalize(value) !== value) {
    fail("settings.local_tool_path_escape", "Local-tool package path is not canonical.");
  }
  return value;
}

function createPrivateDirectory(directoryPath: string): void {
  fs.mkdirSync(path.dirname(directoryPath), { recursive: true, mode: 0o700 });
  fs.mkdirSync(directoryPath, { recursive: false, mode: 0o700 });
}

function createPrivateParents(rootPath: string, directoryPath: string): void {
  const root = path.resolve(rootPath);
  const target = path.resolve(directoryPath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    fail("settings.local_tool_path_escape", "Local-tool staging path escapes its root.");
  }
  if (target === root) return;
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    const stats = fs.lstatSync(current);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      fail("settings.local_tool_symlink_rejected", "Local-tool staging parents must be private directories.");
    }
  }
}

function fsyncDirectoryTree(rootPath: string): void {
  const directories: string[] = [rootPath];
  const visit = (directoryPath: string): void => {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = path.join(directoryPath, entry.name);
      directories.push(child);
      visit(child);
    }
  };
  visit(rootPath);
  for (const directory of directories.reverse()) fsyncDirectoryIfSupported(directory);
}

function fsyncDirectoryIfSupported(directoryPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (caught) {
    if (!isUnsupportedDirectoryFsync(caught)) throw caught;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function isUnsupportedDirectoryFsync(caught: unknown): boolean {
  if (typeof caught !== "object" || caught === null || !("code" in caught)) return false;
  return ["EBADF", "EINVAL", "EISDIR", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EPERM"]
    .includes(String(caught.code));
}

function readFileNoFollow(filePath: string, maxBytes: number): Buffer {
  const stats = readRegularFileStats(filePath);
  if (stats.size > maxBytes) fail("settings.local_tool_size_exceeded", "Local-tool package file exceeds its limit.");
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const buffer = Buffer.alloc(stats.size);
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = fs.readSync(descriptor, buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return buffer.subarray(0, offset);
  } finally {
    fs.closeSync(descriptor);
  }
}

function readRegularFileStats(filePath: string): fs.Stats {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(filePath);
  } catch {
    fail("settings.local_tool_file_missing", "Local-tool package file is unavailable.");
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    fail("settings.local_tool_file_invalid", "Local-tool package entry must be a regular file.");
  }
  return stats;
}

function parseLicense(value: unknown): LocalToolLicenseIdentity {
  const record = requireObject(value, "license");
  assertExactKeys(record, ["spdxId", "name"], "license");
  const spdxId = requireString(record.spdxId, "license.spdxId", 1, 80);
  const name = record.name === undefined ? undefined : requireString(record.name, "license.name", 1, 160);
  return { spdxId, ...(name ? { name } : {}) };
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("settings.local_tool_manifest_invalid", `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    fail("settings.local_tool_manifest_invalid", `${label} contains an unsupported field.`);
  }
}

function requireSafeId(value: unknown, label: string): string {
  const id = requireString(value, label, 1, 80);
  if (!SAFE_ID_PATTERN.test(id)) fail("settings.local_tool_identity_mismatch", `${label} is invalid.`);
  return id;
}

function requireSafeVersion(value: unknown): string {
  const version = requireString(value, "version", 1, 80);
  if (!/^[0-9A-Za-z][0-9A-Za-z._+-]{0,79}$/.test(version)) {
    fail("settings.local_tool_identity_mismatch", "Local-tool version is invalid.");
  }
  return version;
}

function requireString(value: unknown, label: string, minLength: number, maxLength: number): string {
  if (typeof value !== "string" || value.length < minLength || value.length > maxLength) {
    fail("settings.local_tool_manifest_invalid", `${label} is invalid.`);
  }
  return value;
}

function requireUniqueStrings(value: unknown, label: string, maxItems: number): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    fail("settings.local_tool_manifest_invalid", `${label} is invalid.`);
  }
  const strings = value.map((entry, index) => requireString(entry, `${label}[${index}]`, 1, 120));
  if (new Set(strings).size !== strings.length) {
    fail("settings.local_tool_manifest_invalid", `${label} must contain unique values.`);
  }
  return strings;
}

function requireBoundedSize(value: unknown, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
    fail("settings.local_tool_size_exceeded", `${label} is outside the supported range.`);
  }
  return value;
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail("settings.local_tool_checksum_mismatch", `${label} is not a valid SHA-256 value.`);
  }
  return value;
}

function requireEnum<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    fail("settings.local_tool_manifest_invalid", `${label} is invalid.`);
  }
  return value as Values[number];
}

function equalStringSets(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function equalLicense(left: LocalToolLicenseIdentity, right: LocalToolLicenseIdentity): boolean {
  return left.spdxId === right.spdxId && left.name === right.name;
}

function fail(code: string, message: string): never {
  throw new LocalToolPackageError(code, message);
}
